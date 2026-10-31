import { looksLikeBankFile } from "../daily/bank-columns.js";
import { chosenStartDate } from "./onboarding-state.js";
import { filedKey, isCreditNote, xeroNumberOf } from "@nzosa/core";
import { redraw, showPage } from "../app.js";
import { asCsvText, invoiceBalanceMap, recomputeVariance, saveManualJournals, record, syncExpenseClaims } from "../books.js";
import { checkBankBalances, handleFiles } from "../daily/bank-import.js";
import { loadOpeningBalances } from "../daily/opening-balances.js";
import { loadXeroBankAccounts } from "../daily/entities.js";
import { checkAgainstTrialBalance, loadContactList, loadDueDates, loadProductList, loadQuickBooksBankLines } from "./quickbooks.js";
import { loadOpeningDocuments } from "../daily/aged-report.js";
import { setQuickBooksExportCompanions } from "./qbo-export-set.js";
import { loadCheckFiles, settleInvoicesFromXero } from "../migrate/coding-reconciliation.js";
import { $, state } from "../state.js";
import { ledgerName, save, savePart, saveTogether, savesPending } from "../store.js";
import { askOnPage, tellOnPage } from "../ui.js";
import { downloadBackupNow, restoreWithConfirm } from "../backup.js";
import { readFiledReturns } from "../variance.js";
import { readIrdFiles } from "../daily/ird-records.js";
import {
  identifyExport,
  isQuickBooksExportStatement,
  isZip,
  manualJournalsIn,
  readZipFiles,
  mergeJournalNarrations,
  narratedJournalsLost,
  parseFixedAssets,
  parseXeroAllocations,
  parseXeroInvoices,
  parseXeroJournalReport,
  contactsFromDocuments,
  mergeContacts,
  validateInvoices,
} from "@nzosa/core";
import type { Identified, Journal } from "@nzosa/core";

/**
 * Taking whatever the old system produced, in one go.
 *
 * Setting a set of books up used to be seven errands: each report fetched on
 * the same visit to the same system, then loaded here on a different page,
 * through a different button, in an order nobody was told. Most of that is
 * navigation rather than work, and none of it is necessary -- every one of
 * these reports announces itself in its own heading row, and the parsers
 * already knew those headings because each checks for its own before reading
 * a line.
 *
 * So: hand over the lot. Each file is identified, sent where it belongs, and
 * named in the list underneath, with anything unrecognised said plainly rather
 * than pushed through the nearest parser -- which is the failure worth
 * avoiding, because a chart of accounts read as a bank statement does not
 * announce itself either.
 */

export function exportLedger(): void {
  // The same file the Books page makes: everything, rules and history included.
  // This button used to write the ledger alone, which was not a backup.
  void downloadBackupNow(ledgerName());
}

export async function importLedger(file: File): Promise<void> {
  // A backup, or a ledger file from before backups existed; either way every
  // field comes back. This used to read back only part of what "Export ledger"
  // wrote, so a round trip into new books quietly lost opening balances, manual
  // journals, invoice matches, transfers and filed returns.
  await restoreWithConfirm(file, ledgerName());
}

