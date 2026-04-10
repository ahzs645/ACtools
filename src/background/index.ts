import { formatError } from "../shared/errors";
import { getActiveTabId, sendMessageToTab } from "../shared/chrome";
import type {
  AvailabilityPostResult,
  CommandResult,
  PageStatus,
  RuntimeMessage,
  Surface
} from "../shared/messages";
import {
  DEFAULT_SURFACE,
  SURFACE_STORAGE_KEY,
  isPopupMessage,
  isRuntimeMessage
} from "../shared/messages";

const SIDE_PANEL_PATH = "sidepanel.html";
const POPUP_PATH = "sidepanel.html?surface=popup";

let currentSurface: Surface = DEFAULT_SURFACE;

void initialize();

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isRuntimeMessage(message)) {
    return false;
  }

  if (!isPopupMessage(message)) {
    return false;
  }

  void handlePopupMessage(message)
    .then(sendResponse)
    .catch((error: unknown) => {
      sendResponse({
        ok: false,
        error: formatError(error)
      } satisfies CommandResult<never>);
    });

  return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (currentSurface !== "sidepanel" || !("sidePanel" in chrome)) {
    return;
  }

  if (!changeInfo.url && !tab.url) {
    return;
  }

  void syncSidePanelForTab(tabId, changeInfo.url ?? tab.url ?? "");
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  if (currentSurface !== "sidepanel" || !("sidePanel" in chrome)) {
    return;
  }

  void chrome.tabs
    .get(tabId)
    .then((tab) => syncSidePanelForTab(tabId, tab.url ?? ""))
    .catch(() => undefined);
});

async function initialize(): Promise<void> {
  currentSurface = await loadStoredSurface();
  await applySurface(currentSurface);
}

async function loadStoredSurface(): Promise<Surface> {
  try {
    const stored = await chrome.storage.local.get(SURFACE_STORAGE_KEY);
    const value = stored[SURFACE_STORAGE_KEY];
    return value === "popup" ? "popup" : DEFAULT_SURFACE;
  } catch {
    return DEFAULT_SURFACE;
  }
}

async function applySurface(surface: Surface): Promise<void> {
  currentSurface = surface;

  try {
    await chrome.action.setPopup({ popup: surface === "popup" ? POPUP_PATH : "" });
  } catch (error) {
    console.warn("Unable to set action popup.", error);
  }

  if (!("sidePanel" in chrome)) {
    return;
  }

  try {
    await chrome.sidePanel.setPanelBehavior({
      openPanelOnActionClick: surface === "sidepanel"
    });
  } catch (error) {
    console.warn("Unable to set side panel behavior.", error);
  }

  const tabs = await chrome.tabs.query({});
  const taggedTabs = tabs.filter(
    (tab): tab is chrome.tabs.Tab & { id: number } => typeof tab.id === "number"
  );

  if (surface === "popup") {
    await Promise.all(
      taggedTabs.map((tab) =>
        chrome.sidePanel
          .setOptions({ tabId: tab.id, enabled: false })
          .catch(() => undefined)
      )
    );
    return;
  }

  await Promise.all(
    taggedTabs.map((tab) => syncSidePanelForTab(tab.id, tab.url ?? ""))
  );
}

async function handlePopupMessage(
  message: Extract<RuntimeMessage, { type: `ac/popup/${string}` }>
): Promise<CommandResult<PageStatus | AvailabilityPostResult | void>> {
  if (message.type === "ac/popup/set-surface") {
    try {
      await chrome.storage.local.set({ [SURFACE_STORAGE_KEY]: message.payload });
    } catch (error) {
      return { ok: false, error: formatError(error) };
    }

    await applySurface(message.payload);
    return { ok: true };
  }

  const tabId = await getActiveTabId();

  switch (message.type) {
    case "ac/popup/get-status":
      return sendMessageToTab<PageStatus>(tabId, { type: "ac/content/get-status" });
    case "ac/popup/open-day-view":
      return sendMessageToTab<void>(tabId, { type: "ac/content/open-day-view" });
    case "ac/popup/post-availability":
      return sendMessageToTab<AvailabilityPostResult>(tabId, {
        type: "ac/content/post-availability",
        payload: message.payload
      });
    default:
      return {
        ok: false,
        error: "Unsupported popup action."
      };
  }
}

async function syncSidePanelForTab(tabId: number, url: string): Promise<void> {
  if (!("sidePanel" in chrome)) {
    return;
  }

  if (currentSurface !== "sidepanel") {
    return;
  }

  await chrome.sidePanel.setOptions({
    tabId,
    path: SIDE_PANEL_PATH,
    enabled: isSupportedHost(url)
  });
}

function isSupportedHost(url: string): boolean {
  if (!url) {
    return false;
  }

  return (
    /^https:\/\/[^/]+\.alayacare\.(ca|com|cloud)\//i.test(url) ||
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(url)
  );
}
