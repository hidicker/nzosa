import type {
  Account,
  Cents,
  ManualJournal,
  EntityModel,
  OpeningBalances,
  CategoryRule,
  Invoice,
  SplitPart,
  TransactionOverride,
} from "@nzosa/core";
import type { StoredLedger } from "./store.js";

/**
 * A record of what was changed, by whom, and how to put it back.
 *
 * The app stores current state, not history: coding a transaction overwrites
 * whatever was there, and the previous answer is gone. That is fine until
 * somebody asks why a figure moved, or wants a change undone, and there is
 * nothing to look at.
 *
 * So every decision appends an event carrying both sides of the change. State
 * stays the source of truth — this is a log beside it, not a replacement — and
 * reversal is applying `before` back over the target.
 *
 * **`who` is attribution, not authentication.** It is a name typed into this
 * browser, and nothing verifies it. That is honest between people who are not
 * trying to deceive each other, and it is not an audit trail in the sense an
 * auditor means. Saying so plainly is better than implying a guarantee the
 * design cannot make.
 *
 * The log is deliberately local. It is not carried by an exported ledger,
 * because history belongs to the machine the work was done on rather than to
 * the figures themselves.
 */

export type EventKind =
  /** A transaction's coding. `id` is the transaction. */
  | "coding"
  /**
   * Many codings accepted at once.
   *
   * A batch is one act and reverses as one. Recording a line each would put
   * thousands of entries in the log for a single click, and undoing it would
   * mean thousands of clicks back.
   */
  | "codingBatch"
  /**
   * Many transfers paired at once.
   *
   * One act, reversed as one, for the same reason a batch of codings is: the
   * pairs are found together and a person who did not want them wants none of
   * them, not forty of them one at a time.
   */
  | "transferBatch"
  /** A transaction split into parts. `id` is the transaction. */
  | "split"
  /** One account in the chart. `id` is its code and name. */
  | "chart"
  /** Entities, their owners and their account assignments, whole. */
  | "entities"
  /** Which invoice a receipt settles. `id` is the transaction. */
  | "invoiceMatch"
  /** One invoice, created or edited by hand. `id` is its number. */
  | "invoice"
  /**
   * Two bank lines joined as one movement between your own accounts.
   *
   * `id` is the leg the money left. The pair is the unit: both keys are
   * written together and removed together, because half a transfer is a
   * balance that represents nothing.
   */
  | "transfer"
  /** One coding rule. `id` is its index in the rule set. */
  | "rule"
  /** One account's GST treatment. `id` is the account name. */
  | "codeTreatment"
  /**
   * What the accounts stood at before this ledger begins.
   *
   * Logged like any other decision, because it is one: the figures are
   * somebody stating a position from the previous year, and every balance
   * sheet after it rests on that statement.
   */
  | "openingBalance"
  /** What a disposed asset sold for. */
  | "disposal"
  /** A journal somebody wrote by hand. */
  | "manualJournal"
  /** Income entered by hand, whole. */
  | "taxExtras";

/**
 * A match and the coding it produced, recorded together.
 *
 * Matching an invoice codes the line from it, so undoing the match has to undo
 * the coding as well; carrying them separately left a description quoting an
 * invoice the line was no longer matched to.
 */
export interface InvoiceMatchState {
  number: string;
  /** Absent on events written before the coding was carried. */
  override?: TransactionOverride | undefined;
}

/** One line's part in a batch of codings: what it was, so it can go back. */
export interface CodingBatchEntry {
  id: string;
  before: TransactionOverride | null;
}

/** Both legs of a transfer, as one thing so neither can be recorded alone. */
export interface TransferPair {
  from: string;
  to: string;
}

export interface LedgerEvent {
  /** Sortable and unique: the timestamp with a counter, so order is total. */
  id: string;
  /** Full ISO timestamp. The old `at` on an override was date-only, which
   *  could not tell two changes on the same day apart. */
  at: string;
  who: string;
  kind: EventKind;
  /** Which one, when the kind applies to a single thing. */
  targetId?: string;
  /** One line, already written, so the list does not have to guess. */
  summary: string;
  /** What it was. Applying this is what reversal means. */
  before: unknown;
  /** What it became, kept so the log reads as a story rather than a diff. */
  after: unknown;
  /** Set once this event has been undone, so it is not undone twice. */
  reverted?: boolean;
}

/**
 * How many events to keep.
 *
 * Deep enough to hold months of work rather than a session. Older events fall
 * off rather than being archived, because a local, unverified log is not worth
 * keeping forever and pretending otherwise would be the wrong promise.
 *
 * A deep log only works because events are small. An event that snapshots a
 * whole collection is not: recording the entire chart of accounts on both
 * sides of every edit cost 41 KB an event, which at this depth would be 195 MB
 * of history to track a dropdown. Events carry the thing that changed, not the
 * collection it lives in.
 */
