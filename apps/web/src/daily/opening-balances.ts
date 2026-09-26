import { redraw, showPage } from "../app.js";
import { feedStatus } from "../feed-route.js";
import { accountsForEditing, bankLabel, ledgerAccountFor, postedJournals, record } from "../books.js";
import { combobox } from "../combobox.js";
import { $, state } from "../state.js";
import { savePart } from "../store.js";
import { chosenStartDate, startOfFinancialYear } from "../migrate/onboarding-state.js";
import { amountCell, nameCell, note } from "../ui.js";
import { accountEntityKey, emptyEntityModel, financialYearBalances, financialYearOf, parseAmount } from "@nzosa/core";
import type { Account, Cents, FinancialYearBalances, IsoDate, OpeningBalances } from "@nzosa/core";
import { asCsvText } from "../books.js";
import { dayAfter, formatAmount, openingBalancesFrom, parseTrialBalance } from "@nzosa/core";
import type { BalanceCheck } from "@nzosa/core";

/**
 * Where each year started.
 *
 * A set of books that begins part way through its life has a position before
 * the first transaction, and nothing in the bank data can say what it was.
 * Without it every balance sheet is wrong by the same amount for ever, and the
 * error is invisible because the books still balance against themselves.
 *
 * Held per financial year rather than once, because a year's opening position
 * is the previous year's close and reading it back is how a prior year is
 * checked. Entered by hand or taken from a trial balance; either way it is a
 * stated figure, and the reports say so rather than implying it was derived.
 */

/**
 * Returns account balances for each financial year.
 *
 * Sources include:
 * 1. Imported multi-year trial balance columns preserved in `held.byDate`.
 * 2. Active opening balances in `held.accounts`.
 * 3. Subsequent financial years rolled forward from transactions and journals via `computeBalanceSheet`.
 */
function balancesByFinancialYear(): FinancialYearBalances[] {
  // The arithmetic is in core, where it is tested. This says only which parts
  // of the app's state answer its questions -- and asks for the journals once
  // rather than rebuilding them inside the loop, a year at a time.
  return financialYearBalances({
    ...(state.ledger.openingBalances ? { openingBalances: state.ledger.openingBalances } : {}),
    transactions: state.ledger.transactions,
    chart: state.chart,
    journals: postedJournals(),
  });
}

