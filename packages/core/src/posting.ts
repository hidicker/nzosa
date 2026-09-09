import type { Cents } from "./money.js";
import type { Disposal, DisposalAccounts, DisposalPosting } from "./disposal.js";
import type { IsoDate } from "./dates.js";
import type { Transaction } from "./types.js";
import type { GstClassification } from "./gst.js";
import { gstContent } from "./gst.js";
import type { Invoice } from "./invoices.js";

/**
 * Turning a coded bank line into double-entry journal lines.
 *
 * Until now a coding was one row with an implied contra: a bank account, an
 * amount, and the account it was coded to. That is enough to produce a profit
 * figure and a GST return, and it is how every figure here was built — but it
 * cannot be checked. Nothing balances, because there is nothing to balance.
 *
 * This posts the same information as double entry: discrete
 * debit and credit lines that sum to zero, with the tax on its own line in a
 * control account. Two things follow that were not possible before.
 *
 * **It can be proved.** Every journal sums to zero or it is a bug, and the
 * whole ledger sums to zero or something is lost. That is a real check, and
 * this had none.
 *
 * **The tax is tagged, not inferred.** Each line carries a `TaxType`, and the
 * GST return reads the tags rather than the balance of the GST account. Those
 * are not the same thing, and confusing them is how money goes missing: a line
 * posted to the GST account with no tax type moves the account and reaches no
 * return box at all. That is exactly what happened to $3,330.06 of border GST
 * in this ledger, which sat in account 820 and was never claimed.
 *
 * Nothing here replaces the bank data. Postings are *derived*, recomputed from
 * the transaction and its coding every time, so a corrected rule corrects the
 * journal too. The statement stays the source of truth.
 */

/**
 * How a line reaches the GST return.
 *
 * Named after the tags an accounting system uses, because they are the
 * vocabulary an accountant already has and the mapping should be obvious.
 */
export type TaxType =
  /** 15% GST on income. Box 5 gross, Box 6 tax. */
  | "OUTPUT2"
  /** 15% GST on expenses. Box 11 gross, Box 12 tax. */
  | "INPUT2"
  /** GST paid at the border. The line *is* the tax; Box 13 whole. */
  | "GSTONIMPORTS"
  /** Zero-rated supply. In Box 5, then removed by Box 6. */
  | "ZERORATED"
  /** Exempt: financial services, residential rent. Never on the return. */
  | "EXEMPTOUTPUT"
  /** Deliberately outside GST: transfers, drawings, loan principal. */
  | "NONE";

/** The GST treatment and side, as the tag an accounting system would write. */
export function taxTypeFor(classification: GstClassification): TaxType {
  if (classification.side === "imports") return "GSTONIMPORTS";
  if (classification.treatment === "zero-rated") return "ZERORATED";
  if (classification.treatment === "exempt") return "EXEMPTOUTPUT";
  if (classification.treatment !== "standard") return "NONE";
  if (classification.side === "sales") return "OUTPUT2";
  if (classification.side === "purchases") return "INPUT2";
  return "NONE";
}

export interface PostedLine {
  /** Chart code where there is one, or the bank account's own id. */
  accountCode: string;
  accountName: string;
  /**
   * Debit positive, credit negative.
   *
   * One convention throughout, so a journal balances by summing rather than by
   * comparing two columns that can drift apart.
   */
  amount: Cents;
  taxType: TaxType;
  /**
   * The GST-inclusive amount this line's tax was worked out from.
   *
   * Only on the line carrying the supply, because Box 5 and Box 11 want the
   * gross figure while Box 6 and Box 12 want the tax. Keeping both means the
   * return never has to reverse-engineer one from the other.
   */
  taxBase?: Cents;
  /** Half-deductible entertainment, carried so a return can adjust it. */
  deductiblePercent?: number;
  description: string;
}

/** What kind of event produced a journal. */
export type JournalSource =
  | "bank"
  | "invoice"
  | "bill"
  | "depreciation"
  | "disposal"
  | "manual"
  | "transfer";

