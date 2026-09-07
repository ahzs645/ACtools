import type { CommandResult } from "@ac-core/shared/messages";
import { isContentMessage, isRuntimeMessage } from "@ac-core/shared/messages";
import { formatError } from "@ac-core/shared/errors";
import { AlayaCareClient } from "@ac-core/session/AlayaCareClient";
import { dispatchSessionMessage } from "@ac-core/session/dispatch";
import { DayViewOverlay } from "./features/dayview";
import { PageActionButton } from "./features/PageActionButton";

// The content script's session is the page it runs on: same-origin fetches
// carry the tenant cookies, and hash routes are read live.
const client = new AlayaCareClient({
  origin: window.location.origin,
  getHref: () => window.location.href,
  fetch: (input, init) => fetch(input, init)
});
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

  void dispatchSessionMessage(client, message, { openDayView: () => overlay.open() })
    .then(sendResponse)
    .catch((error: unknown) => {
      sendResponse({
        ok: false,
        error: formatError(error)
      } satisfies CommandResult<never>);
    });

  return true;
});
