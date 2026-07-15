import { sendRuntimeMessage } from "../../../shared/chrome";
import type { EmployeeApiCredentialStatus } from "../../../shared/employees";
import {
  DEFAULT_SUPPORT_URL,
  type EnvironmentConfig,
  type EnvironmentHealth,
  type EnvironmentRegistry
} from "../../../shared/environments";
import { showToast } from "../../ui/toasts";
import { clearEmployeeCaches } from "../employees/cache";

interface EnvironmentElements {
  list: HTMLElement;
  name: HTMLInputElement;
  origin: HTMLInputElement;
  supportUrl: HTMLInputElement;
  save: HTMLButtonElement;
  reset: HTMLButtonElement;
  exportButton: HTMLButtonElement;
  importButton: HTMLButtonElement;
  importInput: HTMLInputElement;
  credentialOrigin: HTMLSelectElement;
  publicKey: HTMLInputElement;
  privateKey: HTMLInputElement;
  remember: HTMLInputElement;
  credentialSave: HTMLButtonElement;
  credentialClear: HTMLButtonElement;
  credentialStatus: HTMLElement;
}

export class EnvironmentManagerController {
  private registry: EnvironmentRegistry = { defaultOrigin: null, environments: [] };

  constructor(private readonly onRegistryChanged: () => void | Promise<void>) {}

  async init(): Promise<void> {
    const elements = this.elements();
    elements.save.addEventListener("click", () => void this.saveEnvironment());
    elements.reset.addEventListener("click", () => this.resetForm());
    elements.exportButton.addEventListener("click", () => this.exportEnvironments());
    elements.importButton.addEventListener("click", () => elements.importInput.click());
    elements.importInput.addEventListener("change", () => void this.importEnvironments());
    elements.credentialOrigin.addEventListener("change", () => void this.refreshCredentialStatus());
    elements.credentialSave.addEventListener("click", () => void this.saveCredentials());
    elements.credentialClear.addEventListener("click", () => void this.clearCredentials());
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const response = await sendRuntimeMessage<EnvironmentRegistry>({
      type: "ac/popup/get-environment-registry"
    });
    if (!response.ok || !response.data) {
      showToast("error", "Environment manager", response.error ?? "Unable to load environments.");
      return;
    }
    this.registry = response.data;
    this.render();
  }

  getSupportUrl(origin: string): string {
    return this.registry.environments.find((environment) => environment.origin === origin)?.supportUrl
      ?? DEFAULT_SUPPORT_URL;
  }

  getEnvironmentName(origin: string): string {
    return this.registry.environments.find((environment) => environment.origin === origin)?.name
      ?? new URL(origin).hostname;
  }

  private render(): void {
    const elements = this.elements();
    elements.list.replaceChildren();
    if (this.registry.environments.length === 0) {
      const empty = document.createElement("p");
      empty.className = "employee-list__empty";
      empty.textContent = "No environments configured yet.";
      elements.list.append(empty);
    } else {
      elements.list.append(...this.registry.environments.map((environment) => this.environmentCard(environment)));
    }
    const selectedOrigin = elements.credentialOrigin.value;
    elements.credentialOrigin.replaceChildren(
      ...this.registry.environments.map((environment) => {
        const option = document.createElement("option");
        option.value = environment.origin;
        option.textContent = `${environment.name} — ${environment.origin}`;
        return option;
      })
    );
    if (this.registry.environments.some((environment) => environment.origin === selectedOrigin)) {
      elements.credentialOrigin.value = selectedOrigin;
    } else if (this.registry.defaultOrigin) {
      elements.credentialOrigin.value = this.registry.defaultOrigin;
    }
    elements.credentialSave.disabled = this.registry.environments.length === 0;
    void this.refreshCredentialStatus();
  }

