import { redraw } from "./app.js";
import { appendEvent, makeEvent } from "./events.js";
import type { EventKind } from "./events.js";
import { suggest, transferCandidates } from "./reconcile.js";
import type { Suggestion } from "./reconcile.js";
import { caches, state } from "./state.js";
import { saveEvents, savePart } from "./store.js";
import {
  DEFAULT_ENTITY_NAME,
  dedupe,
  defaultEntityModel,
  emptyEntityModel,
  formatAmount,
  invoiceAssignments as coreInvoiceAssignments,
  mapToOurVocabulary as coreMapToOurVocabulary,
  sameEntityBanks as coreSameEntityBanks,
} from "@nzosa/core";
import type { Account, EntityModel, RuleSet } from "@nzosa/core";

/**
 * What every page asks of the books, and what changes them.
 *
 * These are the questions no single page owns. Which accounts the bank
 * statements mention, which lines are still waiting to be coded, which
 * payments settle which invoices -- the coding queue asks, the reports ask,
 * the entity screen asks, and all three have to get the same answer or the
 * page beside you disagrees with the one in front of you.
 *
 * None of it is the accounting. The rules that decide what a transfer is, or
 * which payment clears which invoice, are in core where they are tested
 * against figures. What is here is the binding between those rules and the
 * state this app happens to be holding: the arguments, the caches keyed on
 * the ledger they were derived from, and the save that tells a page it is
 * now out of date.
 *
 * That binding is the reason they could not stay in `main.ts`. A page that
 * needed one of them had to be in the same file as it, which meant every page
 * was in the same file as every other.
 */

/**
 * Re-run deduplication over the whole ledger.
 *
 * Cheap enough to do on every change at this size, and it means the displayed
 * status is always derived from the current allowlist rather than cached from
 * whenever the import happened.
 */
export function reclassify(): void {
  state.entries = dedupe(state.ledger.transactions, {
    legitimateDuplicates: state.ledger.legitimateDuplicates,
  }).entries;
}

export function banks(): { accounts: Set<string>; labels: Map<string, string> } {
  const source = state.ledger.transactions;
  if (caches.bank?.source === source) return caches.bank;

  const accounts = new Set<string>();
  const labels = new Map<string, string>();
  for (const t of source) {
    accounts.add(t.account);
    if (!labels.has(t.account)) {
      const label = t.extras?.["accountLabel"] as string | undefined;
      if (label !== undefined) labels.set(t.account, label);
    }
  }
  caches.bank = { source, accounts, labels };
  return caches.bank;
}

/**
 * Drop the bank rows a saved chart carries, once they have been read.
 *
 * The chart this app writes ends with one row per bank account, named by the
 * ledger's own account id, so that which entities an account pays for
 * survives a browser being cleared. They are a way of carrying the mapping in
 * a file, not accounts anybody keeps books in -- and loading that file back
 * put them in the chart beside the accounting system's own bank accounts, so
 * "BNZ 01 - Trading Account" and "02-1100-0022001-000" both sat
 * there as separate accounts. They are one account.
 *
 * Read for their entity column first, by applyChartColumns, and dropped here
 * afterwards. Only rows naming an account the ledger actually holds money in:
 * a bank account the accounting system named itself is a real chart row and
 * stays.
 */
export function withoutBankMapping(chart: readonly Account[]): Account[] {
  const held = banks().accounts;
  return chart.filter((a) => !(a.type === "Bank" && held.has(a.name.trim())));
}

/**
 * The bank accounts the chosen entity uses.
 *
 * Empty means no restriction, which is both the answer for "all entities" and
 * the honest answer when an entity has no bank account assigned yet — showing
 * nothing at all would look like a fault rather than a gap in the setup.
 */
export function entityBankAccounts(): string[] {
  if (state.entityFilter === "") return [];
  const model = state.ledger.entities ?? emptyEntityModel();
  const mine = Object.entries(model.banks)
    .filter(([, ids]) => ids.includes(state.entityFilter))
    .map(([account]) => account);
  return mine;
}

/** A page's account selection, narrowed by the entity when one is chosen. */
export function accountsFor(chosen: readonly string[]): string[] {
  const entity = entityBankAccounts();
  if (chosen.length === 0) return entity;
  if (entity.length === 0) return [...chosen];
  return chosen.filter((account) => entity.includes(account));
}

