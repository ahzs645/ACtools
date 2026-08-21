import {
  ALAYACARE_CLIENT_CHART_EXPORT_KIND,
  ALAYACARE_CLIENT_CHART_EXPORT_SCHEMA_VERSION,
  type ClientChartExportSnapshot
} from "./clientChart";

export const ALAYACARE_CLIENT_CHART_IMPORT_SCHEMA_VERSION = 1 as const;

export interface ClientChartImportSectionPreview {
  available: boolean;
  recordCount: number;
  data?: Record<string, unknown>;
}

export interface ClientChartImportPreview {
  schemaVersion: typeof ALAYACARE_CLIENT_CHART_IMPORT_SCHEMA_VERSION;
  sourceTenantOrigin: string;
  sourceClientId: number;
  sourceClientName: string;
  suggestedFirstName: string;
  suggestedLastName: string;
  birthday?: string;
  medicalHistory: ClientChartImportSectionPreview;
  riskAssessment: ClientChartImportSectionPreview;
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
  birthday?: string;
  medicalHistoryData?: Record<string, unknown>;
  riskAssessmentData?: Record<string, unknown>;
}

export interface ClientChartImportStepResult {
  section: "client" | "medicalHistory" | "riskAssessment";
  source: string;
  ok: boolean;
  status?: number;
  error?: string;
}

export interface ClientChartImportResult {
  schemaVersion: typeof ALAYACARE_CLIENT_CHART_IMPORT_SCHEMA_VERSION;
  importedAt: string;
  tenantOrigin: string;
  sourceClient: { id: number; fullName: string };
  targetClient: { id: number; routeId: string; fullName: string; url: string };
  steps: ClientChartImportStepResult[];
  counts: { requested: number; successful: number; failed: number };
  scope: {
    syntheticUatOnly: true;
    copiedSections: Array<"medicalHistory" | "riskAssessment">;
    omittedSections: string[];
  };
}

const UNSUPPORTED_IMPORT_SECTIONS = [
  "contacts",
  "clientNotes",
  "careProviderNotes",
  "progressNotes",
  "services",
  "carePlans",
  "carePlanDetails",
  "clientForms",
  "documentApprovals",
  "medications",
  "attachmentMetadata",
  "visitAttachmentMetadata",
  "openTasks"
] as const;

export function buildClientChartImportPreview(value: unknown): ClientChartImportPreview {
  const snapshot = readClientChartExportSnapshot(value);
  const demographics = readRecord(snapshot.sections.demographics?.data);
  const medicalHistory = readFirstDocumentData(snapshot, "medicalHistory");
  const riskAssessment = readFirstDocumentData(snapshot, "riskAssessment");
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
    medicalHistory: buildSectionPreview(medicalHistory),
    riskAssessment: buildSectionPreview(sanitizeRiskAssessmentForImport(riskAssessment)),
    unsupportedPopulatedSections: UNSUPPORTED_IMPORT_SECTIONS.filter((name) =>
      hasSectionData(snapshot.sections[name]?.data)
    ),
    omittedIdentityFields: [
      "source client/profile/GUID identifiers",
      "external ID and health card",
      "address, phone, and email",
      "attachments and attachment contents",
      "audit authors, timestamps, and document versions"
    ]
  };
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

function firstNameFromFullName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? "";
}

function lastNameFromFullName(fullName: string): string {
  return fullName.trim().split(/\s+/).slice(1).join(" ");
}