/**
 * Which basis this journal's tax belongs to.
 *
 * The same sale is taxed once, but *when* depends on the basis you file. An
 * invoice raises the tax on an invoice basis; the payment raises it on a
 * payments basis. Posting both and counting both would double the return, so
 * each journal says which basis it counts on and the summary filters.
 *
 * `both` is for a transaction with no invoice behind it — a card payment, a
 * direct receipt. Its tax point is the same date either way, so it counts on
 * whichever basis is asked for.
 */
export type TaxBasis = "invoice" | "payments" | "both";

export interface PostedJournal {
  /** The bank transaction this came from, or the document's own reference. */
  transactionId: string;
  date: IsoDate;
  narration: string;
  lines: PostedLine[];
  source: JournalSource;
  taxBasis: TaxBasis;
}

export interface PostingOptions {
  /** Chart code of the GST control account. Defaults to `820`. */
  gstAccountCode?: string;
  gstAccountName?: string;
  /** How a coded account name resolves to a chart code and display name. */
  resolveAccount?: (code: string) => { code: string; name: string };
  /** How a bank account id is named on the journal. */
  nameBankAccount?: (account: string) => string;
  /** Accounts receivable, where a sales invoice sits until it is paid. */
  receivableCode?: string;
  receivableName?: string;
  /** Accounts payable, where a bill sits until it is paid. */
  payableCode?: string;
  payableName?: string;
  /**
   * The invoice this bank line settles, when it settles one.
   *
   * Given it, the payment clears the receivable rather than booking the sale a
   * second time — the sale was already booked when the invoice was posted.
   * Without it a matched receipt would double the income.
   */
  settles?: SettledInvoice;
}

/** Just enough of an invoice for its payment to be posted against it. */
export interface SettledInvoice {
  number: string;
  kind: "sales" | "purchase";
  /** The tax type its supply carried, so a payments basis can read it here. */
  taxType: TaxType;
  /** GST-inclusive total of the invoice, for the return's gross box. */
  total: Cents;
}

/** The GST within an amount, given how the line is treated. */
function gstWithin(amount: Cents, classification: GstClassification): Cents {
  if (classification.side === "imports") return amount;
  if (classification.treatment !== "standard") return 0;
  if (classification.side === "none") return 0;
  return Math.round((amount * 3) / 23);
}

/** One part of a bank line: what it was for, and how it is taxed. */
export interface PostingPart {
  /** Signed the same way as the bank line. */
  amount: Cents;
  /** The account it is coded to, in our own vocabulary. */
  code: string | null;
  classification: GstClassification;
  description?: string;
}

/**
 * Post one bank line as balanced journal lines.
 *
 * The bank line is one side; the coding is the other, split into the supply
 * and its tax. A payment of $230 coded to office expenses at 15% becomes three
 * lines, not two:
 *
 *     Dr  400 Office Expenses   200.00   INPUT2
 *     Dr  820 GST                30.00   INPUT2
 *     Cr  Bank                  230.00   NONE
 *
 * A split bank line produces a pair of lines per part against the one bank
 * line, which is what makes a courier payment — freight, border GST, an entry
 * fee — a single balanced journal rather than three unrelated codings.
 */