export function renderOpeningBalances(): void {
  const body = $("opening-body");
  body.textContent = "";
  if (openingDraft !== null) body.append(openingEditor(openingDraft));

  const yearSelect = $<HTMLSelectElement>("opening-year");
  const held = state.ledger.openingBalances;

  // Say which of the two things is on this page, because they look identical
  // and mean opposite things. Everything below can be worked out from the bank
  // data -- where each account had got to by each year end -- and that is a
  // movement since the first statement, not a position. An opening balance is
  // the part no statement contains, and until a trial balance is loaded there
  // is not one, however full the table looks.
  const status = document.createElement("p");
  if (held === undefined) {
    status.className = "journal-out";
    status.textContent =
      "No opening balances loaded; the figures below show only movement since your first " +
      "statement. Load a trial balance at your previous year end.";
  } else {
    status.className = "journal-balanced";
    const count = Object.keys(held.accounts).length;
    status.textContent =
      `${count} opening balance${count === 1 ? "" : "s"} loaded as at ${held.asAt}` +
      (held.source ? `, from ${held.source}` : "") +
      ". The figures below start from these.";
  }
  body.append(status);

  // Checking the bank's balance at other dates is a different job, on another
  // page; said here because this is where somebody looks for it first.
  const elsewhere = document.createElement("p");
  elsewhere.className = "page-hint";
  elsewhere.append("To check the bank's own balance at other dates, use ");
  const toImport = document.createElement("button");
  toImport.type = "button";
  toImport.className = "link-button";
  toImport.textContent = "Bank import → Import bank balances";
  toImport.addEventListener("click", () => {
    showPage("import");
    requestAnimationFrame(() => document.getElementById("import-balances")?.scrollIntoView({ block: "start" }));
  });
  elsewhere.append(toImport, ". It compares them with your transactions and changes nothing.");
  body.append(elsewhere);

  if (bankDraft !== null) body.append(bankBalancesForm(bankDraft));

  if (held !== undefined) body.append(enteredBalances(held));

  const money = (cents: Cents): string =>
    (cents / 100).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const formatAccounting = (cents: Cents): string => {
    if (cents === 0) return "—";
    const val = Math.abs(cents) / 100;
    const formatted = val.toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return cents < 0 ? `(${formatted})` : formatted;
  };

  const add = document.createElement("button");
  add.type = "button";
  add.className = "link-button";
  add.textContent = "add an account";
  add.addEventListener("click", () => openingRow("", 0));

  const years = balancesByFinancialYear();
  const [firstYear] = years;
  const lastYear = years[years.length - 1];

  if (firstYear === undefined || lastYear === undefined) {
    yearSelect.style.display = "none";
    body.append(
      note(
        "None set. Not needed if these books start when the business started.",
      ),
    );
    body.append(add);
    return;
  }

  // Populate year selector
  yearSelect.style.display = "";
  yearSelect.textContent = "";

  const allOpt = document.createElement("option");
  allOpt.value = "all";
  allOpt.textContent = "All financial years";
  yearSelect.append(allOpt);

  const descYears = [...years].sort((a, b) => b.year - a.year);
  for (const y of descYears) {
    const opt = document.createElement("option");
    opt.value = String(y.year);
    opt.textContent = `FY${y.year} (as at 31 Mar ${y.year})`;
    yearSelect.append(opt);
  }

  // What follows is worked out, not entered: each year's closing balances,
  // which are also the next year's opening ones. Said, because a table of
  // balances on a page called Opening balances reads as the ones entered.
  const worked = document.createElement("h3");
  worked.textContent = "Year-end balances (worked out from the books)";
  body.append(worked);
  body.append(
    note(
      "Each financial year's closing balances, from the opening balances above and every " +
        "transaction and journal since. Choose a year at the top to see one on its own.",
    ),
  );

  if (!years.some((y) => String(y.year) === state.openingYear) && state.openingYear !== "all") {
    state.openingYear = years.length > 1 ? "all" : String(firstYear.year);
  }
  yearSelect.value = state.openingYear;

  const byCode = new Map(state.chart.map((a) => [a.code, a]));
  const labels = new Map<string, string>();
  for (const transaction of state.ledger.transactions) {
    const label = String(transaction.extras?.["accountLabel"] ?? "").trim();
    if (label !== "") labels.set(transaction.account, label);
  }

  if (state.openingYear === "all") {
    // Multi-year comparison view
    const outOfBalance = years.filter((y) => {
      const sum = Object.values(y.accounts).reduce((s, c) => s + c, 0);
      return sum !== 0;
    });

    const summary = document.createElement("p");
    if (outOfBalance.length === 0) {
      summary.className = "journal-balanced";
      summary.textContent = `Balanced across all ${years.length} financial years. Debits equal credits for each year.`;
    } else {
      summary.className = "journal-out";
      summary.textContent = `Out of balance in ${outOfBalance.map((y) => `FY${y.year}`).join(", ")}. Debits must equal credits.`;
    }
    body.append(summary);

    if (held?.source) body.append(note(held.source));

    const codeSet = new Set<string>();
    for (const y of years) {
      for (const [code, cents] of Object.entries(y.accounts)) {
        if (cents !== 0) codeSet.add(code);
      }
    }
    const allCodes = [...codeSet].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    const table = document.createElement("table");
    table.className = "report-table opening-table multi-year";

    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");

    const thAccount = document.createElement("th");
    thAccount.textContent = "Account";
    headRow.append(thAccount);

    const thType = document.createElement("th");
    thType.textContent = "Type";
    headRow.append(thType);

    for (const y of years) {
      const th = document.createElement("th");
      th.innerHTML = `FY${y.year}<span class="opening-col-sub">31 Mar ${y.year}</span>`;
      headRow.append(th);
    }
    thead.append(headRow);

    const tbody = document.createElement("tbody");
    for (const code of allCodes) {
      const row = document.createElement("tr");
      const account = byCode.get(code);
      const bank = labels.get(code);
      row.append(nameCell(account ? `${code} ${account.name}` : (bank ?? code)));

      const tdType = document.createElement("td");
      tdType.className = "type-cell";
      tdType.textContent = account?.type ?? (labels.has(code) ? "Bank" : "—");
      row.append(tdType);

      for (const y of years) {
        const cents = y.accounts[code] ?? 0;
        const td = document.createElement("td");
        td.className = "amount";
        if (cents < 0) td.classList.add("credit-val");
        td.textContent = formatAccounting(cents);
        row.append(td);
      }
      tbody.append(row);
    }

    const tfoot = document.createElement("tfoot");

    const debitsRow = document.createElement("tr");
    debitsRow.className = "bs-total";
    debitsRow.append(nameCell("Total Debits"));
    debitsRow.append(document.createElement("td"));
    for (const y of years) {
      const debits = Object.values(y.accounts).reduce((s, c) => s + (c > 0 ? c : 0), 0);
      const td = document.createElement("td");
      td.className = "amount";
      td.textContent = money(debits);
      debitsRow.append(td);
    }
    tfoot.append(debitsRow);

    const creditsRow = document.createElement("tr");
    creditsRow.className = "bs-total";
    creditsRow.append(nameCell("Total Credits"));
    creditsRow.append(document.createElement("td"));
    for (const y of years) {
      const credits = Object.values(y.accounts).reduce((s, c) => s + (c < 0 ? -c : 0), 0);
      const td = document.createElement("td");
      td.className = "amount";
      td.textContent = money(credits);
      creditsRow.append(td);
    }
    tfoot.append(creditsRow);

    const diffRow = document.createElement("tr");
    diffRow.className = "bs-grand";
    diffRow.append(nameCell("Difference"));
    diffRow.append(document.createElement("td"));
    for (const y of years) {
      const sum = Object.values(y.accounts).reduce((s, c) => s + c, 0);
      const td = document.createElement("td");
      td.className = "amount";
      if (sum === 0) {
        td.classList.add("diff-ok");
        td.textContent = "✓ Balanced";
      } else {
        td.classList.add("diff-bad");
        td.textContent = `Out: ${money(sum)}`;
      }
      diffRow.append(td);
    }
    tfoot.append(diffRow);

    table.append(thead, tbody, tfoot);
    body.append(table);
    body.append(add);
  } else {
    // Single financial year view
    const selected = years.find((y) => String(y.year) === state.openingYear) ?? lastYear;
    const entries = Object.entries(selected.accounts).sort(([a], [b]) => a.localeCompare(b));
    const total = entries.reduce((sum, [, cents]) => sum + cents, 0);

    const summary = document.createElement("p");
    summary.className = total === 0 ? "journal-balanced" : "journal-out";
    summary.textContent =
      total === 0
        ? `Balanced. ${entries.length} accounts as at ${selected.asAt}, debits equal credits.`
        : `Out of balance by ${money(total)}. Debits must equal credits, or every report ` +
          "carries the difference.";
    body.append(summary);

    if (selected.source) body.append(note(selected.source));
    if (!selected.isOpening) {
      body.append(
        note(`Balances as at 31 March ${selected.year} rolled forward from opening balances and transactions.`),
      );
    }

    const table = document.createElement("table");
    table.className = "report-table opening-table";
    const head = document.createElement("thead");
    head.innerHTML = selected.editable
      ? "<tr><th>Account</th><th>Debit</th><th>Credit</th><th></th></tr>"
      : "<tr><th>Account</th><th>Debit</th><th>Credit</th></tr>";
    const tbody = document.createElement("tbody");

    for (const [code, cents] of entries) {
      const row = document.createElement("tr");
      const account = byCode.get(code);
      const bank = labels.get(code);
      row.append(nameCell(account ? `${code} ${account.name}` : (bank ?? code)));
      row.append(amountCell(cents > 0 ? money(cents) : ""));
      row.append(amountCell(cents < 0 ? money(-cents) : ""));

      if (selected.editable) {
        const actions = document.createElement("td");
        const edit = document.createElement("button");
        edit.type = "button";
        edit.className = "link-button";
        edit.textContent = "edit";
        edit.addEventListener("click", () => openingRow(code, cents, selected.asAt));
        actions.append(edit);
        row.append(actions);
      }
      tbody.append(row);
    }

    const sum = document.createElement("tr");
    sum.className = "bs-grand";
    sum.append(nameCell("Total"));
    sum.append(amountCell(money(entries.reduce((s, [, c]) => s + (c > 0 ? c : 0), 0))));
    sum.append(amountCell(money(entries.reduce((s, [, c]) => s + (c < 0 ? -c : 0), 0))));
    if (selected.editable) sum.append(document.createElement("td"));
    tbody.append(sum);

    table.append(head, tbody);
    body.append(table);

    if (selected.editable) {
      const addThisYear = document.createElement("button");
      addThisYear.type = "button";
      addThisYear.className = "link-button";
      addThisYear.textContent = "add an account";
      addThisYear.addEventListener("click", () => openingRow("", 0, selected.asAt));
      body.append(addThisYear);
    }
  }
}

