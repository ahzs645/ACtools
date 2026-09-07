import { isSupportedAlayaCareUrl } from "@ac-core/alayaCareUrls";

export { isSupportedAlayaCareUrl, normalizeSupportedOrigin } from "@ac-core/alayaCareUrls";

export async function getSupportedTabOrigin(tabId: number): Promise<string> {
  const tab = await chrome.tabs.get(tabId);
  const url = tab.url ?? "";
  if (!isSupportedAlayaCareUrl(url)) {
    throw new Error("The active tab is not a supported AlayaCare tenant.");
  }
  return new URL(url).origin;
}
