import type { Cents } from "./money.js";

/**
 * A property manager's statement, read by a model.
 *
 * Managers' statements come as PDFs laid out however their software lays them
 * out -- a month-by-month grid, a list of transactions, a year-end summary --
 * so a model reads them, the way it reads myIR's income details: the person
 * carries the PDF and the prompt to one they use, or sends it from here under
 * their own key. The answer is a fixed JSON shape, one statement per property.
 *
 * Nothing here posts anything. What is read becomes a draft in the statement
 * editor, with each line's account worked out from what kind of line it is,
 * for the person to check against the PDF and save -- where the editor's own
 * rule applies: it is not saved until it adds up.
 */

/** The kinds of line, each with the account (by its standard code) it goes to. */
export const AGENT_INCOME_KINDS: readonly (readonly [string, string, string])[] = [
  ["rent", "Rent collected from the tenant", "200"],
  ["reimbursement", "Reimbursements from the tenant, such as water", "200"],
  ["other", "Any other money collected for the owner, such as an insurance payout", "260"],
];

export const AGENT_EXPENSE_KINDS: readonly (readonly [string, string, string])[] = [
  ["management", "Management, letting, inspection, admin, advertising and supervision fees", "450"],
  ["gst", "GST charged on the manager's fees, where it is shown separately", "450"],
  ["repairs", "Repairs and maintenance: tradespeople, plumbing, renovations, materials", "473"],
  ["rates", "Rates and water rates", "420"],
  ["insurance", "Insurance", "433"],
  ["legal", "Legal fees, Tenancy Tribunal fees", "441"],
  ["other", "Anything else paid out for the property", "429"],
];

export function agentStatementPrompt(): string {
  return [
    "The attached PDF is a New Zealand property manager's statement for a rental owner: what the",
    "manager collected for each property, what they paid out of it, and what they paid to the",
    "owner. Read it and reply with one JSON object and nothing else -- no explanation, no code fence.",
    "",
    "Money is a number in dollars and cents, without $ or commas: 12345.67, not \"$12,345.67\".",
    "Do not include bank account numbers or the owner's address.",
    "",
    "The object has these keys:",
    '  "agent": the property manager\'s business name, as printed',
    '  "statements": an array, one object per property, with keys:',
    '    "property": the property\'s address, as printed',
    '    "from": the first day the statement covers, as YYYY-MM-DD',
    '    "to": the last day it covers, as YYYY-MM-DD',
    '    "openingBalance": what the manager held for the owner at the start (0 if none shown)',
    '    "income": an array of what was collected, totals for the whole period, each with',
    '      "kind": one of ' + AGENT_INCOME_KINDS.map(([k]) => `"${k}"`).join(", ") + ", being:",
    ...AGENT_INCOME_KINDS.map(([k, what]) => `        "${k}": ${what}`),
    '      "description": the statement\'s own name for it',
    '      "amount": the total',
    '    "expenses": an array of what was paid out of it, totals for the whole period, each with',
    '      "kind": one of ' + AGENT_EXPENSE_KINDS.map(([k]) => `"${k}"`).join(", ") + ", being:",
    ...AGENT_EXPENSE_KINDS.map(([k, what]) => `        "${k}": ${what}`),
    '      "description": the statement\'s own name for it',
    '      "amount": the total, including any GST in it',
    '    "paidToOwner": the total paid to the owner in the period',
    '    "closingBalance": what the manager held for the owner at the end (0 if none shown)',
    "",
    "One line per fee or cost the statement names (management fee, inspection fee, plumbing...),",
    "not one per month. Where the fees are shown before GST and the GST separately, give the GST",
    'as its own line of kind "gst".',
    "",
    "The figures must balance: openingBalance + income - expenses - paidToOwner = closingBalance.",
    "Some statements have columns whose meaning is not labelled clearly; use that balance to work",
    "out which side of it a column belongs on. Copy each figure exactly as printed.",
  ].join("\n");
}

export interface ReadAgentLine {
  kind: string;
  description: string;
  amount: Cents;
  /** The standard account code the line goes to: `200`, `450`. */
  base: string;
}

export interface ReadAgentStatement {
  agent: string;
  property: string;
  from: string;
  to: string;
  heldAtStart: Cents;
  income: ReadAgentLine[];
  expenses: ReadAgentLine[];
  paidToOwner: Cents;
  heldAtEnd: Cents;
  /** Closing balance less what the lines make it; zero when it adds up. */
  difference: Cents;
}

