import type { Account } from "./chart.js";
import type { GstClassification } from "./gst.js";
import type { Invoice } from "./invoices.js";
import { isPosted } from "./invoices.js";
import { outsidePaymentJournals } from "./bills.js";
import type { ManualJournal } from "./manual-journals.js";
import { postManualJournal } from "./manual-journals.js";
import {
  postInvoice,
  postTransaction,
  postTransfer,
  taxTypeFromRate,
} from "./posting.js";
import type { PostedJournal, PostingOptions } from "./posting.js";
import { splitAccountLabel } from "./chart-codes.js";
import type { Transaction } from "./types.js";

/**
 * The whole ledger, posted as double entry.
 *
 * Composition rather than arithmetic: each kind of entry already knows how to
 * post itself, and what this decides is which of them applies to a given line
 * and in what order the results are stacked. Three of those decisions are the
 * ones that go expensively wrong.
 *
 * **A settled invoice is not a fresh sale.** An invoiced sale is recorded when
 * the invoice is raised. If the receipt is then also coded to income, the same
 * money is counted twice -- on one real ledger that overstated income by a
 * third -- so a receipt matched to an invoice clears the debtor and touches
 * income not at all.
 *
 * **A transfer is one journal, not two.** Both legs are in the bank data.
 * Posted separately they are only right if both happen to be coded to the same
 * clearing account; posted as a pair there is no account in the middle at all.
 * So the pair is emitted once, from the leg the money left, and the other leg
 * is skipped.
 *
 * **Only an approved invoice is posted.** A draft, or a voided or deleted
 * invoice, is in the export but not in the books, and posting it records a sale
 * nobody made.
 *
 * **Judgements come last**, because they correct what everything above worked
 * out. An unbalanced one is refused rather than posted with the difference
 * hidden.
 */
export interface PostLedgerOptions {
  /** Transactions with splits already expanded into parts. */
  transactions: readonly Transaction[];
  codeOf: (transaction: Transaction) => string | null;
  classify: (transaction: Transaction) => GstClassification;
  chart: readonly Account[];
  /** The bank accounts by their own id, for naming a transfer's two ends. */
  bankLabels: ReadonlyMap<string, string>;
  /** Every transaction unexpanded, which is where a transfer's legs are found. */
  byId: ReadonlyMap<string, Transaction>;
  invoices: readonly Invoice[];
  /** Which transaction, or split part, settled which invoice. */
  settled: ReadonlyMap<string, string>;
  /** Each leg pointing at its partner; both directions are present. */
  transfers: Readonly<Record<string, string>>;
  manualJournals: readonly ManualJournal[];
  /** Depreciation and disposals, already posted. */
  assetJournals?: readonly PostedJournal[];
  /**
   * The receivable or payable a document sits in, when not the usual one.
   *
   * With several entities each keeps its own: a bill for the shop is the
   * shop's debt, and posted to one shared 800 it would sit in whichever
   * entity owns that account. Undefined falls back to 610 or 800.
   */
  controlFor?: (invoice: Invoice) => { code: string; name: string } | undefined;
  /** The books' GST account, where it is not 820. */
  gstAccount?: { code: string; name: string };
  /**
   * The GST account for a supply posted to a chart account, where it is not
   * the books' own: each entity's GST in that entity's control account.
   */
  gstAccountFor?: (accountCode: string) => { code: string; name: string } | undefined;
  /**
   * The day the books start. An invoice or bill dated before it is not
   * posted: its sale or cost is in a year the other system kept, and in the
   * opening retained earnings, and what was still owing on it is in the
   * opening receivables or payables. Posted again here, it counted twice.
   */
  startDate?: string;
}

