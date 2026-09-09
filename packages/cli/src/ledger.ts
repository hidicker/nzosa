import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { dedupe, dedupeKey } from "@nzosa/core";
import type {
  Account,
  DedupeResult,
  Invoice,
  Overrides,
  FiledReturn,
  Journal,
  VarianceNote,
  PaymentAllocation,
  Splits,
  Transaction,
} from "@nzosa/core";

/**
 * The on-disk ledger.
 *
 * A single JSON file, human-readable and diffable, holding the canonical
 * transactions and the small amount of state the user owns. It is deliberately
 * a plain file: it can be put in a private git repo, synced, backed up, or
 * opened in an editor, and it is the same shape the browser build keeps in
 * IndexedDB and that a Supabase table would mirror.
 */
export interface Ledger {
  /** Bumped when the shape changes so old files can be migrated, not guessed at. */
  version: 1;
  /** Dedupe keys the user has confirmed are genuine repeats, not duplicates. */
  legitimateDuplicates: string[];
  /**
   * Known-good balances to reconcile against, keyed by account id.
   *
   * These come from outside the bank feeds -- a statement, or a set of
   * accountant-prepared financials. They are what turns "the import looked
   * fine" into "the import is provably complete": if opening plus the sum of
   * every transaction equals closing, then across that period nothing was
   * missed, double-counted or mis-signed.
   *
   * Amounts are decimal strings as they appear on the statement, so the file
   * stays readable and can be typed straight off a PDF.
   */
  balances?: Record<string, AccountBalances>;
  /**
   * Manual coding and GST corrections, keyed by transaction id.
   *
   * The rules engine suggests; these are the answers a human gave, and they
   * beat every rule. Keyed by the derived transaction id, so a correction
   * survives re-importing the same statement.
   */
  overrides?: Overrides;
  /**
   * One transaction divided into several coded parts, keyed by transaction id.
   *
   * The parts must sum to the original. The original is kept untouched, so
   * `balances` still reconciles against exactly what the bank reported while
   * coding and GST see the parts.
   */
  splits?: Splits;
  /**
   * Invoices, kept beside the transactions rather than turned into them.
   *
   * One invoice can be settled by several receipts and one receipt can carry
   * several invoice lines, so the two are linked, not merged. Nothing here
   * changes what the bank reported, which is what keeps `balances` meaningful.
   */
  invoices?: Invoice[];
  /**
   * Which payment settled which invoice, as the accounting system recorded it.
   *
   * Authoritative, unlike inferring it from amounts: once there are enough
   * small receipts, almost any total can be reached several ways.
   */
  allocations?: PaymentAllocation[];
  /**
   * The accounting system's general ledger, held for reference.
   *
   * Never merged into our own figures: it is read to find what a bank-derived
   * ledger cannot see, and anything that should affect a return has to become
   * an adjustment a person accepted.
   */
  journals?: Journal[];
  /**
   * The chart of accounts, as the app holds it.
   *
   * Read rather than written here, and read for one reason: an account's tax
   * code says how what is coded to it is treated for GST. Without it a return
   * built from these books assumes standard-rated everywhere, including for
   * the accounts the chart plainly marks "No GST".
   */
  chart?: Account[];
  /** GST returns as filed, read from the accounting system. */
  filedReturns?: FiledReturn[];
  /** Differences against a filed return that someone has looked at and accepted. */
  varianceNotes?: VarianceNote[];
  /**
   * Near-matches awaiting a decision.
   *
   * When a receipt is close to an invoice but not equal to it, the difference
   * has to be written off somewhere -- and writing off money is an accounting
   * judgement, not something a matcher should do on its own. So the difference
   * is proposed and left for a person to accept or reject. Nothing here affects
   * a return until it is accepted.
   */
  proposals?: MatchProposal[];
  transactions: Transaction[];
}