function toCents(value: unknown): Cents | null {
  const n =
    typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/[$,\s]/g, "")) : NaN;
  return Number.isFinite(n) ? (Math.round(n * 100) as Cents) : null;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const money = (cents: number): string => (cents / 100).toFixed(2);

/**
 * Read a model's answer: one statement per property. A statement that does
 * not add up is still returned, with its difference, so it can be corrected
 * in the editor; one that cannot be read at all is a problem.
 */
export function readAgentStatements(text: string): { statements: ReadAgentStatement[]; problems: string[] } {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return { statements: [], problems: ["There is no JSON object in that answer."] };
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return { statements: [], problems: ["That answer is not valid JSON."] };
  }
  const problems: string[] = [];
  const agent = String(raw["agent"] ?? "").trim().slice(0, 80);
  const listed = Array.isArray(raw["statements"]) ? (raw["statements"] as unknown[]) : [];
  const statements: ReadAgentStatement[] = [];

  const lines = (
    value: unknown,
    kinds: readonly (readonly [string, string, string])[],
    where: string,
  ): ReadAgentLine[] => {
    const out: ReadAgentLine[] = [];
    const bases = new Map(kinds.map(([k, , base]) => [k, base]));
    for (const item of Array.isArray(value) ? value : []) {
      if (typeof item !== "object" || item === null) continue;
      const one = item as Record<string, unknown>;
      const amount = toCents(one["amount"]);
      const description = String(one["description"] ?? "").trim().slice(0, 80);
      if (amount === null) {
        problems.push(`${where}: "${description || "a line"}" has no readable amount.`);
        continue;
      }
      if (amount === 0) continue;
      const kind = String(one["kind"] ?? "other").toLowerCase();
      out.push({
        kind: bases.has(kind) ? kind : "other",
        description: description || kind,
        amount,
        base: bases.get(kind) ?? bases.get("other") ?? "429",
      });
    }
    return out;
  };

  listed.forEach((item, index) => {
    if (typeof item !== "object" || item === null) return;
    const one = item as Record<string, unknown>;
    const property = String(one["property"] ?? "").trim().slice(0, 120);
    const where = property || `Statement ${index + 1}`;
    const from = String(one["from"] ?? "");
    const to = String(one["to"] ?? "");
    if (!ISO.test(from) || !ISO.test(to)) {
      problems.push(`${where}: the period is missing or not YYYY-MM-DD.`);
      return;
    }
    const heldAtStart = toCents(one["openingBalance"] ?? 0) ?? 0;
    const heldAtEnd = toCents(one["closingBalance"] ?? 0) ?? 0;
    const paidToOwner = toCents(one["paidToOwner"]);
    if (paidToOwner === null) {
      problems.push(`${where}: what was paid to the owner is missing.`);
      return;
    }
    const income = lines(one["income"], AGENT_INCOME_KINDS, where);
    const expenses = lines(one["expenses"], AGENT_EXPENSE_KINDS, where);
    const collected = income.reduce((s, l) => s + l.amount, 0);
    const paidOut = expenses.reduce((s, l) => s + l.amount, 0);
    const difference = heldAtEnd - (heldAtStart + collected - paidOut - paidToOwner);
    if (difference !== 0) {
      problems.push(
        `${where}: it does not add up. ${money(heldAtStart)} held at the start, plus ${money(collected)} ` +
          `collected, less ${money(paidOut)} paid out and ${money(paidToOwner)} paid to the owner, leaves ` +
          `${money(heldAtEnd - difference)}, and the statement says ${money(heldAtEnd)} is held at the end.`,
      );
    }
    statements.push({ agent, property, from, to, heldAtStart, income, expenses, paidToOwner, heldAtEnd, difference });
  });
  if (statements.length === 0 && problems.length === 0) problems.push("No statements were read.");
  return { statements, problems };
}

/**
 * Which of the rentals a statement's address is: the one whose name shares a
 * word with it ("12A Kowhai Avenue, Ridgeview" is Kowhai Avenue), or
 * null where none does or more than one does.
 */
export function propertyForAddress<T extends { id: string; name: string }>(address: string, rentals: readonly T[]): T | null {
  const words = (s: string): string[] =>
    s
      .toUpperCase()
      .split(/[^A-Z0-9]+/)
      .filter((w) => w.length > 2 && !["STREET", "AVENUE", "ROAD", "THE", "AND", "DRIVE", "PLACE", "LANE", "CRESCENT"].includes(w));
  const said = new Set(words(address));
  const matched = rentals.filter((r) => words(r.name).some((w) => said.has(w)));
  return matched.length === 1 ? (matched[0] ?? null) : null;
}
