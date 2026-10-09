import type { CommandResult, RuntimeMessage } from "@ac-core/shared/messages";
import type { DefinitionCapture, FormListEntry } from "@ac-core/shared/capture.mjs";

interface Dependencies {
  send<T>(message: RuntimeMessage): Promise<CommandResult<T>>;
  download(content: string, contentType: string, filename: string): void;
}
export class FormDefinitionsController {
  private readonly load = document.querySelector<HTMLButtonElement>("#load-form-definitions")!;
  private readonly selected = document.querySelector<HTMLSelectElement>("#form-definition-selection")!;
  private readonly single = document.querySelector<HTMLButtonElement>("#export-selected-form-definition")!;
  private readonly all = document.querySelector<HTMLButtonElement>("#export-all-form-definitions")!;
  private readonly status = document.querySelector<HTMLElement>("#form-definition-status")!;
  private readonly archived = document.querySelector<HTMLInputElement>("#include-archived-form-definitions")!;
  private readonly versions = document.querySelector<HTMLInputElement>("#include-form-version-history")!;
  private readonly tenant = document.querySelector<HTMLInputElement>('#include-form-tenant-options')!;
  private scope() { return { includeArchived: this.archived.checked, includeVersions: this.versions.checked, includeTenantConfiguration: this.tenant.checked }; }
  private items: FormListEntry[] = [];
  constructor(private readonly dependencies: Dependencies) {
    this.archived.addEventListener("change", () => { this.items = []; this.selected.replaceChildren(new Option("Reload the list for this scope", "")); this.busy(false); });
    this.load.addEventListener("click", () => void this.loadList());
    this.single.addEventListener("click", () => void this.export(false));
    this.all.addEventListener("click", () => void this.export(true));
  }
  private busy(value: boolean) {
    this.load.disabled = value;
    this.archived.disabled = value;
    this.versions.disabled = value;
    this.tenant.disabled = value;
    this.all.disabled = value;
    this.single.disabled = value || !this.items.length;
    this.selected.disabled = value || !this.items.length;
  }
  private async loadList() {
    this.busy(true); this.status.textContent = "Reading Northern Health UAT form list…";
    try {
      const response = await this.dependencies.send<FormListEntry[]>({ type: "ac/popup/list-form-definitions", payload: this.scope() });
      if (!response.ok || !response.data) throw new Error(response.error ?? "Could not load forms.");
      this.items = response.data;
      this.selected.replaceChildren(...this.items.map(form => new Option(`${form.name} · ID ${form.id} · v${form.schemaVersion ?? "?"} · ${form.status ?? ""}`, String(form.id))));
      this.status.textContent = `${this.items.length} definitions listed. Linked subforms are included in each export.`;
    } catch (error) { this.items = []; this.status.textContent = error instanceof Error ? error.message : "Could not load forms."; }
    finally { this.busy(false); }
  }
  private async export(all: boolean) {
    this.busy(true); this.status.textContent = all ? "Capturing all forms and child definitions…" : "Capturing selected form and child definitions…";
    try {
      const response = await this.dependencies.send<DefinitionCapture>({ type: "ac/popup/export-form-definitions", payload: { ...this.scope(), ...(all ? {} : { formIds: [Number(this.selected.value)] }) } });
      if (!response.ok || !response.data) throw new Error(response.error ?? "Could not export forms.");
      const capture = response.data;
      this.dependencies.download(JSON.stringify(capture, null, 2), "application/json", `alayacare-${all ? "all-forms" : `form-${this.selected.value}`}-with-subforms-${capture.capturedAt.slice(0, 10)}.json`);
      this.status.textContent = `${capture.forms.length} definitions exported for Webforms. ${capture.coverage.selectedDefinitionsComplete ? "Selected definitions and linked dependencies captured." : `${capture.failures.length} failures; check the file's coverage before import.`}`;
    } catch (error) { this.status.textContent = error instanceof Error ? error.message : "Could not export forms."; }
    finally { this.busy(false); }
  }
}