export function postTransaction(
  transaction: Transaction,
  parts: readonly PostingPart[],
  options: PostingOptions = {},
): PostedJournal {
  const gstCode = options.gstAccountCode ?? "820";
  const gstName = options.gstAccountName ?? "GST";
  const resolve =
    options.resolveAccount ?? ((code: string) => ({ code, name: code }));
  const bankName =
    options.nameBankAccount?.(transaction.account) ?? transaction.account;

  const lines: PostedLine[] = [];

  // The bank side. Money in is a debit to the asset; money out is a credit.
  lines.push({
    accountCode: transaction.account,
    accountName: bankName,
    amount: transaction.amount,
    taxType: "NONE",
    description: transaction.otherParty || transaction.particulars || "",
  });

  // Settling an invoice moves the balance out of receivables or payables. The
  // sale or the cost was booked when the document was posted; repeating it here
  // would count the same income twice.
  const settles = options.settles;
  if (settles !== undefined) {
    const receivable = settles.kind === "sales";
    lines.push({
      accountCode: receivable
        ? (options.receivableCode ?? "610")
        : (options.payableCode ?? "800"),
      accountName: receivable
        ? (options.receivableName ?? "Accounts Receivable")
        : (options.payableName ?? "Accounts Payable"),
      amount: -transaction.amount,
      // The tag rides on the clearing line so a payments-basis return can find
      // the tax here, where it actually falls due.
      //
      // The base is the signed gross of the transaction, the same convention a
      // supply line uses -- money out is negative. Flipping it for payables
      // made a settled bill *subtract* from Box 11 rather than adding to it.
      taxType: settles.taxType,
      taxBase: transaction.amount,
      description: `Settles ${settles.number}`,
    });
    return {
      transactionId: transaction.id,
      date: transaction.date,
      narration: transaction.otherParty || transaction.particulars || "",
      lines,
      source: "bank",
      taxBasis: "payments",
    };
  }

  for (const part of parts) {
    const tax = gstWithin(part.amount, part.classification);
    const taxType = taxTypeFor(part.classification);
    const account = part.code === null ? null : resolve(part.code);

    // The whole line is the tax: a customs entry paid to a courier has no
    // supply of its own, so there is no expense line to post beside it.
    if (part.classification.side === "imports") {
      lines.push({
        accountCode: gstCode,
        accountName: gstName,
        amount: -part.amount,
        taxType,
        taxBase: part.amount,
        description: part.description ?? "GST paid at the border",
      });
      continue;
    }

    const net = part.amount - tax;
    if (net !== 0) {
      lines.push({
        accountCode: account?.code ?? "",
        accountName: account?.name ?? "(uncoded)",
        amount: -net,
        taxType,
        ...(tax !== 0 ? { taxBase: part.amount } : {}),
        ...(part.classification.deductiblePercent !== undefined &&
        part.classification.deductiblePercent !== 100
          ? { deductiblePercent: part.classification.deductiblePercent }
          : {}),
        description: part.description ?? "",
      });
    }

    if (tax !== 0) {
      lines.push({
        accountCode: gstCode,
        accountName: gstName,
        amount: -tax,
        taxType,
        // Repeated from the supply line above. A split can mix a fully
        // deductible part with a half deductible one, and the return has to
        // tell their tax lines apart -- there is nothing else linking a tax
        // line back to the part it belongs to.
        ...(part.classification.deductiblePercent !== undefined &&
        part.classification.deductiblePercent !== 100
          ? { deductiblePercent: part.classification.deductiblePercent }
          : {}),
        description: part.description ?? "",
      });
    }
  }

  return {
    transactionId: transaction.id,
    date: transaction.date,
    narration: transaction.otherParty || transaction.particulars || "",
    lines,
    source: "bank",
    // Nothing was invoiced, so the tax point is this date on either basis.
    taxBasis: "both",
  };
}

/** What a journal fails to balance by. Zero is the only acceptable answer. */
export function journalImbalance(journal: PostedJournal): Cents {
  return journal.lines.reduce((sum, line) => sum + line.amount, 0);
}

export interface TrialBalanceRow {
  accountCode: string;
  accountName: string;
  /** Debits positive, credits negative. */
  balance: Cents;
  lines: number;
}

export interface TrialBalance {
  rows: TrialBalanceRow[];
  /** Zero when the ledger balances, which it must. */
  imbalance: Cents;
  /** Journals that do not balance on their own, which is always a bug. */
  unbalanced: PostedJournal[];
}

/**
 * Every account's balance, and proof the ledger holds together.
 *
 * The point is `imbalance`. A single-entry ledger cannot tell you it is
 * complete; this one can, and a non-zero answer means a posting rule is wrong
 * rather than a figure being merely surprising.
 */
