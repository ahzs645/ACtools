export const ALAYACARE_FORM_CONTEXT_CATALOG_KIND = "alayacare-form-context-catalog" as const;
export const ALAYACARE_FORM_CONTEXT_CATALOG_SCHEMA_VERSION = 1 as const;

export interface AlayaCareCatalogOption {
  label: string;
  value: string;
}

export interface AlayaCareCatalogField {
  contextName: string;
  contextLabel: string;
  module: string | null;
  section: string | null;
  subsection: string | null;
  family: string | null;
  chartFieldLabel: string;
  formContextFieldName: string;
  tag: string;
  nativeType: string;
  profileInputType: string;
  normalizedType: string;
  sortOrder: number | null;
  options: AlayaCareCatalogOption[];
}

export interface AlayaCareFormContextCatalogSnapshot {
  kind: typeof ALAYACARE_FORM_CONTEXT_CATALOG_KIND;
  schemaVersion: typeof ALAYACARE_FORM_CONTEXT_CATALOG_SCHEMA_VERSION;
  exportedAt: string;
  tenantOrigin: string;
  sources: {
    contexts: string;
    fields: string;
    profileAttributes: string;
    configuration: string;
    countries: string;
  };
  counts: {
    contexts: number;
    fields: number;
    options: number;
  };
  fields: AlayaCareCatalogField[];
}

export interface AlayaCareCatalogApiPayload {
  tenantOrigin: string;
  contexts: unknown;
  fields: unknown;
  profileAttributes: unknown;
  configuration: unknown;
  countries: unknown;
  exportedAt?: string;
}

const PATIENT_PATH = {
  module: "Clients",
  section: "Client Info",
  subsection: "Demographics"
};

export function buildAlayaCareFormContextCatalog(
  payload: AlayaCareCatalogApiPayload
): AlayaCareFormContextCatalogSnapshot {
  const contexts = toItems(payload.contexts);
  const fields = toItems(payload.fields);
  const profileAttributes = toItems(payload.profileAttributes);
  const countries = toItems(payload.countries);
  const configuration = firstRecord(payload.configuration);
  const genders = toItems(configuration?.genders);
  const contextById = new Map<string, Record<string, unknown>>();
  const profileAttributeByTag = new Map<string, Record<string, unknown>>();

  contexts.forEach((context) => {
    const id = readIdentifier(context.id);
    if (id) contextById.set(id, context);
  });
  profileAttributes.forEach((attribute) => {
    const tag = readString(attribute.tag);
    if (tag) profileAttributeByTag.set(tag, attribute);
  });

  const normalizedFields = fields.flatMap((field) => {
    const assignments = toItems(field.contexts);
    const effectiveAssignments = assignments.length > 0 ? assignments : [{}];
    const tag = readString(field.tag) ?? "";
    const nativeType = readString(field.type) ?? readString(field.input_type) ?? "unknown";
    const profileAttribute = profileAttributeByTag.get(tag);
    const profileInputType = readString(profileAttribute?.input_type) ?? nativeType;

    return effectiveAssignments.map((assignment) => {
      const contextRecord = resolveContextRecord(assignment, contextById);
      const contextName =
        readString(nestedValue(assignment.context, "name")) ??
        readString(assignment.context) ??
        readString(assignment.context_name) ??
        readString(contextRecord?.name) ??
        "Unknown";
      const contextLabel =
        readString(nestedValue(assignment.context, "label")) ??
        readString(assignment.context_label) ??
        readString(contextRecord?.label) ??
        readString(contextRecord?.description) ??
        contextName;
      const formContextFieldName =
        readString(field.description) ?? readString(field.name) ?? readString(field.label) ?? tag;
      const chartFieldLabel =
        readString(assignment.label) ?? readString(field.label) ?? formContextFieldName;
      const family =
        readString(nestedValue(assignment.family, "name")) ??
        readString(assignment.family) ??
        readString(nestedValue(field.family, "name")) ??
        readString(field.family) ??
        readString(profileAttribute?.family_description) ??
        null;
      const options = firstNonEmptyOptions([
        assignment.options,
        field.options,
        profileAttribute?.options,
        nativeType === "gender" ? genders : null,
        nativeType === "country" ? countries : null
      ]);
      const path = contextName === "Patient" ? PATIENT_PATH : null;

      return {
        contextName,
        contextLabel,
        module: path?.module ?? null,
        section: path?.section ?? null,
        subsection: path?.subsection ?? null,
        family,
        chartFieldLabel,
        formContextFieldName,
        tag,
        nativeType,
        profileInputType,
        normalizedType: normalizeFieldType(nativeType),
        sortOrder: readNumber(assignment.sort_order) ?? readNumber(field.sort_order),
        options
      } satisfies AlayaCareCatalogField;
    });
  });

  const deduplicatedFields = Array.from(
    new Map(
      normalizedFields.map((field) => [
        [field.contextName, field.tag, field.formContextFieldName].join("::"),
        field
      ])
    ).values()
  ).sort(compareCatalogFields);

  return {
    kind: ALAYACARE_FORM_CONTEXT_CATALOG_KIND,
    schemaVersion: ALAYACARE_FORM_CONTEXT_CATALOG_SCHEMA_VERSION,
    exportedAt: payload.exportedAt ?? new Date().toISOString(),
    tenantOrigin: payload.tenantOrigin,
    sources: {
      contexts: "/api/v1/agency/form-context/contexts",
      fields: "/api/v1/agency/form-context/fields?include_contexts=true",
      profileAttributes: "/api/v1/config/profile_attributes",
      configuration: "/api/v1/config/ (genders only)",
      countries: "/api/v1/config/countries?only_supported=true&include_subdivisions=false"
    },
    counts: {
      contexts: contexts.length,
      fields: deduplicatedFields.length,
      options: deduplicatedFields.reduce((sum, field) => sum + field.options.length, 0)
    },
    fields: deduplicatedFields
  };
}

