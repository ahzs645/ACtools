import { sendRuntimeMessage } from "../../../shared/chrome";
import { formatError } from "../../../shared/errors";
import {
  EMPTY_SHIFT_LAB_REGISTRY,
  SHIFT_LAB_SCHEMA_VERSION,
  SHIFT_LAB_STORAGE_KEY,
  buildNativeVisitReadiness,
  calculateShiftDurationHours,
  evaluateShiftFixture,
  nextScenarioIdentifier,
  parseShiftLabRegistry,
  validateScenarioIdentifier,
  type ShiftAssessmentItem,
  type ShiftLabRegistry,
  type ShiftRulesetRecord,
  type ShiftScenarioRecord,
  type ShiftServiceLocation,
  type ShiftServiceLocationSearchResponse
} from "../../../shared/shiftLab";
import { showToast } from "../../ui/toasts";

export class ShiftLabController {
  private registry: ShiftLabRegistry = structuredClone(EMPTY_SHIFT_LAB_REGISTRY);
  private selectedLocation: ShiftServiceLocation | null = null;
  private lastShift: ShiftScenarioRecord | null = null;

  private readonly confirm = getElement<HTMLInputElement>("#shift-lab-uat-confirm");
  private readonly locationQuery = getElement<HTMLInputElement>("#shift-location-search-input");
  private readonly searchButton = getElement<HTMLButtonElement>("#shift-location-search-button");
  private readonly locationResults = getElement<HTMLElement>("#shift-location-results");
  private readonly selectedLocationLabel = getElement<HTMLElement>("#shift-selected-location");
  private readonly nativeReadiness = getElement<HTMLElement>("#shift-native-readiness");
  private readonly nativeReadinessBadge = getElement<HTMLElement>("#shift-native-readiness-badge");
  private readonly nativeReadinessSummary = getElement<HTMLElement>("#shift-native-readiness-summary");
  private readonly nativeReadinessList = getElement<HTMLElement>("#shift-native-readiness-list");
  private readonly rulesetForm = getElement<HTMLFormElement>("#shift-ruleset-form");
  private readonly rulesetId = getElement<HTMLInputElement>("#shift-ruleset-id");
  private readonly rulesetName = getElement<HTMLInputElement>("#shift-ruleset-name");
  private readonly overtimeApproved = getElement<HTMLInputElement>("#shift-ruleset-ot-approved");
  private readonly ignoreCapacity = getElement<HTMLInputElement>("#shift-ruleset-ignore-capacity");
  private readonly ignoreFatigue = getElement<HTMLInputElement>("#shift-ruleset-ignore-fatigue");
  private readonly canShiftSwap = getElement<HTMLInputElement>("#shift-ruleset-can-swap");
  private readonly rulesetList = getElement<HTMLElement>("#shift-ruleset-list");
  private readonly shiftForm = getElement<HTMLFormElement>("#shift-scenario-form");
  private readonly occurrenceId = getElement<HTMLInputElement>("#shift-occurrence-id");
  private readonly shiftName = getElement<HTMLInputElement>("#shift-name");
  private readonly office = getElement<HTMLInputElement>("#shift-office");
  private readonly costCenter = getElement<HTMLInputElement>("#shift-cost-center");
  private readonly rulesetSelect = getElement<HTMLSelectElement>("#shift-ruleset-select");
  private readonly start = getElement<HTMLInputElement>("#shift-start");
  private readonly end = getElement<HTMLInputElement>("#shift-end");
  private readonly duration = getElement<HTMLOutputElement>("#shift-duration");
  private readonly payDuration = getElement<HTMLInputElement>("#shift-pay-duration");
  private readonly overtimeEligibility = getElement<HTMLSelectElement>("#shift-ot-eligibility");
  private readonly timezone = getElement<HTMLInputElement>("#shift-timezone");
  private readonly pattern = getElement<HTMLInputElement>("#shift-pattern");
  private readonly expiresAfter = getElement<HTMLInputElement>("#shift-expires-after");
  private readonly shiftCode = getElement<HTMLInputElement>("#shift-code");
  private readonly swapEvent = getElement<HTMLInputElement>("#shift-swap-event");
  private readonly intakeAt = getElement<HTMLInputElement>("#shift-intake-at");
  private readonly intakeUser = getElement<HTMLInputElement>("#shift-intake-user");
  private readonly changedAt = getElement<HTMLInputElement>("#shift-changed-at");
  private readonly changedUser = getElement<HTMLInputElement>("#shift-changed-user");
  private readonly fixtureEvaluation = getElement<HTMLElement>("#shift-fixture-evaluation");
  private readonly fixtureEvaluationBadge = getElement<HTMLElement>("#shift-fixture-evaluation-badge");
  private readonly fixtureEvaluationSummary = getElement<HTMLElement>("#shift-fixture-evaluation-summary");
  private readonly fixtureEvaluationList = getElement<HTMLElement>("#shift-fixture-evaluation-list");
  private readonly summary = getElement<HTMLElement>("#shift-lab-summary");
  private readonly shiftList = getElement<HTMLElement>("#shift-scenario-list");
  private readonly exportShiftButton = getElement<HTMLButtonElement>("#shift-export-last");
  private readonly exportRegistryButton = getElement<HTMLButtonElement>("#shift-export-registry");

