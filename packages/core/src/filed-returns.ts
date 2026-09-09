import type { Cents } from "./money.js";
import { parseAmount } from "./money.js";
import type { IsoDate } from "./dates.js";
import { parseDate } from "./dates.js";
import type { SheetRows, Workbook } from "./xlsx.js";

/**
 * A GST return as it was actually filed.
 *
 * Holding these as data rather than as figures typed into a comparison is the
 * whole point: a baseline that lives in someone's head is one that can be wrong
 * without anyone noticing. This project spent eight periods comparing against
 * Box 8 less Box 12 in the belief it was comparing against Box 15, because the
 * numbers had been transcribed once and never checked again.
 *
 * The return sheet gives the boxes; the transactions sheet gives the lines
 * behind them, which is what makes a difference explainable rather than merely
 * visible.
 */

export interface FiledLine {
  date: IsoDate;
  /** Chart code, e.g. `200`. Blank on some rows. */
  code: string;
  account: string;
  contact: string;
  reference: string;
  description: string;
  /** Tax rate as named by the source, e.g. `15% GST on Income`. */
  taxRate: string;
  /**
   * GST-inclusive amount, signed so that income is positive and expenditure
   * negative.
   *
   * The source prints expenses as positive under an expense heading, which
   * makes an income line and an expense line of the same size look identical.
   * Carrying the sign here means they never can be.
   */
  gross: Cents;
  net: Cents;
  gst: Cents;
  /** The section heading this line appeared under. */
  section: string;
  /** True when it sat under `Late claims` rather than a rate heading. */
  lateClaim: boolean;
}

export interface FiledBoxes {
  box5: Cents;
  box6: Cents;
  box7: Cents;
  box8: Cents;
  box9: Cents;
  box10: Cents;
  box11: Cents;
  box12: Cents;
  box13: Cents;
  box14: Cents;
  /** Signed: positive to pay, negative for a refund. */
  box15: Cents;
}

export interface FiledReturn {
  /** Period end, which names the return. */
  periodEnd: IsoDate;
  periodStart: IsoDate | null;
  /** `Payments basis` or `Invoice basis`, verbatim. */
  basis: string;
  /** `Filed`, `Draft`, or whatever the source says. */
  status: string;
  boxes: FiledBoxes;
  lines: FiledLine[];
  /**
   * Box 8 less Box 12: the period's own trading, before adjustments.
   *
   * This is what a bank-derived ledger produces, so it is the figure to compare
   * against. Box 15 also carries Box 9 and Box 13, which hold late claims and
   * year-end corrections that no bank data can contain.
   */
  core: Cents;
}

export interface FiledReturnProblem {
  message: string;
}

export interface FiledReturnResult {
  returns: FiledReturn[];
  problems: FiledReturnProblem[];
}

const MONTHS =
  "january february march april may june july august september october november december".split(" ");

/** `1 April 2026` and `01-04-2026` both appear, in different sheets. */
function readDate(text: string): IsoDate | null {
  const trimmed = text.trim();
  const words = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/.exec(trimmed);
  if (words?.[1] && words[2] && words[3]) {
    const month = MONTHS.indexOf(words[2].toLowerCase());
    if (month >= 0) {
      return `${words[3]}-${String(month + 1).padStart(2, "0")}-${words[1].padStart(2, "0")}`;
    }
  }
  const dashed = /^(\d{2})-(\d{2})-(\d{4})$/.exec(trimmed);
  if (dashed) return `${dashed[3]}-${dashed[2]}-${dashed[1]}`;
  return parseDate(trimmed);
}

/** The cells of one row, in column order, with blanks dropped. */
function filled(row: Map<number, string>): string[] {
  return [...row.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, value]) => value.trim())
    .filter((value) => value !== "");
}

function readReturnSheet(sheet: SheetRows): {
  periodStart: IsoDate | null;
  periodEnd: IsoDate | null;
  basis: string;
  status: string;
  boxes: FiledBoxes;
} {
  const boxes: FiledBoxes = {
    box5: 0, box6: 0, box7: 0, box8: 0, box9: 0,
    box10: 0, box11: 0, box12: 0, box13: 0, box14: 0, box15: 0,
  };
  let periodStart: IsoDate | null = null;
  let periodEnd: IsoDate | null = null;
  let basis = "";
  let status = "";
  let refund = false;

  for (const key of [...sheet.rows.keys()].sort((a, b) => a - b)) {
    const cells = filled(sheet.rows.get(key) ?? new Map());
    if (cells.length === 0) continue;
    const head = cells[0] ?? "";
    const tail = cells[cells.length - 1] ?? "";

    if (head === "GST return") status = cells[1] ?? "";
    if (head === "Tax basis") basis = tail;
    if (head === "GST refund") refund = true;

    const period = /^For the period (.+?) to (.+)$/.exec(head);
    if (period?.[1] && period[2]) {
      periodStart = readDate(period[1]);
      periodEnd = readDate(period[2]);
    }

    const box = /^Box (\d+)$/.exec(head);
    if (box?.[1]) {
      const value = parseAmount(tail);
      if (value !== null) boxes[`box${box[1]}` as keyof FiledBoxes] = value;
    }
  }

  // The sheet prints Box 15 unsigned and says which way it goes in words.
  if (refund) boxes.box15 = -Math.abs(boxes.box15);
  return { periodStart, periodEnd, basis, status, boxes };
}

