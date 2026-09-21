import { postedJournals } from "./books.js";
import { reportLookups } from "./daily/reports.js";
import { state } from "./state.js";
import { note } from "./ui.js";
import { emptyEntityModel, financialYearOf, formatAmount } from "@nzosa/core";

/**
 * A year-end review of the accounts, carried by hand.
 *
 * Not the coding queue. That asks about one transaction at a time and gets a
 * code back; this asks what a reviewer would ask at year end -- does the GST
 * add up, is anything in the wrong place, what is missing -- and gets prose
 * back, which nothing here can check. So nothing here pretends to: the answer
 * is shown as what it is, a draft for a person to read.
 *
 * It points the model at OpenAccountants, a library of tax guides written
 * against primary sources and reviewed by named, licensed accountants, served
 * over MCP. A model with that connected cites a guide and the accountant who
 * signed it off; a model without it answers from training data and cannot say
 * where the number came from. The difference matters more here than anywhere
 * else in this app, because this is the one place asking a question whose
 * answer is a judgement rather than a category.
 *
 * What goes in it is the shape of the year, not the year: account totals, the
 * entities and their registration, what is uncoded. Not a transaction list --
 * a reviewer does not need one to say "your motor vehicle expenses are 40% of
 * turnover and there is no logbook mentioned anywhere".
 */

export const OPENACCOUNTANTS_MCP = "https://www.openaccountants.com/api/mcp";
export const OPENACCOUNTANTS_CONNECT = "https://www.openaccountants.com/connect";

/** The New Zealand guides that library holds, so the model can name them. */
const NZ_GUIDES = [
  "nz-income-tax-ir3",
  "nz-gst-return",
  "nz-provisional-tax",
  "nz-acc-levies",
  "nz-capital-gains",
  "nz-tax-residency",
  "nz-timing-deductions-when-expense-incurred",
  "nz-motor-vehicle-expenses-logbook-business-use",
];

export function yearsInBooks(): number[] {
  return [...new Set(state.ledger.transactions.map((t) => financialYearOf(t.date)))].sort(
    (a, b) => b - a,
  );
}

function kindWords(kind: string | undefined): string {
  if (kind === "residential") return "residential rental (losses ring-fenced)";
  if (kind === "commercial") return "commercial rental";
  if (kind === "personal") return "personal affairs";
  return "business";
}

/**
 * The year, as totals, with what is not yet answered said out loud.
 *
 * The uncoded count is in it deliberately. A review of a year that is a third
 * uncoded is a review of a third of a year, and a reviewer told the figure can
 * say so; one not told will quietly reason from a profit that is not the
 * profit.
 */
export function reviewPrompt(year: number): string {
  const model = state.ledger.entities ?? emptyEntityModel();
  const { sectionOf } = reportLookups();
  const period = { from: `${year - 1}-04-01`, to: `${year}-03-31` };

  const totals = new Map<string, number>();
  let uncoded = 0;
  let uncodedGross = 0;
  // Only accounts the chart names, and never a bank one.
  //
  // A posted line's account is the chart code where there is one and the bank
  // account's own id where there is not -- so taking them all put a real bank
  // account number, in the shape 01-2345-0678901-000, into a prompt, which is
  // the one thing the panel that turns this on promises never leaves this
  // machine. That comment first quoted the number it found, which is how this
  // mistake gets made twice. A reviewer does not
  // need the number: what the bank holds is a balance, and the question here
  // is about the accounts it moved through.
  const chartCodes = new Map(
    state.chart
      .filter((account) => account.code.trim() !== "")
      .map((account) => [account.code.trim(), account]),
  );
  const named = new Map<string, string>();
  for (const journal of postedJournals()) {
    if (journal.date < period.from || journal.date > period.to) continue;
    for (const line of journal.lines) {
      const code = line.accountCode.trim();
      const account = chartCodes.get(code);
      if (account === undefined) continue;
      if (account.type.trim().toLowerCase() === "bank") continue;
      totals.set(code, (totals.get(code) ?? 0) + line.amount);
      if (!named.has(code)) named.set(code, account.name.trim() || line.accountName);
    }
  }
  for (const transaction of state.ledger.transactions) {
    if (transaction.date < period.from || transaction.date > period.to) continue;
    const override = (state.ledger.overrides ?? {})[transaction.id];
    if (override?.code === undefined || override.code === "") {
      uncoded += 1;
      uncodedGross += transaction.amount;
    }
  }

  const lines: string[] = [
    "You are reviewing a small New Zealand set of books at year end, as an accountant",
    "would before signing anything off.",
    "",
    "Use the OpenAccountants MCP connector for the rules rather than your training data:",
    `  ${OPENACCOUNTANTS_MCP}`,
    "Its New Zealand guides include " + NZ_GUIDES.join(", ") + ".",
    "Cite the guide, and the accountant who reviewed it, for every figure or rule you rely",
    "on. Where the connector is not available to you, say so plainly at the top of your",
    "answer rather than answering from memory as though it were.",
    "",
    "What to look for, in this order:",
    "- Anything in an account it does not belong in, and why you think so.",
    "- GST: whether the treatment on each account matches what the entity is registered",
    "  for, and anything claimed that cannot be.",
    "- Deductions that need something the books do not show -- a logbook, an",
    "  apportionment, a written agreement -- and say which.",
    "- Anything a residential rental's ring-fencing would change.",
    "- What is missing entirely: a category of cost this kind of business always has and",
    "  these books do not.",
    "",
    "Answer in plain English, shortest first, each point naming the account and the figure.",
    "Say what you are unsure of. This is a draft for a qualified person to review, not",
    "advice, and you should say so at the end.",
    "",
    `Financial year: 1 April ${year - 1} to 31 March ${year}.`,
    "",
    "Entities in these books:",
  ];

  for (const entity of model.entities) {
    lines.push(
      `- ${entity.name}: ${kindWords(entity.kind)}, ` +
        `${entity.gstRegistered === false ? "not GST registered" : "GST registered"}` +
        (entity.about ? `. ${entity.about}` : ""),
    );
  }

  lines.push("", "Account totals for the year:");
  const sorted = [...totals.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  for (const [code, amount] of sorted) {
    const where = sectionOf(code);
    lines.push(
      `- ${code} ${named.get(code) ?? ""}: ${formatAmount(amount)}` +
        (where === null ? "" : ` [${where}]`),
    );
  }

  if (uncoded > 0) {
    lines.push(
      "",
      `Not yet coded: ${uncoded} transactions, ${formatAmount(uncodedGross)} in total. Any`,
      "conclusion about profit or GST is short by whatever those turn out to be, and your",
      "answer should say so.",
    );
  }

  const registered = model.entities.some((e) => e.gstRegistered !== false);
  if (registered) {
    lines.push(
      "",
      "At least one entity is GST registered, so check the GST treatments against the",
      "nz-gst-return guide as well as the income tax ones.",
    );
  }

  return lines.join("\n");
}

/** The words this library asks to travel with anything made from it. */
export function reviewDisclaimer(): HTMLElement {
  return note(
    "Whatever comes back is a draft for a qualified person to review — not tax, legal or " +
      "accounting advice. It may be incomplete, out of date or wrong, and nothing should be " +
      "filed, paid or amended on the strength of it. That is OpenAccountants' own condition " +
      "on its guides, and it is this app's position too.",
  );
}

/** Whether there is anything to review at all. */
export function reviewPossible(): boolean {
  return state.ledger.transactions.length > 0 && state.chart.length > 0;
}
