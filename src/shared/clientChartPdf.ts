import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

export const ALAYACARE_CLIENT_CHART_PDF_PARSE_KIND =
  "alayacare-client-chart-pdf-parse" as const;
export const ALAYACARE_CLIENT_CHART_PDF_PARSE_SCHEMA_VERSION = 1 as const;

export type ClientChartPdfReportType =
  | "cover"
  | "care-plan"
  | "medication-administration-record"
  | "medication-profile-report"
  | "date-overview"
  | "service-task-details"
  | "unknown";

export interface ClientChartPdfIdentity {
  displayName?: string;
  dateOfBirth?: string;
  alayacareId?: string;
  externalId?: string;
  brnNumber?: string;
}

export interface ClientChartPdfPage {
  pageNumber: number;
  width: number;
  height: number;
  reportType: ClientChartPdfReportType;
  title: string;
  date?: string;
  visitIds: string[];
  lines: string[];
  text: string;
}

export interface ClientChartPdfReport {
  reportType: ClientChartPdfReportType;
  title: string;
  startPage: number;
  endPage: number;
}

export interface ClientChartPdfVisitDay {
  date: string;
  pageNumbers: number[];
  visitIds: string[];
}

export interface ClientChartPdfFileParse {
  sourceFile: {
    name: string;
    size: number;
    type: string;
    lastModified: number;
  };
  identity: ClientChartPdfIdentity;
  batchRange?: {
    startDate: string;
    endDate: string;
  };
  pageCount: number;
  reports: ClientChartPdfReport[];
  visitDays: ClientChartPdfVisitDay[];
  pages: ClientChartPdfPage[];
  counts: {
    reports: number;
    visitDays: number;
    visitIds: number;
    byReportType: Record<ClientChartPdfReportType, number>;
  };
}

export interface ClientChartPdfParseSnapshot {
  kind: typeof ALAYACARE_CLIENT_CHART_PDF_PARSE_KIND;
  schemaVersion: typeof ALAYACARE_CLIENT_CHART_PDF_PARSE_SCHEMA_VERSION;
  parsedAt: string;
  scope: {
    localOnly: true;
    syntheticUatConfirmed: true;
    tableTextIsPositionReconstructed: true;
  };
  files: ClientChartPdfFileParse[];
  counts: {
    files: number;
    pages: number;
    reports: number;
    visitDays: number;
    uniqueVisitIds: number;
  };
}

export interface ClientChartPdfParseProgress {
  fileIndex: number;
  fileCount: number;
  fileName: string;
  pageNumber: number;
  pageCount: number;
}

interface PositionedText {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export async function parseClientChartPdfBatch(
  files: readonly File[],
  confirmedSyntheticUat: boolean,
  onProgress?: (progress: ClientChartPdfParseProgress) => void
): Promise<ClientChartPdfParseSnapshot> {
  if (!confirmedSyntheticUat) {
    throw new Error("Confirm that the selected PDFs contain synthetic UAT data.");
  }
  if (files.length === 0) throw new Error("Choose at least one PDF to parse.");

  const parsedFiles: ClientChartPdfFileParse[] = [];
  for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
    const file = files[fileIndex];
    if (!file) continue;
    parsedFiles.push(
      await parseClientChartPdfFile(file, (pageNumber, pageCount) => {
        onProgress?.({
          fileIndex,
          fileCount: files.length,
          fileName: file.name,
          pageNumber,
          pageCount
        });
      })
    );
  }

  const uniqueVisitIds = new Set(
    parsedFiles.flatMap((file) => file.visitDays.flatMap((day) => day.visitIds))
  );
  return {
    kind: ALAYACARE_CLIENT_CHART_PDF_PARSE_KIND,
    schemaVersion: ALAYACARE_CLIENT_CHART_PDF_PARSE_SCHEMA_VERSION,
    parsedAt: new Date().toISOString(),
    scope: {
      localOnly: true,
      syntheticUatConfirmed: true,
      tableTextIsPositionReconstructed: true
    },
    files: parsedFiles,
    counts: {
      files: parsedFiles.length,
      pages: parsedFiles.reduce((total, file) => total + file.pageCount, 0),
      reports: parsedFiles.reduce((total, file) => total + file.reports.length, 0),
      visitDays: parsedFiles.reduce((total, file) => total + file.visitDays.length, 0),
      uniqueVisitIds: uniqueVisitIds.size
    }
  };
}

