import "./styles.css";

import { sendRuntimeMessage } from "../shared/chrome";
import { formatError } from "../shared/errors";
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

const elements = getPopupElements();

void init();

async function init(): Promise<void> {
  await applyStoredTheme();
  await applyStoredSurfaceSelection();
  await hydrateForm();
  await refreshStatus();

  elements.themeToggle.addEventListener("click", () => {
    void toggleTheme();
  });

  elements.settingsButton.addEventListener("click", () => {
    showSettings();
  });

  elements.refreshStatusButton.addEventListener("click", () => {
    void refreshStatus();
  });

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
    surfaceHint
  };
}

async function refreshStatus(): Promise<void> {
  elements.statusText.textContent = "Checking current tab\u2026";

  try {
    const response = await sendRuntimeMessage<PageStatus>({ type: "ac/popup/get-status" });

    if (!response.ok || !response.data) {
      throw new Error(response.error ?? "Unable to inspect the current tab.");
    }

    elements.statusText.textContent = buildStatusText(response.data);
  } catch (error) {
    elements.statusText.textContent = formatError(error);
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
    elements.resultText.textContent = await action();
  } catch (error) {
    elements.resultText.textContent = formatError(error);
  }
}