/**
 * Bank balances being entered: each account's balance on a date of the
 * person's choosing -- usually a recent statement -- and the equity account of
 * the entity it belongs to.
 */
interface BankDraft {
  /** The day the books start, which the balances are worked back to. */
  asAt: string;
  /** The day the balances entered are at: the end of that day. */
  on: string;
  rows: { id: string; label: string; amount: string; owing: boolean; balanceTo: string }[];
  /** Said after the feed was used, or why it could not be. */
  feedSaid?: string;
}

let bankDraft: BankDraft | null = null;

/** Today, as a New Zealand date, which is how transactions are dated. */
function todayInNz(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" });
}

/** The equity accounts a starting balance can be balanced to, with whose each is. */
function equityChoices(): { code: string; label: string; entityId: string | undefined; name: string }[] {
  const model = state.ledger.entities ?? emptyEntityModel();
  return state.chart
    .filter((a) => a.type.trim().toLowerCase() === "equity" && a.code.trim() !== "")
    .map((a) => {
      const entityId = model.accounts[accountEntityKey(a)];
      const entity = model.entities.find((e) => e.id === entityId);
      return {
        code: a.code.trim(),
        label: `${a.code.trim()} ${a.name}${entity === undefined ? "" : ` · ${entity.name}`}`,
        entityId,
        name: a.name,
      };
    });
}

/**
 * The equity account a bank account's starting balance goes against: the
 * owner's equity of the entity the bank account belongs to. Each entity's
 * opening position balances to its own equity, so one entity's balance sheet
 * never carries another's money. A shared account defaults to its personal
 * owner, where a shared card's balance usually belongs, and can be changed.
 */
function equityFor(bank: string): string {
  const model = state.ledger.entities ?? emptyEntityModel();
  const choices = equityChoices();
  const owner = (ids: readonly string[]): string | undefined => {
    if (ids.length <= 1) return ids[0];
    return ids.find((id) => model.entities.find((e) => e.id === id)?.kind === "personal") ?? ids[0];
  };
  const entityId = owner(model.banks[bank] ?? []);
  // Nothing rather than somebody else's: where the bank account is not yet
  // ticked to an entity, or its entity has no equity account, the first
  // equity account in the chart belongs to another entity, and a balance
  // defaulted there moves one entity's money onto another's balance sheet.
  // Blank makes it a choice, which saving insists on.
  const theirs = choices.filter((c) => entityId !== undefined && c.entityId === entityId);
  const pick = (list: typeof choices) =>
    list.find((c) => /funds introduced|owner.*funds|owner.*equity|capital/i.test(c.name)) ?? list[0];
  return pick(theirs)?.code ?? "";
}

/** Why a bank account has no equity account chosen for it, in words to act on. */
function noEquityReason(bank: string): string {
  const model = state.ledger.entities ?? emptyEntityModel();
  const ids = model.banks[bank] ?? [];
  if (model.entities.length > 1 && ids.length === 0) {
    return "Not ticked to an entity yet: tick whose it is under Entities & accounts \u2192 Bank accounts.";
  }
  const names = ids.map((id) => model.entities.find((e) => e.id === id)?.name ?? id);
  if (names.length === 0) return "";
  return (
    `${names.join(" / ")} has no equity account: add one under Entities & accounts ` +
    "(Standard accounts\u2026 adds Funds introduced), or choose one here."
  );
}

/** Every bank account, empty, balanced to its own entity's equity. */
function startBankDraft(): BankDraft {
  const asAt = draftFromHeld().asAt;
  const ids = [...new Set(state.ledger.transactions.map((t) => t.account))].sort();
  const rows = ids.map((id) => {
    const name = bankLabel(id);
    return {
      id,
      label: name === id ? id : `${id} ${name}`,
      amount: "",
      owing: false,
      balanceTo: equityFor(id),
    };
  });
  return { asAt, on: todayInNz(), rows };
}