async function parseClientChartPdfFile(
  file: File,
  onProgress: (pageNumber: number, pageCount: number) => void
): Promise<ClientChartPdfFileParse> {
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    throw new Error(`${file.name} is not a PDF.`);
  }

  const loadingTask = getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    const document = await loadingTask.promise;
    const pages: ClientChartPdfPage[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      onProgress(pageNumber, document.numPages);
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const positioned: PositionedText[] = [];
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        positioned.push({
          text: item.str,
          x: item.transform[4],
          y: item.transform[5],
          width: item.width,
          height: item.height
        });
      }
      const lines = reconstructLines(positioned);
      const reportType = classifyPage(lines);
      const date = findPageDate(lines, reportType);
      pages.push({
        pageNumber,
        width: round(viewport.width),
        height: round(viewport.height),
        reportType,
        title: findPageTitle(lines, reportType, date),
        ...(date ? { date } : {}),
        visitIds: findVisitIds(lines),
        lines,
        text: lines.join("\n")
      });
      page.cleanup();
    }

    const reports = groupReports(pages);
    const visitDays = groupVisitDays(pages);
    const byReportType = emptyReportTypeCounts();
    for (const page of pages) byReportType[page.reportType] += 1;
    const identityText = pages.slice(0, 3).flatMap((page) => page.lines).join("\n");
    const visitIds = new Set(visitDays.flatMap((day) => day.visitIds));
    const batchRange = extractBatchRange(identityText);
    return {
      sourceFile: {
        name: file.name,
        size: file.size,
        type: file.type || "application/pdf",
        lastModified: file.lastModified
      },
      identity: extractIdentity(identityText),
      ...(batchRange ? { batchRange } : {}),
      pageCount: pages.length,
      reports,
      visitDays,
      pages,
      counts: {
        reports: reports.length,
        visitDays: visitDays.length,
        visitIds: visitIds.size,
        byReportType
      }
    };
  } finally {
    await loadingTask.destroy();
  }
}

function reconstructLines(items: PositionedText[]): string[] {
  const rows: PositionedText[][] = [];
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  for (const item of sorted) {
    const tolerance = Math.max(1.5, Math.min(3, item.height * 0.3));
    const row = rows.find((candidate) => Math.abs((candidate[0]?.y ?? 0) - item.y) <= tolerance);
    if (row) row.push(item);
    else rows.push([item]);
  }

  return rows
    .sort((a, b) => (b[0]?.y ?? 0) - (a[0]?.y ?? 0))
    .map((row) => {
      const ordered = row.sort((a, b) => a.x - b.x);
      let line = "";
      let previousRight: number | null = null;
      for (const item of ordered) {
        const gap = previousRight === null ? 0 : item.x - previousRight;
        if (line && gap > 16) line += " | ";
        else if (line && gap > 1 && !line.endsWith(" ")) line += " ";
        line += item.text.trim();
        previousRight = Math.max(previousRight ?? item.x, item.x + item.width);
      }
      return line.replace(/\s+/g, " ").trim();
    })
    .filter(Boolean);
}

function classifyPage(lines: readonly string[]): ClientChartPdfReportType {
  const text = lines.join("\n").toLowerCase();
  if (text.includes("cover page") && text.includes("agency information")) return "cover";
  if (text.includes("medication administration record")) return "medication-administration-record";
  if (text.includes("medication profile report")) return "medication-profile-report";
  if (text.includes("service task details") || text.includes("service tasks details")) {
    return "service-task-details";
  }
  if (text.includes("date overview") || text.includes("summary for:")) return "date-overview";
  if (text.includes("care plan")) return "care-plan";
  return "unknown";
}