  private environmentCard(environment: EnvironmentConfig): HTMLElement {
    const card = document.createElement("article");
    card.className = "environment-card";
    const header = document.createElement("div");
    header.className = "environment-card__header";
    const title = document.createElement("div");
    const name = document.createElement("h3");
    name.textContent = environment.name;
    const origin = document.createElement("p");
    origin.textContent = environment.origin;
    title.append(name, origin);
    const badge = document.createElement("span");
    badge.className = "environment-card__badge";
    badge.textContent = environment.origin === this.registry.defaultOrigin ? "Default" : "Tenant";
    header.append(title, badge);

    const health = document.createElement("div");
    health.className = "environment-health";
    health.textContent = "Health not checked.";

    const actions = document.createElement("div");
    actions.className = "environment-card__actions";
    const defaultButton = button("Set default", "button--subtle", () => void this.setDefault(environment.origin));
    defaultButton.disabled = environment.origin === this.registry.defaultOrigin;
    const healthButton = button("Check health", "button--secondary", () => void this.checkHealth(environment, health, healthButton));
    const editButton = button("Edit", "button--subtle", () => this.editEnvironment(environment));
    const deleteButton = button("Delete", "button--danger", () => void this.deleteEnvironment(environment));
    actions.append(defaultButton, healthButton, editButton, deleteButton);
    card.append(header, health, actions);
    return card;
  }

  private async saveEnvironment(): Promise<void> {
    const elements = this.elements();
    const payload = {
      name: elements.name.value,
      origin: elements.origin.value,
      supportUrl: elements.supportUrl.value
    };
    const response = await sendRuntimeMessage<EnvironmentRegistry>({
      type: "ac/popup/save-environment",
      payload
    });
    if (!response.ok || !response.data) {
      showToast("error", "Environment not saved", response.error ?? "Unknown error");
      return;
    }
    this.registry = response.data;
    this.resetForm();
    this.render();
    await this.onRegistryChanged();
    showToast("success", "Environment saved", `${payload.name} is available to AC Tools.`);
  }

  private editEnvironment(environment: EnvironmentConfig): void {
    const elements = this.elements();
    elements.name.value = environment.name;
    elements.origin.value = environment.origin;
    elements.origin.readOnly = true;
    elements.supportUrl.value = environment.supportUrl;
    elements.name.focus();
  }

  private resetForm(): void {
    const elements = this.elements();
    elements.name.value = "";
    elements.origin.value = "";
    elements.origin.readOnly = false;
    elements.supportUrl.value = DEFAULT_SUPPORT_URL;
  }

  private async deleteEnvironment(environment: EnvironmentConfig): Promise<void> {
    if (!window.confirm(`Delete ${environment.name} and its stored API credentials?`)) {
      return;
    }
    const response = await sendRuntimeMessage<EnvironmentRegistry>({
      type: "ac/popup/delete-environment",
      payload: { origin: environment.origin }
    });
    if (!response.ok || !response.data) {
      showToast("error", "Environment not deleted", response.error ?? "Unknown error");
      return;
    }
    await clearEmployeeCaches(environment.origin);
    this.registry = response.data;
    this.render();
    await this.onRegistryChanged();
    showToast("success", "Environment deleted", environment.name);
  }

  private async setDefault(origin: string): Promise<void> {
    const response = await sendRuntimeMessage<EnvironmentRegistry>({
      type: "ac/popup/set-default-environment",
      payload: { origin }
    });
    if (!response.ok || !response.data) {
      showToast("error", "Default not changed", response.error ?? "Unknown error");
      return;
    }
    this.registry = response.data;
    this.render();
  }

  private async checkHealth(
    environment: EnvironmentConfig,
    container: HTMLElement,
    trigger: HTMLButtonElement
  ): Promise<void> {
    trigger.disabled = true;
    container.textContent = "Checking authentication and metadata endpoints…";
    const response = await sendRuntimeMessage<EnvironmentHealth>({
      type: "ac/popup/check-environment-health",
      payload: { origin: environment.origin }
    });
    trigger.disabled = false;
    if (!response.ok || !response.data) {
      container.textContent = response.error ?? "Health check failed.";
      return;
    }
    container.replaceChildren(
      ...response.data.checks.map((check) => {
        const row = document.createElement("span");
        row.className = check.ok ? "health-check health-check--ok" : "health-check health-check--error";
        row.textContent = `${check.ok ? "✓" : "×"} ${check.label}${
          check.ok ? ` (${check.status}${check.count === undefined ? "" : `, ${check.count}`})` : `: ${check.error}`
        }`;
        return row;
      })
    );
  }

