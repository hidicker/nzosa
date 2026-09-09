import { readFileSync } from "node:fs";
import {
  allocateAcrossLines,
  formatAmount,
  invoiceGross,
  parseXeroAllocations,
  parseXeroInvoices,
  validateInvoices,
} from "@nzosa/core";
import type { Invoice, PaymentAllocation, SplitPart, Transaction } from "@nzosa/core";
import { loadLedger, saveLedger } from "./ledger.js";
import { readExport } from "./spreadsheet.js";
import type { MatchProposal } from "./ledger.js";
import { matchInvoices as matchInvoicesCore } from "@nzosa/core";

/**
 * Invoices: importing them, matching them to money, and using them to code it.
 *
 * The invoice is what turns a bank receipt into a coded, GST-treated line
 * without inference. Matching is deliberately conservative -- an invoice is
 * linked to a receipt only when the amounts agree exactly and the dates are
 * plausible, because a wrong link would code real money to the wrong place and
 * do so silently.
 */

export interface InvoiceOptions {
  ledger: string;
  /** Path to a Xero sales-invoice CSV export. */
  importPath: string | undefined;
  /** Path to an Account Transactions CSV, for payment allocations. */
  allocationsPath: string | undefined;
  list: boolean;
  /** Match invoices to ledger transactions and report. */
  match: boolean;
  /** Write the matched invoices' coding onto the transactions. */
  apply: boolean;
  /**
   * Accept a proposed near-match by id, creating its adjustment.
   *
   * There is deliberately no "accept everything" switch. Each write-off is a
   * separate decision about real money.
   */
  accept: string | undefined;
  /** The largest difference that will be proposed at all, in dollars. */
  tolerance: number;
  json: boolean;
}

/** How many days after issue a payment is still plausibly for that invoice. */
const WINDOW_DAYS = 120;

export async function runInvoices(options: InvoiceOptions): Promise<number> {
  const ledger = loadLedger(options.ledger);
  let invoices = ledger.invoices ?? [];

  if (options.importPath !== undefined) {
    const parsed = parseXeroInvoices(await readExport(options.importPath));

    for (const problem of parsed.problems) {
      process.stderr.write(`  ${problem.number || "(file)"}: ${problem.message}\n`);
    }
    if (parsed.invoices.length === 0) {
      process.stderr.write("No invoices read.\n");
      return 1;
    }

    // Re-importing replaces an invoice rather than duplicating it: the number
    // is its identity, and a later export is a more current view of it.
    const merged = new Map(invoices.map((invoice) => [`${invoice.kind}:${invoice.number}`, invoice]));
    for (const invoice of parsed.invoices) merged.set(`${invoice.kind}:${invoice.number}`, invoice);
    invoices = [...merged.values()];

    saveLedger(options.ledger, { ...ledger, invoices });
    process.stdout.write(
      `Read ${parsed.invoices.length} invoices ` +
        `(${parsed.invoices.reduce((n, i) => n + i.lines.length, 0)} lines), ` +
        `${parsed.problems.length} problem(s). Ledger now holds ${invoices.length}.\n`,
    );
  }

  if (options.allocationsPath !== undefined) {
    const parsed = parseXeroAllocations(await readExport(options.allocationsPath));
    for (const problem of parsed.problems) {
      process.stderr.write(`  ${problem.number || "(file)"}: ${problem.message}\n`);
    }
    ledger.allocations = parsed.allocations;
    saveLedger(options.ledger, { ...ledger, invoices, allocations: parsed.allocations });

    const multi = new Map<string, number>();
    for (const a of parsed.allocations) multi.set(a.invoiceNumber, (multi.get(a.invoiceNumber) ?? 0) + 1);
    process.stdout.write(
      `Read ${parsed.allocations.length} payment allocations across ` +
        `${multi.size} invoices; ${[...multi.values()].filter((n) => n > 1).length} were paid in instalments.\n`,
    );
  }

  if (invoices.length === 0) {
    process.stdout.write('No invoices. Use "--import <file>" to load a Xero export.\n');
    return 0;
  }

  if (options.accept !== undefined) return acceptProposal(options, ledger);
  if (options.list) return listInvoices(invoices, options.json);
  if (options.match || options.apply) return matchInvoices(options, ledger, invoices);

  const problems = validateInvoices(invoices);
  process.stdout.write(
    `${invoices.length} invoices, ` +
      `${invoices.reduce((n, i) => n + i.lines.length, 0)} lines, ` +
      `${problems.length} problem(s).\n`,
  );
  return problems.length === 0 ? 0 : 1;
}

