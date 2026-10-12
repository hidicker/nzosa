import type { IsoDate } from "./dates.js";
import type { Invoice, InvoiceLine } from "./invoices.js";
import type { Journal, JournalLine } from "./journals.js";

/**
 * Expense claims, read out of the accounting system's journals.
 *
 * Somebody pays for something themselves and claims it back. Approving the
 * claim books each cost and its GST, owed to them in Unpaid Expense Claims;
 * the repayment from the bank clears it. Xero exports neither as a document:
 * the invoices and bills exports leave claims out, and its Expense Claim
 * Detail report lists only what is still owed today. The journal report holds
 * every claim that reached the books, so they are taken from there -- each as
 * a bill from the person, owed in Unpaid Expense Claims rather than Accounts
 * Payable, so its repayment can be matched to it and its GST claimed like any
 * other bill's.
 *
 * Claims Xero reversed are left out with their reversal: it reposts a claim
 * by reversing it and entering it again, and both halves are in the report.
 */

const CLAIMS = /unpaid\s+expense\s+claims?/i;

/** Whether a journal line is on the claims account. */
function onClaims(line: JournalLine): boolean {
  return CLAIMS.test(line.accountName) || line.accountCode.trim() === "801";
}

function isGst(line: JournalLine): boolean {
  return /^\s*gst\s*$/i.test(line.accountName) || line.accountCode.trim() === "820";
}

/** "Reversed: Xero Demo - Reversal of ID 473": the id of the journal it undoes. */
function reverses(journal: Journal): string | null {
  return /reversal of id\s+(\S+)/i.exec(journal.narration)?.[1] ?? null;
}

/**
 * Whether an account carries GST, from the chart's treatment: true for a
 * standard-rated account, false for one with no GST, undefined when the chart
 * does not say.
 */
export type CarriesGst = (account: { accountCode: string; accountName: string }) => boolean | undefined;

/**
 * Each cost's share of the claim's GST, the last taking what rounding leaves.
 *
 * Shared over the costs whose account carries GST, when the chart says for
 * every one of them and at least one does: a no-GST cost beside a taxed one
 * must not be given GST it never had. Otherwise -- nothing said, or nothing
 * that could hold the GST -- spread over every cost in proportion, as before.
 */
function shareGst(costs: readonly JournalLine[], gst: number, carriesGst?: CarriesGst): number[] {
  const said = carriesGst === undefined ? [] : costs.map((cost) => carriesGst(cost));
  const known = said.length === costs.length && said.every((answer) => answer !== undefined);
  const taxed = known && said.some((answer) => answer === true) ? said.map((answer) => answer === true) : costs.map(() => true);
  // A GST figure larger than the taxed costs themselves is not theirs to hold.
  const taxedNet = costs.reduce((sum, cost, index) => (taxed[index] ? sum + cost.amount : sum), 0);
  const holds = taxed.every((t) => t) || (taxedNet !== 0 && Math.abs(gst) <= Math.abs(taxedNet) && Math.sign(gst) !== -Math.sign(taxedNet));
  const over = holds ? taxed : costs.map(() => true);
  const net = holds ? taxedNet : costs.reduce((sum, cost) => sum + cost.amount, 0);
  const last = over.lastIndexOf(true);

  let left = gst;
  return costs.map((cost, index) => {
    if (!over[index]) return 0;
    const tax = index === last ? left : Math.round((gst * cost.amount) / (net === 0 ? 1 : net));
    left -= tax;
    return tax;
  });
}

export function expenseClaimsFromJournals(
  journals: readonly Journal[],
  from?: IsoDate,
  carriesGst?: CarriesGst,
): Invoice[] {
  const undone = new Set<string>();
  for (const journal of journals) {
    const id = reverses(journal);
    if (id !== null) {
      undone.add(id);
      undone.add(journal.id);
    }
  }

  const claims: Invoice[] = [];
  const taken = new Set<string>();
  for (const journal of journals) {
    if (undone.has(journal.id)) continue;
    if (from !== undefined && journal.date < from) continue;
    // A claim credits the claims account; its repayment debits it.
    const owed = journal.lines.filter(onClaims).reduce((sum, l) => sum + l.amount, 0);
    if (owed >= 0) continue;
    const costs = journal.lines.filter((l) => !onClaims(l) && !isGst(l));
    const gst = journal.lines.filter(isGst).reduce((sum, l) => sum + l.amount, 0);
    const net = costs.reduce((sum, l) => sum + l.amount, 0);
    // Only an entry that is costs, their GST and the amount owed: a bank line
    // in it, or figures that do not add up, is not a claim this can say.
    if (costs.length === 0 || net + gst !== -owed) continue;

    // The journal gives the GST as one figure; it is shared across the costs
    // that carry GST in proportion (see shareGst).
    const shares = shareGst(costs, gst, carriesGst);
    const lines: InvoiceLine[] = costs.map((cost, index) => {
      const tax = shares[index] ?? 0;
      return {
        description: cost.description || journal.narration,
        accountCode: cost.accountCode,
        taxType: tax !== 0 ? "15% GST on Expenses" : "No GST",
        net: cost.amount,
        tax,
        gross: cost.amount + tax,
      };
    });

    const contact = journal.narration.trim() || "Expense claim";
    let number = `${contact}/${journal.date}`;
    for (let n = 2; taken.has(number); n += 1) number = `${contact}/${journal.date}-${n}`;
    taken.add(number);

    claims.push({
      number,
      kind: "purchase",
      contact,
      reference: "Expense claim",
      issued: journal.date,
      due: journal.date,
      total: -owed,
      tax: gst,
      // Nothing is said here about what has been repaid: that is the bank
      // lines matched to it, as for a bill entered in these books.
      paid: 0,
      outstanding: 0,
      currency: "NZD",
      status: "Awaiting Payment",
      lines,
      claim: true,
    });
  }
  return claims;
}
