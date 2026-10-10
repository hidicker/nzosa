import { redraw, showPage } from "./app.js";
import { filedByPeriod, filedKey,
  betweenEntityJournals,
  bankOwner as coreBankOwner,
  betweenAccountPlan,
  suggestSuffix,
} from "@nzosa/core";
import { appendEvent, makeEvent } from "./events.js";
import type { EventKind } from "./events.js";
import { knownCodes, suggest, transferCandidates } from "./reconcile.js";
import type { Suggestion } from "./reconcile.js";
import { describeRules } from "./rules-ui.js";
import { setOptionDescriber } from "./combobox.js";
import type { OptionInfo } from "./combobox.js";
import { buildRows } from "./variance.js";
import type { VarianceInput } from "./variance.js";
import type { RuleFileShape } from "./rules-ui.js";
import { caches, state } from "./state.js";
import { aiSuggestionFor } from "./ai.js";
import { clearStore, emptyLedger, save, saveEvents, savePart, saveRules } from "./store.js";
import { resetLockBaseline } from "./lock.js";
import { applyModules } from "./modules.js";
import { chosenStartDate } from "./migrate/onboarding-state.js";
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
  payrollJournal,
  postLedger,
  prepaymentAdjustments,
  readXlsx,
  vehicleAdjustment,
  emptyTripLog,
  incomeYearOf,
  tripClaims,
  tripJournals,
  sheetToCsv,
  dedupe,
  defaultEntityModel,
  accountEntityKey,
  isGstControlCode,
  emptyEntityModel,
  formatAmount,
  labelForChartAccount,
  splitAccountLabel,
  directionCaution,
  rateForTreatment,
  gstSideForType,
  invoiceAssignments as coreInvoiceAssignments,
  documentsInPlay,
  isPosted,
  outsidePurchases,
  mapToOurVocabulary as coreMapToOurVocabulary,
  sameEntityBanks as coreSameEntityBanks,
} from "@nzosa/core";
import type {
  FiledReturn,
  Account,
  Cents,
  ManualJournal,
  CodingCounts,
  CodingEngine,
  DatedPayment,
  Entity,
  EntityModel,
  Invoice,
  IsoDate,
  InvoiceBalance,
  OtherPurchase,
  Settlement,
  PayrollAccounts,
  PostedJournal,
  RuleSet,
  Transaction,
  VehicleAdjustment,
  VehicleUse,
  TripAccounts,
  TripClaim,
  BetweenAccount,
  PlannedBetweenAccount,
} from "@nzosa/core";
import { taxYearEnd, taxYearOf, taxYearStart } from "./tax-year.js";
import { booksCountry, booksLocale, moneyPlaces } from "./country.js";

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

/**
 * A caution on a rule's suggestion that runs against the money.
 *
 * Money in suggested to an expense, or out to income. Right for a refund and
 * wrong for nearly anything else -- a loan's interest received, suggested as
 * a rental's interest paid, is how it was found. Said on the row, and the
 * line is left out of Accept all so that somebody reads it first. Nothing
 * once the line is confirmed: then a person has answered it.
 */
export function ruleCaution(one: Suggestion): string | undefined {
  if (one.confirmed || one.code === null || one.code === "") return undefined;
  const code = splitAccountLabel(one.code).code;
  const account = state.chart.find((a) => a.code.trim() === code);
  if (account === undefined) return undefined;
  return directionCaution(one.transaction.amount > 0 ? "money in" : "money out", account.type);
}