/**
 * A balance at the end of one day, carried to the start of the day the books
 * begin, using the transactions in between.
 *
 * Every imported transaction counts, coded or not and reconciled or not: the
 * bank's balance moves with each one either way. So the answer is exactly right
 * when every transaction in between is imported once, and wrong by whatever is
 * missing or doubled -- which is what the checks against the bank's own
 * balance are for.
 */
function balanceAtStart(bank: string, balance: Cents, on: string, start: string): { start: Cents; between: Cents } {
  const lines = state.ledger.transactions.filter((t) => t.account === bank);
  if (on >= start) {
    const between = lines.filter((t) => t.date >= start && t.date <= on).reduce((s, t) => s + t.amount, 0);
    return { start: balance - between, between };
  }
  // A balance from before the books start is carried forward instead.
  const between = lines.filter((t) => t.date > on && t.date < start).reduce((s, t) => s + t.amount, 0);
  return { start: balance + between, between: -between };
}

function dollars(cents: Cents): string {
  return `${cents < 0 ? "−" : ""}$${(Math.abs(cents) / 100).toLocaleString("en-NZ", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** The working for one row, in words, or "" when there is nothing to work. */
function workingFor(draft: BankDraft, row: BankDraft["rows"][number]): string {
  if (row.amount.trim() === "" || !/^\d{4}-\d{2}-\d{2}$/.test(draft.on) || !/^\d{4}-\d{2}-\d{2}$/.test(draft.asAt)) {
    return "";
  }
  const entered = parseAmount(row.amount.trim());
  if (entered === null) return "Not an amount.";
  const balance = row.owing ? -Math.abs(entered) : Math.abs(entered);
  if (draft.on === draft.asAt) return "";
  const { start, between } = balanceAtStart(row.id, balance, draft.on, draft.asAt);
  return draft.on > draft.asAt
    ? `${dollars(balance)} on ${draft.on}; transactions from ${draft.asAt} came to ` +
        `${dollars(between)}; so ${dollars(start)} when the books start.`
    : `${dollars(balance)} on ${draft.on}; transactions after it, to ${draft.asAt}, came to ` +
        `${dollars(-between)}; so ${dollars(start)} when the books start.`;
}

/**
 * Bank balances on any date, one box each, worked back to the start.
 *
 * A person has a recent statement to hand far more often than one from the
 * day the books began, so the date is theirs to choose and the app does the
 * arithmetic back to the start, showing it on each account. In credit or
 * owing rather than debit or credit, in the words a statement uses. Each
 * account balances to its own entity's equity, and any other opening balances
 * already held are kept as they are.
 */
function bankBalancesForm(draft: BankDraft): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "split-editor journal-editor";
  const title = document.createElement("h4");
  title.textContent = "Bank balances";
  wrap.append(title);

  // The feed first: when it is there, it is the quickest and surest source.
  const fromFeed = document.createElement("button");
  fromFeed.type = "button";
  fromFeed.textContent = "Use the bank feed's balances";
  fromFeed.title = "Fill in the date and balances from the latest bank feed fetch.";
  fromFeed.addEventListener("click", () => {
    fromFeed.disabled = true;
    void fillFromFeed(draft).then(() => redraw("openingBalances"));
  });
  const feedRow = document.createElement("div");
  feedRow.className = "page-actions";
  feedRow.append(fromFeed);
  wrap.append(feedRow);
  if (draft.feedSaid !== undefined) {
    const feedSaid = document.createElement("p");
    feedSaid.className = "field-hint";
    feedSaid.textContent = draft.feedSaid;
    wrap.append(feedSaid);
  }

  wrap.append(
    note(
      "Enter each account's balance at the end of a day, from a statement or internet " +
        "banking; a recent date is fine. Each is worked back to the day the books start, using " +
        "the transactions in between, so check the working before saving: a missing or " +
        "doubled transaction changes the result by its amount.",
    ),
  );

  const dates = document.createElement("div");
  dates.className = "account-add-grid";
  const dateField = (caption: string, value: string, set: (v: string) => void, hint: string): HTMLElement => {
    const label = document.createElement("label");
    label.className = "account-add-field";
    const span = document.createElement("span");
    span.textContent = caption;
    const input = document.createElement("input");
    input.type = "date";
    input.value = value;
    input.addEventListener("change", () => {
      set(input.value);
      redraw("openingBalances");
    });
    const small = document.createElement("small");
    small.className = "field-hint";
    small.textContent = hint;
    label.append(span, input, small);
    return label;
  };
  dates.append(
    dateField("Balances at the end of", draft.on, (v) => (draft.on = v), "The date on the statement."),
    dateField(
      "Books start on",
      draft.asAt,
      (v) => (draft.asAt = v),
      "Normally 1 April on or before your first transaction.",
    ),
  );
  wrap.append(dates);

  // Starting after the first transaction is allowed but rarely meant: the
  // earlier lines leave the balance sheet and stay everywhere else.
  const earlier = state.ledger.transactions.filter((t) => t.date < draft.asAt);
  if (earlier.length > 0) {
    const first = earlier.map((t) => t.date).sort()[0] ?? "";
    const firstYear = Number(first.slice(5, 7)) >= 4 ? Number(first.slice(0, 4)) : Number(first.slice(0, 4)) - 1;
    const usual = `${firstYear}-04-01`;
    const warn = document.createElement("div");
    warn.className = "variance-note warn";
    const text = document.createElement("p");
    text.textContent =
      `${earlier.length} transaction${earlier.length === 1 ? " is" : "s are"} dated before ` +
      `${draft.asAt}, from ${first}. Starting the books on ${draft.asAt} leaves ` +
      `${earlier.length === 1 ? "it" : "them"} out of the balance sheet, but ` +
      `${earlier.length === 1 ? "it stays" : "they stay"} on Reconcile and in earlier years' ` +
      `profit and loss and GST reports. The books normally start on ${usual}.`;
    const fix = document.createElement("button");
    fix.type = "button";
    fix.textContent = `Start the books on ${usual}`;
    fix.addEventListener("click", () => {
      draft.asAt = usual;
      redraw("openingBalances");
    });
    warn.append(text, fix);
    wrap.append(warn);
  }

  const table = document.createElement("table");
  table.className = "report-table opening-table";
  table.innerHTML =
    "<thead><tr><th>Bank account</th><th>Balance</th><th></th><th>Balance to</th></tr></thead>";
  const equity = equityChoices();
  const tbody = document.createElement("tbody");
  for (const row of draft.rows) {
    const tr = document.createElement("tr");
    const labelCell = nameCell(row.label);
    const how = document.createElement("small");
    how.className = "field-hint opening-working";
    const showWorking = (): void => {
      how.textContent = workingFor(draft, row);
    };
    showWorking();
    labelCell.append(how);
    tr.append(labelCell);

    const amountTd = document.createElement("td");
    const amount = document.createElement("input");
    amount.type = "text";
    amount.inputMode = "decimal";
    amount.placeholder = "0.00";
    amount.value = row.amount;
    amount.addEventListener("input", () => {
      row.amount = amount.value;
      showWorking();
    });
    amountTd.append(amount);

    const sideTd = document.createElement("td");
    const side = document.createElement("select");
    for (const [value, caption] of [
      ["credit", "In credit"],
      ["owing", "Owing"],
    ] as const) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = caption;
      option.selected = (value === "owing") === row.owing;
      side.append(option);
    }
    side.title = "In credit: money in the account. Owing: a credit card, overdraft or loan balance.";
    side.addEventListener("change", () => {
      row.owing = side.value === "owing";
      showWorking();
    });
    sideTd.append(side);

    // A plain list: only equity accounts belong here, and there are few.
    const toTd = document.createElement("td");
    const to = document.createElement("select");
    const choose = document.createElement("option");
    choose.value = "";
    choose.textContent = "\u2014 choose \u2014";
    choose.selected = row.balanceTo === "";
    to.append(choose);
    for (const choice of equity) {
      const option = document.createElement("option");
      option.value = choice.code;
      option.textContent = choice.label;
      option.selected = choice.code === row.balanceTo;
      to.append(option);
    }
    to.title = "The owner's equity of the entity this bank account belongs to.";
    to.addEventListener("change", () => {
      row.balanceTo = to.value;
    });
    toTd.append(to);
    if (row.balanceTo === "") {
      const why = noEquityReason(row.id);
      if (why !== "") {
        const hint = document.createElement("div");
        hint.className = "field-hint";
        hint.textContent = why;
        toTd.append(hint);
      }
    }
    tr.append(amountTd, sideTd, toTd);
    tbody.append(tr);
  }
  table.append(tbody);
  wrap.append(table);

  const said = document.createElement("p");
  said.className = "split-balance";
  const save = document.createElement("button");
  save.type = "button";
  save.className = "primary";
  save.textContent = "Save bank balances";
  save.addEventListener("click", () => void saveBankDraft(draft, said));
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => {
    bankDraft = null;
    redraw("openingBalances");
  });
  const buttons = document.createElement("div");
  buttons.className = "page-actions";
  buttons.append(save, cancel);
  wrap.append(buttons, said);
  return wrap;
}

