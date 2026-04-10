import { formatError } from "../shared/errors";
import { getActiveTabId, sendMessageToTab } from "../shared/chrome";
import type {
  AvailabilityPostResult,
  CommandResult,
  PageStatus,
  RuntimeMessage
} from "../shared/messages";
import { isPopupMessage, isRuntimeMessage } from "../shared/messages";

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