/**
 * Accept one proposed near-match, creating the write-off it needs.
 *
 * Splitting the receipt into the invoiced amount plus the difference keeps the
 * parts summing to what the bank reported, so the reconciliation still holds.
 */
function acceptProposal(options: InvoiceOptions, ledger: ReturnType<typeof loadLedger>): number {
  const proposals = ledger.proposals ?? [];
  const proposal = proposals.find((p) => p.id === options.accept);

  if (!proposal) {
    process.stderr.write(
      `No proposal ${options.accept}. Run "--match" to see what is pending.\n`,
    );
    return 2;
  }

  const transaction = ledger.transactions.find((t) => t.id === proposal.transactionId);
  if (!transaction) {
    process.stderr.write(`Proposal ${proposal.id} refers to a transaction no longer here.\n`);
    return 2;
  }

  const splits = { ...(ledger.splits ?? {}) };
  splits[transaction.id] = [
    {
      amount: proposal.invoiceAmount,
      code: "Accounts Receivable",
      treatment: "standard",
      note: `${proposal.invoiceNumber}: amount invoiced`,
    },
    {
      amount: proposal.adjustment,
      code: "Rounding",
      treatment: "out-of-scope",
      side: "none",
      note: `Adjustment accepted against ${proposal.invoiceNumber}`,
    },
  ];

  saveLedger(options.ledger, {
    ...ledger,
    splits,
    proposals: proposals.filter((p) => p.id !== proposal.id),
  });

  process.stdout.write(
    `Accepted ${proposal.id}: ${formatAmount(proposal.bankAmount)} banked against ` +
      `${proposal.invoiceNumber} (${formatAmount(proposal.invoiceAmount)}), ` +
      `writing off ${formatAmount(proposal.adjustment)}.\n`,
  );
  return 0;
}

function listInvoices(invoices: readonly Invoice[], json: boolean): number {
  if (json) {
    process.stdout.write(`${JSON.stringify(invoices, null, 2)}\n`);
    return 0;
  }

  const sorted = [...invoices].sort((a, b) => a.issued.localeCompare(b.issued));
  process.stdout.write(
    `${"NUMBER".padEnd(12)}${"ISSUED".padEnd(12)}${"TOTAL".padStart(12)}` +
      `${"GST".padStart(11)}${"PAID".padStart(12)}  ${"STATUS".padEnd(18)}CONTACT\n`,
  );
  for (const invoice of sorted) {
    process.stdout.write(
      `${invoice.number.padEnd(12)}${invoice.issued.padEnd(12)}` +
        `${formatAmount(invoice.total, invoice.currency).padStart(12)}` +
        `${formatAmount(invoice.tax, invoice.currency).padStart(11)}` +
        `${formatAmount(invoice.paid, invoice.currency).padStart(12)}  ` +
        `${invoice.status.padEnd(18)}${invoice.contact.slice(0, 28)}\n`,
    );
  }
  process.stdout.write(`\n${sorted.length} invoices\n`);
  return 0;
}