/**
 * The feed's latest balances, and their date, into the form. Akahu gives
 * only the balance now, and that is exactly what the form takes: the working
 * back to the start is then the same as for a balance typed in.
 */
async function fillFromFeed(draft: BankDraft): Promise<void> {
  const status = await feedStatus();
  const latest = status?.balances?.[status.balances.length - 1];
  if (status === null || !status.configured || latest === undefined) {
    draft.feedSaid = "No bank feed balances yet. Connect the feed and fetch it on the Bank import page first.";
    return;
  }
  draft.on = new Date(latest.at).toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" });
  const byAccount = new Map(
    Object.entries(status.accounts ?? {})
      .filter(([, ours]) => ours !== "")
      .map(([akahuId, ours]) => [ours, akahuId]),
  );
  let filled = 0;
  for (const row of draft.rows) {
    const akahuId = byAccount.get(row.id);
    const balance = akahuId === undefined ? undefined : latest.balances[akahuId];
    if (balance === undefined) continue;
    row.amount = balance === 0 ? "0.00" : (Math.abs(balance) / 100).toFixed(2);
    row.owing = balance < 0;
    filled += 1;
  }
  draft.feedSaid =
    filled === 0
      ? "None of these accounts has a feed balance."
      : `Filled from the feed as at ${draft.on}: ${filled} account${filled === 1 ? "" : "s"}. ` +
        "Accounts without a feed balance are left blank.";
}