export function trialBalance(journals: readonly PostedJournal[]): TrialBalance {
  const rows = new Map<string, TrialBalanceRow>();
  const unbalanced: PostedJournal[] = [];

  for (const journal of journals) {
    if (journalImbalance(journal) !== 0) unbalanced.push(journal);
    for (const line of journal.lines) {
      const key = `${line.accountCode}\u0001${line.accountName}`;
      const row = rows.get(key) ?? {
        accountCode: line.accountCode,
        accountName: line.accountName,
        balance: 0,
        lines: 0,
      };
      row.balance += line.amount;
      row.lines += 1;
      rows.set(key, row);
    }
  }

  const all = [...rows.values()].sort(
    (a, b) => a.accountCode.localeCompare(b.accountCode) || a.accountName.localeCompare(b.accountName),
  );

  return {
    rows: all,
    imbalance: all.reduce((sum, row) => sum + row.balance, 0),
    unbalanced,
  };
}

export interface TaxSummary {
  /** Gross sales, Box 5. */
  box5: Cents;
  /** Zero-rated supplies, Box 6. */
  box6: Cents;
  /** GST on sales, Box 8. */
  box8: Cents;
  /** Gross purchases, Box 11. */
  box11: Cents;
  /** GST on purchases, Box 12. */
  box12: Cents;
  /** Credit adjustments — border GST, Box 13. */
  box13: Cents;
}

/**
 * The GST return read from the tags, not from the GST account's balance.
 *
 * This is the distinction the whole module exists for. The balance of account
 * 820 and the figures on a return are different numbers: a line posted to 820
 * with no tax type moves the account and reaches no box. Reading tags means a
 * mis-posted line shows up as a difference rather than disappearing.
 */
export function taxSummary(
  journals: readonly PostedJournal[],
  options: { basis?: "invoice" | "payments" } = {},
): TaxSummary {
  const basis = options.basis ?? "payments";
  const summary: TaxSummary = { box5: 0, box6: 0, box8: 0, box11: 0, box12: 0, box13: 0 };
  const gstAccounts = new Set(["820"]);
  // Counting a sale on both bases would double the return. Each journal says
  // which basis its tax falls due on; only those are read.
  const counted = journals.filter((j) => j.taxBasis === "both" || j.taxBasis === basis);

  // Which tax types this journal actually posts to the GST account.
  //
  // A bank line coded to a sale posts the tax on its own line, and the tax
  // boxes read it there. Settling an invoice does not: the sale and its GST
  // were booked when the invoice was raised, and the receipt only clears the
  // receivable, so the journal carries the tag and the gross but no tax line.
  //
  // On the invoice basis that is right -- the invoice journal supplied the tax.
  // On the payments basis the invoice journal is excluded, and nothing was left
  // to supply it: every settled invoice reported its gross in Box 5 or Box 11
  // and nothing at all in Box 8 or Box 12. Where the journal posts no tax line
  // for a tag, the tax is taken from the gross instead.
  const postsTaxFor = new Map<PostedJournal, Set<TaxType>>();
  for (const journal of counted) {
    const types = new Set<TaxType>();
    for (const line of journal.lines) {
      if (gstAccounts.has(line.accountCode)) types.add(line.taxType);
    }
    postsTaxFor.set(journal, types);
  }

  // Half-deductible entertainment claims half its input tax, and the
  // percentage belongs to the line rather than to the journal.
  //
  // It used to be read off the first partial line and applied to every line in
  // the journal. A split of $100 office supplies and $100 client dinner then
  // claimed half of both -- $100 into Box 11 where $150 was due -- because the
  // dinner's percentage was applied to the stationery as well.
  for (const journal of counted) {
    const posted = postsTaxFor.get(journal) ?? new Set<TaxType>();
    for (const line of journal.lines) {
      const isTaxLine = gstAccounts.has(line.accountCode);

      if (line.taxType === "OUTPUT2") {
        if (line.taxBase !== undefined) {
          summary.box5 += line.taxBase;
          if (!posted.has("OUTPUT2")) summary.box8 += gstContent(line.taxBase);
        }
        if (isTaxLine) summary.box8 += -line.amount;
      } else if (line.taxType === "ZERORATED") {
        if (line.taxBase !== undefined) {
          summary.box5 += line.taxBase;
          summary.box6 += line.taxBase;
        }
      } else if (line.taxType === "INPUT2") {
        const percent = line.deductiblePercent ?? 100;

        // A half-deductible cost claims half the *gross* and takes the tax
        // content of that, rather than halving the tax. The two differ by a
        // cent often enough to matter, and a return does it this way round.
        if (line.taxBase !== undefined) {
          const claimable =
            percent === 100 ? -line.taxBase : Math.round((-line.taxBase * percent) / 100);
          summary.box11 += claimable;
          // Either because the claim is scaled, or -- as when a bill is settled
          // -- because this journal posts no tax line to take it from.
          if (percent !== 100 || !posted.has("INPUT2")) {
            summary.box12 += gstContent(claimable);
          }
        }
        // A tax line for a part that is not fully deductible was already
        // accounted for from its supply line's gross, so taking it again here
        // would claim it twice.
        if (isTaxLine && percent === 100) summary.box12 += line.amount;
      } else if (line.taxType === "GSTONIMPORTS") {
        summary.box13 += line.amount;
      }
    }
  }

  return summary;
}

