import "./styles.css";

import { sendRuntimeMessage } from "../shared/chrome";
import { formatError } from "../shared/errors";
import {
  POPUP_FORM_STORAGE_KEY,
  type AvailabilityDraft,
  type AvailabilityPostResult,
  type PageStatus
} from "../shared/messages";

const defaultDate = new Date().toISOString().slice(0, 10);

const defaultDraft: AvailabilityDraft = {
  employeeId: 348,
  availabilityTypeId: 4,
  date: defaultDate,
  startTime: "08:00",
  endTime: "16:30",
  description: "CHROMIUM EXTENSION"
};

const {
  form,
  statusText,
  resultText,
  refreshStatusButton,
  workspaceTitle,
  workspaceDescription,
  plannedTitle,
  plannedDescription,
  toolTiles,
  panels
} = getPopupElements();

void init();

async function init(): Promise<void> {
  await hydrateForm();
  await refreshStatus();

  refreshStatusButton.addEventListener("click", async () => {
    await refreshStatus();
  });

  toolTiles.forEach((tile) => {
    tile.addEventListener("click", async () => {
      const action = tile.dataset.toolAction;
      const panelName = tile.dataset.toolPanel;
      const title = tile.dataset.toolTitle ?? "Toolkit";
      const description = tile.dataset.toolDescription ?? "";

      workspaceTitle.textContent = title;
      workspaceDescription.textContent = description;

      if (action === "open-day-view") {
        setActiveTile(null);
        showPanel("home");

        await withResult(async () => {
          const response = await sendRuntimeMessage<void>({ type: "ac/popup/open-day-view" });

          if (!response.ok) {
            throw new Error(response.error ?? "Unable to open day view.");
          }

          return "Opened Ramona Day View on the active tab.";
        });
        return;
      }

      if (panelName === "planned") {
        plannedTitle.textContent = title;
        plannedDescription.textContent =
          description || "This module has a reserved slot in the app drawer but is not implemented yet.";
        showPanel("planned");
        setActiveTile(tile);
        return;
      }

      if (panelName) {
        showPanel(panelName);
        setActiveTile(tile);
      }
    });
  });

  form.addEventListener("input", () => {
    void persistDraft(readDraft());
  });

  form.addEventListener("submit", async (event) => {
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

function getPopupElements(): {
  form: HTMLFormElement;
  statusText: HTMLElement;
  resultText: HTMLElement;
  refreshStatusButton: HTMLButtonElement;
  workspaceTitle: HTMLElement;
  workspaceDescription: HTMLElement;
  plannedTitle: HTMLElement;
  plannedDescription: HTMLElement;
  toolTiles: HTMLButtonElement[];
  panels: Map<string, HTMLElement>;
} {
  const form = document.querySelector<HTMLFormElement>("#availability-form");
  const statusText = document.querySelector<HTMLElement>("#status-text");
  const resultText = document.querySelector<HTMLElement>("#result-text");
  const refreshStatusButton = document.querySelector<HTMLButtonElement>("#refresh-status");
  const workspaceTitle = document.querySelector<HTMLElement>("#workspace-title");
  const workspaceDescription = document.querySelector<HTMLElement>("#workspace-description");
  const plannedTitle = document.querySelector<HTMLElement>("#planned-title");
  const plannedDescription = document.querySelector<HTMLElement>("#planned-description");
  const toolTiles = Array.from(document.querySelectorAll<HTMLButtonElement>(".tool-tile"));
  const panelElements = Array.from(document.querySelectorAll<HTMLElement>(".workspace-panel"));
  const panels = new Map(panelElements.map((panel) => [panel.id.replace("panel-", ""), panel]));

  if (
    !form ||
    !statusText ||
    !resultText ||
    !refreshStatusButton ||
    !workspaceTitle ||
    !workspaceDescription ||
    !plannedTitle ||
    !plannedDescription ||
    toolTiles.length === 0 ||
    panels.size === 0
  ) {
    throw new Error("Popup elements are missing.");
  }

  return {
    form,
    statusText,
    resultText,
    refreshStatusButton,
    workspaceTitle,
    workspaceDescription,
    plannedTitle,
    plannedDescription,
    toolTiles,
    panels
  };
}

function showPanel(name: string): void {
  panels.forEach((panel, key) => {
    const isActive = key === name;
    panel.hidden = !isActive;
    panel.classList.toggle("is-active", isActive);
  });
}

function setActiveTile(activeTile: HTMLButtonElement | null): void {
  toolTiles.forEach((tile) => {
    tile.classList.toggle("is-selected", tile === activeTile);
  });
}

async function refreshStatus(): Promise<void> {
  statusText.textContent = "Checking current tab...";

  try {
    const response = await sendRuntimeMessage<PageStatus>({ type: "ac/popup/get-status" });

    if (!response.ok || !response.data) {
      throw new Error(response.error ?? "Unable to inspect the current tab.");
    }

    statusText.textContent = buildStatusText(response.data);
  } catch (error) {
    statusText.textContent = formatError(error);
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
  const formData = new FormData(form);

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
  resultText.textContent = "Working...";

  try {
    resultText.textContent = await action();
  } catch (error) {
    resultText.textContent = formatError(error);
  }
}
