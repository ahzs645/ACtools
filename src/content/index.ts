import type { CommandResult } from "@ac-core/shared/messages";
import { isContentMessage, isRuntimeMessage } from "@ac-core/shared/messages";
import { formatError } from "@ac-core/shared/errors";
import { AlayaCareClient } from "@ac-core/session/AlayaCareClient";
import { dispatchSessionMessage } from "@ac-core/session/dispatch";
import { requestNativeFormDraft } from "./form-deployment-transport";
import { chromeStore } from "../background/platform";
import { DayViewOverlay } from "./features/dayview";
import { PageActionButton } from "./features/PageActionButton";
import { installCatalogPageBridge, CATALOG_READ } from '@ac-core/shared/tenant-catalog.mjs';

installCatalogPageBridge(window, message => chrome.runtime.sendMessage(message));

// The content script's session is the page it runs on: same-origin fetches
// carry the tenant cookies, and hash routes are read live.
const client = new AlayaCareClient({
  origin: window.location.origin,
  getHref: () => window.location.href,
  fetch: (input, init) => fetch(input, init),
  formDraftRequest: requestNativeFormDraft,
  formDraftStore: chromeStore(chrome.storage.local)
});
const overlay = new DayViewOverlay(client);
const pageActionButton = new PageActionButton(() => {
  void overlay.open().catch(console.error);
});

pageActionButton.start();

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (message && typeof message === 'object' && 'type' in message && message.type === CATALOG_READ) {
    void client.refreshTenantCatalog().then(data => sendResponse({ ok: true, data }), error => sendResponse({ ok: false, error: formatError(error) }));
    return true;
  }
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
