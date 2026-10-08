import type { Cents } from "./money.js";
import type { IsoDate } from "./dates.js";
import type { BankFields, ReferenceLine } from "./coding-check.js";
import { splitAccountLabel } from "./chart-codes.js";

/**
 * Any spreadsheet, read by an AI into lines this app can use.
 *
 * People keep their books in spreadsheets of every shape: one amount column or
 * money in and money out; a column per category; a tab per month or per
 * property; totals and notes mixed in. Recognising each shape by hand would
 * never end. So the whole sheet goes to a model, which writes back every line
 * as JSON -- and a second request, separate from the first, works the totals
 * out from the sheet again and compares them with what the first produced, so
 * a mistake the first made is not simply repeated.
 *
 * The model never touches the books. What it returns is read, checked and
 * shown, and nothing is kept until a person accepts it. By default it becomes
 * coded history -- the same as a Xero export: compared with the bank lines and
 * used to learn rules -- because a spreadsheet beside a bank feed is the same
 * money twice if it is taken as transactions too.
 */

/** One tab of a spreadsheet, as rows of cells. */
export interface SheetTab {
  name: string;
  rows: readonly (readonly string[])[];
}

/** One line read from a spreadsheet. */
export interface SheetLine {
  sheet: string;
  row: number;
  date: IsoDate;
  /** Money in positive, money out negative. */
  amount: Cents;
  description: string;
  /** The sheet's own category or account for the line. */
  category: string;
  /** The bank account the sheet says it went through, if it says. */
  bank?: string;
  /** The GST the sheet records for it, as written: "15%", "0%", "exempt". */
  gst?: string;
  bankFields?: BankFields;
}

/** A total the sheet itself shows, for checking the lines against. */
export interface SheetTotal {
  sheet: string;
  row: number;
  label: string;
  amount: Cents;
  /** What it totals: everything, a category, a month, or something else. */
  covers: "all" | "category" | "month" | "other";
  category?: string;
  /** YYYY-MM. */
  month?: string;
}

export interface SheetConversion {
  lines: SheetLine[];
  totals: SheetTotal[];
  skipped: { sheet: string; row: number; reason: string }[];
  notes: string;
  /** The model said the part was too much to convert in one answer. */
  tooBig: boolean;
  /** What was wrong with the answer itself. */
  problems: string[];
}

/** The most rows of a sheet sent in one request: the answer has to fit. */
export const ROWS_PER_PART = 250;

/** A part of a spreadsheet small enough for one answer. */
export interface SheetPart {
  /** 1-based. */
  index: number;
  of: number;
  text: string;
  rows: number;
}

/** A row as one line of text, numbered as the spreadsheet numbers it. */
function rowText(number: number, cells: readonly string[]): string {
  const quoted = cells.map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell));
  return `${number}| ${quoted.join(",")}`;
}

function nonEmpty(cells: readonly string[]): boolean {
  return cells.some((cell) => cell.trim() !== "");
}

/**
 * The spreadsheet in parts, each with its tab's heading rows repeated so a
 * part can be read on its own.
 *
 * A tab is kept whole where it fits; a long one is cut every ROWS_PER_PART
 * rows. Empty rows are left out but numbering is kept, so a row named in an
 * answer is the row in the sheet.
 */
export function sheetParts(tabs: readonly SheetTab[], rowsPerPart = ROWS_PER_PART): SheetPart[] {
  const chunks: { text: string; rows: number }[] = [];
  for (const tab of tabs) {
    const numbered = tab.rows
      .map((cells, i) => ({ number: i + 1, cells }))
      .filter(({ cells }) => nonEmpty(cells));
    if (numbered.length === 0) continue;
    // The first few filled rows are where headings are: repeated with every part.
    const head = numbered.slice(0, 5);
    const body = numbered.slice(5);
    for (let start = 0; start === 0 || start < body.length; start += rowsPerPart) {
      const slice = body.slice(start, start + rowsPerPart);
      const lines = [
        `=== Sheet: ${tab.name} ===`,
        ...head.map(({ number, cells }) => rowText(number, cells)),
        ...(start > 0 ? ["(rows above are the sheet's first rows, repeated for its headings)"] : []),
        ...slice.map(({ number, cells }) => rowText(number, cells)),
      ];
      chunks.push({ text: lines.join("\n"), rows: head.length + slice.length });
      if (body.length === 0) break;
    }
  }
  return chunks.map((chunk, i) => ({ index: i + 1, of: chunks.length, text: chunk.text, rows: chunk.rows }));
}

