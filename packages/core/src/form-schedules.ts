import type { Cents } from "./money.js";
import type { ProfitAndLoss } from "./reports.js";

/**
 * A tax form's lines, filled from a profit and loss.
 *
 * Every country sets out a rental or a small business on its own form -- the
 * United States' Schedule E and Schedule C, Australia's rental property
 * schedule -- but the work is the same: put each account's figure on the line
 * it belongs to, add up, say what is left. The forms differ only in their
 * lines and in which account names go on which, so a form is data (below) and
 * this is the one piece of code that fills any of them.
 *
 * An account goes on the first line whose rule its name matches; anything
 * matching none goes on the form's catch-all ("Other"). Every line lists the
 * accounts it was filled from, so a figure that landed on the wrong line can
 * be seen and moved -- a guess from an account's name is a starting point, not
 * a filing.
 */

export interface FormLineDefinition {
  id: string;
  /** As printed on the form, with its number: "12 Mortgage interest paid to banks, etc." */
  title: string;
  side: "income" | "expense";
  /**
   * The share of the expense the form allows: Schedule C allows half of
   * business meals. 1 where it is the whole amount.
   */
  share?: number;
  /** Cost of goods sold: an expense that comes off gross income rather than out of expenses. */
  costOfSales?: boolean;
}

export interface FormDefinition {
  id: string;
  title: string;
  /** In the order the form prints them. */
  lines: readonly FormLineDefinition[];
  /** Which line an account name goes on, checked in this order. */
  rules: readonly (readonly [lineId: string, match: RegExp])[];
  /** Where income and expenses that match no rule go. */
  otherIncome: string;
  otherExpense: string;
  /** Said under the form, every time. */
  notes?: readonly string[];
}

export interface FormScheduleLine {
  id: string;
  title: string;
  side: "income" | "expense";
  /** The whole amount, positive. */
  amount: Cents;
  /** What the form allows: the amount, or its share of it. */
  allowed: Cents;
  costOfSales: boolean;
  accounts: { code: string; name: string; amount: Cents }[];
}

export interface FormSchedule {
  form: string;
  title: string;
  lines: FormScheduleLine[];
  totalIncome: Cents;
  costOfSales: Cents;
  /** Expenses as allowed, cost of sales not included. */
  totalExpenses: Cents;
  net: Cents;
  notes: string[];
}

/** Which of the form's lines an account name goes on. */
export function formLineFor(form: FormDefinition, name: string, side: "income" | "expense"): string {
  const lower = name.toLowerCase();
  for (const [id, match] of form.rules) {
    const line = form.lines.find((one) => one.id === id);
    if (line !== undefined && line.side === side && match.test(lower)) return id;
  }
  return side === "income" ? form.otherIncome : form.otherExpense;
}

/**
 * Fill a form from a profit and loss. `nameOf` turns an account code into its
 * name; `lineOf`, where given, is a person's choice of line for an account,
 * which wins over the guess from its name.
 */
export function formSchedule(
  form: FormDefinition,
  report: ProfitAndLoss,
  nameOf: (code: string) => string = (code) => code,
  lineOf: (code: string) => string | undefined = () => undefined,
): FormSchedule {
  const lines: FormScheduleLine[] = form.lines.map((line) => ({
    id: line.id,
    title: line.title,
    side: line.side,
    amount: 0,
    allowed: 0,
    costOfSales: line.costOfSales === true,
    accounts: [],
  }));
  const byId = new Map(lines.map((line) => [line.id, line]));
  const place = (code: string, amount: Cents, side: "income" | "expense"): void => {
    if (amount === 0) return;
    const name = nameOf(code);
    const chosen = lineOf(code);
    const id = chosen !== undefined && byId.get(chosen)?.side === side ? chosen : formLineFor(form, name, side);
    const line = byId.get(id);
    if (line === undefined) return;
    line.amount += amount;
    line.accounts.push({ code, name, amount });
  };
  for (const line of report.income) place(line.code, line.net, "income");
  // A report holds an expense as money leaving, so negative; a form lists the
  // positive amount spent.
  for (const line of report.expenses) place(line.code, -line.net, "expense");

  for (const line of lines) {
    const share = form.lines.find((one) => one.id === line.id)?.share ?? 1;
    line.allowed = share === 1 ? line.amount : Math.round(line.amount * share);
  }
  const sum = (pick: (line: FormScheduleLine) => boolean): Cents =>
    lines.filter(pick).reduce((total, line) => total + line.allowed, 0);
  const totalIncome = sum((line) => line.side === "income");
  const costOfSales = sum((line) => line.side === "expense" && line.costOfSales);
  const totalExpenses = sum((line) => line.side === "expense" && !line.costOfSales);
  return {
    form: form.id,
    title: form.title,
    lines,
    totalIncome,
    costOfSales,
    totalExpenses,
    net: totalIncome - costOfSales - totalExpenses,
    notes: [...(form.notes ?? [])],
  };
}
