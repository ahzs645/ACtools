import { setDetailSubtitle } from "./detailHeader";

/**
 * Menu-plus-pages navigation inside one tool panel.
 *
 * Pages are `[data-<name>-view="<view>"]` elements and links to them are
 * `[data-<name>-nav="<view>"]` buttons. The `menu` view is the panel's landing
 * page; the detail header's back button returns to it before leaving the tool.
 */
export interface SubViews<View extends string> {
  show(view: View | "menu"): void;
  /** Returns to the menu. False when already there, so the caller can leave the tool. */
  back(): boolean;
  readonly current: View | "menu";
}

export function createSubViews<View extends string>(options: {
  name: string;
  menuSubtitle: string;
  labels: Record<View, string>;
  onShow?: (view: View | "menu") => void;
}): SubViews<View> {
  const views = new Map<string, HTMLElement>();
  for (const element of document.querySelectorAll<HTMLElement>(`[data-${options.name}-view]`)) {
    views.set(element.getAttribute(`data-${options.name}-view`) ?? "", element);
  }

  let current: View | "menu" = "menu";

  const show = (view: View | "menu"): void => {
    current = views.has(view) ? view : "menu";
    views.forEach((element, key) => {
      element.hidden = key !== current;
    });
    setDetailSubtitle(current === "menu" ? options.menuSubtitle : options.labels[current as View]);
    options.onShow?.(current);
  };

  for (const button of document.querySelectorAll<HTMLButtonElement>(`[data-${options.name}-nav]`)) {
    button.addEventListener("click", () => {
      show(button.getAttribute(`data-${options.name}-nav`) as View);
      button.closest<HTMLElement>(".detail-body")?.scrollTo({ top: 0 });
    });
  }

  return {
    show,
    back() {
      if (current === "menu") {
        return false;
      }
      show("menu");
      return true;
    },
    get current() {
      return current;
    }
  };
}