/**
 * The bank accounts kept for the same entity as this one.
 *
 * `scoped` says whether an entity actually decided it. With no entity model
 * set up there is nothing to scope by, and refusing every candidate would make
 * the feature look broken rather than unconfigured -- so every account is
 * offered and the caller says the scoping is missing.
 */
export function sameEntityBanks(account: string): { accounts: Set<string>; scoped: boolean } {
  return coreSameEntityBanks(account, {
    model: state.ledger.entities ?? emptyEntityModel(),
    allBanks: banks().accounts,
  });
}

export function transferSuggestions(): Set<string> {
  if (caches.transfer !== null && caches.transfer.ledger === state.ledger) {
    return caches.transfer.ids;
  }
  const transfers = state.ledger.transfers ?? {};
  const taken = new Set(Object.keys(transfers));
  const ids = new Set<string>();
  for (const transaction of state.ledger.transactions) {
    if (taken.has(transaction.id)) continue;
    const { accounts } = sameEntityBanks(transaction.account);
    const candidates = transferCandidates(transaction, state.ledger.transactions, {
      sameEntity: accounts,
      taken,
    });
    if (candidates.length > 0) ids.add(transaction.id);
  }
  caches.transfer = { ledger: state.ledger, ids };
  return ids;
}

export function invoiceAssignments(): Map<string, string> {
  // Cached against the ledger it was built from, because this is asked for on
  // every render and the matching is not cheap. The rules themselves are in
  // core, where the ordering that stops a payment being counted twice is
  // tested.
  if (caches.assignment !== null && caches.assignment.ledger === state.ledger) {
    return caches.assignment.map;
  }
  const settled = coreInvoiceAssignments({
    invoices: state.ledger.invoices ?? [],
    transactions: state.ledger.transactions,
    ...(state.ledger.allocations ? { allocations: state.ledger.allocations } : {}),
    accepted: state.ledger.invoiceMatches ?? {},
    splits: state.ledger.splits ?? {},
  });
  caches.assignment = { ledger: state.ledger, map: settled };
  return settled;
}

/**
 * The reconcile lines, and which of them the filter and search leave showing.
 *
 * One definition, used both to draw the rows and to accept them in bulk. If
 * the two ever disagreed, "accept all" would confirm lines that were not on
 * screen -- which is the one thing a bulk action must never do.
 */
export function reconcileRows(): { all: Suggestion[]; shown: Suggestion[] } {
  const all = suggest(
    state.ledger.transactions,
    state.rules,
    state.ledger.overrides ?? {},
    accountsFor(state.reconcileAccounts),
  );
  // Collapsed, because the search is matched against what the row shows and
   // the row shows collapsed whitespace. A bank pads its fields -- the payee is
  // stored as "Bright   Valley" and drawn as "Bright Valley" -- so typing what is on
  // screen found nothing at all.
  const collapse = (text: string): string => text.replace(/\s+/g, " ").trim().toLowerCase();
  const needle = collapse(state.reconcileSearch);

  /**
   * A line that needs nothing further, whether or not it has a code.
   *
   * A transfer between your own accounts is settled by being paired: there is
   * no coding to confirm and its tick has nothing left to do. Asking only
   * whether a line was confirmed left every paired transfer sitting in "still
   * to confirm" for ever, unable to leave, because confirming was the one
   * thing it could not be made to do.
   */
  const linked = state.ledger.transfers ?? {};
  const settled = (one: Suggestion): boolean =>
    one.confirmed || linked[one.transaction.id] !== undefined;

  const shown = all.filter((one) => {
    if (state.reconcileFilter === "todo" && settled(one)) return false;
    if (state.reconcileFilter === "coded" && !settled(one)) return false;
    // A line with no code is one no rule matched. Confirming it means deciding
    // what it is, rather than agreeing with a suggestion.
    if (state.reconcileFilter === "nocode") {
      const suggested =
        one.code !== null ||
        // A split is a coding, and a better one than a single code: it is what
        // the line actually was. Left out, a payment already divided correctly
        // fell into "nothing suggested" and stayed there.
        (state.ledger.splits ?? {})[one.transaction.id] !== undefined ||
        invoiceAssignments().has(one.transaction.id) ||
        transferSuggestions().has(one.transaction.id);
      if (settled(one) || suggested) return false;
    }
    // The mirror of "no code suggested", and the one that makes accepting in
    // bulk work. Suggestions are scattered through thousands of lines, so
    // "accept everything on screen" met screen after screen with nothing on it
    // to accept; this gathers them.
    // A suggestion is not only a code. The matcher offers invoices and
    // transfers too, and a line carrying one of those had nothing in the code
    // column -- so it fell into "no code suggested" and was hidden from the
    // list whose whole job is gathering what is waiting to be agreed to.
    if (state.reconcileFilter === "suggested") {
      const suggested =
        one.code !== null ||
        // A split is a coding, and a better one than a single code: it is what
        // the line actually was. Left out, a payment already divided correctly
        // fell into "nothing suggested" and stayed there.
        (state.ledger.splits ?? {})[one.transaction.id] !== undefined ||
        invoiceAssignments().has(one.transaction.id) ||
        transferSuggestions().has(one.transaction.id);
      if (settled(one) || !suggested) return false;
    }
    if (needle === "") return true;
    // Everything shown on the row is searchable, including the reference and
    // the counterparty account: searching for what you can see should find it.
    const hay = [
      one.transaction.otherParty,
      one.transaction.particulars ?? "",
      one.transaction.reference ?? "",
      one.transaction.otherPartyAccount ?? "",
      // Both forms of the amount: the bare number, and the one with cents that
      // the row actually prints. Only the first was here, so searching for the
      // "56.00" on screen missed a line holding "56".
      String(one.transaction.amount / 100),
      formatAmount(one.transaction.amount),
      one.code ?? "",
    ].join(" ");
    return collapse(hay).includes(needle);
  });

  return { all, shown };
}