/** Xero's tax rate wording, as one of our tags. */
export function taxTypeFromRate(rate: string, kind: "sales" | "purchase"): TaxType {
  const text = rate.trim().toLowerCase();
  if (text.includes("import")) return "GSTONIMPORTS";
  if (text.includes("zero")) return "ZERORATED";
  if (text.includes("exempt")) return "EXEMPTOUTPUT";
  if (text.startsWith("15%") || text.includes("gst on")) {
    return kind === "sales" ? "OUTPUT2" : "INPUT2";
  }
  return "NONE";
}

/**
 * Post an invoice or a bill: the entry no bank statement can produce.
 *
 * This is the half of a set of books that money never touches. A sale exists
 * from the moment it is invoiced, sitting in receivables until someone pays;
 * the payment, when it comes, only moves the balance from one account to
 * another. Posting both halves is what makes an accrual profit figure possible
 * from data of our own rather than read from somebody else's ledger.
 *
 *     Dr  610 Accounts Receivable   1,150.00   NONE
 *     Cr  200 Sales                 1,000.00   OUTPUT2
 *     Cr  820 GST                     150.00   OUTPUT2
 */
export function postInvoice(invoice: Invoice, options: PostingOptions = {}): PostedJournal {
  const gstCode = options.gstAccountCode ?? "820";
  const gstName = options.gstAccountName ?? "GST";
  const resolve = options.resolveAccount ?? ((code: string) => ({ code, name: code }));
  const sales = invoice.kind === "sales";

  // Sales put the customer in debit to us; a bill puts us in credit to them.
  const sign = sales ? 1 : -1;
  const lines: PostedLine[] = [
    {
      accountCode: sales ? (options.receivableCode ?? "610") : (options.payableCode ?? "800"),
      accountName: sales
        ? (options.receivableName ?? "Accounts Receivable")
        : (options.payableName ?? "Accounts Payable"),
      amount: sign * invoice.total,
      taxType: "NONE",
      description: `${invoice.number} ${invoice.contact}`.trim(),
    },
  ];

  for (const line of invoice.lines) {
    const account = resolve(line.accountCode);
    const taxType = taxTypeFromRate(line.taxType, invoice.kind);
    lines.push({
      accountCode: account.code,
      accountName: account.name,
      amount: -sign * line.net,
      taxType,
      ...(line.tax !== 0 ? { taxBase: sign * line.gross } : {}),
      description: line.description,
    });
    if (line.tax !== 0) {
      lines.push({
        accountCode: gstCode,
        accountName: gstName,
        amount: -sign * line.tax,
        taxType,
        description: line.description,
      });
    }
  }

  return {
    transactionId: invoice.number,
    date: invoice.issued,
    narration: `${invoice.number} ${invoice.contact}`.trim(),
    lines,
    source: sales ? "invoice" : "bill",
    // On a payments basis this tax has not fallen due yet; it does when the
    // money arrives, and the settling journal carries it there.
    taxBasis: "invoice",
  };
}