export const MAX_EVENTS = 5000;

let counter = 0;

/** A new event, timestamped now. */
export function makeEvent(
  who: string,
  kind: EventKind,
  summary: string,
  before: unknown,
  after: unknown,
  targetId?: string,
): LedgerEvent {
  const at = new Date().toISOString();
  counter += 1;
  return {
    id: `${at}-${String(counter).padStart(4, "0")}`,
    at,
    who: who.trim() === "" ? "unattributed" : who.trim(),
    kind,
    ...(targetId !== undefined ? { targetId } : {}),
    summary,
    before,
    after,
  };
}

/** Newest first, and never longer than the cap. */
export function appendEvent(
  events: readonly LedgerEvent[],
  event: LedgerEvent,
): LedgerEvent[] {
  return [event, ...events].slice(0, MAX_EVENTS);
}

/**
 * Whether an event can still be undone.
 *
 * A later event on the same target means undoing this one would silently
 * discard the newer decision. Refusing is better than surprising someone, and
 * the newer one can be undone first if that is what they meant.
 */
export function canReverse(
  events: readonly LedgerEvent[],
  event: LedgerEvent,
): { ok: true } | { ok: false; why: string } {
  if (event.reverted === true) return { ok: false, why: "Already undone." };

  const newer = events.filter(
    (e) =>
      e.id > event.id &&
      e.reverted !== true &&
      e.kind === event.kind &&
      e.targetId === event.targetId,
  );
  if (newer.length > 0) {
    const one = newer[newer.length - 1];
    return {
      ok: false,
      why: `Changed again since, by ${one?.who ?? "someone"}. Undo that first.`,
    };
  }
  return { ok: true };
}

/**
 * Put a change back.
 *
 * Returns a new ledger; the caller decides whether to keep it. Only the
 * targeted part is touched, so undoing a coding cannot disturb a chart edit
 * made afterwards.
 */
