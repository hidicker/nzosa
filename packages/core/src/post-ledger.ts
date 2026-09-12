import type { Account } from "./chart.js";
import type { GstClassification } from "./gst.js";
import type { Invoice } from "./invoices.js";
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
}

export function postLedger(options: PostLedgerOptions): PostedJournal[] {
  const {
    transactions, codeOf, classify, chart, bankLabels, byId,
    invoices, settled, transfers, manualJournals,
  } = options;
  if (transactions.length === 0) return [];

  const byName = new Map(chart.map((a) => [a.name.trim().toLowerCase(), a]));
  const posting: PostingOptions = {
    resolveAccount: (code: string) => {
      const { code: digits, name } = splitAccountLabel(code);
      const account = byName.get(name.toLowerCase());
      return { code: digits || account?.code || "", name: account?.name ?? name };
    },
    nameBankAccount: (account: string) => bankLabels.get(account) ?? account,
  };

  const byNumber = new Map(invoices.map((i) => [i.number, i]));

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
          ...posting,
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
    ...invoices.map((invoice) => postInvoice(invoice, posting)),
    ...(options.assetJournals ?? []),
    ...manualJournals
      .map((journal) => postManualJournal(journal, posting))
      .filter((journal): journal is PostedJournal => journal !== null),
  ];
}
