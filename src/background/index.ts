import { getActiveTabId, sendMessageToTab } from "../shared/chrome";
import { formatError } from "@ac-core/shared/errors";
import type { CommandResult, ContentCommandData, RuntimeMessage, Surface } from "@ac-core/shared/messages";
import {
  DEFAULT_SURFACE,
  SURFACE_STORAGE_KEY,
  isPopupMessage,
  isRuntimeMessage
} from "@ac-core/shared/messages";
import { createPopupRouter } from "@ac-core/router";
import { getSupportedTabOrigin, isSupportedAlayaCareUrl } from "./alayaCareUrls";
import { chromePlatform } from "./platform";

const SIDE_PANEL_PATH = "sidepanel.html";
const POPUP_PATH = "sidepanel.html?surface=popup";

/**
 * Everything except surface management is shared with the desktop app. Here
 * "the current tenant" is the active tab, and session commands run in that
 * tab's content script.
 */
const router = createPopupRouter({
  platform: chromePlatform,
  getActiveOrigin: async () => getSupportedTabOrigin(await getActiveTabId()),
  sendSessionMessage: async (message) => sendMessageToTab(await getActiveTabId(), message)
});

let currentSurface: Surface = DEFAULT_SURFACE;

void initialize();

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isRuntimeMessage(message) || !isPopupMessage(message)) {
    return false;
  }
  void handlePopupMessage(message)
    .then(sendResponse)
    .catch((error: unknown) => {
      sendResponse({ ok: false, error: formatError(error) } satisfies CommandResult<never>);
    });
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (currentSurface !== "sidepanel" || !("sidePanel" in chrome)) {
    return;
  }
  if (changeInfo.url || tab.url) {
    void syncSidePanelForTab(tabId, changeInfo.url ?? tab.url ?? "");
  }
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

async function handlePopupMessage(
  message: Extract<RuntimeMessage, { type: `ac/popup/${string}` }>
): Promise<CommandResult<ContentCommandData>> {
  if (message.type === "ac/popup/set-surface") {
    await chrome.storage.local.set({ [SURFACE_STORAGE_KEY]: message.payload });
    await applySurface(message.payload);
    return { ok: true };
  }
  return router.handle(message);
}

async function loadStoredSurface(): Promise<Surface> {
  try {
    const stored = await chrome.storage.local.get(SURFACE_STORAGE_KEY);
    return stored[SURFACE_STORAGE_KEY] === "popup" ? "popup" : DEFAULT_SURFACE;
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
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: surface === "sidepanel" });
  } catch (error) {
    console.warn("Unable to set side panel behavior.", error);
  }
  const tabs = (await chrome.tabs.query({})).filter(
    (tab): tab is chrome.tabs.Tab & { id: number } => typeof tab.id === "number"
  );
  if (surface === "popup") {
    await Promise.all(
      tabs.map((tab) =>
        chrome.sidePanel.setOptions({ tabId: tab.id, enabled: false }).catch(() => undefined)
      )
    );
  } else {
    await Promise.all(tabs.map((tab) => syncSidePanelForTab(tab.id, tab.url ?? "")));
  }
}

async function syncSidePanelForTab(tabId: number, url: string): Promise<void> {
  if (!("sidePanel" in chrome) || currentSurface !== "sidepanel") {
    return;
  }
  await chrome.sidePanel.setOptions({
    tabId,
    path: SIDE_PANEL_PATH,
    enabled: isSupportedAlayaCareUrl(url)
  });
}