const HEADINGS = ["Date", "Gross", "Net"];

function readTransactionsSheet(sheet: SheetRows): FiledLine[] {
  // Find the header row and remember which column each field is in. The rows
  // cannot be read positionally: a blank Reference would shift Gross into the
  // tax-rate column and turn a good line into a difference.
  let columns: Map<string, number> | null = null;
  for (const key of [...sheet.rows.keys()].sort((a, b) => a - b)) {
    const row = sheet.rows.get(key);
    if (!row) continue;
    const byName = new Map<string, number>();
    for (const [column, value] of row) byName.set(value.trim(), column);
    if (HEADINGS.every((heading) => byName.has(heading))) {
      columns = byName;
      break;
    }
  }
  if (!columns) return [];

  const at = (row: Map<number, string>, name: string): string =>
    (row.get(columns?.get(name) ?? -1) ?? "").trim();

  const lines: FiledLine[] = [];
  let section = "";

  for (const key of [...sheet.rows.keys()].sort((a, b) => a - b)) {
    const row = sheet.rows.get(key);
    if (!row) continue;
    const cells = filled(row);
    if (cells.length === 0) continue;
    // A row with a single filled cell is a section heading.
    if (cells.length === 1) {
      section = cells[0] ?? "";
      continue;
    }

    const date = readDate(at(row, "Date"));
    // Subtotal rows carry figures but no date; requiring one is what tells a
    // transaction apart from a total.
    if (date === null) continue;

    const gross = parseAmount(at(row, "Gross"));
    if (gross === null) continue;

    const expense = /expense/i.test(section);
    lines.push({
      date,
      code: at(row, "Code"),
      account: at(row, "Account"),
      contact: at(row, "Contact"),
      reference: at(row, "Reference"),
      description: at(row, "Description"),
      taxRate: at(row, "Tax rate"),
      gross: expense ? -gross : gross,
      net: (parseAmount(at(row, "Net")) ?? 0) * (expense ? -1 : 1),
      gst: (parseAmount(at(row, "Total GST")) ?? 0) * (expense ? -1 : 1),
      section,
      lateClaim: /late claim/i.test(section),
    });
  }

  return lines;
}

/** Read one filed return from its workbook. */
export function parseFiledReturn(workbook: Workbook): FiledReturnResult {
  const problems: FiledReturnProblem[] = [];
  const returnSheet = workbook.sheets.find((sheet) => sheet.name === "Return");
  if (!returnSheet) {
    return { returns: [], problems: [{ message: "no Return sheet: not a GST return workbook" }] };
  }

  const header = readReturnSheet(returnSheet);
  if (header.periodEnd === null) {
    return { returns: [], problems: [{ message: "could not read the period from the Return sheet" }] };
  }

  const transactions = workbook.sheets.find((sheet) => sheet.name === "Transactions");
  const lines = transactions ? readTransactionsSheet(transactions) : [];
  if (!transactions) {
    problems.push({ message: `${header.periodEnd}: no Transactions sheet, so only the boxes are known` });
  }

  const boxes = header.boxes;
  return {
    returns: [
      {
        periodEnd: header.periodEnd,
        periodStart: header.periodStart,
        basis: header.basis,
        status: header.status,
        boxes,
        lines,
        core: boxes.box8 - boxes.box12,
      },
    ],
    problems,
  };
}

/**
 * Check a return's boxes against each other.
 *
 * The form's own arithmetic has to hold, and when it does not the sheet has
 * been misread rather than filed wrongly.
 */
export function validateFiledReturn(filedReturn: FiledReturn): FiledReturnProblem[] {
  const problems: FiledReturnProblem[] = [];
  const b = filedReturn.boxes;
  const label = filedReturn.periodEnd;

  if (b.box10 !== b.box8 + b.box9) {
    problems.push({ message: `${label}: Box 10 is not Box 8 plus Box 9` });
  }
  if (b.box14 !== b.box12 + b.box13) {
    problems.push({ message: `${label}: Box 14 is not Box 12 plus Box 13` });
  }
  if (Math.abs(b.box15) !== Math.abs(b.box10 - b.box14)) {
    problems.push({ message: `${label}: Box 15 is not Box 10 less Box 14` });
  }
  return problems;
}
