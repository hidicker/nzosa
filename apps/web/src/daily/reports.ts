import { computeOurReturns } from "../variance.js";
import { redraw, showPage } from "../app.js";
import {
  recordFiledReturn,
  varianceInput,
  accountsFor,
  accountsForEditing,
  assetProceedsInUse,
  bankLabel,
  banks,
  entityBankAccounts,
  ledgerAccountFor,
  postedJournals,
  record,
  reportEngine,
  saveManualJournals,
} from "../books.js";
import { monthlyColumns, rankedBars, statTiles } from "../charts.js";
import { combobox } from "../combobox.js";
import { $, state } from "../state.js";
import { savePart } from "../store.js";
import { amountCell, download, nameCell, note } from "../ui.js";
import { downloadExcelReport } from "./excel-export.js";
import { unresolvedNote } from "../widgets.js";
import {
  filedReturnFromOurs,
  formatGstReturn,
  gstOutcomeLabel,
  gstReturnBoxRows,
  gstTransactionGroups,
  agentStatementProblems,
  agentStatementTotals,
  ir3Return,
  isRental,
  ownerRentalSchedule,
  rentalSchedule,
  splitAccountLabel,
  IR10_LAYOUT,
  TAX_EXTRA_CATEGORIES,
  accountTransactionRows,
  balanceSheetRole,
  accrualProfitAndLoss,
  checkManualJournal,
  computeBalanceSheet,
  postedFromImported,
  depreciationSchedule,
  emptyEntityModel,
  financialYearOf,
  formatAccountTransactions,
  formatAmount,
  formatDepreciationSchedule,
  formatGeneralLedger,
  formatOwnerSummary,
  formatProfitAndLoss,
  generalLedgerRows,
  generalLedgerTotals,
  groupProfitAndLoss,
  gstWithin,
  ir10Summary,
  manualJournalsIn,
  overdrawnWarning,
  ownersOf,
  parseAmount,
  profitAndLoss,
  reportLabeller as coreReportLabeller,
  reportLookups as coreReportLookups,
  reportsNetOfGst,
  shareholderSchedule,
  summariseForOwner,
  taxSummary,
  totalExtras,
  trialBalance,
} from "@nzosa/core";
import type {
  GstReturnResult,
  AgentStatement,
  AgentStatementLine,
  CodingEngine,
  EntityModel,
  Ir3Details,
  OwnerRentalSchedule,
  RentalLine,
  RentalSchedule,
  BalanceSheetLine,
  Cents,
  DateRange,
  Entity,
  Journal,
  ManualJournal,
  OwnerSummary,
  PlClass,
  PlGroup,
  PostedJournal,
  ProfitAndLoss,
  ReportLine,
  ReportSection,
  RuleSet,
  TaxExtra,
  TaxExtraCategory,
  Transaction,
} from "@nzosa/core";

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

/**
 * The reports, and the three bases they can be read on.
 *
 * The same books answer differently depending on what is being asked. Accrual
 * from our own postings is what the ledger says; accrual from the imported
 * file is what the other system said, kept so the two can be compared; cash is
 * what the bank did. None is more correct than the others, and a report that
 * did not say which it was would be worse than no report.
 *
 * Every figure here is derived, never stored. The composition is in core --
 * `postLedger` and the coding engine -- and this file is the presentation of
 * it: which years, which entity, net or gross, and the tables and charts that
 * result. A figure appearing only here and nowhere in core would be a figure
 * nothing tests, which is why the split falls where it does.
 */

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
export function reportLabeller(): (line: { accountCode: string; accountName: string }) => string {
  return coreReportLabeller({
    chart: state.chart,
    ...(state.rules ? { rules: state.rules as RuleSet } : {}),
    overrides: state.ledger.overrides ?? {},
  });
}

export function reportLookups(): {
  entityOfCode: Map<string, string>;
  sectionOf: (code: string) => ReportSection | null;
  classOf: (code: string) => PlClass | null;
  roleOf: (code: string) => string | null;
} {
  return coreReportLookups({
    model: state.ledger.entities ?? emptyEntityModel(),
    accounts: accountsForEditing(),
  });
}

/**
 * What each line below the profit is, in words.
 *
 * The chart answers for its own accounts. Two kinds of line are not in it: a
 * bank account the postings name by its number, and the lines posted to no
 * account at all. Both are said plainly rather than left as "no type set",
 * which would send somebody looking for a setting that is not the problem.
 */
function lineRoles(): (code: string) => string {
  const lookups = reportLookups();
  const held = new Set<string>();
  for (const account of new Set(state.ledger.transactions.map((t) => t.account))) {
    const named = bankLabel(account);
    held.add(named);
    held.add(`${named} ${named}`);
  }
  for (const t of state.ledger.transactions) {
    const label = String(t.extras?.["accountLabel"] ?? t.account);
    held.add(label);
    held.add(`${label} ${label}`);
  }
  return (code) => {
    if (held.has(code)) return balanceSheetRole("Bank", code);
    if (code.trim() === "(uncoded)") return "Not coded to an account yet";
    return lookups.roleOf(code) ?? "No account type set";
  };
}

