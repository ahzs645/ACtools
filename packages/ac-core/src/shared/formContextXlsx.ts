import { strToU8, zipSync } from "fflate";

import type { AlayaCareFormContextCatalogSnapshot } from "./formContextCatalog";
import {
  buildAlayaCareCatalogRows,
  type AlayaCareCatalogRow
} from "./formContextCsv";

const CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const SHEET_NAME = "Field Catalog";
const HEADER_ROW = 4;
const FIRST_DATA_ROW = HEADER_ROW + 1;
const COLUMN_WIDTHS = [18, 24, 27, 16, 42, 18, 18, 18, 14, 14, 15, 50] as const;
const CENTERED_COLUMNS = new Set([3, 5, 6, 7, 8, 9, 10]);

export interface AlayaCareCatalogXlsxResult {
  xlsx: Uint8Array;
  contentType: typeof CONTENT_TYPE;
  rowCount: number;
  matchedAnnotationCount: number;
  liveOnlyCount: number;
}

export function buildAlayaCareCatalogXlsx(
  snapshot: AlayaCareFormContextCatalogSnapshot
): AlayaCareCatalogXlsxResult {
  const result = buildAlayaCareCatalogRows(snapshot);
  const lastRow = HEADER_ROW + result.rowCount;
  const tenant = tenantLabel(snapshot.tenantOrigin);
  const metadata = [
    `Tenant: ${tenant}`,
    `Exported: ${formatExportedAt(snapshot.exportedAt)}`,
    `${result.rowCount} fields`,
    `${result.matchedAnnotationCount} matched live bindings`,
    `${result.liveOnlyCount} live fields to review`,
    "Yellow rows need documentation review"
  ].join("  •  ");

  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": xmlFile(contentTypesXml()),
    "_rels/.rels": xmlFile(rootRelationshipsXml()),
    "docProps/app.xml": xmlFile(appPropertiesXml()),
    "docProps/core.xml": xmlFile(corePropertiesXml(snapshot.exportedAt)),
    "xl/_rels/workbook.xml.rels": xmlFile(workbookRelationshipsXml()),
    "xl/styles.xml": xmlFile(stylesXml()),
    "xl/workbook.xml": xmlFile(workbookXml()),
    "xl/worksheets/sheet1.xml": xmlFile(
      worksheetXml(result.headers, result.rows, metadata, lastRow)
    )
  };

  return {
    xlsx: zipSync(files, { level: 6 }),
    contentType: CONTENT_TYPE,
    rowCount: result.rowCount,
    matchedAnnotationCount: result.matchedAnnotationCount,
    liveOnlyCount: result.liveOnlyCount
  };
}

function worksheetXml(
  headers: readonly string[],
  rows: AlayaCareCatalogRow[],
  metadata: string,
  lastRow: number
): string {
  const titleCells = Array.from({ length: headers.length }, (_value, index) =>
    inlineStringCell(cellReference(index, 1), index === 0 ? "AlayaCare Field Catalog" : "", 1)
  ).join("");
  const metadataCells = Array.from({ length: headers.length }, (_value, index) =>
    inlineStringCell(cellReference(index, 2), index === 0 ? metadata : "", 2)
  ).join("");
  const headerCells = headers
    .map((header, index) => inlineStringCell(cellReference(index, HEADER_ROW), header, 3))
    .join("");
  const dataRows = rows.map((row, index) => {
    const rowNumber = FIRST_DATA_ROW + index;
    const height = calculateRowHeight(row.values);
    const cells = row.values
      .map((value, columnIndex) =>
        inlineStringCell(
          cellReference(columnIndex, rowNumber),
          value,
          dataStyleIndex(row, index, columnIndex, value)
        )
      )
      .join("");
    return `<row r="${rowNumber}" ht="${height}" customHeight="1">${cells}</row>`;
  });
  const columns = COLUMN_WIDTHS.map(
    (width, index) =>
      `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`
  ).join("");

  return `${xmlDeclaration()}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:L${Math.max(lastRow, HEADER_ROW)}"/>
  <sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A5" sqref="A5"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>${columns}</cols>
  <sheetData>
    <row r="1" ht="32" customHeight="1">${titleCells}</row>
    <row r="2" ht="24" customHeight="1">${metadataCells}</row>
    <row r="3" ht="8" customHeight="1"/>
    <row r="4" ht="42" customHeight="1">${headerCells}</row>
    ${dataRows.join("\n    ")}
  </sheetData>
  <autoFilter ref="A4:L${Math.max(lastRow, HEADER_ROW)}"/>
  <mergeCells count="2"><mergeCell ref="A1:L1"/><mergeCell ref="A2:L2"/></mergeCells>
  <pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
  <pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
}

function dataStyleIndex(
  row: AlayaCareCatalogRow,
  rowIndex: number,
  columnIndex: number,
  value: string
): number {
  if (row.source === "live-only") {
    return CENTERED_COLUMNS.has(columnIndex) ? 10 : 9;
  }

  const alternate = rowIndex % 2 === 1;
  if (columnIndex >= 5 && columnIndex <= 7) {
    const normalized = value.trim().toLowerCase();
    if (normalized === "yes") return alternate ? 12 : 11;
    if (normalized === "no") return alternate ? 14 : 13;
  }
  if (CENTERED_COLUMNS.has(columnIndex)) return alternate ? 8 : 7;
  return alternate ? 6 : 5;
}

function calculateRowHeight(values: string[]): number {
  const descriptionLines = estimatedLines(values[4] ?? "", 48);
  const noteLines = estimatedLines(values[11] ?? "", 60);
  return Math.min(90, Math.max(22, Math.max(descriptionLines, noteLines) * 15));
}

function estimatedLines(value: string, charactersPerLine: number): number {
  return value
    .split(/\r?\n/)
    .reduce((count, line) => count + Math.max(1, Math.ceil(line.length / charactersPerLine)), 0);
}

function inlineStringCell(reference: string, value: string, styleIndex: number): string {
  return `<c r="${reference}" s="${styleIndex}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function cellReference(columnIndex: number, row: number): string {
  let column = "";
  for (let index = columnIndex + 1; index > 0; index = Math.floor((index - 1) / 26)) {
    column = String.fromCharCode(65 + ((index - 1) % 26)) + column;
  }
  return `${column}${row}`;
}

