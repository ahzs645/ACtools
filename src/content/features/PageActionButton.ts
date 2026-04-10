export class PageActionButton {
  private readonly observer: MutationObserver;
  private button: HTMLButtonElement | null = null;

  constructor(private readonly onClick: () => void) {
    this.observer = new MutationObserver(() => this.attach());
  }

  start(): void {
    this.attach();
    this.observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  private attach(): void {
    if (this.button?.isConnected) {
      return;
    }

    const search = document.querySelector(".global-search");
    if (!(search instanceof HTMLElement) || !search.parentElement) {
      return;
    }

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "AC Tools";
    button.dataset.acToolsButton = "true";
    button.style.marginLeft = "8px";
    button.style.background = "#174a8b";
    button.style.color = "#ffffff";
    button.style.border = "none";
    button.style.borderRadius = "6px";
    button.style.padding = "6px 10px";
    button.style.cursor = "pointer";
    button.style.fontSize = "12px";
    button.style.fontWeight = "600";
    button.style.lineHeight = "1.2";
    button.addEventListener("click", this.onClick);

    search.insertAdjacentElement("afterend", button);
    this.button = button;
  }
}