  private exportEnvironments(): void {
    const content = `${JSON.stringify({
      format: "ac-tools-environments-v1",
      ...this.registry
    }, null, 2)}\n`;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([content], { type: "application/json" }));
    link.download = `ac-tools-environments-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    showToast("success", "Environments exported", "Credentials were not included.");
  }

  private async importEnvironments(): Promise<void> {
    const input = this.elements().importInput;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    try {
      const parsed = JSON.parse(await file.text()) as EnvironmentRegistry & { format?: string };
      if (!Array.isArray(parsed.environments)) {
        throw new Error("The file does not contain an environments array.");
      }
      const response = await sendRuntimeMessage<EnvironmentRegistry>({
        type: "ac/popup/import-environments",
        payload: parsed
      });
      if (!response.ok || !response.data) {
        throw new Error(response.error ?? "Import failed.");
      }
      this.registry = response.data;
      this.render();
      await this.onRegistryChanged();
      showToast("success", "Environments imported", `${this.registry.environments.length} tenants loaded without credentials.`);
    } catch (error) {
      showToast("error", "Import failed", error instanceof Error ? error.message : String(error));
    } finally {
      input.value = "";
    }
  }

  private async saveCredentials(): Promise<void> {
    const elements = this.elements();
    const origin = elements.credentialOrigin.value;
    elements.credentialSave.disabled = true;
    const response = await sendRuntimeMessage<EmployeeApiCredentialStatus>({
      type: "ac/popup/set-employee-api-credentials",
      payload: {
        origin,
        publicKey: elements.publicKey.value,
        privateKey: elements.privateKey.value,
        remember: elements.remember.checked
      }
    });
    elements.credentialSave.disabled = false;
    if (!response.ok || !response.data) {
      showToast("error", "Credentials rejected", response.error ?? "Validation failed.");
      return;
    }
    elements.publicKey.value = "";
    elements.privateKey.value = "";
    await this.refreshCredentialStatus();
    await this.onRegistryChanged();
    showToast("success", "Credentials validated", response.data.storage === "local" ? "Remembered on this device." : "Available for this session.");
  }

  private async clearCredentials(): Promise<void> {
    const origin = this.elements().credentialOrigin.value;
    if (!origin) {
      return;
    }
    const response = await sendRuntimeMessage<EmployeeApiCredentialStatus>({
      type: "ac/popup/clear-employee-api-credentials",
      payload: { origin }
    });
    if (!response.ok) {
      showToast("error", "Credentials not cleared", response.error ?? "Unknown error");
      return;
    }
    await clearEmployeeCaches(origin);
    await this.refreshCredentialStatus();
    await this.onRegistryChanged();
    showToast("info", "Credentials cleared", `${this.getEnvironmentName(origin)} no longer has stored API keys.`);
  }

  private async refreshCredentialStatus(): Promise<void> {
    const elements = this.elements();
    const origin = elements.credentialOrigin.value;
    if (!origin) {
      elements.credentialStatus.textContent = "Add an environment first.";
      elements.credentialClear.disabled = true;
      return;
    }
    const response = await sendRuntimeMessage<EmployeeApiCredentialStatus>({
      type: "ac/popup/get-employee-api-credential-status",
      payload: { origin }
    });
    if (!response.ok || !response.data) {
      elements.credentialStatus.textContent = response.error ?? "Status unavailable.";
      return;
    }
    elements.credentialStatus.textContent = response.data.configured
      ? response.data.storage === "local" ? "Credentials remembered on this device." : "Credentials available for this session."
      : "Credentials not configured.";
    elements.credentialClear.disabled = !response.data.configured;
    elements.remember.checked = response.data.storage === "local";
  }

  private elements(): EnvironmentElements {
    return {
      list: required("#environment-list"),
      name: required("#environment-name"),
      origin: required("#environment-origin"),
      supportUrl: required("#environment-support-url"),
      save: required("#environment-save"),
      reset: required("#environment-reset"),
      exportButton: required("#environment-export"),
      importButton: required("#environment-import"),
      importInput: required("#environment-import-input"),
      credentialOrigin: required("#environment-credential-origin"),
      publicKey: required("#environment-public-key"),
      privateKey: required("#environment-private-key"),
      remember: required("#environment-remember"),
      credentialSave: required("#environment-credential-save"),
      credentialClear: required("#environment-credential-clear"),
      credentialStatus: required("#environment-credential-status")
    };
  }
}

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing environment manager element: ${selector}`);
  }
  return element;
}

function button(label: string, variant: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = `button ${variant}`;
  element.textContent = label;
  element.addEventListener("click", onClick);
  return element;
}