export function postLedger(options: PostLedgerOptions): PostedJournal[] {
  const {
    transactions, codeOf, classify, chart, bankLabels, byId,
    invoices, settled, transfers, manualJournals,
  } = options;
  if (transactions.length === 0) return [];

  const byName = new Map(chart.map((a) => [a.name.trim().toLowerCase(), a]));
  // A document line or a payment names its account by the bare code, as an
  // imported invoice does. Found by the code too, or the journal carries
  // "473TSS" where the account's name belongs.
  const byCode = new Map(chart.filter((a) => a.code.trim() !== "").map((a) => [a.code.trim(), a]));
  const posting: PostingOptions = {
    resolveAccount: (code: string) => {
      const { code: digits, name } = splitAccountLabel(code);
      const account = byName.get(name.toLowerCase()) ?? byCode.get(digits.trim());
      if (account === undefined && digits === "") {
        // A code of letters, which Xero allows: "Charitable Donation -
        // Donation" is the account coded "Donation". Not split as a code, it
        // posted to no account at all, and the balance sheet, finding no
        // type for it, counted a donation as an asset.
        const dash = name.lastIndexOf(" - ");
        const lettered = dash < 0 ? undefined : byCode.get(name.slice(dash + 3).trim());
        if (lettered !== undefined && lettered.name.trim().toLowerCase() === name.slice(0, dash).trim().toLowerCase()) {
          return { code: lettered.code, name: lettered.name };
        }
      }
      return { code: digits || account?.code || "", name: account?.name ?? name };
    },
    nameBankAccount: (account: string) => bankLabels.get(account) ?? account,
    ...(options.gstAccount ? { gstAccountCode: options.gstAccount.code, gstAccountName: options.gstAccount.name } : {}),
    ...(options.gstAccountFor ? { gstAccountFor: options.gstAccountFor } : {}),
  };

  // A manual journal can name a bank account: a correction to what a card or
  // account holds, such as a refund the bank data never showed. It posts to
  // the ledger's own account, keyed as every bank line on that account is, so
  // the balance sheet reads one account -- not a second row under the chart's
  // name for it, beside the real one.
  //
  // Found before the label is split, because a bank account's number reads as
  // an account code to the splitter: "02-1234-0567890-001" would become code
  // 001. And only for journals: a bank line coded to another bank account is a
  // transfer question, which is answered where transfers are.
  const tidy = (text: string): string => text.trim().toLowerCase().replace(/\s+/g, " ");
  const bankIdFor = (label: string): string | null => {
    const wanted = label.trim();
    if (bankLabels.has(wanted)) return wanted;
    for (const [id, name] of bankLabels) if (tidy(name) === tidy(wanted)) return id;
    const account = chart.find(
      (a) => /bank/i.test(a.type) && tidy(a.name) === tidy(wanted),
    );
    const linked = account?.ledgerAccount?.trim() ?? "";
    return linked !== "" && linked.toLowerCase() !== "none" ? linked : null;
  };
  const journalPosting: PostingOptions = {
    ...posting,
    resolveAccount: (code: string) => {
      const bank = bankIdFor(code);
      if (bank !== null) return { code: bank, name: bankLabels.get(bank) ?? bank };
      return posting.resolveAccount?.(code) ?? { code, name: code };
    },
  };

  const byNumber = new Map(invoices.map((i) => [i.number, i]));

  // Each document's own control account, as posting options: the invoice
  // journal, its bank settlements and its other payments all name the same
  // one, or the balance would be raised in one account and cleared in another.
  const controlPosting = (invoice: Invoice): PostingOptions => {
    const control = options.controlFor?.(invoice);
    if (control === undefined) return posting;
    return invoice.kind === "sales"
      ? { ...posting, receivableCode: control.code, receivableName: control.name }
      : { ...posting, payableCode: control.code, payableName: control.name };
  };
  const controlOf = (invoice: Invoice): { code: string; name: string } => {
    const own = options.controlFor?.(invoice);
    if (own !== undefined) return own;
    return invoice.kind === "sales"
      ? { code: "610", name: "Accounts Receivable" }
      : { code: "800", name: "Accounts Payable" };
  };

  const transferJournals: PostedJournal[] = [];
  const postedAsTransfer = new Set<string>();
  for (const [legId, partnerId] of Object.entries(transfers)) {
    const leg = byId.get(legId);
    const partner = byId.get(partnerId);
    if (leg === undefined || partner === undefined) continue;
    // Both halves are recorded, so take the outgoing one and ignore its mirror.
    if (leg.amount >= 0) continue;
    transferJournals.push(postTransfer({ from: leg, to: partner }, posting));
    postedAsTransfer.add(leg.id);
    postedAsTransfer.add(partner.id);
  }

  const bank = transactions.flatMap((t) => {
    if (postedAsTransfer.has(t.id)) return [];
    const invoice = byNumber.get(settled.get(t.id) ?? "");
    if (invoice) {
      return [
        postTransaction(t, [], {
          ...controlPosting(invoice),
          settles: {
            number: invoice.number,
            kind: invoice.kind,
            taxType: taxTypeFromRate(invoice.lines[0]?.taxType ?? "", invoice.kind),
            total: invoice.total,
          },
        }),
      ];
    }
    return [
      postTransaction(
        t,
        [{ amount: t.amount, code: codeOf(t), classification: classify(t) }],
        posting,
      ),
    ];
  });

  return [
    ...bank,
    ...transferJournals,
    ...invoices
      .filter((invoice) => isPosted(invoice) && (options.startDate === undefined || invoice.issued >= options.startDate))
      .map((invoice) => postInvoice(invoice, controlPosting(invoice))),
    ...invoices.flatMap((invoice) =>
      outsidePaymentJournals(
        options.startDate === undefined
          ? invoice
          : { ...invoice, paidOutside: (invoice.paidOutside ?? []).filter((p) => p.date >= options.startDate!) },
        {
        control: controlOf(invoice),
        ...(posting.resolveAccount ? { resolveAccount: posting.resolveAccount } : {}),
        },
      ),
    ),
    ...(options.assetJournals ?? []),
    ...manualJournals
      .map((journal) => postManualJournal(journal, journalPosting))
      .filter((journal): journal is PostedJournal => journal !== null),
  ];
}
