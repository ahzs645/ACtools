import "./styles.css";

import { sendRuntimeMessage } from "../shared/chrome";
import { formatError } from "../shared/errors";
import type { AlayaCareFormContextCatalogSnapshot } from "../shared/formContextCatalog";
import type {
  ClientChartExportSnapshot,
  ClientChartRankedResult,
  ClientChartRankResponse,
  ClientChartSearchResponse,
  ClientChartSearchResult
} from "../shared/clientChart";
import type { ClientChartPdfParseSnapshot } from "../shared/clientChartPdf";
import {
  buildClientChartImportPreview,
  isSyntheticClientName,
  type ClientChartDestinationCatalog,
  type ClientChartDestinationGroup,
  type ClientChartImportPreview,
  type ClientChartImportResult
} from "../shared/clientChartImport";
import { buildAlayaCareCatalogCsv } from "../shared/formContextCsv";
import { buildAlayaCareCatalogXlsx } from "../shared/formContextXlsx";
import type {
  EmployeeApiCredentialStatus,
  EmployeeConfiguredTenant,
  EmployeeDetail,
  EmployeeListResult,
  EmployeeSummary,
  EmployeeWriteResult
} from "../shared/employees";
import type { AppPreferences } from "../shared/environments";
import {
  DEFAULT_FEATURE_FLAGS,
  FEATURE_FLAG_LABELS,
  disabledFeatureMessage,
  loadFeatureFlags,
  saveFeatureFlags,
  type AcFeatureFlag,
  type AcFeatureFlags
} from "../shared/featureFlags";
import { EnvironmentManagerController } from "./features/environments/controller";
import { ConnectorUtilitiesController } from "./features/connectors/controller";
import { clearEmployeeCaches, cacheEmployees, loadCachedEmployees } from "./features/employees/cache";
import { EmployeeCopyController } from "./features/employees/copyController";
import { ShiftLabController } from "./features/shifts/controller";
import {
  type EmployeeSortField,
  type SortDirection,
  sortEmployees
} from "./features/employees/sort";
import { loadAppPreferences, resetAppPreferences, saveAppPreferences } from "./features/preferences";
import { setDetailHeader, setDetailSubtitle } from "./ui/detailHeader";
import {
  hideResultScope,
  setResult,
  setResultWorking,
  showResultScope,
  withResult
} from "./ui/result";
import { showToast } from "./ui/toasts";
import {
  DEFAULT_SURFACE,
  POPUP_FORM_STORAGE_KEY,
  SURFACE_STORAGE_KEY,
  type AvailabilityDraft,
  type AvailabilityPostResult,
  type PageStatus,
  type Surface
} from "../shared/messages";

const THEME_STORAGE_KEY = "ac-tools-theme";

type ThemeMode = "system" | "light" | "dark";

const SETTINGS_TITLE = "Settings";
const SETTINGS_SUBTITLE = "Configure how AC Tools opens and looks.";

const defaultDate = new Date().toISOString().slice(0, 10);

const defaultDraft: AvailabilityDraft = {
  employeeId: 348,
  availabilityTypeId: 4,
  date: defaultDate,
  startTime: "08:00",
  endTime: "16:30",
  description: "CHROMIUM EXTENSION"
};

let currentSurface: Surface = readInitialSurface();
let employeeItems: EmployeeSummary[] = [];
let selectedEmployee: EmployeeDetail | null = null;
let employeeApiCredentialsConfigured = false;
let isUatTenant = false;
let currentEmployeeOrigin = "";
let configuredEmployeeTenants: EmployeeConfiguredTenant[] = [];
let employeeSortField: EmployeeSortField = "last_name";
let employeeSortDirection: SortDirection = "asc";
let appPreferences!: AppPreferences;
let clientChartSnapshot: ClientChartExportSnapshot | null = null;
let clientChartPdfSnapshot: ClientChartPdfParseSnapshot | null = null;
let clientChartSearchResults: ClientChartSearchResult[] = [];
let clientChartRankings = new Map<number, ClientChartRankedResult>();
let clientChartImportPreview: ClientChartImportPreview | null = null;
let clientChartImportResult: ClientChartImportResult | null = null;
let clientChartDestinationCatalog: ClientChartDestinationCatalog | null = null;
let clientChartSelectedGroupIds = new Set<number>();
let activePanelName: string | null = null;
let clientChartView: ClientChartView = "menu";
let featureFlags: AcFeatureFlags = { ...DEFAULT_FEATURE_FLAGS };

const elements = getPopupElements();
const environmentManager = new EnvironmentManagerController(async () => {
  await refreshConfiguredEmployeeTenants();
});
const connectorUtilities = new ConnectorUtilitiesController();
const shiftLab = new ShiftLabController();
const employeeCopyController = new EmployeeCopyController({
  getEmployee: () => selectedEmployee
    ? { ...selectedEmployee, timezone: selectedEmployee.timezone || appPreferences.defaultTimezone }
    : null,
  getEmployeeName: employeeDisplayName,
  getCurrentOrigin: () => currentEmployeeOrigin,
  getSupportUrl: (origin) => environmentManager.getSupportUrl(origin),
  getEnvironmentName: (origin) => environmentManager.getEnvironmentName(origin)
});

void init();

async function init(): Promise<void> {
  connectorUtilities.init();
  await shiftLab.init();
  appPreferences = await loadAppPreferences();
  await applyStoredTheme();
  await applyStoredSurfaceSelection();
  applyEmployeePreferences();
  await hydrateForm();
  await refreshStatus();
  await environmentManager.init();
  employeeCopyController.init();
  elements.extensionVersion.textContent = `v${chrome.runtime.getManifest().version}`;
  featureFlags = await loadFeatureFlags();
  applyFeatureFlagToggles();
  applyClientChartGuard();

  elements.themeToggle.addEventListener("click", () => {
    void toggleTheme();
  });

  elements.settingsButton.addEventListener("click", () => {
    showSettings();
  });

  elements.refreshStatusButton.addEventListener("click", () => {
    void refreshStatus();
  });

  elements.catalogJsonExportButton.addEventListener("click", () => {
    void exportFormContextCatalog("json");
  });

  elements.catalogCsvExportButton.addEventListener("click", () => {
    void exportFormContextCatalog("csv");
  });

  elements.catalogXlsxExportButton.addEventListener("click", () => {
    void exportFormContextCatalog("xlsx");
  });

  elements.clientChartSyntheticConfirm.addEventListener("change", () => {
    applyClientChartGuard();
  });

  elements.featureFlagToggles.forEach((toggle) => {
    toggle.addEventListener("change", () => {
      void handleFeatureFlagChange(toggle);
    });
  });

  elements.clientChartNavButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const view = button.dataset.chartNav as ClientChartView | undefined;
      if (view) {
        showClientChartView(view);
      }
    });
  });

  elements.inspectClientChartButton.addEventListener("click", () => {
    void inspectActiveClientChart();
  });

  elements.clientChartSearchInput.addEventListener("input", () => {
    elements.searchClientChartsButton.disabled =
      !elements.clientChartSyntheticConfirm.checked ||
      elements.clientChartSearchInput.value.trim().length < 2;
  });

  elements.clientChartSearchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !elements.searchClientChartsButton.disabled) {
      event.preventDefault();
      void searchClientCharts();
    }
  });

  elements.searchClientChartsButton.addEventListener("click", () => {
    void searchClientCharts();
  });

  elements.rankClientChartsButton.addEventListener("click", () => {
    void rankClientCharts();
  });

  elements.downloadClientChartButton.addEventListener("click", () => {
    if (clientChartSnapshot) downloadClientChartJson(clientChartSnapshot);
  });

  elements.clientChartImportFile.addEventListener("change", () => {
    clientChartImportPreview = null;
    clientChartImportResult = null;
    resetClientChartImportPreviewUi();
    const fileCount = elements.clientChartImportFile.files?.length ?? 0;
    elements.previewClientChartImportButton.disabled =
      !elements.clientChartSyntheticConfirm.checked || fileCount === 0;
    elements.clientChartImportSummary.textContent = fileCount > 0
      ? "JSON selected. Preview it locally before creating a synthetic client."
      : "Select an AC Tools client-chart JSON export.";
  });

  elements.previewClientChartImportButton.addEventListener("click", () => {
    void previewClientChartImport();
  });

  elements.createClientChartImportButton.addEventListener("click", () => {
    void createClientChartImport();
  });

  for (const element of [
    elements.clientChartImportFirstName,
    elements.clientChartImportLastName,
    elements.clientChartImportBirthday,
    elements.clientChartImportHealthCard,
    elements.clientChartImportGender,
    elements.clientChartImportEmail,
    elements.clientChartImportPhoneMain,
    elements.clientChartImportMedicalHistory,
    elements.clientChartImportRiskAssessment,
    elements.clientChartImportProgressNotes,
    elements.clientChartImportMedications,
    elements.clientChartImportCostCentre,
    elements.clientChartImportConfirm
  ]) {
    element.addEventListener("input", updateClientChartImportCreateAvailability);
    element.addEventListener("change", updateClientChartImportCreateAvailability);
  }

  elements.clientChartImportFacilityFilter.addEventListener("input", () => {
    renderClientChartDestinationGroups();
  });

  elements.downloadClientChartImportReportButton.addEventListener("click", () => {
    if (clientChartImportResult) downloadClientChartImportReport(clientChartImportResult);
  });

  elements.clientChartPdfFiles.addEventListener("change", () => {
    clientChartPdfSnapshot = null;
    elements.downloadClientChartPdfJsonButton.disabled = true;
    const files = Array.from(elements.clientChartPdfFiles.files ?? []);
    elements.parseClientChartPdfsButton.disabled =
      !elements.clientChartSyntheticConfirm.checked || files.length === 0;
    elements.clientChartPdfSummary.textContent = files.length > 0
      ? `${files.length} PDF${files.length === 1 ? "" : "s"} selected. Ready to parse locally.`
      : "Select one or more AlayaCare batch PDFs.";
  });

  elements.parseClientChartPdfsButton.addEventListener("click", () => {
    void parseSelectedClientChartPdfs();
  });

  elements.downloadClientChartPdfJsonButton.addEventListener("click", () => {
    if (clientChartPdfSnapshot) downloadClientChartPdfJson(clientChartPdfSnapshot);
  });

  elements.employeeRefreshButton.addEventListener("click", () => {
    void loadEmployees(true);
  });

  elements.employeeSearchInput.addEventListener("input", () => {
    renderEmployeeList();
  });

  elements.employeeStatusFilter.addEventListener("change", () => {
    void loadEmployees();
  });

  elements.employeeSort.addEventListener("change", () => {
    employeeSortField = elements.employeeSort.value as EmployeeSortField;
    renderEmployeeList();
  });

  elements.employeeSortDirection.addEventListener("click", () => {
    employeeSortDirection = employeeSortDirection === "asc" ? "desc" : "asc";
    elements.employeeSortDirection.textContent = employeeSortDirection === "asc" ? "Ascending ↑" : "Descending ↓";
    renderEmployeeList();
  });

  elements.employeeUpdateStatusButton.addEventListener("click", () => {
    void updateSelectedEmployeeStatus();
  });

  elements.employeeApiSaveButton.addEventListener("click", () => {
    void saveEmployeeApiCredentials();
  });

  elements.employeeApiClearButton.addEventListener("click", () => {
    void clearEmployeeApiCredentials();
  });

  elements.employeeTestSelectedButton.addEventListener("click", () => {
    void runSelectedEmployeeRoundTripTest();
  });

  elements.preferencesSave.addEventListener("click", () => void savePreferencesFromUi());
  elements.preferencesReset.addEventListener("click", () => void resetPreferencesUi());

  elements.detailBackButton.addEventListener("click", () => {
    if (activePanelName === "connector-utilities" && connectorUtilities.backToOptions()) {
      return;
    }
    if (activePanelName === "client-chart-export" && clientChartView !== "menu") {
      showClientChartView("menu");
      return;
    }
    showLauncher();
  });

  elements.homeButton.addEventListener("click", () => {
    showLauncher();
  });

  elements.searchInput.addEventListener("input", () => {
    filterTiles(elements.searchInput.value);
  });

  elements.toolTiles.forEach((tile) => {
    tile.addEventListener("click", () => {
      void handleTileClick(tile);
    });
  });

  elements.surfaceRadios.forEach((radio) => {
    radio.addEventListener("change", () => {
      if (radio.checked) {
        void handleSurfaceChange(radio.value as Surface);
      }
    });
  });

  elements.themeRadios.forEach((radio) => {
    radio.addEventListener("change", () => {
      if (radio.checked) {
        void handleThemeChange(radio.value as ThemeMode);
      }
    });
  });

  elements.form.addEventListener("input", () => {
    void persistDraft(readDraft());
  });

  elements.form.addEventListener("submit", async (event) => {
    event.preventDefault();

    await withResult(async () => {
      const response = await sendRuntimeMessage<AvailabilityPostResult>({
        type: "ac/popup/post-availability",
        payload: readDraft()
      });

      if (!response.ok || !response.data) {
        throw new Error(response.error ?? "Unable to post availability.");
      }

      return JSON.stringify(response.data, null, 2);
    });
  });
}

