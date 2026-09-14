import { redraw } from "../app.js";
import { ledgerAccountFor, postedJournals, record } from "../books.js";
import { $, state } from "../state.js";
import { savePart } from "../store.js";
import { amountCell, nameCell, note } from "../ui.js";
import { financialYearBalances, financialYearOf, parseAmount } from "@nzosa/core";
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
      "No opening balances loaded. The figures below are worked out from the bank data, " +
      "so they are the movement since your first statement rather than the position before " +
      "it. Load a trial balance at your previous year end to set the real ones.";
  } else {
    status.className = "journal-balanced";
    const count = Object.keys(held.accounts).length;
    status.textContent =
      `${count} opening balance${count === 1 ? "" : "s"} loaded as at ${held.asAt}` +
      (held.source ? `, from ${held.source}` : "") +
      ". The figures below start from those rather than from nothing.";
  }
  body.append(status);
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
  // these and not -- the export writes "BNZ 01 -  Arrow Rock Trading Account"
  // where the bank import recorded "Arrow Rock Trading", which no amount of
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

/** Loading an opening position, and choosing which year is being edited. */
export function wireOpeningBalances(): void {

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