function toItems(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];
  if (Array.isArray(value.items)) return value.items.filter(isRecord);
  if (Array.isArray(value.results)) return value.results.filter(isRecord);
  return [];
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return value.find(isRecord) ?? null;
  return isRecord(value) ? value : null;
}

function resolveContextRecord(
  assignment: Record<string, unknown>,
  contextById: Map<string, Record<string, unknown>>
): Record<string, unknown> | null {
  if (isRecord(assignment.context)) return assignment.context;
  const id =
    readIdentifier(assignment.context_id) ??
    readIdentifier(assignment.context) ??
    readIdentifier(assignment.form_context_id);
  return id ? contextById.get(id) ?? null : null;
}

function firstNonEmptyOptions(candidates: unknown[]): AlayaCareCatalogOption[] {
  for (const candidate of candidates) {
    const options = normalizeOptions(candidate);
    if (options.length > 0) return options;
  }
  return [];
}

function normalizeOptions(value: unknown): AlayaCareCatalogOption[] {
  if (!Array.isArray(value)) return [];
  const options = value.flatMap((entry): AlayaCareCatalogOption[] => {
    if (typeof entry === "string" || typeof entry === "number") {
      const normalized = String(entry);
      return [{ label: normalized, value: normalized }];
    }
    if (!isRecord(entry)) return [];
    const label =
      readString(entry.label) ?? readString(entry.name) ?? readString(entry.description) ??
      readIdentifier(entry.value) ?? readIdentifier(entry.code) ?? readIdentifier(entry.id);
    const optionValue =
      readIdentifier(entry.value) ?? readIdentifier(entry.code) ?? readIdentifier(entry.id) ?? label;
    return label && optionValue ? [{ label, value: optionValue }] : [];
  });
  return Array.from(new Map(options.map((option) => [option.value, option])).values());
}

function normalizeFieldType(nativeType: string): string {
  switch (nativeType.toLowerCase()) {
    case "text":
      return "free_text";
    case "textarea":
      return "long_text";
    case "phone":
      return "phone";
    case "email":
      return "email";
    case "gender":
    case "list":
    case "country":
    case "region":
      return "dropdown";
    case "date":
    case "bday":
      return "date";
    case "checkbox":
      return "checkbox";
    case "tags":
    case "tags_v2":
      return "multi_select";
    default:
      return nativeType.toLowerCase();
  }
}

function compareCatalogFields(left: AlayaCareCatalogField, right: AlayaCareCatalogField): number {
  return (
    left.contextLabel.localeCompare(right.contextLabel) ||
    (left.family ?? "").localeCompare(right.family ?? "") ||
    (left.sortOrder ?? Number.MAX_SAFE_INTEGER) - (right.sortOrder ?? Number.MAX_SAFE_INTEGER) ||
    left.chartFieldLabel.localeCompare(right.chartFieldLabel)
  );
}

function nestedValue(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readIdentifier(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return readString(value);
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
