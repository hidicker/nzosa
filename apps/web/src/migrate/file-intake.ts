import { redraw, showPage } from "../app.js";
import { asCsvText, recomputeVariance, saveManualJournals, record } from "../books.js";
import { checkBankBalances, handleFiles } from "../daily/bank-import.js";
import { loadOpeningBalances } from "../daily/opening-balances.js";
import { loadCheckFiles } from "../migrate/coding-reconciliation.js";
import { $, state } from "../state.js";
import { ledgerName, save, savePart } from "../store.js";
import { downloadBackupNow, restoreWithConfirm } from "../backup.js";
import { readFiledReturns } from "../variance.js";
import {
  identifyExport,
  manualJournalsIn,
  mergeJournalNarrations,
  narratedJournalsLost,
  parseFixedAssets,
  parseXeroAllocations,
  parseXeroInvoices,
  parseXeroJournalReport,
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

  // Order matters, and a file picker hands them over in whatever order it
  // likes. A trial balance read before the chart of accounts recognises none
  // of its codes -- every account is reported as unknown and the opening
  // balances land under names nothing else uses -- and it reads the bank rows
  // through the chart's links, so the chart has to be in first. The same is
  // true in smaller ways of the rest: they all resolve account names.
  const ORDER: Record<string, number> = {
    chart: 0,
    "account-transactions": 0,
    "journal-report": 1,
    "general-ledger-detail": 1,
    invoices: 2,
    allocations: 2,
    "fixed-assets": 2,
    "trial-balance": 3,
  };
  rest.sort((a, b) => (ORDER[a.identified.kind] ?? 2) - (ORDER[b.identified.kind] ?? 2));

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
    alert(
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
    const ok = confirm(
      `${file.name} holds ${parsed.journals.length} journals, and does not include ` +
        `${lost.length} that carry a narration:\n\n${listed}${more}\n\n` +
        "These year-end entries cannot be recreated. Load this report anyway?",
    );
    if (!ok) return;
  }

  state.ledger = { ...state.ledger, journals: merged.journals };
  state.persistent = await savePart(state.ledger, "journals");
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
 * ledger three of them -- a 3,354.78 interest reversal, a 3,324.10 GST
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
  const found = manualJournalsIn(journals).filter(
    (j) => !held.some((existing) => existing.id === j.id),
  );
  if (found.length === 0) return;

  const many = found.length !== 1;
  const listed = found.map((j) => `  ${j.date}  ${j.narration.slice(0, 64)}`).join("\n");
  const ask =
    `${found.length} manual journal${many ? "s" : ""} in that report ${many ? "are" : "is"} ` +
    `not in your books:\n\n${listed}\n\n` +
    "These are year-end adjustments, and they change the profit and the " +
    "balance sheet. Take them?";
  if (!confirm(ask)) return;

  await saveManualJournals(
    [...held, ...found],
    `Read ${found.length} manual journal${many ? "s" : ""} from the report`,
  );
}

/** Read a fixed asset register and keep it with the ledger. */
export async function loadAssets(file: File): Promise<void> {
  const parsed = parseFixedAssets(await file.text());
  if (parsed.assets.length === 0) {
    alert(
      `${file.name} holds no assets. Export one from Xero as Accounting > Fixed assets > Export.`,
    );
    return;
  }
  const before = state.ledger.assets ?? [];
  if (
    before.length > 0 &&
    !confirm(
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
    alert(
      `${parsed.assets.length} assets loaded. ${parsed.problems.length} could not be read:\n` +
        parsed.problems.slice(0, 5).map((p) => p.message).join("\n"),
    );
  }
  redraw("assets");
  redraw("reports");
}

export async function loadInvoices(file: File): Promise<void> {
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

export async function loadAllocations(file: File): Promise<void> {
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