/** Work each balance back to the start, merge into what is held, balance, and save. */
async function saveBankDraft(draft: BankDraft, said: HTMLElement): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.asAt) || !/^\d{4}-\d{2}-\d{2}$/.test(draft.on)) {
    said.textContent = "Choose both dates.";
    return;
  }
  const accounts: Record<string, Cents> = {};
  const entered = new Set<string>();
  for (const row of draft.rows) {
    if (row.amount.trim() === "") continue;
    const cents = parseAmount(row.amount.trim());
    if (cents === null) {
      said.textContent = `"${row.amount}" for ${row.label} is not an amount.`;
      return;
    }
    if (row.balanceTo === "") {
      said.textContent = `Choose the equity account ${row.label} balances to.`;
      return;
    }
    const balance = row.owing ? -Math.abs(cents) : Math.abs(cents);
    accounts[row.id] = balanceAtStart(row.id, balance, draft.on, draft.asAt).start;
    entered.add(row.id);
  }
  if (entered.size === 0) {
    said.textContent = "Enter at least one balance.";
    return;
  }

  // Everything else held for the same start date is kept. Each bank balance
  // that changes moves its own entity's equity by the same amount, so balances
  // that balanced before still do, and nothing else is touched.
  const held = state.ledger.openingBalances;
  if (held !== undefined && held.asAt !== draft.asAt && Object.keys(held.accounts).length > 0) {
    if (
      !confirm(
        `Opening balances are already held as at ${held.asAt}. Replace them with these ` +
          `bank balances as at ${draft.asAt}?`,
      )
    ) {
      return;
    }
  }
  const merged: Record<string, Cents> =
    held !== undefined && held.asAt === draft.asAt ? { ...held.accounts } : {};
  const move = (key: string, by: Cents): void => {
    const next = (merged[key] ?? 0) + by;
    if (next === 0) delete merged[key];
    else merged[key] = next;
  };
  for (const row of draft.rows) {
    if (!entered.has(row.id)) continue;
    const now = accounts[row.id] ?? 0;
    const before = merged[row.id] ?? 0;
    if (now === before) continue;
    move(row.id, now - before);
    move(row.balanceTo, before - now);
  }

  const options = openingAccountOptions();
  const labelOf = (key: string): string => options.find((o) => o.key === key)?.label ?? key;
  await saveOpeningDraft({
    asAt: draft.asAt,
    lines: Object.entries(merged).map(([key, cents]) => ({
      key,
      label: labelOf(key),
      debit: cents > 0 ? (cents / 100).toFixed(2) : "",
      credit: cents < 0 ? (-cents / 100).toFixed(2) : "",
    })),
  });
  bankDraft = null;
  redraw("openingBalances");
}

/**
 * The opening balances as entered, apart from the worked-out table below
 * them: the date, where they came from, and each balance in plain words.
 */
function enteredBalances(held: OpeningBalances): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "opening-entered";
  const title = document.createElement("h3");
  title.textContent = `Opening balances entered, as at ${held.asAt}`;
  wrap.append(title);
  if (held.source) wrap.append(note(`From: ${held.source}.`));

  const options = openingAccountOptions();
  const labelOf = (key: string): string => options.find((o) => o.key === key)?.label ?? key;
  const table = document.createElement("table");
  table.className = "report-table opening-table";
  table.innerHTML = "<thead><tr><th>Account</th><th>In credit / owned</th><th>Owing / equity</th></tr></thead>";
  const tbody = document.createElement("tbody");
  const shown = (cents: Cents): string =>
    (Math.abs(cents) / 100).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  for (const [key, cents] of Object.entries(held.accounts).sort(([a], [b]) => a.localeCompare(b))) {
    const tr = document.createElement("tr");
    tr.append(nameCell(labelOf(key)));
    tr.append(amountCell(cents > 0 ? shown(cents) : ""));
    tr.append(amountCell(cents < 0 ? shown(cents) : ""));
    tbody.append(tr);
  }
  table.append(tbody);
  wrap.append(table);

  const edit = document.createElement("button");
  edit.type = "button";
  edit.textContent = "Edit opening balances";
  edit.addEventListener("click", () => {
    openingDraft = draftFromHeld();
    redraw("openingBalances");
  });
  wrap.append(edit);
  return wrap;
}

/** Add or change one opening balance. */
function openingRow(code: string, cents: Cents, targetAsAt?: IsoDate): void {
  const held = state.ledger.openingBalances;
  const asAt = targetAsAt ?? held?.asAt ?? chosenStartDate() ?? startOfFinancialYear();
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
  void saveOpeningBalance(which.trim(), parsed, code, asAt);
}

