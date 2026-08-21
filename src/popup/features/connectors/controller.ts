import { sendRuntimeMessage } from "../../../shared/chrome";
import type {
  ConnectorBlueprint,
  ConnectorBlueprintAuditReport,
  ConnectorReferenceCatalog,
  ConnectorScenarioBundle,
  ConnectorScenarioBulkDownloadResult,
  ConnectorScenarioListItem,
  ConnectorScenarioListResult,
  ConnectorScenarioHealth,
  ConnectorScenarioSaveResult,
  ConnectorScenarioSnapshot,
  ConnectorScenarioSource
} from "../../../shared/connectorScenarios";
import {
  CONNECTOR_ERROR_DIAGNOSTICS,
  auditConnectorBlueprint,
  extractConnectorBlueprint,
  validateConnectorBlueprint
} from "../../../shared/connectorScenarios";
import { formatError } from "../../../shared/errors";
import { showToast } from "../../ui/toasts";

interface ConnectorElements {
  views: Record<ConnectorView, HTMLElement>;
  navigationButtons: HTMLButtonElement[];
  headerBack: HTMLButtonElement;
  context: HTMLElement;
  summary: HTMLElement;
  source: HTMLElement;
  editor: HTMLTextAreaElement;
  validation: HTMLElement;
  scenarioCount: HTMLElement;
  scenarioSearch: HTMLInputElement;
  scenarioSelect: HTMLSelectElement;
  refreshScenarios: HTMLButtonElement;
  loadActive: HTMLButtonElement;
  downloadAll: HTMLButtonElement;
  loadDraft: HTMLButtonElement;
  loadPublished: HTMLButtonElement;
  format: HTMLButtonElement;
  validate: HTMLButtonElement;
  revert: HTMLButtonElement;
  copy: HTMLButtonElement;
  importButton: HTMLButtonElement;
  importInput: HTMLInputElement;
  exportJson: HTMLButtonElement;
  exportBundle: HTMLButtonElement;
  save: HTMLButtonElement;
  saveConfirmation: HTMLInputElement;
  refreshReferences: HTMLButtonElement;
  exportReferences: HTMLButtonElement;
  referenceSummary: HTMLElement;
  referenceCounts: Record<ConnectorReferenceKey, HTMLElement>;
  referenceButtons: HTMLButtonElement[];
  healthScenario: HTMLSelectElement;
  loadHealth: HTMLButtonElement;
  healthSummary: HTMLElement;
  healthRuns: HTMLElement;
  openHistory: HTMLAnchorElement;
  auditScenario: HTMLSelectElement;
  runAudit: HTMLButtonElement;
  auditResult: HTMLElement;
  diagnosticsList: HTMLElement;
}

type ConnectorReferenceKey = "templates" | "connections" | "webhooks" | "functions" | "keys" | "dataStores" | "dataStructures";
type ConnectorView = "menu" | "scenarios" | "editor" | "references" | "health" | "diagnostics";

export class ConnectorUtilitiesController {
  private elements: ConnectorElements | null = null;
  private snapshot: ConnectorScenarioSnapshot | null = null;
  private scenarioList: ConnectorScenarioListItem[] = [];
  private activeScenarioId: number | undefined;
  private references: ConnectorReferenceCatalog | null = null;
  private currentView: ConnectorView = "menu";
  private originalText = "";
  private busy = false;

