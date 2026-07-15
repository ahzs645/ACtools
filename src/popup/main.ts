import "./styles.css";

import { sendRuntimeMessage } from "../shared/chrome";
import { formatError } from "../shared/errors";
import type { AlayaCareFormContextCatalogSnapshot } from "../shared/formContextCatalog";
import { buildAlayaCareCatalogCsv } from "../shared/formContextCsv";
import type {
  EmployeeApiCredentialStatus,
  EmployeeConfiguredTenant,
  EmployeeDetail,
  EmployeeListResult,
  EmployeeSummary,
  EmployeeWriteResult
} from "../shared/employees";
import type { AppPreferences } from "../shared/environments";
import { EnvironmentManagerController } from "./features/environments/controller";
import { clearEmployeeCaches, cacheEmployees, loadCachedEmployees } from "./features/employees/cache";
import { EmployeeCopyController } from "./features/employees/copyController";
import {
  type EmployeeSortField,
  type SortDirection,
  sortEmployees
} from "./features/employees/sort";
import { loadAppPreferences, resetAppPreferences, saveAppPreferences } from "./features/preferences";
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

const elements = getPopupElements();
const environmentManager = new EnvironmentManagerController(async () => {
  await refreshConfiguredEmployeeTenants();
});
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
  appPreferences = await loadAppPreferences();
  await applyStoredTheme();
  await applyStoredSurfaceSelection();
  applyEmployeePreferences();
  await hydrateForm();
  await refreshStatus();
  await environmentManager.init();
  employeeCopyController.init();
  elements.extensionVersion.textContent = `v${chrome.runtime.getManifest().version}`;

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
    elements.resultText.textContent = "Working\u2026";

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
    elements.resultText.textContent = "Ready.";
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

  if (panelName) {
    showDetail(title, subtitle, panelName);
  }
}

function showLauncher(): void {
  elements.launcherView.hidden = false;
  elements.launcherView.classList.add("is-active");
  elements.detailView.hidden = true;
  elements.detailView.classList.remove("is-active");
  elements.searchInput.focus();
}

