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

export function expenseClaimsFromJournals(
  journals: readonly Journal[],
  from?: IsoDate,
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
    // in proportion, the last taking what rounding leaves.
    let left = gst;
    const lines: InvoiceLine[] = costs.map((cost, index) => {
      const tax = index === costs.length - 1 ? left : Math.round((gst * cost.amount) / (net === 0 ? 1 : net));
      left -= tax;
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
