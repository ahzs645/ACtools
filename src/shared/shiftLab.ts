export const SHIFT_LAB_STORAGE_KEY = "ac-tools-shift-lab-registry";
export const SHIFT_LAB_SCHEMA_VERSION = 1 as const;

export interface ShiftServiceLocation {
  tenantOrigin: string;
  accountId: number;
  staffingId?: number;
  branchId: number;
  label: string;
  type: "CustomerStaffingPosition";
}

export interface ShiftServiceLocationSearchResponse {
  query: string;
  tenantOrigin: string;
  items: ShiftServiceLocation[];
  sources: string[];
}

export interface ShiftRulesetRecord {
  kind: "ac-tools/shift-ruleset";
  schemaVersion: typeof SHIFT_LAB_SCHEMA_VERSION;
  rulesetId: string;
  name: string;
  overtimeApproved: boolean;
  ignoreCapacity: boolean;
  ignoreFatigue: boolean;
  canShiftSwap: boolean;
  rules: [];
  createdAt: string;
  storageScope: "extension-local";
}

export interface ShiftScenarioRecord {
  kind: "ac-tools/shift-scenario";
  schemaVersion: typeof SHIFT_LAB_SCHEMA_VERSION;
  shiftName: string;
  occurrenceId: string;
  office: string;
  serviceLocation: ShiftServiceLocation;
  costCenter?: string;
  rulesetId?: string;
  startLocal: string;
  endLocal: string;
  durationHours: number;
  payDurationHours: number;
  overtimeEligibility: "Approved" | "Not approved" | "Ruleset";
  timezone: string;
  pattern: string;
  expiresAfter: string;
  shiftCode: string;
  swapEvent?: string;
  relationships: {
    clientCohorts: [];
    clientVisits: [];
    employeeCohorts: [];
    employeeAvailability: [];
    employeeAssignments: [];
    allowsServiceLocationOverlap: true;
  };
  audit: {
    intakeAt: string;
    intakeUser: string;
    changedAt: string;
    changedUser: string;
  };
  createdAt: string;
  storageScope: "extension-local";
  alayaCareNativeRecordCreated: false;
}

export interface ShiftLabRegistry {
  schemaVersion: typeof SHIFT_LAB_SCHEMA_VERSION;
  rulesets: ShiftRulesetRecord[];
  shifts: ShiftScenarioRecord[];
}

export type ShiftAssessmentTone = "pass" | "warning" | "blocked" | "not-evaluated";

export interface ShiftAssessmentItem {
  id: string;
  label: string;
  tone: ShiftAssessmentTone;
  summary: string;
}

export interface ShiftFixtureEvaluation {
  status: "ready" | "blocked";
  summary: string;
  items: ShiftAssessmentItem[];
}

export interface NativeVisitReadiness {
  canCreateNativeVisit: boolean;
  summary: string;
  items: ShiftAssessmentItem[];
}

export const EMPTY_SHIFT_LAB_REGISTRY: ShiftLabRegistry = {
  schemaVersion: SHIFT_LAB_SCHEMA_VERSION,
  rulesets: [],
  shifts: []
};

export function parseShiftLabRegistry(value: unknown): ShiftLabRegistry {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return structuredClone(EMPTY_SHIFT_LAB_REGISTRY);
  }
  const candidate = value as Partial<ShiftLabRegistry>;
  if (candidate.schemaVersion !== SHIFT_LAB_SCHEMA_VERSION) {
    return structuredClone(EMPTY_SHIFT_LAB_REGISTRY);
  }
  return {
    schemaVersion: SHIFT_LAB_SCHEMA_VERSION,
    rulesets: Array.isArray(candidate.rulesets) ? candidate.rulesets : [],
    shifts: Array.isArray(candidate.shifts) ? candidate.shifts : []
  };
}

export function nextScenarioIdentifier(prefix: "S" | "R", existing: string[]): string {
  const values = existing
    .filter((value) => new RegExp(`^${prefix}\\d{10}$`).test(value))
    .map((value) => Number(value.slice(1)))
    .filter(Number.isSafeInteger);
  const next = Math.max(0, ...values) + 1;
  return `${prefix}${String(next).padStart(10, "0")}`;
}

export function calculateShiftDurationHours(startLocal: string, endLocal: string): number {
  const start = new Date(startLocal);
  const end = new Date(endLocal);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    throw new Error("Enter valid shift start and end values.");
  }
  const hours = (end.getTime() - start.getTime()) / 3_600_000;
  if (hours <= 0 || hours > 24) {
    throw new Error("Shift duration must be greater than 0 and no more than 24 hours.");
  }
  return Math.round(hours * 100) / 100;
}

export function validateScenarioIdentifier(value: string, prefix: "S" | "R"): string {
  const normalized = value.trim().toUpperCase();
  if (!new RegExp(`^${prefix}\\d{10}$`).test(normalized)) {
    throw new Error(`${prefix === "S" ? "Shift occurrence" : "Ruleset ID"} must use ${prefix} followed by 10 digits.`);
  }
  return normalized;
}

