import { redraw } from "../app.js";
import {
  accountsFor,
  accountsForEditing,
  bankLabel,
  banks,
  entityBankAccounts,
  postedJournals,
  record,
  reportEngine,
  saveManualJournals,
} from "../books.js";
import { monthlyColumns, rankedBars, statTiles } from "../charts.js";
import { knownCodes } from "../reconcile.js";
import { $, state } from "../state.js";
import { savePart } from "../store.js";
import { amountCell, download, nameCell, note } from "../ui.js";
import { unresolvedNote } from "../widgets.js";
import {
  TAX_EXTRA_CATEGORIES,
  accountTransactionRows,
  accrualProfitAndLoss,
  checkManualJournal,
  computeBalanceSheet,
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
  ir10IsCalculated,
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
  BalanceSheetLine,
  Cents,
  DateRange,
  Entity,
  IsoDate,
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
} {
  return coreReportLookups({
    model: state.ledger.entities ?? emptyEntityModel(),
    accounts: accountsForEditing(),
  });
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