/** The whole spreadsheet as one text, for the check. */
export function sheetText(tabs: readonly SheetTab[]): string {
  return tabs
    .map((tab) =>
      [
        `=== Sheet: ${tab.name} ===`,
        ...tab.rows.map((cells, i) => ({ number: i + 1, cells })).filter(({ cells }) => nonEmpty(cells)).map(({ number, cells }) => rowText(number, cells)),
      ].join("\n"),
    )
    .join("\n\n");
}

/** Roughly how many tokens a text is: about four characters each. */
export function roughTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const LINE_FIELDS = [
  `"sheet": the tab's name`,
  `"row": the row number, as given at the start of each row`,
  `"date": YYYY-MM-DD. Dates in these sheets are New Zealand dates, day first: 03/04/2025 is 3 April 2025`,
  `"amount": a number in dollars and cents, POSITIVE for money in and NEGATIVE for money out`,
  `"description": what the row says the line was: payee, details, notes, joined if spread over columns`,
  `"category": the sheet's own category, account or coding for the line, exactly as written`,
  `"bank": the bank account or card it went through, if the sheet says; otherwise leave it out`,
  `"gst": the GST the sheet records for it ("15%", "0%", "exempt"), if it says; otherwise leave it out`,
  `"particulars", "code", "reference", "otherParty", "otherPartyAccount", "serial", "trn": copy these exactly if the sheet has columns with these bank names; otherwise leave them out`,
];

/**
 * The prompt that converts one part of a spreadsheet.
 *
 * It asks for every line, the sheet's own totals, and anything skipped, as
 * JSON and nothing else -- and to say so rather than guess when the part is
 * more than it can answer in full.
 */
export function conversionPrompt(part: SheetPart, about = ""): string {
  return [
    "Below is " + (part.of > 1 ? `part ${part.index} of ${part.of} of ` : "") +
      "a spreadsheet someone kept their books in. Each row starts with its row number and a bar.",
    about.trim() === "" ? "" : `About these books: ${about.trim()}`,
    "",
    "Read it into every individual money line it holds, and reply with ONE JSON object and nothing",
    "else -- no explanation, no code fence. The object has these keys:",
    "",
    '"lines": an array, one object per money line, with keys:',
    ...LINE_FIELDS.map((field) => `  - ${field}`),
    "",
    '"totals": an array of the totals the sheet itself shows (total rows, subtotals, monthly or category',
    '  totals), each {"sheet", "row", "label": the text beside it, "amount": as a number with the same',
    '  sign rule, "covers": "all" | "category" | "month" | "other", "category" if it totals one category,',
    '  "month": "YYYY-MM" if it totals one month}. These are for checking, not lines: never also put them',
    "  in lines.",
    "",
    '"skipped": an array of {"sheet", "row", "reason"} for every row with figures you did not turn into a',
    "  line or a total, saying why.",
    "",
    '"notes": a sentence or two on how the sheet is laid out and anything you were unsure of.',
    "",
    '"tooBig": true only if you cannot list every line of this part in your answer. Then return no lines,',
    '  and say in "notes" where you would split it. Never return some of the lines as if they were all.',
    "",
    "How to read it:",
    "- A sheet with one column per category (Rates, Insurance, Repairs ...) has a line for every filled",
    "  cell in those columns: the category is that column's heading.",
    "- A sheet with separate money in and money out (or debit and credit) columns: in is positive, out is",
    "  negative. A single amount column keeps its own sign; if every amount is positive and the sheet is",
    "  plainly a list of spending, they are money out.",
    "- Leave out blank rows, headings, notes and running balances. Copy figures exactly; never round,",
    "  estimate or invent a line, a date or a category.",
    "",
    part.text,
  ]
    .filter((line, i, all) => !(line === "" && all[i - 1] === ""))
    .join("\n");
}