export interface MatchProposal {
  /** Stable id so a proposal can be accepted or rejected by name. */
  id: string;
  /** The bank transaction this concerns. */
  transactionId: string;
  /** The invoice it appears to settle. */
  invoiceNumber: string;
  /** What the invoice says is outstanding. */
  invoiceAmount: number;
  /** What actually arrived. */
  bankAmount: number;
  /** The difference that would have to be written off, in minor units. */
  adjustment: number;
  /** Where the suggestion came from. */
  source: string;
}

export interface AccountBalances {
  /** Balance carried into the period, on the day before it starts. */
  opening?: { date: string; amount: string };
  /** Balance at the close of the period, per the statement or the filings. */
  closing?: { date: string; amount: string };
  /**
   * Cut-off differences: amounts the bank dates inside this period that the
   * target recognises in a different one.
   *
   * A transfer between two of your own accounts can leave one on 31 March and
   * arrive at the other on 1 April. The bank reports each leg on the day it
   * touched that account; a ledger may instead treat the transfer as complete
   * at balance date and put both legs in the earlier year. Neither is wrong,
   * but the two conventions disagree by the amount in transit, and without
   * somewhere to record that, a correct set of books looks like a discrepancy.
   *
   * Each entry is subtracted from the computed movement.
   */
  cutOff?: CutOffAdjustment[];
  /** Where these figures came from, e.g. "FY2026 financials, balance sheet". */
  note?: string;
}

export interface CutOffAdjustment {
  /** Date the bank assigned to the transaction. */
  date?: string;
  /** Signed amount as the bank reported it, e.g. "172.08". */
  amount: string;
  /** Why this belongs in another period. Required: an unexplained one is a fudge. */
  note: string;
}

export function emptyLedger(): Ledger {
  return { version: 1, legitimateDuplicates: [], transactions: [] };
}

/**
 * A ledger the app wrote: a folder holding one JSON file per part.
 *
 * The two halves of this project had drifted apart. The app keeps books as a
 * directory -- transactions, decisions, chart, entities, each in its own file,
 * written atomically with its own version counter -- and this read a single
 * file, so pointing the command line at anybody's actual books answered
 * "EISDIR: illegal operation on a directory" or, worse, read `ledger.json` and
 * reported it as an unknown version, when that file holds only the name and
 * the date the folder was made.
 *
 * Each file is `{ version, data }`. `decisions` is a bag of everything keyed
 * by transaction id and is spread out flat, which is how the app holds it in
 * memory too.
 */
function loadFolder(folder: string): Ledger {
  const part = (name: string): unknown => {
    const file = join(folder, `${name}.json`);
    if (!existsSync(file)) return undefined;
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as { data?: unknown };
      return parsed?.data ?? parsed;
    } catch (error) {
      throw new Error(`${file} is not valid JSON: ${(error as Error).message}`);
    }
  };

  const decisions = (part("decisions") ?? {}) as Record<string, unknown>;
  const list = (name: string): unknown[] | undefined => {
    const held = part(name);
    return Array.isArray(held) ? held : undefined;
  };

  const ledger: Record<string, unknown> = {
    version: 1,
    transactions: list("transactions") ?? [],
    legitimateDuplicates: (decisions["legitimateDuplicates"] as string[]) ?? [],
    ...decisions,
  };
  for (const [name, field] of [
    ["chart", "chart"],
    ["entities", "entities"],
    ["invoices", "invoices"],
    ["allocations", "allocations"],
    ["assets", "assets"],
    ["journals", "journals"],
    ["reference", "reference"],
    ["filed", "filedReturns"],
  ] as const) {
    const held = part(name);
    if (held !== undefined) ledger[field] = held;
  }
  // Set last so a stray key in decisions cannot claim to be the version.
  ledger["version"] = 1;
  return ledger as unknown as Ledger;
}