async function handleTileClick(tile: HTMLButtonElement): Promise<void> {
  const action = tile.dataset.toolAction;
  const panelName = tile.dataset.toolPanel;
  const title = tile.dataset.toolTitle ?? "Tool";
  const subtitle = tile.dataset.toolSubtitle ?? "";

  if (action === "open-day-view") {
    showDetail(title, subtitle, "day-view");
    setResultWorking();

    await withResult(async () => {
      const response = await sendRuntimeMessage<void>({ type: "ac/popup/open-day-view" });

      if (!response.ok) {
        throw new Error(response.error ?? "Unable to open Day View.");
      }

      return "Opened Day View on the active tab.";
    });
    return;
  }

  if (panelName === "planned") {
    elements.plannedTitle.textContent = title;
    elements.plannedDescription.textContent =
      subtitle || "This module has a reserved slot in the launcher but is not implemented yet.";
    showDetail(title, subtitle, "planned");
    return;
  }

  if (panelName === "availability") {
    showDetail(title, subtitle, "availability");
    setResult("Ready.");
    return;
  }

  if (panelName === "employee-manager") {
    showDetail(title, subtitle, panelName);
    await refreshEmployeeApiCredentialStatus();
    await refreshConfiguredEmployeeTenants();
    if (employeeItems.length === 0) {
      await loadEmployees(true);
    }
    return;
  }

  if (panelName === "environment-manager") {
    showDetail(title, subtitle, panelName);
    await environmentManager.refresh();
    return;
  }

  if (panelName === "connector-utilities") {
    showDetail(title, subtitle, panelName);
    await connectorUtilities.open();
    return;
  }

  if (panelName === "client-chart-export") {
    showDetail(title, subtitle, panelName);
    showClientChartView("menu");
    return;
  }

  if (panelName === "shift-lab") {
    showDetail(title, subtitle, panelName);
    await shiftLab.open();
    return;
  }

  if (panelName) {
    showDetail(title, subtitle, panelName);
  }
}

function showLauncher(): void {
  activePanelName = null;
  elements.launcherView.hidden = false;
  elements.launcherView.classList.add("is-active");
  elements.detailView.hidden = true;
  elements.detailView.classList.remove("is-active");
  elements.searchInput.focus();
}

/** Panels that render their own result block instead of the shared one. */
const PANELS_WITHOUT_SHARED_RESULT = new Set([
  "settings",
  "connector-utilities",
  "client-chart-export",
  "shift-lab"
]);

function showDetail(title: string, subtitle: string, panelName: string): void {
  activePanelName = panelName;
  setDetailHeader(title, subtitle);
  elements.launcherView.hidden = true;
  elements.launcherView.classList.remove("is-active");
  elements.detailView.hidden = false;
  elements.detailView.classList.add("is-active");

  elements.toolPanels.forEach((panel, key) => {
    const isActive = key === panelName;
    panel.hidden = !isActive;
    panel.classList.toggle("is-active", isActive);
  });

  if (PANELS_WITHOUT_SHARED_RESULT.has(panelName)) {
    hideResultScope();
  } else {
    showResultScope(panelName, title);
  }
}

function showSettings(): void {
  showDetail(SETTINGS_TITLE, SETTINGS_SUBTITLE, "settings");
  elements.surfaceHint.hidden = true;
}

function filterTiles(query: string): void {
  const normalized = query.trim().toLowerCase();
  let visible = 0;

  elements.toolTiles.forEach((tile) => {
    if (!normalized) {
      tile.hidden = false;
      visible += 1;
      return;
    }

    const haystack = [
      tile.dataset.toolTitle ?? "",
      tile.dataset.toolSubtitle ?? "",
      tile.dataset.searchTerms ?? ""
    ]
      .join(" ")
      .toLowerCase();

    const matches = haystack.includes(normalized);
    tile.hidden = !matches;

    if (matches) {
      visible += 1;
    }
  });

  elements.emptySearch.classList.toggle("is-visible", visible === 0);
}

function readInitialSurface(): Surface {
  const fromHtml = document.documentElement.dataset.surface;
  if (fromHtml === "popup" || fromHtml === "sidepanel") {
    return fromHtml;
  }
  return DEFAULT_SURFACE;
}

async function applyStoredSurfaceSelection(): Promise<void> {
  let stored: Surface = DEFAULT_SURFACE;
  try {
    const result = await chrome.storage.local.get(SURFACE_STORAGE_KEY);
    const value = result[SURFACE_STORAGE_KEY];
    if (value === "popup" || value === "sidepanel") {
      stored = value;
    }
  } catch {
    // ignore — fall back to default
  }

  selectRadio(elements.surfaceRadios, stored);
}

async function handleSurfaceChange(next: Surface): Promise<void> {
  try {
    const response = await sendRuntimeMessage<void>({
      type: "ac/popup/set-surface",
      payload: next
    });

    if (!response.ok) {
      throw new Error(response.error ?? "Unable to update surface.");
    }
  } catch (error) {
    showSurfaceHint(formatError(error), "danger");
    return;
  }

  if (next !== currentSurface) {
    showSurfaceHint(buildSurfaceMigrationHint(next), "info");
  } else {
    elements.surfaceHint.hidden = true;
  }
}

function buildSurfaceMigrationHint(next: Surface): string {
  if (currentSurface === "sidepanel" && next === "popup") {
    return "Popup mode is on. Close this side panel and click the AC Tools icon in your toolbar to open the popup.";
  }
  if (currentSurface === "popup" && next === "sidepanel") {
    return "Side panel mode is on. Close this popup and click the AC Tools icon in your toolbar to open the side panel.";
  }
  return "";
}

function showSurfaceHint(message: string, _tone: "info" | "danger"): void {
  elements.surfaceHint.textContent = message;
  elements.surfaceHint.hidden = message.length === 0;
}

async function applyStoredTheme(): Promise<void> {
  let mode: ThemeMode = "system";

  try {
    const stored = await chrome.storage.local.get(THEME_STORAGE_KEY);
    const value = stored[THEME_STORAGE_KEY];
    if (value === "light" || value === "dark" || value === "system") {
      mode = value;
    }
  } catch {
    // ignore — fall back to system
  }

  setTheme(mode);
  selectRadio(elements.themeRadios, mode);
}

async function handleThemeChange(next: ThemeMode): Promise<void> {
  setTheme(next);

  try {
    await chrome.storage.local.set({ [THEME_STORAGE_KEY]: next });
  } catch {
    // ignore — runtime may not have storage access
  }
}

async function toggleTheme(): Promise<void> {
  const current = readActiveTheme();
  const next: ThemeMode = current === "dark" ? "light" : "dark";
  setTheme(next);
  selectRadio(elements.themeRadios, next);

  try {
    await chrome.storage.local.set({ [THEME_STORAGE_KEY]: next });
  } catch {
    // ignore — runtime may not have storage access
  }
}

function setTheme(mode: ThemeMode): void {
  if (mode === "system") {
    delete document.documentElement.dataset.theme;
    return;
  }
  document.documentElement.dataset.theme = mode;
}

function readActiveTheme(): "light" | "dark" {
  const explicit = document.documentElement.dataset.theme;
  if (explicit === "light" || explicit === "dark") {
    return explicit;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function selectRadio(radios: HTMLInputElement[], value: string): void {
  radios.forEach((radio) => {
    radio.checked = radio.value === value;
  });
}

function applyEmployeePreferences(): void {
  elements.defaultTimezone.value = appPreferences.defaultTimezone;
  elements.employeeStatuses.value = appPreferences.employeeStatuses.join("\n");
  replaceStatusOptions(elements.employeeStatusFilter, appPreferences.employeeStatuses, true);
  replaceStatusOptions(elements.employeeNextStatus, appPreferences.employeeStatuses, false);
}

function replaceStatusOptions(
  select: HTMLSelectElement,
  statuses: string[],
  includeAll: boolean
): void {
  const current = select.value;
  const options = statuses.map((status) => {
    const option = document.createElement("option");
    option.value = status;
    option.textContent = status.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
    return option;
  });
  if (includeAll) {
    const all = document.createElement("option");
    all.value = "all";
    all.textContent = "All statuses";
    options.push(all);
  }
  select.replaceChildren(...options);
  if (Array.from(select.options).some((option) => option.value === current)) {
    select.value = current;
  } else if (includeAll && current === "all") {
    select.value = "all";
  }
}

async function savePreferencesFromUi(): Promise<void> {
  const timezone = elements.defaultTimezone.value.trim();
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
  } catch {
    showToast("error", "Invalid timezone", "Enter an IANA timezone such as America/Vancouver.");
    return;
  }
  appPreferences = await saveAppPreferences({
    defaultTimezone: timezone,
    employeeStatuses: elements.employeeStatuses.value.split(/\r?\n/)
  });
  applyEmployeePreferences();
  showToast("success", "Employee defaults saved", "Timezone and status options were updated.");
}

async function resetPreferencesUi(): Promise<void> {
  appPreferences = await resetAppPreferences();
  applyEmployeePreferences();
  showToast("info", "Employee defaults reset", "Built-in defaults were restored.");
}

async function loadEmployees(forceRefresh = false): Promise<void> {
  elements.employeeRefreshButton.disabled = true;
  elements.employeeSummary.textContent = "Loading employees…";

  try {
    const status = elements.employeeStatusFilter.value;
    if (forceRefresh) {
      await clearEmployeeCaches(currentEmployeeOrigin);
    } else {
      const cached = await loadCachedEmployees(currentEmployeeOrigin, status);
      if (cached) {
        employeeItems = cached.items;
        renderEmployeeList();
        elements.employeeSummary.textContent = `${employeeItems.length} employees restored from this session's cache.`;
        return;
      }
    }
    const response = await sendRuntimeMessage<EmployeeListResult>({
      type: "ac/popup/list-employees",
      payload: {
        count: 2000,
        status
      }
    });

    if (!response.ok || !response.data) {
      throw new Error(response.error ?? "Unable to load employees.");
    }

    employeeItems = response.data.items;
    await cacheEmployees(currentEmployeeOrigin, status, response.data);
    elements.employeeSummary.textContent = `${employeeItems.length} employees loaded from the active tenant.`;
    renderEmployeeList();
  } catch (error) {
    employeeItems = [];
    elements.employeeList.replaceChildren();
    elements.employeeSummary.textContent = formatError(error);
    showToast("error", "Employees not loaded", formatError(error));
  } finally {
    elements.employeeRefreshButton.disabled = false;
  }
}

function renderEmployeeList(): void {
  const query = elements.employeeSearchInput.value.trim().toLowerCase();
  const matches = employeeItems.filter((employee) => {
    if (!query) {
      return true;
    }

    return [
      employee.id,
      employee.first_name,
      employee.last_name,
      employee.email,
      employee.status,
      employee.designation
    ]
      .filter((value) => value !== undefined && value !== null)
      .join(" ")
      .toLowerCase()
      .includes(query);
  });

  const sortedMatches = sortEmployees(matches, employeeSortField, employeeSortDirection);
  const visibleMatches = sortedMatches.slice(0, 100);
  elements.employeeList.replaceChildren(
    ...visibleMatches.map((employee) => createEmployeeListButton(employee))
  );

  if (visibleMatches.length === 0) {
    const empty = document.createElement("p");
    empty.className = "employee-list__empty";
    empty.textContent = "No employees match the current search and status filter.";
    elements.employeeList.append(empty);
  }

  const suffix = sortedMatches.length > visibleMatches.length ? ` Showing the first ${visibleMatches.length}.` : "";
  elements.employeeSummary.textContent = `${matches.length} of ${employeeItems.length} loaded employees match.${suffix}`;
}

function createEmployeeListButton(employee: EmployeeSummary): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "employee-list__item";
  button.dataset.employeeId = String(employee.id);
  button.setAttribute("aria-label", `View employee details for ${employeeDisplayName(employee)}`);

  const header = document.createElement("span");
  header.className = "employee-list__header";

  const avatar = document.createElement("span");
  avatar.className = "employee-list__avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = getPersonInitials(employeeDisplayName(employee));

  const identity = document.createElement("span");
  identity.className = "employee-list__identity";

  const name = document.createElement("span");
  name.className = "employee-list__name";
  name.textContent = employeeDisplayName(employee);
  identity.append(name);

  const status = document.createElement("span");
  status.className = "employee-list__status";
  status.dataset.tone = getPersonStatusTone(employee.status);
  status.textContent = employee.status?.replace(/_/g, " ") || "Unknown";
  header.append(avatar, identity, status);

  const metadata = document.createElement("span");
  metadata.className = "employee-list__metadata";
  const metadataItems: Array<[string, string | undefined, boolean?]> = [
    ["Employee ID", `#${employee.id}`],
    ["Designation", employee.designation],
    ["Email", employee.email, true]
  ];
  for (const [label, value, wide] of metadataItems) {
    if (!value) {
      continue;
    }
    const item = document.createElement("span");
    item.className = `employee-list__metadata-item${wide ? " employee-list__metadata-item--wide" : ""}`;
    const itemLabel = document.createElement("span");
    itemLabel.className = "employee-list__metadata-label";
    itemLabel.textContent = label;
    const itemValue = document.createElement("span");
    itemValue.className = "employee-list__metadata-value";
    itemValue.textContent = value;
    item.append(itemLabel, itemValue);
    metadata.append(item);
  }

  const footer = document.createElement("span");
  footer.className = "employee-list__footer";
  const action = document.createElement("span");
  action.className = "employee-list__action";
  action.textContent = "View details";
  const arrow = document.createElement("span");
  arrow.className = "employee-list__arrow";
  arrow.setAttribute("aria-hidden", "true");
  arrow.textContent = "→";
  footer.append(action, arrow);

  button.append(header, metadata, footer);
  button.addEventListener("click", () => {
    void loadEmployeeDetail(employee.id);
  });
  return button;
}

