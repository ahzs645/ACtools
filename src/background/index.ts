import { formatError } from "../shared/errors";
import { getActiveTabId, sendMessageToTab } from "../shared/chrome";
import type {
  AvailabilityPostResult,
  CommandResult,
  PageStatus,
  RuntimeMessage
} from "../shared/messages";
import { isPopupMessage, isRuntimeMessage } from "../shared/messages";

const SIDE_PANEL_PATH = "sidepanel.html";

void initializeSidePanel();

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
  if (!("sidePanel" in chrome) || (!changeInfo.url && !tab.url)) {
    return;
  }

  void syncSidePanelForTab(tabId, changeInfo.url ?? tab.url ?? "");
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  if (!("sidePanel" in chrome)) {
    return;
  }

  void chrome.tabs
    .get(tabId)
    .then((tab) => syncSidePanelForTab(tabId, tab.url ?? ""))
    .catch(() => undefined);
});

async function handlePopupMessage(
  message: Extract<RuntimeMessage, { type: `ac/popup/${string}` }>
): Promise<CommandResult<PageStatus | AvailabilityPostResult | void>> {
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

async function initializeSidePanel(): Promise<void> {
  if (!("sidePanel" in chrome)) {
    return;
  }

  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

    const tabs = await chrome.tabs.query({});
    await Promise.all(
      tabs
        .filter((tab): tab is chrome.tabs.Tab & { id: number } => typeof tab.id === "number")
        .map((tab) => syncSidePanelForTab(tab.id, tab.url ?? ""))
    );
  } catch (error) {
    console.warn("Unable to initialize side panel behavior.", error);
  }
}

async function syncSidePanelForTab(tabId: number, url: string): Promise<void> {
  if (!("sidePanel" in chrome)) {
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
