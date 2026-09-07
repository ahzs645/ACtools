import {
  ALAYACARE_CLIENT_CHART_EXPORT_KIND,
  ALAYACARE_CLIENT_CHART_EXPORT_SCHEMA_VERSION,
  type ClientChartExportSnapshot
} from "./clientChart";

export const ALAYACARE_CLIENT_CHART_IMPORT_SCHEMA_VERSION = 1 as const;

export interface ClientChartImportSectionPreview<T = Record<string, unknown>> {
  available: boolean;
  recordCount: number;
  data?: T;
}

export interface ClientChartProgressNoteImport {
  type: string;
  body: string;
  content_type: string;
}

export type ClientChartMedicationImport = Record<string, unknown>;

export interface ClientChartDestinationGroup {
  id: number;
  name: string;
  description?: string;
}

export interface ClientChartDestinationCostCentre {
  code: string;
  name: string;
}

export interface ClientChartDestinationCatalog {
  tenantOrigin: string;
  groups: ClientChartDestinationGroup[];
  costCentres: ClientChartDestinationCostCentre[];
  sources: {
    groups: string;
    costCentres: string;
  };
}

export interface ClientChartImportPreview {
  schemaVersion: typeof ALAYACARE_CLIENT_CHART_IMPORT_SCHEMA_VERSION;
  sourceTenantOrigin: string;
  sourceClientId: number;
  sourceClientName: string;
  suggestedFirstName: string;
  suggestedLastName: string;
  birthday?: string;
  suggestedGender: "M" | "F" | "O";
  sourceGroupNames: string[];
  medicalHistory: ClientChartImportSectionPreview;
  riskAssessment: ClientChartImportSectionPreview;
  progressNotes: ClientChartImportSectionPreview<ClientChartProgressNoteImport[]>;
  medications: ClientChartImportSectionPreview<ClientChartMedicationImport[]>;
  unsupportedPopulatedSections: string[];
  omittedIdentityFields: string[];
}

export interface ClientChartImportRequest {
  confirmedSynthetic: boolean;
  confirmedCreate: boolean;
  sourceTenantOrigin: string;
  sourceClientId: number;
  sourceClientName: string;
  targetFirstName: string;
  targetLastName: string;
  birthday: string;
  gender: "M" | "F" | "O";
  healthCard: string;
  email?: string;
  phoneMain?: string;
  destinationGroupIds: number[];
  costCentreCode?: string;
  medicalHistoryData?: Record<string, unknown>;
  riskAssessmentData?: Record<string, unknown>;
  progressNotesData?: ClientChartProgressNoteImport[];
  medicationsData?: ClientChartMedicationImport[];
}

export interface ClientChartImportStepResult {
  section: "client" | "medicalHistory" | "riskAssessment" | "progressNotes" | "medications";
  source: string;
  ok: boolean;
  skipped?: boolean;
  status?: number;
  error?: string;
}

export interface ClientChartImportResult {
  schemaVersion: typeof ALAYACARE_CLIENT_CHART_IMPORT_SCHEMA_VERSION;
  importedAt: string;
  tenantOrigin: string;
  sourceClient: { id: number; fullName: string };
  targetClient: {
    id: number;
    routeId: string;
    fullName: string;
    birthday?: string;
    email?: string;
    phoneMain?: string;
    url: string;
    destinationGroups: ClientChartDestinationGroup[];
    costCentre?: ClientChartDestinationCostCentre;
  };
  steps: ClientChartImportStepResult[];
  counts: { requested: number; successful: number; skipped: number; failed: number };
  scope: {
    syntheticUatOnly: true;
    copiedSections: Array<"medicalHistory" | "riskAssessment" | "progressNotes" | "medications">;
    omittedSections: string[];
  };
}

const UNSUPPORTED_IMPORT_SECTIONS = [
  "statusHistory",
  "contacts",
  "clientNotes",
  "careProviderNotes",
  "services",
  "authorizations",
  "carePlans",
  "carePlanDetails",
  "clientForms",
  "documentApprovals",
  "attachmentMetadata",
  "visitAttachmentMetadata",
  "requiredCareSkills",
  "events",
  "visitReports",
  "associatedEmployees",
  "blockedEmployeeDetails",
  "openTasks"
] as const;