async function loadEmployeeDetail(employeeId: number): Promise<void> {
  elements.employeeDetail.hidden = false;
  elements.employeeDetailName.textContent = "Loading employee…";
  elements.employeeDetailMeta.textContent = `#${employeeId}`;
  elements.employeeDetailFields.replaceChildren();

  try {
    const response = await sendRuntimeMessage<EmployeeDetail>({
      type: "ac/popup/get-employee",
      payload: { employeeId }
    });

    if (!response.ok || !response.data) {
      throw new Error(response.error ?? "Unable to load the employee.");
    }

    selectedEmployee = response.data;
    renderEmployeeDetail(response.data);
  } catch (error) {
    selectedEmployee = null;
    updateSelectedEmployeeTestAvailability();
    employeeCopyController.selectedEmployeeChanged();
    elements.employeeDetailName.textContent = "Employee unavailable";
    elements.employeeDetailMeta.textContent = formatError(error);
    showToast("error", "Employee details unavailable", formatError(error));
  }
}

function renderEmployeeDetail(employee: EmployeeDetail): void {
  elements.employeeDetailName.textContent = employeeDisplayName(employee);
  elements.employeeDetailMeta.textContent = `#${employee.id} · ${employee.status ?? "unknown"}`;
  if (employee.status && !Array.from(elements.employeeNextStatus.options).some((option) => option.value === employee.status)) {
    const option = document.createElement("option");
    option.value = employee.status;
    option.textContent = employee.status.replace(/_/g, " ");
    elements.employeeNextStatus.append(option);
  }
  elements.employeeNextStatus.value = employee.status ?? "active";
  elements.employeeStatusComment.value = "";
  updateSelectedEmployeeTestAvailability();
  employeeCopyController.selectedEmployeeChanged();

  const fields: Array<[string, string]> = [
    ["Email", employee.email ?? employee.demographics?.email ?? "—"],
    ["Phone", employee.demographics?.phone_main ?? "—"],
    ["Username", employee.username ?? "—"],
    ["Payroll number", employee.payroll_number ?? "—"],
    ["Designation", employee.designation ?? "—"],
    ["Timezone", employee.timezone ?? "—"],
    ["Groups", formatReferences(employee.groups)],
    ["Roles", formatReferences(employee.roles)],
    ["Departments", formatReferences(employee.departments)],
    ["Employment type", employee.employment_type?.name ?? String(employee.employment_type?.id ?? "—")]
  ];

  elements.employeeDetailFields.replaceChildren(
    ...fields.flatMap(([label, value]) => {
      const term = document.createElement("dt");
      term.textContent = label;
      const definition = document.createElement("dd");
      definition.textContent = value;
      return [term, definition];
    })
  );
}

async function refreshConfiguredEmployeeTenants(): Promise<void> {
  try {
    const response = await sendRuntimeMessage<EmployeeConfiguredTenant[]>({
      type: "ac/popup/list-employee-configured-tenants"
    });
    if (!response.ok || !response.data) {
      throw new Error(response.error ?? "Unable to list configured tenants.");
    }
    configuredEmployeeTenants = response.data;
    employeeCopyController.renderTargets(configuredEmployeeTenants, currentEmployeeOrigin);
  } catch (error) {
    configuredEmployeeTenants = [];
    elements.employeeCopyTargets.replaceChildren();
    const message = document.createElement("p");
    message.className = "employee-list__empty";
    message.textContent = formatError(error);
    elements.employeeCopyTargets.append(message);
    employeeCopyController.renderTargets([], currentEmployeeOrigin);
  }
}

async function updateSelectedEmployeeStatus(): Promise<void> {
  if (!selectedEmployee) {
    setResult("Select an employee before updating status.");
    return;
  }

  const employeeId = selectedEmployee.id;
  const comment = elements.employeeStatusComment.value.trim();
  if (!comment) {
    setResult("Enter a ticket or reason so the change has an audit note.");
    return;
  }

  elements.employeeUpdateStatusButton.disabled = true;
  try {
    await withResult(async () => {
      const result = await sendEmployeeStatusUpdate(
        employeeId,
        elements.employeeNextStatus.value,
        comment
      );

      await loadEmployees(true);
      await loadEmployeeDetail(employeeId);
      return `Employee #${employeeId} status updated (HTTP ${result.status}); audit note HTTP ${result.noteStatus ?? "not requested"}.`;
    });
  } finally {
    elements.employeeUpdateStatusButton.disabled = false;
  }
}

async function runSelectedEmployeeRoundTripTest(): Promise<void> {
  if (!selectedEmployee) {
    setResult("Select the existing UAT test employee first.");
    return;
  }

  const employee = selectedEmployee;
  const displayName = employeeDisplayName(employee);
  if (!isUatTenant || !/(test|do\s*not\s*send)/i.test(displayName)) {
    setResult("The selected employee must be clearly marked Test on a UAT tenant.");
    return;
  }
  if (employee.status !== "active") {
    setResult("The round-trip test expects the selected test employee to start active.");
    return;
  }

  elements.employeeTestSelectedButton.disabled = true;
  try {
    await withResult(async () => {
      const suspended = await sendEmployeeStatusUpdate(
        employee.id,
        "suspended",
        "AC Tools UAT extension round-trip test; restoring active immediately."
      );
      const restored = await sendEmployeeStatusUpdate(
        employee.id,
        "active",
        "AC Tools UAT extension round-trip test completed; original active status restored."
      );

      await loadEmployees(true);
      await loadEmployeeDetail(employee.id);
      return [
        `Employee #${employee.id} (${displayName}) completed active → suspended → active.`,
        `Suspend HTTP ${suspended.status}, note HTTP ${suspended.noteStatus}; restore HTTP ${restored.status}, note HTTP ${restored.noteStatus}.`,
        "Original active status restored."
      ].join("\n");
    });
  } finally {
    updateSelectedEmployeeTestAvailability();
  }
}

async function sendEmployeeStatusUpdate(
  employeeId: number,
  status: string,
  comment: string
): Promise<EmployeeWriteResult> {
  const response = await sendRuntimeMessage<EmployeeWriteResult>({
    type: "ac/popup/update-employee-status",
    payload: { employeeId, status, comment }
  });

  if (!response.ok || !response.data) {
    throw new Error(response.error ?? "Unable to update employee status.");
  }
  return response.data;
}

async function refreshEmployeeApiCredentialStatus(): Promise<void> {
  try {
    const response = await sendRuntimeMessage<EmployeeApiCredentialStatus>({
      type: "ac/popup/get-employee-api-credential-status"
    });
    if (!response.ok || !response.data) {
      throw new Error(response.error ?? "Unable to inspect API credential status.");
    }
    applyEmployeeApiCredentialStatus(response.data);
  } catch (error) {
    employeeApiCredentialsConfigured = false;
    elements.employeeApiCredentialStatus.textContent = formatError(error);
    updateSelectedEmployeeTestAvailability();
  }
}

async function saveEmployeeApiCredentials(): Promise<void> {
  elements.employeeApiSaveButton.disabled = true;
  try {
    const response = await sendRuntimeMessage<EmployeeApiCredentialStatus>({
      type: "ac/popup/set-employee-api-credentials",
      payload: {
        publicKey: elements.employeeApiPublicKey.value,
        privateKey: elements.employeeApiPrivateKey.value,
        remember: elements.employeeApiRemember.checked
      }
    });
    if (!response.ok || !response.data) {
      throw new Error(response.error ?? "Unable to configure API credentials.");
    }
    elements.employeeApiPublicKey.value = "";
    elements.employeeApiPrivateKey.value = "";
    applyEmployeeApiCredentialStatus(response.data);
    await environmentManager.refresh();
    await refreshConfiguredEmployeeTenants();
    const message = response.data.storage === "local"
      ? "API credentials were validated and remembered in this Chrome profile."
      : "API credentials were validated and are available for this Chrome session only.";
    setResult(message);
    showToast("success", "Credentials validated", message);
  } catch (error) {
    setResult(formatError(error));
    showToast("error", "Credentials rejected", formatError(error));
  } finally {
    elements.employeeApiSaveButton.disabled = false;
  }
}

async function clearEmployeeApiCredentials(): Promise<void> {
  const response = await sendRuntimeMessage<EmployeeApiCredentialStatus>({
    type: "ac/popup/clear-employee-api-credentials"
  });
  if (!response.ok || !response.data) {
    setResult(response.error ?? "Unable to clear API credentials.");
    return;
  }
  await clearEmployeeCaches(response.data.origin);
  applyEmployeeApiCredentialStatus(response.data);
  elements.employeeApiRemember.checked = false;
  await refreshConfiguredEmployeeTenants();
  setResult("API credentials cleared from session and device storage.");
  showToast("info", "Credentials cleared", `Removed credentials for ${response.data.origin}.`);
}

function applyEmployeeApiCredentialStatus(status: EmployeeApiCredentialStatus): void {
  employeeApiCredentialsConfigured = status.configured;
  currentEmployeeOrigin = status.origin;
  elements.employeeApiRemember.checked = status.storage === "local";
  elements.employeeApiCredentialStatus.textContent = status.configured
    ? `${status.storage === "local" ? "Remembered on this device" : "Configured for this session"} for ${status.origin}`
    : `Not configured for ${status.origin}`;
  elements.employeeApiClearButton.disabled = !status.configured;
  updateSelectedEmployeeTestAvailability();
}

function updateSelectedEmployeeTestAvailability(): void {
  const name = selectedEmployee ? employeeDisplayName(selectedEmployee) : "";
  elements.employeeTestSelectedButton.disabled = !(
    employeeApiCredentialsConfigured &&
    isUatTenant &&
    selectedEmployee?.status === "active" &&
    /(test|do\s*not\s*send)/i.test(name)
  );
}

function employeeDisplayName(employee: EmployeeSummary | EmployeeDetail): string {
  const demographics = "demographics" in employee ? employee.demographics : undefined;
  const firstName = employee.first_name ?? demographics?.first_name ?? "";
  const lastName = employee.last_name ?? demographics?.last_name ?? "";
  return [firstName, lastName].filter(Boolean).join(" ").trim() || `Employee #${employee.id}`;
}

function formatReferences(references: EmployeeDetail["groups"]): string {
  if (!references || references.length === 0) {
    return "—";
  }
  return references.map((reference) => reference.name ?? String(reference.id)).join(", ");
}

interface PopupElements {
  form: HTMLFormElement;
  statusText: HTMLElement;
  refreshStatusButton: HTMLButtonElement;
  themeToggle: HTMLButtonElement;
  settingsButton: HTMLButtonElement;
  homeButton: HTMLButtonElement;
  searchInput: HTMLInputElement;
  emptySearch: HTMLElement;
  launcherView: HTMLElement;
  detailView: HTMLElement;
  detailBackButton: HTMLButtonElement;
  plannedTitle: HTMLElement;
  plannedDescription: HTMLElement;
  toolTiles: HTMLButtonElement[];
  toolPanels: Map<string, HTMLElement>;
  surfaceRadios: HTMLInputElement[];
  themeRadios: HTMLInputElement[];
  surfaceHint: HTMLElement;
  catalogJsonExportButton: HTMLButtonElement;
  catalogCsvExportButton: HTMLButtonElement;
  catalogXlsxExportButton: HTMLButtonElement;
  clientChartSyntheticConfirm: HTMLInputElement;
  featureFlagToggles: HTMLInputElement[];
  clientChartViews: Map<ClientChartView, HTMLElement>;
  clientChartNavButtons: HTMLButtonElement[];
  clientChartSearchInput: HTMLInputElement;
  searchClientChartsButton: HTMLButtonElement;
  clientChartRankLimit: HTMLSelectElement;
  rankClientChartsButton: HTMLButtonElement;
  clientChartSearchResults: HTMLElement;
  inspectClientChartButton: HTMLButtonElement;
  downloadClientChartButton: HTMLButtonElement;
  clientChartSummary: HTMLElement;
  clientChartImportFile: HTMLInputElement;
  previewClientChartImportButton: HTMLButtonElement;
  createClientChartImportButton: HTMLButtonElement;
  clientChartImportTarget: HTMLElement;
  clientChartImportFirstName: HTMLInputElement;
  clientChartImportLastName: HTMLInputElement;
  clientChartImportBirthday: HTMLInputElement;
  clientChartImportHealthCard: HTMLInputElement;
  clientChartImportGender: HTMLSelectElement;
  clientChartImportEmail: HTMLInputElement;
  clientChartImportPhoneMain: HTMLInputElement;
  clientChartImportDestination: HTMLElement;
  clientChartImportDestinationCount: HTMLElement;
  clientChartImportFacilityFilter: HTMLInputElement;
  clientChartImportFacilities: HTMLElement;
  clientChartImportCostCentre: HTMLSelectElement;
  clientChartImportSections: HTMLFieldSetElement;
  clientChartImportMedicalHistory: HTMLInputElement;
  clientChartImportRiskAssessment: HTMLInputElement;
  clientChartImportProgressNotes: HTMLInputElement;
  clientChartImportMedications: HTMLInputElement;
  clientChartImportConfirmContainer: HTMLElement;
  clientChartImportConfirm: HTMLInputElement;
  openImportedClientLink: HTMLAnchorElement;
  downloadClientChartImportReportButton: HTMLButtonElement;
  clientChartImportSummary: HTMLElement;
  clientChartPdfFiles: HTMLInputElement;
  parseClientChartPdfsButton: HTMLButtonElement;
  downloadClientChartPdfJsonButton: HTMLButtonElement;
  clientChartPdfSummary: HTMLElement;
  employeeSearchInput: HTMLInputElement;
  employeeStatusFilter: HTMLSelectElement;
  employeeRefreshButton: HTMLButtonElement;
  employeeSort: HTMLSelectElement;
  employeeSortDirection: HTMLButtonElement;
  employeeSummary: HTMLElement;
  employeeList: HTMLElement;
  employeeDetail: HTMLElement;
  employeeDetailName: HTMLElement;
  employeeDetailMeta: HTMLElement;
  employeeDetailFields: HTMLElement;
  employeeNextStatus: HTMLSelectElement;
  employeeStatusComment: HTMLInputElement;
  employeeUpdateStatusButton: HTMLButtonElement;
  employeeApiCredentialStatus: HTMLElement;
  employeeApiPublicKey: HTMLInputElement;
  employeeApiPrivateKey: HTMLInputElement;
  employeeApiRemember: HTMLInputElement;
  employeeApiSaveButton: HTMLButtonElement;
  employeeApiClearButton: HTMLButtonElement;
  employeeTestSelectedButton: HTMLButtonElement;
  employeeCopyTicket: HTMLInputElement;
  employeeCopyTargets: HTMLElement;
  employeeCopyButton: HTMLButtonElement;
  defaultTimezone: HTMLInputElement;
  employeeStatuses: HTMLTextAreaElement;
  preferencesSave: HTMLButtonElement;
  preferencesReset: HTMLButtonElement;
  extensionVersion: HTMLElement;
}

