import { PAGE_BUTTON_STORAGE_KEY, isPageButtonEnabled } from "@ac-core/shared/pageButton";
import { formatError } from "@ac-core/shared/errors";
import { isDesktopHost, popupStorage } from "../platform";
import { showToast } from "../ui/toasts";

/** Settings → On AlayaCare pages: the content script reacts to the stored value live. */
export async function initPageButtonSetting(): Promise<void> {
  const toggle = document.querySelector<HTMLInputElement>("#page-button-toggle");
  if (!toggle || isDesktopHost()) {
    return;
  }

  toggle.checked = isPageButtonEnabled(await popupStorage.local.get(PAGE_BUTTON_STORAGE_KEY));
  toggle.addEventListener("change", async () => {
    const enabled = toggle.checked;
    try {
      await popupStorage.local.set(PAGE_BUTTON_STORAGE_KEY, enabled);
      showToast(
        "success",
        enabled ? "Button shown" : "Button hidden",
        enabled ? "AlayaCare pages show the AC Tools button again." : "AlayaCare pages no longer show the AC Tools button."
      );
    } catch (error) {
      toggle.checked = !enabled;
      showToast("error", "Could not save", formatError(error));
    }
  });
}