function centsOf(value: unknown): Cents | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.replace(/[$,\s]/g, "").replace(/^\((.*)\)$/, "-$1"))
        : NaN;
  return Number.isFinite(n) ? (Math.round(n * 100) as Cents) : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
}

/**
 * The JSON object in an answer, with any code fence or chatter around it set
 * aside.
 *
 * The first complete object, found by matching its braces outside strings:
 * asked for JSON and nothing else, a model still added a paragraph after it --
 * with braces of its own -- and taking everything to the last brace read that
 * paragraph as part of the JSON.
 */
function jsonIn(answer: string): unknown {
  const start = answer.indexOf("{");
  if (start < 0) throw new Error("There is no JSON object in the answer.");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < answer.length; i++) {
    const ch = answer[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return JSON.parse(answer.slice(start, i + 1));
    }
  }
  throw new Error("The JSON in the answer is not complete -- it may have been cut off.");
}

/** Read a conversion answer, keeping what is sound and saying what is not. */
export function readConversionAnswer(answer: string): SheetConversion {
  const out: SheetConversion = { lines: [], totals: [], skipped: [], notes: "", tooBig: false, problems: [] };
  let raw: Record<string, unknown>;
  try {
    raw = jsonIn(answer) as Record<string, unknown>;
  } catch (error) {
    out.problems.push(`The answer could not be read: ${(error as Error).message}`);
    return out;
  }
  out.tooBig = raw["tooBig"] === true;
  out.notes = text(raw["notes"]);
  const lines = Array.isArray(raw["lines"]) ? raw["lines"] : [];
  for (const [i, item] of lines.entries()) {
    const line = (item ?? {}) as Record<string, unknown>;
    const where = `Line ${i + 1}${line["row"] !== undefined ? ` (row ${text(line["row"])})` : ""}`;
    const date = text(line["date"]);
    const amount = centsOf(line["amount"]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
      out.problems.push(`${where}: the date "${date}" is not a date.`);
      continue;
    }
    if (amount === null) {
      out.problems.push(`${where}: the amount is not a number.`);
      continue;
    }
    const fields: BankFields = {};
    for (const key of ["particulars", "code", "reference", "otherParty", "otherPartyAccount", "serial", "trn"] as const) {
      const value = text(line[key]);
      if (value !== "") fields[key] = value;
    }
    const bank = text(line["bank"]);
    const gst = text(line["gst"]);
    out.lines.push({
      sheet: text(line["sheet"]),
      row: Number(line["row"]) || 0,
      date: date as IsoDate,
      amount,
      description: text(line["description"]),
      category: text(line["category"]),
      ...(bank !== "" ? { bank } : {}),
      ...(gst !== "" ? { gst } : {}),
      ...(Object.keys(fields).length > 0 ? { bankFields: fields } : {}),
    });
  }
  const totals = Array.isArray(raw["totals"]) ? raw["totals"] : [];
  for (const item of totals) {
    const total = (item ?? {}) as Record<string, unknown>;
    const amount = centsOf(total["amount"]);
    if (amount === null) continue;
    const covers = ["all", "category", "month", "other"].includes(text(total["covers"]))
      ? (text(total["covers"]) as SheetTotal["covers"])
      : "other";
    out.totals.push({
      sheet: text(total["sheet"]),
      row: Number(total["row"]) || 0,
      label: text(total["label"]),
      amount,
      covers,
      ...(text(total["category"]) !== "" ? { category: text(total["category"]) } : {}),
      ...(/^\d{4}-\d{2}$/.test(text(total["month"])) ? { month: text(total["month"]) } : {}),
    });
  }
  const skipped = Array.isArray(raw["skipped"]) ? raw["skipped"] : [];
  for (const item of skipped) {
    const one = (item ?? {}) as Record<string, unknown>;
    out.skipped.push({ sheet: text(one["sheet"]), row: Number(one["row"]) || 0, reason: text(one["reason"]) });
  }
  if (lines.length === 0 && !out.tooBig) out.problems.push("The answer holds no lines.");
  return out;
}