export function buildClientChartImportPreview(value: unknown): ClientChartImportPreview {
  const snapshot = readClientChartExportSnapshot(value);
  const demographics = readRecord(snapshot.sections.demographics?.data);
  const medicalHistory = readFirstDocumentData(snapshot, "medicalHistory");
  const riskAssessment = readFirstDocumentData(snapshot, "riskAssessment");
  const progressNotes = sanitizeProgressNotesForImport(readSectionItems(snapshot, "progressNotes"));
  const medications = sanitizeMedicationsForImport(readSectionItems(snapshot, "medications"));
  const overview = readRecord(snapshot.sections.overview?.data);
  const firstName = readString(demographics?.first_name) ?? firstNameFromFullName(snapshot.client.fullName);
  const lastName = readString(demographics?.last_name) ?? lastNameFromFullName(snapshot.client.fullName);

  return {
    schemaVersion: ALAYACARE_CLIENT_CHART_IMPORT_SCHEMA_VERSION,
    sourceTenantOrigin: snapshot.tenantOrigin,
    sourceClientId: snapshot.client.id,
    sourceClientName: snapshot.client.fullName,
    suggestedFirstName: `Test ${firstName || "Client"}`,
    suggestedLastName: `${lastName || "Clone"} Copy`,
    birthday: readString(demographics?.birthday),
    suggestedGender: normalizeGender(demographics?.gender),
    sourceGroupNames: readStringArray(overview?.groups),
    medicalHistory: buildSectionPreview(medicalHistory),
    riskAssessment: buildSectionPreview(sanitizeRiskAssessmentForImport(riskAssessment)),
    progressNotes: buildListSectionPreview(progressNotes),
    medications: buildListSectionPreview(medications),
    unsupportedPopulatedSections: UNSUPPORTED_IMPORT_SECTIONS.filter((name) =>
      hasSectionData(snapshot.sections[name]?.data)
    ),
    omittedIdentityFields: [
      "source client/profile/GUID identifiers",
      "external ID and health card",
      "source address, phone, and email unless entered for the new client",
      "attachments and attachment contents",
      "audit authors, timestamps, and document versions"
    ]
  };
}

function readSectionItems(
  snapshot: ClientChartExportSnapshot,
  sectionName: "progressNotes" | "medications"
): Record<string, unknown>[] {
  const section = snapshot.sections[sectionName];
  if (!section?.ok) return [];
  return readCollectionItems(section.data);
}

function readCollectionItems(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.map(readRecord).filter((item): item is Record<string, unknown> => Boolean(item));
  const record = readRecord(value);
  if (!record) return [];
  return Array.isArray(record.items)
    ? record.items.map(readRecord).filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
}

function buildListSectionPreview<T extends object>(data: T[]): ClientChartImportSectionPreview<T[]> {
  return { available: data.length > 0, recordCount: data.length, data };
}

export function isSyntheticClientName(firstName: string, lastName: string): boolean {
  return /\b(test|synthetic|uat|clone|copy)\b/i.test(`${firstName} ${lastName}`);
}

function readClientChartExportSnapshot(value: unknown): ClientChartExportSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The selected file is not a client-chart JSON object.");
  }
  const candidate = value as Partial<ClientChartExportSnapshot>;
  if (
    candidate.kind !== ALAYACARE_CLIENT_CHART_EXPORT_KIND ||
    candidate.schemaVersion !== ALAYACARE_CLIENT_CHART_EXPORT_SCHEMA_VERSION
  ) {
    throw new Error("Select an AC Tools client-chart export with schema version 1.");
  }
  if (!candidate.scope?.uatOnly) {
    throw new Error("The selected export is not marked as UAT-only.");
  }
  let sourceUrl: URL;
  try {
    sourceUrl = new URL(candidate.tenantOrigin ?? "");
  } catch {
    throw new Error("The selected export is missing a valid tenant origin.");
  }
  if (!sourceUrl.hostname.toLowerCase().includes(".uat.alayacare.")) {
    throw new Error("The selected export did not originate from an AlayaCare UAT tenant.");
  }
  if (
    !candidate.client ||
    !Number.isSafeInteger(candidate.client.id) ||
    typeof candidate.client.fullName !== "string" ||
    !candidate.client.fullName.trim() ||
    !candidate.sections
  ) {
    throw new Error("The selected export is missing its client identity or chart sections.");
  }
  return candidate as ClientChartExportSnapshot;
}

function readFirstDocumentData(
  snapshot: ClientChartExportSnapshot,
  sectionName: "medicalHistory" | "riskAssessment"
): Record<string, unknown> | undefined {
  const section = snapshot.sections[sectionName];
  if (!section?.ok) return undefined;
  const record = readRecord(section.data);
  const items = Array.isArray(record?.items) ? record.items : [];
  const firstItem = items.map(readRecord).find(Boolean);
  return sanitizeClinicalData(readRecord(firstItem?.data));
}

function buildSectionPreview(data?: Record<string, unknown>): ClientChartImportSectionPreview {
  const recordCount = countClinicalRecords(data);
  return {
    available: recordCount > 0,
    recordCount,
    data
  };
}

function sanitizeClinicalData(
  value: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!value) return undefined;
  return sanitizeValue(value) as Record<string, unknown>;
}

export function sanitizeMedicalHistoryForImport(
  data: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  return sanitizeClinicalData(data);
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (
      [
        "id",
        "author",
        "account_id",
        "user_id",
        "schema_id",
        "schema_version",
        "version",
        "created_at",
        "updated_at",
        "external_id"
      ].includes(key)
    ) {
      continue;
    }
    result[key] = sanitizeValue(child);
  }
  return result;
}

