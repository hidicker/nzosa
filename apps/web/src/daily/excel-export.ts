import {
  assetProceedsInUse,
  entityBankAccounts,
  invoiceAssignments,
  postedJournals,
  reportEngine,
  varianceInput,
} from "../books.js";
import { state } from "../state.js";
export { state };
import { computeOurReturns } from "../variance.js";
import {
  balanceSheetRole,
  categorise,
  depreciationSchedule,
  financialYearOf,
  generalLedgerRows,
  gstWithin,
  plClassForType,
  splitAccountLabel,
} from "@nzosa/core";
import type {
  Entity,
  FixedAsset,
  GstClassification,
  PlClass,
  RuleSet,
} from "@nzosa/core";

// --- OpenXML Stylesheet & Packaging ---

// XML 1.0 legal characters: #x9 | #xA | #xD | [#x20-#xD7FF] | [#xE000-#xFFFD] | [#x10000-#x10FFFF]
// Anything outside this range (like C0/C1 control codes \x00-\x08, \x0B-\x0C, \x0E-\x1F, \x7F, unpaired surrogates)
// is strictly illegal in XML 1.0 and causes Excel to report "Illegal xml character".
const ILLEGAL_XML_REGEX = /[^\x09\x0A\x0D\x20-\x7E\u00A0-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu;

function escapeXml(s: string | number | null | undefined): string {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(ILLEGAL_XML_REGEX, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatObjectInline(obj: unknown): string {
  if (obj === null || obj === undefined) return "";
  if (typeof obj === "string") return obj;
  if (typeof obj === "number" || typeof obj === "boolean") return String(obj);
  try {
    return JSON.stringify(obj);
  } catch {
    return String(obj);
  }
}

function textCell(ref: string, text: string, style = 4): string {
  if (!text) return `<c r="${ref}" s="${style}"/>`;
  const clean = escapeXml(text);
  if (!clean) return `<c r="${ref}" s="${style}"/>`;
  return `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${clean}</t></is></c>`;
}

function numCell(ref: string, value: number, style = 6, formula?: string): string {
  const safeVal = Number.isFinite(value) ? value.toFixed(2) : "0.00";
  if (formula) {
    return `<c r="${ref}" s="${style}"><f>${escapeXml(formula)}</f><v>${safeVal}</v></c>`;
  }
  return `<c r="${ref}" s="${style}"><v>${safeVal}</v></c>`;
}

function pctCell(ref: string, value: number, style = 8): string {
  const safeVal = Number.isFinite(value) ? (value / 100).toFixed(4) : "0.0000";
  return `<c r="${ref}" s="${style}"><v>${safeVal}</v></c>`;
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="4">
    <numFmt numFmtId="164" formatCode="#,##0.00;(#,##0.00);&quot;-&quot;"/>
    <numFmt numFmtId="165" formatCode="&quot;$&quot;#,##0.00;(&quot;$&quot;#,##0.00);&quot;-&quot;"/>
    <numFmt numFmtId="166" formatCode="0.0%"/>
    <numFmt numFmtId="167" formatCode="#,##0"/>
  </numFmts>
  <fonts count="8">
    <font><sz val="10"/><name val="Segoe UI"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Segoe UI"/></font>
    <font><b/><sz val="10"/><color rgb="FF1A1A1A"/><name val="Segoe UI"/></font>
    <font><b/><sz val="14"/><color rgb="FF1B365D"/><name val="Segoe UI"/></font>
    <font><i/><sz val="10"/><color rgb="FF555555"/><name val="Segoe UI"/></font>
    <font><b/><sz val="11"/><color rgb="FF1B365D"/><name val="Segoe UI"/></font>
    <font><b/><sz val="10"/><color rgb="FFC0392B"/><name val="Segoe UI"/></font>
    <font><b/><sz val="10"/><color rgb="FF27AE60"/><name val="Segoe UI"/></font>
  </fonts>
  <fills count="8">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1B365D"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF4F6F9"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFDEDEC"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEAFAF1"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF5"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF2C3E50"/></patternFill></fill>
  </fills>
  <borders count="5">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FFE0E0E0"/></left><right style="thin"><color rgb="FFE0E0E0"/></right><top style="thin"><color rgb="FFE0E0E0"/></top><bottom style="thin"><color rgb="FFE0E0E0"/></bottom><diagonal/></border>
    <border><left/><right/><top style="thin"><color rgb="FF333333"/></top><bottom style="double"><color rgb="FF333333"/></bottom><diagonal/></border>
    <border><bottom style="medium"><color rgb="FF1B365D"/></bottom></border>
    <border><top style="thin"><color rgb="FF999999"/></top><bottom style="thin"><color rgb="FF999999"/></bottom></border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="21">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="167" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="164" fontId="2" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="4" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="164" fontId="2" fillId="3" borderId="4" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="0" fontId="5" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="6" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="7" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
  </cellXfs>
</styleSheet>`;

// --- Zip Generation via Typed Arrays (Zero Dependencies) ---

const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[i] = c;
}

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i] ?? 0;
    c = (crcTable[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

const encoder = new TextEncoder();
function encodeUtf8(str: string): Uint8Array {
  return encoder.encode(str);
}

function writeU16(arr: Uint8Array, offset: number, val: number): void {
  arr[offset] = val & 0xff;
  arr[offset + 1] = (val >> 8) & 0xff;
}

function writeU32(arr: Uint8Array, offset: number, val: number): void {
  arr[offset] = val & 0xff;
  arr[offset + 1] = (val >> 8) & 0xff;
  arr[offset + 2] = (val >> 16) & 0xff;
  arr[offset + 3] = (val >>> 24) & 0xff;
}

function dosDateTime(date: Date = new Date()): { time: number; date: number } {
  const time =
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    ((date.getSeconds() >> 1) & 0x1f);
  const d =
    (((date.getFullYear() - 1980) & 0x7f) << 9) |
    (((date.getMonth() + 1) & 0x0f) << 5) |
    (date.getDate() & 0x1f);
  return { time, date: d };
}

function createZip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const { time, date } = dosDateTime();
  const localHeaders: Uint8Array[] = [];
  const cdHeaders: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encodeUtf8(file.name);
    const dataBytes = file.data;
    const crc = crc32(dataBytes);
    const size = dataBytes.length;

    const local = new Uint8Array(30 + nameBytes.length + size);
    writeU32(local, 0, 0x04034b50);
    writeU16(local, 4, 20);
    writeU16(local, 6, 0x0800); // UTF-8
    writeU16(local, 8, 0); // Stored (0)
    writeU16(local, 10, time);
    writeU16(local, 12, date);
    writeU32(local, 14, crc);
    writeU32(local, 18, size);
    writeU32(local, 22, size);
    writeU16(local, 26, nameBytes.length);
    writeU16(local, 28, 0);
    local.set(nameBytes, 30);
    local.set(dataBytes, 30 + nameBytes.length);

    const cd = new Uint8Array(46 + nameBytes.length);
    writeU32(cd, 0, 0x02014b50);
    writeU16(cd, 4, 20);
    writeU16(cd, 6, 20);
    writeU16(cd, 8, 0x0800); // UTF-8
    writeU16(cd, 10, 0);
    writeU16(cd, 12, time);
    writeU16(cd, 14, date);
    writeU32(cd, 16, crc);
    writeU32(cd, 20, size);
    writeU32(cd, 24, size);
    writeU16(cd, 28, nameBytes.length);
    writeU16(cd, 30, 0);
    writeU16(cd, 32, 0);
    writeU16(cd, 34, 0);
    writeU16(cd, 36, 0);
    writeU32(cd, 38, 0);
    writeU32(cd, 42, offset);
    cd.set(nameBytes, 46);

    offset += local.length;
    localHeaders.push(local);
    cdHeaders.push(cd);
  }

  const cdTotalSize = cdHeaders.reduce((s, h) => s + h.length, 0);
  const cdOffset = offset;
  const eocd = new Uint8Array(22);
  writeU32(eocd, 0, 0x06054b50);
  writeU16(eocd, 4, 0);
  writeU16(eocd, 6, 0);
  writeU16(eocd, 8, files.length);
  writeU16(eocd, 10, files.length);
  writeU32(eocd, 12, cdTotalSize);
  writeU32(eocd, 16, cdOffset);
  writeU16(eocd, 20, 0);

  const totalLength = offset + cdTotalSize + eocd.length;
  const result = new Uint8Array(totalLength);
  let pos = 0;
  for (const part of localHeaders) {
    result.set(part, pos);
    pos += part.length;
  }
  for (const part of cdHeaders) {
    result.set(part, pos);
    pos += part.length;
  }
  result.set(eocd, pos);
  return result;
}

// --- Data Helpers ---

function reportingEntity(): Entity | undefined {
  const entities = state.ledger.entities?.entities ?? [];
  if (state.entityFilter !== "") return entities.find((e) => e.id === state.entityFilter);
  return entities.length === 1 ? entities[0] : undefined;
}

function isDiminishing(asset: FixedAsset): boolean {
  const method = asset.method.trim().toLowerCase();
  return method.startsWith("dv") || method.includes("diminish");
}

function plClassOfAccount(code: string, name: string): PlClass | null {
  const byCode = new Map(state.chart.map((a) => [a.code, a]));
  const byName = new Map(state.chart.map((a) => [a.name.trim().toLowerCase(), a]));
  const acc =
    (code ? byCode.get(code) : undefined) ??
    (name ? byName.get(name.trim().toLowerCase()) : undefined) ??
    byCode.get(splitAccountLabel(code).code) ??
    byName.get(splitAccountLabel(name).name.trim().toLowerCase());
  if (!acc) return null;
  return plClassForType(acc.type);
}

function roleOfAccount(code: string, name: string): string {
  const byCode = new Map(state.chart.map((a) => [a.code, a]));
  const byName = new Map(state.chart.map((a) => [a.name.trim().toLowerCase(), a]));
  const acc =
    (code ? byCode.get(code) : undefined) ??
    (name ? byName.get(name.trim().toLowerCase()) : undefined) ??
    byCode.get(splitAccountLabel(code).code) ??
    byName.get(splitAccountLabel(name).name.trim().toLowerCase());
  if (!acc) return "";
  return balanceSheetRole(acc.type, acc.name);
}

function gstRateName(classification: GstClassification): string {
  if (classification.side === "imports") return "GST on Imports";
  if (classification.treatment === "zero-rated") return "Zero Rated";
  if (classification.treatment === "exempt") return "Exempt";
  if (classification.treatment === "out-of-scope") return "No GST";
  if (classification.side === "none") return "No GST";
  return classification.side === "sales" ? "15% GST on Income" : "15% GST on Expenses";
}

// --- Sheet Builders ---

interface SheetContext {
  year: number | "all";
  yearLabel: string;
  startYear: number;
  endYear: number;
  from: string;
  to: string;
  entityName: string;
  gstNumber: string;
  exportBasis: string;
}

function buildColsXml(widths: number[]): string {
  return `<cols>${widths
    .map((w, idx) => `<col min="${idx + 1}" max="${idx + 1}" width="${w}" customWidth="1"/>`)
    .join("")}</cols>`;
}

function buildSheetViewsXml(splitRow = 3): string {
  return `<sheetViews><sheetView tabSelected="1" workbookViewId="0"><pane ySplit="${splitRow}" topLeftCell="A${splitRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`;
}

/**
 * Sheet 1: Summary & Trial Balance
 */
function buildSummaryTrialBalanceSheet(ctx: SheetContext): string {
  const { year, from, to, entityName, gstNumber, exportBasis, startYear, yearLabel } = ctx;
  const scope = entityBankAccounts();
  const journals = postedJournals().filter((journal) => {
    if (journal.date < from || journal.date > to) return false;
    if (scope.length === 0) return true;
    return journal.lines.some((line) => scope.includes(line.accountCode));
  });

  const byCode = new Map(state.chart.map((a) => [a.code, a]));
  const byName = new Map(state.chart.map((a) => [a.name.trim().toLowerCase(), a]));

  const movements = new Map<string, { code: string; name: string; debit: number; credit: number }>();
  for (const j of journals) {
    for (const l of j.lines) {
      const code = l.accountCode || byName.get(l.accountName.trim().toLowerCase())?.code || "";
      const name = l.accountName || byCode.get(code)?.name || code;
      const key = code || name;
      const cur = movements.get(key) ?? { code, name, debit: 0, credit: 0 };
      if (l.amount > 0) cur.debit += l.amount;
      else if (l.amount < 0) cur.credit += -l.amount;
      movements.set(key, cur);
    }
  }

  const openingMap = new Map<string, number>();
  const openingObj = state.ledger.openingBalances;
  if (openingObj) {
    const priorEnd = `${startYear - 1}-03-31`;
    const accounts = (openingObj.byDate && openingObj.byDate[priorEnd]) || openingObj.accounts || {};
    for (const [key, cents] of Object.entries(accounts)) {
      openingMap.set(key, cents);
    }
  }

  const allKeys = new Set([...movements.keys(), ...openingMap.keys()]);
  for (const acc of state.chart) {
    if (acc.code) allKeys.add(acc.code);
  }

  interface TbRow {
    code: string;
    name: string;
    type: string;
    category: string;
    opening: number;
    debit: number;
    credit: number;
    netMovement: number;
    closing: number;
  }

  const tbRows: TbRow[] = [];
  let totalRevenue = 0;
  let totalCostOfSales = 0;
  let totalExpenses = 0;
  let totalBankClosing = 0;

  for (const key of allKeys) {
    const acc = byCode.get(key) ?? byName.get(key.toLowerCase());
    const code = acc?.code ?? key;
    const name = acc?.name ?? movements.get(key)?.name ?? key;
    const type = acc?.type ?? "Other";
    const plClass = plClassOfAccount(code, name);
    const role = roleOfAccount(code, name);
    const category = plClass
      ? plClass === "trading" || plClass === "otherIncome"
        ? "Revenue"
        : plClass === "costOfSales"
          ? "Cost of Sales"
          : "Operating Expenses"
      : role || type;

    const openingCents = openingMap.get(code) ?? openingMap.get(name) ?? 0;
    const mov = movements.get(key) ?? movements.get(code) ?? { debit: 0, credit: 0 };
    const debitCents = mov.debit;
    const creditCents = mov.credit;
    const netMovCents = debitCents - creditCents;
    const closingCents = openingCents + netMovCents;

    if (openingCents === 0 && debitCents === 0 && creditCents === 0) continue;

    const opening = openingCents / 100;
    const debit = debitCents / 100;
    const credit = creditCents / 100;
    const netMovement = netMovCents / 100;
    const closing = closingCents / 100;

    tbRows.push({ code, name, type, category, opening, debit, credit, netMovement, closing });

    if (plClass === "trading" || plClass === "otherIncome") {
      totalRevenue += (creditCents - debitCents) / 100;
    } else if (plClass === "costOfSales") {
      totalCostOfSales += (debitCents - creditCents) / 100;
    } else if (plClass === "operatingExpenses") {
      totalExpenses += (debitCents - creditCents) / 100;
    }

    if (type.toLowerCase() === "bank") {
      totalBankClosing += closing;
    }
  }

  tbRows.sort((a, b) => a.code.localeCompare(b.code) || a.name.localeCompare(b.name));

  const grossProfit = totalRevenue - totalCostOfSales;
  const netProfit = grossProfit - totalExpenses;

  const widths = [14, 34, 18, 24, 16, 16, 16, 16, 16, 12];
  const rowsXml: string[] = [];

  rowsXml.push(`<row r="1" ht="26" customHeight="1">
    ${textCell("A1", `${entityName} — Financial Summary & Trial Balance`, 13)}
  </row>`);
  rowsXml.push(`<row r="2" ht="18" customHeight="1">
    ${textCell("A2", `Period: ${yearLabel} | GST: ${gstNumber || "Not registered"} | Basis: ${exportBasis}`, 14)}
  </row>`);

  rowsXml.push(`<row r="4" ht="20" customHeight="1">
    ${textCell("A4", `Key Financial Indicators (${year === "all" ? "All Financial Years" : "FY" + year})`, 15)}
    ${textCell("B4", "", 15)}
    ${textCell("C4", "", 15)}
  </row>`);
  rowsXml.push(`<row r="5">
    ${textCell("A5", "Total Revenue (Sales & Income)", 4)}
    ${numCell("B5", totalRevenue, 6)}
  </row>`);
  rowsXml.push(`<row r="6">
    ${textCell("A6", "Total Cost of Sales (Direct Costs)", 4)}
    ${numCell("B6", totalCostOfSales, 6)}
  </row>`);
  rowsXml.push(`<row r="7">
    ${textCell("A7", "Gross Profit", 9)}
    ${numCell("B7", grossProfit, 10, "B5-B6")}
  </row>`);
  rowsXml.push(`<row r="8">
    ${textCell("A8", "Total Operating Expenses", 4)}
    ${numCell("B8", totalExpenses, 6)}
  </row>`);
  rowsXml.push(`<row r="9">
    ${textCell("A9", "Net Operating Profit / (Loss) Before Tax", 9)}
    ${numCell("B9", netProfit, 10, "B7-B8")}
  </row>`);
  rowsXml.push(`<row r="10">
    ${textCell("A10", "Total Bank Balances (at Period End)", 4)}
    ${numCell("B10", totalBankClosing, 6)}
  </row>`);

  rowsXml.push(`<row r="12" ht="20" customHeight="1">
    ${textCell("A12", "General Ledger Trial Balance & Proof", 15)}
    ${textCell("B12", "", 15)}${textCell("C12", "", 15)}${textCell("D12", "", 15)}${textCell("E12", "", 15)}
    ${textCell("F12", "", 15)}${textCell("G12", "", 15)}${textCell("H12", "", 15)}${textCell("I12", "", 15)}${textCell("J12", "", 15)}
  </row>`);

  rowsXml.push(`<row r="13" ht="22" customHeight="1">
    ${textCell("A13", "Account Code", 2)}
    ${textCell("B13", "Account Name", 2)}
    ${textCell("C13", "Account Type", 2)}
    ${textCell("D13", "Category / Group", 2)}
    ${textCell("E13", "Opening Balance", 3)}
    ${textCell("F13", "Debit Movement", 3)}
    ${textCell("G13", "Credit Movement", 3)}
    ${textCell("H13", "Net Movement", 3)}
    ${textCell("I13", "Closing Balance", 3)}
    ${textCell("J13", "Balance Type", 1)}
  </row>`);

  let rIdx = 14;
  for (const r of tbRows) {
    const balTypeFormula = `IF(I${rIdx}>0.005,"DR",IF(I${rIdx}<-0.005,"CR","-"))`;
    rowsXml.push(`<row r="${rIdx}">
      ${textCell(`A${rIdx}`, r.code, 5)}
      ${textCell(`B${rIdx}`, r.name, 4)}
      ${textCell(`C${rIdx}`, r.type, 4)}
      ${textCell(`D${rIdx}`, r.category, 4)}
      ${numCell(`E${rIdx}`, r.opening, 6)}
      ${numCell(`F${rIdx}`, r.debit, 6)}
      ${numCell(`G${rIdx}`, r.credit, 6)}
      ${numCell(`H${rIdx}`, r.netMovement, 6, `F${rIdx}-G${rIdx}`)}
      ${numCell(`I${rIdx}`, r.closing, 6, `E${rIdx}+H${rIdx}`)}
      <c r="J${rIdx}" t="inlineStr" s="5"><f>${escapeXml(balTypeFormula)}</f><is><t xml:space="preserve">${r.closing > 0.005 ? "DR" : r.closing < -0.005 ? "CR" : "-"}</t></is></c>
    </row>`);
    rIdx++;
  }

  const startRow = 14;
  const endRow = rIdx > 14 ? rIdx - 1 : 14;
  const totRow = rIdx;
  const proofFormula = `IF(ABS(F${totRow}-G${totRow})<0.01,"BALANCED ($0.00)","IMBALANCE: "&TEXT(F${totRow}-G${totRow},"#,##0.00"))`;

  rowsXml.push(`<row r="${totRow}" ht="24" customHeight="1">
    ${textCell(`A${totRow}`, "TOTALS & PROOF", 9)}
    ${textCell(`B${totRow}`, "", 9)}
    ${textCell(`C${totRow}`, "", 9)}
    ${textCell(`D${totRow}`, "", 9)}
    ${numCell(`E${totRow}`, 0, 10, `SUM(E${startRow}:E${endRow})`)}
    ${numCell(`F${totRow}`, 0, 10, `SUM(F${startRow}:F${endRow})`)}
    ${numCell(`G${totRow}`, 0, 10, `SUM(G${startRow}:G${endRow})`)}
    ${numCell(`H${totRow}`, 0, 10, `SUM(H${startRow}:H${endRow})`)}
    ${numCell(`I${totRow}`, 0, 10, `SUM(I${startRow}:I${endRow})`)}
    <c r="J${totRow}" t="inlineStr" s="17"><f>${escapeXml(proofFormula)}</f><is><t xml:space="preserve">BALANCED ($0.00)</t></is></c>
  </row>`);

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  ${buildSheetViewsXml(13)}
  ${buildColsXml(widths)}
  <sheetData>${rowsXml.join("")}</sheetData>
</worksheet>`;
}

/**
 * Sheet 2: General Ledger
 */
function buildGeneralLedgerSheet(ctx: SheetContext): string {
  const { year, from, to, entityName } = ctx;
  const scope = entityBankAccounts();
  const journals = postedJournals().filter((journal) => {
    if (journal.date < from || journal.date > to) return false;
    if (scope.length === 0) return true;
    return journal.lines.some((line) => scope.includes(line.accountCode));
  });

  const rows = generalLedgerRows(journals);
  const widths = [12, 14, 16, 32, 14, 26, 34, 16, 16, 16, 22, 16];
  const rowsXml: string[] = [];

  rowsXml.push(`<row r="1" ht="26" customHeight="1">
    ${textCell("A1", `${entityName} — Complete General Ledger (${year === "all" ? "All Financial Years" : "FY" + year})`, 13)}
  </row>`);
  rowsXml.push(`<row r="2" ht="18" customHeight="1">
    ${textCell("A2", `All posted double-entry journal lines for the period ${from} to ${to} (${rows.length} lines from ${journals.length} journals)`, 14)}
  </row>`);

  rowsXml.push(`<row r="3" ht="22" customHeight="1">
    ${textCell("A3", "Date", 1)}
    ${textCell("B3", "Source", 1)}
    ${textCell("C3", "Journal ID", 1)}
    ${textCell("D3", "Narration", 2)}
    ${textCell("E3", "Account Code", 1)}
    ${textCell("F3", "Account Name", 2)}
    ${textCell("G3", "Line Description", 2)}
    ${textCell("H3", "Debit ($)", 3)}
    ${textCell("I3", "Credit ($)", 3)}
    ${textCell("J3", "Net Movement ($)", 3)}
    ${textCell("K3", "Tax Type", 1)}
    ${textCell("L3", "Tax Base ($)", 3)}
  </row>`);

  let rIdx = 4;
  for (const row of rows) {
    const debit = row.debit / 100;
    const credit = row.credit / 100;
    const net = row.amount / 100;
    const taxBase = row.taxBase !== null ? row.taxBase / 100 : 0;

    rowsXml.push(`<row r="${rIdx}">
      ${textCell(`A${rIdx}`, row.date, 5)}
      ${textCell(`B${rIdx}`, row.source, 5)}
      ${textCell(`C${rIdx}`, row.journal, 5)}
      ${textCell(`D${rIdx}`, row.narration, 4)}
      ${textCell(`E${rIdx}`, row.accountCode, 5)}
      ${textCell(`F${rIdx}`, row.accountName, 4)}
      ${textCell(`G${rIdx}`, row.description, 4)}
      ${debit > 0 ? numCell(`H${rIdx}`, debit, 6) : textCell(`H${rIdx}`, "", 4)}
      ${credit > 0 ? numCell(`I${rIdx}`, credit, 6) : textCell(`I${rIdx}`, "", 4)}
      ${numCell(`J${rIdx}`, net, 6, `IF(H${rIdx}>0,H${rIdx},-I${rIdx})`)}
      ${textCell(`K${rIdx}`, row.taxType === "NONE" ? "" : row.taxType, 5)}
      ${row.taxBase !== null ? numCell(`L${rIdx}`, taxBase, 6) : textCell(`L${rIdx}`, "", 4)}
    </row>`);
    rIdx++;
  }

  const startRow = 4;
  const endRow = rIdx > 4 ? rIdx - 1 : 4;
  const totRow = rIdx;

  rowsXml.push(`<row r="${totRow}" ht="24" customHeight="1">
    ${textCell(`A${totRow}`, "TOTAL GENERAL LEDGER", 9)}
    ${textCell(`B${totRow}`, "", 9)}
    ${textCell(`C${totRow}`, "", 9)}
    ${textCell(`D${totRow}`, "", 9)}
    ${textCell(`E${totRow}`, "", 9)}
    ${textCell(`F${totRow}`, "", 9)}
    ${textCell(`G${totRow}`, "", 9)}
    ${numCell(`H${totRow}`, 0, 10, `SUM(H${startRow}:H${endRow})`)}
    ${numCell(`I${totRow}`, 0, 10, `SUM(I${startRow}:I${endRow})`)}
    ${numCell(`J${totRow}`, 0, 10, `H${totRow}-I${totRow}`)}
    <c r="K${totRow}" t="inlineStr" s="17"><f>${escapeXml(`IF(ABS(H${totRow}-I${totRow})<0.01,"BALANCED","IMBALANCE")`)}</f><is><t xml:space="preserve">BALANCED</t></is></c>
    ${numCell(`L${totRow}`, 0, 10, `SUM(L${startRow}:L${endRow})`)}
  </row>`);

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  ${buildSheetViewsXml(3)}
  ${buildColsXml(widths)}
  <sheetData>${rowsXml.join("")}</sheetData>
</worksheet>`;
}

/**
 * Sheet 3: Bank Transactions & Coding
 */
function buildBankTransactionsSheet(ctx: SheetContext): string {
  const { year, from, to, entityName } = ctx;
  const engine = reportEngine();
  const txs = (engine?.transactions ?? []).filter((t) => t.date >= from && t.date <= to);

  const byCode = new Map(state.chart.map((a) => [a.code, a]));
  const codingRules: RuleSet = {
    ...(state.rules ? (state.rules as RuleSet) : {}),
    overrides: engine?.overrides ?? state.ledger.overrides ?? {},
  };

  const widths = [12, 18, 26, 20, 16, 20, 16, 16, 16, 14, 26, 16, 12, 16, 16, 14, 30, 20];
  const rowsXml: string[] = [];

  rowsXml.push(`<row r="1" ht="26" customHeight="1">
    ${textCell("A1", `${entityName} — Bank Transactions & Coding Audit (${year === "all" ? "All Financial Years" : "FY" + year})`, 13)}
  </row>`);
  rowsXml.push(`<row r="2" ht="18" customHeight="1">
    ${textCell("A2", `Itemised bank transactions with account coding, GST treatments, rules and audit status (${from} to ${to}: ${txs.length} transactions)`, 14)}
  </row>`);

  rowsXml.push(`<row r="3" ht="22" customHeight="1">
    ${textCell("A3", "Date", 1)}
    ${textCell("B3", "Bank Account", 1)}
    ${textCell("C3", "Payee / Other Party", 2)}
    ${textCell("D3", "Particulars", 2)}
    ${textCell("E3", "Code", 1)}
    ${textCell("F3", "Reference", 2)}
    ${textCell("G3", "Spent ($)", 3)}
    ${textCell("H3", "Received ($)", 3)}
    ${textCell("I3", "Net Flow ($)", 3)}
    ${textCell("J3", "Coded Account", 1)}
    ${textCell("K3", "Account Name", 2)}
    ${textCell("L3", "GST Treatment", 1)}
    ${textCell("M3", "GST Rate", 1)}
    ${textCell("N3", "GST ($)", 3)}
    ${textCell("O3", "Net Excl GST ($)", 3)}
    ${textCell("P3", "Matched By", 1)}
    ${textCell("Q3", "Rule / Reason", 2)}
    ${textCell("R3", "Audit Status", 1)}
  </row>`);

  const fallbackClassification: GstClassification = { treatment: "out-of-scope", side: "none" };

  let rIdx = 4;
  for (const t of txs) {
    const cat = categorise(t, codingRules);
    const code = cat.code ?? "";
    const acc = byCode.get(code);
    const accName = acc?.name ?? code;
    const classification = engine?.classify(t) ?? fallbackClassification;
    const gstCents = gstWithin(t.amount, classification);
    const rate = classification.treatment === "standard" && classification.side !== "none" ? 15 : 0;
    const spent = t.amount < 0 ? Math.abs(t.amount) / 100 : 0;
    const received = t.amount > 0 ? t.amount / 100 : 0;
    const net = t.amount / 100;
    const gst = gstCents / 100;
    const netExcl = (t.amount - gstCents) / 100;

    const isConfirmed = cat.matchedBy === "override" || cat.confirmed;
    const isAssumed = classification.assumed ?? false;
    const statusText = isConfirmed
      ? "Confirmed"
      : isAssumed
        ? "Assumed (Review)"
        : cat.matchedBy === "rule"
          ? "Suggested (Rule)"
          : cat.matchedBy === "default"
            ? "Default"
            : "Unmatched";
    const statusStyle = isAssumed ? 16 : isConfirmed ? 17 : 5;

    rowsXml.push(`<row r="${rIdx}">
      ${textCell(`A${rIdx}`, t.date, 5)}
      ${textCell(`B${rIdx}`, String(t.extras?.["accountLabel"] ?? t.account), 5)}
      ${textCell(`C${rIdx}`, t.otherParty || "", 4)}
      ${textCell(`D${rIdx}`, t.particulars || "", 4)}
      ${textCell(`E${rIdx}`, t.code || "", 5)}
      ${textCell(`F${rIdx}`, t.reference || "", 4)}
      ${spent > 0 ? numCell(`G${rIdx}`, spent, 6) : textCell(`G${rIdx}`, "", 4)}
      ${received > 0 ? numCell(`H${rIdx}`, received, 6) : textCell(`H${rIdx}`, "", 4)}
      ${numCell(`I${rIdx}`, net, 6, `IF(H${rIdx}>0,H${rIdx},-G${rIdx})`)}
      ${textCell(`J${rIdx}`, code, 5)}
      ${textCell(`K${rIdx}`, accName, 4)}
      ${textCell(`L${rIdx}`, classification.treatment, 5)}
      ${textCell(`M${rIdx}`, rate > 0 ? "15%" : "0%", 5)}
      ${numCell(`N${rIdx}`, gst, 6)}
      ${numCell(`O${rIdx}`, netExcl, 6, `I${rIdx}-N${rIdx}`)}
      ${textCell(`P${rIdx}`, cat.matchedBy ?? "none", 5)}
      ${textCell(`Q${rIdx}`, cat.reason ?? classification.reason ?? "", 4)}
      ${textCell(`R${rIdx}`, statusText, statusStyle)}
    </row>`);
    rIdx++;
  }

  const startRow = 4;
  const endRow = rIdx > 4 ? rIdx - 1 : 4;
  const totRow = rIdx;

  rowsXml.push(`<row r="${totRow}" ht="24" customHeight="1">
    ${textCell(`A${totRow}`, "TOTAL BANK TRANSACTIONS", 9)}
    ${textCell(`B${totRow}`, "", 9)}${textCell(`C${totRow}`, "", 9)}${textCell(`D${totRow}`, "", 9)}${textCell(`E${totRow}`, "", 9)}${textCell(`F${totRow}`, "", 9)}
    ${numCell(`G${totRow}`, 0, 10, `SUM(G${startRow}:G${endRow})`)}
    ${numCell(`H${totRow}`, 0, 10, `SUM(H${startRow}:H${endRow})`)}
    ${numCell(`I${totRow}`, 0, 10, `SUM(I${startRow}:I${endRow})`)}
    ${textCell(`J${totRow}`, "", 9)}${textCell(`K${totRow}`, "", 9)}${textCell(`L${totRow}`, "", 9)}${textCell(`M${totRow}`, "", 9)}
    ${numCell(`N${totRow}`, 0, 10, `SUM(N${startRow}:N${endRow})`)}
    ${numCell(`O${totRow}`, 0, 10, `SUM(O${startRow}:O${endRow})`)}
    ${textCell(`P${totRow}`, "", 9)}${textCell(`Q${totRow}`, "", 9)}${textCell(`R${totRow}`, "", 9)}
  </row>`);

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  ${buildSheetViewsXml(3)}
  ${buildColsXml(widths)}
  <sheetData>${rowsXml.join("")}</sheetData>
</worksheet>`;
}

/**
 * Sheet 4: Revenue & Expenses Detail
 */
function buildRevenueExpensesSheet(ctx: SheetContext): string {
  const { year, from, to, entityName } = ctx;
  const scope = entityBankAccounts();
  const journals = postedJournals().filter((journal) => {
    if (journal.date < from || journal.date > to) return false;
    if (scope.length === 0) return true;
    return journal.lines.some((line) => scope.includes(line.accountCode));
  });

  const byCode = new Map(state.chart.map((a) => [a.code, a]));
  const byName = new Map(state.chart.map((a) => [a.name.trim().toLowerCase(), a]));

  interface PlItem {
    category: string;
    accountCode: string;
    accountName: string;
    date: string;
    contact: string;
    description: string;
    reference: string;
    gross: number;
    gst: number;
    net: number;
    taxType: string;
    journalId: string;
  }

  const items: PlItem[] = [];
  for (const j of journals) {
    for (const l of j.lines) {
      const code = l.accountCode || byName.get(l.accountName.trim().toLowerCase())?.code || "";
      const plClass = plClassOfAccount(code, l.accountName);
      if (!plClass) continue;

      const category =
        plClass === "trading" || plClass === "otherIncome"
          ? "1. Revenue"
          : plClass === "costOfSales"
            ? "2. Cost of Sales"
            : "3. Operating Expenses";

      const acc = byCode.get(code);
      const accName = l.accountName || acc?.name || code;
      const net = (plClass === "trading" || plClass === "otherIncome" ? -l.amount : l.amount) / 100;
      const taxBase = l.taxBase !== null && l.taxBase !== undefined ? l.taxBase / 100 : net;
      const gross = taxBase;
      const gst = gross !== net ? gross - net : 0;

      items.push({
        category,
        accountCode: code,
        accountName: accName,
        date: j.date,
        contact: j.narration,
        description: l.description || j.narration,
        reference: j.transactionId,
        gross,
        gst,
        net,
        taxType: l.taxType === "NONE" ? "" : l.taxType,
        journalId: j.transactionId,
      });
    }
  }

  items.sort(
    (a, b) =>
      a.category.localeCompare(b.category) ||
      a.accountCode.localeCompare(b.accountCode) ||
      a.date.localeCompare(b.date),
  );

  const widths = [18, 14, 26, 12, 26, 32, 18, 16, 16, 16, 20, 16];
  const rowsXml: string[] = [];

  rowsXml.push(`<row r="1" ht="26" customHeight="1">
    ${textCell("A1", `${entityName} — Revenue & Expenses Detail (${year === "all" ? "All Financial Years" : "FY" + year})`, 13)}
  </row>`);
  rowsXml.push(`<row r="2" ht="18" customHeight="1">
    ${textCell("A2", `Itemised transactions making up the Profit & Loss statement for ${from} to ${to} (${items.length} lines)`, 14)}
  </row>`);

  rowsXml.push(`<row r="3" ht="22" customHeight="1">
    ${textCell("A3", "Category", 1)}
    ${textCell("B3", "Account Code", 1)}
    ${textCell("C3", "Account Name", 2)}
    ${textCell("D3", "Date", 1)}
    ${textCell("E3", "Contact / Payee", 2)}
    ${textCell("F3", "Line Description", 2)}
    ${textCell("G3", "Reference", 2)}
    ${textCell("H3", "Gross ($)", 3)}
    ${textCell("I3", "GST ($)", 3)}
    ${textCell("J3", "Net P&L ($)", 3)}
    ${textCell("K3", "Tax Treatment", 1)}
    ${textCell("L3", "Journal ID", 1)}
  </row>`);

  let rIdx = 4;
  let curCategory = "";
  let catStartRow = 4;

  for (const item of items) {
    if (item.category !== curCategory) {
      if (curCategory !== "" && rIdx > catStartRow) {
        const subTotRow = rIdx;
        rowsXml.push(`<row r="${subTotRow}" ht="20" customHeight="1">
          ${textCell(`A${subTotRow}`, `Subtotal: ${curCategory}`, 11)}
          ${textCell(`B${subTotRow}`, "", 11)}${textCell(`C${subTotRow}`, "", 11)}${textCell(`D${subTotRow}`, "", 11)}${textCell(`E${subTotRow}`, "", 11)}${textCell(`F${subTotRow}`, "", 11)}${textCell(`G${subTotRow}`, "", 11)}
          ${numCell(`H${subTotRow}`, 0, 12, `SUM(H${catStartRow}:H${subTotRow - 1})`)}
          ${numCell(`I${subTotRow}`, 0, 12, `SUM(I${catStartRow}:I${subTotRow - 1})`)}
          ${numCell(`J${subTotRow}`, 0, 12, `SUM(J${catStartRow}:J${subTotRow - 1})`)}
          ${textCell(`K${subTotRow}`, "", 11)}${textCell(`L${subTotRow}`, "", 11)}
        </row>`);
        rIdx++;
      }
      curCategory = item.category;
      catStartRow = rIdx;
    }

    rowsXml.push(`<row r="${rIdx}">
      ${textCell(`A${rIdx}`, item.category, 4)}
      ${textCell(`B${rIdx}`, item.accountCode, 5)}
      ${textCell(`C${rIdx}`, item.accountName, 4)}
      ${textCell(`D${rIdx}`, item.date, 5)}
      ${textCell(`E${rIdx}`, item.contact, 4)}
      ${textCell(`F${rIdx}`, item.description, 4)}
      ${textCell(`G${rIdx}`, item.reference, 4)}
      ${numCell(`H${rIdx}`, item.gross, 6)}
      ${numCell(`I${rIdx}`, item.gst, 6)}
      ${numCell(`J${rIdx}`, item.net, 6)}
      ${textCell(`K${rIdx}`, item.taxType, 5)}
      ${textCell(`L${rIdx}`, item.journalId, 5)}
    </row>`);
    rIdx++;
  }

  if (curCategory !== "" && rIdx > catStartRow) {
    const subTotRow = rIdx;
    rowsXml.push(`<row r="${subTotRow}" ht="20" customHeight="1">
      ${textCell(`A${subTotRow}`, `Subtotal: ${curCategory}`, 11)}
      ${textCell(`B${subTotRow}`, "", 11)}${textCell(`C${subTotRow}`, "", 11)}${textCell(`D${subTotRow}`, "", 11)}${textCell(`E${subTotRow}`, "", 11)}${textCell(`F${subTotRow}`, "", 11)}${textCell(`G${subTotRow}`, "", 11)}
      ${numCell(`H${subTotRow}`, 0, 12, `SUM(H${catStartRow}:H${subTotRow - 1})`)}
      ${numCell(`I${subTotRow}`, 0, 12, `SUM(I${catStartRow}:I${subTotRow - 1})`)}
      ${numCell(`J${subTotRow}`, 0, 12, `SUM(J${catStartRow}:J${subTotRow - 1})`)}
      ${textCell(`K${subTotRow}`, "", 11)}${textCell(`L${subTotRow}`, "", 11)}
    </row>`);
    rIdx++;
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  ${buildSheetViewsXml(3)}
  ${buildColsXml(widths)}
  <sheetData>${rowsXml.join("")}</sheetData>
</worksheet>`;
}

/**
 * Sheet 5: Unusual & Non-Standard Transactions
 */
function buildUnusualTransactionsSheet(ctx: SheetContext): string {
  const { year, from, to, entityName } = ctx;
  const engine = reportEngine();
  const txs = (engine?.transactions ?? []).filter((t) => t.date >= from && t.date <= to);
  const byCode = new Map(state.chart.map((a) => [a.code, a]));

  const widths = [24, 12, 30, 14, 24, 16, 20, 34];
  const rowsXml: string[] = [];

  rowsXml.push(`<row r="1" ht="26" customHeight="1">
    ${textCell("A1", `${entityName} — Non-Standard & Unusual Transactions Audit (${year === "all" ? "All Financial Years" : "FY" + year})`, 13)}
  </row>`);
  rowsXml.push(`<row r="2" ht="18" customHeight="1">
    ${textCell("A2", `Audit exceptions: split transactions, combined invoice settlements, credit notes, border GST, entertainment, transfers for ${from} to ${to}`, 14)}
  </row>`);

  let rIdx = 4;

  // 1. Split Transactions
  const splits = state.ledger.splits ?? {};
  const splitTxs = txs.filter((t) => (splits[t.id]?.length ?? 0) > 1);

  rowsXml.push(`<row r="${rIdx}" ht="22" customHeight="1">
    ${textCell(`A${rIdx}`, "1. Split Transactions (Single Bank Entry Split Across Multiple Accounts)", 15)}
    ${textCell(`B${rIdx}`, "", 15)}${textCell(`C${rIdx}`, "", 15)}${textCell(`D${rIdx}`, "", 15)}${textCell(`E${rIdx}`, "", 15)}${textCell(`F${rIdx}`, "", 15)}${textCell(`G${rIdx}`, "", 15)}${textCell(`H${rIdx}`, "", 15)}
  </row>`);
  rIdx++;

  rowsXml.push(`<row r="${rIdx}" ht="20" customHeight="1">
    ${textCell(`A${rIdx}`, "Type", 18)}
    ${textCell(`B${rIdx}`, "Date", 20)}
    ${textCell(`C${rIdx}`, "Payee / Particulars", 18)}
    ${textCell(`D${rIdx}`, "Account Code", 20)}
    ${textCell(`E${rIdx}`, "Account Name", 18)}
    ${textCell(`F${rIdx}`, "Amount ($)", 19)}
    ${textCell(`G${rIdx}`, "GST Treatment", 20)}
    ${textCell(`H${rIdx}`, "Part Note / Description", 18)}
  </row>`);
  rIdx++;

  if (splitTxs.length === 0) {
    rowsXml.push(`<row r="${rIdx}">
      ${textCell(`A${rIdx}`, "None", 4)}
      ${textCell(`B${rIdx}`, "-", 5)}
      ${textCell(`C${rIdx}`, "No split transactions recorded in this period.", 4)}
      ${textCell(`D${rIdx}`, "", 4)}${textCell(`E${rIdx}`, "", 4)}${textCell(`F${rIdx}`, "", 4)}${textCell(`G${rIdx}`, "", 4)}${textCell(`H${rIdx}`, "", 4)}
    </row>`);
    rIdx++;
  } else {
    for (const t of splitTxs) {
      const parts = splits[t.id] ?? [];
      rowsXml.push(`<row r="${rIdx}">
        ${textCell(`A${rIdx}`, "Parent Bank Tx", 9)}
        ${textCell(`B${rIdx}`, t.date, 5)}
        ${textCell(`C${rIdx}`, t.otherParty || t.particulars || "Bank Entry", 4)}
        ${textCell(`D${rIdx}`, t.account, 5)}
        ${textCell(`E${rIdx}`, "Bank Account", 4)}
        ${numCell(`F${rIdx}`, t.amount / 100, 10)}
        ${textCell(`G${rIdx}`, `${parts.length} parts`, 5)}
        ${textCell(`H${rIdx}`, `Tx ID: ${t.id}`, 4)}
      </row>`);
      rIdx++;

      for (let p = 0; p < parts.length; p++) {
        const part = parts[p];
        if (!part) continue;
        const partCode = part.code ?? "";
        const acc = byCode.get(partCode);
        rowsXml.push(`<row r="${rIdx}">
          ${textCell(`A${rIdx}`, `  └─ Part ${p + 1}`, 4)}
          ${textCell(`B${rIdx}`, t.date, 5)}
          ${textCell(`C${rIdx}`, part.note || "Split allocation", 4)}
          ${textCell(`D${rIdx}`, partCode, 5)}
          ${textCell(`E${rIdx}`, acc?.name ?? partCode, 4)}
          ${numCell(`F${rIdx}`, part.amount / 100, 6)}
          ${textCell(`G${rIdx}`, part.treatment ?? "standard", 5)}
          ${textCell(`H${rIdx}`, part.note ?? "", 4)}
        </row>`);
        rIdx++;
      }
    }
  }

  // 2. Combined Invoice Settlements
  rIdx++;
  rowsXml.push(`<row r="${rIdx}" ht="22" customHeight="1">
    ${textCell(`A${rIdx}`, "2. Invoices & Matched Settlements (Combined Payments, Instalments)", 15)}
    ${textCell(`B${rIdx}`, "", 15)}${textCell(`C${rIdx}`, "", 15)}${textCell(`D${rIdx}`, "", 15)}${textCell(`E${rIdx}`, "", 15)}${textCell(`F${rIdx}`, "", 15)}${textCell(`G${rIdx}`, "", 15)}${textCell(`H${rIdx}`, "", 15)}
  </row>`);
  rIdx++;

  rowsXml.push(`<row r="${rIdx}" ht="20" customHeight="1">
    ${textCell(`A${rIdx}`, "Invoice #", 18)}
    ${textCell(`B${rIdx}`, "Issue Date", 20)}
    ${textCell(`C${rIdx}`, "Customer / Contact", 18)}
    ${textCell(`D${rIdx}`, "Kind", 20)}
    ${textCell(`E${rIdx}`, "Settlement Status", 18)}
    ${textCell(`F${rIdx}`, "Invoice Total ($)", 19)}
    ${textCell(`G${rIdx}`, "Due Date", 20)}
    ${textCell(`H${rIdx}`, "Matched Bank Tx / Notes", 18)}
  </row>`);
  rIdx++;

  const invoices = (state.ledger.invoices ?? []).filter(
    (inv) => inv.issued >= from && inv.issued <= to,
  );
  const assignments = invoiceAssignments();

  if (invoices.length === 0) {
    rowsXml.push(`<row r="${rIdx}">
      ${textCell(`A${rIdx}`, "None", 4)}
      ${textCell(`B${rIdx}`, "-", 5)}
      ${textCell(`C${rIdx}`, "No invoices recorded for this period.", 4)}
      ${textCell(`D${rIdx}`, "", 4)}${textCell(`E${rIdx}`, "", 4)}${textCell(`F${rIdx}`, "", 4)}${textCell(`G${rIdx}`, "", 4)}${textCell(`H${rIdx}`, "", 4)}
    </row>`);
    rIdx++;
  } else {
    for (const inv of invoices) {
      const isSettled = inv.paid >= inv.total;
      const matchedTxs: string[] = [];
      for (const [txId, num] of assignments.entries()) {
        if (num === inv.number) matchedTxs.push(txId);
      }

      rowsXml.push(`<row r="${rIdx}">
        ${textCell(`A${rIdx}`, inv.number, 5)}
        ${textCell(`B${rIdx}`, inv.issued, 5)}
        ${textCell(`C${rIdx}`, inv.contact, 4)}
        ${textCell(`D${rIdx}`, inv.kind, 5)}
        ${textCell(`E${rIdx}`, isSettled ? "Fully Settled" : inv.paid > 0 ? "Partially Settled" : "Awaiting Settlement", isSettled ? 17 : 5)}
        ${numCell(`F${rIdx}`, inv.total / 100, 6)}
        ${textCell(`G${rIdx}`, inv.due ?? "None", 5)}
        ${textCell(`H${rIdx}`, matchedTxs.length > 0 ? `Matched to ${matchedTxs.length} bank entries` : inv.reference || "", 4)}
      </row>`);
      rIdx++;
    }
  }

  // 3. Non-Standard GST Treatments (Border Customs, 50% Entertainment, Assumed)
  rIdx++;
  rowsXml.push(`<row r="${rIdx}" ht="22" customHeight="1">
    ${textCell(`A${rIdx}`, "3. Non-Standard GST Treatments (Border Customs, 50% Entertainment, Assumed)", 15)}
    ${textCell(`B${rIdx}`, "", 15)}${textCell(`C${rIdx}`, "", 15)}${textCell(`D${rIdx}`, "", 15)}${textCell(`E${rIdx}`, "", 15)}${textCell(`F${rIdx}`, "", 15)}${textCell(`G${rIdx}`, "", 15)}${textCell(`H${rIdx}`, "", 15)}
  </row>`);
  rIdx++;

  rowsXml.push(`<row r="${rIdx}" ht="20" customHeight="1">
    ${textCell(`A${rIdx}`, "Audit Tag", 18)}
    ${textCell(`B${rIdx}`, "Date", 20)}
    ${textCell(`C${rIdx}`, "Payee / Particulars", 18)}
    ${textCell(`D${rIdx}`, "Account Code", 20)}
    ${textCell(`E${rIdx}`, "Account Name", 18)}
    ${textCell(`F${rIdx}`, "Amount ($)", 19)}
    ${textCell(`G${rIdx}`, "GST Amount ($)", 19)}
    ${textCell(`H${rIdx}`, "Audit Note / Treatment", 18)}
  </row>`);
  rIdx++;

  const unusualGst = txs.filter((t) => {
    const cl = engine?.classify(t);
    if (!cl) return false;
    return (
      cl.side === "imports" ||
      cl.assumed ||
      /entertainment/i.test(t.otherParty) ||
      /entertainment/i.test(t.particulars)
    );
  });

  if (unusualGst.length === 0) {
    rowsXml.push(`<row r="${rIdx}">
      ${textCell(`A${rIdx}`, "None", 4)}
      ${textCell(`B${rIdx}`, "-", 5)}
      ${textCell(`C${rIdx}`, "No non-standard GST or assumed treatments found.", 4)}
      ${textCell(`D${rIdx}`, "", 4)}${textCell(`E${rIdx}`, "", 4)}${textCell(`F${rIdx}`, "", 4)}${textCell(`G${rIdx}`, "", 4)}${textCell(`H${rIdx}`, "", 4)}
    </row>`);
    rIdx++;
  } else {
    for (const t of unusualGst) {
      const cl = engine!.classify(t);
      const gst = gstWithin(t.amount, cl);
      const code = engine!.codeOf(t) ?? "";
      const acc = byCode.get(code);
      const tag =
        cl.side === "imports"
          ? "Border GST (100%)"
          : cl.assumed
            ? "Assumed GST (Review)"
            : "Entertainment (50%)";

      rowsXml.push(`<row r="${rIdx}">
        ${textCell(`A${rIdx}`, tag, cl.assumed ? 16 : 4)}
        ${textCell(`B${rIdx}`, t.date, 5)}
        ${textCell(`C${rIdx}`, t.otherParty || t.particulars, 4)}
        ${textCell(`D${rIdx}`, code, 5)}
        ${textCell(`E${rIdx}`, acc?.name ?? code, 4)}
        ${numCell(`F${rIdx}`, t.amount / 100, 6)}
        ${numCell(`G${rIdx}`, gst / 100, 6)}
        ${textCell(`H${rIdx}`, cl.reason || gstRateName(cl), 4)}
      </row>`);
      rIdx++;
    }
  }

  // 4. Inter-Account Transfers
  rIdx++;
  rowsXml.push(`<row r="${rIdx}" ht="22" customHeight="1">
    ${textCell(`A${rIdx}`, "4. Internal Bank Account Transfers (Non-P&L Movements)", 15)}
    ${textCell(`B${rIdx}`, "", 15)}${textCell(`C${rIdx}`, "", 15)}${textCell(`D${rIdx}`, "", 15)}${textCell(`E${rIdx}`, "", 15)}${textCell(`F${rIdx}`, "", 15)}${textCell(`G${rIdx}`, "", 15)}${textCell(`H${rIdx}`, "", 15)}
  </row>`);
  rIdx++;

  rowsXml.push(`<row r="${rIdx}" ht="20" customHeight="1">
    ${textCell(`A${rIdx}`, "Transfer Tag", 18)}
    ${textCell(`B${rIdx}`, "Date", 20)}
    ${textCell(`C${rIdx}`, "Particulars / Memo", 18)}
    ${textCell(`D${rIdx}`, "From Account", 20)}
    ${textCell(`E${rIdx}`, "To Account", 18)}
    ${textCell(`F${rIdx}`, "Amount ($)", 19)}
    ${textCell(`G${rIdx}`, "Matched Pair ID", 20)}
    ${textCell(`H${rIdx}`, "Audit Note", 18)}
  </row>`);
  rIdx++;

  const transfers = state.ledger.transfers ?? {};
  const transferTxs = txs.filter((t) => transfers[t.id] !== undefined && t.amount < 0);

  if (transferTxs.length === 0) {
    rowsXml.push(`<row r="${rIdx}">
      ${textCell(`A${rIdx}`, "None", 4)}
      ${textCell(`B${rIdx}`, "-", 5)}
      ${textCell(`C${rIdx}`, "No internal transfers recorded in this period.", 4)}
      ${textCell(`D${rIdx}`, "", 4)}${textCell(`E${rIdx}`, "", 4)}${textCell(`F${rIdx}`, "", 4)}${textCell(`G${rIdx}`, "", 4)}${textCell(`H${rIdx}`, "", 4)}
    </row>`);
    rIdx++;
  } else {
    for (const t of transferTxs) {
      const matchId = transfers[t.id] ?? "";
      const matchTx = (engine?.transactions ?? []).find((m) => m.id === matchId);
      rowsXml.push(`<row r="${rIdx}">
        ${textCell(`A${rIdx}`, "Bank Transfer", 4)}
        ${textCell(`B${rIdx}`, t.date, 5)}
        ${textCell(`C${rIdx}`, t.particulars || t.reference || "Transfer", 4)}
        ${textCell(`D${rIdx}`, t.account, 5)}
        ${textCell(`E${rIdx}`, matchTx?.account ?? matchId, 4)}
        ${numCell(`F${rIdx}`, Math.abs(t.amount) / 100, 6)}
        ${textCell(`G${rIdx}`, matchId, 5)}
        ${textCell(`H${rIdx}`, "Zero net P&L effect (internal transfer)", 4)}
      </row>`);
      rIdx++;
    }
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  ${buildSheetViewsXml(3)}
  ${buildColsXml(widths)}
  <sheetData>${rowsXml.join("")}</sheetData>
</worksheet>`;
}

/**
 * Sheet 6: Fixed Asset Register & Depreciation Schedule
 */
function buildDepreciationSheet(ctx: SheetContext): string {
  const { year, from, to, entityName } = ctx;
  const assets = state.ledger.assets ?? [];
  const schedule = depreciationSchedule(assets, { from, to });
  const proceedsMap = assetProceedsInUse();

  const widths = [14, 30, 20, 12, 16, 10, 12, 16, 16, 16, 14, 16, 16, 16, 16, 16];
  const rowsXml: string[] = [];

  rowsXml.push(`<row r="1" ht="26" customHeight="1">
    ${textCell("A1", `${entityName} — Fixed Asset Register & Depreciation Schedule (${year === "all" ? "All Financial Years" : "FY" + year})`, 13)}
  </row>`);
  rowsXml.push(`<row r="2" ht="18" customHeight="1">
    ${textCell("A2", `Tax depreciation schedule for ${from} to ${to} (${assets.length} registered assets)`, 14)}
  </row>`);

  rowsXml.push(`<row r="3" ht="22" customHeight="1">
    ${textCell("A3", "Asset Code / ID", 1)}
    ${textCell("B3", "Asset Description", 2)}
    ${textCell("C3", "Asset Type", 2)}
    ${textCell("D3", "Purchase Date", 1)}
    ${textCell("E3", "Original Cost ($)", 3)}
    ${textCell("F3", "Method", 1)}
    ${textCell("G3", "Rate (%)", 3)}
    ${textCell("H3", "Opening Value ($)", 3)}
    ${textCell("I3", "Additions ($)", 3)}
    ${textCell("J3", "Depreciation ($)", 3)}
    ${textCell("K3", "Disposal Date", 1)}
    ${textCell("L3", "Proceeds ($)", 3)}
    ${textCell("M3", "Disposal Book Val ($)", 3)}
    ${textCell("N3", "Gain / (Loss) ($)", 3)}
    ${textCell("O3", "Closing Value ($)", 3)}
    ${textCell("P3", "Accumulated Dep ($)", 3)}
  </row>`);

  let rIdx = 4;
  if (schedule.rows.length === 0) {
    rowsXml.push(`<row r="${rIdx}">
      ${textCell(`A${rIdx}`, "None", 4)}
      ${textCell(`B${rIdx}`, "No depreciable fixed assets recorded in the asset register.", 4)}
      ${textCell(`C${rIdx}`, "", 4)}${textCell(`D${rIdx}`, "", 4)}${textCell(`E${rIdx}`, "", 4)}${textCell(`F${rIdx}`, "", 4)}${textCell(`G${rIdx}`, "", 4)}
      ${textCell(`H${rIdx}`, "", 4)}${textCell(`I${rIdx}`, "", 4)}${textCell(`J${rIdx}`, "", 4)}${textCell(`K${rIdx}`, "", 4)}${textCell(`L${rIdx}`, "", 4)}
      ${textCell(`M${rIdx}`, "", 4)}${textCell(`N${rIdx}`, "", 4)}${textCell(`O${rIdx}`, "", 4)}${textCell(`P${rIdx}`, "", 4)}
    </row>`);
    rIdx++;
  } else {
    for (const row of schedule.rows) {
      const a = row.asset;
      const isNew = (a.purchased ?? "") >= from && (a.purchased ?? "") <= to;
      const additions = isNew ? a.cost / 100 : 0;
      const proceeds = (proceedsMap[a.number] ?? 0) / 100;
      const bookAtDisposal = row.bookValueAtDisposal / 100;
      const gainLoss = row.disposedInPeriod ? proceeds - bookAtDisposal : 0;

      rowsXml.push(`<row r="${rIdx}">
        ${textCell(`A${rIdx}`, a.number, 5)}
        ${textCell(`B${rIdx}`, a.name, 4)}
        ${textCell(`C${rIdx}`, a.type, 4)}
        ${textCell(`D${rIdx}`, a.purchased ?? "", 5)}
        ${numCell(`E${rIdx}`, a.cost / 100, 6)}
        ${textCell(`F${rIdx}`, isDiminishing(a) ? "DV" : "SL", 5)}
        ${pctCell(`G${rIdx}`, a.rate, 8)}
        ${numCell(`H${rIdx}`, row.opening / 100, 6)}
        ${numCell(`I${rIdx}`, additions, 6)}
        ${numCell(`J${rIdx}`, row.depreciation / 100, 6)}
        ${textCell(`K${rIdx}`, a.disposed ?? "", 5)}
        ${row.disposedInPeriod ? numCell(`L${rIdx}`, proceeds, 6) : textCell(`L${rIdx}`, "", 4)}
        ${row.disposedInPeriod ? numCell(`M${rIdx}`, bookAtDisposal, 6) : textCell(`M${rIdx}`, "", 4)}
        ${row.disposedInPeriod ? numCell(`N${rIdx}`, gainLoss, 6) : textCell(`N${rIdx}`, "", 4)}
        ${numCell(`O${rIdx}`, row.closing / 100, 6)}
        ${numCell(`P${rIdx}`, row.accumulated / 100, 6)}
      </row>`);
      rIdx++;
    }

    const startRow = 4;
    const endRow = rIdx - 1;
    const totRow = rIdx;

    rowsXml.push(`<row r="${totRow}" ht="24" customHeight="1">
      ${textCell(`A${totRow}`, "TOTAL FIXED ASSETS", 9)}
      ${textCell(`B${totRow}`, "", 9)}${textCell(`C${totRow}`, "", 9)}${textCell(`D${totRow}`, "", 9)}
      ${numCell(`E${totRow}`, 0, 10, `SUM(E${startRow}:E${endRow})`)}
      ${textCell(`F${totRow}`, "", 9)}${textCell(`G${totRow}`, "", 9)}
      ${numCell(`H${totRow}`, 0, 10, `SUM(H${startRow}:H${endRow})`)}
      ${numCell(`I${totRow}`, 0, 10, `SUM(I${startRow}:I${endRow})`)}
      ${numCell(`J${totRow}`, 0, 10, `SUM(J${startRow}:J${endRow})`)}
      ${textCell(`K${totRow}`, "", 9)}
      ${numCell(`L${totRow}`, 0, 10, `SUM(L${startRow}:L${endRow})`)}
      ${numCell(`M${totRow}`, 0, 10, `SUM(M${startRow}:M${endRow})`)}
      ${numCell(`N${totRow}`, 0, 10, `SUM(N${startRow}:N${endRow})`)}
      ${numCell(`O${totRow}`, 0, 10, `SUM(O${startRow}:O${endRow})`)}
      ${numCell(`P${totRow}`, 0, 10, `SUM(P${startRow}:P${endRow})`)}
    </row>`);
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  ${buildSheetViewsXml(3)}
  ${buildColsXml(widths)}
  <sheetData>${rowsXml.join("")}</sheetData>
</worksheet>`;
}

/**
 * Sheet 7: Statutory GST Returns (Boxes 5 to 15)
 */
function buildGstReturnsSheet(ctx: SheetContext): string {
  const { year, from, to, entityName, gstNumber } = ctx;
  const vInput = varianceInput();
  const returnResults = computeOurReturns(vInput, from, to);

  const widths = [14, 12, 12, 12, 18, 16, 18, 16, 16, 18, 18, 16, 16, 18, 18, 22];
  const rowsXml: string[] = [];

  rowsXml.push(`<row r="1" ht="26" customHeight="1">
    ${textCell("A1", `${entityName} — Statutory GST Returns Reconciliation (${year === "all" ? "All Financial Years" : "FY" + year})`, 13)}
  </row>`);
  rowsXml.push(`<row r="2" ht="18" customHeight="1">
    ${textCell("A2", `Period-by-period Box 5 to Box 15 return calculations and statutory totals (${from} to ${to}) | GST #: ${gstNumber || "Not registered"}`, 14)}
  </row>`);

  rowsXml.push(`<row r="3" ht="22" customHeight="1">
    ${textCell("A3", "Period", 1)}
    ${textCell("B3", "From Date", 1)}
    ${textCell("C3", "To Date", 1)}
    ${textCell("D3", "Due Date", 1)}
    ${textCell("E3", "Box 5: Sales (incl GST)", 3)}
    ${textCell("F3", "Box 6: Zero-Rated", 3)}
    ${textCell("G3", "Box 7: Net Sales", 3)}
    ${textCell("H3", "Box 8: Output GST", 3)}
    ${textCell("I3", "Box 9: Adjustments", 3)}
    ${textCell("J3", "Box 10: Total Output", 3)}
    ${textCell("K3", "Box 11: Purchases", 3)}
    ${textCell("L3", "Box 12: Input GST", 3)}
    ${textCell("M3", "Box 13: Adjustments", 3)}
    ${textCell("N3", "Box 14: Total Credit", 3)}
    ${textCell("O3", "Box 15: Net GST", 3)}
    ${textCell("P3", "Status / Filing Note", 1)}
  </row>`);

  let rIdx = 4;
  if (returnResults.length === 0) {
    rowsXml.push(`<row r="${rIdx}">
      ${textCell(`A${rIdx}`, "None", 4)}
      ${textCell(`B${rIdx}`, from, 5)}
      ${textCell(`C${rIdx}`, to, 5)}
      ${textCell(`D${rIdx}`, "-", 5)}
      ${textCell(`E${rIdx}`, "No GST returns computed for this financial year.", 4)}
      ${textCell(`F${rIdx}`, "", 4)}${textCell(`G${rIdx}`, "", 4)}${textCell(`H${rIdx}`, "", 4)}${textCell(`I${rIdx}`, "", 4)}${textCell(`J${rIdx}`, "", 4)}
      ${textCell(`K${rIdx}`, "", 4)}${textCell(`L${rIdx}`, "", 4)}${textCell(`M${rIdx}`, "", 4)}${textCell(`N${rIdx}`, "", 4)}${textCell(`O${rIdx}`, "", 4)}${textCell(`P${rIdx}`, "", 4)}
    </row>`);
    rIdx++;
  } else {
    for (const res of returnResults) {
      const b = res.boxes;
      const b5 = b.box5 / 100;
      const b6 = b.box6 / 100;
      const b7 = (b.box5 - b.box6) / 100;
      const b8 = b.box8 / 100;
      const b9 = b.box9 / 100;
      const b10 = (b.box8 + b.box9) / 100;
      const b11 = b.box11 / 100;
      const b12 = b.box12 / 100;
      const b13 = b.box13 / 100;
      const b14 = (b.box12 + b.box13) / 100;
      const b15 = b.box15 / 100;

      rowsXml.push(`<row r="${rIdx}">
        ${textCell(`A${rIdx}`, res.period.label, 5)}
        ${textCell(`B${rIdx}`, res.period.from, 5)}
        ${textCell(`C${rIdx}`, res.period.to, 5)}
        ${textCell(`D${rIdx}`, res.period.payBy !== undefined && res.period.payBy !== res.period.due ? `${res.period.due} (pay by ${res.period.payBy})` : res.period.due, 5)}
        ${numCell(`E${rIdx}`, b5, 6)}
        ${numCell(`F${rIdx}`, b6, 6)}
        ${numCell(`G${rIdx}`, b7, 6, `E${rIdx}-F${rIdx}`)}
        ${numCell(`H${rIdx}`, b8, 6)}
        ${numCell(`I${rIdx}`, b9, 6)}
        ${numCell(`J${rIdx}`, b10, 6, `H${rIdx}+I${rIdx}`)}
        ${numCell(`K${rIdx}`, b11, 6)}
        ${numCell(`L${rIdx}`, b12, 6)}
        ${numCell(`M${rIdx}`, b13, 6)}
        ${numCell(`N${rIdx}`, b14, 6, `L${rIdx}+M${rIdx}`)}
        ${numCell(`O${rIdx}`, b15, 6, `J${rIdx}-N${rIdx}`)}
        ${textCell(`P${rIdx}`, b15 >= 0 ? "GST to Pay" : "GST Refund", b15 >= 0 ? 5 : 17)}
      </row>`);
      rIdx++;
    }

    const startRow = 4;
    const endRow = rIdx - 1;
    const totRow = rIdx;

    rowsXml.push(`<row r="${totRow}" ht="24" customHeight="1">
      ${textCell(`A${totRow}`, year === "all" ? "ALL PERIODS COMBINED" : `FULL YEAR FY${year}`, 9)}
      ${textCell(`B${totRow}`, from, 9)}
      ${textCell(`C${totRow}`, to, 9)}
      ${textCell(`D${totRow}`, "", 9)}
      ${numCell(`E${totRow}`, 0, 10, `SUM(E${startRow}:E${endRow})`)}
      ${numCell(`F${totRow}`, 0, 10, `SUM(F${startRow}:F${endRow})`)}
      ${numCell(`G${totRow}`, 0, 10, `SUM(G${startRow}:G${endRow})`)}
      ${numCell(`H${totRow}`, 0, 10, `SUM(H${startRow}:H${endRow})`)}
      ${numCell(`I${totRow}`, 0, 10, `SUM(I${startRow}:I${endRow})`)}
      ${numCell(`J${totRow}`, 0, 10, `SUM(J${startRow}:J${endRow})`)}
      ${numCell(`K${totRow}`, 0, 10, `SUM(K${startRow}:K${endRow})`)}
      ${numCell(`L${totRow}`, 0, 10, `SUM(L${startRow}:L${endRow})`)}
      ${numCell(`M${totRow}`, 0, 10, `SUM(M${startRow}:M${endRow})`)}
      ${numCell(`N${totRow}`, 0, 10, `SUM(N${startRow}:N${endRow})`)}
      ${numCell(`O${totRow}`, 0, 10, `SUM(O${startRow}:O${endRow})`)}
      ${textCell(`P${totRow}`, "Annual Reconciliation", 9)}
    </row>`);
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  ${buildSheetViewsXml(3)}
  ${buildColsXml(widths)}
  <sheetData>${rowsXml.join("")}</sheetData>
</worksheet>`;
}

/**
 * Sheet 8: Raw Database Table: transactions
 */
function buildRawTransactionsSheet(ctx: SheetContext): string {
  const { entityName } = ctx;
  const txs = state.ledger.transactions ?? [];
  const widths = [32, 12, 22, 14, 8, 26, 20, 18, 20, 22, 10, 10, 12, 12, 12, 12, 16, 26, 12];
  const rowsXml: string[] = [];

  rowsXml.push(`<row r="1" ht="26" customHeight="1">
    ${textCell("A1", `${entityName} — Raw Database Table: transactions`, 13)}
  </row>`);
  rowsXml.push(`<row r="2" ht="18" customHeight="1">
    ${textCell("A2", `Direct export of raw bank statement rows imported into the database | Total records: ${txs.length}`, 14)}
  </row>`);

  rowsXml.push(`<row r="3" ht="22" customHeight="1">
    ${textCell("A3", "Transaction ID", 1)}
    ${textCell("B3", "Date", 1)}
    ${textCell("C3", "Bank Account", 1)}
    ${textCell("D3", "Amount ($)", 3)}
    ${textCell("E3", "Currency", 1)}
    ${textCell("F3", "Other Party / Payee", 2)}
    ${textCell("G3", "Particulars", 2)}
    ${textCell("H3", "Code", 2)}
    ${textCell("I3", "Reference", 2)}
    ${textCell("J3", "Other Party Account", 2)}
    ${textCell("K3", "Type", 1)}
    ${textCell("L3", "TRN", 1)}
    ${textCell("M3", "Serial", 1)}
    ${textCell("N3", "Batch", 1)}
    ${textCell("O3", "Origin", 1)}
    ${textCell("P3", "Occurrence", 3)}
    ${textCell("Q3", "Importer", 2)}
    ${textCell("R3", "Source File", 2)}
    ${textCell("S3", "Source Line", 3)}
  </row>`);

  let rIdx = 4;
  if (txs.length === 0) {
    rowsXml.push(`<row r="${rIdx}">
      ${textCell(`A${rIdx}`, "No transactions", 5)}
      ${textCell(`B${rIdx}`, "No bank transactions recorded in database.", 4)}
    </row>`);
  } else {
    for (const t of txs) {
      rowsXml.push(`<row r="${rIdx}">
        ${textCell(`A${rIdx}`, t.id, 5)}
        ${textCell(`B${rIdx}`, t.date, 5)}
        ${textCell(`C${rIdx}`, t.account, 5)}
        ${numCell(`D${rIdx}`, t.amount / 100, 6)}
        ${textCell(`E${rIdx}`, t.currency || "NZD", 5)}
        ${textCell(`F${rIdx}`, t.otherParty, 4)}
        ${textCell(`G${rIdx}`, t.particulars, 4)}
        ${textCell(`H${rIdx}`, t.code, 4)}
        ${textCell(`I${rIdx}`, t.reference, 4)}
        ${textCell(`J${rIdx}`, t.otherPartyAccount, 4)}
        ${textCell(`K${rIdx}`, t.type, 5)}
        ${textCell(`L${rIdx}`, t.trn, 5)}
        ${textCell(`M${rIdx}`, t.serial, 5)}
        ${textCell(`N${rIdx}`, t.batch, 5)}
        ${textCell(`O${rIdx}`, t.origin, 5)}
        ${numCell(`P${rIdx}`, t.occurrence ?? 1, 7)}
        ${textCell(`Q${rIdx}`, t.source?.importer ?? "", 4)}
        ${textCell(`R${rIdx}`, t.source?.file ?? "", 4)}
        ${t.source?.line ? numCell(`S${rIdx}`, t.source.line, 7) : textCell(`S${rIdx}`, "", 5)}
      </row>`);
      rIdx++;
    }

    const startRow = 4;
    const endRow = rIdx - 1;
    const totRow = rIdx;
    rowsXml.push(`<row r="${totRow}" ht="24" customHeight="1">
      ${textCell(`A${totRow}`, `TOTAL TRANSACTIONS (${txs.length})`, 9)}
      ${textCell(`B${totRow}`, "", 9)}${textCell(`C${totRow}`, "", 9)}
      ${numCell(`D${totRow}`, 0, 10, `SUM(D${startRow}:D${endRow})`)}
    </row>`);
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  ${buildSheetViewsXml(3)}
  ${buildColsXml(widths)}
  <sheetData>${rowsXml.join("")}</sheetData>
</worksheet>`;
}

/**
 * Sheet 9: Raw Database Table: chart
 */
function buildRawChartSheet(ctx: SheetContext): string {
  const { entityName } = ctx;
  const accounts = state.ledger.chart ?? [];
  const widths = [14, 32, 22, 22, 18, 20, 16, 24, 40];
  const rowsXml: string[] = [];

  rowsXml.push(`<row r="1" ht="26" customHeight="1">
    ${textCell("A1", `${entityName} — Raw Database Table: chart`, 13)}
  </row>`);
  rowsXml.push(`<row r="2" ht="18" customHeight="1">
    ${textCell("A2", `Master Chart of Accounts registry | Total accounts: ${accounts.length}`, 14)}
  </row>`);

  rowsXml.push(`<row r="3" ht="22" customHeight="1">
    ${textCell("A3", "Account Code", 1)}
    ${textCell("B3", "Account Name", 2)}
    ${textCell("C3", "Classification / Type", 1)}
    ${textCell("D3", "Source Tax Code", 2)}
    ${textCell("E3", "GST Treatment", 1)}
    ${textCell("F3", "Assigned Entity", 2)}
    ${textCell("G3", "Entity Kind", 1)}
    ${textCell("H3", "Entity Owners", 2)}
    ${textCell("I3", "Description / Notes", 2)}
  </row>`);

  let rIdx = 4;
  if (accounts.length === 0) {
    rowsXml.push(`<row r="${rIdx}">
      ${textCell(`A${rIdx}`, "No accounts", 5)}
      ${textCell(`B${rIdx}`, "No chart of accounts loaded in database.", 4)}
    </row>`);
  } else {
    for (const a of accounts) {
      rowsXml.push(`<row r="${rIdx}">
        ${textCell(`A${rIdx}`, a.code, 5)}
        ${textCell(`B${rIdx}`, a.name, 4)}
        ${textCell(`C${rIdx}`, a.type, 5)}
        ${textCell(`D${rIdx}`, a.taxCode, 4)}
        ${textCell(`E${rIdx}`, a.gstTreatment ?? "standard", 5)}
        ${textCell(`F${rIdx}`, a.entity ?? "", 4)}
        ${textCell(`G${rIdx}`, a.entityKind ?? "", 5)}
        ${textCell(`H${rIdx}`, a.entityOwners ?? "", 4)}
        ${textCell(`I${rIdx}`, a.description ?? "", 4)}
      </row>`);
      rIdx++;
    }
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  ${buildSheetViewsXml(3)}
  ${buildColsXml(widths)}
  <sheetData>${rowsXml.join("")}</sheetData>
</worksheet>`;
}

/**
 * Sheet 10: Raw Database Table: invoices
 */
function buildRawInvoicesSheet(ctx: SheetContext): string {
  const { entityName } = ctx;
  const invoices = state.ledger.invoices ?? [];
  const widths = [16, 14, 26, 16, 12, 12, 16, 8, 32, 14, 20, 10, 14, 14, 14, 15, 14, 14];
  const rowsXml: string[] = [];

  rowsXml.push(`<row r="1" ht="26" customHeight="1">
    ${textCell("A1", `${entityName} — Raw Database Table: invoices`, 13)}
  </row>`);
  rowsXml.push(`<row r="2" ht="18" customHeight="1">
    ${textCell("A2", `Sales invoices, supplier bills, and line-item breakdown | Total documents: ${invoices.length}`, 14)}
  </row>`);

  rowsXml.push(`<row r="3" ht="22" customHeight="1">
    ${textCell("A3", "Invoice #", 1)}
    ${textCell("B3", "Kind", 1)}
    ${textCell("C3", "Contact", 2)}
    ${textCell("D3", "Reference", 2)}
    ${textCell("E3", "Issue Date", 1)}
    ${textCell("F3", "Due Date", 1)}
    ${textCell("G3", "Status", 1)}
    ${textCell("H3", "Currency", 1)}
    ${textCell("I3", "Line Description", 2)}
    ${textCell("J3", "Account Code", 1)}
    ${textCell("K3", "Tax Type", 2)}
    ${textCell("L3", "Qty", 3)}
    ${textCell("M3", "Line Net ($)", 3)}
    ${textCell("N3", "Line Tax ($)", 3)}
    ${textCell("O3", "Line Gross ($)", 3)}
    ${textCell("P3", "Doc Total ($)", 3)}
    ${textCell("Q3", "Paid ($)", 3)}
    ${textCell("R3", "Outstanding ($)", 3)}
  </row>`);

  let rIdx = 4;
  if (invoices.length === 0) {
    rowsXml.push(`<row r="${rIdx}">
      ${textCell(`A${rIdx}`, "No invoices", 5)}
      ${textCell(`B${rIdx}`, "No invoices loaded in the database.", 4)}
    </row>`);
  } else {
    for (const inv of invoices) {
      const kindLabel = inv.kind === "sales" ? "Sales Invoice" : "Purchase Bill";
      const lines = inv.lines && inv.lines.length > 0 ? inv.lines : [null];
      for (const line of lines) {
        rowsXml.push(`<row r="${rIdx}">
          ${textCell(`A${rIdx}`, inv.number, 5)}
          ${textCell(`B${rIdx}`, kindLabel, 5)}
          ${textCell(`C${rIdx}`, inv.contact, 4)}
          ${textCell(`D${rIdx}`, inv.reference, 4)}
          ${textCell(`E${rIdx}`, inv.issued, 5)}
          ${textCell(`F${rIdx}`, inv.due ?? "", 5)}
          ${textCell(`G${rIdx}`, inv.status, 5)}
          ${textCell(`H${rIdx}`, inv.currency || "NZD", 5)}
          ${textCell(`I${rIdx}`, line?.description ?? "", 4)}
          ${textCell(`J${rIdx}`, line?.accountCode ?? "", 5)}
          ${textCell(`K${rIdx}`, line?.taxType ?? "", 4)}
          ${line?.quantity !== undefined ? numCell(`L${rIdx}`, line.quantity, 7) : textCell(`L${rIdx}`, "", 5)}
          ${line ? numCell(`M${rIdx}`, line.net / 100, 6) : textCell(`M${rIdx}`, "", 6)}
          ${line ? numCell(`N${rIdx}`, line.tax / 100, 6) : textCell(`N${rIdx}`, "", 6)}
          ${line ? numCell(`O${rIdx}`, line.gross / 100, 6) : textCell(`O${rIdx}`, "", 6)}
          ${numCell(`P${rIdx}`, inv.total / 100, 6)}
          ${numCell(`Q${rIdx}`, inv.paid / 100, 6)}
          ${numCell(`R${rIdx}`, inv.outstanding / 100, 6)}
        </row>`);
        rIdx++;
      }
    }
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  ${buildSheetViewsXml(3)}
  ${buildColsXml(widths)}
  <sheetData>${rowsXml.join("")}</sheetData>
</worksheet>`;
}

/**
 * Sheet 11: Raw Database Table: allocations
 */
function buildRawAllocationsSheet(ctx: SheetContext): string {
  const { entityName } = ctx;
  const allocs = state.ledger.allocations ?? [];
  const widths = [12, 18, 14, 28, 18];
  const rowsXml: string[] = [];

  rowsXml.push(`<row r="1" ht="26" customHeight="1">
    ${textCell("A1", `${entityName} — Raw Database Table: allocations`, 13)}
  </row>`);
  rowsXml.push(`<row r="2" ht="18" customHeight="1">
    ${textCell("A2", `Invoice payment allocations and settlement records | Total allocations: ${allocs.length}`, 14)}
  </row>`);

  rowsXml.push(`<row r="3" ht="22" customHeight="1">
    ${textCell("A3", "Record #", 1)}
    ${textCell("B3", "Invoice #", 1)}
    ${textCell("C3", "Payment Date", 1)}
    ${textCell("D3", "Contact", 2)}
    ${textCell("E3", "Allocated Amount ($)", 3)}
  </row>`);

  let rIdx = 4;
  if (allocs.length === 0) {
    rowsXml.push(`<row r="${rIdx}">
      ${textCell(`A${rIdx}`, "No allocations", 5)}
      ${textCell(`B${rIdx}`, "No payment allocations loaded in the database.", 4)}
    </row>`);
  } else {
    let rec = 1;
    for (const a of allocs) {
      rowsXml.push(`<row r="${rIdx}">
        ${numCell(`A${rIdx}`, rec++, 7)}
        ${textCell(`B${rIdx}`, a.invoiceNumber, 5)}
        ${textCell(`C${rIdx}`, a.date, 5)}
        ${textCell(`D${rIdx}`, a.contact, 4)}
        ${numCell(`E${rIdx}`, a.amount / 100, 6)}
      </row>`);
      rIdx++;
    }

    const startRow = 4;
    const endRow = rIdx - 1;
    const totRow = rIdx;
    rowsXml.push(`<row r="${totRow}" ht="24" customHeight="1">
      ${textCell(`A${totRow}`, "TOTAL ALLOCATED", 9)}
      ${textCell(`B${totRow}`, "", 9)}${textCell(`C${totRow}`, "", 9)}${textCell(`D${totRow}`, "", 9)}
      ${numCell(`E${totRow}`, 0, 10, `SUM(E${startRow}:E${endRow})`)}
    </row>`);
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  ${buildSheetViewsXml(3)}
  ${buildColsXml(widths)}
  <sheetData>${rowsXml.join("")}</sheetData>
</worksheet>`;
}

/**
 * Sheet 12: Raw Database Table: assets
 */
function buildRawAssetsSheet(ctx: SheetContext): string {
  const { entityName } = ctx;
  const assets = state.ledger.assets ?? [];
  const widths = [14, 36, 22, 14, 14, 16, 16, 16, 14, 16, 14];
  const rowsXml: string[] = [];

  rowsXml.push(`<row r="1" ht="26" customHeight="1">
    ${textCell("A1", `${entityName} — Raw Database Table: assets`, 13)}
  </row>`);
  rowsXml.push(`<row r="2" ht="18" customHeight="1">
    ${textCell("A2", `Raw fixed asset registry master cards | Total registered assets: ${assets.length}`, 14)}
  </row>`);

  rowsXml.push(`<row r="3" ht="22" customHeight="1">
    ${textCell("A3", "Asset Number", 1)}
    ${textCell("B3", "Asset Name / Description", 2)}
    ${textCell("C3", "Asset Type / Category", 2)}
    ${textCell("D3", "Status", 1)}
    ${textCell("E3", "Purchased Date", 1)}
    ${textCell("F3", "Deprec Start Date", 1)}
    ${textCell("G3", "Original Cost ($)", 3)}
    ${textCell("H3", "Deprec Method", 1)}
    ${textCell("I3", "Deprec Rate", 3)}
    ${textCell("J3", "Averaging Method", 1)}
    ${textCell("K3", "Disposal Date", 1)}
  </row>`);

  let rIdx = 4;
  if (assets.length === 0) {
    rowsXml.push(`<row r="${rIdx}">
      ${textCell(`A${rIdx}`, "No assets", 5)}
      ${textCell(`B${rIdx}`, "No fixed assets loaded in the database.", 4)}
    </row>`);
  } else {
    for (const a of assets) {
      rowsXml.push(`<row r="${rIdx}">
        ${textCell(`A${rIdx}`, a.number, 5)}
        ${textCell(`B${rIdx}`, a.name, 4)}
        ${textCell(`C${rIdx}`, a.type, 4)}
        ${textCell(`D${rIdx}`, a.status, 5)}
        ${textCell(`E${rIdx}`, a.purchased ?? "", 5)}
        ${textCell(`F${rIdx}`, a.depreciationFrom ?? "", 5)}
        ${numCell(`G${rIdx}`, a.cost / 100, 6)}
        ${textCell(`H${rIdx}`, a.method, 5)}
        ${pctCell(`I${rIdx}`, a.rate, 8)}
        ${textCell(`J${rIdx}`, a.averaging ?? "Full Month", 5)}
        ${textCell(`K${rIdx}`, a.disposed ?? "", 5)}
      </row>`);
      rIdx++;
    }

    const startRow = 4;
    const endRow = rIdx - 1;
    const totRow = rIdx;
    rowsXml.push(`<row r="${totRow}" ht="24" customHeight="1">
      ${textCell(`A${totRow}`, "TOTAL ASSET COST", 9)}
      ${textCell(`B${totRow}`, "", 9)}${textCell(`C${totRow}`, "", 9)}${textCell(`D${totRow}`, "", 9)}${textCell(`E${totRow}`, "", 9)}${textCell(`F${totRow}`, "", 9)}
      ${numCell(`G${totRow}`, 0, 10, `SUM(G${startRow}:G${endRow})`)}
      ${textCell(`H${totRow}`, "", 9)}${textCell(`I${totRow}`, "", 9)}${textCell(`J${totRow}`, "", 9)}${textCell(`K${totRow}`, "", 9)}
    </row>`);
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  ${buildSheetViewsXml(3)}
  ${buildColsXml(widths)}
  <sheetData>${rowsXml.join("")}</sheetData>
</worksheet>`;
}

/**
 * Sheet 13: Raw Database Table: entities
 */
function buildRawEntitiesSheet(ctx: SheetContext): string {
  const { entityName } = ctx;
  const model = state.ledger.entities;
  const entities = model?.entities ?? [];
  const banks = model?.banks ?? {};
  const accounts = model?.accounts ?? {};
  const chartMap = new Map(state.chart.map((a) => [a.code, a.name]));

  const widths = [16, 26, 18, 16, 16, 22, 30, 26, 30];
  const rowsXml: string[] = [];

  rowsXml.push(`<row r="1" ht="26" customHeight="1">
    ${textCell("A1", `${entityName} — Raw Database Table: entities`, 13)}
  </row>`);
  rowsXml.push(`<row r="2" ht="18" customHeight="1">
    ${textCell("A2", `Configured business entities, legal structures, ownership, bank links, and account mappings | Total entities: ${entities.length}`, 14)}
  </row>`);

  rowsXml.push(`<row r="3" ht="22" customHeight="1">
    ${textCell("A3", "Entity ID", 1)}
    ${textCell("B3", "Legal / Trading Name", 2)}
    ${textCell("C3", "Entity Kind", 1)}
    ${textCell("D3", "GST Registered?", 1)}
    ${textCell("E3", "GST Number", 1)}
    ${textCell("F3", "Bank Pay To", 2)}
    ${textCell("G3", "Postal / Street Address", 2)}
    ${textCell("H3", "Owners &amp; Ownership %", 2)}
    ${textCell("I3", "Notes / Description", 2)}
  </row>`);

  let rIdx = 4;
  if (entities.length === 0) {
    rowsXml.push(`<row r="${rIdx}">
      ${textCell(`A${rIdx}`, "No entities", 5)}
      ${textCell(`B${rIdx}`, "No entity models registered in the database.", 4)}
    </row>`);
    rIdx++;
  } else {
    for (const e of entities) {
      const ownersStr = (e.owners ?? [])
        .map((o) => `${o.name} (${o.percent}%)`)
        .join(", ");
      const kindStr =
        e.kind === "residential"
          ? "Residential Rental"
          : e.kind === "commercial"
          ? "Commercial Property"
          : e.kind === "business"
          ? "Trading Business"
          : e.kind === "personal"
          ? "Personal"
          : (e.kind ?? "Default");

      rowsXml.push(`<row r="${rIdx}">
        ${textCell(`A${rIdx}`, e.id, 5)}
        ${textCell(`B${rIdx}`, e.name, 4)}
        ${textCell(`C${rIdx}`, kindStr, 5)}
        ${textCell(`D${rIdx}`, e.gstRegistered !== false ? "Yes" : "No", 5)}
        ${textCell(`E${rIdx}`, e.gstNumber ?? "", 5)}
        ${textCell(`F${rIdx}`, e.payTo ?? "", 4)}
        ${textCell(`G${rIdx}`, e.address ?? "", 4)}
        ${textCell(`H${rIdx}`, ownersStr, 4)}
        ${textCell(`I${rIdx}`, e.note ?? "", 4)}
      </row>`);
      rIdx++;
    }
  }

  // Section: Bank Account Mappings
  rIdx += 2;
  rowsXml.push(`<row r="${rIdx}" ht="20" customHeight="1">
    ${textCell(`A${rIdx}`, "BANK ACCOUNT TO ENTITY MAPPINGS", 11)}
    ${textCell(`B${rIdx}`, "", 11)}${textCell(`C${rIdx}`, "", 11)}
  </row>`);
  rIdx++;
  rowsXml.push(`<row r="${rIdx}" ht="20" customHeight="1">
    ${textCell(`A${rIdx}`, "Bank Account #", 1)}
    ${textCell(`B${rIdx}`, "Assigned Entities (ID List)", 2)}
    ${textCell(`C${rIdx}`, "Entity Names", 2)}
  </row>`);
  rIdx++;

  const bankEntries = Object.entries(banks);
  if (bankEntries.length === 0) {
    rowsXml.push(`<row r="${rIdx}">
      ${textCell(`A${rIdx}`, "None", 5)}
      ${textCell(`B${rIdx}`, "No specific bank account entity mappings recorded.", 4)}
    </row>`);
    rIdx++;
  } else {
    for (const [bankAcc, entityIds] of bankEntries) {
      const names = entityIds
        .map((id) => entities.find((e) => e.id === id)?.name ?? id)
        .join(", ");
      rowsXml.push(`<row r="${rIdx}">
        ${textCell(`A${rIdx}`, bankAcc, 5)}
        ${textCell(`B${rIdx}`, entityIds.join(", "), 4)}
        ${textCell(`C${rIdx}`, names, 4)}
      </row>`);
      rIdx++;
    }
  }

  // Section: Chart of Account Mappings
  rIdx += 2;
  rowsXml.push(`<row r="${rIdx}" ht="20" customHeight="1">
    ${textCell(`A${rIdx}`, "CHART OF ACCOUNTS TO ENTITY MAPPINGS", 11)}
    ${textCell(`B${rIdx}`, "", 11)}${textCell(`C${rIdx}`, "", 11)}
  </row>`);
  rIdx++;
  rowsXml.push(`<row r="${rIdx}" ht="20" customHeight="1">
    ${textCell(`A${rIdx}`, "Account Code", 1)}
    ${textCell(`B${rIdx}`, "Account Name", 2)}
    ${textCell(`C${rIdx}`, "Assigned Entity Name (ID)", 2)}
  </row>`);
  rIdx++;

  const accEntries = Object.entries(accounts);
  if (accEntries.length === 0) {
    rowsXml.push(`<row r="${rIdx}">
      ${textCell(`A${rIdx}`, "None", 5)}
      ${textCell(`B${rIdx}`, "No chart account mappings recorded (all accounts default to main entity).", 4)}
    </row>`);
  } else {
    for (const [code, entityId] of accEntries) {
      const accName = chartMap.get(code) ?? "";
      const entName = entities.find((e) => e.id === entityId)?.name ?? entityId;
      rowsXml.push(`<row r="${rIdx}">
        ${textCell(`A${rIdx}`, code, 5)}
        ${textCell(`B${rIdx}`, accName, 4)}
        ${textCell(`C${rIdx}`, `${entName} (${entityId})`, 4)}
      </row>`);
      rIdx++;
    }
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  ${buildSheetViewsXml(3)}
  ${buildColsXml(widths)}
  <sheetData>${rowsXml.join("")}</sheetData>
</worksheet>`;
}

/**
 * Sheet 14: Raw Database Table: journals
 */
function buildRawJournalsSheet(ctx: SheetContext): string {
  const { entityName } = ctx;
  const journals = state.ledger.journals ?? [];
  const manualJournals = state.ledger.manualJournals ?? [];
  const widths = [16, 16, 12, 32, 12, 18, 8, 14, 25, 30, 14, 14, 14, 14];
  const rowsXml: string[] = [];

  const totalEntries = journals.length + manualJournals.length;
  rowsXml.push(`<row r="1" ht="26" customHeight="1">
    ${textCell("A1", `${entityName} — Raw Database Table: journals`, 13)}
  </row>`);
  rowsXml.push(`<row r="2" ht="18" customHeight="1">
    ${textCell("A2", `General ledger journal postings, system imports, and manual year-end journals | Total journals: ${totalEntries}`, 14)}
  </row>`);

  rowsXml.push(`<row r="3" ht="22" customHeight="1">
    ${textCell("A3", "Journal ID", 1)}
    ${textCell("B3", "Journal Type", 1)}
    ${textCell("C3", "Date", 1)}
    ${textCell("D3", "Narration / Summary", 2)}
    ${textCell("E3", "Posted Date", 1)}
    ${textCell("F3", "Posted By / Source", 2)}
    ${textCell("G3", "Line #", 1)}
    ${textCell("H3", "Account Code", 1)}
    ${textCell("I3", "Account Name", 2)}
    ${textCell("J3", "Line Description", 2)}
    ${textCell("K3", "Debit ($)", 3)}
    ${textCell("L3", "Credit ($)", 3)}
    ${textCell("M3", "Net Amount ($)", 3)}
    ${textCell("N3", "Tax Base ($)", 3)}
  </row>`);

  let rIdx = 4;
  if (totalEntries === 0) {
    rowsXml.push(`<row r="${rIdx}">
      ${textCell(`A${rIdx}`, "No journals", 5)}
      ${textCell(`B${rIdx}`, "No journal entries found in the database.", 4)}
    </row>`);
  } else {
    for (const j of journals) {
      for (const line of j.lines) {
        const debit = line.amount > 0 ? line.amount / 100 : 0;
        const credit = line.amount < 0 ? -line.amount / 100 : 0;
        const net = line.amount / 100;
        const taxBase = line.taxBase !== undefined ? line.taxBase / 100 : undefined;

        rowsXml.push(`<row r="${rIdx}">
          ${textCell(`A${rIdx}`, j.id, 5)}
          ${textCell(`B${rIdx}`, "General Journal", 5)}
          ${textCell(`C${rIdx}`, j.date, 5)}
          ${textCell(`D${rIdx}`, j.narration, 4)}
          ${textCell(`E${rIdx}`, j.postedDate ?? "", 5)}
          ${textCell(`F${rIdx}`, j.postedBy ?? "", 4)}
          ${numCell(`G${rIdx}`, line.line, 7)}
          ${textCell(`H${rIdx}`, line.accountCode, 5)}
          ${textCell(`I${rIdx}`, line.accountName, 4)}
          ${textCell(`J${rIdx}`, line.description, 4)}
          ${debit !== 0 ? numCell(`K${rIdx}`, debit, 6) : textCell(`K${rIdx}`, "", 6)}
          ${credit !== 0 ? numCell(`L${rIdx}`, credit, 6) : textCell(`L${rIdx}`, "", 6)}
          ${numCell(`M${rIdx}`, net, 6)}
          ${taxBase !== undefined ? numCell(`N${rIdx}`, taxBase, 6) : textCell(`N${rIdx}`, "", 6)}
        </row>`);
        rIdx++;
      }
    }

    for (const mj of manualJournals) {
      let lNum = 1;
      for (const line of mj.lines) {
        const debit = line.amount > 0 ? line.amount / 100 : 0;
        const credit = line.amount < 0 ? -line.amount / 100 : 0;
        const net = line.amount / 100;

        rowsXml.push(`<row r="${rIdx}">
          ${textCell(`A${rIdx}`, mj.id, 5)}
          ${textCell(`B${rIdx}`, "Manual Journal", 5)}
          ${textCell(`C${rIdx}`, mj.date, 5)}
          ${textCell(`D${rIdx}`, mj.narration, 4)}
          ${textCell(`E${rIdx}`, "", 5)}
          ${textCell(`F${rIdx}`, mj.source ?? "Manual Entry", 4)}
          ${numCell(`G${rIdx}`, lNum++, 7)}
          ${textCell(`H${rIdx}`, line.code, 5)}
          ${textCell(`I${rIdx}`, "", 4)}
          ${textCell(`J${rIdx}`, line.description ?? "", 4)}
          ${debit !== 0 ? numCell(`K${rIdx}`, debit, 6) : textCell(`K${rIdx}`, "", 6)}
          ${credit !== 0 ? numCell(`L${rIdx}`, credit, 6) : textCell(`L${rIdx}`, "", 6)}
          ${numCell(`M${rIdx}`, net, 6)}
          ${textCell(`N${rIdx}`, "", 6)}
        </row>`);
        rIdx++;
      }
    }

    const startRow = 4;
    const endRow = rIdx - 1;
    const totRow = rIdx;
    rowsXml.push(`<row r="${totRow}" ht="24" customHeight="1">
      ${textCell(`A${totRow}`, "TOTAL JOURNAL MOVEMENTS", 9)}
      ${textCell(`B${totRow}`, "", 9)}${textCell(`C${totRow}`, "", 9)}${textCell(`D${totRow}`, "", 9)}
      ${textCell(`E${totRow}`, "", 9)}${textCell(`F${totRow}`, "", 9)}${textCell(`G${totRow}`, "", 9)}
      ${textCell(`H${totRow}`, "", 9)}${textCell(`I${totRow}`, "", 9)}${textCell(`J${totRow}`, "", 9)}
      ${numCell(`K${totRow}`, 0, 10, `SUM(K${startRow}:K${endRow})`)}
      ${numCell(`L${totRow}`, 0, 10, `SUM(L${startRow}:L${endRow})`)}
      ${numCell(`M${totRow}`, 0, 10, `SUM(M${startRow}:M${endRow})`)}
      ${textCell(`N${totRow}`, "", 10)}
    </row>`);
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  ${buildSheetViewsXml(3)}
  ${buildColsXml(widths)}
  <sheetData>${rowsXml.join("")}</sheetData>
</worksheet>`;
}

/**
 * Sheet 15: Raw Database Table: decisions
 */
function buildRawDecisionsSheet(ctx: SheetContext): string {
  const { entityName } = ctx;
  const txMap = new Map(state.ledger.transactions.map((t) => [t.id, t]));
  const overrides = state.ledger.overrides ?? {};
  const splits = state.ledger.splits ?? {};
  const matches = state.ledger.invoiceMatches ?? {};
  const transfers = state.ledger.transfers ?? {};
  const creditNotes = state.ledger.creditNotes ?? {};
  const legDups = state.ledger.legitimateDuplicates ?? [];
  const remDups = state.ledger.removedDuplicates ?? [];
  const rejTransfers = state.ledger.rejectedTransfers ?? [];
  const openBalances = state.ledger.openingBalances ?? {};
  const assetProceeds = state.ledger.assetProceeds ?? {};
  const varNotes = state.ledger.varianceNotes ?? [];

  const widths = [10, 24, 20, 12, 28, 18, 16, 22, 35];
  const rowsXml: string[] = [];

  rowsXml.push(`<row r="1" ht="26" customHeight="1">
    ${textCell("A1", `${entityName} — Raw Database Table: decisions`, 13)}
  </row>`);
  rowsXml.push(`<row r="2" ht="18" customHeight="1">
    ${textCell("A2", `User choices, manual coding overrides, splits, transfer links, invoice match judgements, and opening values`, 14)}
  </row>`);

  rowsXml.push(`<row r="3" ht="22" customHeight="1">
    ${textCell("A3", "Record #", 1)}
    ${textCell("B3", "Decision Category", 1)}
    ${textCell("C3", "Target ID / Reference", 1)}
    ${textCell("D3", "Date", 1)}
    ${textCell("E3", "Target Contact / Counterparty", 2)}
    ${textCell("F3", "Target Account Code", 1)}
    ${textCell("G3", "Amount ($)", 3)}
    ${textCell("H3", "Secondary Ref / Match ID", 2)}
    ${textCell("I3", "Notes / Details / Action", 2)}
  </row>`);

  let rIdx = 4;
  let count = 1;

  // 1. Coding Overrides
  for (const [txId, val] of Object.entries(overrides)) {
    const tx = txMap.get(txId);
    const code = typeof val === "string" ? val : (val as { code?: string })?.code ?? "";
    const note = typeof val === "object" ? (val as { note?: string })?.note ?? "" : "";
    rowsXml.push(`<row r="${rIdx}">
      ${numCell(`A${rIdx}`, count++, 7)}
      ${textCell(`B${rIdx}`, "Manual Coding Override", 5)}
      ${textCell(`C${rIdx}`, txId, 5)}
      ${textCell(`D${rIdx}`, tx?.date ?? "", 5)}
      ${textCell(`E${rIdx}`, tx?.otherParty ?? tx?.particulars ?? "", 4)}
      ${textCell(`F${rIdx}`, code, 5)}
      ${tx ? numCell(`G${rIdx}`, tx.amount / 100, 6) : textCell(`G${rIdx}`, "", 6)}
      ${textCell(`H${rIdx}`, "", 4)}
      ${textCell(`I${rIdx}`, note || "User manual code override", 4)}
    </row>`);
    rIdx++;
  }

  // 2. Splits
  for (const [txId, parts] of Object.entries(splits)) {
    const tx = txMap.get(txId);
    for (const part of parts) {
      rowsXml.push(`<row r="${rIdx}">
        ${numCell(`A${rIdx}`, count++, 7)}
        ${textCell(`B${rIdx}`, "Transaction Split Part", 5)}
        ${textCell(`C${rIdx}`, txId, 5)}
        ${textCell(`D${rIdx}`, tx?.date ?? "", 5)}
        ${textCell(`E${rIdx}`, tx?.otherParty ?? "", 4)}
        ${textCell(`F${rIdx}`, part.code ?? "", 5)}
        ${numCell(`G${rIdx}`, part.amount / 100, 6)}
        ${textCell(`H${rIdx}`, part.treatment ?? "", 5)}
        ${textCell(`I${rIdx}`, part.note ?? "Split allocation", 4)}
      </row>`);
      rIdx++;
    }
  }

  // 3. Invoice Matches
  for (const [txId, invNum] of Object.entries(matches)) {
    const tx = txMap.get(txId);
    rowsXml.push(`<row r="${rIdx}">
      ${numCell(`A${rIdx}`, count++, 7)}
      ${textCell(`B${rIdx}`, "Invoice Payment Match", 5)}
      ${textCell(`C${rIdx}`, txId, 5)}
      ${textCell(`D${rIdx}`, tx?.date ?? "", 5)}
      ${textCell(`E${rIdx}`, tx?.otherParty ?? "", 4)}
      ${textCell(`F${rIdx}`, "", 5)}
      ${tx ? numCell(`G${rIdx}`, tx.amount / 100, 6) : textCell(`G${rIdx}`, "", 6)}
      ${textCell(`H${rIdx}`, invNum, 5)}
      ${textCell(`I${rIdx}`, `Matched to invoice ${invNum}`, 4)}
    </row>`);
    rIdx++;
  }

  // 4. Transfers
  for (const [txId, targetId] of Object.entries(transfers)) {
    const tx = txMap.get(txId);
    rowsXml.push(`<row r="${rIdx}">
      ${numCell(`A${rIdx}`, count++, 7)}
      ${textCell(`B${rIdx}`, "Bank Transfer Pair", 5)}
      ${textCell(`C${rIdx}`, txId, 5)}
      ${textCell(`D${rIdx}`, tx?.date ?? "", 5)}
      ${textCell(`E${rIdx}`, tx?.otherParty ?? "", 4)}
      ${textCell(`F${rIdx}`, "", 5)}
      ${tx ? numCell(`G${rIdx}`, tx.amount / 100, 6) : textCell(`G${rIdx}`, "", 6)}
      ${textCell(`H${rIdx}`, targetId, 5)}
      ${textCell(`I${rIdx}`, `Paired transfer opposite leg ${targetId}`, 4)}
    </row>`);
    rIdx++;
  }

  // 5. Credit Note Links
  for (const [cnNum, invNum] of Object.entries(creditNotes)) {
    rowsXml.push(`<row r="${rIdx}">
      ${numCell(`A${rIdx}`, count++, 7)}
      ${textCell(`B${rIdx}`, "Credit Note Allocation", 5)}
      ${textCell(`C${rIdx}`, cnNum, 5)}
      ${textCell(`D${rIdx}`, "", 5)}
      ${textCell(`E${rIdx}`, "", 4)}
      ${textCell(`F${rIdx}`, "", 5)}
      ${textCell(`G${rIdx}`, "", 6)}
      ${textCell(`H${rIdx}`, invNum, 5)}
      ${textCell(`I${rIdx}`, `Credit note applied against invoice ${invNum}`, 4)}
    </row>`);
    rIdx++;
  }

  // 6. Legitimate Duplicates
  for (const txId of legDups) {
    const tx = txMap.get(txId);
    rowsXml.push(`<row r="${rIdx}">
      ${numCell(`A${rIdx}`, count++, 7)}
      ${textCell(`B${rIdx}`, "Legitimate Duplicate", 5)}
      ${textCell(`C${rIdx}`, txId, 5)}
      ${textCell(`D${rIdx}`, tx?.date ?? "", 5)}
      ${textCell(`E${rIdx}`, tx?.otherParty ?? "", 4)}
      ${textCell(`F${rIdx}`, "", 5)}
      ${tx ? numCell(`G${rIdx}`, tx.amount / 100, 6) : textCell(`G${rIdx}`, "", 6)}
      ${textCell(`H${rIdx}`, "", 5)}
      ${textCell(`I${rIdx}`, "Confirmed genuine transaction, not duplicate", 4)}
    </row>`);
    rIdx++;
  }

  // 7. Removed Duplicates
  for (const txId of remDups) {
    rowsXml.push(`<row r="${rIdx}">
      ${numCell(`A${rIdx}`, count++, 7)}
      ${textCell(`B${rIdx}`, "Removed Duplicate", 5)}
      ${textCell(`C${rIdx}`, txId, 5)}
      ${textCell(`D${rIdx}`, "", 5)}
      ${textCell(`E${rIdx}`, "", 4)}
      ${textCell(`F${rIdx}`, "", 5)}
      ${textCell(`G${rIdx}`, "", 6)}
      ${textCell(`H${rIdx}`, "", 5)}
      ${textCell(`I${rIdx}`, "Discarded duplicate bank transaction", 4)}
    </row>`);
    rIdx++;
  }

  // 8. Rejected Transfers
  for (const txId of rejTransfers) {
    const tx = txMap.get(txId);
    rowsXml.push(`<row r="${rIdx}">
      ${numCell(`A${rIdx}`, count++, 7)}
      ${textCell(`B${rIdx}`, "Rejected Transfer Match", 5)}
      ${textCell(`C${rIdx}`, txId, 5)}
      ${textCell(`D${rIdx}`, tx?.date ?? "", 5)}
      ${textCell(`E${rIdx}`, tx?.otherParty ?? "", 4)}
      ${textCell(`F${rIdx}`, "", 5)}
      ${tx ? numCell(`G${rIdx}`, tx.amount / 100, 6) : textCell(`G${rIdx}`, "", 6)}
      ${textCell(`H${rIdx}`, "", 5)}
      ${textCell(`I${rIdx}`, "Confirmed line is not an internal transfer", 4)}
    </row>`);
    rIdx++;
  }

  // 9. Opening Balances
  for (const [code, amt] of Object.entries(openBalances)) {
    rowsXml.push(`<row r="${rIdx}">
      ${numCell(`A${rIdx}`, count++, 7)}
      ${textCell(`B${rIdx}`, "Opening Balance", 5)}
      ${textCell(`C${rIdx}`, code, 5)}
      ${textCell(`D${rIdx}`, "Start of Books", 5)}
      ${textCell(`E${rIdx}`, "", 4)}
      ${textCell(`F${rIdx}`, code, 5)}
      ${numCell(`G${rIdx}`, Number(amt) / 100, 6)}
      ${textCell(`H${rIdx}`, "", 5)}
      ${textCell(`I${rIdx}`, "Inherited pre-conversion opening balance", 4)}
    </row>`);
    rIdx++;
  }

  // 10. Asset Proceeds
  for (const [assetNum, cents] of Object.entries(assetProceeds)) {
    rowsXml.push(`<row r="${rIdx}">
      ${numCell(`A${rIdx}`, count++, 7)}
      ${textCell(`B${rIdx}`, "Asset Disposal Proceeds", 5)}
      ${textCell(`C${rIdx}`, assetNum, 5)}
      ${textCell(`D${rIdx}`, "", 5)}
      ${textCell(`E${rIdx}`, "", 4)}
      ${textCell(`F${rIdx}`, "", 5)}
      ${numCell(`G${rIdx}`, cents / 100, 6)}
      ${textCell(`H${rIdx}`, "", 5)}
      ${textCell(`I${rIdx}`, "Disposal proceeds (ex GST)", 4)}
    </row>`);
    rIdx++;
  }

  // 11. Variance Notes
  for (const vn of varNotes) {
    rowsXml.push(`<row r="${rIdx}">
      ${numCell(`A${rIdx}`, count++, 7)}
      ${textCell(`B${rIdx}`, "GST Variance Note", 5)}
      ${textCell(`C${rIdx}`, vn.period, 5)}
      ${textCell(`D${rIdx}`, vn.at ?? vn.period, 5)}
      ${textCell(`E${rIdx}`, "", 4)}
      ${textCell(`F${rIdx}`, "", 5)}
      ${numCell(`G${rIdx}`, vn.amount / 100, 6)}
      ${textCell(`H${rIdx}`, "", 5)}
      ${textCell(`I${rIdx}`, vn.reason, 4)}
    </row>`);
    rIdx++;
  }

  if (count === 1) {
    rowsXml.push(`<row r="${rIdx}">
      ${textCell(`A${rIdx}`, "None", 5)}
      ${textCell(`B${rIdx}`, "No user decisions or adjustments recorded in the database.", 4)}
    </row>`);
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  ${buildSheetViewsXml(3)}
  ${buildColsXml(widths)}
  <sheetData>${rowsXml.join("")}</sheetData>
</worksheet>`;
}

/**
 * Sheet 16: Raw Database Table: rules
 */
function buildRawRulesSheet(ctx: SheetContext): string {
  const { entityName } = ctx;
  const ruleSet = state.rules ?? { rules: [], defaults: [] };
  const rules = ruleSet.rules ?? [];
  const defaults = ruleSet.defaults ?? [];
  const chartMap = new Map(state.chart.map((a) => [a.code, a.name]));

  const widths = [10, 14, 25, 20, 22, 8, 18, 14, 14, 20, 20, 20, 25, 35];
  const rowsXml: string[] = [];

  rowsXml.push(`<row r="1" ht="26" customHeight="1">
    ${textCell("A1", `${entityName} — Raw Database Table: rules`, 13)}
  </row>`);
  rowsXml.push(`<row r="2" ht="18" customHeight="1">
    ${textCell("A2", `Active categorisation rules, keyword matchers, field filters, direction constraints, and default codings | Total rules: ${rules.length}`, 14)}
  </row>`);

  rowsXml.push(`<row r="3" ht="22" customHeight="1">
    ${textCell("A3", "Priority", 1)}
    ${textCell("B3", "Account Code", 1)}
    ${textCell("C3", "Account Name", 2)}
    ${textCell("D3", "Keyword Match", 2)}
    ${textCell("E3", "Assign Contact", 2)}
    ${textCell("F3", "Sign", 1)}
    ${textCell("G3", "Bank Account Scope", 1)}
    ${textCell("H3", "Min Amt ($)", 3)}
    ${textCell("I3", "Max Amt ($)", 3)}
    ${textCell("J3", "Where: Payee / Party", 2)}
    ${textCell("K3", "Where: Particulars", 2)}
    ${textCell("L3", "Where: Reference", 2)}
    ${textCell("M3", "Warning Advice", 2)}
    ${textCell("N3", "Rule Note / Explanation", 2)}
  </row>`);

  let rIdx = 4;
  if (rules.length === 0) {
    rowsXml.push(`<row r="${rIdx}">
      ${textCell(`A${rIdx}`, "No rules", 5)}
      ${textCell(`B${rIdx}`, "No category rules configured in database.", 4)}
    </row>`);
    rIdx++;
  } else {
    for (const r of rules) {
      const accName = chartMap.get(r.code) ?? "";
      rowsXml.push(`<row r="${rIdx}">
        ${numCell(`A${rIdx}`, r.priority ?? 0, 7)}
        ${textCell(`B${rIdx}`, r.code, 5)}
        ${textCell(`C${rIdx}`, accName, 4)}
        ${textCell(`D${rIdx}`, r.keyword ?? "", 4)}
        ${textCell(`E${rIdx}`, r.contact ?? "", 4)}
        ${textCell(`F${rIdx}`, r.sign ?? "Any", 5)}
        ${textCell(`G${rIdx}`, r.account ?? "All Accounts", 5)}
        ${r.minAmount !== undefined ? numCell(`H${rIdx}`, r.minAmount / 100, 6) : textCell(`H${rIdx}`, "", 6)}
        ${r.maxAmount !== undefined ? numCell(`I${rIdx}`, r.maxAmount / 100, 6) : textCell(`I${rIdx}`, "", 6)}
        ${textCell(`J${rIdx}`, r.where?.otherParty ?? "", 4)}
        ${textCell(`K${rIdx}`, r.where?.particulars ?? "", 4)}
        ${textCell(`L${rIdx}`, r.where?.reference ?? "", 4)}
        ${textCell(`M${rIdx}`, r.warn ?? "", 4)}
        ${textCell(`N${rIdx}`, r.note ?? "", 4)}
      </row>`);
      rIdx++;
    }
  }

  // Section: Category Defaults
  if (defaults.length > 0) {
    rIdx += 2;
    rowsXml.push(`<row r="${rIdx}" ht="20" customHeight="1">
      ${textCell(`A${rIdx}`, "CATEGORY DEFAULTS (FALLBACK CODING)", 11)}
      ${textCell(`B${rIdx}`, "", 11)}${textCell(`C${rIdx}`, "", 11)}${textCell(`D${rIdx}`, "", 11)}
      ${textCell(`E${rIdx}`, "", 11)}${textCell(`F${rIdx}`, "", 11)}${textCell(`G${rIdx}`, "", 11)}
    </row>`);
    rIdx++;
    rowsXml.push(`<row r="${rIdx}" ht="20" customHeight="1">
      ${textCell(`A${rIdx}`, "Bank Account", 1)}
      ${textCell(`B${rIdx}`, "Direction", 1)}
      ${textCell(`C${rIdx}`, "Default Code", 1)}
      ${textCell(`D${rIdx}`, "Account Name", 2)}
      ${textCell(`E${rIdx}`, "Times Seen", 3)}
      ${textCell(`F${rIdx}`, "Times Agreed", 3)}
      ${textCell(`G${rIdx}`, "Notes / Rationale", 2)}
    </row>`);
    rIdx++;

    for (const d of defaults) {
      const accName = chartMap.get(d.code) ?? "";
      rowsXml.push(`<row r="${rIdx}">
        ${textCell(`A${rIdx}`, d.account, 5)}
        ${textCell(`B${rIdx}`, d.sign, 5)}
        ${textCell(`C${rIdx}`, d.code, 5)}
        ${textCell(`D${rIdx}`, accName, 4)}
        ${d.seen !== undefined ? numCell(`E${rIdx}`, d.seen, 7) : textCell(`E${rIdx}`, "", 7)}
        ${d.agreed !== undefined ? numCell(`F${rIdx}`, d.agreed, 7) : textCell(`F${rIdx}`, "", 7)}
        ${textCell(`G${rIdx}`, d.note ?? "", 4)}
      </row>`);
      rIdx++;
    }
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  ${buildSheetViewsXml(3)}
  ${buildColsXml(widths)}
  <sheetData>${rowsXml.join("")}</sheetData>
</worksheet>`;
}

/**
 * Sheet 17: Raw Database Table: filed
 */
function buildRawFiledReturnsSheet(ctx: SheetContext): string {
  const { entityName } = ctx;
  const returns = state.filed && state.filed.length > 0 ? state.filed : (state.ledger.filedReturns ?? []);
  const widths = [14, 14, 14, 12, 14, 14, 14, 14, 14, 14, 14, 14, 14, 16, 16];
  const rowsXml: string[] = [];

  rowsXml.push(`<row r="1" ht="26" customHeight="1">
    ${textCell("A1", `${entityName} — Raw Database Table: filed`, 13)}
  </row>`);
  rowsXml.push(`<row r="2" ht="18" customHeight="1">
    ${textCell("A2", `Historical GST returns filed with Inland Revenue (IRD) with official box values and line item audit | Returns: ${returns.length}`, 14)}
  </row>`);

  rowsXml.push(`<row r="3" ht="22" customHeight="1">
    ${textCell("A3", "Period Start", 1)}
    ${textCell("B3", "Period End", 1)}
    ${textCell("C3", "Filing Basis", 1)}
    ${textCell("D3", "Status", 1)}
    ${textCell("E3", "Box 5: Sales ($)", 3)}
    ${textCell("F3", "Box 6: Zero-rated", 3)}
    ${textCell("G3", "Box 8: Sales GST ($)", 3)}
    ${textCell("H3", "Box 9: Adjust ($)", 3)}
    ${textCell("I3", "Box 10: Total GST ($)", 3)}
    ${textCell("J3", "Box 11: Purchases ($)", 3)}
    ${textCell("K3", "Box 12: Purch GST ($)", 3)}
    ${textCell("L3", "Box 13: Credit Adj ($)", 3)}
    ${textCell("M3", "Box 14: Total Purch GST", 3)}
    ${textCell("N3", "Box 15: Net GST ($)", 3)}
    ${textCell("O3", "Core (Box 8-12) ($)", 3)}
  </row>`);

  let rIdx = 4;
  if (returns.length === 0) {
    rowsXml.push(`<row r="${rIdx}">
      ${textCell(`A${rIdx}`, "No filed returns", 5)}
      ${textCell(`B${rIdx}`, "No historical filed GST returns loaded in database.", 4)}
    </row>`);
    rIdx++;
  } else {
    for (const ret of returns) {
      const b = ret.boxes;
      rowsXml.push(`<row r="${rIdx}">
        ${textCell(`A${rIdx}`, ret.periodStart ?? "", 5)}
        ${textCell(`B${rIdx}`, ret.periodEnd, 5)}
        ${textCell(`C${rIdx}`, ret.basis, 5)}
        ${textCell(`D${rIdx}`, ret.status, 5)}
        ${numCell(`E${rIdx}`, b.box5 / 100, 6)}
        ${numCell(`F${rIdx}`, b.box6 / 100, 6)}
        ${numCell(`G${rIdx}`, b.box8 / 100, 6)}
        ${numCell(`H${rIdx}`, b.box9 / 100, 6)}
        ${numCell(`I${rIdx}`, b.box10 / 100, 6)}
        ${numCell(`J${rIdx}`, b.box11 / 100, 6)}
        ${numCell(`K${rIdx}`, b.box12 / 100, 6)}
        ${numCell(`L${rIdx}`, b.box13 / 100, 6)}
        ${numCell(`M${rIdx}`, b.box14 / 100, 6)}
        ${numCell(`N${rIdx}`, b.box15 / 100, 6)}
        ${numCell(`O${rIdx}`, ret.core / 100, 6)}
      </row>`);
      rIdx++;
    }

    // Line items detail
    const allLines = returns.flatMap((r) =>
      r.lines.map((l) => ({ periodEnd: r.periodEnd, ...l })),
    );
    if (allLines.length > 0) {
      rIdx += 2;
      rowsXml.push(`<row r="${rIdx}" ht="20" customHeight="1">
        ${textCell(`A${rIdx}`, "FILED RETURN LINE-BY-LINE AUDIT BREAKDOWN", 11)}
        ${textCell(`B${rIdx}`, "", 11)}${textCell(`C${rIdx}`, "", 11)}${textCell(`D${rIdx}`, "", 11)}
        ${textCell(`E${rIdx}`, "", 11)}${textCell(`F${rIdx}`, "", 11)}${textCell(`G${rIdx}`, "", 11)}
        ${textCell(`H${rIdx}`, "", 11)}${textCell(`I${rIdx}`, "", 11)}${textCell(`J${rIdx}`, "", 11)}
        ${textCell(`K${rIdx}`, "", 11)}${textCell(`L${rIdx}`, "", 11)}${textCell(`M${rIdx}`, "", 11)}
      </row>`);
      rIdx++;
      rowsXml.push(`<row r="${rIdx}" ht="20" customHeight="1">
        ${textCell(`A${rIdx}`, "Period End", 1)}
        ${textCell(`B${rIdx}`, "Date", 1)}
        ${textCell(`C${rIdx}`, "Account Code", 1)}
        ${textCell(`D${rIdx}`, "Account Name", 2)}
        ${textCell(`E${rIdx}`, "Contact / Payee", 2)}
        ${textCell(`F${rIdx}`, "Reference", 2)}
        ${textCell(`G${rIdx}`, "Line Description", 2)}
        ${textCell(`H${rIdx}`, "Tax Rate", 2)}
        ${numCell(`I${rIdx}`, 0, 3)}
        ${numCell(`J${rIdx}`, 0, 3)}
        ${numCell(`K${rIdx}`, 0, 3)}
        ${textCell(`L${rIdx}`, "Section", 2)}
        ${textCell(`M${rIdx}`, "Late Claim?", 1)}
      </row>`);
      // Fix header text for columns I, J, K in line items header
      rowsXml[rowsXml.length - 1] = `<row r="${rIdx}" ht="20" customHeight="1">
        ${textCell(`A${rIdx}`, "Period End", 1)}
        ${textCell(`B${rIdx}`, "Date", 1)}
        ${textCell(`C${rIdx}`, "Account Code", 1)}
        ${textCell(`D${rIdx}`, "Account Name", 2)}
        ${textCell(`E${rIdx}`, "Contact / Payee", 2)}
        ${textCell(`F${rIdx}`, "Reference", 2)}
        ${textCell(`G${rIdx}`, "Line Description", 2)}
        ${textCell(`H${rIdx}`, "Tax Rate", 2)}
        ${textCell(`I${rIdx}`, "Gross ($)", 3)}
        ${textCell(`J${rIdx}`, "Net ($)", 3)}
        ${textCell(`K${rIdx}`, "GST ($)", 3)}
        ${textCell(`L${rIdx}`, "Section", 2)}
        ${textCell(`M${rIdx}`, "Late Claim?", 1)}
      </row>`;
      rIdx++;

      for (const line of allLines) {
        rowsXml.push(`<row r="${rIdx}">
          ${textCell(`A${rIdx}`, line.periodEnd, 5)}
          ${textCell(`B${rIdx}`, line.date, 5)}
          ${textCell(`C${rIdx}`, line.code, 5)}
          ${textCell(`D${rIdx}`, line.account, 4)}
          ${textCell(`E${rIdx}`, line.contact, 4)}
          ${textCell(`F${rIdx}`, line.reference, 4)}
          ${textCell(`G${rIdx}`, line.description, 4)}
          ${textCell(`H${rIdx}`, line.taxRate, 4)}
          ${numCell(`I${rIdx}`, line.gross / 100, 6)}
          ${numCell(`J${rIdx}`, line.net / 100, 6)}
          ${numCell(`K${rIdx}`, line.gst / 100, 6)}
          ${textCell(`L${rIdx}`, line.section, 4)}
          ${textCell(`M${rIdx}`, line.lateClaim ? "Yes" : "No", 5)}
        </row>`);
        rIdx++;
      }
    }
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  ${buildSheetViewsXml(3)}
  ${buildColsXml(widths)}
  <sheetData>${rowsXml.join("")}</sheetData>
</worksheet>`;
}

/**
 * Sheet 18: Raw Database Table: reference
 */
function buildRawReferenceSheet(ctx: SheetContext): string {
  const { entityName } = ctx;
  const refs = state.reference && state.reference.length > 0 ? state.reference : (state.ledger.reference ?? []);
  const widths = [10, 12, 18, 18, 14, 25, 24, 20, 30, 16, 18, 14];
  const rowsXml: string[] = [];

  rowsXml.push(`<row r="1" ht="26" customHeight="1">
    ${textCell("A1", `${entityName} — Raw Database Table: reference`, 13)}
  </row>`);
  rowsXml.push(`<row r="2" ht="18" customHeight="1">
    ${textCell("A2", `Prior accounting system history / benchmark records for coding reconciliation | Total records: ${refs.length}`, 14)}
  </row>`);

  rowsXml.push(`<row r="3" ht="22" customHeight="1">
    ${textCell("A3", "Record #", 1)}
    ${textCell("B3", "Date", 1)}
    ${textCell("C3", "Source System / File", 2)}
    ${textCell("D3", "Bank Account", 1)}
    ${textCell("E3", "Account Code", 1)}
    ${textCell("F3", "Account Label", 2)}
    ${textCell("G3", "Contact / Payee", 2)}
    ${textCell("H3", "Reference", 2)}
    ${textCell("I3", "Description / Narration", 2)}
    ${textCell("J3", "Invoice #", 1)}
    ${textCell("K3", "GST Rate", 2)}
    ${textCell("L3", "Amount ($)", 3)}
  </row>`);

  let rIdx = 4;
  if (refs.length === 0) {
    rowsXml.push(`<row r="${rIdx}">
      ${textCell(`A${rIdx}`, "No reference records", 5)}
      ${textCell(`B${rIdx}`, "No reference accounting records loaded in database.", 4)}
    </row>`);
  } else {
    let rec = 1;
    for (const r of refs) {
      rowsXml.push(`<row r="${rIdx}">
        ${numCell(`A${rIdx}`, rec++, 7)}
        ${textCell(`B${rIdx}`, r.date, 5)}
        ${textCell(`C${rIdx}`, r.source, 4)}
        ${textCell(`D${rIdx}`, r.account ?? "", 5)}
        ${textCell(`E${rIdx}`, r.code, 5)}
        ${textCell(`F${rIdx}`, r.label, 4)}
        ${textCell(`G${rIdx}`, r.contact ?? "", 4)}
        ${textCell(`H${rIdx}`, r.reference ?? "", 4)}
        ${textCell(`I${rIdx}`, r.description ?? "", 4)}
        ${textCell(`J${rIdx}`, r.invoiceNumber ?? "", 5)}
        ${textCell(`K${rIdx}`, r.gstRate ?? "", 4)}
        ${numCell(`L${rIdx}`, r.amount / 100, 6)}
      </row>`);
      rIdx++;
    }

    const startRow = 4;
    const endRow = rIdx - 1;
    const totRow = rIdx;
    rowsXml.push(`<row r="${totRow}" ht="24" customHeight="1">
      ${textCell(`A${totRow}`, "TOTAL REFERENCE AMOUNT", 9)}
      ${textCell(`B${totRow}`, "", 9)}${textCell(`C${totRow}`, "", 9)}${textCell(`D${totRow}`, "", 9)}
      ${textCell(`E${totRow}`, "", 9)}${textCell(`F${totRow}`, "", 9)}${textCell(`G${totRow}`, "", 9)}
      ${textCell(`H${totRow}`, "", 9)}${textCell(`I${totRow}`, "", 9)}${textCell(`J${totRow}`, "", 9)}
      ${textCell(`K${totRow}`, "", 9)}
      ${numCell(`L${totRow}`, 0, 10, `SUM(L${startRow}:L${endRow})`)}
    </row>`);
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  ${buildSheetViewsXml(3)}
  ${buildColsXml(widths)}
  <sheetData>${rowsXml.join("")}</sheetData>
</worksheet>`;
}

/**
 * Sheet 19: Raw Database Table: events
 */
function buildRawEventsSheet(ctx: SheetContext): string {
  const { entityName } = ctx;
  const events = state.events ?? [];
  const widths = [16, 22, 16, 20, 20, 35, 12, 28, 28];
  const rowsXml: string[] = [];

  rowsXml.push(`<row r="1" ht="26" customHeight="1">
    ${textCell("A1", `${entityName} — Raw Database Table: events`, 13)}
  </row>`);
  rowsXml.push(`<row r="2" ht="18" customHeight="1">
    ${textCell("A2", `Audit trail events, ledger mutations, user actions, and change history | Total events: ${events.length}`, 14)}
  </row>`);

  rowsXml.push(`<row r="3" ht="22" customHeight="1">
    ${textCell("A3", "Event ID", 1)}
    ${textCell("B3", "Timestamp (UTC)", 1)}
    ${textCell("C3", "User / Agent", 1)}
    ${textCell("D3", "Action / Kind", 1)}
    ${textCell("E3", "Target ID", 1)}
    ${textCell("F3", "Summary Description", 2)}
    ${textCell("G3", "Reverted?", 1)}
    ${textCell("H3", "Prior State (Before)", 2)}
    ${textCell("I3", "New State (After)", 2)}
  </row>`);

  let rIdx = 4;
  if (events.length === 0) {
    rowsXml.push(`<row r="${rIdx}">
      ${textCell(`A${rIdx}`, "No events", 5)}
      ${textCell(`B${rIdx}`, "No audit events recorded in database.", 4)}
    </row>`);
  } else {
    for (const ev of events) {
      const beforeStr = formatObjectInline(ev.before);
      const afterStr = formatObjectInline(ev.after);
      rowsXml.push(`<row r="${rIdx}">
        ${textCell(`A${rIdx}`, ev.id, 5)}
        ${textCell(`B${rIdx}`, ev.at, 5)}
        ${textCell(`C${rIdx}`, ev.who || "system", 5)}
        ${textCell(`D${rIdx}`, ev.kind, 5)}
        ${textCell(`E${rIdx}`, ev.targetId ?? "", 5)}
        ${textCell(`F${rIdx}`, ev.summary, 4)}
        ${textCell(`G${rIdx}`, ev.reverted ? "Yes" : "No", 5)}
        ${textCell(`H${rIdx}`, beforeStr, 4)}
        ${textCell(`I${rIdx}`, afterStr, 4)}
      </row>`);
      rIdx++;
    }
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  ${buildSheetViewsXml(3)}
  ${buildColsXml(widths)}
  <sheetData>${rowsXml.join("")}</sheetData>
</worksheet>`;
}

/**
 * Sheet 20: Raw Database Table: rulesarchive
 */
function buildRawRulesArchiveSheet(ctx: SheetContext): string {
  const { entityName } = ctx;
  const archive = state.rulesArchive;
  const entries = archive?.entries ?? [];
  const widths = [22, 22, 10, 14, 20, 22, 8, 18, 14, 14, 22, 35];
  const rowsXml: string[] = [];

  rowsXml.push(`<row r="1" ht="26" customHeight="1">
    ${textCell("A1", `${entityName} — Raw Database Table: rulesarchive`, 13)}
  </row>`);
  rowsXml.push(`<row r="2" ht="18" customHeight="1">
    ${textCell("A2", `Displaced and superseded categorisation rule sets archive | Total archived sets: ${entries.length}`, 14)}
  </row>`);

  rowsXml.push(`<row r="3" ht="22" customHeight="1">
    ${textCell("A3", "Archive Set Name", 1)}
    ${textCell("B3", "Replaced At", 1)}
    ${textCell("C3", "Priority", 1)}
    ${textCell("D3", "Account Code", 1)}
    ${textCell("E3", "Keyword Match", 2)}
    ${textCell("F3", "Assign Contact", 2)}
    ${textCell("G3", "Sign", 1)}
    ${textCell("H3", "Bank Account Scope", 1)}
    ${textCell("I3", "Min Amt ($)", 3)}
    ${textCell("J3", "Max Amt ($)", 3)}
    ${textCell("K3", "Warning Advice", 2)}
    ${textCell("L3", "Rule Note / Explanation", 2)}
  </row>`);

  let rIdx = 4;
  if (entries.length === 0) {
    rowsXml.push(`<row r="${rIdx}">
      ${textCell(`A${rIdx}`, "No archives", 5)}
      ${textCell(`B${rIdx}`, "No superseded rule sets archived in database.", 4)}
    </row>`);
  } else {
    for (const entry of entries) {
      const setRules = entry.rules?.rules ?? [];
      if (setRules.length === 0) {
        rowsXml.push(`<row r="${rIdx}">
          ${textCell(`A${rIdx}`, entry.name, 5)}
          ${textCell(`B${rIdx}`, entry.replacedAt, 5)}
          ${textCell(`C${rIdx}`, "Empty", 5)}
          ${textCell(`D${rIdx}`, "", 5)}
          ${textCell(`E${rIdx}`, "(No rules in set)", 4)}
        </row>`);
        rIdx++;
      } else {
        for (const r of setRules) {
          rowsXml.push(`<row r="${rIdx}">
            ${textCell(`A${rIdx}`, entry.name, 4)}
            ${textCell(`B${rIdx}`, entry.replacedAt, 5)}
            ${numCell(`C${rIdx}`, r.priority ?? 0, 7)}
            ${textCell(`D${rIdx}`, r.code, 5)}
            ${textCell(`E${rIdx}`, r.keyword ?? "", 4)}
            ${textCell(`F${rIdx}`, r.contact ?? "", 4)}
            ${textCell(`G${rIdx}`, r.sign ?? "Any", 5)}
            ${textCell(`H${rIdx}`, r.account ?? "All Accounts", 5)}
            ${r.minAmount !== undefined ? numCell(`I${rIdx}`, r.minAmount / 100, 6) : textCell(`I${rIdx}`, "", 6)}
            ${r.maxAmount !== undefined ? numCell(`J${rIdx}`, r.maxAmount / 100, 6) : textCell(`J${rIdx}`, "", 6)}
            ${textCell(`K${rIdx}`, r.warn ?? "", 4)}
            ${textCell(`L${rIdx}`, r.note ?? "", 4)}
          </row>`);
          rIdx++;
        }
      }
    }
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  ${buildSheetViewsXml(3)}
  ${buildColsXml(widths)}
  <sheetData>${rowsXml.join("")}</sheetData>
</worksheet>`;
}

// --- Master Workbook Assembler ---

export function buildExcelReport(targetYear?: number | "all"): Uint8Array {
  const txYears = state.ledger.transactions.map((t) => financialYearOf(t.date));
  const journalYears = (state.ledger.journals ?? []).map((j) => financialYearOf(j.date));
  const allYears = [...new Set([...txYears, ...journalYears])].sort((a, b) => b - a);
  const years = allYears.length > 0 ? allYears : [new Date().getFullYear()];

  const defaultYear = years[0] ?? new Date().getFullYear();
  let year: number | "all";
  if (targetYear !== undefined) {
    year = targetYear;
  } else {
    const bannerSelect = typeof document !== "undefined"
      ? (document.getElementById("excel-export-year-select") as HTMLSelectElement | null)
      : null;
    const toolbarSelect = typeof document !== "undefined"
      ? (document.getElementById("report-year") as HTMLSelectElement | null)
      : null;

    if (bannerSelect && bannerSelect.value) {
      year = bannerSelect.value === "all" ? "all" : (Number(bannerSelect.value) || defaultYear);
    } else if (toolbarSelect && toolbarSelect.value) {
      year = toolbarSelect.value === "all" ? "all" : (Number(toolbarSelect.value) || defaultYear);
    } else {
      year = "all";
    }
  }

  const startYear = year === "all" ? Math.min(...years) : year;
  const endYear = year === "all" ? Math.max(...years) : year;
  const from = `${startYear - 1}-04-01`;
  const to = `${endYear}-03-31`;
  const yearLabel =
    year === "all"
      ? (years.length > 1
          ? `All Financial Years (FY${startYear} - FY${endYear}: ${from} to ${to})`
          : `All Financial Years (FY${startYear}: ${from} to ${to})`)
      : `FY${year} (${from} to ${to})`;

  const entity = reportingEntity();
  const entityName = entity?.name ?? "NZOSA Entity";
  const gstNumber = entity?.gstNumber ?? "";
  const basisEl = typeof document !== "undefined" ? (document.getElementById("report-basis") as HTMLSelectElement | null) : null;
  const exportBasis = basisEl?.value === "cash" ? "Cash Basis" : "Accrual / Posted Basis";

  const ctx: SheetContext = {
    year,
    yearLabel,
    startYear,
    endYear,
    from,
    to,
    entityName,
    gstNumber,
    exportBasis,
  };

  // 1. Generate XML for all 20 sheets (7 Reports + 13 Raw Database Tables)
  const sheet1Xml = buildSummaryTrialBalanceSheet(ctx);
  const sheet2Xml = buildGeneralLedgerSheet(ctx);
  const sheet3Xml = buildBankTransactionsSheet(ctx);
  const sheet4Xml = buildRevenueExpensesSheet(ctx);
  const sheet5Xml = buildUnusualTransactionsSheet(ctx);
  const sheet6Xml = buildDepreciationSheet(ctx);
  const sheet7Xml = buildGstReturnsSheet(ctx);
  const sheet8Xml = buildRawTransactionsSheet(ctx);
  const sheet9Xml = buildRawChartSheet(ctx);
  const sheet10Xml = buildRawInvoicesSheet(ctx);
  const sheet11Xml = buildRawAllocationsSheet(ctx);
  const sheet12Xml = buildRawAssetsSheet(ctx);
  const sheet13Xml = buildRawEntitiesSheet(ctx);
  const sheet14Xml = buildRawJournalsSheet(ctx);
  const sheet15Xml = buildRawDecisionsSheet(ctx);
  const sheet16Xml = buildRawRulesSheet(ctx);
  const sheet17Xml = buildRawFiledReturnsSheet(ctx);
  const sheet18Xml = buildRawReferenceSheet(ctx);
  const sheet19Xml = buildRawEventsSheet(ctx);
  const sheet20Xml = buildRawRulesArchiveSheet(ctx);

  // 2. OpenXML Structural Files
  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet4.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet5.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet6.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet7.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet8.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet9.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet10.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet11.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet12.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet13.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet14.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet15.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet16.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet17.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet18.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet19.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet20.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;

  const packageRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Summary &amp; Trial Balance" sheetId="1" r:id="rId1"/>
    <sheet name="General Ledger" sheetId="2" r:id="rId2"/>
    <sheet name="Bank Transactions &amp; Coding" sheetId="3" r:id="rId3"/>
    <sheet name="Revenue &amp; Expenses" sheetId="4" r:id="rId4"/>
    <sheet name="Unusual Transactions" sheetId="5" r:id="rId5"/>
    <sheet name="Depreciation Schedule" sheetId="6" r:id="rId6"/>
    <sheet name="GST Returns" sheetId="7" r:id="rId7"/>
    <sheet name="Raw Transactions" sheetId="8" r:id="rId8"/>
    <sheet name="Chart of Accounts" sheetId="9" r:id="rId9"/>
    <sheet name="Invoices &amp; Bills" sheetId="10" r:id="rId10"/>
    <sheet name="Payment Allocations" sheetId="11" r:id="rId11"/>
    <sheet name="Fixed Asset Register" sheetId="12" r:id="rId12"/>
    <sheet name="Entities &amp; Setup" sheetId="13" r:id="rId13"/>
    <sheet name="Raw Journals" sheetId="14" r:id="rId14"/>
    <sheet name="User Decisions" sheetId="15" r:id="rId15"/>
    <sheet name="Categorisation Rules" sheetId="16" r:id="rId16"/>
    <sheet name="Filed GST Returns" sheetId="17" r:id="rId17"/>
    <sheet name="Reference Ledger" sheetId="18" r:id="rId18"/>
    <sheet name="Audit Trail Events" sheetId="19" r:id="rId19"/>
    <sheet name="Rules Archive" sheetId="20" r:id="rId20"/>
  </sheets>
</workbook>`;

  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet4.xml"/>
  <Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet5.xml"/>
  <Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet6.xml"/>
  <Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet7.xml"/>
  <Relationship Id="rId8" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet8.xml"/>
  <Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet9.xml"/>
  <Relationship Id="rId10" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet10.xml"/>
  <Relationship Id="rId11" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet11.xml"/>
  <Relationship Id="rId12" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet12.xml"/>
  <Relationship Id="rId13" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet13.xml"/>
  <Relationship Id="rId14" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet14.xml"/>
  <Relationship Id="rId15" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet15.xml"/>
  <Relationship Id="rId16" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet16.xml"/>
  <Relationship Id="rId17" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet17.xml"/>
  <Relationship Id="rId18" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet18.xml"/>
  <Relationship Id="rId19" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet19.xml"/>
  <Relationship Id="rId20" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet20.xml"/>
  <Relationship Id="rIdStyle" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  // 3. Assemble Zip Archive
  const files = [
    { name: "[Content_Types].xml", data: encodeUtf8(contentTypesXml) },
    { name: "_rels/.rels", data: encodeUtf8(packageRelsXml) },
    { name: "xl/workbook.xml", data: encodeUtf8(workbookXml) },
    { name: "xl/_rels/workbook.xml.rels", data: encodeUtf8(workbookRelsXml) },
    { name: "xl/styles.xml", data: encodeUtf8(STYLES_XML) },
    { name: "xl/worksheets/sheet1.xml", data: encodeUtf8(sheet1Xml) },
    { name: "xl/worksheets/sheet2.xml", data: encodeUtf8(sheet2Xml) },
    { name: "xl/worksheets/sheet3.xml", data: encodeUtf8(sheet3Xml) },
    { name: "xl/worksheets/sheet4.xml", data: encodeUtf8(sheet4Xml) },
    { name: "xl/worksheets/sheet5.xml", data: encodeUtf8(sheet5Xml) },
    { name: "xl/worksheets/sheet6.xml", data: encodeUtf8(sheet6Xml) },
    { name: "xl/worksheets/sheet7.xml", data: encodeUtf8(sheet7Xml) },
    { name: "xl/worksheets/sheet8.xml", data: encodeUtf8(sheet8Xml) },
    { name: "xl/worksheets/sheet9.xml", data: encodeUtf8(sheet9Xml) },
    { name: "xl/worksheets/sheet10.xml", data: encodeUtf8(sheet10Xml) },
    { name: "xl/worksheets/sheet11.xml", data: encodeUtf8(sheet11Xml) },
    { name: "xl/worksheets/sheet12.xml", data: encodeUtf8(sheet12Xml) },
    { name: "xl/worksheets/sheet13.xml", data: encodeUtf8(sheet13Xml) },
    { name: "xl/worksheets/sheet14.xml", data: encodeUtf8(sheet14Xml) },
    { name: "xl/worksheets/sheet15.xml", data: encodeUtf8(sheet15Xml) },
    { name: "xl/worksheets/sheet16.xml", data: encodeUtf8(sheet16Xml) },
    { name: "xl/worksheets/sheet17.xml", data: encodeUtf8(sheet17Xml) },
    { name: "xl/worksheets/sheet18.xml", data: encodeUtf8(sheet18Xml) },
    { name: "xl/worksheets/sheet19.xml", data: encodeUtf8(sheet19Xml) },
    { name: "xl/worksheets/sheet20.xml", data: encodeUtf8(sheet20Xml) },
  ];

  return createZip(files);
}

export function downloadBytes(
  bytes: Uint8Array,
  filename: string,
  type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
): void {
  const blob = new Blob([bytes as unknown as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function downloadExcelReport(year?: number | "all"): void {
  const txYears = state.ledger.transactions.map((t) => financialYearOf(t.date));
  const journalYears = (state.ledger.journals ?? []).map((j) => financialYearOf(j.date));
  const allYears = [...new Set([...txYears, ...journalYears])].sort((a, b) => b - a);
  const years = allYears.length > 0 ? allYears : [new Date().getFullYear()];

  const defaultYear = years[0] ?? new Date().getFullYear();
  let selectedYear: number | "all";
  if (year !== undefined) {
    selectedYear = year;
  } else {
    const bannerSelect = typeof document !== "undefined"
      ? (document.getElementById("excel-export-year-select") as HTMLSelectElement | null)
      : null;
    const toolbarSelect = typeof document !== "undefined"
      ? (document.getElementById("report-year") as HTMLSelectElement | null)
      : null;

    if (bannerSelect && bannerSelect.value) {
      selectedYear = bannerSelect.value === "all" ? "all" : (Number(bannerSelect.value) || defaultYear);
    } else if (toolbarSelect && toolbarSelect.value) {
      selectedYear = toolbarSelect.value === "all" ? "all" : (Number(toolbarSelect.value) || defaultYear);
    } else {
      selectedYear = "all";
    }
  }

  const bytes = buildExcelReport(selectedYear);
  const entity = reportingEntity();
  const slug = (entity?.name ?? "nzosa").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const filename =
    selectedYear === "all"
      ? `${slug}-financial-report-all-years.xlsx`
      : `${slug}-financial-report-fy${selectedYear}.xlsx`;
  downloadBytes(bytes, filename);
}
