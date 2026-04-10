import type { AlayaCareClient, Department } from "../../services/AlayaCareClient";
import { renderColumns, type ColumnContext } from "./columns";
import { SHADOW_TEMPLATE } from "./shellTemplate";
import { VisitTooltip } from "./VisitTooltip";

export class DayViewOverlay {
  private readonly host: HTMLDivElement;
  private readonly shadowRoot: ShadowRoot;
  private overlay: HTMLDivElement | null = null;
  private columnsContainer: HTMLDivElement | null = null;
  private errorElement: HTMLDivElement | null = null;
  private tooltip: VisitTooltip | null = null;
  private departments: Department[] = [];
  private currentDate = "";
  private initialized = false;

  constructor(private readonly client: AlayaCareClient) {
    this.host = document.createElement("div");
    this.host.id = "ac-tools-overlay-root";
    this.shadowRoot = this.host.attachShadow({ mode: "open" });
    document.body.appendChild(this.host);
  }

  async open(): Promise<void> {
    await this.ensureInitialized();

    if (!this.overlay) {
      throw new Error("Overlay did not initialize.");
    }

    this.overlay.hidden = false;
  }

  close(): void {
    if (this.overlay) {
      this.overlay.hidden = true;
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const context = await this.client.getUserContext();

    if (!context.status.ready) {
      throw new Error(context.status.reason ?? "Page is not ready.");
    }

    this.departments = context.departments;
    this.renderShell();
    this.initialized = true;
  }

  private renderShell(): void {
    this.shadowRoot.innerHTML = SHADOW_TEMPLATE;

    const overlay = this.shadowRoot.querySelector(".overlay");
    const tooltipEl = this.shadowRoot.querySelector(".tooltip");
    const closeButton = this.shadowRoot.querySelector(".close-button");
    const dateInput = this.shadowRoot.querySelector(".date-input");
    const columnsContainer = this.shadowRoot.querySelector(".columns");
    const errorElement = this.shadowRoot.querySelector(".error-text");

    if (
      !(overlay instanceof HTMLDivElement) ||
      !(tooltipEl instanceof HTMLDivElement) ||
      !(columnsContainer instanceof HTMLDivElement)
    ) {
      throw new Error("Failed to create overlay shell.");
    }

    this.overlay = overlay;
    this.columnsContainer = columnsContainer;
    this.errorElement = errorElement instanceof HTMLDivElement ? errorElement : null;
    this.tooltip = new VisitTooltip(tooltipEl, this.client);

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        this.close();
      }
    });

    if (closeButton instanceof HTMLButtonElement) {
      closeButton.addEventListener("click", () => this.close());
    }

    if (dateInput instanceof HTMLInputElement) {
      dateInput.value = new Date().toISOString().slice(0, 10);
      this.currentDate = dateInput.value;
      dateInput.addEventListener("change", () => {
        this.currentDate = dateInput.value;
        this.refreshColumns();
      });
    }

    this.refreshColumns();
  }

  private refreshColumns(): void {
    const context = this.buildColumnContext();
    if (!context) {
      return;
    }

    renderColumns(context);
  }

  private buildColumnContext(): ColumnContext | null {
    if (!this.columnsContainer || !this.tooltip) {
      return null;
    }

    return {
      columnsContainer: this.columnsContainer,
      departments: this.departments,
      client: this.client,
      tooltip: this.tooltip,
      getDate: () => this.currentDate,
      setError: (message: string) => this.setError(message)
    };
  }

  private setError(message: string): void {
    if (!this.errorElement) {
      return;
    }

    this.errorElement.textContent = message;
    this.errorElement.hidden = message.length === 0;
  }
}
