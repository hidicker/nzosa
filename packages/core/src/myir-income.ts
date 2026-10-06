import type { Cents } from "./money.js";
import type { TaxExtra, TaxExtraCategory, TaxExtraDetail } from "./reports.js";

/**
 * myIR's "Income from myIR": the income Inland Revenue was told about for a
 * person's year, payer by payer, with the tax taken from each.
 *
 * Employers, banks, share registries, KiwiSaver and other PIE providers,
 * Maori authorities and anyone paying schedular payments all report to
 * Inland Revenue, and this is that, for the year -- exactly what an IR3 needs
 * from outside the books. What it leaves out it says: business and rental
 * income, which the books supply.
 *
 * It comes as a PDF only, so a model reads it, as it reads a filed return:
 * the person carries the PDF and the prompt to one they use, or sends it from
 * here under their own key. The answer is a fixed JSON shape, and nothing is
 * kept until its lines add up to the totals myIR prints on its first page.
 */

/** The kinds of income myIR lists, each as the answer names it. */
export const MYIR_INCOME_KINDS: readonly (readonly [string, string, TaxExtraCategory])[] = [
  ["salary", "Salary, wages, benefits and taxable pensions (PAYE income), including ACC and NZ Super", "salary"],
  ["schedular", "Schedular payments (withholding tax on contract or other schedular work)", "other"],
  ["interest", "New Zealand interest received", "interest"],
  ["dividends", "Dividends, and dividends treated as interest", "dividends"],
  ["pie", "Portfolio investment entity (PIE) income: KiwiSaver, managed funds", "pie"],
  ["maori", "Maori authority distributions", "other"],
  ["other", "Any other income type myIR lists", "other"],
];

export function myirIncomePrompt(): string {
  return [
    "The attached PDF is \"Income from myIR\" for one New Zealand financial year: the income",
    "Inland Revenue holds for a person, payer by payer. Read it and reply with one JSON object",
    "and nothing else -- no explanation, no code fence.",
    "",
    "Money is a number in dollars and cents, without $ or commas: 12345.67, not \"$12,345.67\".",
    "Do not include the IRD number or the person's name. Payers' names are wanted.",
    "",
    "The object has these keys:",
    '  "from": the first day of the period the income is for, as YYYY-MM-DD',
    '  "to": the last day, as YYYY-MM-DD',
    '  "totalIncome": the total income printed on the first page',
    '  "totalDeductions": the total deductions printed on the first page',
    '  "lines": an array, one object per payer per kind of income (their own totals for the',
    "    period, not each month), with keys:",
    '    "kind": one of ' + MYIR_INCOME_KINDS.map(([k]) => `"${k}"`).join(", ") + ", being:",
    ...MYIR_INCOME_KINDS.map(([k, what]) => `      "${k}": ${what}`),
    '    "payer": the payer, as printed',
    '    "gross": the gross amount',
    '    "tax": the tax deducted from it: PAYE, RWT, withholding tax or PIE tax',
    '    "imputation": imputation credits, for dividends only',
    '    "note": anything else the line says that matters, such as the income type\'s own',
    "      name for an \"other\" line, or earnings not liable for ACC; otherwise leave it out",
    '    "details": the dated amounts listed under that payer, each with "date" (YYYY-MM-DD),',
    '      "gross", "tax" and, for dividends, "imputation"',
    "",
    "Copy each figure exactly as printed. If something is unreadable, leave its key out.",
  ].join("\n");
}

export interface MyirIncomeLine {
  kind: string;
  category: TaxExtraCategory;
  payer: string;
  gross: Cents;
  credits: Cents;
  imputation?: Cents;
  note?: string;
  details?: TaxExtraDetail[];
}

export interface MyirIncome {
  from: string;
  to: string;
  /** The financial year, by the year it ends in. */
  year: number;
  totalIncome: Cents;
  totalDeductions: Cents;
  lines: MyirIncomeLine[];
}

function toCents(value: unknown): Cents | null {
  const n =
    typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/[$,\s]/g, "")) : NaN;
  return Number.isFinite(n) ? (Math.round(n * 100) as Cents) : null;
}

