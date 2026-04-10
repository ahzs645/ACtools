import { formatError } from "../../../shared/errors";
import { formatVisitDateTime } from "../../utils/time";
import type { AlayaCareClient, VisitRecord } from "../../services/AlayaCareClient";

const DEFAULT_HIDE_DELAY_MS = 150;

export class VisitTooltip {
  private hideTimer: number | null = null;
  private readonly cache = new Map<string, VisitRecord>();

  constructor(
    private readonly element: HTMLDivElement,
    private readonly client: AlayaCareClient,
    private readonly hideDelayMs: number = DEFAULT_HIDE_DELAY_MS
  ) {
    this.element.addEventListener("mouseenter", () => this.cancelHide());
    this.element.addEventListener("mouseleave", () => this.scheduleHide());
  }

  attachToVisitIcon(icon: HTMLElement, visitId: string): void {
    icon.addEventListener("mouseenter", (event) => {
      this.cancelHide();
      void this.show(visitId, event);
    });
    icon.addEventListener("mousemove", (event) => {
      this.position(event);
    });
    icon.addEventListener("mouseleave", () => {
      this.scheduleHide();
    });
  }

  cancelHide(): void {
    if (this.hideTimer !== null) {
      window.clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }

  scheduleHide(): void {
    this.cancelHide();
    this.hideTimer = window.setTimeout(() => {
      this.hideTimer = null;
      this.element.hidden = true;
    }, this.hideDelayMs);
  }

  private async show(visitId: string, event: MouseEvent): Promise<void> {
    this.position(event);
    this.element.hidden = false;
    this.element.innerHTML = `<div class="tooltip-row">Loading visit ${visitId}\u2026</div>`;

    try {
      const data = await this.fetchDetails(visitId);
      this.element.innerHTML = "";
      this.element.appendChild(
        tooltipRow(
          "Client",
          buildVisitAnchor(
            data.client?.full_name ?? "Unknown client",
            visitId,
            data.status ?? ""
          )
        )
      );
      this.element.appendChild(
        tooltipRow("Start", document.createTextNode(formatVisitDateTime(data.start_at ?? "")))
      );
      this.element.appendChild(
        tooltipRow("Status", document.createTextNode(data.status ?? ""))
      );
      this.element.appendChild(
        tooltipRow("Service", document.createTextNode(data.service?.name ?? ""))
      );
      this.element.appendChild(
        tooltipRow("Code", document.createTextNode(data.service?.service_code_name ?? ""))
      );
    } catch (error) {
      this.element.innerHTML = `<div class="tooltip-row">${formatError(error)}</div>`;
    }
  }

  private position(event: MouseEvent): void {
    const pad = 12;
    const width = this.element.offsetWidth || 320;
    const height = this.element.offsetHeight || 120;
    let left = event.clientX + pad;
    let top = event.clientY + pad;

    if (left + width > window.innerWidth - 12) {
      left = Math.max(12, event.clientX - width - pad);
    }

    if (top + height > window.innerHeight - 12) {
      top = Math.max(12, event.clientY - height - pad);
    }

    this.element.style.left = `${left}px`;
    this.element.style.top = `${top}px`;
  }

  private async fetchDetails(visitId: string): Promise<VisitRecord> {
    const cached = this.cache.get(visitId);
    if (cached) {
      return cached;
    }

    const record = await this.client.getVisitDetails(visitId);
    this.cache.set(visitId, record);
    return record;
  }
}

function tooltipRow(label: string, value: Node): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "tooltip-row";

  const labelElement = document.createElement("span");
  labelElement.className = "tooltip-label";
  labelElement.textContent = `${label}: `;
  row.append(labelElement, value);
  return row;
}

function buildVisitAnchor(fullName: string, visitId: string, status: string): HTMLAnchorElement {
  const link = document.createElement("a");
  link.href = `/#/scheduling/shift/edit/id/${encodeURIComponent(
    visitId
  )}/form_type/client?new_modal=true&force_dialog=true`;
  link.target = "_blank";
  link.rel = "noreferrer";
  const normalized = status.trim().toLowerCase().replace(/[\s_]+/g, "-");
  link.className = normalized
    ? `tooltip-link tooltip-link--${normalized}`
    : "tooltip-link";
  link.textContent = fullName;
  return link;
}