export function sanitizeRiskAssessmentForImport(
  data: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!data) return undefined;
  const risks = Array.isArray(data.risks)
    ? data.risks.flatMap((value) => {
        const risk = readRecord(value);
        if (!risk) return [];
        const riskName = readString(risk.risk);
        const category = readString(risk.category);
        const severity = typeof risk.severity === "number" ? risk.severity : Number(risk.severity);
        if (!riskName || !category || !Number.isInteger(severity) || severity < 0 || severity > 5) {
          return [];
        }
        const sanitized: Record<string, unknown> = { risk: riskName, category, severity };
        const effectiveFrom = readString(risk.effective_from);
        const effectiveThrough = readString(risk.effective_through);
        if (effectiveFrom) sanitized.effective_from = effectiveFrom;
        if (effectiveThrough) sanitized.effective_through = effectiveThrough;
        return [sanitized];
      })
    : [];
  return { risks };
}

export function sanitizeProgressNotesForImport(
  values: Array<Record<string, unknown> | ClientChartProgressNoteImport> | undefined
): ClientChartProgressNoteImport[] {
  if (!values) return [];
  return values.flatMap((note) => {
    const record = note as Record<string, unknown>;
    if (record.archived === true || record.deleted === true) return [];
    const type = readString(record.type);
    const body = readString(record.body);
    if (!type || !body) return [];
    return [{ type, body, content_type: readString(record.content_type) ?? "text/html" }];
  });
}

const MEDICATION_IMPORT_FIELDS = new Set([
  "administration_instructions", "administration_site_details", "administration_type",
  "brand_name", "count", "days_of_month", "dosage", "dosage_form",
  "dosage_unit", "drug_family", "drug_info_number", "duration", "duration_unit",
  "end_date", "end_date_unknown", "end_time", "end_time_unknown", "frequency", "frequency_max",
  "frequency_setting", "high_alert", "ingredient_strength", "ingredient_strength_unit",
  "interval", "interval_max", "min_timings_count", "max_timings_count",
  "min_weekdays_count", "max_weekdays_count", "min_days_of_month_count",
  "max_days_of_month_count", "name", "narcotic", "ordering_physician", "period", "period_max",
  "period_unit", "prn_as_needed", "prn_reason", "purpose", "route", "start_date",
  "start_date_unknown", "start_time", "start_time_unknown", "status", "strict", "time_of_day",
  "timings", "types", "website", "weekdays", "when", "admin_timings_unknown"
]);

export function sanitizeMedicationsForImport(
  values: Record<string, unknown>[] | undefined
): ClientChartMedicationImport[] {
  if (!values) return [];
  return values.flatMap((medication) => {
    if (medication.is_archived === true) return [];
    const name = readString(medication.name);
    if (!name) return [];
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(medication)) {
      if (MEDICATION_IMPORT_FIELDS.has(key) && value !== null && value !== undefined) {
        sanitized[key] = sanitizeValue(value);
      }
    }
    sanitized.name = name;
    sanitized.start_time_unknown =
      typeof sanitized.start_time_unknown === "boolean"
        ? sanitized.start_time_unknown
        : !readString(sanitized.start_time);
    sanitized.end_time_unknown =
      typeof sanitized.end_time_unknown === "boolean"
        ? sanitized.end_time_unknown
        : !readString(sanitized.end_time);
    sanitized.admin_timings_unknown =
      typeof sanitized.admin_timings_unknown === "boolean"
        ? sanitized.admin_timings_unknown
        : false;
    sanitized.administration_instructions =
      readString(sanitized.administration_instructions) ?? "";
    Object.assign(sanitized, {
      information_source: "",
      discrepancy_type: "",
      discrepancy_status: "",
      discrepancy_note: "",
      healthcare_professional_notified: "",
      needs_education: false,
      cms_485_status: "new"
    });
    return [sanitized];
  });
}

function normalizeGender(value: unknown): "M" | "F" | "O" {
  const normalized = readString(value)?.toUpperCase();
  return normalized === "M" || normalized === "F" ? normalized : "O";
}

function countClinicalRecords(value: unknown): number {
  if (Array.isArray(value)) {
    return value.reduce((total, child) => total + (isMeaningfulRecord(child) ? 1 : 0), 0);
  }
  if (!value || typeof value !== "object") return value === null || value === "" ? 0 : 1;
  return Object.values(value as Record<string, unknown>).reduce<number>(
    (total, child) => total + countClinicalRecords(child),
    0
  );
}

function isMeaningfulRecord(value: unknown): boolean {
  if (!value || typeof value !== "object") return value !== null && value !== "";
  return Object.values(value as Record<string, unknown>).some(
    (child) => child !== null && child !== "" && child !== false
  );
}

function hasSectionData(value: unknown): boolean {
  const record = readRecord(value);
  if (!record) return Array.isArray(value) ? value.length > 0 : Boolean(value);
  if (record.format === "html-tables" && Array.isArray(record.tables)) {
    return record.tables.some((table) => {
      const tableRecord = readRecord(table);
      return Array.isArray(tableRecord?.rows) && tableRecord.rows.length > 0;
    });
  }
  if (Array.isArray(record.items)) return record.items.length > 0;
  if (typeof record.count === "number") return record.count > 0;
  return Object.keys(record).length > 0;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(readString).filter((item): item is string => Boolean(item)))];
}

function firstNameFromFullName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? "";
}

function lastNameFromFullName(fullName: string): string {
  return fullName.trim().split(/\s+/).slice(1).join(" ");
}
