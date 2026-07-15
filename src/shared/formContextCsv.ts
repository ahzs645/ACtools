import type {
  AlayaCareCatalogField,
  AlayaCareFormContextCatalogSnapshot
} from "./formContextCatalog";
import {
  ALAYACARE_FORM_CONTEXT_ANNOTATIONS,
  type AlayaCareFormContextAnnotation
} from "./formContextAnnotations.generated";

export const ALAYACARE_CATALOG_CSV_HEADERS = [
  "SubSubSection",
  "Chart Field Label",
  "Form Context Field Name",
  "Field Type",
  "Description",
  "Populates Client Quick Look?",
  "Can Be Written Using Forms?",
  "Writes to AlayaAssessments?",
  "AlayaAssessments CA",
  "AlayaAssessments HC",
  "AlayaAssessment LTCH",
  "Note"
] as const;

export interface AlayaCareCatalogCsvResult {
  csv: string;
  rowCount: number;
  matchedAnnotationCount: number;
  liveOnlyCount: number;
}

export function buildAlayaCareCatalogCsv(
  snapshot: AlayaCareFormContextCatalogSnapshot
): AlayaCareCatalogCsvResult {
  const patientFields = snapshot.fields.filter((field) => field.contextName === "Patient");
  const usedFieldIndexes = new Set<number>();
  let matchedAnnotationCount = 0;
  const rows = ALAYACARE_FORM_CONTEXT_ANNOTATIONS.map((annotation) => {
    const matchIndex = findLiveFieldIndex(annotation, patientFields, usedFieldIndexes);
    if (matchIndex < 0) return annotationRow(annotation);
    usedFieldIndexes.add(matchIndex);
    matchedAnnotationCount += 1;
    return mergedRow(patientFields[matchIndex], annotation);
  });
  const liveOnlyFields = patientFields.filter((_field, index) => !usedFieldIndexes.has(index));
  liveOnlyFields.forEach((field) => rows.push(liveFieldRow(field)));

  const csvRows = [ALAYACARE_CATALOG_CSV_HEADERS, ...rows];
  return {
    csv: `\uFEFF${csvRows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`,
    rowCount: rows.length,
    matchedAnnotationCount,
    liveOnlyCount: liveOnlyFields.length
  };
}

function findLiveFieldIndex(
  annotation: AlayaCareFormContextAnnotation,
  fields: AlayaCareCatalogField[],
  usedIndexes: Set<number>
): number {
  if (isUnavailable(annotation.formContextFieldName)) return -1;
  const candidates = fields
    .map((field, index) => ({ field, index }))
    .filter(({ index }) => !usedIndexes.has(index));
  const tests: Array<(field: AlayaCareCatalogField) => boolean> = [
    (field) => sameText(field.formContextFieldName, annotation.formContextFieldName),
    (field) => sameText(field.tag, annotation.formContextFieldName),
    (field) => sameText(bindingAlias(field.tag), annotation.formContextFieldName),
    (field) => sameText(field.chartFieldLabel, annotation.chartFieldLabel)
  ];

  for (const test of tests) {
    const matches = candidates.filter(({ field }) => test(field));
    if (matches.length === 1) return matches[0].index;
    if (matches.length > 1) {
      const familyMatches = matches.filter(({ field }) =>
        sameText(field.family, annotation.subSubSection)
      );
      if (familyMatches.length === 1) return familyMatches[0].index;
    }
  }
  return -1;
}

function mergedRow(
  field: AlayaCareCatalogField,
  annotation: AlayaCareFormContextAnnotation
): string[] {
  return [
    field.family ?? annotation.subSubSection,
    field.chartFieldLabel || annotation.chartFieldLabel,
    field.formContextFieldName || annotation.formContextFieldName,
    displayFieldType(field),
    annotation.description,
    annotation.populatesClientQuickLook,
    annotation.writableFromForms,
    annotation.writesToAlayaAssessments,
    annotation.alayaAssessmentsCa,
    annotation.alayaAssessmentsHc,
    annotation.alayaAssessmentLtch,
    annotation.note
  ];
}

function annotationRow(annotation: AlayaCareFormContextAnnotation): string[] {
  return [
    annotation.subSubSection,
    annotation.chartFieldLabel,
    annotation.formContextFieldName,
    annotation.displayType,
    annotation.description,
    annotation.populatesClientQuickLook,
    annotation.writableFromForms,
    annotation.writesToAlayaAssessments,
    annotation.alayaAssessmentsCa,
    annotation.alayaAssessmentsHc,
    annotation.alayaAssessmentLtch,
    annotation.note
  ];
}

function liveFieldRow(field: AlayaCareCatalogField): string[] {
  return [
    field.family ?? "",
    field.chartFieldLabel,
    field.formContextFieldName,
    displayFieldType(field),
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    ""
  ];
}

function displayFieldType(field: AlayaCareCatalogField): string {
  switch (field.normalizedType) {
    case "free_text":
      return "Free Text";
    case "long_text":
      return "Long Text";
    case "dropdown":
      return "Drop Down";
    case "multi_select":
      return "Multi Select";
    case "phone":
      return "Phone Number";
    case "email":
      return "Email";
    case "date":
      return "Date";
    case "checkbox":
      return "Checkbox";
    default:
      return field.normalizedType || field.nativeType;
  }
}

function csvCell(value: string): string {
  const safeValue = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safeValue) ? `"${safeValue.replace(/"/g, '""')}"` : safeValue;
}

function bindingAlias(tag: string): string {
  if (tag === "zip") return "Zip Code";
  return tag;
}

function isUnavailable(value: string): boolean {
  const normalized = normalize(value);
  return !normalized || normalized === "n a";
}

function sameText(left: string | null, right: string | null): boolean {
  const normalizedLeft = normalize(left);
  return Boolean(normalizedLeft) && normalizedLeft === normalize(right);
}

function normalize(value: string | null): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}
