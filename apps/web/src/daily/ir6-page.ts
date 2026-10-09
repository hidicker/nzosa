import { redraw } from "../app.js";
import { bookYears, postedJournals, record } from "../books.js";
import { $, state } from "../state.js";
import { savePart } from "../store.js";
import { amountCell, download, nameCell, note } from "../ui.js";
import {
  BALANCE_PLACES,
  EXPENSE_PLACEMENTS,
  SETTLEMENT_KINDS,
  TRUST_INCOME_CLASSES,
  accountEntityKey,
  beneficiaryRule,
  defaultBalancePlace,
  defaultExpensePlacement,
  defaultTrustIncomeClass,
  emptyEntityModel,
  emptyTrust,
  incomeAndExpenses,
  ir6bRows,
  parseAmount,
  personId,
  spreadsheetCell,
  trustInputs,
  trustRows,
  trustStatementRows,
  trustStatements,
  trustWorksheet,
} from "@nzosa/core";
import type { Account, BalancePlace, Cents, Entity, ExpensePlacement, SettlementKind, TrustIncomeClass, TrustInputs } from "@nzosa/core";
import { taxYearEnd, taxYearEndSaid, taxYearStart } from "../tax-year.js";
import { booksLocale, moneyPlaces } from "../country.js";

/**
 * The IR6: a trust or estate's income tax return, worked out from the books in
 * the order of the form, with the trustees' choices beside the figures they
 * affect -- which accounts are income, what is allocated to whom, what was
 * distributed -- and the disclosure pages (IR6B, IR6S, IR6P) that go with it.
 * See core's trust.ts for what the guide says and what is not covered.
 */

let chosen = "";
let chosenYear = 0;

const key = (entity: Entity, year: number): string => `${entity.id}:${year}`;

function inputsFor(entity: Entity, year: number): TrustInputs {
  return trustInputs(state.ledger.trustReturns?.[key(entity, year)]);
}

function money(cents: number): string {
  const text = (Math.abs(cents) / 100).toLocaleString(booksLocale(), {
    minimumFractionDigits: moneyPlaces(),
    maximumFractionDigits: moneyPlaces(),
  });
  return cents < 0 ? `-${text}` : text;
}

async function saveInputs(entity: Entity, year: number, next: TrustInputs, what: string): Promise<void> {
  const before = state.ledger.trustReturns ?? {};
  const after = { ...before, [key(entity, year)]: next };
  state.ledger = { ...state.ledger, trustReturns: after };
  state.persistent = await savePart(state.ledger);
  await record("trustReturn", what, before, after);
}

function tick(label: string, checked: boolean, onChange: (value: boolean) => void): HTMLLabelElement {
  const wrap = document.createElement("label");
  wrap.className = "feed-auto";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = checked;
  box.addEventListener("change", () => onChange(box.checked));
  wrap.append(box, ` ${label}`);
  return wrap;
}

function dollarsBox(cents: number | undefined, onChange: (c: Cents | undefined) => void, title?: string): HTMLInputElement {
  const box = document.createElement("input");
  box.type = "text";
  box.className = "payroll-tiny-input";
  box.placeholder = "0.00";
  if (title !== undefined) box.title = title;
  box.value = cents === undefined || cents === 0 ? "" : (cents / 100).toFixed(2);
  box.addEventListener("change", () => {
    const parsed = parseAmount(box.value);
    onChange(parsed === null || parsed === 0 ? undefined : (parsed as Cents));
  });
  return box;
}

let section = 0;

/** A numbered heading: sections that are left out do not leave a gap. */
function heading(text: string): HTMLElement {
  const h = document.createElement("h3");
  section += 1;
  h.textContent = `${section}. ${text}`;
  return h;
}

function wrapTable(table: HTMLElement): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "table-scroll";
  wrap.append(table);
  return wrap;
}