/** Several parts' answers as one. */
export function joinConversions(parts: readonly SheetConversion[]): SheetConversion {
  return {
    lines: parts.flatMap((p) => p.lines),
    totals: parts.flatMap((p) => p.totals),
    skipped: parts.flatMap((p) => p.skipped),
    notes: parts.map((p) => p.notes).filter((n) => n !== "").join(" "),
    tooBig: parts.some((p) => p.tooBig),
    problems: parts.flatMap((p, i) => p.problems.map((problem) => (parts.length > 1 ? `Part ${i + 1}: ${problem}` : problem))),
  };
}

/** What the lines come to: overall, by category and by month. */
export interface LineTotals {
  count: number;
  in: Cents;
  out: Cents;
  net: Cents;
  byCategory: Map<string, Cents>;
  byMonth: Map<string, Cents>;
}

export function lineTotals(lines: readonly SheetLine[]): LineTotals {
  const byCategory = new Map<string, Cents>();
  const byMonth = new Map<string, Cents>();
  let inSum = 0;
  let outSum = 0;
  for (const line of lines) {
    if (line.amount >= 0) inSum += line.amount;
    else outSum += line.amount;
    const category = line.category === "" ? "(no category)" : line.category;
    byCategory.set(category, ((byCategory.get(category) ?? 0) + line.amount) as Cents);
    const month = line.date.slice(0, 7);
    byMonth.set(month, ((byMonth.get(month) ?? 0) + line.amount) as Cents);
  }
  return {
    count: lines.length,
    in: inSum as Cents,
    out: outSum as Cents,
    net: (inSum + outSum) as Cents,
    byCategory,
    byMonth,
  };
}

/** One of the sheet's own totals beside what the lines make of it. */
export interface TotalCheck {
  total: SheetTotal;
  ours: Cents | null;
  /** Null when there is nothing to compare it with. */
  agrees: boolean | null;
}

/**
 * The sheet's own totals against the lines, where it can be said what a total
 * covers. Compared by size, since a total of spending is written either way
 * round.
 */
export function checkAgainstSheetTotals(lines: readonly SheetLine[], totals: readonly SheetTotal[]): TotalCheck[] {
  const sum = (picked: readonly SheetLine[]): Cents => picked.reduce((s, l) => s + l.amount, 0) as Cents;
  return totals.map((total) => {
    const own = lines.filter((l) => total.sheet === "" || l.sheet === total.sheet);
    let ours: Cents | null = null;
    if (total.covers === "all") ours = sum(own);
    if (total.covers === "category" && total.category !== undefined) {
      ours = sum(own.filter((l) => l.category.toLowerCase() === total.category!.toLowerCase()));
    }
    if (total.covers === "month" && total.month !== undefined) ours = sum(own.filter((l) => l.date.startsWith(total.month!)));
    return {
      total,
      ours,
      agrees: ours === null ? null : Math.abs(Math.abs(ours) - Math.abs(total.amount)) <= 1,
    };
  });
}

/** Cents as the check prompt shows them. */
function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * The second request: work the totals out from the sheet again, and compare.
 *
 * Separate from the conversion, so the model starts from the sheet rather
 * than from its own first answer. Asked part by part, with each part's own
 * lines' totals: a whole year's sheet can be more than a model takes in at
 * once, and a part is what was converted together.
 */