export async function loadFiledReturns(files: File[]): Promise<void> {
  const { returns, problems } = await readFiledReturns(files);
  // Re-importing a period replaces it rather than adding a second copy.
  // Keyed by period and registration: co-owners file a return each.
  const byPeriod = new Map(state.filed.map((one) => [filedKey(one), one]));
  for (const one of returns) byPeriod.set(filedKey(one), one);
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
export async function loadWhatever(files: File[]): Promise<void> {
  const told = $("setup-loaded");
  told.textContent = "";
  const said: string[] = [];
  const show = (): void => {
    told.textContent = "";
    for (const one of said) {
      const row = document.createElement("div");
      row.textContent = one;
      told.append(row);
    }
    const now = loadingFiles();
    if (now !== null) told.append(loadingLine(now));
  };
  const say = (line: string): void => {
    said.push(line);
    show();
  };
  const loading = (done: number, name: string): void => {
    setLoading({ done, total: files.length, name });
    show();
  };
  try {
    await saveTogether(async () => {
      files = await unzipped(files, say);
      await loadEach(files, say, loading);
      // What loading saved goes to the books now, all at once.
      if (savesPending() > 0) {
        setLoading({ done: files.length, total: files.length, name: "", saving: true });
        show();
      }
    });
  } finally {
    setLoading(null);
    show();
  }
}

/**
 * A zip of exports opened into the files inside it, as if each had been
 * dropped: QuickBooks Online's Export data comes as one. A workbook is a zip
 * too, and is left as it is.
 */
async function unzipped(files: File[], say: (line: string) => void): Promise<File[]> {
  const out: File[] = [];
  for (const file of files) {
    if (!/\.zip$/i.test(file.name)) {
      out.push(file);
      continue;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!isZip(bytes)) {
      say(`${file.name} — not a zip file that can be opened, so nothing was done with it.`);
      continue;
    }
    try {
      const inside = (await readZipFiles(bytes)).filter((f) => !/(^|\/)(__MACOSX\/|\.)/.test(f.name));
      for (const one of inside) out.push(new File([new Uint8Array(one.bytes)], one.name.split("/").pop() ?? one.name));
      if (inside.length === 0) say(`${file.name} — an empty zip file.`);
    } catch (error) {
      say(`${file.name} — the zip could not be opened: ${(error as Error).message}`);
    }
  }
  return out;
}

/** Where loading dropped files is up to: how many are in, of how many, and which now. */
/**
 * Let the page draw and answer what is waiting, then carry on. Not a timer:
 * a tab in the background runs its timers once a minute at worst, which
 * would hold a load there for as long.
 */
function giveThePageATurn(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

export interface LoadingFiles {
  done: number;
  total: number;
  name: string;
  /** Read, and being saved. */
  saving?: boolean;
}

let loadingNow: LoadingFiles | null = null;
const loadingWatchers = new Set<() => void>();

/**
 * The files being loaded, or null when none are. Loading a set of Xero files
 * takes a while, and each one redraws the page, so a "Reading…" put up when
 * they were dropped was gone at the first redraw and nothing said they were
 * still going in. Whatever drop zone is on screen asks here instead.
 */
export function loadingFiles(): LoadingFiles | null {
  return loadingNow;
}

/** Be told whenever that changes. Returns how to stop being told. */
export function watchLoadingFiles(watcher: () => void): () => void {
  loadingWatchers.add(watcher);
  return () => loadingWatchers.delete(watcher);
}

function setLoading(next: LoadingFiles | null): void {
  loadingNow = next;
  for (const watcher of [...loadingWatchers]) watcher();
}

/** "Loading 3 of 10: the file's name…", with a spinner. */
export function loadingLine(now: LoadingFiles): HTMLElement {
  const line = document.createElement("div");
  line.className = "files-loading";
  line.setAttribute("role", "status");
  line.textContent =
    now.saving === true
      ? "Saving the books…"
      : now.total === 1
      ? `Loading ${now.name}…`
      : `Loading ${Math.min(now.done + 1, now.total)} of ${now.total}${now.name !== "" ? `: ${now.name}` : ""}…`;
  return line;
}

async function loadEach(
  files: File[],
  sayOut: (line: string) => void,
  loading: (done: number, name: string) => void,
): Promise<void> {
  let spoken = 0;
  const say = (line: string): void => {
    spoken += 1;
    sayOut(line);
  };
  loading(0, "");

  // Bank statements go through the importer together: it dedupes across the
  // files it is given, and feeding them one at a time would ask about the same
  // overlap once per file.
  const banks: File[] = [];
  const rest: { file: File; identified: Identified }[] = [];

  const read: { file: File; text: string; identified: Identified }[] = [];
  for (const file of files) {
    loading(0, file.name);
    if (file.size > 50 * 1024 * 1024) {
      say(`Skipped "${file.name}": file is over 50MB.`);
      continue;
    }
    const text = await asCsvText(file.name, new Uint8Array(await file.arrayBuffer()));
    read.push({ file, text, identified: identifyExport(text) });
  }

  // QuickBooks Online's Export data: the Journal is read with the statements
  // and the trial balance that came with it, which say what each account is
  // and what the whole must come to. Each goes as text, as the workbooks it
  // came in are read as nothing else here.
  const exportJournal = read.some((r) => r.identified.kind === "quickbooks-export");
  const companions = exportJournal ? read.filter((r) => isQuickBooksExportStatement(r.text) !== null) : [];
  setQuickBooksExportCompanions(companions.map((r) => ({ name: r.file.name, text: r.text })));
  for (const one of companions) {
    const kind = isQuickBooksExportStatement(one.text);
    say(
      `${one.file.name} — QuickBooks Online ` +
        (kind === "trial-balance"
          ? "trial balance, read with the journal to check it."
          : `${kind === "balance-sheet" ? "balance sheet" : "profit and loss"}, read with the journal for what type each account is.`),
    );
  }
  for (const one of read) {
    if (companions.includes(one)) continue;
    const file =
      one.identified.kind === "quickbooks-export" && !/\.csv$/i.test(one.file.name)
        ? new File([one.text], `${one.file.name.replace(/\.[^.]*$/, "")}.csv`, { type: "text/csv" })
        : one.file;
    if (one.identified.kind === "bank") banks.push(file);
    else rest.push({ file, identified: one.identified });
  }

  let done = 0;
  if (banks.length > 0) {
    loading(done, `${banks.length} bank statement${banks.length === 1 ? "" : "s"}`);
    await handleFiles(banks);
    done += banks.length;

    say(`${banks.length} bank statement${banks.length === 1 ? "" : "s"} imported.`);
  }

  // Order matters, and a file picker hands them over in whatever order it
  // likes. A trial balance read before the chart of accounts recognises none
  // of its codes -- every account is reported as unknown and the opening
  // balances land under names nothing else uses -- and it reads the bank rows
  // through the chart's links, so the chart has to be in first. The same is
  // true in smaller ways of the rest: they all resolve account names.
  const ORDER: Record<string, number> = {
    // The chart before the coding history: rules are made from the history as
    // it loads, and its account names only mean something once the chart does.
    chart: -1,
    "quickbooks-chart": -1,
    "quickbooks-ledger": 0,
    "quickbooks-iif": -1,
    "slowbooks-ledger": -1,
    // MYOB's accounts first, so the journal's account numbers have names and types.
    "myob-accounts": -1,
    "myob-journal": 0,
    // GnuCash's account tree first, for the same reason.
    "gnucash-accounts": -1,
    "gnucash-transactions": 0,
    // After the IIF file, whose chart gives its accounts their types.
    "quickbooks-desktop-detail": 0,
    // Its own chart, made from the statements dropped with it.
    "quickbooks-export": -1,
    // After the ledger: the due dates go on the documents it brought in, and
    // a product's account is found in the chart it brought.
    "product-list": 1,
    "due-dates": 3,
    // Which bank account each of the chart's bank rows is, before anything
    // reads a balance or a line through those rows.
    "bank-accounts": -0.5,
    "account-transactions": 0,
    "coding-sheet": 0,
    // The opening balances before the open invoices and bills, which are
    // checked against the receivables and payables balances in them: read the
    // other way round, every set said there was nothing to check against yet.
    "trial-balance": 0.5,
    "journal-report": 1,
    "general-ledger-detail": 1,
    invoices: 2,
    allocations: 2,
    "fixed-assets": 2,
    "aged-detail": 2,
  };
  rest.sort((a, b) => (ORDER[a.identified.kind] ?? 2) - (ORDER[b.identified.kind] ?? 2));

  for (const { file, identified } of rest) {
    loading(done, file.name);
    done += 1;
    // The page gets a turn between files: the line above shows, and a click
    // or a scroll is answered rather than waiting for the whole set.
    await giveThePageATurn();
    try {
      switch (identified.kind) {
        case "quickbooks-chart":
          await loadCheckFiles([file]);
          break;
        case "quickbooks-ledger": {
          // The coding it holds is checked like any imported coding, and its bank and card
          // postings come in as bank lines: with no bank feed they are all
          // there is, and with one the duplicates are found as usual.
          await loadCheckFiles([file]);
          const lines = await loadQuickBooksBankLines(file);
          say(`${file.name} — ${identified.what}: ${lines}`);
          continue;
        }
        case "myob-accounts":
        case "gnucash-accounts":
          await loadCheckFiles([file]);
          say(`${file.name} — ${identified.what}: the accounts are in the chart.`);
          continue;
        case "myob-journal":
        case "gnucash-transactions":
        case "slowbooks-ledger":
        case "quickbooks-desktop-detail":
        case "quickbooks-export":
        case "quickbooks-iif": {
          // The chart and the coding first, the way a chart and a ledger go;
          // then the bank lines, documents and journals.
          await loadCheckFiles([file]);
          say(`${file.name} — ${identified.what}: ${await loadQuickBooksBankLines(file)}`);
          continue;
        }
        case "product-list": {
          say(`${file.name} — ${identified.what}: ${await loadProductList(file)}`);
          continue;
        }
        case "due-dates": {
          say(`${file.name} — ${await loadDueDates(file)}`);
          continue;
        }
        case "contact-list": {
          say(`${file.name} — ${await loadContactList(file)}`);
          continue;
        }
        case "chart":
        case "account-transactions":
        case "coding-sheet":
          // The same reader takes both: it lifts the chart out of a chart
          // export, and the coding and the invoice payments out of an account
          // transactions one.
          await loadCheckFiles([file]);
          break;
        case "journal-report":
        case "general-ledger-detail":
          await loadJournals(file);
          break;
        case "not-needed":
          say(`${file.name} — ${identified.what}.`);
          continue;
        case "trial-balance": {
          // With a general ledger from the start, QuickBooks' trial balance
          // checks the books rather than starting them.
          const checked = await checkAgainstTrialBalance(file);
          if (checked !== null) {
            say(`${file.name} — ${checked}`);
            continue;
          }
          // Read is not applied. It was listed as loaded whenever it had been
          // recognised -- a column not chosen or a confirmation declined
          // included -- and the books went on with no opening balances.
          if (!(await loadOpeningBalances(file))) {
            say(
              `${file.name} \u2014 a trial balance, not applied. Import it on the Opening ` +
                "balances page to choose its column and see the figures first.",
            );
            continue;
          }
          break;
        }
        case "fixed-assets":
          await loadAssets(file);
          break;
        case "invoices":
          say(`${file.name} — ${await loadInvoices(file)}`);
          continue;
        case "daily-balances":
          await checkBankBalances(file);
          break;
        case "gst-return":
        case "gst-summary":
          await loadFiledReturns([file]);
          break;
        case "ird-export":
          // Whose it is is asked before it is kept, so it is read there.
          await readIrdFiles([file]);
          say(`${file.name} — ${identified.what}: confirm whose it is on Inland Revenue records.`);
          showPage("ird");
          continue;
        case "bank-accounts":
          say(`${file.name} \u2014 ${await loadXeroBankAccounts(file)}`);
          continue;
        case "aged-detail":
          say(`${file.name} \u2014 ${await loadOpeningDocuments(file)}`);
          continue;
        default:
          // Dates and amounts, in a layout nothing knows: a bank's file, to
          // have its columns pointed out on Bank import.
          if (looksLikeBankFile(await asCsvText(file.name, new Uint8Array(await file.arrayBuffer())))) {
            await handleFiles([file]);
            say(`${file.name} — a bank file in a layout NZOSA doesn't know yet: point out its columns under Bank import.`);
            continue;
          }
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

  // Last, once the invoices and the coding are both in: deposits Xero says
  // paid several invoices, settling them, where nothing one-to-one did.
  const settled = await settleInvoicesFromXero();
  if (settled > 0) {
    say(
      `${settled} deposit${settled === 1 ? "" : "s"} holding several invoice payments ` +
        `settled as Xero recorded them.`,
    );
  }
  if (spoken === 0) say("Nothing was loaded.");
  // Only reachable from Setup today, but named by page rather than by hand for
  // the same reason as above: the next thing to call this may not be.
  showPage(state.page);
}

export function clearCheck(): void {
  state.reference = [];
  state.checkProblems = [];
  state.ledger = { ...state.ledger, reference: [] };
  void savePart(state.ledger, "reference");
  redraw("check");
}

export async function loadJournals(file: File): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const text = await asCsvText(file.name, bytes);

  const parsed = parseXeroJournalReport(text);
  if (parsed.journals.length === 0) {
    await tellOnPage(
      `${file.name} holds no journals. Export one from Xero as ` +
        "Accounting > Reports > Journal Report.",
    );
    return;
  }
  // Two exports of the same journals answer different questions: the Journal
  // Report carries the narration that tells a year-end adjustment from an
  // ordinary posting, and General Ledger Detail values every line -- gross,
  // tax and net -- which the Journal Report does not. So the values come from
  // whichever has just arrived and the narrations are carried across by
  // journal id, rather than one report being made to win.
  const held = state.ledger.journals ?? [];
  const merged = mergeJournalNarrations(parsed.journals, held);

  // Carrying a narration across cannot help a journal the incoming report does
  // not mention at all. An export of one year loaded over a file holding two
  // drops the other year, and a narrated journal is an entry a person wrote
  // that nothing can work out again -- so those are named and asked about.
  const lost = narratedJournalsLost(parsed.journals, held);
  if (lost.length > 0) {
    const listed = lost
      .slice(0, 8)
      .map((j) => `  ${j.date}  ${j.narration.slice(0, 58)}`)
      .join("\n");
    const more = lost.length > 8 ? `\n  and ${lost.length - 8} more` : "";
    const ok = await askOnPage(
      `${file.name} holds ${parsed.journals.length} journals, and does not include ` +
        `${lost.length} that carry a narration:\n\n${listed}${more}\n\n` +
        "These year-end entries cannot be recreated. Load this report anyway?",
    );
    if (!ok) return;
  }

  state.ledger = { ...state.ledger, journals: merged.journals };
  state.persistent = await savePart(state.ledger, "journals");
  // The expense claims in it, as documents owed to whoever claimed them.
  if (await syncExpenseClaims()) {
    const claims = (state.ledger.invoices ?? []).filter((i) => i.claim === true).length;
    const settled = await settleInvoicesFromXero();
    const said = document.createElement("div");
    said.textContent =
      `${claims} expense claim${claims === 1 ? "" : "s"} brought in from the journals, on Bills` +
      (settled > 0 ? `; ${settled} repayment${settled === 1 ? "" : "s"} matched as Xero recorded them.` : ".");
    $("setup-loaded").append(said);
  }
  redraw("reports");

  if (merged.carried > 0) {
    sayNarrationsKept(merged.carried);
  }
  await offerManualJournals(merged.journals);
}

/**
 * Say that the narrations survived.
 *
 * Silence here reads as having lost them, which is the thing this file load
 * was changed to stop doing.
 */
function sayNarrationsKept(n: number): void {
  const said = document.createElement("div");
  said.textContent =
    `Kept the narration on ${n} journal${n === 1 ? "" : "s"} from the report already loaded.`;
  $("setup-loaded").append(said);
}

/**
 * Take the year-end journals out of the report that just arrived.
 *
 * The journal report is the only place these exist. Loading it and stopping
 * there left them sitting in a file the books had already read: on one real
 * ledger three of them -- a 1,287.40 interest reversal, a 2,416.90 GST
 * correction and a rounding adjustment -- sat in the report for months and in
 * nobody's books, because taking them was a separate button on a page there
 * was no reason to open.
 *
 * Offered rather than done. A manual journal moves the profit and the balance
 * sheet, and a figure that changes because a file was dropped is the kind of
 * change nobody can explain later.
 *
 * What is on the list is decided by the other system's own markers: a manual
 * entry's narration ends "- Manual", and one that was later reversed is left
 * off -- otherwise the correction is applied twice and the reversal never.
 */
async function offerManualJournals(journals: readonly Journal[]): Promise<void> {
  const held = state.ledger.manualJournals ?? [];
  // Only from the day these books start. A journal from before it is already
  // inside the trial balance the books open from; offered with the rest, a
  // year's payroll journals from the previous system sat beside the year-end
  // adjustments as if both were missing.
  const start = state.ledger.openingBalances?.asAt ?? chosenStartDate() ?? "";
  const unheld = manualJournalsIn(journals).filter(
    (j) => !held.some((existing) => existing.id === j.id),
  );
  const found = unheld.filter((j) => start === "" || j.date >= start);
  const earlier = unheld.length - found.length;
  if (found.length === 0) return;

  const many = found.length !== 1;
  const listed = found
    .map((j) => `${j.date}  ${j.narration.length > 80 ? `${j.narration.slice(0, 80)}…` : j.narration}`)
    .join("\n");
  const ask =
    `${found.length} manual journal${many ? "s" : ""} in that report ${many ? "are" : "is"} ` +
    `not in your books:\n\n${listed}\n\n` +
    "These are year-end adjustments, and they change the profit and the " +
    "balance sheet. Take them?" +
    (earlier > 0
      ? `\n\n${earlier} more from before ${start} are left out: the opening balances ` +
        "already include them."
      : "");
  // Asked on the page, as the trial balance is: a browser that answers confirm()
  // by itself refused these without a word.
  if (!(await askOnPage(ask, many ? "Take them" : "Take it", "Not now"))) return;

  await saveManualJournals(
    [...held, ...found],
    `Read ${found.length} manual journal${many ? "s" : ""} from the report`,
  );
}

/** Read a fixed asset register and keep it with the ledger. */
export async function loadAssets(file: File): Promise<void> {
  const parsed = parseFixedAssets(await file.text());
  if (parsed.assets.length === 0) {
    await tellOnPage(
      `${file.name} holds no assets. Export one from Xero as Accounting > Fixed assets > Export.`,
    );
    return;
  }
  const before = state.ledger.assets ?? [];
  if (
    before.length > 0 &&
    !await askOnPage(
      `Replace the ${before.length} asset${before.length === 1 ? "" : "s"} held with the ` +
        `${parsed.assets.length} in ${file.name}? It can be undone from History.`,
    )
  ) {
    return;
  }
  state.ledger = { ...state.ledger, assets: parsed.assets };
  state.persistent = await savePart(state.ledger, "assets");
  await record("assets", `Fixed asset register loaded from ${file.name}`, before, parsed.assets);
  if (parsed.problems.length > 0) {
    await tellOnPage(
      `${parsed.assets.length} assets loaded. ${parsed.problems.length} could not be read:\n` +
        parsed.problems.slice(0, 5).map((p) => p.message).join("\n"),
    );
  }
  redraw("assets");
  redraw("reports");
}

export async function loadInvoices(file: File): Promise<string> {
  const parsed = parseXeroInvoices(await readXeroText(file));
  if (parsed.invoices.length === 0) {
    const none =
      `${file.name} holds no invoices or bills. Export them from Xero as Business > Invoices > Export, ` +
      "or Business > Bills to pay > Export.";
    await tellOnPage(none);
    return none;
  }
  // Sales invoices and bills come in separate files. Loading one replaces
  // what was held of its own kind only: the bills file used to replace the
  // sales invoices already loaded, and the other way round.
  const kinds = new Set(parsed.invoices.map((i) => i.kind));
  const kept = (state.ledger.invoices ?? []).filter((i) => !kinds.has(i.kind));
  // The customers and vendors they name, as records with the email Xero
  // gave: nothing else brings them across from Xero.
  const contactsBefore = (state.ledger.contacts ?? []).length;
  const contacts = mergeContacts(state.ledger.contacts ?? [], contactsFromDocuments(parsed.invoices, "Xero"));
  const newContacts = contacts.length - contactsBefore;
  state.ledger = { ...state.ledger, invoices: [...kept, ...parsed.invoices], contacts };
  state.persistent = await savePart(state.ledger, "invoices");
  redraw("contacts");
  const bills = parsed.invoices.filter((i) => i.kind === "purchase").length;
  const sales = parsed.invoices.length - bills;
  const what = [
    sales > 0 ? `${sales} invoice${sales === 1 ? "" : "s"}` : "",
    bills > 0 ? `${bills} bill${bills === 1 ? "" : "s"}` : "",
  ]
    .filter((x) => x !== "")
    .join(" and ");
  const issues = validateInvoices(parsed.invoices);
  state.invoiceMessage =
    issues.length > 0
      ? `${what} loaded. ${issues.length} look wrong: ` + issues.slice(0, 3).map((i) => i.message).join("; ")
      : `${what} loaded from ${file.name}.`;
  // The payments Xero says paid each one, settled now rather than left to be
  // found by hand -- from the Invoices page as well as from Start here.
  const settled = await settleInvoicesFromXero();
  const credited = await creditNotesByNumber();
  redraw("invoices");
  const paid =
    (settled > 0 ? ` ${settled} payment${settled === 1 ? "" : "s"} matched as Xero recorded them.` : "") +
    (credited > 0 ? ` ${credited} credit note${credited === 1 ? "" : "s"} put against the document ${credited === 1 ? "it credits" : "they credit"}.` : "") +
    (newContacts > 0 ? ` ${newContacts} ${bills > 0 && sales === 0 ? "vendor" : bills === 0 ? "customer" : "customer and vendor"} record${newContacts === 1 ? "" : "s"} added.` : "");
  return (issues.length > 0 ? `${what}; ${issues.length} look wrong, see Invoices.` : `${what}.`) + paid;
}

/**
 * Each credit note against the document it credits, where Xero's numbering
 * says so beyond doubt.
 *
 * A supplier's credit carries the number of the bill it reduces: PC Complete's
 * credit of 270.36 is "720-2", like the bill for the laptop it could not
 * supply. A customer's has its own number, and is found by the reference it
 * shares with the invoice and the credit being exactly what that invoice
 * still owes. Same kind and contact, dated no later, and only where exactly
 * one fits. Anything else waits for a person on Invoices or Bills.
 */
async function creditNotesByNumber(): Promise<number> {
  const links = { ...(state.ledger.creditNotes ?? {}) };
  const balances = invoiceBalanceMap();
  const documents = state.ledger.invoices ?? [];
  let made = 0;
  const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();
  for (const note of documents) {
    if (!isCreditNote(note) || links[note.number] !== undefined) continue;
    const credit = Math.abs(note.total);
    const candidates = documents.filter(
      (d) =>
        !isCreditNote(d) &&
        d.kind === note.kind &&
        same(d.contact, note.contact) &&
        d.issued <= note.issued &&
        (balances.get(d.number)?.remaining ?? 0) >= credit,
    );
    // By number, as a supplier writes it: PC Complete's "720-2".
    const number = xeroNumberOf(note.number);
    const byNumber = /\d/.test(number) ? candidates.filter((d) => xeroNumberOf(d.number) === number) : [];
    // Or by the reference both carry, where exactly one with it still owes
    // exactly the credit: DIISR's "Yr Ref W08-143" credit of 19.95, and the
    // one invoice of that reference with 19.95 left on it. Customers' credit
    // notes are numbered on their own (CN-0034), so the number says nothing.
    const byReference =
      note.reference.trim() === ""
        ? []
        : candidates.filter(
            (d) => same(d.reference, note.reference) && (balances.get(d.number)?.remaining ?? 0) === credit,
          );
    // Or, with neither -- Xero leaves a credit note's number and reference
    // blank as readily as a bill's -- the one document of that contact still
    // owing exactly the credit: OpenAI's credit of 37.69 and its one bill of
    // 37.69 open at the start.
    const byAmount = candidates.filter((d) => (balances.get(d.number)?.remaining ?? 0) === credit);
    const fits = byNumber.length > 0 ? byNumber : byReference.length > 0 ? byReference : byAmount;
    const only = fits[0];
    if (fits.length !== 1 || only === undefined) continue;
    links[note.number] = only.number;
    made += 1;
  }
  if (made === 0) return 0;
  const before = state.ledger.creditNotes ?? {};
  state.ledger = { ...state.ledger, creditNotes: links };
  state.persistent = await savePart(state.ledger);
  await record("invoice", `${made} credit note${made === 1 ? "" : "s"} put against what ${made === 1 ? "it credits" : "they credit"}, by number`, before, links);
  return made;
}

export async function loadAllocations(file: File): Promise<void> {
  const parsed = parseXeroAllocations(await readXeroText(file));
  if (parsed.allocations.length === 0) {
    await tellOnPage(`${file.name} holds no payment allocations.`);
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

/** The one drop zone that takes everything, and the single-purpose pickers beside it. */
export function wireFileIntake(): void {

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
  $("allocations-pick").addEventListener("click", () =>
    $<HTMLInputElement>("allocations-input").click(),
  );
  $<HTMLInputElement>("allocations-input").addEventListener("change", (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) void loadAllocations(file);
    (e.target as HTMLInputElement).value = "";
  });
  $("journals-pick").addEventListener("click", () => $<HTMLInputElement>("journals-input").click());
  $<HTMLInputElement>("journals-input").addEventListener("change", (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) void loadJournals(file);
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
}
