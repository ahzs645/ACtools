/**
 * Explanatory detail lives behind a small info button instead of on the page:
 *
 *   <button type="button" class="tip" data-tip="Longer explanation…" aria-label="About exports"></button>
 *
 * One floating bubble serves every `[data-tip]` element. It opens on hover,
 * keyboard focus, or tap, stays inside the viewport (side panels are narrow),
 * and is announced through `aria-describedby`. Escape or a tap elsewhere closes it.
 */
export function installTooltips(root: Document = document): void {
  const bubble = root.createElement("div");
  bubble.id = "ac-tooltip";
  bubble.className = "tooltip";
  bubble.setAttribute("role", "tooltip");
  bubble.hidden = true;
  root.body.append(bubble);

  let anchor: HTMLElement | null = null;
  let pinned = false;

  const place = (target: HTMLElement): void => {
    const margin = 8;
    const rect = target.getBoundingClientRect();
    const width = Math.min(260, root.documentElement.clientWidth - margin * 2);
    bubble.style.maxWidth = `${width}px`;
    const box = bubble.getBoundingClientRect();
    const left = Math.min(
      Math.max(margin, rect.left + rect.width / 2 - box.width / 2),
      root.documentElement.clientWidth - box.width - margin
    );
    const below = rect.bottom + 6;
    const top = below + box.height > root.documentElement.clientHeight - margin
      ? Math.max(margin, rect.top - box.height - 6)
      : below;
    bubble.style.left = `${left}px`;
    bubble.style.top = `${top}px`;
  };

  const show = (target: HTMLElement): void => {
    const text = target.dataset.tip;
    if (!text) {
      return;
    }
    anchor?.removeAttribute("aria-describedby");
    anchor = target;
    bubble.textContent = text;
    bubble.hidden = false;
    target.setAttribute("aria-describedby", bubble.id);
    place(target);
  };

  const hide = (): void => {
    anchor?.removeAttribute("aria-describedby");
    anchor = null;
    pinned = false;
    bubble.hidden = true;
  };

  const tipFrom = (node: EventTarget | null): HTMLElement | null =>
    node instanceof Element ? node.closest<HTMLElement>("[data-tip]") : null;

  root.addEventListener("mouseover", (event) => {
    const target = tipFrom(event.target);
    if (target && target !== anchor) {
      show(target);
    }
  });
  root.addEventListener("mouseout", (event) => {
    const target = tipFrom(event.target);
    if (target && target === anchor && !pinned && !target.contains(event.relatedTarget as Node | null)) {
      hide();
    }
  });
  root.addEventListener("focusin", (event) => {
    const target = tipFrom(event.target);
    if (target) {
      show(target);
    }
  });
  root.addEventListener("focusout", (event) => {
    if (tipFrom(event.target) === anchor && !pinned) {
      hide();
    }
  });
  // Touch has no hover: a tap pins the bubble open until the next tap.
  root.addEventListener("click", (event) => {
    const target = tipFrom(event.target);
    if (target?.classList.contains("tip")) {
      event.preventDefault();
      if (pinned && anchor === target) {
        hide();
      } else {
        show(target);
        pinned = true;
      }
      return;
    }
    if (pinned) {
      hide();
    }
  });
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && anchor) {
      hide();
    }
  });
  root.addEventListener("scroll", () => anchor && hide(), true);
}