function getPopupElements(): PopupElements {
  const form = document.querySelector<HTMLFormElement>("#availability-form");
  const statusText = document.querySelector<HTMLElement>("#status-text");
  const refreshStatusButton = document.querySelector<HTMLButtonElement>("#refresh-status");
  const themeToggle = document.querySelector<HTMLButtonElement>("#theme-toggle");
  const settingsButton = document.querySelector<HTMLButtonElement>("#settings-button");
  const homeButton = document.querySelector<HTMLButtonElement>("#home-button");
  const searchInput = document.querySelector<HTMLInputElement>("#tool-search");
  const emptySearch = document.querySelector<HTMLElement>("#empty-search");
  const launcherView = document.querySelector<HTMLElement>("#view-launcher");
  const detailView = document.querySelector<HTMLElement>("#view-detail");
  const detailBackButton = document.querySelector<HTMLButtonElement>("#detail-back");
  const plannedTitle = document.querySelector<HTMLElement>("#planned-title");
  const plannedDescription = document.querySelector<HTMLElement>("#planned-description");
  const surfaceHint = document.querySelector<HTMLElement>("#surface-hint");
  const catalogJsonExportButton = document.querySelector<HTMLButtonElement>(
    "#export-form-context-catalog-json"
  );
  const catalogCsvExportButton = document.querySelector<HTMLButtonElement>(
    "#export-form-context-catalog-csv"
  );
  const catalogXlsxExportButton = document.querySelector<HTMLButtonElement>(
    "#export-form-context-catalog-xlsx"
  );
  const clientChartSyntheticConfirm = document.querySelector<HTMLInputElement>(
    "#client-chart-synthetic-confirm"
  );
  const featureFlagToggles = Array.from(
    document.querySelectorAll<HTMLInputElement>("[data-feature-flag]")
  );
  const clientChartViewElements = Array.from(
    document.querySelectorAll<HTMLElement>("[data-chart-view]")
  );
  const clientChartViews = new Map<ClientChartView, HTMLElement>(
    clientChartViewElements.map((view) => [view.dataset.chartView as ClientChartView, view])
  );
  const clientChartNavButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-chart-nav]")
  );
  const clientChartSearchInput = document.querySelector<HTMLInputElement>(
    "#client-chart-search-input"
  );
  const searchClientChartsButton = document.querySelector<HTMLButtonElement>(
    "#search-client-charts"
  );
  const clientChartRankLimit = document.querySelector<HTMLSelectElement>(
    "#client-chart-rank-limit"
  );
  const rankClientChartsButton = document.querySelector<HTMLButtonElement>(
    "#rank-client-charts"
  );
  const clientChartSearchResults = document.querySelector<HTMLElement>(
    "#client-chart-search-results"
  );
  const inspectClientChartButton = document.querySelector<HTMLButtonElement>(
    "#inspect-client-chart"
  );
  const downloadClientChartButton = document.querySelector<HTMLButtonElement>(
    "#download-client-chart"
  );
  const clientChartSummary = document.querySelector<HTMLElement>("#client-chart-summary");
  const clientChartImportFile = document.querySelector<HTMLInputElement>(
    "#client-chart-import-file"
  );
  const previewClientChartImportButton = document.querySelector<HTMLButtonElement>(
    "#preview-client-chart-import"
  );
  const createClientChartImportButton = document.querySelector<HTMLButtonElement>(
    "#create-client-chart-import"
  );
  const clientChartImportTarget = document.querySelector<HTMLElement>(".chart-import__target");
  const clientChartImportFirstName = document.querySelector<HTMLInputElement>(
    "#client-chart-import-first-name"
  );
  const clientChartImportLastName = document.querySelector<HTMLInputElement>(
    "#client-chart-import-last-name"
  );
  const clientChartImportBirthday = document.querySelector<HTMLInputElement>(
    "#client-chart-import-birthday"
  );
  const clientChartImportHealthCard = document.querySelector<HTMLInputElement>(
    "#client-chart-import-health-card"
  );
  const clientChartImportGender = document.querySelector<HTMLSelectElement>(
    "#client-chart-import-gender"
  );
  const clientChartImportEmail = document.querySelector<HTMLInputElement>(
    "#client-chart-import-email"
  );
  const clientChartImportPhoneMain = document.querySelector<HTMLInputElement>(
    "#client-chart-import-phone-main"
  );
  const clientChartImportDestination = document.querySelector<HTMLElement>(
    ".chart-import__destination"
  );
  const clientChartImportDestinationCount = document.querySelector<HTMLElement>(
    "#client-chart-import-destination-count"
  );
  const clientChartImportFacilityFilter = document.querySelector<HTMLInputElement>(
    "#client-chart-import-facility-filter"
  );
  const clientChartImportFacilities = document.querySelector<HTMLElement>(
    "#client-chart-import-facilities"
  );
  const clientChartImportCostCentre = document.querySelector<HTMLSelectElement>(
    "#client-chart-import-cost-centre"
  );
  const clientChartImportSections = document.querySelector<HTMLFieldSetElement>(
    ".chart-import__sections"
  );
  const clientChartImportMedicalHistory = document.querySelector<HTMLInputElement>(
    "#client-chart-import-medical-history"
  );
  const clientChartImportRiskAssessment = document.querySelector<HTMLInputElement>(
    "#client-chart-import-risk-assessment"
  );
  const clientChartImportProgressNotes = document.querySelector<HTMLInputElement>(
    "#client-chart-import-progress-notes"
  );
  const clientChartImportMedications = document.querySelector<HTMLInputElement>(
    "#client-chart-import-medications"
  );
  const clientChartImportConfirmContainer = document.querySelector<HTMLElement>(
    ".chart-import__confirm"
  );
  const clientChartImportConfirm = document.querySelector<HTMLInputElement>(
    "#client-chart-import-confirm"
  );
  const openImportedClientLink = document.querySelector<HTMLAnchorElement>(
    "#open-imported-client"
  );
  const downloadClientChartImportReportButton = document.querySelector<HTMLButtonElement>(
    "#download-client-chart-import-report"
  );
  const clientChartImportSummary = document.querySelector<HTMLElement>(
    "#client-chart-import-summary"
  );
  const clientChartPdfFiles = document.querySelector<HTMLInputElement>("#client-chart-pdf-files");
  const parseClientChartPdfsButton = document.querySelector<HTMLButtonElement>(
    "#parse-client-chart-pdfs"
  );
  const downloadClientChartPdfJsonButton = document.querySelector<HTMLButtonElement>(
    "#download-client-chart-pdf-json"
  );
  const clientChartPdfSummary = document.querySelector<HTMLElement>(
    "#client-chart-pdf-summary"
  );
  const employeeSearchInput = document.querySelector<HTMLInputElement>("#employee-search");
  const employeeStatusFilter = document.querySelector<HTMLSelectElement>(
    "#employee-status-filter"
  );
  const employeeRefreshButton = document.querySelector<HTMLButtonElement>("#employee-refresh");
  const employeeSort = document.querySelector<HTMLSelectElement>("#employee-sort");
  const employeeSortDirection = document.querySelector<HTMLButtonElement>("#employee-sort-direction");
  const employeeSummary = document.querySelector<HTMLElement>("#employee-summary");
  const employeeList = document.querySelector<HTMLElement>("#employee-list");
  const employeeDetail = document.querySelector<HTMLElement>("#employee-detail");
  const employeeDetailName = document.querySelector<HTMLElement>("#employee-detail-name");
  const employeeDetailMeta = document.querySelector<HTMLElement>("#employee-detail-meta");
  const employeeDetailFields = document.querySelector<HTMLElement>("#employee-detail-fields");
  const employeeNextStatus = document.querySelector<HTMLSelectElement>("#employee-next-status");
  const employeeStatusComment = document.querySelector<HTMLInputElement>(
    "#employee-status-comment"
  );
  const employeeUpdateStatusButton = document.querySelector<HTMLButtonElement>(
    "#employee-update-status"
  );
  const employeeApiCredentialStatus = document.querySelector<HTMLElement>(
    "#employee-api-credential-status"
  );
  const employeeApiPublicKey = document.querySelector<HTMLInputElement>("#employee-api-public-key");
  const employeeApiPrivateKey = document.querySelector<HTMLInputElement>("#employee-api-private-key");
  const employeeApiRemember = document.querySelector<HTMLInputElement>("#employee-api-remember");
  const employeeApiSaveButton = document.querySelector<HTMLButtonElement>("#employee-api-save");
  const employeeApiClearButton = document.querySelector<HTMLButtonElement>("#employee-api-clear");
  const employeeTestSelectedButton = document.querySelector<HTMLButtonElement>(
    "#employee-test-selected"
  );
  const employeeCopyTicket = document.querySelector<HTMLInputElement>("#employee-copy-ticket");
  const employeeCopyTargets = document.querySelector<HTMLElement>("#employee-copy-targets");
  const employeeCopyButton = document.querySelector<HTMLButtonElement>("#employee-copy");
  const defaultTimezone = document.querySelector<HTMLInputElement>("#default-timezone");
  const employeeStatuses = document.querySelector<HTMLTextAreaElement>("#employee-statuses");
  const preferencesSave = document.querySelector<HTMLButtonElement>("#preferences-save");
  const preferencesReset = document.querySelector<HTMLButtonElement>("#preferences-reset");
  const extensionVersion = document.querySelector<HTMLElement>("#extension-version");
  const toolTiles = Array.from(document.querySelectorAll<HTMLButtonElement>(".app-tile"));
  const panelElements = Array.from(document.querySelectorAll<HTMLElement>(".tool-panel"));
  const toolPanels = new Map(
    panelElements.map((panel) => [panel.id.replace("panel-", ""), panel])
  );
  const surfaceRadios = Array.from(
    document.querySelectorAll<HTMLInputElement>('input[name="surface"]')
  );
  const themeRadios = Array.from(
    document.querySelectorAll<HTMLInputElement>('input[name="theme"]')
  );

  if (
    !form ||
    !statusText ||
    !refreshStatusButton ||
    !themeToggle ||
    !settingsButton ||
    !homeButton ||
    !searchInput ||
    !emptySearch ||
    !launcherView ||
    !detailView ||
    !detailBackButton ||
    !plannedTitle ||
    !plannedDescription ||
    !surfaceHint ||
    !catalogJsonExportButton ||
    !catalogCsvExportButton ||
    !catalogXlsxExportButton ||
    !clientChartSyntheticConfirm ||
    featureFlagToggles.length === 0 ||
    clientChartViews.size === 0 ||
    clientChartNavButtons.length === 0 ||
    !clientChartSearchInput ||
    !searchClientChartsButton ||
    !clientChartRankLimit ||
    !rankClientChartsButton ||
    !clientChartSearchResults ||
    !inspectClientChartButton ||
    !downloadClientChartButton ||
    !clientChartSummary ||
    !clientChartImportFile ||
    !previewClientChartImportButton ||
    !createClientChartImportButton ||
    !clientChartImportTarget ||
    !clientChartImportFirstName ||
    !clientChartImportLastName ||
    !clientChartImportBirthday ||
    !clientChartImportHealthCard ||
    !clientChartImportGender ||
    !clientChartImportEmail ||
    !clientChartImportPhoneMain ||
    !clientChartImportDestination ||
    !clientChartImportDestinationCount ||
    !clientChartImportFacilityFilter ||
    !clientChartImportFacilities ||
    !clientChartImportCostCentre ||
    !clientChartImportSections ||
    !clientChartImportMedicalHistory ||
    !clientChartImportRiskAssessment ||
    !clientChartImportProgressNotes ||
    !clientChartImportMedications ||
    !clientChartImportConfirmContainer ||
    !clientChartImportConfirm ||
    !openImportedClientLink ||
    !downloadClientChartImportReportButton ||
    !clientChartImportSummary ||
    !clientChartPdfFiles ||
    !parseClientChartPdfsButton ||
    !downloadClientChartPdfJsonButton ||
    !clientChartPdfSummary ||
    !employeeSearchInput ||
    !employeeStatusFilter ||
    !employeeRefreshButton ||
    !employeeSort ||
    !employeeSortDirection ||
    !employeeSummary ||
    !employeeList ||
    !employeeDetail ||
    !employeeDetailName ||
    !employeeDetailMeta ||
    !employeeDetailFields ||
    !employeeNextStatus ||
    !employeeStatusComment ||
    !employeeUpdateStatusButton ||
    !employeeApiCredentialStatus ||
    !employeeApiPublicKey ||
    !employeeApiPrivateKey ||
    !employeeApiRemember ||
    !employeeApiSaveButton ||
    !employeeApiClearButton ||
    !employeeTestSelectedButton ||
    !employeeCopyTicket ||
    !employeeCopyTargets ||
    !employeeCopyButton ||
    !defaultTimezone ||
    !employeeStatuses ||
    !preferencesSave ||
    !preferencesReset ||
    !extensionVersion ||
    toolTiles.length === 0 ||
    toolPanels.size === 0 ||
    surfaceRadios.length === 0 ||
    themeRadios.length === 0
  ) {
    throw new Error("Popup elements are missing.");
  }

  return {
    form,
    statusText,
    refreshStatusButton,
    themeToggle,
    settingsButton,
    homeButton,
    searchInput,
    emptySearch,
    launcherView,
    detailView,
    detailBackButton,
    plannedTitle,
    plannedDescription,
    toolTiles,
    toolPanels,
    surfaceRadios,
    themeRadios,
    surfaceHint,
    catalogJsonExportButton,
    catalogCsvExportButton,
    catalogXlsxExportButton,
    clientChartSyntheticConfirm,
    featureFlagToggles,
    clientChartViews,
    clientChartNavButtons,
    clientChartSearchInput,
    searchClientChartsButton,
    clientChartRankLimit,
    rankClientChartsButton,
    clientChartSearchResults,
    inspectClientChartButton,
    downloadClientChartButton,
    clientChartSummary,
    clientChartImportFile,
    previewClientChartImportButton,
    createClientChartImportButton,
    clientChartImportTarget,
    clientChartImportFirstName,
    clientChartImportLastName,
    clientChartImportBirthday,
    clientChartImportHealthCard,
    clientChartImportGender,
    clientChartImportEmail,
    clientChartImportPhoneMain,
    clientChartImportDestination,
    clientChartImportDestinationCount,
    clientChartImportFacilityFilter,
    clientChartImportFacilities,
    clientChartImportCostCentre,
    clientChartImportSections,
    clientChartImportMedicalHistory,
    clientChartImportRiskAssessment,
    clientChartImportProgressNotes,
    clientChartImportMedications,
    clientChartImportConfirmContainer,
    clientChartImportConfirm,
    openImportedClientLink,
    downloadClientChartImportReportButton,
    clientChartImportSummary,
    clientChartPdfFiles,
    parseClientChartPdfsButton,
    downloadClientChartPdfJsonButton,
    clientChartPdfSummary,
    employeeSearchInput,
    employeeStatusFilter,
    employeeRefreshButton,
    employeeSort,
    employeeSortDirection,
    employeeSummary,
    employeeList,
    employeeDetail,
    employeeDetailName,
    employeeDetailMeta,
    employeeDetailFields,
    employeeNextStatus,
    employeeStatusComment,
    employeeUpdateStatusButton,
    employeeApiCredentialStatus,
    employeeApiPublicKey,
    employeeApiPrivateKey,
    employeeApiRemember,
    employeeApiSaveButton,
    employeeApiClearButton,
    employeeTestSelectedButton,
    employeeCopyTicket,
    employeeCopyTargets,
    employeeCopyButton,
    defaultTimezone,
    employeeStatuses,
    preferencesSave,
    preferencesReset,
    extensionVersion
  };
}

