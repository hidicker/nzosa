import { registerPages, showPage } from "./app.js";
import {
  dismissLoading,
  wireChrome,
} from "./chrome.js";
import {
  wireFileIntake,
} from "./migrate/file-intake.js";
import {
  autoFetchFromFeed,
  render,
  renderFeed,
  renderFormats,
  renderTable,
  showWhatNeedsDeciding,
  wireBankImport,
} from "./daily/bank-import.js";
import {
  recomputeVariance,
  ensureDefaultEntity,
  reclassify,
  tidyChart,
} from "./books.js";
import {
  renderBooks,
  renderOpenBooks,
  wireBooksPage,
} from "./daily/books-page.js";
import {
  renderRules,
  wireRules,
} from "./daily/rules.js";
import {
  renderAssetsPage,
  wireAssets,
} from "./daily/assets.js";
import {
  renderHistory,
  wireHistory,
} from "./daily/history.js";
import {
  renderVariance,
  wireGstReconcile,
} from "./daily/gst-reconcile.js";
import {
  renderOpeningBalances,
  wireOpeningBalances,
} from "./daily/opening-balances.js";
import {
  renderReconcile,
  wireReconcile,
} from "./daily/reconcile-page.js";
import {
  renderReportsPage,
  wireReports,
} from "./daily/reports.js";
import {
  renderInvoiceEditor,
  renderInvoices,
  wireInvoices,
} from "./daily/invoices.js";
import {
  renderEntities,
} from "./daily/entities.js";
import {
  markSetupProgress,
  renderSetup,
  renderSetupBody,
  seedBrowser,
  seedStarterChart,
  wireSetup,
} from "./migrate/setup-wizard.js";
import { renderMigration, wireMigration } from "./migrate/migration-page.js";
import { renderAi } from "./daily/ai-page.js";
import { renderAiCheck } from "./daily/ai-check-page.js";
import {
  applyChartColumns,
  renderCheck,
  wireCodingReconciliation,
} from "./migrate/coding-reconciliation.js";
import { sessionFromUrl, signedIn } from "./cloud.js";
import { reportsFromMenu, wireMenu } from "./menu.js";
import { $, state } from "./state.js";
import {
  dedupeReference,
} from "@nzosa/core";
import {
  setLoadingStatus,
} from "./ui.js";
import {
  load,
  loadRules,
  loadRulesArchive,
  writesToFolder,
  loadEvents,
  loadUser,
  onSaveTrouble,
  requestPersistence,
  savePart,
  saveUser,
} from "./store.js";
import { renderEntityFilter } from "./widgets.js";

/**
 * The whole front end.
 *
 * Files are read with the FileReader API and parsed by @nzosa/core in
 * this tab. Nothing is uploaded: there is no fetch call in this application,
 * which is a property worth keeping as it grows.
 */




async function init(): Promise<void> {
  // A confirmation link comes back with the session in the address bar. Read it
  // before anything is loaded, or the books that open are this browser's own
  // copy and the person appears not to be signed in at all.
  sessionFromUrl();

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
    migration: renderMigration,
    ai: renderAi,
    aiCheck: renderAiCheck,
    openBooks: renderOpenBooks,
    openingBalances: renderOpeningBalances,
    reconcile: renderReconcile,
    reports: renderReportsPage,
    rules: renderRules,
    setup: renderSetup,
    setupBody: renderSetupBody,
    setupProgress: markSetupProgress,
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
    // Not for somebody signed in to books of their own: seeding would fill this
    // browser's copy with an invented company, and send half a dozen requests
    // after seed files a hosted copy does not have.
    if (!writesToFolder() && !signedIn()) await seedBrowser();

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
    // Reconcile page cannot say what to do about that. The guided start can: it
    // asks what it needs and hands over to Setup with the answers in. Once
    // there are transactions, Reconcile is the page you actually live on.
    if (state.ledger.transactions.length === 0) state.page = "migration";

    showPage(state.page);
  } finally {
    dismissLoading();
  }
}

function wireUp(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    ".sidebar-nav button[data-page], .sidebar-foot button[data-page]",
  )) {
    button.addEventListener("click", () => {
      if (button.dataset["page"] === "reports") reportsFromMenu();
      showPage(button.dataset["page"] ?? "reconcile");
    });
  }

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

  // Each page wires its own controls. main.ts knows their names and
  // nothing else about them -- not which elements they touch, nor what
  // those do.
  wireChrome();
  wireMenu();

  // A save that did not happen, said across the top of the app rather than on
  // whichever page happened to be open when it failed.
  onSaveTrouble((trouble) => {
    const banner = document.getElementById("save-banner");
    const said = document.getElementById("save-banner-text");
    if (banner === null || said === null) return;
    said.textContent = trouble.why;
    banner.hidden = false;
  });
  document.getElementById("save-banner-reload")?.addEventListener("click", () => {
    location.reload();
  });
  document.getElementById("save-banner-close")?.addEventListener("click", () => {
    const banner = document.getElementById("save-banner");
    if (banner !== null) banner.hidden = true;
  });
  wireBankImport();
  wireFileIntake();
  wireReconcile();
  wireCodingReconciliation();
  wireRules();
  wireGstReconcile();
  wireHistory();
  wireSetup();
  wireMigration();
  wireInvoices();
  wireReports();
  wireAssets();
  wireOpeningBalances();
  wireBooksPage();
}

/** Fill the header selector from the entities that exist. */

/**
 * The asset register, on a page of its own.
 *
 * It used to be a button in the Reports header that appeared only when the
 * depreciation report was selected -- so the one input the accounts cannot be
 * produced without was reachable only by first choosing a report that needs
 * it. This is the input; depreciation is what comes out.
 */

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

/** A table cell of plain text. */

/** A right-aligned figure. */


void init();