function money(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Read a model's answer, and check it adds up to myIR's own totals. */
export function readMyirIncome(text: string): { income?: MyirIncome; problems: string[] } {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return { problems: ["There is no JSON object in that answer."] };
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return { problems: ["That answer is not valid JSON."] };
  }
  const problems: string[] = [];
  const from = String(raw["from"] ?? "");
  const to = String(raw["to"] ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) problems.push("The period's last day is missing or not YYYY-MM-DD.");
  const totalIncome = toCents(raw["totalIncome"]);
  const totalDeductions = toCents(raw["totalDeductions"]);
  if (totalIncome === null) problems.push("The total income is missing.");
  if (totalDeductions === null) problems.push("The total deductions are missing.");

  const kinds = new Map(MYIR_INCOME_KINDS.map(([k, , category]) => [k, category]));
  const lines: MyirIncomeLine[] = [];
  const listed = Array.isArray(raw["lines"]) ? (raw["lines"] as unknown[]) : [];
  listed.forEach((item, index) => {
    if (typeof item !== "object" || item === null) return;
    const one = item as Record<string, unknown>;
    const where = `Line ${index + 1}`;
    const kind = String(one["kind"] ?? "other").toLowerCase();
    const category = kinds.get(kind) ?? "other";
    const gross = toCents(one["gross"]);
    const credits = toCents(one["tax"] ?? 0);
    const imputation = one["imputation"] === undefined || one["imputation"] === null ? null : toCents(one["imputation"]);
    if (gross === null || credits === null) {
      problems.push(`${where}: its gross or its tax is not an amount.`);
      return;
    }
    const payer = String(one["payer"] ?? "").trim().slice(0, 80) || "(payer not given)";
    const said = typeof one["note"] === "string" ? one["note"].trim().slice(0, 120) : "";
    // The kind is kept in the note where the category is broader than it:
    // schedular payments and Maori authority distributions are both "other".
    const named =
      kind === "schedular"
        ? "Schedular payments"
        : kind === "maori"
          ? "Maori authority distribution"
          : kinds.has(kind)
            ? ""
            : kind;
    const note = [named, said].filter((s) => s !== "").join("; ");

    // The dated amounts under the payer, where given: each has to be readable,
    // and together they have to make the payer's totals, or they are not kept.
    const details: TaxExtraDetail[] = [];
    const rawDetails = Array.isArray(one["details"]) ? (one["details"] as unknown[]) : [];
    for (const d of rawDetails) {
      if (typeof d !== "object" || d === null) continue;
      const entry = d as Record<string, unknown>;
      const date = String(entry["date"] ?? "");
      const g = toCents(entry["gross"]);
      const t = toCents(entry["tax"] ?? 0);
      const imp = entry["imputation"] === undefined || entry["imputation"] === null ? null : toCents(entry["imputation"]);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || g === null || t === null) {
        problems.push(`${where} (${payer}): a dated amount is not readable.`);
        continue;
      }
      details.push({ date, gross: g, credits: t, ...(imp !== null && imp !== 0 ? { imputation: imp } : {}) });
    }
    if (details.length > 0) {
      const dg = details.reduce((s, d) => s + d.gross, 0);
      const dt = details.reduce((s, d) => s + d.credits, 0);
      if (Math.abs(dg - gross) > 1 || Math.abs(dt - credits) > 1) {
        problems.push(
          `${where} (${payer}): the dated amounts come to ${money(dg)} gross and ${money(dt)} tax, ` +
            `and the payer's totals are ${money(gross)} and ${money(credits)}.`,
        );
      }
    }
    lines.push({
      kind,
      category,
      payer,
      gross,
      credits,
      ...(imputation !== null && imputation !== 0 ? { imputation } : {}),
      ...(note !== "" ? { note } : {}),
      ...(details.length > 0 ? { details } : {}),
    });
  });
  if (lines.length === 0) problems.push("No income lines were read.");
  if (problems.length > 0 || totalIncome === null || totalDeductions === null) return { problems };

  // myIR's first page totals every line: income, and every deduction
  // including imputation credits. A line misread shows here.
  const income = lines.reduce((s, l) => s + l.gross, 0);
  const deductions = lines.reduce((s, l) => s + l.credits + (l.imputation ?? 0), 0);
  if (Math.abs(income - totalIncome) > 1) {
    problems.push(`The lines' income comes to ${money(income)}, and myIR's total is ${money(totalIncome)}.`);
  }
  if (Math.abs(deductions - totalDeductions) > 1) {
    problems.push(`The lines' deductions come to ${money(deductions)}, and myIR's total is ${money(totalDeductions)}.`);
  }
  if (problems.length > 0) return { problems };

  const year = Number(to.slice(0, 4)) + (to.slice(5) > "03-31" ? 1 : 0);
  return { income: { from, to, year, totalIncome, totalDeductions, lines }, problems: [] };
}

/** The lines as income for a person's return, marked as from myIR. */
export const MYIR_NOTE = "From myIR income details";

export function myirTaxExtras(income: MyirIncome, owner: string): TaxExtra[] {
  return income.lines.map((line) => ({
    owner,
    year: income.year,
    category: line.category,
    payer: line.payer,
    gross: line.gross,
    credits: line.credits,
    ...(line.imputation !== undefined ? { imputation: line.imputation } : {}),
    note: line.note === undefined ? MYIR_NOTE : `${MYIR_NOTE}: ${line.note}`,
    ...(line.details !== undefined ? { details: line.details } : {}),
  }));
}