export function reverse(ledger: StoredLedger, event: LedgerEvent): StoredLedger {
  switch (event.kind) {
    case "manualJournal": {
      // The whole set, because a journal is only meaningful beside the others.
      return { ...ledger, manualJournals: (event.before ?? []) as ManualJournal[] };
    }
    case "disposal": {
      // One asset's proceeds, or the whole set when they were read in at once.
      const proceeds = { ...(ledger.assetProceeds ?? {}) };
      if (event.targetId === "proceeds") {
        return { ...ledger, assetProceeds: (event.before ?? {}) as Record<string, Cents> };
      }
      const before = event.before as Cents | null | undefined;
      if (before === null || before === undefined) delete proceeds[event.targetId ?? ""];
      else proceeds[event.targetId ?? ""] = before;
      return { ...ledger, assetProceeds: proceeds };
    }
    case "openingBalance": {
      // The whole set moves together. They are one statement of a position,
      // and half of it put back would not balance.
      const before = event.before as OpeningBalances | null | undefined;
      if (before === null || before === undefined) {
        const rest = { ...ledger };
        delete rest.openingBalances;
        return rest;
      }
      return { ...ledger, openingBalances: before };
    }
    case "coding": {
      const overrides = { ...(ledger.overrides ?? {}) };
      if (event.before === null || event.before === undefined) delete overrides[event.targetId ?? ""];
      else overrides[event.targetId ?? ""] = event.before as TransactionOverride;
      return { ...ledger, overrides };
    }
    case "split": {
      const splits = { ...(ledger.splits ?? {}) };
      if (event.before === null || event.before === undefined) delete splits[event.targetId ?? ""];
      else splits[event.targetId ?? ""] = event.before as SplitPart[];
      return { ...ledger, splits };
    }
    case "codingBatch": {
      const overrides = { ...(ledger.overrides ?? {}) };
      const batch = (event.before ?? []) as CodingBatchEntry[];
      for (const entry of batch) {
        if (entry.before === null) delete overrides[entry.id];
        else overrides[entry.id] = entry.before;
      }
      return { ...ledger, overrides };
    }
    case "transferBatch": {
      const transfers = { ...(ledger.transfers ?? {}) };
      // Both keys of every pair, because half a transfer is a balance that
      // represents nothing.
      for (const pair of (event.after ?? []) as TransferPair[]) {
        delete transfers[pair.from];
        delete transfers[pair.to];
      }
      return { ...ledger, transfers };
    }
    case "invoiceMatch": {
      const id = event.targetId ?? "";
      const matches = { ...(ledger.invoiceMatches ?? {}) };
      const overrides = { ...(ledger.overrides ?? {}) };

      // Events written before the match carried its coding hold a bare invoice
      // number. Read both shapes so old history still reverses.
      const read = (value: unknown): InvoiceMatchState | null => {
        if (value === null || value === undefined) return null;
        if (typeof value === "string") return { number: value, override: undefined };
        return value as InvoiceMatchState;
      };
      const before = read(event.before);

      if (before === null) {
        delete matches[id];
        // Only an event that recorded the coding may remove it. An old event
        // says nothing about the override, and guessing would delete a coding
        // the person made by hand afterwards.
        if (event.after !== null && typeof event.after === "object") delete overrides[id];
      } else {
        matches[id] = before.number;
        if (before.override !== undefined) overrides[id] = before.override;
      }
      return { ...ledger, invoiceMatches: matches, overrides };
    }
    case "invoice": {
      // The event holds one invoice, so only that invoice moves -- a whole-list
      // snapshot would also undo every other invoice edited since.
      const invoices = [...(ledger.invoices ?? [])];
      const target = (event.after ?? event.before) as Invoice | null;
      if (target === null) return ledger;
      const at = invoices.findIndex((i) => i.number === target.number);
      if (event.before === null || event.before === undefined) {
        if (at >= 0) invoices.splice(at, 1);
      } else if (at >= 0) {
        invoices[at] = event.before as Invoice;
      } else {
        invoices.push(event.before as Invoice);
      }
      return { ...ledger, invoices };
    }
    case "transfer": {
      const transfers = { ...(ledger.transfers ?? {}) };
      const pair = (event.after ?? event.before) as TransferPair | null;
      if (pair === null) return ledger;
      delete transfers[pair.from];
      delete transfers[pair.to];
      if (event.before !== null && event.before !== undefined) {
        const restore = event.before as TransferPair;
        transfers[restore.from] = restore.to;
        transfers[restore.to] = restore.from;
      }
      // Putting a pairing back also takes back the "not a transfer" that
      // unlinking recorded. Leaving it would be a note saying the opposite of
      // what the books now say.
      const rejectedTransfers = (ledger.rejectedTransfers ?? []).filter(
        (id) => id !== pair.from && id !== pair.to,
      );
      return { ...ledger, transfers, rejectedTransfers };
    }
    case "chart": {
      // The event holds one account, so only that account moves. A whole-chart
      // snapshot would also undo every edit made to other accounts since.
      const chart = [...(ledger.chart ?? [])];
      const key = (a: Account) => `${a.code}|${a.name}`;
      const target = (event.after ?? event.before) as Account | null;
      if (target === null) return ledger;
      const index = chart.findIndex((a) => key(a) === key(target));
      if (event.before === null || event.before === undefined) {
        if (index >= 0) chart.splice(index, 1);
      } else if (index >= 0) {
        chart[index] = event.before as Account;
      } else {
        chart.push(event.before as Account);
      }
      return { ...ledger, chart };
    }
    case "entities":
      return { ...ledger, entities: event.before as EntityModel };
    case "taxExtras":
      return { ...ledger, taxExtras: (event.before ?? []) as NonNullable<StoredLedger["taxExtras"]> };
    // Rules live outside the ledger, so the caller applies these itself.
    case "rule":
    case "codeTreatment":
      return ledger;
  }
}

/** Rule changes are reversed against the rule set, not the ledger. */
export function reverseRule(
  rules: { rules?: CategoryRule[]; codeTreatments?: Record<string, unknown> },
  event: LedgerEvent,
): { rules?: CategoryRule[]; codeTreatments?: Record<string, unknown> } {
  if (event.kind === "rule") {
    const list = [...(rules.rules ?? [])];
    const index = Number(event.targetId);
    if (!Number.isInteger(index)) return rules;
    if (event.before === null || event.before === undefined) list.splice(index, 1);
    else if (event.after === null || event.after === undefined) {
      list.splice(index, 0, event.before as CategoryRule);
    } else list[index] = event.before as CategoryRule;
    return { ...rules, rules: list };
  }
  if (event.kind === "codeTreatment") {
    const treatments = { ...(rules.codeTreatments ?? {}) };
    if (event.before === null || event.before === undefined) delete treatments[event.targetId ?? ""];
    else treatments[event.targetId ?? ""] = event.before;
    return { ...rules, codeTreatments: treatments };
  }
  return rules;
}

/** Human wording for the kinds, used in the history list. */
export const KIND_LABELS: Record<EventKind, string> = {
  coding: "Coding",
  split: "Split",
  chart: "Chart of accounts",
  entities: "Entities",
  codingBatch: "Coding (batch)",
  transferBatch: "Transfers (batch)",
  invoiceMatch: "Invoice match",
  invoice: "Invoice",
  transfer: "Transfer",
  openingBalance: "Opening balances",
  disposal: "Asset disposal",
  manualJournal: "Manual journal",
  rule: "Rule",
  codeTreatment: "GST treatment",
  taxExtras: "Other income",
};