type ClientChartView = "menu" | "snapshot" | "import" | "pdf";

interface ClientChartViewDefinition {
  label: string;
  feature: keyof AcFeatureFlags;
}

const CLIENT_CHART_VIEWS: Record<Exclude<ClientChartView, "menu">, ClientChartViewDefinition> = {
  snapshot: { label: "Structured client snapshot", feature: "clientChartSnapshot" },
  import: { label: "Create client from JSON", feature: "clientChartImport" },
  pdf: { label: "Batch PDF parser", feature: "clientChartPdfParser" }
};

const CLIENT_CHART_MENU_SUBTITLE = "Choose the workspace you need.";

function isClientChartViewEnabled(view: ClientChartView): boolean {
  return view === "menu" || featureFlags[CLIENT_CHART_VIEWS[view].feature];
}

function requireClientChartFeature(view: Exclude<ClientChartView, "menu">): void {
  if (!isClientChartViewEnabled(view)) {
    throw new Error(disabledFeatureMessage(CLIENT_CHART_VIEWS[view].feature));
  }
}

function applyFeatureFlagToggles(): void {
  for (const toggle of elements.featureFlagToggles) {
    const flag = toggle.dataset.featureFlag as AcFeatureFlag | undefined;
    if (flag && flag in featureFlags) {
      toggle.checked = featureFlags[flag];
    }
  }
}

async function handleFeatureFlagChange(toggle: HTMLInputElement): Promise<void> {
  const flag = toggle.dataset.featureFlag as AcFeatureFlag | undefined;
  if (!flag || !(flag in featureFlags)) {
    return;
  }

  const previous = featureFlags[flag];
  try {
    featureFlags = await saveFeatureFlags({ ...featureFlags, [flag]: toggle.checked });
    applyFeatureFlagToggles();
    applyClientChartGuard();
    if (clientChartView !== "menu" && !isClientChartViewEnabled(clientChartView)) {
      showClientChartView("menu");
    }
    showToast(
      "success",
      featureFlags[flag] ? "Tool enabled" : "Tool disabled",
      `${FEATURE_FLAG_LABELS[flag]} is now ${featureFlags[flag] ? "available" : "hidden"} in Client Chart Export.`
    );
  } catch (error) {
    featureFlags = { ...featureFlags, [flag]: previous };
    applyFeatureFlagToggles();
    showToast("error", "Could not save", formatError(error));
  }
}

function showClientChartView(view: ClientChartView): void {
  const target = isClientChartViewEnabled(view) ? view : "menu";
  clientChartView = target;

  elements.clientChartViews.forEach((element, key) => {
    element.hidden = key !== target;
  });

  setDetailSubtitle(
    target === "menu" ? CLIENT_CHART_MENU_SUBTITLE : CLIENT_CHART_VIEWS[target].label
  );

  if (target === "menu") {
    applyClientChartGuard();
  }
}

/**
 * Disabled sub-tools stay visible but unreachable, so the flag state is
 * obvious rather than a silently missing entry point.
 */
function applyClientChartGuard(): void {
  const confirmed = elements.clientChartSyntheticConfirm.checked;

  for (const button of elements.clientChartNavButtons) {
    const view = button.dataset.chartNav as ClientChartView | undefined;
    if (!view || view === "menu") {
      continue;
    }
    const enabled = isClientChartViewEnabled(view);
    button.disabled = !enabled || !confirmed;
    button.title = enabled
      ? confirmed
        ? CLIENT_CHART_VIEWS[view].label
        : "Confirm synthetic UAT data to open this workspace."
      : disabledFeatureMessage(CLIENT_CHART_VIEWS[view].feature);
    renderClientChartNavBadge(button, enabled);
  }

  elements.inspectClientChartButton.disabled = !confirmed;
  elements.clientChartSearchInput.disabled = !confirmed;
  elements.searchClientChartsButton.disabled =
    !confirmed || elements.clientChartSearchInput.value.trim().length < 2;
  elements.clientChartRankLimit.disabled = !confirmed;
  elements.rankClientChartsButton.disabled = !confirmed;
  elements.clientChartImportFile.disabled = !confirmed;
  elements.previewClientChartImportButton.disabled =
    !confirmed || (elements.clientChartImportFile.files?.length ?? 0) === 0;
  elements.clientChartPdfFiles.disabled = !confirmed;
  elements.parseClientChartPdfsButton.disabled =
    !confirmed || (elements.clientChartPdfFiles.files?.length ?? 0) === 0;

  if (!confirmed) {
    resetClientChartWorkspaces();
  } else if (clientChartSearchResults.length === 0) {
    renderClientChartSearchResults("Search by name or AlayaCare ID, or rank the fullest charts.");
  }
}

function renderClientChartNavBadge(button: HTMLButtonElement, enabled: boolean): void {
  const title = button.querySelector("strong");
  if (!title) {
    return;
  }
  const existing = title.querySelector(".utility-option__badge");
  if (enabled) {
    existing?.remove();
    return;
  }
  if (existing) {
    return;
  }
  const badge = document.createElement("span");
  badge.className = "utility-option__badge";
  badge.textContent = "Off";
  title.append(badge);
}

function resetClientChartWorkspaces(): void {
  clientChartSnapshot = null;
  clientChartPdfSnapshot = null;
  clientChartSearchResults = [];
  clientChartRankings.clear();
  elements.clientChartSearchInput.value = "";
  elements.clientChartPdfFiles.value = "";
  resetClientChartImport();
  elements.downloadClientChartButton.disabled = true;
  elements.downloadClientChartPdfJsonButton.disabled = true;
  elements.clientChartSummary.textContent =
    "Search for a client, or inspect the chart open on the active tab.";
  renderClientChartSearchResults("Confirm synthetic UAT data to enable client search.");
  elements.clientChartPdfSummary.textContent = "Select one or more AlayaCare batch PDFs.";
}

async function searchClientCharts(): Promise<void> {
  await withResult(async () => {
    requireClientChartFeature("snapshot");
    if (!elements.clientChartSyntheticConfirm.checked) {
      throw new Error("Confirm synthetic UAT data before searching for clients.");
    }
    const query = elements.clientChartSearchInput.value.trim();
    if (query.length < 2) throw new Error("Enter at least two characters to search.");

    elements.clientChartSearchInput.disabled = true;
    elements.searchClientChartsButton.disabled = true;
    elements.clientChartRankLimit.disabled = true;
    elements.rankClientChartsButton.disabled = true;
    setClientChartResultButtonsDisabled(true);
    renderClientChartSearchResults(`Searching for “${query}”…`);
    try {
      const response = await sendRuntimeMessage<ClientChartSearchResponse>({
        type: "ac/popup/search-client-charts",
        payload: {
          query,
          confirmedSynthetic: elements.clientChartSyntheticConfirm.checked
        }
      });
      if (!response.ok || !response.data) {
        throw new Error(response.error ?? "Unable to search UAT clients.");
      }

      clientChartRankings.clear();
      clientChartSearchResults = response.data.items;
      renderClientChartSearchResults();
      return response.data.items.length > 0
        ? `Found ${response.data.items.length} matching synthetic UAT client${response.data.items.length === 1 ? "" : "s"}.`
        : `No matching clients found for “${response.data.query}”.`;
    } catch (error) {
      clientChartSearchResults = [];
      clientChartRankings.clear();
      renderClientChartSearchResults(formatError(error));
      throw error;
    } finally {
      const confirmed = elements.clientChartSyntheticConfirm.checked;
      elements.clientChartSearchInput.disabled = !confirmed;
      elements.clientChartRankLimit.disabled = !confirmed;
      elements.rankClientChartsButton.disabled = !confirmed;
      elements.searchClientChartsButton.disabled =
        !confirmed || elements.clientChartSearchInput.value.trim().length < 2;
      setClientChartResultButtonsDisabled(!confirmed);
    }
  });
}

async function rankClientCharts(): Promise<void> {
  await withResult(async () => {
    requireClientChartFeature("snapshot");
    if (!elements.clientChartSyntheticConfirm.checked) {
      throw new Error("Confirm synthetic UAT data before ranking client charts.");
    }
    const limit = Number(elements.clientChartRankLimit.value) === 25 ? 25 : 10;
    elements.clientChartSearchInput.disabled = true;
    elements.searchClientChartsButton.disabled = true;
    elements.clientChartRankLimit.disabled = true;
    elements.rankClientChartsButton.disabled = true;
    setClientChartResultButtonsDisabled(true);
    renderClientChartSearchResults(
      `Deep-scanning ${limit} candidate charts. This can take up to a minute…`
    );
    try {
      const response = await sendRuntimeMessage<ClientChartRankResponse>({
        type: "ac/popup/rank-client-charts",
        payload: {
          limit,
          confirmedSynthetic: elements.clientChartSyntheticConfirm.checked
        }
      });
      if (!response.ok || !response.data) {
        throw new Error(response.error ?? "Unable to rank UAT client charts.");
      }

      clientChartSearchResults = response.data.items;
      clientChartRankings = new Map(
        response.data.items.map((result) => [result.clientId, result])
      );
      renderClientChartSearchResults();
      return [
        `Ranked ${response.data.deepScanned} deeply scanned charts from ${response.data.candidatePool} active UAT clients.`,
        "Results are sorted by populated chart sections, then capped record counts."
      ].join("\n");
    } catch (error) {
      clientChartSearchResults = [];
      clientChartRankings.clear();
      renderClientChartSearchResults(formatError(error));
      throw error;
    } finally {
      const confirmed = elements.clientChartSyntheticConfirm.checked;
      elements.clientChartSearchInput.disabled = !confirmed;
      elements.clientChartRankLimit.disabled = !confirmed;
      elements.rankClientChartsButton.disabled = !confirmed;
      elements.searchClientChartsButton.disabled =
        !confirmed || elements.clientChartSearchInput.value.trim().length < 2;
      setClientChartResultButtonsDisabled(!confirmed);
    }
  });
}