export function transferSuggestions(): Set<string> {
  if (caches.transfer !== null && caches.transfer.ledger === state.ledger) {
    return caches.transfer.ids;
  }
  // The same rules the row itself uses, so the "suggested" filter and the
  // row cannot disagree: a line marked "not a transfer" suggests nothing, and
  // a line already given an account is nobody's partner.
  const transfers = state.ledger.transfers ?? {};
  const refused = new Set(state.ledger.rejectedTransfers ?? []);
  const decided = accountDecided();
  const taken = new Set([
    ...Object.keys(transfers),
    ...state.ledger.transactions.filter((t) => decided(t.id)).map((t) => t.id),
  ]);
  const ids = new Set<string>();
  for (const transaction of state.ledger.transactions) {
    if (taken.has(transaction.id) || refused.has(transaction.id)) continue;
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
 * Undo a pairing, removing both legs so half a transfer cannot be left.
 *
 * Both legs are also remembered as not a transfer, because either one on its
 * own would be offered the other again. False when the line was not paired.
 * Redrawing is the caller's.
 */
export async function unpairTransfer(transactionId: string): Promise<boolean> {
  const existing = state.ledger.transfers ?? {};
  const partnerId = existing[transactionId];
  if (partnerId === undefined) return false;

  const transfers = { ...existing };
  delete transfers[transactionId];
  delete transfers[partnerId];
  const rejectedTransfers = [
    ...new Set([...(state.ledger.rejectedTransfers ?? []), transactionId, partnerId]),
  ];
  state.ledger = { ...state.ledger, transfers, rejectedTransfers };
  state.persistent = await savePart(state.ledger, "transfers");
  await record(
    "transfer",
    "Unlinked a transfer",
    { from: transactionId, to: partnerId },
    null,
    transactionId,
  );
  return true;
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
      "transfer between your own accounts, so it cannot also be coded to an account.\n\n" +
      'If it is not a transfer, choose "not a transfer" on the Reconcile page, then code it.',
  );
  return true;
}

/** The day these books start, where it is known. */
export function booksStartKnown(): string | undefined {
  return chosenStartDate() ?? state.ledger.openingBalances?.asAt;
}

/**
 * The invoices and bills in play in these books.
 *
 * Every one dated from the start, and of those dated earlier only the ones
 * the opening aged receivables or payables list as open -- carried forward
 * owing what that said. The rest were settled before these books began: they
 * are kept in the file, as history, but offered for matching, balances and
 * reports they would only mislead.
 */
export function invoicesInPlay(): Invoice[] {
  const start = booksStartKnown();
  if (caches.inPlay !== null && caches.inPlay.ledger === state.ledger && caches.inPlay.start === start) {
    return caches.inPlay.invoices;
  }
  const invoices = documentsInPlay(
    state.ledger.invoices ?? [],
    start as IsoDate | undefined,
    state.ledger.openingDocuments ?? [],
  );
  caches.inPlay = { ledger: state.ledger, start, invoices };
  return invoices;
}

/**
 * The invoices and bills a payment can be matched to: those in play, less
 * drafts. A draft is not in the books -- nothing is owed on it yet -- so a
 * receipt matched to one would settle a debt that does not exist.
 */
export function invoicesToMatch(): Invoice[] {
  return invoicesInPlay().filter(isPosted);
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
    invoices: invoicesToMatch(),
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
/**
 * Whether a line has been given an account, by any of the ways there are.
 *
 * A code is the usual one. A split is a better one -- it is what the line
 * actually was. An invoice match is the third: a receipt settling an invoice
 * posts against the debtor rather than to an account of its own.
 */
function hasCoding(one: Suggestion): boolean {
  return (
    one.code !== null ||
    (state.ledger.splits ?? {})[one.transaction.id] !== undefined ||
    invoiceAssignments().has(one.transaction.id)
  );
}

/**
 * A line that needs nothing further.
 *
 * Confirmed is not enough on its own. A line confirmed with no account is a
 * decision to post nothing, which is not a decision anybody means to make --
 * and because confirming took it out of the queue, it left no trace. A
 * recorded transfer is settled by being paired: there is no coding to confirm
 * and its tick has nothing left to do.
 */
export function settledAlready(one: Suggestion): boolean {
  return (
    (one.confirmed && hasCoding(one)) ||
    (state.ledger.transfers ?? {})[one.transaction.id] !== undefined
  );
}

/**
 * Nothing in these books has anything to say about this line.
 *
 * The one question worth asking before paying to ask a model, and it is not
 * "is the code null". A recorded transfer, a split, a matched invoice and an
 * offered transfer are all answers -- three of them better answers than a
 * single code would be -- and a line carrying one of them wants agreeing to,
 * not describing to a stranger.
 *
 * Written once and shared, because the Reconcile filter and the model queue
 * asking the same question differently is how a transfer already settled ends
 * up in a batch somebody is charged for and then offered an account for.
 */
export function nothingHasAnswered(one: Suggestion): boolean {
  if (settledAlready(one)) return false;
  return !(
    one.code !== null ||
    (state.ledger.splits ?? {})[one.transaction.id] !== undefined ||
    invoiceAssignments().has(one.transaction.id) ||
    transferSuggestions().has(one.transaction.id)
  );
}

export function reconcileRows(): { all: Suggestion[]; shown: Suggestion[] } {
  const all = suggest(
    state.ledger.transactions,
    state.rules,
    state.ledger.overrides ?? {},
    accountsFor(state.reconcileAccounts),
    unregisteredCode(),
    gstLookups(),
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
  const settled = settledAlready;

  const shown = all.filter((one) => {
    // What a model proposed and nobody has agreed to yet. Its own view
    // because it is its own kind of work: every one of these wants reading
    // rather than accepting in bulk.
    if (state.reconcileFilter === "ai") {
      if (settled(one)) return false;
      if (aiSuggestionFor(one.transaction.id) === undefined) return false;
    }
    if (state.reconcileFilter === "todo" && settled(one)) return false;
    if (state.reconcileFilter === "coded" && !settled(one)) return false;
    if (state.reconcileFilter === "between" && betweenTagFor(one.transaction, one.code) === null) return false;
    // A line with no code is one no rule matched. Confirming it means deciding
    // what it is, rather than agreeing with a suggestion.
    if (state.reconcileFilter === "nocode" && !nothingHasAnswered(one)) return false;
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

  // By date, oldest first unless asked otherwise, so the lines are worked
  // through in the order they happened. Same-day lines keep their order.
  const direction = state.reconcileSort === "newest" ? -1 : 1;
  shown.sort((a, b) => direction * a.transaction.date.localeCompare(b.transaction.date));
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

/**
 * Whether an entity of this kind is usually registered for GST.
 *
 * A starting answer for a tick box, not a rule: a household never is, a
 * residential rental almost never is (its rent is exempt), and a business or a
 * commercial rental usually is.
 */
export function gstUsually(kind: string): boolean {
  return kind === "business" || kind === "commercial";
}

export async function saveEntities(
  model: EntityModel,
  what = "Entities changed",
  /**
   * Leave Start here as it is: for a change it is already showing, such as
   * the description just typed there. Redrawing it replaced the Continue
   * button between the press and the release, and the first press was lost.
   */
  options: { quiet?: boolean } = {},
): Promise<void> {
  const before = state.ledger.entities;
  state.ledger = { ...state.ledger, entities: model };
  state.persistent = await savePart(state.ledger, "entities");
  await record("entities", what, before ?? null, model);
  // A new entity, owner, bank owner or loan may need accounts to post to.
  await ensureBetweenAccounts();
  redraw("entities");
  if (options.quiet !== true) redraw("migration");
  // The picker at the top of every page lists them too, and went on offering
  // the placeholder the guided start had just replaced.
  redraw("entityFilter");
  // What the books use follows the entities (a first rental, a first
  // non-profit), so the menu is brought up to date with them now rather than
  // when something else happens to redraw it.
  applyModules();
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
  // Cleared on purpose: the books that held the locks are gone with them.
  resetLockBaseline();
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

/**
 * What the comparison with filed returns was last worked out from.
 *
 * It was recalculated on a handful of named events, and accepting a batch
 * of coding was not one of them: the GST page went on showing 470 lines as
 * uncoded and differences in the thousands until the page was reloaded. The
 * ledger's parts are replaced rather than edited, so comparing what they are
 * now with what they were is enough to know.
 */
let varianceFrom: readonly unknown[] = [];

function varianceKey(): unknown[] {
  const led = state.ledger;
  return [
    led.transactions,
    led.overrides,
    led.splits,
    led.transfers,
    led.entities,
    led.invoiceMatches,
    led.varianceNotes,
    led.journals,
    state.rules,
    state.chart,
    state.filed,
    state.varianceAccounts.join("\n"),
  ];
}

/** Whether anything the comparison depends on has changed since it was worked out. */
export function varianceStale(): boolean {
  const now = varianceKey();
  return now.length !== varianceFrom.length || now.some((value, i) => value !== varianceFrom[i]);
}

export function recomputeVariance(): void {
  varianceFrom = varianceKey();
  if (state.filed.length === 0) {
    state.varianceRows = [];
    return;
  }
  state.varianceRows = buildRows(filedByPeriod(state.filed), varianceInput());
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
    sideOf: accountSideOf,
    // A line of an entity not registered for GST is on no return.
    unregistered: unregisteredCode(),
    unregisteredBank: unregisteredBank(),
    // Narrowed by the chosen entity, as every other page's selection is.
    // Choosing an entity narrowed the account chips here and left the figures
    // alone, so a page headed by one company's name compared everybody's bank
    // accounts against that company's filed returns and reported the rest of
    // the household as a disagreement.
    accounts: accountsFor(state.varianceAccounts),
    // With an entity chosen and no bank accounts picked, the entity's return is
    // what is coded to it, from any account: a commercial lease paid into the
    // owners' joint account is still the property's output tax. Going by the
    // property's own accounts alone left it off.
    ...gstBelongsTo(),
    months: gstFrequency(),
    // The private use of a vehicle gives back GST once a year, in Box 9 of
    // the return covering the balance date.
    debitAdjustments: vehicleBox9(accountsFor(state.varianceAccounts)),
    otherPurchases: otherPurchasesFor,
    settles: settlementOf,
  };
}

function gstBelongsTo(): { belongsTo?: (account: string, code: string) => boolean } {
  if (state.entityFilter === "" || state.varianceAccounts.length > 0) return {};
  const entity = state.entityFilter;
  const own = new Set(entityBankAccounts());
  const entityOf = entityOfCoding();
  return {
    belongsTo: (account, code) => {
      const whose = code === "" ? undefined : entityOf(code);
      return whose !== undefined ? whose === entity : own.has(account);
    },
  };
}

/**
 * The invoice or bill a bank line settles, as the GST return needs it: which
 * side, and how much of the document carries GST.
 */
function settlementOf(transactionId: string): Settlement | undefined {
  const number = invoiceAssignments().get(transactionId);
  if (number === undefined || number === "") return undefined;
  const invoice = invoicesInPlay().find((i) => i.number === number);
  if (invoice === undefined || invoice.total === 0) return undefined;
  const taxedGross = invoice.lines.filter((l) => l.tax !== 0).reduce((sum, l) => sum + l.gross, 0);
  return {
    side: invoice.kind === "sales" ? "sales" : "purchases",
    taxable: Math.min(1, Math.max(0, taxedGross / invoice.total)),
    number,
  };
}

/**
 * Keep a filed return with the books, replacing any held for the same period.
 *
 * One place, used by the reconciliation and by the GST return report, so a
 * return marked as filed from either is kept the same way and compared the same
 * way afterwards.
 */
export async function recordFiledReturn(one: FiledReturn): Promise<void> {
  const byPeriod = new Map(state.filed.map((f) => [filedKey(f), f]));
  byPeriod.set(filedKey(one), one);
  state.filed = [...byPeriod.values()].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  state.ledger = { ...state.ledger, filedReturns: state.filed };
  state.persistent = await save(state.ledger);
  recomputeVariance();
}

/**
 * The entities that keep bills: companies and commercial rentals.
 *
 * A household or a residential rental pays its bills as they come, and the
 * bank line is the whole record -- a payable in between is bookkeeping for
 * its own sake. A business whose structure nobody has said yet is counted as
 * a company, which is what nearly every one arriving from Xero is.
 */
export function billEntities(): Entity[] {
  const model = state.ledger.entities ?? emptyEntityModel();
  return model.entities.filter(
    (e) =>
      e.kind === "commercial" ||
      ((e.kind ?? "business") === "business" && (e.structure === undefined || e.structure === "company")),
  );
}

/** Whether these books have a Bills page at all. */
export function billsAvailable(): boolean {
  return billEntities().length > 0;
}

/**
 * The receivable or payable an entity's documents sit in.
 *
 * The chart account belonging to that entity whose type (or, failing that,
 * name) says Accounts Payable or Receivable. Undefined when it has none, which
 * the Bills page says, rather than falling back to a shared 800 that belongs
 * to somebody else.
 */
export function controlAccountFor(
  entityId: string,
  kind: "sales" | "purchase",
): { code: string; name: string } | undefined {
  const model = state.ledger.entities ?? emptyEntityModel();
  const wanted = kind === "purchase" ? /accounts\s+payable/i : /accounts\s+receivable/i;
  const mine = state.chart.filter((a) => model.accounts[accountEntityKey(a)] === entityId);
  const found = mine.find((a) => wanted.test(a.type)) ?? mine.find((a) => wanted.test(a.name));
  return found === undefined ? undefined : { code: found.code, name: found.name };
}

/** A document's own control account, for posting; undefined keeps 610 or 800. */
export function documentControl(invoice: Invoice): { code: string; name: string } | undefined {
  if (invoice.entityId === undefined) return undefined;
  return controlAccountFor(invoice.entityId, invoice.kind);
}

/**
 * Every payment against a document, with its date.
 *
 * Bank lines and split parts, from the same assignments the balances use.
 * Payments outside the bank are on the documents themselves.
 */
export function datedInvoicePayments(): DatedPayment[] {
  const byId = new Map(state.ledger.transactions.map((t) => [t.id, t]));
  const out: DatedPayment[] = [];
  for (const [id, number] of invoiceAssignments()) {
    if (number === "") continue;
    const colon = id.lastIndexOf(":");
    const direct = byId.get(id);
    if (direct !== undefined) {
      out.push({ invoiceNumber: number, date: direct.date, amount: direct.amount });
      continue;
    }
    if (colon < 0) continue;
    const parent = byId.get(id.slice(0, colon));
    const index = Number(id.slice(colon + 1)) - 1;
    const part = parent === undefined ? undefined : (state.ledger.splits ?? {})[parent.id]?.[index];
    if (parent !== undefined && part !== undefined) {
      out.push({ invoiceNumber: number, date: parent.date, amount: part.amount });
    }
  }
  return out;
}

/**
 * Bills paid outside the bank lines, for the GST return's Box 11.
 *
 * Only those of the entity chosen, and only an entity registered for GST: a
 * bill with no entity said counts when all of them are showing.
 */
function otherPurchasesFor(period: { from: string; to: string }): OtherPurchase[] {
  const model = state.ledger.entities ?? emptyEntityModel();
  const chosen = state.entityFilter;
  return outsidePurchases(invoicesInPlay(), period, (bill) => {
    if (chosen !== "" && bill.entityId !== chosen) return false;
    const entity = model.entities.find((e) => e.id === bill.entityId);
    return entity === undefined || entity.gstRegistered !== false;
  });
}

export function invoiceBalanceMap(): Map<string, InvoiceBalance> {
  return invoiceBalancesFor({
    invoices: invoicesInPlay(),
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
/**
 * The GST rate an account's own setting gives, for the Reconcile row to
 * follow when the account is picked; null where it says nothing the row can
 * show. An account of an entity not registered for GST is always 0%.
 */
export function accountRate(label: string): "0" | "15" | "100" | null {
  if (label === "") return null;
  if (unregisteredCode()(label)) return "0";
  const file = state.rules as RuleFileShape | undefined;
  const rate = rateForTreatment((file?.codeTreatments ?? {})[label] ?? chartTreatmentOf(label));
  return rate === "0" || rate === "15" || rate === "100" ? rate : null;
}

/**
 * The entity a coding belongs to, by the account it names, or undefined.
 *
 * What decides whose a line is: the account it is coded to. Which bank account
 * it went through says only whose money paid it.
 */
let entityOfCodingCache: { model: unknown; chart: unknown; rules: unknown; overrides: unknown; fn: (code: string) => string | undefined } | null = null;

export function entityOfCoding(): (code: string) => string | undefined {
  const model = state.ledger.entities ?? emptyEntityModel();
  const c = entityOfCodingCache;
  if (c !== null && c.model === model && c.chart === state.chart && c.rules === state.rules && c.overrides === state.ledger.overrides) return c.fn;
  const fn = entityOfCodingFresh(model);
  entityOfCodingCache = { model, chart: state.chart, rules: state.rules, overrides: state.ledger.overrides, fn };
  return fn;
}

function entityOfCodingFresh(model: EntityModel): (code: string) => string | undefined {
  const byLabel = new Map<string, string>();
  for (const { account, label } of accountsForEditing()) {
    const id = model.accounts[accountEntityKey(account)];
    if (id !== undefined) byLabel.set(label, id);
  }
  return (code) => {
    const direct = byLabel.get(code);
    if (direct !== undefined) return direct;
    const { code: digits, name } = splitAccountLabel(code);
    return model.accounts[accountEntityKey({ code: digits, name })];
  };
}

/**
 * Whether a posted journal belongs in a report narrowed to the chosen entity:
 * it moves one of the entity's own bank accounts, or one of its lines is
 * posted to an account of the entity's. Null when no entity is chosen.
 */
export function journalInEntity(): ((journal: PostedJournal) => boolean) | null {
  if (state.entityFilter === "") return null;
  const entity = state.entityFilter;
  const model = state.ledger.entities ?? emptyEntityModel();
  const banks = new Set(entityBankAccounts());
  const own = (line: { accountCode: string; accountName: string }): boolean =>
    banks.has(line.accountCode) ||
    model.accounts[accountEntityKey({ code: line.accountCode, name: line.accountName })] === entity;
  return (journal) => journal.lines.some(own);
}

let reachCache: { overrides: unknown; model: unknown; transactions: unknown; coded: Map<string, Set<string>> } | null = null;

/**
 * The entities a bank account pays for: the one it belongs to, and every one
 * its lines have been coded to.
 *
 * What the account is for, as against whose it is. The household's card is the
 * household's, but it also pays a rental's repairs, and the AI, the order of
 * the account list and the care taken before a coding becomes a rule all need
 * to know it reaches that far. Read from the codings themselves rather than
 * from ticks somebody has to keep up to date.
 */
export function bankReach(account: string): string[] {
  const model = state.ledger.entities ?? emptyEntityModel();
  const overrides = state.ledger.overrides ?? {};
  if (
    reachCache === null ||
    reachCache.overrides !== overrides ||
    reachCache.model !== model ||
    reachCache.transactions !== state.ledger.transactions
  ) {
    const entityOf = entityOfCoding();
    const accountOf = new Map(state.ledger.transactions.map((t) => [t.id, t.account]));
    const coded = new Map<string, Set<string>>();
    for (const [id, decision] of Object.entries(overrides)) {
      const bank = accountOf.get(id);
      const code = (decision as { code?: string } | undefined)?.code ?? "";
      if (bank === undefined || code === "") continue;
      const whose = entityOf(code);
      if (whose === undefined) continue;
      const set = coded.get(bank) ?? new Set<string>();
      set.add(whose);
      coded.set(bank, set);
    }
    reachCache = { overrides, model, transactions: state.ledger.transactions, coded };
  }
  const ticked = model.banks[account] ?? [];
  const coded = reachCache.coded.get(account) ?? new Set<string>();
  return model.entities.map((e) => e.id).filter((id) => ticked.includes(id) || coded.has(id));
}

/**
 * The suffix an entity's codes carry: the one it was given, or the one its
 * accounts already share, or one made from its name.
 */
function suffixOfEntity(entity: Entity): string {
  if (entity.codeSuffix !== undefined && entity.codeSuffix !== "") return entity.codeSuffix;
  const model = state.ledger.entities ?? emptyEntityModel();
  const counts = new Map<string, number>();
  for (const account of state.chart) {
    if (model.accounts[accountEntityKey(account)] !== entity.id) continue;
    const found = /^\d+([A-Z]{1,3})$/.exec(account.code.trim());
    if (found?.[1] !== undefined) counts.set(found[1], (counts.get(found[1]) ?? 0) + 1);
  }
  const usual = [...counts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
  if (usual !== undefined) return usual;
  const taken = new Set(model.entities.filter((e) => e.id !== entity.id).map((e) => e.codeSuffix ?? "").filter((x) => x !== ""));
  return suggestSuffix(entity.name, taken);
}

/** The accounts money between entities posts to, each held in the chart or still to add. */
export function betweenPlan(): PlannedBetweenAccount[] {
  const model = state.ledger.entities ?? emptyEntityModel();
  return betweenAccountPlan(model, state.chart, suffixOfEntity, model.between);
}

/**
 * Add to the chart the accounts money between entities needs and does not
 * have yet, each assigned to its entity. Run when the books open and when the
 * entities change: a new entity, a new owner, a bank account given an owner, a
 * pair set to a loan. Adding an account moves no figure.
 */
export async function ensureBetweenAccounts(): Promise<number> {
  const wanted = betweenPlan().filter((a) => !a.exists);
  if (wanted.length === 0) return 0;
  const model = state.ledger.entities ?? emptyEntityModel();
  const added: Account[] = wanted.map((a) => ({
    code: a.code,
    name: a.name,
    type: a.type,
    taxCode: "No GST",
    description:
      a.role === "introduced"
        ? `Money ${a.person} put in, from another entity's account`
        : a.role === "drawings"
          ? `Money ${a.person} took out, into another entity's account`
          : a.role === "current"
            ? `What ${a.person} has lent to it, or owes it`
            : "A balance owed between the two entities",
  }));
  const accounts = { ...model.accounts };
  for (const account of added) accounts[accountEntityKey(account)] = wanted.find((w) => w.code === account.code)!.entityId;
  const chart = [...state.chart, ...added];
  state.chart = chart;
  state.ledger = { ...state.ledger, chart, entities: { ...model, accounts } };
  state.persistent = await savePart(state.ledger, "chart", "entities");
  await record(
    "chart",
    `Added ${added.length} account${added.length === 1 ? "" : "s"} for money between entities: ${added.map((x) => `${x.code} ${x.name}`).join("; ")}`,
    null,
    added,
  );
  return added.length;
}

let betweenCache: { ledger: unknown; chart: unknown; rules: unknown; value: { journals: PostedJournal[]; accounts: BetweenAccount[] } } | null = null;

/**
 * Money passing between entities, as posted: the ledger's between-entity
 * journals and the accounts they use. Cached until the books, the chart or the
 * rules change, because Actions required asks on every redraw.
 */
export function betweenEntities(): { journals: PostedJournal[]; accounts: BetweenAccount[] } {
  if (betweenCache !== null && betweenCache.ledger === state.ledger && betweenCache.chart === state.chart && betweenCache.rules === state.rules) {
    return betweenCache.value;
  }
  const value = {
    journals: postedJournals().filter((j) => j.source === "between"),
    accounts: betweenPlan().filter((a) => a.exists),
  };
  betweenCache = { ledger: state.ledger, chart: state.chart, rules: state.rules, value };
  return value;
}

export interface BetweenTag {
  /** "Larch Street, paid by Both". */
  label: string;
  /** What the books record for it, account by account. */
  title: string;
}

let tagCache: { value: unknown; byLine: Map<string, PostedJournal> } | null = null;

/**
 * Whether a bank line is for another entity than the one whose account it went
 * through, and if so, said plainly: whose line it is and whose money.
 *
 * `code` is the line's coding (a split line's parts are read from the split).
 * Null for a line that stays with the account's owner, or whose account has no
 * single owner.
 */
export function betweenTagFor(transaction: Transaction, code: string | null): BetweenTag | null {
  const model = state.ledger.entities ?? emptyEntityModel();
  if (model.entities.length < 2) return null;
  const owner = coreBankOwner(model, transaction.account);
  if (owner === undefined) return null;
  const entityOf = entityOfCoding();
  const parts = (state.ledger.splits ?? {})[transaction.id];
  const codes = parts !== undefined ? parts.map((p) => p.code ?? "").filter((c) => c !== "") : code !== null && code !== "" ? [code] : [];
  const nameOf = (id: string): string => model.entities.find((e) => e.id === id)?.name ?? id;
  const others = [...new Set(codes.map((c) => entityOf(c)).filter((id): id is string => id !== undefined && id !== owner))];
  if (others.length === 0) return null;
  const label = `${others.map(nameOf).join(", ")}, ${transaction.amount < 0 ? "paid" : "received"} by ${nameOf(owner)}`;

  // The entries the books hold for it, from the ledger itself.
  const between = betweenEntities();
  if (tagCache === null || tagCache.value !== between) {
    tagCache = { value: between, byLine: new Map(between.journals.map((j) => [j.transactionId, j])) };
  }
  const journal = tagCache.byLine.get(transaction.id);
  const money = (cents: number): string =>
    `$${(Math.abs(cents) / 100).toLocaleString(booksLocale(), { minimumFractionDigits: moneyPlaces(), maximumFractionDigits: moneyPlaces() })}`;
  const title =
    journal === undefined
      ? `Money passing between ${nameOf(owner)} and ${others.map(nameOf).join(", ")}. It is recorded once the line is coded.`
      : "Recorded in the books:\n" +
        journal.lines
          .map((l) => {
            const whose = model.accounts[accountEntityKey({ code: l.accountCode, name: l.accountName })];
            return `${whose !== undefined ? nameOf(whose) : ""}: ${l.accountCode} ${l.accountName} ${money(l.amount)} ${l.amount > 0 ? "debit" : "credit"}`;
          })
          .join("\n");
  return { label, title };
}

/** The between-entity journals for what has been posted, on the chart's accounts. */
function betweenJournalsFor(posted: readonly PostedJournal[]): PostedJournal[] {
  const model = state.ledger.entities ?? emptyEntityModel();
  if (model.entities.length < 2) return [];
  const held = new Set(state.ledger.transactions.map((t) => t.account));
  return betweenEntityJournals(posted, {
    model,
    bankOwner: (account) => coreBankOwner(model, account),
    isBank: (code) => held.has(code),
    overrides: model.between,
    plan: betweenPlan().filter((a) => a.exists),
  }).journals;
}

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

/**
 * Which side of the GST return an account is on, from its type.
 *
 * For an account whose tax code does not say -- one added here rather than
 * loaded from a chart -- so that a refund to it lands on the side its
 * account is on, not the side its sign suggests.
 */
export function accountSideOf(label: string): "sales" | "purchases" | undefined {
  const { code, name } = splitAccountLabel(label);
  const account =
    (code !== "" ? state.chart.find((a) => a.code.trim() === code) : undefined) ??
    state.chart.find((a) => a.name.trim().toLowerCase() === name.trim().toLowerCase());
  const side = account === undefined ? undefined : gstSideForType(account.type);
  return side === "sales" || side === "purchases" ? side : undefined;
}

/** What every GST resolver in the app is told about the chart. */
export function gstLookups(): {
  chartTreatment: (code: string) => unknown | null;
  sideOf: (code: string) => "sales" | "purchases" | undefined;
  unregisteredBank: (account: string) => boolean;
} {
  return {
    chartTreatment: (code) => chartTreatmentOf(code),
    sideOf: accountSideOf,
    unregisteredBank: unregisteredBank(),
  };
}

/**
 * Whether a bank account's uncoded lines carry no GST: none of its entities is
 * registered for GST.
 *
 * GST follows the entities a bank account is for: GST if any one of them is
 * registered, none if none is. In books of one entity, every bank account is
 * that entity's. A bank account ticked to nobody has no registered entity, so
 * no GST either -- it used to fall back to GST, which put GST on lines nobody
 * had said belonged to a registered entity. Books with no entities set up yet
 * say nothing, and are left to the defaults.
 */
export function unregisteredBank(): (account: string) => boolean {
  const model = state.ledger.entities ?? emptyEntityModel();
  if (model.entities.length === 0) return () => false;
  const registered = new Set(
    model.entities.filter((e) => e.gstRegistered !== false).map((e) => e.id),
  );
  const only = model.entities.length === 1 ? model.entities[0]?.id : undefined;
  return (account) => {
    const ticked = model.banks[account] ?? [];
    const ids = ticked.length === 0 && only !== undefined ? [only] : ticked;
    return ids.every((id) => !registered.has(id));
  };
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
    sideOf: accountSideOf,
    unregistered: unregisteredCode(),
    unregisteredBank: unregisteredBank(),
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
    // Today in New Zealand: the year in progress is posted month by month.
    today: new Date().toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" }),
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

  const posted = postLedger({
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
    invoices: invoicesInPlay(),
    settled: invoiceAssignments(),
    controlFor: documentControl,
    gstAccount: gstAccount(),
    gstAccountFor: gstAccountForEntities(),
    ...(booksStartKnown() !== undefined ? { startDate: booksStartKnown()! } : {}),
    transfers: state.ledger.transfers ?? {},
    // A property manager's statement posts as a journal of its own, derived
    // each time so an edited statement cannot leave its old journal behind.
    manualJournals: [...(state.ledger.manualJournals ?? []), ...agentStatementJournals()],
    // Pay runs post like depreciation: derived from what was stored, each time.
    assetJournals: [
      ...depreciationJournals(),
      ...disposalJournals({ resolveAccount }),
      ...payrollJournals(),
    ],
  });
  // The year-end adjustments come last, because they are worked out from
  // everything else: a share of what the vehicle accounts ended up holding, a
  // part of what a prepayment was coded to.
  const withYearEnd = [...posted, ...yearEndJournals(posted)];
  // Last of all, money that passed between entities: a line coded to one
  // entity on another's bank account leaves each of them out of balance until
  // the owners' money in and out, or a loan, is written on both sides.
  return [...withYearEnd, ...betweenJournalsFor(withYearEnd)];
}

/**
 * Where pay runs post, from the accounts chosen on the Payroll page.
 *
 * Null until wages, wages payable and PAYE payable are all chosen and still in
 * the chart. Guessing would be worse than waiting: a pay run posted to an
 * account that happens to share a code with Xero's wages account is how wages
 * ended up in telephone and internet.
 */
/**
 * How often the GST return is filed, for the entity chosen.
 *
 * The entity chosen says, when one is; with all entities showing, the one
 * frequency every registered entity shares, and two-monthly -- IRD's default
 * -- when they differ or nobody has said.
 */
export function gstFrequency(): 1 | 2 | 3 | 6 {
  // The country's usual period where nobody has said: two-monthly in New
  // Zealand, quarterly in Australia, six-monthly in South Korea.
  const usual = booksCountry().id === "au" ? 3 : booksCountry().id === "kr" ? 6 : 2;
  const model = state.ledger.entities ?? emptyEntityModel();
  const chosen = model.entities.find((e) => e.id === state.entityFilter);
  if (chosen !== undefined) return chosen.gstFrequency ?? usual;
  const registered = model.entities.filter((e) => e.gstRegistered !== false && e.kind !== "personal");
  const set = new Set(registered.map((e) => e.gstFrequency ?? usual));
  return set.size === 1 ? ([...set][0] ?? usual) : usual;
}

/**
 * Every income year the books hold anything for, newest first.
 *
 * Bank lines were the only thing asked, so a year with pay runs, a year-end
 * adjustment or a hand journal and no bank lines yet had no year to show it
 * in -- the figures were posted and no report could reach them.
 */
/**
 * Each account's figure for the chart of accounts, keyed by account code:
 * for income and expenses the year to date, for everything else the balance
 * today -- the way an accounting system's chart shows it.
 *
 * Both are worked out here and the page picks by type. Built once per set of
 * books and chart, since the page redraws on every edit.
 */
let balancesCache: {
  ledger: unknown;
  rules: unknown;
  chart: unknown;
  yearToDate: Map<string, Cents>;
  today: Map<string, Cents>;
} | null = null;

export function chartBalances(): { yearToDate: Map<string, Cents>; today: Map<string, Cents> } {
  if (
    balancesCache !== null &&
    balancesCache.ledger === state.ledger &&
    balancesCache.rules === state.rules &&
    balancesCache.chart === state.chart
  ) {
    return balancesCache;
  }
  const now = new Date().toISOString().slice(0, 10);
  const yearStart = taxYearStart(taxYearOf(now));
  const opening = state.ledger.openingBalances;
  const yearToDate = new Map<string, Cents>();
  const today = new Map<string, Cents>();
  const add = (map: Map<string, Cents>, code: string, amount: Cents): void => {
    map.set(code, (map.get(code) ?? 0) + amount);
  };
  for (const [code, amount] of Object.entries(opening?.accounts ?? {})) add(today, code.trim(), amount);
  for (const journal of postedJournals()) {
    if (journal.date > now) continue;
    for (const line of journal.lines) {
      const code = line.accountCode.trim();
      if (code === "") continue;
      if (journal.date >= yearStart) add(yearToDate, code, line.amount);
      if (opening === undefined || journal.date > opening.asAt) add(today, code, line.amount);
    }
  }
  balancesCache = { ledger: state.ledger, rules: state.rules, chart: state.chart, yearToDate, today };
  return balancesCache;
}

/**
 * An account label's entity, for the account pickers: shown beside it, and
 * searchable by its name and code suffix, so "totara rates" still finds the
 * rental's rates now that the name alone is "Rates and water". Only with
 * more than one entity; with one it would say the same thing on every line.
 */
let accountInfoCache: { entities: unknown; chart: unknown; info: Map<string, OptionInfo | undefined> } | null = null;

export function accountSearchInfo(label: string): OptionInfo | undefined {
  const model = state.ledger.entities;
  if (model === undefined || model.entities.length < 2) return undefined;
  if (accountInfoCache === null || accountInfoCache.entities !== model || accountInfoCache.chart !== state.chart) {
    accountInfoCache = { entities: model, chart: state.chart, info: new Map() };
  }
  const cached = accountInfoCache.info;
  if (cached.has(label)) return cached.get(label);
  const { code, name } = splitAccountLabel(label);
  const id = model.accounts[accountEntityKey({ code, name })];
  const entity = id === undefined ? undefined : model.entities.find((e) => e.id === id);
  const info =
    entity === undefined
      ? undefined
      : { note: entity.name, words: `${entity.name} ${entity.codeSuffix ?? ""}` };
  cached.set(label, info);
  return info;
}
setOptionDescriber(accountSearchInfo);

export function bookYears(): number[] {
  const dates: string[] = [
    ...state.ledger.transactions.map((t) => t.date),
    ...(state.ledger.journals ?? []).map((j) => j.date),
    ...(state.ledger.manualJournals ?? []).map((j) => j.date),
    ...(state.ledger.payroll?.payRuns ?? []).map((r) => r.payDate),
    ...(state.ledger.agentStatements ?? []).map((a) => a.to),
    ...(state.ledger.prepayments ?? []).map((p) => p.from),
  ];
  const years = new Set(dates.filter((d) => d !== "").map((d) => taxYearOf(d)));
  for (const use of state.ledger.vehicleUse ?? []) years.add(use.year);
  return [...years].sort((a, b) => b - a);
}

export function payrollAccounts(): PayrollAccounts | null {
  const chosen = state.ledger.payroll?.accounts ?? {};
  const find = (code: string | undefined) => {
    if (code === undefined || code === "") return undefined;
    const account = state.chart.find((a) => a.code === code);
    return account === undefined ? undefined : { code: account.code, name: account.name };
  };
  const wages = find(chosen.wages);
  const wagesPayable = find(chosen.wagesPayable);
  const payePayable = find(chosen.payePayable);
  if (wages === undefined || wagesPayable === undefined || payePayable === undefined) return null;
  return {
    wages,
    wagesPayable,
    payePayable,
    kiwiSaverExpense: find(chosen.kiwiSaverExpense),
    kiwiSaverPayable: find(chosen.kiwiSaverPayable),
    // An allowance, reimbursement or deduction's own account, by its code.
    named: (code: string) => find(code),
  };
}

function payrollJournals(): PostedJournal[] {
  const accounts = payrollAccounts();
  if (accounts === null) return [];
  return (state.ledger.payroll?.payRuns ?? [])
    .map((run) => payrollJournal(run, accounts))
    .filter((j): j is PostedJournal => j !== null);
}

function chartName(code: string): string {
  return state.chart.find((a) => a.code === code)?.name ?? code;
}

function gstAccount(): { code: string; name: string } {
  const account =
    state.chart.find((a) => a.code === "820") ??
    state.chart.find((a) => isGstControlCode(a.code)) ??
    state.chart.find((a) => /^gst\b/i.test(a.name.trim()));
  return { code: account?.code ?? "820", name: account?.name ?? "GST" };
}

/**
 * The GST account for a supply posted to a chart account: the GST control
 * account of the entity that owns it, where that entity has one of its own.
 *
 * With several entities, Standard accounts gives each GST-registered one its
 * own control account -- 820KC, 820MS -- and each entity's GST belongs in its
 * own. Undefined leaves the books' single GST account to take it.
 */
function gstAccountForEntities(): (accountCode: string) => { code: string; name: string } | undefined {
  const model = state.ledger.entities ?? emptyEntityModel();
  const byEntity = new Map<string, { code: string; name: string }>();
  for (const account of state.chart) {
    if (!isGstControlCode(account.code)) continue;
    const entity = model.accounts[accountEntityKey(account)];
    if (entity !== undefined && !byEntity.has(entity)) byEntity.set(entity, { code: account.code, name: account.name });
  }
  if (byEntity.size < 2) return () => undefined;
  return (accountCode) => {
    const entity = model.accounts[accountCode.trim()];
    return entity === undefined ? undefined : byEntity.get(entity);
  };
}

function prepaymentsAccount(): { code: string; name: string } {
  const account =
    state.chart.find((a) => /prepayment/i.test(a.name)) ?? state.chart.find((a) => a.code === "620");
  return { code: account?.code ?? "620", name: account?.name ?? "Prepayments" };
}

/** Each vehicle's private-use adjustment, worked from the journals as posted. */
export function vehicleAdjustments(
  posted: readonly PostedJournal[],
): { use: VehicleUse; result: VehicleAdjustment }[] {
  const books = gstAccount();
  const ownFor = gstAccountForEntities();
  return (state.ledger.vehicleUse ?? []).map((use) => {
    // The vehicle's own entity's GST account, where it has one.
    const gst = ownFor(use.counterCode) ?? books;
    return {
      use,
      result: vehicleAdjustment(
        { ...use, counterName: use.counterName ?? chartName(use.counterCode) },
        posted,
        { gstAccountCode: gst.code, gstAccountName: gst.name },
      ),
    };
  });
}

/** The fiscal years any prepayment runs across, oldest first. */
export function prepaymentYears(): number[] {
  const years = new Set<number>();
  const fiscal = (date: string): number => taxYearOf(date);
  for (const p of state.ledger.prepayments ?? []) {
    for (let y = fiscal(p.from); y <= fiscal(p.to); y += 1) years.add(y);
  }
  return [...years].sort((a, b) => a - b);
}

export function prepaymentsFor(posted: readonly PostedJournal[], year: number) {
  const account = prepaymentsAccount();
  return prepaymentAdjustments(state.ledger.prepayments ?? [], posted, year, {
    prepaymentsCode: account.code,
    prepaymentsName: account.name,
    accountName: chartName,
  });
}

/**
 * Where a property's vehicle claim posts: its Travel account, and its owners'
 * funds introduced -- found by the entity's code suffix, as Standard accounts
 * names them (`493MS`, `970MS`).
 */
export function tripAccounts(entityId: string): TripAccounts | null {
  const entity = (state.ledger.entities ?? emptyEntityModel()).entities.find((e) => e.id === entityId);
  const suffix = entity?.codeSuffix ?? "";
  const find = (base: string, name: RegExp) =>
    state.chart.find((a) => a.code.trim() === `${base}${suffix}`) ??
    state.chart.find((a) => name.test(a.name) && a.code.trim().endsWith(suffix) && suffix !== "");
  const travel = find("493", /^travel/i);
  const counter = find("970", /funds introduced|owner'?s equity|capital/i);
  if (travel === undefined || counter === undefined) return null;
  return {
    travel: { code: travel.code.trim(), name: travel.name },
    counter: { code: counter.code.trim(), name: counter.name },
  };
}

/** The years trips were made in, oldest first. */
export function tripYears(): number[] {
  return [...new Set((state.ledger.tripLog?.trips ?? []).map((t) => incomeYearOf(t.date)))].sort((a, b) => a - b);
}

/** Each year's vehicle claims and their journals. */
export function tripsFor(year: number): { claims: TripClaim[]; journals: PostedJournal[]; notes: string[] } {
  const claims = tripClaims(state.ledger.tripLog ?? emptyTripLog(), year);
  const { journals, notes } = tripJournals(claims, tripAccounts);
  return { claims, journals, notes };
}

function yearEndJournals(posted: readonly PostedJournal[]): PostedJournal[] {
  const journals: PostedJournal[] = [];
  for (const year of tripYears()) journals.push(...tripsFor(year).journals);
  for (const { result } of vehicleAdjustments(posted)) {
    if (result.journal !== null) journals.push(result.journal);
  }
  if ((state.ledger.prepayments ?? []).length > 0) {
    for (const year of prepaymentYears()) journals.push(...prepaymentsFor(posted, year).journals);
  }
  return journals;
}

/**
 * The GST on vehicles' private use falling in a return, for Box 9.
 *
 * A return is worked from bank accounts, and the adjustment belongs to an
 * entity, so it is counted where the return covers one of that entity's banks
 * -- or every bank, when no selection is made.
 */
function vehicleBox9(accounts: readonly string[]): (period: { from: string; to: string }) => Cents {
  return (period) => {
    const uses = (state.ledger.vehicleUse ?? []).filter((use) => {
      const end = taxYearEnd(use.year);
      return end >= period.from && end <= period.to;
    });
    if (uses.length === 0) return 0;
    const model = state.ledger.entities ?? emptyEntityModel();
    const covers = (entityId: string): boolean =>
      accounts.length === 0 ||
      accounts.some((account) => (model.banks[account] ?? []).includes(entityId));
    const posted = postedJournals();
    return vehicleAdjustments(posted)
      .filter(({ use }) => uses.includes(use) && covers(use.entityId))
      .reduce((sum, { result }) => sum + result.privateGst, 0);
  };
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

/**
 * Where a proposed invoice match stands.
 *
 * Accepted when this bank line was matched to this invoice. Waiting when
 * nothing was said, and also when the line was marked "not an invoice
 * payment" -- which accepting another system's coding does on its own -- since
 * the proposal is still on offer. Elsewhere when the line went to a different
 * invoice: the proposal cannot be accepted as it stands, and calling it
 * "accepted", as the page did, said the opposite of what had happened.
 */
/**
 * A proposed match still asking for a decision.
 *
 * Not one already accepted, not one whose bank line is matched to another
 * invoice, and not one for an invoice already settled. The matcher looks for
 * each recorded payment by amount alone, so an invoice paid as part of one
 * larger receipt -- $800 split across two invoices -- has its payment looked
 * for again, and is offered the nearest line: often one another invoice has.
 */
export function proposalOpen(
  proposal: { transactionId: string; invoiceNumber: string },
  balances: ReadonlyMap<string, { remaining: number }> = invoiceBalanceMap(),
): boolean {
  if (proposalState(proposal) !== "waiting") return false;
  const balance = balances.get(proposal.invoiceNumber);
  return balance === undefined || balance.remaining > 0;
}

export function proposalState(proposal: {
  transactionId: string;
  invoiceNumber: string;
}): "accepted" | "waiting" | "elsewhere" {
  const held = (state.ledger.invoiceMatches ?? {})[proposal.transactionId];
  if (held === proposal.invoiceNumber) return "accepted";
  if (held === undefined || held === "") return "waiting";
  return "elsewhere";
}