/** Just the lines on screen, for anything that acts on what you can see. */
export function shownSuggestions(): Suggestion[] {
  return reconcileRows().shown;
}

/** `910 - Loan from Director` -> whatever the rules already call account 910. */
export function mapToOurVocabulary(code: string): string | null {
  return coreMapToOurVocabulary(code, {
    chart: state.chart,
    ...(state.rules ? { rules: state.rules as RuleSet } : {}),
    overrides: state.ledger.overrides ?? {},
  });
}

/**
 * Record a change.
 *
 * Called beside the write, not instead of it: state remains the source of
 * truth and this is the log alongside. `before` is what makes it reversible,
 * so it has to be captured before the change is applied — a recorder that
 * reads current state has already lost the thing it needs.
 */
export async function record(
  kind: EventKind,
  summary: string,
  before: unknown,
  after: unknown,
  targetId?: string,
): Promise<void> {
  const event = makeEvent(state.who, kind, summary, before, after, targetId);
  state.events = appendEvent(state.events, event);
  await saveEvents(state.events);
}

export async function saveEntities(model: EntityModel, what = "Entities changed"): Promise<void> {
  const before = state.ledger.entities;
  state.ledger = { ...state.ledger, entities: model };
  state.persistent = await savePart(state.ledger, "entities");
  await record("entities", what, before ?? null, model);
  redraw("entities");
}

/**
 * Give a ledger its one entity, if it has none.
 *
 * Books that hold one company used to have no entity at all, and every screen
 * then had to explain what nothing meant: a filter that hid itself, a chart
 * that counted nought assigned, a bank account "not assigned to an entity
 * yet". One entity holding everything says the same thing and reads as a fact
 * rather than an omission, and it gives the person something to rename to
 * their own company on the first day.
 *
 * It changes no figure. Everything belongs to it, so nothing is excluded from
 * anything.
 *
 * Only ever when there are none. Sweeping later arrivals into a lone entity
 * looked like the same kindness and is the opposite: a ledger with one
 * company in it has accounts deliberately left out of that company -- the
 * personal half of a shared bank account -- and assigning those to it would
 * quietly move somebody's groceries into a company's expenses.
 */
export async function ensureDefaultEntity(): Promise<void> {
  const model = state.ledger.entities ?? emptyEntityModel();
  if (model.entities.length > 0) return;
  const bankAccounts = [...banks().accounts];
  if (state.chart.length === 0 && bankAccounts.length === 0) return;
  await saveEntities(
    defaultEntityModel(state.chart, bankAccounts),
    `Started with one entity, ${DEFAULT_ENTITY_NAME}`,
  );
}

/** Strip them from the stored chart, if any are there. */
export async function tidyChart(): Promise<void> {
  const tidied = withoutBankMapping(state.chart);
  if (tidied.length === state.chart.length) return;
  state.chart = tidied;
  state.ledger = { ...state.ledger, chart: tidied };
  state.persistent = await savePart(state.ledger, "chart");
}