function getPersonInitials(fullName: string): string {
  const initials = fullName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
  return initials || "PT";
}

function getPersonStatusTone(
  status?: string
): "success" | "warning" | "danger" | "neutral" {
  const normalizedStatus = status?.trim().toLowerCase() ?? "";
  if (normalizedStatus === "active") {
    return "success";
  }
  if (
    normalizedStatus === "pending" ||
    normalizedStatus === "applicant" ||
    normalizedStatus === "on hold" ||
    normalizedStatus === "on_hold"
  ) {
    return "warning";
  }
  if (["suspended", "terminated", "rejected"].includes(normalizedStatus)) {
    return "danger";
  }
  return "neutral";
}

function renderClientChartSearchResults(message?: string): void {
  elements.clientChartSearchResults.replaceChildren();
  if (message || clientChartSearchResults.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = message ?? "No matching synthetic UAT clients found.";
    elements.clientChartSearchResults.append(empty);
    return;
  }

  for (const result of clientChartSearchResults) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chart-client-search-result";
    button.setAttribute("aria-label", `Inspect chart for ${result.fullName}`);
    button.addEventListener("click", () => {
      void inspectActiveClientChart(result.clientId);
    });

    const header = document.createElement("span");
    header.className = "chart-client-search-result__header";

    const avatar = document.createElement("span");
    avatar.className = "chart-client-search-result__avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = getPersonInitials(result.fullName);

    const identity = document.createElement("span");
    identity.className = "chart-client-search-result__identity";
    const name = document.createElement("strong");
    name.textContent = result.preferredName
      ? `${result.fullName} (${result.preferredName})`
      : result.fullName;
    identity.append(name);

    const status = document.createElement("span");
    status.className = "chart-client-search-result__status";
    status.dataset.tone = getPersonStatusTone(result.status);
    status.textContent = result.status?.trim() || "Unknown";
    header.append(avatar, identity, status);

    const metadata = document.createElement("span");
    metadata.className = "chart-client-search-result__metadata";
    const metadataItems: Array<[string, string | undefined]> = [
      ["AlayaCare ID", result.alayaCareId],
      ["DOB", result.dateOfBirth],
      ["Branch", result.branchName]
    ];
    for (const [label, value] of metadataItems) {
      if (!value) {
        continue;
      }
      const item = document.createElement("span");
      item.className = "chart-client-search-result__metadata-item";
      const itemLabel = document.createElement("span");
      itemLabel.className = "chart-client-search-result__metadata-label";
      itemLabel.textContent = label;
      const itemValue = document.createElement("span");
      itemValue.className = "chart-client-search-result__metadata-value";
      itemValue.textContent = value;
      item.append(itemLabel, itemValue);
      metadata.append(item);
    }

    const ranking = clientChartRankings.get(result.clientId);
    if (ranking) {
      const score = document.createElement("span");
      score.className = "chart-client-search-result__score";
      const rankingItems: Array<[string, string]> = [
        ["Coverage", `${ranking.populatedSections}/${ranking.totalSections}`],
        ["Records", String(ranking.recordCount)],
        ["Failures", String(ranking.failedSections)]
      ];
      for (const [label, value] of rankingItems) {
        const item = document.createElement("span");
        const itemValue = document.createElement("strong");
        itemValue.textContent = value;
        item.append(itemValue, ` ${label}`);
        score.append(item);
      }
      button.append(header, metadata, score);
    } else {
      button.append(header, metadata);
    }

    const footer = document.createElement("span");
    footer.className = "chart-client-search-result__footer";
    const action = document.createElement("span");
    action.className = "chart-client-search-result__action";
    action.textContent = "Inspect chart";
    const arrow = document.createElement("span");
    arrow.className = "chart-client-search-result__arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "→";
    footer.append(action, arrow);
    button.append(footer);
    elements.clientChartSearchResults.append(button);
  }
}

function setClientChartResultButtonsDisabled(disabled: boolean): void {
  for (const button of elements.clientChartSearchResults.querySelectorAll<HTMLButtonElement>(
    ".chart-client-search-result"
  )) {
    button.disabled = disabled;
  }
}

async function inspectActiveClientChart(clientId?: number): Promise<void> {
  await withResult(async () => {
    requireClientChartFeature("snapshot");
    elements.inspectClientChartButton.disabled = true;
    elements.clientChartSearchInput.disabled = true;
    elements.searchClientChartsButton.disabled = true;
    elements.clientChartRankLimit.disabled = true;
    elements.rankClientChartsButton.disabled = true;
    setClientChartResultButtonsDisabled(true);
    elements.downloadClientChartButton.disabled = true;
    const selected = clientChartSearchResults.find((result) => result.clientId === clientId);
    elements.clientChartSummary.textContent = selected
      ? `Reading structured chart data for ${selected.fullName}\u2026`
      : "Reading structured chart data for the active client\u2026";
    try {
      const response = await sendRuntimeMessage<ClientChartExportSnapshot>({
        type: "ac/popup/export-active-client-chart",
        payload: {
          confirmedSynthetic: elements.clientChartSyntheticConfirm.checked,
          ...(clientId ? { clientId } : {})
        }
      });
      if (!response.ok || !response.data) {
        throw new Error(response.error ?? "Unable to inspect the client chart.");
      }

      clientChartSnapshot = response.data;
      elements.downloadClientChartButton.disabled = false;
      elements.clientChartSummary.textContent = buildClientChartSummary(response.data);
      const partialCount = response.data.counts.partial ?? 0;
      const completeCount =
        response.data.counts.complete ?? response.data.counts.successful - partialCount;
      return [
        `Inspected ${response.data.client.fullName}.`,
        `${completeCount} of ${response.data.counts.sections} sections are complete; ${partialCount} are partial.`,
        "Review the summary, then download the local JSON snapshot."
      ].join("\n");
    } catch (error) {
      clientChartSnapshot = null;
      elements.clientChartSummary.textContent = formatError(error);
      throw error;
    } finally {
      const confirmed = elements.clientChartSyntheticConfirm.checked;
      elements.inspectClientChartButton.disabled = !confirmed;
      elements.clientChartSearchInput.disabled = !confirmed;
      elements.clientChartRankLimit.disabled = !confirmed;
      elements.rankClientChartsButton.disabled = !confirmed;
      elements.searchClientChartsButton.disabled =
        !confirmed || elements.clientChartSearchInput.value.trim().length < 2;
      setClientChartResultButtonsDisabled(!confirmed);
    }
  });
}

function buildClientChartSummary(snapshot: ClientChartExportSnapshot): string {
  const failedSections = Object.entries(snapshot.sections)
    .filter(([, section]) => !section.ok)
    .map(([name, section]) => `- ${name}: ${section.error ?? "request failed"}`);
  const partialSections = Object.entries(snapshot.sections)
    .filter(([, section]) => section.ok && section.complete === false)
    .map(([name, section]) => `- ${name}: ${(section.warnings ?? ["partial capture"]).join(" ")}`);
  const partialCount = snapshot.counts.partial ?? partialSections.length;
  const completeCount = snapshot.counts.complete ?? snapshot.counts.successful - partialCount;
  const knownExclusions = snapshot.scope.knownExclusions ?? [];
  return [
    snapshot.client.fullName,
    `Route ID: ${snapshot.client.routeId}`,
    `Client ID: ${snapshot.client.id}`,
    `GUID: ${snapshot.client.guid}`,
    `Sections: ${completeCount}/${snapshot.counts.sections} complete; ${partialCount} partial; ${snapshot.counts.failed} failed`,
    `Attachment binaries: not included`,
    partialSections.length > 0
      ? `\nPartial sections:\n${partialSections.join("\n")}`
      : "\nNo partial sections.",
    failedSections.length > 0
      ? `\nSection failures:\n${failedSections.join("\n")}`
      : "\nNo section failures.",
    knownExclusions.length > 0
      ? `\nKnown exclusions:\n${knownExclusions.map((item) => `- ${item}`).join("\n")}`
      : ""
  ].join("\n");
}

function downloadClientChartJson(snapshot: ClientChartExportSnapshot): void {
  const tenant = safeTenantName(snapshot.tenantOrigin);
  const client = safeFileNamePart(snapshot.client.fullName) || `client-${snapshot.client.id}`;
  const date = snapshot.exportedAt.slice(0, 10);
  const filename = `alayacare-client-chart-${tenant}-${client}-${date}.json`;
  downloadFile(`${JSON.stringify(snapshot, null, 2)}\n`, "application/json", filename);
}

function resetClientChartImport(): void {
  clientChartImportPreview = null;
  clientChartImportResult = null;
  clientChartDestinationCatalog = null;
  clientChartSelectedGroupIds.clear();
  elements.clientChartImportFile.value = "";
  elements.clientChartImportFile.disabled = true;
  elements.previewClientChartImportButton.disabled = true;
  resetClientChartImportPreviewUi();
  elements.clientChartImportSummary.textContent =
    "Select an AC Tools client-chart JSON export.";
}

function resetClientChartImportPreviewUi(): void {
  clientChartDestinationCatalog = null;
  clientChartSelectedGroupIds.clear();
  elements.clientChartImportTarget.hidden = true;
  elements.clientChartImportFirstName.value = "";
  elements.clientChartImportFirstName.disabled = true;
  elements.clientChartImportLastName.value = "";
  elements.clientChartImportLastName.disabled = true;
  elements.clientChartImportBirthday.value = "";
  elements.clientChartImportBirthday.disabled = true;
  elements.clientChartImportHealthCard.value = "";
  elements.clientChartImportHealthCard.disabled = true;
  elements.clientChartImportGender.value = "O";
  elements.clientChartImportGender.disabled = true;
  elements.clientChartImportEmail.value = "";
  elements.clientChartImportEmail.disabled = true;
  elements.clientChartImportPhoneMain.value = "";
  elements.clientChartImportPhoneMain.disabled = true;
  elements.clientChartImportDestination.hidden = true;
  elements.clientChartImportDestinationCount.textContent = "Loading";
  elements.clientChartImportDestinationCount.dataset.tone = "neutral";
  elements.clientChartImportFacilityFilter.value = "";
  elements.clientChartImportFacilityFilter.disabled = true;
  elements.clientChartImportFacilities.replaceChildren();
  const destinationPlaceholder = document.createElement("p");
  destinationPlaceholder.textContent =
    "Care locations and client groups load after the JSON preview is validated.";
  elements.clientChartImportFacilities.append(destinationPlaceholder);
  elements.clientChartImportCostCentre.replaceChildren(new Option("No cost centre", ""));
  elements.clientChartImportCostCentre.disabled = true;
  elements.clientChartImportSections.hidden = true;
  elements.clientChartImportSections.disabled = true;
  elements.clientChartImportMedicalHistory.checked = false;
  elements.clientChartImportMedicalHistory.disabled = true;
  elements.clientChartImportRiskAssessment.checked = false;
  elements.clientChartImportRiskAssessment.disabled = true;
  elements.clientChartImportProgressNotes.checked = false;
  elements.clientChartImportProgressNotes.disabled = true;
  elements.clientChartImportMedications.checked = false;
  elements.clientChartImportMedications.disabled = true;
  elements.clientChartImportConfirmContainer.hidden = true;
  elements.clientChartImportConfirm.checked = false;
  elements.clientChartImportConfirm.disabled = true;
  elements.createClientChartImportButton.disabled = true;
  elements.openImportedClientLink.hidden = true;
  elements.openImportedClientLink.removeAttribute("href");
  elements.downloadClientChartImportReportButton.disabled = true;
}

