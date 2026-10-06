import type { Cents } from "./money.js";
import type { IsoDate } from "./dates.js";
import type { ReadonlyCsvRecord } from "./csv.js";

/**
 * The canonical transaction.
 *
 * Every importer normalises to this shape, so downstream stages -- dedupe,
 * categorisation, GST, export -- never need to know which bank a row came
 * from. The field set mirrors the BNZ export because it is the richest of the
 * feeds; sparser sources simply leave fields empty rather than inventing data.
 *
 * String fields are always strings, never null. An absent value is `""`. That
 * keeps dedupe key construction total: there is no null-vs-empty ambiguity to
 * make two identical rows hash differently.
 */
export interface Transaction {
  /** Stable identity for this row within a dataset. Derived, not from the bank. */
  id: string;

  /** Calendar date of the transaction, `YYYY-MM-DD`. */
  date: IsoDate;
  /** Signed minor units in `currency`. Negative is money out of the account. */
  amount: Cents;
  /** ISO 4217 code of `amount`, i.e. the account's own currency. */
  currency: string;

  /** Bank-assigned serial. Empty on card and loan feeds. */
  serial: string;
  /** Bank transaction code. BNZ calls this "Transaction Code". */
  trn: string;
  /** Free-text field 1, set by whoever initiated the payment. */
  particulars: string;
  /** Free-text field 2. On card feeds this holds the original `NZD2599` amount. */
  code: string;
  /** Free-text field 3. */
  reference: string;
  /** Counterparty name as the bank printed it. */
  otherParty: string;
  /** Originating bank/branch, e.g. `02-1255`. */
  origin: string;
  /** Transaction type: `BP`, `DD`, `TL`, `FT`, `AP`, `DC`, `PUR`, `PAY`. */
  type: string;
  /** Batch number. */
  batch: string;
  /** Counterparty account number. */
  otherPartyAccount: string;

  /** Account this row belongs to, as an account id from the account registry. */
  account: string;

  /**
   * Which repeat this is, among otherwise-identical rows in the same file.
   *
   * A school taking three $20 membership payments on one day produces three
   * byte-identical rows, and a card feed has no serial to tell them apart. A
   * re-export of that same file produces the same three. Numbering them 1, 2, 3
   * makes both facts true at once: all three are kept, and re-importing the
   * file matches them one-for-one instead of adding three more.
   */
  occurrence: number;

  /**
   * Original-currency detail for foreign transactions, where the feed carries
   * it. A NZD 43.63 card purchase billed as USD 29.00 records the USD leg here
   * while `amount` stays in the account's currency.
   */
  foreign?: {
    currency: string;
    amount: Cents;
  };

  /** Extra source-specific fields kept verbatim so nothing is lost on import. */
  extras: Record<string, string>;

  /** Where this row came from. */
  source: TransactionSource;
}

export interface TransactionSource {
  /** Id of the importer that produced this row, e.g. `bnz-account`. */
  importer: string;
  /** Name of the file it came from. */
  file: string;
  /** 1-based line number within that file, for pointing the user at a row. */
  line: number;
}

/** A row that could not be imported, kept so the user sees what was skipped. */
export interface ImportProblem {
  line: number;
  /** The raw fields, so the UI can show what was actually in the file. */
  row: readonly string[];
  message: string;
}

export interface ImportResult {
  importer: string;
  file: string;
  account: string;
  transactions: Transaction[];
  problems: ImportProblem[];
}

/** Confidence that a given importer recognises a file. */
export interface DetectionResult {
  importer: string;
  /** 0 = no match. Higher wins. Roughly "how many distinctive columns matched". */
  score: number;
  /** Human-readable reason, shown in the UI when detection is wrong. */
  reason: string;
}

export interface ImporterContext {
  /** File name, used for provenance and for account-name heuristics. */
  file: string;
  /**
   * Account id to stamp on every row. Importers that can read the account
   * number out of the file itself (BNZ account exports) may override this.
   */
  account: string;
  /** Account currency when the file does not state one. Defaults to `NZD`. */
  defaultCurrency?: string;
  /** Interpret ambiguous numeric dates day-first. Defaults to true. */
  dayFirst?: boolean;
}

export interface Importer {
  /** Stable machine id, e.g. `bnz-account`. */
  id: string;
  /** Name shown to the user. */
  label: string;
  /** Short note on where to get this file from the bank. */
  description: string;
  /** Score how well this importer matches the parsed rows. */
  detect(records: readonly ReadonlyCsvRecord[]): DetectionResult;
  /** Convert parsed rows into canonical transactions. */
  parse(records: readonly ReadonlyCsvRecord[], context: ImporterContext): ImportResult;
}