async function saveOpeningBalance(
  code: string,
  cents: Cents,
  replacing: string,
  targetAsAt?: IsoDate,
): Promise<void> {
  const held = state.ledger.openingBalances;
  const accounts = { ...(held?.accounts ?? {}) };
  // Renaming an account is a move, not a copy. Leaving the old key would state
  // the same balance twice and put the sheet out by its own size.
  if (replacing !== "" && replacing !== code) delete accounts[replacing];
  if (cents === 0) delete accounts[code];
  else accounts[code] = cents;

  const fyFromDate = (date: IsoDate): number => {
    if (date.endsWith("-04-01")) return Number(date.slice(0, 4));
    return financialYearOf(date);
  };

  const asAt = targetAsAt ?? held?.asAt ?? chosenStartDate() ?? startOfFinancialYear();
  const byDate = held?.byDate ? { ...held.byDate } : undefined;
  if (byDate) {
    for (const d of Object.keys(byDate)) {
      if (fyFromDate(d) === fyFromDate(asAt)) {
        const accts = { ...(byDate[d] ?? {}) };
        if (replacing !== "" && replacing !== code) delete accts[replacing];
        if (cents === 0) delete accts[code];
        else accts[code] = cents;
        byDate[d] = accts;
      }
    }
  }

  const before = held ?? null;
  const openingBalances: OpeningBalances = {
    asAt,
    ...(held?.source ? { source: held.source } : {}),
    accounts,
    ...(byDate ? { byDate } : {}),
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
  redraw("openingBalances");
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
export function balanceMovementSection(
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
          : "One balance recorded so far; the next fetch can be compared with it.",
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
        `${new Date(last.at).toLocaleString("en-NZ")}: the bank's balance movement compared ` +
        "with the transactions in that time.",
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

/** Read a trial balance and take one of its columns as the opening position. */
export async function loadOpeningBalances(file: File): Promise<void> {
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
  // numbers it. The link between the two has already been made, on the chart
  // of accounts, and asking there first is the difference between recognising
  // these and not -- the export writes "BNZ 01 -  Harbour Roastery Account"
  // where the bank import recorded "Harbour Roastery", which no amount of
  // lowercasing will reconcile.
  const byName = new Map<string, Account>();
  for (const account of state.chart) {
    const name = account.name.trim().toLowerCase();
    if (name !== "") byName.set(name, account);
  }
  const banks = new Map<string, string>();
  for (const transaction of state.ledger.transactions) {
    const label = String(transaction.extras?.["accountLabel"] ?? "").trim();
    if (label !== "") banks.set(label.toLowerCase(), transaction.account);
  }
  const bankAccountFor = (name: string): string | undefined => {
    const wanted = name.trim().toLowerCase();
    // What somebody said on the chart, before anything a name suggests.
    const mapped = ledgerAccountFor(name, byName.get(wanted));
    if (mapped !== null && mapped !== "") return mapped;
    return banks.get(wanted);
  };

  const built = openingBalancesFrom(parsed, chosen, { bankAccountFor });
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
    const builtForDate = openingBalancesFrom(parsed, d, { bankAccountFor });
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

export function renderBalanceChecks(
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
      "Negative: money left the bank with no matching transaction here. Positive: a " +
        "transaction here the bank does not have, usually imported twice. A steady " +
        "difference before the first date is the balance before your data starts." +
        (tied > 0 ? ` ${tied} account(s) tie exactly.` : "") +
        (missing.length > 0
          ? ` ${missing.length} account(s) in the file have nothing imported.`
          : ""),
    ),
  );
}

/** Loading an opening position, and choosing which year is being edited. */
export function wireOpeningBalances(): void {
  $("opening-bank").addEventListener("click", () => {
    bankDraft = startBankDraft();
    openingDraft = null;
    redraw("openingBalances");
  });
  $("opening-enter").addEventListener("click", () => {
    bankDraft = null;
    openingDraft = draftFromHeld();
    redraw("openingBalances");
  });

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
}

/** Opening balances being entered: amounts as typed, until they balance and are saved. */
interface OpeningDraftLine {
  key: string;
  label: string;
  debit: string;
  credit: string;
}

interface OpeningDraft {
  asAt: string;
  lines: OpeningDraftLine[];
}

let openingDraft: OpeningDraft | null = null;

/** What an opening balance can be stated against: each bank account, and the chart. */
function openingAccountOptions(): { key: string; label: string }[] {
  const bankIds = [...new Set(state.ledger.transactions.map((t) => t.account))].sort();
  const banks = bankIds.map((id) => {
    const name = bankLabel(id);
    return { key: id, label: name === id ? id : `${id} ${name}` };
  });
  const chart = accountsForEditing()
    .map((row) => row.account)
    .filter((a) => a.code.trim() !== "" && a.type.trim().toLowerCase() !== "bank")
    .map((a) => ({ key: a.code.trim(), label: `${a.code.trim()} ${a.name}` }));
  return [...banks, ...chart];
}

function blankOpeningLine(): OpeningDraftLine {
  return { key: "", label: "", debit: "", credit: "" };
}

/**
 * The form, started from what is held.
 *
 * With nothing held, the date offered is the first of April on or before the
 * first transaction: the start of the first financial year the books reach,
 * which is the position a set of books opens from.
 */
function draftFromHeld(): OpeningDraft {
  const held = state.ledger.openingBalances;
  const options = openingAccountOptions();
  const labelOf = (key: string): string => options.find((o) => o.key === key)?.label ?? key;
  const first = state.ledger.transactions.map((t) => t.date).sort()[0];
  const startYear =
    first === undefined
      ? new Date().getFullYear()
      : Number(first.slice(5, 7)) >= 4
        ? Number(first.slice(0, 4))
        : Number(first.slice(0, 4)) - 1;
  const lines = Object.entries(held?.accounts ?? {}).map(([key, cents]) => ({
    key,
    label: labelOf(key),
    debit: cents > 0 ? (cents / 100).toFixed(2) : "",
    credit: cents < 0 ? (-cents / 100).toFixed(2) : "",
  }));
  return {
    asAt: held?.asAt ?? chosenStartDate() ?? `${startYear}-04-01`,
    lines: lines.length > 0 ? lines : [blankOpeningLine(), blankOpeningLine()],
  };
}

/** The balances a draft would save, their total, and what is still stopping them. */
function readOpeningDraft(draft: OpeningDraft): { accounts: Record<string, Cents>; total: Cents; problems: string[] } {
  const problems: string[] = [];
  const accounts: Record<string, Cents> = {};
  draft.lines.forEach((line, index) => {
    const n = index + 1;
    if (line.key === "" && line.debit.trim() === "" && line.credit.trim() === "") return;
    const debit = line.debit.trim() === "" ? 0 : parseAmount(line.debit.trim());
    const credit = line.credit.trim() === "" ? 0 : parseAmount(line.credit.trim());
    if (debit === null || credit === null) {
      problems.push(`line ${n}: that is not an amount`);
      return;
    }
    if (line.key === "") {
      problems.push(`line ${n}: choose the account`);
      return;
    }
    if (debit !== 0 && credit !== 0) {
      problems.push(`line ${n}: a debit or a credit, not both`);
      return;
    }
    if (accounts[line.key] !== undefined) {
      problems.push(`line ${n}: ${line.label || line.key} is listed twice`);
      return;
    }
    const cents = Math.abs(debit) - Math.abs(credit);
    if (cents !== 0) accounts[line.key] = cents;
  });
  const total = Object.values(accounts).reduce((sum, c) => sum + c, 0);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.asAt)) problems.push("choose the date the balances are at");
  if (Object.keys(accounts).length === 0) problems.push("enter at least one balance");
  if (total !== 0) problems.push(`debits and credits are ${formatAmount(Math.abs(total))} apart`);
  return { accounts, total, problems };
}

