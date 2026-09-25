import { emptyLedger } from "./store.js";
import type { StoredLedger } from "./store.js";
import type {
  Account,
  BalanceCheck,
  CodingCounts,
  DedupeEntry,
  FiledReturn,
  ImportProblem,
  ReferenceLine,
  RuleSet,
  Transaction,
} from "@nzosa/core";
import type { RulesArchive } from "./store.js";
import type { Suggestion } from "./reconcile.js";
import type { RuleDraft } from "./rules-editor.js";
import type { RuleFileShape } from "./rules-ui.js";

/** Which rows the import review is showing. */
export type Filter = "all" | "review" | "duplicate";

/** One imported file, and what came of it. */
export interface FileReport {
  name: string;
  importer: string;
  account: string;
  count: number;
  problems: ImportProblem[];
  error?: string;
}
import type { ReferenceLoad } from "./check-ui.js";
import type { VarianceRow } from "./variance.js";
import type { LedgerEvent } from "./events.js";

/**
 * What the app is holding, and the indexes it keeps over it.
 *
 * One object rather than a scattering of variables, because almost every
 * question a page asks is about the same ledger and the same chart, and a page
 * reaching for its own copy would answer differently from the one beside it.
 *
 * It lives here rather than in `main.ts` so a page can be a module of its own.
 * That is the whole reason this file exists: the pages were one closure
 * because the state was, and nothing could be lifted out without bringing all
 * of it along.
 *
 * **Derived, not stored.** Nothing here is the truth -- the truth is the
 * folder, or the browser's own storage. This is the working copy, and the
 * caches over it, each keyed on the thing it was derived from so that a change
 * invalidates it rather than being missed.
 */

export const state = {
  ledger: emptyLedger() as StoredLedger,
  filed: [] as FiledReturn[],
  rules: undefined as RuleSet | undefined,
  varianceRows: [] as VarianceRow[],
  varianceProblems: [] as string[],
  varianceAccounts: [] as string[],
  page: "reconcile",
  reconcileAccounts: [] as string[],
  reconcileSearch: "",
  /** Reconcile's order: oldest first unless the person chose otherwise (kept in this browser). */
  reconcileSort: ((): "oldest" | "newest" => {
    try {
      return localStorage.getItem("nzosa:reconcile-sort") === "newest" ? "newest" : "oldest";
    } catch {
      return "oldest";
    }
  })() as "oldest" | "newest",
  /** What the feed said last time it was asked, when it went wrong. */
  feedProblem: "",
  /** Loaded files whose columns nothing could name, awaiting a person. */
  checkUnreadable: [] as ReferenceLoad["unreadable"],
  /**
   * The last daily-balance comparison, kept so the import review can use it.
   *
   * The bank's balance is the only outside witness this app has, and a
   * questionable duplicate is exactly the question it can answer.
   */
  balanceChecks: [] as BalanceCheck[],
  /**
   * Which reconcile lines to show.
   *
   * `todo` is everything not yet confirmed, which is where the work is.
   * `nocode` narrows to the lines no rule could code at all -- those cannot be
   * accepted in a hurry, so they are the ones worth finding.
   */
  reconcileFilter: "todo" as "todo" | "suggested" | "ai" | "nocode" | "coded" | "all",
  splitting: null as string | null,
  expanded: null as string | null,
  reference: [] as ReferenceLine[],
  chart: [] as Account[],
  checkAccounts: [] as string[],
  checkProblems: [] as string[],
  suggestions: null as Map<string, Suggestion> | null,
  accountMap: new Map<string, string>(),
  expandedSplit: null as string | null,
  rulesName: "",
  rulesLoadedAt: "",
  rulesMessage: "",
  pendingRules: null as { rules: RuleFileShape; name: string } | null,
  rulesArchive: { version: 1, entries: [] } as RulesArchive,
  /**
   * The rule the last coding decision wrote, until the page has said so.
   *
   * Writing a rule out of somebody's coding is helpful and is also the tool
   * doing something they did not press a button for, so it is said once on
   * the page it happened on and then cleared.
   */
  lastRule: null as { keyword: string; code: string; alsoCoded: number; fixed?: boolean } | null,
  /**
   * A rule with the keyword a coding would have written, which did not pick
   * that line up. Said on the page with the offer to fix it, until the next
   * coding or until it is acted on.
   */
  ruleNotice: null as {
    index: number;
    keyword: string;
    code: string;
    newCode: string;
    description: string;
    transaction: import("@nzosa/core").Transaction;
  } | null,
  /** A rule being edited or added, or null when the table is just a table. */
  /**
   * The entity every page is looking at, or "" for all of them.
   *
   * One person's affairs are several sets of books sharing a bank account.
   * Choosing one narrows every page to the accounts that belong to it, so a
   * question about the company is not answered with the rentals mixed in.
   */
  entityFilter: "",
  /**
   * True when the browser has promised not to evict this data.
   *
   * Distinct from `persistent`, which only says storage works at all.
   */
  durable: false,
  /** Every change made in this browser, newest first. */
  events: [] as LedgerEvent[],
  /** Whose name goes on a change. Claimed, never verified. */
  who: "",
  /** What the app loaded for itself on startup, so it is never a mystery. */
  startupMessage: "",
  /** What the invoices page last did, shown at the top of it. */
  invoiceMessage: "",
  ruleDraft: null as RuleDraft | null,
  /** Rules have been changed in the page but not yet written to storage. */
  rulesDirty: false,
  openPeriod: null as string | null,
  persistent: true,
  entries: [] as DedupeEntry[],
  reports: [] as FileReport[],
  /**
   * Which rows the Import page is showing.
   *
   * Set to the review queue whenever there is one, because that is the only
   * part of that page anybody has to act on -- the rest is a record of what
   * arrived. Choosing a tab by hand still holds until the next import brings
   * something new to decide.
   */
  filter: "review" as Filter,
  search: "",
  busy: false,
  openingYear: "all",
};