function tenantLabel(origin: string): string {
  try {
    return new URL(origin).hostname;
  } catch {
    return origin || "Unknown tenant";
  }
}

function formatExportedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function xmlFile(value: string): Uint8Array {
  return strToU8(value);
}

function xmlDeclaration(): string {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
}

function escapeXml(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function contentTypesXml(): string {
  return `${xmlDeclaration()}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;
}

function rootRelationshipsXml(): string {
  return `${xmlDeclaration()}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
}

function workbookRelationshipsXml(): string {
  return `${xmlDeclaration()}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function workbookXml(): string {
  return `${xmlDeclaration()}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="14000"/></bookViews>
  <sheets><sheet name="${SHEET_NAME}" sheetId="1" state="visible" r:id="rId1"/></sheets>
  <calcPr calcId="191029" fullCalcOnLoad="1"/>
</workbook>`;
}

function corePropertiesXml(exportedAt: string): string {
  const exportedDate = new Date(exportedAt);
  const created = Number.isNaN(exportedDate.getTime())
    ? new Date().toISOString()
    : exportedDate.toISOString();
  return `${xmlDeclaration()}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:creator>AC Tools</dc:creator><cp:lastModifiedBy>AC Tools</cp:lastModifiedBy>
  <dc:title>AlayaCare Field Catalog</dc:title><dc:subject>Reviewed Patient field catalog</dc:subject>
  <dcterms:created xsi:type="dcterms:W3CDTF">${escapeXml(created)}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${escapeXml(created)}</dcterms:modified>
</cp:coreProperties>`;
}

function appPropertiesXml(): string {
  return `${xmlDeclaration()}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>AC Tools</Application><AppVersion>1.0</AppVersion>
  <HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>1</vt:i4></vt:variant></vt:vector></HeadingPairs>
  <TitlesOfParts><vt:vector size="1" baseType="lpstr"><vt:lpstr>${SHEET_NAME}</vt:lpstr></vt:vector></TitlesOfParts>
</Properties>`;
}

function stylesXml(): string {
  return `${xmlDeclaration()}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="7">
    <font><sz val="11"/><color rgb="FF1F2937"/><name val="Aptos"/><family val="2"/></font>
    <font><b/><sz val="18"/><color rgb="FFFFFFFF"/><name val="Aptos Display"/><family val="2"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Aptos"/><family val="2"/></font>
    <font><i/><sz val="10"/><color rgb="FF475569"/><name val="Aptos"/><family val="2"/></font>
    <font><b/><sz val="11"/><color rgb="FF166534"/><name val="Aptos"/><family val="2"/></font>
    <font><sz val="11"/><color rgb="FF64748B"/><name val="Aptos"/><family val="2"/></font>
    <font><b/><sz val="11"/><color rgb="FF92400E"/><name val="Aptos"/><family val="2"/></font>
  </fonts>
  <fills count="6">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF17324D"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF1F6FA"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFF7D6"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="3">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left/><right/><top/><bottom style="medium"><color rgb="FF0F766E"/></bottom><diagonal/></border>
    <border><left/><right/><top/><bottom style="thin"><color rgb="FFDCE3E8"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="15">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="2" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="2" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="3" borderId="2" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="2" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="3" borderId="2" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="6" fillId="5" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="6" fillId="5" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="4" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="4" fillId="3" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="5" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="5" fillId="3" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top" wrapText="1"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}