function openingEditor(draft: OpeningDraft): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "split-editor journal-editor";
  const title = document.createElement("h4");
  title.textContent = "Enter opening balances";
  wrap.append(title);
  wrap.append(
    note(
      "Every account's balance on the day the books start: debits for what is owned, credits " +
        "for what is owed or held as equity. They must balance; the balancing line usually " +
        "goes to retained earnings or owner's equity.",
    ),
  );

  const options = openingAccountOptions();
  const labels = options.map((o) => o.label);
  const keyOf = (label: string): string => options.find((o) => o.label === label)?.key ?? "";
  const status = document.createElement("p");
  status.className = "split-balance";
  const save = document.createElement("button");
  save.type = "button";
  save.className = "primary";
  save.textContent = "Save opening balances";

  const head = document.createElement("div");
  head.className = "agent-fields";
  const dateLabel = document.createElement("label");
  const date = document.createElement("input");
  date.type = "date";
  date.value = draft.asAt;
  date.addEventListener("input", () => {
    draft.asAt = date.value;
    refresh();
  });
  dateLabel.append("Balances at the start of", date);
  head.append(dateLabel);
  wrap.append(head);

  const rows = document.createElement("div");
  const draw = (): void => {
    rows.textContent = "";
    draft.lines.forEach((line, index) => {
      const row = document.createElement("div");
      row.className = "agent-row";
      const account = combobox(labels, line.label === "" ? null : line.label, "Search accounts…", () => {
        line.label = account.value;
        line.key = keyOf(account.value);
        refresh();
      });
      const amount = (value: string, placeholder: string, set: (v: string) => void): HTMLInputElement => {
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
      const drop = document.createElement("button");
      drop.type = "button";
      drop.textContent = "✕";
      drop.title = "Remove this line";
      drop.addEventListener("click", () => {
        draft.lines.splice(index, 1);
        draw();
        refresh();
      });
      row.append(
        account.element,
        amount(line.debit, "Debit", (v) => { line.debit = v; }),
        amount(line.credit, "Credit", (v) => { line.credit = v; }),
        drop,
      );
      rows.append(row);
    });
  };
  draw();
  wrap.append(rows);

  const more = document.createElement("button");
  more.type = "button";
  more.textContent = "Add a line";
  more.addEventListener("click", () => {
    draft.lines.push(blankOpeningLine());
    draw();
    refresh();
  });

  // The difference to one account, as a balancing line.
  const balanceTo = combobox(labels, null, "Balance the difference to…", () => undefined);
  const balance = document.createElement("button");
  balance.type = "button";
  balance.textContent = "Add balancing line";
  balance.addEventListener("click", () => {
    const { total } = readOpeningDraft(draft);
    const key = keyOf(balanceTo.value);
    if (total === 0 || key === "") return;
    const existing = draft.lines.find((l) => l.key === key);
    const line = existing ?? { key, label: balanceTo.value, debit: "", credit: "" };
    const current = (parseAmount(line.debit.trim() || "0") ?? 0) - (parseAmount(line.credit.trim() || "0") ?? 0);
    const wanted = current - total;
    line.debit = wanted > 0 ? (wanted / 100).toFixed(2) : "";
    line.credit = wanted < 0 ? (-wanted / 100).toFixed(2) : "";
    if (existing === undefined) draft.lines.push(line);
    draw();
    refresh();
  });
  const balancing = document.createElement("div");
  balancing.className = "page-actions";
  balancing.append(more, balanceTo.element, balance);
  wrap.append(balancing);

  const later = document.createElement("p");
  later.className = "variance-note";
  wrap.append(later, status);

  save.addEventListener("click", () => void saveOpeningDraft(draft));
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => {
    openingDraft = null;
    redraw("openingBalances");
  });
  const buttons = document.createElement("div");
  buttons.className = "page-actions";
  buttons.append(save, cancel);
  wrap.append(buttons);

  function refresh(): void {
    const { accounts, problems } = readOpeningDraft(draft);
    const debits = Object.values(accounts).reduce((s, c) => s + (c > 0 ? c : 0), 0);
    const credits = Object.values(accounts).reduce((s, c) => s + (c < 0 ? -c : 0), 0);
    const said = `Debits ${formatAmount(debits)} · Credits ${formatAmount(credits)}`;
    status.textContent = problems.length === 0 ? `${said} · balanced` : `${said}. Still to do: ${problems.join("; ")}.`;
    status.className = problems.length === 0 ? "split-balance ok" : "split-balance off";
    save.disabled = problems.length > 0;
    // A date after the first transaction leaves that transaction out of every
    // balance, because the balances are taken to include it already.
    const first = state.ledger.transactions.map((t) => t.date).sort()[0];
    later.textContent =
      first !== undefined && draft.asAt > first
        ? `The books have transactions from ${first}, before this date; those are treated as ` +
          "already included in these balances. The date is normally 1 April on or before the " +
          "first transaction."
        : "";
    later.hidden = later.textContent === "";
  }
  refresh();
  return wrap;
}

async function saveOpeningDraft(draft: OpeningDraft): Promise<void> {
  const { accounts, problems } = readOpeningDraft(draft);
  if (problems.length > 0) return;
  const held = state.ledger.openingBalances;
  const openingBalances: OpeningBalances = {
    asAt: draft.asAt as IsoDate,
    source: "Entered by hand",
    accounts,
    ...(held?.byDate ? { byDate: held.byDate } : {}),
  };
  state.ledger = { ...state.ledger, openingBalances };
  state.persistent = await savePart(state.ledger);
  await record(
    "openingBalance",
    `Opening balances entered as at ${draft.asAt}, ${Object.keys(accounts).length} accounts`,
    held ?? null,
    openingBalances,
    "opening",
  );
  openingDraft = null;
  redraw("openingBalances");
}