function findPageTitle(
  lines: readonly string[],
  reportType: ClientChartPdfReportType,
  date?: string
): string {
  const patterns: Record<ClientChartPdfReportType, RegExp[]> = {
    cover: [/cover page/i],
    "care-plan": [/care plan\s*-\s*.+/i, /care plan/i],
    "medication-administration-record": [/medication administration record/i],
    "medication-profile-report": [/medication profile report/i],
    "date-overview": [/summary for:\s*\d{4}-\d{2}-\d{2}/i, /date overview/i],
    "service-task-details": [/service tasks? details/i],
    unknown: []
  };
  for (const pattern of patterns[reportType]) {
    const line = lines.find((candidate) => pattern.test(candidate));
    if (line) return line;
  }
  return date ? `${reportType} ${date}` : reportType;
}

function findPageDate(
  lines: readonly string[],
  reportType: ClientChartPdfReportType
): string | undefined {
  if (reportType !== "date-overview" && reportType !== "service-task-details") return undefined;
  for (const line of lines) {
    const summary = /summary for:\s*(\d{4}-\d{2}-\d{2})/i.exec(line);
    if (summary?.[1]) return summary[1];
  }
  for (const line of lines.slice(0, 12)) {
    const standalone = /(?:^|\|\s*)(\d{4}-\d{2}-\d{2})(?:\s*\||$)/.exec(line);
    if (standalone?.[1]) return standalone[1];
  }
  return undefined;
}

function findVisitIds(lines: readonly string[]): string[] {
  const ids = new Set<string>();
  for (const line of lines) {
    const match = /^(\d{3,})(?:\s*\|\s*|\s+)(?:scheduled|actual)\s+start\/end:/i.exec(line);
    if (match?.[1]) ids.add(match[1]);
  }
  return [...ids];
}

function extractIdentity(text: string): ClientChartPdfIdentity {
  const header = /^(.+?)\s*\|\s*DOB:\s*(\d{4}-\d{2}-\d{2})/m.exec(text);
  return compactObject({
    displayName: header?.[1]?.trim(),
    dateOfBirth: header?.[2],
    alayacareId: capture(text, /Alayacare ID:\s*([^\n|]+)/i),
    externalId: capture(text, /External ID:\s*([^\n|]+)/i),
    brnNumber: capture(text, /BRN number:\s*([^\n|]+)/i)
  });
}

function extractBatchRange(text: string): { startDate: string; endDate: string } | undefined {
  const match = /(\d{4}-\d{2}-\d{2})\s*--\s*(\d{4}-\d{2}-\d{2})/.exec(text);
  return match?.[1] && match[2] ? { startDate: match[1], endDate: match[2] } : undefined;
}

function groupReports(pages: readonly ClientChartPdfPage[]): ClientChartPdfReport[] {
  const reports: ClientChartPdfReport[] = [];
  for (const page of pages) {
    const previous = reports.at(-1);
    if (previous && previous.reportType === page.reportType && previous.title === page.title) {
      previous.endPage = page.pageNumber;
    } else {
      reports.push({
        reportType: page.reportType,
        title: page.title,
        startPage: page.pageNumber,
        endPage: page.pageNumber
      });
    }
  }
  return reports;
}

function groupVisitDays(pages: readonly ClientChartPdfPage[]): ClientChartPdfVisitDay[] {
  const byDate = new Map<string, ClientChartPdfVisitDay>();
  for (const page of pages) {
    if (!page.date) continue;
    const day = byDate.get(page.date) ?? { date: page.date, pageNumbers: [], visitIds: [] };
    day.pageNumbers.push(page.pageNumber);
    day.visitIds = [...new Set([...day.visitIds, ...page.visitIds])];
    byDate.set(page.date, day);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function emptyReportTypeCounts(): Record<ClientChartPdfReportType, number> {
  return {
    cover: 0,
    "care-plan": 0,
    "medication-administration-record": 0,
    "medication-profile-report": 0,
    "date-overview": 0,
    "service-task-details": 0,
    unknown: 0
  };
}

function compactObject<T extends Record<string, string | undefined>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function capture(text: string, pattern: RegExp): string | undefined {
  return pattern.exec(text)?.[1]?.trim();
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
