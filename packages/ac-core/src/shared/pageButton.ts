/**
 * Whether the content script adds the "AC Tools" button next to AlayaCare's
 * global search. Stored in `chrome.storage.local` so open tabs follow a change
 * from Settings without reloading. On unless explicitly turned off.
 */
export const PAGE_BUTTON_STORAGE_KEY = "ac-tools-page-button";

export function isPageButtonEnabled(stored: unknown): boolean {
  return stored !== false;
}
