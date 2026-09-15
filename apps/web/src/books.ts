import { redraw, showPage } from "./app.js";
import { appendEvent, makeEvent } from "./events.js";
import type { EventKind } from "./events.js";
import { knownCodes, suggest, transferCandidates } from "./reconcile.js";
import type { Suggestion } from "./reconcile.js";
import { describeRules } from "./rules-ui.js";
import { buildRows } from "./variance.js";
import type { VarianceInput } from "./variance.js";
import type { RuleFileShape } from "./rules-ui.js";
import { caches, state } from "./state.js";
import { clearStore, emptyLedger, saveEvents, savePart, saveRules } from "./store.js";
import {
  agentStatementJournal,
  agentStatementProblems,
  DEFAULT_ENTITY_NAME,
  chartTreatments,
  codingCounts,
  codingEngine,
  depreciationJournals as coreDepreciationJournals,
  disposalJournals as coreDisposalJournals,
  proceedsFromDisposalJournals,
  decodeText,
  invoiceBalancesFor,
  postLedger,
  readXlsx,
  sheetToCsv,
  dedupe,
  defaultEntityModel,
  accountEntityKey,
  emptyEntityModel,
  formatAmount,
  labelForChartAccount,
  splitAccountLabel,
  invoiceAssignments as coreInvoiceAssignments,
  mapToOurVocabulary as coreMapToOurVocabulary,
  sameEntityBanks as coreSameEntityBanks,
} from "@nzosa/core";
import type {
  Account,
  Cents,
  ManualJournal,
  CodingCounts,
  CodingEngine,
  EntityModel,
  InvoiceBalance,
  PostedJournal,
  RuleSet,
  Transaction,
} from "@nzosa/core";

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

/**
 * Whether a line has been given an account, by any route: a confirmed code, a
 * split, or an invoice it settles.
 *
 * Built once and asked many times, since the invoice matching behind it is not
 * cheap to ask for line by line.
 */
export function accountDecided(): (id: string) => boolean {
  const overrides = state.ledger.overrides ?? {};
  const splits = state.ledger.splits ?? {};
  const assigned = invoiceAssignments();
  return (id) => {
    const override = overrides[id];
    return (
      (override?.confirmed === true && (override.code ?? "") !== "") ||
      splits[id] !== undefined ||
      assigned.has(id)
    );
  };
}

/**
 * Lines recorded as a transfer and given an account as well.
 *
 * The books have no meaning for that. Posted, the transfer wins and the
 * account gets nothing, so a receipt coded to sales that is also paired as a
 * transfer is silently missing from the profit and loss -- which is how two
 * customer payments left real books. Nothing should make one any more; this
 * finds any made before that was so.
 */
export function transfersAlsoCoded(): Transaction[] {
  const transfers = state.ledger.transfers ?? {};
  const decided = accountDecided();
  return state.ledger.transactions.filter(
    (t) => transfers[t.id] !== undefined && decided(t.id),
  );
}

/**
 * Bank lines coded to Accounts Receivable or Payable that settle no invoice.
 *
 * Coded that way a payment clears the balance, but no invoice is marked paid:
 * the invoice still shows as owing, and receivables are overstated by exactly
 * the payment until somebody notices. Matching it to its invoice is the fix,
 * so each one is listed where that can be done.
 *
 * Payables only once there are bills to match against. Without them a payment
 * of an old bill coded to payables is the right answer, not a loose end.
 */
