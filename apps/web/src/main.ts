import { redraw, registerPages, showPage } from "./app.js";
import {
  accountsForEditing,
  asCsvText,
  recomputeVariance,
  ensureDefaultEntity,
  reclassify,
  record,
  tidyChart,
  DEMO_SEEDED,
  markDemoSeeded,
  useRules,
} from "./books.js";
import {
  renderBooks,
} from "./daily/books-page.js";
import {
  renderRules,
} from "./daily/rules.js";
import {
  renderAssetsPage,
} from "./daily/assets.js";
import {
  renderHistory,
} from "./daily/history.js";
import {
  renderVariance,
} from "./daily/gst-reconcile.js";
import {
  renderOpeningBalances,
} from "./daily/opening-balances.js";
import {
  renderReconcile,
} from "./daily/reconcile-page.js";
import {
  currentReport,
  ownerSummaryFor,
  renderReportsPage,
} from "./daily/reports.js";
import {
  renderInvoiceEditor,
  renderInvoices,
  startNewInvoice,
} from "./daily/invoices.js";
import {
  renderEntities,
} from "./daily/entities.js";
import {
  loadStartupFiles,
  renderSetup,
  renderSetupBody,
} from "./migrate/setup-wizard.js";
import {
  acceptAllShown,
  applyChartColumns,
  loadCheckFiles,
  renderCheck,
} from "./migrate/coding-reconciliation.js";
import { $, state } from "./state.js";
import { } from "./combobox.js";
import type { } from "./combobox.js";
import {
  financialYearOf,
  accountsAtExportLimit,
  feedResumeDate,
  openingBalancesFrom,
  parseTrialBalance,
  dayAfter,
  dedupe,
  dedupeKey,
  accountEntityKey,
  emptyEntityModel,
  dedupeReference,
  identifyExport,
  starterChart,
  checkDailyBalances,
  judgeDuplicates,
  parseDailyBalances,
  depreciationSchedule,
  akahuAccountId,
  fromAkahu,
  matchLedgerAccount,
  hash,
  formatChartOfAccounts,
  formatDepreciationSchedule,
  formatOwnerSummary,
  formatOwners,
  formatProfitAndLoss,
  parseFixedAssets,
  parseXeroAllocations,
  parseXeroInvoices,
  parseXeroJournalReport,
  validateInvoices,
  formatAmount,
  importFile,
  importers,
} from "@nzosa/core";
import type {
  Account,
  AkahuAccount,
  IsoDate,
  OpeningBalances,
  AkahuTransaction,
  Cents,
  BalanceCheck,
  DuplicateJudgement,
  Identified,
  ImportProblem,
  Transaction,
} from "@nzosa/core";
import { readFiledReturns } from "./variance.js";
import {
  THEME_KEY,
  amountCell,
  currentTheme,
  download,
  escapeHtml,
  nameCell,
  note,
  setLoadingStatus,
} from "./ui.js";
import type { Theme } from "./ui.js";
import type { } from "./check-ui.js";
import type { } from "./events.js";
import { } from "./split-ui.js";
import type { } from "./rules-editor.js";
import type { } from "@nzosa/core";
import type { RuleFileShape } from "./rules-ui.js";
import type { } from "./variance.js";
import {
  clear,
  emptyLedger,
  load,
  loadRules,
  loadRulesArchive,
  currentLedger,
  ledgers,
  writesToFolder,
  loadEvents,
  loadUser,
  requestPersistence,
  save,
  savePart,
  saveUser,
} from "./store.js";
import type { StoredLedger } from "./store.js";
import type { } from "./events.js";

/**
 * The whole front end.
 *
 * Files are read with the FileReader API and parsed by @nzosa/core in
 * this tab. Nothing is uploaded: there is no fetch call in this application,
 * which is a property worth keeping as it grows.
 */




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
  return feedResumeDate({ mapping, transactions: state.ledger.transactions });
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


function dismissLoading(): void {
  const el = document.getElementById("app-loading");
  if (!el) return;
  el.classList.add("dismissed");
  setTimeout(() => el.remove(), 400);
}