function rowsTable(rows: { label: string; box: string; amount: number }[], strong: string[]): HTMLElement {
  const table = document.createElement("table");
  table.className = "report-table";
  table.innerHTML = "<thead><tr><th>Box</th><th></th><th>$</th></tr></thead>";
  const tbody = document.createElement("tbody");
  for (const r of rows) {
    const tr = document.createElement("tr");
    const label = nameCell(r.label);
    if (strong.includes(r.box)) label.style.fontWeight = "600";
    tr.append(nameCell(r.box), label, amountCell(money(r.amount)));
    tbody.append(tr);
  }
  table.append(tbody);
  return wrapTable(table);
}

export function renderIr6Page(): void {
  const body = $("ir6-body");
  body.textContent = "";
  section = 0;
  const model = state.ledger.entities ?? emptyEntityModel();
  const entities = model.entities.filter((e) => e.kind === "trust");
  if (entities.length === 0) {
    body.append(note("No trusts or estates. On Entities & accounts, add one and choose \"Trust or estate\"."));
    return;
  }
  const entity = entities.find((e) => e.id === chosen) ?? entities.find((e) => e.id === state.entityFilter) ?? entities[0];
  if (entity === undefined) return;
  chosen = entity.id;
  const years = bookYears();
  if (years.length === 0) {
    body.append(note("No transactions yet, so there is no year to report on."));
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  if (!years.includes(chosenYear)) chosenYear = years.filter((y) => taxYearEnd(y) < today)[0] ?? years[0] ?? 0;
  const year = chosenYear;
  const trust = entity.trust ?? emptyTrust();
  const balanceDate = taxYearEnd(year);

  const pick = document.createElement("div");
  pick.className = "page-actions";
  if (entities.length > 1) {
    const who = document.createElement("select");
    for (const e of entities) {
      const option = document.createElement("option");
      option.value = e.id;
      option.textContent = e.name;
      option.selected = e.id === entity.id;
      who.append(option);
    }
    who.addEventListener("change", () => {
      chosen = who.value;
      redraw("ir6");
    });
    pick.append(who);
  }
  const when = document.createElement("select");
  for (const y of years) {
    const option = document.createElement("option");
    option.value = String(y);
    option.textContent = `Year ended ${taxYearEndSaid(y)}`;
    option.selected = y === year;
    when.append(option);
  }
  when.addEventListener("change", () => {
    chosenYear = Number(when.value);
    redraw("ir6");
  });
  pick.append(when);
  body.append(pick);

  // What is stored now: a field changed without a redraw must not undo another.
  const patch = (change: (draft: TrustInputs) => void, what: string): void => {
    const next = structuredClone(inputsFor(entity, year));
    change(next);
    void saveInputs(entity, year, next, what);
    redraw("ir6");
  };
  const setMap = (name: "allocations" | "otherIncome" | "taxableDistributions" | "openingBalances" | "distributionsTaxable" | "distributionsNotTaxable" | "withdrawals", id: string, v: Cents | undefined, what: string): void =>
    patch((d) => {
      if (v === undefined) delete d[name][id];
      else d[name][id] = v;
    }, what);
  const setScalar = (name: keyof TrustInputs, v: Cents | undefined, what: string): void =>
    patch((d) => {
      const target = d as unknown as Record<string, unknown>;
      if (v === undefined) delete target[name];
      else target[name] = v;
    }, what);

  const inputs = inputsFor(entity, year);
  const owned = (accountKey: string): boolean => {
    const holder = model.accounts[accountKey];
    return holder === entity.id || (holder === undefined && model.entities.length <= 1);
  };
  const only = (account: Account): boolean => {
    const bank = (account.ledgerAccount ?? "").trim();
    // A bank account belongs to the entities it serves; with one entity, to that one.
    if (bank !== "") return (model.banks[bank] ?? []).includes(entity.id) || (model.banks[bank] === undefined && model.entities.length <= 1);
    return owned(accountEntityKey(account));
  };
  const journals = postedJournals();
  const from = taxYearStart(year);
  const { income, expenses } = incomeAndExpenses({ journals, chart: state.chart, from, to: balanceDate, only });

  // What each beneficiary's account stood at in the books, at the start and end of the year.
  const accountBalances: Record<string, { opening: Cents; closing: Cents }> = {};
  for (const b of trust.beneficiaries) {
    const code = (b.accountCode ?? "").trim();
    if (code === "") continue;
    let open = 0;
    let close = 0;
    for (const j of journals) {
      for (const l of j.lines) {
        if (l.accountCode.trim() !== code) continue;
        if (j.date < from) open += l.amount;
        if (j.date <= balanceDate) close += l.amount;
      }
    }
    accountBalances[b.id] = { opening: -open as Cents, closing: -close as Cents };
  }
  const sheet = trustWorksheet({ income, expenses, trust, inputs, year, balanceDate, accountBalances });

  // 1. Does it have to file?
  body.append(heading("Does it have to file?"));
  const quiet = sheet.box.totalIncome === 0 && sheet.box.lossBroughtForward === 0 && sheet.beneficiaries.length === 0;
  body.append(
    note(
      quiet
        ? "Nothing was earned, no loss is brought forward and nothing was distributed in this year. Answer No to question 7B on the IR6, sign the declaration, and answer nothing more."
        : "Every trust and estate that has income, losses brought forward, distributions or disclosures files an IR6 each year, due 7 July for a 31 March balance date.",
    ),
  );
  if (trust.registered !== true) {
    body.append(note("A new trust must first be registered with Inland Revenue: an IR596 and a copy of the trust deed. Tick \"Registered\" in the trust's settings when that is done."));
  }

  // 2. Income
  body.append(heading("What was earned"));
  body.append(
    note(
      "Say what each income account is. Money settled on the trust, capital gains and gifts are not income. Interest, dividends and overseas income go in boxes of their own on the form.",
    ),
  );
  const incomeTable = document.createElement("table");
  incomeTable.className = "report-table";
  incomeTable.innerHTML = "<thead><tr><th>Account</th><th>For the year</th><th>It is</th></tr></thead>";
  const ibody = document.createElement("tbody");
  for (const a of income) {
    const tr = document.createElement("tr");
    const select = document.createElement("select");
    const held = inputs.classes[a.code] ?? defaultTrustIncomeClass(a);
    for (const [value, label] of TRUST_INCOME_CLASSES) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      option.selected = value === held;
      select.append(option);
    }
    select.addEventListener("change", () =>
      patch((d) => {
        if (select.value === defaultTrustIncomeClass(a)) delete d.classes[a.code];
        else d.classes[a.code] = select.value as TrustIncomeClass;
      }, `IR6: ${a.name}`),
    );
    const cell = document.createElement("td");
    cell.append(select);
    tr.append(nameCell(`${a.code} ${a.name}`), amountCell(money(a.amount)), cell);
    ibody.append(tr);
  }
  incomeTable.append(ibody);
  body.append(income.length === 0 ? note("Nothing earned in this year.") : wrapTable(incomeTable));

  // 3. Expenses
  body.append(heading("What it cost"));
  body.append(
    note(
      "Trustee expenses (accounting, legal, bank fees) go in box 21 and come off trustee income only. Costs of earning rent come off that rent in its own box. Private spending and capital items are not deductible.",
    ),
  );
  const costTable = document.createElement("table");
  costTable.className = "report-table";
  costTable.innerHTML = "<thead><tr><th>Account</th><th>For the year</th><th>It is</th></tr></thead>";
  const cbody = document.createElement("tbody");
  for (const a of expenses) {
    const tr = document.createElement("tr");
    const select = document.createElement("select");
    const held = inputs.placements[a.code] ?? defaultExpensePlacement(a);
    for (const [value, label] of EXPENSE_PLACEMENTS) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      option.selected = value === held;
      select.append(option);
    }
    select.addEventListener("change", () =>
      patch((d) => {
        if (select.value === defaultExpensePlacement(a)) delete d.placements[a.code];
        else d.placements[a.code] = select.value as ExpensePlacement;
      }, `IR6: ${a.name}`),
    );
    const cell = document.createElement("td");
    cell.append(select);
    tr.append(nameCell(`${a.code} ${a.name}`), amountCell(money(a.amount)), cell);
    cbody.append(tr);
  }
  costTable.append(cbody);
  body.append(expenses.length === 0 ? note("No costs in this year.") : wrapTable(costTable));

  // 4. Other figures
  body.append(heading("Other figures the return asks"));
  const field = (label: string, control: HTMLElement): HTMLLabelElement => {
    const wrap = document.createElement("label");
    wrap.className = "year-end-field";
    wrap.append(`${label} `, control);
    return wrap;
  };
  const money1 = (label: string, name: keyof TrustInputs, what: string): HTMLLabelElement =>
    field(label, dollarsBox(inputs[name] as Cents | undefined, (v) => setScalar(name, v, `IR6: ${what}`)));
  body.append(
    tick("The books record interest and dividends before tax (the credits below are already in them)", inputs.grossBooks === true, (v) =>
      patch((d) => {
        if (v) d.grossBooks = true;
        else delete d.grossBooks;
      }, "IR6: books gross"),
    ),
    money1("Tax withheld from interest (RWT) $", "rwtInterest", "RWT on interest"),
    money1("Dividend imputation credits $", "imputation", "imputation credits"),
    money1("RWT on dividends $", "rwtDividends", "RWT on dividends"),
    money1("Tax paid overseas $", "overseasTax", "overseas tax"),
    money1("Taxable Māori authority distributions $", "maori", "Māori authority"),
    money1("Income from a partnership, estate or trust $", "partnership", "partnership income"),
    money1("Look-through company income (adjusted) $", "ltc", "look-through company"),
    money1("Taxable property sales $", "propertySales", "property sales"),
    money1("Other tax credits $", "otherCredits", "other credits"),
    money1("Residential rental deductions brought forward $", "residentialBroughtForward", "residential deductions brought forward"),
    money1("Net losses brought forward $", "lossBroughtForward", "losses brought forward"),
    money1("Provisional tax paid for the year $", "provisionalPaid", "provisional tax paid"),
  );

  // 5. Beneficiaries
  body.append(heading("Beneficiaries: income and accounts"));
  body.append(
    note(
      "Income is beneficiary income only if it is allocated to a beneficiary by balance date, or within six months after it and before the return is completed. Everything else is trustee income. " +
        "A loss can't be passed to a beneficiary. Record what each was allocated, and the movements in their account for the year.",
    ),
  );
  if (trust.beneficiaries.length === 0) {
    body.append(note("No beneficiaries yet: add them on Trust people."));
  } else {
    const t = document.createElement("table");
    t.className = "report-table";
    t.innerHTML =
      "<thead><tr><th>Beneficiary</th><th>Allocated</th><th>Their other income</th>" +
      (trust.type !== "complying" ? "<th>Taxable distribution</th>" : "") +
      "<th>Opening account</th><th>Distributed (taxable)</th><th>Distributed (not taxable)</th><th>Withdrawn</th><th>Closing account</th><th>Tax rule</th></tr></thead>";
    const tb = document.createElement("tbody");
    for (const b of trust.beneficiaries) {
      const tr = document.createElement("tr");
      const linked = accountBalances[b.id];
      const mine = sheet.beneficiaries.find((x) => x.id === b.id);
      const allocated = inputs.allocations[b.id] ?? 0;
      const rule = beneficiaryRule(b, allocated, balanceDate);
      const cell = (control: HTMLElement | string): HTMLTableCellElement => {
        const td = document.createElement("td");
        td.append(control);
        return td;
      };
      const tax = rule === "minor" ? "Minor: 39%, in the trust" : rule === "corporate" ? "Corporate: 39%, in the trust" : b.trusteeDoesNotPay === true ? "Their own return" : "Their rates, paid by the trustee";
      tr.append(
        nameCell(b.name === "" ? "(unnamed)" : b.name),
        cell(dollarsBox(inputs.allocations[b.id], (v) => setMap("allocations", b.id, v, `IR6: allocation to ${b.name}`))),
        cell(dollarsBox(inputs.otherIncome[b.id], (v) => setMap("otherIncome", b.id, v, `IR6: other income of ${b.name}`), "Their taxable income from other sources, to work out the tax on this")),
      );
      if (trust.type !== "complying") {
        tr.append(cell(dollarsBox(inputs.taxableDistributions[b.id], (v) => setMap("taxableDistributions", b.id, v, `IR6: taxable distribution to ${b.name}`))));
      }
      tr.append(
        linked !== undefined
          ? amountCell(money(linked.opening))
          : cell(dollarsBox(inputs.openingBalances[b.id], (v) => setMap("openingBalances", b.id, v, `IR6: opening account of ${b.name}`))),
        cell(dollarsBox(inputs.distributionsTaxable[b.id], (v) => setMap("distributionsTaxable", b.id, v, `IR6: distribution to ${b.name}`), "Accounting income credited or paid to them for the year")),
        cell(dollarsBox(inputs.distributionsNotTaxable[b.id], (v) => setMap("distributionsNotTaxable", b.id, v, `IR6: untaxed distribution to ${b.name}`), "Corpus, assets, debts forgiven, trust property used below market value")),
        cell(dollarsBox(inputs.withdrawals[b.id], (v) => setMap("withdrawals", b.id, v, `IR6: withdrawals by ${b.name}`), "Cash drawn, assets taken, property used for less than market value")),
        amountCell(money(mine?.closing ?? (linked?.opening ?? inputs.openingBalances[b.id] ?? 0))),
        nameCell(tax),
      );
      tb.append(tr);
      if (linked !== undefined && mine !== undefined && mine.closing !== linked.closing) {
        const warn = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = 11;
        td.textContent = `${b.name}: the movements entered give a closing account of $${money(mine.closing)}, but the books say $${money(linked.closing)}. Check the distributions and withdrawals against the account.`;
        td.style.color = "var(--warn, #b45309)";
        warn.append(td);
        tb.append(warn);
      }
    }
    t.append(tb);
    body.append(wrapTable(t));
  }

  // 6. Settlements
  if (trust.disclosureExempt !== true) {
    body.append(heading("Settlements made this year"));
    body.append(
      note(
        "Value put into the trust this year by each settlor, valued at market value: cash at face value, assets at what they were worth when settled. Services and interest not charged are settlements at nil. " +
          "A settlor's non-cash settlements under $100,000 in the year need not be disclosed.",
      ),
    );
    if (trust.settlors.length === 0) body.append(note("No settlors yet: add them on Trust people."));
    else {
      const t = document.createElement("table");
      t.className = "report-table";
      t.innerHTML = `<thead><tr><th>Settlor</th>${SETTLEMENT_KINDS.map(([, label]) => `<th>${label}</th>`).join("")}</tr></thead>`;
      const tb = document.createElement("tbody");
      for (const s of trust.settlors) {
        const tr = document.createElement("tr");
        tr.append(nameCell(s.name === "" ? "(unnamed)" : s.name));
        for (const [kind] of SETTLEMENT_KINDS) {
          const td = document.createElement("td");
          td.append(
            dollarsBox(inputs.settlements[s.id]?.[kind as SettlementKind], (v) =>
              patch((d) => {
                const mine = { ...(d.settlements[s.id] ?? {}) };
                if (v === undefined) delete mine[kind as SettlementKind];
                else mine[kind as SettlementKind] = v;
                d.settlements[s.id] = mine;
              }, `IR6: settlement by ${s.name}`),
            ),
          );
          tr.append(td);
        }
        tb.append(tr);
      }
      t.append(tb);
      body.append(wrapTable(t));
    }
  }

  // 7. The return
  body.append(heading("The return"));
  const rows = trustRows(sheet);
  body.append(rowsTable(rows, ["19B", "27D", "28C", "28E"]));
  body.append(note(`Trustee income is taxed at ${Math.round(sheet.rate * 100)}%: ${sheet.rateWhy}.`));
  for (const problem of sheet.problems) {
    const p = note(problem);
    p.style.color = "var(--warn, #b45309)";
    body.append(p);
  }
  if (sheet.lossCarriedForward > 0) {
    body.append(note(`A loss of $${money(sheet.lossCarriedForward)} is carried forward to next year.`));
  }
  if (sheet.box.residentialCarried > 0) {
    body.append(note(`Residential rental deductions of $${money(sheet.box.residentialCarried)} could not be used and are carried forward (box 15I).`));
  }
  if (sheet.box.toPay < 0) body.append(note("The return ends in a refund. Choose on the form where it goes."));
  if (sheet.provisionalNext !== null) {
    body.append(
      note(
        `This trust is a provisional tax payer: residual income tax is over $5,000. The standard option for next year is this year's residual income tax plus 5%, $${money(sheet.provisionalNext)}, ` +
          "paid in three instalments (28 August, 15 January and 7 May for a 31 March balance date). Distributions to minor and corporate beneficiaries count. The estimation option is on the form's worksheet.",
      ),
    );
  }

  // 8. Beneficiary pages
  if (sheet.beneficiaries.length > 0) {
    body.append(heading("The beneficiaries' pages (IR6B)"));
    body.append(
      note(
        "One for each beneficiary who was allocated income or received a distribution. Tax paid for a beneficiary is not final: they put the income and the tax in their own return. " +
          "The totals of boxes 26I here are box 20A plus box 20C on the return.",
      ),
    );
    for (const s of sheet.beneficiaries) {
      const person = trust.beneficiaries.find((b) => b.id === s.id);
      const d = document.createElement("details");
      const sum = document.createElement("summary");
      sum.textContent = `${s.name}${person !== undefined && personId(person) !== "" ? ` · ${personId(person)}` : ""}${s.rule !== null ? ` · ${s.rule} beneficiary rule` : ""}`;
      d.append(sum, rowsTable(ir6bRows(s), ["26I", "26T", "26Y"]));
      body.append(d);
    }
  }

  // 9. Disclosure
  if (trust.disclosureExempt !== true) {
    body.append(heading("The trust disclosure pages"));
    const statements = trustStatements({ journals, chart: state.chart, trust, inputs, from, to: balanceDate, sheet, only });
    body.append(
      note(
        "Questions 33 to 37 of the return: the trust's profit or loss, what it owns and owes, and what it has built up. Valued as in the trust's own accounts. " +
          "Accounts are placed by name; change one in the table below if it has gone to the wrong box.",
      ),
    );
    body.append(rowsTable(trustStatementRows(statements), ["34H", "35D", "36A"]));

    const place = state.chart.filter((a) => /asset|bank|liabilit|payable|receivable/i.test(a.type) && only(a) && !trust.beneficiaries.some((b) => b.accountCode === a.code));
    if (place.length > 0) {
      const det = document.createElement("details");
      const sum = document.createElement("summary");
      sum.textContent = "Where the trust's asset and liability accounts go";
      const t = document.createElement("table");
      t.className = "report-table";
      const tb = document.createElement("tbody");
      for (const a of place) {
        const tr = document.createElement("tr");
        const select = document.createElement("select");
        const held = inputs.placementsOfBalances[a.code] ?? defaultBalancePlace(a);
        for (const [value, label] of BALANCE_PLACES) {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = label;
          option.selected = value === held;
          select.append(option);
        }
        select.addEventListener("change", () =>
          patch((d) => {
            if (select.value === defaultBalancePlace(a)) delete d.placementsOfBalances[a.code];
            else d.placementsOfBalances[a.code] = select.value as BalancePlace;
          }, `IR6: ${a.name}`),
        );
        const td = document.createElement("td");
        td.append(select);
        tr.append(nameCell(`${a.code} ${a.name}`), td);
        tb.append(tr);
      }
      t.append(tb);
      det.append(sum, wrapTable(t));
      body.append(det);
    }

    {
      const h = document.createElement("h4");
      h.textContent = "Settlors (IR6S) and people who can appoint or remove (IR6P)";
      body.append(h);
    }
    const ps = document.createElement("table");
    ps.className = "report-table";
    ps.innerHTML = "<thead><tr><th>Page</th><th>Name</th><th>Born or began</th><th>Resident in</th><th>IRD number or TIN</th><th>This year</th></tr></thead>";
    const pb = document.createElement("tbody");
    for (const s of trust.settlors) {
      const mine = inputs.settlements[s.id] ?? {};
      const total = SETTLEMENT_KINDS.reduce((sum, [k]) => sum + (mine[k as SettlementKind] ?? 0), 0);
      const tr = document.createElement("tr");
      tr.append(nameCell("IR6S"), nameCell(s.name), nameCell(s.born ?? ""), nameCell(s.residence ?? ""), nameCell(personId(s)), amountCell(total === 0 ? "no settlement" : money(total)));
      pb.append(tr);
    }
    for (const a of trust.appointers) {
      const tr = document.createElement("tr");
      tr.append(nameCell("IR6P"), nameCell(a.name), nameCell(a.born ?? ""), nameCell(a.residence ?? ""), nameCell(personId(a)), nameCell(`${a.since ?? ""}${a.until !== undefined ? ` to ${a.until}` : a.since !== undefined ? " on" : ""}`));
      pb.append(tr);
    }
    ps.append(pb);
    body.append(pb.childElementCount === 0 ? note("None entered yet.") : wrapTable(ps));
  }

  // The pack
  const save = document.createElement("button");
  save.type = "button";
  save.textContent = "Download the worksheet (CSV)";
  save.addEventListener("click", () => {
    const lines: string[][] = [["Page", "Box", "What", "Amount"]];
    for (const r of rows) lines.push(["IR6", r.box, r.label, (r.amount / 100).toFixed(2)]);
    for (const s of sheet.beneficiaries) for (const r of ir6bRows(s)) lines.push([`IR6B ${s.name}`, r.box, r.label, (r.amount / 100).toFixed(2)]);
    if (trust.disclosureExempt !== true) {
      const st = trustStatements({ journals, chart: state.chart, trust, inputs, from, to: balanceDate, sheet, only });
      for (const r of trustStatementRows(st)) lines.push(["IR6", r.box, r.label, (r.amount / 100).toFixed(2)]);
    }
    const text = lines.map((row) => row.map((cell) => spreadsheetCell(cell)).join(",")).join("\r\n");
    download(text, `ir6-worksheet-${year}.csv`, "text/csv");
  });
  body.append(save);

  body.append(
    note(
      "The box numbers are those of the IR6 for the year to 31 March 2026; Inland Revenue renumbers them from year to year, so check each against that year's form. " +
        "The figures go into myIR or onto the form. Not worked out here: foreign investment fund and controlled foreign company income (enter the figure), the disabled beneficiary trust election, " +
        "non-resident beneficiaries' withholding tax, and the rules for foreign trusts beyond the 45% on taxable distributions from a non-complying trust. " +
        "Where a choice is the trustees' to make -- what is income, who is allocated what, whether a beneficiary's tax is deducted -- have an accountant look at it before filing.",
    ),
  );
}