  init(): void {
    this.elements = getConnectorElements();
    const elements = this.elements;

    elements.loadDraft.addEventListener("click", () => void this.loadSelected("draft"));
    elements.loadPublished.addEventListener("click", () => void this.loadSelected("published"));
    elements.loadActive.addEventListener("click", () => void this.loadActiveScenario());
    elements.refreshScenarios.addEventListener("click", () => void this.refreshScenarios());
    elements.scenarioSearch.addEventListener("input", () => this.renderScenarioList());
    elements.scenarioSelect.addEventListener("dblclick", () => void this.loadSelected("draft"));
    elements.downloadAll.addEventListener("click", () => void this.downloadAllScenarios());
    elements.format.addEventListener("click", () => this.formatJson());
    elements.validate.addEventListener("click", () => this.validateJson(true));
    elements.revert.addEventListener("click", () => this.revert());
    elements.copy.addEventListener("click", () => void this.copyJson());
    elements.importButton.addEventListener("click", () => elements.importInput.click());
    elements.importInput.addEventListener("change", () => void this.importJson());
    elements.exportJson.addEventListener("click", () => this.exportJson());
    elements.exportBundle.addEventListener("click", () => void this.exportBundle());
    elements.save.addEventListener("click", () => void this.save());
    elements.editor.addEventListener("input", () => this.updateDirtyState());
    elements.editor.addEventListener("keydown", (event) => this.handleEditorKeydown(event));
    elements.saveConfirmation.addEventListener("change", () => this.updateDirtyState());
    elements.refreshReferences.addEventListener("click", () => void this.refreshReferences());
    elements.exportReferences.addEventListener("click", () => this.exportReferences());
    elements.loadHealth.addEventListener("click", () => void this.loadHealth());
    elements.runAudit.addEventListener("click", () => void this.runAudit());
    elements.referenceButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const key = button.dataset.connectorReference as ConnectorReferenceKey;
        this.exportReference(key);
      });
    });
    elements.navigationButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const view = button.dataset.connectorNav as ConnectorView;
        void this.navigate(view);
      });
    });
    this.renderDiagnosticsReference();
  }

  async open(): Promise<void> {
    this.showView("menu");
  }

  backToOptions(): boolean {
    if (this.currentView === "menu") {
      return false;
    }
    this.showView("menu");
    return true;
  }

  private async navigate(view: ConnectorView): Promise<void> {
    if (this.busy) {
      return;
    }
    this.showView(view);
    if (["scenarios", "health", "diagnostics"].includes(view) && this.scenarioList.length === 0) {
      await this.refreshScenarios();
    } else if (view === "references" && !this.references) {
      await this.refreshReferences();
    }
  }

  private showView(view: ConnectorView): void {
    this.currentView = view;
    const elements = this.requireElements();
    elements.headerBack.hidden = view === "menu";
    if (view !== "editor") {
      elements.source.textContent = {
        menu: "Connector Utilities",
        scenarios: "Scenario Library",
        references: "Asset Inventory",
        health: "Operations & Health",
        diagnostics: "Diagnostics & Audit"
      }[view];
    } else {
      elements.source.textContent = this.snapshot ? getSourceLabel(this.snapshot) : "JSON Editor";
    }
    (Object.keys(this.requireElements().views) as ConnectorView[]).forEach((key) => {
      elements.views[key].hidden = key !== view;
    });
  }

  private async load(source: ConnectorScenarioSource, scenarioId: number): Promise<void> {
    const elements = this.requireElements();
    await this.withBusy(async () => {
      elements.validation.textContent = `Loading ${source} scenario JSON…`;
      const response = await sendRuntimeMessage<ConnectorScenarioSnapshot>({
        type: "ac/popup/get-connector-scenario",
        payload: { source, scenarioId }
      });

      if (!response.ok || !response.data) {
        throw new Error(response.error ?? "Unable to load the Connector scenario.");
      }

      this.applySnapshot(response.data);
      this.showView("editor");
      showToast("success", "Scenario loaded", `${response.data.scenario.name} (${source})`);
    });
  }

  private async loadSelected(source: ConnectorScenarioSource): Promise<void> {
    const scenarioId = Number(this.requireElements().scenarioSelect.value);
    if (!scenarioId) {
      showToast("error", "Select a scenario", "Choose a team scenario first.");
      return;
    }
    await this.load(source, scenarioId);
  }

  private async loadActiveScenario(): Promise<void> {
    if (!this.activeScenarioId) {
      showToast("error", "No active scenario", "Open a scenario editor page or choose a scenario from the list.");
      return;
    }
    this.requireElements().scenarioSelect.value = String(this.activeScenarioId);
    await this.load("draft", this.activeScenarioId);
  }

  private async refreshScenarios(): Promise<void> {
    const elements = this.requireElements();
    await this.withBusy(async () => {
      elements.scenarioCount.textContent = "Querying the active Connector team…";
      const response = await sendRuntimeMessage<ConnectorScenarioListResult>({
        type: "ac/popup/list-connector-scenarios"
      });
      if (!response.ok || !response.data) {
        throw new Error(response.error ?? "Unable to list Connector scenarios.");
      }

      this.scenarioList = response.data.scenarios;
      this.activeScenarioId = response.data.activeScenarioId;
      elements.context.textContent = `${response.data.teamName ?? "Connector team"} · Team ${response.data.teamId}`;
      elements.scenarioCount.textContent =
        `${response.data.scenarios.length} scenarios` +
        (this.activeScenarioId ? ` · active scenario ${this.activeScenarioId}` : " · select one below");
      elements.loadActive.disabled = !this.activeScenarioId;
      this.renderScenarioList();
    });
  }

  private renderScenarioList(): void {
    const elements = this.requireElements();
    const previous = elements.scenarioSelect.value;
    const query = elements.scenarioSearch.value.trim().toLowerCase();
    const items = this.scenarioList.filter((scenario) => {
      if (!query) {
        return true;
      }
      return `${scenario.id} ${scenario.name} ${scenario.description ?? ""}`.toLowerCase().includes(query);
    });

    elements.scenarioSelect.replaceChildren(
      ...items.map((scenario) => {
        const option = document.createElement("option");
        option.value = String(scenario.id);
        option.textContent = `${scenario.isActive ? "● " : ""}${scenario.name} (#${scenario.id})`;
        return option;
      })
    );

    const preferred = [
      previous,
      this.snapshot ? String(this.snapshot.scenarioId) : "",
      this.activeScenarioId ? String(this.activeScenarioId) : "",
      items[0] ? String(items[0].id) : ""
    ].find((value) => value && items.some((scenario) => String(scenario.id) === value));
    elements.scenarioSelect.value = preferred ?? "";
    this.populateScenarioPicker(elements.healthScenario, preferred);
    this.populateScenarioPicker(elements.auditScenario, preferred);
  }

  private populateScenarioPicker(select: HTMLSelectElement, preferred?: string): void {
    const current = select.value || preferred || "";
    select.replaceChildren(...this.scenarioList.map((scenario) => {
      const option = document.createElement("option");
      option.value = String(scenario.id);
      option.textContent = `${scenario.name} (#${scenario.id})`;
      return option;
    }));
    select.value = this.scenarioList.some((scenario) => String(scenario.id) === current)
      ? current
      : String(this.activeScenarioId ?? this.scenarioList[0]?.id ?? "");
  }

  private async downloadAllScenarios(): Promise<void> {
    const confirmed = window.confirm(
      `Download published and draft JSON for all ${this.scenarioList.length || "team"} Connector scenarios?`
    );
    if (!confirmed) {
      return;
    }

    await this.withBusy(async () => {
      const response = await sendRuntimeMessage<ConnectorScenarioBulkDownloadResult>({
        type: "ac/popup/download-all-connector-scenarios"
      });
      if (!response.ok || !response.data) {
        throw new Error(response.error ?? "Unable to download all Connector scenarios.");
      }
      showToast(
        response.data.failedCount ? "info" : "success",
        "Scenario archive downloaded",
        `${response.data.scenarioCount} scenarios saved to ${response.data.filename}` +
          (response.data.failedCount ? `; ${response.data.failedCount} failed.` : ".")
      );
    });
  }

  private async refreshReferences(): Promise<void> {
    const elements = this.requireElements();
    await this.withBusy(async () => {
      elements.referenceSummary.textContent = "Querying Connector reference catalogs…";
      const response = await sendRuntimeMessage<ConnectorReferenceCatalog>({
        type: "ac/popup/get-connector-reference-catalog"
      });
      if (!response.ok || !response.data) {
        throw new Error(response.error ?? "Unable to load Connector reference catalogs.");
      }
      this.references = response.data;
      const counts = getReferenceCounts(response.data);
      (Object.keys(counts) as ConnectorReferenceKey[]).forEach((key) => {
        elements.referenceCounts[key].textContent = String(counts[key]);
      });
      elements.referenceSummary.textContent =
        `${counts.templates} templates · ${counts.connections} connections · ` +
        `${counts.webhooks} webhooks · ${counts.functions} functions · ${counts.keys} keys · ` +
        `${counts.dataStores} data stores · ${counts.dataStructures} data structures`;
      elements.exportReferences.disabled = false;
    });
  }

  private exportReferences(): void {
    if (!this.references) {
      showToast("error", "References not loaded", "Refresh the reference catalogs first.");
      return;
    }
    downloadJson(
      this.references,
      `connector-team-${this.references.teamId}-references-${this.references.exportedAt.slice(0, 10)}.json`
    );
    showToast("success", "Reference catalogs exported", "Downloaded the combined sanitized catalog.");
  }

  private exportReference(key: ConnectorReferenceKey): void {
    if (!this.references) {
      showToast("error", "References not loaded", "Refresh the reference catalogs first.");
      return;
    }
    downloadJson(
      {
        schemaVersion: this.references.schemaVersion,
        exportedAt: this.references.exportedAt,
        tenantOrigin: this.references.tenantOrigin,
        teamId: this.references.teamId,
        organizationId: this.references.organizationId,
        [key]: this.references[key]
      },
      `connector-team-${this.references.teamId}-${key}-${this.references.exportedAt.slice(0, 10)}.json`
    );
    showToast("success", `${capitalize(key)} exported`, `Downloaded ${this.references[key].length} records.`);
  }

  private async loadHealth(): Promise<void> {
    const elements = this.requireElements();
    const scenarioId = Number(elements.healthScenario.value);
    if (!scenarioId) {
      showToast("error", "Select a scenario", "Choose a scenario to inspect.");
      return;
    }
    await this.withBusy(async () => {
      elements.healthSummary.textContent = "Loading schedule and execution metadata…";
      const response = await sendRuntimeMessage<ConnectorScenarioHealth>({
        type: "ac/popup/get-connector-scenario-health",
        payload: { scenarioId }
      });
      if (!response.ok || !response.data) {
        throw new Error(response.error ?? "Unable to load Connector scenario health.");
      }
      this.renderHealth(response.data);
    });
  }

  private renderHealth(health: ConnectorScenarioHealth): void {
    const elements = this.requireElements();
    const scenario = health.scenario;
    const schedule = describeSchedule(scenario.scheduling);
    const metrics: Array<[string, string]> = [
      ["State", scenario.isPaused ? "Paused" : scenario.isWaiting ? "Waiting" : scenario.isActive === true ? "Active" : scenario.isActive === false ? "Inactive" : "Available"],
      ["Schedule", schedule],
      ["Next run", scenario.nextExec ? formatTimestamp(scenario.nextExec) : "Not scheduled"],
      ["Incomplete", String(health.incompleteExecutionCount)],
      ["Operations", formatMetric(scenario.operations)],
      ["Data transfer", formatBytes(scenario.transfer)]
    ];
    elements.healthSummary.replaceChildren(...metrics.map(([label, value]) => {
      const card = document.createElement("div");
      card.className = "connector-metric";
      const caption = document.createElement("span");
      caption.textContent = label;
      const strong = document.createElement("strong");
      strong.textContent = value;
      card.append(caption, strong);
      return card;
    }));
    if (health.runs.length === 0) {
      elements.healthRuns.replaceChildren(makeMessage("No execution rows were returned. Open Connector History for the complete retained history."));
    } else {
      elements.healthRuns.replaceChildren(...health.runs.slice(0, 20).map((run) => {
        const row = document.createElement("div");
        row.className = "connector-list-item";
        const title = document.createElement("strong");
        title.textContent = run.status || run.kind || `Execution ${run.id ?? ""}`.trim();
        const detail = document.createElement("span");
        detail.textContent = [run.started ? formatTimestamp(run.started) : undefined, run.duration !== undefined ? `${run.duration} ms` : undefined, run.operations !== undefined ? `${run.operations} ops` : undefined].filter(Boolean).join(" · ");
        row.append(title, detail);
        return row;
      }));
    }
    elements.openHistory.href = health.historyUrl;
    elements.openHistory.hidden = false;
  }

  private async runAudit(): Promise<void> {
    const elements = this.requireElements();
    const scenarioId = Number(elements.auditScenario.value);
    if (!scenarioId) {
      showToast("error", "Select a scenario", "Choose a scenario to audit.");
      return;
    }
    await this.withBusy(async () => {
      elements.auditResult.textContent = "Loading draft and published blueprints…";
      const response = await sendRuntimeMessage<ConnectorScenarioBundle>({
        type: "ac/popup/export-connector-scenario-bundle",
        payload: { scenarioId }
      });
      if (!response.ok || !response.data) {
        throw new Error(response.error ?? "Unable to load blueprints for audit.");
      }
      const report = auditConnectorBlueprint(response.data.draft.blueprint, response.data.published.blueprint);
      this.renderAudit(report);
    });
  }

  private renderAudit(report: ConnectorBlueprintAuditReport): void {
    const elements = this.requireElements();
    const summary = document.createElement("div");
    summary.className = "connector-audit-score";
    const score = document.createElement("strong");
    score.textContent = `${report.score}/100`;
    const detail = document.createElement("span");
    detail.textContent = `${report.counts.danger} high risk · ${report.counts.warning} warnings · ${report.counts.info} notes`;
    summary.append(score, detail);
    const comparison = makeMessage(report.comparison?.changed
      ? `Draft differs from published: ${report.comparison.draftModules} vs ${report.comparison.publishedModules} modules; ${report.comparison.draftRoutes} vs ${report.comparison.publishedRoutes} routes.`
      : "Draft and published blueprints are structurally identical.");
    const findings = report.findings.length
      ? report.findings.map((finding) => {
          const row = document.createElement("div");
          row.className = `connector-finding connector-finding--${finding.severity}`;
          const title = document.createElement("strong");
          title.textContent = `${finding.title}${finding.moduleId ? ` · module ${finding.moduleId}` : ""}`;
          const body = document.createElement("span");
          body.textContent = finding.detail;
          row.append(title, body);
          return row;
        })
      : [makeMessage("No heuristic findings were detected. This audit does not replace a test run or peer review.")];
    elements.auditResult.replaceChildren(summary, comparison, ...findings);
  }

  private renderDiagnosticsReference(): void {
    const list = this.requireElements().diagnosticsList;
    list.replaceChildren(...CONNECTOR_ERROR_DIAGNOSTICS.map((diagnostic) => {
      const item = document.createElement("details");
      item.className = "connector-diagnostic";
      const summary = document.createElement("summary");
      summary.textContent = `${diagnostic.match} · ${diagnostic.category}`;
      const cause = document.createElement("p");
      cause.textContent = diagnostic.likelyCause;
      const next = document.createElement("p");
      next.textContent = `Next: ${diagnostic.nextStep}`;
      item.append(summary, cause, next);
      return item;
    }));
  }

  private applySnapshot(snapshot: ConnectorScenarioSnapshot): void {
    const elements = this.requireElements();
    this.snapshot = snapshot;
    this.originalText = `${JSON.stringify(snapshot.blueprint, null, 2)}\n`;
    elements.editor.value = this.originalText;
    elements.source.textContent = getSourceLabel(snapshot);
    elements.context.textContent = `${snapshot.scenario.name} · Scenario ${snapshot.scenarioId} · Team ${snapshot.teamId}`;
    elements.summary.textContent = buildSummary(snapshot);
    elements.saveConfirmation.checked = false;
    this.validateJson(false);
    this.updateDirtyState();
  }

  private formatJson(): void {
    const elements = this.requireElements();
    const parsed = this.parseEditor();
    if (!parsed) {
      return;
    }
    elements.editor.value = `${JSON.stringify(parsed, null, 2)}\n`;
    this.validateJson(true);
    this.updateDirtyState();
  }

  private validateJson(showSuccess: boolean): ConnectorBlueprint | null {
    const elements = this.requireElements();
    const parsed = this.parseEditor();
    if (!parsed) {
      return null;
    }

    const blueprint = extractConnectorBlueprint(parsed);
    if (!blueprint) {
      elements.validation.textContent = 'Invalid blueprint: expected a JSON object with a "flow" array.';
      elements.validation.dataset.status = "error";
      return null;
    }

    const result = validateConnectorBlueprint(blueprint);
    const lines = [
      result.valid
        ? `Valid blueprint · ${result.summary.moduleCount} modules · ${result.summary.routeCount} routes`
        : `${result.errors.length} validation error${result.errors.length === 1 ? "" : "s"}`,
      ...result.errors.map((message) => `Error: ${message}`),
      ...result.warnings.map((message) => `Warning: ${message}`)
    ];
    elements.validation.textContent = lines.join("\n");
    elements.validation.dataset.status = result.valid ? (result.warnings.length ? "warning" : "success") : "error";

    if (showSuccess && result.valid) {
      showToast(
        result.warnings.length ? "info" : "success",
        "JSON validation complete",
        result.warnings.length ? `${result.warnings.length} warning(s) found.` : "No structural issues found."
      );
    }

    return result.valid ? blueprint : null;
  }

  private parseEditor(): unknown | null {
    const elements = this.requireElements();
    try {
      return JSON.parse(elements.editor.value);
    } catch (error) {
      elements.validation.textContent = describeJsonError(error, elements.editor.value);
      elements.validation.dataset.status = "error";
      return null;
    }
  }

  private revert(): void {
    const elements = this.requireElements();
    if (!this.originalText) {
      return;
    }
    elements.editor.value = this.originalText;
    elements.saveConfirmation.checked = false;
    this.validateJson(false);
    this.updateDirtyState();
    showToast("info", "Editor reverted", "Restored the last loaded server copy.");
  }

  private async copyJson(): Promise<void> {
    const elements = this.requireElements();
    if (!elements.editor.value.trim()) {
      return;
    }

    try {
      await navigator.clipboard.writeText(elements.editor.value);
    } catch {
      elements.editor.focus();
      elements.editor.select();
      if (!document.execCommand("copy")) {
        throw new Error("The browser did not allow clipboard access.");
      }
    }
    showToast("success", "JSON copied", "The editor contents are on the clipboard.");
  }

  private async importJson(): Promise<void> {
    const elements = this.requireElements();
    const file = elements.importInput.files?.[0];
    elements.importInput.value = "";
    if (!file) {
      return;
    }

    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const blueprint = extractConnectorBlueprint(parsed);
      if (!blueprint) {
        throw new Error('The file does not contain a Connector blueprint with a "flow" array.');
      }
      elements.editor.value = `${JSON.stringify(blueprint, null, 2)}\n`;
      elements.saveConfirmation.checked = false;
      this.validateJson(false);
      this.updateDirtyState();
      showToast("success", "JSON imported", file.name);
    } catch (error) {
      showToast("error", "Import failed", formatError(error));
    }
  }

  private exportJson(): void {
    const blueprint = this.validateJson(false);
    if (!blueprint) {
      showToast("error", "Export blocked", "Fix the JSON errors before exporting.");
      return;
    }

    const scenarioName = safeFilename(this.snapshot?.scenario.name ?? blueprint.name ?? "connector-scenario");
    const scenarioId = this.snapshot?.scenarioId ?? "scenario";
    downloadJson(blueprint, `${scenarioName}-${scenarioId}-blueprint.json`);
    showToast("success", "Blueprint exported", "Downloaded the current editor JSON.");
  }

  private async exportBundle(): Promise<void> {
    const scenarioId = this.snapshot?.scenarioId ?? Number(this.requireElements().scenarioSelect.value);
    if (!scenarioId) {
      showToast("error", "Select a scenario", "Choose or load a scenario before exporting its bundle.");
      return;
    }
    await this.withBusy(async () => {
      const response = await sendRuntimeMessage<ConnectorScenarioBundle>({
        type: "ac/popup/export-connector-scenario-bundle",
        payload: { scenarioId }
      });

      if (!response.ok || !response.data) {
        throw new Error(response.error ?? "Unable to export the Connector scenario bundle.");
      }

      const name = safeFilename(response.data.scenario.name || "connector-scenario");
      downloadJson(response.data, `${name}-${response.data.scenarioId}-bundle.json`);
      showToast("success", "Scenario bundle exported", "Downloaded published and draft blueprints.");
    });
  }

  private async save(): Promise<void> {
    const elements = this.requireElements();
    const snapshot = this.snapshot;
    if (!snapshot) {
      showToast("error", "Nothing to save", "Load a scenario before saving.");
      return;
    }
    if (snapshot.source !== "draft") {
      showToast("error", "Published JSON is read-only", "Load Draft before saving changes.");
      return;
    }
    if (!elements.saveConfirmation.checked) {
      showToast("error", "Confirmation required", "Acknowledge the save warning first.");
      return;
    }

    const blueprint = this.validateJson(false);
    if (!blueprint) {
      showToast("error", "Save blocked", "Fix the JSON errors before saving.");
      return;
    }

    const confirmed = window.confirm(
      `Save the edited JSON to Connector scenario ${snapshot.scenarioId} (${snapshot.scenario.name})?\n\n` +
      "This updates the server-side scenario draft. Export a bundle first if you need a separate backup."
    );
    if (!confirmed) {
      return;
    }

    await this.withBusy(async () => {
      const response = await sendRuntimeMessage<ConnectorScenarioSaveResult>({
        type: "ac/popup/save-connector-scenario",
        payload: {
          scenarioId: snapshot.scenarioId,
          blueprint,
          expectedLastEdit: snapshot.lastEdit
        }
      });

      if (!response.ok || !response.data) {
        throw new Error(response.error ?? "Unable to save the Connector scenario.");
      }

      this.applySnapshot(response.data.snapshot);
      showToast("success", "Scenario draft saved", `Saved scenario ${response.data.scenarioId}.`);
    });
  }

  private updateDirtyState(): void {
    const elements = this.requireElements();
    const dirty = Boolean(this.originalText) && elements.editor.value !== this.originalText;
    elements.revert.disabled = !dirty || this.busy;
    elements.save.disabled =
      !dirty ||
      this.busy ||
      this.snapshot?.source !== "draft" ||
      !elements.saveConfirmation.checked;
  }

  private handleEditorKeydown(event: KeyboardEvent): void {
    if (event.key !== "Tab") {
      return;
    }

    event.preventDefault();
    const editor = this.requireElements().editor;
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    editor.setRangeText("  ", start, end, "end");
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  }

  private async withBusy(action: () => Promise<void>): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    this.setButtonsDisabled(true);
    try {
      await action();
    } catch (error) {
      const message = formatError(error);
      this.requireElements().validation.textContent = message;
      this.requireElements().validation.dataset.status = "error";
      showToast("error", "Connector utility failed", message);
    } finally {
      this.busy = false;
      this.setButtonsDisabled(false);
      this.updateDirtyState();
    }
  }

  private setButtonsDisabled(disabled: boolean): void {
    const elements = this.requireElements();
    [
      elements.loadDraft,
      elements.loadPublished,
      elements.format,
      elements.validate,
      elements.copy,
      elements.importButton,
      elements.exportJson,
      elements.exportBundle,
      elements.refreshScenarios,
      elements.downloadAll,
      elements.refreshReferences,
      elements.loadHealth,
      elements.runAudit,
      ...elements.navigationButtons,
      ...elements.referenceButtons
    ].forEach((button) => {
      button.disabled = disabled;
    });
    elements.editor.disabled = disabled;
    elements.scenarioSearch.disabled = disabled;
    elements.scenarioSelect.disabled = disabled;
    elements.healthScenario.disabled = disabled;
    elements.auditScenario.disabled = disabled;
    elements.loadActive.disabled = disabled || !this.activeScenarioId;
    elements.saveConfirmation.disabled = disabled;
    elements.exportReferences.disabled = disabled || !this.references;
  }

  private requireElements(): ConnectorElements {
    if (!this.elements) {
      throw new Error("Connector utilities have not been initialized.");
    }
    return this.elements;
  }
}