export function clearingWithoutInvoice(): Transaction[] {
  const overrides = state.ledger.overrides ?? {};
  const splits = state.ledger.splits ?? {};
  const transfers = state.ledger.transfers ?? {};
  const assigned = invoiceAssignments();
  const bills = (state.ledger.invoices ?? []).some((i) => i.kind === "purchase");
  const receivable = /\b610\b|accounts\s+receivable/i;
  const payable = /\b800\b|accounts\s+payable/i;
  const flagged = (code: string | undefined): boolean =>
    code !== undefined && (receivable.test(code) || (bills && payable.test(code)));

  return state.ledger.transactions.filter((t) => {
    if (transfers[t.id] !== undefined || assigned.has(t.id)) return false;
    const parts = splits[t.id];
    if (parts !== undefined) {
      return parts.some(
        (part, index) => flagged(part.code) && !assigned.has(`${t.id}:${index + 1}`),
      );
    }
    const override = overrides[t.id];
    return override?.confirmed === true && flagged(override.code);
  });
}

/**
 * Refuse to code a line that is one leg of a recorded transfer, and say why.
 *
 * True when refused. Every route that confirms a coding asks this first, so
 * none of them can put an account on a transfer behind the others' backs.
 */
export function codingRefusedForTransfer(transaction: Transaction): boolean {
  if ((state.ledger.transfers ?? {})[transaction.id] === undefined) return false;
  alert(
    `${transaction.date} ${formatAmount(transaction.amount)} ${transaction.otherParty} is recorded as a ` +
      "transfer between your own accounts, so it cannot be coded to an account as well.\n\n" +
      'If it is not a transfer, press "not a transfer" on it on the Reconcile page, then code it.',
  );
  return true;
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
    unregisteredCode(),
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

  /**
   * Whether a line has been given an account, by any of the ways there are.
   *
   * A code is the usual one. A split is a better one -- it is what the line
   * actually was. An invoice match is the third: a receipt settling an invoice
   * posts against the debtor rather than to an account of its own.
   */
  const hasCoding = (one: Suggestion): boolean =>
    one.code !== null ||
    (state.ledger.splits ?? {})[one.transaction.id] !== undefined ||
    invoiceAssignments().has(one.transaction.id);

  /**
   * A line that needs nothing further.
   *
   * Confirmed is not enough on its own. A line confirmed with no account is a
   * decision to post nothing, which is not a decision anybody means to make --
   * and because confirming took it out of this queue, it left no trace: on
   * these books 33 receipts worth 20,551.49 had been accepted in bulk with no
   * code, were absent from every report, and showed nowhere as outstanding.
   * So it stays in the queue until it has an account.
   */
  const settled = (one: Suggestion): boolean =>
    (one.confirmed && hasCoding(one)) || linked[one.transaction.id] !== undefined;

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

/**
 * Put the rules back where they came from.
 *
 * Rules are edited from three screens and undone from a fourth, and every one
 * of them has to leave the same file behind. The dirty flag clears here rather
 * than at each call site for the same reason: whether there is unsaved work is
 * a fact about the rules, not about whichever screen last touched them.
 */
export async function persistRules(): Promise<void> {
  const file = state.rules as RuleFileShape | undefined;
  if (!file) return;
  await saveRules({
    version: 1,
    name: state.rulesName,
    loadedAt: state.rulesLoadedAt,
    rules: file,
  });
  state.rulesDirty = false;
  if (state.page === "rules") redraw("rules");
}

/**
 * An account, paired with the name a coding actually stores against it.
 *
 * These are not the same string. A chart export calls an account `310` /
 * `Cost of Goods Sold`; the rules, and therefore every coded transaction and
 * every GST treatment, call it `NB Cost of Goods Sold - 310`. Looking a
 * treatment up by anything else silently finds nothing, which would show every
 * account as untreated and write new treatments under names nothing reads.
 */
export interface AccountRow {
  account: Account;
  /** The key used in codeTreatments and stored on a coding. */
  label: string;
}

/**
 * Every account worth showing: the chart, plus anything the rules already
 * name.
 *
 * A chart export is not the whole picture. Sixteen accounts here exist only as
 * a GST treatment, because no keyword will ever match them -- deciding a meal
 * was non-deductible is a judgement, not a payee.
 */
export function accountsForEditing(): AccountRow[] {
  const known = knownCodes(state.rules, state.ledger.overrides ?? {});
  const out: AccountRow[] = [];
  const claimed = new Set<string>();

  for (const account of state.chart) {
    const label = labelForChartAccount(account, known);
    claimed.add(label);
    out.push({ account, label });
  }

  for (const code of known) {
    if (claimed.has(code)) continue;
    claimed.add(code);
    const { code: digits, name } = splitAccountLabel(code);
    out.push({
      account: { code: digits, name, type: "From the rules", taxCode: "", description: "" },
      label: code,
    });
  }

  return out.sort((a, b) =>
    (a.account.code || "zzz").localeCompare(b.account.code || "zzz") ||
    a.account.name.localeCompare(b.account.name),
  );
}

/** Set once the demo has been seeded, or a book deliberately cleared. */
export const DEMO_SEEDED = "nzosa:demo-seeded";

/** Remember that this browser has had its one automatic seed. */
export function markDemoSeeded(): void {
  try {
    localStorage.setItem(DEMO_SEEDED, new Date().toISOString());
  } catch {
    // Nothing to do: without storage the seed simply happens again next time,
    // which is the same as any other browser that keeps nothing.
  }
}

/**
 * Empty the browser's store, in memory and on disk.
 *
 * Shared by the demo loader and the clear button: loading a demo over a part
 * coded book would leave the old book's decisions attached to transactions
 * that are no longer there.
 */
export async function wipe(): Promise<void> {
  state.ledger = emptyLedger();
  state.chart = [];
  state.rules = undefined;
  state.rulesName = "";
  state.rulesLoadedAt = "";
  state.rulesArchive = { version: 1, entries: [] };
  state.suggestions = null;
  state.reference = [];
  state.events = [];
  state.startupMessage = "";
  // Cleared means cleared: without this the automatic seed refills the browser
  // on the next refresh, and a clear that undoes itself is indistinguishable
  // from one that never worked.
  markDemoSeeded();
  await clearStore();
}

export async function clearEverything(button: HTMLButtonElement): Promise<void> {
  button.disabled = true;
  await wipe();
  reclassify();
  state.entityFilter = "";
  showPage("setup");
}

/** Said, and the answer is that this ledger holds no money in this account. */
export const NOT_IN_LEDGER = "none";

/**
 * The ledger account a chart's bank row is, if it is one of them.
 *
 * The same account has two names: the accounting system calls it "BNZ
 * Advantage Visa Classic" and the ledger calls it by the id the bank feed
 * gives, so neither recognises the other. Matched on the id, or on the
 * ledger's own label for the account word for word -- and on nothing looser.
 * "Platinum Credit Card used for Business Transactions" and "BNZ Advantage
 * Visa Platinum" are the same card to a person and nothing a computer should
 * decide, and a wrong guess here files somebody's spending under another
 * entity.
 */
export function ledgerAccountFor(name: string, account?: Account): string | null {
  // What somebody said, before anything a name suggests. "Platinum Credit
  // Card used for Business Transactions" is the same card as the one the feed
  // calls by its id, and only a person can know that.
  const said = account?.ledgerAccount;
  // Case-insensitively: a chart edited by hand, or written by another tool,
  // holds "None" as readily as "none", and reading one of them as the name of
  // a ledger account maps the row to an account that does not exist.
  if (said !== undefined && said.trim().toLowerCase() === NOT_IN_LEDGER) return null;
  if (said !== undefined && said !== "") return said;

  const wanted = name.trim();
  const { accounts, labels } = banks();
  if (accounts.has(wanted)) return wanted;
  const tidy = (text: string): string => text.trim().toLowerCase().replace(/\s+/g, " ");
  const target = tidy(wanted);
  for (const [id, label] of labels) if (tidy(label) === target) return id;
  return null;
}

/** The sentence that has to be typed before anything is cleared. */
export const CLEAR_PHRASE = "Confirm this will clear all records";

export async function useRules(rules: RuleFileShape, name: string, verb: string): Promise<void> {
  state.rules = rules;
  state.rulesName = name;
  state.rulesLoadedAt = new Date().toISOString().slice(0, 16).replace("T", " ");
  state.pendingRules = null;
  state.rulesMessage = `${verb} ${name}: ${describeRules(rules)}.`;
  await saveRules({ version: 1, name, loadedAt: state.rulesLoadedAt, rules });
  redraw("rules");
}

export function recomputeVariance(): void {
  if (state.filed.length === 0) {
    state.varianceRows = [];
    return;
  }
  state.varianceRows = buildRows(state.filed, varianceInput());
}

/**
 * What a GST return is recomputed from.
 *
 * One definition, used for the comparison with filed returns and for the
 * returns listed to be marked as filed, so the figure recorded as filed is the
 * figure the comparison would have produced.
 */
export function varianceInput(): VarianceInput {
  return {
    transactions: state.ledger.transactions,
    splits: state.ledger.splits ?? {},
    overrides: state.ledger.overrides ?? {},
    rules: state.rules,
    notes: state.ledger.varianceNotes ?? [],
    // A pairing the ledger posts as a transfer is out of scope on the return
    // too, rather than left to what the bank line happens to say.
    transfers: state.ledger.transfers ?? {},
    // The same fallback the profit and loss uses, so an account treated by the
    // chart is treated the same way in both.
    chartTreatment: (code: string) => chartTreatmentOf(code),
    // A line of an entity not registered for GST is on no return.
    unregistered: unregisteredCode(),
    // Narrowed by the chosen entity, as every other page's selection is.
    // Choosing an entity narrowed the account chips here and left the figures
    // alone, so a page headed by one company's name compared everybody's bank
    // accounts against that company's filed returns and reported the rest of
    // the household as a disagreement.
    accounts: accountsFor(state.varianceAccounts),
  };
}

export function invoiceBalanceMap(): Map<string, InvoiceBalance> {
  return invoiceBalancesFor({
    invoices: state.ledger.invoices ?? [],
    transactions: state.ledger.transactions,
    splits: state.ledger.splits ?? {},
    assignments: invoiceAssignments(),
    credits: state.ledger.creditNotes ?? {},
  });
}

export function bankLabel(account: string): string {
  return banks().labels.get(account) ?? account;
}

export function codingProgress(): CodingCounts {
  if (
    caches.coded !== undefined &&
    caches.coded.transactions === state.ledger.transactions &&
    caches.coded.rules === state.rules
  ) {
    return caches.coded.counts;
  }
  const counts = codingCounts(state.ledger.transactions, {
    ...((state.rules as RuleFileShape | undefined) ?? {}),
    overrides: state.ledger.overrides ?? {},
  } as RuleSet);
  caches.coded = { transactions: state.ledger.transactions, rules: state.rules, counts };
  return counts;
}

export function cachedChartTreatments(): Map<string, unknown> {
  // Built once and kept until one of the three things it derives from is
  // replaced. It is consulted per transaction, and rebuilding a ninety-row map
  // three thousand times is the difference between a report and a wait.
  // Identity is the key rather than a flag somebody has to remember to clear:
  // the chart, the rules and the ledger are all replaced wholesale, never
  // edited in place, so a stale cache cannot survive a change.
  if (
    caches.chartTreatment !== null &&
    caches.chartTreatment.chart === state.chart &&
    caches.chartTreatment.rules === state.rules &&
    caches.chartTreatment.ledger === state.ledger
  ) {
    return caches.chartTreatment.map;
  }

  // The map itself is core's; what stays here is the cache in front of it.
  const map: Map<string, unknown> = chartTreatments(
    state.chart,
    state.rules,
    state.ledger.overrides ?? {},
  );

  caches.chartTreatment = {
    chart: state.chart,
    rules: state.rules,
    ledger: state.ledger,
    map,
  };
  return map;
}

/**
 * Which codes are accounts of an entity not registered for GST.
 *
 * Asked once for a whole page rather than per line: the answer comes from the
 * entities and the chart, which do not change while a page is drawn. A code
 * with no entity is not in the set, so books that have never been divided
 * into entities are treated exactly as before.
 */
export function unregisteredCode(): (code: string) => boolean {
  const model = state.ledger.entities ?? emptyEntityModel();
  const unregistered = new Set(
    model.entities.filter((e) => e.gstRegistered === false).map((e) => e.id),
  );
  if (unregistered.size === 0) return () => false;
  const codes = new Set<string>();
  for (const { account, label } of accountsForEditing()) {
    const id = model.accounts[accountEntityKey(account)];
    if (id !== undefined && unregistered.has(id)) codes.add(label);
  }
  return (code) => codes.has(code);
}

export function chartTreatmentOf(label: string): unknown | null {
  return cachedChartTreatments().get(label) ?? null;
}

/**
 * Coding and GST, set up once for a report.
 *
 * Splits are expanded first: a payment divided across accounts reaches the
 * profit figure as its parts, not as whichever code the parent carries.
 */
export function reportEngine(): CodingEngine | null {
  // Coding and GST treatment are decided together in core, because a
  // correction to either has to reach both. This says only where the app keeps
  // the inputs -- and passes the chart lookup rather than repeating it, so a
  // report and the Entities page cannot come to different answers.
  return codingEngine({
    transactions: state.ledger.transactions,
    splits: state.ledger.splits ?? {},
    overrides: state.ledger.overrides ?? {},
    ...(state.rules ? { rules: state.rules as RuleFileShape } : {}),
    chartTreatment: (code: string) => chartTreatmentOf(code) as never,
    unregistered: unregisteredCode(),
  });
}

/**
 * A dropped file as CSV text, whichever of the two shapes it arrived in.
 *
 * The readers here are written against the CSV a system exports, because that
 * is where the column names are stable. But the same report often comes out of
 * the same system as a spreadsheet -- Xero's Journal Report does -- and
 * refusing it means going back to export it again in another format, knowing
 * to. The sheet is turned into the text the reader already understands.
 */
export async function asCsvText(name: string, bytes: Uint8Array): Promise<string> {
  // A spreadsheet is a zip, and every zip starts "PK". Checked as well as the
  // extension, because a spreadsheet saved as .csv is still a zip inside.
  const zipped = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (/[.]xlsx$/i.test(name) || zipped) {
    const workbook = await readXlsx(bytes);
    const sheet = workbook.sheets[0];
    if (sheet !== undefined) return sheetToCsv(sheet);
  }

  // A plain UTF-8 read mangles anything written in Windows-1252, which is what
  // Xero writes. `decodeText` tries UTF-8 strictly and falls back.
  return decodeText(bytes);
}

/**
 * What each disposed asset sold for, as the journal report's disposal journals
 * say.
 *
 * Read rather than asked for: the other system has already posted the sale,
 * and its journal carries everything needed to work the proceeds back out.
 */
export function importedAssetProceeds(): Map<string, Cents> {
  return proceedsFromDisposalJournals({
    assets: state.ledger.assets ?? [],
    journals: state.ledger.journals ?? [],
    transactions: state.ledger.transactions,
  });
}

/**
 * The proceeds the disposals are posted with.
 *
 * An amount entered by hand wins, because it is a person's decision; the
 * journal report fills in every disposal nobody has entered.
 */
export function assetProceedsInUse(): Record<string, Cents> {
  return {
    ...Object.fromEntries(importedAssetProceeds()),
    ...(state.ledger.assetProceeds ?? {}),
  };
}

function disposalJournals(options: {
  resolveAccount: (code: string) => { code: string; name: string };
}): PostedJournal[] {
  return coreDisposalJournals({
    assets: state.ledger.assets ?? [],
    proceeds: assetProceedsInUse(),
    transactions: state.ledger.transactions,
    chart: state.chart,
    posting: options,
  });
}

function depreciationJournals(): PostedJournal[] {
  // The matching and the arithmetic are in core, where they are tested. The
  // `resolveAccount` this used to take was never read.
  return coreDepreciationJournals({
    assets: state.ledger.assets ?? [],
    transactions: state.ledger.transactions,
    chart: state.chart,
  });
}

/**
 * Post the ledger as double entry.
 *
 * Postings are derived, not stored: recomputed from the transaction and its
 * coding every time, so correcting a rule corrects the journal. The bank data
 * stays the source of truth.
 *
 * Split lines are posted from their expanded rows rather than their raw parts,
 * because a part written without a side has one resolved for it from the
 * direction of the money — posting the raw part would silently drop its GST.
 */
/**
 * The journals property manager statements imply, for the ones that add up.
 *
 * One that does not is left out rather than posted with its gap, the same rule
 * a manual journal is held to; the statements page says why.
 */
export function agentStatementJournals(): ManualJournal[] {
  return (state.ledger.agentStatements ?? [])
    .filter((statement) => agentStatementProblems(statement).length === 0)
    .map((statement) => agentStatementJournal(statement));
}

export function postedJournals(): PostedJournal[] {
  // Composition is in core, where the three rules that go expensively wrong --
  // a settled invoice not counting as a fresh sale, a transfer posting once
  // rather than twice, judgements coming last -- are tested. This gathers what
  // the app knows and hands it over.
  const engine = reportEngine();
  if (!engine) return [];

  // Built once, not once per lookup: this is called for every line of every
  // journal, and rebuilding the chart index inside it made posting the ledger
  // quadratic in the size of the chart.
  const byName = new Map(state.chart.map((a) => [a.name.trim().toLowerCase(), a]));
  const resolveAccount = (code: string): { code: string; name: string } => {
    const { code: digits, name } = splitAccountLabel(code);
    const account = byName.get(name.toLowerCase());
    return { code: digits || account?.code || "", name: account?.name ?? name };
  };

  return postLedger({
    transactions: engine.transactions,
    codeOf: engine.codeOf,
    classify: engine.classify,
    chart: state.chart,
    bankLabels: new Map(
      state.ledger.transactions.map((t) => [
        t.account,
        String(t.extras?.["accountLabel"] ?? t.account),
      ]),
    ),
    byId: new Map(state.ledger.transactions.map((t) => [t.id, t])),
    invoices: state.ledger.invoices ?? [],
    settled: invoiceAssignments(),
    transfers: state.ledger.transfers ?? {},
    // A property manager's statement posts as a journal of its own, derived
    // each time so an edited statement cannot leave its old journal behind.
    manualJournals: [...(state.ledger.manualJournals ?? []), ...agentStatementJournals()],
    assetJournals: [...depreciationJournals(), ...disposalJournals({ resolveAccount })],
  });
}

/**
 * Keep a set of manual journals with the books.
 *
 * Year-end adjustments are the entries nobody can re-derive: an accountant
 * decided them, and they exist in the other system's journal report and
 * nowhere else. They are saved here rather than from the page that happened to
 * read them, because two screens now take them -- the Reports page on request,
 * and the file load as the report arrives -- and both have to leave the same
 * books behind.
 *
 * `reclassify` runs because a manual journal changes what the coding queue has
 * left to say about a transaction.
 */
export async function saveManualJournals(journals: ManualJournal[], what: string): Promise<void> {
  const before = state.ledger.manualJournals ?? null;
  state.ledger = { ...state.ledger, manualJournals: journals };
  state.persistent = await savePart(state.ledger);
  await record("manualJournal", what, before, journals, "manualJournals");
  reclassify();
  redraw("reports");
}
