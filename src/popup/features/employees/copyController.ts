import { sendRuntimeMessage } from "../../../shared/chrome";
import type {
  EmployeeConfiguredTenant,
  EmployeeCopyMappingSelection,
  EmployeeCopyPlanResult,
  EmployeeCopyTargetPlan,
  EmployeeCopyTargetResult,
  EmployeeDetail
} from "../../../shared/employees";
import { formatError } from "../../../shared/errors";
import { showToast } from "../../ui/toasts";

interface CopyControllerOptions {
  getEmployee: () => EmployeeDetail | null;
  getEmployeeName: (employee: EmployeeDetail) => string;
  getCurrentOrigin: () => string;
  getSupportUrl: (origin: string) => string;
  getEnvironmentName: (origin: string) => string;
}

export class EmployeeCopyController {
  private plans: EmployeeCopyTargetPlan[] = [];
  private sourceOrigin = "";

  constructor(private readonly options: CopyControllerOptions) {}

  init(): void {
    this.previewButton().addEventListener("click", () => void this.preview());
    this.executeButton().addEventListener("click", () => void this.execute());
    this.ticketInput().addEventListener("input", () => this.updateExecuteAvailability());
  }

  renderTargets(tenants: EmployeeConfiguredTenant[], currentOrigin: string): void {
    const container = this.targetsContainer();
    container.replaceChildren();
    const targets = tenants.filter((tenant) => tenant.origin !== currentOrigin);
    if (targets.length === 0) {
      container.append(empty("No credentialed target tenants. Configure another environment first."));
    } else {
      for (const tenant of targets) {
        const label = document.createElement("label");
        label.className = "employee-copy-target";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = tenant.origin;
        checkbox.addEventListener("change", () => this.resetPreview());
        const text = document.createElement("span");
        text.textContent = `${this.options.getEnvironmentName(tenant.origin)} · ${tenant.storage === "local" ? "remembered" : "this session"}`;
        label.append(checkbox, text);
        container.append(label);
      }
    }
    this.resetPreview();
  }

  selectedEmployeeChanged(): void {
    this.resetPreview();
  }

  private async preview(): Promise<void> {
    const employee = this.options.getEmployee();
    const targetOrigins = this.selectedTargets();
    if (!employee || targetOrigins.length === 0) {
      showToast("warning", "Copy preview", "Select an employee and at least one target tenant.");
      return;
    }
    this.sourceOrigin = this.options.getCurrentOrigin();
    this.previewButton().disabled = true;
    this.planContainer().replaceChildren(empty("Loading target catalogs and checking for duplicates…"));
    const response = await sendRuntimeMessage<EmployeeCopyPlanResult>({
      type: "ac/popup/plan-employee-copy",
      payload: { employee, targetOrigins }
    });
    this.previewButton().disabled = false;
    if (!response.ok || !response.data) {
      this.planContainer().replaceChildren(empty(response.error ?? "Unable to prepare copy preview."));
      showToast("error", "Copy preview failed", response.error ?? "Unknown error");
      return;
    }
    this.plans = response.data.plans;
    this.renderPlans();
  }

  private renderPlans(): void {
    const container = this.planContainer();
    container.replaceChildren(...this.plans.map((plan) => this.planCard(plan)));
    this.updateExecuteAvailability();
  }

  private planCard(plan: EmployeeCopyTargetPlan): HTMLElement {
    const card = document.createElement("article");
    card.className = "copy-plan-card";
    card.dataset.origin = plan.origin;
    const heading = document.createElement("h5");
    heading.textContent = this.options.getEnvironmentName(plan.origin);
    card.append(heading);
    if (plan.error) {
      card.append(alert(plan.error, "error"));
      return card;
    }
    if (plan.duplicateEmployee) {
      card.append(alert(
        `Duplicate found: #${plan.duplicateEmployee.id} ${plan.duplicateEmployee.name}. Copy is blocked.`,
        "error"
      ));
    }
    if (plan.mappings.length === 0) {
      card.append(alert("No access mappings are required for this employee.", "info"));
    }
    for (const mapping of plan.mappings) {
      const row = document.createElement("label");
      row.className = "copy-mapping-row";
      const source = document.createElement("span");
      source.textContent = `${labelForKind(mapping.kind)}: ${mapping.sourceName}`;
      const select = document.createElement("select");
      select.className = "input";
      select.dataset.origin = plan.origin;
      select.dataset.kind = mapping.kind;
      select.dataset.sourceId = String(mapping.sourceId);
      const missing = document.createElement("option");
      missing.value = "";
      missing.textContent = "Choose target…";
      select.append(missing);
      for (const option of mapping.options) {
        const element = document.createElement("option");
        element.value = String(option.id);
        element.textContent = option.name;
        element.selected = option.id === mapping.targetId;
        select.append(element);
      }
      select.addEventListener("change", () => this.updateExecuteAvailability());
      row.append(source, select);
      card.append(row);
      if (mapping.targetId === null && mapping.kind === "groups") {
        const support = document.createElement("a");
        support.href = this.options.getSupportUrl(plan.origin);
        support.target = "_blank";
        support.rel = "noreferrer";
        support.className = "support-link";
        support.textContent = "Open ServiceNow for the missing group";
        card.append(support);
      }
    }
    return card;
  }