  async init(): Promise<void> {
    this.confirm.addEventListener("change", () => this.updateSearchAvailability());
    this.locationQuery.addEventListener("input", () => this.updateSearchAvailability());
    this.searchButton.addEventListener("click", () => void this.searchLocations());
    this.locationQuery.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void this.searchLocations();
      }
    });
    this.rulesetForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.saveRuleset();
    });
    this.shiftForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.saveShift();
    });
    this.shiftForm.addEventListener("input", () => this.renderAssessments());
    this.shiftForm.addEventListener("change", () => this.renderAssessments());
    this.start.addEventListener("input", () => this.updateDuration());
    this.end.addEventListener("input", () => this.updateDuration());
    this.exportShiftButton.addEventListener("click", () => {
      if (this.lastShift) downloadJson(this.lastShift, `${this.lastShift.occurrenceId}.json`);
    });
    this.exportRegistryButton.addEventListener("click", () => {
      downloadJson(this.registry, `ac-tools-shift-lab-${new Date().toISOString().slice(0, 10)}.json`);
    });
    await this.hydrate();
    this.updateSearchAvailability();
    this.updateDuration();
    this.renderAssessments();
  }

  async open(): Promise<void> {
    await this.hydrate();
    this.locationQuery.focus();
  }

  private async hydrate(): Promise<void> {
    const stored = await chrome.storage.local.get(SHIFT_LAB_STORAGE_KEY);
    this.registry = parseShiftLabRegistry(stored[SHIFT_LAB_STORAGE_KEY]);
    this.lastShift = this.registry.shifts.at(-1) ?? null;
    if (this.registry.rulesets.length > 0) {
      this.rulesetId.value = nextScenarioIdentifier(
        "R",
        this.registry.rulesets.map((item) => item.rulesetId)
      );
    }
    if (this.registry.shifts.length > 0) {
      this.occurrenceId.value = nextScenarioIdentifier(
        "S",
        this.registry.shifts.map((item) => item.occurrenceId)
      );
    }
    this.renderRulesets();
    this.renderShifts();
    this.exportRegistryButton.disabled =
      this.registry.rulesets.length === 0 && this.registry.shifts.length === 0;
    this.exportShiftButton.disabled = !this.lastShift;
  }

  private updateSearchAvailability(): void {
    this.searchButton.disabled = !(
      this.confirm.checked && this.locationQuery.value.trim().length >= 2
    );
    if (!this.confirm.checked) {
      this.selectedLocation = null;
      this.locationResults.replaceChildren();
      this.selectedLocationLabel.textContent = "No UAT service location selected.";
    }
    this.renderNativeReadiness();
  }

  private async searchLocations(): Promise<void> {
    const query = this.locationQuery.value.trim();
    if (!this.confirm.checked) {
      this.setSummary("Confirm that the lookup is for UAT test data first.", "error");
      return;
    }
    this.searchButton.disabled = true;
    this.locationResults.textContent = `Searching UAT for “${query}”…`;
    try {
      const response = await sendRuntimeMessage<ShiftServiceLocationSearchResponse>({
        type: "ac/popup/search-shift-service-locations",
        payload: { query, confirmedUat: true }
      });
      if (!response.ok || !response.data) {
        throw new Error(response.error ?? "Unable to search service locations.");
      }
      this.renderLocationResults(response.data.items);
      this.setSummary(
        response.data.items.length > 0
          ? `Found ${response.data.items.length} active staffing position(s) in ${response.data.tenantOrigin}. Select one for the local scenario.`
          : `No active service locations matched “${query}”.`,
        response.data.items.length > 0 ? "info" : "warning"
      );
    } catch (error) {
      this.locationResults.textContent = "Service-location search failed.";
      this.setSummary(formatError(error), "error");
    } finally {
      this.updateSearchAvailability();
    }
  }

  private renderLocationResults(items: ShiftServiceLocation[]): void {
    this.locationResults.replaceChildren();
    if (items.length === 0) {
      this.locationResults.textContent = "No matching locations.";
      return;
    }
    for (const item of items) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "shift-location-card";
      const title = document.createElement("strong");
      title.textContent = item.label;
      const metadata = document.createElement("span");
      metadata.textContent = [
        `Account ${item.accountId}`,
        item.staffingId ? `Staffing ${item.staffingId}` : "",
        `Branch ${item.branchId}`
      ].filter(Boolean).join(" · ");
      button.append(title, metadata);
      button.addEventListener("click", () => {
        this.selectedLocation = item;
        this.selectedLocationLabel.textContent = `${item.label} · Account ${item.accountId}${item.staffingId ? ` · Staffing ${item.staffingId}` : ""}`;
        for (const result of this.locationResults.querySelectorAll(".shift-location-card")) {
          result.classList.toggle("is-selected", result === button);
        }
        this.renderNativeReadiness();
      });
      this.locationResults.append(button);
    }
  }

  private async saveRuleset(): Promise<void> {
    try {
      const rulesetId = validateScenarioIdentifier(this.rulesetId.value, "R");
      const name = this.rulesetName.value.trim();
      if (!name) throw new Error("Enter a ruleset name.");
      if (this.registry.rulesets.some((item) => item.rulesetId === rulesetId)) {
        throw new Error(`Ruleset ${rulesetId} already exists in this local registry.`);
      }
      const record: ShiftRulesetRecord = {
        kind: "ac-tools/shift-ruleset",
        schemaVersion: SHIFT_LAB_SCHEMA_VERSION,
        rulesetId,
        name,
        overtimeApproved: this.overtimeApproved.checked,
        ignoreCapacity: this.ignoreCapacity.checked,
        ignoreFatigue: this.ignoreFatigue.checked,
        canShiftSwap: this.canShiftSwap.checked,
        rules: [],
        createdAt: new Date().toISOString(),
        storageScope: "extension-local"
      };
      this.registry.rulesets.push(record);
      await this.persist();
      this.rulesetId.value = nextScenarioIdentifier(
        "R",
        this.registry.rulesets.map((item) => item.rulesetId)
      );
      this.renderRulesets(record.rulesetId);
      this.exportRegistryButton.disabled = false;
      this.setSummary(`Saved local ruleset ${record.rulesetId} (${record.name}).`, "success");
      showToast("success", "Ruleset saved locally", `${record.rulesetId} is ready for Shift Lab scenarios.`);
    } catch (error) {
      this.setSummary(formatError(error), "error");
    }
  }

  private async saveShift(): Promise<void> {
    try {
      if (!this.selectedLocation) {
        throw new Error("Search for and select an active UAT service location.");
      }
      const occurrenceId = validateScenarioIdentifier(this.occurrenceId.value, "S");
      if (this.registry.shifts.some((item) => item.occurrenceId === occurrenceId)) {
        throw new Error(`Shift occurrence ${occurrenceId} already exists in this local registry.`);
      }
      const shiftName = this.shiftName.value.trim();
      if (!/\bSHIFT\b.*\(\d{3,4}-\d{1,2}\)/i.test(shiftName)) {
        throw new Error("Use a familiar shift name pattern such as D SHIFT (730-16).");
      }
      const office = requireText(this.office.value, "scheduling office");
      const durationHours = calculateShiftDurationHours(this.start.value, this.end.value);
      const payDurationHours = Number(this.payDuration.value);
      if (!Number.isFinite(payDurationHours) || payDurationHours <= 0 || payDurationHours > durationHours) {
        throw new Error("Pay duration must be greater than 0 and no more than shift duration.");
      }
      const rulesetId = this.rulesetSelect.value || undefined;
      if (rulesetId && !this.registry.rulesets.some((item) => item.rulesetId === rulesetId)) {
        throw new Error("The selected local ruleset no longer exists.");
      }
      if (!this.expiresAfter.value || this.expiresAfter.value < this.start.value.slice(0, 10)) {
        throw new Error("Shift expiry must be on or after the shift start date.");
      }
      const record: ShiftScenarioRecord = {
        kind: "ac-tools/shift-scenario",
        schemaVersion: SHIFT_LAB_SCHEMA_VERSION,
        shiftName,
        occurrenceId,
        office,
        serviceLocation: this.selectedLocation,
        costCenter: optionalText(this.costCenter.value),
        rulesetId,
        startLocal: this.start.value,
        endLocal: this.end.value,
        durationHours,
        payDurationHours: Math.round(payDurationHours * 100) / 100,
        overtimeEligibility: this.overtimeEligibility.value as ShiftScenarioRecord["overtimeEligibility"],
        timezone: requireText(this.timezone.value, "timezone"),
        pattern: requireText(this.pattern.value, "shift pattern"),
        expiresAfter: this.expiresAfter.value,
        shiftCode: requireText(this.shiftCode.value, "shift code"),
        swapEvent: optionalText(this.swapEvent.value),
        relationships: {
          clientCohorts: [],
          clientVisits: [],
          employeeCohorts: [],
          employeeAvailability: [],
          employeeAssignments: [],
          allowsServiceLocationOverlap: true
        },
        audit: {
          intakeAt: requireText(this.intakeAt.value, "shift intake date"),
          intakeUser: requireText(this.intakeUser.value, "shift intake user"),
          changedAt: requireText(this.changedAt.value, "shift change date"),
          changedUser: requireText(this.changedUser.value, "shift change user")
        },
        createdAt: new Date().toISOString(),
        storageScope: "extension-local",
        alayaCareNativeRecordCreated: false
      };
      this.registry.shifts.push(record);
      this.lastShift = record;
      await this.persist();
      this.occurrenceId.value = nextScenarioIdentifier(
        "S",
        this.registry.shifts.map((item) => item.occurrenceId)
      );
      this.renderShifts();
      this.exportShiftButton.disabled = false;
      this.exportRegistryButton.disabled = false;
      this.setSummary(
        `Saved ${record.occurrenceId} locally: ${record.shiftName}, ${record.durationHours} h, unassigned, ${record.serviceLocation.label}. No native AlayaCare visit was created.`,
        "success"
      );
      showToast("success", "Shift scenario saved locally", `${record.occurrenceId} is ready to export and inspect.`);
    } catch (error) {
      this.setSummary(formatError(error), "error");
    }
  }

  private async persist(): Promise<void> {
    await chrome.storage.local.set({ [SHIFT_LAB_STORAGE_KEY]: this.registry });
  }

  private updateDuration(): void {
    try {
      this.duration.value = `${calculateShiftDurationHours(this.start.value, this.end.value)} hours`;
    } catch {
      this.duration.value = "—";
    }
  }

  private renderRulesets(selectedId = this.rulesetSelect.value): void {
    this.rulesetList.replaceChildren();
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "No ruleset";
    this.rulesetSelect.replaceChildren(emptyOption);
    for (const item of this.registry.rulesets) {
      const option = document.createElement("option");
      option.value = item.rulesetId;
      option.textContent = `${item.name} (${item.rulesetId})`;
      this.rulesetSelect.append(option);

      const card = document.createElement("article");
      card.className = "shift-record-card";
      const title = document.createElement("strong");
      title.textContent = `${item.name} · ${item.rulesetId}`;
      const metadata = document.createElement("span");
      metadata.textContent = [
        `OT ${item.overtimeApproved ? "approved" : "not approved"}`,
        `Capacity ${item.ignoreCapacity ? "ignored" : "enforced"}`,
        `Fatigue ${item.ignoreFatigue ? "ignored" : "enforced"}`,
        item.canShiftSwap ? "Swap allowed" : "Swap blocked"
      ].join(" · ");
      const actions = document.createElement("div");
      actions.className = "shift-record-card__actions";
      actions.append(
        createCardButton("Use", () => {
          this.rulesetSelect.value = item.rulesetId;
          this.overtimeEligibility.value = "Ruleset";
          this.renderFixtureEvaluation();
        }),
        createCardButton("Copy JSON", () => void this.copyRecordJson(item, item.rulesetId)),
        createCardButton("Delete", () => void this.deleteRuleset(item.rulesetId), "button--danger")
      );
      card.append(title, metadata, actions);
      this.rulesetList.append(card);
    }
    this.rulesetSelect.value = this.registry.rulesets.some((item) => item.rulesetId === selectedId)
      ? selectedId
      : "";
    if (this.registry.rulesets.length === 0) this.rulesetList.textContent = "No local rulesets yet.";
    this.renderFixtureEvaluation();
  }

  private renderShifts(): void {
    this.shiftList.replaceChildren();
    for (const item of [...this.registry.shifts].reverse().slice(0, 8)) {
      const card = document.createElement("article");
      card.className = "shift-record-card";
      const title = document.createElement("strong");
      title.textContent = `${item.shiftName} · ${item.occurrenceId}`;
      const metadata = document.createElement("span");
      metadata.textContent = `${item.startLocal.replace("T", " ")}–${item.endLocal.slice(11)} · ${item.durationHours} h · ${item.serviceLocation.label}`;
      const actions = document.createElement("div");
      actions.className = "shift-record-card__actions";
      const json = document.createElement("pre");
      json.className = "shift-record-card__json";
      json.hidden = true;
      json.textContent = JSON.stringify(item, null, 2);
      actions.append(
        createCardButton("View JSON", () => {
          json.hidden = !json.hidden;
        }),
        createCardButton("Duplicate", () => this.loadShiftAsDraft(item)),
        createCardButton("Copy JSON", () => void this.copyRecordJson(item, item.occurrenceId)),
        createCardButton("Delete", () => void this.deleteShift(item.occurrenceId), "button--danger")
      );
      card.append(title, metadata, actions, json);
      this.shiftList.append(card);
    }
    if (this.registry.shifts.length === 0) this.shiftList.textContent = "No local shift scenarios yet.";
  }

  private renderAssessments(): void {
    this.updateDuration();
    this.renderFixtureEvaluation();
    this.renderNativeReadiness();
  }

  private renderFixtureEvaluation(): void {
    let durationHours: number | undefined;
    try {
      durationHours = calculateShiftDurationHours(this.start.value, this.end.value);
    } catch {
      durationHours = undefined;
    }
    const ruleset = this.registry.rulesets.find((item) => item.rulesetId === this.rulesetSelect.value);
    const evaluation = evaluateShiftFixture({
      overtimeEligibility: this.overtimeEligibility.value as ShiftScenarioRecord["overtimeEligibility"],
      durationHours,
      payDurationHours: Number(this.payDuration.value),
      ruleset
    });
    this.fixtureEvaluation.dataset.status = evaluation.status;
    this.fixtureEvaluationBadge.textContent = evaluation.status === "ready" ? "Ready locally" : "Blocked";
    this.fixtureEvaluationSummary.textContent = evaluation.summary;
    renderAssessmentItems(this.fixtureEvaluationList, evaluation.items);
  }

  private renderNativeReadiness(): void {
    let hasValidTimes = false;
    try {
      calculateShiftDurationHours(this.start.value, this.end.value);
      hasValidTimes = true;
    } catch {
      hasValidTimes = false;
    }
    const readiness = buildNativeVisitReadiness({
      hasServiceLocation: Boolean(this.selectedLocation),
      hasValidTimes
    });
    this.nativeReadiness.dataset.status = readiness.canCreateNativeVisit ? "ready" : "blocked";
    this.nativeReadinessBadge.textContent = readiness.canCreateNativeVisit ? "Ready" : "Blocked";
    this.nativeReadinessSummary.textContent = readiness.summary;
    renderAssessmentItems(this.nativeReadinessList, readiness.items);
  }

  private loadShiftAsDraft(item: ShiftScenarioRecord): void {
    this.selectedLocation = item.serviceLocation;
    this.confirm.checked = true;
    this.selectedLocationLabel.textContent = `${item.serviceLocation.label} · Account ${item.serviceLocation.accountId}${item.serviceLocation.staffingId ? ` · Staffing ${item.serviceLocation.staffingId}` : ""}`;
    this.occurrenceId.value = nextScenarioIdentifier(
      "S",
      this.registry.shifts.map((record) => record.occurrenceId)
    );
    this.shiftName.value = item.shiftName;
    this.office.value = item.office;
    this.costCenter.value = item.costCenter ?? "";
    this.rulesetSelect.value = item.rulesetId && this.registry.rulesets.some((record) => record.rulesetId === item.rulesetId)
      ? item.rulesetId
      : "";
    this.start.value = item.startLocal;
    this.end.value = item.endLocal;
    this.payDuration.value = String(item.payDurationHours);
    this.overtimeEligibility.value = item.overtimeEligibility;
    this.timezone.value = item.timezone;
    this.pattern.value = item.pattern;
    this.expiresAfter.value = item.expiresAfter;
    this.shiftCode.value = item.shiftCode;
    this.swapEvent.value = item.swapEvent ?? "";
    this.intakeAt.value = item.audit.intakeAt;
    this.intakeUser.value = item.audit.intakeUser;
    this.changedAt.value = item.audit.changedAt;
    this.changedUser.value = item.audit.changedUser;
    this.updateSearchAvailability();
    this.renderAssessments();
    this.setSummary(`Loaded ${item.occurrenceId} as a new draft. Review it before saving.`, "info");
    this.shiftForm.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  private async deleteRuleset(rulesetId: string): Promise<void> {
    if (this.registry.shifts.some((item) => item.rulesetId === rulesetId)) {
      this.setSummary(`Ruleset ${rulesetId} is referenced by a saved shift and cannot be deleted.`, "error");
      return;
    }
    if (!window.confirm(`Delete local ruleset ${rulesetId}? This does not affect AlayaCare.`)) return;
    this.registry.rulesets = this.registry.rulesets.filter((item) => item.rulesetId !== rulesetId);
    await this.persist();
    this.renderRulesets();
    this.exportRegistryButton.disabled = this.registry.shifts.length === 0 && this.registry.rulesets.length === 0;
    this.setSummary(`Deleted local ruleset ${rulesetId}.`, "success");
  }

  private async deleteShift(occurrenceId: string): Promise<void> {
    if (!window.confirm(`Delete local shift fixture ${occurrenceId}? This does not affect AlayaCare.`)) return;
    this.registry.shifts = this.registry.shifts.filter((item) => item.occurrenceId !== occurrenceId);
    this.lastShift = this.registry.shifts.at(-1) ?? null;
    await this.persist();
    this.renderShifts();
    this.exportShiftButton.disabled = !this.lastShift;
    this.exportRegistryButton.disabled = this.registry.shifts.length === 0 && this.registry.rulesets.length === 0;
    this.setSummary(`Deleted local shift fixture ${occurrenceId}.`, "success");
  }

  private async copyRecordJson(value: unknown, label: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(`${JSON.stringify(value, null, 2)}\n`);
      showToast("success", "JSON copied", `${label} is on the clipboard.`);
    } catch {
      this.setSummary("The browser did not allow clipboard access. Use the download action instead.", "error");
    }
  }

  private setSummary(message: string, tone: "info" | "success" | "warning" | "error"): void {
    this.summary.textContent = message;
    this.summary.dataset.tone = tone;
  }
}

function renderAssessmentItems(container: HTMLElement, items: ShiftAssessmentItem[]): void {
  container.replaceChildren();
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "shift-assessment-item";
    row.dataset.tone = item.tone;
    const label = document.createElement("strong");
    label.textContent = item.label;
    const tone = document.createElement("span");
    tone.className = "shift-assessment-item__tone";
    tone.textContent = item.tone === "not-evaluated" ? "Not evaluated" : item.tone;
    const summary = document.createElement("span");
    summary.className = "shift-assessment-item__summary";
    summary.textContent = item.summary;
    row.append(label, tone, summary);
    container.append(row);
  }
}

function createCardButton(
  label: string,
  onClick: () => void,
  modifier?: string
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = ["button", "button--secondary", modifier].filter(Boolean).join(" ");
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function getElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Shift Lab element is missing: ${selector}`);
  return element;
}

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Enter ${label}.`);
  return normalized;
}

function optionalText(value: string): string | undefined {
  return value.trim() || undefined;
}

function downloadJson(value: unknown, filename: string): void {
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
