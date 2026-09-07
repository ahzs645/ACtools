import { sendRuntimeMessage } from "../../../shared/chrome";
import { formatError } from "@ac-core/shared/errors";
import type {
  EmployeeDetail,
  EmployeeTaskClonePreview,
  EmployeeTaskCloneRequest,
  EmployeeTaskCloneResult
} from "@ac-core/shared/employees";
import type { EnvironmentConfig } from "@ac-core/shared/environments";
import { showToast } from "../../ui/toasts";

interface TaskCloneElements {
  template: HTMLInputElement;
  group: HTMLSelectElement;
  name: HTMLInputElement;
  ticket: HTMLInputElement;
  preview: HTMLButtonElement;
  create: HTMLButtonElement;
  result: HTMLElement;
}

export interface TaskCloneControllerOptions {
  getEmployee(): EmployeeDetail | null;
  getEmployeeName(employee: EmployeeDetail): string;
  getCurrentOrigin(): string;
  getEnvironment(origin: string): EnvironmentConfig | undefined;
}

/**
 * "Onboarding tasks" block of Employee Manager.
 *
 * Ported from Alayaduck's new-employee task clone, with the guards it lacked:
 * the group must be one of the employee's own groups, a preview must succeed
 * before the create button enables, any edit invalidates that preview, and the
 * create needs a ticket plus an explicit confirmation.
 */
export class EmployeeTaskCloneController {
  private preview: EmployeeTaskClonePreview | null = null;
  private previewKey = "";

  constructor(private readonly options: TaskCloneControllerOptions) {}

  init(): void {
    const elements = this.elements();
    elements.preview.addEventListener("click", () => void this.runPreview());
    elements.create.addEventListener("click", () => void this.runCreate());
    for (const input of [elements.template, elements.group, elements.name, elements.ticket]) {
      input.addEventListener("input", () => this.invalidatePreview());
      input.addEventListener("change", () => this.invalidatePreview());
    }
    this.selectedEmployeeChanged();
  }

  /** Re-seeds the form from the selected employee and the tenant's settings. */
  selectedEmployeeChanged(): void {
    const elements = this.elements();
    const employee = this.options.getEmployee();
    this.preview = null;
    this.previewKey = "";
    elements.result.hidden = true;
    elements.result.textContent = "";
    elements.create.disabled = true;

    if (!employee) {
      elements.group.replaceChildren();
      elements.name.value = "";
      elements.preview.disabled = true;
      return;
    }

    const environment = this.options.getEnvironment(this.options.getCurrentOrigin());
    if (!elements.template.value && environment?.taskTemplateId) {
      elements.template.value = String(environment.taskTemplateId);
    }

    const groups = (employee.groups ?? []).filter((group) => Number.isInteger(group.id));
    let pattern: RegExp | null = null;
    if (environment?.taskGroupPattern) {
      try {
        pattern = new RegExp(environment.taskGroupPattern);
      } catch {
        pattern = null;
      }
    }
    const preferred = pattern ? groups.find((group) => pattern!.test(group.name ?? "")) : undefined;
    elements.group.replaceChildren(
      ...groups.map((group) => {
        const option = document.createElement("option");
        option.value = String(group.id);
        option.textContent = group.name?.trim() || `#${group.id}`;
        return option;
      })
    );
    if (preferred) {
      elements.group.value = String(preferred.id);
    }

    const lastName = employee.demographics?.last_name ?? employee.last_name ?? "";
    const firstName = employee.demographics?.first_name ?? employee.first_name ?? "";
    elements.name.value = `New Employee Tasks - ${lastName}, ${firstName}`.replace(/ - ,\s*$/, "");
    elements.preview.disabled = groups.length === 0;
    if (groups.length === 0) {
      this.showResult("This employee has no groups, so there is nothing that can own an onboarding task.");
    }
  }

  private readRequest(employee: EmployeeDetail): EmployeeTaskCloneRequest {
    const elements = this.elements();
    return {
      templateTaskId: Number(elements.template.value.trim()),
      employeeId: employee.id,
      groupId: Number(elements.group.value),
      name: elements.name.value.trim()
    };
  }

