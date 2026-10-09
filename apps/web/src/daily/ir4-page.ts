import { redraw } from "../app.js";
import { bookYears, postedJournals, record } from "../books.js";
import { $, state } from "../state.js";
import { savePart } from "../store.js";
import { amountCell, download, nameCell, note } from "../ui.js";
import {
  IR4_EXPENSE_PLACEMENTS,
  IR4_INCOME_CLASSES,
  accountEntityKey,
  defaultIr4ExpensePlacement,
  defaultIr4IncomeClass,
  dividendImputation,
  emptyEntityModel,
  icaRows,
  incomeAndExpenses,
  ir4Inputs,
  ir4Rows,
  ir4Worksheet,
  parseAmount,
  spreadsheetCell,
} from "@nzosa/core";
import type { Account, Cents, Entity, Ir4ExpensePlacement, Ir4IncomeClass, Ir4Inputs } from "@nzosa/core";
import { taxYearEnd, taxYearEndSaid, taxYearStart } from "../tax-year.js";
import { booksLocale, moneyPlaces } from "../country.js";

/**
 * The IR4: a company's income tax return and its imputation credit account,
 * worked out from the books in the order of the form, with the company's
 * choices -- what each account is, losses, credits, dividends paid -- beside
 * the figures they affect. See core's ir4.ts for what the guide says and what
 * is not covered. The company's accounts (IR10) are under Reports.
 */

let chosen = "";
let chosenYear = 0;

const key = (entity: Entity, year: number): string => `${entity.id}:${year}`;

/** Entities that file an IR4: businesses that are companies and not look-through companies. */
function companies(): Entity[] {
  const model = state.ledger.entities ?? emptyEntityModel();
  return model.entities.filter(
    (e) => (e.kind ?? "business") === "business" && (e.structure === undefined || e.structure === "company") && e.lookThrough !== true,
  );
}

function inputsFor(entity: Entity, year: number): Ir4Inputs {
  return ir4Inputs(state.ledger.ir4Returns?.[key(entity, year)]);
}

function money(cents: number): string {
  const text = (Math.abs(cents) / 100).toLocaleString(booksLocale(), {
    minimumFractionDigits: moneyPlaces(),
    maximumFractionDigits: moneyPlaces(),
  });
  return cents < 0 ? `-${text}` : text;
}