export function evaluateShiftFixture(input: {
  overtimeEligibility: ShiftScenarioRecord["overtimeEligibility"];
  durationHours?: number;
  payDurationHours?: number;
  ruleset?: ShiftRulesetRecord;
}): ShiftFixtureEvaluation {
  const items: ShiftAssessmentItem[] = [];
  const durationIsValid = Number.isFinite(input.durationHours) && (input.durationHours ?? 0) > 0;
  const payIsValid = Number.isFinite(input.payDurationHours)
    && (input.payDurationHours ?? 0) > 0
    && (input.payDurationHours ?? 0) <= (input.durationHours ?? 0);

  items.push({
    id: "duration",
    label: "Duration and pay",
    tone: durationIsValid && payIsValid ? "pass" : "blocked",
    summary: durationIsValid && payIsValid
      ? `${input.durationHours} scheduled hours and ${input.payDurationHours} paid hours are internally valid.`
      : "Enter valid times and a pay duration no greater than the scheduled duration."
  });

  if (input.overtimeEligibility === "Approved") {
    items.push({ id: "overtime", label: "Overtime", tone: "pass", summary: "Approved directly by the shift fixture." });
  } else if (input.overtimeEligibility === "Not approved") {
    items.push({ id: "overtime", label: "Overtime", tone: "warning", summary: "The shift fixture explicitly does not approve overtime." });
  } else if (!input.ruleset) {
    items.push({ id: "overtime", label: "Overtime", tone: "blocked", summary: "“Use ruleset” is selected, but no local ruleset is attached." });
  } else {
    items.push({
      id: "overtime",
      label: "Overtime",
      tone: input.ruleset.overtimeApproved ? "pass" : "warning",
      summary: input.ruleset.overtimeApproved
        ? `Approved by ${input.ruleset.name} (${input.ruleset.rulesetId}).`
        : `Not approved by ${input.ruleset.name} (${input.ruleset.rulesetId}).`
    });
  }

  items.push(evaluateUnavailableConstraint("capacity", "Capacity", input.ruleset?.ignoreCapacity));
  items.push(evaluateUnavailableConstraint("fatigue", "Fatigue", input.ruleset?.ignoreFatigue));
  items.push(input.ruleset
    ? {
        id: "swap",
        label: "Shift swap",
        tone: input.ruleset.canShiftSwap ? "pass" : "warning",
        summary: input.ruleset.canShiftSwap ? "Allowed by the attached local ruleset." : "Blocked by the attached local ruleset."
      }
    : {
        id: "swap",
        label: "Shift swap",
        tone: "not-evaluated",
        summary: "No local ruleset is attached."
      });
  items.push({
    id: "assignments",
    label: "Assignments",
    tone: "pass",
    summary: "The fixture remains unassigned: all client and employee relationship collections are empty."
  });

  const blocked = items.some((item) => item.tone === "blocked");
  return {
    status: blocked ? "blocked" : "ready",
    summary: blocked
      ? "The local fixture has blocking validation issues."
      : "The local fixture is internally consistent. Unevaluated UAT constraints remain clearly marked.",
    items
  };
}

export function buildNativeVisitReadiness(input: {
  hasServiceLocation: boolean;
  hasValidTimes: boolean;
  patientId?: number;
  serviceId?: number;
}): NativeVisitReadiness {
  const items: ShiftAssessmentItem[] = [
    {
      id: "service-location",
      label: "Service location",
      tone: input.hasServiceLocation ? "pass" : "blocked",
      summary: input.hasServiceLocation
        ? "A live UAT staffing-position reference is selected."
        : "Resolve and select a live UAT staffing position."
    },
    {
      id: "times",
      label: "Visit times",
      tone: input.hasValidTimes ? "pass" : "blocked",
      summary: input.hasValidTimes ? "Start and end can map to native visit times." : "Enter a valid start and end time."
    },
    {
      id: "client",
      label: "Client",
      tone: input.patientId ? "pass" : "blocked",
      summary: input.patientId
        ? `Resolved patient ID ${input.patientId}.`
        : "No client/patient is resolved. A native AlayaCare visit requires one."
    },
    {
      id: "service",
      label: "Client service",
      tone: input.serviceId ? "pass" : "blocked",
      summary: input.serviceId
        ? `Resolved service ID ${input.serviceId}.`
        : "No active client service is resolved. A native AlayaCare visit requires one."
    },
    {
      id: "employee",
      label: "Employee",
      tone: "pass",
      summary: "Optional for an unassigned native visit."
    },
    {
      id: "local-fields",
      label: "Shift-specific fields",
      tone: "not-evaluated",
      summary: "Name, occurrence, pay, pattern, expiry, ruleset, and audit fields have no native scheduler mapping and remain local-only."
    }
  ];
  const canCreateNativeVisit = items.every((item) => item.tone !== "blocked");
  return {
    canCreateNativeVisit,
    summary: canCreateNativeVisit
      ? "All native visit prerequisites are resolved. Creation would still require a separate confirmation step."
      : "Native visit creation is unavailable until every required UAT mapping is resolved.",
    items
  };
}

function evaluateUnavailableConstraint(
  id: "capacity" | "fatigue",
  label: string,
  ignored: boolean | undefined
): ShiftAssessmentItem {
  if (ignored === true) {
    return {
      id,
      label,
      tone: "warning",
      summary: `${label} checking is bypassed by the attached local ruleset.`
    };
  }
  return {
    id,
    label,
    tone: "not-evaluated",
    summary: `${label} is enforced by the fixture, but no live ${id} data has been loaded, so it was not evaluated.`
  };
}