/** Build the report currently selected, or null when there is nothing to build. */
export function currentReport(
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
export function ownerSummaryFor(owner: string, year: number): OwnerSummary {
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
  add.disabled = journalDraft !== null;
  add.addEventListener("click", () => {
    journalDraft = {
      date: to,
      narration: "",
      lines: [blankJournalLine(), blankJournalLine()],
    };
    redraw("reports");
  });
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
  if (journalDraft !== null) body.append(journalEditor(journalDraft));

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

interface JournalDraftLine {
  code: string;
  debit: string;
  credit: string;
  description: string;
}

interface JournalDraft {
  date: string;
  narration: string;
  lines: JournalDraftLine[];
}

/**
 * The journal being written on the page, or null when none is.
 *
 * Kept outside the page so a redraw for some other reason -- a save elsewhere,
 * a change of year -- does not throw away what has been typed.
 */
let journalDraft: JournalDraft | null = null;

function blankJournalLine(): JournalDraftLine {
  return { code: "", debit: "", credit: "", description: "" };
}

/**
 * Write a journal of as many lines as it needs.
 *
 * It used to be two: a debit, a credit and one amount, asked one question at a
 * time. That is what a correction usually is, but not always -- clearing three
 * supplier bills takes Accounts Payable, the expense, and the GST on it, and
 * split into two-line journals the entry no longer reads as the one thing it
 * was.
 *
 * The rules are the ones a journal is posted under, checked while it is typed
 * rather than after: it must balance to the cent, have at least two lines and a
 * reason, and every line needs an account from the chart and an amount on one
 * side only. Saving stays off until all of that holds, and what is still wrong
 * is said underneath -- so an unbalanced journal is never saved at all, rather
 * than saved and then left out of the reports.
 */
function journalEditor(draft: JournalDraft): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "split-editor journal-editor";

  const title = document.createElement("h4");
  title.textContent = "Write a journal";
  wrap.append(title);

  const head = document.createElement("div");
  head.className = "journal-editor-head";
  const date = document.createElement("input");
  date.type = "date";
  date.value = draft.date;
  date.title = "Date of the journal";
  date.addEventListener("input", () => {
    draft.date = date.value;
    refresh();
  });
  const narration = document.createElement("input");
  narration.type = "text";
  narration.placeholder =
    "Why this journal exists, in your own words -- a year from now the figures will be obvious and the reason will not";
  narration.value = draft.narration;
  narration.addEventListener("input", () => {
    draft.narration = narration.value;
    refresh();
  });
  head.append(date, narration);
  wrap.append(head);

  const columns = document.createElement("div");
  columns.className = "journal-row journal-columns";
  for (const label of ["Account", "Debit", "Credit", "Description (optional)", ""]) {
    const cell = document.createElement("span");
    cell.textContent = label;
    columns.append(cell);
  }
  wrap.append(columns);

  const rows = document.createElement("div");
  rows.className = "split-rows";
  wrap.append(rows);

  // The chart's accounts, and any bank account the ledger holds that no chart
  // account is linked to. A linked one is offered under its chart name, which
  // posts to the same account.
  const linkedBanks = new Set(
    state.chart.map((a) => (a.ledgerAccount ?? "").trim()).filter((id) => id !== ""),
  );
  const unlinkedBanks = [...banks().accounts]
    .filter((id) => !linkedBanks.has(id))
    .map((id) => bankLabel(id));
  const codes = [...new Set([...accountsForEditing().map((a) => a.label), ...unlinkedBanks])];
  const knownAccount = new Set(codes);

  const status = document.createElement("p");
  status.className = "split-balance";

  const addLine = document.createElement("button");
  addLine.type = "button";
  addLine.textContent = "Add line";
  addLine.addEventListener("click", () => {
    readRows();
    draft.lines.push(blankJournalLine());
    draw();
  });

  const save = document.createElement("button");
  save.type = "button";
  save.className = "primary";
  save.textContent = "Save journal";
  save.addEventListener("click", () => {
    readRows();
    const { journal, problems } = assemble();
    if (problems.length > 0) return;
    journalDraft = null;
    void saveManualJournals(
      [...(state.ledger.manualJournals ?? []), journal],
      `Journal: ${journal.narration}`,
    );
  });

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => {
    journalDraft = null;
    redraw("reports");
  });

  const buttons = document.createElement("div");
  buttons.className = "page-actions";
  buttons.append(addLine, save, cancel);
  wrap.append(status, buttons);

  /**
   * Read-backs for the account pickers, which commit on a mousedown they have
   * already handled and fire nothing -- the same arrangement as the split
   * editor.
   */
  let readers: Array<() => void> = [];
  function readRows(): void {
    for (const read of readers) read();
  }

  const money = (cents: Cents): string => formatAmount(cents);

  /** The journal as it would be saved, and everything still stopping that. */
  function assemble(): { journal: ManualJournal; problems: string[] } {
    const problems: string[] = [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) problems.push("choose a date");
    if (draft.narration.trim() === "") problems.push("say why the journal exists");

    const lines: ManualJournal["lines"] = [];
    draft.lines.forEach((line, index) => {
      const n = index + 1;
      const code = line.code.trim();
      const hasDebit = line.debit.trim() !== "";
      const hasCredit = line.credit.trim() !== "";
      if (code === "" && !hasDebit && !hasCredit) return;

      const debit = hasDebit ? parseAmount(line.debit.trim()) : 0;
      const credit = hasCredit ? parseAmount(line.credit.trim()) : 0;
      if (debit === null || credit === null) {
        problems.push(`line ${n}: that is not an amount`);
        return;
      }
      if (debit < 0 || credit < 0) {
        problems.push(`line ${n}: enter amounts without a minus sign, in the debit or the credit column`);
        return;
      }
      if (debit !== 0 && credit !== 0) {
        problems.push(`line ${n}: a line is a debit or a credit, not both`);
        return;
      }
      if (debit === 0 && credit === 0) {
        problems.push(`line ${n}: needs an amount`);
        return;
      }
      if (code === "") {
        problems.push(`line ${n}: needs an account`);
        return;
      }
      if (!knownAccount.has(code)) {
        problems.push(`line ${n}: "${code}" is not an account in the chart -- pick one from the list`);
        return;
      }
      lines.push({
        code,
        amount: debit - credit,
        ...(line.description.trim() !== "" ? { description: line.description.trim() } : {}),
      });
    });

    const journal: ManualJournal = {
      id: `m${Date.now().toString(36)}`,
      date: draft.date,
      narration: draft.narration.trim(),
      lines,
    };
    // The rules the journal is posted under, so this form cannot accept one the
    // ledger would then refuse. Asked once the line-by-line checks have nothing
    // to say: before that they only repeat them in other words.
    if (problems.length === 0) {
      for (const problem of checkManualJournal(journal)) problems.push(problem.message);
    }
    return { journal, problems };
  }

  function refresh(): void {
    const { problems } = assemble();
    // From what is typed, not from the lines that are already complete: amounts
    // usually go in before the accounts, and totals that ignored them read
    // "balanced" over a journal that was nothing of the kind.
    const typed = (text: string): Cents => Math.abs(parseAmount(text.trim()) ?? 0);
    const debits = draft.lines.reduce((sum, l) => sum + typed(l.debit), 0);
    const credits = draft.lines.reduce((sum, l) => sum + typed(l.credit), 0);
    const difference = debits - credits;
    const totals =
      `Debits ${money(debits)} · Credits ${money(credits)}` +
      (difference !== 0
        ? ` · out by ${money(Math.abs(difference))}`
        : debits === 0
          ? ""
          : " · balanced");
    status.textContent = problems.length === 0 ? totals : `${totals}. Still to do: ${problems.join("; ")}.`;
    status.className = problems.length === 0 ? "split-balance ok" : "split-balance off";
    save.disabled = problems.length > 0;
  }

  function draw(): void {
    rows.textContent = "";
    readers = [];
    draft.lines.forEach((line, index) => {
      const row = document.createElement("div");
      row.className = "journal-row";

      const account = combobox(codes, line.code === "" ? null : line.code, "Search accounts…", () => {
        line.code = account.value;
        refresh();
      });
      readers.push(() => {
        line.code = account.value;
      });

      const amountInput = (value: string, placeholder: string, set: (v: string) => void) => {
        const input = document.createElement("input");
        input.type = "text";
        input.inputMode = "decimal";
        input.className = "split-amount";
        input.placeholder = placeholder;
        input.value = value;
        input.addEventListener("input", () => {
          set(input.value);
          refresh();
        });
        return input;
      };
      const debit = amountInput(line.debit, "0.00", (v) => {
        line.debit = v;
      });
      const credit = amountInput(line.credit, "0.00", (v) => {
        line.credit = v;
      });

      const description = document.createElement("input");
      description.type = "text";
      description.value = line.description;
      description.addEventListener("input", () => {
        line.description = description.value;
      });

      const drop = document.createElement("button");
      drop.type = "button";
      drop.className = "link-button";
      drop.textContent = "✕";
      drop.title = "Remove this line";
      drop.disabled = draft.lines.length <= 2;
      drop.addEventListener("click", () => {
        readRows();
        draft.lines.splice(index, 1);
        draw();
      });

      row.append(account.element, debit, credit, description, drop);
      rows.append(row);
    });
    refresh();
  }

  draw();
  return wrap;
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
/**
 * The journals a position-on-the-day report is built from, for the basis chosen.
 *
 * On the imported basis, the other system's own answer: its journals over the
 * same opening balances, with its bank lines keyed as this ledger keys them.
 * Anywhere else, and on that basis with no journal report loaded, this
 * ledger's postings. The balance sheet and the IR10 both used to build from the
 * postings on every basis, under a heading that said the imported one was read
 * from the file -- and the balance sheet was fixed while the IR10 was not. One
 * function for both is what stops that happening again.
 */
function positionJournals(): {
  journals: PostedJournal[];
  basis: string;
  fromImport: boolean;
} {
  const basis = $<HTMLSelectElement>("report-basis").value;
  const imported = state.ledger.journals ?? [];
  const fromImport = basis === "accrual" && imported.length > 0;
  if (!fromImport) return { journals: postedJournals(), basis, fromImport };
  const chartByName = new Map(state.chart.map((a) => [a.name.trim().toLowerCase(), a]));
  return {
    journals: postedFromImported(imported, (name) =>
      ledgerAccountFor(name, chartByName.get(name.trim().toLowerCase())),
    ),
    basis,
    fromImport,
  };
}

const NO_JOURNAL_REPORT =
  "No journal report is loaded, so this is built from your postings rather than read " +
  "from the other system. Load one on the Coding reconciliation page to compare.";

/**
 * Whether these books are a company's.
 *
 * A company owes its shareholders what they lend it through their current
 * accounts, so the IR10 and the balance sheet set those out as a liability; for
 * anyone else the same accounts are the owner's equity. The entity records
 * what kind of income it earns, not whether it is a company, so its name
 * decides -- and with no entity, a company is the likelier answer.
 */
function companyBooks(): boolean {
  const entity = reportingEntity();
  return entity === undefined || /\b(limited|ltd)\b/i.test(entity.name);
}

function renderIr10(body: HTMLElement, year: number): void {
  const { journals, basis, fromImport } = positionJournals();
  const entity = reportingEntity();
  const company = companyBooks();
  const summary = ir10Summary({
    yearEnding: `${year}-03-31`,
    yearStarting: `${year - 1}-04-01`,
    journals,
    ...(state.ledger.openingBalances ? { openingBalances: state.ledger.openingBalances } : {}),
    chart: state.chart,
    assets: state.ledger.assets ?? [],
    proceeds: assetProceedsInUse(),
    currentAccountsAsLiabilities: company,
  });

  // Set out as the form is printed: every box, in order, whole dollars, the
  // totals in bold and a rule under each block -- so it can be laid beside a
  // filed return and read down the two together.
  const heading = document.createElement("h3");
  heading.textContent = "Financial Statement - IR10";
  body.append(heading);
  body.append(
    note(`1 April ${year - 1} to 31 March ${year}${entity !== undefined ? ` · ${entity.name}` : ""}`),
  );
  if (basis === "accrual" && !fromImport) body.append(note(NO_JOURNAL_REPORT));

  if (state.ledger.openingBalances === undefined) {
    const warn = document.createElement("p");
    warn.className = "journal-out";
    warn.textContent =
      "No opening balances, so boxes 30 to 51 are only the movement since the first " +
      "transaction. The income and expense boxes are unaffected.";
    body.append(warn);
  }

  const dollars = (cents: Cents): string => {
    const text = (Math.abs(cents) / 100).toLocaleString("en-NZ", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return cents < 0 ? `(${text})` : text;
  };

  const table = document.createElement("table");
  table.className = "report-table ir10-form";
  const tbody = document.createElement("tbody");
  for (const line of IR10_LAYOUT) {
    const box = summary.boxes[line.box];
    if (box === undefined) continue;
    const row = document.createElement("tr");
    if (line.total === true) row.classList.add("ir10-total");
    if (line.ruleAfter === true) row.classList.add("ir10-rule");
    const number = document.createElement("td");
    number.className = "ir10-box";
    number.textContent = String(line.box);
    const title = document.createElement("td");
    title.textContent = line.title;
    const amount = document.createElement("td");
    amount.className = "report-amount";
    amount.textContent = box.text ?? dollars(box.amount);
    row.append(number, title, amount);
    tbody.append(row);
  }
  table.append(tbody);
  body.append(table);

  const check = document.createElement("p");
  check.className = summary.imbalance === 0 ? "journal-balanced" : "journal-out";
  check.textContent =
    summary.imbalance === 0
      ? "The books behind this balance, so owners equity (box 51) is what is left once the liabilities are met."
      : `The books behind this are out by ${formatAmount(summary.imbalance)} before rounding, ` +
        "and owners equity (box 51) is carrying that difference.";
  body.append(check);

  body.append(
    note(
      "Whole dollars, as filed. Total income and total expenses are rounded from their exact " +
        "figures and other income and other expenses take the rounding, so every total adds up. " +
        (company
          ? "Shareholder current accounts are a current liability (box 47), as a company owes them. "
          : "Owner current accounts are counted in owners equity. ") +
        "Box 28 adds back non-deductible expenses, and box 52 takes tax depreciation to equal " +
        "accounting depreciation. Losses brought forward and the tax on the result are on the IR4.",
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
  const { journals, basis, fromImport } = positionJournals();
  // Set out as signed statements are: a company's shareholder current accounts
  // as one current liability, and the year's profit inside retained earnings.
  const company = companyBooks();
  const sheet = computeBalanceSheet({
    asAt,
    ...(opening ? { openingBalances: opening } : {}),
    journals,
    chart: state.chart,
    shareholderCurrentAccounts: company,
    profitInRetainedEarnings: company,
  });

  const heading = document.createElement("h3");
  heading.textContent = `Balance sheet as at 31 March ${year}`;
  body.append(heading);

  if (basis === "accrual" && !fromImport) body.append(note(NO_JOURNAL_REPORT));

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

  // A section's own total is left off where a grand total below says the same.
  const section = (
    title: string,
    lines: readonly BalanceSheetLine[],
    total: Cents,
    withTotal = true,
  ): void => {
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

    if (!withTotal) return;
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
  section(sheet.equity.title, sheet.equity.lines, sheet.equity.total, false);
  grand("Total equity", sheet.totalEquity);

  table.append(head, tbody);
  body.append(table);

  if (company) {
    body.append(
      note(
        "Shareholder current accounts are the director's loan, drawings and funds introduced as " +
          "one balance, a current liability because the company owes it; retained earnings " +
          "include the year's profit. This is how the signed statements set them out.",
      ),
    );
  }

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
        "No fixed assets yet. Depreciation is the one figure bank data cannot produce — " +
          "it depends on each asset's cost, method and rate. Add them, or load a register, " +
          "on the Fixed assets page.",
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
      "Each asset on its own method, straight line or diminishing value, with full month " +
        "averaging. An asset disposed of during the year takes no " +
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

/** A statement being entered or edited: amounts as typed, until it is saved. */
interface AgentDraftLine {
  code: string;
  description: string;
  amount: string;
}

interface AgentDraft {
  id: string;
  entity: string;
  agent: string;
  from: string;
  to: string;
  heldCode: string;
  heldAtStart: string;
  income: AgentDraftLine[];
  expenses: AgentDraftLine[];
  paidToOwner: string;
  heldAtEnd: string;
}

let agentDraft: AgentDraft | null = null;

function draftFromStatement(statement: AgentStatement): AgentDraft {
  const text = (cents: Cents): string => (cents / 100).toFixed(2);
  const lines = (list: readonly AgentStatementLine[]): AgentDraftLine[] =>
    list.map((line) => ({ code: line.code, description: line.description, amount: text(line.amount) }));
  return {
    id: statement.id,
    entity: statement.entity,
    agent: statement.agent,
    from: statement.from,
    to: statement.to,
    heldCode: statement.heldCode,
    heldAtStart: text(statement.heldAtStart),
    income: lines(statement.income),
    expenses: lines(statement.expenses),
    paidToOwner: text(statement.paidToOwner),
    heldAtEnd: text(statement.heldAtEnd),
  };
}

/** The statement a draft would save, and everything still stopping it. */
function statementFromDraft(draft: AgentDraft): { statement: AgentStatement; problems: string[] } {
  const problems: string[] = [];
  const amount = (typed: string, what: string): Cents => {
    if (typed.trim() === "") return 0;
    const parsed = parseAmount(typed.trim());
    if (parsed === null) {
      problems.push(`${what}: that is not an amount`);
      return 0;
    }
    return parsed;
  };
  const lines = (list: readonly AgentDraftLine[], kind: string): AgentStatementLine[] =>
    list
      .filter((l) => l.code.trim() !== "" || l.description.trim() !== "" || l.amount.trim() !== "")
      .map((l, index) => ({
        code: l.code.trim(),
        description: l.description.trim(),
        amount: amount(l.amount, `${kind} line ${index + 1}`),
      }));
  const statement: AgentStatement = {
    id: draft.id,
    entity: draft.entity,
    agent: draft.agent.trim(),
    from: draft.from,
    to: draft.to,
    heldCode: draft.heldCode.trim(),
    heldAtStart: amount(draft.heldAtStart, "held at the start"),
    income: lines(draft.income, "collected"),
    expenses: lines(draft.expenses, "paid out"),
    paidToOwner: amount(draft.paidToOwner, "paid to you"),
    heldAtEnd: amount(draft.heldAtEnd, "held at the end"),
  };
  const known = new Set(accountsForEditing().map((a) => a.label));
  for (const code of [statement.heldCode, ...statement.income.map((l) => l.code), ...statement.expenses.map((l) => l.code)]) {
    if (code !== "" && !known.has(code)) problems.push(`"${code}" is not an account -- pick one from the list`);
  }
  return { statement, problems: [...problems, ...agentStatementProblems(statement)] };
}

/**
 * What the books hold in an account at the end of a day.
 *
 * Its opening balance, where one was entered, and everything posted to it from
 * then on -- the same figure the balance sheet would show for it that day.
 */
function bookBalanceOn(code: string, date: string, journals: readonly PostedJournal[]): Cents {
  const { code: digits, name } = splitAccountLabel(code);
  const wanted = name.trim().toLowerCase();
  const opening = state.ledger.openingBalances;
  let balance = opening !== undefined && opening.asAt <= date ? (opening.accounts[digits] ?? 0) : 0;
  for (const journal of journals) {
    if (journal.date > date) continue;
    if (opening !== undefined && journal.date < opening.asAt) continue;
    for (const line of journal.lines) {
      const same =
        (digits !== "" && line.accountCode === digits) || line.accountName.trim().toLowerCase() === wanted;
      if (same) balance += line.amount;
    }
  }
  return balance;
}

/**
 * Property manager statements: entered, posted, and checked against the bank.
 *
 * The check is the point. The statement says what the manager is holding; the
 * property manager account says what the books think they are holding, once
 * the statement's journal and the payments from the bank are both in it. A
 * payment made on the last day and banked a few days later is the one ordinary
 * difference, and it is named as that rather than left looking like an error.
 */
function renderAgentStatements(body: HTMLElement, year: number): void {
  const from = `${year - 1}-04-01`;
  const to = `${year}-03-31`;
  const model = state.ledger.entities ?? emptyEntityModel();
  const rentals = model.entities.filter(isRental);
  const inYear = (state.ledger.agentStatements ?? [])
    .filter((s) => s.to >= from && s.to <= to)
    .sort((a, b) => a.to.localeCompare(b.to) || a.agent.localeCompare(b.agent));

  const heading = document.createElement("h3");
  heading.textContent = `Property manager statements, year ended 31 March ${year}`;
  body.append(heading);
  body.append(
    note(
      "Code the manager's payments to you to a property manager account -- a current asset " +
        "belonging to the property -- then enter each statement here. It posts the rent the " +
        "manager collected and what they paid out of it, and leaves the account holding what the " +
        "manager holds, so the two can be checked against each other.",
    ),
  );

  if (rentals.length === 0) {
    body.append(
      note("No rental properties yet. On Entities & accounts, give each property an entity of its own."),
    );
    return;
  }

  const actions = document.createElement("div");
  actions.className = "page-actions";
  const add = document.createElement("button");
  add.type = "button";
  add.textContent = "Enter a statement";
  add.disabled = agentDraft !== null;
  add.addEventListener("click", () => {
    agentDraft = {
      id: `a${Date.now().toString(36)}`,
      entity: rentals.length === 1 ? (rentals[0]?.id ?? "") : "",
      agent: "",
      from,
      to,
      heldCode: "",
      heldAtStart: "",
      income: [{ code: "", description: "Rent", amount: "" }],
      expenses: [{ code: "", description: "Management fees", amount: "" }],
      paidToOwner: "",
      heldAtEnd: "",
    };
    redraw("reports");
  });
  actions.append(add);
  body.append(actions);
  if (agentDraft !== null) body.append(agentEditor(agentDraft, rentals));

  if (inYear.length === 0) {
    body.append(note("None entered for this year."));
    return;
  }
  const journals = postedJournals();
  const engine = reportEngine();
  for (const statement of inYear) body.append(agentCard(statement, model, journals, engine));
}

function agentCard(
  statement: AgentStatement,
  model: EntityModel,
  journals: readonly PostedJournal[],
  engine: CodingEngine | null,
): HTMLElement {
  const card = document.createElement("div");
  const problems = agentStatementProblems(statement);
  card.className = problems.length > 0 ? "journal-card journal-broken" : "journal-card";

  const property = model.entities.find((e) => e.id === statement.entity)?.name ?? statement.entity;
  const title = document.createElement("p");
  title.className = "journal-narration";
  title.textContent = `${statement.agent} — ${property}, ${statement.from} to ${statement.to}`;
  card.append(title);

  if (problems.length > 0) {
    const bad = document.createElement("p");
    bad.className = "journal-out";
    bad.textContent = `Not posted: ${problems.join("; ")}.`;
    card.append(bad);
  }

  const totals = agentStatementTotals(statement);
  const table = document.createElement("table");
  table.className = "report-table opening-table";
  const tbody = document.createElement("tbody");
  const row = (label: string, amount: Cents, className = ""): void => {
    const tr = document.createElement("tr");
    if (className !== "") tr.className = className;
    tr.append(nameCell(label), amountCell(centsSaid(amount)));
    tbody.append(tr);
  };
  row("Held for you at the start", statement.heldAtStart);
  for (const line of statement.income) row(`${line.description} — ${scheduleName(line.code)}`, line.amount);
  row("Collected", totals.income, "report-total");
  for (const line of statement.expenses) row(`${line.description} — ${scheduleName(line.code)}`, line.amount);
  row("Paid out", totals.expenses, "report-total");
  row("Paid to you", statement.paidToOwner);
  row("Held for you at the end", statement.heldAtEnd, "bs-grand");
  table.append(tbody);
  card.append(table);

  if (problems.length === 0) {
    const books = bookBalanceOn(statement.heldCode, statement.to, journals);
    const lateReceipts =
      engine === null
        ? 0
        : engine.transactions
            .filter(
              (t) =>
                t.date > statement.to &&
                (Date.parse(t.date) - Date.parse(statement.to)) / 86_400_000 <= 14 &&
                engine.codeOf(t) === statement.heldCode,
            )
            .reduce((sum, t) => sum + t.amount, 0);
    const account = scheduleName(statement.heldCode);
    const difference = books - statement.heldAtEnd;
    const check = document.createElement("p");
    if (difference === 0) {
      check.className = "journal-balanced";
      check.textContent = `${account} holds ${centsSaid(books)} at ${statement.to}, as the statement says.`;
    } else if (difference === lateReceipts) {
      check.className = "journal-balanced";
      check.textContent =
        `${account} holds ${centsSaid(books)} at ${statement.to} and the statement says ` +
        `${centsSaid(statement.heldAtEnd)}. The ${centsSaid(difference)} between them reached your ` +
        "bank within two weeks of the period ending: paid out at the end of the period, banked after it.";
    } else {
      check.className = "journal-out";
      check.textContent =
        `${account} holds ${centsSaid(books)} at ${statement.to}, but the statement says ` +
        `${centsSaid(statement.heldAtEnd)} -- ${centsSaid(difference)} apart. Check that every payment ` +
        "from this manager is coded to this account, that the account's opening balance is what the " +
        "manager held when the books start, and that the earlier statements are entered.";
    }
    card.append(check);
  }

  const buttons = document.createElement("div");
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "link-button";
  edit.textContent = "edit";
  edit.disabled = agentDraft !== null;
  edit.addEventListener("click", () => {
    agentDraft = draftFromStatement(statement);
    redraw("reports");
  });
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "link-button";
  remove.textContent = "remove";
  remove.addEventListener("click", () => void removeAgentStatement(statement));
  buttons.append(edit, remove);
  card.append(buttons);
  return card;
}

/** The form for one statement, checked as it is typed. */
function agentEditor(draft: AgentDraft, rentals: readonly Entity[]): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "split-editor journal-editor";
  const title = document.createElement("h4");
  title.textContent = "A property manager's statement";
  wrap.append(title);

  const codes = accountsForEditing().map((a) => a.label);
  const status = document.createElement("p");
  status.className = "split-balance";
  const gstNote = note(
    "This rental is registered for GST, and the form posts amounts as entered with no GST split " +
      "out. Enter them excluding GST, and put the GST on the manager's fees through a manual journal.",
  );
  const save = document.createElement("button");
  save.type = "button";
  save.className = "primary";
  save.textContent = "Save statement";

  const input = (value: string, placeholder: string, set: (v: string) => void, type = "text"): HTMLInputElement => {
    const element = document.createElement("input");
    element.type = type;
    element.value = value;
    element.placeholder = placeholder;
    element.addEventListener("input", () => {
      set(element.value);
      refresh();
    });
    return element;
  };
  const money = (value: string, set: (v: string) => void): HTMLInputElement => {
    const element = input(value, "0.00", set);
    element.inputMode = "decimal";
    element.className = "split-amount";
    return element;
  };
  const fieldsIn = (container: HTMLElement) => (label: string, control: HTMLElement): void => {
    const wrapper = document.createElement("label");
    wrapper.append(label, control);
    container.append(wrapper);
  };

  const opening = document.createElement("div");
  opening.className = "agent-fields";
  const field = fieldsIn(opening);
  const property = document.createElement("select");
  if (draft.entity === "") {
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "-- choose the property --";
    property.append(blank);
  }
  for (const entity of rentals) {
    const option = document.createElement("option");
    option.value = entity.id;
    option.textContent = entity.name;
    option.selected = entity.id === draft.entity;
    property.append(option);
  }
  property.addEventListener("change", () => {
    draft.entity = property.value;
    refresh();
  });
  field("Property", property);
  field("Property manager", input(draft.agent, "e.g. Kowhai Property Management", (v) => { draft.agent = v; }));
  field("From", input(draft.from, "", (v) => { draft.from = v; }, "date"));
  field("To", input(draft.to, "", (v) => { draft.to = v; }, "date"));
  const heldPicker = combobox(codes, draft.heldCode === "" ? null : draft.heldCode, "Search accounts…", () => {
    draft.heldCode = heldPicker.value;
    refresh();
  });
  field("Their payments to you are coded to", heldPicker.element);
  field("Held for you at the start", money(draft.heldAtStart, (v) => { draft.heldAtStart = v; }));
  wrap.append(opening);

  const section = (heading: string, lines: AgentDraftLine[], placeholder: string): void => {
    const label = document.createElement("p");
    label.className = "agent-section";
    label.textContent = heading;
    const rows = document.createElement("div");
    const draw = (): void => {
      rows.textContent = "";
      lines.forEach((line, index) => {
        const row = document.createElement("div");
        row.className = "agent-row";
        const account = combobox(codes, line.code === "" ? null : line.code, "Search accounts…", () => {
          line.code = account.value;
          refresh();
        });
        const drop = document.createElement("button");
        drop.type = "button";
        drop.textContent = "✕";
        drop.title = "Remove this line";
        drop.addEventListener("click", () => {
          lines.splice(index, 1);
          draw();
          refresh();
        });
        row.append(
          input(line.description, placeholder, (v) => { line.description = v; }),
          account.element,
          money(line.amount, (v) => { line.amount = v; }),
          drop,
        );
        rows.append(row);
      });
    };
    const more = document.createElement("button");
    more.type = "button";
    more.textContent = "Add a line";
    more.addEventListener("click", () => {
      lines.push({ code: "", description: "", amount: "" });
      draw();
    });
    draw();
    wrap.append(label, rows, more);
  };
  section("Collected from the tenant", draft.income, "e.g. Rent");
  section("Paid out of it", draft.expenses, "e.g. Management fees");

  const closing = document.createElement("div");
  closing.className = "agent-fields";
  const closingField = fieldsIn(closing);
  closingField("Paid to you", money(draft.paidToOwner, (v) => { draft.paidToOwner = v; }));
  closingField("Held for you at the end", money(draft.heldAtEnd, (v) => { draft.heldAtEnd = v; }));
  wrap.append(closing, gstNote);

  save.addEventListener("click", () => {
    const { statement, problems } = statementFromDraft(draft);
    if (problems.length > 0) return;
    agentDraft = null;
    void saveAgentStatement(statement);
  });
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => {
    agentDraft = null;
    redraw("reports");
  });
  const buttons = document.createElement("div");
  buttons.className = "page-actions";
  buttons.append(save, cancel);
  wrap.append(status, buttons);

  function refresh(): void {
    const { statement, problems } = statementFromDraft(draft);
    const totals = agentStatementTotals(statement);
    const said =
      `Collected ${centsSaid(totals.income)} · paid out ${centsSaid(totals.expenses)} · ` +
      `held at the end should be ${centsSaid(totals.expectedHeldAtEnd)}`;
    status.textContent = problems.length === 0 ? `${said} · adds up` : `${said}. Still to do: ${problems.join("; ")}.`;
    status.className = problems.length === 0 ? "split-balance ok" : "split-balance off";
    save.disabled = problems.length > 0;
    const entity = rentals.find((e) => e.id === draft.entity);
    gstNote.hidden = entity === undefined || entity.gstRegistered === false;
  }
  refresh();
  return wrap;
}

async function saveAgentStatement(statement: AgentStatement): Promise<void> {
  const before = state.ledger.agentStatements ?? [];
  const agentStatements = [...before.filter((s) => s.id !== statement.id), statement];
  state.ledger = { ...state.ledger, agentStatements };
  state.persistent = await savePart(state.ledger);
  await record(
    "agentStatements",
    `${statement.agent}: statement for ${statement.from} to ${statement.to}`,
    before,
    agentStatements,
  );
  redraw("reports");
}

async function removeAgentStatement(statement: AgentStatement): Promise<void> {
  if (!confirm(`Remove the ${statement.agent} statement for ${statement.from} to ${statement.to}? Its journal goes with it.`)) {
    return;
  }
  const before = state.ledger.agentStatements ?? [];
  const agentStatements = before.filter((s) => s.id !== statement.id);
  state.ledger = { ...state.ledger, agentStatements };
  state.persistent = await savePart(state.ledger);
  await record(
    "agentStatements",
    `${statement.agent}: statement for ${statement.from} to ${statement.to} removed`,
    before,
    agentStatements,
  );
  redraw("reports");
}

/** Which GST return period is open, and which half of it is showing. */
let gstPeriodChoice = "";
let gstReturnTab: "return" | "transactions" = "return";
/** When a box was clicked, which lines the Transactions tab narrows to. */
let gstBoxFocus: "sales" | "purchases" | "late" | null = null;

/** Every two-monthly return a financial year holds, from the coding. */
function gstReturnsFor(year: number): GstReturnResult[] {
  try {
    return computeOurReturns(varianceInput(), `${year - 1}-04-01`, `${year}-03-31`).filter(
      (r) => r.period.to >= `${year - 1}-04-01` && r.period.to <= `${year}-03-31`,
    );
  } catch {
    return [];
  }
}

/** The return the page is set to, or the latest one that has ended. */
function chosenGstReturn(year: number): GstReturnResult | undefined {
  const returns = gstReturnsFor(year);
  const chosen = returns.find((r) => r.period.to === gstPeriodChoice);
  if (chosen !== undefined) return chosen;
  const today = new Date().toISOString().slice(0, 10);
  return [...returns].reverse().find((r) => r.period.to < today) ?? returns[returns.length - 1];
}

/**
 * A GST return, laid out as the form is and as Xero shows one.
 *
 * Nothing here is stored: the return is worked out from the coding each time,
 * by the same calculation the reconciliation compares with a filed return. What
 * can be stored is the decision that it was filed, which keeps the return as it
 * stands that day.
 */
function renderGstReturn(body: HTMLElement, year: number): void {
  const returns = gstReturnsFor(year);
  if (returns.length === 0) {
    body.append(note("No GST periods in this year hold any transactions."));
    return;
  }
  const result = chosenGstReturn(year) ?? returns[returns.length - 1];
  if (result === undefined) return;
  gstPeriodChoice = result.period.to;
  const today = new Date().toISOString().slice(0, 10);
  const entity = reportingEntity();
  const filed = state.filed.find((f) => f.periodEnd === result.period.to);
  const money = (cents: Cents): string =>
    (cents / 100).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // --- period and tabs ---
  const controls = document.createElement("div");
  controls.className = "page-actions";
  const period = document.createElement("select");
  for (const one of [...returns].reverse()) {
    const option = document.createElement("option");
    option.value = one.period.to;
    option.textContent = `${one.period.from} to ${one.period.to}`;
    option.selected = one.period.to === result.period.to;
    period.append(option);
  }
  period.addEventListener("change", () => {
    gstPeriodChoice = period.value;
    gstBoxFocus = null;
    redraw("reports");
  });
  controls.append(period);
  for (const [tab, caption] of [["return", "GST return"], ["transactions", "Transactions"]] as const) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = caption;
    button.className = gstReturnTab === tab ? "primary" : "";
    button.addEventListener("click", () => {
      gstReturnTab = tab;
      if (tab === "return") gstBoxFocus = null;
      redraw("reports");
    });
    controls.append(button);
  }
  body.append(controls);

  // --- the heading: whose, which period, when, and which way the money goes ---
  const status = document.createElement("p");
  status.className = "gst-return-status";
  status.textContent =
    filed !== undefined
      ? /^filed$/i.test(filed.status.trim())
        ? "Filed"
        : `Filed (${filed.status})`
      : result.period.from <= today && today <= result.period.to
        ? "Current period"
        : result.period.to < today
          ? "Not recorded as filed"
          : "Future period";
  body.append(status);

  const heading = document.createElement("div");
  heading.className = "gst-return-head";
  const who = document.createElement("div");
  const name = document.createElement("h3");
  name.textContent = `${entity?.name ?? "GST return"} · ${result.period.from} to ${result.period.to}`;
  const sub = document.createElement("p");
  sub.className = "gst-return-sub";
  sub.textContent =
    (entity?.gstNumber ? `GST number ${entity.gstNumber} · ` : "") + `File by ${result.period.due}`;
  who.append(name, sub);
  const owed = document.createElement("div");
  owed.className = "gst-return-owed";
  const figure = document.createElement("strong");
  figure.textContent = money(result.boxes.box15);
  const said = document.createElement("span");
  said.textContent = gstOutcomeLabel(result);
  owed.append(figure, said);
  heading.append(who, owed);
  body.append(heading);

  // --- anything the figures are guessing at ---
  const assumed = result.lines.filter((line) => line.classification.assumed === true);
  if (assumed.length > 0) {
    const warn = document.createElement("p");
    warn.className = "journal-out";
    const tax = assumed.reduce((sum, line) => sum + Math.abs(gstWithin(line.amount, line.classification)), 0);
    warn.textContent =
      `${assumed.length} line${assumed.length === 1 ? " has" : "s have"} no coding and no GST treatment, ` +
      `so ${assumed.length === 1 ? "it was" : "they were"} assumed standard-rated: ${money(tax)} of GST ` +
      "on an assumption. Code them before filing.";
    body.append(warn);
  }
  if (result.missingTaxPoint.length > 0) {
    body.append(
      note(
        `${result.missingTaxPoint.length} transaction${result.missingTaxPoint.length === 1 ? " has" : "s have"} ` +
          "no tax point, so they were placed by payment date.",
      ),
    );
  }

  if (gstReturnTab === "transactions") {
    renderGstTransactions(body, result, money);
  } else {
    renderGstBoxes(body, result, money);
  }

  // --- filing ---
  if (filed === undefined && result.period.to < today) {
    const actions = document.createElement("div");
    actions.className = "page-actions";
    const mark = document.createElement("button");
    mark.type = "button";
    mark.className = "primary";
    mark.textContent = "Mark as filed";
    mark.title = "Keep this return as it stands today, to compare the books against later.";
    mark.addEventListener("click", () => {
      const owedText =
        result.boxes.outcome === "refund"
          ? `a refund of ${money(result.boxes.box15)}`
          : `${money(result.boxes.box15)} to pay`;
      if (
        !confirm(
          `Record the return for ${result.period.from} to ${result.period.to} as filed, with ${owedText}? ` +
            "It is kept as these books show it now, and the GST reconciliation compares against it.",
        )
      ) {
        return;
      }
      void recordFiledReturn(filedReturnFromOurs(result)).then(() => redraw("reports"));
    });
    actions.append(mark);
    body.append(actions);
  } else if (filed !== undefined) {
    const difference = result.boxes.box8 - result.boxes.box12 - filed.core;
    body.append(
      note(
        difference === 0
          ? "Filed, and the books still agree with the return as filed."
          : `Filed. The books now differ from it by ${money(difference)} (Box 8 less Box 12); ` +
              "the GST reconciliation shows the lines behind that.",
      ),
    );
  }
}

function renderGstBoxes(body: HTMLElement, result: GstReturnResult, money: (cents: Cents) => string): void {
  const details = document.createElement("table");
  details.className = "report-table gst-return-details";
  const detailBody = document.createElement("tbody");
  const late = result.lateClaims.reduce((sum, line) => sum + Math.abs(line.amount), 0);
  for (const [label, value] of [
    ["Tax basis", `${result.basis.charAt(0).toUpperCase()}${result.basis.slice(1)} basis`],
    ["Late claims included", result.lateClaims.length === 0 ? "None" : `${result.lateClaims.length}, ${money(late)}`],
  ] as const) {
    const tr = document.createElement("tr");
    tr.append(nameCell(label), amountCell(value));
    detailBody.append(tr);
  }
  details.append(detailBody);
  body.append(details);

  const focusFor: Record<string, "sales" | "purchases" | "late"> = {
    "Box 5": "sales",
    "Box 6": "sales",
    "Box 8": "sales",
    "Box 9": "late",
    "Box 11": "purchases",
    "Box 12": "purchases",
    "Box 13": "late",
  };
  for (const [section, title] of [["sales", "Sales and Income"], ["purchases", "Purchases and Expenses"]] as const) {
    const heading = document.createElement("h4");
    heading.textContent = title;
    body.append(heading);
    const table = document.createElement("table");
    table.className = "report-table ir10-form gst-return-form";
    const tbody = document.createElement("tbody");
    for (const row of gstReturnBoxRows(result).filter((r) => r.section === section)) {
      const tr = document.createElement("tr");
      if (row.box === "Box 10" || row.box === "Box 14" || row.box === "Box 15") tr.classList.add("ir10-total");
      const number = document.createElement("td");
      number.className = "ir10-box";
      number.textContent = row.box;
      const label = document.createElement("td");
      const focus = focusFor[row.box];
      if (focus !== undefined && (focus !== "late" || result.lateClaims.length > 0)) {
        const link = document.createElement("button");
        link.type = "button";
        link.className = "link-button";
        link.textContent = row.label;
        link.title = "Show the transactions behind this box";
        link.addEventListener("click", () => {
          gstReturnTab = "transactions";
          gstBoxFocus = focus;
          redraw("reports");
        });
        label.append(link);
      } else {
        label.textContent = row.label;
      }
      const amount = document.createElement("td");
      amount.className = "report-amount";
      amount.textContent = money(row.amount);
      tr.append(number, label, amount);
      tbody.append(tr);
    }
    table.append(tbody);
    body.append(table);
  }

  // Box 8 and Box 12 add up the GST on each line, rounded to the cent, as the
  // accounting systems do; Box 7 and Box 11 are then worked back from them. So
  // they can sit a few cents from Box 5 less Box 6, or from the lines' total.
  // Said only when it shows, because a figure that does not add up with no
  // reason given reads as an error.
  const b = result.boxes;
  const purchasesGross = result.lines
    .filter((l) => l.classification.side === "purchases")
    .reduce((sum, l) => sum - l.amount, 0);
  if (b.box7 !== b.box5 - b.box6 || (b.box11 !== purchasesGross && Math.abs(b.box11 - purchasesGross) < 100)) {
    body.append(
      note(
        "Box 8 and Box 12 add up the GST on each line, rounded to the cent, as Xero does. Box 7 and " +
          "Box 11 are worked back from them, so they can differ by a few cents from Box 5 less Box 6, " +
          "or from the total of the transactions behind them.",
      ),
    );
  }
}

function renderGstTransactions(body: HTMLElement, result: GstReturnResult, money: (cents: Cents) => string): void {
  if (gstBoxFocus !== null) {
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "link-button";
    clear.textContent =
      gstBoxFocus === "sales" ? "Showing sales and income · show all" :
        gstBoxFocus === "purchases" ? "Showing purchases and expenses · show all" : "Showing late claims · show all";
    clear.addEventListener("click", () => {
      gstBoxFocus = null;
      redraw("reports");
    });
    body.append(clear);
  }
  const sections: { heading: string; lines: GstReturnResult["lines"] }[] = [];
  const onSide = (side: string) => result.lines.filter((l) => l.classification.side === side || (side === "purchases" && l.classification.side === "imports"));
  if (gstBoxFocus === null) sections.push({ heading: "", lines: result.lines });
  if (gstBoxFocus === "sales") sections.push({ heading: "", lines: onSide("sales") });
  if (gstBoxFocus === "purchases") sections.push({ heading: "", lines: onSide("purchases") });
  if ((gstBoxFocus === null || gstBoxFocus === "late") && result.lateClaims.length > 0) {
    sections.push({ heading: "Late claims", lines: result.lateClaims });
  }

  let shown = 0;
  for (const section of sections) {
    for (const group of gstTransactionGroups(section.lines)) {
      shown += group.rows.length;
      const heading = document.createElement("h4");
      heading.textContent = section.heading === "" ? group.group : `${section.heading}: ${group.group}`;
      body.append(heading);
      const table = document.createElement("table");
      table.className = "report-table";
      table.innerHTML =
        "<thead><tr><th>Date</th><th>Contact</th><th>Description</th><th>Gross</th><th>GST</th><th>Net</th></tr></thead>";
      const tbody = document.createElement("tbody");
      for (const row of group.rows) {
        const tr = document.createElement("tr");
        tr.append(nameCell(row.date), nameCell(row.contact), nameCell(row.description));
        tr.append(amountCell(money(row.gross)), amountCell(money(row.gst)), amountCell(money(row.net)));
        tbody.append(tr);
      }
      const total = document.createElement("tr");
      total.className = "report-total";
      total.append(nameCell("Total"), nameCell(""), nameCell(""));
      total.append(amountCell(money(group.gross)), amountCell(money(group.gst)), amountCell(money(group.net)));
      tbody.append(total);
      table.append(tbody);
      body.append(table);
    }
  }
  if (shown === 0) body.append(note("No transactions in this part of the return."));
  if (shown > 0) {
    body.append(
      note(
        "Totals here are the lines added up. The return's Box 7 and Box 11 are worked back from the " +
          "GST on each line, rounded to the cent, so they can differ from these totals by a few cents.",
      ),
    );
  }
  if (gstBoxFocus === null && result.excluded.length > 0) {
    body.append(
      note(
        `${result.excluded.length} transaction${result.excluded.length === 1 ? " was" : "s were"} left out ` +
          "of the return: transfers, drawings and anything with no GST to account for.",
      ),
    );
  }
}

/** A financial year as a date range, labelled by the year it ends in. */
function yearPeriod(year: number): DateRange {
  return { from: `${year - 1}-04-01`, to: `${year}-03-31` };
}

/**
 * One entity's profit and loss, on the basis the page is set to.
 *
 * The same three sources the profit and loss reads, narrowed to the accounts
 * the entity holds, so a rental schedule and the profit and loss filtered to
 * the same property cannot disagree. The journals are gathered once and the
 * returned function reused for every property and year.
 */
function entityReporter(): (entity: Entity, period: DateRange) => ProfitAndLoss | null {
  const { entityOfCode, sectionOf } = reportLookups();
  const basis = $<HTMLSelectElement>("report-basis").value;
  const labelOf = reportLabeller();
  const imported = state.ledger.journals ?? [];
  const journals =
    basis === "posted" ? ourAccrualJournals() : basis === "accrual" && imported.length > 0 ? imported : null;
  const engine = journals === null ? reportEngine() : null;
  return (entity, period) => {
    const includeCode = (code: string): boolean => entityOfCode.get(code) === entity.id;
    if (journals !== null) return accrualProfitAndLoss(journals, { period, sectionOf, labelOf, includeCode });
    if (!engine) return null;
    return profitAndLoss(engine.transactions, {
      period,
      codeOf: engine.codeOf,
      classify: engine.classify,
      sectionOf,
      includeCode,
    });
  };
}

/** An account as a schedule names it: without the code on the end. */
function scheduleName(code: string): string {
  const { name } = splitAccountLabel(code);
  return name.trim() === "" ? code : name;
}

/** Every rental's schedule for a year, and for the year before where asked. */
function rentalSchedulesFor(
  year: number,
  withPrior = true,
): { entity: Entity; now: RentalSchedule; before: RentalSchedule | null }[] {
  const model = state.ledger.entities ?? emptyEntityModel();
  const reportOf = entityReporter();
  const out: { entity: Entity; now: RentalSchedule; before: RentalSchedule | null }[] = [];
  for (const entity of model.entities.filter(isRental)) {
    const now = reportOf(entity, yearPeriod(year));
    if (now === null) continue;
    const before = withPrior ? reportOf(entity, yearPeriod(year - 1)) : null;
    out.push({
      entity,
      now: rentalSchedule(entity, now, scheduleName),
      before: before === null ? null : rentalSchedule(entity, before, scheduleName),
    });
  }
  return out;
}

interface ScheduleRow {
  name: string;
  now: Cents;
  before: Cents;
}

/** This year's lines beside last year's, one row per account name. */
function pairLines(now: readonly RentalLine[], before: readonly RentalLine[]): ScheduleRow[] {
  const rows = new Map<string, ScheduleRow>();
  const at = (name: string): ScheduleRow => {
    const found = rows.get(name) ?? { name, now: 0, before: 0 };
    rows.set(name, found);
    return found;
  };
  for (const line of now) at(line.name).now += line.amount;
  for (const line of before) at(line.name).before += line.amount;
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Whole dollars, a dash for nothing, a loss in brackets -- as schedules print. */
function wholeDollars(cents: Cents): string {
  const dollars = Math.round(cents / 100);
  if (dollars === 0) return "-";
  const text = Math.abs(dollars).toLocaleString("en-NZ");
  return dollars < 0 ? `(${text})` : text;
}

/** Dollars and cents, a negative in brackets -- as a return prints. */
function centsSaid(cents: Cents): string {
  const text = (Math.abs(cents) / 100).toLocaleString("en-NZ", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return cents < 0 ? `(${text})` : text;
}

function scheduleTable(
  year: number,
  sections: readonly { title: string; lines: readonly ScheduleRow[]; total: readonly [string, Cents, Cents] }[],
  bottom: readonly [string, Cents, Cents],
): HTMLTableElement {
  const table = document.createElement("table");
  table.className = "report-table rental-schedule";
  const head = document.createElement("thead");
  head.innerHTML = `<tr><th></th><th>${year}</th><th>${year - 1}</th></tr>`;
  const tbody = document.createElement("tbody");
  const row = (cells: readonly string[], className = ""): void => {
    const tr = document.createElement("tr");
    if (className !== "") tr.className = className;
    cells.forEach((text, index) => {
      const td = document.createElement("td");
      td.textContent = text;
      td.className = index === 0 ? "report-name" : "report-amount";
      tr.append(td);
    });
    tbody.append(tr);
  };
  for (const section of sections) {
    row([section.title, "", ""], "bs-section");
    for (const line of section.lines) row([line.name, wholeDollars(line.now), wholeDollars(line.before)]);
    row([section.total[0], wholeDollars(section.total[1]), wholeDollars(section.total[2])], "report-total");
  }
  row([bottom[0], wholeDollars(bottom[1]), wholeDollars(bottom[2])], "bs-grand");
  table.append(head, tbody);
  return table;
}

/**
 * Rental schedules: one per property, then all of them as one statement.
 *
 * Set out as a practitioner's rental summaries are -- whole dollars, last year
 * beside this one, income, expenses and what is left -- so the two can be read
 * side by side a line at a time.
 */
function renderRentalSchedules(body: HTMLElement, year: number): void {
  const built = rentalSchedulesFor(year);
  if (built.length === 0) {
    body.append(
      note(
        "No rental properties yet. On Entities & accounts, give each property an entity of " +
          "kind Residential rental or Commercial rental, with its owners and its accounts.",
      ),
    );
    return;
  }

  for (const { entity, now, before } of built) {
    const heading = document.createElement("h3");
    heading.textContent = `Rental schedule — ${entity.name}`;
    body.append(heading);
    const owners = (entity.owners ?? []).map((o) => `${o.name} ${o.percent}%`).join(", ");
    body.append(
      note(
        `${entity.kind === "residential" ? "Residential" : "Commercial"} rental` +
          (owners !== "" ? `, owned ${owners}` : ", with no owners set") +
          ". " +
          (entity.gstRegistered === false
            ? "Not registered for GST, so the figures include it."
            : "Registered for GST, so the figures exclude it."),
      ),
    );
    body.append(
      scheduleTable(
        year,
        [
          {
            title: "Income",
            lines: pairLines(now.income, before?.income ?? []),
            total: ["Total Income", now.totalIncome, before?.totalIncome ?? 0],
          },
          {
            title: "Expenses",
            lines: pairLines(now.expenses, before?.expenses ?? []),
            total: ["Total Expenses", now.totalExpenses, before?.totalExpenses ?? 0],
          },
        ],
        ["Net Rental Income", now.net, before?.net ?? 0],
      ),
    );
  }

  if (built.length > 1) {
    const heading = document.createElement("h3");
    heading.textContent = "Statement of profit or loss — all rentals";
    body.append(heading);
    const sum = (pick: (s: RentalSchedule) => Cents, prior: boolean): Cents =>
      built.reduce((total, b) => total + (prior ? (b.before ? pick(b.before) : 0) : pick(b.now)), 0);
    const merged = (pick: (s: RentalSchedule) => readonly RentalLine[]): ScheduleRow[] =>
      pairLines(
        built.flatMap((b) => pick(b.now)),
        built.flatMap((b) => (b.before ? pick(b.before) : [])),
      );
    body.append(
      scheduleTable(
        year,
        [
          {
            title: "Trading Income",
            lines: merged((s) => s.income),
            total: ["Total Trading Income", sum((s) => s.totalIncome, false), sum((s) => s.totalIncome, true)],
          },
          {
            title: "Expenses",
            lines: merged((s) => s.expenses),
            total: ["Total Expenses", sum((s) => s.totalExpenses, false), sum((s) => s.totalExpenses, true)],
          },
        ],
        ["Net Profit (Loss) for the Year", sum((s) => s.net, false), sum((s) => s.net, true)],
      ),
    );
  }
}

/** One owner's return for a year, from the books and what was entered for it. */
function ir3For(owner: string, year: number): ReturnType<typeof ir3Return> {
  const shares: OwnerRentalSchedule[] = [];
  for (const { now } of rentalSchedulesFor(year, false)) {
    const share = ownerRentalSchedule(now, owner);
    if (share !== null) shares.push(share);
  }
  const details = (state.ledger.ir3Details ?? []).find((d) => d.owner === owner && d.year === year);
  return ir3Return({
    owner,
    year,
    extras: state.ledger.taxExtras ?? [],
    rentals: shares,
    ...(details?.provisionalTaxPaid !== undefined ? { provisionalTaxPaid: details.provisionalTaxPaid } : {}),
    ...(details?.ietcEligible !== undefined ? { ietcEligible: details.ietcEligible } : {}),
    ...(details?.residentialBroughtForward !== undefined
      ? { residentialBroughtForward: details.residentialBroughtForward }
      : {}),
  });
}

/** One owner's share of one property, under the headings the IR3 schedule uses. */
function ownerScheduleTable(schedule: OwnerRentalSchedule): HTMLElement {
  const wrap = document.createElement("div");
  const title = document.createElement("h4");
  title.textContent = `${schedule.property} — ${schedule.percent}% share`;
  wrap.append(title);
  const table = document.createElement("table");
  table.className = "report-table owner-schedule";
  const tbody = document.createElement("tbody");
  const row = (label: string, amount: Cents | null, className = ""): void => {
    const tr = document.createElement("tr");
    if (className !== "") tr.className = className;
    const name = document.createElement("td");
    name.className = "report-name";
    name.textContent = label;
    const value = document.createElement("td");
    value.className = "report-amount";
    value.textContent = amount === null ? "" : centsSaid(amount);
    tr.append(name, value);
    tbody.append(tr);
  };
  const residential = schedule.residential;
  row("Income", null, "bs-section");
  row(residential ? "Gross residential rental income" : "Total rents", schedule.rents);
  row(residential ? "Other residential income" : "Other income", schedule.otherIncome);
  row("Total income", schedule.totalIncome, "report-total");
  row("Expenses", null, "bs-section");
  for (const heading of schedule.headings) {
    if (heading.heading !== "other") {
      row(heading.heading === "interest" && residential ? "Total interest" : heading.label, heading.amount);
      continue;
    }
    if (schedule.other.length === 0) row("Other", 0);
    for (const item of schedule.other) row(`Other: ${item.name}`, item.amount);
  }
  row("Total expenses", schedule.totalExpenses, "report-total");
  row("Net rents", schedule.netRents, "bs-grand");
  table.append(tbody);
  wrap.append(table);
  return wrap;
}

/**
 * An owner's IR3, box by box, with the schedules behind it.
 *
 * Box numbers are the 2026 form's. The rental figures are this owner's share,
 * line by line, of each property's schedule on the basis the page is set to;
 * everything else is what was entered below.
 */
function renderIr3(body: HTMLElement, owner: string, year: number): void {
  const result = ir3For(owner, year);

  const heading = document.createElement("h3");
  heading.textContent = `${owner} — Individual income tax return (IR3), 1 April ${year - 1} to 31 March ${year}`;
  body.append(heading);
  for (const said of result.notes) body.append(note(said));

  const table = document.createElement("table");
  table.className = "report-table ir10-form";
  const tbody = document.createElement("tbody");
  for (const line of result.boxes) {
    const tr = document.createElement("tr");
    if (line.total === true) tr.classList.add("ir10-total");
    const number = document.createElement("td");
    number.className = "ir10-box";
    number.textContent = line.box;
    const title = document.createElement("td");
    title.textContent = line.title;
    const amount = document.createElement("td");
    amount.className = "report-amount";
    amount.textContent = line.text ?? centsSaid(line.amount ?? 0);
    tr.append(number, title, amount);
    tbody.append(tr);
  }
  table.append(tbody);
  body.append(table);

  if (result.nextYearProvisional !== null) {
    const [first = 0, second = 0, third = 0] = result.instalments;
    body.append(
      note(
        `${year + 1} provisional tax of ${centsSaid(result.nextYearProvisional)} on the standard ` +
          `option -- this year's residual income tax plus 5% -- in instalments of ` +
          `${centsSaid(first)}, ${centsSaid(second)} and ${centsSaid(third)}.`,
      ),
    );
  }
  if (result.refundOrToPay === null && result.residualIncomeTax !== null) {
    body.append(note("Enter the provisional tax paid for the year below to see the refund or the tax to pay."));
  }

  if (result.residential.properties.length > 0) {
    const title = document.createElement("h3");
    title.textContent = "Residential property income schedules";
    body.append(title);
    for (const property of result.residential.properties) body.append(ownerScheduleTable(property));
    if (result.residential.carriedForward > 0) {
      body.append(
        note(
          `Residential deductions of ${centsSaid(result.residential.carriedForward)} are more than ` +
            "the residential income can use. They are ring-fenced and carried forward to next " +
            "year, not set against other income.",
        ),
      );
    }
  }
  if (result.otherRentals.length > 0) {
    const title = document.createElement("h3");
    title.textContent = "Rental income schedules";
    body.append(title);
    for (const property of result.otherRentals) body.append(ownerScheduleTable(property));
  }

  renderIr3Details(body, owner, year);
  renderTaxExtras(body, owner, year);
}

/** The return's facts from outside the books, entered by hand. */
function renderIr3Details(body: HTMLElement, owner: string, year: number): void {
  const heading = document.createElement("h3");
  heading.textContent = "From Inland Revenue and last year's return";
  body.append(heading);
  const details = (state.ledger.ir3Details ?? []).find((d) => d.owner === owner && d.year === year);

  const form = document.createElement("div");
  form.className = "extra-add ir3-details";
  const field = (placeholder: string, value: Cents | undefined, title: string): HTMLInputElement => {
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = placeholder;
    input.title = title;
    input.value = value === undefined ? "" : (value / 100).toFixed(2);
    return input;
  };
  const paid = field(
    "Provisional tax paid",
    details?.provisionalTaxPaid,
    "Provisional tax paid for the year, as the Inland Revenue account shows it -- including anything transferred in.",
  );
  const carried = field(
    "Residential deductions brought forward",
    details?.residentialBroughtForward,
    "Excess residential rental deductions carried forward on last year's return.",
  );
  const ietc = document.createElement("select");
  const chosen = details?.ietcEligible === undefined ? "" : details.ietcEligible ? "yes" : "no";
  for (const [value, caption] of [
    ["", "IETC: assume eligible"],
    ["yes", "IETC: eligible"],
    ["no", "IETC: not eligible"],
  ] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = caption;
    option.selected = value === chosen;
    ietc.append(option);
  }
  ietc.title =
    "The independent earner tax credit is ruled out by New Zealand Super, a main benefit or Working for Families.";

  const save = document.createElement("button");
  save.type = "button";
  save.className = "primary";
  save.textContent = "Save";
  save.addEventListener("click", () => {
    const next: Ir3Details = { owner, year };
    for (const [input, key, what] of [
      [paid, "provisionalTaxPaid", "Provisional tax paid"],
      [carried, "residentialBroughtForward", "Deductions brought forward"],
    ] as const) {
      if (input.value.trim() === "") continue;
      const amount = parseAmount(input.value);
      if (amount === null) {
        alert(`${what} needs to be an amount.`);
        return;
      }
      next[key] = amount;
    }
    if (ietc.value !== "") next.ietcEligible = ietc.value === "yes";
    void saveIr3Details(next);
  });

  form.append(paid, carried, ietc, save);
  body.append(form);
}

async function saveIr3Details(details: Ir3Details): Promise<void> {
  const before = state.ledger.ir3Details ?? [];
  const ir3Details = [
    ...before.filter((d) => !(d.owner === details.owner && d.year === details.year)),
    details,
  ];
  state.ledger = { ...state.ledger, ir3Details };
  state.persistent = await savePart(state.ledger);
  await record("ir3Details", `${details.owner} FY${details.year}: details for the IR3`, before, ir3Details);
  redraw("reports");
}

function csvOf(rows: readonly (readonly string[])[]): string {
  return (
    rows
      .map((row) => row.map((cell) => (/[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(","))
      .join("\r\n") + "\r\n"
  );
}

function rentalSchedulesCsv(year: number): string {
  const dollars = (cents: Cents): string => (cents / 100).toFixed(2);
  const rows: string[][] = [[`Rental schedules, FY${year}`], []];
  for (const { entity, now, before } of rentalSchedulesFor(year)) {
    rows.push([entity.name, String(year), String(year - 1)]);
    rows.push(["Income"]);
    for (const line of pairLines(now.income, before?.income ?? [])) {
      rows.push([line.name, dollars(line.now), dollars(line.before)]);
    }
    rows.push(["Total Income", dollars(now.totalIncome), dollars(before?.totalIncome ?? 0)]);
    rows.push(["Expenses"]);
    for (const line of pairLines(now.expenses, before?.expenses ?? [])) {
      rows.push([line.name, dollars(line.now), dollars(line.before)]);
    }
    rows.push(["Total Expenses", dollars(now.totalExpenses), dollars(before?.totalExpenses ?? 0)]);
    rows.push(["Net Rental Income", dollars(now.net), dollars(before?.net ?? 0)]);
    rows.push([]);
  }
  return csvOf(rows);
}

function ir3Csv(owner: string, year: number): string {
  const result = ir3For(owner, year);
  const rows: string[][] = [[`${owner} — IR3, FY${year}`], ["Box", "Description", "Amount"]];
  for (const box of result.boxes) {
    rows.push([box.box, box.title, box.text ?? ((box.amount ?? 0) / 100).toFixed(2)]);
  }
  for (const said of result.notes) rows.push(["", said, ""]);
  return csvOf(rows);
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
      [
        extra.imputation
          ? `${money(extra.credits)} + ${money(extra.imputation)} imputation`
          : money(extra.credits),
        "report-amount",
      ],
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
  credits.placeholder = "Tax credits (PAYE, RWT, PIE tax)";
  // Only a dividend carries two kinds of credit, and the return keeps them
  // apart: RWT is tax paid, imputation is company tax that only reduces tax owed.
  const imputation = document.createElement("input");
  imputation.type = "text";
  imputation.placeholder = "Imputation credits";
  imputation.hidden = category.value !== "dividends";
  category.addEventListener("change", () => {
    imputation.hidden = category.value !== "dividends";
  });

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
      ...(category.value === "dividends" && parseAmount(imputation.value) !== null
        ? { imputation: parseAmount(imputation.value) as number }
        : {}),
    });
  });

  form.append(category, payer, gross, credits, imputation, add);
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
  redraw("reports");
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
  redraw("reports");
}

/**
 * What the figures on screen were actually built from.
 *
 * The page had one fixed sentence describing the cash basis, shown whichever
 * basis was chosen -- so on both accrual reports it described something else.
 * Three sources, three different things worth knowing about them.
 */
const FAVOURITES_KEY = "nzosa:report-favourites";
const DEFAULT_FAVOURITES = ["pl", "balancesheet", "ir10"];

/** What each report is for, in a line, for the list of reports. */
const REPORT_DESCRIPTIONS: Record<string, string> = {
  pl: "Income and expenses for the year, set out as an accountant reads them.",
  balancesheet: "What the business owns and owes at year end.",
  depreciation: "Each asset's depreciation for the year, and its book value.",
  shareholders: "What each shareholder has put in and taken out.",
  ir10: "Inland Revenue's financial statement, box by box, as it is filed.",
  gstreturn: "A GST return for any period, box by box, with the transactions behind every box.",
  rentals: "Each rental property's income and expenses, and all of them together.",
  ir3: "One owner's individual return: their rental schedules, other income and the tax.",
  agents: "What each property manager collected and paid out, posted and checked against the bank.",
  journal: "Every posting for the year, and the trial balance they prove.",
  general: "Every line in the ledger, account by account.",
  manual: "Year-end and correcting journals written by hand.",
  extract: "The transactions behind an account, ready to export.",
  owner: "Income and expenses by owner, for property held jointly.",
  charts: "The year's income and spending, month by month.",
};

/** The reports this viewer has starred, kept in the browser rather than the books. */
function readFavourites(): string[] {
  try {
    const held = localStorage.getItem(FAVOURITES_KEY);
    const parsed: unknown = held === null ? DEFAULT_FAVOURITES : JSON.parse(held);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [...DEFAULT_FAVOURITES];
  } catch {
    return [...DEFAULT_FAVOURITES];
  }
}

function writeFavourites(list: readonly string[]): void {
  try {
    localStorage.setItem(FAVOURITES_KEY, JSON.stringify(list));
  } catch {
    // Nothing to do: without storage the stars simply are not remembered.
  }
}

interface ReportEntry {
  value: string;
  name: string;
}

/**
 * Every report, grouped the way an accounting package groups them, with the
 * ones used most at the top.
 *
 * One long list stopped being findable once it passed a handful of reports.
 * The groups are read from the report picker itself, so the list and the
 * picker cannot disagree about what exists or what it is called.
 */
function renderReportsHome(body: HTMLElement): void {
  const select = $<HTMLSelectElement>("report-kind");
  const groups = [...select.querySelectorAll("optgroup")].map((group) => ({
    label: group.label,
    reports: [...group.querySelectorAll("option")].map(
      (option): ReportEntry => ({ value: option.value, name: option.textContent ?? option.value }),
    ),
  }));
  const all = groups.flatMap((group) => group.reports);
  const favourites = readFavourites().filter((value) => all.some((r) => r.value === value));

  const txYears = state.ledger.transactions.map((t) => financialYearOf(t.date));
  const journalYears = (state.ledger.journals ?? []).map((j) => financialYearOf(j.date));
  const allYears = [...new Set([...txYears, ...journalYears])].sort((a, b) => b - a);
  const years = allYears.length > 0 ? allYears : [new Date().getFullYear()];

  const open = (value: string): void => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const item = (report: ReportEntry): HTMLElement => {
    const row = document.createElement("div");
    row.className = "reports-home-item";
    const starred = favourites.includes(report.value);
    const star = document.createElement("button");
    star.type = "button";
    star.className = "link-button reports-star";
    star.textContent = starred ? "★" : "☆";
    star.title = starred ? "Remove from favourites" : "Add to favourites";
    star.setAttribute("aria-pressed", String(starred));
    star.addEventListener("click", () => {
      writeFavourites(
        starred ? favourites.filter((value) => value !== report.value) : [...favourites, report.value],
      );
      redraw("reports");
    });
    const link = document.createElement("button");
    link.type = "button";
    link.className = "link-button reports-open";
    link.textContent = report.name;
    link.addEventListener("click", () => open(report.value));
    const about = document.createElement("span");
    about.className = "reports-about";
    about.textContent = REPORT_DESCRIPTIONS[report.value] ?? "";
    row.append(star, link, about);
    return row;
  };

  const section = (title: string, rows: readonly HTMLElement[]): void => {
    if (rows.length === 0) return;
    const group = document.createElement("div");
    group.className = "reports-home-group";
    const heading = document.createElement("h3");
    heading.textContent = title;
    const list = document.createElement("div");
    list.className = "reports-home-list";
    list.append(...rows);
    group.append(heading, list);
    body.append(group);
  };

  section(
    "Favourites",
    favourites
      .map((value) => all.find((report) => report.value === value))
      .filter((report): report is ReportEntry => report !== undefined)
      .map(item),
  );

  // Reports that are pages of their own, because they are also where the work
  // is done. They belong in this list all the same: this is where somebody looks
  // for a report, and a report that can only be found from the menu is one they
  // do not know exists.
  const elsewhere: readonly { group: string; name: string; page: string; about: string }[] = [
    {
      group: "Financial statements",
      name: "Fixed asset register",
      page: "assets",
      about: "Every asset with this year's depreciation and book value, and what was disposed of.",
    },
    {
      group: "Taxes and balances",
      name: "GST reconciliation",
      page: "gst",
      about: "Each filed GST return beside what the books say now, with the lines behind any difference.",
    },
    {
      group: "Taxes and balances",
      name: "Opening balances by year",
      page: "opening",
      about: "What every account stood at at each year end, and the position the books open from.",
    },
    {
      group: "Transactions",
      name: "Invoices",
      page: "invoices",
      about: "Invoices raised, what has been paid and what is still owed.",
    },
    {
      group: "Transactions",
      name: "Bank balance check",
      page: "import",
      about: "The bank's own balances against the transactions, proving nothing is missing. On Bank import.",
    },
    {
      group: "Checks and history",
      name: "Coding reconciliation",
      page: "check",
      about: "Your coding beside your previous system's, line by line.",
    },
    {
      group: "Checks and history",
      name: "History",
      page: "history",
      about: "Every change to the books, who made it and when, with undo.",
    },
  ];
  const pageItem = (entry: (typeof elsewhere)[number]): HTMLElement => {
    const row = document.createElement("div");
    row.className = "reports-home-item";
    const spacer = document.createElement("span");
    const link = document.createElement("button");
    link.type = "button";
    link.className = "link-button reports-open";
    link.textContent = entry.name;
    link.title = "Opens its own page";
    link.addEventListener("click", () => showPage(entry.page));
    const about = document.createElement("span");
    about.className = "reports-about";
    about.textContent = entry.about;
    row.append(spacer, link, about);
    return row;
  };

  /**
   * Everything at once, for a spreadsheet.
   *
   * Not a report to read on screen: every report and every underlying table in
   * one workbook, which is what an accountant asks for when they would rather
   * work in Excel than click through a year. It sits at the end, under the
   * checks, because that is where the whole-file outputs belong.
   */
  const excelExtractItem = (): HTMLElement => {
    const row = document.createElement("div");
    row.className = "reports-home-item";
    const spacer = document.createElement("span");

    const name = document.createElement("span");
    name.className = "reports-open";
    name.textContent = "Excel detailed extract";

    const about = document.createElement("span");
    about.className = "reports-about";
    about.textContent =
      "One workbook: the general ledger, bank coding, revenue and expenses, unusual " +
      "transactions, the depreciation schedule, trial balance and GST returns, and behind " +
      "them every table these books are made of.";

    const controls = document.createElement("div");
    controls.className = "excel-extract-controls";

    const yearSelect = document.createElement("select");
    yearSelect.id = "excel-export-year-select";
    yearSelect.setAttribute("aria-label", "Which year to put in the workbook");
    const allOpt = document.createElement("option");
    allOpt.value = "all";
    allOpt.textContent = "Every year";
    yearSelect.append(allOpt);
    for (const y of years) {
      const opt = document.createElement("option");
      opt.value = String(y);
      opt.textContent = `FY${y} (year to 31 Mar ${y})`;
      yearSelect.append(opt);
    }

    const exportBtn = document.createElement("button");
    exportBtn.type = "button";
    exportBtn.textContent = "Download (.xlsx)";
    exportBtn.addEventListener("click", () => {
      downloadExcelReport(yearSelect.value === "all" ? "all" : Number(yearSelect.value));
    });

    controls.append(yearSelect, exportBtn);
    about.append(controls);
    row.append(spacer, name, about);
    return row;
  };

  const placed = new Set<string>();
  for (const group of groups) {
    const rows = group.reports.map(item);
    for (const entry of elsewhere.filter((e) => e.group === group.label)) {
      rows.push(pageItem(entry));
      placed.add(entry.name);
    }
    section(group.label, rows);
  }
  // Groups the report picker has no reports in, listed after the rest.
  for (const label of [...new Set(elsewhere.filter((e) => !placed.has(e.name)).map((e) => e.group))]) {
    const rows = elsewhere.filter((e) => e.group === label && !placed.has(e.name)).map(pageItem);
    if (label === "Checks and history") rows.push(excelExtractItem());
    section(label, rows);
  }
}

function reportsHint(basis: string, kind: string): string {
  if (kind === "gstreturn") {
    return (
      "Built from your coding on the payments basis, the same way the GST reconciliation " +
      "compares with a filed return. Choose a period; click a box for the lines behind it."
    );
  }
  if (kind === "rentals") {
    return (
      "Each property's own schedule, from the accounts given to it on Entities & accounts, " +
      "with last year beside it. A rental registered for GST is shown net of GST; one that " +
      "is not includes it, because it cannot claim it back."
    );
  }
  if (kind === "agents") {
    return (
      "A property manager passes on the rent less what they paid out of it, so the bank shows " +
      "neither the rent nor the fees. Each statement entered here posts both."
    );
  }
  if (kind === "ir3") {
    return (
      "One owner's return. Their share of each rental comes from the books; salary, " +
      "interest, dividends and PIE income are entered below, from the income summary " +
      "and the certificates."
    );
  }
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
  if (kind === "balancesheet" && basis === "cash") {
    return (
      "A balance sheet has no cash basis: it is what the business owns and owes " +
      "on the day. So on this basis it is built from your postings, as it is on " +
      "the postings basis."
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

export function renderReportsPage(): void {
  const body = $("reports-body");
  body.textContent = "";

  // The list of every report, before any one is chosen. The controls belong to
  // a report, so they wait for one.
  const kindSelect = $<HTMLSelectElement>("report-kind");
  const home = kindSelect.value === "home";
  kindSelect.parentElement?.classList.toggle("reports-home", home);
  if (home) {
    $("reports-hint").textContent =
      "Choose a report. Star the ones you use most and they stay at the top.";
    renderReportsHome(body);
    return;
  }

  // The way back to the list, where it can be seen. It was the first entry of
  // the report picker and nowhere else, and choosing Reports in the menu keeps
  // the report that was open -- so once a report was chosen, the list of them
  // looked as though it had gone.
  const back = document.createElement("button");
  back.type = "button";
  back.className = "reports-back";
  back.textContent = "← All reports";
  back.addEventListener("click", () => {
    kindSelect.value = "home";
    redraw("reports");
  });
  body.append(back);

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
  ownerSelect.hidden = kind !== "owner" && kind !== "ir3";

  const chosenYearNow = Number($<HTMLSelectElement>("report-year").value) || years[0];

  if (kind === "balancesheet") {
    ownerSelect.hidden = true;
    if (chosenYearNow !== undefined) renderBalanceSheet(body, chosenYearNow);
    return;
  }

  if (kind === "gstreturn") {
    ownerSelect.hidden = true;
    if (chosenYearNow !== undefined) renderGstReturn(body, chosenYearNow);
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

  if (kind === "rentals") {
    ownerSelect.hidden = true;
    if (chosenYearNow !== undefined) renderRentalSchedules(body, chosenYearNow);
    return;
  }

  if (kind === "agents") {
    ownerSelect.hidden = true;
    if (chosenYearNow !== undefined) renderAgentStatements(body, chosenYearNow);
    return;
  }

  if (kind === "ir3") {
    if (owners.length === 0) {
      body.append(
        note(
          "No owners set. On Entities & accounts, give each rental its owners — " +
            "for example “Ana Whitcombe 50%; Tom Whitcombe 50%”.",
        ),
      );
      return;
    }
    const owner = ownerSelect.value || owners[0];
    if (owner !== undefined && chosenYearNow !== undefined) renderIr3(body, owner, chosenYearNow);
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

  const addRow = (
    label: string,
    value: string,
    cls = "",
    count = "",
    line?: ReportLine,
  ): void => {
    const tr = document.createElement("tr");
    if (cls !== "") tr.className = cls;
    const name = document.createElement("td");
    name.className = "report-name";
    const n = document.createElement("td");
    n.textContent = count;
    n.className = "report-count";
    const amount = document.createElement("td");
    amount.textContent = value;
    amount.className = "report-amount";

    // A figure is only checkable if you can see what is in it. The account
    // lines open; the section headings and totals have nothing of their own
    // behind them, so they stay plain rather than offering an empty panel.
    if (line !== undefined && line.transactionIds.length > 0) {
      const open = document.createElement("button");
      open.type = "button";
      open.className = "link-button";
      open.textContent = label;
      open.title = `Show the ${line.transactionIds.length} entries behind this figure`;
      let shown: HTMLTableRowElement | null = null;
      open.addEventListener("click", () => {
        if (shown) {
          shown.remove();
          shown = null;
          tr.classList.remove("report-open");
          return;
        }
        shown = behindRow(line, money, line.net === line.gross && line.gst !== 0);
        tr.classList.add("report-open");
        tr.after(shown);
      });
      name.append(open);
    } else {
      name.textContent = label;
    }

    tr.append(name, n, amount);
    tbody.append(tr);
  };

  // Set out the way an accountant reads one: trading income less the cost of
  // sales is the gross profit, and other income is kept apart so it cannot
  // flatter it. The grouping is a partition of the same lines, so the net
  // profit below is the report's own.
  const grouped = groupProfitAndLoss(report, reportLookups().classOf);
  const showGroup = (group: PlGroup, income: boolean): void => {
    if (group.lines.length === 0) return;
    addRow(group.title, "", "report-section");
    for (const line of group.lines) {
      addRow(line.code, money(income ? line.net : -line.net), "", String(line.count), line);
    }
    addRow(`Total ${group.title}`, money(group.total), "report-total");
  };

  showGroup(grouped.trading, true);
  showGroup(grouped.costOfSales, false);
  addRow("Gross Profit", money(grouped.grossProfit), "report-total");
  showGroup(grouped.otherIncome, true);
  showGroup(grouped.operatingExpenses, false);
  addRow("Net Profit", money(grouped.netProfit), "report-net");
  table.append(tbody);
  body.append(table);

  if (report.unclassified.length > 0) {
    const h = document.createElement("h3");
    h.textContent = `Not in the profit figure (${report.unclassified.length})`;
    body.append(h);
    body.append(
      note(
        "Accounts that belong on the balance sheet, not the profit: each figure is the year's " +
          "movement on it, and the second column says what it is. One reading \"No account type " +
          "set\" can be given a type on Entities & accounts, and moves onto the report if it is " +
          "income or an expense.",
      ),
    );
    const other = document.createElement("table");
    other.className = "report-table";
    const otherBody = document.createElement("tbody");
    const roleOf = lineRoles();
    for (const line of report.unclassified) {
      const tr = document.createElement("tr");
      const name = document.createElement("td");
      name.textContent = line.code;
      name.className = "report-name";
      const role = document.createElement("td");
      role.textContent = roleOf(line.code);
      role.className = "report-name";
      const n = document.createElement("td");
      n.textContent = String(line.count);
      n.className = "report-count";
      const amount = document.createElement("td");
      amount.textContent = money(line.net);
      amount.className = "report-amount";
      tr.append(name, role, n, amount);
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

export function downloadReport(): void {
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

  if ($<HTMLSelectElement>("report-kind").value === "gstreturn") {
    if (year === undefined) return;
    const chosen = chosenGstReturn(year);
    if (chosen === undefined) return;
    download(
      formatGstReturn(chosen, `${reportingEntity()?.name ?? "GST"} — GST return`),
      `gst-return-${chosen.period.to}.csv`,
      "text/csv",
    );
    return;
  }

  if ($<HTMLSelectElement>("report-kind").value === "rentals") {
    if (year === undefined) return;
    download(rentalSchedulesCsv(year), `rental-schedules-fy${year}.csv`, "text/csv");
    return;
  }

  if ($<HTMLSelectElement>("report-kind").value === "ir3") {
    const owner = $<HTMLSelectElement>("report-owner").value;
    if (owner === "" || year === undefined) return;
    download(
      ir3Csv(owner, year),
      `ir3-${owner.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-fy${year}.csv`,
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
      reportLookups().classOf,
      lineRoles(),
    ),
    `profit-and-loss-${built.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-fy${built.year}.csv`,
    "text/csv",
  );
}

/** The five choices that decide which report is shown, and downloading it. */
export function wireReports(): void {

  $("report-basis").addEventListener("change", () => redraw("reports"));
  $("report-gst").addEventListener("change", () => redraw("reports"));

  $("report-kind").addEventListener("change", () => redraw("reports"));
  $("report-owner").addEventListener("change", () => redraw("reports"));
  $("report-year").addEventListener("change", () => redraw("reports"));
  $("report-download").addEventListener("click", () => downloadReport());
  $("report-download-excel").addEventListener("click", () => downloadExcelReport());
}

/**
 * The entries behind one line of a report.
 *
 * A total nobody can look inside is a total nobody can check, and "where does
 * 18,342.72 of sales come from" is the first question anyone asks of a set of
 * accounts. The bank lines are the report's own -- it carries the ids it
 * counted -- so what is listed always adds up to the figure it opened from,
 * which a second query over the same arguments could not promise.
 *
 * A row that is not a bank line is shown by its id rather than dropped: on the
 * accrual basis a figure can come from a year-end journal, and a report that
 * silently listed fewer entries than it counted would be worse than one that
 * admits what it cannot name.
 */
function behindRow(
  line: ReportLine,
  money: (cents: number) => string,
  grossBasis: boolean,
): HTMLTableRowElement {
  const row = document.createElement("tr");
  row.className = "report-behind";
  const cell = document.createElement("td");
  cell.colSpan = 3;

  const byId = new Map(state.ledger.transactions.map((t) => [t.id, t]));
  const engine = reportEngine();
  const table = document.createElement("table");
  table.className = "report-table match-table";
  const head = document.createElement("thead");
  // Gross, GST and net, because the figure on the report is the net and the
  // figure on the statement is the gross. Showing only one of them invites the
  // question this panel exists to answer.
  head.innerHTML =
    "<tr><th>Date</th><th>Account</th><th>Who</th><th>Reference</th>" +
    "<th>Gross</th><th>GST</th><th>Net</th></tr>";
  const tbody = document.createElement("tbody");

  // On an accrual basis most of a sales figure comes from invoices, which post
  // as journals and have no bank line at all. Listing only what could be found
  // in the statements showed a handful of receipts under a figure built mostly
  // from invoices, and said the rest was "from a journal" without saying which
  // -- so the answer to "where does this come from" was still missing exactly
  // the part being asked about.
  const journals = new Map<string, Journal>();
  for (const journal of state.ledger.journals ?? []) journals.set(String(journal.id), journal);
  const posted = new Map<string, PostedJournal>();
  for (const journal of postedJournals()) posted.set(journal.transactionId, journal);
  const labelOf = reportLabeller();

  // One row per entry, not per posting. A report line records the id it
  // counted once for each line of a journal that reaches this account, so an
  // invoice with two sales lines names itself twice -- and a row built per id
  // that sums the whole journal each time shows the invoice twice at its full
  // value. The figure was right; the list was not.
  const entries = [...new Set(line.transactionIds)];

  let shown = 0;
  let unnamed = 0;
  for (const id of entries) {
    const transaction = byId.get(id);
    if (transaction === undefined) {
      const fromJournal = journalRow(id, line.code, journals, posted, labelOf, money);
      if (fromJournal === null) {
        unnamed += 1;
        continue;
      }
      shown += 1;
      tbody.append(fromJournal);
      continue;
    }
    shown += 1;
    const gst = engine ? gstWithin(transaction.amount, engine.classify(transaction)) : 0;
    const tr = document.createElement("tr");
    tr.append(nameCell(transaction.date));
    tr.append(nameCell(bankLabel(transaction.account)));
    tr.append(nameCell(transaction.otherParty || transaction.particulars || ""));
    tr.append(nameCell(transaction.reference ?? ""));
    tr.append(amountCell(money(transaction.amount)));
    tr.append(amountCell(gst === 0 ? "" : money(gst)));
    tr.append(amountCell(money(grossBasis ? transaction.amount : transaction.amount - gst)));
    tbody.append(tr);
  }

  // The report's own totals, so the panel cannot disagree with the line it
  // opened from. Signed as the bank moved it: an expense is money out here and
  // is shown positive on the report above, which is what a profit and loss
  // does to expenses.
  const total = document.createElement("tr");
  total.className = "report-total";
  total.append(nameCell(`${shown} entr${shown === 1 ? "y" : "ies"}`));
  total.append(nameCell(""));
  total.append(nameCell(""));
  total.append(nameCell(""));
  total.append(amountCell(money(line.gross)));
  total.append(amountCell(line.gst === 0 ? "" : money(line.gst)));
  total.append(amountCell(money(line.net)));
  tbody.append(total);

  table.append(head, tbody);
  if (unnamed > 0) {
    cell.append(
      note(
        `${unnamed} entr${unnamed === 1 ? "y" : "ies"} could not be named — neither a bank ` +
          "line nor a journal this ledger still holds. Loading the journal report again " +
          "usually settles it.",
      ),
    );
  }
  cell.append(table);
  row.append(cell);
  return row;
}

/**
 * One row for a figure that came from a journal rather than a statement.
 *
 * An invoice, a year-end adjustment, depreciation: real entries with real
 * amounts and no bank line behind them. The amount shown is this journal's
 * contribution to *this* report line rather than its total, because a journal
 * touches several accounts and only one of them is the figure that was opened.
 */
function journalRow(
  id: string,
  code: string,
  journals: Map<string, Journal>,
  posted: Map<string, PostedJournal>,
  labelOf: (line: { accountCode: string; accountName: string }) => string,
  money: (cents: number) => string,
): HTMLTableRowElement | null {
  const imported = journals.get(id);
  const ours = posted.get(id);
  const source = imported ?? ours;
  if (source === undefined) return null;

  // A ledger credits income and debits expenses; the report reads the other
  // way round, which is the same flip `accrualProfitAndLoss` makes.
  let net = 0;
  for (const entry of source.lines) {
    if (labelOf(entry) !== code) continue;
    net += -entry.amount;
  }

  const row = document.createElement("tr");
  row.append(nameCell(source.date));
  row.append(nameCell(imported ? `journal ${id}` : "posted"));
  row.append(nameCell(source.narration || ""));
  row.append(nameCell(""));
  row.append(amountCell(""));
  row.append(amountCell(""));
  row.append(amountCell(money(net)));
  return row;
}