export interface DepreciationPosting {
  /** Asset name, for the narration. */
  name: string;
  /** Where the charge goes, e.g. `416` Depreciation. */
  expenseCode: string;
  expenseName: string;
  /** The contra, e.g. `731` Less Accumulated Depreciation. */
  accumulatedCode: string;
  accumulatedName: string;
  amount: Cents;
  date: IsoDate;
}

/**
 * Post a year's depreciation.
 *
 * The purest example of an entry bank data cannot reach: no money moves, and
 * the amount depends on decisions taken when the asset was bought. It comes
 * from the asset register, and without it an accrual profit figure is
 * overstated by the whole charge.
 */
/**
 * One journal for money moved between two accounts you hold.
 *
 * A transfer arrives as two bank lines, and coding them separately is correct
 * only by convention: send both to the same clearing account and the halves
 * cancel, send them to different ones and you are left with a balance that
 * represents nothing. Posting the pair as a single journal makes it correct by
 * construction -- one debit, one credit, straight between the two banks, with
 * no account in the middle to get wrong.
 *
 * Neither leg is a supply, so there is no GST on either side. The caller is
 * responsible for not also posting the legs through `postTransaction`; that
 * would count the movement twice.
 */
export interface TransferPosting {
  /** The leg money left. Its amount is negative. */
  from: Transaction;
  /** The leg money arrived on. Its amount is positive. */
  to: Transaction;
}

export function postTransfer(
  transfer: TransferPosting,
  options: PostingOptions = {},
): PostedJournal {
  const name = (account: string): string =>
    options.nameBankAccount?.(account) ?? account;
  const { from, to } = transfer;

  // The pair is identified by both ids in a fixed order, so the same transfer
  // produces the same journal id whichever leg the user started from.
  const [first, second] = [from.id, to.id].sort();

  return {
    transactionId: `transfer:${first}:${second}`,
    // The later of the two: the movement is not complete until both ends have
    // happened, and dating it earlier would move money before it left.
    date: from.date >= to.date ? from.date : to.date,
    narration: `Transfer — ${name(from.account)} to ${name(to.account)}`,
    lines: [
      {
        accountCode: from.account,
        accountName: name(from.account),
        amount: from.amount,
        taxType: "NONE",
        description: from.otherParty || from.particulars || "",
      },
      {
        accountCode: to.account,
        accountName: name(to.account),
        amount: to.amount,
        taxType: "NONE",
        description: to.otherParty || to.particulars || "",
      },
    ],
    source: "transfer",
    // Not a supply on any basis.
    taxBasis: "both",
  };
}

export function postDepreciation(charge: DepreciationPosting): PostedJournal {
  return {
    transactionId: `depreciation:${charge.expenseCode}:${charge.date}`,
    date: charge.date,
    narration: `Depreciation — ${charge.name}`,
    lines: [
      {
        accountCode: charge.expenseCode,
        accountName: charge.expenseName,
        amount: charge.amount,
        taxType: "NONE",
        description: charge.name,
      },
      {
        accountCode: charge.accumulatedCode,
        accountName: charge.accumulatedName,
        amount: -charge.amount,
        taxType: "NONE",
        description: charge.name,
      },
    ],
    source: "depreciation",
    // No tax either way, so it does not matter which basis asks.
    taxBasis: "both",
  };
}