async function init(): Promise<void> {
  // Before the first load, because loading changes the state and the state is
  // what a page is drawn from. Every page at once: leaving one out does not
  // compile, which is the point of taking the whole set.
  registerPages({
    assets: renderAssetsPage,
    books: renderBooks,
    check: renderCheck,
    entities: renderEntities,
    entityFilter: renderEntityFilter,
    feed: renderFeed,
    history: renderHistory,
    importRows: renderTable,
    invoiceEditor: renderInvoiceEditor,
    invoices: renderInvoices,
    openBooks: renderOpenBooks,
    openingBalances: renderOpeningBalances,
    reconcile: renderReconcile,
    reports: renderReportsPage,
    rules: renderRules,
    setup: renderSetup,
    setupBody: renderSetupBody,
    variance: renderVariance,
  });
  setLoadingStatus("Opening books…");
  try {
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

    setLoadingStatus("Preparing workspace…");
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
  } finally {
    dismissLoading();
  }
}

function wireUp(): void {
  const demoBanner = document.getElementById("demo-banner");
  if (demoBanner) {
    demoBanner.hidden = writesToFolder();
    $("demo-banner-close")?.addEventListener("click", () => {
      demoBanner.hidden = true;
    });
  }

  const demoNotice = document.getElementById("demo-import-privacy-notice");
  if (demoNotice) {
    demoNotice.hidden = writesToFolder();
  }

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
    redraw("importRows");
  });

  for (const button of document.querySelectorAll<HTMLButtonElement>(".sidebar-nav button[data-page]")) {
    button.addEventListener("click", () => {
      showPage(button.dataset["page"] ?? "reconcile");
    });
  }

  for (const link of document.querySelectorAll<HTMLAnchorElement>(".import-subnav-link, .sidebar-sublink")) {
    link.addEventListener("click", (e) => {
      const href = link.getAttribute("href");
      if (!href?.startsWith("#")) return;
      e.preventDefault();
      if (state.page !== "import") {
        showPage("import");
      }
      const target = document.getElementById(href.slice(1));
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        for (const other of document.querySelectorAll<HTMLAnchorElement>(".import-subnav-link")) {
          other.classList.toggle("active", other.getAttribute("href") === href);
        }
      }
    });
  }

  const importObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && state.page === "import") {
          const id = entry.target.id;
          for (const link of document.querySelectorAll<HTMLAnchorElement>(".import-subnav-link")) {
            link.classList.toggle("active", link.getAttribute("href") === `#${id}`);
          }
        }
      }
    },
    { rootMargin: "-10% 0px -70% 0px" },
  );
  for (const section of document.querySelectorAll(".import-subsection")) {
    importObserver.observe(section);
  }
  $<HTMLInputElement>("reconcile-search").addEventListener("input", (e) => {
    state.reconcileSearch = (e.target as HTMLInputElement).value;
    redraw("reconcile");
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
    redraw("reconcile");
  });
  $<HTMLInputElement>("rules-search").addEventListener("input", () => redraw("rules"));
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
  $<HTMLSelectElement>("history-kind").addEventListener("change", () => redraw("history"));
  $<HTMLSelectElement>("setup-source").addEventListener("change", () => redraw("setup"));
  $("balances-pick").addEventListener("click", () => $("balances-input").click());
  $<HTMLInputElement>("balances-input").addEventListener("change", (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) void checkBankBalances(file);
  });
  $("invoice-new").addEventListener("click", () => startNewInvoice());

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
  $<HTMLInputElement>("invoice-search").addEventListener("input", () => redraw("invoices"));

  $("report-basis").addEventListener("change", () => redraw("reports"));
  $("report-gst").addEventListener("change", () => redraw("reports"));
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

  $("report-kind").addEventListener("change", () => redraw("reports"));
  $("report-owner").addEventListener("change", () => redraw("reports"));
  $("report-year").addEventListener("change", () => redraw("reports"));
  $("report-download").addEventListener("click", () => downloadReport());

  $("opening-pick").addEventListener("click", () => $<HTMLInputElement>("opening-input").click());
  $<HTMLInputElement>("opening-input").addEventListener("change", (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) void loadOpeningBalances(file);
    (e.target as HTMLInputElement).value = "";
  });
  $("opening-year").addEventListener("change", (e) => {
    state.openingYear = (e.target as HTMLSelectElement).value;
    redraw("openingBalances");
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
    if (file.size > 50 * 1024 * 1024) {
      alert(`"${file.name}" is over 50MB. Bank export files are normally much smaller. Skipped to prevent memory exhaustion.`);
      continue;
    }
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
  redraw("variance");
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
    if (file.size > 50 * 1024 * 1024) {
      say(`Skipped "${file.name}": file is over 50MB.`);
      continue;
    }
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

/**
 * The asset register, on a page of its own.
 *
 * It used to be a button in the Reports header that appeared only when the
 * depreciation report was selected -- so the one input the accounts cannot be
 * produced without was reachable only by first choosing a report that needs
 * it. This is the input; depreciation is what comes out.
 */

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

  const heading = document.createElement("h4");
  heading.className = "feed-subheading";
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
 * Point the Import page at whatever is waiting to be decided.
 *
 * Everything on that page except the review queue is a record of what arrived.
 * The queue is the only part somebody has to act on, and it opened on "All" --
 * a list of five thousand rows with thirty-two that mattered somewhere in it.
 */
function showWhatNeedsDeciding(): void {
  state.filter = "review";
}

function clearCheck(): void {
  state.reference = [];
  state.checkProblems = [];
  state.ledger = { ...state.ledger, reference: [] };
  void savePart(state.ledger, "reference");
  redraw("check");
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
    redraw("rules");
    return;
  }
  if (!Array.isArray(incoming.rules)) {
    state.rulesMessage = `${file.name} has no rules array, so it is not a rule file.`;
    redraw("rules");
    return;
  }

  if (state.rules === undefined) {
    await useRules(incoming, file.name, "Loaded");
    return;
  }

  state.pendingRules = { rules: incoming, name: file.name };
  redraw("rules");
}

/** Hand a generated file to the browser to save. */

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

  // Capture all columns present in the file into byDate
  const byDate: Record<IsoDate, Record<string, Cents>> = {};
  for (const d of parsed.dates) {
    const builtForDate = openingBalancesFrom(parsed, d, {
      bankAccountFor: (name) => banks.get(name.trim().toLowerCase()),
    });
    if (Object.keys(builtForDate.balances.accounts).length > 0) {
      byDate[d] = builtForDate.balances.accounts;
    }
  }

  const before = state.ledger.openingBalances ?? null;
  const openingBalances: OpeningBalances = {
    accounts,
    asAt: dayAfter(chosen),
    source: `${file.name}, ${chosen} column`,
    byDate,
  };
  state.ledger = { ...state.ledger, openingBalances };
  state.openingYear = "all";
  state.persistent = await savePart(state.ledger);
  await record(
    "openingBalance",
    `Opening balances from ${file.name}: ${Object.keys(accounts).length} accounts as at ${chosen}`,
    before,
    openingBalances,
    "opening",
  );
  redraw("openingBalances");
  redraw("entities");
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
  const shape = raw as { treatment?: string; side?: string };
  if (shape.side === "imports") return "imports";
  return shape.treatment ?? "standard";
}

/**
 * Everything to go and fetch, said once and up front.
 *
 * It was said seven times instead, a line at a time on whichever step wanted
 * that file -- so setting up read as seven separate trips to the accounting


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

/**
 * The financial year a date falls in, labelled by the year it ends in.
 *
 * New Zealand's ends on 31 March, so April 2025 to March 2026 is FY2026.
 */
/** Which codes belong to the entity being reported on, and how each is treated. */

/**
 * Read a general ledger export and keep it with the ledger.
 *
 * The file is Windows-1252, like every other Xero export, so it is decoded the
 * same way the reference loader does rather than assumed to be UTF-8.
 */

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
  redraw("reports");
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
  redraw("reports");
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
  redraw("invoices");
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
  redraw("invoices");
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
    redraw("importRows");
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

/** A table cell of plain text. */

/** A right-aligned figure. */


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

function render(): void {
  renderStatus();
  renderReports();
  redraw("importRows");
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
  return accountsAtExportLimit(state.ledger.transactions);
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


void init();