  private requestKey(request: EmployeeTaskCloneRequest): string {
    return JSON.stringify(request);
  }

  private invalidatePreview(): void {
    if (!this.preview) {
      return;
    }
    this.preview = null;
    this.previewKey = "";
    this.elements().create.disabled = true;
    this.showResult("Inputs changed since the preview. Preview again before creating the task.");
  }

  private async runPreview(): Promise<void> {
    const employee = this.options.getEmployee();
    if (!employee) {
      this.showResult("Select an employee first.");
      return;
    }
    const elements = this.elements();
    const request = this.readRequest(employee);
    elements.preview.disabled = true;
    this.showResult("Resolving the template task, employee, and group…");
    try {
      const response = await sendRuntimeMessage<EmployeeTaskClonePreview>({
        type: "ac/popup/preview-employee-task-clone",
        payload: request
      });
      if (!response.ok || !response.data) {
        throw new Error(response.error ?? "Preview failed.");
      }
      this.preview = response.data;
      this.previewKey = this.requestKey(request);
      elements.create.disabled = false;
      const { template, group, proposedName } = response.data;
      this.showResult(
        `Ready: clone task #${template.id} "${template.name}"${template.status ? ` (${template.status})` : ""} as "${proposedName}", owned by ${group.name} (#${group.id}) for ${response.data.employee.name} (#${response.data.employee.id}). Nothing has been written yet.`
      );
    } catch (error) {
      this.preview = null;
      this.previewKey = "";
      elements.create.disabled = true;
      this.showResult(formatError(error));
      showToast("error", "Onboarding task preview failed", formatError(error));
    } finally {
      elements.preview.disabled = false;
    }
  }

  private async runCreate(): Promise<void> {
    const employee = this.options.getEmployee();
    const elements = this.elements();
    if (!employee || !this.preview) {
      this.showResult("Preview the task before creating it.");
      return;
    }
    const request = this.readRequest(employee);
    if (this.requestKey(request) !== this.previewKey) {
      this.invalidatePreview();
      return;
    }
    const ticket = elements.ticket.value.trim();
    if (ticket.length < 5) {
      this.showResult("Enter a ticket number or change reference with at least 5 characters.");
      return;
    }
    const confirmed = window.confirm(
      `Create "${this.preview.proposedName}" from task #${this.preview.template.id} for ${this.options.getEmployeeName(employee)}, owned by ${this.preview.group.name}, on ${this.options.getCurrentOrigin()}?`
    );
    if (!confirmed) {
      return;
    }
    elements.create.disabled = true;
    elements.preview.disabled = true;
    this.showResult("Creating the onboarding task…");
    try {
      const response = await sendRuntimeMessage<EmployeeTaskCloneResult>({
        type: "ac/popup/clone-employee-task",
        payload: { ...request, ticket, confirmed: true }
      });
      if (!response.ok || !response.data) {
        throw new Error(response.error ?? "Task creation failed.");
      }
      const result = response.data;
      this.preview = null;
      this.previewKey = "";
      this.showResult(
        `Created task #${result.taskId} "${result.name}" (clone HTTP ${result.cloneStatus}, assignment HTTP ${result.assignStatus}). Ticket ${ticket}.`
      );
      showToast("success", "Onboarding task created", `Task #${result.taskId} is assigned.`);
    } catch (error) {
      this.showResult(formatError(error));
      showToast("error", "Onboarding task not created", formatError(error));
    } finally {
      elements.preview.disabled = false;
    }
  }

  private showResult(message: string): void {
    const elements = this.elements();
    elements.result.textContent = message;
    elements.result.hidden = false;
  }

  private elements(): TaskCloneElements {
    return {
      template: required("#employee-task-template"),
      group: required("#employee-task-group"),
      name: required("#employee-task-name"),
      ticket: required("#employee-task-ticket"),
      preview: required("#employee-task-preview"),
      create: required("#employee-task-create"),
      result: required("#employee-task-result")
    };
  }
}

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing onboarding task element: ${selector}`);
  }
  return element;
}