function getConnectorElements(): ConnectorElements {
  const get = <T extends Element>(selector: string): T => {
    const element = document.querySelector<T>(selector);
    if (!element) {
      throw new Error(`Missing Connector utility element: ${selector}`);
    }
    return element;
  };

  const referenceButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-connector-reference]")
  );
  const navigationButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-connector-nav]")
  );

  return {
    views: {
      menu: get<HTMLElement>('[data-connector-view="menu"]'),
      scenarios: get<HTMLElement>('[data-connector-view="scenarios"]'),
      editor: get<HTMLElement>('[data-connector-view="editor"]'),
      references: get<HTMLElement>('[data-connector-view="references"]'),
      health: get<HTMLElement>('[data-connector-view="health"]'),
      diagnostics: get<HTMLElement>('[data-connector-view="diagnostics"]')
    },
    navigationButtons,
    headerBack: get<HTMLButtonElement>("#connector-header-back"),
    context: get<HTMLElement>("#connector-context"),
    summary: get<HTMLElement>("#connector-summary"),
    source: get<HTMLElement>("#connector-source"),
    editor: get<HTMLTextAreaElement>("#connector-json-editor"),
    validation: get<HTMLElement>("#connector-validation"),
    scenarioCount: get<HTMLElement>("#connector-scenario-count"),
    scenarioSearch: get<HTMLInputElement>("#connector-scenario-search"),
    scenarioSelect: get<HTMLSelectElement>("#connector-scenario-select"),
    refreshScenarios: get<HTMLButtonElement>("#connector-refresh-scenarios"),
    loadActive: get<HTMLButtonElement>("#connector-load-active"),
    downloadAll: get<HTMLButtonElement>("#connector-download-all"),
    loadDraft: get<HTMLButtonElement>("#connector-load-draft"),
    loadPublished: get<HTMLButtonElement>("#connector-load-published"),
    format: get<HTMLButtonElement>("#connector-format-json"),
    validate: get<HTMLButtonElement>("#connector-validate-json"),
    revert: get<HTMLButtonElement>("#connector-revert-json"),
    copy: get<HTMLButtonElement>("#connector-copy-json"),
    importButton: get<HTMLButtonElement>("#connector-import-json"),
    importInput: get<HTMLInputElement>("#connector-import-file"),
    exportJson: get<HTMLButtonElement>("#connector-export-json"),
    exportBundle: get<HTMLButtonElement>("#connector-export-bundle"),
    save: get<HTMLButtonElement>("#connector-save-json"),
    saveConfirmation: get<HTMLInputElement>("#connector-save-confirmation"),
    refreshReferences: get<HTMLButtonElement>("#connector-refresh-references"),
    exportReferences: get<HTMLButtonElement>("#connector-export-references"),
    referenceSummary: get<HTMLElement>("#connector-reference-summary"),
    referenceCounts: {
      templates: get<HTMLElement>("#connector-reference-templates"),
      connections: get<HTMLElement>("#connector-reference-connections"),
      webhooks: get<HTMLElement>("#connector-reference-webhooks"),
      functions: get<HTMLElement>("#connector-reference-functions"),
      keys: get<HTMLElement>("#connector-reference-keys"),
      dataStores: get<HTMLElement>("#connector-reference-data-stores"),
      dataStructures: get<HTMLElement>("#connector-reference-data-structures")
    },
    referenceButtons,
    healthScenario: get<HTMLSelectElement>("#connector-health-scenario"),
    loadHealth: get<HTMLButtonElement>("#connector-load-health"),
    healthSummary: get<HTMLElement>("#connector-health-summary"),
    healthRuns: get<HTMLElement>("#connector-health-runs"),
    openHistory: get<HTMLAnchorElement>("#connector-open-history"),
    auditScenario: get<HTMLSelectElement>("#connector-audit-scenario"),
    runAudit: get<HTMLButtonElement>("#connector-run-audit"),
    auditResult: get<HTMLElement>("#connector-audit-result"),
    diagnosticsList: get<HTMLElement>("#connector-diagnostics-list")
  };
}