async function previewClientChartImport(): Promise<void> {
  await withResult(async () => {
    requireClientChartFeature("import");
    const file = elements.clientChartImportFile.files?.[0];
    if (!elements.clientChartSyntheticConfirm.checked) {
      throw new Error("Confirm synthetic UAT data before previewing a chart import.");
    }
    if (!file) throw new Error("Choose an AC Tools client-chart JSON export.");

    elements.previewClientChartImportButton.disabled = true;
    elements.clientChartImportSummary.textContent = "Validating the selected JSON locally…";
    try {
      const raw = JSON.parse(await file.text()) as unknown;
      const preview = buildClientChartImportPreview(raw);
      clientChartImportPreview = preview;
      clientChartImportResult = null;

      elements.clientChartImportTarget.hidden = false;
      elements.clientChartImportFirstName.disabled = false;
      elements.clientChartImportFirstName.value = preview.suggestedFirstName;
      elements.clientChartImportLastName.disabled = false;
      elements.clientChartImportLastName.value = preview.suggestedLastName;
      elements.clientChartImportBirthday.disabled = false;
      elements.clientChartImportBirthday.value = preview.birthday ?? "";
      elements.clientChartImportHealthCard.disabled = false;
      elements.clientChartImportHealthCard.value = "";
      elements.clientChartImportGender.disabled = false;
      elements.clientChartImportGender.value = preview.suggestedGender;
      elements.clientChartImportEmail.disabled = false;
      elements.clientChartImportEmail.value = "";
      elements.clientChartImportPhoneMain.disabled = false;
      elements.clientChartImportPhoneMain.value = "";
      elements.clientChartImportDestination.hidden = false;
      elements.clientChartImportDestinationCount.textContent = "Loading";
      elements.clientChartImportDestinationCount.dataset.tone = "neutral";
      elements.clientChartImportFacilities.replaceChildren();
      const loadingDestinations = document.createElement("p");
      loadingDestinations.textContent = "Loading care locations and client groups from UAT…";
      elements.clientChartImportFacilities.append(loadingDestinations);
      await loadClientChartWriteDestinations(preview);
      elements.clientChartImportSections.hidden = false;
      elements.clientChartImportSections.disabled = false;
      elements.clientChartImportMedicalHistory.disabled = !preview.medicalHistory.available;
      elements.clientChartImportMedicalHistory.checked = preview.medicalHistory.available;
      elements.clientChartImportRiskAssessment.disabled = !preview.riskAssessment.available;
      elements.clientChartImportRiskAssessment.checked = preview.riskAssessment.available;
      elements.clientChartImportProgressNotes.disabled = !preview.progressNotes.available;
      elements.clientChartImportProgressNotes.checked = preview.progressNotes.available;
      elements.clientChartImportMedications.disabled = !preview.medications.available;
      elements.clientChartImportMedications.checked = preview.medications.available;
      elements.clientChartImportConfirmContainer.hidden = false;
      elements.clientChartImportConfirm.disabled = false;
      elements.clientChartImportConfirm.checked = false;
      elements.clientChartImportSummary.textContent = buildClientChartImportPreviewSummary(preview);
      updateClientChartImportCreateAvailability();
      return [
        `Validated the chart export for ${preview.sourceClientName}.`,
        `Loaded ${clientChartDestinationCatalog?.groups.length ?? 0} care locations/client groups.`,
        "Review the suggested basic information and care locations, then choose clinical sections to replay."
      ].join("\n");
    } catch (error) {
      clientChartImportPreview = null;
      resetClientChartImportPreviewUi();
      elements.clientChartImportSummary.textContent = formatError(error);
      throw error;
    } finally {
      elements.previewClientChartImportButton.disabled =
        !elements.clientChartSyntheticConfirm.checked ||
        (elements.clientChartImportFile.files?.length ?? 0) === 0;
    }
  });
}

async function loadClientChartWriteDestinations(
  preview: ClientChartImportPreview
): Promise<void> {
  const response = await sendRuntimeMessage<ClientChartDestinationCatalog>({
    type: "ac/popup/get-client-chart-destinations",
    payload: { confirmedSynthetic: elements.clientChartSyntheticConfirm.checked }
  });
  if (!response.ok || !response.data) {
    throw new Error(response.error ?? "Unable to load UAT client destinations.");
  }
  if (new URL(response.data.tenantOrigin).origin !== new URL(preview.sourceTenantOrigin).origin) {
    throw new Error(
      "Open the same AlayaCare UAT tenant that produced this JSON before choosing destinations."
    );
  }

  clientChartDestinationCatalog = response.data;
  clientChartSelectedGroupIds.clear();
  const sourceGroups = new Set(preview.sourceGroupNames.map((name) => name.toLowerCase()));
  for (const group of response.data.groups) {
    if (
      sourceGroups.has(group.name.toLowerCase()) ||
      (group.description && sourceGroups.has(group.description.toLowerCase()))
    ) {
      clientChartSelectedGroupIds.add(group.id);
    }
  }
  elements.clientChartImportFacilityFilter.disabled = false;
  elements.clientChartImportCostCentre.replaceChildren(new Option("No cost centre", ""));
  for (const costCentre of response.data.costCentres) {
    elements.clientChartImportCostCentre.append(new Option(costCentre.name, costCentre.code));
  }
  elements.clientChartImportCostCentre.disabled = false;
  renderClientChartDestinationGroups();
}

function renderClientChartDestinationGroups(): void {
  const catalog = clientChartDestinationCatalog;
  elements.clientChartImportFacilities.replaceChildren();
  if (!catalog) {
    const message = document.createElement("p");
    message.textContent = "Care locations and client groups are not loaded.";
    elements.clientChartImportFacilities.append(message);
    updateClientChartDestinationCount();
    return;
  }

  const query = elements.clientChartImportFacilityFilter.value.trim().toLowerCase();
  const groups = catalog.groups.filter((group) =>
    `${group.name} ${group.description ?? ""}`.toLowerCase().includes(query)
  );
  if (groups.length === 0) {
    const message = document.createElement("p");
    message.textContent = `No care locations or client groups match “${elements.clientChartImportFacilityFilter.value.trim()}”.`;
    elements.clientChartImportFacilities.append(message);
  } else {
    for (const group of groups) {
      const label = document.createElement("label");
      label.className = "chart-import__facility";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = String(group.id);
      checkbox.checked = clientChartSelectedGroupIds.has(group.id);
      checkbox.disabled = !clientChartImportPreview;
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) clientChartSelectedGroupIds.add(group.id);
        else clientChartSelectedGroupIds.delete(group.id);
        updateClientChartDestinationCount();
        updateClientChartImportCreateAvailability();
      });
      const name = document.createElement("span");
      name.textContent = group.description
        ? `${group.name} — ${group.description}`
        : group.name;
      label.append(checkbox, name);
      elements.clientChartImportFacilities.append(label);
    }
  }
  updateClientChartDestinationCount();
}

function updateClientChartDestinationCount(): void {
  const count = clientChartSelectedGroupIds.size;
  elements.clientChartImportDestinationCount.textContent = `${count} selected`;
  elements.clientChartImportDestinationCount.dataset.tone = count > 0 ? "success" : "neutral";
}

function selectedClientChartDestinationGroups(): ClientChartDestinationGroup[] {
  return (clientChartDestinationCatalog?.groups ?? []).filter((group) =>
    clientChartSelectedGroupIds.has(group.id)
  );
}

function buildClientChartImportPreviewSummary(preview: ClientChartImportPreview): string {
  const supported = [
    `Medical history: ${preview.medicalHistory.available ? `${preview.medicalHistory.recordCount} populated values` : "not available"}`,
    `Risk assessment: ${preview.riskAssessment.available ? `${preview.riskAssessment.recordCount} risks` : "not available"}`,
    `Progress notes: ${preview.progressNotes.available ? `${preview.progressNotes.recordCount} notes` : "not available"}`,
    `Medications: ${preview.medications.available ? `${preview.medications.recordCount} medications` : "not available"}`
  ];
  return [
    `Source: ${preview.sourceClientName} (Client ${preview.sourceClientId})`,
    `Tenant: ${preview.sourceTenantOrigin}`,
    `Suggested birthday: ${preview.birthday ?? "none"}`,
    `Source care locations/groups: ${preview.sourceGroupNames.join(", ") || "none reported"}`,
    `Available destinations: ${clientChartDestinationCatalog?.groups.length ?? 0} care locations/groups; ${clientChartDestinationCatalog?.costCentres.length ?? 0} cost centres`,
    "",
    "Supported in this version:",
    ...supported.map((value) => `- ${value}`),
    "",
    "Populated sections reported but not imported:",
    ...(preview.unsupportedPopulatedSections.length > 0
      ? preview.unsupportedPopulatedSections.map((name) => `- ${name}`)
      : ["- none detected"]),
    "",
    "Always omitted:",
    ...preview.omittedIdentityFields.map((name) => `- ${name}`)
  ].join("\n");
}

function updateClientChartImportCreateAvailability(): void {
  const firstName = elements.clientChartImportFirstName.value.trim();
  const lastName = elements.clientChartImportLastName.value.trim();
  elements.createClientChartImportButton.disabled = !(
    clientChartImportPreview &&
    clientChartDestinationCatalog &&
    clientChartSelectedGroupIds.size > 0 &&
    elements.clientChartSyntheticConfirm.checked &&
    elements.clientChartImportConfirm.checked &&
    firstName &&
    lastName &&
    isSyntheticClientName(firstName, lastName) &&
    elements.clientChartImportBirthday.checkValidity() &&
    elements.clientChartImportHealthCard.checkValidity() &&
    Boolean(elements.clientChartImportHealthCard.value.trim()) &&
    elements.clientChartImportGender.checkValidity() &&
    elements.clientChartImportEmail.checkValidity() &&
    elements.clientChartImportPhoneMain.checkValidity()
  );
}

async function createClientChartImport(): Promise<void> {
  await withResult(async () => {
    requireClientChartFeature("import");
    const preview = clientChartImportPreview;
    if (!preview) throw new Error("Preview a valid client-chart JSON before creating a client.");
    if (!elements.clientChartImportConfirm.checked) {
      throw new Error("Confirm that this operation creates a new synthetic UAT client.");
    }

    const firstName = elements.clientChartImportFirstName.value.trim();
    const lastName = elements.clientChartImportLastName.value.trim();
    const birthday = elements.clientChartImportBirthday.value.trim();
    const healthCard = elements.clientChartImportHealthCard.value.trim();
    const gender = elements.clientChartImportGender.value as "M" | "F" | "O";
    const email = elements.clientChartImportEmail.value.trim();
    const phoneMain = elements.clientChartImportPhoneMain.value.trim();
    if (!isSyntheticClientName(firstName, lastName)) {
      throw new Error("The new client name must include Test, Synthetic, UAT, Clone, or Copy.");
    }
    const destinationGroups = selectedClientChartDestinationGroups();
    if (destinationGroups.length === 0) {
      throw new Error("Choose at least one care location or client group.");
    }
    const selectedCostCentre = clientChartDestinationCatalog?.costCentres.find(
      (costCentre) => costCentre.code === elements.clientChartImportCostCentre.value
    );

    const selectedSections = [
      elements.clientChartImportMedicalHistory.checked ? "medical history" : "",
      elements.clientChartImportRiskAssessment.checked ? "risk assessment" : "",
      elements.clientChartImportProgressNotes.checked ? "progress notes" : "",
      elements.clientChartImportMedications.checked ? "medications" : ""
    ].filter(Boolean);
    const confirmed = window.confirm(
      [
        `Create a new synthetic client named ${firstName} ${lastName}?`,
        "",
        `Destination: ${preview.sourceTenantOrigin}`,
        `Care locations/groups (${destinationGroups.length}): ${destinationGroups.map((group) => group.name).join(", ")}`,
        `Cost centre: ${selectedCostCentre?.name ?? "none"}`,
        `Date of birth: ${birthday || "not set"}`,
        `Health card: ${healthCard || "not set"}`,
        `Gender: ${gender}`,
        `Email: ${email || "not set"}`,
        `Main phone: ${phoneMain || "not set"}`,
        `Replay sections: ${selectedSections.join(" and ") || "none (basic client only)"}`,
        "",
        "This creates a new record and cannot be undone by AC Tools."
      ].join("\n")
    );
    if (!confirmed) return "Client creation cancelled.";

    setClientChartImportControlsDisabled(true);
    clientChartImportResult = null;
    elements.clientChartImportSummary.textContent =
      "Creating the synthetic UAT client and replaying selected clinical sections…";
    try {
      const response = await sendRuntimeMessage<ClientChartImportResult>({
        type: "ac/popup/import-client-chart",
        payload: {
          confirmedSynthetic: elements.clientChartSyntheticConfirm.checked,
          confirmedCreate: elements.clientChartImportConfirm.checked,
          sourceTenantOrigin: preview.sourceTenantOrigin,
          sourceClientId: preview.sourceClientId,
          sourceClientName: preview.sourceClientName,
          targetFirstName: firstName,
          targetLastName: lastName,
          birthday,
          healthCard,
          gender,
          email: email || undefined,
          phoneMain: phoneMain || undefined,
          destinationGroupIds: destinationGroups.map((group) => group.id),
          costCentreCode: selectedCostCentre?.code,
          medicalHistoryData: elements.clientChartImportMedicalHistory.checked
            ? preview.medicalHistory.data
            : undefined,
          riskAssessmentData: elements.clientChartImportRiskAssessment.checked
            ? preview.riskAssessment.data
            : undefined,
          progressNotesData: elements.clientChartImportProgressNotes.checked
            ? preview.progressNotes.data
            : undefined,
          medicationsData: elements.clientChartImportMedications.checked
            ? preview.medications.data
            : undefined
        }
      });
      if (!response.ok || !response.data) {
        throw new Error(response.error ?? "Unable to create the synthetic UAT client.");
      }

      clientChartImportResult = response.data;
      elements.clientChartImportSummary.textContent = buildClientChartImportResultSummary(
        response.data
      );
      elements.openImportedClientLink.href = response.data.targetClient.url;
      elements.openImportedClientLink.hidden = false;
      elements.downloadClientChartImportReportButton.disabled = false;
      elements.clientChartImportConfirm.checked = false;
      if (response.data.counts.failed > 0) {
        showToast(
          "warning",
          "Client created with import warnings",
          `${response.data.counts.failed} selected clinical replay step failed. Download the report for details.`
        );
      } else {
        showToast(
          "success",
          "Synthetic client created",
          `${response.data.targetClient.fullName} was created with the selected clinical sections.`
        );
      }
      return [
        `Created ${response.data.targetClient.fullName} (Client ${response.data.targetClient.id}).`,
        `${response.data.counts.successful}/${response.data.counts.requested} import steps succeeded.`
      ].join("\n");
    } catch (error) {
      elements.clientChartImportSummary.textContent = formatError(error);
      throw error;
    } finally {
      setClientChartImportControlsDisabled(false);
      updateClientChartImportCreateAvailability();
    }
  });
}

