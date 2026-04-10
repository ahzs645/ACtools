const STYLE_ELEMENT_ID = "ac-tools-button-style";

const BUTTON_STYLES = `
  .ac-tools-button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    margin-left: 8px;
    padding: 0 12px;
    border: 1px solid transparent;
    border-radius: 4px;
    background-color: #0f6cbd;
    color: #ffffff;
    font-family: "Segoe UI Variable", "Segoe UI", -apple-system, BlinkMacSystemFont,
      "Helvetica Neue", Arial, sans-serif;
    font-size: 14px;
    font-weight: 600;
    line-height: 20px;
    cursor: pointer;
    box-shadow: 0 0 2px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.14);
    transition: background-color 100ms cubic-bezier(0.33, 0, 0.67, 1);
  }

  .ac-tools-button:hover {
    background-color: #115ea3;
  }

  .ac-tools-button:active {
    background-color: #0c3b5e;
  }

  .ac-tools-button:focus-visible {
    outline: 2px solid #0f6cbd;
    outline-offset: 2px;
  }

  .ac-tools-button__icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
  }

  .ac-tools-button__icon svg {
    width: 100%;
    height: 100%;
    fill: currentColor;
  }
`;

export class PageActionButton {
  private readonly observer: MutationObserver;
  private button: HTMLButtonElement | null = null;

  constructor(private readonly onClick: () => void) {
    this.observer = new MutationObserver(() => this.attach());
  }

  start(): void {
    this.ensureStyles();
    this.attach();
    this.observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  private ensureStyles(): void {
    if (document.getElementById(STYLE_ELEMENT_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = STYLE_ELEMENT_ID;
    style.textContent = BUTTON_STYLES;
    document.head.appendChild(style);
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
    button.className = "ac-tools-button";
    button.dataset.acToolsButton = "true";
    button.setAttribute("aria-label", "Open AC Tools");
    button.innerHTML = `
      <span class="ac-tools-button__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <rect x="4" y="4" width="6" height="6" rx="1.2" />
          <rect x="14" y="4" width="6" height="6" rx="1.2" />
          <rect x="4" y="14" width="6" height="6" rx="1.2" />
          <rect x="14" y="14" width="6" height="6" rx="1.2" />
        </svg>
      </span>
      <span>AC Tools</span>
    `;
    button.addEventListener("click", this.onClick);

    search.insertAdjacentElement("afterend", button);
    this.button = button;
  }
}