function showDetail(title: string, subtitle: string, panelName: string): void {
  elements.detailTitle.textContent = title;
  elements.detailSubtitle.textContent = subtitle;
  elements.launcherView.hidden = true;
  elements.launcherView.classList.remove("is-active");
  elements.detailView.hidden = false;
  elements.detailView.classList.add("is-active");

  elements.toolPanels.forEach((panel, key) => {
    const isActive = key === panelName;
    panel.hidden = !isActive;
    panel.classList.toggle("is-active", isActive);
  });

  elements.resultContainer.hidden = panelName === "settings";
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

  const name = document.createElement("span");
  name.className = "employee-list__name";
  name.textContent = employeeDisplayName(employee);

  const meta = document.createElement("span");
  meta.className = "employee-list__meta";
  meta.textContent = `#${employee.id} · ${employee.status ?? "unknown"}${
    employee.designation ? ` · ${employee.designation}` : ""
  }`;

  button.append(name, meta);
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
    elements.resultText.textContent = "Select an employee before updating status.";
    return;
  }

  const employeeId = selectedEmployee.id;
  const comment = elements.employeeStatusComment.value.trim();
  if (!comment) {
    elements.resultText.textContent = "Enter a ticket or reason so the change has an audit note.";
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
    elements.resultText.textContent = "Select the existing UAT test employee first.";
    return;
  }

  const employee = selectedEmployee;
  const displayName = employeeDisplayName(employee);
  if (!isUatTenant || !/(test|do\s*not\s*send)/i.test(displayName)) {
    elements.resultText.textContent = "The selected employee must be clearly marked Test on a UAT tenant.";
    return;
  }
  if (employee.status !== "active") {
    elements.resultText.textContent = "The round-trip test expects the selected test employee to start active.";
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
    elements.resultText.textContent = response.data.storage === "local"
      ? "API credentials were validated and remembered in this Chrome profile."
      : "API credentials were validated and are available for this Chrome session only.";
    showToast("success", "Credentials validated", elements.resultText.textContent);
  } catch (error) {
    elements.resultText.textContent = formatError(error);
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
    elements.resultText.textContent = response.error ?? "Unable to clear API credentials.";
    return;
  }
  await clearEmployeeCaches(response.data.origin);
  applyEmployeeApiCredentialStatus(response.data);
  elements.employeeApiRemember.checked = false;
  await refreshConfiguredEmployeeTenants();
  elements.resultText.textContent = "API credentials cleared from session and device storage.";
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
  resultText: HTMLElement;
  resultContainer: HTMLElement;
  refreshStatusButton: HTMLButtonElement;
  themeToggle: HTMLButtonElement;
  settingsButton: HTMLButtonElement;
  searchInput: HTMLInputElement;
  emptySearch: HTMLElement;
  launcherView: HTMLElement;
  detailView: HTMLElement;
  detailTitle: HTMLElement;
  detailSubtitle: HTMLElement;
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
  const resultText = document.querySelector<HTMLElement>("#result-text");
  const resultContainer = document.querySelector<HTMLElement>("#result-container");
  const refreshStatusButton = document.querySelector<HTMLButtonElement>("#refresh-status");
  const themeToggle = document.querySelector<HTMLButtonElement>("#theme-toggle");
  const settingsButton = document.querySelector<HTMLButtonElement>("#settings-button");
  const searchInput = document.querySelector<HTMLInputElement>("#tool-search");
  const emptySearch = document.querySelector<HTMLElement>("#empty-search");
  const launcherView = document.querySelector<HTMLElement>("#view-launcher");
  const detailView = document.querySelector<HTMLElement>("#view-detail");
  const detailTitle = document.querySelector<HTMLElement>("#detail-title");
  const detailSubtitle = document.querySelector<HTMLElement>("#detail-subtitle");
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
    !resultText ||
    !resultContainer ||
    !refreshStatusButton ||
    !themeToggle ||
    !settingsButton ||
    !searchInput ||
    !emptySearch ||
    !launcherView ||
    !detailView ||
    !detailTitle ||
    !detailSubtitle ||
    !detailBackButton ||
    !plannedTitle ||
    !plannedDescription ||
    !surfaceHint ||
    !catalogJsonExportButton ||
    !catalogCsvExportButton ||
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
    resultText,
    resultContainer,
    refreshStatusButton,
    themeToggle,
    settingsButton,
    searchInput,
    emptySearch,
    launcherView,
    detailView,
    detailTitle,
    detailSubtitle,
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

async function exportFormContextCatalog(format: "json" | "csv"): Promise<void> {
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
      } else {
        const csvResult = buildAlayaCareCatalogCsv(response.data);
        downloadCatalogCsv(response.data, csvResult.csv);
        return [
          `Exported ${csvResult.rowCount} CSV rows.`,
          `Merged ${csvResult.matchedAnnotationCount} live Patient bindings with reviewed annotations.`,
          `Appended ${csvResult.liveOnlyCount} newly discovered live fields.`
        ].join("\n");
      }
      return [
        `Exported ${response.data.counts.fields} fields from ${response.data.counts.contexts} contexts.`,
        `Resolved ${response.data.counts.options} option values.`,
        "Next: run the Webforms catalog curation command with this JSON and Book1.csv."
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

function downloadFile(content: string, type: string, filename: string): void {
  const blob = new Blob([content], { type });
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
}

function safeTenantName(origin: string): string {
  try {
    return new URL(origin).hostname.split(".")[0]?.replace(/[^a-z0-9-]+/gi, "-") || "tenant";
  } catch {
    return "tenant";
  }
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

async function withResult(action: () => Promise<string>): Promise<void> {
  elements.resultText.textContent = "Working\u2026";

  try {
    const message = await action();
    elements.resultText.textContent = message;
    showToast("success", "Completed", message.length > 240 ? `${message.slice(0, 237)}…` : message);
  } catch (error) {
    const message = formatError(error);
    elements.resultText.textContent = message;
    showToast("error", "Action failed", message);
  }
}