function matchInvoices(
  options: InvoiceOptions,
  ledger: ReturnType<typeof loadLedger>,
  invoices: readonly Invoice[],
): number {
  // The matching itself lives in core, so the command line and the browser
  // reach the same answer from the same evidence rather than each having their
  // own idea of what counts as a match.
  const { matched: matches, unmatched, proposals } = matchInvoicesCore({
    invoices,
    transactions: ledger.transactions,
    ...(ledger.allocations ? { allocations: ledger.allocations } : {}),
    tolerance: Math.round(options.tolerance * 100),
  });

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          matched: matches.map((m) => ({
            invoice: m.invoice.number, how: m.how,
            transactions: m.transactions.map((t) => ({ id: t.id, date: t.date, amount: t.amount })),
          })),
          unmatched: unmatched.map((i) => ({ number: i.number, total: i.total, paid: i.paid })),
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  }

  const single = matches.filter((m) => m.how === "single receipt").length;
  const staged = matches.length - single;

  process.stdout.write(`${single} invoices matched to one receipt\n`);
  process.stdout.write(`${staged} matched to a set of instalments\n`);
  process.stdout.write(`${unmatched.length} not matched\n\n`);

  for (const m of matches.filter((x) => x.how === "instalments").slice(0, 8)) {
    process.stdout.write(
      `   ${m.invoice.number.padEnd(11)}${formatAmount(m.invoice.total).padStart(10)} = ` +
        m.transactions.map((t) => `${formatAmount(t.amount)} (${t.date})`).join(" + ") +
        `  ${m.invoice.contact.slice(0, 20)}\n`,
    );
  }
  if (staged > 0) process.stdout.write("\n");

  const unmatchedPaid = unmatched.reduce((n, i) => n + i.paid, 0);
  if (unmatched.length > 0) {
    process.stdout.write(
      "Unmatched invoices are usually paid in instalments, settled through a\n" +
        "processor net of fees, or banked outside these accounts. Largest first:\n",
    );
    for (const invoice of [...unmatched].sort((a, b) => b.paid - a.paid).slice(0, 10)) {
      process.stdout.write(
        `   ${invoice.number.padEnd(11)}${invoice.issued}  ` +
          `total ${formatAmount(invoice.total).padStart(10)}  ` +
          `paid ${formatAmount(invoice.paid).padStart(10)}  ${invoice.contact.slice(0, 24)}\n`,
      );
    }
    process.stdout.write(`   ${formatAmount(unmatchedPaid).padStart(52)} paid across all of them\n\n`);
  }

  if (proposals.length > 0) {
    saveLedger(options.ledger, { ...ledger, proposals });
    process.stdout.write(
      `${proposals.length} receipt(s) are close to an invoice but not equal to it.\n` +
        "Closing each gap means writing money off, so none has been applied:\n\n",
    );
    for (const p of proposals.slice(0, 10)) {
      process.stdout.write(
        `   ${p.id.padEnd(26)} banked ${formatAmount(p.bankAmount).padStart(10)} ` +
          `against ${formatAmount(p.invoiceAmount).padStart(10)}  ` +
          `write off ${formatAmount(p.adjustment).padStart(8)}\n`,
      );
    }
    if (proposals.length > 10) {
      process.stdout.write(`   ... and ${proposals.length - 10} more\n`);
    }
    process.stdout.write(
      '\nAccept one with "nzosa invoices --accept <id>". There is deliberately\n' +
        "no accept-all: each is a separate decision about real money.\n\n",
    );
  }

  if (!options.apply) {
    process.stdout.write('Run again with "--apply" to code the matched receipts from their invoices.\n');
    return 0;
  }

  const splits = { ...(ledger.splits ?? {}) };
  let coded = 0;

  for (const match of matches) {
    for (const transaction of match.transactions) {
      if (splits[transaction.id]) continue;
      const parts = invoiceParts(match.invoice, transaction.amount);
      if (parts.length < 2) continue;
      splits[transaction.id] = parts;
      coded += 1;
    }
  }

  saveLedger(options.ledger, { ...ledger, splits });
  process.stdout.write(`Coded ${coded} receipt(s) from their invoice lines.\n`);
  return 0;
}

/**
 * Turn an invoice's lines into split parts for a payment.
 *
 * Lines sharing a code and tax treatment are merged, because splitting a
 * receipt into two parts that are treated identically adds noise without
 * adding information.
 */
function invoiceParts(invoice: Invoice, payment: number): SplitPart[] {
  const allocation = allocateAcrossLines(invoice, payment);
  const merged = new Map<string, SplitPart>();

  for (const { line, amount } of allocation) {
    // Terms and conditions arrive as an invoice line with no amount. It is
    // text, not an accounting line, and turning it into a 0.00 split part just
    // puts an empty row in every report the payment appears in.
    if (line.gross === 0 && amount === 0) continue;

    const zeroRated = /zero/i.test(line.taxType);
    const noGst = /no gst|exempt/i.test(line.taxType);
    const treatment = noGst ? "out-of-scope" : zeroRated ? "zero-rated" : "standard";
    const key = `${line.accountCode}|${treatment}`;

    const existing = merged.get(key);
    if (existing) {
      existing.amount += amount;
      continue;
    }
    merged.set(key, {
      amount,
      code: line.accountCode,
      treatment,
      note: `${invoice.number}: ${line.description.slice(0, 60)}`,
    });
  }

  const parts = [...merged.values()];
  const drift = payment - parts.reduce((sum, part) => sum + part.amount, 0);
  const last = parts[parts.length - 1];
  if (last && drift !== 0) last.amount += drift;
  return parts;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Exported for the summary line elsewhere. */
export function invoiceTotal(invoice: Invoice): number {
  return invoiceGross(invoice);
}
