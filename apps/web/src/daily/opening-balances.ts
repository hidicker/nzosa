import { redraw } from "../app.js";
import { postedJournals, record } from "../books.js";
import { $, state } from "../state.js";
import { savePart } from "../store.js";
import { amountCell, nameCell, note } from "../ui.js";
import { financialYearBalances, financialYearOf, parseAmount } from "@nzosa/core";
import type {
  Cents,
  FinancialYearBalances,
  IsoDate,
  OpeningBalances,
} from "@nzosa/core";

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

  const yearSelect = $<HTMLSelectElement>("opening-year");
  const held = state.ledger.openingBalances;
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
        "None set. That is right for a ledger starting at the beginning of the company: " +
          "everything it has ever done is in the transactions. It is wrong for one starting " +
          "partway through, and the balance sheet will say so.",
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
      summary.textContent = `Out of balance in ${outOfBalance.map((y) => `FY${y.year}`).join(", ")}. These are not opening balances until they sum to nothing.`;
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
        : `Out of balance by ${money(total)}. These are not opening balances until they sum ` +
          "to nothing, and every report built on them carries the difference.";
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

/** Add or change one opening balance. */
function openingRow(code: string, cents: Cents, targetAsAt?: IsoDate): void {
  const held = state.ledger.openingBalances;
  const asAt = targetAsAt ?? held?.asAt ?? `${new Date().getFullYear()}-04-01`;
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

  const asAt = targetAsAt ?? held?.asAt ?? `${new Date().getFullYear()}-04-01`;
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