function buildSummary(snapshot: ConnectorScenarioSnapshot): string {
  const parts = [
    `${snapshot.summary.moduleCount} modules`,
    `${snapshot.summary.routeCount} routes`,
    `${snapshot.summary.errorHandlerCount} error handlers`,
    `${snapshot.summary.packages.length} packages`
  ];
  if (snapshot.lastEdit) {
    parts.push(`last edited ${formatTimestamp(snapshot.lastEdit)}`);
  }
  return parts.join(" · ");
}

function getSourceLabel(snapshot: ConnectorScenarioSnapshot): string {
  if (snapshot.source === "published") {
    return "Published";
  }
  return snapshot.serverDraftAvailable ? "Draft" : "Draft · published base";
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function getReferenceCounts(catalog: ConnectorReferenceCatalog): Record<ConnectorReferenceKey, number> {
  return {
    templates: catalog.templates.length,
    connections: catalog.connections.length,
    webhooks: catalog.webhooks.length,
    functions: catalog.functions.length,
    keys: catalog.keys.length,
    dataStores: catalog.dataStores.length,
    dataStructures: catalog.dataStructures.length
  };
}

function describeSchedule(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "Not configured";
  }
  const record = value as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : "configured";
  return type === "immediately" ? "Immediately" : type.replace(/[_-]+/g, " ");
}

function formatMetric(value: number | undefined): string {
  return value === undefined ? "—" : new Intl.NumberFormat().format(value);
}

function formatBytes(value: number | undefined): string {
  if (value === undefined) {
    return "—";
  }
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function makeMessage(text: string): HTMLParagraphElement {
  const paragraph = document.createElement("p");
  paragraph.className = "connector-card__summary";
  paragraph.textContent = text;
  return paragraph;
}

function capitalize(value: string): string {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

function describeJsonError(error: unknown, source: string): string {
  const message = formatError(error);
  const match = /position\s+(\d+)/i.exec(message);
  if (!match) {
    return `Invalid JSON: ${message}`;
  }

  const position = Number(match[1]);
  const before = source.slice(0, position);
  const line = before.split("\n").length;
  const column = position - before.lastIndexOf("\n");
  return `Invalid JSON at line ${line}, column ${column}: ${message}`;
}

function safeFilename(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "connector-scenario";
}

function downloadJson(value: unknown, filename: string): void {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