export const $ = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
};

/**
 * Which bank line settles which invoice, from both sources at once.
 *
 * A person's own decision wins; the matcher fills in the rest. This used to be
 * worked out separately in each place that needed it, which meant the Invoices
 * page could call an invoice unmatched while the Reconcile page showed it
 * settled -- and the balance owing depends on getting one answer, not two.
 */

/**
 * Which lines the matcher can offer a transfer for.
 *
 * Worked out once and kept until the ledger is replaced, because the answer
 * for one line is found by looking at every other line -- doing that per row
 * while filtering three thousand of them is the difference between a list and
 * a wait.
 */

/**
 * The bank accounts this ledger holds, and what each is called.
 *
 * Cached against the transaction list it was derived from and recomputed when
 * that changes -- which is the only thing that can change it.
 */

/**
 * How many transactions are coded to each account.
 *
 * Through `categorise`, so a rule counts as much as a hand-coding: an account
 * nothing has been coded to by hand may still be where a rule sends fifty
 * lines, and removing it because the overrides are empty would break exactly
 * the accounts that are working hardest. Worked out once per set of
 * transactions rather than per row, because ninety-three rows against five
 * thousand transactions is not a sum to do ninety-three times.
 */

/**
 * The treatment an account's own chart row implies, from its tax code.
 *
 * The chart already says how most accounts are treated -- it is the column the
 * accounting package it came from used to work out GST -- and reading it means
 * a freshly loaded chart arrives with its treatments rather than with ninety
 * rows saying "not set" and a day's work to fill them in.
 */

/**
 * Indexes derived from the ledger, each keyed on what it was derived from.
 *
 * An object rather than five variables because a page module cannot assign to
 * an imported binding -- and because keeping them together makes the rule
 * visible: every one of these is a cache of something in `state`, and every
 * one carries the thing it was built from so that a change invalidates it
 * instead of being missed.
 */
export const caches = {
  assignment: null as | { ledger: unknown; map: Map<string, string> }  | null,
  transfer: null as { ledger: unknown; ids: Set<string> } | null,
  bank: undefined as | { source: readonly Transaction[]; accounts: Set<string>; labels: Map<string, string> }  | undefined,
  coded: undefined as | { transactions: readonly Transaction[]; rules: unknown; counts: CodingCounts }  | undefined,
  chartTreatment: null as | { chart: unknown; rules: unknown; ledger: unknown; map: Map<string, unknown> }  | null,
};