/**
 * Post a disposal: take the asset off the books and say what the sale was.
 *
 *     Dr  731 Accumulated depreciation   339.86   what was claimed, cleared
 *     Dr  730 Paragliding Equipment    1,130.43   the proceeds, cleared
 *     Cr  730 Paragliding Equipment      869.57   the asset, at cost
 *     Cr  300 Depreciation Recovered     339.86   assessable
 *     Cr  301 Capital Gain               260.86   not assessable
 *
 * The second line is the one that needs explaining. The sale itself is an
 * ordinary receipt or invoice, and an accounting system codes it to the asset
 * account -- so by the time the disposal is posted, that account already holds
 * a credit for the proceeds. The disposal debits it back out, which is what
 * leaves the asset removed at cost and the profit sitting in the right two
 * places. `proceedsCode` says where the sale was credited, and defaults to the
 * asset account because that is where an accounting system puts it.
 *
 * Whatever the split, the journal balances: the proceeds plus the depreciation
 * cleared equal the cost plus what the sale made, and a loss sits on the other
 * side of that equation instead. There is a test for each of the three shapes.
 */
export function postDisposal(
  posting: DisposalPosting,
  accounts: DisposalAccounts,
  options: PostingOptions & { proceedsCode?: string; proceedsName?: string } = {},
): PostedJournal {
  const resolve = options.resolveAccount ?? ((code: string) => ({ code, name: code }));
  const { disposal, assetNumber, assetName, date } = posting;
  const lines: PostedLine[] = [];

  const asset = resolve(accounts.assetCode);
  const assetLabel = accounts.assetName ?? asset.name;
  const description = `Disposal of ${assetNumber} ${assetName}`.trim();

  // What was claimed, cleared out of the contra account.
  if (disposal.accumulatedDepreciation !== 0) {
    lines.push({
      accountCode: accounts.accumulatedCode,
      accountName: accounts.accumulatedName ?? resolve(accounts.accumulatedCode).name,
      amount: disposal.accumulatedDepreciation,
      taxType: "NONE",
      description,
    });
  }

  // The proceeds, cleared out of wherever the sale was credited.
  if (disposal.proceeds !== 0) {
    const code = options.proceedsCode ?? accounts.assetCode;
    lines.push({
      accountCode: code,
      accountName: options.proceedsName ?? (code === accounts.assetCode ? assetLabel : resolve(code).name),
      amount: disposal.proceeds,
      taxType: "NONE",
      description,
    });
  }

  // The asset itself, at what it cost.
  lines.push({
    accountCode: accounts.assetCode,
    accountName: assetLabel,
    amount: -disposal.cost,
    taxType: "NONE",
    description,
  });

  // Depreciation Inland Revenue takes back. Assessable, and it is income, so
  // it is a credit.
  if (disposal.depreciationRecovered !== 0) {
    lines.push({
      accountCode: accounts.recoveredCode ?? "300",
      accountName: accounts.recoveredName ?? "Depreciation Recovered",
      amount: -disposal.depreciationRecovered,
      taxType: "NONE",
      description,
    });
  }

  // Proceeds above cost. Not assessable, which is the whole reason it is not
  // lumped in with the line above.
  if (disposal.capitalGain !== 0) {
    lines.push({
      accountCode: accounts.capitalGainCode ?? "301",
      accountName: accounts.capitalGainName ?? "Capital Gain (Loss) on Disposal of Assets",
      amount: -disposal.capitalGain,
      taxType: "NONE",
      description,
    });
  }

  // Book value the sale did not cover. Deductible, and an expense, so a debit.
  if (disposal.lossOnSale !== 0) {
    lines.push({
      accountCode: accounts.lossCode ?? "470",
      accountName: accounts.lossName ?? "Loss on sale of Fixed Assets",
      amount: disposal.lossOnSale,
      taxType: "NONE",
      description,
    });
  }

  return {
    transactionId: `disposal:${assetNumber}`,
    date,
    narration: description,
    lines,
    source: "disposal",
    // A disposal is not a supply on either basis: the GST went with the sale
    // invoice, which is posted separately and carries its own tag.
    taxBasis: "payments",
  };
}
