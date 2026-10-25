import { applyNewBooksCountry } from "./new-books-country.js";
import { wirePresentation } from "./presentation.js";
import { afterPress, watchBusyButtons } from "./busy.js";
import { INBOX_FRESH_HOURS, readMorning, restoreMorning } from "./nightly.js";
import { redraw, registerPages, showPage } from "./app.js";
import type { PageName } from "./app.js";
import { applyModules } from "./modules.js";
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
  ensureBetweenAccounts,
  storeBetweenChoices,
  keepConfirmedGst,
  storeConfirmedGst,
  record,
  tidyStaleTreatments,
  persistRules,
  syncExpenseClaims,
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
  startNewJournal,
  wireReports,
} from "./daily/reports.js";
import {
  renderInvoiceEditor,
  renderInvoices,
  startNewBill,
  startNewInvoice,
  wireInvoices,
} from "./daily/invoices.js";
import { renderBills, wireBills } from "./daily/bills.js";
import { wireShortcuts } from "./shortcuts.js";
import { markActions, renderActions } from "./daily/actions.js";
import { renderIrdRecords, wireIrdRecords } from "./daily/ird-records.js";
import { renderRentalsPage } from "./daily/rentals-page.js";
import { renderGrantsPage } from "./daily/grants-page.js";
import { renderContacts } from "./daily/contacts-page.js";
import { renderStatements } from "./daily/statements-page.js";
import { renderBudgets } from "./daily/budgets-page.js";
import { renderItems } from "./daily/items-page.js";
import { renderClasses } from "./daily/classes-page.js";
import { renderApps } from "./daily/apps-page.js";
import { renderTime } from "./daily/time-page.js";
import { renderAuPayroll } from "./daily/au-payroll-page.js";
import { renderIr9Page } from "./daily/ir9-page.js";
import { renderTrustPeoplePage } from "./daily/trust-people-page.js";
import { renderIr6Page } from "./daily/ir6-page.js";
import { renderIr7Page } from "./daily/ir7-page.js";
import { renderIr4Page } from "./daily/ir4-page.js";
import { renderSocietyPage } from "./daily/society-report-page.js";
import { renderDonationsPage } from "./daily/donations-page.js";
import { renderPerformancePage } from "./daily/performance-report-page.js";
import { renderPersonalYearEnd } from "./daily/personal-year-end.js";
import { renderRentalYearEnd } from "./daily/rental-year-end.js";
import {
  renderPayrollPage,
  wirePayroll,
} from "./daily/payroll.js";
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
import { autoSuggestOnOpen, renderAi } from "./daily/ai-page.js";
import { installLockGuard, resetLockBaseline } from "./lock.js";
import { showOtherTabs, watchOtherTabs } from "./other-tabs.js";
import { renderAiCheck } from "./daily/ai-check-page.js";
import {
  applyChartColumns,
  repairImportedChart,
  renderCheck,
  settleInvoicesFromXero,
  wireCodingReconciliation,
} from "./migrate/coding-reconciliation.js";
import { sessionFromUrl, signedIn } from "./cloud.js";
import { applyCountry, booksCountry } from "./country.js";
import { openReport, reportsFromMenu, wireMenu } from "./menu.js";
import { wireRecordSearch } from "./search-wiring.js";
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
  booksReadOnly,
  onSaveTrouble,
  onSavedAgain,
  hasUnsavedChanges,
  requestPersistence,
  savePart,
  saveUser,
  setBeforeSave,
  keepBooksInMemory,
  backendKind,
  openCloudBookId,
  ledgerId,
  savesPending,
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
  await sessionFromUrl();

  // Before the first load, because loading changes the state and the state is
  // what a page is drawn from. Every page at once: leaving one out does not
  // compile, which is the point of taking the whole set.
  registerPages({
    actions: renderActions,
    actionsBadge: () => markActions(),
    assets: renderAssetsPage,
    bills: renderBills,
    books: renderBooks,
    check: renderCheck,
    contacts: renderContacts,
    statements: renderStatements,
    budgets: renderBudgets,
    items: renderItems,
    classes: renderClasses,
    apps: renderApps,
    time: renderTime,
    aupayroll: renderAuPayroll,
    entities: renderEntities,
    entityFilter: renderEntityFilter,
    feed: renderFeed,
    history: renderHistory,
    importRows: renderTable,
    invoiceEditor: renderInvoiceEditor,
    invoices: renderInvoices,
    ird: renderIrdRecords,
    migration: renderMigration,
    ai: renderAi,
    aiCheck: renderAiCheck,
    openBooks: renderOpenBooks,
    openingBalances: renderOpeningBalances,
    payroll: renderPayrollPage,
    tenancies: renderRentalsPage,
    grants: renderGrantsPage,
    ir9: renderIr9Page,
    trustPeople: renderTrustPeoplePage,
    ir6: renderIr6Page,
    ir7: renderIr7Page,
    ir4: renderIr4Page,
    society: renderSocietyPage,
    donations: renderDonationsPage,
    performance: renderPerformancePage,
    personalYear: renderPersonalYearEnd,
    rentalYear: renderRentalYearEnd,
    reconcile: renderReconcile,
    reports: renderReportsPage,
    rules: renderRules,
    setup: renderSetup,
    setupBody: renderSetupBody,
    setupProgress: markSetupProgress,
    variance: renderVariance,
  });
  setLoadingStatus("Opening books…");
  // Before anything can be saved: locked periods stay as they were locked.
  installLockGuard(() => showPage(state.page));
  // The choice for money between entities is stored with each line as it is confirmed.
  // Every confirmed line keeps its own GST, and its choice for money between
  // entities, stored by the save that confirmed it.
  setBeforeSave((ledger) => storeBetweenChoices(storeConfirmedGst(ledger)));
  // A save refused because somebody else saved these books first takes in
  // what they changed, here, and tries again with this change on top.
  keepBooksInMemory({
    ledger: () => state.ledger,
    setLedger: (ledger) => {
      state.ledger = ledger;
      state.chart = ledger.chart ?? [];
    },
    events: () => state.events,
    setEvents: (events) => {
      state.events = events;
    },
    rules: () =>
      state.rules === undefined
        ? undefined
        : { version: 1, name: state.rulesName, loadedAt: state.rulesLoadedAt, rules: state.rules },
    setRules: (stored) => {
      const held = stored as { name?: string; loadedAt?: string; rules?: typeof state.rules } | null;
      if (!held?.rules) return;
      state.rules = held.rules;
      state.rulesName = held.name ?? state.rulesName;
      state.rulesLoadedAt = held.loadedAt ?? state.rulesLoadedAt;
    },
    shown: () => {
      reclassify();
      applyModules();
      redraw(state.page as PageName);
    },
  });
  for (const link of document.querySelectorAll<HTMLAnchorElement>("#sidebar-rules-sublinks a")) {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      if (state.page !== "rules") showPage("rules");
      document.getElementById((link.getAttribute("href") ?? "").slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
  try {
    const loaded = await load();
    state.ledger = loaded.ledger;
    applyCountry();
    state.persistent = loaded.persistent;
    // Before anything below can record what it did. `record` appends to
    // `state.events` and writes the lot back, so anything recording before the
    // log is read would save a log of one and lose what was there. The step
    // below that stores each confirmed line's GST did exactly that: opened
    // once, older books kept one event of their history.
    state.events = await loadEvents();
    state.who = await loadUser();

    // Classify what is already stored, so the review queue survives a reload.
    reclassify();
    // The books as opened are what the locks are measured against.
    state.chart = state.ledger.chart ?? [];
    // Once: confirmed lines keep their own GST from now on, so those showing
    // none only because their entity is unregistered have that stored first.
    // Before the lock baseline, so the locks measure the books as they stand.
    const kept = keepConfirmedGst();
    resetLockBaseline();
    if (kept !== null) {
      await savePart(state.ledger);
      if (kept.batch.length > 0 || kept.splitIds.length > 0) {
        const lines = kept.batch.length + kept.splitIds.length;
        await record(
          "codingBatch",
          `GST stored with ${lines} confirmed line${lines === 1 ? "" : "s"}, as each was shown`,
          kept.batch,
          null,
        );
      }
    }
    // Accounts for money between entities, where the books lack any.
    void ensureBetweenAccounts().then(async (added) => {
      // Lines confirmed before choices were kept with them get theirs now,
      // so none is left following whatever the settings say later.
      const before = state.ledger;
      if (storeBetweenChoices(before) !== before) await savePart(state.ledger);
      if (added > 0) resetLockBaseline();
    });
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
    if (!writesToFolder() && !signedIn()) {
      // Demo books of another country -- the US set, for a first visit from
      // there -- bring its tax, reports and date order, set again once they
      // are in: they opened with New Zealand's GST at 15%.
      const before = booksCountry().id;
      await seedBrowser();
      if (booksCountry().id !== before) applyCountry();
    }

    setLoadingStatus("Preparing workspace…");
    renderFormats();
    wireUp();
    render();
    const storedRules = await loadRules();
    if (storedRules) {
      state.rules = storedRules.rules;
      state.rulesName = storedRules.name;
      state.rulesLoadedAt = storedRules.loadedAt;
      // Books whose chart replaced the standard one before this was tidied
      // at the time still carry the standard chart's names for its numbers.
      if (tidyStaleTreatments()) void persistRules();
    }
    // Books made a moment ago take the country chosen as they were made,
    // before their starter chart goes in, so it is that country's chart.
    if (await applyNewBooksCountry()) applyCountry();
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
    // Books brought from QuickBooks or SlowBooks before their chart was tidied
    // as it arrived: their accounts given to their entity, the starter
    // chart's names on their numbers dropped.
    await repairImportedChart();

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
    // Claims from the journal report, kept in step with it, and their
    // repayments settled where Xero recorded them.
    if (await syncExpenseClaims()) await settleInvoicesFromXero();

    // Last, and not waited for. A feed that is slow, or a bank that is down,
    // must not hold up an app whose books are already on the screen.
    // Then the AI, once the feed has brought in whatever it brings.
    // What the morning run left: suggestions onto their lines, and the bank's
    // new lines into the books through the feed's own import, below.
    const morning = await readMorning();
    await restoreMorning(morning);
    const ranToday =
      morning.ran !== undefined && Date.now() - Date.parse(morning.ran.at) < INBOX_FRESH_HOURS * 3600 * 1000;
    if (ranToday && morning.ran !== undefined) {
      state.startupMessage =
        `Got ready this morning: ${morning.ran.added} new line${morning.ran.added === 1 ? "" : "s"} from the bank, ` +
        `${morning.ran.suggested} suggestion${morning.ran.suggested === 1 ? "" : "s"} waiting on Reconcile.`;
    }
    // Not asked again on opening what the morning already asked.
    void autoFetchFromFeed(morning).then(() => (ranToday ? undefined : autoSuggestOnOpen()));

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
  // Each menu item named for a screen reader, and for a tip on hover, by its
  // own label: narrowed to icons, the label is hidden, and a hidden label
  // names nothing -- a row of buttons a screen reader could only call "button".
  for (const button of document.querySelectorAll<HTMLButtonElement>(".sidebar-nav button")) {
    const label = button.querySelector("span")?.textContent?.replace(/\s+/g, " ").trim() ?? "";
    if (label === "" || button.hasAttribute("aria-label")) continue;
    button.setAttribute("aria-label", label);
    if (button.title === "") button.title = label;
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    ".sidebar-nav button[data-page], .sidebar-foot button[data-page]",
  )) {
    button.addEventListener("click", () =>
      afterPress(button, () => {
        if (button.dataset["page"] === "reports") reportsFromMenu();
        showPage(button.dataset["page"] ?? "reconcile");
      }),
    );
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
  wireRecordSearch();

  // Leaving while a save is still on its way: a tick on Reconcile moves on
  // before the server has answered, so closing or reloading straight after
  // could lose it. Or after one failed and has not been made good since:
  // nothing is pending then, but the change is held only on this page. The
  // browser asks first, in its own words.
  window.addEventListener("beforeunload", (event) => {
    if (savesPending() === 0 && !hasUnsavedChanges()) return;
    event.preventDefault();
    event.returnValue = "";
  });

  // A save that did not happen, said across the top of the app rather than on
  // whichever page happened to be open when it failed.
  // "offline" is tried again on its own, so it offers no Reload: reloading
  // then would throw away the very change waiting to be saved.
  let shownTrouble: string | null = null;
  onSaveTrouble((trouble) => {
    const banner = document.getElementById("save-banner");
    const said = document.getElementById("save-banner-text");
    if (banner === null || said === null) return;
    // A conflict says more than "not answering", so it is not replaced by one.
    if (trouble.kind === "offline" && shownTrouble !== null && shownTrouble !== "offline" && !banner.hidden) return;
    shownTrouble = trouble.kind;
    said.textContent = trouble.why;
    const reload = document.getElementById("save-banner-reload");
    if (reload !== null) reload.hidden = trouble.kind === "offline";
    banner.hidden = false;
  });
  onSavedAgain(() => {
    const banner = document.getElementById("save-banner");
    if (banner === null || shownTrouble !== "offline") return;
    banner.hidden = true;
    shownTrouble = null;
  });
  document.getElementById("save-banner-reload")?.addEventListener("click", () => {
    location.reload();
  });
  document.getElementById("save-banner-close")?.addEventListener("click", () => {
    const banner = document.getElementById("save-banner");
    if (banner !== null) banner.hidden = true;
  });
  // The same books open in another tab of this browser, said at once rather
  // than when a save is refused.
  const where = backendKind();
  watchOtherTabs(
    where === "cloud" ? (openCloudBookId() === "" ? "" : `cloud:${openCloudBookId()}`) : where === "folder" ? `folder:${ledgerId()}` : "browser",
    showOtherTabs,
  );
  // Said once on opening, rather than discovered on the first change refused.
  if (booksReadOnly()) {
    document.body.classList.add("read-only");
    const banner = document.getElementById("save-banner");
    const said = document.getElementById("save-banner-text");
    const reload = document.getElementById("save-banner-reload");
    if (banner !== null && said !== null) {
      said.textContent = "Read only: you can look through these books but not change them.";
      if (reload !== null) reload.hidden = true;
      banner.hidden = false;
    }
  }
  // Before anything can be pressed: a button left waiting says so.
  watchBusyButtons();
  wireBankImport();
  wireFileIntake();
  wireReconcile();
  wireCodingReconciliation();
  wireRules();
  wireGstReconcile();
  wireHistory();
  wireSetup();
  wireMigration();
  wirePresentation();
  wireInvoices();
  wireBills();
  wireIrdRecords();
  wireReports();
  wireAssets();
  wirePayroll();
  wireOpeningBalances();
  wireBooksPage();
  wireShortcuts({
    invoice: () => {
      showPage("invoices", "top");
      startNewInvoice();
    },
    bill: () => {
      showPage("bills", "top");
      startNewBill();
    },
    journal: () => {
      startNewJournal();
      openReport("manual");
    },
  });
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
