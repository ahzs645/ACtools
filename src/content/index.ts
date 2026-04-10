import type { AvailabilityPostResult, CommandResult, PageStatus, RuntimeMessage } from "../shared/messages";
import { isContentMessage, isRuntimeMessage } from "../shared/messages";
import { formatError } from "../shared/errors";
import { DayViewOverlay } from "./features/dayview";
import { PageActionButton } from "./features/PageActionButton";
import { AlayaCareClient } from "./services/AlayaCareClient";

const client = new AlayaCareClient();
const overlay = new DayViewOverlay(client);
const pageActionButton = new PageActionButton(() => {
  void overlay.open().catch(console.error);
});

pageActionButton.start();

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isRuntimeMessage(message)) {
    return false;
  }

  if (!isContentMessage(message)) {
    return false;
  }

  void handleContentMessage(message)
    .then(sendResponse)
    .catch((error: unknown) => {
      sendResponse({
        ok: false,
        error: formatError(error)
      } satisfies CommandResult<never>);
    });

  return true;
});

async function handleContentMessage(
  message: Extract<RuntimeMessage, { type: `ac/content/${string}` }>
): Promise<CommandResult<PageStatus | AvailabilityPostResult | void>> {
  switch (message.type) {
    case "ac/content/get-status":
      return {
        ok: true,
        data: await client.getStatus()
      };
    case "ac/content/open-day-view":
      await overlay.open();
      return { ok: true };
    case "ac/content/post-availability":
      return {
        ok: true,
        data: await client.postAvailability(message.payload)
      };
    default:
      return {
        ok: false,
        error: "Unsupported content action."
      };
  }
}
