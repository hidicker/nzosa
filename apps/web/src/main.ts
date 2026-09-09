import { combobox } from "./combobox.js";
import type { Combobox } from "./combobox.js";
import {
  categorise,
  checkManualJournal,
  computeBalanceSheet,
  decodeText,
  manualJournalsIn,
  postManualJournal,
  overdrawnWarning,
  shareholderSchedule,
  ir10IsCalculated,
  ir10Summary,
  disposalOf,
  postDisposal,
  openingBalancesFrom,
  parseTrialBalance,
  splitAccountLabel,
  daysBetween,
  dedupe,
  dedupeKey,
  expandSplits,
  splitPartId,
  gstResolver,
  gstWithin,
  formatAccountTransactions,
  accountTransactionRows,
  formatGeneralLedger,
  generalLedgerRows,
  generalLedgerTotals,
  accountEntityKey,
  emptyEntityModel,
  defaultEntityModel,
  reportsNetOfGst,
  DEFAULT_ENTITY_NAME,
  entityCoverage,
  entityId,
  accrualProfitAndLoss,
  accountLabel,
  dedupeReference,
  identifyExport,
  invoiceDocument,
  renameAccount,
  starterChart,
  renameProblem,
  canonicalCodeFor,
  chartTreatments,
  labelForChartAccount,
  checkDailyBalances,
  judgeDuplicates,
  parseDailyBalances,
  coverage,
  inferRules,
  keywordFor,
  postDepreciation,
  postInvoice,
  postTransaction,
  postTransfer,
  taxSummary,
  taxTypeFromRate,
  trialBalance,
  depreciationSchedule,
  matchAccountName,
  accountTreatment,
  akahuAccountId,
  fromAkahu,
  matchLedgerAccount,
  hash,
  invoiceBalances,
  formatChartOfAccounts,
  formatDepreciationSchedule,
  formatOwnerSummary,
  formatOwners,
  ownersOf,
  ownersTotal,
  formatProfitAndLoss,
  parseAmount,
  parseChartOfAccounts,
  parseFixedAssets,
  parseXeroAllocations,
  parseXeroInvoices,
  parseXeroJournalReport,
  readXlsx,
  sheetToCsv,
  matchInvoices,
  validateInvoices,
  parseOwners,
  totalExtras,
  TAX_EXTRA_CATEGORIES,
  summariseForOwner,
  profitAndLoss,
  isKnownType,
  sectionForType,
  formatAmount,
  gstContent,
  importFile,
  importers,
} from "@nzosa/core";
import type {
  Account,
  AkahuAccount,
  BalanceSheetLine,
  GstSide,
  GstTreatment,
  ManualJournal,
  Payout,
  IsoDate,
  OpeningBalances,
  GstClassification,
  AkahuTransaction,
  Cents,
  DedupeEntry,
  Entity,
  EntityKind,
  Invoice,
  InvoiceAssignment,
  SheetRows,
  InvoiceBalance,
  BalanceCheck,
  DuplicateJudgement,
  InvoiceKind,
  InvoiceLine,
  EntityModel,
  TaxExtra,
  TaxExtraCategory,
  OwnerSummary,
  Journal,
  CodedExample,
  PostedJournal,
  ProfitAndLoss,
  DateRange,
  RuleProposal,
  ReportSection,
  FiledReturn,
  Identified,
  ImportProblem,
  InvoiceSupplier,
  CodingRow,
  ReferenceLine,
  ReferencePart,
  RuleSet,
  SplitPart,
  Transaction,
} from "@nzosa/core";
import { buildRows, detailFor, readFiledReturns } from "./variance.js";
import {
  GST_OPTIONS,
  classificationToRate,
  knownCodes,
  rateLabel,
  rateToClassification,
  describeFlow,
  transferCandidates,
  suggest,
} from "./reconcile.js";
import type { GstRate, Suggestion } from "./reconcile.js";
import type { ReferenceLoad } from "./check-ui.js";
import type { TransferPair } from "./events.js";
import { monthlyColumns, rankedBars, statTiles } from "./charts.js";
import { splitEditor } from "./split-ui.js";
import { compareCodings, inferAccountMapping, loadReference, readChosenColumns } from "./check-ui.js";
import { describeRules, mergeRules } from "./rules-ui.js";
import { blankDraft, fromDraft, ruleImpact, toDraft, validateDraft } from "./rules-editor.js";
import type { RuleDraft } from "./rules-editor.js";
import type { CategoryRule } from "@nzosa/core";
import type { RuleFileShape } from "./rules-ui.js";
import type { VarianceRow } from "./variance.js";
import {
  clear,
  emptyLedger,
  load,
  loadRules,
  loadRulesArchive,
  currentLedger,
  archiveOther,
  ledgers,
  switchLedger,
  writesToFolder,
  listArchives,
  restoreArchive,
  clearStore,
  loadEvents,
  loadUser,
  requestPersistence,
  save,
  saveEvents,
  savePart,
  saveUser,
  saveRules,
  saveRulesArchive,
} from "./store.js";
import type { RulesArchive, StoredLedger } from "./store.js";
import {
  appendEvent,
  canReverse,
  MAX_EVENTS,
  KIND_LABELS,
  makeEvent,
  reverse,
  reverseRule,
} from "./events.js";
import type { CodingBatchEntry, EventKind, LedgerEvent } from "./events.js";

/**
 * The whole front end.
 *
 * Files are read with the FileReader API and parsed by @nzosa/core in
 * this tab. Nothing is uploaded: there is no fetch call in this application,
 * which is a property worth keeping as it grows.
 */

interface FileReport {
  name: string;
  importer: string;
  account: string;
  count: number;
  problems: ImportProblem[];
  error?: string;
}

type Filter = "all" | "review" | "duplicate";

const state = {
  ledger: emptyLedger() as StoredLedger,
  filed: [] as FiledReturn[],
  rules: undefined as RuleSet | undefined,
  varianceRows: [] as VarianceRow[],
  varianceProblems: [] as string[],
  varianceAccounts: [] as string[],
  page: "reconcile",
  reconcileAccounts: [] as string[],
  reconcileSearch: "",
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
  reconcileFilter: "todo" as "todo" | "suggested" | "nocode" | "coded" | "all",
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
  lastRule: null as { keyword: string; code: string; alsoCoded: number } | null,
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
  filter: "all" as Filter,
  search: "",
  busy: false,
};

const $ = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
};

/**
 * Where a fetch from the feed should start.
 *
 * One request covers every account at once, so the window has to suit the
 * account furthest behind rather than the ledger as a whole. Taking the last
 * transaction anywhere in the books meant an account that had not been
 * imported for months -- or a newly connected one with nothing at all -- was
 * asked only for the last week, and the rest never arrived. Nothing failed and
 * nothing was said; the account was simply short.
 *
 * So the earliest of the per-account dates, and nothing at all when any mapped
 * account is empty, because everything it holds is still to come.
 */
function feedStartDate(mapping: Record<string, string>): string | undefined {
  const mapped = [...new Set(Object.values(mapping).filter((to) => to !== ""))];
  if (mapped.length === 0) return undefined;

  const latestFor = new Map<string, string>();
  for (const transaction of state.ledger.transactions) {
    const seen = latestFor.get(transaction.account);
    if (seen === undefined || transaction.date > seen) {
      latestFor.set(transaction.account, transaction.date);
    }
  }

  if (mapped.some((account) => !latestFor.has(account))) return undefined;

  const earliest = mapped.map((account) => latestFor.get(account) as string).sort()[0];
  if (earliest === undefined) return undefined;

  // The same week of overlap, because a charge settles after the date it
  // carries and resuming exactly where an account ends steps over it.
  const day = new Date(`${earliest}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - 7);
  return day.toISOString().slice(0, 10);
}

/**
 * Bring in what the feed has, on opening, without being asked.
 *
 * This is the step a feed exists to remove. Somebody who connected one wants
 * what it holds; making them press a button for it every time puts the manual
 * step back in a different place.
 *
 * It runs after everything else and is not waited for: a slow feed or a bank
 * having a bad morning must not hold up books that are already on the screen.
 * It says what it did, because something that changes a ledger on its own has
 * to be visible, and it does nothing at all until accounts have been mapped --
 * an unmapped feed has nowhere to put anything.
 */
async function autoFetchFromFeed(): Promise<void> {
  if (!writesToFolder()) return;

  try {
    const status = (await fetch("/api/feed").then((r) => r.json())) as {
      configured: boolean;
      autoFetch: boolean;
      accounts: Record<string, string>;
    };
    if (!status.configured || !status.autoFetch) return;

    const mapping = status.accounts ?? {};
    const mapped = Object.values(mapping).filter((to) => to !== "");
    if (mapped.length === 0) return;

    const start = feedStartDate(mapping);
    const search = start === undefined ? "" : `?start=${encodeURIComponent(`${start}T00:00:00.000Z`)}`;

    const answer = (await fetch(`/api/feed/transactions${search}`).then((r) => r.json())) as {
      items?: AkahuTransaction[];
      error?: string;
    };
    if (answer.error !== undefined) throw new Error(answer.error);

    const read = fromAkahu(answer.items ?? [], {
      accountFor: (id) => {
        const to = mapping[id];
        return to === undefined || to === "" ? null : to;
      },
    });
    if (read.transactions.length === 0) return;

    const before = state.ledger.transactions.length;
    await addTransactions(read.transactions, {
      importer: "akahu",
      file: "bank feed, on opening",
      problems: read.problems,
    });
    const added = state.ledger.transactions.length - before;

    // Nothing new is the ordinary case and says nothing. Something new is
    // worth a line, because it arrived without anybody asking.
    if (added === 0) return;
    state.startupMessage =
      `${added} new transaction${added === 1 ? "" : "s"} from the bank feed. ` +
      "They are on the Bank import page with anything that needs a decision.";
    // Through showPage rather than render: the startup line is drawn there,
    // and setting the state without it left the message written down and never
    // shown -- which for something that changed the ledger on its own is the
    // one thing it must not do.
    showPage(state.page);
  } catch (error) {
    // Quiet on the page that is showing: the books are fine, the feed is not,
    // and the Bank feed page is where that belongs.
    state.feedProblem = (error as Error).message;
  }
}

/**
 * Give a brand new set of books the standard chart of accounts.
 *
 * Starting empty is honest and useless. With no chart there is nothing to code
 * to, the account picker is empty, and the first thing anybody has to do is go
 * and find a chart of accounts somewhere else -- and what they would find is
 * very nearly this one, because it is the standard New Zealand small-company
 * chart, in the numbering an accountant here expects.
 *
 * Only when the books are genuinely new: no chart, nothing imported, nothing
 * coded. Someone who has deliberately cleared their chart down to the accounts
 * they use has a ledger with transactions in it, and must not find sixty-six
 * accounts back the next time they open the app.
 */
async function seedStarterChart(): Promise<void> {
  if (state.chart.length > 0) return;
  if (state.ledger.transactions.length > 0) return;
  if (Object.keys(state.ledger.overrides ?? {}).length > 0) return;

  const chart = starterChart();
  state.chart = chart;
  state.ledger = { ...state.ledger, chart };
  state.persistent = await savePart(state.ledger, "chart");
  await record(
    "chart",
    `Started with the standard chart of accounts, ${chart.length} accounts`,
    null,
    null,
  );
}

async function init(): Promise<void> {
  const loaded = await load();
  state.ledger = loaded.ledger;
  state.persistent = loaded.persistent;

  // Classify what is already stored, so the review queue survives a reload.
  reclassify();
  // Once, here -- not in reclassify, which runs on every coding change and
  // would drag somebody back to the queue each time they coded a line.
  showWhatNeedsDeciding();
  state.chart = state.ledger.chart ?? [];
  // Ask before anything is written, so the first save is already protected.
  state.durable = await requestPersistence();
  // Only when there is no folder behind the app. The data/ folder is a seed
  // for a browser that has nothing in it; a ledger folder is the books
  // themselves, and loading a second set of files over the top is the muddle
  // that makes clearing look as though it had not worked.
  if (!writesToFolder()) await seedBrowser();

  renderFormats();
  wireUp();
  render();
  const storedRules = await loadRules();
  if (storedRules) {
    state.rules = storedRules.rules;
    state.rulesName = storedRules.name;
    state.rulesLoadedAt = storedRules.loadedAt;
  }
  // Before anything below can record what it did. `record` appends to
  // `state.events` and writes the lot back, so anything recording before the
  // log is read would save a log of one and lose what was there -- which the
  // entity setup below has always been one changed ledger away from doing.
  state.events = await loadEvents();
  state.who = await loadUser();

  // A new set of books starts with a chart rather than with nothing.
  await seedStarterChart();
  // A ledger folder holds the chart with its entity columns, but the model
  // those columns describe is derived rather than stored -- it used to be built
  // when a chart CSV was loaded, which never happens when the chart comes from
  // the folder. Building it here means a folder is enough on its own.
  if ((state.ledger.entities?.entities ?? []).length === 0 && state.chart.length > 0) {
    await applyChartColumns(state.chart);
  }
  // A chart that named entities has made them by now; one that named none
  // gets the single entity these books plainly are.
  await ensureDefaultEntity();
  // And the rows that carried the mapping have done their job.
  await tidyChart();

  state.rulesArchive = await loadRulesArchive();
  state.filed = state.ledger.filedReturns ?? [];
  state.varianceAccounts = state.ledger.varianceAccounts ?? [];
  // Deduplicated on the way in as well as on the way out, so a set of books
  // that already holds the same export twice is put right by opening it rather
  // than by the person working out what happened and loading the file again.
  state.reference = dedupeReference(state.ledger.reference ?? []);
  if (state.reference.length !== (state.ledger.reference ?? []).length) {
    state.ledger = { ...state.ledger, reference: state.reference };
    state.persistent = await savePart(state.ledger, "reference");
  }
  // Restoring the returns is not enough: the comparison against them is derived,
  // so without this the page has the filed figures and nothing to show.
  if (state.filed.length > 0) recomputeVariance();

  // Last, and not waited for. A feed that is slow, or a bank that is down,
  // must not hold up an app whose books are already on the screen.
  void autoFetchFromFeed();

  // Someone opening this for the first time has nothing to reconcile, and the
  // Reconcile page cannot say what to do about that. Setup can: it lists what
  // is missing and what each thing would give them. Once there are
  // transactions, Reconcile is the page you actually live on.
  if (state.ledger.transactions.length === 0) state.page = "setup";

  showPage(state.page);
}

/**
 * Re-run deduplication over the whole ledger.
 *
 * Cheap enough to do on every change at this size, and it means the displayed
 * status is always derived from the current allowlist rather than cached from
 * whenever the import happened.
 */
function reclassify(): void {
  state.entries = dedupe(state.ledger.transactions, {
    legitimateDuplicates: state.ledger.legitimateDuplicates,
  }).entries;
}

function wireUp(): void {
  const picker = $<HTMLInputElement>("file-input");
  const drop = $<HTMLElement>("dropzone");

  $("pick-button").addEventListener("click", () => picker.click());
  picker.addEventListener("change", () => {
    if (picker.files) void handleFiles([...picker.files]);
    picker.value = "";
  });

  for (const event of ["dragenter", "dragover"]) {
    drop.addEventListener(event, (e) => {
      e.preventDefault();
      drop.classList.add("dragging");
    });
  }
  for (const event of ["dragleave", "drop"]) {
    drop.addEventListener(event, (e) => {
      e.preventDefault();
      drop.classList.remove("dragging");
    });
  }
  drop.addEventListener("drop", (e) => {
    const files = (e as DragEvent).dataTransfer?.files;
    if (files) void handleFiles([...files]);
  });

  // The same thing on Setup, except it takes anything and sorts it out itself.
  const setupPicker = $<HTMLInputElement>("setup-input");
  const setupDrop = $<HTMLElement>("setup-drop");
  $("setup-pick").addEventListener("click", () => setupPicker.click());
  setupPicker.addEventListener("change", () => {
    if (setupPicker.files) void loadWhatever([...setupPicker.files]);
    setupPicker.value = "";
  });
  for (const event of ["dragenter", "dragover"]) {
    setupDrop.addEventListener(event, (e) => {
      e.preventDefault();
      setupDrop.classList.add("dragging");
    });
  }
  for (const event of ["dragleave", "drop"]) {
    setupDrop.addEventListener(event, (e) => {
      e.preventDefault();
      setupDrop.classList.remove("dragging");
    });
  }
  setupDrop.addEventListener("drop", (e) => {
    const files = (e as DragEvent).dataTransfer?.files;
    if (files) void loadWhatever([...files]);
  });

  for (const filter of ["all", "review", "duplicate"] as const) {
    $(`filter-${filter}`).addEventListener("click", () => {
      state.filter = filter;
      render();
    });
  }

  $<HTMLInputElement>("search").addEventListener("input", (e) => {
    state.search = (e.target as HTMLInputElement).value.toLowerCase();
    renderTable();
  });

  for (const button of document.querySelectorAll<HTMLButtonElement>(".sidebar-nav button[data-page]")) {
    button.addEventListener("click", () => {
      showPage(button.dataset["page"] ?? "reconcile");
    });
  }
  $<HTMLInputElement>("reconcile-search").addEventListener("input", (e) => {
    state.reconcileSearch = (e.target as HTMLInputElement).value;
    renderReconcile();
  });
  $("sidebar-toggle").addEventListener("click", () => toggleNarrow());
  try {
    applyNarrow(localStorage.getItem(NARROW_KEY) === "yes");
  } catch {
    applyNarrow(false);
  }
  $("theme-toggle").addEventListener("click", () => cycleTheme());
  applyTheme(currentTheme());
  // Following the computer means noticing when the computer changes its mind.
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (currentTheme() === "system") applyTheme("system");
  });

  $("accept-all").addEventListener("click", () => void acceptAllShown());
  $<HTMLSelectElement>("reconcile-filter").addEventListener("change", (e) => {
    state.reconcileFilter = (e.target as HTMLSelectElement)
      .value as typeof state.reconcileFilter;
    renderReconcile();
  });
  $<HTMLInputElement>("rules-search").addEventListener("input", () => renderRules());
  $("check-pick").addEventListener("click", () => $<HTMLInputElement>("check-input").click());
  $("check-clear").addEventListener("click", () => clearCheck());
  $<HTMLInputElement>("check-input").addEventListener("change", (e) => {
    const files = [...((e.target as HTMLInputElement).files ?? [])];
    if (files.length > 0) void loadCheckFiles(files);
    (e.target as HTMLInputElement).value = "";
  });

  $("variance-pick").addEventListener("click", () => $<HTMLInputElement>("variance-input").click());
  $<HTMLInputElement>("variance-input").addEventListener("change", (e) => {
    const files = [...((e.target as HTMLInputElement).files ?? [])];
    if (files.length > 0) void loadFiledReturns(files);
    (e.target as HTMLInputElement).value = "";
  });

  $<HTMLSelectElement>("entity-filter").addEventListener("change", () => {
    state.entityFilter = $<HTMLSelectElement>("entity-filter").value;
    // The per-page account chips are a narrowing *within* an entity, so they
    // are cleared: keeping a chip from another entity would silently show
    // nothing and look like a bug.
    state.reconcileAccounts = [];
    state.checkAccounts = [];
    state.varianceAccounts = [];
    // The comparison is built from the accounts, so it has to be built again.
    recomputeVariance();
    showPage(state.page);
  });

  $<HTMLInputElement>("who").addEventListener("change", () => {
    state.who = $<HTMLInputElement>("who").value.trim();
    void saveUser(state.who);
  });
  $<HTMLSelectElement>("history-kind").addEventListener("change", () => renderHistory());
  $<HTMLSelectElement>("setup-source").addEventListener("change", () => renderSetup());
  $("balances-pick").addEventListener("click", () => $("balances-input").click());
  $<HTMLInputElement>("balances-input").addEventListener("change", (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) void checkBankBalances(file);
  });
  $("invoice-new").addEventListener("click", () => {
    editingInvoice = "";
    renderInvoiceEditor();
  });

  $("invoices-pick").addEventListener("click", () => $<HTMLInputElement>("invoices-input").click());
  $<HTMLInputElement>("invoices-input").addEventListener("change", (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) void loadInvoices(file);
    (e.target as HTMLInputElement).value = "";
  });
  $("allocations-pick").addEventListener("click", () =>
    $<HTMLInputElement>("allocations-input").click(),
  );
  $<HTMLInputElement>("allocations-input").addEventListener("change", (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) void loadAllocations(file);
    (e.target as HTMLInputElement).value = "";
  });
  $<HTMLInputElement>("invoice-search").addEventListener("input", () => renderInvoices());

  $("report-basis").addEventListener("change", () => renderReportsPage());
  $("report-gst").addEventListener("change", () => renderReportsPage());
  $("journals-pick").addEventListener("click", () => $<HTMLInputElement>("journals-input").click());
  $<HTMLInputElement>("journals-input").addEventListener("change", (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) void loadJournals(file);
    (e.target as HTMLInputElement).value = "";
  });

  $("assets-pick").addEventListener("click", () => $<HTMLInputElement>("assets-input").click());
  $("assets-pick2").addEventListener("click", () => $<HTMLInputElement>("assets-input").click());
  $<HTMLInputElement>("assets-input").addEventListener("change", (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) void loadAssets(file);
    (e.target as HTMLInputElement).value = "";
  });

  $("report-kind").addEventListener("change", () => renderReportsPage());
  $("report-owner").addEventListener("change", () => renderReportsPage());
  $("report-year").addEventListener("change", () => renderReportsPage());
  $("report-download").addEventListener("click", () => downloadReport());

  $("opening-pick").addEventListener("click", () => $<HTMLInputElement>("opening-input").click());
  $<HTMLInputElement>("opening-input").addEventListener("change", (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) void loadOpeningBalances(file);
    (e.target as HTMLInputElement).value = "";
  });

  $("chart-pick").addEventListener("click", () => $<HTMLInputElement>("chart-input").click());
  $("chart-save").addEventListener("click", () => saveChart());
  $<HTMLInputElement>("chart-input").addEventListener("change", (e) => {
    const files = [...((e.target as HTMLInputElement).files ?? [])];
    if (files.length > 0) void loadCheckFiles(files);
    (e.target as HTMLInputElement).value = "";
  });

  $("rules-pick").addEventListener("click", () => $<HTMLInputElement>("rules-input").click());
  $<HTMLInputElement>("rules-input").addEventListener("change", (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) void loadRulesFile(file);
    (e.target as HTMLInputElement).value = "";
  });

  $("export-button").addEventListener("click", exportLedger);
  $("import-ledger-button").addEventListener("click", () =>
    $<HTMLInputElement>("ledger-input").click(),
  );
  $<HTMLInputElement>("ledger-input").addEventListener("change", (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) void importLedger(file);
    (e.target as HTMLInputElement).value = "";
  });

  $("clear-button").addEventListener("click", () => {
    const count = state.ledger.transactions.length;
    if (count === 0) return;
    if (!confirm(`Delete all ${count} transactions from this browser? This cannot be undone.`)) {
      return;
    }
    void (async () => {
      await clear();
      state.ledger = emptyLedger();
      state.reports = [];
      reclassify();
      render();
    })();
  });
}

async function handleFiles(files: File[]): Promise<void> {
  if (files.length === 0 || state.busy) return;

  state.busy = true;
  state.reports = [];
  render();

  const account = $<HTMLInputElement>("account").value.trim();
  const currency = $<HTMLInputElement>("currency").value.trim().toUpperCase() || "NZD";
  const dayFirst = $<HTMLInputElement>("day-first").checked;

  const incoming: Transaction[] = [];

  for (const file of files) {
    const text = await file.text();

    try {
      const result = importFile(text, {
        file: file.name,
        defaultCurrency: currency,
        dayFirst,
        ...(account !== "" ? { account } : {}),
      });

      incoming.push(...result.transactions);
      state.reports.push({
        name: file.name,
        importer: result.importer,
        account: result.account,
        count: result.transactions.length,
        problems: result.problems,
      });
    } catch (error) {
      state.reports.push({
        name: file.name,
        importer: "",
        account: "",
        count: 0,
        problems: [],
        error: (error as Error).message,
      });
    }
  }

  // Existing rows go first so anything already in the ledger wins the tie and
  // keeps its provenance. Anything already judged a duplicate and thrown
  // away is not offered again.
  const discarded = new Set(state.ledger.removedDuplicates ?? []);
  const merged = dedupe(
    [...state.ledger.transactions, ...incoming.filter((t) => !discarded.has(t.id))],
    { legitimateDuplicates: state.ledger.legitimateDuplicates },
  );

  state.ledger = { ...state.ledger, transactions: merged.kept };
  state.entries = merged.entries;
  showWhatNeedsDeciding();

  state.persistent = await save(state.ledger);
  // Bank files are where somebody with no other accounting system starts, so
  // this is the moment their books first hold any accounts at all -- and the
  // moment to give them the one entity those accounts belong to. It was only
  // done on opening the ledger and after a chart import, so a person who
  // imported a statement and carried on saw no entity until they next reloaded.
  await ensureDefaultEntity();
  state.busy = false;
  render();
}

/**
 * Put transactions from somewhere other than a file into the ledger.
 *
 * The same merge a file import does, so a feed is not a second way in with its
 * own rules: the same duplicate check, the same review list, the same report at
 * the top of the Import page.
 *
 * Ids are assigned here for the same reason the file importers assign them
 * centrally -- from the transaction's own content, so the same transaction gets
 * the same id however it arrived, and a coding survives a change of route.
 */
async function addTransactions(
  incoming: Transaction[],
  report: { importer: string; file: string; problems: ImportProblem[] },
): Promise<void> {
  const counts = new Map<string, number>();
  for (const transaction of incoming) {
    const key = dedupeKey(transaction);
    const next = (counts.get(key) ?? 0) + 1;
    counts.set(key, next);
    transaction.occurrence = next;
  }
  for (const transaction of incoming) transaction.id = hash(dedupeKey(transaction));

  // Anything already judged a duplicate and thrown away does not come back.
  const removed = new Set(state.ledger.removedDuplicates ?? []);
  const wanted = incoming.filter((transaction) => !removed.has(transaction.id));

  const merged = dedupe([...state.ledger.transactions, ...wanted], {
    legitimateDuplicates: state.ledger.legitimateDuplicates,
  });

  state.ledger = { ...state.ledger, transactions: merged.kept };
  state.entries = merged.entries;
  showWhatNeedsDeciding();
  state.reports.push({
    name: report.file,
    importer: report.importer,
    account: "",
    count: incoming.length,
    problems: report.problems,
  });

  state.persistent = await save(state.ledger);
  // Bank data is where a person with no other system starts, so this is the
  // moment their books first have accounts in them. Waiting until the next
  // reload to give them the one entity those accounts belong to made the
  // first minutes of a new ledger look emptier than it was.
  await ensureDefaultEntity();
  render();
}

/** Mark a transaction's key as a genuine repeat and re-run classification. */
async function allow(transaction: Transaction): Promise<void> {
  const key = dedupeKey(transaction);
  if (!state.ledger.legitimateDuplicates.includes(key)) {
    state.ledger = {
      ...state.ledger,
      legitimateDuplicates: [...state.ledger.legitimateDuplicates, key],
    };
  }
  reclassify();
  state.persistent = await save(state.ledger);
  render();
}

async function remove(transaction: Transaction): Promise<void> {
  // Remembered, not just removed. The feed still holds it, and without a note
  // that it was judged it arrives again on the next fetch and is asked about
  // all over again -- a decision that has to be made every morning is not a
  // decision, it is a chore.
  const removed = state.ledger.removedDuplicates ?? [];
  state.ledger = {
    ...state.ledger,
    transactions: state.ledger.transactions.filter((t) => t !== transaction),
    removedDuplicates: removed.includes(transaction.id) ? removed : [...removed, transaction.id],
  };
  reclassify();
  state.persistent = await save(state.ledger);
  render();
}

function exportLedger(): void {
  const blob = new Blob([`${JSON.stringify(state.ledger, null, 2)}\n`], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "ledger.json";
  link.click();
  URL.revokeObjectURL(url);
}

async function importLedger(file: File): Promise<void> {
  try {
    const parsed = JSON.parse(await file.text()) as Partial<StoredLedger>;
    if (parsed.version !== 1 || !Array.isArray(parsed.transactions)) {
      throw new Error("That file is not a NZOSA ledger.");
    }
    // Setup is not transaction data. The chart, entities, asset register,
    // ledger and hand-entered income were configured in this browser and are
    // not in an exported ledger file, so importing one must not silently
    // discard them -- it did, which turned a refresh into a reset.
    state.ledger = {
      ...state.ledger,
      version: 1,
      legitimateDuplicates: parsed.legitimateDuplicates ?? [],
      transactions: parsed.transactions,
      ...(parsed.splits ? { splits: parsed.splits } : {}),
      ...(parsed.overrides ? { overrides: parsed.overrides } : {}),
      ...(parsed.varianceNotes ? { varianceNotes: parsed.varianceNotes } : {}),
      ...(parsed.chart ? { chart: parsed.chart } : {}),
      ...(parsed.entities ? { entities: parsed.entities } : {}),
      ...(parsed.assets ? { assets: parsed.assets } : {}),
      ...(parsed.journals ? { journals: parsed.journals } : {}),
      ...(parsed.invoices ? { invoices: parsed.invoices } : {}),
      ...(parsed.allocations ? { allocations: parsed.allocations } : {}),
      ...(parsed.taxExtras ? { taxExtras: parsed.taxExtras } : {}),
    };
    state.chart = state.ledger.chart ?? [];
    reclassify();
    state.persistent = await save(state.ledger);
    state.reports = [];
    render();
  } catch (error) {
    alert((error as Error).message);
  }
}

function renderFormats(): void {
  $("formats").innerHTML = importers
    .map(
      (importer) =>
        `<li><strong>${escapeHtml(importer.label)}</strong><span>${escapeHtml(
          importer.description,
        )}</span></li>`,
    )
    .join("");
}

async function loadFiledReturns(files: File[]): Promise<void> {
  const { returns, problems } = await readFiledReturns(files);
  // Re-importing a period replaces it rather than adding a second copy.
  const byPeriod = new Map(state.filed.map((one) => [one.periodEnd, one]));
  for (const one of returns) byPeriod.set(one.periodEnd, one);
  state.filed = [...byPeriod.values()].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  state.varianceProblems = problems;
  // Kept with the ledger rather than in memory. A return that has been filed is
  // a fact about the year, not about this browser session, and re-loading the
  // same workbook after every reload was work nobody should have to repeat.
  state.ledger = { ...state.ledger, filedReturns: state.filed };
  state.persistent = await save(state.ledger);
  recomputeVariance();
  renderVariance();
}

function recomputeVariance(): void {
  if (state.filed.length === 0) {
    state.varianceRows = [];
    return;
  }
  state.varianceRows = buildRows(state.filed, {
    transactions: state.ledger.transactions,
    splits: state.ledger.splits ?? {},
    overrides: state.ledger.overrides ?? {},
    rules: state.rules,
    notes: state.ledger.varianceNotes ?? [],
    // The same fallback the profit and loss uses, so an account treated by the
    // chart is treated the same way in both.
    chartTreatment: (code: string) => chartTreatmentOf(code),
    // Narrowed by the chosen entity, as every other page's selection is.
    // Choosing an entity narrowed the account chips here and left the figures
    // alone, so a page headed by one company's name compared everybody's bank
    // accounts against that company's filed returns and reported the rest of
    // the household as a disagreement.
    accounts: accountsFor(state.varianceAccounts),
  });
}

/**
 * The bank accounts the chosen entity uses.
 *
 * Empty means no restriction, which is both the answer for "all entities" and
 * the honest answer when an entity has no bank account assigned yet — showing
 * nothing at all would look like a fault rather than a gap in the setup.
 */
function entityBankAccounts(): string[] {
  if (state.entityFilter === "") return [];
  const model = state.ledger.entities ?? emptyEntityModel();
  const mine = Object.entries(model.banks)
    .filter(([, ids]) => ids.includes(state.entityFilter))
    .map(([account]) => account);
  return mine;
}

/** A page's account selection, narrowed by the entity when one is chosen. */
function accountsFor(chosen: readonly string[]): string[] {
  const entity = entityBankAccounts();
  if (chosen.length === 0) return entity;
  if (entity.length === 0) return [...chosen];
  return chosen.filter((account) => entity.includes(account));
}

/** Fill the header selector from the entities that exist. */
/**
 * Take whatever came out of the accounting system, in one go.
 *
 * Setting a set of books up was seven errands: each report fetched on the same
 * visit to the same system, then loaded on a different page here, through a
 * different button, in an order nobody was told. Most of that is navigation
 * rather than work, and none of it is necessary -- every one of these reports
 * announces itself in its own heading row, and the parsers already knew those
 * headings because each checks for its own before reading a line.
 *
 * So: hand over the lot. Each file is identified, sent where it belongs, and
 * named in the list underneath, with anything unrecognised said plainly rather
 * than pushed through the nearest parser.
 */
async function loadWhatever(files: File[]): Promise<void> {
  const told = $("setup-loaded");
  told.textContent = "";
  const said: string[] = [];
  const say = (line: string): void => {
    said.push(line);
    told.textContent = "";
    for (const one of said) {
      const row = document.createElement("div");
      row.textContent = one;
      told.append(row);
    }
  };

  // Bank statements go through the importer together: it dedupes across the
  // files it is given, and feeding them one at a time would ask about the same
  // overlap once per file.
  const banks: File[] = [];
  const rest: { file: File; identified: Identified }[] = [];

  for (const file of files) {
    const text = await asCsvText(file.name, new Uint8Array(await file.arrayBuffer()));
    const identified = identifyExport(text);
    if (identified.kind === "bank") banks.push(file);
    else rest.push({ file, identified });
  }

  if (banks.length > 0) {
    say(`${banks.length} bank statement${banks.length === 1 ? "" : "s"} — importing…`);
    await handleFiles(banks);
    said.pop();
    say(`${banks.length} bank statement${banks.length === 1 ? "" : "s"} imported.`);
  }

  for (const { file, identified } of rest) {
    try {
      switch (identified.kind) {
        case "chart":
        case "account-transactions":
          // The same reader takes both: it lifts the chart out of a chart
          // export, and the coding and the invoice payments out of an account
          // transactions one.
          await loadCheckFiles([file]);
          break;
        case "journal-report":
        case "general-ledger-detail":
          await loadJournals(file);
          break;
        case "trial-balance":
          await loadOpeningBalances(file);
          break;
        case "fixed-assets":
          await loadAssets(file);
          break;
        case "invoices":
          await loadInvoices(file);
          break;
        case "daily-balances":
          await checkBankBalances(file);
          break;
        case "gst-return":
          await loadFiledReturns([file]);
          break;
        default:
          say(`${file.name} — not recognised, so nothing was done with it.`);
          continue;
      }
      say(
        `${file.name} — ${identified.what}` +
          (identified.alsoUseFor === "allocations" ? ", and the invoice payments in it" : "") +
          ".",
      );
    } catch (error) {
      say(`${file.name} — could not be read: ${(error as Error).message}`);
    }
  }

  if (said.length === 0) say("Nothing was loaded.");
  // Only reachable from Setup today, but named by page rather than by hand for
  // the same reason as above: the next thing to call this may not be.
  showPage(state.page);
}

/** The form for starting another entity, under the ones that already exist. */
function addEntityForm(): HTMLElement {
  const row = document.createElement("div");
  row.className = "entity-add-row";

  const name = document.createElement("input");
  name.type = "text";
  name.placeholder = "New entity name";

  // Kind and registration are asked for here rather than left to be found
  // later: they decide whether losses are ring-fenced and whether reports are
  // net of GST, and an entity made without them is one whose first report is
  // wrong with nothing to prompt anybody.
  const kind = document.createElement("select");
  for (const [value, caption] of [
    ["business", "Business"],
    ["residential", "Residential rental"],
    ["commercial", "Commercial rental"],
    ["personal", "Personal"],
  ] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = caption;
    kind.append(option);
  }
  kind.title = "Residential rental losses are ring-fenced; the others are not.";

  const gstWrap = document.createElement("label");
  gstWrap.className = "entity-add-gst";
  const gst = document.createElement("input");
  gst.type = "checkbox";
  gst.checked = true;
  gstWrap.append(gst, document.createTextNode(" GST registered"));

  const add = document.createElement("button");
  add.type = "button";
  add.textContent = "Add entity";
  add.addEventListener("click", () => {
    const wanted = name.value.trim();
    if (wanted === "") return;
    const model = state.ledger.entities ?? emptyEntityModel();
    const id = entityId(wanted);
    if (model.entities.some((e) => e.id === id)) {
      alert(`There is already an entity called "${wanted}".`);
      return;
    }
    name.value = "";
    void saveEntities({
      ...model,
      entities: [
        ...model.entities,
        { id, name: wanted, kind: kind.value as EntityKind, gstRegistered: gst.checked },
      ],
    });
  });

  row.append(name, kind, gstWrap, add);
  return row;
}

/**
 * The asset register, on a page of its own.
 *
 * It used to be a button in the Reports header that appeared only when the
 * depreciation report was selected -- so the one input the accounts cannot be
 * produced without was reachable only by first choosing a report that needs
 * it. This is the input; depreciation is what comes out.
 */
/**
 * The disposals, and the one figure that has to be supplied by hand.
 *
 * A fixed asset register carries the cost, the rate and the date something was
 * disposed of. It does not carry what it sold for, and without that a disposal
 * cannot be posted at all: the same asset scrapped for nothing and sold for
 * more than it cost differ by the whole of the profit.
 *
 * So this lists what left during a year, works out the book value it left at,
 * and takes the proceeds. It then shows the three figures that follow, because
 * they are the ones somebody would check against a set of accounts -- and
 * because seeing a capital gain appear tells you the sale beat the original
 * cost, which is worth noticing.
 */
function renderDisposals(body: HTMLElement): void {
  const assets = state.ledger.assets ?? [];
  const disposed = assets.filter((a) => a.disposed !== null);
  if (disposed.length === 0) return;

  const heading = document.createElement("h3");
  heading.textContent = `Disposals (${disposed.length})`;
  body.append(heading);

  const years = [...new Set(state.ledger.transactions.map((t) => financialYearOf(t.date)))];
  // Book value at disposal comes from the schedule for the year it went, since
  // that is where the convention lives: an asset disposed of during a year
  // takes no depreciation that year, and its book value goes to the disposal.
  const bookValues = new Map<string, Cents>();
  for (const year of years) {
    const schedule = depreciationSchedule(assets, {
      from: `${year - 1}-04-01`,
      to: `${year}-03-31`,
    });
    for (const row of schedule.rows) {
      if (row.disposedInPeriod) bookValues.set(row.asset.number, row.bookValueAtDisposal);
    }
  }

  const proceeds = state.ledger.assetProceeds ?? {};
  const missing = disposed.filter((a) => proceeds[a.number] === undefined).length;
  if (missing > 0) {
    body.append(
      note(
        `${missing} of these have no sale proceeds recorded, so nothing is posted for them: ` +
          "the asset is still on the balance sheet at book value and the profit is short " +
          "whatever it fetched. Enter what each sold for, excluding GST.",
      ),
    );
  }

  const fromJournals = document.createElement("button");
  fromJournals.type = "button";
  fromJournals.textContent = "Read proceeds from the journal report";
  fromJournals.addEventListener("click", () => void proceedsFromJournals());
  body.append(fromJournals);

  const table = document.createElement("table");
  table.className = "report-table owner-table";
  const head = document.createElement("thead");
  head.innerHTML =
    "<tr><th>Asset</th><th>Disposed</th><th>Cost</th><th>Depreciation</th>" +
    "<th>Book value</th><th>Proceeds</th><th>Recovered</th><th>Capital gain</th>" +
    "<th>Loss</th><th></th></tr>";
  const tbody = document.createElement("tbody");

  for (const asset of [...disposed].sort((a, b) => (a.disposed ?? "").localeCompare(b.disposed ?? ""))) {
    const book = bookValues.get(asset.number);
    const sold = proceeds[asset.number];
    const tr = document.createElement("tr");
    tr.append(nameCell(`${asset.number} ${asset.name}`));
    tr.append(nameCell(asset.disposed ?? ""));
    tr.append(amountCell(formatAmount(asset.cost)));

    if (book === undefined) {
      // Disposed outside every year the transactions cover, so no schedule ran
      // for it. Saying so beats showing blanks that look like nil.
      tr.append(nameCell("before this ledger"));
      tr.append(nameCell(""));
      tr.append(nameCell(""));
      tr.append(nameCell(""));
      tr.append(nameCell(""));
      tr.append(nameCell(""));
      tr.append(nameCell(""));
      tbody.append(tr);
      continue;
    }

    tr.append(amountCell(formatAmount(asset.cost - book)));
    tr.append(amountCell(formatAmount(book)));

    if (sold === undefined) {
      const cell = document.createElement("td");
      cell.className = "report-amount";
      const ask = document.createElement("button");
      ask.type = "button";
      ask.className = "link-button";
      ask.textContent = "enter";
      ask.addEventListener("click", () => askProceeds(asset.number, asset.name, 0));
      cell.append(ask);
      tr.append(cell);
      tr.append(nameCell(""));
      tr.append(nameCell(""));
      tr.append(nameCell(""));
      tr.append(nameCell(""));
      tbody.append(tr);
      continue;
    }

    const d = disposalOf({
      cost: asset.cost,
      accumulatedDepreciation: asset.cost - book,
      proceeds: sold,
    });
    tr.append(amountCell(formatAmount(d.proceeds)));
    tr.append(amountCell(d.depreciationRecovered === 0 ? "" : formatAmount(d.depreciationRecovered)));
    tr.append(amountCell(d.capitalGain === 0 ? "" : formatAmount(d.capitalGain)));
    tr.append(amountCell(d.lossOnSale === 0 ? "" : formatAmount(d.lossOnSale)));

    const actions = document.createElement("td");
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "link-button";
    edit.textContent = "edit";
    edit.addEventListener("click", () => askProceeds(asset.number, asset.name, sold));
    actions.append(edit);
    tr.append(actions);
    tbody.append(tr);
  }

  table.append(head, tbody);
  body.append(table);
  body.append(
    note(
      "Depreciation recovered is assessable income: the part of the depreciation claimed that " +
        "the sale showed was too generous. A capital gain is not assessable, and is anything " +
        "above what the asset cost. A loss on sale is deductible. At most two of the three are " +
        "ever more than nothing.",
    ),
  );
}

function askProceeds(number: string, name: string, current: Cents): void {
  const amount = window.prompt(
    `What did ${number} ${name} sell for, excluding GST?\n\n` +
      "Nothing at all, if it was scrapped: the whole book value is then a loss on sale.",
    (current / 100).toFixed(2),
  );
  if (amount === null) return;
  const parsed = parseAmount(amount.trim());
  if (parsed === null) {
    alert(`"${amount}" is not an amount.`);
    return;
  }
  void saveProceeds(number, Math.abs(parsed));
}

async function saveProceeds(number: string, cents: Cents): Promise<void> {
  const before = state.ledger.assetProceeds ?? {};
  const assetProceeds = { ...before, [number]: cents };
  state.ledger = { ...state.ledger, assetProceeds };
  state.persistent = await savePart(state.ledger);
  await record(
    "disposal",
    `${number} sold for ${(cents / 100).toFixed(2)}`,
    before[number] ?? null,
    cents,
    number,
  );
  reclassify();
  renderAssetsPage();
}

/**
 * Take the proceeds from the disposal journals the accounting system posted.
 *
 * Its journal names the asset and carries the outcome -- what was recovered,
 * any capital gain, any loss -- so the proceeds can be worked back out of it:
 * book value plus what was recovered plus any gain, less any loss. That is
 * arithmetic on figures somebody else already agreed, not a guess.
 *
 * Reversals are why this cannot simply add up every journal mentioning the
 * asset. A disposal reversed and re-posted appears three times, and summing
 * them would give a figure that never happened; the last one dated on or
 * before the disposal date is the one that stands.
 */
async function proceedsFromJournals(): Promise<void> {
  const journals = state.ledger.journals ?? [];
  if (journals.length === 0) {
    alert(
      "No journal report loaded. Load one on the Coding reconciliation page, and the disposal journals " +
        "in it can be read for what each asset sold for.",
    );
    return;
  }

  const assets = state.ledger.assets ?? [];
  const years = [...new Set(state.ledger.transactions.map((t) => financialYearOf(t.date)))];
  const bookValues = new Map<string, Cents>();
  for (const year of years) {
    const schedule = depreciationSchedule(assets, {
      from: `${year - 1}-04-01`,
      to: `${year}-03-31`,
    });
    for (const row of schedule.rows) {
      if (row.disposedInPeriod) bookValues.set(row.asset.number, row.bookValueAtDisposal);
    }
  }

  const found = new Map<string, Cents>();
  const skipped: string[] = [];
  for (const asset of assets) {
    if (asset.disposed === null) continue;
    const book = bookValues.get(asset.number);
    if (book === undefined) continue;

    // The live disposal for this asset: its own journals, reversals left out,
    // latest first.
    const mine = journals
      .filter(
        (j) =>
          j.narration.includes(asset.number) &&
          /disposal/i.test(j.narration) &&
          !/^reversed:/i.test(j.narration.trim()),
      )
      .sort((a, b) => b.date.localeCompare(a.date));
    const journal = mine[0];
    if (journal === undefined) {
      skipped.push(asset.number);
      continue;
    }

    const on = (code: string): Cents =>
      journal.lines.filter((l) => l.accountCode === code).reduce((sum, l) => sum + l.amount, 0);
    const recovered = -on("300");
    const gain = -on("301");
    const loss = on("470");
    found.set(asset.number, book + recovered + gain - loss);
  }

  if (found.size === 0) {
    alert("No disposal journals found for the assets in the register.");
    return;
  }

  const lines = [...found]
    .map(([number, cents]) => `  ${number}  ${(cents / 100).toFixed(2)}`)
    .join("\n");
  const ok = confirm(
    `Proceeds worked back from ${found.size} disposal journal${found.size === 1 ? "" : "s"}:\n\n` +
      lines +
      (skipped.length > 0 ? `\n\nNo journal found for: ${skipped.join(", ")}` : "") +
      "\n\nThis replaces any proceeds already entered.",
  );
  if (!ok) return;

  const before = state.ledger.assetProceeds ?? {};
  const assetProceeds = { ...before, ...Object.fromEntries(found) };
  state.ledger = { ...state.ledger, assetProceeds };
  state.persistent = await savePart(state.ledger);
  await record(
    "disposal",
    `Proceeds read from the journal report for ${found.size} assets`,
    before,
    assetProceeds,
    "proceeds",
  );
  reclassify();
  renderAssetsPage();
}

function renderAssetsPage(): void {
  const body = $("assets-body");
  body.textContent = "";
  const assets = state.ledger.assets ?? [];

  if (assets.length === 0) {
    body.append(
      note(
        "No assets loaded. Without them the accounts are short exactly one figure: " +
          "depreciation, and any gain or loss on something sold.",
      ),
    );
    return;
  }

  const total = assets.reduce((sum, a) => sum + a.cost, 0);
  body.append(
    note(
      `${assets.length} asset${assets.length === 1 ? "" : "s"}, ${formatAmount(total)} at cost. ` +
        "The depreciation schedule is on the Reports page.",
    ),
  );

  const table = document.createElement("table");
  table.className = "report-table owner-table";
  const head = document.createElement("thead");
  head.innerHTML =
    "<tr><th>Number</th><th>Asset</th><th>Type</th><th>Purchased</th>" +
    "<th>Cost</th><th>Rate</th><th>Disposed / status</th></tr>";
  const tbody = document.createElement("tbody");

  for (const asset of [...assets].sort((a, b) => (a.purchased ?? "").localeCompare(b.purchased ?? ""))) {
    const tr = document.createElement("tr");
    tr.append(nameCell(asset.number));
    tr.append(nameCell(asset.name));
    tr.append(nameCell(asset.type));
    tr.append(nameCell(asset.purchased ?? ""));
    tr.append(amountCell(formatAmount(asset.cost)));
    tr.append(amountCell(`${asset.rate}%`));
    tr.append(nameCell(asset.disposed ?? asset.status));
    tbody.append(tr);
  }
  table.append(head, tbody);
  body.append(table);

  renderDisposals(body);
}

/**
 * Which set of books is open, in the corner of the menu.
 *
 * This was a dropdown that also switched between them. Switching lives on the
 * Books page now, where there is room to say what each set holds before you
 * open it -- but the name stays here, because not knowing which books you are
 * coding into is how a morning's work ends up in the wrong ones.
 */
async function renderOpenBooks(): Promise<void> {
  const button = $("ledger-open");
  if (!writesToFolder()) {
    button.hidden = true;
    return;
  }
  const [all, current] = await Promise.all([ledgers(), currentLedger()]);
  const open = all.find((one) => one.id === current);
  $("ledger-open-name").textContent = open?.name ?? current;
  button.hidden = false;
}

async function chooseLedger(value: string): Promise<void> {
  let id = value;
  let label: string | undefined;
  if (id === "\u0000new") {
    const name = prompt(
      "Name for the new set of books.\n\nIt becomes a folder beside the others, " +
        "and starts empty.",
      "",
    );
    if (name === null || name.trim() === "") return;
    // A folder name, so only what a folder name may hold.
    label = name.trim();
    id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (id === "") {
      alert("That name has nothing in it a folder can be called.");
      return;
    }
  }

  if (!(await switchLedger(id, label))) {
    alert("Could not open that set of books.");
    return;
  }
  // Everything on screen belongs to the ledger that was open, so the honest
  // thing is to start again rather than repaint around it.
  location.reload();
}

/**
 * Light, dark, or whatever the computer is set to.
 *
 * Three states rather than two, because "follow the machine" is the right
 * default and is not the same as either choice -- someone whose laptop goes
 * dark at sunset should not have to come here twice a day.
 *
 * Kept in localStorage rather than with the books: which theme someone likes is
 * a fact about them and this screen, not about the ledger, and it should not
 * travel in a folder that gets copied to a colleague.
 */
type Theme = "system" | "light" | "dark";

const THEME_KEY = "nzosa:theme";

/**
 * Whether the menu is narrowed to icons.
 *
 * Beside the theme in localStorage rather than with the books: how wide
 * somebody likes their menu is a fact about them and this screen, and has no
 * business travelling in a folder that gets copied to a colleague.
 */
const NARROW_KEY = "nzosa:narrow";

function applyNarrow(narrow: boolean): void {
  document.querySelector(".shell")?.classList.toggle("narrow", narrow);
  const button = $("sidebar-toggle");
  button.setAttribute("aria-expanded", String(!narrow));
  button.title = narrow ? "Show the menu names" : "Narrow the menu to icons";
}

function toggleNarrow(): void {
  const narrow = !document.querySelector(".shell")?.classList.contains("narrow");
  try {
    localStorage.setItem(NARROW_KEY, narrow ? "yes" : "no");
  } catch {
    // Not remembered, but still applied for this session.
  }
  applyNarrow(narrow);
}

function currentTheme(): Theme {
  try {
    const held = localStorage.getItem(THEME_KEY);
    if (held === "light" || held === "dark" || held === "system") return held;
  } catch {
    // A browser refusing storage is not a reason to render nothing.
  }
  return "system";
}

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);

  // The button says what pressing it does next, not what the theme is now.
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  const button = $("theme-toggle");
  button.textContent = dark ? "☀" : "☽";
  button.title =
    theme === "system"
      ? `Following this computer (${dark ? "dark" : "light"}). Click for ${dark ? "light" : "dark"}.`
      : `${theme[0]?.toUpperCase()}${theme.slice(1)}. Click to cycle light, dark, follow the computer.`;
}

function cycleTheme(): void {
  const order: Theme[] = ["system", "light", "dark"];
  const next = order[(order.indexOf(currentTheme()) + 1) % order.length] as Theme;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // Not remembered, but still applied for this session.
  }
  applyTheme(next);
}

function renderEntityFilter(): void {
  const select = $<HTMLSelectElement>("entity-filter");
  const model = state.ledger.entities ?? emptyEntityModel();
  const chosen = state.entityFilter;
  select.textContent = "";
  const all = document.createElement("option");
  all.value = "";
  all.textContent = "All entities";
  select.append(all);
  for (const entity of model.entities) {
    const option = document.createElement("option");
    option.value = entity.id;
    option.textContent = entity.name;
    option.selected = entity.id === chosen;
    select.append(option);
  }
  // Hide the whole control, not just the select. Hiding the select alone left
  // the word "Entity" sitting under the title next to nothing, which is what
  // every first run saw.
  const control = select.closest("label");
  if (control instanceof HTMLElement) control.hidden = model.entities.length === 0;
  select.hidden = model.entities.length === 0;
}

function showPage(page: string): void {
  // Arriving at a page half way down it is disorienting: the sections are all
  // one scrolling document, so the position simply carried over from wherever
  // you were on the last one. Only on an actual change of page, because this
  // is also how a page redraws itself -- jumping to the top every time
  // somebody codes a line would be worse than the thing it fixes.
  // The bank feed used to be a page of its own and is now a section of the
  // import page. A ledger saved before that still names it.
  if (page === "feed") page = "import";
  const moved = state.page !== page;
  state.page = page;
  for (const section of document.querySelectorAll<HTMLElement>("section.page")) {
    section.hidden = section.id !== `page-${page}`;
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>(".sidebar-nav button[data-page]")) {
    button.classList.toggle("active", button.dataset["page"] === page);
  }
  // The page name lives in the topbar now rather than inside each section, so
  // it is read off the sidebar rather than repeated in a second list that
  // could drift from it.
  const chosen = document.querySelector<HTMLButtonElement>(
    `.sidebar-nav button[data-page="${page}"]`,
  );
  $("page-title").textContent = chosen?.querySelector("span")?.textContent ?? "";

  const status = $("startup-status");
  status.textContent = state.startupMessage;
  status.hidden = state.startupMessage === "";

  renderEntityFilter();
  void renderOpenBooks();
  if (page === "reconcile") renderReconcile();
  if (page === "check") renderCheck();
  if (page === "rules") renderRules();
  if (page === "entities") renderEntities();
  if (page === "reports") renderReportsPage();
  if (page === "invoices") {
    renderInvoiceEditor();
    renderInvoices();
  }
  if (page === "history") renderHistory();
  if (page === "books") void renderBooks();
  if (page === "assets") renderAssetsPage();
  if (page === "setup") renderSetup();
  if (page === "import") void renderFeed();
  if (page === "opening") renderOpeningBalances();
  if (page === "gst") renderVariance();

  if (moved) window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
}

/**
 * Whether the bank's balance moved by what our transactions say it should.
 *
 * The bank gives a balance now and no history, and one figure on its own says
 * nothing: a ledger holds the change since it began, a balance holds the whole
 * account, and the gap between them is just whatever came before. Two of them
 * say a great deal. However far the balance moved between one fetch and the
 * next has to equal the transactions in that window, and where it does not,
 * something was missed or counted twice -- with the window naming where.
 *
 * This is the check the daily balance export does, built from what the feed
 * gives for free, and it gets better every time the app is opened.
 */
function balanceMovementSection(
  snapshots: readonly { at: string; balances: Record<string, number> }[],
  mapping: Record<string, string>,
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "feed-accounts";

  const heading = document.createElement("h3");
  heading.textContent = "Against the bank's own balance";
  wrap.append(heading);

  if (snapshots.length < 2) {
    wrap.append(
      note(
        snapshots.length === 0
          ? "Nothing to compare yet. A balance is recorded each time the feed is fetched."
          : "One balance recorded so far. The next fetch gives something to compare it against.",
      ),
    );
    return wrap;
  }

  const first = snapshots[snapshots.length - 2];
  const last = snapshots[snapshots.length - 1];
  if (first === undefined || last === undefined) return wrap;

  wrap.append(
    note(
      `Between ${new Date(first.at).toLocaleString("en-NZ")} and ` +
        `${new Date(last.at).toLocaleString("en-NZ")}, how far the bank's balance moved ` +
        "against what the transactions in that window come to.",
    ),
  );

  const table = document.createElement("table");
  table.className = "report-table owner-table match-table";
  const head = document.createElement("thead");
  head.innerHTML = "<tr><th>Account</th><th>Bank moved</th><th>Our transactions</th><th>Difference</th></tr>";
  const rows = document.createElement("tbody");

  let anyOut = false;
  for (const [akahuId, ours] of Object.entries(mapping)) {
    if (ours === "") continue;
    const before = first.balances[akahuId];
    const after = last.balances[akahuId];
    if (before === undefined || after === undefined) continue;

    const moved = after - before;
    const inWindow = state.ledger.transactions
      .filter((t) => t.account === ours && t.date > first.at.slice(0, 10) && t.date <= last.at.slice(0, 10))
      .reduce((sum, t) => sum + t.amount, 0);
    const difference = moved - inWindow;
    if (difference !== 0) anyOut = true;

    const tr = document.createElement("tr");
    tr.append(nameCell(ours));
    for (const value of [moved, inWindow, difference]) {
      const cell = document.createElement("td");
      cell.className = "report-amount";
      cell.textContent = formatAmount(value);
      if (value === difference && difference !== 0) cell.classList.add("match-off");
      if (value === difference && difference === 0) cell.classList.add("match-ok");
      tr.append(cell);
    }
    rows.append(tr);
  }

  table.append(head, rows);
  wrap.append(table);
  if (!anyOut) {
    const ok = document.createElement("p");
    ok.className = "balance-ok";
    ok.textContent = "Every account moved by exactly what its transactions say.";
    wrap.append(ok);
  }
  return wrap;
}

/**
 * Which of their accounts is which of ours, and pulling what they hold.
 *
 * Nothing is imported until each account it would touch has been pointed at an
 * account in these books. A feed can carry accounts a set of books has never
 * heard of -- a personal card alongside the company's -- and filing those under
 * whatever Akahu calls them would put private spending into the company ledger.
 */
function accountMappingSection(mapping: Record<string, string>): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "feed-accounts";

  const load = document.createElement("button");
  load.type = "button";
  load.textContent = "Show the connected accounts";

  const table = document.createElement("div");
  const said = document.createElement("p");
  said.className = "feed-said";

  const chosen: Record<string, string> = { ...mapping };

  load.addEventListener("click", () => {
    load.disabled = true;
    said.textContent = "Asking Akahu…";
    void fetch("/api/feed/accounts")
      .then(async (r) => {
        const answer = (await r.json()) as { accounts?: AkahuAccount[]; error?: string };
        if (!r.ok) throw new Error(answer.error ?? "could not list the accounts");
        said.textContent = "";
        draw(answer.accounts ?? []);
      })
      .catch((error: Error) => {
        said.textContent = error.message;
      })
      .finally(() => {
        load.disabled = false;
      });
  });

  const ours = (): string[] => [...new Set(state.ledger.transactions.map((t) => t.account))].sort();

  function draw(accounts: readonly AkahuAccount[]): void {
    table.textContent = "";
    if (accounts.length === 0) {
      table.append(note("Akahu has no accounts connected yet. Connect your bank at my.akahu.nz."));
      return;
    }

    const grid = document.createElement("table");
    grid.className = "report-table owner-table";
    const head = document.createElement("thead");
    head.innerHTML = "<tr><th>At the bank</th><th>Number</th><th>Balance</th><th>In these books</th></tr>";
    const rows = document.createElement("tbody");

    for (const account of accounts) {
      const tr = document.createElement("tr");
      tr.append(nameCell(`${account.name}${account.connection?.name ? ` · ${account.connection.name}` : ""}`));
      tr.append(nameCell(account.formatted_account ?? "—"));
      const balance = document.createElement("td");
      balance.className = "report-amount";
      balance.textContent =
        account.balance?.current === undefined ? "—" : formatAmount(Math.round(account.balance.current * 100));
      tr.append(balance);

      const pick = document.createElement("td");
      const select = document.createElement("select");
      const none = document.createElement("option");
      none.value = "";
      none.textContent = "-- do not import --";
      select.append(none);

      // The account this already is, when these books have it. The two systems
      // write the same account differently -- a suffix as two digits in one and
      // three in the other, a card as a masked number -- so a plain comparison
      // finds nothing and would offer to create a second account beside a
      // reconciled one. Only when unambiguous; otherwise it asks.
      const suggestion = matchLedgerAccount(account, ours()) ?? akahuAccountId(account);
      for (const id of [...new Set([...ours(), suggestion])].sort()) {
        const option = document.createElement("option");
        option.value = id;
        option.textContent = id;
        option.selected = (chosen[account._id] ?? suggestion) === id;
        select.append(option);
      }
      select.addEventListener("change", () => {
        chosen[account._id] = select.value;
      });
      if (chosen[account._id] === undefined) chosen[account._id] = suggestion;
      pick.append(select);
      tr.append(pick);
      rows.append(tr);
    }
    grid.append(head, rows);
    table.append(grid);

    const from = document.createElement("input");
    from.type = "date";

    // A week before the last transaction already held, not the day after it.
    //
    // A feed reports settled transactions, and a card charge settles days
    // after the date it carries. Starting where the ledger ends would step
    // over anything that settled in between and leave a hole nothing later
    // fills. Overlapping costs nothing: what is already held is recognised as
    // a duplicate and dropped, which is the whole point of doing it that way.
    // Empty means from the beginning, which is what an account with nothing in
    // the books needs and what the picker should therefore offer.
    from.value = feedStartDate(chosen) ?? "";
    const fromLabel = document.createElement("label");
    fromLabel.append("From ", from);

    const fetchButton = document.createElement("button");
    fetchButton.type = "button";
    fetchButton.className = "primary";
    fetchButton.textContent = "Fetch transactions";
    fetchButton.addEventListener("click", () => {
      void pullFromFeed(chosen, from.value, fetchButton, said);
    });

    const actions = document.createElement("div");
    actions.className = "feed-form";
    actions.append(fromLabel, fetchButton);
    table.append(actions);
  }

  wrap.append(load, said, table);
  return wrap;
}

/** Pull from the feed and hand it to the same import everything else uses. */
async function pullFromFeed(
  mapping: Record<string, string>,
  from: string,
  button: HTMLButtonElement,
  said: HTMLElement,
): Promise<void> {
  // The button itself says so, not only the line of text beside it.
  //
  // A fetch reaches a bank and can take a while, and the only sign it had
  // started was a sentence somewhere else on the page. Pressing a button that
  // does not change is how somebody comes to press it three times.
  const label = button.textContent ?? "Fetch transactions";
  button.disabled = true;
  button.textContent = "Fetching…";
  button.classList.add("working");
  button.setAttribute("aria-busy", "true");
  said.textContent = "Fetching…";
  try {
    await fetch("/api/feed/accounts", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accounts: mapping }),
    });

    const search = from === "" ? "" : `?start=${encodeURIComponent(`${from}T00:00:00.000Z`)}`;
    const answer = (await fetch(`/api/feed/transactions${search}`).then((r) => r.json())) as {
      items?: AkahuTransaction[];
      error?: string;
    };
    if (answer.error !== undefined) throw new Error(answer.error);

    const read = fromAkahu(answer.items ?? [], {
      accountFor: (id) => {
        const to = mapping[id];
        return to === undefined || to === "" ? null : to;
      },
    });

    if (read.transactions.length === 0) {
      said.textContent =
        read.unmappedAccounts.length > 0
          ? "Nothing to import: every account it returned is set to be left alone."
          : "Nothing new in that period.";
      return;
    }

    await addTransactions(read.transactions, {
      importer: "akahu",
      file: `bank feed, from ${from || "the beginning"}`,
      problems: read.problems,
    });
    said.textContent =
      `${read.transactions.length} read from the feed. They are on the Bank import page ` +
      "with anything that needs a decision.";
  } catch (error) {
    said.textContent = (error as Error).message;
  } finally {
    button.disabled = false;
    button.textContent = label;
    button.classList.remove("working");
    button.removeAttribute("aria-busy");
  }
}

/**
 * Connecting a bank feed, and pulling from it.
 *
 * The tokens are typed here and then never seen again: they are held by the
 * process serving this page, not by the page, so nothing can read one back out
 * of the screen or out of browser storage. What comes back is a list of
 * accounts, a mapping to the accounts already in these books, and transactions
 * that go through exactly the same import as a downloaded file -- the same
 * duplicate check, the same review, the same coding.
 */
async function renderFeed(): Promise<void> {
  const body = $("feed-body");
  body.textContent = "";

  if (!writesToFolder()) {
    body.append(
      note(
        "A bank feed needs the app running with a folder behind it, because the " +
          "connection is held there rather than in this browser. Start it from the " +
          "NZOSA shortcut rather than opening the page on its own.",
      ),
    );
    return;
  }

  const status = (await fetch("/api/feed").then((r) => r.json()).catch(() => null)) as
    | {
        configured: boolean;
        appToken: string;
        accounts: Record<string, string>;
        autoFetch: boolean;
        lastFetch: string;
        balances: { at: string; balances: Record<string, number> }[];
      }
    | null;

  if (status === null) {
    body.append(note("Could not ask the app about the bank feed."));
    return;
  }

  // --- how to get the tokens ------------------------------------------------
  const how = document.createElement("details");
  how.open = !status.configured;
  const summary = document.createElement("summary");
  summary.textContent = "How to connect your bank";
  how.append(summary);
  const steps = document.createElement("ol");
  steps.className = "feed-steps";
  for (const step of [
    "Create an account at my.akahu.nz and set up two-factor authentication.",
    "Connect your bank there. Nothing appears here until at least one account is connected, " +
      "and the User Access Token does not exist until then.",
    "Open my.akahu.nz/developers, accept the developer terms, and copy the two tokens.",
    "Paste them below. They are kept by this app on this machine, not in the browser.",
  ]) {
    const li = document.createElement("li");
    li.textContent = step;
    steps.append(li);
  }
  how.append(steps);
  body.append(how);

  // --- the tokens -----------------------------------------------------------
  const form = document.createElement("div");
  form.className = "feed-form";

  const appToken = document.createElement("input");
  appToken.type = "text";
  appToken.placeholder = "App ID Token — app_token_…";
  appToken.autocomplete = "off";

  const userToken = document.createElement("input");
  // Masked: this is the half that reaches somebody's bank data.
  userToken.type = "password";
  userToken.placeholder = "User Access Token — user_token_…";
  userToken.autocomplete = "off";

  const save = document.createElement("button");
  save.type = "button";
  save.className = "primary";
  save.textContent = status.configured ? "Replace the connection" : "Connect";

  const said = document.createElement("p");
  said.className = "feed-said";

  save.addEventListener("click", () => {
    save.disabled = true;
    said.textContent = "Connecting…";
    void fetch("/api/feed", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ appToken: appToken.value, userToken: userToken.value }),
    })
      .then(async (r) => {
        const answer = (await r.json()) as { error?: string };
        if (!r.ok) throw new Error(answer.error ?? "could not save the connection");
        appToken.value = "";
        userToken.value = "";
        void renderFeed();
      })
      .catch((error: Error) => {
        said.textContent = error.message;
        save.disabled = false;
      });
  });

  form.append(appToken, userToken, save);
  body.append(form, said);

  if (!status.configured) return;

  const connected = document.createElement("p");
  connected.className = "feed-connected";
  connected.textContent = `Connected as ${status.appToken}`;
  const forget = document.createElement("button");
  forget.type = "button";
  forget.className = "link-button";
  forget.textContent = "forget this connection";
  forget.addEventListener("click", () => {
    if (!confirm("Forget the bank feed connection? The tokens are deleted from this machine.")) return;
    void fetch("/api/feed", { method: "DELETE" }).then(() => renderFeed());
  });
  connected.append(" · ", forget);
  body.append(connected);

  // Whatever went wrong last time it looked, said here rather than on whatever
  // page happened to be open when it happened.
  if (state.feedProblem !== "") {
    const failed = document.createElement("p");
    failed.className = "variance-problems";
    failed.textContent = `Last time it looked: ${state.feedProblem}`;
    body.append(failed);
  }

  const auto = document.createElement("label");
  auto.className = "feed-auto";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = status.autoFetch;
  box.addEventListener("change", () => {
    void fetch("/api/feed/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ autoFetch: box.checked }),
    });
  });
  auto.append(box, " Fetch new transactions when NZOSA opens");
  body.append(auto);

  body.append(balanceMovementSection(status.balances ?? [], status.accounts ?? {}));

  if (status.lastFetch !== "") {
    const when = document.createElement("p");
    when.className = "feed-said";
    // Said plainly, because a feed that has stopped working looks exactly like
    // a feed with nothing new until you know when it last managed to look.
    when.textContent = `Last looked ${new Date(status.lastFetch).toLocaleString("en-NZ")}.`;
    body.append(when);
  }

  body.append(accountMappingSection(status.accounts));
}

/**
 * Account chooser as a row of toggles.
 *
 * A multi-select listbox is the wrong control here: it hides most of its
 * options behind a scrollbar, gives no hint that several can be chosen, and
 * loses the whole selection to a stray click. Toggles show every account at
 * once and each one is independent.
 */
function fillAccounts(id: string, chosen: string[], onChange: () => void): void {
  const holder = $(id);
  const entity = entityBankAccounts();
  const present = [...new Set(state.ledger.transactions.map((t) => t.account))]
    .filter((account) => entity.length === 0 || entity.includes(account))
    .sort();
  holder.textContent = "";

  const label = (account: string): string => {
    const named = state.ledger.transactions.find((t) => t.account === account)?.extras?.accountLabel;
    return named ?? account;
  };

  const all = document.createElement("button");
  all.type = "button";
  all.className = chosen.length === 0 ? "chip on" : "chip";
  all.textContent = "All accounts";
  all.addEventListener("click", () => {
    chosen.length = 0;
    onChange();
  });
  holder.append(all);

  for (const account of present) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = chosen.includes(account) ? "chip on" : "chip";
    chip.textContent = label(account);
    chip.title = account;
    chip.addEventListener("click", () => {
      const at = chosen.indexOf(account);
      if (at >= 0) chosen.splice(at, 1);
      else chosen.push(account);
      onChange();
    });
    holder.append(chip);
  }
}

/**
 * The reconcile lines, and which of them the filter and search leave showing.
 *
 * One definition, used both to draw the rows and to accept them in bulk. If
 * the two ever disagreed, "accept all" would confirm lines that were not on
 * screen -- which is the one thing a bulk action must never do.
 */
function reconcileRows(): { all: Suggestion[]; shown: Suggestion[] } {
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
function shownSuggestions(): Suggestion[] {
  return reconcileRows().shown;
}

/**
 * Point the Import page at whatever is waiting to be decided.
 *
 * Everything on that page except the review queue is a record of what arrived.
 * The queue is the only part somebody has to act on, and it opened on "All" --
 * a list of five thousand rows with thirty-two that mattered somewhere in it.
 */
function showWhatNeedsDeciding(): void {
  state.filter = state.entries.some((e) => e.status === "review") ? "review" : "all";
}

function renderReconcile(): void {
  fillAccounts("reconcile-accounts", state.reconcileAccounts, renderReconcile);
  const body = $("reconcile-body");
  body.textContent = "";

  if (state.ledger.transactions.length === 0) {
    body.append(note("No transactions yet. Import a bank file first."));
    return;
  }

  // Above the queue, because this is the page somebody works from and a row
  // that might be counted twice is worth knowing about before coding it.
  const unresolved = unresolvedNote();
  if (unresolved) body.append(unresolved);

  // Payouts before anything else, because coding one as it arrives is the
  // mistake this page is most likely to make: it looks like an ordinary
  // receipt and is three postings wearing one figure.
  const payouts = payoutBanner();
  if (payouts) body.append(payouts);

  // A rule written out of the last coding, said once. The tool did something
  // nobody pressed a button for, so it says so, says what it reached, and
  // says where to undo it.
  const made = state.lastRule;
  if (made !== null) {
    state.lastRule = null;
    const said = document.createElement("p");
    said.className = "rule-made";
    said.textContent =
      `Rule added from that coding: anything matching "${made.keyword}" now suggests ` +
      `${made.code}. ` +
      (made.alsoCoded > 0
        ? `It suggests a code for ${made.alsoCoded} other line${made.alsoCoded === 1 ? "" : "s"}, ` +
          "still yours to confirm. "
        : "") +
      "Change or remove it on the Rules page.";
    body.append(said);
  }

  const { all, shown } = reconcileRows();

  const linkedNow = state.ledger.transfers ?? {};
  const done = all.filter(
    (one) => one.confirmed || linkedNow[one.transaction.id] !== undefined,
  ).length;
  // How many the filter matched belongs at the top. It was only said at the
  // foot of the list, which meant scrolling past two hundred rows to find out
  // whether you were looking at forty lines or four thousand.
  const showing: Record<typeof state.reconcileFilter, string> = {
    todo: `${shown.length} still to confirm`,
    suggested: `${shown.length} suggested and waiting`,
    nocode: `${shown.length} with nothing suggested`,
    coded: `${shown.length} coded`,
    all: `${shown.length} lines`,
  };
  $("reconcile-hint").textContent =
    `${showing[state.reconcileFilter]}. ${done} of ${all.length} coded in all. ` +
    "Accept the suggestion or change it; either way the line is coded and stays that way.";

  if (shown.length === 0) {
    body.append(note("Nothing left to code here."));
    return;
  }

  const codes = knownCodes(state.rules, state.ledger.overrides ?? {}, state.chart);
  for (const one of shown.slice(0, 200)) body.append(renderLine(one, codes));
  if (shown.length > 200) {
    body.append(note(`Showing the first 200 of ${shown.length}.`));
  }
}

/** Everything the bank actually said, for when the summary is not enough. */
function rawFields(transaction: Transaction): HTMLElement {
  const table = document.createElement("table");
  table.className = "code-raw";
  const body = document.createElement("tbody");
  const rows: [string, string][] = [
    ["Account", `${transaction.extras?.["accountLabel"] ?? ""} ${transaction.account}`.trim()],
    ["Other party", transaction.otherParty],
    ["Other party account", transaction.otherPartyAccount ?? ""],
    ["Particulars", transaction.particulars ?? ""],
    ["Code", transaction.code ?? ""],
    ["Reference", transaction.reference ?? ""],
    ["Type", transaction.type ?? ""],
    ["Serial / TRN", `${transaction.serial ?? ""} ${transaction.trn ?? ""}`.trim()],
    ["Source", `${transaction.source.file} line ${transaction.source.line}`],
    ["Id", transaction.id],
  ];
  for (const [name, value] of rows) {
    if (value === "") continue;
    const tr = document.createElement("tr");
    const th = document.createElement("th");
    th.textContent = name;
    const td = document.createElement("td");
    td.textContent = value;
    tr.append(th, td);
    body.append(tr);
  }
  table.append(body);
  return table;
}

function note(text: string): HTMLElement {
  const p = document.createElement("p");
  p.className = "page-hint";
  p.textContent = text;
  return p;
}

function renderLine(one: Suggestion, codes: readonly string[]): HTMLElement {
  const row = document.createElement("div");
  row.className = one.confirmed ? "code-row done" : "code-row";
  // Which transaction this row is. Nothing on the page needed it, and that is
  // why it was missing -- but a row that cannot be named can only be found by
  // its date and amount, which is a guess whenever two lines share both.
  row.dataset["id"] = one.transaction.id;

  const bank = document.createElement("div");
  bank.className = "code-bank";
  const date = document.createElement("div");
  date.className = "code-date";
  date.textContent = one.transaction.date;
  const who = document.createElement("div");
  who.className = "code-who";
  who.textContent = one.transaction.otherParty || "--";
  const flow = describeFlow(one.transaction, state.ledger.transactions);
  const flowLine = document.createElement("div");
  flowLine.className = flow.internal ? "code-flow internal" : "code-flow";
  const arrow = flow.direction === "out" ? "out to" : "in from";
  const here = one.transaction.extras?.["accountLabel"] ?? one.transaction.account;
  flowLine.textContent =
    flow.direction === "out"
      ? `${here} → ${flow.counterparty}`
      : `${flow.counterparty} → ${here}`;
  flowLine.title =
    `Money ${arrow} ${flow.counterparty}` +
    (flow.bothLegs
      ? ". Both sides of this transfer are in the ledger, so it is a movement between your own accounts."
      : flow.internal
        ? ". That account is in the ledger but the matching opposite entry was not found."
        : ".");

  const what = document.createElement("div");
  what.className = "code-what";
  what.textContent = [one.transaction.particulars, one.transaction.reference]
    .filter((part) => part !== undefined && part !== "")
    .join(" · ");
  const details = document.createElement("button");
  details.type = "button";
  details.className = "code-details";
  details.textContent = state.expanded === one.transaction.id ? "hide details" : "details";
  details.addEventListener("click", () => {
    state.expanded = state.expanded === one.transaction.id ? null : one.transaction.id;
    renderReconcile();
  });

  bank.append(date, who, what, flowLine, details);
  if (state.expanded === one.transaction.id) bank.append(rawFields(one.transaction));

  const amount = document.createElement("div");
  amount.className = one.transaction.amount < 0 ? "code-amount out" : "code-amount in";
  amount.textContent = formatAmount(one.transaction.amount);

  const form = document.createElement("div");
  form.className = "code-form";

  const codeSelect = combobox(codes, one.code, "Search accounts…");

  const gstSelect = document.createElement("select");
  gstSelect.className = "gst-select";
  const currentRate = classificationToRate(one.classification);
  for (const rate of GST_OPTIONS) {
    const option = document.createElement("option");
    option.value = rate.value;
    option.textContent = rate.label;
    option.title = rate.hint;
    option.selected = rate.value === currentRate;
    gstSelect.append(option);
  }

  // Who it was to or from, in readable words rather than the bank's shouting.
  // Editable per line, because a rule cannot know that one payment to a builder
  // was for a different property.
  const to = document.createElement("input");
  to.type = "text";
  to.className = "code-contact";
  to.placeholder = "To";
  to.value = one.contact;
  to.title = "Who this was to or from. Set it for every matching line on the Rules page.";

  const description = document.createElement("input");
  description.type = "text";
  description.className = "code-description";
  description.placeholder = "Description";
  description.value = one.note ?? "";

  const ok = document.createElement("button");
  ok.type = "button";
  ok.className = "primary";
  // A confirmed line can still be changed, and used to look as though it could:
  // the account picker, the rate and the description all stayed editable while
  // the button that saves them was disabled. Changing your mind about a coding
  // appeared to work and did nothing at all.
  // A tick rather than the word, because this button is pressed more than
  // anything else in the app and reads faster as a mark than as two letters.
  // The word stays on the change: "Update" is not the same promise as "confirm
  // this", and a tick would say both.
  ok.textContent = one.confirmed ? "Update" : "✓";
  ok.title = one.confirmed
    ? "Save a change to this coding"
    : "Confirm this line as coded";
  // The glyph is not a name. Anything reading this aloud, or listing the
  // buttons on the page, needs the words.
  if (!one.confirmed) {
    ok.setAttribute("aria-label", "Confirm this line as coded");
    ok.classList.add("code-tick");
  }
  ok.addEventListener("click", () => {
    // A transfer chosen on this row is what the tick is confirming. Coding it
    // as well would file the same money twice.
    if (pendingTransfer !== null) {
      void linkTransfer(one.transaction, pendingTransfer);
      return;
    }
    void confirmLine(one, codeSelect.value, gstSelect.value as GstRate, description.value, to.value);
  });

  const splitButton = document.createElement("button");
  splitButton.type = "button";
  splitButton.textContent = (state.ledger.splits ?? {})[one.transaction.id] ? "Edit split" : "Split";
  splitButton.addEventListener("click", () => {
    state.splitting = state.splitting === one.transaction.id ? null : one.transaction.id;
    renderReconcile();
  });

  const reason = document.createElement("div");
  reason.className = "code-reason";
  reason.textContent = one.confirmed
    ? (one.note ?? "Confirmed")
    : (state.ledger.splits ?? {})[one.transaction.id]
      ? "Coded by its split, below. The tick agrees to it."
      : `${rateLabel(one.classification)} · ${one.reason}`;

  form.append(codeSelect.element, gstSelect, to, description, ok, splitButton);
  row.append(bank, amount, form, reason);

  /**
   * A row with a transfer on it is not a row to code.
   *
   * The dropdown offers its only candidate already chosen, which saves a
   * click and reads, to somebody working down a list, exactly like a row that
   * needs coding -- so the account gets picked, the tick gets pressed, and a
   * movement between two of your own accounts is filed as income. That
   * mistake is quiet and it is the expensive direction, which is why the
   * coding half of the row goes flat while a transfer is chosen: there is
   * nothing to decide there until somebody says it is not a transfer.
   */
  const codingControls: HTMLElement[] = [gstSelect, to, description];
  const comboInput = codeSelect.element.querySelector("input");

  /**
   * Which transfer this row would confirm, or nothing.
   *
   * The tick is the one thing that settles a row, whichever kind of row it is.
   * It used to be switched off while a transfer was chosen, which left the row
   * with a chosen answer, a greyed-out everything, and no way to say yes
   * except a second button -- so it looked finished and was not.
   */
  let pendingTransfer: string | null = null;

  /**
   * Two reasons the coding half of a row can have nothing left to decide.
   *
   * A transfer is not a supply, so there is no account and no GST to pick. An
   * invoice already carries both: settling one posts bank against receivables
   * or payables and takes the tax treatment from the invoice, so the account
   * and rate on this row are read by nothing at all. Leaving them live invited
   * a decision that could not have any effect, which is worse than asking
   * nothing -- somebody picks an account, sees no change, and stops trusting
   * the row.
   *
   * Held as two flags rather than one, because either can be true on its own
   * and each has its own way back.
   */
  let transferChosen = false;
  let invoiceChosen = false;
  let splitChosen = false;

  const applyCoding = (): void => {
    const off = transferChosen || invoiceChosen || splitChosen;
    for (const control of codingControls) {
      (control as HTMLInputElement | HTMLSelectElement).disabled = off;
    }
    if (comboInput instanceof HTMLInputElement) comboInput.disabled = off;
    codeSelect.element.classList.toggle("is-transfer", off);
    form.classList.toggle("coding-off", off);

    // Only a transfer already on record leaves nothing for the tick to do. An
    // invoice match still wants confirming, and so does a transfer that has
    // been chosen but not yet agreed to.
    ok.disabled = transferChosen && !invoiceChosen && !splitChosen && pendingTransfer === null;
    // The one control still worth pressing must not be dimmed with the ones
    // that are finished with. Flattening the whole row made the tick read as
    // already pressed, which is the opposite of what it was waiting to say.
    ok.classList.toggle("tick-live", !ok.disabled);
    ok.title = transferChosen
      ? pendingTransfer === null
        ? "Already recorded as a transfer between your own accounts."
        : "Confirm this as a transfer between your own accounts"
      : splitChosen
        ? "The accounts and the GST come from the split below."
        : invoiceChosen
          ? "The account and the GST come from the invoice this settles."
        : one.confirmed
          ? "Save a change to this coding"
          : "Confirm this line as coded";
  };

  const setCodingOff = (off: boolean, partnerId: string | null = null): void => {
    transferChosen = off;
    pendingTransfer = off ? partnerId : null;
    applyCoding();
  };

  /** The same, for a bank line that settles an invoice. */
  const setInvoiceChosen = (chosen: boolean): void => {
    invoiceChosen = chosen;
    applyCoding();
  };

  /** And for one divided across accounts, which no single box can express. */
  const setSplitChosen = (chosen: boolean): void => {
    splitChosen = chosen;
    applyCoding();
  };

  // All three built before any is placed, because each needs its own switch
  // thrown first and none reads the others.
  const splitRow = splitLineFor(one.transaction, setSplitChosen);
  const transferRow = transferLineFor(one.transaction, setCodingOff);
  const invoiceRow = invoiceLineFor(one.transaction, setInvoiceChosen);

  // The transfer first. It is the stronger claim on the line -- a movement
  // between accounts you hold is not income or spending at all -- and it used
  // to sit under the invoice offer, where somebody meeting the page for the
  // first time read the invoice line and stopped.
  // The split first: it says what the line *is*, and the other two are offers
  // about a line whose nature is already settled.
  if (splitRow) row.append(splitRow);
  if (transferRow) row.append(transferRow);
  if (invoiceRow) row.append(invoiceRow);

  // Shown, not enforced. The code on offer may well be the right principal
  // account; what it cannot do is carry two GST treatments at once. Once the
  // line has been split the caution has been answered, so it goes.
  if (one.warn !== undefined && !(state.ledger.splits ?? {})[one.transaction.id]) {
    const caution = document.createElement("div");
    caution.className = "code-warn";
    caution.textContent = one.warn;
    row.append(caution);
  }

  if (state.splitting === one.transaction.id) {
    const parts = (state.ledger.splits ?? {})[one.transaction.id] ?? [];
    const editor = splitEditor({
      transaction: one.transaction,
      parts,
      codes,
      onSave: (saved) => void saveSplit(one.transaction.id, saved),
      onRemove: () => void saveSplit(one.transaction.id, null),
      onCancel: () => {
        state.splitting = null;
        renderReconcile();
      },
    });
    editor.classList.add("split-attached");
    row.append(editor);
  }
  return row;
}

async function saveSplit(id: string, parts: SplitPart[] | null): Promise<void> {
  const splits = { ...(state.ledger.splits ?? {}) };
  if (parts === null) delete splits[id];
  else splits[id] = parts;
  state.ledger = { ...state.ledger, splits };
  state.persistent = await save(state.ledger);
  state.splitting = null;
  renderReconcile();
}

/**
 * Which bank line settles which invoice, from both sources at once.
 *
 * A person's own decision wins; the matcher fills in the rest. This used to be
 * worked out separately in each place that needed it, which meant the Invoices
 * page could call an invoice unmatched while the Reconcile page showed it
 * settled -- and the balance owing depends on getting one answer, not two.
 */
let assignmentCache:
  | { ledger: unknown; map: Map<string, string> }
  | null = null;

/**
 * Which lines the matcher can offer a transfer for.
 *
 * Worked out once and kept until the ledger is replaced, because the answer
 * for one line is found by looking at every other line -- doing that per row
 * while filtering three thousand of them is the difference between a list and
 * a wait.
 */
let transferCache: { ledger: unknown; ids: Set<string> } | null = null;

function transferSuggestions(): Set<string> {
  if (transferCache !== null && transferCache.ledger === state.ledger) {
    return transferCache.ids;
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
  transferCache = { ledger: state.ledger, ids };
  return ids;
}

function invoiceAssignments(): Map<string, string> {
  if (assignmentCache !== null && assignmentCache.ledger === state.ledger) {
    return assignmentCache.map;
  }

  const invoices = state.ledger.invoices ?? [];
  const settled = new Map<string, string>(Object.entries(state.ledger.invoiceMatches ?? {}));
  if (invoices.length > 0) {
    const found = matchInvoices({
      invoices,
      transactions: state.ledger.transactions,
      ...(state.ledger.allocations ? { allocations: state.ledger.allocations } : {}),
    });
    // A payment whose parts settle invoices is already answered, and answered
    // more precisely than the matcher could. Letting the matcher also claim the
    // parent would count the same money twice -- once as the whole payment
    // against one invoice, and again as its parts against several.
    const splitAcross = new Set<string>();
    for (const [id, parts] of Object.entries(state.ledger.splits ?? {})) {
      const anyPart = parts.some((_, index) => settled.has(splitPartId(id, index)));
      if (anyPart) splitAcross.add(id);
    }
    for (const match of found.matched) {
      for (const t of match.transactions) {
        if (splitAcross.has(t.id)) continue;
        if (!settled.has(t.id)) settled.set(t.id, match.invoice.number);
      }
    }
  }

  // A refusal was only ever there to stop the matcher claiming the line. It is
  // not an assignment, so it does not leave this function as one.
  for (const [id, number] of [...settled]) if (number === "") settled.delete(id);

  assignmentCache = { ledger: state.ledger, map: settled };
  return settled;
}

/**
 * What every invoice still has owing, from the receipts assigned to it.
 *
 * The imported paid figure is not what is counted -- see `invoiceBalances`.
 */
function invoiceBalanceMap(): Map<string, InvoiceBalance> {
  const byId = new Map(state.ledger.transactions.map((t) => [t.id, t]));
  // Split parts as well, because one payment can settle several invoices and
  // each part is what actually landed on its own. Addressed by the same id
  // `expandSplits` gives them, so a part assignment means the same thing here,
  // in the postings, and in the history.
  for (const [id, parts] of Object.entries(state.ledger.splits ?? {})) {
    const parent = byId.get(id);
    if (parent === undefined) continue;
    parts.forEach((part, index) => {
      byId.set(splitPartId(id, index), { ...parent, id: splitPartId(id, index), amount: part.amount });
    });
  }
  const assignments: InvoiceAssignment[] = [];
  for (const [transactionId, invoiceNumber] of invoiceAssignments()) {
    const transaction = byId.get(transactionId);
    if (transaction !== undefined) assignments.push({ invoiceNumber, amount: transaction.amount });
  }
  return invoiceBalances(state.ledger.invoices ?? [], assignments);
}

/** What one invoice still has owing, or its full total when it is unknown. */
function remainingOn(invoice: Invoice): Cents {
  return invoiceBalanceMap().get(invoice.number)?.remaining ?? invoice.total;
}

/**
 * Candidate invoices for one bank line.
 *
 * Ranked by how much the evidence is worth, the same order the matcher uses:
 * the invoice number appearing in the bank reference is the customer telling
 * you what they are paying, and beats an amount that merely agrees.
 */
function invoiceCandidates(transaction: Transaction): Invoice[] {
  const invoices = state.ledger.invoices ?? [];
  if (invoices.length === 0 || transaction.amount === 0) return [];

  const wanted = Math.abs(transaction.amount);
  const kind: InvoiceKind = transaction.amount > 0 ? "sales" : "purchase";
  const text = `${transaction.reference ?? ""} ${transaction.particulars ?? ""} ${transaction.otherParty ?? ""}`
    .toUpperCase();

  const balances = invoiceBalanceMap();

  const scored: { invoice: Invoice; score: number }[] = [];
  for (const invoice of invoices) {
    if (invoice.kind !== kind) continue;

    // Against what is still owing, not the original total. An invoice already
    // part paid is looking for the rest, and judging the next receipt against
    // the full amount would neither call it exact nor rank it properly -- so
    // the second half of a half-paid invoice never came up as a candidate.
    const owing = balances.get(invoice.number)?.remaining ?? invoice.total;

    // Nothing left to settle. It stays visible on the Invoices page, but it is
    // not what this receipt is for.
    if (owing <= 0) continue;

    const named = invoice.number !== "" && text.includes(invoice.number.toUpperCase());
    const exact = owing === wanted;
    // A payment can be a part payment, so a smaller receipt against a larger
    // balance is still a candidate -- just a weaker one than an exact figure.
    const partial = !exact && wanted < owing;
    // The first word of the contact is enough: bank lines abbreviate, so
    // "TAUTAHI,MERE" should still recognise "Tautahi".
    const firstWord = invoice.contact.toUpperCase().split(/[ ,]/)[0] ?? "";
    const sameContact = firstWord.length >= 3 && text.includes(firstWord);
    const days = Math.abs(daysBetween(invoice.issued, transaction.date));
    if (days > 180) continue;
    if (!named && !exact && !(partial && sameContact)) continue;

    const score = (named ? 8 : 0) + (exact ? 4 : 0) + (sameContact ? 2 : 0) + (days <= 30 ? 1 : 0);
    scored.push({ invoice, score });
  }

  scored.sort((a, b) => b.score - a.score || a.invoice.issued.localeCompare(b.invoice.issued));
  return scored.slice(0, 6).map((s) => s.invoice);
}

/**
 * Bank accounts and their names, worked out once per set of transactions.
 *
 * Both of these used to walk all 2,832 transactions, once per row, for 200
 * rows. Nothing about the answer changes between rows, so it is cached against
 * the transaction list it was derived from and recomputed when that changes --
 * which is the only thing that can change it.
 */
let bankIndex:
  | { source: readonly Transaction[]; accounts: Set<string>; labels: Map<string, string> }
  | undefined;

function banks(): { accounts: Set<string>; labels: Map<string, string> } {
  const source = state.ledger.transactions;
  if (bankIndex?.source === source) return bankIndex;

  const accounts = new Set<string>();
  const labels = new Map<string, string>();
  for (const t of source) {
    accounts.add(t.account);
    if (!labels.has(t.account)) {
      const label = t.extras?.["accountLabel"] as string | undefined;
      if (label !== undefined) labels.set(t.account, label);
    }
  }
  bankIndex = { source, accounts, labels };
  return bankIndex;
}

/**
 * The bank accounts kept for the same entity as this one.
 *
 * `scoped` says whether an entity actually decided it. With no entity model
 * set up there is nothing to scope by, and refusing every candidate would make
 * the feature look broken rather than unconfigured -- so every account is
 * offered and the caller says the scoping is missing.
 */
function sameEntityBanks(account: string): { accounts: Set<string>; scoped: boolean } {
  const model = state.ledger.entities ?? emptyEntityModel();
  const mine = model.banks[account] ?? [];
  if (mine.length === 0) return { accounts: banks().accounts, scoped: false };

  const accounts = new Set<string>();
  for (const [bank, ids] of Object.entries(model.banks)) {
    if (ids.some((id) => mine.includes(id))) accounts.add(bank);
  }
  return { accounts, scoped: true };
}

/** A bank account's readable name, falling back to its id. */
function bankLabel(account: string): string {
  return banks().labels.get(account) ?? account;
}

/**
 * Payment-processor payouts: one bank line that is really three postings.
 *
 * A customer pays a 300.00 invoice through Stripe, is surcharged 8.70 to cover
 * the fee, Stripe keeps 11.72, and 296.98 reaches the bank. Coded as it
 * arrives, that figure goes to sales -- overstating income, leaving the invoice
 * outstanding for ever, and losing a deductible fee that was never recorded.
 *
 * Splitting it puts each piece where it belongs, and the split is not inferred:
 * the export carries the processor's charge id on all three rows, so the
 * grouping is read rather than guessed. Which is just as well, because the
 * payout equals none of the figures involved -- searching for an invoice of
 * 296.98 finds nothing, whatever else is tried.
 */
function payoutMatches(): { payout: Payout; transaction: Transaction }[] {
  const payouts = state.ledger.payouts ?? [];
  if (payouts.length === 0) return [];

  const byAmount = new Map<Cents, Transaction[]>();
  for (const transaction of state.ledger.transactions) {
    const list = byAmount.get(transaction.amount);
    if (list) list.push(transaction);
    else byAmount.set(transaction.amount, [transaction]);
  }

  const taken = new Set<string>();
  const out: { payout: Payout; transaction: Transaction }[] = [];
  for (const payout of payouts) {
    // The bank shows the payout a day or two after the processor records it,
    // so the date is a window rather than a key. The amount is exact: it is
    // the sum of the parts, and if it does not match to the cent this is not
    // the line.
    const candidates = (byAmount.get(payout.net) ?? []).filter((t) => !taken.has(t.id));
    let best: { gap: number; transaction: Transaction } | undefined;
    for (const transaction of candidates) {
      const gap = Math.abs(daysBetween(payout.date, transaction.date));
      if (gap > 10) continue;
      if (!best || gap < best.gap) best = { gap, transaction };
    }
    if (best === undefined) continue;
    taken.add(best.transaction.id);
    out.push({ payout, transaction: best.transaction });
  }
  return out;
}

/** Payouts whose bank line has not been split yet. */
function payoutsToApply(): { payout: Payout; transaction: Transaction }[] {
  const splits = state.ledger.splits ?? {};
  return payoutMatches().filter(({ transaction }) => splits[transaction.id] === undefined);
}

/**
 * Turn one payout into a split on its bank line.
 *
 * Each part keeps the account the export gave it, and the part that clears the
 * debtor is recorded as settling its invoice rather than coded -- so the
 * invoice closes, which is the whole point.
 */
async function applyPayout(payout: Payout, transaction: Transaction): Promise<void> {
  const known = knownCodes(state.rules, state.ledger.overrides ?? {});
  const receivable = (account: string): boolean => /receivable/i.test(account);
  const invoice = payout.invoices[0];

  const parts: SplitPart[] = [];
  const invoiceOf = new Map<number, string>();
  for (const part of payout.parts) {
    if (part.amount === 0) continue;
    const settles = receivable(part.account) && invoice !== undefined;
    if (settles) invoiceOf.set(parts.length, invoice);
    // The export writes "200 - Sales" and this ledger may know it as
    // "Sales - 200" or "200 Sales". `matchAccountName` reads all of them;
    // `canonicalCodeFor` wants a bare number and returns nothing for a label,
    // which left every part of a payout uncoded.
    //
    // Falling back to the chart, because the account this most needs is the
    // one nothing has ever been coded to: a ledger that has been booking
    // payouts as sales has no processor-fee coding to recognise, and that
    // missing expense is half the reason to do this at all.
    const code = settles ? null : (matchAccountName(part.account, known) ?? chartLabelFor(part.account));
    parts.push({
      amount: part.amount,
      note: settles
        ? `Settles ${invoice} (${payout.reference})`
        : `${part.source} (${payout.reference})`,
      ...(code !== null ? { code } : {}),
      // The GST comes from the export rather than being assumed. A processor's
      // fee is charged from offshore and carries no New Zealand GST, and
      // treating it as standard-rated strips out 15% that was never there --
      // 332.51 of fees reported as 289.14, which is the ratio exactly.
      ...(settles ? {} : gstFor(part, part.amount)),
    });
  }
  if (parts.length < 2) return;

  const before = {
    split: (state.ledger.splits ?? {})[transaction.id] ?? null,
    match: (state.ledger.invoiceMatches ?? {})[transaction.id] ?? null,
  };
  const splits = { ...(state.ledger.splits ?? {}), [transaction.id]: parts };
  const invoiceMatches = { ...(state.ledger.invoiceMatches ?? {}) };
  delete invoiceMatches[transaction.id];
  for (const [index, number] of invoiceOf) {
    invoiceMatches[splitPartId(transaction.id, index)] = number;
  }

  state.ledger = { ...state.ledger, splits, invoiceMatches };
  state.persistent = await save(state.ledger);
  await record(
    "split",
    `${transaction.date} ${formatAmount(transaction.amount)} split as a payout ` +
      `(${payout.reference})` + (invoice !== undefined ? `, settling ${invoice}` : ""),
    before.split,
    parts,
    transaction.id,
  );
  reclassify();
}

/**
 * The GST treatment a rate name describes.
 *
 * An empty rate is not a missing answer, it is the answer: the accounting
 * system had nothing to charge, which for a payment processor's fee is because
 * the service was supplied from outside New Zealand.
 */
function gstFor(
  part: { gstRate: string; hasGst: boolean },
  amount: Cents,
): { treatment: GstTreatment; side: GstSide } {
  const side = amount > 0 ? ("sales" as const) : ("purchases" as const);
  const said = part.gstRate.trim().toLowerCase();

  // The rate when the export gives one, which it does on a ledger row.
  if (said !== "") {
    if (said.includes("no gst")) return { treatment: "out-of-scope", side: "none" };
    if (said.includes("zero")) return { treatment: "zero-rated", side };
    return { treatment: "standard", side };
  }

  // A bank row carries no rate, but it does name the accounts the posting
  // reached, and a GST control account among them says the amount is
  // tax-inclusive. A processor's fee reaches no such account, because it is
  // supplied from offshore and carries none.
  return part.hasGst ? { treatment: "standard", side } : { treatment: "out-of-scope", side: "none" };
}

/** An account the chart knows, labelled the way this app writes codings. */
function chartLabelFor(account: string): string | null {
  const digits = splitAccountLabel(account).code;
  if (digits === "") return null;
  const held = state.chart.find((a) => a.code === digits);
  return held === undefined ? null : accountLabel(held.code, held.name);
}

/** The Reconcile page's offer to split every payout it recognises. */
function payoutBanner(): HTMLElement | null {
  const waiting = payoutsToApply();
  if (waiting.length === 0) return null;

  const wrap = document.createElement("div");
  wrap.className = "payout-banner";

  const said = document.createElement("span");
  const total = waiting.reduce((sum, { transaction }) => sum + transaction.amount, 0);
  said.textContent =
    `${waiting.length} bank line${waiting.length === 1 ? " is" : "s are"} a payment-processor ` +
    `payout, ${formatAmount(total)} in all. Each is really an invoice payment, the customer's ` +
    "surcharge and the processor's fee, and coding it as one figure overstates sales, leaves " +
    "the invoice outstanding and loses the fee.";
  wrap.append(said);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "primary";
  button.textContent = `Split ${waiting.length}`;
  button.addEventListener("click", () => void applyAllPayouts());
  wrap.append(button);
  return wrap;
}

async function applyAllPayouts(): Promise<void> {
  const waiting = payoutsToApply();
  if (waiting.length === 0) return;
  const invoices = waiting.filter((w) => w.payout.invoices.length > 0).length;
  const ok = confirm(
    `Split ${waiting.length} payout${waiting.length === 1 ? "" : "s"} into their parts?\n\n` +
      `${invoices} of them name the invoice they settle, which will be closed.\n` +
      "The processor's fee goes to the fee account the export names, and the surcharge to sales.\n\n" +
      "Each bank line keeps its total; only what it is made of changes.",
  );
  if (!ok) return;
  for (const { payout, transaction } of waiting) await applyPayout(payout, transaction);
  renderReconcile();
}

/**
 * The split row under a bank line: what it was divided into.
 *
 * A line split across two accounts is coded -- it just is not coded to one
 * thing, so the single account box on the row cannot say what it is. It said
 * nothing instead: an empty account and "No rule or default matched" on a
 * payment already divided correctly, which reads as work still to do and kept
 * the line in the to-do list for ever. The reports had it right the whole time,
 * expanding the split into its parts; this was the row disagreeing with them.
 *
 * Said the way the invoice and transfer rows say theirs, because it is the same
 * sentence: this is settled, and here is what by.
 */
function splitLineFor(
  transaction: Transaction,
  setSplitChosen: (chosen: boolean) => void = () => {},
): HTMLElement | null {
  const parts = (state.ledger.splits ?? {})[transaction.id];
  if (parts === undefined || parts.length === 0) {
    setSplitChosen(false);
    return null;
  }
  setSplitChosen(true);

  const wrap = document.createElement("div");
  wrap.className = "code-split";

  const matchesFor = state.ledger.invoiceMatches ?? {};

  const label = document.createElement("span");
  label.className = "split-matched";
  // What the split is for, in its own words. A payment divided to settle two
  // invoices is not "split across accounts" to the person who made it; it is
  // one payment clearing two bills.
  const settling = parts.filter(
    (_, index) => (matchesFor[splitPartId(transaction.id, index)] ?? "") !== "",
  ).length;
  label.textContent =
    settling > 1
      ? `Settles ${settling} invoices`
      : `Split across ${parts.length} accounts`;

  const detail = document.createElement("span");
  detail.className = "split-parts";
  // Each part with its own rate, because the rate is the whole reason the line
  // was split: half an entertainment bill carries GST and half does not, and a
  // row showing only the accounts would hide the point of it.
  detail.textContent = parts
    .map((part, index) => {
      // An invoice on a part outranks its account. The invoice says what the
      // money was and at what rate; repeating the account beside it says the
      // same thing twice in a row that has to stay readable.
      const settles = matchesFor[splitPartId(transaction.id, index)];
      if (settles !== undefined && settles !== "") {
        return `settles ${settles} ${formatAmount(part.amount)}`;
      }
      const rate = rateLabel({
        treatment: part.treatment ?? "standard",
        side: part.side ?? "none",
      } as GstClassification);
      return `${part.code ?? "not coded"} ${formatAmount(part.amount)} · ${rate}`;
    })
    .join("  |  ");

  wrap.append(label, detail);
  return wrap;
}

/**
 * The transfer row under a bank line: the leg it pairs with, or which it might.
 *
 * Only offered where there is something to offer, so an ordinary payment is not
 * cluttered with a question that has no answer.
 */
function transferLineFor(
  transaction: Transaction,
  /**
   * Switch the row's coding controls off while a transfer is chosen, and tell
   * it which transfer its tick would confirm -- or null where there is nothing
   * left to confirm, because the pairing is already recorded.
   */
  setCodingOff: (off: boolean, partnerId?: string | null) => void = () => {},
): HTMLElement | null {
  const transfers = state.ledger.transfers ?? {};
  const recorded = transfers[transaction.id];
  const settlesInvoice = (state.ledger.invoiceMatches ?? {})[transaction.id] !== undefined;
  if (settlesInvoice && recorded === undefined) return null;

  const { accounts, scoped } = sameEntityBanks(transaction.account);
  const candidates =
    recorded !== undefined
      ? []
      : transferCandidates(transaction, state.ledger.transactions, {
          sameEntity: accounts,
          taken: new Set(Object.keys(transfers)),
        });

  // A rejection outranks the offer. The candidate stays available, so changing
  // your mind is picking it again, but nothing is chosen for you and the row is
  // a row to code.
  const refused = (state.ledger.rejectedTransfers ?? []).includes(transaction.id);

  // One candidate is not a choice, so it is shown as the answer rather than as
  // a question -- the same way a receipt the matcher has already tied to an
  // invoice says which invoice rather than asking. It is found, not recorded:
  // the tick is what records it, and until that is pressed the row can still be
  // sent back with one press of "not a transfer".
  const found =
    !refused && candidates.length === 1 ? (candidates[0]?.transaction.id ?? undefined) : undefined;
  const partnerId = recorded ?? found;

  if (partnerId === undefined && candidates.length === 0) return null;

  const wrap = document.createElement("div");
  wrap.className = "code-transfer";

  if (partnerId !== undefined) {
    const confirmed = recorded !== undefined;
    setCodingOff(true, confirmed ? null : partnerId);

    const partner = state.ledger.transactions.find((t) => t.id === partnerId);
    const label = document.createElement("span");
    label.className = "transfer-matched";
    // How far apart the legs were, on the ones where it is not obvious.
    //
    // Same day needs no remark. A gap does: a pairing made across three or
    // four days is the one that might be a coincidence rather than a
    // movement, and this is where somebody scanning the page can see which
    // ones those are without opening anything.
    const apart =
      partner === undefined
        ? 0
        : Math.round(
            Math.abs(Date.parse(partner.date) - Date.parse(transaction.date)) / 86_400_000,
          );
    label.textContent = partner
      ? `Matched to transfer — ${bankLabel(transaction.account)} ` +
        `${transaction.amount < 0 ? "→" : "←"} ${bankLabel(partner.account)}` +
        ` · ${partner.date}` +
        (apart > 0 ? ` · ${apart}d apart` : "")
      : "Matched to transfer — the other leg is no longer in the ledger";
    if (apart > 0) label.classList.add("transfer-stretched");

    // Found rather than agreed to, and said so. The row reads the same either
    // way because it is the same pairing; what differs is whether anybody has
    // looked at it yet, and that is worth one quiet phrase rather than a
    // second control asking the question the tick already asks.
    if (!confirmed) {
      const how = document.createElement("span");
      how.className = "transfer-auto";
      how.textContent = "found automatically";
      label.append(" · ", how);
      label.title = "Found by matching your own accounts. Press the tick to record it.";
    }

    // One sentence either way, because it is one thing to the person reading
    // it. Both routes also remember the refusal, or the same candidate is
    // offered again on the next render and greys the row straight back out.
    const undo = document.createElement("button");
    undo.type = "button";
    undo.className = "link-button";
    undo.textContent = "not a transfer";
    undo.addEventListener("click", () => {
      if (confirmed) {
        void unlinkTransfer(transaction.id);
        return;
      }
      void rejectTransfer(transaction.id, true).then(() => renderReconcile());
    });
    wrap.append(label, undo);
    return wrap;
  }

  // More than one leg it could be, so it is a question and stays one.
  const label = document.createElement("span");
  label.textContent = "Transfer between your accounts?";
  // Three states, not two. Scoped by an entity; unscoped because this bank
  // account has not been assigned to one; and unscoped because there are no
  // entities, which is one set of books working exactly as it should and must
  // not be reported as something left undone.
  const usingEntities = (state.ledger.entities?.entities ?? []).length > 0;
  label.title = scoped
    ? "Only accounts belonging to the same entity are offered."
    : usingEntities
      ? "This bank account is not assigned to an entity yet, so every account is offered."
      : "Every account is offered.";

  const select = document.createElement("select");
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "-- not a transfer --";
  select.append(none);
  for (const candidate of candidates.slice(0, 8)) {
    const option = document.createElement("option");
    option.value = candidate.transaction.id;
    const when = candidate.daysApart === 0 ? "same day" : `${candidate.daysApart}d apart`;
    option.textContent =
      `${bankLabel(candidate.transaction.account)} · ${candidate.transaction.date} · ` +
      `${formatAmount(candidate.transaction.amount)} · ${when}` +
      (candidate.accountsAgree ? " · accounts agree" : "");
    select.append(option);
  }

  setCodingOff(false, null);
  select.addEventListener("change", () => {
    setCodingOff(select.value !== "", select.value === "" ? null : select.value);
    // Saying no is a decision, and is kept like one -- otherwise the next
    // render offers the same candidate again and greys the row straight back
    // out, which is what made this look like a control that did nothing.
    void rejectTransfer(transaction.id, select.value === "");
  });

  const link = document.createElement("button");
  link.type = "button";
  link.textContent = "Link as transfer";
  link.className = "primary";
  link.addEventListener("click", () => {
    if (select.value === "") return;
    void linkTransfer(transaction, select.value);
  });

  wrap.append(label, select, link);
  return wrap;
}

/**
 * Join two bank lines as one movement between accounts you hold.
 *
 * Both legs are written together. Coding them separately is right only if the
 * same clearing account is used for both; recorded as a pair there is no
 * account in the middle at all, and re-importing cannot split them because the
 * ids are content hashes.
 */
async function linkTransfer(transaction: Transaction, partnerId: string): Promise<void> {
  const partner = state.ledger.transactions.find((t) => t.id === partnerId);
  if (partner === undefined) return;

  const out = transaction.amount < 0 ? transaction : partner;
  const into = transaction.amount < 0 ? partner : transaction;

  // Captured before the change: the only moment the old value exists.
  const existing = state.ledger.transfers ?? {};
  const before =
    existing[out.id] !== undefined ? { from: out.id, to: existing[out.id] as string } : null;

  const transfers = { ...existing, [out.id]: into.id, [into.id]: out.id };
  state.ledger = { ...state.ledger, transfers };
  state.persistent = await savePart(state.ledger, "transfers");
  await record(
    "transfer",
    `${out.date} ${formatAmount(out.amount)} — transfer from ` +
      `${bankLabel(out.account)} to ${bankLabel(into.account)}`,
    before,
    { from: out.id, to: into.id },
    out.id,
  );
  reclassify();
  renderReconcile();
}

/**
 * Remember that a line is not a transfer, or that it might be after all.
 *
 * Kept with the decisions rather than in the page, because the offer is made
 * again on every open and an answer that lives only on screen is an answer
 * given once a day for ever.
 */
async function rejectTransfer(transactionId: string, rejected: boolean): Promise<void> {
  const before = state.ledger.rejectedTransfers ?? [];
  const has = before.includes(transactionId);
  if (has === rejected) return;
  const rejectedTransfers = rejected
    ? [...before, transactionId]
    : before.filter((id) => id !== transactionId);
  state.ledger = { ...state.ledger, rejectedTransfers };
  state.persistent = await savePart(state.ledger, "transfers");
}

/** Undo a pairing, removing both legs so half a transfer cannot be left. */
async function unlinkTransfer(transactionId: string): Promise<void> {
  const existing = state.ledger.transfers ?? {};
  const partnerId = existing[transactionId];
  if (partnerId === undefined) return;

  const transfers = { ...existing };
  delete transfers[transactionId];
  delete transfers[partnerId];
  // Both legs, because either one on its own would be offered the other again.
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
  reclassify();
  renderReconcile();
}

/** The invoice row under a bank line: what it settles, or what it might. */
function invoiceLineFor(
  transaction: Transaction,
  /**
   * Quiet the row's coding controls while an invoice is settled by it.
   *
   * The account and the GST both come from the invoice, so there is nothing on
   * this row for either to decide.
   */
  setInvoiceChosen: (chosen: boolean) => void = () => {},
): HTMLElement | null {
  const decided = (state.ledger.invoiceMatches ?? {})[transaction.id];

  // What settles this line, from both sources. The row used to read only the
  // decisions a person had recorded, so a receipt the matcher had already tied
  // to an invoice -- and which was already posted as settling it -- still
  // asked which invoice it settled. Being asked a question the app has already
  // answered is worse than not being asked.
  const assigned = invoiceAssignments().get(transaction.id);

  // An empty string is a decision that this is not an invoice payment at all,
  // which has to be recorded: without it the matcher simply finds the same
  // invoice again on the next render.
  const refused = decided === "";
  const matched = refused ? undefined : (decided ?? assigned);
  const confirmed = decided !== undefined && decided !== "";

  setInvoiceChosen(matched !== undefined);

  const isTransfer = (state.ledger.transfers ?? {})[transaction.id] !== undefined;
  if (isTransfer && matched === undefined) return null;

  // Already answered by its own parts. A payment divided to settle two invoices
  // has said which invoices twice over -- in the split line above and in the
  // records behind it -- and asking a third time invites a third answer that
  // would contradict both.
  const parts = (state.ledger.splits ?? {})[transaction.id] ?? [];
  const settledByParts = parts.some(
    (_, index) =>
      ((state.ledger.invoiceMatches ?? {})[splitPartId(transaction.id, index)] ?? "") !== "",
  );
  if (settledByParts) {
    setInvoiceChosen(true);
    return null;
  }
  const candidates = matched === undefined ? invoiceCandidates(transaction) : [];

  const wrap = document.createElement("div");
  wrap.className = "code-invoice";

  // Every invoice still owing money, not only the ranked candidates. The
  // ranking is a good guess and it is offered first, but a part payment from
  // somebody whose name the bank line never mentions is exactly the case that
  // needs assigning by hand -- and that used to be unreachable.
  const kind: InvoiceKind = transaction.amount > 0 ? "sales" : "purchase";
  const balances = invoiceBalanceMap();
  const paying = Math.abs(transaction.amount);

  const describe = (invoice: Invoice): string => {
    const owing = balances.get(invoice.number)?.remaining ?? invoice.total;
    const after = owing - paying;
    const what =
      after === 0 ? "settles it" : after > 0 ? `leaves ${formatAmount(after)}` : `over by ${formatAmount(-after)}`;
    return (
      `${invoice.number} · ${invoice.contact.slice(0, 24)} · ` +
      `${formatAmount(owing)} owing · ${invoice.issued} · ${what}`
    );
  };

  const suggested = candidates.map(describe);
  const others = (state.ledger.invoices ?? [])
    .filter(
      (invoice) =>
        invoice.kind === kind &&
        (balances.get(invoice.number)?.remaining ?? invoice.total) > 0 &&
        !candidates.some((c) => c.number === invoice.number),
    )
    .sort((a, b) => b.issued.localeCompare(a.issued))
    .map(describe);

  const options = [...suggested, ...others];
  if (options.length === 0) return null;

  const numberOf = (text: string): string => text.split(" · ")[0] ?? "";

  const label = document.createElement("span");
  label.textContent = candidates.length === 1 ? "Settles invoice?" : "Settles which invoice?";

  // Pre-filled when there is a single candidate, so the decision stays one
  // press. Anything else has to be typed, and the box refuses what is not on
  // the list -- a misspelt number assigns nothing rather than inventing one.
  const picker = combobox(
    options,
    candidates.length === 1 ? (suggested[0] ?? null) : null,
    `search ${options.length} open invoice${options.length === 1 ? "" : "s"}…`,
    // The running total and the "and another" button both depend on what is in
    // the box, so they are redrawn when it changes rather than going stale.
    () => redraw(),
  );

  // One payment can settle several invoices, so the picker gathers rather than
  // decides. Each one added is shown with what it still owed and what is left
  // of the payment, because that running figure is the only way to see whether
  // the set is right before committing to it -- and the arithmetic must not be
  // done for anybody: sums of open invoices collide constantly.
  const gathered: string[] = [];
  const chips = document.createElement("span");
  chips.className = "invoice-gathered";
  const tally = document.createElement("span");
  tally.className = "invoice-tally";

  const owingOn = (number: string): Cents => {
    const invoice = (state.ledger.invoices ?? []).find((i) => i.number === number);
    if (invoice === undefined) return 0;
    return Math.abs(invoiceBalanceMap().get(number)?.remaining ?? invoice.total);
  };

  const match = document.createElement("button");
  match.type = "button";

  const add = document.createElement("button");
  add.type = "button";
  add.className = "link-button";
  add.textContent = "and another invoice";

  const redraw = (): void => {
    chips.textContent = "";
    for (const number of gathered) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "invoice-chip";
      chip.textContent = `${number} ${formatAmount(owingOn(number))} ×`;
      chip.title = "Take this one off again";
      chip.addEventListener("click", () => {
        gathered.splice(gathered.indexOf(number), 1);
        redraw();
      });
      chips.append(chip);
    }

    // Counting what is in the box as well as what has been gathered, because
    // the figure has to describe what pressing the button would do. Counting
    // only the chips said "300.00 still unaccounted for" at the exact moment
    // the last invoice had been picked and the set was complete.
    const pending = numberOf(picker.value);
    const all = pending === "" || gathered.includes(pending) ? gathered : [...gathered, pending];
    const taken = all.reduce((sum, number) => sum + owingOn(number), 0);
    const paying = Math.abs(transaction.amount);
    const left = paying - taken;
    tally.textContent =
      all.length === 0
        ? ""
        : left === 0
          ? `${formatAmount(paying)} accounted for exactly`
          : left > 0
            ? `${formatAmount(left)} of this payment still unaccounted for`
            : `${formatAmount(-left)} more than the payment`;
    tally.classList.toggle("invoice-tally-exact", all.length > 0 && left === 0);
    tally.classList.toggle("invoice-tally-over", left < 0);

    match.textContent =
      gathered.length === 0 ? "Match" : `Settle ${gathered.length + 1} invoices`;
    add.hidden = gathered.length === 0 && numberOf(picker.value) === "";
  };

  add.addEventListener("click", () => {
    const number = numberOf(picker.value);
    if (number === "" || gathered.includes(number)) return;
    gathered.push(number);
    picker.clear();
    redraw();
    picker.element.querySelector("input")?.focus();
  });

  match.addEventListener("click", () => {
    const number = numberOf(picker.value);
    const all = number === "" ? [...gathered] : [...gathered, number];
    if (all.length === 0) return;
    if (all.length === 1) {
      void matchToInvoice(transaction, all[0] as string);
      return;
    }
    void matchToInvoices(transaction, all);
  });

  const openPicker = (): void => {
    wrap.replaceChildren(label, picker.element, add, chips, tally, match);
    redraw();
    picker.element.querySelector("input")?.focus();
  };

  // Already tied to an invoice: say so plainly instead of asking. Clicking it
  // opens the same picker, so changing the answer is one press either way --
  // including when the matcher got it wrong, which is the case that most needs
  // a way out.
  if (matched !== undefined) {
    const invoice = (state.ledger.invoices ?? []).find((i) => i.number === matched);
    const label2 = document.createElement("button");
    label2.type = "button";
    label2.className = "invoice-matched";
    label2.title = "Click to match it to a different invoice";

    if (invoice) {
      const owing = invoiceBalanceMap().get(invoice.number)?.remaining ?? 0;
      const part = Math.abs(transaction.amount) < invoice.total;
      label2.textContent =
        `Matched to ${invoice.number} — ${invoice.contact} ${formatAmount(invoice.total)}` +
        (part
          ? owing > 0
            ? ` · part payment, ${formatAmount(owing)} still owing`
            : ` · part payment, now settled`
          : "");
    } else {
      label2.textContent = `Matched to ${matched}`;
    }

    // Found by the matcher rather than chosen by a person. Both settle the
    // invoice and both post the same way; the difference is how much it is
    // worth checking, so it is said rather than hidden.
    if (!confirmed) {
      const how = document.createElement("span");
      how.className = "invoice-auto";
      how.textContent = "found automatically";
      label2.append(" · ", how);
    }

    label2.addEventListener("click", () => openPicker());

    // Two different things to undo, so two different words. Undoing your own
    // decision puts the line back to whatever the matcher thinks; saying it is
    // not an invoice payment is a decision in its own right, and has to be, or
    // the matcher claims it again on the next render.
    const undo = document.createElement("button");
    undo.type = "button";
    undo.className = "link-button";
    undo.textContent = confirmed ? "unmatch" : "not an invoice payment";
    undo.addEventListener("click", () =>
      confirmed ? void unmatchInvoice(transaction.id) : void refuseInvoice(transaction.id),
    );

    wrap.append(label2, undo);
    return wrap;
  }

  // With nothing suggesting an invoice, the picker is a way in rather than a
  // question: every open invoice offered against every bank line would bury
  // the coding controls under something that is usually not being asked. So it
  // waits behind one phrase until somebody says that is what this is.
  if (candidates.length === 0) {
    const open = document.createElement("button");
    open.type = "button";
    open.className = "link-button";
    open.textContent = "match to an invoice";
    open.addEventListener("click", () => openPicker());
    wrap.append(open);
    return wrap;
  }

  wrap.append(label, picker.element, add, chips, tally, match);
  redraw();
  return wrap;
}

/**
 * Record that a receipt settles an invoice, and code it from the invoice.
 *
 * The invoice knows what was sold and at what tax rate, which is better
 * evidence than any keyword — so the coding follows it rather than being
 * guessed again. Only when the invoice has a single account: a split invoice
 * is a split, and belongs in the split editor where the parts must balance.
 */
async function matchToInvoice(transaction: Transaction, number: string): Promise<void> {
  const invoice = (state.ledger.invoices ?? []).find((i) => i.number === number);
  // Captured before the change, because that is the only moment it exists.
  const wasMatched = (state.ledger.invoiceMatches ?? {})[transaction.id] ?? null;
  const wasCodedBefore = (state.ledger.overrides ?? {})[transaction.id];
  const invoiceMatches = { ...(state.ledger.invoiceMatches ?? {}), [transaction.id]: number };
  const overrides = { ...(state.ledger.overrides ?? {}) };

  const codes = new Set((invoice?.lines ?? []).map((l) => l.accountCode).filter((c) => c !== ""));
  const only = codes.size === 1 ? [...codes][0] : undefined;
  let coded = false;
  if (invoice && only !== undefined) {
    const code = canonicalCodeFor(only, knownCodes(state.rules, overrides));
    if (code !== null) {
      // Choosing the invoice is the decision. The invoice already says which
      // account the sale belongs to and at what rate -- better evidence than
      // any keyword -- so asking for OK afterwards only asked the same question
      // twice. This is the one path that codes a line without a separate
      // confirmation, and it is a person's explicit choice that starts it.
      //
      // Only when the invoice names a single account. Several accounts is a
      // split, whose parts have to balance, and it stays unconfirmed so the
      // split editor gets the decision instead.
      overrides[transaction.id] = {
        ...(overrides[transaction.id] ?? {}),
        code,
        treatment: "standard",
        side: transaction.amount > 0 ? "sales" : "purchases",
        confirmed: true,
        note: `Settles ${number} (${invoice.contact}). Coded from the invoice.`,
        at: new Date().toISOString().slice(0, 10),
      };
      coded = true;
    }
  }

  state.ledger = { ...state.ledger, invoiceMatches, overrides };
  // savePart still writes the core record, which is where the override lives.
  state.persistent = await savePart(state.ledger, "invoiceMatches");
  await record(
    "invoiceMatch",
    `${transaction.date} ${formatAmount(transaction.amount)} settles ${number}` +
      (invoice ? ` (${invoice.contact})` : "") +
      (coded ? ", coded from the invoice" : ", still to code"),
    // The coding rides with the match, so undoing one undoes both.
    wasMatched === null ? null : { number: wasMatched, override: wasCodedBefore },
    { number, override: overrides[transaction.id] },
    transaction.id,
  );
  reclassify();
  renderReconcile();
}

/**
 * Settle several invoices from one payment.
 *
 * A customer pays two invoices with one transfer and the bank shows one line.
 * Matched to either invoice alone it is wrong twice over: one invoice is
 * overpaid and the other is still outstanding. So the payment is divided --
 * one part per invoice, each part settling its own -- and every part is
 * addressed by the id `expandSplits` already gives it, so the postings, the
 * balances and the history all read a part the same way they read a payment.
 *
 * Amounts are taken from what each invoice still owes, in the order chosen,
 * until the money runs out. Anything left over becomes a part of its own with
 * no invoice on it: an overpayment is real and hiding it inside the last
 * invoice would misstate both that invoice and the account it posts to.
 *
 * No arithmetic is guessed at. Sums of open invoices collide constantly -- on
 * one real ledger 1,295 combinations of two or three matched some receipt
 * exactly -- so which invoices a payment settles is a question only the person
 * paying attention can answer, and this records their answer.
 */
async function matchToInvoices(transaction: Transaction, numbers: readonly string[]): Promise<void> {
  const invoices = state.ledger.invoices ?? [];
  const chosen = numbers
    .map((number) => invoices.find((i) => i.number === number))
    .filter((i): i is Invoice => i !== undefined);
  if (chosen.length < 2) return;

  const balances = invoiceBalanceMap();
  const sign = transaction.amount < 0 ? -1 : 1;
  let left = Math.abs(transaction.amount);

  const parts: SplitPart[] = [];
  const assigned: string[] = [];
  for (const invoice of chosen) {
    if (left <= 0) break;
    const owing = balances.get(invoice.number)?.remaining ?? invoice.total;
    const take = Math.min(Math.abs(owing), left);
    if (take <= 0) continue;
    parts.push({
      amount: sign * take,
      treatment: "standard",
      side: transaction.amount > 0 ? "sales" : "purchases",
      note: `Settles ${invoice.number} (${invoice.contact})`,
      ...(codeFromInvoice(invoice) !== null ? { code: codeFromInvoice(invoice) as string } : {}),
    });
    assigned.push(invoice.number);
    left -= take;
  }

  // Whatever the invoices did not account for. Left uncoded on purpose: it is
  // the part somebody has to look at.
  if (left > 0) {
    parts.push({
      amount: sign * left,
      note: "Not accounted for by the invoices chosen",
    });
  }
  if (parts.length < 2) return;

  const before = {
    split: (state.ledger.splits ?? {})[transaction.id] ?? null,
    match: (state.ledger.invoiceMatches ?? {})[transaction.id] ?? null,
  };

  const splits = { ...(state.ledger.splits ?? {}), [transaction.id]: parts };
  const invoiceMatches = { ...(state.ledger.invoiceMatches ?? {}) };
  // The payment itself no longer settles one invoice; its parts do.
  delete invoiceMatches[transaction.id];
  assigned.forEach((number, index) => {
    invoiceMatches[splitPartId(transaction.id, index)] = number;
  });

  state.ledger = { ...state.ledger, splits, invoiceMatches };
  state.persistent = await save(state.ledger);
  await record(
    "invoiceMatch",
    `${transaction.date} ${formatAmount(transaction.amount)} settles ` +
      `${assigned.join(", ")}` +
      (left > 0 ? `, with ${formatAmount(sign * left)} left over` : ""),
    before,
    { split: parts, matches: assigned },
    transaction.id,
  );
  reclassify();
  renderReconcile();
}

/** The single account an invoice codes to, when it has only one. */
function codeFromInvoice(invoice: Invoice): string | null {
  const codes = new Set((invoice.lines ?? []).map((l) => l.accountCode).filter((c) => c !== ""));
  if (codes.size !== 1) return null;
  return canonicalCodeFor([...codes][0] as string, knownCodes(state.rules, state.ledger.overrides ?? {}));
}

/**
 * Record that a bank line is not an invoice payment at all.
 *
 * Deleting the match is not enough when the matcher is the one that made it:
 * it finds the same invoice again on the next render, and the line cannot be
 * got rid of. So a refusal is stored as its own decision, and outranks
 * anything found automatically.
 */
async function refuseInvoice(transactionId: string): Promise<void> {
  const invoiceMatches = { ...(state.ledger.invoiceMatches ?? {}) };
  const before = invoiceMatches[transactionId] ?? invoiceAssignments().get(transactionId) ?? null;
  invoiceMatches[transactionId] = "";
  state.ledger = { ...state.ledger, invoiceMatches };
  state.persistent = await savePart(state.ledger, "invoiceMatches");
  await record(
    "invoiceMatch",
    `Not an invoice payment${before ? ` (was ${before})` : ""}`,
    before,
    "",
    transactionId,
  );
  reclassify();
  renderReconcile();
}

async function unmatchInvoice(transactionId: string): Promise<void> {
  const invoiceMatches = { ...(state.ledger.invoiceMatches ?? {}) };
  const before = invoiceMatches[transactionId];
  delete invoiceMatches[transactionId];
  state.ledger = { ...state.ledger, invoiceMatches };
  state.persistent = await savePart(state.ledger, "invoiceMatches");
  await record("invoiceMatch", `Unmatched ${before ?? ""}`, before ?? null, null, transactionId);
  renderReconcile();
}

/**
 * Accept every suggestion currently on screen.
 *
 * The point is the search box: narrow to one payee, see that the suggestion is
 * right for all of them, and say so once instead of forty times. The filter
 * and the search decide what "on screen" means, so this only ever accepts what
 * you are looking at.
 *
 * Lines with no suggestion are skipped rather than confirmed blank. Accepting
 * nothing is not a decision, and a line no rule could code is exactly the one
 * that deserves a person's attention.
 */
async function acceptAllShown(): Promise<void> {
  const offered = shownSuggestions().filter((one) => !one.confirmed && one.code !== null);

  /**
   * Lines that are a transfer, or are one press away from being one.
   *
   * This is the button the guard is really for. Working down a screen and
   * confirming it in one go is exactly when a transfer row -- which looks like
   * any other row, and has its only candidate already chosen -- gets coded as
   * an expense or, worse, as income. One at a time somebody might notice; two
   * hundred at a time nobody will.
   */
  const taken = new Set(Object.keys(state.ledger.transfers ?? {}));
  const rejected = new Set(state.ledger.rejectedTransfers ?? []);
  const partnerFor = (one: Suggestion): string | null => {
    if (taken.has(one.transaction.id) || rejected.has(one.transaction.id)) return null;
    const candidates = transferCandidates(one.transaction, state.ledger.transactions, {
      sameEntity: sameEntityBanks(one.transaction.account).accounts,
      taken,
    });
    return candidates.length === 1 ? (candidates[0]?.transaction.id ?? null) : null;
  };

  /*
   * The transfers first, then the coding of whatever is left.
   *
   * Two passes, because a line can be the partner of a pairing found later. In
   * one pass it was coded when its turn came and then paired when its partner's
   * turn came, so fourteen lines on one screen ended up both coded and paired
   * -- a state the books have no meaning for. Nothing is coded until every
   * pairing is known.
   */
  const pairs: { one: Suggestion; partnerId: string }[] = [];
  for (const one of offered) {
    const partnerId = partnerFor(one);
    if (partnerId === null || taken.has(partnerId)) continue;
    pairs.push({ one, partnerId });
    // Taken as they are found, so one leg cannot be spent on two transfers.
    taken.add(one.transaction.id);
    taken.add(partnerId);
  }

  const paired = new Set(pairs.flatMap((p) => [p.one.transaction.id, p.partnerId]));
  const lines = offered.filter((one) => !paired.has(one.transaction.id));

  if (lines.length === 0 && pairs.length === 0) {
    alert("Nothing on screen to accept: every line here is settled already, or has no suggestion to accept.");
    return;
  }

  const accounts = new Set(lines.map((one) => one.code));
  const summary =
    accounts.size === 1
      ? `all to ${[...accounts][0]}`
      : `across ${accounts.size} accounts`;
  if (
    !confirm(
      (lines.length > 0
        ? `Accept ${lines.length} suggestion${lines.length === 1 ? "" : "s"}, ${summary}?`
        : "Confirm what is on screen?") +
        "\n\n" +
        (pairs.length > 0
          ? `${pairs.length} line${pairs.length === 1 ? " is" : "s are"} a transfer between your ` +
            `own accounts, and will be recorded as ${pairs.length === 1 ? "one" : "transfers"} ` +
            "rather than coded.\n\n"
          : "") +
        "This confirms them exactly as shown. The change log can undo the whole batch.",
    )
  ) {
    return;
  }

  const overrides = { ...(state.ledger.overrides ?? {}) };
  const batch: CodingBatchEntry[] = [];
  const today = new Date().toISOString().slice(0, 10);
  for (const one of lines) {
    batch.push({ id: one.transaction.id, before: overrides[one.transaction.id] ?? null });
    overrides[one.transaction.id] = {
      ...(one.code !== null ? { code: one.code } : {}),
      confirmed: true,
      treatment: one.classification.treatment,
      side: one.classification.side,
      note: "Suggestion accepted unchanged, with others",
      at: today,
    };
  }

  // The transfers on screen, recorded as transfers. Both keys of each pair,
  // because half a transfer is a balance representing nothing.
  const transfers = { ...(state.ledger.transfers ?? {}) };
  const made: TransferPair[] = [];
  const byId = new Map(state.ledger.transactions.map((t) => [t.id, t]));
  for (const { one, partnerId } of pairs) {
    const partner = byId.get(partnerId);
    if (partner === undefined) continue;
    const out = one.transaction.amount < 0 ? one.transaction : partner;
    const into = one.transaction.amount < 0 ? partner : one.transaction;
    transfers[out.id] = into.id;
    transfers[into.id] = out.id;
    made.push({ from: out.id, to: into.id });
  }

  state.ledger = { ...state.ledger, overrides, transfers };
  state.persistent = await save(state.ledger);
  if (lines.length > 0) {
    await record(
      "codingBatch",
      `Accepted ${lines.length} suggestions ${summary}`,
      batch,
      null,
    );
  }
  if (made.length > 0) {
    await record(
      "transferBatch",
      `Recorded ${made.length} transfer${made.length === 1 ? "" : "s"} while accepting a screen`,
      null,
      made,
    );
  }
  reclassify();
  renderReconcile();
}

async function confirmLine(
  one: Suggestion,
  code: string,
  rate: GstRate,
  description: string,
  contact: string,
): Promise<void> {
  const { treatment, side } = rateToClassification(rate, one.transaction.amount);
  // A description is worth having when a suggestion is overruled, but it is not
  // required: blocking the line only moved the friction onto the person doing
  // the work, who then types a full stop. The change log records what changed
  // and who changed it either way. This is still wanted for the note below,
  // which must not claim a changed coding was accepted as it stood.
  const changed =
    code !== (one.code ?? "") || rate !== classificationToRate(one.classification);

  const overrides = { ...(state.ledger.overrides ?? {}) };
  const wasCoded = overrides[one.transaction.id];
  overrides[one.transaction.id] = {
    confirmed: true,
    ...(code !== "" ? { code } : {}),
    treatment,
    side,
    // Stored only when it differs from what the rules already say, so the
    // override records a decision rather than a copy of the suggestion.
    ...(contact.trim() !== "" && contact.trim() !== one.contact ? { contact: contact.trim() } : {}),
    note:
      description.trim() !== ""
        ? description.trim()
        : changed
          ? "Changed by hand, no description given"
          : "Suggestion accepted unchanged",
    at: new Date().toISOString().slice(0, 10),
  };
  state.ledger = { ...state.ledger, overrides };
  state.persistent = await save(state.ledger);
  await record(
    "coding",
    `${one.transaction.date} ${formatAmount(one.transaction.amount)} ${one.transaction.otherParty} → ${code || "no code"}`,
    wasCoded ?? null,
    overrides[one.transaction.id],
    one.transaction.id,
  );

  // Nothing suggested a code and a person supplied one: that is a rule being
  // stated, not merely a line being coded.
  if ((one.code ?? "") === "" && code !== "") await ruleFromDecision(one.transaction, code);

  renderReconcile();
}

/**
 * Turn one person's decision about an unsuggested line into a rule.
 *
 * The inference elsewhere refuses to build a rule from a single sighting, and
 * is right to: three sightings and eighty percent agreement is what makes a
 * *guess* about somebody's habits worth acting on. This is not that. Nothing
 * suggested a code, a person read the line and said what it was, and one
 * person saying so is not weak evidence -- it is the answer. What the
 * inference is protecting against is the tool inventing a pattern; this
 * records one it was told.
 *
 * Three things it will not do. It will not write a rule from a keyword too
 * short or too generic to mean anything, because "PAYMENT" as a rule would
 * code half the ledger. It will not add a second rule for a keyword that
 * already has one, because the first one is a decision too and quietly
 * outranking it would be a way of losing work. And it does not hide: the count
 * of lines it newly codes is on the page and in the change log, so a rule that
 * reached further than expected can be found and undone.
 */
async function ruleFromDecision(transaction: Transaction, code: string): Promise<void> {
  const keyword = keywordFor(transaction);
  if (keyword.length < 4 || GENERIC_PAYEES.has(keyword)) return;

  const file = (state.rules as RuleFileShape | undefined) ?? { rules: [] };
  const rules = [...(file.rules ?? [])];
  if (rules.some((r) => (r.keyword ?? "").toUpperCase() === keyword && r.account === undefined)) {
    return;
  }

  const rule: CategoryRule = { priority: 100, keyword, code, note: "From a coding decision" };

  // What it reaches, counted with the engine that will do the coding rather
  // than by re-matching the keyword here -- the two disagree, and a promise
  // about what just happened has to be made by asking the thing that did it.
  //
  // The line that started this is already in the before-count, because its
  // override was written before any of this ran. So the difference is other
  // lines, all of it, with nothing to subtract.
  const before = codedNow();
  state.rules = { ...file, rules: [...rules, rule] } as RuleSet;
  if (state.rulesName === "") state.rulesName = "rules.json";
  reclassify();
  const alsoCoded = Math.max(0, codedNow() - before);

  await record(
    "rule",
    `${keyword} → ${code}, from coding one line by hand` +
      (alsoCoded > 0
        ? `; it also suggests a code for ${alsoCoded} other line${alsoCoded === 1 ? "" : "s"}`
        : ""),
    null,
    rule,
    String(rules.length),
  );
  await persistRules();
  state.lastRule = { keyword, code, alsoCoded };
}

/**
 * How many transactions the engine can put a code on.
 *
 * Suggested or confirmed, which is deliberately not the same as "coded": a
 * rule proposes and a person decides, and a rule that reaches fifty lines has
 * not coded fifty lines. Saying it had would be the tool claiming somebody
 * else's work.
 */
function codedNow(): number {
  const rules = {
    ...((state.rules as RuleFileShape | undefined) ?? {}),
    overrides: state.ledger.overrides ?? {},
  } as RuleSet;
  let coded = 0;
  for (const line of state.ledger.transactions) if (categorise(line, rules).code) coded += 1;
  return coded;
}

/**
 * Payees that identify nobody.
 *
 * A bank line often has nothing in it but the transfer's own vocabulary, and a
 * rule on one of these words is a rule on everything.
 */
const GENERIC_PAYEES = new Set([
  "PAYMENT",
  "TRANSFER",
  "DIRECT CREDIT",
  "DIRECT DEBIT",
  "AUTOMATIC PAYMENT",
  "BILL PAYMENT",
  "INTERNET XFR",
  "DEPOSIT",
  "WITHDRAWAL",
  "EFTPOS",
  "VISA PURCHASE",
  "CREDIT",
  "DEBIT",
]);

async function loadCheckFiles(files: File[]): Promise<void> {
  // The journal report the ledger already holds goes in with the files, so an
  // Account Transactions export loaded on its own is still read knowing which
  // postings belong to which payment.
  const loaded = await loadReference(files, {
    ...(state.ledger.journals ? { journals: state.ledger.journals } : {}),
  });

  // A journal report dropped here is kept, not used once. It is the only file
  // that identifies a payment, and every export loaded afterwards wants it.
  if (loaded.journals.length > 0) {
    state.ledger = { ...state.ledger, journals: loaded.journals };
    state.persistent = await savePart(state.ledger, "journals");
  }

  // The payouts the same file describes. Kept whether or not anything is done
  // with them yet: they are the only record tying a bank line to the invoice,
  // the surcharge and the fee it is really made of.
  if (loaded.payouts.length > 0) {
    state.ledger = { ...state.ledger, payouts: loaded.payouts };
    state.persistent = await savePart(state.ledger);
  }
  // Accumulated, because a year often comes out of the accounting system as
  // several exports and all of them are wanted -- but deduplicated, because
  // loading the same one twice used to double it, and a doubled reference is
  // unusable rather than merely untidy: every transaction then matches two
  // identical rows, nothing is an unambiguous pair, and the account mapping
  // comes back empty, which is the difference between coding suggestions and
  // silence.
  const before = state.reference.length + loaded.lines.length;
  state.reference = dedupeReference([...state.reference, ...loaded.lines]);
  const dropped = before - state.reference.length;
  // Kept with the ledger. The Check page compares against it and the rule
  // suggestions are drawn from it, and neither should need the same export
  // loaded again after every reload.
  state.ledger = { ...state.ledger, reference: state.reference };
  state.persistent = await savePart(state.ledger, "reference");
  if (loaded.chart.length > 0) {
    state.chart = loaded.chart;
    state.ledger = { ...state.ledger, chart: loaded.chart };
    state.persistent = await save(state.ledger);
    await applyChartColumns(loaded.chart);
  }
  await ensureDefaultEntity();
  await tidyChart();
  // Payment allocations come out of the same export, so they are taken while
  // it is open rather than asked for again as a separate file. Only when it
  // carries some: loading a workbook or a journal report must not wipe the
  // allocations another file already supplied.
  if (loaded.allocations.length > 0) {
    state.ledger = { ...state.ledger, allocations: loaded.allocations };
    state.persistent = await savePart(state.ledger, "allocations");
  }

  state.checkProblems = loaded.problems;
  // Said rather than done quietly: somebody who loads the same export twice
  // should be told the second one added nothing, not left wondering why the
  // count did not move.
  if (dropped > 0) {
    state.checkProblems = [
      ...state.checkProblems,
      `${dropped} line${dropped === 1 ? "" : "s"} were already loaded from an earlier ` +
        "export and were not added again.",
    ];
  }
  // Files that hold a table nothing could name. Kept so the columns can be
  // pointed out rather than the file refused.
  state.checkUnreadable = loaded.unreadable;
  // The chart can be loaded from either page, so redraw whichever is showing.
  // Redrawing the check page while the user is looking at the accounts page
  // made loading a chart look like it had done nothing at all.
  showPage(state.page);
}

function clearCheck(): void {
  state.reference = [];
  state.checkProblems = [];
  state.ledger = { ...state.ledger, reference: [] };
  void savePart(state.ledger, "reference");
  renderCheck();
}

/**
 * Whether one of our accounts is the account a reference line sat on.
 *
 * Uses a mapping inferred from the payments rather than the account names: the
 * two systems name things nothing alike, and a card called `Kea Coffee Roaster`
 * here is `BNZ Visa - Business Card` there, sharing not one word.
 *
 * An account with no inferred pairing is left unconstrained rather than
 * excluded -- too few sightings to be sure is a reason to stay quiet, not a
 * reason to drop every line on that account.
 */
function sameAccount(ours: Transaction, theirs: ReferenceLine): boolean {
  if (theirs.account === undefined) return true;
  const expected = state.accountMap.get(ours.account);
  if (expected !== undefined) return expected === theirs.account;
  // No pairing was inferred for this account. When the reference produced
  // pairings for other accounts it has had its chance, so silence here means
  // the reference does not cover this account at all -- Xero holds one entity
  // and the ledger holds nine. Leaving it unconstrained lets a Rimu Lane transfer
  // marry an Kea Coffee loan of the same amount.
  return state.accountMap.size === 0;
}

/** The GST rate our own classification implies, in the reference's wording. */
function ourGstRate(transaction: Transaction): string | null {
  const one = state.suggestions?.get(transaction.id);
  if (!one) return null;
  return rateLabel(one.classification);
}

/**
 * Ask which columns to read, for a table nothing could name.
 *
 * A spreadsheet is somebody's own: the headings are whatever they chose, and a
 * reader that guesses will sometimes be wrong. Rather than refuse the file and
 * leave a person to work out what it wanted, its headings are shown and the
 * three that matter are chosen.
 */
function columnPicker(file: {
  name: string;
  sheet: SheetRows;
  headings: { index: number; name: string }[];
}): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "column-picker";

  const heading = document.createElement("h3");
  heading.textContent = `Which columns in ${file.name}?`;
  wrap.append(heading);

  wrap.append(
    note(
      "This looks like a table, but not one of the shapes read automatically. " +
        "Point out the three columns that matter and it will be read as it is.",
    ),
  );

  const form = document.createElement("div");
  form.className = "feed-form";

  // A guess for each, so the common case is a glance rather than three
  // decisions: the headings usually say what they are.
  const guess = (...words: string[]): number => {
    const hit = file.headings.find((c) =>
      words.some((w) => c.name.toLowerCase() === w) ,
    ) ?? file.headings.find((c) => words.some((w) => c.name.toLowerCase().includes(w)));
    return hit?.index ?? file.headings[0]?.index ?? 1;
  };

  const pick = (label: string, chosen: number): HTMLSelectElement => {
    const select = document.createElement("select");
    for (const column of file.headings) {
      const option = document.createElement("option");
      option.value = String(column.index);
      option.textContent = column.name;
      option.selected = column.index === chosen;
      select.append(option);
    }
    const wrapper = document.createElement("label");
    wrapper.append(`${label} `, select);
    form.append(wrapper);
    return select;
  };

  const date = pick("Date", guess("date"));
  const amount = pick("Amount", guess("amount", "value", "total"));
  const code = pick("Coded to", guess("what", "account", "code", "coding", "category"));

  const load = document.createElement("button");
  load.type = "button";
  load.className = "primary";
  load.textContent = "Read it";
  const said = document.createElement("p");
  said.className = "feed-said";

  load.addEventListener("click", () => {
    const lines = readChosenColumns(
      file.sheet,
      { date: Number(date.value), amount: Number(amount.value), code: Number(code.value) },
      file.name,
    );
    if (lines.length === 0) {
      said.textContent =
        "Nothing read from those columns. Check the date and amount are the right way round.";
      return;
    }
    state.reference = [...state.reference, ...lines];
    state.ledger = { ...state.ledger, reference: state.reference };
    state.checkUnreadable = state.checkUnreadable.filter((f) => f !== file);
    void savePart(state.ledger, "reference").then(() => renderCheck());
  });

  form.append(load);
  wrap.append(form, said);
  return wrap;
}

function renderCheck(): void {
  fillAccounts("check-accounts", state.checkAccounts, renderCheck);
  const body = $("check-body");
  body.textContent = "";

  for (const problem of state.checkProblems) {
    const line = document.createElement("p");
    line.className = "variance-problems";
    line.textContent = problem;
    body.append(line);
  }

  for (const file of state.checkUnreadable) body.append(columnPicker(file));

  if (state.ledger.transactions.length === 0) {
    body.append(note("No transactions yet. Import a bank file first."));
    return;
  }
  if (state.reference.length === 0) {
    body.append(
      note(
        "Load a Xero Account Transactions export (.xlsx) or the workbook (.xlsx) to check against. " +
          "A chart of accounts (.csv) helps too: it lets a code and a name be recognised as the same account.",
      ),
    );
    return;
  }

  const suggestions = suggest(
    state.ledger.transactions,
    state.rules,
    state.ledger.overrides ?? {},
    accountsFor(state.checkAccounts),
  );
  state.suggestions = new Map(suggestions.map((one) => [one.transaction.id, one]));

  // The rules' own opinion, with any human decision taken out of the way.
  const proposals = suggest(
    state.ledger.transactions,
    state.rules,
    {},
    accountsFor(state.checkAccounts),
  );
  const proposedBy = new Map(proposals.map((one) => [one.transaction.id, one.code]));

  const coded = suggestions.map((one) => ({ transaction: one.transaction, code: one.code }));
  state.accountMap = inferAccountMapping(coded, state.reference);

  const result = compareCodings(coded, state.reference, {
    chart: state.chart,
    accountMatches: sameAccount,
    gstRateOf: ourGstRate,
  });

  const checked = result.agreed.length + result.differed.length;
  const rate = checked === 0 ? 0 : (result.agreed.length / checked) * 100;

  // Nothing coded on our side means nothing to compare, and a row of zeros
  // reads as "the file matched nothing" rather than "there is nothing here
  // yet to match it against". Which is backwards: the reference is what
  // teaches the rules in the first place, so this is the beginning of the
  // loop rather than a failure of it.
  const nothingCoded =
    checked === 0 && coded.every((one) => one.code === null || one.code === "(uncoded)");
  if (nothingCoded) {
    const why = document.createElement("div");
    why.className = "check-nothing";
    const said = document.createElement("p");
    said.textContent =
      `${state.reference.length} reference lines loaded, and ${state.ledger.transactions.length} ` +
      "transactions — but none of them is coded yet, so there is nothing to compare. " +
      "That is the right way round: the coding in this file is what writes the rules, " +
      "and they are below.";
    why.append(said);
    body.append(why);
  }

  // The rules this file can write, on the page the file lands on.
  //
  // They used to be on Setup, because Setup was once the only place a coded
  // history could be loaded -- and they stayed there after the loading moved,
  // so the answer to "nothing is coded yet" lived on a different page from the
  // question, reached by a button whose only purpose was to bridge the two.
  //
  // Above the comparison while there is nothing to compare, because then they
  // are the whole point of the page. Folded away below it once there are
  // codings, because then the comparison is what somebody came for and a table
  // of eighteen proposals is in the way of it.
  if (nothingCoded) {
    renderRuleSuggestions(body);
  }

  /**
   * Every payment the other system split, whether or not we have split it too.
   *
   * Comparing one of these on a single code is meaningless in both directions.
   * If we hold one line, the comparison is against whichever part happens to be
   * largest -- it agrees or differs by accident. If we hold a split, the parent
   * has no single code at all, so it silently landed in "agree" and disappeared,
   * which is why four courier payments could not be found anywhere on this page.
   *
   * So they come out of the code and GST comparisons entirely and get their own
   * section, where the question is the one actually worth asking: do our parts
   * match theirs.
   */
  const ourSplits = state.ledger.splits ?? {};
  const isSplit = (r: CodingRow): boolean => (r.theirs?.parts?.length ?? 0) > 1;
  // Uncoded lines belong here too. A payment the other system split can sit on
  // this ledger split -- and split differently -- without ever having been
  // coded, and until uncoded rows started carrying the other side there was no
  // way for one to reach this section at all. A split done differently from
  // theirs is exactly the disagreement worth seeing.
  const splitRows = [...result.agreed, ...result.differed, ...result.uncoded].filter(isSplit);

  // Only the ones still asking for something.
  //
  // The section listed every payment the other system splits, whether or not
  // it had been split here -- so taking a split left the row exactly where it
  // was, offering to reload the split you had just accepted, and the only way
  // to tell it had worked was to count. A split whose parts match theirs is
  // finished, and belongs off the page with everything else that agrees.
  //
  // Matched on the amounts rather than the count: two parts against two parts
  // is not agreement if they are 40/60 here and 50/50 there.
  const sameParts = (row: CodingRow): boolean => {
    const held = ourSplits[row.transaction.id];
    const theirs = row.theirs?.parts;
    if (held === undefined || theirs === undefined) return false;
    if (held.length !== theirs.length) return false;
    const sorted = (amounts: readonly number[]): string =>
      [...amounts].sort((a, b) => a - b).join(",");
    return sorted(held.map((p) => p.amount)) === sorted(theirs.map((p) => p.amount));
  };
  const splitsToDo = splitRows.filter((row) => !sameParts(row));

  /**
   * Lines this ledger has already settled another way.
   *
   * A receipt matched to an invoice is already posted, and posted the same way
   * the other system posts it: Dr Bank, Cr Accounts Receivable, clearing the
   * debtor the invoice raised. `postTransaction` does that from the invoice
   * link, so "Accounts Receivable" is not a coding this ledger is missing -- it
   * is the coding this ledger already has.
   *
   * Which is why offering it is worse than useless. The settles branch returns
   * before it reads any parts, so an adopted code changes nothing about the
   * posting -- a button that appears to act and does not. What it does change is
   * the evidence: an override saying this payee means Accounts Receivable is a
   * rule waiting to be inferred, and that rule would fire on the next receipt
   * that has no invoice behind it, crediting a control account with no sale
   * recognised anywhere.
   *
   * A recorded transfer is the same case: both legs are posted as one movement
   * by `postTransfer`, and neither wants a code.
   *
   * So they are held out of the adoption section the way splits are -- not a
   * disagreement and not a gap, but work already done.
   */
  const assigned = invoiceAssignments();
  const ourTransfers = state.ledger.transfers ?? {};
  const settledElsewhere = (row: CodingRow): boolean =>
    assigned.has(row.transaction.id) || ourTransfers[row.transaction.id] !== undefined;

  const comparable = result.uncoded.filter((r) => r.theirs !== null && !isSplit(r));
  const adoptable = comparable.filter((r) => !settledElsewhere(r));
  const alreadySettled = comparable.length - adoptable.length;


  const gstFlags = [...result.agreed, ...result.differed].filter(
    (r) => r.gstDiffers && !isSplit(r),
  );
  const differed = result.differed.filter((r) => !isSplit(r));

  const summary = document.createElement("div");
  summary.className = "check-summary";
  for (const [value, label] of [
    [String(result.agreed.length), "agree"],
    [String(differed.length), "differ"],
    [`${rate.toFixed(1)}%`, "of checkable lines agree"],
    [String(gstFlags.length), "GST rate differs"],
    [
      splitsToDo.length === 0
        ? String(splitRows.length)
        : `${splitRows.length} / ${splitsToDo.length}`,
      splitsToDo.length === 0
        ? "split in Xero, all matched here"
        : "split in Xero / still to match",
    ],
    [String(result.unreferenced.length), "coded, nothing to check against"],
    [String(result.uncoded.length - alreadySettled), "not coded yet"],
    // The mirror of the line above, and the one nobody was told. A line in the
    // file with no transaction behind it used to vanish without a count.
    [String(result.unmatched.length), "in the file, not in your ledger"],
  ] as const) {
    const cell = document.createElement("div");
    cell.className = "check-stat";
    const big = document.createElement("span");
    big.className = "check-value";
    big.textContent = value;
    const small = document.createElement("span");
    small.className = "check-label";
    small.textContent = label;
    cell.append(big, small);
    summary.append(cell);
  }
  body.append(summary);

  body.append(
    note(
      `${state.reference.length} reference lines loaded. Only lines that exist on both sides ` +
        "can be checked; the rest are shown so the coverage is visible rather than assumed.",
    ),
  );

  // The order is the order somebody should work in.
  //
  // Splits first, because a split changes what a line *is*: a courier payment
  // that is really freight, border GST and a fee cannot be coded to one
  // account at all, so coding it before splitting it means doing it twice.
  if (splitsToDo.length > 0) {
    body.append(section("Xero splits these", splitsToDo, proposedBy, false));
    body.append(
      note(
        "A split payment cannot be compared on one code, so these are kept out of the counts " +
          "above. Open one to see Xero's parts; loading them replaces whatever split is held here.",
      ),
    );
  }

  // Then the disagreements. They come before the wholesale adoption below
  // because they are what says whether that adoption is safe: nine differing
  // out of a hundred and seventy means the other system's coding can be
  // trusted here, and eighty means it cannot.
  if (differed.length > 0) {
    body.append(section("Coding disagrees", differed, proposedBy, false));
  }

  // Then the lines we have not coded, that the other system did.
  //
  // These used to be counted and never shown. The comparison was built to
  // check our coding against theirs, so a row with nothing on our side had
  // nothing to compare -- but on a ledger nobody has worked through yet that
  // is exactly backwards: their coding is not the thing to check against, it
  // is the answer.
  //
  // Splits are not adoptable one line at a time -- taking a single code for a
  // payment the other system split across three accounts would be wrong, which
  // is the whole reason splits have a section of their own. So they are left
  // to it rather than listed in both.
  if (adoptable.length > 0) {
    body.append(section("Not coded here, coded in the file", adoptable, proposedBy, false));
    body.append(
      note(
        "These have a coding in the file and none here. “Use Xero” takes it, one " +
          "line at a time -- which is the way through the ones no rule can gather: a " +
          "supplier whose payee changes with every payment, or one coded to a " +
          "different account each time.",
      ),
    );
  }

  // Said rather than silently dropped. A row leaving a section without a word
  // is how somebody comes to trust a count that is quietly wrong.
  if (alreadySettled > 0) {
    body.append(
      note(
        `${alreadySettled} more ${alreadySettled === 1 ? "line is" : "lines are"} coded in the ` +
          "file and left off that list, because they are already posted here the same way: " +
          "a receipt against an invoice clears Accounts Receivable, a payment on a bill " +
          "clears Accounts Payable, and a transfer is posted as one movement across both " +
          "legs. Nothing is missing on these, so there is nothing to adopt.",
      ),
    );
  }

  // Then GST, last of the coding work, because a rate is a refinement on a
  // line whose account is already settled -- and settling the account above
  // may well have changed the rate anyway.
  if (gstFlags.length > 0) {
    body.append(section("GST rate disagrees", gstFlags, proposedBy, true));
  }

  // Last, because nothing here can be acted on from this page.
  //
  // These are lines in the file that no transaction here matched -- and until
  // now they simply vanished: no row, no count, no warning, because a
  // comparison can only report where both sides exist. They are worth seeing
  // anyway. Either the bank data is short of something, or the other system
  // holds entries the bank never saw.
  if (result.unmatched.length > 0) {
    const heading = document.createElement("h3");
    heading.textContent = `In the file, not in your ledger (${result.unmatched.length})`;
    body.append(heading);
    body.append(
      note(
        "Nothing here matched one of your transactions, so none of it could be checked. " +
          "That means either these are missing from what you imported, or the other " +
          "system holds them and your bank never saw them -- a journal, an adjustment, " +
          "or an account you have not imported.",
      ),
    );

    const table = document.createElement("table");
    table.className = "report-table owner-table";
    const head = document.createElement("thead");
    head.innerHTML =
      "<tr><th>Date</th><th>Amount</th><th>Coded to</th><th>On their account</th></tr>";
    const tbody = document.createElement("tbody");
    // Grouped by their account, because the commonest cause by far is a whole
    // account nobody imported, and a list sorted by date hides that.
    for (const line of [...result.unmatched].sort(
      (a, b) => (a.account ?? "").localeCompare(b.account ?? "") || a.date.localeCompare(b.date),
    )) {
      const tr = document.createElement("tr");
      tr.append(nameCell(line.date));
      tr.append(amountCell(formatAmount(line.amount)));
      tr.append(nameCell(line.label));
      tr.append(nameCell(line.account ?? ""));
      tbody.append(tr);
    }
    table.append(head, tbody);
    body.append(table);
  }

  // And folded away at the foot once there is a comparison to read. Still
  // here, because more rules can always be drawn out as more of the file is
  // matched -- just not in front of what somebody opened the page for.
  if (!nothingCoded) {
    const fold = document.createElement("details");
    fold.className = "check-rules-fold";
    const summary = document.createElement("summary");
    summary.textContent = "Rules that could be drawn from this file";
    fold.append(summary);
    renderRuleSuggestions(fold, false);
    body.append(fold);
  }
}

/**
 * One table of differences.
 *
 * Three codings are shown separately because they are three different things:
 * what the rules propose, what a person decided, and what the other system
 * recorded. Collapsing the first two hides whether anyone has actually looked.
 */
function section(
  title: string,
  rows: readonly CodingRow[],
  proposedBy: ReadonlyMap<string, string | null>,
  gst: boolean,
): HTMLElement {
  const wrap = document.createElement("div");
  const heading = document.createElement("h3");
  heading.textContent = `${title} (${rows.length})`;
  wrap.append(heading);

  const table = document.createElement("table");
  table.className = "check-table";
  const head = document.createElement("thead");
  head.innerHTML =
    '<tr><th class="col-date">Date</th><th class="col-amount">Amount</th>' +
    '<th class="col-payee">Payee</th><th class="col-proposed">Rules propose</th>' +
    '<th class="col-coded">You coded</th>' +
    `<th class="${gst ? "col-gst" : "col-imported"}">${gst ? "GST ours / theirs" : "Xero says"}</th>` +
    '<th class="col-use">Use</th></tr>';
  const tbody = document.createElement("tbody");

  for (const row of [...rows].sort(
    (a, b) => Math.abs(b.transaction.amount) - Math.abs(a.transaction.amount),
  )) {
    const tr = document.createElement("tr");
    const override = (state.ledger.overrides ?? {})[row.transaction.id];
    const proposed = proposedBy.get(row.transaction.id) ?? "";
    // Whatever the override says is what the engine uses and what the
    // comparison compared, confirmed or not. Showing only confirmed ones made
    // a row look like it disagreed over nothing more than a name.
    const coded =
      override?.code === undefined
        ? ""
        : override.confirmed === true
          ? override.code
          : `${override.code} (unconfirmed)`;
    const imported = row.theirs?.label ?? "";

    // Payee, the bank's own code field, and the reference, run together. Any
    // of the three can be the part that identifies a payment, and which one it
    // is differs by bank and by transaction type.
    const who = [row.transaction.otherParty, row.transaction.code, row.transaction.reference]
      .filter((part) => part !== undefined && part.trim() !== "")
      .join(" ");

    const cells = [
      row.transaction.date,
      formatAmount(row.transaction.amount),
      who,
      proposed,
      coded,
      gst ? `${row.gstDiffers?.ours ?? ""} / ${row.gstDiffers?.theirs ?? ""}` : imported,
    ];
    const classes = ["col-date", "col-amount", "col-payee", "col-proposed", "col-coded",
                     gst ? "col-gst" : "col-imported"];
    cells.forEach((text, index) => {
      const td = document.createElement("td");
      td.textContent = text;
      td.className = classes[index] ?? "";
      // The column is narrow and the text is truncated, so the full value has
      // to be reachable without leaving the page.
      if (text !== "") td.title = text;
      tr.append(td);
    });

    // A payment split across accounts cannot be represented by one code, so it
    // is offered as a split rather than pretending one of its parts is the
    // whole answer.
    const parts = row.theirs?.parts;
    if (parts && parts.length > 1) {
      const marker = document.createElement("button");
      marker.type = "button";
      marker.className = "split-marker";
      const held = (state.ledger.splits ?? {})[row.transaction.id];
      marker.textContent =
        `Xero splits this into ${parts.length}` +
        (held ? ` — split into ${held.length} here` : " — one line here");
      marker.addEventListener("click", () => {
        state.expandedSplit = state.expandedSplit === row.transaction.id ? null : row.transaction.id;
        renderCheck();
      });
      const cell = tr.querySelector(gst ? ".col-gst" : ".col-imported");
      cell?.append(document.createElement("br"), marker);
    }

    const actions = document.createElement("td");
    actions.className = "check-actions";
    if (proposed !== "" && proposed !== coded) {
      actions.append(useButton("proposed", row.transaction, proposed));
    }
    if (imported !== "" && !(parts && parts.length > 1)) {
      // In the section that exists because the *rate* disagrees, the rate is
      // what the button has to bring across. It took only the account, which
      // in that section already matched -- so the one button offered to settle
      // a GST disagreement changed nothing at all, thirty-nine times over.
      actions.append(
        useButton("imported", row.transaction, imported, gst ? row.gstDiffers?.theirs : undefined),
      );
    }
    if (parts && parts.length > 1) {
      const useSplit = document.createElement("button");
      useSplit.type = "button";
      useSplit.className = "use-button";
      useSplit.textContent = (state.ledger.splits ?? {})[row.transaction.id]
        ? "reload split"
        : "use split";
      useSplit.addEventListener("click", () => void acceptSplit(row.transaction, parts));
      actions.append(useSplit);
    }
    tr.append(actions);
    tbody.append(tr);

    if (state.expandedSplit === row.transaction.id && parts) {
      const detail = document.createElement("tr");
      detail.className = "split-detail";
      const cell = document.createElement("td");
      cell.colSpan = 7;
      const table = document.createElement("table");
      const body = document.createElement("tbody");
      for (const part of parts) {
        const line = document.createElement("tr");
        for (const [index, text] of [
          formatAmount(part.amount),
          part.code,
          part.gstRate,
          part.description,
        ].entries()) {
          const td = document.createElement("td");
          td.textContent = text;
          td.style.textAlign = index === 0 ? "right" : "left";
          line.append(td);
        }
        body.append(line);
      }
      table.append(body);
      cell.append(table);
      detail.append(cell);
      tbody.append(detail);
    }
  }

  table.append(head, tbody);
  const scroll = document.createElement("div");
  scroll.className = "check-scroll";
  scroll.append(table);
  wrap.append(scroll);
  return wrap;
}

function useButton(
  kind: string,
  transaction: Transaction,
  code: string,
  /** The rate the other system used, where that is what disagrees. */
  rate?: string,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "use-button";
  button.textContent = kind === "imported" ? "use Xero" : "use rules";
  button.title = rate === undefined ? code : `${code} · ${rate}`;
  button.addEventListener("click", () => void acceptCode(transaction, code, kind, rate));
  return button;
}

/**
 * Accept one of the offered codings.
 *
 * An imported code arrives in the other system's vocabulary -- `910 - Loan from
 * Director` where the rules say `NB Loan from director - 910` -- and storing it
 * raw would leave a code with no GST treatment, which the engine silently
 * assumes to be standard-rated. So it is mapped back to the name already in
 * use, and refused when it cannot be.
 */
async function acceptCode(
  transaction: Transaction,
  code: string,
  kind: string,
  rate?: string,
): Promise<void> {
  let chosen = code;
  if (kind === "imported") {
    const mapped = mapToOurVocabulary(code);
    if (mapped === null) {
      // The old wording sent people to set a code treatment, which has not been
      // the only way to answer this since the chart's own tax code started
      // being read. What is actually missing is the account.
      alert(
        `Nothing here matches "${code}". Add that account to your chart of ` +
          "accounts -- with its tax code -- and this will find it.",
      );
      return;
    }
    chosen = mapped;
  }

  const one = state.suggestions?.get(transaction.id);

  // A rate named by the other system is read with the same rules a chart's tax
  // code is read with, rather than a second interpretation of the same words.
  const stated =
    rate === undefined || rate.trim() === ""
      ? null
      : accountTreatment({ code: "", name: "", type: "", taxCode: rate, description: "" });

  const overrides = { ...(state.ledger.overrides ?? {}) };
  const wasCoded = overrides[transaction.id];
  const side = stated?.side ?? (stated !== null ? "none" : one?.classification.side);
  overrides[transaction.id] = {
    confirmed: true,
    code: chosen,
    treatment: stated?.treatment ?? one?.classification.treatment ?? "standard",
    ...(side !== undefined && side !== "none" ? { side } : {}),
    note:
      stated === null
        ? `Accepted the ${kind} coding on the Coding reconciliation page.`
        : `Accepted the ${kind} coding and its rate (${rate}) on the Coding reconciliation page.`,
    at: new Date().toISOString().slice(0, 10),
  };
  state.ledger = { ...state.ledger, overrides };
  state.persistent = await save(state.ledger);
  await record(
    "coding",
    `${transaction.date} ${formatAmount(transaction.amount)} ${transaction.otherParty} → ${chosen} (accepted the ${kind} coding)`,
    wasCoded ?? null,
    overrides[transaction.id],
    transaction.id,
  );
  renderCheck();
}

/**
 * Load a split recorded by the other system.
 *
 * The parts are mapped into our own vocabulary and GST model on the way in, and
 * the whole thing is refused unless they still sum to the bank line.
 */
async function acceptSplit(transaction: Transaction, parts: readonly ReferencePart[]): Promise<void> {
  const mapped: SplitPart[] = [];
  const unmapped: string[] = [];

  // The whole payment went one way; a part with the opposite sign is a refund
  // of that same thing, not income. Taking the side from each part own sign
  // would move a courier refund into Box 5.
  const side = transaction.amount < 0 ? "purchases" : "sales";

  for (const part of parts) {
    const code = mapToOurVocabulary(part.code);
    if (code === null) unmapped.push(part.code);

    // A posting to the GST control account is not an expense carrying GST --
    // it is the tax itself, which belongs in Box 13 whole rather than having
    // 3/23 taken out of it.
    const isTax = /(^|[ ])GST([ ]|$)/i.test(part.code) && !/^15%/.test(part.gstRate);
    const rated = /^15%/.test(part.gstRate);

    mapped.push({
      amount: part.amount,
      ...(code !== null ? { code } : {}),
      treatment: isTax || rated ? "standard" : "out-of-scope",
      side: isTax ? "imports" : rated ? side : "none",
      note: `Xero: ${part.description}`,
    });
  }

  if (unmapped.length > 0) {
    alert(
      `No account in your rules matches ${unmapped.join(", ")}. ` +
        "Add a code treatment first, otherwise the GST on those parts would only be assumed.",
    );
    return;
  }

  const total = mapped.reduce((sum, part) => sum + part.amount, 0);
  if (total !== transaction.amount) {
    alert(`The parts total ${formatAmount(total)} but the bank line is ${formatAmount(transaction.amount)}.`);
    return;
  }

  const before = (state.ledger.splits ?? {})[transaction.id];
  const splits = { ...(state.ledger.splits ?? {}), [transaction.id]: mapped };
  state.ledger = { ...state.ledger, splits };
  state.persistent = await save(state.ledger);
  await record(
    "split",
    `${transaction.date} ${formatAmount(transaction.amount)} ${transaction.otherParty} split into ${mapped.length} from Xero`,
    before ?? null,
    mapped,
    transaction.id,
  );
  state.expandedSplit = null;
  renderCheck();
}

/** `910 - Loan from Director` -> whatever the rules already call account 910. */
function mapToOurVocabulary(code: string): string | null {
  // The chart counts as something we know about. Without it, an account that
  // exists only in the chart -- which is every account on a freshly imported
  // one, before anything has been coded to it -- was unknown, and taking the
  // other system's coding for it was refused with the advice to go and set up
  // the very thing that was already set up.
  const known = knownCodes(state.rules, state.ledger.overrides ?? {}, state.chart);
  if (known.includes(code)) return code;
  return matchAccountName(code, known);
}

/**
 * Loading a rule file.
 *
 * When one is already in use the choice is put to the user rather than
 * guessed at: adding and replacing produce very different codings, and
 * replacing silently would change every uncoded suggestion at once.
 */
async function loadRulesFile(file: File): Promise<void> {
  let incoming: RuleFileShape;
  try {
    incoming = JSON.parse(await file.text()) as RuleFileShape;
  } catch (error) {
    state.rulesMessage = `${file.name}: ${(error as Error).message}`;
    renderRules();
    return;
  }
  if (!Array.isArray(incoming.rules)) {
    state.rulesMessage = `${file.name} has no rules array, so it is not a rule file.`;
    renderRules();
    return;
  }

  if (state.rules === undefined) {
    await useRules(incoming, file.name, "Loaded");
    return;
  }

  state.pendingRules = { rules: incoming, name: file.name };
  renderRules();
}

async function useRules(rules: RuleFileShape, name: string, verb: string): Promise<void> {
  state.rules = rules;
  state.rulesName = name;
  state.rulesLoadedAt = new Date().toISOString().slice(0, 16).replace("T", " ");
  state.pendingRules = null;
  state.rulesMessage = `${verb} ${name}: ${describeRules(rules)}.`;
  await saveRules({ version: 1, name, loadedAt: state.rulesLoadedAt, rules });
  renderRules();
}

async function replaceRules(): Promise<void> {
  const pending = state.pendingRules;
  if (!pending) return;
  // The set being displaced is kept: replacing changes every suggestion at
  // once, and getting the old one back should not depend on still having the
  // file it came from.
  if (state.rules) {
    state.rulesArchive = {
      version: 1,
      entries: [
        {
          name: state.rulesName,
          replacedAt: new Date().toISOString().slice(0, 16).replace("T", " "),
          rules: state.rules,
        },
        ...state.rulesArchive.entries,
      ].slice(0, 10),
    };
    await saveRulesArchive(state.rulesArchive);
  }
  await useRules(pending.rules, pending.name, "Replaced with");
}

async function addRules(): Promise<void> {
  const pending = state.pendingRules;
  if (!pending || !state.rules) return;
  const report = mergeRules(state.rules as RuleFileShape, pending.rules);
  await useRules(report.merged, `${state.rulesName} + ${pending.name}`, "Added");
  state.rulesMessage =
    `Added ${report.addedRules} rules from ${pending.name}` +
    (report.skippedRules > 0 ? `, skipping ${report.skippedRules} already present` : "") +
    (report.addedTreatments > 0 ? `, and ${report.addedTreatments} code treatments` : "") +
    ".";
  if (report.conflictingTreatments.length > 0) {
    state.rulesMessage +=
      ` ${report.conflictingTreatments.length} code treatment(s) disagreed and the existing ones were kept: ` +
      report.conflictingTreatments.map((c) => c.code).slice(0, 5).join(", ") +
      ".";
  }
  renderRules();
}

async function restoreRules(index: number): Promise<void> {
  const entry = state.rulesArchive.entries[index];
  if (!entry) return;
  state.rulesArchive = {
    version: 1,
    entries: state.rulesArchive.entries.filter((_, i) => i !== index),
  };
  await saveRulesArchive(state.rulesArchive);
  await useRules(entry.rules as RuleFileShape, entry.name, "Restored");
}

function renderRulesStatus(): void {
  const holder = $("rules-status");
  holder.textContent = "";

  const line = document.createElement("p");
  line.className = "page-hint";
  line.textContent =
    state.rules === undefined
      ? "No rules loaded. Load a rule file to get coding suggestions."
      : `In use: ${state.rulesName} — ${describeRules(state.rules as RuleFileShape)}, loaded ${state.rulesLoadedAt}. Kept between sessions.`;
  holder.append(line);

  if (state.rulesMessage !== "") {
    const message = document.createElement("p");
    message.className = "rules-message";
    message.textContent = state.rulesMessage;
    holder.append(message);
  }

  const pending = state.pendingRules;
  if (pending) {
    const choice = document.createElement("div");
    choice.className = "rules-choice";
    const question = document.createElement("p");
    question.textContent =
      `${pending.name} holds ${describeRules(pending.rules)}. ` +
      "Add it to what is already loaded, or replace? The set being replaced is kept.";
    choice.append(question);

    const add = document.createElement("button");
    add.type = "button";
    add.className = "primary";
    add.textContent = "Add to existing";
    add.addEventListener("click", () => void addRules());

    const replace = document.createElement("button");
    replace.type = "button";
    replace.textContent = "Replace";
    replace.addEventListener("click", () => void replaceRules());

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => {
      state.pendingRules = null;
      renderRules();
    });

    choice.append(add, replace, cancel);
    holder.append(choice);
  }

  if (state.rulesArchive.entries.length > 0) {
    const heading = document.createElement("h3");
    heading.textContent = "Replaced rule sets";
    holder.append(heading);
    for (const [index, entry] of state.rulesArchive.entries.entries()) {
      const row = document.createElement("p");
      row.className = "rules-archive";
      row.textContent = `${entry.name} — ${describeRules(entry.rules as RuleFileShape)}, replaced ${entry.replacedAt}. `;
      const restore = document.createElement("button");
      restore.type = "button";
      restore.textContent = "Restore";
      restore.addEventListener("click", () => void restoreRules(index));
      row.append(restore);
      holder.append(row);
    }
  }
}

function renderRules(): void {
  renderRulesStatus();
  const body = $("rules-body");
  body.textContent = "";
  const file = state.rules as RuleFileShape | undefined;

  if (!file) {
    body.append(note("No rules loaded. Load a rule file with the button above."));
    return;
  }

  const all = file.rules ?? [];
  const needle = $<HTMLInputElement>("rules-search").value.trim().toLowerCase();
  const matches = (text: string) => needle === "" || text.toLowerCase().includes(needle);

  // Indexes are carried through the filter: editing row 3 of a search result
  // has to write back to the rule it actually came from, not to rule 3.
  const shown = all
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) =>
      matches(
        `${rule.keyword ?? ""} ${rule.code} ${rule.account ?? ""} ${rule.contact ?? ""} ${rule.note ?? ""}`,
      ),
    )
    .sort((a, b) => (b.rule.priority ?? 0) - (a.rule.priority ?? 0) || a.index - b.index);

  const summary = document.createElement("div");
  summary.className = "rules-summary";
  const count = document.createElement("span");
  count.textContent =
    `${shown.length} of ${all.length} rules, ` +
    `${(file.defaults ?? []).length} defaults, ` +
    `${Object.keys(file.codeTreatments ?? {}).length} code treatments. ` +
    "Changes are kept in this browser as you make them.";

  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.textContent = "Add rule";
  addButton.addEventListener("click", () => {
    state.ruleDraft = blankDraft();
    renderRules();
  });

  const downloadButton = document.createElement("button");
  downloadButton.type = "button";
  downloadButton.textContent = "Download JSON";
  downloadButton.title = "Save the whole rule set to a file you can keep or share.";
  downloadButton.addEventListener("click", () => downloadRules());

  summary.append(count, addButton, downloadButton);
  body.append(summary);

  if (state.ruleDraft && state.ruleDraft.index === null) {
    body.append(ruleEditor(state.ruleDraft, "Add this rule"));
  }

  const limit = 300;
  const table = document.createElement("table");
  table.className = "rules-table";
  const head = document.createElement("thead");
  head.innerHTML =
    "<tr><th>Priority</th><th>Keyword</th><th>Account</th><th>Code</th>" +
    "<th>To (contact)</th><th>Note</th><th></th></tr>";
  const tbody = document.createElement("tbody");

  for (const { rule, index } of shown.slice(0, limit)) {
    if (state.ruleDraft && state.ruleDraft.index === index) {
      const editing = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 7;
      cell.append(ruleEditor(state.ruleDraft, "Save this rule"));
      editing.append(cell);
      tbody.append(editing);
      continue;
    }

    const tr = document.createElement("tr");
    const cells = [
      String(rule.priority ?? 0),
      rule.keyword ?? "",
      rule.account ?? "",
      rule.code,
      rule.contact ?? "",
      rule.note ?? "",
    ];
    cells.forEach((text, column) => {
      const td = document.createElement("td");
      td.textContent = text;
      if (column > 0) td.className = "rules-left";
      tr.append(td);
    });

    const actions = document.createElement("td");
    actions.className = "rules-actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => {
      state.ruleDraft = toDraft(rule, index);
      renderRules();
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => deleteRule(index, rule));
    actions.append(edit, remove);
    tr.append(actions);
    tbody.append(tr);
  }

  table.append(head, tbody);
  body.append(table);

  if (shown.length > limit) {
    body.append(
      note(`Showing the first ${limit}. Search to narrow the list down to the rule you want.`),
    );
  }
}

/**
 * The edit form for one rule.
 *
 * It reports how many transactions the rule would match before it is saved,
 * because that is the only honest answer to what a rule actually does -- a
 * keyword that reads as specific can match three hundred lines, and one that
 * reads as broad can match none.
 */
function ruleEditor(draft: RuleDraft, saveLabel: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "rule-editor";

  const fields: [keyof RuleDraft, string, string][] = [
    ["priority", "Priority", "0"],
    ["keyword", "Keyword", "Text found anywhere in the bank line"],
    ["account", "Account", "Bank account id, or blank for any"],
    ["code", "Code", "Account to code it to"],
    ["contact", "To (contact)", "Defaults to the keyword"],
    ["note", "Note", "Why this rule exists"],
    // Narrower than a keyword: these look in one field each, and all of them
    // have to hold. The payee is the same on every payment to Inland Revenue;
    // which tax it was is in the particulars.
    ["wherePayee", "Payee contains", "Narrower than a keyword — blank for any"],
    ["whereParticulars", "Particulars contains", "e.g. GST"],
    ["whereCode", "Bank code contains", "The bank's own code field"],
    ["whereReference", "Reference contains", ""],
    // The one field that identifies a counterparty when the payee will not.
    // Some banks write the particulars into the payee, so every payment to one
    // supplier arrives under a different name -- and all of them name the same
    // account number.
    ["whereOtherAccount", "Paid to/from account", "e.g. 38-9022-0374960-00"],
  ];

  const impact = document.createElement("p");
  impact.className = "rule-impact";

  const refresh = (): void => {
    // The parts as well as the whole, because a rule may now name a field.
    const text = state.ledger.transactions.map((t) => ({
      account: t.account,
      text: [t.otherParty, t.particulars, t.code, t.reference, t.otherPartyAccount]
        .join(" ")
        .toUpperCase(),
      otherParty: t.otherParty,
      particulars: t.particulars,
      code: t.code,
      reference: t.reference,
      otherPartyAccount: t.otherPartyAccount,
    }));
    const codes = state.suggestions;
    const result = ruleImpact(draft, text, (index) => {
      const transaction = state.ledger.transactions[index];
      return transaction ? (codes?.get(transaction.id)?.code ?? null) : null;
    });
    impact.textContent =
      result.matches === 0
        ? "Matches nothing in the ledger as it stands."
        : `Matches ${result.matches} transaction${result.matches === 1 ? "" : "s"}` +
          (result.stolen > 0
            ? `, ${result.stolen} of which another rule currently codes differently.`
            : ".") +
          " Lines already confirmed keep their coding.";
  };

  for (const [key, label, placeholder] of fields) {
    const wrapper = document.createElement("label");
    wrapper.className = "rule-field";
    const caption = document.createElement("span");
    caption.textContent = label;
    const input = document.createElement("input");
    input.type = "text";
    input.value = String(draft[key]);
    input.placeholder = placeholder;
    input.addEventListener("input", () => {
      (draft[key] as string) = input.value;
      refresh();
    });
    wrapper.append(caption, input);
    wrap.append(wrapper);
  }

  const problems = document.createElement("p");
  problems.className = "rule-problems";

  const save = document.createElement("button");
  save.type = "button";
  save.className = "primary";
  save.textContent = saveLabel;
  save.addEventListener("click", () => {
    const found = validateDraft(draft);
    if (found.length > 0) {
      problems.textContent = found.map((p) => p.message).join(" ");
      return;
    }
    commitRule(draft);
  });

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => {
    state.ruleDraft = null;
    renderRules();
  });

  const buttons = document.createElement("div");
  buttons.className = "rule-editor-actions";
  buttons.append(save, cancel);

  refresh();
  wrap.append(impact, problems, buttons);
  return wrap;
}

/** Put an edited or new rule back into the set, in memory only. */
function commitRule(draft: RuleDraft): void {
  const file = state.rules as RuleFileShape | undefined;
  if (!file) return;
  const rules = [...(file.rules ?? [])];
  const rule = fromDraft(draft);

  const index = draft.index ?? rules.length;
  const before = draft.index === null ? null : (rules[draft.index] ?? null);
  if (draft.index === null) rules.push(rule);
  else rules[draft.index] = rule;
  void record(
    "rule",
    `${before === null ? "Added" : "Changed"} rule: ${rule.keyword ?? rule.account ?? "everything"} → ${rule.code}`,
    before,
    rule,
    String(index),
  );

  state.rules = { ...file, rules };
  state.ruleDraft = null;
  reclassify();
  void persistRules();
}

function deleteRule(index: number, rule: CategoryRule): void {
  if (
    !confirm(
      `Delete the rule coding "${rule.keyword ?? rule.account ?? "everything"}" to ${rule.code}?` +
        " Lines already confirmed keep their coding; unconfirmed ones lose this suggestion.",
    )
  ) {
    return;
  }
  const file = state.rules as RuleFileShape | undefined;
  if (!file) return;
  const rules = [...(file.rules ?? [])];
  const removed = rules[index] ?? null;
  rules.splice(index, 1);
  void record(
    "rule",
    `Deleted rule: ${rule.keyword ?? rule.account ?? "everything"} → ${rule.code}`,
    removed,
    null,
    String(index),
  );
  state.rules = { ...file, rules };
  state.ruleDraft = null;
  reclassify();
  void persistRules();
}

async function persistRules(): Promise<void> {
  const file = state.rules as RuleFileShape | undefined;
  if (!file) return;
  await saveRules({
    version: 1,
    name: state.rulesName,
    loadedAt: state.rulesLoadedAt,
    rules: file,
  });
  state.rulesDirty = false;
  if (state.page === "rules") renderRules();
}

/**
 * Write the rule set out as JSON.
 *
 * Rules edited here would otherwise live only in one browser profile, where
 * they cannot be backed up, reviewed in a diff, or moved to the command line.
 */
function downloadRules(): void {
  const file = state.rules as RuleFileShape | undefined;
  if (!file) return;
  download(
    `${JSON.stringify(file, null, 2)}\n`,
    state.rulesName || "rules.json",
    "application/json",
  );
}

/** Hand a generated file to the browser to save. */
function download(text: string, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Which bank accounts serve which entities.
 *
 * A column per entity, so with none defined there is no grid to draw -- which
 * is why the caller skips it rather than rendering an empty one.
 */
function bankTable(model: EntityModel): HTMLElement {
  const accounts = [...new Set(state.ledger.transactions.map((t) => t.account))].sort();
  const bankTable = document.createElement("table");
  bankTable.className = "entity-table";
  const bankHead = document.createElement("thead");
  bankHead.innerHTML =
    "<tr><th>Bank account</th>" +
    model.entities.map((e) => `<th>${escapeHtml(e.name)}</th>`).join("") +
    "</tr>";
  const bankBody = document.createElement("tbody");

  for (const account of accounts) {
    const tr = document.createElement("tr");
    const label = document.createElement("td");
    label.className = "entity-left";
    const named = state.ledger.transactions.find((t) => t.account === account)?.extras?.[
      "accountLabel"
    ];
    label.textContent = named !== undefined ? `${named} (${account})` : account;
    tr.append(label);

    for (const entity of model.entities) {
      const cell = document.createElement("td");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = (model.banks[account] ?? []).includes(entity.id);
      box.addEventListener("change", () => {
        // Read the model as it is now, not as it was when this row was drawn.
        // Two changes made before the redraw would otherwise see the same
        // starting point and the second would silently undo the first.
        const live = state.ledger.entities ?? emptyEntityModel();
        const current = new Set(live.banks[account] ?? []);
        if (box.checked) current.add(entity.id);
        else current.delete(entity.id);
        const banks = { ...live.banks };
        if (current.size === 0) delete banks[account];
        else banks[account] = [...current];
        void saveEntities({ ...live, banks });
      });
      cell.append(box);
      tr.append(cell);
    }
    bankBody.append(tr);
  }
  bankTable.append(bankHead, bankBody);
  return bankTable;

}

/**
 * Entities, and what belongs to each.
 *
 * The chart is the source of truth for what accounts exist, so this page can
 * only assign what has been loaded on the Coding reconciliation page. Saying so is
 * better than showing an empty table that looks broken.
 */
/**
 * Opening balances: what each account stood at before this ledger begins.
 *
 * The figures a set of books inherits. Without them every balance is only the
 * movement since the first bank line, which is not a smaller answer than the
 * right one -- it is a different and wrong one, and it looks just as tidy.
 *
 * Entered by hand or read from a trial balance, and refused if they do not sum
 * to nothing. That refusal is the point: a trial balance that does not balance
 * is not a set of opening balances, and accepting one would put the error
 * inside every report that follows and leave nothing to find it by.
 */
function renderOpeningBalances(): void {
  const body = $("opening-body");
  body.textContent = "";

  const held = state.ledger.openingBalances;
  const money = (cents: Cents): string =>
    (cents / 100).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const add = document.createElement("button");
  add.type = "button";
  add.className = "link-button";
  add.textContent = "add an account";
  add.addEventListener("click", () => openingRow("", 0));

  if (held === undefined) {
    body.append(
      note(
        "None set. That is right for a ledger starting at the beginning of the company: " +
          "everything it has ever done is in the transactions. It is wrong for one starting " +
          "partway through, and the balance sheet will say so.",
      ),
    );
    body.append(add);
    return;
  }

  const entries = Object.entries(held.accounts).sort(([a], [b]) => a.localeCompare(b));
  const total = entries.reduce((sum, [, cents]) => sum + cents, 0);

  const summary = document.createElement("p");
  summary.className = total === 0 ? "journal-balanced" : "journal-out";
  summary.textContent =
    total === 0
      ? `Balanced. ${entries.length} accounts as at ${held.asAt}, debits equal credits.`
      : `Out of balance by ${money(total)}. These are not opening balances until they sum ` +
        "to nothing, and every report built on them carries the difference.";
  body.append(summary);

  if (held.source !== undefined && held.source !== "") body.append(note(held.source));

  const table = document.createElement("table");
  table.className = "report-table opening-table";
  const head = document.createElement("thead");
  head.innerHTML = "<tr><th>Account</th><th>Debit</th><th>Credit</th><th></th></tr>";
  const tbody = document.createElement("tbody");

  const byCode = new Map(state.chart.map((a) => [a.code, a]));
  const labels = new Map<string, string>();
  for (const transaction of state.ledger.transactions) {
    const label = String(transaction.extras?.["accountLabel"] ?? "").trim();
    if (label !== "") labels.set(transaction.account, label);
  }

  for (const [code, cents] of entries) {
    const row = document.createElement("tr");
    const account = byCode.get(code);
    const bank = labels.get(code);
    row.append(nameCell(account ? `${code} ${account.name}` : (bank ?? code)));
    // Debits and credits in their own columns, the way a trial balance is
    // written. One signed column reads as a mistake to anybody used to the
    // other, and this is a page an accountant will check.
    row.append(amountCell(cents > 0 ? money(cents) : ""));
    row.append(amountCell(cents < 0 ? money(-cents) : ""));

    const actions = document.createElement("td");
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "link-button";
    edit.textContent = "edit";
    edit.addEventListener("click", () => openingRow(code, cents));
    actions.append(edit);
    row.append(actions);
    tbody.append(row);
  }

  const sum = document.createElement("tr");
  sum.className = "bs-grand";
  sum.append(nameCell("Total"));
  sum.append(amountCell(money(entries.reduce((s, [, c]) => s + (c > 0 ? c : 0), 0))));
  sum.append(amountCell(money(entries.reduce((s, [, c]) => s + (c < 0 ? -c : 0), 0))));
  sum.append(document.createElement("td"));
  tbody.append(sum);

  table.append(head, tbody);
  body.append(table);
  body.append(add);
}

/** Add or change one opening balance. */
function openingRow(code: string, cents: Cents): void {
  const held = state.ledger.openingBalances;
  const asAt = held?.asAt ?? `${new Date().getFullYear()}-04-01`;
  const which = window.prompt("Account code, or a bank account number", code);
  if (which === null || which.trim() === "") return;
  const amount = window.prompt(
    `Balance for ${which.trim()} as at ${asAt}.\n\n` +
      "Debit positive, credit negative: an asset is positive, a liability negative.",
    (cents / 100).toFixed(2),
  );
  if (amount === null) return;
  const parsed = parseAmount(amount.trim());
  if (parsed === null) {
    alert(`"${amount}" is not an amount.`);
    return;
  }
  void saveOpeningBalance(which.trim(), parsed, code);
}

async function saveOpeningBalance(code: string, cents: Cents, replacing: string): Promise<void> {
  const held = state.ledger.openingBalances;
  const accounts = { ...(held?.accounts ?? {}) };
  // Renaming an account is a move, not a copy. Leaving the old key would state
  // the same balance twice and put the sheet out by its own size.
  if (replacing !== "" && replacing !== code) delete accounts[replacing];
  if (cents === 0) delete accounts[code];
  else accounts[code] = cents;

  const before = held ?? null;
  const openingBalances: OpeningBalances = {
    asAt: held?.asAt ?? `${new Date().getFullYear()}-04-01`,
    ...(held?.source ? { source: held.source } : {}),
    accounts,
  };
  state.ledger = { ...state.ledger, openingBalances };
  state.persistent = await savePart(state.ledger);
  await record(
    "openingBalance",
    `Opening balance for ${code} set to ${(cents / 100).toFixed(2)}`,
    before,
    openingBalances,
    code,
  );
  renderOpeningBalances();
}

/** The day after an ISO date, so a year end becomes the day a ledger opens. */
function dayAfter(date: IsoDate): IsoDate {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + 1);
  return at.toISOString().slice(0, 10);
}

/** Read a trial balance and take one of its columns as the opening position. */
async function loadOpeningBalances(file: File): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const text = await asCsvText(file.name, bytes);
  const parsed = parseTrialBalance(text);
  if (parsed.accounts.length === 0) {
    alert(
      `${file.name} is not a trial balance. Export one from Xero as ` +
        "Accounting > Reports > Trial Balance, dated the year end this ledger opens after.",
    );
    return;
  }
  if (parsed.dates.length === 0) {
    alert(`${file.name} has no balance columns, only movements.`);
    return;
  }

  // Which column. A trial balance carries the report's own date and the years
  // before it, and the one wanted is the year end this ledger opens after --
  // usually not the first, so it is asked rather than assumed.
  const dates = parsed.dates;
  const chosen =
    dates.length === 1
      ? dates[0]
      : window.prompt(
          "Which column? The ledger opens the day after the date you pick.\n\n" + dates.join("\n"),
          dates[dates.length - 1] ?? dates[0],
        );
  if (chosen === null || chosen === undefined || !dates.includes(chosen)) return;

  // A bank account has no chart code: the export names it and this ledger
  // numbers it. Matched on the label the bank import already recorded.
  const banks = new Map<string, string>();
  for (const transaction of state.ledger.transactions) {
    const label = String(transaction.extras?.["accountLabel"] ?? "").trim();
    if (label !== "") banks.set(label.toLowerCase(), transaction.account);
  }

  const built = openingBalancesFrom(parsed, chosen, {
    bankAccountFor: (name) => banks.get(name.trim().toLowerCase()),
  });
  const accounts = built.balances.accounts;
  const total = Object.values(accounts).reduce((sum, c) => sum + c, 0);
  const money = (cents: number): string => (cents / 100).toFixed(2);
  const unknown = Object.keys(accounts).filter(
    (code) =>
      !state.chart.some((a) => a.code === code) &&
      !state.ledger.transactions.some((t) => t.account === code),
  );

  // Everything worth objecting to, before anything is written. Loading figures
  // that do not balance is allowed -- the page will keep saying so -- but it
  // should never happen without being read first.
  const ok = confirm(
    `${Object.keys(accounts).length} accounts as at ${chosen}, from ${file.name}.\n\n` +
      `They sum to ${money(total)}${total === 0 ? " - balanced." : " - NOT balanced."}\n` +
      `Retained earnings ${built.retainedEarningsGiven ? "given as" : "derived as"} ` +
      `${money(built.retainedEarnings)}.\n` +
      `${built.skipped.length} revenue and expense accounts left out, since a new year starts ` +
      "them at nothing.\n" +
      (unknown.length > 0
        ? `\nNot recognised: ${unknown.slice(0, 5).join(", ")}${unknown.length > 5 ? ", and more" : ""}\n`
        : "") +
      "\nThis replaces whatever opening balances are held now.",
  );
  if (!ok) return;

  const before = state.ledger.openingBalances ?? null;
  const openingBalances: OpeningBalances = {
    accounts,
    asAt: dayAfter(chosen),
    source: `${file.name}, ${chosen} column`,
  };
  state.ledger = { ...state.ledger, openingBalances };
  state.persistent = await savePart(state.ledger);
  await record(
    "openingBalance",
    `Opening balances from ${file.name}: ${Object.keys(accounts).length} accounts as at ${chosen}`,
    before,
    openingBalances,
    "opening",
  );
  renderOpeningBalances();
  renderEntities();
}

function renderEntities(): void {
  const body = $("entities-body");
  body.textContent = "";
  const model = state.ledger.entities ?? emptyEntityModel();

  const list = document.createElement("div");
  list.className = "entity-list";
  if (model.entities.length === 0) {
    list.append(
      note(
        "No entities, which is right for one company or one set of books: leave this " +
          "empty and every report covers everything. Add one above only if you keep " +
          "several things in one ledger -- a company and two rental properties, say -- " +
          "and want a separate profit figure for each.",
      ),
    );
  }
  for (const entity of model.entities) {
    const row = document.createElement("div");
    row.className = "entity-chip";

    // Still called by the placeholder name. Marked on the row itself rather
    // than shown once as a first-visit bubble: a bubble needs somewhere to
    // remember it has been seen, and is gone for good if it was dismissed by
    // somebody not ready to act on it. This clears itself the moment the
    // entity is renamed, which is exactly when it stops being true -- and it
    // is the same fact the Setup page counts as this step being done.
    const unnamed = entity.name === DEFAULT_ENTITY_NAME;
    if (unnamed) row.classList.add("needs-name");

    const name = document.createElement("span");
    const coverage = entityCoverage(model, state.chart);
    const count = coverage.byEntity.get(entity.id) ?? 0;
    const banks = Object.entries(model.banks).filter(([, ids]) => ids.includes(entity.id)).length;
    name.textContent =
      `${entity.name} — ${count} account${count === 1 ? "" : "s"}, ` +
      `${banks} bank account${banks === 1 ? "" : "s"}`;

    if (unnamed) {
      const hint = document.createElement("span");
      hint.className = "entity-rename-hint";
      hint.textContent =
        "Rename this to your company, trust or your own name — it is the one " +
        "thing these books cannot work out for themselves.";
      name.append(hint);
    }

    // Ownership decides whose tax return a rental's profit reaches, so it is
    // edited beside the entity rather than buried in a file.
    const ownersWrap = document.createElement("div");
    ownersWrap.className = "entity-owners-wrap";
    const owners = document.createElement("input");
    owners.type = "text";
    owners.className = "entity-owners";
    owners.placeholder = "Owners, e.g. Ana Whitcombe 50%, Tom Whitcombe 50%";
    owners.value = formatOwners(entity.owners ?? []);
    owners.title =
      "Names and shares. Separate them with a comma, a semicolon or the word " +
      "'and'. Shares should total 100%.";

    // What it understood, said back.
    //
    // The parsing is forgiving and therefore capable of being forgiving in the
    // wrong direction -- reading two owners as one, or a name as a share. That
    // used to happen silently, and a wrong share reaches somebody's return
    // looking exactly like a right one. So the reading is shown, and the total
    // with it: there has been a check that shares add to 100 since entities
    // existed, and nothing ever called it.
    const said = document.createElement("span");
    said.className = "entity-owners-said";
    const sayOwners = (text: string): void => {
      const parsed = parseOwners(text);
      const total = ownersTotal(parsed);
      said.textContent = total.said;
      said.classList.toggle("owners-wrong", !total.ok);
      said.title = total.ok
        ? "How this was read."
        : "Shares that do not total 100% mean somebody's income is unreported, or reported twice.";
    };
    sayOwners(owners.value);

    owners.addEventListener("input", () => sayOwners(owners.value));
    owners.addEventListener("change", () => {
      const live = state.ledger.entities ?? emptyEntityModel();
      void saveEntities({
        ...live,
        entities: live.entities.map((e) =>
          e.id === entity.id ? { ...e, owners: parseOwners(owners.value) } : e,
        ),
      });
    });
    ownersWrap.append(owners, said);

    const kind = document.createElement("select");
    for (const [value, caption] of [
      ["business", "Business"],
      ["residential", "Residential rental"],
      ["commercial", "Commercial rental"],
      ["personal", "Personal"],
    ] as const) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = caption;
      option.selected = (entity.kind ?? "business") === value;
      kind.append(option);
    }
    kind.title = "Residential rental losses are ring-fenced; the others are not.";
    kind.addEventListener("change", () => {
      const live = state.ledger.entities ?? emptyEntityModel();
      void saveEntities({
        ...live,
        entities: live.entities.map((e) =>
          e.id === entity.id ? { ...e, kind: kind.value as EntityKind } : e,
        ),
      });
    });

    // Registration decides whether this entity's own reports are net of GST,
    // so it lives beside the entity rather than as a switch on the report:
    // one ledger can hold a registered company and an unregistered rental,
    // and the report cannot be both at once for both of them.
    const gstWrap = document.createElement("label");
    gstWrap.className = "entity-gst";
    const gstBox = document.createElement("input");
    gstBox.type = "checkbox";
    gstBox.checked = reportsNetOfGst(entity);
    gstWrap.title =
      "Registered: GST is collected for Inland Revenue, so it belongs in neither " +
      "income nor expenses and reports are net of it. Not registered: the GST paid " +
      "is part of what things cost, and reports include it.";
    gstWrap.append(gstBox, document.createTextNode(" GST registered"));
    gstBox.addEventListener("change", () => {
      const live = state.ledger.entities ?? emptyEntityModel();
      void saveEntities(
        {
          ...live,
          entities: live.entities.map((e) =>
            e.id === entity.id ? { ...e, gstRegistered: gstBox.checked } : e,
          ),
        },
        `${entity.name} ${gstBox.checked ? "is" : "is not"} GST registered`,
      );
    });

    const rename = document.createElement("button");
    rename.type = "button";
    rename.textContent = "Rename";
    rename.addEventListener("click", () => {
      const next = prompt("Name for this entity", entity.name);
      if (next === null || next.trim() === "") return;
      void saveEntities({
        ...model,
        entities: model.entities.map((e) =>
          e.id === entity.id ? { ...e, name: next.trim() } : e,
        ),
      });
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => {
      if (!confirm(`Delete "${entity.name}"? Everything assigned to it becomes unassigned.`)) {
        return;
      }
      // Assignments pointing at a deleted entity are removed rather than left
      // dangling: a mapping to something that no longer exists would drop out
      // of a per-entity total silently.
      const accounts: Record<string, string> = {};
      for (const [code, id] of Object.entries(model.accounts)) {
        if (id !== entity.id) accounts[code] = id;
      }
      const banks: Record<string, string[]> = {};
      for (const [account, ids] of Object.entries(model.banks)) {
        const kept = ids.filter((id) => id !== entity.id);
        if (kept.length > 0) banks[account] = kept;
      }
      void saveEntities({
        entities: model.entities.filter((e) => e.id !== entity.id),
        accounts,
        banks,
      });
    });

    row.append(name, ownersWrap, kind, gstWrap, rename, remove);

    // What goes at the top of an invoice you send somebody. Nothing else in
    // these books knows any of it, and without it an invoice cannot be sent:
    // one over $200 has to carry the supplier's GST number, and a customer
    // needs somewhere to pay.
    // Collapsed by default. These three are wanted once, when an invoice is
    // first sent, and never looked at again -- but they were open on every
    // entity for ever, and each one costs a full-width row with a two-line
    // address box in it. On a ledger with a few entities that pushed the
    // opening balances, which this page also holds, off the bottom of the
    // screen entirely. The summary counts what is still empty, so collapsing
    // them does not hide that they are missing.
    const billingDetails = document.createElement("details");
    billingDetails.className = "entity-billing-details";
    const billingSummary = document.createElement("summary");
    const missing = (["gstNumber", "address", "payTo"] as const).filter(
      (field) => (entity[field] ?? "").trim() === "",
    ).length;
    billingSummary.textContent =
      missing === 0 ? "Invoice details" : `Invoice details — ${missing} of 3 not filled in`;
    billingSummary.title =
      "The GST number, address and bank account that go at the top of an invoice you " +
      "send. An invoice over $200 has to carry the GST number.";
    billingDetails.append(billingSummary);

    const billing = document.createElement("div");
    billing.className = "entity-billing";
    for (const [key, label, hint, wide] of [
      ["gstNumber", "GST number", "123-456-789", false],
      ["address", "Address", "12 Example Street, Nelson 7010", true],
      ["payTo", "Payment", "02-1234-0567890-000", true],
    ] as const) {
      const wrap = document.createElement("label");
      wrap.className = "entity-billing-field";
      const caption = document.createElement("span");
      caption.textContent = label;
      const input = key === "address"
        ? document.createElement("textarea")
        : document.createElement("input");
      if (input instanceof HTMLTextAreaElement) input.rows = 2;
      input.value = entity[key] ?? "";
      input.placeholder = hint;
      if (wide) wrap.classList.add("wide");
      input.addEventListener("change", () => {
        const live = state.ledger.entities ?? emptyEntityModel();
        const value = input.value.trim();
        void saveEntities({
          ...live,
          entities: live.entities.map((e) => {
            if (e.id !== entity.id) return e;
            const { [key]: _drop, ...rest } = e;
            return value === "" ? rest : { ...rest, [key]: value };
          }),
        });
      });
      wrap.append(caption, input);
      billing.append(wrap);
    }
    billingDetails.append(billing);
    row.append(billingDetails);
    list.append(row);
  }
  body.append(list);
  // Built here rather than moved here. It used to live in the markup and be
  // moved into this container, which worked exactly once: the next render
  // begins by emptying the container, so the element was destroyed and every
  // render after the first threw looking for it -- taking the bank section and
  // the whole accounts table down with it, and making a chart that had loaded
  // look like a chart that had not.
  body.append(addEntityForm());

  // --- bank accounts ---
  if (model.entities.length > 0) {
    const bankHeading = document.createElement("h3");
    bankHeading.textContent = "Bank accounts";
    body.append(bankHeading);
    body.append(
      note("A bank account can serve several entities. Tick every one it pays for."),
    );
    body.append(bankTable(model));
  }

  // Bank rows in a chart carry no account number, so nothing can tell which
  // of the ledger's bank accounts each one is -- and until somebody says, the
  // reports cannot put a payment on the right entity. The control for it is a
  // column in the accounts table below, which on a chart of sixty-six accounts
  // is not somewhere anybody looks. So the count is said up here, where the
  // rest of the setting up is.
  const unlinked = accountsForEditing().filter(
    ({ account }) =>
      account.type.trim().toLowerCase() === "bank" &&
      account.ledgerAccount === undefined &&
      ledgerAccountFor(account.name, account) === null,
  );
  if (unlinked.length > 0) {
    const say = document.createElement("p");
    say.className = "needs-linking";
    say.textContent =
      `${unlinked.length} bank account${unlinked.length === 1 ? "" : "s"} in the chart ` +
      `${unlinked.length === 1 ? "is" : "are"} not yet linked to an account in this ` +
      "ledger: " +
      unlinked.map(({ account }) => account.name).join(", ") +
      ". Set each one under “Entity, or which account” in the table below.";
    body.append(say);
  }

  // --- accounts ---
  const chartHeading = document.createElement("h3");
  chartHeading.textContent = "Accounts";
  body.append(chartHeading);

  const accountRows = accountsForEditing();
  if (accountRows.length === 0) {
    body.append(
      note(
        "No accounts yet. Load a chart of accounts with the button above, or add one below. " +
          "Accounts also appear here once a rule or a GST treatment names them.",
      ),
    );
  } else {
    const coverage = entityCoverage(model, accountRows.map((r) => r.account));
    const untreated = accountRows.filter((r) => treatmentOf(r.label) === null).length;
    // "0 assigned to an entity" on books that have no entities reads as a job
    // half done, and most books are one entity and will never have any. The
    // count is worth saying once there is something to be assigned to.
    const entityPart =
      model.entities.length === 0
        ? ""
        : `, ${coverage.assigned} assigned to an entity`;
    body.append(
      note(
        `${accountRows.length} accounts${entityPart}` +
          (untreated > 0 ? `, ${untreated} with no GST treatment set` : "") +
          (model.entities.length === 0 ? "." : ". An account belongs to one entity only."),
      ),
    );
  }

  const addRow = document.createElement("div");
  addRow.className = "account-add";
  const newCode = document.createElement("input");
  newCode.type = "text";
  newCode.placeholder = "Code, e.g. 424";
  newCode.required = true;
  const newName = document.createElement("input");
  newName.type = "text";
  newName.placeholder = "Name, e.g. Entertainment - Non deductible";
  const addAccount = document.createElement("button");
  addAccount.type = "button";
  addAccount.textContent = "Add account";
  addAccount.addEventListener("click", () => {
    const code = newCode.value.trim();
    const name = newName.value.trim();
    if (name === "") return;
    // A code, the same as when one is edited. It is what survives a rename:
    // the entity assignment, the reports and the chart's own tax code all find
    // an account again by its number, and an account with only a name can be
    // found only by the thing most likely to change.
    const wrong = renameProblem(state.chart, { code: "", name: "" }, { code, name });
    if (wrong !== null) {
      alert(wrong);
      return;
    }
    // Named the way this ledger already names accounts, so a code chosen here
    // is the same string the coding picker offers.
    //
    // Which is not one fixed way. One chart puts "NB" in front of every
    // account name -- a house convention of that chart's, nothing to do with
    // accounting -- and this wrote it into every account anybody added, so a
    // person starting from their own bank data got a stranger's prefix on
    // their books with no way to know where it came from. Followed where the
    // ledger already uses it, and not invented where it does not.
    const housePrefixed = accountRows.some((r) => /^NB\s+/i.test(r.label));
    const label = accountLabel(code, name, housePrefixed);
    if (accountRows.some((r) => r.label === label)) {
      alert(`"${label}" already exists.`);
      return;
    }
    newCode.value = "";
    newName.value = "";
    setTreatment(label, "15");
  });
  addRow.append(newCode, newName, addAccount);
  body.append(addRow);

  if (accountRows.length === 0) return;

  const chartTable = document.createElement("table");
  chartTable.className = "entity-table accounts-table";
  const chartHead = document.createElement("thead");
  chartHead.innerHTML =
    "<tr><th>Code</th><th>Name</th><th>Type</th><th>GST</th>" +
    "<th>Entity, or which account</th><th></th></tr>";
  const chartBody = document.createElement("tbody");

  for (const { account, label } of accountRows) {
    const tr = document.createElement("tr");

    // Code and name are editable in place. A dialog would be tidier to build
    // and worse to use: the whole reason to change a code is that you can see
    // the ones around it, and a dialog covers them up.
    const codeCell = document.createElement("td");
    const nameCell = document.createElement("td");
    codeCell.className = "entity-left";
    nameCell.className = "entity-left";
    codeCell.textContent = account.code;
    nameCell.textContent = account.name;
    tr.append(codeCell, nameCell);

    // The type decides whether an account is income, an expense, or neither.
    // Chart accounts arrive with Xero's; accounts that exist only as a rule
    // have none, and a profit figure cannot be built until they do.
    const typeCell = document.createElement("td");
    typeCell.className = "entity-left";
    const typeSelect = document.createElement("select");
    for (const [value, caption] of ACCOUNT_TYPES) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = caption;
      option.selected = value === account.type;
      typeSelect.append(option);
    }
    // A type the picker does not offer -- Xero has more of them than a profit
    // and loss needs -- is kept as its own option rather than lost, and only
    // called out when nothing can place it.
    const placeable = isKnownType(account.type);
    if (account.type !== "" && !ACCOUNT_TYPES.some(([v]) => v === account.type)) {
      const option = document.createElement("option");
      option.value = account.type;
      option.textContent = account.type + (placeable ? "" : " (not recognised)");
      option.selected = true;
      typeSelect.append(option);
    }
    // Amber means "no report can place this", not "this is not income".
    // Accounts Receivable and Inventory are balance-sheet accounts doing
    // exactly what they should, and colouring them as problems taught people
    // to ignore the colour, which is worse than not having it.
    if (!placeable) typeSelect.className = "type-unset";
    typeSelect.addEventListener("change", () => {
      void setAccountType(account, label, typeSelect.value);
    });
    typeCell.append(typeSelect);
    tr.append(typeCell);

    // GST treatment. This is the value the returns actually use, so an account
    // with none is called out rather than defaulted quietly.
    //
    // Except on a bank account, which has none to set. Money moving into or
    // out of your own account is not a supply: the treatment belongs to the
    // income or expense code the other side of it was coded to. Asking for
    // one here put an amber "not set" against every bank account in the
    // chart, which was a job that could never be finished.
    const isBankAccount = account.type === "Bank";
    const gstCell = document.createElement("td");
    if (isBankAccount) {
      const none = document.createElement("span");
      none.className = "cell-not-applicable";
      none.textContent = "—";
      none.title = "A bank account has no GST treatment: moving your own money is not a supply.";
      gstCell.append(none);
      tr.append(gstCell);
    } else {
    const gst = document.createElement("select");
    const current = treatmentOf(label);
    const fromChart =
      current !== null &&
      ((state.rules as RuleFileShape | undefined)?.codeTreatments ?? {})[label] === undefined;
    const unset = document.createElement("option");
    unset.value = "";
    unset.textContent = "-- not set --";
    unset.selected = current === null;
    gst.append(unset);
    for (const rate of GST_OPTIONS) {
      const option = document.createElement("option");
      option.value = rate.value;
      option.textContent = rate.label;
      option.title = rate.hint;
      option.selected = current === rate.value;
      gst.append(option);
    }
    if (current !== null && !GST_OPTIONS.some((r) => r.value === current)) {
      // A treatment this picker cannot express -- half-deductible
      // entertainment, for instance -- is shown and left alone rather than
      // being flattened by the act of looking at it.
      const option = document.createElement("option");
      option.value = current;
      option.textContent = current;
      option.selected = true;
      gst.append(option);
    }
    if (current === null) gst.className = "gst-unset";
    else if (fromChart) {
      // Shown as what it is: the chart's own tax code, not a decision taken
      // here. Choosing anything writes a real treatment and the mark goes.
      gst.className = "gst-from-chart";
      gst.title = `From the chart: ${account.taxCode}`;
    }
    gst.addEventListener("change", () => setTreatment(label, gst.value));
    gstCell.append(gst);
    tr.append(gstCell);
    }

    // --- Which entity it belongs to. ---
    //
    // Two controls used to write this, and they could not agree. A chart
    // account belongs to one entity and is set here; a bank account may serve
    // several -- one current account pays the rates on two properties and the
    // company's suppliers -- and is set in the entity list above, which is
    // the only one of the two that can say "both". They were even keyed
    // differently, so assigning a bank account above left this reading
    // "unassigned" for ever. There is now one place to set it, and this shows
    // what it says.
    const cell = document.createElement("td");
    if (isBankAccount) {
      // Not which entity -- that is set above, where a bank account can serve
      // several -- but which account in this ledger this row *is*.
      //
      // A chart brings bank accounts with it, under the names the other system
      // used. Import the transactions and the same accounts arrive again under
      // the names the bank issues, and now one card is two rows: one with a
      // name and no money, one with money and no name. Nothing can safely join
      // them by their words, so this asks the one person who knows, once.
      const id = ledgerAccountFor(account.name, account);
      const link = document.createElement("select");
      link.className = "bank-link";

      const unsaid = document.createElement("option");
      unsaid.value = "";
      unsaid.textContent = "— which account is this? —";
      unsaid.selected = account.ledgerAccount === undefined && id === null;
      link.append(unsaid);

      const { accounts: held, labels } = banks();
      for (const bank of [...held].sort()) {
        const option = document.createElement("option");
        option.value = bank;
        const label = labels.get(bank);
        option.textContent = label !== undefined && label !== bank ? `${label} (${bank})` : bank;
        option.selected = bank === id;
        link.append(option);
      }

      const none = document.createElement("option");
      none.value = NOT_IN_LEDGER;
      none.textContent = "not in this ledger";
      none.selected = account.ledgerAccount === NOT_IN_LEDGER;
      link.append(none);

      link.title =
        "The account in this ledger that this chart row is. Set it and the two stop " +
        "being two accounts; say it is not in this ledger and it stops being asked about.";
      link.addEventListener("change", () => {
        void setLedgerAccount(account, link.value);
      });
      cell.append(link);

      // And, quietly beside it, which entities that account serves -- decided
      // above, shown here so the row is not half an answer.
      const serves = (id === null ? [] : (model.banks[id] ?? []))
        .map((entityId) => model.entities.find((e) => e.id === entityId)?.name)
        .filter((name): name is string => name !== undefined);
      if (serves.length > 0) {
        const shown = document.createElement("span");
        shown.className = "cell-said-elsewhere bank-serves";
        shown.textContent = serves.join(", ");
        shown.title = "Which entities it serves, set in the list above.";
        cell.append(shown);
      }

      tr.append(cell);
      tr.append(removalCell(account, label));
      chartBody.append(tr);
      continue;
    }
    const select = document.createElement("select");
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "-- unassigned --";
    select.append(blank);
    for (const entity of model.entities) {
      const option = document.createElement("option");
      option.value = entity.id;
      option.textContent = entity.name;
      option.selected = model.accounts[accountEntityKey(account)] === entity.id;
      select.append(option);
    }
    select.addEventListener("change", () => {
      const live = state.ledger.entities ?? emptyEntityModel();
      const accountsMap = { ...live.accounts };
      const key = accountEntityKey(account);
      if (select.value === "") delete accountsMap[key];
      else accountsMap[key] = select.value;
      void saveEntities({ ...live, accounts: accountsMap });
    });
    cell.append(select);
    tr.append(cell);

    // Edit is offered here and not on the bank rows above. A bank row's name
    // is the ledger's own account id -- the string every transaction on that
    // account carries -- so letting somebody type over it would detach the
    // account from its own transactions, which is not a rename.
    const actions = removalCell(account, label);
    actions.prepend(editCell({ code: codeCell, name: nameCell }, account, label));
    tr.append(actions);
    chartBody.append(tr);
  }
  chartTable.append(chartHead, chartBody);
  body.append(chartTable);
}

/**
 * Account types offered on the accounts page.
 *
 * Xero's own vocabulary, so a chart written here still reads as a Xero chart,
 * plus a blank for "not on the profit and loss at all" -- which is the right
 * answer for a bank account, a loan or drawings.
 */
const ACCOUNT_TYPES: readonly (readonly [string, string])[] = [
  ["", "-- not on the P&L --"],
  ["Revenue", "Revenue (income)"],
  ["Other Income", "Other Income"],
  ["Direct Costs", "Direct Costs (expense)"],
  ["Expense", "Expense"],
  ["Overhead", "Overhead (expense)"],
  ["Bank", "Bank"],
  ["Current Asset", "Current Asset"],
  ["Current Liability", "Current Liability"],
  ["Equity", "Equity"],
];

/**
 * Record which account in this ledger a chart's bank row is.
 *
 * Kept on the chart account, so it travels in the file with the rest of the
 * setup and survives a browser being cleared, the same way the entity
 * assignment and the GST treatment do.
 */
async function setLedgerAccount(account: Account, to: string): Promise<void> {
  const chart = [...state.chart];
  const index = chart.findIndex((a) => a.code === account.code && a.name === account.name);
  if (index < 0) return;
  const was = chart[index];
  if (!was) return;
  const { ledgerAccount: _drop, ...rest } = was;
  chart[index] = to === "" ? rest : { ...rest, ledgerAccount: to };

  state.chart = chart;
  state.ledger = { ...state.ledger, chart };
  state.persistent = await savePart(state.ledger, "chart");
  await record(
    "chart",
    to === ""
      ? `${account.name} is no longer linked to a ledger account`
      : to === NOT_IN_LEDGER
        ? `${account.name} is not an account this ledger holds`
        : `${account.name} is ${to}`,
    was,
    chart[index] ?? null,
    `${account.code}|${account.name}`,
  );
  renderEntities();
}

/**
 * A cell offering to take an account out of the chart.
 *
 * Charts arrive with accounts nobody here will ever use -- another system's
 * bank accounts, its clearing accounts, things belonging to a business that
 * was sold. Leaving them is not free: every one is a row to read past, a
 * candidate in every coding picker, and one more thing that looks unfinished.
 *
 * Refused rather than hidden where the account is in use, because deleting an
 * account something is coded to would leave those transactions pointing at
 * nothing, and a chart that disagrees with the codings is worse than a long one.
 */
/**
 * Turn an account's code and name into fields, and back again.
 *
 * In place rather than in a dialog: the reason somebody is changing a code is
 * usually that they can see the codes around it, and a dialog covers them up.
 *
 * Enter saves, Escape abandons -- both because a two-field edit that can only
 * be finished by aiming at a button is slower than the typing it follows.
 */
function editCell(
  cells: { code: HTMLTableCellElement; name: HTMLTableCellElement },
  account: Account,
  label: string,
): HTMLButtonElement {
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "row-edit";
  edit.textContent = "Edit";
  edit.title = "Change this account's code or name.";

  let editing = false;
  const stop = (): void => {
    editing = false;
    cells.code.textContent = account.code;
    cells.name.textContent = account.name;
    edit.textContent = "Edit";
  };

  edit.addEventListener("click", () => {
    if (editing) {
      const code = (cells.code.firstElementChild as HTMLInputElement | null)?.value ?? "";
      const name = (cells.name.firstElementChild as HTMLInputElement | null)?.value ?? "";
      void renameChartAccount(account, label, { code, name });
      return;
    }

    editing = true;
    edit.textContent = "Save";
    for (const [cell, value, width, placeholder] of [
      [cells.code, account.code, "5em", "Code"],
      [cells.name, account.name, "14em", "Name"],
    ] as const) {
      const input = document.createElement("input");
      input.type = "text";
      input.value = value;
      input.placeholder = placeholder;
      input.style.width = width;
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") edit.click();
        if (event.key === "Escape") stop();
      });
      cell.textContent = "";
      cell.append(input);
    }
    (cells.code.firstElementChild as HTMLInputElement | null)?.focus();
  });

  return edit;
}

function removalCell(account: Account, label: string): HTMLTableCellElement {
  const cell = document.createElement("td");
  const coded = codedToEach().get(label) ?? 0;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "row-remove";
  button.textContent = "Remove";
  if (coded > 0) {
    button.disabled = true;
    button.title =
      `${coded} transaction${coded === 1 ? " is" : "s are"} coded to this account. ` +
      "Recode them first, or it would leave them pointing at nothing.";
  } else {
    button.title = "Take this account out of the chart.";
    button.addEventListener("click", () => {
      if (!confirm(`Remove "${account.name}" from the chart of accounts?`)) return;
      void removeChartAccount(account, label);
    });
  }
  cell.append(button);
  return cell;
}

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
let codedIndex:
  | { transactions: readonly Transaction[]; rules: unknown; counts: Map<string, number> }
  | undefined;

function codedToEach(): Map<string, number> {
  if (
    codedIndex !== undefined &&
    codedIndex.transactions === state.ledger.transactions &&
    codedIndex.rules === state.rules
  ) {
    return codedIndex.counts;
  }
  const rules = {
    ...((state.rules as RuleFileShape | undefined) ?? {}),
    overrides: state.ledger.overrides ?? {},
  } as RuleSet;
  const counts = new Map<string, number>();
  for (const line of state.ledger.transactions) {
    const { code } = categorise(line, rules);
    if (code) counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  codedIndex = { transactions: state.ledger.transactions, rules: state.rules, counts };
  return counts;
}

/** Take one account out of the chart, and out of everything keyed to it. */
async function removeChartAccount(account: Account, label: string): Promise<void> {
  const chart = state.chart.filter(
    (a) => !(a.code === account.code && a.name === account.name),
  );
  state.chart = chart;

  // The entity assignment goes with it: an assignment keyed to an account that
  // is gone is a row nothing will ever read and something will one day count.
  const model = state.ledger.entities ?? emptyEntityModel();
  const accounts = { ...model.accounts };
  delete accounts[accountEntityKey(account)];

  state.ledger = { ...state.ledger, chart, entities: { ...model, accounts } };
  state.persistent = await savePart(state.ledger, "chart", "entities");
  await record("chart", `${account.name} removed from the chart`, account, null, `${account.code}|${account.name}`);

  // And its GST treatment, which lives with the rules.
  const file = state.rules as RuleFileShape | undefined;
  if (file?.codeTreatments?.[label] !== undefined) {
    const codeTreatments = { ...file.codeTreatments };
    delete codeTreatments[label];
    state.rules = { ...file, codeTreatments } as RuleSet;
    await persistRules();
  }
  reclassify();
  renderEntities();
}

/**
 * Change an account's code or name, and everything that points at it.
 *
 * An account is stored in the chart and referred to everywhere else by a
 * label built from its code and name. Editing the chart row alone would leave
 * every transaction coded to a name no account has, its GST treatment
 * unfindable and its entity assignment keyed to a code nothing holds -- none
 * of which raises an error, and all of which quietly moves a return.
 *
 * So the whole move is worked out first, in the core where it can be tested,
 * and saved as one change. The user is told what came with it, because "also
 * moved 46 codings" is the part they would otherwise have to take on trust.
 */
async function renameChartAccount(
  account: Account,
  label: string,
  to: { code: string; name: string },
): Promise<void> {
  const why = renameProblem(state.chart, account, to);
  if (why !== null) {
    alert(why);
    return;
  }

  const code = to.code.trim();
  const name = to.name.trim();
  if (code === account.code && name === account.name) return;

  // Named the way this ledger already names accounts, so the new label is the
  // same string the coding picker will offer.
  const housePrefixed = accountsForEditing().some((r) => /^NB\s+/i.test(r.label));
  const newLabel = accountLabel(code, name, housePrefixed);
  if (newLabel !== label && accountsForEditing().some((r) => r.label === newLabel)) {
    alert(`"${newLabel}" already exists.`);
    return;
  }

  const model = state.ledger.entities ?? emptyEntityModel();
  const after = renameAccount(
    {
      chart: state.chart,
      overrides: state.ledger.overrides ?? {},
      splits: state.ledger.splits ?? {},
      rules: state.rules,
      accountEntities: model.accounts,
    },
    account,
    { code, name },
    label,
    newLabel,
  );

  state.chart = after.chart;
  state.ledger = {
    ...state.ledger,
    chart: after.chart,
    overrides: after.overrides,
    splits: after.splits,
    entities: { ...model, accounts: after.accountEntities },
  };
  // Saved whole rather than part by part: a rename moves the chart, the
  // codings, the splits and the entity assignment together, and a half-written
  // rename is the thing this function exists to prevent.
  state.persistent = await save(state.ledger);
  state.rules = after.rules;
  await persistRules();

  const { codings, splitParts, rules, treatment } = after.moved;
  const carried = [
    codings > 0 ? `${codings} coding${codings === 1 ? "" : "s"}` : "",
    splitParts > 0 ? `${splitParts} split part${splitParts === 1 ? "" : "s"}` : "",
    rules > 0 ? `${rules} rule${rules === 1 ? "" : "s"}` : "",
    treatment ? "its GST treatment" : "",
  ].filter((part) => part !== "");

  await record(
    "chart",
    `${label} renamed to ${newLabel}` +
      (carried.length > 0 ? `, carrying ${carried.join(", ")}` : ""),
    account,
    after.chart.find((a) => a.code === code && a.name === name) ?? null,
    `${account.code}|${account.name}`,
  );

  reclassify();
  renderEntities();
}

/**
 * Set an account's type, promoting it into the chart if it was only a rule.
 *
 * An account that exists solely as a coding rule has nowhere to keep a type.
 * Giving it one puts it in the chart, which is also what makes it survive a
 * reload and travel in the saved file.
 */
async function setAccountType(account: Account, label: string, type: string): Promise<void> {
  const chart = [...state.chart];
  const index = chart.findIndex((a) => a.code === account.code && a.name === account.name);
  if (index >= 0) {
    const existing = chart[index];
    if (existing) chart[index] = { ...existing, type };
  } else {
    chart.push({ ...account, type });
  }
  const wasAccount = index >= 0 ? (state.chart[index] ?? null) : null;
  state.chart = chart;
  state.ledger = { ...state.ledger, chart };
  state.persistent = await savePart(state.ledger, "chart");
  await record(
    "chart",
    `${account.code || account.name} type set to ${type === "" ? "not on the P&L" : type}`,
    wasAccount,
    chart[index >= 0 ? index : chart.length - 1] ?? null,
    `${account.code}|${account.name}`,
  );
  renderEntities();
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
interface AccountRow {
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
function accountsForEditing(): AccountRow[] {
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

/**
 * The treatment an account's own chart row implies, from its tax code.
 *
 * The chart already says how most accounts are treated -- it is the column the
 * accounting package it came from used to work out GST -- and reading it means
 * a freshly loaded chart arrives with its treatments rather than with ninety
 * rows saying "not set" and a day's work to fill them in.
 */
let chartTreatmentCache:
  | { chart: unknown; rules: unknown; ledger: unknown; map: Map<string, unknown> }
  | null = null;

function cachedChartTreatments(): Map<string, unknown> {
  // Built once and kept until one of the three things it derives from is
  // replaced. It is consulted per transaction, and rebuilding a ninety-row map
  // three thousand times is the difference between a report and a wait.
  // Identity is the key rather than a flag somebody has to remember to clear:
  // the chart, the rules and the ledger are all replaced wholesale, never
  // edited in place, so a stale cache cannot survive a change.
  if (
    chartTreatmentCache !== null &&
    chartTreatmentCache.chart === state.chart &&
    chartTreatmentCache.rules === state.rules &&
    chartTreatmentCache.ledger === state.ledger
  ) {
    return chartTreatmentCache.map;
  }

  // The map itself is core's; what stays here is the cache in front of it.
  const map: Map<string, unknown> = chartTreatments(
    state.chart,
    state.rules,
    state.ledger.overrides ?? {},
  );

  chartTreatmentCache = {
    chart: state.chart,
    rules: state.rules,
    ledger: state.ledger,
    map,
  };
  return map;
}

function chartTreatmentOf(label: string): unknown | null {
  return cachedChartTreatments().get(label) ?? null;
}

/**
 * The GST option this account's treatment corresponds to, or null if unset.
 *
 * A treatment set in this app wins; the chart's tax code is the default behind
 * it. Both are reported the same way, and `treatmentIsFromChart` says which,
 * so the page can show a default as a default.
 */
function treatmentOf(label: string): string | null {
  const file = state.rules as RuleFileShape | undefined;
  const value = (file?.codeTreatments ?? {})[label] ?? chartTreatmentOf(label) ?? undefined;
  if (value === undefined) return null;

  // Only "standard" is a rate this picker has a percentage for. Exempt and
  // zero-rated are neither 15% nor out of scope, and reporting them as 15%
  // would let looking at the page quietly change what they are.
  const rateFor = (treatment: string | undefined): string =>
    treatment === "out-of-scope" ? "0" : treatment === "standard" || treatment === undefined ? "15" : treatment;

  if (typeof value === "string") return rateFor(value);
  const shape = value as { treatment?: string; side?: string; deductiblePercent?: number };
  if (shape.side === "imports") return "100";
  if (shape.deductiblePercent !== undefined && shape.deductiblePercent !== 100) {
    return `${shape.deductiblePercent}% deductible`;
  }
  return rateFor(shape.treatment);
}

/**
 * Write a GST treatment for one account into the rule set.
 *
 * Started with none, if there are none. How an account is treated for GST is a
 * fact about the account, and having written no coding rules yet is no reason
 * to refuse to record it -- but the treatments are kept in the rule file, so
 * the page used to say "load a rule file first" to anybody who had not got one.
 * Which is everybody who starts from a bank feed rather than from another
 * accounting system, and they cannot get one: the rule file is something this
 * app writes, not something they have lying about.
 */
function setTreatment(label: string, rate: string): void {
  const file = (state.rules as RuleFileShape | undefined) ?? { rules: [] };
  if (state.rules === undefined) {
    state.rulesName = "rules.json";
    state.rulesLoadedAt = new Date().toISOString();
  }
  const codeTreatments = { ...(file.codeTreatments ?? {}) };
  const wasTreated = codeTreatments[label] ?? null;
  if (rate === "") delete codeTreatments[label];
  else if (rate === "0") codeTreatments[label] = "out-of-scope";
  else if (rate === "100") codeTreatments[label] = { treatment: "standard", side: "imports" };
  else if (rate === "15") codeTreatments[label] = "standard";
  else return; // a treatment this picker does not express: left as it was

  // RuleSet is the shape core consumes; the file carries GST fields alongside
  // it, which is why the app works in terms of RuleFileShape throughout.
  state.rules = { ...file, codeTreatments } as RuleSet;
  void record(
    "codeTreatment",
    `${label} GST set to ${rate === "" ? "not set" : rate + "%"}`,
    wasTreated,
    codeTreatments[label] ?? null,
    label,
  );
  reclassify();
  void persistRules().then(() => renderEntities());
}

/**
 * Everything the app loads for itself on startup.
 *
 * These live together in one folder — `data/` beside the app — rather than
 * scattered, because "which file is it reading?" should have one answer. Each
 * is optional: a missing file is not an error, it is a setup that has not been
 * done yet, and the page works without any of them.
 *
 * Nothing here overwrites work. Each entry says how to tell whether the app
 * already holds that kind of data, and loads only when it does not — so a file
 * you loaded by hand is never quietly replaced by the one on disk.
 */
interface StartupFile {
  file: string;
  what: string;
  /** True when the app already holds this, so the file is left alone. */
  have: () => boolean;
  /** Reads the file and returns what it found, or null if it held nothing. */
  load: (text: string) => Promise<string | null>;
}

function startupFiles(): StartupFile[] {
  return [
    {
      // First, because a ledger carries its own chart and coding decisions:
      // anything it brings makes the separate files below unnecessary.
      file: "ledger.json",
      what: "ledger",
      have: () => state.ledger.transactions.length > 0,
      load: async (text) => {
        const parsed = JSON.parse(text) as Partial<StoredLedger>;
        if (!Array.isArray(parsed.transactions) || parsed.transactions.length === 0) return null;
        state.ledger = { ...state.ledger, ...parsed, version: 1 };
        state.chart = state.ledger.chart ?? [];
        reclassify();
        state.persistent = await save(state.ledger);
        const decisions = Object.keys(parsed.overrides ?? {}).length;
        const matched = Object.keys(parsed.invoiceMatches ?? {}).length;
        return (
          `${parsed.transactions.length} transactions` +
          (decisions > 0 ? `, ${decisions} codings` : "") +
          (matched > 0 ? `, ${matched} invoice matches` : "")
        );
      },
    },
    {
      file: "rules.json",
      what: "coding rules",
      have: () => state.rules !== undefined,
      load: async (text) => {
        const incoming = JSON.parse(text) as RuleFileShape;
        if (!Array.isArray(incoming.rules) || incoming.rules.length === 0) return null;
        await useRules(incoming, "rules.json", "Loaded");
        return describeRules(incoming);
      },
    },
    {
      file: "chart-of-accounts.csv",
      what: "chart of accounts",
      have: () => state.chart.length > 0,
      load: async (text) => {
        const parsed = parseChartOfAccounts(text);
        if (parsed.accounts.length === 0) return null;
        state.chart = parsed.accounts;
        state.ledger = { ...state.ledger, chart: parsed.accounts };
        state.persistent = await save(state.ledger);
        await applyChartColumns(parsed.accounts);
        await tidyChart();
        return `${state.chart.length} accounts`;
      },
    },
    {
      file: "invoices.csv",
      what: "invoices",
      have: () => (state.ledger.invoices ?? []).length > 0,
      load: async (text) => {
        const parsed = parseXeroInvoices(text);
        if (parsed.invoices.length === 0) return null;
        state.ledger = { ...state.ledger, invoices: parsed.invoices };
        state.persistent = await save(state.ledger);
        return `${parsed.invoices.length} invoices`;
      },
    },
    {
      file: "allocations.csv",
      what: "payment allocations",
      have: () => (state.ledger.allocations ?? []).length > 0,
      load: async (text) => {
        const parsed = parseXeroAllocations(text);
        if (parsed.allocations.length === 0) return null;
        state.ledger = { ...state.ledger, allocations: parsed.allocations };
        state.persistent = await save(state.ledger);
        return `${parsed.allocations.length} allocations`;
      },
    },
    {
      file: "assets.csv",
      what: "fixed assets",
      have: () => (state.ledger.assets ?? []).length > 0,
      load: async (text) => {
        const parsed = parseFixedAssets(text);
        if (parsed.assets.length === 0) return null;
        state.ledger = { ...state.ledger, assets: parsed.assets };
        state.persistent = await save(state.ledger);
        return `${parsed.assets.length} assets`;
      },
    },
    {
      file: "journals.csv",
      what: "general ledger",
      have: () => (state.ledger.journals ?? []).length > 0,
      load: async (text) => {
        const parsed = parseXeroJournalReport(text);
        if (parsed.journals.length === 0) return null;
        state.ledger = { ...state.ledger, journals: parsed.journals };
        state.persistent = await save(state.ledger);
        return `${parsed.journals.length} journals`;
      },
    },
  ];
}

/**
 * Read the startup folder.
 *
 * Failures are quiet on purpose: the folder is optional, and an app that
 * refuses to start because an optional file is absent is worse than one that
 * starts empty. What did load is reported, so it is never a mystery.
 */
async function loadStartupFiles(folder = "data", replace = false): Promise<void> {
  const loaded: string[] = [];
  const problems: string[] = [];

  for (const entry of startupFiles()) {
    // `replace` is for a deliberate load, where the point is to overwrite.
    if (!replace && entry.have()) continue;
    try {
      const response = await fetch(`${folder}/${entry.file}`);
      if (!response.ok) continue;
      // Xero writes Windows-1252; a plain UTF-8 read mangles anything accented.
      const bytes = new Uint8Array(await response.arrayBuffer());
      let text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      if (text.includes("�")) text = new TextDecoder("windows-1252").decode(bytes);

      const found = await entry.load(text);
      if (found !== null) loaded.push(`${entry.what} (${found})`);
    } catch (error) {
      problems.push(`${entry.file}: ${(error as Error).message}`);
    }
  }

  state.startupMessage =
    loaded.length === 0
      ? ""
      : `Loaded from ${folder}/: ${loaded.join(", ")}.` +
        (problems.length > 0 ? ` Could not read ${problems.join("; ")}.` : "");
}

/**
 * Write the chart out, carrying the entity and GST columns.
 *
 * The chart is the natural home for both. An account's entity and its GST
 * treatment are facts about the account, and keeping them in one file means
 * they can be backed up, diffed and edited in a spreadsheet -- rather than
 * living only in one browser profile, which is where they were.
 */
function saveChart(): void {
  const model = state.ledger.entities ?? emptyEntityModel();
  const rows = accountsForEditing();
  if (rows.length === 0) {
    alert("There are no accounts to save yet. Load a chart of accounts first.");
    return;
  }

  const named = new Map(model.entities.map((e) => [e.id, e.name]));
  const file = state.rules as RuleFileShape | undefined;
  const treatments = file?.codeTreatments ?? {};

  // Bank accounts are written as their own rows, because which entities an
  // account pays for is exactly the kind of setup that should survive a
  // browser being cleared. They carry the ledger's own account id as the name,
  // which is what the mapping is keyed on.
  const bankRows: Account[] = [];
  for (const id of [...new Set(state.ledger.transactions.map((t) => t.account))].sort()) {
    const ids = model.banks[id] ?? [];
    const label = state.ledger.transactions.find((t) => t.account === id)?.extras?.[
      "accountLabel"
    ];
    bankRows.push({
      code: "",
      name: id,
      type: "Bank",
      taxCode: "",
      description: typeof label === "string" ? label : "",
      ...(ids.length > 0
        ? { entity: ids.map((e) => named.get(e) ?? e).join("; ") }
        : {}),
    });
  }

  const accounts: Account[] = rows.map(({ account, label }) => {
    const id = model.accounts[accountEntityKey(account)];
    const entity = model.entities.find((e) => e.id === id);
    const raw = treatments[label];
    return {
      ...account,
      ...(entity !== undefined ? { entity: entity.name } : {}),
      ...(raw !== undefined ? { gstTreatment: describeTreatment(raw) } : {}),
      ...(entity?.owners && entity.owners.length > 0
        ? { entityOwners: formatOwners(entity.owners) }
        : {}),
      ...(entity?.kind !== undefined ? { entityKind: entity.kind } : {}),
    };
  });

  download(
    formatChartOfAccounts([...accounts, ...bankRows]),
    "chart-of-accounts.csv",
    "text/csv",
  );
}

/** A stored treatment in the wording the chart file uses. */
function describeTreatment(raw: unknown): string {
  if (typeof raw === "string") return raw;
  const shape = raw as { treatment?: string; side?: string; deductiblePercent?: number };
  if (shape.side === "imports") return "imports";
  const percent = shape.deductiblePercent;
  const base = shape.treatment ?? "standard";
  return percent !== undefined && percent !== 100 ? `${base} ${percent}%` : base;
}

/** Turn the chart file's wording back into a stored treatment. */
function parseTreatment(text: string): unknown | null {
  const value = text.trim();
  if (value === "") return null;
  if (value === "imports") return { treatment: "standard", side: "imports" };
  const percent = /^(\S+)\s+(\d{1,3})%$/.exec(value);
  if (percent?.[1] && percent[2]) {
    return { treatment: percent[1], side: "purchases", deductiblePercent: Number(percent[2]) };
  }
  return value;
}

/**
 * Take the entity and GST columns from a loaded chart.
 *
 * Entities are matched by name and created when they are new, so a chart
 * written on one machine brings its entities with it rather than arriving with
 * every account pointing at nothing.
 */
async function applyChartColumns(chart: readonly Account[]): Promise<void> {
  // A plain accounting-package export carries no columns of ours, but its tax
  // codes are still worth reading: they are the same information, written by
  // whoever set the chart up.
  const carries = chart.some(
    (a) => a.entity !== undefined || a.gstTreatment !== undefined || a.taxCode !== "",
  );
  if (!carries) return;

  const model = state.ledger.entities ?? emptyEntityModel();
  const entities = [...model.entities];
  const accounts = { ...model.accounts };
  const byName = new Map(entities.map((e) => [e.name.toLowerCase(), e]));

  const file = state.rules as RuleFileShape | undefined;
  const codeTreatments = { ...(file?.codeTreatments ?? {}) };
  const known = knownCodes(state.rules, state.ledger.overrides ?? {});
  let treatmentsSet = 0;

  const ledgerAccounts = new Set(state.ledger.transactions.map((t) => t.account));
  const banks: Record<string, string[]> = Object.fromEntries(
    Object.entries(model.banks).map(([id, ids]) => [id, [...ids]]),
  );

  for (const account of chart) {
    // A bank-account row names a ledger account, and its entity column can
    // hold several: one current account often pays for more than one.
    if (account.type === "Bank" && ledgerAccounts.has(account.name.trim())) {
      const wanted = (account.entity ?? "")
        .split(";")
        .map((n) => n.trim())
        .filter((n) => n !== "");
      const ids: string[] = [];
      for (const name of wanted) {
        let entity = byName.get(name.toLowerCase());
        if (!entity) {
          entity = { id: entityId(name), name };
          entities.push(entity);
          byName.set(name.toLowerCase(), entity);
        }
        ids.push(entity.id);
      }
      if (ids.length > 0) banks[account.name.trim()] = ids;
      else delete banks[account.name.trim()];
      continue;
    }
    if (account.entity !== undefined && account.entity !== "") {
      let entity = byName.get(account.entity.toLowerCase());
      if (!entity) {
        entity = { id: entityId(account.entity), name: account.entity };
        entities.push(entity);
        byName.set(account.entity.toLowerCase(), entity);
      }
      // Ownership and kind are facts about the entity, repeated on each of its
      // accounts in the file. The first row carrying them wins.
      if (account.entityOwners !== undefined && (entity.owners ?? []).length === 0) {
        entity.owners = parseOwners(account.entityOwners);
      }
      if (account.entityKind !== undefined && entity.kind === undefined) {
        entity.kind = account.entityKind as EntityKind;
      }
      accounts[accountEntityKey(account)] = entity.id;
    }
    // Our own column first, then the file's tax code. One is a decision taken
    // in this app and the other is what the chart was set up with, so the
    // decision wins -- but an account with no decision is no longer left with
    // nothing when the file plainly says how it is treated.
    const label = labelForChartAccount(account, known);
    const own =
      account.gstTreatment !== undefined ? parseTreatment(account.gstTreatment) : null;
    const fromTaxCode = own === null ? accountTreatment(account) : null;

    if (own !== null) {
      codeTreatments[label] = own;
      treatmentsSet += 1;
    } else if (fromTaxCode !== null && codeTreatments[label] === undefined) {
      // Only where nothing has been said already: a treatment set by hand in
      // the rules is a later decision than the chart it was set against.
      codeTreatments[label] = fromTaxCode;
      treatmentsSet += 1;
    }
  }

  if (treatmentsSet > 0) {
    // Again without requiring one to exist first. A chart export carries how
    // every account is treated, and reading that and then throwing it away
    // because no rule file had been loaded left a new set of books with no GST
    // treatments at all -- and no way to tell, because the chart plainly had
    // them.
    if (state.rules === undefined) {
      state.rulesName = "rules.json";
      state.rulesLoadedAt = new Date().toISOString();
    }
    state.rules = { ...(file ?? { rules: [] }), codeTreatments } as RuleSet;
    state.rulesDirty = true;
    reclassify();
    void persistRules();
  }
  state.ledger = { ...state.ledger, entities: { ...model, entities, accounts, banks } };
  state.persistent = await save(state.ledger);
}

/**
 * Record a change.
 *
 * Called beside the write, not instead of it: state remains the source of
 * truth and this is the log alongside. `before` is what makes it reversible,
 * so it has to be captured before the change is applied — a recorder that
 * reads current state has already lost the thing it needs.
 */
async function record(
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

/** Put one change back, ledger or rules depending on what it touched. */
async function undo(event: LedgerEvent): Promise<void> {
  const allowed = canReverse(state.events, event);
  if (!allowed.ok) {
    alert(allowed.why);
    return;
  }

  if (event.kind === "rule" || event.kind === "codeTreatment") {
    const file = state.rules as RuleFileShape | undefined;
    if (!file) return;
    state.rules = reverseRule(file, event) as RuleSet;
    await persistRules();
  } else {
    state.ledger = reverse(state.ledger, event);
    state.chart = state.ledger.chart ?? [];
    state.persistent = await save(state.ledger);
  }

  state.events = state.events.map((e) => (e.id === event.id ? { ...e, reverted: true } : e));
  await saveEvents(state.events);
  reclassify();
  renderHistory();
}

/**
 * What is set up, what is missing, and what each missing thing would buy.
 *
 * The order is the order it has to happen in: bank data is the spine, the chart
 * names the accounts, coded history teaches the rules. Everything else is
 * optional and says so, with what it unlocks — an optional file nobody can see
 * the point of does not get provided.
 */
interface SetupStep {
  what: string;
  done: boolean;
  detail: string;
  /** What providing it makes possible. Empty for the required ones. */
  unlocks: string;
  /**
   * Where to go and do it.
   *
   * More than one where there is more than one way in: bank data arrives from
   * a feed or from a file, and offering only one of them told half the people
   * reading it that the other was not there.
   */
  page?: string;
  links?: { label: string; page: string }[];
  /**
   * Not everybody needs this one, and not doing it is not being behind.
   *
   * Most books are one company or one person, and entities exist for the
   * ledger that holds a company and two rental properties at once. Counting
   * an entity list nobody needs towards "3 of 10 set up" tells the ordinary
   * case it is two thirds finished when it is finished, so an optional step
   * is shown and explained but left out of the count.
   */
  optional?: boolean;
}

/**
 * Where the Account Transactions export comes from, in one place.
 *
 * Said on the Setup page and again on the Check page, and the two had already
 * drifted into naming different Xero menus. One string cannot disagree with
 * itself.
 */
export const XERO_ACCOUNT_TRANSACTIONS =
  "Xero: Reporting → Account Transactions, select all columns, set grouping to None";

/**
 * Which chart bank accounts have been tied to an account in this ledger.
 *
 * A bank row in a chart carries a name and no account number, so nothing can
 * work out which of the ledger's bank accounts it is -- and until somebody
 * says, three things downstream are quietly wrong. Transfers are the loud one:
 * a movement between two accounts is only recognised as one when both ends are
 * known to belong to the entity, and an unrecognised transfer leaves the
 * receiving leg reading as income. The balance sheet cannot place a balance,
 * and a comparison against the accounting system has nothing to line the
 * accounts up by.
 */
function bankLinkState(): { total: number; unlinked: string[] } {
  const rows = accountsForEditing().filter(
    ({ account }) => account.type.trim().toLowerCase() === "bank",
  );
  const unlinked = rows
    .filter(
      ({ account }) =>
        account.ledgerAccount === undefined && ledgerAccountFor(account.name, account) === null,
    )
    .map(({ account }) => account.name);
  return { total: rows.length, unlinked };
}

function setupSteps(): SetupStep[] {
  const led = state.ledger;
  const source = $<HTMLSelectElement>("setup-source").value;
  const xero = source === "xero";
  const fromNew = source === "new";
  const entities = led.entities?.entities ?? [];
  const typed = state.chart.filter((a) => a.type.trim() !== "").length;
  const bankLinks = bankLinkState();

  // Renaming the one entity these books belong to is the smallest useful act
  // of setting them up, and the only one that cannot be inferred: a chart
  // arrives with accounts, but nothing can know whose books these are. Still
  // being called by the placeholder name is a reliable sign nobody has been
  // here yet -- and it stops being true the moment somebody renames it, which
  // is why the step is measured on it rather than on having visited a page.
  const named =
    entities.length > 0 && !entities.some((entity) => entity.name === DEFAULT_ENTITY_NAME);

  return [
    {
      what: "Bank transactions",
      done: led.transactions.length > 0,
      detail:
        led.transactions.length > 0
          ? `${led.transactions.length} imported`
          : "Connect a bank feed, or drop your bank CSVs, on the Bank import page. " +
            "Everything else hangs off these.",
      unlocks: "",
      links: [{ label: "Bank import", page: "import" }],
    },
    {
      // The chart step used to be judged on this as well, so a chart that had
      // imported perfectly sat unticked and the fix was on another page --
      // two unrelated facts under one tick, and the more confusing of them
      // reported against the wrong one. It is its own step now, and it is
      // done at the top of this page rather than by hunting for a placeholder
      // entity somewhere else.
      what: "Whose books are these?",
      done: named,
      detail: named
        ? entities.map((e) => e.name).join(", ")
        : "The one thing no export contains: a chart arrives with sixty accounts and " +
          "not one of them says whose they are. Set it at the top of this page.",
      unlocks: "Every report, and every return, can say who it is for",
    },
    {
      what: "Chart of accounts",
      done: state.chart.length > 0,
      detail:
        state.chart.length > 0
          ? `${state.chart.length} accounts, ${typed} with a type set`
          : xero
            ? "Export from Xero's Chart of accounts page and drop it above."
            : "Load your chart of accounts.",
      unlocks: "Names accounts consistently, and carries entities and GST treatments",
      page: "entities",
    },
    {
      what: "Your bank accounts",
      done: bankLinks.total > 0 && bankLinks.unlinked.length === 0,
      detail:
        bankLinks.total === 0
          ? "These arrive with the chart of accounts. Load that first."
          : bankLinks.unlinked.length === 0
            ? `${bankLinks.total} bank account${bankLinks.total === 1 ? "" : "s"} tied to ` +
              "an account in this ledger"
            : `${bankLinks.unlinked.length} of ${bankLinks.total} not yet tied to an ` +
              `account in this ledger: ${bankLinks.unlinked.join(", ")}. Set each one ` +
              "under “Entity, or which account”.",
      unlocks:
        "Transfers between your own accounts, instead of the receiving leg reading as income",
      page: "entities",
    },
    {
      // Required for a ledger that starts partway through a company's life,
      // and meaningless for one that starts at the beginning -- so it is only
      // optional in the case where it genuinely is. Missing them does not
      // produce a short balance sheet, it produces a wrong one, which is the
      // reason this is its own step rather than a note on the reports page.
      what: "Opening balances",
      done: led.openingBalances !== undefined,
      optional: fromNew,
      detail:
        led.openingBalances !== undefined
          ? `${Object.keys(led.openingBalances.accounts).length} accounts as at ` +
            led.openingBalances.asAt
          : fromNew
            ? "Nothing to bring in when the ledger starts at the beginning of the company: " +
              "everything it has ever done is in the transactions."
            : xero
              ? "Xero: Accounting → Reports → Trial Balance, at your previous year end"
              : "A trial balance at the previous year end, which carries every account " +
                "and the cents, so the figures balance on their own",
      unlocks: "A balance sheet that is a position rather than a movement, and the IR10",
      page: "opening",
    },
    {
      what: "Coded history",
      done: state.reference.length > 0,
      optional: fromNew,
      detail:
        state.reference.length > 0
          ? `${state.reference.length} coded lines loaded`
          : fromNew
            ? "Nothing to load when you are starting from new. Your rules will come " +
              "from the first few codings you make instead."
            : xero
              ? XERO_ACCOUNT_TRANSACTIONS
              : "Your spreadsheet, with a column saying what each line was coded to",
      unlocks: "Teaches the rules, and lets your coding be checked against it",
      page: "check",
    },
    {
      what: "Rules",
      done: ((state.rules as RuleFileShape | undefined)?.rules ?? []).length > 0,
      optional: true,
      detail:
        ((state.rules as RuleFileShape | undefined)?.rules ?? []).length > 0
          ? `${((state.rules as RuleFileShape | undefined)?.rules ?? []).length} rules`
          : fromNew
            ? "Written for you as you code. Coding a transaction by hand offers to " +
              "make a rule from it."
            : state.reference.length > 0
              // The proposals themselves are on the Check page, where the file
              // that produces them is loaded. This says they are waiting and
              // sends you there, rather than repeating the whole table here.
              ? "Optional: your coded history can write these for you. The proposals " +
                "are on the Coding reconciliation page, under the file they came from."
              : "Optional: load a coded history on the Coding reconciliation page and the coding " +
                "you have already done becomes the rules.",
      unlocks: "",
      links:
        state.reference.length > 0 &&
        ((state.rules as RuleFileShape | undefined)?.rules ?? []).length === 0
          ? [
              { label: "See the proposals", page: "check" },
              { label: "Rules", page: "rules" },
            ]
          : [{ label: "Go", page: "rules" }],
    },
    {
      what: "More than one entity?",
      done: entities.length > 1,
      optional: true,
      detail:
        entities.length > 1
          ? entities.map((e) => e.name).join(", ")
          : "Only if one set of books holds several things — a company and two " +
            "rentals, say. One company or one person needs none of this.",
      unlocks: "Per-entity reports, and owner shares on a return",
      page: "entities",
    },
    {
      what: "Invoices",
      done: (led.invoices ?? []).length > 0,
      optional: true,
      detail:
        (led.invoices ?? []).length > 0
          ? `${(led.invoices ?? []).length} invoices, ${(led.allocations ?? []).length} allocations`
          : xero
            ? "Xero: Business → Invoices → Export"
            : "Your invoices, with what each one was for and when it was paid",
      unlocks: "Accrual income, and matching receipts to what they settled",
      page: "invoices",
    },
    {
      what: "Fixed assets",
      done: (led.assets ?? []).length > 0,
      optional: true,
      detail:
        (led.assets ?? []).length > 0
          ? `${(led.assets ?? []).length} assets`
          : xero
            ? "Xero: Accounting → Fixed assets → Export"
            : "Your asset register: what was bought, when, and for how much",
      unlocks: "Depreciation — the one figure bank data can never produce",
      page: "assets",
    },
    {
      what: "General ledger",
      done: (led.journals ?? []).length > 0,
      optional: true,
      detail:
        (led.journals ?? []).length > 0
          ? `${(led.journals ?? []).length} journals`
          : fromNew
            ? "Nothing to load when you are starting from new."
            : "Xero: Accounting → Reports → Journal Report, all columns, exported as " +
            "CSV or Excel. Load it on the Fixed assets page's neighbour, Reports.",
      unlocks: "Accrual reports that reproduce a signed set of accounts exactly",
      page: "reports",
    },
    {
      // Asked for by name, because it is the only outside witness there is.
      // Everything else in this list comes from the same two systems; a total
      // built from the rows cannot tell you a row is missing.
      what: "Daily bank balances",
      done: state.balanceChecks.length > 0,
      optional: true,
      detail:
        state.balanceChecks.length > 0
          ? `${state.balanceChecks.filter((c) => c.account !== null && c.breaks.length === 0).length} of ` +
            `${state.balanceChecks.length} accounts tie to the bank`
          : "Optional, and the best check there is. A separate export from your " +
            "bank, worth fetching in the same visit as your transactions: same " +
            "accounts, same dates. Drop it on the Bank import page.",
      unlocks: "Proves nothing is missing or counted twice, and settles questionable duplicates",
      page: "import",
    },
    {
      what: "Filed GST returns",
      done: state.filed.length > 0,
      optional: true,
      detail:
        state.filed.length > 0
          ? `${state.filed.length} periods loaded`
          : fromNew
            ? "Nothing filed yet when you are starting from new."
            : "The returns you have already filed, as they were filed",
      unlocks: "Checks every period against what was actually filed, and finds what moved",
      page: "gst",
    },
  ];
}

/** Worked examples for inference: our transactions paired with their coding. */
function codedExamples(): CodedExample[] {
  // Your own confirmed codings count as evidence, not only the accounting
  // system's. They were ignored, so a payment nobody else had coded could be
  // coded here fifty times and never suggest a rule -- and the ones you code
  // by hand are exactly the ones no rule covers yet.
  //
  // Only confirmed ones: a suggestion nobody has looked at is the rule's own
  // opinion, and learning a rule from it would be the software agreeing with
  // itself.
  const overrides = state.ledger.overrides ?? {};
  const yours: CodedExample[] = state.ledger.transactions
    .filter((t) => overrides[t.id]?.confirmed === true && (overrides[t.id]?.code ?? "") !== "")
    .map((t) => ({ transaction: t, code: overrides[t.id]?.code ?? "" }));

  if (state.reference.length === 0) return yours;
  const coded = state.ledger.transactions.map((t) => ({
    transaction: t,
    code: (state.suggestions?.get(t.id)?.code ?? null) ?? "(uncoded)",
  }));
  const mapping = inferAccountMapping(coded, state.reference);
  const sameAccount = (ours: Transaction, theirs: { account?: string }) => {
    if (theirs.account === undefined) return true;
    const expected = mapping.get(ours.account);
    return expected !== undefined ? expected === theirs.account : mapping.size === 0;
  };
  const result = compareCodings(coded, state.reference, {
    chart: state.chart,
    accountMatches: sameAccount,
  });
  const theirs = [...result.agreed, ...result.differed]
    .filter((r) => r.theirs !== null)
    .map((r) => ({ transaction: r.transaction, code: r.theirs?.label ?? "" }));

  // Both sources, with yours last so that where a transaction appears in both
  // the agreement is counted twice rather than the disagreement hidden -- the
  // inference weighs them, and seeing both is the point.
  return [...theirs, ...yours];
}


/**
 * Everything to go and fetch, said once and up front.
 *
 * It was said seven times instead, a line at a time on whichever step wanted
 * that file -- so setting up read as seven separate trips to the accounting
 * system, and the natural way to work the list was to make all seven. They
 * come from one place and are exported in one visit, and somebody who knows
 * that fetches the lot in five minutes. The checklist below then stops being
 * a list of errands and becomes a receipt: what arrived, and what did not.
 *
 * `have` is what the ledger already holds, so a second visit shows what is
 * still outstanding rather than asking again for what is already in.
 */
interface SourceFile {
  what: string;
  where: string;
  why: string;
  have: boolean;
}

function filesToFetch(): { title: string; hint: string; files: SourceFile[] } {
  const led = state.ledger;
  const source = $<HTMLSelectElement>("setup-source").value;
  const bank: SourceFile = {
    what: "Bank statements",
    where: "Your bank's own CSV export, every account, as far back as you keep",
    why:
      "Everything else hangs off these. A daily balance export too, if the bank offers " +
      "one: it is the only outside witness there is.",
    have: led.transactions.length > 0,
  };

  if (source === "new") {
    return {
      title: "What to fetch",
      hint: "Starting from new, there is only one thing to get.",
      files: [bank],
    };
  }

  if (source === "sheet") {
    return {
      title: "What to fetch",
      hint: "Two things, and the second is whatever you already keep.",
      files: [
        bank,
        {
          what: "Your coded spreadsheet",
          where: "However you keep it, with a column saying what each line was coded to",
          why: "The coding you have already done becomes the rules, rather than being retyped.",
          have: state.reference.length > 0,
        },
      ],
    };
  }

  // Xero. Named by the menu path rather than by the file, because the export
  // is found by walking that menu and the file is called something else
  // entirely by the time it lands in a downloads folder.
  return {
    title: "Export these from Xero, in one visit",
    hint:
      "All of them now, rather than one at a time as each is wanted: they come from the " +
      "same place and the whole set takes a few minutes. Then drop the lot below, in any " +
      "order. Each file is recognised by its own columns.",
    files: [
      bank,
      {
        what: "Chart of accounts",
        where: "Accounting -> Chart of accounts -> Export",
        why: "Names every account consistently, and carries the GST treatment each one uses.",
        have: state.chart.length > 0,
      },
      {
        what: "Account transactions",
        where: XERO_ACCOUNT_TRANSACTIONS,
        why: "Every line somebody has already coded. This is what teaches the rules.",
        have: state.reference.length > 0,
      },
      {
        what: "Trial balance",
        where: "Accounting -> Reports -> Trial Balance, at your previous year end",
        why: "Opening balances. Without them a balance sheet is wrong rather than short.",
        have: led.openingBalances !== undefined,
      },
      {
        what: "Invoices",
        where: "Business -> Invoices -> Export",
        why: "Accrual income, and which receipt settled which invoice.",
        have: (led.invoices ?? []).length > 0,
      },
      {
        what: "Fixed assets",
        where: "Accounting -> Fixed assets -> Export",
        why: "Depreciation, which is the one figure bank data can never produce.",
        have: (led.assets ?? []).length > 0,
      },
      {
        what: "Journal report",
        where: "Accounting -> Reports -> Journal Report, all columns",
        why:
          "The year-end judgements your accountant made, which no bank line shows. A " +
          "General Ledger Detail export is taken here too and values every line, but it " +
          "has no narration column -- so it cannot tell a manual journal from an " +
          "ordinary posting. Fetch this one.",
        have: (led.journals ?? []).length > 0,
      },
      {
        what: "Filed GST returns",
        where: "The returns you have already filed, as they were filed",
        why: "Checks every period against what was actually filed, and finds what moved.",
        have: state.filed.length > 0,
      },
    ],
  };
}

/**
 * The name of the books, asked for where it is first wanted.
 *
 * It is the one fact no export contains: a chart arrives with sixty accounts
 * and not one of them says whose they are. It used to be set by finding the
 * placeholder entity on another page and pressing Rename, which is a strange
 * first instruction to give anybody -- and until it was done the chart step
 * sat unticked with a correctly imported chart sitting behind it.
 */
function setupNameField(): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "setup-name";
  const model = state.ledger.entities ?? emptyEntityModel();
  const first = model.entities[0];
  const placeholderOnly = first !== undefined && first.name === DEFAULT_ENTITY_NAME;

  const label = document.createElement("label");
  label.textContent = "Whose books are these?";
  label.htmlFor = "setup-entity-name";

  const input = document.createElement("input");
  input.type = "text";
  input.id = "setup-entity-name";
  input.placeholder = "Your company, trust, or your own name";
  input.value = first === undefined || placeholderOnly ? "" : first.name;

  const save = document.createElement("button");
  save.type = "button";
  save.className = "primary";
  save.textContent = first === undefined ? "Save" : "Rename";

  const said = document.createElement("span");
  said.className = "setup-name-said";
  said.textContent =
    model.entities.length > 1
      ? `${model.entities.length} entities. This renames the first; the rest are on ` +
        "Entities & accounts."
      : "Only needed once. If one set of books holds several things -- a company and two " +
        "rentals, say -- add the others on Entities & accounts.";

  const commit = async (): Promise<void> => {
    const wanted = input.value.trim();
    if (wanted === "") return;
    const live = state.ledger.entities ?? emptyEntityModel();
    const existing = live.entities[0];
    if (existing === undefined) {
      // The id is derived from the name once, when the entity is made. A
      // rename afterwards keeps it: everything assigned to the entity points
      // at the id, and changing it would orphan the lot.
      save.disabled = true;
      save.classList.add("working");
      try {
        await saveEntities({
          ...live,
          entities: [
            ...live.entities,
            { id: entityId(wanted), name: wanted, kind: "business", gstRegistered: true },
          ],
        });
        save.textContent = "Saved ✓";
        renderSetupBody();
      } finally {
        save.disabled = false;
        save.classList.remove("working");
      }
      return;
    }
    if (existing.name === wanted) {
      save.textContent = "Saved ✓";
      return;
    }
    save.disabled = true;
    save.classList.add("working");
    try {
      await saveEntities(
        {
          ...live,
          entities: live.entities.map((e) => (e.id === existing.id ? { ...e, name: wanted } : e)),
        },
        `Renamed ${existing.name} to ${wanted}`,
      );
      save.textContent = "Renamed ✓";
      renderSetupBody();
    } finally {
      save.disabled = false;
      save.classList.remove("working");
    }
  };
  save.addEventListener("click", () => void commit());
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") void commit();
  });
  input.addEventListener("input", () => {
    const live = state.ledger.entities ?? emptyEntityModel();
    const existing = live.entities[0];
    const wanted = input.value.trim();
    if (existing && existing.name === wanted) {
      save.textContent = "Saved ✓";
    } else {
      save.textContent = existing === undefined ? "Save" : "Rename";
    }
  });

  wrap.append(label, input, save, said);
  return wrap;
}

function renderSetupIntro(): void {
  const intro = $("setup-intro");
  intro.textContent = "";
  intro.append(setupNameField());

  const { title, hint, files } = filesToFetch();
  const box = document.createElement("div");
  box.className = "setup-files";
  const heading = document.createElement("h3");
  heading.textContent = title;
  const said = document.createElement("p");
  said.textContent = hint;
  box.append(heading, said);

  for (const file of files) {
    const row = document.createElement("div");
    row.className = file.have ? "setup-file have" : "setup-file";
    const what = document.createElement("div");
    what.className = "setup-file-what";
    what.textContent = file.have ? `✓ ${file.what}` : file.what;
    const where = document.createElement("div");
    where.className = "setup-file-where";
    where.textContent = file.where;
    const why = document.createElement("div");
    why.className = "setup-file-why";
    why.textContent = file.why;
    row.append(what, where, why);
    box.append(row);
  }
  intro.append(box);
}

function renderSetup(): void {
  renderSetupIntro();
  renderSetupBody();
}

function renderSetupBody(): void {
  const body = $("setup-body");
  body.textContent = "";

  const steps = setupSteps();
  const needed = steps.filter((s) => s.optional !== true);
  const done = needed.filter((s) => s.done).length;
  const extras = steps.filter((s) => s.optional === true && s.done).length;

  const summary = document.createElement("p");
  summary.className = "setup-progress";
  summary.textContent =
    `${done} of ${needed.length} set up.` + (extras > 0 ? ` ${extras} optional as well.` : "");
  body.append(summary);

  // Where to come back to. Each step sends you off to another page, and
  // nothing there says the list you came from is keeping score -- so it looked
  // like a page you pass through once rather than the one you work down.
  body.append(
    note(
      done === needed.length
        ? "Everything needed is set up. The optional steps below each say what they " +
          "add; come back here whenever you load something new."
        : "Work down the list. Each step opens the page that does it — come back here " +
          "afterwards and it will have ticked itself off. Nothing has to be done in " +
          "one sitting.",
    ),
  );

  // Somewhere to see it working before trusting it with anything, said here
  // rather than only at the foot of the page under a heading nobody scrolls to.
  if (state.ledger.transactions.length === 0) {
    const demo = document.createElement("p");
    demo.className = "setup-demo";
    demo.textContent =
      "Not ready to load your own? There is a complete invented set of books — a " +
      "coffee roastery and a rental, part way through a year, with codings, splits, " +
      "invoices and a transfer. It opens in books of its own, so nothing here is " +
      "touched.";
    const open = document.createElement("button");
    open.type = "button";
    open.textContent = writesToFolder() ? "Open the demo books" : "Load demo data";
    open.addEventListener("click", () => void loadDemoData(open));
    demo.append(document.createElement("br"), open);
    body.append(demo);
  }

  const list = document.createElement("div");
  list.className = "setup-steps";
  for (const step of steps) {
    const row = document.createElement("div");
    row.className = step.done ? "setup-step done" : "setup-step";

    const mark = document.createElement("span");
    mark.className = "setup-mark";
    // An optional step nobody has done is not an empty box waiting to be
    // ticked, so it does not get one.
    mark.textContent = step.done ? "✓" : step.optional === true ? "–" : "";
    if (step.optional === true && !step.done) mark.title = "Optional";

    const text = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = step.what;
    const detail = document.createElement("div");
    detail.className = "setup-detail";
    detail.textContent = step.detail;
    text.append(title, detail);
    if (!step.done && step.unlocks !== "") {
      const unlocks = document.createElement("div");
      unlocks.className = "setup-unlocks";
      unlocks.textContent = `Gives you: ${step.unlocks}`;
      text.append(unlocks);
    }

    row.append(mark, text);
    const links = step.links ?? (step.page === undefined
      ? []
      : [{ label: step.done ? "Review" : "Go", page: step.page }]);
    if (links.length > 0) {
      const buttons = document.createElement("div");
      buttons.className = "setup-go";
      for (const link of links) {
        const go = document.createElement("button");
        go.type = "button";
        go.textContent = link.label;
        go.addEventListener("click", () => showPage(link.page));
        buttons.append(go);
      }
      row.append(buttons);
    }
    list.append(row);
  }
  body.append(list);

  renderSetupTools(body);
}

/**
 * Demo data, and the way out again.
 *
 * These sit at the foot of Setup because both are about the whole book rather
 * than any one part of it, and because a page that offers to fill the app up
 * should offer to empty it in the same breath.
 */
function renderSetupTools(body: HTMLElement): void {
  const heading = document.createElement("h3");
  heading.textContent = "Demo data";
  body.append(heading);

  body.append(
    note(
      "An invented coffee roastery and a rental, part-way through a year: " +
        "88 bank lines with 35 still to code, two splits, three matched " +
        "invoices and a transfer. Nothing in it is real." +
        (writesToFolder()
          ? " It opens in a set of books of its own called Demo, so whatever you " +
            "are working on is left exactly as it is."
          : " Loading it replaces what is in this browser."),
    ),
  );

  const load = document.createElement("button");
  load.type = "button";
  load.textContent = writesToFolder() ? "Open the demo books" : "Load demo data";
  load.addEventListener("click", () => void loadDemoData(load));
  body.append(load);

  // Clearing lives on the Books page now. It is about a whole set of books
  // rather than about setting one up, and it was reachable there only for
  // whichever books happened to be open -- so tidying an old set away meant
  // opening it first, which is the wrong way round.
  const away = document.createElement("h3");
  away.textContent = "Clearing a set of books";
  body.append(away);

  if (!writesToFolder()) {
    body.append(
      note(
        "There is one set of books here: whatever is in this browser. Clearing it " +
          "cannot be undone, and no copy is kept.",
      ),
    );
    body.append(clearHereControl());
    return;
  }

  body.append(
    note(
      "On the Books page, beside the books it clears. A dated copy is kept first, " +
        "and can be put back.",
    ),
  );
  const goBooks = document.createElement("button");
  goBooks.type = "button";
  goBooks.textContent = "Books";
  goBooks.addEventListener("click", () => showPage("books"));
  body.append(goBooks);
}


/**
 * The clear control, where there is only one set of books to clear.
 *
 * With a folder behind the app, clearing belongs on the Books page beside the
 * books it clears. Without one there is no Books page worth the name -- there
 * is one browser holding one ledger -- and the two pages pointed at each other:
 * Setup said clearing was on Books, Books said it was on Setup, and there was
 * no way to do it at all. That matters most on exactly the copy that has no
 * folder, because that is the one somebody is trying out and wants to reset.
 */
function clearHereControl(): HTMLElement {
  const wrap = document.createElement("div");

  const start = document.createElement("button");
  start.type = "button";
  start.textContent = "Clear these books…";

  const area = document.createElement("div");
  area.hidden = true;

  start.addEventListener("click", () => {
    area.hidden = !area.hidden;
    if (area.hidden) {
      area.textContent = "";
      return;
    }

    const what = document.createElement("p");
    const count = state.ledger.transactions.length;
    what.textContent =
      `This removes ${count} transaction${count === 1 ? "" : "s"} and every coding, ` +
      "rule, invoice, entity and asset with them. Nothing is kept: with no folder " +
      "behind this app there is nowhere to keep a dated copy, so export first if " +
      "you want one.";

    const label = document.createElement("label");
    const says = document.createElement("span");
    says.textContent = `Type ${CLEAR_PHRASE} to enable the button.`;
    const typed = document.createElement("input");
    typed.type = "text";
    typed.placeholder = CLEAR_PHRASE;
    typed.autocomplete = "off";
    label.append(says, typed);

    const go = document.createElement("button");
    go.type = "button";
    go.className = "danger";
    go.textContent = "Clear these books";
    go.disabled = true;
    typed.addEventListener("input", () => {
      go.disabled = typed.value.trim() !== CLEAR_PHRASE;
    });
    go.addEventListener("click", () => {
      go.disabled = true;
      go.textContent = "Clearing…";
      void clearEverything(go);
    });

    const form = document.createElement("div");
    form.className = "clear-form";
    form.append(label, go);
    area.append(what, form);
    typed.focus();
  });

  wrap.append(start, area);
  return wrap;
}

/** The sentence that has to be typed before anything is cleared. */
const CLEAR_PHRASE = "Confirm this will clear all records";

/**
 * Every set of books in the folder, and the way to empty one.
 *
 * Its own page rather than a corner of Setup, because it is about the books as
 * a whole and not about setting any one of them up -- and because clearing was
 * previously reachable only for whichever books happened to be open, so
 * tidying away an old set meant opening it first, which is the wrong way round.
 *
 * Nothing here deletes anything. Clearing moves the files into a dated copy
 * beside them and empties the folder; the folder stays, and the copy can be put
 * back. That is the same promise the rest of this app makes about the folder
 * being the truth, and a delete button would quietly withdraw it.
 */
async function renderBooks(): Promise<void> {
  const body = $("books-body");
  body.textContent = "";

  if (!writesToFolder()) {
    body.append(
      note(
        "This copy has no folder behind it, so there is only one set of books: " +
          "whatever is in this browser. Clearing it is on the Setup page.",
      ),
    );
    return;
  }

  const books = await ledgers();
  const open = await currentLedger();

  const table = document.createElement("table");
  table.className = "report-table books-table";
  const head = document.createElement("thead");
  head.innerHTML = "<tr><th>Books</th><th>Transactions</th><th></th></tr>";
  const tbody = document.createElement("tbody");

  for (const book of books) {
    const tr = document.createElement("tr");
    const isOpen = book.id === open;

    const name = document.createElement("td");
    name.textContent = book.name;
    if (isOpen) {
      const here = document.createElement("span");
      here.className = "books-open";
      here.textContent = "open now";
      name.append(" ", here);
    }
    tr.append(name);

    const count = document.createElement("td");
    count.className = "report-amount";
    count.textContent = String(book.transactions);
    tr.append(count);

    const actions = document.createElement("td");
    actions.className = "report-amount";

    if (!isOpen) {
      const openIt = document.createElement("button");
      openIt.type = "button";
      openIt.textContent = "Open";
      openIt.addEventListener("click", () => void chooseLedger(book.id));
      actions.append(openIt);
    }

    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "row-remove";
    clear.textContent = "Clear…";
    actions.append(clear);
    tr.append(actions);
    tbody.append(tr);

    // The confirmation opens under the row it belongs to, so the books being
    // cleared and the sentence agreeing to it are never a scroll apart.
    const confirmRow = document.createElement("tr");
    confirmRow.hidden = true;
    const cell = document.createElement("td");
    cell.colSpan = 3;
    cell.className = "books-confirm";
    confirmRow.append(cell);
    tbody.append(confirmRow);

    clear.addEventListener("click", () => {
      confirmRow.hidden = !confirmRow.hidden;
      if (confirmRow.hidden) {
        cell.textContent = "";
        return;
      }

      const what = document.createElement("p");
      what.textContent =
        `Clearing ${book.name} removes its ${book.transactions} transactions and ` +
        "every coding, rule, invoice, entity and asset with them. A dated copy is " +
        "kept beside it first" +
        (isOpen ? " and can be put back below." : ", and can be put back by opening those books.");

      const label = document.createElement("label");
      const says = document.createElement("span");
      says.textContent = `Type ${CLEAR_PHRASE} to enable the button.`;
      const typed = document.createElement("input");
      typed.type = "text";
      typed.placeholder = CLEAR_PHRASE;
      typed.autocomplete = "off";
      label.append(says, typed);

      const go = document.createElement("button");
      go.type = "button";
      go.className = "danger";
      go.textContent = `Clear ${book.name}`;
      go.disabled = true;
      typed.addEventListener("input", () => {
        go.disabled = typed.value.trim() !== CLEAR_PHRASE;
      });

      go.addEventListener("click", () => {
        go.disabled = true;
        go.textContent = "Clearing…";
        // The open books go through the same routine as the Setup page always
        // used, because the page is holding a working copy of them and has to
        // be told to forget it. Books that are not open have no working copy
        // here, so the server does the whole job.
        if (isOpen) {
          void clearEverything(go);
          return;
        }
        void archiveOther(book.id).then((result: { ok: boolean; why: string }) => {
          if (result.ok) void renderBooks();
          else {
            alert(result.why);
            go.disabled = false;
            go.textContent = `Clear ${book.name}`;
          }
        });
      });

      const form = document.createElement("div");
      form.className = "clear-form";
      form.append(label, go);
      cell.append(what, form);
      typed.focus();
    });
  }

  table.append(head, tbody);
  body.append(table);

  // Starting a new set of books used to live in the menu's dropdown, which is
  // where you would look for it only if you already knew it was there.
  const make = document.createElement("button");
  make.type = "button";
  make.className = "books-new";
  make.textContent = "New set of books…";
  make.addEventListener("click", () => void chooseLedger("\u0000new"));
  body.append(make);

  // Named, since the table above lists several sets and this list is of one.
  const openName = books.find((b) => b.id === open)?.name ?? "";
  await renderArchives(body, openName);
}

/**
 * The dated copies kept beside these books.
 *
 * Clearing has always moved the files into `archive/<stamp>/` rather than
 * deleting them, and the app has always said there was no undo -- which was
 * false, and false in the direction that makes somebody stop looking. A safety
 * net nobody can reach is not one.
 */
async function renderArchives(body: HTMLElement, whose = ""): Promise<void> {
  const archives = await listArchives();
  if (archives.length === 0) return;

  const heading = document.createElement("h3");
  // Named, because this list sits under a table of several sets of books and
  // "Earlier copies" alone does not say of what. Putting one back replaces a
  // whole set of books, which is not a thing to do from a guess.
  heading.textContent = whose === "" ? "Earlier copies" : `Earlier copies of ${whose}`;
  body.append(heading);

  body.append(
    note(
      "Taken whenever " +
        (whose === "" ? "these books were" : `${whose} was`) +
        " cleared or restored over. Putting one back keeps a copy of what it " +
        "replaces, so this is reversible too.",
    ),
  );

  const table = document.createElement("table");
  table.className = "report-table owner-table";
  const head = document.createElement("thead");
  head.innerHTML =
    "<tr><th>Books</th><th>Taken</th><th>Transactions</th><th>Invoices</th>" +
    "<th>Accounts</th><th></th></tr>";
  const tbody = document.createElement("tbody");

  for (const archive of archives) {
    const tr = document.createElement("tr");

    const books = document.createElement("td");
    books.className = "report-name";
    books.textContent = whose;
    tr.append(books);

    // The folder name is a timestamp with the punctuation swapped out, which
    // is unambiguous but not a date anybody reads. Shown as one.
    const [year, month, day, hour, minute] = archive.stamp.split("-");
    const when = document.createElement("td");
    when.textContent =
      year && month && day ? `${day}/${month}/${year}${hour ? ` ${hour}:${minute ?? "00"}` : ""}` : archive.stamp;
    tr.append(when);

    for (const value of [archive.transactions, archive.invoices, archive.accounts]) {
      const cell = document.createElement("td");
      cell.className = "report-amount";
      cell.textContent = String(value);
      tr.append(cell);
    }

    const actions = document.createElement("td");
    actions.className = "report-amount";
    const put = document.createElement("button");
    put.type = "button";
    put.textContent = "Put this back";
    put.addEventListener("click", () => {
      if (
        !confirm(
          `Put back the copy of ${whose || "these books"} from ${when.textContent}?

` +
            `${archive.transactions} transactions and their coding. What is open now is ` +
            `kept as another copy first, so this can be undone.`,
        )
      ) {
        return;
      }
      put.disabled = true;
      put.textContent = "Putting back…";
      void restoreArchive(archive.stamp).then((ok) => {
        if (ok) location.reload();
        else {
          alert("Could not put that copy back.");
          put.disabled = false;
          put.textContent = "Put this back";
        }
      });
    });
    actions.append(put);
    tr.append(actions);
    tbody.append(tr);
  }

  table.append(head, tbody);
  body.append(table);
}

/**
 * Open the invented books.
 *
 * With a folder behind the app this moves to a ledger of its own rather than
 * replacing the one in front of you. It used to wipe whatever was open, with
 * no confirmation and nothing naming what was about to go -- which archived
 * real books more than once while this was being built.
 *
 * Without a folder there is only one place to put it, so it still replaces,
 * and now says so first.
 */

/** Set once the demo has been seeded, or a book deliberately cleared. */
const DEMO_SEEDED = "nzosa:demo-seeded";

/**
 * What a browser with nothing in it should open on.
 *
 * With no folder behind the app there is nowhere for real books to live
 * durably, so a copy served as plain files is a demonstration whether or not
 * it says so. Somebody arriving at an empty one has nothing to look at and no
 * way to tell whether any of it works, and the honest fix is to fill it: the
 * invented books are already shipped beside the app, so they load themselves.
 *
 * Never over anything. Only a ledger with no transactions in it is seeded, and
 * only once -- the flag is what stops a deliberate clear from being undone on
 * the next refresh, which looks exactly like the clear not having worked.
 * `wipe()` sets it for the same reason, so clearing means cleared.
 *
 * A folder-backed app never reaches here. There the books are the folder, and
 * a demo belongs in a folder of its own.
 */
async function seedBrowser(): Promise<void> {
  // A copy that ships its own data still wins: `data/` is somebody's
  // deliberate seed, and the demo is only the fallback for an empty one.
  await loadStartupFiles();
  if (state.ledger.transactions.length > 0) return;

  let already = true;
  try {
    already = localStorage.getItem(DEMO_SEEDED) !== null;
  } catch {
    // Storage can throw outright rather than come back empty -- a browser set
    // to block site data, or a preview pane. Treated as "already", because
    // seeding on every single load is worse than never seeding.
    already = true;
  }
  if (already) return;

  await loadStartupFiles("demo", true);
  if (state.ledger.transactions.length === 0) return; // nothing shipped; say nothing
  markDemoSeeded();
  reclassify();
  state.startupMessage =
    "These are demo books — an invented coffee roastery and a rental, part way " +
    "through a year. Nothing here is real, and you can change anything. To keep " +
    "books of your own, run NZOSA on your own computer: see the guide for owners.";
}

/** Remember that this browser has had its one automatic seed. */
function markDemoSeeded(): void {
  try {
    localStorage.setItem(DEMO_SEEDED, new Date().toISOString());
  } catch {
    // Nothing to do: without storage the seed simply happens again next time,
    // which is the same as any other browser that keeps nothing.
  }
}

async function loadDemoData(button: HTMLButtonElement): Promise<void> {
  if (writesToFolder()) {
    button.disabled = true;
    button.textContent = "Opening…";
    if (!(await switchLedger("demo", "Demo"))) {
      alert("Could not open the demo books.");
      button.disabled = false;
      button.textContent = "Open the demo books";
      return;
    }
    // The demo ledger is the open one now. Filling it cannot touch anything
    // else, and if it already holds the demo the reload simply shows it.
    await loadStartupFiles("demo", true);
    location.reload();
    return;
  }

  if (
    state.ledger.transactions.length > 0 &&
    !confirm(
      `This replaces everything in the browser: ${state.ledger.transactions.length} ` +
        `transactions and the coding on them. There is no undo.\n\nGo ahead?`,
    )
  ) {
    return;
  }

  button.disabled = true;
  button.textContent = "Loading…";
  try {
    await wipe();
    await loadStartupFiles("demo", true);
    reclassify();
    state.entityFilter = "";
    showPage("reconcile");
  } catch (error) {
    alert(`Could not load the demo data: ${(error as Error).message}`);
    button.disabled = false;
    button.textContent = "Load demo data";
  }
}

/**
 * Empty the browser's store, in memory and on disk.
 *
 * Shared by the demo loader and the clear button: loading a demo over a part
 * coded book would leave the old book's decisions attached to transactions
 * that are no longer there.
 */
async function wipe(): Promise<void> {
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

async function clearEverything(button: HTMLButtonElement): Promise<void> {
  button.disabled = true;
  await wipe();
  reclassify();
  state.entityFilter = "";
  showPage("setup");
}

/**
 * Rules proposed from coded history, with the evidence behind each one.
 *
 * Nothing is applied until it is accepted. Every proposal shows how many
 * transactions it saw, how many agreed, and what the competing answers were —
 * because a rule you cannot see the evidence for is a rule you cannot argue
 * with later.
 */
function renderRuleSuggestions(body: HTMLElement, withHeading = true): void {
  if (withHeading) {
    const heading = document.createElement("h3");
    heading.textContent = "Rules from your coded history";
    body.append(heading);
  }

  if (state.reference.length === 0) {
    body.append(
      note(
        "Load your coded history first — a Xero Account Transactions export, or your " +
          "spreadsheet — and the coding you have already done becomes the rules.",
      ),
    );
    return;
  }

  const examples = codedExamples();
  if (examples.length === 0) {
    body.append(note("No transactions could be matched to a coding in that file."));
    return;
  }

  const proposals = inferRules(examples).filter((p) => {
    const known = ((state.rules as RuleFileShape | undefined)?.rules ?? []);
    return !known.some(
      (r) =>
        r.keyword === p.rule.keyword &&
        r.account === p.rule.account &&
        (r.where?.otherPartyAccount ?? "") === (p.rule.where?.otherPartyAccount ?? ""),
    );
  });
  const cover = coverage(state.ledger.transactions, proposals);

  body.append(
    note(
      `${examples.length} of your transactions have a coding in that file. ` +
        `${proposals.length} new rules can be drawn from them, which would code ` +
        `${cover.covered} of ${cover.total} transactions. The rest are one-offs — ` +
        "individual customers and suppliers that no keyword should try to capture.",
    ),
  );

  if (proposals.length === 0) return;

  const acceptAll = document.createElement("button");
  acceptAll.type = "button";
  acceptAll.className = "primary";
  acceptAll.textContent = `Accept all ${proposals.length}`;
  acceptAll.addEventListener("click", () => void acceptProposals(proposals));
  body.append(acceptAll);

  const table = document.createElement("table");
  table.className = "report-table owner-table setup-table";
  const head = document.createElement("thead");
  head.innerHTML =
    "<tr><th>Evidence</th><th>When the line says</th><th>Code it to</th>" +
    "<th>Account</th><th>Also seen as</th><th></th></tr>";
  const tbody = document.createElement("tbody");

  for (const proposal of proposals.slice(0, 200)) {
    const tr = document.createElement("tr");
    const competing =
      proposal.competing.length === 0
        ? ""
        : proposal.competing.map((c) => `${c.code} ×${c.count}`).join(", ");
    for (const [text, cls] of [
      [`${proposal.agreed} of ${proposal.seen}`, "report-amount"],
      // What the rule actually matches on. A rule keyed on the account the
      // money went to has no keyword, and a row reading "18 of 18 -> 200
      // Sales" with nothing in this column cannot be judged at all.
      [
        proposal.rule.keyword ??
          (proposal.rule.where?.otherPartyAccount !== undefined
            ? `paid to/from ${proposal.rule.where.otherPartyAccount}`
            : ""),
        "report-name",
      ],
      [proposal.rule.code, "report-name"],
      [proposal.rule.account ?? "any", "report-name"],
      [competing, "report-name"],
    ] as const) {
      const td = document.createElement("td");
      td.textContent = text;
      td.className = cls;
      if (text !== "") td.title = proposal.examples.join("\n");
      tr.append(td);
    }
    const actions = document.createElement("td");
    actions.className = "report-amount";
    const accept = document.createElement("button");
    accept.type = "button";
    accept.textContent = "Accept";
    accept.addEventListener("click", () => void acceptProposals([proposal]));
    actions.append(accept);
    tr.append(actions);
    tbody.append(tr);
  }
  table.append(head, tbody);
  body.append(table);
}

/** Add accepted proposals to the rule set, recording each as a change. */
async function acceptProposals(proposals: readonly RuleProposal[]): Promise<void> {
  const file = (state.rules as RuleFileShape | undefined) ?? { rules: [] };
  const rules = [...(file.rules ?? [])];
  for (const proposal of proposals) {
    rules.push(proposal.rule);
    void record(
      "rule",
      `Accepted a suggested rule: ${proposal.rule.keyword} → ${proposal.rule.code}` +
        ` (${proposal.agreed} of ${proposal.seen} agreed)`,
      null,
      proposal.rule,
      String(rules.length - 1),
    );
  }
  state.rules = { ...file, rules } as RuleSet;
  state.rulesName = state.rulesName === "" ? "suggested-rules.json" : state.rulesName;
  reclassify();
  await persistRules();
  // Whichever page is showing, not the one these proposals used to live on.
  // They moved to the Check page and this did not follow, so accepting a rule
  // redrew a hidden Setup and left the proposals sitting on screen looking
  // ignored -- they had in fact been accepted, and said so the moment you
  // navigated away and back.
  showPage(state.page);
}

function renderHistory(): void {
  const body = $("history-body");
  body.textContent = "";
  $<HTMLInputElement>("who").value = state.who;

  const kindSelect = $<HTMLSelectElement>("history-kind");
  const chosen = kindSelect.value;
  const kinds = [...new Set(state.events.map((e) => e.kind))];
  kindSelect.textContent = "";
  const all = document.createElement("option");
  all.value = "";
  all.textContent = "Everything";
  kindSelect.append(all);
  for (const kind of kinds) {
    const option = document.createElement("option");
    option.value = kind;
    option.textContent = KIND_LABELS[kind];
    option.selected = kind === chosen;
    kindSelect.append(option);
  }

  if (state.events.length === 0) {
    body.append(
      note(
        "Nothing recorded yet. From here on, every coding, split, chart edit, entity " +
          "assignment, invoice match and rule change is logged with your name and can be " +
          "undone.",
      ),
    );
    return;
  }

  const shown = state.events.filter((e) => chosen === "" || e.kind === chosen);
  // Say what the log costs. A deep history is only a good idea while it stays
  // small, and the number is the thing that tells you whether it has.
  const bytes = new Blob([JSON.stringify(state.events)]).size;
  const size =
    bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
  body.append(
    note(
      `${shown.length} of ${state.events.length} changes, ${size}. ` +
        `The last ${MAX_EVENTS.toLocaleString("en-NZ")} are kept; older ones fall off.`,
    ),
  );

  const table = document.createElement("table");
  table.className = "report-table owner-table";
  const head = document.createElement("thead");
  head.innerHTML = "<tr><th>When</th><th>Who</th><th>What</th><th>Change</th><th></th></tr>";
  const tbody = document.createElement("tbody");

  for (const event of shown) {
    const tr = document.createElement("tr");
    if (event.reverted === true) tr.className = "event-reverted";
    const when = event.at.slice(0, 16).replace("T", " ");
    for (const [text, cls] of [
      [when, "report-name"],
      [event.who, "report-name"],
      [KIND_LABELS[event.kind], "report-name"],
      [event.summary, "report-name"],
    ] as const) {
      const td = document.createElement("td");
      td.textContent = text;
      td.className = cls;
      tr.append(td);
    }

    const actions = document.createElement("td");
    actions.className = "report-amount";
    const allowed = canReverse(state.events, event);
    if (event.reverted === true) {
      const label = document.createElement("span");
      label.className = "event-undone";
      label.textContent = "undone";
      actions.append(label);
    } else {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Undo";
      button.disabled = !allowed.ok;
      if (!allowed.ok) button.title = allowed.why;
      button.addEventListener("click", () => void undo(event));
      actions.append(button);
    }
    tr.append(actions);
    tbody.append(tr);
  }

  table.append(head, tbody);
  body.append(table);
}

/** Said, and the answer is that this ledger holds no money in this account. */
const NOT_IN_LEDGER = "none";

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
function ledgerAccountFor(name: string, account?: Account): string | null {
  // What somebody said, before anything a name suggests. "Platinum Credit
  // Card used for Business Transactions" is the same card as the one the feed
  // calls by its id, and only a person can know that.
  const said = account?.ledgerAccount;
  if (said === NOT_IN_LEDGER) return null;
  if (said !== undefined && said !== "") return said;

  const wanted = name.trim();
  const { accounts, labels } = banks();
  if (accounts.has(wanted)) return wanted;
  const tidy = (text: string): string => text.trim().toLowerCase().replace(/\s+/g, " ");
  const target = tidy(wanted);
  for (const [id, label] of labels) if (tidy(label) === target) return id;
  return null;
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
function withoutBankMapping(chart: readonly Account[]): Account[] {
  const held = banks().accounts;
  return chart.filter((a) => !(a.type === "Bank" && held.has(a.name.trim())));
}

/** Strip them from the stored chart, if any are there. */
async function tidyChart(): Promise<void> {
  const tidied = withoutBankMapping(state.chart);
  if (tidied.length === state.chart.length) return;
  state.chart = tidied;
  state.ledger = { ...state.ledger, chart: tidied };
  state.persistent = await savePart(state.ledger, "chart");
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
async function ensureDefaultEntity(): Promise<void> {
  const model = state.ledger.entities ?? emptyEntityModel();
  if (model.entities.length > 0) return;
  const bankAccounts = [...banks().accounts];
  if (state.chart.length === 0 && bankAccounts.length === 0) return;
  await saveEntities(
    defaultEntityModel(state.chart, bankAccounts),
    `Started with one entity, ${DEFAULT_ENTITY_NAME}`,
  );
}

async function saveEntities(model: EntityModel, what = "Entities changed"): Promise<void> {
  const before = state.ledger.entities;
  state.ledger = { ...state.ledger, entities: model };
  state.persistent = await savePart(state.ledger, "entities");
  await record("entities", what, before ?? null, model);
  renderEntities();
}

/**
 * The financial year a date falls in, labelled by the year it ends in.
 *
 * New Zealand's ends on 31 March, so April 2025 to March 2026 is FY2026.
 */
function financialYearOf(date: string): number {
  const year = Number(date.slice(0, 4));
  return date.slice(5, 7) >= "04" ? year + 1 : year;
}

/** Which codes belong to the entity being reported on, and how each is treated. */
/**
 * How a posted line is named on a report.
 *
 * A chart account is found by its code where it has one, and by its name where
 * it does not. The name half matters: an account with no code used to produce
 * an empty label, and a report skips lines it cannot name -- so the three
 * rentals, whose accounts are all named rather than numbered, had nothing at
 * all on either accrual basis while the cash one worked from the coding label
 * directly.
 *
 * The label is the same string the cash report and the entity filter use, so
 * the three agree about what an account is called.
 */
function reportLabeller(): (line: { accountCode: string; accountName: string }) => string {
  const known = knownCodes(state.rules, state.ledger.overrides ?? {});
  const byCode = new Map<string, Account>();
  const byName = new Map<string, Account>();
  for (const account of state.chart) {
    const code = account.code.trim();
    if (code !== "") byCode.set(code, account);
    const name = account.name.trim().toLowerCase();
    if (name !== "" && !byName.has(name)) byName.set(name, account);
  }

  return (line) => {
    const code = line.accountCode.trim();
    const found = code !== "" ? byCode.get(code) : byName.get(line.accountName.trim().toLowerCase());
    if (found) return labelForChartAccount(found, known);
    if (code !== "") return `${code} ${line.accountName}`.trim();
    return line.accountName.trim();
  };
}

function reportLookups(): {
  entityOfCode: Map<string, string>;
  sectionOf: (code: string) => ReportSection | null;
} {
  const model = state.ledger.entities ?? emptyEntityModel();
  const entityOfCode = new Map<string, string>();
  const sections = new Map<string, ReportSection | null>();

  for (const { account, label } of accountsForEditing()) {
    const id = model.accounts[accountEntityKey(account)];
    if (id !== undefined) entityOfCode.set(label, id);
    sections.set(label, sectionForType(account.type));
  }

  return { entityOfCode, sectionOf: (code) => sections.get(code) ?? null };
}

/** Build the report currently selected, or null when there is nothing to build. */
function currentReport(
  /**
   * A shorter span than the year, for a chart plotting month by month.
   *
   * The charts run this same builder rather than totalling transactions
   * themselves, so a bar and the profit and loss cannot come to disagree:
   * whatever basis, entity, and GST choice the page is set to applies to
   * both, and there is one place where that is decided.
   */
  over?: DateRange,
): { report: ProfitAndLoss; title: string; year: number } | null {
  if (state.ledger.transactions.length === 0) return null;

  // Above the figures, not below them: a warning under a total is read after
  // the total has already been believed. Not while filling in a chart: the
  // note belongs to the page, and writing it twelve times would only move it.
  if (over === undefined) {
    const hint = $("reports-hint");
    hint.parentElement?.querySelector(".unresolved-note")?.remove();
    const unresolved = unresolvedNote();
    if (unresolved) hint.insertAdjacentElement("afterend", unresolved);
  }

  const years = [
    ...new Set(state.ledger.transactions.map((t) => financialYearOf(t.date))),
  ].sort((a, b) => b - a);
  const chosenYear = Number($<HTMLSelectElement>("report-year").value) || years[0];
  if (chosenYear === undefined) return null;

  const model = state.ledger.entities ?? emptyEntityModel();
  const entityValue = state.entityFilter;
  const entity = model.entities.find((e) => e.id === entityValue);
  const { entityOfCode, sectionOf } = reportLookups();

  const journals = state.ledger.journals ?? [];
  const basis = $<HTMLSelectElement>("report-basis").value;
  // Only where it can be honoured. A ledger read from a file keeps its GST on
  // separate lines with nothing tying them to the cost, so there is no gross
  // to report and pretending otherwise would just show the net twice.
  const includeGst = $<HTMLSelectElement>("report-gst").value === "gross" && basis !== "accrual";
  const period = over ?? { from: `${chosenYear - 1}-04-01`, to: `${chosenYear}-03-31` };

  if (basis === "posted") {
    const ours = ourAccrualJournals();
    return {
      report: accrualProfitAndLoss(ours, {
        period,
        sectionOf,
        includeGst,
        labelOf: reportLabeller(),
        ...(entity ? { includeCode: (code: string) => entityOfCode.get(code) === entity.id } : {}),
      }),
      title: entity ? entity.name : "All accounts",
      year: chosenYear,
    };
  }

  if (basis === "accrual" && journals.length > 0) {
    // The ledger names accounts by code; the report names them the way the
    // rest of the app does, so the two can sit side by side.
    const labelOf = reportLabeller();
    return {
      report: accrualProfitAndLoss(journals, {
        period,
        sectionOf,
        includeGst,
        labelOf,
        ...(entity ? { includeCode: (code: string) => entityOfCode.get(code) === entity.id } : {}),
      }),
      title: entity ? entity.name : "All accounts",
      year: chosenYear,
    };
  }

  const engine = reportEngine();
  if (!engine) return null;
  const { transactions, codeOf, classify } = engine;

  const report = profitAndLoss(transactions, {
    period,
    codeOf,
    classify,
    sectionOf,
    includeGst,
    // With no entity chosen the whole ledger is reported, which is the right
    // default before any account has been assigned to one.
    ...(entity
      ? { includeCode: (code: string) => entityOfCode.get(code) === entity.id }
      : {}),
    // A bank account serving this entity narrows it further, when one is set.
    ...(entity && Object.keys(model.banks).length > 0
      ? {
          accounts: Object.entries(model.banks)
            .filter(([, ids]) => ids.includes(entity.id))
            .map(([account]) => account),
        }
      : {}),
  });

  return {
    report,
    title: entity ? entity.name : "All accounts",
    year: chosenYear,
  };
}

/**
 * Coding and GST, set up once for a report.
 *
 * Splits are expanded first: a payment divided across accounts reaches the
 * profit figure as its parts, not as whichever code the parent carries.
 */
function reportEngine(): {
  transactions: Transaction[];
  codeOf: (t: Transaction) => string | null;
  classify: (t: Transaction) => ReturnType<ReturnType<typeof gstResolver>>;
} | null {
  if (state.ledger.transactions.length === 0) return null;
  const expanded = expandSplits(
    state.ledger.transactions,
    state.ledger.splits ?? {},
    state.ledger.overrides ?? {},
  );
  const ruleFile = state.rules as RuleFileShape | undefined;
  const codingRules = { ...(ruleFile ?? {}), overrides: expanded.overrides } as RuleSet;
  const codeOf = (t: Transaction) => categorise(t, codingRules).code;
  const all = new Set(state.ledger.transactions.map((t) => t.account));
  const classify = gstResolver({
    ownAccounts: all,
    relatedAccounts: all,
    ...(ruleFile?.gstRules ? { rules: ruleFile.gstRules as never } : {}),
    ...(ruleFile?.codeTreatments ? { codeTreatments: ruleFile.codeTreatments as never } : {}),
    // So a report says the same thing the Entities and Accounts page shows.
    chartTreatment: (code: string) => chartTreatmentOf(code) as never,
    codeOf,
    overrides: expanded.overrides,
  });
  return { transactions: expanded.transactions, codeOf, classify };
}

/**
 * Every entity's result for the year, with who owns it.
 *
 * Built once and shared, because an owner summary needs all of them and a
 * profit and loss needs one.
 */
function entityReports(year: number): {
  entity: Entity;
  report: ProfitAndLoss;
}[] {
  const model = state.ledger.entities ?? emptyEntityModel();
  const { entityOfCode, sectionOf } = reportLookups();
  const engine = reportEngine();
  if (!engine) return [];

  return model.entities.map((entity) => ({
    entity,
    report: profitAndLoss(engine.transactions, {
      period: { from: `${year - 1}-04-01`, to: `${year}-03-31` },
      codeOf: engine.codeOf,
      classify: engine.classify,
      sectionOf,
      includeCode: (code: string) => entityOfCode.get(code) === entity.id,
    }),
  }));
}

/** One owner's share of every entity they own part of. */
function ownerSummaryFor(owner: string, year: number): OwnerSummary {
  return summariseForOwner(
    owner,
    entityReports(year).map(({ entity, report }) => ({
      entity: entity.name,
      kind: entity.kind ?? "business",
      percent: (entity.owners ?? []).find((o) => o.name === owner)?.percent ?? 0,
      report,
    })),
  );
}

/**
 * Read a general ledger export and keep it with the ledger.
 *
 * The file is Windows-1252, like every other Xero export, so it is decoded the
 * same way the reference loader does rather than assumed to be UTF-8.
 */
/**
 * A dropped file as CSV text, whichever of the two shapes it arrived in.
 *
 * The readers here are written against the CSV a system exports, because that
 * is where the column names are stable. But the same report often comes out of
 * the same system as a spreadsheet -- Xero's Journal Report does -- and
 * refusing it means going back to export it again in another format, knowing
 * to. The sheet is turned into the text the reader already understands.
 */
async function asCsvText(name: string, bytes: Uint8Array): Promise<string> {
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

async function loadJournals(file: File): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const text = await asCsvText(file.name, bytes);

  const parsed = parseXeroJournalReport(text);
  if (parsed.journals.length === 0) {
    alert(
      `${file.name} holds no journals. Export one from Xero as ` +
        "Accounting > Reports > Journal Report.",
    );
    return;
  }
  // A General Ledger Detail export parses into journals perfectly well and
  // values every line, which the Journal Report does not -- but it carries no
  // Narration column, and a narration is the only thing that distinguishes a
  // manual year-end journal from an ordinary posting. Replacing a narrated set
  // with an unnarrated one therefore loses every manual journal silently,
  // which on one real ledger was three of them and 3,354.78 of interest that
  // came back as an expense. So it is asked about rather than done.
  const held = state.ledger.journals ?? [];
  const incomingNarrated = parsed.journals.some((j) => j.narration.trim() !== "");
  const heldNarrated = held.filter((j) => j.narration.trim() !== "").length;
  if (!incomingNarrated && heldNarrated > 0) {
    const ok = confirm(
      `${file.name} has no Narration column, so no journal in it can be recognised as a ` +
        `manual one.\n\nThe ${held.length} journals already loaded include ${heldNarrated} ` +
        "with a narration. Replacing them would lose every year-end journal your accountant " +
        "made.\n\nReplace them anyway?",
    );
    if (!ok) return;
  }

  state.ledger = { ...state.ledger, journals: parsed.journals };
  state.persistent = await savePart(state.ledger, "journals");
  renderReportsPage();
}

/** Read a fixed asset register and keep it with the ledger. */
async function loadAssets(file: File): Promise<void> {
  const parsed = parseFixedAssets(await file.text());
  if (parsed.assets.length === 0) {
    alert(
      `${file.name} holds no assets. Export one from Xero as Accounting > Fixed assets > Export.`,
    );
    return;
  }
  state.ledger = { ...state.ledger, assets: parsed.assets };
  state.persistent = await savePart(state.ledger, "assets");
  if (parsed.problems.length > 0) {
    alert(
      `${parsed.assets.length} assets loaded. ${parsed.problems.length} could not be read:\n` +
        parsed.problems.slice(0, 5).map((p) => p.message).join("\n"),
    );
  }
  renderReportsPage();
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
function postedJournals(): PostedJournal[] {
  const engine = reportEngine();
  if (!engine) return [];

  const byName = new Map(state.chart.map((a) => [a.name.trim().toLowerCase(), a]));
  const resolveAccount = (code: string): { code: string; name: string } => {
    const { code: digits, name } = splitAccountLabel(code);
    const account = byName.get(name.toLowerCase());
    return { code: digits || account?.code || "", name: account?.name ?? name };
  };
  const labels = new Map(
    state.ledger.transactions.map((t) => [t.account, String(t.extras?.["accountLabel"] ?? t.account)]),
  );

  const options = {
    resolveAccount,
    nameBankAccount: (a: string) => labels.get(a) ?? a,
  };

  // Which receipt settled which invoice. Anything a person has accepted wins;
  // the matcher fills in the rest. Without this an invoiced sale is posted
  // twice — once when raised and again when the money arrives — which on this
  // ledger overstated income by a third.
  const invoices = state.ledger.invoices ?? [];
  const byNumber = new Map(invoices.map((i) => [i.number, i]));
  const settled = invoiceAssignments();

  // A transfer is one journal for two bank lines. Posting each leg separately
  // is right only if both happen to be coded to the same clearing account;
  // posted as a pair there is no account in the middle at all. The pair is
  // emitted once, from the leg the money left, and the other leg is skipped --
  // otherwise the movement is counted twice.
  const transfers = state.ledger.transfers ?? {};
  const byId = new Map(state.ledger.transactions.map((t) => [t.id, t]));
  const transferJournals: PostedJournal[] = [];
  const postedAsTransfer = new Set<string>();
  for (const [legId, partnerId] of Object.entries(transfers)) {
    const leg = byId.get(legId);
    const partner = byId.get(partnerId);
    if (leg === undefined || partner === undefined) continue;
    // Both halves are recorded, so take the outgoing one and ignore its mirror.
    if (leg.amount >= 0) continue;
    transferJournals.push(postTransfer({ from: leg, to: partner }, options));
    postedAsTransfer.add(leg.id);
    postedAsTransfer.add(partner.id);
  }

  const bank = engine.transactions.flatMap((t) => {
    if (postedAsTransfer.has(t.id)) return [];
    const invoice = byNumber.get(settled.get(t.id) ?? "");
    if (invoice) {
      return [
        postTransaction(t, [], {
          ...options,
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
        [{ amount: t.amount, code: engine.codeOf(t), classification: engine.classify(t) }],
        options,
      ),
    ];
  });

  const raised = invoices.map((invoice) => postInvoice(invoice, options));
  return [
    ...bank,
    ...transferJournals,
    ...raised,
    ...depreciationJournals(options),
    ...disposalJournals(options),
    // The judgements, last, because they correct what everything above worked
    // out: an expense reclassified, a balance brought to what a third party
    // actually holds. An unbalanced one is refused rather than posted.
    ...(state.ledger.manualJournals ?? [])
      .map((journal) => postManualJournal(journal, options))
      .filter((journal): journal is PostedJournal => journal !== null),
  ];
}

/**
 * The disposals, posted.
 *
 * An asset that leaves has to leave the balance sheet too: its cost out of the
 * asset account, the depreciation claimed out of the contra, and the difference
 * between what it was worth and what it fetched split three ways -- recovered
 * depreciation, capital gain, loss on sale -- because New Zealand taxes those
 * differently and one combined figure loses the distinction.
 *
 * Only where the proceeds are known. Without them nothing is posted at all,
 * because a disposal is not a fact about the asset alone: guessing at nil
 * proceeds would write off the whole book value as a loss and understate the
 * profit by exactly the amount it sold for.
 */
function disposalJournals(options: {
  resolveAccount: (code: string) => { code: string; name: string };
}): PostedJournal[] {
  const assets = state.ledger.assets ?? [];
  const proceeds = state.ledger.assetProceeds ?? {};
  if (assets.length === 0 || Object.keys(proceeds).length === 0) return [];

  const years = [...new Set(state.ledger.transactions.map((t) => financialYearOf(t.date)))];
  const accumulated = state.chart.filter((a) => /accumulated depreciation/i.test(a.name));

  const out: PostedJournal[] = [];
  for (const year of years) {
    const schedule = depreciationSchedule(assets, {
      from: `${year - 1}-04-01`,
      to: `${year}-03-31`,
    });
    for (const row of schedule.rows) {
      if (!row.disposedInPeriod) continue;
      const sold = proceeds[row.asset.number];
      if (sold === undefined) continue;

      // The asset account, and the contra that carries its depreciation. Both
      // are found by name against the asset's own class, the way the
      // depreciation posting does it, so a ledger with several asset classes
      // does not credit one class's depreciation to another's contra.
      const assetAccount = chartAccountFor(row.asset.type);
      const contra = bestMatch(accumulated, row.asset.type);

      const disposal = disposalOf({
        cost: row.asset.cost,
        accumulatedDepreciation: row.asset.cost - row.bookValueAtDisposal,
        proceeds: sold,
      });

      out.push(
        postDisposal(
          {
            assetNumber: row.asset.number,
            assetName: row.asset.name,
            date: row.asset.disposed ?? `${year}-03-31`,
            disposal,
          },
          {
            assetCode: assetAccount?.code ?? "730",
            ...(assetAccount?.name ? { assetName: assetAccount.name } : {}),
            accumulatedCode: contra?.code ?? "731",
            ...(contra?.name ? { accumulatedName: contra.name } : {}),
          },
          options,
        ),
      );
    }
  }
  return out;
}

/** The chart account an asset class is carried in, by name. */
function chartAccountFor(type: string): Account | undefined {
  const fixed = state.chart.filter(
    (a) => /fixed asset/i.test(a.type) && !/accumulated depreciation/i.test(a.name),
  );
  return bestMatch(fixed, type);
}

/**
 * The account whose name best matches an asset class.
 *
 * Scored rather than first-found: "Roasting equipment" shares the word
 * "equipment" with Office Equipment, and taking the first hit put a whole
 * class's depreciation against the wrong contra account. The distinctive word
 * is the long one, so longer matches count for more.
 */
function bestMatch(candidates: readonly Account[], type: string): Account | undefined {
  const words = type.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  let chosen = candidates[0];
  let best = 0;
  for (const candidate of candidates) {
    const name = candidate.name.toLowerCase();
    let score = 0;
    for (const word of words) if (name.includes(word)) score += word.length;
    if (score > best) {
      best = score;
      chosen = candidate;
    }
  }
  return chosen;
}

/**
 * A year's depreciation, posted per asset class.
 *
 * The contra is looked up in the chart by name, because an accumulated
 * depreciation account is named after the class it belongs to and getting it
 * wrong would put the credit in the wrong place on a balance sheet.
 */
function depreciationJournals(options: {
  resolveAccount: (code: string) => { code: string; name: string };
}): PostedJournal[] {
  const assets = state.ledger.assets ?? [];
  if (assets.length === 0) return [];

  const years = [...new Set(state.ledger.transactions.map((t) => financialYearOf(t.date)))];
  const accumulated = state.chart.filter((a) => /accumulated depreciation/i.test(a.name));
  const expense = state.chart.find((a) => /^depreciation$/i.test(a.name.trim()));

  const out: PostedJournal[] = [];
  for (const year of years) {
    const schedule = depreciationSchedule(assets, {
      from: `${year - 1}-04-01`,
      to: `${year}-03-31`,
    });
    for (const group of schedule.byType) {
      if (group.depreciation === 0) continue;
      // Score, do not take the first hit. "Roasting equipment" shares the
      // word "equipment" with Office Equipment, and first-found put the whole
      // roasting charge against the wrong contra account. The distinctive
      // word is the long one, so longer matches count for more.
      const words = group.type.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
      let contra = accumulated[0];
      let best = 0;
      for (const account of accumulated) {
        const name = account.name.toLowerCase();
        const score = words.reduce((sum, w) => (name.includes(w) ? sum + w.length : sum), 0);
        if (score > best) {
          best = score;
          contra = account;
        }
      }
      out.push(
        postDepreciation({
          name: group.type,
          expenseCode: expense?.code ?? "416",
          expenseName: expense?.name ?? "Depreciation",
          accumulatedCode: contra?.code ?? "",
          accumulatedName: contra?.name ?? `Less Accumulated Depreciation — ${group.type}`,
          amount: group.depreciation,
          date: `${year}-03-31`,
        }),
      );
    }
  }
  return out;
}

/** Our own postings, in the shape the accrual report reads. */
function ourAccrualJournals(): Journal[] {
  return postedJournals().map((journal, index) => ({
    id: journal.transactionId,
    date: journal.date,
    narration: journal.narration,
    // Derived, not entered: there is no posting date or author to record,
    // because nobody posted them — they are recomputed from the coding.
    postedDate: journal.date,
    postedBy: "derived",
    lines: journal.lines.map((line, n) => ({
      accountCode: line.accountCode,
      accountName: line.accountName,
      description: line.description,
      amount: line.amount,
      ...(line.taxBase !== undefined ? { taxBase: line.taxBase } : {}),
      line: index * 100 + n,
    })),
  }));
}

/**
 * Manual journals: the entries a person writes and no bank line implies.
 *
 * Shown with their narration, because that is the part that matters a year
 * later. The figures will still be obvious then; why somebody moved 3,354.78
 * out of interest and into drawings will not.
 */
function renderManualJournals(body: HTMLElement, year: number): void {
  const from = `${year - 1}-04-01`;
  const to = `${year}-03-31`;
  const all = state.ledger.manualJournals ?? [];
  const held = all.filter((j) => j.date >= from && j.date <= to);

  const heading = document.createElement("h3");
  heading.textContent = `Manual journals, year ended 31 March ${year}`;
  body.append(heading);

  const actions = document.createElement("div");
  actions.className = "page-actions";
  const add = document.createElement("button");
  add.type = "button";
  add.textContent = "Write a journal";
  add.addEventListener("click", () => void writeManualJournal(to));
  actions.append(add);

  // Only offered when there is a report to read them out of, and only for the
  // ones not already held.
  const importable = manualJournalsIn(state.ledger.journals ?? []).filter(
    (j) => !all.some((existing) => existing.id === j.id),
  );
  if (importable.length > 0) {
    const take = document.createElement("button");
    take.type = "button";
    take.textContent = `Read ${importable.length} from the journal report`;
    take.addEventListener("click", () => void importManualJournals());
    actions.append(take);
  }
  body.append(actions);

  if (held.length === 0) {
    body.append(
      note(
        "None in this year. These are the year-end judgements: an expense reclassified because " +
          "the loan turned out to be personal, a GST balance corrected to what Inland Revenue " +
          "actually holds. Nothing in the bank data implies them, so they have to be written.",
      ),
    );
    return;
  }

  const money = (cents: Cents): string =>
    (cents / 100).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  for (const journal of [...held].sort((a, b) => a.date.localeCompare(b.date))) {
    const problems = checkManualJournal(journal);

    const card = document.createElement("div");
    card.className = problems.length > 0 ? "journal-card journal-broken" : "journal-card";

    const title = document.createElement("p");
    title.className = "journal-narration";
    title.textContent = `${journal.date} — ${journal.narration}`;
    card.append(title);

    if (problems.length > 0) {
      const bad = document.createElement("p");
      bad.className = "journal-out";
      bad.textContent =
        `Not posted: ${problems.map((p) => p.message).join("; ")}. ` +
        "An unbalanced journal is a broken one, so it is left out of the reports rather than " +
        "put in with the difference hidden inside them.";
      card.append(bad);
    }

    const table = document.createElement("table");
    table.className = "report-table opening-table";
    const tbody = document.createElement("tbody");
    for (const line of journal.lines) {
      const row = document.createElement("tr");
      row.append(nameCell(line.code));
      row.append(amountCell(line.amount > 0 ? money(line.amount) : ""));
      row.append(amountCell(line.amount < 0 ? money(-line.amount) : ""));
      tbody.append(row);
    }
    table.append(tbody);
    card.append(table);

    if (journal.source !== undefined && journal.source !== "") {
      card.append(note(journal.source));
    }

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "link-button";
    remove.textContent = "remove";
    remove.addEventListener("click", () => void removeManualJournal(journal, year));
    card.append(remove);
    body.append(card);
  }
}

/** Write one by hand. Two lines, which is what a correction almost always is. */
async function writeManualJournal(defaultDate: IsoDate): Promise<void> {
  const date = window.prompt("Date of the journal", defaultDate);
  if (date === null || !/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) return;
  const narration = window.prompt(
    "Why does this journal exist?\n\n" +
      "In your own words. A year from now the figures will be obvious and the reason will not.",
    "",
  );
  if (narration === null || narration.trim() === "") return;

  const codes = knownCodes(state.rules, state.ledger.overrides ?? {});
  const debit = window.prompt(`Account to debit\n\n${codes.slice(0, 12).join("\n")}`, "");
  if (debit === null || debit.trim() === "") return;
  const credit = window.prompt("Account to credit", "");
  if (credit === null || credit.trim() === "") return;
  const amount = window.prompt("Amount", "0.00");
  if (amount === null) return;
  const cents = parseAmount(amount.trim());
  if (cents === null || cents === 0) {
    alert(`"${amount}" is not an amount.`);
    return;
  }

  const journal: ManualJournal = {
    id: `m${Date.now().toString(36)}`,
    date: date.trim(),
    narration: narration.trim(),
    lines: [
      { code: debit.trim(), amount: Math.abs(cents) },
      { code: credit.trim(), amount: -Math.abs(cents) },
    ],
  };
  await saveManualJournals([...(state.ledger.manualJournals ?? []), journal], `Journal: ${journal.narration}`);
}

async function removeManualJournal(journal: ManualJournal, year: number): Promise<void> {
  if (!confirm(`Remove this journal?\n\n${journal.date} — ${journal.narration}`)) return;
  const kept = (state.ledger.manualJournals ?? []).filter((j) => j.id !== journal.id);
  await saveManualJournals(kept, `Removed journal: ${journal.narration}`);
  void year;
}

/** Read the manual journals out of an imported journal report. */
async function importManualJournals(): Promise<void> {
  const held = state.ledger.manualJournals ?? [];
  const found = manualJournalsIn(state.ledger.journals ?? []).filter(
    (j) => !held.some((existing) => existing.id === j.id),
  );
  if (found.length === 0) {
    alert("No manual journals in the report that are not already held.");
    return;
  }
  const listed = found
    .map((j) => `  ${j.date}  ${j.narration.slice(0, 60)}`)
    .join("\n");
  if (!confirm(`Take ${found.length} manual journal${found.length === 1 ? "" : "s"}?\n\n${listed}`)) return;
  await saveManualJournals([...held, ...found], `Read ${found.length} manual journals from the report`);
}

async function saveManualJournals(journals: ManualJournal[], what: string): Promise<void> {
  const before = state.ledger.manualJournals ?? null;
  state.ledger = { ...state.ledger, manualJournals: journals };
  state.persistent = await savePart(state.ledger);
  await record("manualJournal", what, before, journals, "manualJournals");
  reclassify();
  renderReportsPage();
}

/**
 * The shareholder current account schedule.
 *
 * In a closely held company this is usually the busiest account in the books,
 * and it carries a question the balance sheet only hints at: does the company
 * owe the shareholder, or the shareholder owe the company? Which way it points
 * has tax consequences, so it gets its own page rather than one line among the
 * liabilities.
 */
function renderShareholders(body: HTMLElement, year: number): void {
  const schedule = shareholderSchedule({
    from: `${year - 1}-04-01`,
    to: `${year}-03-31`,
    journals: postedJournals(),
    ...(state.ledger.openingBalances ? { openingBalances: state.ledger.openingBalances } : {}),
    chart: state.chart,
  });

  const heading = document.createElement("h3");
  heading.textContent = `Shareholder current account, year ended 31 March ${year}`;
  body.append(heading);

  const money = (cents: Cents): string =>
    (cents / 100).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const warning = overdrawnWarning(schedule);
  if (warning !== null) {
    const flag = document.createElement("p");
    flag.className = "journal-out";
    flag.textContent = warning;
    body.append(flag);
  }

  const table = document.createElement("table");
  table.className = "report-table balance-sheet";
  const head = document.createElement("thead");
  head.innerHTML = "<tr><th></th><th>Amount</th></tr>";
  const tbody = document.createElement("tbody");

  const line = (label: string, amount: Cents, cls = ""): void => {
    const row = document.createElement("tr");
    if (cls !== "") row.className = cls;
    row.append(nameCell(label));
    row.append(amountCell(money(amount)));
    tbody.append(row);
  };

  line(`Balance at 1 April ${year - 1}`, schedule.opening, "bs-total");
  line("Funds introduced", schedule.introduced);
  line("Drawings", -schedule.drawings);
  line(`Balance at 31 March ${year}`, schedule.closing, "bs-grand");

  if (schedule.movements.length > 0) {
    const header = document.createElement("tr");
    header.className = "bs-section";
    const cell = document.createElement("td");
    cell.colSpan = 2;
    cell.textContent = "Made up of";
    header.append(cell);
    tbody.append(header);
    for (const movement of schedule.movements) {
      if (movement.introduced !== 0) {
        line(`${movement.code} ${movement.name} — in`, movement.introduced);
      }
      if (movement.drawings !== 0) {
        line(`${movement.code} ${movement.name} — out`, -movement.drawings);
      }
    }
  }

  table.append(head, tbody);
  body.append(table);

  body.append(
    note(
      schedule.overdrawn
        ? "A credit balance is simply money the company owes and nothing follows from it. This " +
          "one is the other way round, which is why it is flagged above."
        : "A credit balance is money the company owes the shareholder, which is the ordinary " +
          "state of the account and needs nothing done about it. An overdrawn balance would be " +
          "flagged here, because Inland Revenue expects interest or fringe benefit tax on it.",
    ),
  );
}

/**
 * The IR10, which Inland Revenue wants with a company's IR4.
 *
 * A summary of figures the books already hold, arranged into the form's own
 * numbered boxes. It is not a tax computation: the form asks for profit before
 * tax, and the adjustments that turn that into taxable income -- non-deductible
 * entertainment added back, tax depreciation in place of accounting
 * depreciation, losses brought forward -- belong to the IR4 and are not done
 * here. That is said on the page, because a form that looks finished is exactly
 * the sort of thing somebody files.
 */
function renderIr10(body: HTMLElement, year: number): void {
  const summary = ir10Summary({
    yearEnding: `${year}-03-31`,
    yearStarting: `${year - 1}-04-01`,
    journals: postedJournals(),
    ...(state.ledger.openingBalances ? { openingBalances: state.ledger.openingBalances } : {}),
    chart: state.chart,
  });

  const heading = document.createElement("h3");
  heading.textContent = `IR10 financial statements summary, year ended 31 March ${year}`;
  body.append(heading);

  if (state.ledger.openingBalances === undefined) {
    const warn = document.createElement("p");
    warn.className = "journal-out";
    warn.textContent =
      "No opening balances, so every balance sheet box below is only the movement since the " +
      "first transaction. The income and expense boxes are unaffected.";
    body.append(warn);
  }

  const money = (cents: Cents): string =>
    (cents / 100).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const table = document.createElement("table");
  table.className = "report-table balance-sheet";
  const head = document.createElement("thead");
  head.innerHTML = "<tr><th>Box</th><th>What the form calls it</th><th>Amount</th></tr>";
  const tbody = document.createElement("tbody");

  const section = (title: string, boxes: readonly number[]): void => {
    const shown = boxes.filter((b) => summary.boxes[b] !== undefined);
    if (shown.length === 0) return;
    const header = document.createElement("tr");
    header.className = "bs-section";
    const cell = document.createElement("td");
    cell.colSpan = 3;
    cell.textContent = title;
    header.append(cell);
    tbody.append(header);

    for (const number of shown) {
      const box = summary.boxes[number];
      if (box === undefined) continue;
      const row = document.createElement("tr");
      // A box the form works out is marked, because somebody checking against
      // a set of accounts should know which figures came from an account and
      // which are the form's own arithmetic.
      if (ir10IsCalculated(number)) row.className = "bs-total";
      row.append(nameCell(String(number)));
      row.append(nameCell(box.title));
      row.append(amountCell(money(box.amount)));
      tbody.append(row);
    }
  };

  section("Income", [2, 3, 4, 5, 6, 7, 10, 11]);
  section("Expenses", [13, 14, 15, 16, 18, 19, 22, 23, 24, 25]);
  section("Profit", [26]);
  section("Assets", [27, 28, 29, 31]);
  section("Liabilities and equity", [34, 35, 37, 38]);

  table.append(head, tbody);
  body.append(table);

  // The one arithmetic check the form itself makes possible, said out loud.
  const assets = summary.totalAssets;
  const claimed = summary.totalLiabilities + summary.totalEquity;
  const check = document.createElement("p");
  check.className = assets === claimed ? "journal-balanced" : "journal-out";
  check.textContent =
    assets === claimed
      ? `Assets ${money(assets)} equal liabilities and equity.`
      : `Assets ${money(assets)} against liabilities and equity of ${money(claimed)} — ` +
        `a difference of ${money(assets - claimed)}. Something is out.`;
  body.append(check);

  body.append(
    note(
      "This is a summary of the accounts, not a tax return. The IR4 adds the adjustments that " +
        "turn profit before tax into taxable income: non-deductible entertainment added back, " +
        "tax depreciation in place of accounting depreciation, losses brought forward, and " +
        "imputation credits. None of those is done here.",
    ),
  );
}

/**
 * The balance sheet: what the company owns and owes on a day.
 *
 * The one report here that cannot be produced from bank data alone. A profit
 * figure is a year's movement and the transactions carry all of it, but a
 * balance is a running total since the company started -- so a set of books
 * that begins partway through needs the position it inherited, or every figure
 * is only the movement since the first bank line. That is not a smaller balance
 * sheet, it is a wrong one, and it is said rather than left to be discovered.
 */
function renderBalanceSheet(body: HTMLElement, year: number): void {
  const asAt = `${year}-03-31`;
  const opening = state.ledger.openingBalances;
  const sheet = computeBalanceSheet({
    asAt,
    ...(opening ? { openingBalances: opening } : {}),
    journals: postedJournals(),
    chart: state.chart,
  });

  const heading = document.createElement("h3");
  heading.textContent = `Balance sheet as at 31 March ${year}`;
  body.append(heading);

  const money = (cents: Cents): string =>
    (cents / 100).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (opening === undefined) {
    const warn = document.createElement("p");
    warn.className = "journal-out";
    warn.textContent =
      "No opening balances, so this is the movement since the first transaction rather than " +
      "what the company owns and owes. Set them on the Entities and accounts page — a trial " +
      "balance from the previous year end can be loaded there.";
    body.append(warn);
  }

  // The proof, first, in the same words the journal report uses. A balance
  // sheet that does not balance is not a figure to read past.
  const proof = document.createElement("p");
  proof.className = sheet.imbalance === 0 ? "journal-balanced" : "journal-out";
  proof.textContent =
    sheet.imbalance === 0
      ? "Balanced. Net assets equal total equity."
      : `Out of balance by ${money(sheet.imbalance)}. Either the opening balances do not ` +
        "balance or a journal does not; this is a bug, not a figure.";
  body.append(proof);

  // Scope, said plainly. Opening balances are held for the ledger rather than
  // per entity, so a balance sheet cannot honestly be filtered to one.
  const entities = state.ledger.entities?.entities ?? [];
  if (entities.length > 1) {
    body.append(
      note(
        "This covers the whole ledger. Opening balances are held once for the books rather " +
          "than per entity, so a balance sheet cannot be split between them.",
      ),
    );
  }

  const table = document.createElement("table");
  table.className = "report-table balance-sheet";
  const head = document.createElement("thead");
  head.innerHTML =
    `<tr><th>Account</th><th>Opening</th><th>Movement</th><th>As at 31 Mar ${year}</th></tr>`;
  const tbody = document.createElement("tbody");

  const section = (title: string, lines: readonly BalanceSheetLine[], total: Cents): void => {
    if (lines.length === 0 && total === 0) return;
    const header = document.createElement("tr");
    header.className = "bs-section";
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.textContent = title;
    header.append(cell);
    tbody.append(header);

    for (const line of lines) {
      const row = document.createElement("tr");
      row.append(nameCell(line.code === "" ? line.name : `${line.code} ${line.name}`));
      row.append(amountCell(line.opening === 0 ? "" : money(line.opening)));
      row.append(amountCell(line.movement === 0 ? "" : money(line.movement)));
      row.append(amountCell(money(line.closing)));
      tbody.append(row);
    }

    const sum = document.createElement("tr");
    sum.className = "bs-total";
    sum.append(nameCell(`Total ${title.toLowerCase()}`));
    sum.append(amountCell(""));
    sum.append(amountCell(""));
    sum.append(amountCell(money(total)));
    tbody.append(sum);
  };

  const grand = (label: string, amount: Cents): void => {
    const row = document.createElement("tr");
    row.className = "bs-grand";
    row.append(nameCell(label));
    row.append(amountCell(""));
    row.append(amountCell(""));
    row.append(amountCell(money(amount)));
    tbody.append(row);
  };

  section(sheet.currentAssets.title, sheet.currentAssets.lines, sheet.currentAssets.total);
  section(sheet.nonCurrentAssets.title, sheet.nonCurrentAssets.lines, sheet.nonCurrentAssets.total);
  grand("Total assets", sheet.totalAssets);
  section(sheet.currentLiabilities.title, sheet.currentLiabilities.lines, sheet.currentLiabilities.total);
  section(
    sheet.nonCurrentLiabilities.title,
    sheet.nonCurrentLiabilities.lines,
    sheet.nonCurrentLiabilities.total,
  );
  grand("Total liabilities", sheet.totalLiabilities);
  grand("Net assets", sheet.netAssets);
  section(sheet.equity.title, sheet.equity.lines, sheet.equity.total);
  grand("Total equity", sheet.totalEquity);

  table.append(head, tbody);
  body.append(table);

  body.append(
    note(
      opening === undefined
        ? "Every figure is the movement on that account since the ledger begins."
        : `Opening figures are as at ${opening.asAt}${opening.source ? ` — ${opening.source}` : ""}. ` +
          "Movement is what the postings since then have done to each account.",
    ),
  );
}

function renderJournal(body: HTMLElement, year: number): void {
  const from = `${year - 1}-04-01`;
  const to = `${year}-03-31`;
  const accounts = entityBankAccounts();
  const journals = postedJournals().filter((j) => {
    if (j.date < from || j.date > to) return false;
    if (accounts.length === 0) return true;
    return j.lines.some((l) => accounts.includes(l.accountCode));
  });

  const heading = document.createElement("h3");
  heading.textContent = `Journal and trial balance, FY${year}`;
  body.append(heading);

  if (journals.length === 0) {
    body.append(note("No transactions in this year for the chosen entity."));
    return;
  }

  const balance = trialBalance(journals);
  const tax = taxSummary(journals);
  const money = (cents: number): string =>
    (cents / 100).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // The imbalance is the whole point: a single-entry ledger cannot tell you it
  // is complete, and this one can.
  const proof = document.createElement("p");
  proof.className = balance.imbalance === 0 ? "journal-balanced" : "journal-out";
  proof.textContent =
    balance.imbalance === 0
      ? `Balanced. ${journals.length} journals, ` +
        `${journals.reduce((n, j) => n + j.lines.length, 0)} lines, debits equal credits.`
      : `Out of balance by ${money(balance.imbalance)} across ${journals.length} journals — ` +
        `${balance.unbalanced.length} do not balance on their own. This is a bug, not a figure.`;
  body.append(proof);

  const summary = document.createElement("div");
  summary.className = "check-summary";
  for (const [value, label] of [
    [money(tax.box5), "Box 5 gross sales"],
    [money(tax.box8), "Box 8 GST on sales"],
    [money(tax.box11), "Box 11 gross purchases"],
    [money(tax.box12), "Box 12 GST on purchases"],
    [money(tax.box13), "Box 13 import GST"],
  ] as const) {
    const cell = document.createElement("div");
    cell.className = "check-stat";
    const big = document.createElement("span");
    big.className = "check-value";
    big.textContent = value;
    const small = document.createElement("span");
    small.className = "check-label";
    small.textContent = label;
    cell.append(big, small);
    summary.append(cell);
  }
  body.append(summary);
  body.append(
    note(
      "These come from the tax tag on each line, not from the balance of the GST account. " +
        "They are different numbers: a line posted to the GST account with no tax type moves " +
        "the account and reaches no box at all.",
    ),
  );

  const table = document.createElement("table");
  table.className = "report-table owner-table";
  const head = document.createElement("thead");
  head.innerHTML =
    "<tr><th>Code</th><th>Account</th><th>Lines</th><th>Debit</th><th>Credit</th></tr>";
  const tbody = document.createElement("tbody");

  for (const row of [...balance.rows].sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))) {
    const tr = document.createElement("tr");
    for (const [text, cls] of [
      [row.accountCode, "report-name"],
      [row.accountName, "report-name"],
      [String(row.lines), "report-amount"],
      [row.balance > 0 ? money(row.balance) : "", "report-amount"],
      [row.balance < 0 ? money(-row.balance) : "", "report-amount"],
    ] as const) {
      const td = document.createElement("td");
      td.textContent = text;
      td.className = cls;
      tr.append(td);
    }
    tbody.append(tr);
  }

  const total = document.createElement("tr");
  total.className = "report-net";
  const debits = balance.rows.reduce((n, r) => n + (r.balance > 0 ? r.balance : 0), 0);
  const credits = balance.rows.reduce((n, r) => n + (r.balance < 0 ? -r.balance : 0), 0);
  for (const [text, cls] of [
    ["", "report-name"], ["Total", "report-name"], ["", "report-amount"],
    [money(debits), "report-amount"], [money(credits), "report-amount"],
  ] as const) {
    const td = document.createElement("td");
    td.textContent = text;
    td.className = cls;
    total.append(td);
  }
  tbody.append(total);

  table.append(head, tbody);
  body.append(table);
}

function renderDepreciation(body: HTMLElement, year: number): void {
  const assets = state.ledger.assets ?? [];
  if (assets.length === 0) {
    body.append(
      note(
        "No asset register loaded. Depreciation is the one figure bank data cannot produce — " +
          "it depends on each asset's cost, method and rate. Load a Xero fixed asset export " +
          "with the button above.",
      ),
    );
    return;
  }

  const schedule = depreciationSchedule(assets, {
    from: `${year - 1}-04-01`,
    to: `${year}-03-31`,
  });

  const heading = document.createElement("h3");
  heading.textContent = `Depreciation schedule, FY${year}`;
  body.append(heading);
  body.append(
    note(
      "Straight line, full month averaging. An asset disposed of during the year takes no " +
        "depreciation that year: its book value goes to the disposal instead, so the same " +
        "value is not counted twice.",
    ),
  );

  const money = (cents: number): string =>
    (cents / 100).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const table = document.createElement("table");
  table.className = "report-table owner-table depreciation-table";
  const head = document.createElement("thead");
  head.innerHTML =
    "<tr><th>Asset</th><th>Purchased</th><th>Cost</th><th>Rate</th>" +
    "<th>Opening</th><th>Depreciation</th><th>Closing</th></tr>";
  const tbody = document.createElement("tbody");

  const row = (cells: readonly (readonly [string, string])[], cls = ""): void => {
    const tr = document.createElement("tr");
    if (cls !== "") tr.className = cls;
    for (const [text, klass] of cells) {
      const td = document.createElement("td");
      td.textContent = text;
      td.className = klass;
      tr.append(td);
    }
    tbody.append(tr);
  };

  for (const group of schedule.byType) {
    row([[group.type, "report-name"], ["", ""], ["", ""], ["", ""], ["", ""], ["", ""], ["", ""]],
        "report-section");
    for (const line of group.rows) {
      const name =
        line.asset.name + (line.disposedInPeriod ? ` — disposed ${line.asset.disposed ?? ""}` : "");
      row([
        [name, "report-name"],
        [line.asset.purchased ?? "", "report-name"],
        [money(line.asset.cost), "report-amount"],
        [`${line.asset.rate}%`, "report-amount"],
        [money(line.opening), "report-amount"],
        [money(line.depreciation), "report-amount"],
        [money(line.closing), "report-amount"],
      ]);
    }
    row([
      [`Total ${group.type}`, "report-name"], ["", ""], ["", ""], ["", ""], ["", ""],
      [money(group.depreciation), "report-amount"], [money(group.closing), "report-amount"],
    ], "report-total");
  }

  row([
    ["Total", "report-name"], ["", ""],
    [money(schedule.totalCost), "report-amount"], ["", ""],
    [money(schedule.totalOpening), "report-amount"],
    [money(schedule.totalDepreciation), "report-amount"],
    [money(schedule.totalClosing), "report-amount"],
  ], "report-net");

  table.append(head, tbody);
  body.append(table);

  if (schedule.disposedBookValue !== 0) {
    body.append(
      note(
        `Assets disposed of in the year carried ${money(schedule.disposedBookValue)} of book ` +
          "value. Whether that is a loss on sale, depreciation recovered or a capital gain " +
          "depends on what each sold for, which the asset register does not record.",
      ),
    );
  }
}

function renderOwnerReport(body: HTMLElement, owner: string, year: number): void {
  const summary = ownerSummaryFor(owner, year);

  const heading = document.createElement("h3");
  heading.textContent = `${owner} — rental income, FY${year}`;
  body.append(heading);

  if (summary.shares.length === 0) {
    body.append(
      note(
        `${owner} owns no entity. Set owners against an entity on Entities & accounts, ` +
          "e.g. “Ana Whitcombe 50%; Tom Whitcombe 50%”.",
      ),
    );
    return;
  }

  const money = (cents: number): string =>
    (cents / 100).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const table = document.createElement("table");
  table.className = "report-table owner-table";
  const head = document.createElement("thead");
  head.innerHTML =
    "<tr><th>Property</th><th>Kind</th><th>Share</th><th>Income</th><th>Expenses</th><th>Net</th></tr>";
  const tbody = document.createElement("tbody");

  for (const share of summary.shares) {
    const tr = document.createElement("tr");
    for (const [text, cls] of [
      [share.entity, "report-name"],
      [share.kind, "report-name"],
      [`${share.percent}%`, "report-amount"],
      [money(share.income), "report-amount"],
      [money(share.expenses), "report-amount"],
      [money(share.net), "report-amount"],
    ] as const) {
      const td = document.createElement("td");
      td.textContent = text;
      td.className = cls;
      tr.append(td);
    }
    tbody.append(tr);
  }

  // Residential is kept apart because New Zealand ring-fences its losses: they
  // cannot offset other income, so the two totals are not interchangeable.
  const total = (label: string, income: number, expenses: number, net: number): void => {
    const tr = document.createElement("tr");
    tr.className = "report-total";
    for (const [text, cls] of [
      [label, "report-name"], ["", "report-name"], ["", "report-amount"],
      [money(income), "report-amount"], [money(expenses), "report-amount"],
      [money(net), "report-amount"],
    ] as const) {
      const td = document.createElement("td");
      td.textContent = text;
      td.className = cls;
      tr.append(td);
    }
    tbody.append(tr);
  };
  total("Residential (ring-fenced)", summary.residentialIncome, summary.residentialExpenses, summary.residentialNet);
  total("Other rents and business", summary.otherIncome, summary.otherExpenses, summary.otherNet);

  table.append(head, tbody);
  body.append(table);
  body.append(
    note(
      "Shares are applied to income and expenses separately, not to the net, because a return " +
        "asks for both — and deductions are what carry forward when a residential property " +
        "makes a loss.",
    ),
  );

  renderTaxExtras(body, owner, year);
}

/**
 * Income that never reaches these bank accounts.
 *
 * Interest, dividends and PIE income from KiwiSaver and share platforms are
 * taxed at source and often reinvested without ever arriving, so nothing in a
 * bank feed will ever show them. They still belong on a return, so they are
 * typed in — and kept in their own table, clearly separate from everything the
 * app worked out for itself.
 */
function renderTaxExtras(body: HTMLElement, owner: string, year: number): void {
  const heading = document.createElement("h3");
  heading.textContent = "Other income for the return";
  body.append(heading);
  body.append(
    note(
      "Entered by hand, because it never passes through these accounts: bank interest, " +
        "dividends, and PIE income from KiwiSaver or managed funds. Nothing here is derived.",
    ),
  );

  const extras = (state.ledger.taxExtras ?? []).filter(
    (e) => e.owner === owner && e.year === year,
  );

  const money = (cents: number): string =>
    (cents / 100).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const table = document.createElement("table");
  table.className = "report-table owner-table";
  const head = document.createElement("thead");
  head.innerHTML =
    "<tr><th>Category</th><th>Payer</th><th>Gross</th><th>Tax credits</th><th></th></tr>";
  const tbody = document.createElement("tbody");

  for (const extra of extras) {
    const tr = document.createElement("tr");
    const label =
      TAX_EXTRA_CATEGORIES.find((c) => c.value === extra.category)?.label ?? extra.category;
    for (const [text, cls] of [
      [label, "report-name"],
      [extra.payer, "report-name"],
      [money(extra.gross), "report-amount"],
      [money(extra.credits), "report-amount"],
    ] as const) {
      const td = document.createElement("td");
      td.textContent = text;
      td.className = cls;
      tr.append(td);
    }
    const actions = document.createElement("td");
    actions.className = "report-amount";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => void removeExtra(extra));
    actions.append(remove);
    tr.append(actions);
    tbody.append(tr);
  }

  const totals = totalExtras(state.ledger.taxExtras ?? [], owner, year);
  const totalRow = document.createElement("tr");
  totalRow.className = "report-total";
  for (const [text, cls] of [
    ["Total other income", "report-name"], ["", "report-name"],
    [money(totals.gross), "report-amount"], [money(totals.credits), "report-amount"],
    ["", ""],
  ] as const) {
    const td = document.createElement("td");
    td.textContent = text;
    td.className = cls;
    totalRow.append(td);
  }
  tbody.append(totalRow);

  table.append(head, tbody);
  body.append(table);

  // --- add one ---
  const form = document.createElement("div");
  form.className = "extra-add";

  const category = document.createElement("select");
  for (const option of TAX_EXTRA_CATEGORIES) {
    const element = document.createElement("option");
    element.value = option.value;
    element.textContent = option.label;
    category.append(element);
  }
  const payer = document.createElement("input");
  payer.type = "text";
  payer.placeholder = "Payer, e.g. BANK OF NEW ZEALAND";
  const gross = document.createElement("input");
  gross.type = "text";
  gross.placeholder = "Gross";
  const credits = document.createElement("input");
  credits.type = "text";
  credits.placeholder = "Tax credits";

  const add = document.createElement("button");
  add.type = "button";
  add.className = "primary";
  add.textContent = "Add";
  add.addEventListener("click", () => {
    const amount = parseAmount(gross.value);
    if (amount === null) {
      alert("Give a gross amount.");
      return;
    }
    void addExtra({
      owner,
      year,
      category: category.value as TaxExtraCategory,
      payer: payer.value.trim(),
      gross: amount,
      credits: parseAmount(credits.value) ?? 0,
    });
  });

  form.append(category, payer, gross, credits, add);
  body.append(form);
}

async function addExtra(extra: TaxExtra): Promise<void> {
  const before = state.ledger.taxExtras ?? [];
  const taxExtras = [...before, extra];
  state.ledger = { ...state.ledger, taxExtras };
  state.persistent = await savePart(state.ledger, "taxExtras");
  await record(
    "taxExtras",
    `${extra.owner} FY${extra.year}: ${extra.category} ${extra.payer} ${formatAmount(extra.gross)}`,
    before,
    taxExtras,
  );
  renderReportsPage();
}

async function removeExtra(extra: TaxExtra): Promise<void> {
  const before = state.ledger.taxExtras ?? [];
  const taxExtras = before.filter((e) => e !== extra);
  state.ledger = { ...state.ledger, taxExtras };
  state.persistent = await savePart(state.ledger, "taxExtras");
  await record(
    "taxExtras",
    `Removed ${extra.owner} FY${extra.year}: ${extra.payer} ${formatAmount(extra.gross)}`,
    before,
    taxExtras,
  );
  renderReportsPage();
}

async function loadInvoices(file: File): Promise<void> {
  const parsed = parseXeroInvoices(await readXeroText(file));
  if (parsed.invoices.length === 0) {
    alert(`${file.name} holds no invoices. Export one from Xero as Business > Invoices > Export.`);
    return;
  }
  state.ledger = { ...state.ledger, invoices: parsed.invoices };
  state.persistent = await savePart(state.ledger, "invoices");
  const issues = validateInvoices(parsed.invoices);
  if (issues.length > 0) {
    state.invoiceMessage =
      `${parsed.invoices.length} invoices loaded. ${issues.length} look wrong: ` +
      issues.slice(0, 3).map((i) => i.message).join("; ");
  } else {
    state.invoiceMessage = `${parsed.invoices.length} invoices loaded from ${file.name}.`;
  }
  renderInvoices();
}

async function loadAllocations(file: File): Promise<void> {
  const parsed = parseXeroAllocations(await readXeroText(file));
  if (parsed.allocations.length === 0) {
    alert(`${file.name} holds no payment allocations.`);
    return;
  }
  state.ledger = { ...state.ledger, allocations: parsed.allocations };
  state.persistent = await savePart(state.ledger, "allocations");
  state.invoiceMessage = `${parsed.allocations.length} allocations loaded from ${file.name}.`;
  renderInvoices();
}

/** Xero writes Windows-1252, so a plain UTF-8 read mangles anything accented. */
async function readXeroText(file: File): Promise<string> {
  // Through the same reader as everything else that comes out of Xero. This
  // used to decode the bytes as text and stop there, so the invoice and
  // allocation imports were the two places in the app that could not take a
  // spreadsheet -- and Xero hands you one depending on which button you press.
  return asCsvText(file.name, new Uint8Array(await file.arrayBuffer()));
}

/**
 * Writing an invoice by hand.
 *
 * Not everything is billed through an accounting system, and an invoice that
 * exists only on paper still has to be matched to the money and still belongs
 * in an accrual result. Without this the app could read invoices and never
 * record one, which meant a whole class of income had nowhere to live.
 *
 * `null` means the form is closed; a number means that invoice is being edited;
 * the empty string means a new one is being written.
 */
let editingInvoice: string | null = null;

/** An invoice number split into its prefix and its number, when it has both. */
interface NumberedInvoice {
  prefix: string;
  digits: string;
  value: number;
}

function splitInvoiceNumber(number: string): NumberedInvoice | null {
  const parts = /^([A-Za-z-]*)(\d+)$/.exec(number.trim());
  if (parts === null) return null;
  return { prefix: parts[1] ?? "", digits: parts[2] ?? "", value: Number(parts[2]) };
}

/** What each kind of document is called. Money in is INV, money out is BILL. */
function invoicePrefix(kind: InvoiceKind): string {
  return kind === "purchase" ? "BILL-" : "INV-";
}

/**
 * The next number, counting across every prefix rather than within each.
 *
 * One sequence for the whole book: a credit note does not restart the count,
 * and CN-0155 never sits alongside INV-0155 meaning something different. So the
 * number is the highest in use anywhere plus one.
 *
 * The prefix is separate, and says what the document is rather than what the
 * last one happened to be -- taking the highest entry's prefix made the next
 * sales invoice a CN the moment a credit note was the latest thing raised.
 */
function suggestInvoiceNumber(kind: InvoiceKind): string {
  const numbered = (state.ledger.invoices ?? [])
    .map((i) => splitInvoiceNumber(i.number))
    .filter((n): n is NumberedInvoice => n !== null);
  const prefix = invoicePrefix(kind);
  if (numbered.length === 0) return `${prefix}0001`;

  const highest = numbered.reduce((best, n) => (n.value > best.value ? n : best));
  const width = Math.max(...numbered.map((n) => n.digits.length));
  return prefix + String(highest.value + 1).padStart(width, "0");
}

function blankInvoice(): Invoice {
  const today = new Date().toISOString().slice(0, 10);
  return {
    number: suggestInvoiceNumber("sales"),
    kind: "sales",
    contact: "",
    reference: "",
    issued: today,
    due: null,
    total: 0,
    tax: 0,
    paid: 0,
    outstanding: 0,
    currency: "NZD",
    status: "Awaiting Payment",
    lines: [{ description: "", accountCode: "", taxType: "15% GST on Income", net: 0, tax: 0, gross: 0 }],
  };
}

/** Cents from what someone typed, tolerating commas, spaces and a $ sign. */
function parseMoney(text: string): number {
  const cleaned = text.replace(/[$,\s]/g, "");
  if (cleaned === "" || !/^-?\d*\.?\d*$/.test(cleaned)) return 0;
  return Math.round(Number(cleaned) * 100);
}

/** The GST treatments an invoice line can carry, named as Xero names them. */
const INVOICE_TAX_TYPES = [
  { value: "15% GST on Income", label: "15% GST on Income", rate: 15 },
  { value: "Zero Rated", label: "Zero rated", rate: 0 },
  { value: "GST Exempt", label: "Exempt", rate: 0 },
  { value: "No GST", label: "No GST", rate: 0 },
] as const;

function renderInvoiceEditor(): void {
  const host = $("invoice-editor");
  host.textContent = "";
  if (editingInvoice === null) return;

  const existing =
    editingInvoice === ""
      ? undefined
      : (state.ledger.invoices ?? []).find((i) => i.number === editingInvoice);
  // A working copy: nothing reaches the ledger until Save, so closing the form
  // leaves the invoice exactly as it was.
  const draft: Invoice = existing
    ? { ...existing, lines: existing.lines.map((l) => ({ ...l })) }
    : blankInvoice();

  const box = document.createElement("div");
  box.className = "invoice-editor";

  const heading = document.createElement("h3");
  heading.textContent = existing ? `Edit ${existing.number}` : "New invoice";
  box.append(heading);

  const grid = document.createElement("div");
  grid.className = "invoice-fields";

  const field = (
    label: string,
    control: HTMLElement,
    hint?: string,
  ): HTMLLabelElement => {
    const wrap = document.createElement("label");
    const name = document.createElement("span");
    name.textContent = label;
    wrap.append(name, control);
    if (hint !== undefined) {
      const small = document.createElement("small");
      small.textContent = hint;
      wrap.append(small);
    }
    grid.append(wrap);
    return wrap;
  };

  const text = (value: string, placeholder = ""): HTMLInputElement => {
    const input = document.createElement("input");
    input.type = "text";
    input.value = value;
    input.placeholder = placeholder;
    return input;
  };

  const number = text(draft.number);
  field("Invoice number", number);

  const kind = document.createElement("select");
  for (const [value, label] of [
    ["sales", "Sales invoice (money in)"],
    ["purchase", "Bill (money out)"],
  ] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.selected = draft.kind === value;
    kind.append(option);
  }
  field("Type", kind);

  // Changing what the document is changes what it is called, but only while the
  // number is still the one offered: a number typed by hand is a decision, and
  // an invoice already raised keeps the number it was issued under.
  let offered = number.value;
  kind.addEventListener("change", () => {
    if (existing !== undefined || number.value !== offered) return;
    offered = suggestInvoiceNumber(kind.value as InvoiceKind);
    number.value = offered;
  });

  const contact = text(draft.contact, "Who it is to, or from");
  field("Contact", contact);

  const reference = text(draft.reference);
  field("Reference", reference);

  const issued = document.createElement("input");
  issued.type = "date";
  issued.value = draft.issued;
  field("Issued", issued);

  const due = document.createElement("input");
  due.type = "date";
  due.value = draft.due ?? "";
  field("Due", due, "Optional.");

  const status = text(draft.status);
  field("Status", status);

  const paid = text((draft.paid / 100).toFixed(2));
  field("Already paid", paid, "Leave at 0.00 for a new invoice.");

  box.append(grid);

  // --- lines ---------------------------------------------------------------
  const linesHead = document.createElement("h4");
  linesHead.textContent = "Lines";
  box.append(linesHead);

  const lineHost = document.createElement("div");
  lineHost.className = "invoice-lines";
  box.append(lineHost);

  const totals = document.createElement("p");
  totals.className = "invoice-totals";

  const accounts = knownCodes(state.rules, state.ledger.overrides ?? {}, state.chart);
  const lineAccounts = new Map<HTMLElement, Combobox>();

  function readLines(): InvoiceLine[] {
    return [...lineHost.querySelectorAll<HTMLElement>(".invoice-line")].map((row) => {
      const description = row.querySelector<HTMLInputElement>(".line-description")?.value ?? "";
      const account = lineAccounts.get(row)?.value ?? "";
      const taxType = row.querySelector<HTMLSelectElement>(".line-tax")?.value ?? "No GST";
      const gross = parseMoney(row.querySelector<HTMLInputElement>(".line-gross")?.value ?? "");
      // Store the bare chart code, the way an imported invoice holds it. The
      // picker shows "NB Sales - 200"; keeping that label here would leave two
      // spellings of the same account in one field.
      const code = splitAccountLabel(account).code || account.trim();
      // The gross is what the customer pays, so the tax is taken out of it
      // rather than added on -- the same 3/23 the returns use.
      const rate = INVOICE_TAX_TYPES.find((t) => t.value === taxType)?.rate ?? 0;
      const tax = rate === 15 ? gstContent(gross) : 0;
      return { description, accountCode: code, taxType, net: gross - tax, tax, gross };
    });
  }

  function refreshTotals(): void {
    const lines = readLines();
    const total = lines.reduce((sum, l) => sum + l.gross, 0);
    const tax = lines.reduce((sum, l) => sum + l.tax, 0);
    totals.textContent =
      `Total ${formatAmount(total)} · GST ${formatAmount(tax)} · ` +
      `excluding GST ${formatAmount(total - tax)}`;
  }

  function addLine(line: InvoiceLine): void {
    const row = document.createElement("div");
    row.className = "invoice-line";

    const description = text(line.description, "What it is for");
    description.className = "line-description";

    const account = combobox(
      accounts,
      line.accountCode === "" ? null : accountLabelFor(line.accountCode),
      "Account",
    );
    account.element.querySelector("input")?.classList.add("line-account");
    lineAccounts.set(row, account);

    const tax = document.createElement("select");
    tax.className = "line-tax";
    for (const option of INVOICE_TAX_TYPES) {
      const item = document.createElement("option");
      item.value = option.value;
      item.textContent = option.label;
      item.selected = option.value === line.taxType;
      tax.append(item);
    }

    const gross = text((line.gross / 100).toFixed(2));
    gross.className = "line-gross invoice-amount";
    gross.placeholder = "0.00";

    const drop = document.createElement("button");
    drop.type = "button";
    drop.className = "line-drop";
    drop.textContent = "×";
    drop.title = "Remove this line";
    drop.addEventListener("click", () => {
      lineAccounts.delete(row);
      row.remove();
      refreshTotals();
    });

    row.append(description, account.element, tax, gross, drop);
    lineHost.append(row);
    for (const control of [description, tax, gross]) {
      control.addEventListener("input", refreshTotals);
      control.addEventListener("change", refreshTotals);
    }
  }

  for (const line of draft.lines) addLine(line);
  refreshTotals();

  const addRow = document.createElement("button");
  addRow.type = "button";
  addRow.textContent = "Add line";
  addRow.addEventListener("click", () => {
    addLine({ description: "", accountCode: "", taxType: "15% GST on Income", net: 0, tax: 0, gross: 0 });
    refreshTotals();
  });
  box.append(addRow, totals);

  // --- actions -------------------------------------------------------------
  const actions = document.createElement("div");
  actions.className = "invoice-actions";

  const save = document.createElement("button");
  save.type = "button";
  save.className = "primary";
  save.textContent = "Save invoice";
  save.addEventListener("click", () => {
    const lines = readLines().filter((l) => l.gross !== 0 || l.description.trim() !== "");
    const total = lines.reduce((sum, l) => sum + l.gross, 0);
    const tax = lines.reduce((sum, l) => sum + l.tax, 0);
    const paidCents = parseMoney(paid.value);

    const built: Invoice = {
      number: number.value.trim(),
      kind: kind.value as InvoiceKind,
      contact: contact.value.trim(),
      reference: reference.value.trim(),
      issued: issued.value,
      due: due.value === "" ? null : due.value,
      total,
      tax,
      paid: paidCents,
      // Derived, never typed: an outstanding figure that disagreed with the
      // total less what was paid would quietly break every match proposal.
      outstanding: total - paidCents,
      currency: draft.currency,
      status: status.value.trim(),
      lines,
    };
    void saveInvoice(built, existing);
  });

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => {
    editingInvoice = null;
    renderInvoiceEditor();
  });

  actions.append(save, cancel);

  if (existing) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => {
      if (!confirm(`Delete ${existing.number}? The change log can undo it.`)) return;
      void deleteInvoice(existing);
    });
    actions.append(remove);
  }

  box.append(actions);
  host.append(box);
}

/** The picker label for a chart code, so an editor shows what a coder sees. */
function accountLabelFor(code: string): string {
  const codes = knownCodes(state.rules, state.ledger.overrides ?? {}, state.chart);
  return canonicalCodeFor(code, codes) ?? code;
}

async function saveInvoice(built: Invoice, existing: Invoice | undefined): Promise<void> {
  if (built.number === "") {
    alert("Give the invoice a number.");
    return;
  }
  const invoices = [...(state.ledger.invoices ?? [])];
  const clash = invoices.findIndex((i) => i.number === built.number);
  if (clash >= 0 && invoices[clash] !== existing) {
    alert(`There is already an invoice numbered ${built.number}.`);
    return;
  }

  // The same number under a different prefix -- CN-0155 beside INV-0155 -- is
  // two documents that sound like one. Worth stopping to check, not worth
  // forbidding, so it asks.
  const mine = splitInvoiceNumber(built.number);
  if (mine !== null) {
    const twin = invoices.find(
      (i) => i !== existing && splitInvoiceNumber(i.number)?.value === mine.value,
    );
    if (
      twin !== undefined &&
      !confirm(
        `${twin.number} already uses number ${mine.value}.\n\n` +
          `Save ${built.number} as well? ${suggestInvoiceNumber(built.kind)} is free.`,
      )
    ) {
      return;
    }
  }

  const at = existing ? invoices.indexOf(existing) : -1;
  if (at >= 0) invoices[at] = built;
  else invoices.push(built);

  state.ledger = { ...state.ledger, invoices };
  state.persistent = await savePart(state.ledger, "invoices");
  await record(
    "invoice",
    `${existing ? "Edited" : "Created"} ${built.number} — ${built.contact} ${formatAmount(built.total)}`,
    existing ?? null,
    built,
    built.number,
  );
  editingInvoice = null;
  renderInvoiceEditor();
  renderInvoices();
}

async function deleteInvoice(invoice: Invoice): Promise<void> {
  const invoices = (state.ledger.invoices ?? []).filter((i) => i.number !== invoice.number);
  state.ledger = { ...state.ledger, invoices };
  state.persistent = await savePart(state.ledger, "invoices");
  await record(
    "invoice",
    `Deleted ${invoice.number} — ${invoice.contact} ${formatAmount(invoice.total)}`,
    invoice,
    null,
    invoice.number,
  );
  editingInvoice = null;
  renderInvoiceEditor();
  renderInvoices();
}

/**
 * Read a bank daily balance export and say whether the import ties to it.
 *
 * Held in memory rather than stored: it is a check, not a record. Loading a
 * newer export next month should ask the same question again of the data as it
 * stands, not accumulate answers.
 */
async function checkBankBalances(file: File): Promise<void> {
  const body = $("balances-body");
  body.textContent = "";
  try {
    // Decoded the same way every other bank file is: a plain UTF-8 read
    // mangles anything the bank wrote in Windows-1252.
    const bytes = new Uint8Array(await file.arrayBuffer());
    let text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    if (text.includes("�")) text = new TextDecoder("windows-1252").decode(bytes);
    const parsed = parseDailyBalances(text);
    const checks = checkDailyBalances(parsed.sections, state.ledger.transactions);
    state.balanceChecks = checks;
    renderBalanceChecks(body, file.name, checks, parsed.problems);
    // The review list asks about duplicates the balances can now settle.
    renderTable();
  } catch (error) {
    body.append(note(`Could not read ${file.name}: ${(error as Error).message}`));
  }
}

function renderBalanceChecks(
  body: HTMLElement,
  fileName: string,
  checks: readonly BalanceCheck[],
  problems: readonly string[],
): void {
  const tied = checks.filter((c) => c.account !== null && c.breaks.length === 0).length;
  const broken = checks.filter((c) => c.breaks.length > 0);
  const missing = checks.filter((c) => c.account === null);

  const summary = document.createElement("p");
  summary.className = broken.length === 0 ? "balance-ok" : "balance-off";
  summary.textContent =
    broken.length === 0
      ? `${fileName}: every account ties to the bank.`
      : `${fileName}: ${broken.length} of ${checks.length} accounts do not tie.`;
  body.append(summary);

  for (const problem of problems) body.append(note(problem));

  const table = document.createElement("table");
  // match-table lets the figures take only what they need, so the account name
  // gets the rest rather than wrapping to three lines beside empty columns.
  table.className = "report-table owner-table match-table";
  const head = document.createElement("thead");
  head.innerHTML =
    "<tr><th>Account</th><th>Ours</th><th>Days</th><th>Agreed until</th>" +
    "<th>Out by</th><th>Days differing</th></tr>";
  const tbody = document.createElement("tbody");

  for (const check of checks) {
    const tr = document.createElement("tr");
    tr.append(nameCell(`${check.section.label} (${check.section.account})`));
    tr.append(amountCell(check.account === null ? "—" : String(check.transactions)));
    tr.append(amountCell(String(check.section.days.length)));

    if (check.account === null) {
      const none = nameCell("nothing imported for this account");
      none.colSpan = 3;
      tr.append(none);
      tbody.append(tr);
      continue;
    }

    tr.append(nameCell(check.breaks.length === 0 ? "all of it" : (check.agreedUntil ?? "never")));
    const out = amountCell(check.breaks.length === 0 ? "—" : formatAmount(check.outBy));
    if (check.breaks.length > 0) out.classList.add("match-off");
    tr.append(out);
    tr.append(amountCell(check.breaks.length === 0 ? "—" : String(check.breaks.length)));
    tbody.append(tr);

    // The days themselves, because "out by 4,915" is not actionable and
    // "the 3rd of April, by 45.18" is.
    if (check.breaks.length > 0) {
      const detail = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 6;
      cell.className = "balance-detail";
      for (const gap of check.breaks.slice(0, 40)) {
        const line = document.createElement("div");
        line.textContent = `${gap.date}   ${formatAmount(gap.difference)}`;
        cell.append(line);
      }
      if (check.breaks.length > 40) {
        const more = document.createElement("div");
        more.textContent = `… and ${check.breaks.length - 40} more`;
        cell.append(more);
      }
      detail.append(cell);
      tbody.append(detail);
    }
  }
  table.append(head, tbody);
  body.append(table);

  body.append(
    note(
      "A negative figure is money the bank saw leave that we have no transaction " +
        "for. A positive one is movement we hold and the bank does not — usually " +
        "the same transaction imported twice. A steady difference before the first " +
        "date is just the balance the account held before the data starts, and is " +
        "not an error." +
        (tied > 0 ? ` ${tied} account(s) tie exactly.` : "") +
        (missing.length > 0
          ? ` ${missing.length} account(s) in the file have nothing imported.`
          : ""),
    ),
  );
}

/**
 * Which entity is sending this invoice.
 *
 * The accounts its lines are coded to say so: a sale coded to an account
 * belonging to the rental is the rental invoicing, whatever else is in the
 * ledger. With one entity there is nothing to work out, and with none the
 * books have no name to put at the top -- which is what the button says.
 */
function supplierFor(invoice: Invoice): InvoiceSupplier | null {
  const model = state.ledger.entities ?? emptyEntityModel();
  if (model.entities.length === 0) return null;

  const counts = new Map<string, number>();
  for (const line of invoice.lines) {
    const account = state.chart.find((a) => a.code.trim() === line.accountCode.trim());
    const id = account === undefined ? undefined : model.accounts[accountEntityKey(account)];
    if (id !== undefined) counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  const best = [...counts].sort((a, b) => b[1] - a[1])[0];
  const entity =
    (best === undefined ? undefined : model.entities.find((e) => e.id === best[0])) ??
    (model.entities.length === 1 ? model.entities[0] : undefined);
  if (entity === undefined) return null;

  return {
    name: entity.name,
    ...(entity.address === undefined ? {} : { address: entity.address }),
    ...(entity.gstNumber === undefined ? {} : { gstNumber: entity.gstNumber }),
    ...(entity.payTo === undefined ? {} : { payTo: entity.payTo }),
  };
}

/** Edit, and for a sales invoice the document to send. */
function editInvoiceCell(invoice: Invoice): HTMLTableCellElement {
  const td = document.createElement("td");
  td.className = "report-amount";

  const edit = document.createElement("button");
  edit.type = "button";
  edit.textContent = "edit";
  edit.addEventListener("click", () => {
    editingInvoice = invoice.number;
    renderInvoiceEditor();
    $("invoice-editor").scrollIntoView({ block: "nearest" });
  });
  td.append(edit);

  // Only a sales invoice: a bill somebody sent you is not yours to issue.
  if (invoice.kind === "sales") {
    const send = document.createElement("button");
    send.type = "button";
    send.className = "invoice-send";
    send.textContent = "document";
    const supplier = supplierFor(invoice);
    if (supplier === null) {
      send.disabled = true;
      send.title =
        "These books have no entity yet, so there is no name to put at the top. " +
        "Name one on the Entities page first.";
    } else {
      send.title =
        `A tax invoice for ${invoice.contact}, as an HTML file: open it to print ` +
        "or save as PDF, or open it in Word to change the wording.";
      send.addEventListener("click", () => {
        download(
          invoiceDocument(invoice, supplier),
          `${invoice.number || "invoice"}.html`,
          "text/html;charset=utf-8",
        );
      });
    }
    td.append(send);
  }

  return td;
}

/** A table cell of plain text. */
function nameCell(text: string): HTMLTableCellElement {
  const td = document.createElement("td");
  td.className = "report-name";
  td.textContent = text;
  return td;
}

/** A right-aligned figure. */
function amountCell(text: string): HTMLTableCellElement {
  const td = document.createElement("td");
  td.className = "report-amount";
  td.textContent = text;
  return td;
}

/**
 * The invoice, with enough on screen to recognise it.
 *
 * A number alone is not evidence: deciding whether a receipt settles INV-0121
 * means knowing who it was to, what it was for and when it was raised. Showing
 * only the number made the page ask a question it had not given you the means
 * to answer.
 */
function invoiceCell(invoice: Invoice | undefined, fallback: string): HTMLTableCellElement {
  const td = document.createElement("td");
  td.className = "report-name match-cell";
  const number = document.createElement("strong");
  number.textContent = invoice?.number ?? fallback;
  td.append(number);
  if (invoice === undefined) return td;

  const who = document.createElement("div");
  who.className = "match-sub";
  who.textContent = invoice.contact;
  td.append(who);

  const detail = [invoice.reference, invoice.issued].filter((p) => p !== "").join(" · ");
  if (detail !== "") {
    const line = document.createElement("div");
    line.className = "match-sub";
    line.textContent = detail;
    td.append(line);
  }
  return td;
}

/** The bank line, named the way it appears on a statement. */
function bankCell(transaction: Transaction | undefined): HTMLTableCellElement {
  const td = document.createElement("td");
  td.className = "report-name match-cell";
  if (transaction === undefined) {
    td.textContent = "line not found";
    return td;
  }
  const who = document.createElement("strong");
  who.textContent = transaction.otherParty || transaction.particulars || "(no payee)";
  td.append(who);

  const when = document.createElement("div");
  when.className = "match-sub";
  when.textContent = `${transaction.date} · ${bankLabel(transaction.account)}`;
  td.append(when);

  const extra = [transaction.particulars, transaction.reference]
    .filter((p) => p !== undefined && p !== "" && p !== transaction.otherParty)
    .join(" · ");
  if (extra !== "") {
    const line = document.createElement("div");
    line.className = "match-sub";
    line.textContent = extra;
    td.append(line);
  }
  return td;
}

function renderInvoices(): void {
  const body = $("invoices-body");
  body.textContent = "";

  if (state.invoiceMessage !== "") body.append(note(state.invoiceMessage));

  const invoices = state.ledger.invoices ?? [];
  if (invoices.length === 0) {
    body.append(
      note(
        "No invoices loaded. Export them from Xero as Business > Invoices > Export, and " +
          "optionally an Account Transactions CSV for the payment allocations — those say " +
          "exactly which receipts settled which invoice.",
      ),
    );
    return;
  }

  const byNumber = new Map(invoices.map((i) => [i.number, i]));
  const byTransaction = new Map(state.ledger.transactions.map((t) => [t.id, t]));
  // Split parts too, so a payment that settled several invoices can be shown
  // against each of them. A part is addressed by the id `expandSplits` gives
  // it, and carries the amount that actually went to that invoice.
  for (const [id, parts] of Object.entries(state.ledger.splits ?? {})) {
    const parent = byTransaction.get(id);
    if (parent === undefined) continue;
    parts.forEach((part, index) => {
      byTransaction.set(splitPartId(id, index), {
        ...parent,
        id: splitPartId(id, index),
        amount: part.amount,
      });
    });
  }

  const accepted = state.ledger.invoiceMatches ?? {};
  const result = matchInvoices({
    invoices,
    transactions: state.ledger.transactions,
    ...(state.ledger.allocations ? { allocations: state.ledger.allocations } : {}),
  });

  const money = (cents: number): string =>
    (cents / 100).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const summary = document.createElement("div");
  summary.className = "check-summary";
  // Counted by what is owed rather than by how a match was arrived at. How a
  // receipt was found is interesting once; what is still owed is the question
  // the page exists to answer.
  const summaryBalances = [...invoiceBalanceMap().values()];
  const count = (status: string) => summaryBalances.filter((b) => b.status === status).length;
  const totalOwing = summaryBalances.reduce((sum, b) => sum + Math.max(0, b.remaining), 0);

  for (const [value, label] of [
    [String(count("paid")), "settled in full"],
    [String(count("part paid")), "part paid"],
    [String(count("unpaid")), "nothing assigned"],
    [money(totalOwing), "still owing"],
    [String(result.proposals.length), "proposed, needs a decision"],
  ] as const) {
    const cell = document.createElement("div");
    cell.className = "check-stat";
    const big = document.createElement("span");
    big.className = "check-value";
    big.textContent = value;
    const small = document.createElement("span");
    small.className = "check-label";
    small.textContent = label;
    cell.append(big, small);
    summary.append(cell);
  }
  body.append(summary);

  const needle = $<HTMLInputElement>("invoice-search").value.trim().toLowerCase();
  const hit = (text: string) => needle === "" || text.toLowerCase().includes(needle);

  // --- proposals first: they are the only rows asking for anything ---
  if (result.proposals.length > 0) {
    const heading = document.createElement("h3");
    heading.textContent = `Proposed (${result.proposals.length})`;
    body.append(heading);
    body.append(
      note(
        "The amounts do not agree exactly. Accepting one records the match and leaves the " +
          "difference as a write-off to code yourself — nothing is adjusted automatically.",
      ),
    );

    const table = document.createElement("table");
    table.className = "report-table owner-table match-table";
    const head = document.createElement("thead");
    head.innerHTML =
      "<tr><th>Invoice</th><th>Invoice total</th><th>Outstanding</th>" +
      "<th>Bank line</th><th>Received</th><th>Difference</th><th>Why</th><th></th></tr>";
    const tbody = document.createElement("tbody");

    for (const proposal of result.proposals) {
      const invoice = byNumber.get(proposal.invoiceNumber);
      const bank = byTransaction.get(proposal.transactionId);
      const searchable =
        `${proposal.invoiceNumber} ${proposal.source} ${invoice?.contact ?? ""} ` +
        `${invoice?.reference ?? ""} ${bank?.otherParty ?? ""}`;
      if (!hit(searchable)) continue;

      const tr = document.createElement("tr");
      tr.append(invoiceCell(invoice, proposal.invoiceNumber));
      tr.append(amountCell(money(invoice?.total ?? proposal.invoiceAmount)));
      tr.append(amountCell(money(proposal.invoiceAmount)));
      tr.append(bankCell(bank));
      tr.append(amountCell(money(proposal.bankAmount)));

      // The difference is the whole reason this is a proposal rather than a
      // match, so it is called out rather than merely listed.
      const diff = amountCell(money(proposal.adjustment));
      diff.classList.add(proposal.adjustment === 0 ? "match-ok" : "match-off");
      tr.append(diff);
      const why = nameCell(proposal.source);
      why.classList.add("match-why");
      tr.append(why);

      const actions = document.createElement("td");
      actions.className = "report-amount";
      const accept = document.createElement("button");
      accept.type = "button";
      accept.className = "primary";
      accept.textContent = accepted[proposal.transactionId] ? "accepted" : "accept";
      accept.disabled = accepted[proposal.transactionId] !== undefined;
      accept.addEventListener("click", () => void acceptMatch(proposal.transactionId, proposal.invoiceNumber));
      actions.append(accept);
      tr.append(actions);
      tbody.append(tr);
    }
    table.append(head, tbody);
    body.append(table);
  }

  // --- what is still owing ---
  //
  // Driven by the receipts assigned to each invoice rather than by the
  // matcher's own list: an invoice half settled is neither matched nor
  // unmatched, and the question being asked here is "what is still owed",
  // which only the balance can answer.
  const balances = invoiceBalanceMap();
  const owing = [...balances.values()]
    .filter((b) => b.remaining > 0)
    .sort((a, b) => b.remaining - a.remaining);

  if (owing.length > 0) {
    const heading = document.createElement("h3");
    heading.textContent = `Owing (${owing.length})`;
    body.append(heading);
    body.append(
      note(
        "What is owed is the invoice less the bank lines assigned to it. Where the imported " +
          "file disagrees, its figure is shown beside ours: usually a receipt that has not been " +
          "found yet, settled through a processor net of its fee, or banked outside these accounts.",
      ),
    );
    const table = document.createElement("table");
    const head = document.createElement("thead");
    table.className = "report-table owner-table match-table";
    head.innerHTML =
      "<tr><th>Invoice</th><th>Due</th><th>Total</th><th>Assigned</th>" +
      "<th>Owing</th><th>File says</th><th>Status</th><th></th></tr>";
    const tbody = document.createElement("tbody");

    for (const balance of owing) {
      const invoice = balance.invoice;
      if (!hit(`${invoice.number} ${invoice.contact} ${invoice.reference}`)) continue;
      const tr = document.createElement("tr");
      tr.append(invoiceCell(invoice, invoice.number));
      tr.append(nameCell(invoice.due ?? ""));
      tr.append(amountCell(money(invoice.total)));
      tr.append(amountCell(balance.assigned === 0 ? "" : money(balance.assigned)));

      const left = amountCell(money(balance.remaining));
      left.classList.add("match-off");
      tr.append(left);

      // Only when it differs, and only when the file said anything: a column
      // repeating our own figure back at us is noise on every row.
      const differs =
        balance.fileRemaining !== null && balance.fileRemaining !== balance.remaining;
      const fileCell = amountCell(differs ? money(balance.fileRemaining ?? 0) : "");
      if (differs) fileCell.classList.add("match-why");
      tr.append(fileCell);

      tr.append(nameCell(balance.status));
      tr.append(editInvoiceCell(invoice));
      tbody.append(tr);
    }
    table.append(head, tbody);
    body.append(table);
  }

  // --- matched ---
  const heading = document.createElement("h3");
  heading.textContent = `Matched (${result.matched.length})`;
  body.append(heading);
  const table = document.createElement("table");
  table.className = "report-table owner-table";
  const head = document.createElement("thead");
  table.className = "report-table owner-table match-table";
  head.innerHTML =
    "<tr><th>Invoice</th><th>Total</th><th>Settled by</th><th>Received</th><th>How</th><th></th></tr>";
  const tbody = document.createElement("tbody");
  for (const match of result.matched) {
    if (!hit(`${match.invoice.number} ${match.invoice.contact} ${match.invoice.reference}`)) continue;
    const tr = document.createElement("tr");
    tr.append(invoiceCell(match.invoice, match.invoice.number));
    tr.append(amountCell(money(match.invoice.total)));

    // One settling line per row inside the cell. Several instalments run
    // together on a single line was the unreadable part.
    const lines = document.createElement("td");
    lines.className = "report-name match-lines";
    for (const t of match.transactions) {
      const line = document.createElement("div");
      line.textContent =
        `${t.date} · ${money(t.amount)} · ${bankLabel(t.account)} · ` +
        `${t.otherParty || t.particulars || ""}`;
      lines.append(line);
    }
    tr.append(lines);

    const received = match.transactions.reduce((sum, t) => sum + t.amount, 0);
    const total = amountCell(money(received));
    // Instalments that do not add up to the invoice are worth seeing.
    if (received !== match.invoice.total) total.classList.add("match-off");
    tr.append(total);
    tr.append(nameCell(match.how));
    tr.append(editInvoiceCell(match.invoice));
    tbody.append(tr);
  }

  // Invoices settled by hand, which the matcher never proposed and so never
  // reports. Without these a payment split across two invoices cleared them
  // both out of "still owing" and then appeared nowhere at all -- money that
  // had gone somewhere the page could not say.
  const shownAlready = new Set(result.matched.map((m) => m.invoice.number));
  const byInvoice = new Map<string, Transaction[]>();
  for (const [transactionId, number] of invoiceAssignments()) {
    if (number === "" || shownAlready.has(number)) continue;
    const t = byTransaction.get(transactionId);
    if (t === undefined) continue;
    const list = byInvoice.get(number);
    if (list) list.push(t);
    else byInvoice.set(number, [t]);
  }
  for (const [number, lines] of byInvoice) {
    const invoice = byNumber.get(number);
    if (invoice === undefined) continue;
    if (!hit(`${invoice.number} ${invoice.contact} ${invoice.reference}`)) continue;
    const tr = document.createElement("tr");
    tr.append(invoiceCell(invoice, invoice.number));
    tr.append(amountCell(money(invoice.total)));
    const cell = document.createElement("td");
    cell.className = "report-name match-lines";
    for (const t of lines) {
      const line = document.createElement("div");
      line.textContent =
        `${t.date} · ${money(t.amount)} · ${bankLabel(t.account)} · ` +
        `${t.otherParty || t.particulars || ""}` +
        (t.id.includes(":") ? " · part of a split payment" : "");
      cell.append(line);
    }
    tr.append(cell);
    const received = lines.reduce((sum, t) => sum + t.amount, 0);
    const total = amountCell(money(received));
    if (received !== invoice.total) total.classList.add("match-off");
    tr.append(total);
    tr.append(nameCell("chosen here"));
    tr.append(editInvoiceCell(invoice));
    tbody.append(tr);
  }

  heading.textContent = `Matched (${result.matched.length + byInvoice.size})`;
  table.append(head, tbody);
  body.append(table);
}

/** Record an accepted match, so it is not guessed again. */
async function acceptMatch(transactionId: string, invoiceNumber: string): Promise<void> {
  const invoiceMatches = { ...(state.ledger.invoiceMatches ?? {}), [transactionId]: invoiceNumber };
  state.ledger = { ...state.ledger, invoiceMatches };
  state.persistent = await savePart(state.ledger, "invoiceMatches");
  state.invoiceMessage = `Matched ${invoiceNumber}. The difference is still yours to code.`;
  renderInvoices();
}

/**
 * What the figures on screen were actually built from.
 *
 * The page had one fixed sentence describing the cash basis, shown whichever
 * basis was chosen -- so on both accrual reports it described something else.
 * Three sources, three different things worth knowing about them.
 */
function reportsHint(basis: string, kind: string): string {
  if (kind === "depreciation") {
    return (
      "Depreciation for the year, worked out from the asset register rather " +
      "than from any transaction. This is the one figure bank data can never " +
      "produce."
    );
  }
  if (kind === "journal") {
    return (
      "Every posting behind the accrual figures, and the proof that they " +
      "balance. The tax boxes come from the tag on each line, not from the " +
      "balance of the GST account."
    );
  }
  if (basis === "accrual") {
    return (
      "Read from the general ledger file you loaded, not computed here. This " +
      "is your accounting system's own answer, shown with your account names " +
      "so it can sit beside ours."
    );
  }
  if (basis === "posted") {
    return (
      "Built here, from your coding: every coded bank line posted as double " +
      "entry, invoices counted when raised rather than when paid, and " +
      "depreciation from the asset register. Where this differs from the " +
      "imported file, the difference is what is still to be accounted for."
    );
  }
  return (
    "Built from the bank data, on a cash basis and excluding GST. It has no " +
    "depreciation, no accruals and no year-end journals, because none of " +
    "those are payments \u2014 so it will not equal a signed statement, and " +
    "the gap is listed rather than hidden."
  );
}

/**
 * Say when a figure is built on transactions still in question.
 *
 * A duplicate the app is unsure of is kept and flagged, which is right: two
 * payments of the same amount a few days apart can genuinely be two payments,
 * and dropping one on a guess would lose real money. But kept means counted,
 * and the flag lives on the Import page while the damage is done here -- a
 * profit figure, or a return, quietly too big by whatever those rows come to.
 *
 * So the pages that state a figure say what is still unsettled underneath it,
 * and how much it is worth. Being wrong is survivable; being wrong with
 * nothing on the screen to say so is not.
 */
function unresolvedNote(): HTMLElement | null {
  const waiting = state.entries.filter((e) => e.status === "review");
  if (waiting.length === 0) return null;

  const worth = waiting.reduce((sum, e) => sum + Math.abs(e.transaction.amount), 0);
  const note = document.createElement("p");
  note.className = "unresolved-note";
  note.textContent =
    `${waiting.length} transaction${waiting.length === 1 ? " is" : "s are"} still in question ` +
    `— possibly the same thing counted twice, worth ${formatAmount(worth)} in total. ` +
    // Not "the figures below": this line appears on the reconcile queue as well,
    // where there are no figures below it, and a warning that describes the
    // wrong page is one somebody learns to skip.
    "They count towards every total until you decide.";

  const go = document.createElement("button");
  go.type = "button";
  go.className = "link-button";
  go.textContent = "settle them";
  go.addEventListener("click", () => {
    state.filter = "review";
    showPage("import");
  });
  note.append(" ", go);
  return note;
}

/**
 * The entity a report is being run for, when there is one.
 *
 * The chosen one, or the only one there is: books with a single entity are
 * always reporting on it whether or not anybody picked it from a list.
 * Nothing when several exist and none is chosen, because "all entities" is
 * not an entity and cannot have a registration.
 */
function reportingEntity(): Entity | undefined {
  const entities = state.ledger.entities?.entities ?? [];
  if (state.entityFilter !== "") return entities.find((e) => e.id === state.entityFilter);
  return entities.length === 1 ? entities[0] : undefined;
}

/**
 * The entity and registration last applied to the GST control.
 *
 * Following has to happen when the answer changes and not on every redraw, or
 * picking "Including GST" by hand would be undone by the next thing that
 * caused a render. The registration is part of the key and not just the
 * entity: ticking "GST registered" on the entity you are already looking at
 * changes what the report should say, and keying on the id alone left the
 * control explaining one thing while showing the other.
 */
let gstFollowing: string | null = null;

function renderReportsPage(): void {
  const body = $("reports-body");
  body.textContent = "";

  const basisNow = $<HTMLSelectElement>("report-basis").value;
  const kindNow = $<HTMLSelectElement>("report-kind").value;

  // Only the profit and loss has a GST choice to make, and only where the
  // gross can be recovered. A ledger read from a file cannot say what a line
  // was before GST, so the control goes rather than sitting there lying.
  const gstSelect = $<HTMLSelectElement>("report-gst");
  gstSelect.hidden = kindNow !== "pl" || basisNow === "accrual";

  // Registration decides this, so the control follows the entity rather than
  // waiting to be set: a registered entity reports net, an unregistered one
  // reports what it actually paid. Still a control, because a person may want
  // to see the other one, and only reset when the entity itself changes.
  const scope = reportingEntity();
  const follows = scope === undefined ? "" : `${scope.id}:${reportsNetOfGst(scope)}`;
  if (follows !== gstFollowing) {
    gstFollowing = follows;
    if (scope !== undefined) gstSelect.value = reportsNetOfGst(scope) ? "net" : "gross";
  }
  gstSelect.title =
    scope === undefined
      ? "Whether the figures include GST"
      : reportsNetOfGst(scope)
        ? `${scope.name} is GST registered, so its figures are net of GST.`
        : `${scope.name} is not GST registered, so the GST it paid is part of what things cost.`;

  $("reports-hint").textContent =
    reportsHint(basisNow, kindNow) +
    (kindNow === "pl"
      ? basisNow === "accrual"
        ? " Figures exclude GST."
        : gstSelect.value === "gross"
          ? " Figures include GST, so they are what moved rather than what reaches profit."
          : " Figures exclude GST, which is the basis a return is filed on."
      : "");

  const years = [
    ...new Set(state.ledger.transactions.map((t) => financialYearOf(t.date))),
  ].sort((a, b) => b - a);
  const yearSelect = $<HTMLSelectElement>("report-year");
  const chosenYear = yearSelect.value;
  yearSelect.textContent = "";
  for (const year of years) {
    const option = document.createElement("option");
    option.value = String(year);
    option.textContent = `FY${year} (year to 31 Mar ${year})`;
    option.selected = String(year) === chosenYear;
    yearSelect.append(option);
  }

  // The owner list comes from the entities, so it only has people in it once
  // ownership has been set against one.
  const kind = $<HTMLSelectElement>("report-kind").value;
  const ownerSelect = $<HTMLSelectElement>("report-owner");
  const owners = ownersOf(state.ledger.entities ?? emptyEntityModel());
  const chosenOwner = ownerSelect.value;
  ownerSelect.textContent = "";
  for (const owner of owners) {
    const option = document.createElement("option");
    option.value = owner;
    option.textContent = owner;
    option.selected = owner === chosenOwner;
    ownerSelect.append(option);
  }
  ownerSelect.hidden = kind !== "owner";
  $("assets-pick").hidden = kind !== "depreciation";

  const chosenYearNow = Number($<HTMLSelectElement>("report-year").value) || years[0];

  if (kind === "balancesheet") {
    ownerSelect.hidden = true;
    if (chosenYearNow !== undefined) renderBalanceSheet(body, chosenYearNow);
    return;
  }

  if (kind === "ir10") {
    ownerSelect.hidden = true;
    if (chosenYearNow !== undefined) renderIr10(body, chosenYearNow);
    return;
  }

  if (kind === "shareholders") {
    ownerSelect.hidden = true;
    if (chosenYearNow !== undefined) renderShareholders(body, chosenYearNow);
    return;
  }

  if (kind === "manual") {
    ownerSelect.hidden = true;
    if (chosenYearNow !== undefined) renderManualJournals(body, chosenYearNow);
    return;
  }

  if (kind === "journal") {
    ownerSelect.hidden = true;
    if (chosenYearNow !== undefined) renderJournal(body, chosenYearNow);
    return;
  }

  if (kind === "depreciation") {
    ownerSelect.hidden = true;
    if (chosenYearNow !== undefined) renderDepreciation(body, chosenYearNow);
    return;
  }

  if (kind === "extract") {
    ownerSelect.hidden = true;
    if (chosenYearNow !== undefined) renderExtract(body, chosenYearNow);
    return;
  }

  if (kind === "charts") {
    ownerSelect.hidden = true;
    if (chosenYearNow !== undefined) renderCharts(body, chosenYearNow);
    return;
  }

  if (kind === "general") {
    ownerSelect.hidden = true;
    if (chosenYearNow !== undefined) renderGeneralLedger(body, chosenYearNow);
    return;
  }

  if (kind === "owner") {
    if (owners.length === 0) {
      body.append(
        note(
          "No owners set. On Entities & accounts, give an entity its owners — " +
            "for example “Ana Whitcombe 50%; Tom Whitcombe 50%”.",
        ),
      );
      return;
    }
    const owner = ownerSelect.value || owners[0];
    if (owner !== undefined && chosenYearNow !== undefined) {
      renderOwnerReport(body, owner, chosenYearNow);
    }
    return;
  }

  const built = currentReport();
  if (!built) {
    body.append(note("No transactions yet. Import a bank file first."));
    return;
  }
  const { report, title, year } = built;

  const heading = document.createElement("h3");
  const basisChoice = $<HTMLSelectElement>("report-basis").value;
  const usingAccrual =
    basisChoice === "posted" ||
    (basisChoice === "accrual" && (state.ledger.journals ?? []).length > 0);
  const how =
    basisChoice === "posted"
      ? "accrual, from our own postings"
      : usingAccrual
        ? "accrual, from the imported ledger"
        : "cash";
  heading.textContent = `${title} — Profit and Loss, FY${year} (${how})`;
  body.append(heading);
  if (!usingAccrual && basisChoice === "accrual") {
    body.append(
      note(
        "No general ledger loaded, so this is the cash figure from bank data. " +
          "Accrual needs invoices and year-end journals, which a bank statement does not " +
          "carry — load a Xero Journal Report with the button above.",
      ),
    );
  }

  const table = document.createElement("table");
  table.className = "report-table";
  const tbody = document.createElement("tbody");

  const money = (cents: number): string =>
    (cents / 100).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const addRow = (label: string, value: string, cls = "", count = ""): void => {
    const tr = document.createElement("tr");
    if (cls !== "") tr.className = cls;
    const name = document.createElement("td");
    name.textContent = label;
    name.className = "report-name";
    const n = document.createElement("td");
    n.textContent = count;
    n.className = "report-count";
    const amount = document.createElement("td");
    amount.textContent = value;
    amount.className = "report-amount";
    tr.append(name, n, amount);
    tbody.append(tr);
  };

  addRow("Income", "", "report-section");
  for (const line of report.income) addRow(line.code, money(line.net), "", String(line.count));
  addRow("Total Income", money(report.totalIncome), "report-total");

  addRow("Expenses", "", "report-section");
  for (const line of report.expenses) addRow(line.code, money(-line.net), "", String(line.count));
  addRow("Total Expenses", money(report.totalExpenses), "report-total");

  addRow("Net Profit", money(report.netProfit), "report-net");
  table.append(tbody);
  body.append(table);

  if (report.unclassified.length > 0) {
    const h = document.createElement("h3");
    h.textContent = `Not in the profit figure (${report.unclassified.length})`;
    body.append(h);
    body.append(
      note(
        "Transfers between your own accounts, drawings, loan principal — and anything whose " +
          "account has no type set. Give an account a type on Entities & accounts and it moves " +
          "onto the report.",
      ),
    );
    const other = document.createElement("table");
    other.className = "report-table";
    const otherBody = document.createElement("tbody");
    for (const line of report.unclassified) {
      const tr = document.createElement("tr");
      const name = document.createElement("td");
      name.textContent = line.code;
      name.className = "report-name";
      const n = document.createElement("td");
      n.textContent = String(line.count);
      n.className = "report-count";
      const amount = document.createElement("td");
      amount.textContent = money(line.net);
      amount.className = "report-amount";
      tr.append(name, n, amount);
      otherBody.append(tr);
    }
    other.append(otherBody);
    body.append(other);
  }

  if (report.uncoded.count > 0) {
    body.append(
      note(
        `${report.uncoded.count} transactions in FY${year} are not coded at all, ` +
          `totalling ${money(report.uncoded.gross)}. They are in no figure above.`,
      ),
    );
  }
}

function downloadReport(): void {
  const years = [
    ...new Set(state.ledger.transactions.map((t) => financialYearOf(t.date))),
  ].sort((a, b) => b - a);
  const year = Number($<HTMLSelectElement>("report-year").value) || years[0];

  if ($<HTMLSelectElement>("report-kind").value === "depreciation") {
    const assets = state.ledger.assets ?? [];
    if (assets.length === 0 || year === undefined) return;
    download(
      formatDepreciationSchedule(
        depreciationSchedule(assets, { from: `${year - 1}-04-01`, to: `${year}-03-31` }),
        `Depreciation schedule, FY${year}`,
      ),
      `depreciation-schedule-fy${year}.csv`,
      "text/csv",
    );
    return;
  }

  if ($<HTMLSelectElement>("report-kind").value === "owner") {
    const owner = $<HTMLSelectElement>("report-owner").value;
    if (owner === "" || year === undefined) return;
    download(
      formatOwnerSummary(ownerSummaryFor(owner, year), year),
      `rental-income-${owner.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-fy${year}.csv`,
      "text/csv",
    );
    return;
  }

  const built = currentReport();
  if (!built) return;

  // The exported file has to say what it is. It leaves this app and gets read
  // months later beside three others, and a figure whose basis is guessed at is
  // worse than no figure.
  const exportBasis = $<HTMLSelectElement>("report-basis").value;
  const exportNote =
    (exportBasis === "cash"
      ? "Cash basis, from bank data. No depreciation or year-end journals."
      : exportBasis === "posted"
        ? "Accrual basis, from our postings."
        : "Accrual basis, from the imported file.") +
    ($<HTMLSelectElement>("report-gst").value === "gross" && exportBasis !== "accrual"
      ? " GST inclusive."
      : " GST exclusive.");

  download(
    formatProfitAndLoss(
      built.report,
      `${built.title} — Profit and Loss, FY${built.year}`,
      exportNote,
    ),
    `profit-and-loss-${built.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-fy${built.year}.csv`,
    "text/csv",
  );
}

/**
 * Every coded line for the year, in the shape an accounting system exports.
 *
 * The report an accountant asks for by name. Handing somebody a ledger means
 * handing them something they can already read, and every one of them can read
 * this: date, who, what it was coded to, and what GST was on it, one row per
 * line of the bank statement.
 *
 * The same file this app reads back, which is what stops the format drifting
 * into something only this app understands. Export a year, load it on the
 * Check page, and every line agrees with itself.
 */
function renderExtract(body: HTMLElement, year: number): void {
  const engine = reportEngine();
  if (engine === null) {
    body.append(note("No transactions yet. Import some bank data first."));
    return;
  }

  const from = `${year - 1}-04-01`;
  const to = `${year}-03-31`;
  const scope = accountsFor(state.varianceAccounts);
  const rows = engine.transactions.filter(
    (t) => t.date >= from && t.date <= to && (scope.length === 0 || scope.includes(t.account)),
  );

  const entity = reportingEntity();
  const labels = banks().labels;
  const invoices = new Map((state.ledger.invoices ?? []).map((i) => [i.number, i]));
  const settled = state.ledger.invoiceMatches ?? {};

  const options = {
    ...(entity !== undefined ? { entity: entity.name } : {}),
    period: { from, to },
    codeOf: (t: Transaction) => engine.codeOf(t) ?? "",
    classify: engine.classify,
    accountName: (id: string) => labels.get(id) ?? id,
    invoiceOf: (t: Transaction) => {
      const number = settled[t.id];
      return number === undefined ? "" : (invoices.get(number)?.number ?? number);
    },
  };

  const built = accountTransactionRows(rows, options);
  const uncoded = built.filter((r) => r.relatedAccount === "(not coded)").length;

  body.append(
    note(
      `${built.length} lines for the year to ${to}` +
        (scope.length > 0 ? `, on ${scope.length} account${scope.length === 1 ? "" : "s"}` : "") +
        (uncoded > 0
          ? `. ${uncoded} of them have no coding and are written as "(not coded)" rather than ` +
            `left looking coded to nothing.`
          : ". Every one of them is coded."),
    ),
  );

  const save = document.createElement("button");
  save.type = "button";
  save.className = "primary";
  save.textContent = `Export ${built.length} lines as CSV`;
  save.disabled = built.length === 0;
  save.addEventListener("click", () => {
    download(
      formatAccountTransactions(rows, options),
      `account-transactions-fy${year}.csv`,
      "text/csv",
    );
  });
  body.append(save);

  if (built.length === 0) return;

  // Shown before it is saved, because a file downloaded and opened elsewhere
  // is a slow way to find out the coding was not what you thought.
  const table = document.createElement("table");
  table.className = "extract-table";
  table.innerHTML =
    "<thead><tr><th>Date</th><th>Source</th><th>Contact</th><th>Description</th>" +
    "<th>Gross</th><th>GST</th><th>Rate</th><th>Account</th><th>Coded to</th></tr></thead>";
  const tbody = document.createElement("tbody");
  for (const row of built.slice(0, 200)) {
    const tr = document.createElement("tr");
    tr.append(nameCell(row.date), nameCell(row.source), nameCell(row.contact));
    tr.append(nameCell(row.description));
    tr.append(amountCell(formatAmount(row.gross)), amountCell(formatAmount(row.gst)));
    tr.append(nameCell(row.gstRateName), nameCell(row.account));
    const coded = nameCell(row.relatedAccount);
    if (row.relatedAccount === "(not coded)") coded.className = "match-off";
    tr.append(coded);
    tbody.append(tr);
  }
  table.append(tbody);
  body.append(table);
  if (built.length > 200) {
    body.append(note(`Showing the first 200 of ${built.length}. The export holds them all.`));
  }
}

/** The twelve months of a financial year, April to March. */
function monthsOfYear(year: number): { label: string; from: string; to: string }[] {
  const names = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];
  return names.map((label, index) => {
    const month = ((index + 3) % 12) + 1;
    const calendar = index <= 8 ? year - 1 : year;
    const last = new Date(Date.UTC(calendar, month, 0)).getUTCDate();
    const two = String(month).padStart(2, "0");
    return { label, from: `${calendar}-${two}-01`, to: `${calendar}-${two}-${last}` };
  });
}

/**
 * The year in two pictures.
 *
 * Every figure here comes from the same builder the profit and loss uses, run
 * once for each month rather than totalled again here, so whatever basis,
 * entity and GST setting the page is on applies to both and a bar can never
 * disagree with the report above it. Slower than summing the transactions, and
 * twelve of these is nothing at this size; a chart that quietly means
 * something else than the report it sits beside is worth far more than the
 * milliseconds.
 */
function renderCharts(body: HTMLElement, year: number): void {
  const whole = currentReport();
  if (whole === null) {
    body.append(note("No transactions yet. Import some bank data first."));
    return;
  }

  const months = monthsOfYear(year).map((month) => {
    const built = currentReport({ from: month.from, to: month.to });
    return {
      label: month.label,
      income: built?.report.totalIncome ?? 0,
      expenses: built?.report.totalExpenses ?? 0,
    };
  });

  body.append(
    statTiles([
      { label: "Money in", value: whole.report.totalIncome },
      { label: "Money out", value: Math.abs(whole.report.totalExpenses) },
      {
        label: whole.report.netProfit >= 0 ? "Net profit" : "Net loss",
        value: whole.report.netProfit,
        note: `${whole.title}, FY${year}`,
      },
    ]),
  );

  // Nothing coded at all is the first thing a new set of books looks like, and
  // three zeroes with no explanation is the worst possible answer to it: the
  // charts look broken when they are merely early. Said whatever basis the
  // page is on, because the accrual side does not count uncoded lines and the
  // person who has just imported a statement is exactly who sees this.
  const nothingYet =
    whole.report.totalIncome === 0 &&
    whole.report.totalExpenses === 0 &&
    state.ledger.transactions.some(
      (line) => line.date >= `${year - 1}-04-01` && line.date <= `${year}-03-31`,
    );
  if (nothingYet) {
    const empty = document.createElement("p");
    empty.className = "variance-note warn";
    empty.textContent =
      "Every figure here is zero because nothing in this year has been coded yet. " +
      "Code some transactions on the Reconcile page and these fill in; until then " +
      "there is nothing for a chart to show.";
    body.append(empty);
  }

  // Said before the pictures, not under them: a shape read from figures that
  // are a third guesswork is a shape somebody will remember and act on.
  if (!nothingYet && whole.report.uncoded.count > 0) {
    const warn = document.createElement("p");
    warn.className = "variance-note warn";
    warn.textContent =
      `${whole.report.uncoded.count} transactions this year have no code, worth ` +
      `${formatAmount(Math.abs(whole.report.uncoded.gross))}. They are in neither ` +
      `figure below, so both charts understate.`;
    body.append(warn);
  }

  const monthly = document.createElement("h3");
  monthly.className = "chart-heading";
  monthly.textContent = `Month by month, FY${year}`;
  body.append(monthly, monthlyColumns(months));

  const biggest = [...whole.report.expenses]
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
    .slice(0, 10)
    .map((line) => ({ label: line.code, value: line.net }));

  if (biggest.length > 0) {
    const where = document.createElement("h3");
    where.className = "chart-heading";
    where.textContent =
      biggest.length === whole.report.expenses.length
        ? `Where it went, FY${year}`
        : `Where it went: the ten biggest of ${whole.report.expenses.length} accounts, FY${year}`;
    body.append(where, rankedBars(biggest));
  }

  // The numbers behind the pictures, for anybody the pictures do not serve.
  const table = document.createElement("table");
  table.className = "extract-table";
  table.innerHTML = "<thead><tr><th>Month</th><th>In</th><th>Out</th><th>Net</th></tr></thead>";
  const tbody = document.createElement("tbody");
  for (const month of months) {
    const tr = document.createElement("tr");
    tr.append(nameCell(month.label));
    tr.append(amountCell(formatAmount(month.income)));
    tr.append(amountCell(formatAmount(Math.abs(month.expenses))));
    tr.append(amountCell(formatAmount(month.income - Math.abs(month.expenses))));
    tbody.append(tr);
  }
  table.append(tbody);
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "The figures behind these charts";
  details.append(summary, table);
  body.append(details);
}

/**
 * Every line the books are made of, for a year.
 *
 * The account transactions extract answers "what happened on this bank
 * account". This answers the question asked when a figure looks wrong: what is
 * this total actually made of. One row per posting line -- so an accountant's
 * fee is three rows, the money out, the cost and the GST, and they come to
 * nothing because that is what a balanced entry does.
 *
 * Built from the same journals the profit and loss, the trial balance and the
 * GST return are built from, rather than from a second pass over the
 * transactions. If this disagrees with them the report is wrong and not the
 * books, which is the only way a listing like this is worth reading.
 */
function renderGeneralLedger(body: HTMLElement, year: number): void {
  const from = `${year - 1}-04-01`;
  const to = `${year}-03-31`;
  const scope = entityBankAccounts();
  const journals = postedJournals().filter((journal) => {
    if (journal.date < from || journal.date > to) return false;
    if (scope.length === 0) return true;
    return journal.lines.some((line) => scope.includes(line.accountCode));
  });

  if (journals.length === 0) {
    body.append(note("Nothing posted in this year for the chosen entity."));
    return;
  }

  const entity = reportingEntity();
  const options = {
    ...(entity !== undefined ? { entity: entity.name } : {}),
    period: { from, to },
  };
  const rows = generalLedgerRows(journals);
  const totals = generalLedgerTotals(rows);

  body.append(
    note(
      `${rows.length} lines from ${journals.length} entries, ` +
        `${formatAmount(totals.debit)} debits against ${formatAmount(totals.credit)} credits.`,
    ),
  );

  // Said before the listing rather than under it. A set of books that does not
  // balance is the one fact worth knowing before reading anything else in it.
  if (totals.difference !== 0) {
    const off = document.createElement("p");
    off.className = "variance-note warn";
    off.textContent =
      `These entries do not balance: debits exceed credits by ` +
      `${formatAmount(totals.difference)}. Every entry should come to nothing, so ` +
      "this is a fault in the books rather than a rounding.";
    body.append(off);
  }

  const save = document.createElement("button");
  save.type = "button";
  save.className = "primary";
  save.textContent = `Export ${rows.length} lines as CSV`;
  save.addEventListener("click", () => {
    download(formatGeneralLedger(journals, options), `general-ledger-fy${year}.csv`, "text/csv");
  });
  body.append(save);

  const table = document.createElement("table");
  table.className = "extract-table";
  table.innerHTML =
    "<thead><tr><th>Date</th><th>Entry</th><th>Account</th><th>Description</th>" +
    "<th>Debit</th><th>Credit</th><th>Tax</th></tr></thead>";
  const tbody = document.createElement("tbody");

  let last = "";
  for (const row of rows.slice(0, 300)) {
    const tr = document.createElement("tr");
    // The entry is named once and its other lines are indented under it, so
    // three rows read as one thing rather than as three coincidences.
    const first = row.journal !== last;
    last = row.journal;
    if (first) tr.classList.add("entry-start");
    tr.append(nameCell(first ? row.date : ""));
    tr.append(nameCell(first ? row.narration : ""));
    tr.append(nameCell(`${row.accountCode ? `${row.accountCode} ` : ""}${row.accountName}`));
    tr.append(nameCell(row.description));
    tr.append(amountCell(row.debit === 0 ? "" : formatAmount(row.debit)));
    tr.append(amountCell(row.credit === 0 ? "" : formatAmount(row.credit)));
    tr.append(nameCell(row.taxType === "NONE" ? "" : row.taxType));
    tbody.append(tr);
  }
  table.append(tbody);
  body.append(table);

  if (rows.length > 300) {
    body.append(note(`Showing the first 300 of ${rows.length}. The export holds them all.`));
  }
}

function renderVariance(): void {
  fillAccounts("variance-accounts", state.varianceAccounts, () => {
    // Remembered with the ledger: re-picking the same accounts after every
    // reload is work, and getting it wrong quietly changes every figure below.
    state.ledger = { ...state.ledger, varianceAccounts: [...state.varianceAccounts] };
    void save(state.ledger);
    recomputeVariance();
    renderVariance();
  });
  const body = $("variance-body");
  const hint = $("variance-hint");
  body.innerHTML = "";

  // A return is the figure it matters most to be right about.
  const unresolved = unresolvedNote();
  if (unresolved) body.append(unresolved);

  if (state.varianceProblems.length > 0) {
    const list = document.createElement("div");
    list.className = "variance-problems";
    for (const problem of state.varianceProblems) {
      const line = document.createElement("p");
      line.className = "variance-note";
      line.textContent = problem;
      list.append(line);
    }
    body.append(list);
  }

  if (state.varianceRows.length === 0) return;

  // What the figures below are guessing at.
  //
  // A transaction nothing has coded still reaches a return: it falls through
  // every rule and is treated as standard-rated, which puts it in Box 11 and
  // claims three twenty-thirds of it in Box 12. On books that are part-way
  // coded that is a real amount of tax claimed on nobody's authority, and it
  // is claimed silently -- the difference against the filed return looks like
  // a disagreement rather than a gap in the coding. Said once, above the
  // table, because it explains most of what is in it.
  let assumedLines = 0;
  let assumedTax = 0;
  for (const row of state.varianceRows) {
    for (const line of row.computed?.lines ?? []) {
      if (line.classification.assumed !== true) continue;
      assumedLines += 1;
      assumedTax += Math.abs(gstWithin(line.amount, line.classification));
    }
  }
  if (assumedLines > 0) {
    const warning = document.createElement("p");
    warning.className = "variance-note warn";
    warning.textContent =
      `${assumedLines} line${assumedLines === 1 ? "" : "s"} in these periods have no coding and no ` +
      `GST treatment, so they were assumed to be standard-rated. That is ${formatAmount(assumedTax)} ` +
      `of GST claimed or charged on an assumption. Code them, or set a treatment on their account, ` +
      `before treating the differences below as disagreements.`;
    body.append(warning);
  }

  hint.textContent =
    "Box 8 less Box 12 on both sides, so late claims and year-end adjustments do not distort it. Click a period for its lines.";

  const table = document.createElement("table");
  table.innerHTML =
    "<thead><tr><th>Period</th><th>Filed</th><th>Ours</th><th>Difference</th>" +
    "<th>Explained</th><th>Left</th></tr></thead>";
  const tbody = document.createElement("tbody");

  for (const row of state.varianceRows) {
    const tr = document.createElement("tr");
    tr.className = row.left === 0 ? "settled" : row.left === null ? "" : "open";
    const cells = [
      row.periodEnd,
      formatAmount(row.filed),
      row.ours === null ? "--" : formatAmount(row.ours),
      row.difference === null ? "" : formatAmount(row.difference),
      formatAmount(row.explained),
      row.left === null ? "" : formatAmount(row.left),
    ];
    cells.forEach((text, index) => {
      const td = document.createElement("td");
      td.textContent = text;
      if (index === 5) td.className = "left";
      tr.append(td);
    });
    tr.addEventListener("click", () => {
      state.openPeriod = state.openPeriod === row.periodEnd ? null : row.periodEnd;
      renderVariance();
    });
    tbody.append(tr);
  }

  table.append(tbody);
  body.append(table);

  const open = state.varianceRows.find((row) => row.periodEnd === state.openPeriod);
  if (open) body.append(renderDetail(open));
}

function renderDetail(row: VarianceRow): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "variance-detail";
  const detail = detailFor(row);

  const title = document.createElement("h3");
  title.textContent = `${row.periodEnd} — ${row.filedReturn.basis}`;
  wrap.append(title);

  if (!detail) {
    const none = document.createElement("p");
    none.className = "variance-note";
    none.textContent = "No computed return for this period, so there is nothing to line up.";
    wrap.append(none);
    return wrap;
  }

  const summary = document.createElement("p");
  summary.className = "variance-note";
  summary.textContent =
    `${detail.matched} lines agree exactly. ` +
    `Filed GST ${formatAmount(detail.filedGst)}, ours ${formatAmount(detail.ourGst)}.`;
  wrap.append(summary);

  const section = (heading: string, lines: readonly { date: string; amount: number; who: string; what: string }[]) => {
    if (lines.length === 0) return;
    const h = document.createElement("h4");
    h.textContent = `${heading} (${lines.length})`;
    wrap.append(h);
    const table = document.createElement("table");
    table.innerHTML = "<thead><tr><th>Date</th><th>Amount</th><th>GST</th><th>Who</th><th>What</th></tr></thead>";
    const tbody = document.createElement("tbody");
    for (const line of [...lines].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))) {
      const tr = document.createElement("tr");
      for (const [index, text] of [
        line.date,
        formatAmount(line.amount),
        formatAmount(Math.round((line.amount * 3) / 23)),
        line.who,
        line.what,
      ].entries()) {
        const td = document.createElement("td");
        td.textContent = text;
        if (index >= 3) td.style.textAlign = "left";
        tr.append(td);
      }
      tbody.append(tr);
    }
    table.append(tbody);
    wrap.append(table);
  };

  section("In the filed return, not in ours", detail.onlyFiled);
  section("In ours, not in the filed return", detail.onlyOurs);
  return wrap;
}

function render(): void {
  renderStatus();
  renderReports();
  renderTable();
}

function renderStatus(): void {
  const counts = {
    total: state.entries.length,
    review: state.entries.filter((entry) => entry.status === "review").length,
    duplicate: state.entries.filter((entry) => entry.status === "duplicate").length,
  };

  $("stat-total").textContent = String(state.ledger.transactions.length);
  $("stat-review").textContent = String(counts.review);
  $("stat-accounts").textContent = String(
    new Set(state.ledger.transactions.map((t) => t.account)).size,
  );

  const range = dateRange(state.ledger.transactions);
  $("stat-range").textContent = range ? `${range.from} to ${range.to}` : "--";

  for (const filter of ["all", "review", "duplicate"] as const) {
    $(`filter-${filter}`).classList.toggle("active", state.filter === filter);
  }
  $("filter-review").textContent = `Needs review (${counts.review})`;
  $("filter-duplicate").textContent = `Duplicates (${counts.duplicate})`;

  const warning = $("storage-warning");
  warning.hidden = state.persistent;

  $("busy").hidden = !state.busy;
}

function renderReports(): void {
  const container = $("reports");
  if (state.reports.length === 0) {
    // No import this session, but a short export stays short: the warning
    // belongs to the data rather than to the moment it arrived.
    container.innerHTML = "";
    appendTruncationWarning(container);
    return;
  }

  container.innerHTML = state.reports
    .map((report) => {
      if (report.error) {
        return `<div class="report error">
          <strong>${escapeHtml(report.name)}</strong>
          <p>${escapeHtml(report.error)}</p>
        </div>`;
      }

      const problems =
        report.problems.length === 0
          ? ""
          : `<details><summary>${report.problems.length} row(s) skipped</summary><ul>${report.problems
              .map(
                (problem) =>
                  `<li><code>line ${problem.line}</code> ${escapeHtml(problem.message)}</li>`,
              )
              .join("")}</ul></details>`;

      return `<div class="report">
        <strong>${escapeHtml(report.name)}</strong>
        <p>${report.count} transactions &middot; ${escapeHtml(report.importer)} &middot; ${escapeHtml(
          report.account,
        )}</p>
        ${problems}
      </div>`;
    })
    .join("");

  appendTruncationWarning(container);
}

/** Say so when an account looks cut off at the bank's export limit. */
function appendTruncationWarning(container: HTMLElement): void {
  const cut = truncatedAccounts();
  if (cut.length > 0) {
    container.insertAdjacentHTML(
      "beforeend",
      `<div class="report cut-off"><strong>Some of this may be missing</strong>
        <p>${cut.map((a) => escapeHtml(a)).join(", ")} ${
          cut.length === 1 ? "holds" : "hold"
        } exactly 1,000 transactions, which is where BNZ stops an export without
        saying so. Export ${cut.length === 1 ? "that account" : "those accounts"} again in
        shorter date ranges and import each one: nothing is counted twice, and the daily
        balance check will confirm it.</p>
      </div>`,
    );
  }
}

/**
 * Accounts whose export looks cut off at the bank's row limit.
 *
 * BNZ stops a transaction export at a thousand rows without saying so. The
 * file looks complete, imports cleanly, and quietly begins part way through
 * the period -- which shows up much later as a balance that will not tie, and
 * is very hard to recognise from the far end. A count of exactly a thousand is
 * the tell, and it is worth saying out loud at the moment of import.
 */
function truncatedAccounts(): string[] {
  const counts = new Map<string, number>();
  for (const t of state.ledger.transactions) {
    counts.set(t.account, (counts.get(t.account) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n === 1000).map(([account]) => account);
}

function renderTable(): void {
  const body = $("rows");

  let entries = state.entries;
  if (state.filter !== "all") {
    entries = entries.filter((entry) => entry.status === state.filter);
  }
  if (state.search !== "") {
    entries = entries.filter((entry) => matches(entry.transaction, state.search));
  }

  if (entries.length === 0) {
    body.innerHTML = `<tr><td colspan="7" class="empty">${
      state.ledger.transactions.length === 0
        ? "No transactions yet. Drop a bank export above to get started."
        : "Nothing matches this filter."
    }</td></tr>`;
    return;
  }

  // Newest first, which is what someone reconciling a month actually wants.
  const sorted = [...entries].sort((a, b) =>
    b.transaction.date.localeCompare(a.transaction.date),
  );

  const limit = 500;
  const shown = sorted.slice(0, limit);

  // What the bank's own balance says about each row we are asking about. Only
  // the questionable ones are judged: this answers a question already on the
  // screen rather than going looking for new ones.
  const verdicts = new Map<string, DuplicateJudgement>();
  if (state.balanceChecks.length > 0) {
    const asking = shown.filter((e) => e.status === "review").map((e) => e.transaction);
    for (const judgement of judgeDuplicates(asking, state.balanceChecks)) {
      verdicts.set(judgement.transactionId, judgement);
    }
  }

  body.innerHTML = shown
    .map((entry, index) => {
      const t = entry.transaction;
      const negative = t.amount < 0;
      const foreign = t.foreign
        ? `<span class="foreign">${escapeHtml(t.foreign.currency)} ${formatAmount(
            t.foreign.amount,
            t.foreign.currency,
          )}</span>`
        : "";

      return `<tr class="status-${entry.status}">
        <td class="date">${t.date}</td>
        <td class="amount ${negative ? "out" : "in"}">${formatAmount(
          t.amount,
          t.currency,
        )}<span class="ccy">${escapeHtml(t.currency)}</span>${foreign}</td>
        <td class="party">${escapeHtml(t.otherParty || "--")}</td>
        <td class="detail">${escapeHtml(
          [t.particulars, t.code, t.reference].filter(Boolean).join(" / ") || "--",
        )}</td>
        <td class="account">${escapeHtml(t.account)}</td>
        <td class="source" title="${escapeHtml(t.source.file)}">${escapeHtml(
          t.source.file,
        )}:${t.source.line}</td>
        <td class="status">
          <span class="chip ${entry.status}">${entry.status}</span>
          ${
            entry.reason
              ? `<p class="reason">${escapeHtml(entry.reason)}</p>`
              : ""
          }
          ${(() => {
            if (entry.status !== "review") return "";
            const judgement = verdicts.get(t.id);
            const said = judgement
              ? `<p class="verdict verdict-${judgement.verdict.replace(/ /g, "-")}">` +
                `${escapeHtml(judgement.reason)}</p>`
              : "";
            // The likelier answer goes first and is the emphasised one, so the
            // button a person reaches for is the one the bank supports.
            const removeFirst = judgement?.verdict === "double counted";
            const keep = `<button data-action="keep" data-index="${index}"${
              removeFirst ? "" : ' class="primary"'
            }>Keep both</button>`;
            const remove = `<button data-action="remove" data-index="${index}"${
              removeFirst ? ' class="primary"' : ""
            }>Remove this one</button>`;
            return `${said}<div class="actions">${
              removeFirst ? remove + keep : keep + remove
            }</div>`;
          })()}
        </td>
      </tr>`;
    })
    .join("");

  if (sorted.length > limit) {
    body.insertAdjacentHTML(
      "beforeend",
      `<tr><td colspan="7" class="empty">Showing the first ${limit} of ${sorted.length}. Use search to narrow it down.</td></tr>`,
    );
  }

  for (const button of body.querySelectorAll<HTMLButtonElement>("button[data-action]")) {
    button.addEventListener("click", () => {
      const entry = shown[Number(button.dataset.index)];
      if (!entry) return;
      if (button.dataset.action === "keep") void allow(entry.transaction);
      else void remove(entry.transaction);
    });
  }
}

function matches(transaction: Transaction, needle: string): boolean {
  return [
    transaction.otherParty,
    transaction.particulars,
    transaction.code,
    transaction.reference,
    transaction.account,
    transaction.date,
    formatAmount(transaction.amount, transaction.currency),
  ]
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

function dateRange(transactions: readonly Transaction[]): { from: string; to: string } | null {
  if (transactions.length === 0) return null;
  let from = transactions[0]!.date;
  let to = from;
  for (const transaction of transactions) {
    if (transaction.date < from) from = transaction.date;
    if (transaction.date > to) to = transaction.date;
  }
  return { from, to };
}

/**
 * Escape before inserting into HTML.
 *
 * Payee and particulars fields are attacker-influenced in the sense that
 * anyone who can pay you can choose what appears in them, and a ledger is
 * exactly the kind of file people forward to an accountant.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

void init();