  private async execute(): Promise<void> {
    const employee = this.options.getEmployee();
    const ticket = this.ticketInput().value.trim();
    if (this.options.getCurrentOrigin() !== this.sourceOrigin) {
      this.resetPreview();
      showToast("warning", "Source tenant changed", "Run the copy preview again from the employee's source tenant.");
      return;
    }
    if (!employee || ticket.length < 5 || !this.isPlanComplete()) {
      showToast("warning", "Copy not ready", "Complete the preview, mappings, and ticket first.");
      return;
    }
    if (!window.confirm(`Create copies of ${this.options.getEmployeeName(employee)} in ${this.plans.length} tenant${this.plans.length === 1 ? "" : "s"}?`)) {
      return;
    }
    this.executeButton().disabled = true;
    const progress = this.progressContainer();
    progress.replaceChildren();
    let successCount = 0;
    const targetCount = this.plans.length;
    for (const plan of this.plans) {
      const row = progressRow(plan.origin, this.options.getEnvironmentName(plan.origin));
      progress.append(row.container);
      row.status.textContent = "Pending";
    }
    for (const plan of this.plans) {
      const row = progress.querySelector<HTMLElement>(`[data-progress-origin="${cssEscape(plan.origin)}"]`);
      const status = row?.querySelector<HTMLElement>(".copy-progress__status");
      if (status) status.textContent = "Copying…";
      const response = await sendRuntimeMessage<EmployeeCopyTargetResult>({
        type: "ac/popup/copy-employee-target",
        payload: {
          employee,
          sourceOrigin: this.sourceOrigin,
          targetOrigin: plan.origin,
          ticket,
          mappings: this.readMappings(plan.origin)
        }
      });
      if (response.ok && response.data?.ok) {
        successCount += 1;
        if (row) row.classList.add("copy-progress--success");
        if (status) status.textContent = `Created #${response.data.employeeId}; note HTTP ${response.data.noteStatus}`;
      } else {
        if (row) row.classList.add("copy-progress--error");
        if (status) status.textContent = response.error ?? response.data?.error ?? "Copy failed";
      }
    }
    this.plans = [];
    this.executeButton().disabled = true;
    showToast(
      successCount === targetCount ? "success" : "warning",
      "Copy workflow finished",
      `${successCount} of ${targetCount} target tenants completed. Run a new preview before copying again.`
    );
  }

  private resetPreview(): void {
    this.plans = [];
    this.sourceOrigin = "";
    this.planContainer().replaceChildren();
    this.progressContainer().replaceChildren();
    this.previewButton().disabled = !this.options.getEmployee() || this.selectedTargets().length === 0;
    this.executeButton().disabled = true;
  }

  private updateExecuteAvailability(): void {
    this.executeButton().disabled = !this.isPlanComplete();
  }

  private isPlanComplete(): boolean {
    return this.plans.length > 0
      && this.ticketInput().value.trim().length >= 5
      && this.plans.every((plan) => !plan.error && !plan.duplicateEmployee)
      && this.plans.every((plan) => this.readMappings(plan.origin).length === plan.mappings.length);
  }

  private readMappings(origin: string): EmployeeCopyMappingSelection[] {
    return Array.from(
      this.planContainer().querySelectorAll<HTMLSelectElement>(`select[data-origin="${cssEscape(origin)}"]`)
    ).flatMap((select) => {
      const targetId = Number(select.value);
      const sourceId = Number(select.dataset.sourceId);
      const kind = select.dataset.kind as EmployeeCopyMappingSelection["kind"];
      return targetId > 0 && sourceId > 0 ? [{ kind, sourceId, targetId }] : [];
    });
  }

  private selectedTargets(): string[] {
    return Array.from(
      this.targetsContainer().querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')
    ).map((checkbox) => checkbox.value);
  }

  private targetsContainer(): HTMLElement { return required("#employee-copy-targets"); }
  private planContainer(): HTMLElement { return required("#employee-copy-plan"); }
  private progressContainer(): HTMLElement { return required("#employee-copy-progress"); }
  private previewButton(): HTMLButtonElement { return required("#employee-copy-preview"); }
  private executeButton(): HTMLButtonElement { return required("#employee-copy"); }
  private ticketInput(): HTMLInputElement { return required("#employee-copy-ticket"); }
}

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing copy workflow element: ${selector}`);
  return element;
}

function empty(message: string): HTMLElement {
  const element = document.createElement("p");
  element.className = "employee-list__empty";
  element.textContent = message;
  return element;
}

function alert(message: string, tone: "error" | "info"): HTMLElement {
  const element = document.createElement("p");
  element.className = `copy-plan-alert copy-plan-alert--${tone}`;
  element.textContent = message;
  return element;
}

function labelForKind(kind: EmployeeCopyMappingSelection["kind"]): string {
  return { groups: "Group", roles: "Role", departments: "Department", employment_type: "Employment type" }[kind];
}

function progressRow(origin: string, name: string): { container: HTMLElement; status: HTMLElement } {
  const container = document.createElement("div");
  container.className = "copy-progress";
  container.dataset.progressOrigin = origin;
  const label = document.createElement("strong");
  label.textContent = name;
  const status = document.createElement("span");
  status.className = "copy-progress__status";
  container.append(label, status);
  return { container, status };
}

function cssEscape(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}