async function saveInputs(entity: Entity, year: number, next: Ir4Inputs, what: string): Promise<void> {
  const before = state.ledger.ir4Returns ?? {};
  const after = { ...before, [key(entity, year)]: next };
  state.ledger = { ...state.ledger, ir4Returns: after };
  state.persistent = await savePart(state.ledger);
  await record("ir4Return", what, before, after);
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

export function renderIr4Page(): void {
  const body = $("ir4-body");
  body.textContent = "";
  section = 0;
  const model = state.ledger.entities ?? emptyEntityModel();
  const list = companies();
  if (list.length === 0) {
    body.append(note("No companies. On Entities & accounts, set a business's structure to Company. A look-through company files an IR7 instead."));
    return;
  }
  const entity = list.find((e) => e.id === chosen) ?? list.find((e) => e.id === state.entityFilter) ?? list[0];
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

  const pick = document.createElement("div");
  pick.className = "page-actions";
  if (list.length > 1) {
    const who = document.createElement("select");
    for (const e of list) {
      const option = document.createElement("option");
      option.value = e.id;
      option.textContent = e.name;
      option.selected = e.id === entity.id;
      who.append(option);
    }
    who.addEventListener("change", () => {
      chosen = who.value;
      redraw("ir4");
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
    redraw("ir4");
  });
  pick.append(when);
  body.append(pick);

  const patch = (change: (draft: Ir4Inputs) => void, what: string): void => {
    const next = structuredClone(inputsFor(entity, year));
    change(next);
    void saveInputs(entity, year, next, what);
    redraw("ir4");
  };
  const setScalar = (name: keyof Ir4Inputs, v: Cents | undefined, what: string): void =>
    patch((d) => {
      const target = d as unknown as Record<string, unknown>;
      if (v === undefined) delete target[name];
      else target[name] = v;
    }, what);

  const stored = inputsFor(entity, year);
  // The imputation account opens where last year's closed, unless it has been said.
  const previous = state.ledger.ir4Returns?.[key(entity, year - 1)];
  const carried = previous !== undefined ? ir4Worksheet({ income: [], expenses: [], inputs: ir4Inputs(previous) }).ica.closing : undefined;
  const inputs: Ir4Inputs = stored.icaOpening === undefined && carried !== undefined ? { ...stored, icaOpening: carried } : stored;

  const owned = (accountKey: string): boolean => {
    const holder = model.accounts[accountKey];
    return holder === entity.id || (holder === undefined && model.entities.length <= 1);
  };
  const only = (account: Account): boolean => {
    const bank = (account.ledgerAccount ?? "").trim();
    if (bank !== "") return (model.banks[bank] ?? []).includes(entity.id) || (model.banks[bank] === undefined && model.entities.length <= 1);
    return owned(accountEntityKey(account));
  };
  const { income, expenses } = incomeAndExpenses({ journals: postedJournals(), chart: state.chart, from: taxYearStart(year), to: taxYearEnd(year), only });
  const sheet = ir4Worksheet({ income, expenses, inputs });

  // 1. Who files
  body.append(heading("Does it have to file?"));
  body.append(
    note(
      "Every New Zealand resident company that is active files an IR4 each year, due 7 July for a 31 March balance date (later with a tax agent). It includes the annual imputation return, for the tax year 1 April to 31 March whatever the balance date. " +
        "A debit in the imputation account is payable by 20 June. The company's accounts, or an IR10, go with it.",
    ),
  );

  // 2. Income
  body.append(heading("What was earned"));
  body.append(note("Say what each income account is. Share capital, loans and GST are not income. Each kind goes in a box of its own on the form."));
  const incomeTable = document.createElement("table");
  incomeTable.className = "report-table";
  incomeTable.innerHTML = "<thead><tr><th>Account</th><th>For the year</th><th>It is</th></tr></thead>";
  const ibody = document.createElement("tbody");
  for (const a of income) {
    const tr = document.createElement("tr");
    const select = document.createElement("select");
    const held = inputs.classes[a.code] ?? defaultIr4IncomeClass(a);
    for (const [value, label] of IR4_INCOME_CLASSES) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      option.selected = value === held;
      select.append(option);
    }
    select.addEventListener("change", () =>
      patch((d) => {
        if (select.value === defaultIr4IncomeClass(a)) delete d.classes[a.code];
        else d.classes[a.code] = select.value as Ir4IncomeClass;
      }, `IR4: ${a.name}`),
    );
    const cell = document.createElement("td");
    cell.append(select);
    tr.append(nameCell(`${a.code} ${a.name}`), amountCell(money(a.amount)), cell);
    ibody.append(tr);
  }
  incomeTable.append(ibody);
  body.append(income.length === 0 ? note("Nothing earned in this year.") : wrapTable(incomeTable));

  // 3. Costs
  body.append(heading("What it cost"));
  body.append(
    note(
      "Business costs come off the business income, giving the net profit at box 20B. Residential rental deductions are kept apart: they come off residential income only. Anything not deductible, such as penalties and the company's own income tax, is left out. " +
        "Differences between the accounts and tax (entertainment, depreciation) go in the tax adjustment below.",
    ),
  );
  const costTable = document.createElement("table");
  costTable.className = "report-table";
  costTable.innerHTML = "<thead><tr><th>Account</th><th>For the year</th><th>It is</th></tr></thead>";
  const cbody = document.createElement("tbody");
  for (const a of expenses) {
    const tr = document.createElement("tr");
    const select = document.createElement("select");
    const held = inputs.placements[a.code] ?? defaultIr4ExpensePlacement(a);
    for (const [value, label] of IR4_EXPENSE_PLACEMENTS) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      option.selected = value === held;
      select.append(option);
    }
    select.addEventListener("change", () =>
      patch((d) => {
        if (select.value === defaultIr4ExpensePlacement(a)) delete d.placements[a.code];
        else d.placements[a.code] = select.value as Ir4ExpensePlacement;
      }, `IR4: ${a.name}`),
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
  const field = (label: string, name: keyof Ir4Inputs, what: string, title?: string): HTMLLabelElement => {
    const wrap = document.createElement("label");
    wrap.className = "year-end-field";
    wrap.append(`${label} `, dollarsBox(inputs[name] as Cents | undefined, (v) => setScalar(name, v, `IR4: ${what}`), title));
    return wrap;
  };
  body.append(
    tick("The books record interest and dividends before tax (the credits below are already in them)", inputs.grossBooks === true, (v) =>
      patch((d) => {
        if (v) d.grossBooks = true;
        else delete d.grossBooks;
      }, "IR4: books gross"),
    ),
    field("Tax deducted from schedular payments $", "schedularTax", "schedular tax"),
    field("Tax withheld from interest (RWT) $", "rwtInterest", "RWT on interest"),
    field("Dividend imputation credits received $", "imputationReceived", "imputation credits received"),
    field("RWT on dividends $", "rwtDividends", "RWT on dividends"),
    field("Taxable Māori authority distributions $", "maori", "Māori authority"),
    field("Māori authority credits $", "maoriCredits", "Māori authority credits"),
    field("Income from a partnership, estate or trust $", "partnership", "partnership income"),
    field("Credits from a partnership, estate or trust $", "partnershipCredits", "partnership credits"),
    field("Tax paid overseas $", "overseasTax", "overseas tax"),
    field("Net bright-line profit $", "brightLine", "bright-line profit"),
    field("Other residential income $", "otherResidential", "other residential income"),
    field("Residential deductions brought forward $", "residentialBroughtForward", "residential deductions brought forward"),
    field("Taxable property sales, profit or loss $", "propertySales", "property sales"),
    field("Residential land withholding tax credit $", "rlwt", "RLWT credit"),
    field("Tax adjustments to the business profit $", "taxAdjustment", "tax adjustments", "Add back what the accounts deducted and tax does not allow; take off what tax allows and the accounts did not. Negative reduces profit."),
    field("Donations made to donee organisations $", "donations", "donations"),
    field("Net losses brought forward $", "lossBroughtForward", "losses brought forward"),
    tick("Shareholder continuity has broken (and the business continuity test is not met)", inputs.continuityBroken === true, (v) =>
      patch((d) => {
        if (v) d.continuityBroken = true;
        else delete d.continuityBroken;
      }, "IR4: continuity"),
    ),
    field("Losses from or to other group companies $", "lossOffsets", "group losses", "As the form has it: minus where the company received losses."),
    field("Subvention payments $", "subvention", "subvention payments", "As the form has it: minus where the company made a payment."),
    field("Foreign investor tax credit $", "foreignInvestorCredit", "foreign investor tax credit"),
    field("Provisional tax paid for the year $", "provisionalPaid", "provisional tax paid"),
  );

  // 5. Shareholders
  const holders = entity.shareholders ?? [];
  if (holders.length > 0) {
    body.append(heading("Shareholders, directors and relatives (question 40)"));
    body.append(
      note(
        "Anyone who was paid with no PAYE deducted, had shareholder AIM credits, or was lent money by the company. The current account balances are on the Shareholder current accounts report. Remuneration is liable for ACC earners' levy.",
      ),
    );
    const t = document.createElement("table");
    t.className = "report-table";
    t.innerHTML = "<thead><tr><th>Shareholder</th><th>IRD number</th><th>Remuneration, no PAYE</th><th>AIM credits</th><th>Loans from the company</th></tr></thead>";
    const tb = document.createElement("tbody");
    for (const h of holders) {
      const tr = document.createElement("tr");
      const cell = (control: HTMLElement | string): HTMLTableCellElement => {
        const td = document.createElement("td");
        td.append(control);
        return td;
      };
      const set = (name: "remuneration" | "aimCredits" | "loans", v: Cents | undefined): void =>
        patch((d) => {
          const all = { ...(d.shareholders ?? {}) };
          const mine = { ...(all[h.name] ?? {}) };
          if (v === undefined) delete mine[name];
          else mine[name] = v;
          if (Object.keys(mine).length === 0) delete all[h.name];
          else all[h.name] = mine;
          if (Object.keys(all).length === 0) delete d.shareholders;
          else d.shareholders = all;
        }, `IR4: ${h.name}`);
      const mine = inputs.shareholders?.[h.name];
      tr.append(
        nameCell(h.name),
        nameCell(entity.holderIrd?.[h.name] ?? "—"),
        cell(dollarsBox(mine?.remuneration, (v) => set("remuneration", v))),
        cell(dollarsBox(mine?.aimCredits, (v) => set("aimCredits", v))),
        cell(dollarsBox(mine?.loans, (v) => set("loans", v))),
      );
      tb.append(tr);
    }
    t.append(tb);
    body.append(wrapTable(t));
  }

  // 6. The return
  body.append(heading("The return"));
  const rows = ir4Rows(sheet).filter((r) => r.amount !== 0 || ["23", "25", "29", "30B", "30J", "30L"].includes(r.box));
  body.append(rowsTable(rows, ["23", "25", "29", "30B", "30J", "30L"]));
  for (const text of sheet.notes) body.append(note(text));
  if (sheet.lossCarriedForward > 0) body.append(note(`Net losses of $${money(sheet.lossCarriedForward)} are carried forward to next year.`));
  if (sheet.box.residentialCarried > 0) body.append(note(`Residential deductions of $${money(sheet.box.residentialCarried)} could not be used and are carried forward (box 19I).`));
  const p = sheet.provisionalNext;
  if (p.basis !== "not due") {
    const [a = 0, b = 0, c = 0] = p.instalments;
    body.append(
      note(
        `Provisional tax for next year, on the standard option (${p.basis}): $${money(p.amount)}, in instalments of $${money(a)}, $${money(b)} and $${money(c)}. ` +
          "The estimation and ratio options are on the form's worksheet.",
      ),
    );
  } else {
    body.append(note(`No provisional tax is due next year: ${p.why}`));
  }

  // 7. The imputation credit account
  body.append(heading("Imputation credit account (annual imputation return)"));
  body.append(
    note(
      stored.icaOpening === undefined && carried !== undefined
        ? "It opens with last year's closing balance. Credits are tax paid by the company and imputation credits on dividends it received; debits are refunds and credits attached to dividends it paid."
        : "Credits are tax paid by the company and imputation credits on dividends it received; debits are refunds and credits attached to dividends it paid. Enter the opening balance from last year's return: a debit is negative.",
    ),
  );
  body.append(
    field("Opening balance (debit is negative) $", "icaOpening", "imputation opening balance", "From last year's closing balance; negative for a debit"),
    field("Income tax paid between 1 April and 31 March, by the date paid $", "icaIncomeTaxPaid", "income tax paid", "Provisional tax and end-of-year tax, counted in the tax year the payment is made, whatever year it is for. Not use-of-money interest, imputation penalty tax or other penalties."),
    field("Other credits (not RWT on dividends or RLWT, which are added) $", "icaOtherCredits", "other imputation credits"),
    field("Income tax refunded $", "icaRefunds", "income tax refunded"),
    field("Imputation credits attached to dividends paid $", "icaDividendCredits", "credits attached to dividends"),
    field("Other debits (including a change of shareholding adjustment) $", "icaOtherDebits", "other imputation debits"),
    field("Adjustment to reduce further income tax $", "icaAdjustment", "imputation adjustment"),
  );
  body.append(rowsTable(icaRows(sheet), ["42E", "43D", "44", "44B"]));
  body.append(
    note(
      "The account runs from 1 April to 31 March whatever the balance date, and an entry is dated by the day the payment is made. Credits can only be passed on to shareholders if at least 66% of the voting or market value interests have stayed the same since the credits arose; " +
        "a change of shareholding of more than 34% needs a debit to remove any unused credit. A debit at the end of the tax year is further income tax with a 10% penalty, due 20 June, and a payment towards it goes first to any late payment penalty and interest.",
    ),
  );
  for (const problem of sheet.problems) {
    const warn = note(problem);
    warn.style.color = "var(--warn, #b45309)";
    body.append(warn);
  }

  // 8. Paying a dividend
  body.append(heading("Paying a dividend"));
  body.append(
    note(
      "Credits can be attached up to 28/72 of the dividend (38.89%, or 28% of the gross) and no more than the account holds. The first dividend of a tax year sets the ratio for the rest: later dividends must carry credits at the same ratio, " +
        "unless a ratio change declaration (IR407) is made before paying, or the account is debited. Resident withholding tax of 33% of the gross dividend is deducted, less the imputation credit.",
    ),
  );
  const calc = document.createElement("div");
  calc.className = "journal-card";
  const out = document.createElement("div");
  let dividendNow: Cents | undefined;
  let firstNet: Cents | undefined;
  let firstCredit: Cents | undefined;
  const show = (): void => {
    out.textContent = "";
    if (dividendNow === undefined) return;
    const bench = firstNet !== undefined ? { net: firstNet, credit: (firstCredit ?? 0) as Cents } : undefined;
    const r = dividendImputation(dividendNow, Math.max(0, sheet.ica.closing) as Cents, bench);
    out.append(
      note(
        `Dividend $${money(r.net)}: attach an imputation credit of $${money(r.credit)} (ratio ${r.ratio.toFixed(4)}), making $${money(r.gross)} gross. ` +
          `Deduct RWT of $${money(r.rwt)} and pay the shareholder $${money(r.payable)}. ` +
          (r.benchmark !== null ? `This follows the ratio of the first dividend this tax year (${r.benchmark.ratio.toFixed(4)}). ` : "") +
          (r.limitedByAccount
            ? `The account holds $${money(r.available)}, less than the credit that would be attached: the dividend is not fully imputed, and the shareholder is taxed on the rest at their own rate.`
            : r.credit === r.maximum
              ? "That is the full credit the law allows, and the account covers it."
              : "The account covers it."),
      ),
    );
  };
  const label = document.createElement("label");
  label.className = "year-end-field";
  label.append("Dividend to be paid, in cash $ ", dollarsBox(undefined, (v) => { dividendNow = v; show(); }));
  const first = document.createElement("label");
  first.className = "year-end-field";
  first.append("First dividend this tax year, in cash $ ", dollarsBox(undefined, (v) => { firstNet = v; show(); }), " with credit $ ", dollarsBox(undefined, (v) => { firstCredit = v; show(); }));
  first.title = "If one was already paid this tax year, its ratio is the benchmark for this one.";
  calc.append(label, first, out);
  body.append(calc);

  const save = document.createElement("button");
  save.type = "button";
  save.textContent = "Download the worksheet (CSV)";
  save.addEventListener("click", () => {
    const lines: string[][] = [["Page", "Box", "What", "Amount"]];
    for (const r of ir4Rows(sheet)) lines.push(["IR4", r.box, r.label, (r.amount / 100).toFixed(2)]);
    for (const r of icaRows(sheet)) lines.push(["IR4 imputation", r.box, r.label, (r.amount / 100).toFixed(2)]);
    const text = lines.map((row) => row.map((cell) => spreadsheetCell(cell)).join(",")).join("\r\n");
    download(text, `ir4-worksheet-${year}.csv`, "text/csv");
  });
  body.append(save);

  body.append(
    note(
      "The box numbers are those of the IR4 for the year to 31 March 2026; Inland Revenue renumbers them from year to year, so check each against that year's form. " +
        "Not worked out here: group loss offsets and part-year grouping (enter the figures), the foreign investor tax credit, foreign investment fund and controlled foreign company income, AIM, and the business continuity test. " +
        "Where a choice is the company's to make -- what is income, the tax adjustments, losses -- have an accountant look at it before filing.",
    ),
  );
}