export function checkPrompt(sheet: string, totals: LineTotals): string {
  const categories = [...totals.byCategory.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const months = [...totals.byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return [
    "Below is a spreadsheet someone kept their books in, and the totals another program worked out from",
    "the money lines it read out of it. Check those totals against the sheet. Work each one out from the",
    "sheet yourself -- do not assume the figures given are right.",
    "",
    "Money in is positive and money out negative. Dates are New Zealand dates, day first.",
    "",
    "Totals to check:",
    `  lines read: ${totals.count}`,
    `  money in: ${dollars(totals.in)}`,
    `  money out: ${dollars(totals.out)}`,
    "  by category:",
    ...categories.map(([name, cents]) => `    ${name}: ${dollars(cents)}`),
    "  by month:",
    ...months.map(([month, cents]) => `    ${month}: ${dollars(cents)}`),
    "",
    "Reply with ONE JSON object and nothing else -- no explanation, no code fence:",
    '{"agrees": true or false,',
    ' "differences": [{"what": which total, e.g. "category Rates" or "month 2025-07" or "money out",',
    '   "sheet": the figure you get from the sheet, as a number, "given": the figure above, as a number,',
    '   "rows": the sheet rows that explain the difference, if you can say, "note": why}],',
    ' "notes": anything else worth knowing}',
    "List ONLY totals where your figure from the sheet is different from the figure given. A total that",
    "matches is not a difference and must not be listed, not even to confirm it. A total the sheet does",
    "not let you check is not a difference either. If everything matches, differences is an empty array.",
    "",
    sheet,
  ].join("\n");
}

export interface CheckResult {
  agrees: boolean;
  differences: { what: string; sheet: Cents | null; given: Cents | null; rows: string; note: string }[];
  notes: string;
  problems: string[];
}

export function readCheckAnswer(answer: string): CheckResult {
  const out: CheckResult = { agrees: false, differences: [], notes: "", problems: [] };
  try {
    const raw = jsonIn(answer) as Record<string, unknown>;
    out.agrees = raw["agrees"] === true;
    out.notes = text(raw["notes"]);
    let confirmed = 0;
    for (const item of Array.isArray(raw["differences"]) ? raw["differences"] : []) {
      const one = (item ?? {}) as Record<string, unknown>;
      // Listed, but the same figure both ways: a model confirming a total,
      // however plainly it was asked only for differences.
      const sheetFigure = centsOf(one["sheet"]);
      const givenFigure = centsOf(one["given"]);
      if (sheetFigure !== null && givenFigure !== null && Math.abs(sheetFigure - givenFigure) <= 1) {
        confirmed++;
        continue;
      }
      out.differences.push({
        what: text(one["what"]),
        sheet: centsOf(one["sheet"]),
        given: centsOf(one["given"]),
        rows: Array.isArray(one["rows"]) ? one["rows"].map(text).join(", ") : text(one["rows"]),
        note: text(one["note"]),
      });
    }
    if (out.differences.length > 0) out.agrees = false;
    // Everything it listed was a total confirmed: it agrees, whatever it said.
    else if (confirmed > 0) out.agrees = true;
  } catch (error) {
    out.problems.push(`The answer could not be read: ${(error as Error).message}`);
  }
  return out;
}

/** The lines as coded history: compared with the bank lines and learned from. */
export function sheetLinesToReference(lines: readonly SheetLine[], source: string): ReferenceLine[] {
  return lines
    .filter((line) => line.category !== "")
    .map((line) => ({
      date: line.date,
      amount: line.amount,
      code: line.category,
      label: line.category,
      source,
      ...(line.description !== "" ? { description: line.description } : {}),
      ...(line.bankFields?.otherParty || line.description
        ? { contact: line.bankFields?.otherParty ?? line.description }
        : {}),
      ...(line.bank !== undefined ? { bankAccount: line.bank } : {}),
      ...(line.gst !== undefined ? { gstRate: line.gst } : {}),
      ...(line.bankFields !== undefined ? { bankFields: line.bankFields } : {}),
    }));
}

/**
 * The lines as bank transactions, when that is chosen over coded history.
 *
 * Only for money no bank export holds -- cash, or a year before any bank data.
 * Beside a bank feed for the same account, the same money is in the books
 * twice, which is why it is not the default. A line with no bank of its own
 * goes to `account`.
 */
export function sheetLinesToTransactions(
  lines: readonly SheetLine[],
  account: string,
  source: string,
): import("./types.js").Transaction[] {
  return lines.map((line, i) => ({
    id: "",
    date: line.date,
    amount: line.amount,
    currency: "NZD",
    account: line.bank ?? account,
    serial: line.bankFields?.serial ?? "",
    trn: line.bankFields?.trn ?? "",
    particulars: line.bankFields?.particulars ?? "",
    code: line.bankFields?.code ?? "",
    reference: line.bankFields?.reference ?? "",
    otherParty: line.bankFields?.otherParty ?? line.description,
    origin: "",
    type: "",
    batch: "",
    otherPartyAccount: line.bankFields?.otherPartyAccount ?? "",
    occurrence: 1,
    extras: { sheetCategory: line.category, sheetRow: `${line.sheet}!${line.row}` },
    source: { importer: "spreadsheet (AI)", file: source, line: i + 1 },
  }));
}

/** A name the imported coding uses, with what it was used for. */
export interface CategoryToMatch {
  name: string;
  lines: number;
  /** A few descriptions of lines coded to it, for what it means. */
  examples: readonly string[];
  /** Which way the money coded to it went: rent received and rent paid are different accounts. */
  direction?: "in" | "out" | "both";
}

/** What the model said a name is: one of the accounts, a transfer, or to be ignored. */
export type CategoryMatch =
  | { kind: "account"; account: string; why: string }
  | { kind: "transfer"; why: string }
  | { kind: "ignore"; why: string };

/**
 * The prompt that suggests which of the chart's accounts each name means.
 *
 * Names and what was coded to them, and the chart's own account names -- no
 * amounts, which say nothing about what a category is. It may only choose an
 * account from the list, and is told to leave a name alone rather than guess.
 */
export function categoryMatchPrompt(
  names: readonly CategoryToMatch[],
  accounts: readonly (string | { label: string; type: string })[],
  about = "",
): string {
  const way = (n: CategoryToMatch): string =>
    n.direction === "in" ? "money in" : n.direction === "out" ? "money out" : n.direction === "both" ? "money in and out" : "";
  return [
    "Below are the category names someone's old spreadsheet or accounting system coded their money to,",
    "and the accounts in their new chart of accounts. For each name, say which ONE account it means.",
    about.trim() === "" ? "" : `About these books: ${about.trim()}`,
    "",
    "Reply with ONE JSON object and nothing else -- no explanation, no code fence:",
    '{"matches": [{"category": the name exactly as given, "kind": "account" | "transfer" | "ignore" | "unsure",',
    '  "account": the account EXACTLY as written in the list below, when kind is "account",',
    '  "why": a few words}]}',
    "",
    '- "transfer": the name is money moved between the person\'s own accounts (savings, card payments).',
    '- "ignore": the name marks lines that are not money at all, or were left out ("Ignore", "Pending").',
    '- "unsure": you cannot tell. Saying so is better than a guess: a person will choose.',
    "- Choose only from the list. Never invent an account or change its wording.",
    "- The account must fit the money's direction: money in belongs to an income (revenue) account, or a",
    "  liability or equity one; money out to an expense, asset or liability account. Rent RECEIVED is not",
    "  rent PAID.",
    "- Never choose an account that is merely similar or shares a word: council rates are not power, and",
    "  insurance is not interest. Where the list has no account for the thing itself, choose the general",
    "  one for its side if the list has one (General Expenses for money out; Other Revenue or Other",
    "  Income for money in, rather than Sales for income that is not from selling). Otherwise say unsure.",
    "",
    "Names (lines coded to it, which way the money went, examples of what they were):",
    ...names.map((n) => {
      const facts = [`${n.lines} line${n.lines === 1 ? "" : "s"}`, way(n), n.examples.length > 0 ? `e.g. ${n.examples.join("; ")}` : ""];
      return `- ${n.name} (${facts.filter((f) => f !== "").join("; ")})`;
    }),
    "",
    "Accounts (name, then its type):",
    ...accounts.map((a) => (typeof a === "string" ? `- ${a}` : `- ${a.label} (${a.type || "no type set"})`)),
  ]
    .filter((line, i, all) => !(line === "" && all[i - 1] === ""))
    .join("\n");
}

/**
 * Read the suggestions, keeping only what can be used: a name that was asked
 * about, and an account that is in the chart exactly. Anything else is left
 * for a person, and said.
 */
/**
 * The accounts a category may be matched to: not the ones the app keeps for
 * itself -- bank accounts, receivables and payables, GST, rounding, retained
 * earnings -- which are posted to by what they are for, never chosen as a
 * line's coding. A model offered Accounts Receivable for rent received chose
 * it.
 */
export function codingAccountsOnly<T extends { type: string }>(accounts: readonly T[]): T[] {
  return accounts.filter(
    (a) => !/bank|receivable|payable|\bgst\b|rounding|historical|tracking|retained|unpaid expense/i.test(a.type),
  );
}

/**
 * The chart's own label for an account written another way -- "473 Repairs
 * and Maintenance" for "Repairs and Maintenance - 473". By code where both
 * have one, otherwise by name; never a near miss.
 */
function sameAccount(said: string, accounts: readonly { label: string }[]): string | undefined {
  const { code, name } = splitAccountLabel(said);
  const split = accounts.map((a) => ({ label: a.label, ...splitAccountLabel(a.label) }));
  if (code !== "") {
    const byCode = split.filter((a) => a.code === code);
    if (byCode.length === 1 && byCode[0]!.name.toLowerCase() === name.toLowerCase()) return byCode[0]!.label;
    if (byCode.length > 0) return undefined;
  }
  const byName = split.filter((a) => a.name.toLowerCase() === name.trim().toLowerCase());
  return byName.length === 1 ? byName[0]!.label : undefined;
}

/** Whether money going one way can be coded to an account of this type. */
function fitsDirection(direction: CategoryToMatch["direction"], type: string): boolean {
  if (direction === "in" && /expense|overhead|direct cost|cost of sales/i.test(type)) return false;
  if (direction === "out" && /revenue|income|sales/i.test(type)) return false;
  return true;
}

export function readCategoryMatches(
  answer: string,
  names: readonly (string | CategoryToMatch)[],
  accounts: readonly (string | { label: string; type: string })[],
): { matches: Map<string, CategoryMatch>; problems: string[] } {
  const named = names.map((n) => (typeof n === "string" ? { name: n, lines: 0, examples: [] } : n));
  const typed = accounts.map((a) => (typeof a === "string" ? { label: a, type: "" } : a));
  const matches = new Map<string, CategoryMatch>();
  const problems: string[] = [];
  let raw: Record<string, unknown>;
  try {
    raw = jsonIn(answer) as Record<string, unknown>;
  } catch (error) {
    return { matches, problems: [`The answer could not be read: ${(error as Error).message}`] };
  }
  const asked = new Map(named.map((n) => [n.name.toLowerCase(), n.name]));
  const directionOf = new Map(named.map((n) => [n.name, n.direction]));
  const chart = new Map(typed.map((a) => [a.label.toLowerCase(), a.label]));
  const typeOf = new Map(typed.map((a) => [a.label, a.type]));
  for (const item of Array.isArray(raw["matches"]) ? raw["matches"] : []) {
    const one = (item ?? {}) as Record<string, unknown>;
    const name = asked.get(text(one["category"]).toLowerCase());
    if (name === undefined) continue;
    const kind = text(one["kind"]);
    const why = text(one["why"]);
    if (kind === "transfer" || kind === "ignore") {
      matches.set(name, { kind, why });
      continue;
    }
    if (kind !== "account") continue;
    const account = chart.get(text(one["account"]).toLowerCase()) ?? sameAccount(text(one["account"]), typed);
    if (account === undefined) {
      problems.push(`"${name}": the suggested account "${text(one["account"])}" is not in your chart, so it is left for you.`);
      continue;
    }
    const direction = directionOf.get(name);
    if (!fitsDirection(direction, typeOf.get(account) ?? "")) {
      problems.push(
        `"${name}": ${account} was suggested, but it is money ${direction} and that is ${direction === "in" ? "an expense" : "an income"} account, so it is left for you.`,
      );
      continue;
    }
    matches.set(name, { kind: "account", account, why });
  }
  return { matches, problems };
}