export function loadLedger(path: string): Ledger {
  if (!existsSync(path)) return emptyLedger();
  if (statSync(path).isDirectory()) return loadFolder(path);

  const raw = readFileSync(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${(error as Error).message}`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`${path} does not contain a ledger.`);
  }

  const ledger = parsed as Partial<Ledger>;
  if (ledger.version !== 1) {
    throw new Error(
      `${path} is ledger version ${String(ledger.version)}; this build reads version 1.`,
    );
  }

  return {
    version: 1,
    legitimateDuplicates: ledger.legitimateDuplicates ?? [],
    transactions: ledger.transactions ?? [],
    ...(ledger.balances ? { balances: ledger.balances } : {}),
    ...(ledger.overrides ? { overrides: ledger.overrides } : {}),
    ...(ledger.splits ? { splits: ledger.splits } : {}),
    ...(ledger.invoices ? { invoices: ledger.invoices } : {}),
    ...(ledger.allocations ? { allocations: ledger.allocations } : {}),
    ...(ledger.journals ? { journals: ledger.journals } : {}),
    ...(ledger.filedReturns ? { filedReturns: ledger.filedReturns } : {}),
    ...(ledger.varianceNotes ? { varianceNotes: ledger.varianceNotes } : {}),
    ...(ledger.proposals ? { proposals: ledger.proposals } : {}),
  };
}

/**
 * Refuse to write to a ledger the app has open.
 *
 * The app writes to its folder on every change, so two writers would overwrite
 * each other with no sign of it having happened. The server leaves `.open-by`
 * beside the books while it runs; this is the other half of that.
 *
 * A lock whose process is gone is ignored rather than obeyed. A crash should
 * not shut somebody out of their own books until they work out which file to
 * delete.
 */
function heldByTheApp(path: string): string | null {
  const lock = join(dirname(resolve(path)), ".open-by");
  if (!existsSync(lock)) return null;
  try {
    const held = JSON.parse(readFileSync(lock, "utf8")) as { pid?: number; since?: string };
    if (typeof held.pid !== "number") return null;
    try {
      // Signal 0 asks whether the process exists without disturbing it.
      process.kill(held.pid, 0);
    } catch {
      return null;
    }
    return held.since ?? "";
  } catch {
    return null;
  }
}

export function saveLedger(path: string, ledger: Ledger): void {
  // Reading a folder is safe; writing one is not, and doing it badly would be
  // worse than not doing it. The app writes each part separately with its own
  // version counter, and a single file dropped in the middle of that folder
  // would be ignored by the app and would look, to the next person, like the
  // books.
  if (existsSync(path) && statSync(path).isDirectory()) {
    throw new Error(
      `${path} is a folder of books written by NZOSA, which this command can read ` +
        `but not write. Make the change in the app, or work on a copy: ` +
        `nzosa import <file> --ledger some-name.json`,
    );
  }
  const since = heldByTheApp(path);
  if (since !== null) {
    throw new Error(
      `These books are open in NZOSA${since ? ` (since ${since})` : ""}, which writes to ` +
        `them as you work. Close it -- double-click "Stop NZOSA" -- and run this again. ` +
        `Writing from both at once would lose whichever change landed first.`,
    );
  }
  // Trailing newline so the file plays nicely with git and text tools.
  writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
}

/**
 * Merge newly imported transactions into a ledger.
 *
 * Existing transactions are passed first so that anything already in the
 * ledger wins: re-importing an overlapping statement never renumbers or
 * re-sources rows the user has already seen.
 */
export function merge(
  ledger: Ledger,
  incoming: readonly Transaction[],
): { ledger: Ledger; result: DedupeResult; added: number } {
  const result = dedupe([...ledger.transactions, ...incoming], {
    legitimateDuplicates: ledger.legitimateDuplicates,
  });

  const added = result.kept.length - ledger.transactions.length;

  return {
    ledger: { ...ledger, transactions: result.kept },
    result,
    added,
  };
}

/** Mark a transaction's key as a genuine repeat, so future copies are kept. */
export function allowDuplicate(ledger: Ledger, transaction: Transaction): Ledger {
  const key = dedupeKey(transaction);
  if (ledger.legitimateDuplicates.includes(key)) return ledger;
  return { ...ledger, legitimateDuplicates: [...ledger.legitimateDuplicates, key] };
}