function setClientChartImportControlsDisabled(disabled: boolean): void {
  const confirmed = elements.clientChartSyntheticConfirm.checked;
  elements.clientChartImportFile.disabled = disabled || !confirmed;
  elements.previewClientChartImportButton.disabled =
    disabled || !confirmed || (elements.clientChartImportFile.files?.length ?? 0) === 0;
  elements.clientChartImportFirstName.disabled = disabled || !clientChartImportPreview;
  elements.clientChartImportLastName.disabled = disabled || !clientChartImportPreview;
  elements.clientChartImportBirthday.disabled = disabled || !clientChartImportPreview;
  elements.clientChartImportHealthCard.disabled = disabled || !clientChartImportPreview;
  elements.clientChartImportGender.disabled = disabled || !clientChartImportPreview;
  elements.clientChartImportEmail.disabled = disabled || !clientChartImportPreview;
  elements.clientChartImportPhoneMain.disabled = disabled || !clientChartImportPreview;
  elements.clientChartImportFacilityFilter.disabled = disabled || !clientChartDestinationCatalog;
  for (const checkbox of elements.clientChartImportFacilities.querySelectorAll<HTMLInputElement>(
    'input[type="checkbox"]'
  )) {
    checkbox.disabled = disabled || !clientChartDestinationCatalog;
  }
  elements.clientChartImportCostCentre.disabled = disabled || !clientChartDestinationCatalog;
  elements.clientChartImportSections.disabled = disabled || !clientChartImportPreview;
  elements.clientChartImportProgressNotes.disabled =
    disabled || !clientChartImportPreview?.progressNotes.available;
  elements.clientChartImportMedications.disabled =
    disabled || !clientChartImportPreview?.medications.available;
  elements.clientChartImportConfirm.disabled = disabled || !clientChartImportPreview;
  elements.createClientChartImportButton.disabled = disabled;
}

function buildClientChartImportResultSummary(result: ClientChartImportResult): string {
  const steps = result.steps.map(
    (step) =>
      `- ${step.section}: ${step.skipped ? "already present (skipped)" : step.ok ? `success${step.status ? ` (${step.status})` : ""}` : `failed — ${step.error ?? "unknown error"}`}`
  );
  return [
    `Created: ${result.targetClient.fullName}`,
    `Client ID: ${result.targetClient.id}`,
    `Route ID: ${result.targetClient.routeId}`,
    `Date of birth: ${result.targetClient.birthday ?? "not set"}`,
    `Email: ${result.targetClient.email ?? "not set"}`,
    `Main phone: ${result.targetClient.phoneMain ?? "not set"}`,
    `Care locations/groups: ${result.targetClient.destinationGroups.map((group) => group.name).join(", ")}`,
    `Cost centre: ${result.targetClient.costCentre?.name ?? "none"}`,
    `Steps: ${result.counts.successful}/${result.counts.requested} successful`,
    `Already present: ${result.counts.skipped}`,
    "",
    ...steps,
    "",
    `Not imported: ${result.scope.omittedSections.join(", ")}.`
  ].join("\n");
}

function downloadClientChartImportReport(result: ClientChartImportResult): void {
  const tenant = safeTenantName(result.tenantOrigin);
  const client = safeFileNamePart(result.targetClient.fullName) || `client-${result.targetClient.id}`;
  const date = result.importedAt.slice(0, 10);
  downloadFile(
    `${JSON.stringify(result, null, 2)}\n`,
    "application/json",
    `alayacare-client-import-${tenant}-${client}-${date}.json`
  );
}

async function parseSelectedClientChartPdfs(): Promise<void> {
  await withResult(async () => {
    requireClientChartFeature("pdf");
    if (!elements.clientChartSyntheticConfirm.checked) {
      throw new Error("Confirm that the selected PDFs contain synthetic UAT data.");
    }
    const files = Array.from(elements.clientChartPdfFiles.files ?? []);
    if (files.length === 0) throw new Error("Choose at least one AlayaCare batch PDF.");

    elements.parseClientChartPdfsButton.disabled = true;
    elements.downloadClientChartPdfJsonButton.disabled = true;
    elements.clientChartPdfSummary.textContent = "Loading the local PDF parser…";
    try {
      const { parseClientChartPdfBatch } = await import("../shared/clientChartPdf");
      const snapshot = await parseClientChartPdfBatch(files, true, (progress) => {
        elements.clientChartPdfSummary.textContent = [
          `Parsing ${progress.fileName}`,
          `File ${progress.fileIndex + 1}/${progress.fileCount}`,
          `Page ${progress.pageNumber}/${progress.pageCount}`
        ].join("\n");
      });
      clientChartPdfSnapshot = snapshot;
      elements.downloadClientChartPdfJsonButton.disabled = false;
      elements.clientChartPdfSummary.textContent = buildClientChartPdfSummary(snapshot);
      return [
        `Parsed ${snapshot.counts.files} local PDF${snapshot.counts.files === 1 ? "" : "s"}.`,
        `Indexed ${snapshot.counts.pages} pages and ${snapshot.counts.visitDays} visit days.`,
        "Review the summary, then download the parsed JSON."
      ].join("\n");
    } catch (error) {
      clientChartPdfSnapshot = null;
      elements.clientChartPdfSummary.textContent = formatError(error);
      throw error;
    } finally {
      elements.parseClientChartPdfsButton.disabled =
        !elements.clientChartSyntheticConfirm.checked ||
        (elements.clientChartPdfFiles.files?.length ?? 0) === 0;
    }
  });
}

function buildClientChartPdfSummary(snapshot: ClientChartPdfParseSnapshot): string {
  const fileSummaries = snapshot.files.map((file) => {
    const name = file.identity.displayName ?? file.sourceFile.name;
    const knownPages = file.pageCount - file.counts.byReportType.unknown;
    return `- ${name}: ${file.pageCount} pages, ${knownPages} classified, ${file.counts.visitDays} visit days`;
  });
  return [
    `Files: ${snapshot.counts.files}`,
    `Pages: ${snapshot.counts.pages}`,
    `Report groups: ${snapshot.counts.reports}`,
    `Visit days: ${snapshot.counts.visitDays}`,
    `Unique visit IDs: ${snapshot.counts.uniqueVisitIds}`,
    "Processing: local only; no upload",
    "",
    ...fileSummaries
  ].join("\n");
}

function downloadClientChartPdfJson(snapshot: ClientChartPdfParseSnapshot): void {
  const date = snapshot.parsedAt.slice(0, 10);
  const filename = `alayacare-client-chart-pdf-batch-${date}.json`;
  downloadFile(`${JSON.stringify(snapshot, null, 2)}\n`, "application/json", filename);
}

async function exportFormContextCatalog(format: "json" | "csv" | "xlsx"): Promise<void> {
  await withResult(async () => {
    setCatalogExportButtonsDisabled(true);
    try {
      const response = await sendRuntimeMessage<AlayaCareFormContextCatalogSnapshot>({
        type: "ac/popup/export-form-context-catalog"
      });

      if (!response.ok || !response.data) {
        throw new Error(response.error ?? "Unable to export the form-context catalog.");
      }

      if (format === "json") {
        downloadCatalogJson(response.data);
      } else if (format === "csv") {
        const csvResult = buildAlayaCareCatalogCsv(response.data);
        downloadCatalogCsv(response.data, csvResult.csv);
        return [
          `Exported ${csvResult.rowCount} CSV rows.`,
          `Merged ${csvResult.matchedAnnotationCount} live Patient bindings with reviewed annotations.`,
          `Appended ${csvResult.liveOnlyCount} newly discovered live fields.`
        ].join("\n");
      } else {
        const xlsxResult = buildAlayaCareCatalogXlsx(response.data);
        downloadCatalogXlsx(response.data, xlsxResult.xlsx, xlsxResult.contentType);
        return [
          `Exported ${xlsxResult.rowCount} styled Excel rows.`,
          `Merged ${xlsxResult.matchedAnnotationCount} live Patient bindings with reviewed annotations.`,
          `Highlighted ${xlsxResult.liveOnlyCount} newly discovered live fields for review.`
        ].join("\n");
      }
      return [
        `Exported ${response.data.counts.fields} fields from ${response.data.counts.contexts} contexts.`,
        `Resolved ${response.data.counts.options} option values.`,
        "Next: run the Webforms catalog curation command with this JSON and the reviewed catalog export."
      ].join("\n");
    } finally {
      setCatalogExportButtonsDisabled(false);
    }
  });
}

function downloadCatalogJson(snapshot: AlayaCareFormContextCatalogSnapshot): void {
  const tenant = safeTenantName(snapshot.tenantOrigin);
  const date = snapshot.exportedAt.slice(0, 10);
  const filename = `alayacare-field-catalog-${tenant}-${date}.json`;
  downloadFile(`${JSON.stringify(snapshot, null, 2)}\n`, "application/json", filename);
}

function downloadCatalogCsv(
  snapshot: AlayaCareFormContextCatalogSnapshot,
  csv: string
): void {
  const tenant = safeTenantName(snapshot.tenantOrigin);
  const date = snapshot.exportedAt.slice(0, 10);
  const filename = `alayacare-field-catalog-${tenant}-${date}.csv`;
  downloadFile(csv, "text/csv;charset=utf-8", filename);
}

function downloadCatalogXlsx(
  snapshot: AlayaCareFormContextCatalogSnapshot,
  xlsx: Uint8Array,
  contentType: string
): void {
  const tenant = safeTenantName(snapshot.tenantOrigin);
  const date = snapshot.exportedAt.slice(0, 10);
  const filename = `alayacare-field-catalog-${tenant}-${date}.xlsx`;
  downloadFile(xlsx, contentType, filename);
}

function downloadFile(content: string | Uint8Array, type: string, filename: string): void {
  const blobContent =
    typeof content === "string"
      ? content
      : (content.buffer.slice(
          content.byteOffset,
          content.byteOffset + content.byteLength
        ) as ArrayBuffer);
  const blob = new Blob([blobContent], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function setCatalogExportButtonsDisabled(disabled: boolean): void {
  elements.catalogJsonExportButton.disabled = disabled;
  elements.catalogCsvExportButton.disabled = disabled;
  elements.catalogXlsxExportButton.disabled = disabled;
}

function safeTenantName(origin: string): string {
  try {
    return new URL(origin).hostname.split(".")[0]?.replace(/[^a-z0-9-]+/gi, "-") || "tenant";
  } catch {
    return "tenant";
  }
}

function safeFileNamePart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function refreshStatus(): Promise<void> {
  elements.statusText.textContent = "Checking current tab\u2026";

  try {
    const response = await sendRuntimeMessage<PageStatus>({ type: "ac/popup/get-status" });

    if (!response.ok || !response.data) {
      throw new Error(response.error ?? "Unable to inspect the current tab.");
    }

    elements.statusText.textContent = buildStatusText(response.data);
    isUatTenant = response.data.ready && response.data.location.includes(".uat.alayacare.");
    updateSelectedEmployeeTestAvailability();
  } catch (error) {
    elements.statusText.textContent = formatError(error);
    isUatTenant = false;
    updateSelectedEmployeeTestAvailability();
  }
}

function buildStatusText(status: PageStatus): string {
  if (!status.ready) {
    return `${status.location}\n${status.reason ?? "This does not look like a usable AlayaCare page."}`;
  }

  const userLabel = status.currentUserName ?? status.currentUserId?.toString() ?? "Unknown user";
  return `${status.location}\nSigned in as ${userLabel}`;
}

function readDraft(): AvailabilityDraft {
  const formData = new FormData(elements.form);

  return {
    employeeId: Number(formData.get("employeeId")),
    availabilityTypeId: Number(formData.get("availabilityTypeId")),
    date: String(formData.get("date")),
    startTime: String(formData.get("startTime")),
    endTime: String(formData.get("endTime")),
    description: String(formData.get("description"))
  };
}

async function hydrateForm(): Promise<void> {
  const storage = await chrome.storage.local.get(POPUP_FORM_STORAGE_KEY);
  const draft = mergeDraft(storage[POPUP_FORM_STORAGE_KEY]);

  setFieldValue("employeeId", String(draft.employeeId));
  setFieldValue("availabilityTypeId", String(draft.availabilityTypeId));
  setFieldValue("date", draft.date);
  setFieldValue("startTime", draft.startTime);
  setFieldValue("endTime", draft.endTime);
  setFieldValue("description", draft.description);
}

async function persistDraft(draft: AvailabilityDraft): Promise<void> {
  await chrome.storage.local.set({
    [POPUP_FORM_STORAGE_KEY]: draft
  });
}

function mergeDraft(candidate: unknown): AvailabilityDraft {
  if (!candidate || typeof candidate !== "object") {
    return defaultDraft;
  }

  const value = candidate as Partial<AvailabilityDraft>;

  return {
    employeeId: Number(value.employeeId) || defaultDraft.employeeId,
    availabilityTypeId: Number(value.availabilityTypeId) || defaultDraft.availabilityTypeId,
    date: value.date || defaultDraft.date,
    startTime: value.startTime || defaultDraft.startTime,
    endTime: value.endTime || defaultDraft.endTime,
    description: value.description || defaultDraft.description
  };
}

function setFieldValue(fieldId: keyof AvailabilityDraft, value: string): void {
  const field = document.querySelector<HTMLInputElement>(`#${fieldId}`);
  if (field) {
    field.value = value;
  }
}
