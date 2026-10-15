import { moduleOn } from "../modules.js";
import {
  AU_RENTAL_SCHEDULE,
  KR_BUSINESS_STATEMENT,
  KR_RENTAL_STATEMENT,
  auLowIncomeOffset,
  auResidentTax,
  SCHEDULE_C,
  SCHEDULE_E,
  basDueDate,
  basQuarters,
  contractorTotals,
  emptyEntityModel,
  estimatedTaxDates,
  findContact,
  formSchedule,
  isRental,
  medicareLevy,
  medicareThresholdHeld,
  krIncomeTax,
  krIncomeTaxDue,
  krVatPeriods,
  krVatReturn,
  nec1099Threshold,
  profitAndLossByClass,
  selfEmploymentTax,
  simplerBas,
  usIncomeTaxSingle,
} from "@nzosa/core";
import type { ContractorPayment, Entity, FormDefinition, FormSchedule } from "@nzosa/core";
import { postedJournals, varianceInput } from "../books.js";
import { state } from "../state.js";
import { note } from "../ui.js";
import { computeOurReturns } from "../variance.js";
import { entityYearReport, scheduleName } from "./reports.js";
import { taxYearEnd, taxYearStart } from "../tax-year.js";
import { booksMoney } from "../country.js";

/**
 * The United States' and Australia's forms, as reports.
 *
 * Each is the books' own figures set out on the form's lines, from the same
 * per-entity profit and loss the rest of the reports use, so a form and the
 * profit and loss filtered to the same entity cannot disagree. Every line
 * says which accounts filled it: the line an account lands on is worked out
 * from its name, and a wrong guess has to be easy to see.
 */

/** Grouped, with the currency's decimals: "22,200.00", or "36,000,000" for won. */
const money = (cents: number): string =>
  booksMoney(cents);

function entities(): readonly Entity[] {
  return (state.ledger.entities ?? emptyEntityModel()).entities;
}

/** One filled form as a table: line, amount (and what is allowed, where that differs), accounts. */
function formTable(filled: FormSchedule): HTMLElement {
  const table = document.createElement("table");
  table.className = "report-table";
  const body = document.createElement("tbody");
  const row = (label: string, amount: string, from = "", total = false): void => {
    const tr = document.createElement("tr");
    if (total) tr.className = "report-total";
    for (const [text, cls] of [
      [label, "report-name"],
      [amount, "report-amount"],
      [from, "report-note"],
    ] as const) {
      const td = document.createElement("td");
      td.className = cls;
      td.textContent = text;
      tr.append(td);
    }
    body.append(tr);
  };
  for (const line of filled.lines) {
    if (line.amount === 0) continue;
    const shown =
      line.allowed === line.amount ? money(line.amount) : `${money(line.allowed)} (of ${money(line.amount)})`;
    row(line.title, shown, line.accounts.map((a) => a.name).join(", "));
  }
  if (filled.costOfSales !== 0) row("Cost of goods sold", money(filled.costOfSales), "", true);
  row("Total income", money(filled.totalIncome), "", true);
  row("Total expenses", money(filled.totalExpenses), "", true);
  row(filled.net < 0 ? "Net loss" : "Net income", money(filled.net), "", true);
  table.append(body);
  return table;
}

function formFor(
  body: HTMLElement,
  year: number,
  form: FormDefinition,
  pick: (entity: Entity) => boolean,
  none: string,
): void {
  const chosen = entities().filter(pick);
  if (chosen.length === 0) {
    body.append(note(none));
    return;
  }
  for (const entity of chosen) {
    const report = entityYearReport(entity, year);
    if (report === null) continue;
    const filled = formSchedule(form, report, scheduleName);
    const heading = document.createElement("h3");
    const owners = (entity.owners ?? []).map((o) => `${o.name} ${o.percent}%`).join(" / ");
    heading.textContent = `${entity.name}${owners === "" ? "" : ` — ${owners}`}`;
    body.append(heading, formTable(filled));
  }
  for (const said of form.notes ?? []) body.append(note(said));
}

/** Schedule E, part I: one per rental property. */
export function renderScheduleE(body: HTMLElement, year: number): void {
  const title = document.createElement("h3");
  title.textContent = `Schedule E, Part I — ${year}`;
  body.append(title);
  formFor(body, year, SCHEDULE_E, isRental, "No rental properties in these books. Add one on Entities & accounts.");
}

/** Schedule C: one per business. */
export function renderScheduleC(body: HTMLElement, year: number): void {
  const title = document.createElement("h3");
  title.textContent = `Schedule C — ${year}`;
  body.append(title);
  formFor(
    body,
    year,
    SCHEDULE_C,
    (entity) => (entity.kind ?? "business") === "business",
    "No business in these books. Add one on Entities & accounts.",
  );
  const dates = estimatedTaxDates(year);
  body.append(
    note(
      `Estimated tax for ${year} is paid in four instalments: ${dates.join(", ")}. ` +
        "A date that falls on a federal holiday moves too; check the IRS calendar.",
    ),
  );
}

/**
 * Sales tax: what was collected and what was paid, by the account it sits in.
 *
 * Sales tax in the United States is a liability account for each authority --
 * a state, a county, a district -- and not a rate on each line, so this reads
 * the accounts rather than the lines: every posting to an account whose name
 * says it holds sales tax, credits as collected and debits as paid, with what
 * is still owed. A payment to an authority is a bank line coded to its account.
 */
export function renderSalesTax(body: HTMLElement, year: number): void {
  const title = document.createElement("h3");
  title.textContent = `Sales tax — ${year}`;
  body.append(title);
  const holds = /sales tax|tax payable|board of equalization|dept\. of revenue|department of revenue|use tax/i;
  const accounts = state.chart.filter((a) => /liab/i.test(a.type) && holds.test(a.name));
  if (accounts.length === 0) {
    body.append(note("No sales tax accounts in the chart. A liability account with Sales tax in its name will be read here."));
    return;
  }
  const codes = new Map(accounts.map((a) => [a.code.trim(), a.name]));
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;
  const rows = new Map<string, { before: number; collected: number; paid: number; lines: { date: string; text: string; amount: number }[] }>();
  for (const [, name] of codes) rows.set(name, { before: 0, collected: 0, paid: 0, lines: [] });
  for (const journal of postedJournals()) {
    for (const line of journal.lines) {
      const name = codes.get(line.accountCode.trim());
      const row = name === undefined ? undefined : rows.get(name);
      if (row === undefined) continue;
      // Credit negative in the journals: what is owed is the credit side.
      const owed = -line.amount;
      if (journal.date < start) row.before += owed;
      else if (journal.date <= end) {
        if (owed > 0) row.collected += owed;
        else row.paid += -owed;
        row.lines.push({ date: journal.date, text: journal.narration, amount: owed });
      }
    }
  }
  const table = document.createElement("table");
  table.className = "report-table";
  table.innerHTML =
    "<thead><tr><th>Account</th><th>Owed at 1 January</th><th>Collected</th><th>Paid</th><th>Owed at 31 December</th></tr></thead>";
  const tbody = document.createElement("tbody");
  let totalOwed = 0;
  for (const [name, row] of rows) {
    const owedAtEnd = row.before + row.collected - row.paid;
    totalOwed += owedAtEnd;
    const tr = document.createElement("tr");
    for (const [text, cls] of [
      [name, "report-name"],
      [money(row.before), "report-amount"],
      [money(row.collected), "report-amount"],
      [money(row.paid), "report-amount"],
      [money(owedAtEnd), "report-amount"],
    ] as const) {
      const td = document.createElement("td");
      td.className = cls;
      td.textContent = text;
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(tbody);
  body.append(
    table,
    note(
      `Owed to the authorities at 31 December ${year}: ${money(totalOwed)}. ` +
        "Collected is what customers were charged on invoices and sales; paid is what has gone to the " +
        "state or district. Which sales are taxable, and at what rate for each address, is not worked out " +
        "here: the figures are what the books hold in these accounts.",
    ),
  );
}

/**
 * Payroll tax by quarter, for Form 941: the wages paid, the tax withheld from
 * them, the employer's share, and the deposits made.
 *
 * A worksheet from the books' own accounts, not a payroll engine: it reads
 * what was posted to the accounts named for wages and for each payroll tax,
 * by quarter. The employee-by-employee limits (the Social Security wage base)
 * and the rounding a payroll service does are not here, so the figures are
 * what the books hold and not what a 941 will say to the cent.
 */
export function renderPayrollTax(body: HTMLElement, year: number): void {
  const title = document.createElement("h3");
  title.textContent = `Payroll tax worksheet (Form 941) — ${year}`;
  body.append(title);
  const kinds: { id: "wages" | "income" | "social" | "medicare" | "futa"; pattern: RegExp; label: string }[] = [
    { id: "wages", pattern: /(wages?|salar(y|ies)|payroll expenses?)/i, label: "Wages and salaries" },
    { id: "income", pattern: /federal (income )?(tax )?withh|fit|federal income tax/i, label: "Federal income tax withheld" },
    { id: "social", pattern: /social security|oasdi|fica/i, label: "Social Security tax" },
    { id: "medicare", pattern: /medicare/i, label: "Medicare tax" },
    { id: "futa", pattern: /futa|federal unemployment/i, label: "Federal unemployment (FUTA)" },
  ];
  const byCode = new Map<string, (typeof kinds)[number]["id"]>();
  for (const account of state.chart) {
    const liability = /liab/i.test(account.type);
    const expense = /expense|overhead|direct/i.test(account.type);
    const found = kinds.find((k) => k.pattern.test(account.name));
    if (found === undefined) continue;
    // Wages are an expense; each tax is read from its payable account.
    if (found.id === "wages" ? expense : liability || expense) byCode.set(account.code.trim(), found.id);
  }
  if (!byCode.size || ![...byCode.values()].includes("wages")) {
    body.append(
      note(
        "No wage account found. Name the expense account for wages \"Wages\" or \"Salaries\", and a payable " +
          "account for each tax withheld (\"Federal income tax withheld\", \"Social Security\", \"Medicare\"), " +
          "and they are read here by quarter.",
      ),
    );
    return;
  }
  const quarters = [1, 2, 3, 4].map(() => ({ wages: 0, income: 0, social: 0, medicare: 0, futa: 0, deposits: 0 }));
  for (const journal of postedJournals()) {
    if (!journal.date.startsWith(String(year))) continue;
    const quarter = Math.min(3, Math.floor((Number(journal.date.slice(5, 7)) - 1) / 3));
    const q = quarters[quarter];
    if (q === undefined) continue;
    for (const line of journal.lines) {
      const id = byCode.get(line.accountCode.trim());
      if (id === undefined) continue;
      if (id === "wages") q.wages += line.amount;
      // A payable account: the credit is the tax, a debit is a deposit of it.
      else if (line.amount < 0) q[id] += -line.amount;
      else q.deposits += line.amount;
    }
  }
  const table = document.createElement("table");
  table.className = "report-table";
  table.innerHTML =
    "<thead><tr><th></th><th>Q1</th><th>Q2</th><th>Q3</th><th>Q4</th><th>Year</th></tr></thead>";
  const tbody = document.createElement("tbody");
  const rows: [string, (q: (typeof quarters)[number]) => number, boolean?][] = [
    ["Wages paid (line 2)", (q) => q.wages],
    ["Federal income tax withheld (line 3)", (q) => q.income],
    ["Social Security tax, employee and employer (line 5a)", (q) => q.social],
    ["Medicare tax, employee and employer (line 5c)", (q) => q.medicare],
    ["Total tax (line 6, without adjustments)", (q) => q.income + q.social + q.medicare, true],
    ["Deposits made (line 13)", (q) => q.deposits],
    ["Still to deposit (line 14)", (q) => q.income + q.social + q.medicare - q.deposits, true],
    ["Federal unemployment tax (Form 940)", (q) => q.futa],
  ];
  for (const [label, of, total] of rows) {
    const tr = document.createElement("tr");
    if (total === true) tr.className = "report-total";
    const name = document.createElement("td");
    name.className = "report-name";
    name.textContent = label;
    tr.append(name);
    let sum = 0;
    for (const q of quarters) {
      const td = document.createElement("td");
      td.className = "report-amount";
      const value = of(q);
      sum += value;
      td.textContent = money(value);
      tr.append(td);
    }
    const year4 = document.createElement("td");
    year4.className = "report-amount";
    year4.textContent = money(sum);
    tr.append(year4);
    tbody.append(tr);
  }
  table.append(tbody);
  body.append(
    table,
    note(
      "Read from the accounts named for wages and for each payroll tax; Social Security and Medicare include " +
        "the employer's share only if it was posted to the same account. Limits that depend on each employee " +
        "(the Social Security wage base, the additional Medicare tax) and the number of employees are not worked " +
        "out: use this to check a payroll service's 941, not to file from. Deposits are debits to those accounts.",
    ),
  );
}

/**
 * Budget against actual for a calendar year: each account's budget, what the
 * books hold in it, the difference, and the year to date as the budget spread
 * evenly over the months gone.
 */
export function renderBudgetVsActual(body: HTMLElement, year: number): void {
  const title = document.createElement("h3");
  title.textContent = `Budget vs actual — ${year}`;
  body.append(title);
  const budgets = state.ledger.budgets?.[String(year)] ?? {};
  if (Object.keys(budgets).length === 0) {
    body.append(note(`No budget for ${year}. Set one on the Budgets page.`));
    return;
  }
  const incomeType = /revenue|income|sales/i;
  const costType = /expense|overhead|direct|cost/i;
  const accounts = state.chart.filter((a) => incomeType.test(a.type) || costType.test(a.type));
  const actual = new Map<string, number>();
  const today = new Date();
  for (const journal of postedJournals()) {
    if (!journal.date.startsWith(String(year))) continue;
    for (const line of journal.lines) {
      const code = line.accountCode.trim();
      actual.set(code, (actual.get(code) ?? 0) + line.amount);
    }
  }
  // The months gone: all twelve for a year past, none for one not begun.
  const months = today.getFullYear() > year ? 12 : today.getFullYear() < year ? 0 : today.getMonth() + 1;
  const table = document.createElement("table");
  table.className = "report-table";
  table.innerHTML =
    "<thead><tr><th>Account</th><th>Budget</th><th>Actual</th><th>Difference</th><th>Budget to date</th><th>Actual less to date</th></tr></thead>";
  const tbody = document.createElement("tbody");
  let net = { budget: 0, actual: 0, toDate: 0 };
  const rowFor = (label: string, budget: number, got: number, income: boolean, total = false): void => {
    const toDate = Math.round((budget * months) / 12);
    const tr = document.createElement("tr");
    if (total) tr.className = "report-total";
    const cells: [string, string][] = [
      [label, "report-name"],
      [money(budget), "report-amount"],
      [money(got), "report-amount"],
      // For income more than budget is good; for a cost, less is. Said as
      // the actual less the budget, so the sign has one meaning down the page.
      [money(got - budget), "report-amount"],
      [money(toDate), "report-amount"],
      [money(got - toDate), "report-amount"],
    ];
    void income;
    for (const [text, cls] of cells) {
      const td = document.createElement("td");
      td.className = cls;
      td.textContent = text;
      tr.append(td);
    }
    tbody.append(tr);
  };
  for (const side of ["income", "cost"] as const) {
    const rows = accounts.filter((a) => (side === "income" ? incomeType.test(a.type) : !incomeType.test(a.type) && costType.test(a.type)));
    let b = 0;
    let a2 = 0;
    for (const account of rows) {
      const budget = budgets[account.code] ?? 0;
      // Credits are negative in the journals: income is the other way round.
      const got = side === "income" ? -(actual.get(account.code.trim()) ?? 0) : (actual.get(account.code.trim()) ?? 0);
      if (budget === 0 && got === 0) continue;
      rowFor(`${account.code} ${account.name}`.trim(), budget, got, side === "income");
      b += budget;
      a2 += got;
    }
    rowFor(side === "income" ? "Total income" : "Total expenses", b, a2, side === "income", true);
    net = side === "income" ? { ...net, budget: net.budget + b, actual: net.actual + a2 } : { ...net, budget: net.budget - b, actual: net.actual - a2 };
  }
  rowFor("Net (income less expenses)", net.budget, net.actual, true, true);
  table.append(tbody);
  body.append(
    table,
    note(
      `Difference is actual less budget. The year to date is the budget spread evenly over ${months} of 12 months; ` +
        "a budget with a season in it is better judged against the full year.",
    ),
  );
}

/**
 * Contractors paid over the year's 1099-NEC threshold: every payment posted to
 * an account Schedule C puts on line 11 (contract labor), by payee.
 */
export function renderContractors(body: HTMLElement, year: number): void {
  const title = document.createElement("h3");
  title.textContent = `Contractors and 1099-NEC — ${year}`;
  body.append(title);
  const payments: ContractorPayment[] = [];
  // A bill posts under its number and the supplier's name; the supplier is the
  // payee, so that three bills to one contractor are one total.
  const contactOf = new Map((state.ledger.invoices ?? []).map((i) => [i.number, i.contact]));
  for (const journal of postedJournals()) {
    if (!journal.date.startsWith(String(year))) continue;
    for (const line of journal.lines) {
      if (line.amount <= 0) continue;
      // The line carries the bare code ("460B"); the name is the chart's.
      const code = line.accountCode.trim();
      const name = state.chart.find((one) => one.code.trim() === code)?.name ?? scheduleName(code);
      if (!/contract|subcontract|freelanc/.test(name.toLowerCase())) continue;
      const billed = journal.source === "bill" ? contactOf.get(journal.transactionId) : undefined;
      payments.push({ payee: billed ?? (journal.narration || "(no payee)"), date: journal.date, amount: line.amount });
    }
  }
  const totals = contractorTotals(payments, year);
  if (totals.length === 0) {
    body.append(note("No payments to contract labor accounts this year."));
    return;
  }
  const table = document.createElement("table");
  table.className = "report-table";
  const records = state.ledger.contacts ?? [];
  table.innerHTML =
    "<thead><tr><th>Payee</th><th>Payments</th><th>Total</th><th>1099-NEC</th>" +
    (records.length > 0 ? "<th>W-9</th>" : "") +
    "</tr></thead>";
  const tbody = document.createElement("tbody");
  for (const one of totals) {
    const tr = document.createElement("tr");
    for (const [text, cls] of [
      [one.payee, "report-name"],
      [String(one.payments), "report-amount"],
      [money(one.total), "report-amount"],
      [one.due ? "Due" : "Not due", "report-note"],
      ...(records.length > 0
        ? ([[findContact(records, one.payee)?.w9 === true ? "On file" : one.due ? "Missing" : "", "report-note"]] as const)
        : []),
    ] as const) {
      const td = document.createElement("td");
      td.className = cls;
      td.textContent = text;
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(tbody);
  body.append(
    table,
    note(
      `A 1099-NEC is due for each payee paid ${money(nec1099Threshold(year))} or more for services in ${year}, ` +
        "by 31 January of the next year (the next business day if that is a weekend), with their W-9 details. " +
        "Not for a corporation, except an attorney, who is always reported. Payments by card or through a " +
        "payment processor such as PayPal Business are reported on a 1099-K instead; take those out. " +
        "$600 to 2025; $2,000 from 2026 under the One Big Beautiful Bill Act.",
    ),
  );
}

/** Australia's rental property schedule: one per rental. */
export function renderAuRentalSchedule(body: HTMLElement, year: number): void {
  const title = document.createElement("h3");
  title.textContent = `Rental property schedule — year to 30 June ${year}`;
  body.append(title);
  formFor(body, year, AU_RENTAL_SCHEDULE, isRental, "No rental properties in these books. Add one on Entities & accounts.");
}

/** 표준손익계산서: the business on the standard income statement headings. */
export function renderKrBusiness(body: HTMLElement, year: number): void {
  const title = document.createElement("h3");
  title.textContent = `표준손익계산서 Business income statement — ${year}`;
  body.append(title);
  formFor(
    body,
    year,
    KR_BUSINESS_STATEMENT,
    (entity) => (entity.kind ?? "business") === "business",
    "No business in these books. Add one on Entities & accounts.",
  );
  body.append(note(`종합소득세 신고·납부 기한 Comprehensive income tax is due by ${krIncomeTaxDue(year)}.`));
}

/** 부동산임대업: each rental's income and expenses. */
export function renderKrRental(body: HTMLElement, year: number): void {
  const title = document.createElement("h3");
  title.textContent = `부동산임대업 Rental income — ${year}`;
  body.append(title);
  formFor(body, year, KR_RENTAL_STATEMENT, isRental, "No rental properties in these books. Add one on Entities & accounts.");
}

/** 부가가치세: each half year's VAT, from the returns the books work out. */
export function renderKrVat(body: HTMLElement, year: number): void {
  const title = document.createElement("h3");
  title.textContent = `부가가치세 VAT — ${year}`;
  body.append(title);
  let returns: ReturnType<typeof computeOurReturns> = [];
  try {
    returns = computeOurReturns(varianceInput(), taxYearStart(year), taxYearEnd(year));
  } catch {
    returns = [];
  }
  const table = document.createElement("table");
  table.className = "report-table";
  table.innerHTML =
    "<thead><tr><th>과세기간 Period</th><th>신고기한 Due</th><th>과세표준 Tax base</th><th>매출세액 Output VAT</th><th>매입세액 Input VAT</th><th>납부(환급)세액 Payable</th></tr></thead>";
  const tbody = document.createElement("tbody");
  for (const period of krVatPeriods(year)) {
    const inside = returns.filter((r) => r.period.to >= period.from && r.period.to <= period.to);
    const sum = (key: string): number =>
      inside.reduce((t, r) => t + ((r.boxes as unknown as Record<string, number | undefined>)[key] ?? 0), 0);
    const vat = krVatReturn({ box5: sum("box5"), box6: sum("box6"), box8: sum("box8"), box12: sum("box12"), box13: sum("box13") });
    const tr = document.createElement("tr");
    for (const [text, cls] of [
      [`${period.label} ${period.from} ~ ${period.to}`, "report-name"],
      [period.due, "report-note"],
      [money(vat.taxBase), "report-amount"],
      [money(vat.outputVat), "report-amount"],
      [money(vat.inputVat), "report-amount"],
      [`${money(Math.abs(vat.payable))} ${vat.payable >= 0 ? "납부 to pay" : "환급 refund"}`, "report-amount"],
    ] as const) {
      const td = document.createElement("td");
      td.className = cls;
      td.textContent = text;
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(tbody);
  body.append(
    table,
    note(
      "세금계산서·신용카드·현금영수증 매출은 신고서에서 나누어 적습니다. Tax-invoice, card and cash-receipt " +
        "sales are one figure here; the return splits them. 개인 일반과세자는 4월·10월에 예정고지세액을 납부합니다. " +
        "An individual pays a preliminary amount on notice in April and October.",
    ),
  );
}

/** GST on the BAS, quarter by quarter: G1, 1A, 1B and the net. */
export function renderBas(body: HTMLElement, year: number): void {
  const title = document.createElement("h3");
  title.textContent = `GST on the business activity statement — year to 30 June ${year}`;
  body.append(title);
  let returns: ReturnType<typeof computeOurReturns> = [];
  try {
    returns = computeOurReturns(varianceInput(), taxYearStart(year), taxYearEnd(year));
  } catch {
    returns = [];
  }
  const table = document.createElement("table");
  table.className = "report-table";
  table.innerHTML =
    "<thead><tr><th>Quarter</th><th>Due</th><th>G1 Total sales</th><th>1A GST on sales</th><th>1B GST on purchases</th><th>Net</th></tr></thead>";
  const tbody = document.createElement("tbody");
  for (const quarter of basQuarters(year)) {
    const inside = returns.filter((r) => r.period.to >= quarter.from && r.period.to <= quarter.to);
    const sum = (pick: (b: Record<string, number | undefined>) => number): number =>
      inside.reduce((t, r) => t + pick(r.boxes as unknown as Record<string, number | undefined>), 0);
    const bas = simplerBas({
      box5: sum((b) => b["box5"] ?? 0),
      box8: sum((b) => b["box8"] ?? 0),
      box12: sum((b) => b["box12"] ?? 0),
      box13: sum((b) => b["box13"] ?? 0),
    });
    const tr = document.createElement("tr");
    for (const [text, cls] of [
      [`${quarter.from} to ${quarter.to}`, "report-name"],
      [basDueDate(quarter.to), "report-note"],
      [money(bas.g1), "report-amount"],
      [money(bas.a1), "report-amount"],
      [money(bas.b1), "report-amount"],
      [`${money(Math.abs(bas.net))} ${bas.net >= 0 ? "to pay" : "refund"}`, "report-amount"],
    ] as const) {
      const td = document.createElement("td");
      td.className = cls;
      td.textContent = text;
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(tbody);
  body.append(
    table,
    note(
      "The simpler BAS: G1 includes GST. Due dates are for lodging yourself; a registered tax agent " +
        "lodging electronically usually has longer. PAYG instalments and withholding are not included.",
    ),
  );
}

/**
 * The books' own country's reports, added to the report list once the books
 * are open. Never in the page for anyone else: a hidden option is still in the
 * list, and some browsers have shown hidden options anyway, so books kept in
 * New Zealand get nothing added at all.
 */
const COUNTRY_REPORTS: Record<string, { label: string; options: [string, string][] }> = {
  us: {
    label: "United States",
    options: [
      ["schedulee", "Schedule E (rentals)"],
      ["schedulec", "Schedule C (business)"],
      ["contractors", "Contractors and 1099-NEC"],
      ["ustax", "Self-employment and estimated tax"],
      ["salestax", "Sales tax collected and paid"],
      ["payrolltax", "Payroll tax worksheet (Form 941)"],
    ],
  },
  au: {
    label: "Australia",
    options: [
      ["aurental", "Rental property schedule"],
      ["bas", "GST on the BAS"],
      ["autax", "Income tax estimate"],
    ],
  },
  kr: {
    label: "South Korea",
    options: [
      ["krbusiness", "표준손익계산서 Business income statement"],
      ["krrental", "부동산임대 Rental income"],
      ["krvat", "부가가치세 VAT return"],
      ["krtax", "종합소득세 Income tax estimate"],
    ],
  },
};

/**
 * Budget vs actual and the profit and loss by class, where their modules are
 * on: in any country. Drawn again whenever a module is turned on or off.
 */
export function syncPlanningReports(): void {
  const select = document.getElementById("report-kind");
  if (select === null) return;
  select.querySelector("optgroup[data-planning]")?.remove();
  const wanted: [string, string][] = [
    ...(moduleOn("budgets") ? ([["budget", "Budget vs actual"]] as [string, string][]) : []),
    ...(moduleOn("classes") ? ([["byclass", "Profit and loss by class"]] as [string, string][]) : []),
  ];
  if (wanted.length === 0) return;
  const group = document.createElement("optgroup");
  group.label = "Budgets and classes";
  group.dataset["planning"] = "yes";
  for (const [value, text] of wanted) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    group.append(option);
  }
  const analytics = select.querySelector('optgroup[label="Analytics"]');
  if (analytics !== null) select.insertBefore(group, analytics);
  else select.append(group);
}

if (typeof window !== "undefined") window.addEventListener("nzosa:modules-changed", () => syncPlanningReports());

export function addCountryReports(country: string): void {
  syncPlanningReports();
  const select = document.getElementById("report-kind");
  const wanted = COUNTRY_REPORTS[country];
  if (select === null || wanted === undefined || select.querySelector("optgroup[data-country]") !== null) return;
  const group = document.createElement("optgroup");
  group.label = wanted.label;
  group.dataset["country"] = country;
  for (const [value, text] of wanted.options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    group.append(option);
  }
  const analytics = select.querySelector('optgroup[label="Analytics"]');
  if (analytics !== null) select.insertBefore(group, analytics);
  else select.append(group);
}

/**
 * Each owner's share of what the books earned: every rental and business by
 * the owner's percentage, net. The base for an owner's income tax, before
 * anything the books do not hold (salary, interest, deductions).
 */
function ownerIncome(
  year: number,
): { owner: string; parts: { entity: string; share: number; rental: boolean }[]; total: number }[] {
  const byOwner = new Map<string, { entity: string; share: number; rental: boolean }[]>();
  for (const entity of entities()) {
    if (entity.kind === "personal") continue;
    if (!isRental(entity) && entity.structure === "company") continue;
    const report = entityYearReport(entity, year);
    if (report === null) continue;
    for (const owner of entity.owners ?? []) {
      const list = byOwner.get(owner.name) ?? [];
      list.push({
        entity: entity.name,
        share: Math.round((report.netProfit * owner.percent) / 100),
        rental: isRental(entity),
      });
      byOwner.set(owner.name, list);
    }
  }
  return [...byOwner.entries()].map(([owner, parts]) => ({
    owner,
    parts,
    total: parts.reduce((sum, part) => sum + part.share, 0),
  }));
}

function estimateTable(rows: readonly (readonly [string, string, boolean?])[]): HTMLTableElement {
  const table = document.createElement("table");
  table.className = "report-table";
  const tbody = document.createElement("tbody");
  for (const [label, amount, total] of rows) {
    const tr = document.createElement("tr");
    if (total === true) tr.className = "report-total";
    const name = document.createElement("td");
    name.className = "report-name";
    name.textContent = label;
    const value = document.createElement("td");
    value.className = "report-amount";
    value.textContent = amount;
    tr.append(name, value);
    tbody.append(tr);
  }
  table.append(tbody);
  return table;
}

/**
 * United States: self-employment tax on each owner's business share, federal
 * income tax on the whole at single-filer rates, and the four payments.
 */
export function renderUsTax(body: HTMLElement, year: number): void {
  const title = document.createElement("h3");
  title.textContent = `Self-employment and estimated tax — ${year}`;
  body.append(title);
  const owners = ownerIncome(year);
  if (owners.length === 0) {
    body.append(note("No owners set. On Entities & accounts, give each rental and business its owners and their shares."));
    return;
  }
  const dates = estimatedTaxDates(year);
  for (const one of owners) {
    const heading = document.createElement("h4");
    heading.textContent = one.owner;
    const business = one.parts.filter((part) => !part.rental).reduce((sum, part) => sum + part.share, 0);
    const se = selfEmploymentTax(Math.max(0, business), year);
    const gross = one.total;
    const afterHalf = gross - (se?.deduction ?? 0);
    const income = usIncomeTaxSingle(Math.max(0, afterHalf), year);
    const seTotal = se?.total ?? 0;
    const due = (income?.tax ?? 0) + seTotal;
    const rows: (readonly [string, string, boolean?])[] = [
      ...one.parts.map((part) => [`${part.rental ? "Schedule E" : "Schedule C"}: ${part.entity}`, money(part.share)] as const),
      ["Net income from these books", money(gross), true],
      [
        "Self-employment tax (Schedule SE)",
        se === null ? "rates not held for this year" : money(seTotal),
      ],
      ["Half of it, deducted from income", se === null ? "—" : `-${money(se.deduction)}`],
      ["Standard deduction (single)", income === null ? "—" : `-${money(Math.min(income.standardDeduction, Math.max(0, afterHalf)))}`],
      ["Taxable income", income === null ? "—" : money(income.taxableIncome)],
      ["Federal income tax", income === null ? "rates not held for this year" : money(income.tax)],
      ["Estimated tax for the year", se === null || income === null ? "—" : money(due), true],
    ];
    body.append(heading, estimateTable(rows));
    if (se !== null && income !== null && dates.length === 4) {
      const quarter = Math.round(due / 4);
      body.append(
        estimateTable(
          dates.map((day, i) => [`Payment ${i + 1}, due ${day}`, money(i === 3 ? due - quarter * 3 : quarter)] as const),
        ),
      );
    }
  }
  body.append(
    note(
      "Only the income these books hold, for a single filer taking the standard deduction. Wages, interest, " +
        "dividends, the 20% qualified business income deduction, credits, other deductions and state tax are " +
        "the return's, as is a different filing status. Self-employment tax is on Schedule C profit only, not " +
        "rental income. The four payments are the year's total in equal parts; safe-harbour rules may allow " +
        "less. Rates and thresholds per the IRS for 2025 and 2026: confirm them before paying.",
    ),
  );
}

/** Australia: each owner's share, resident tax on it and the Medicare levy. */
export function renderAuTax(body: HTMLElement, year: number): void {
  const title = document.createElement("h3");
  title.textContent = `Income tax estimate — year to 30 June ${year}`;
  body.append(title);
  const owners = ownerIncome(year);
  if (owners.length === 0) {
    body.append(note("No owners set. On Entities & accounts, give each rental and business its owners and their shares."));
    return;
  }
  for (const one of owners) {
    const heading = document.createElement("h4");
    heading.textContent = one.owner;
    const tax = auResidentTax(one.total, year);
    const lito = auLowIncomeOffset(one.total, year);
    const afterOffset = tax === null ? null : Math.max(0, tax - (lito ?? 0));
    const levy = medicareLevy(one.total, year);
    body.append(
      heading,
      estimateTable([
        ...one.parts.map((part) => [`Share of ${part.entity}`, money(part.share)] as const),
        ["Taxable income from these books", money(one.total), true],
        ["Tax at resident rates", tax === null ? "rates not held for this year" : money(tax)],
        ["Low income tax offset", lito === null ? "not held for this year" : `-${money(Math.min(lito, tax ?? 0))}`],
        [
          medicareThresholdHeld(year) ? "Medicare levy (2%, single low-income reduction applied)" : "Medicare levy (2%, low-income reduction not applied)",
          money(levy),
        ],
        ["Estimate", afterOffset === null ? "—" : money(afterOffset + levy), true],
      ]),
    );
  }
  body.append(
    note(
      "Only the income these books hold. Salary, interest, dividends, deductions and other offsets are " +
        "the return's, and the low income tax offset is worked on this income alone. A net rental loss " +
        "reduces other income; from 1 July 2027 only for a new build or a property held at 7:30 pm AEST " +
        "on 12 May 2026. Rates per the OpenAccountants Australian rates card (2025-26 and 2026-27); " +
        "confirm them with the ATO.",
    ),
  );
}

/** South Korea: each owner's 종합소득금액 share, income tax and local income tax. */
export function renderKrTax(body: HTMLElement, year: number): void {
  const title = document.createElement("h3");
  title.textContent = `종합소득세 추정 Comprehensive income tax estimate — ${year}`;
  body.append(title);
  const owners = ownerIncome(year);
  if (owners.length === 0) {
    body.append(note("No owners set. On Entities & accounts, give each rental and business its owners and their shares."));
    return;
  }
  for (const one of owners) {
    const heading = document.createElement("h4");
    heading.textContent = one.owner;
    // 기본공제 for the taxpayer alone (1,500,000 won); spouse, dependants,
    // pension and health insurance are the return's.
    const BASIC = 150_000_000;
    const taxBase = Math.max(0, one.total - BASIC);
    const tax = krIncomeTax(taxBase, year);
    // 표준세액공제 70,000 won, where no other special deductions are claimed.
    const STANDARD_CREDIT = 7_000_000;
    const national = tax === null ? null : Math.max(0, tax.incomeTax - STANDARD_CREDIT);
    const local = national === null ? null : Math.floor(national / 10 / 100) * 100;
    body.append(
      heading,
      estimateTable([
        ...one.parts.map((part) => [`${part.entity} 소득 share`, money(part.share)] as const),
        ["종합소득금액 Income from these books", money(one.total), true],
        ["기본공제 Basic deduction (self)", `-${money(Math.min(BASIC, Math.max(0, one.total)))}`],
        ["과세표준 Tax base (to the 10,000 won)", money(Math.floor(taxBase / 1_000_000) * 1_000_000)],
        ["산출세액 Income tax", tax === null ? "rates not held for this year" : money(tax.incomeTax)],
        ["표준세액공제 Standard tax credit", tax === null ? "—" : `-${money(Math.min(STANDARD_CREDIT, tax.incomeTax))}`],
        ["지방소득세 Local income tax (10%)", local === null ? "—" : money(local)],
        ["합계 Estimate", national === null || local === null ? "—" : money(national + local), true],
      ]),
    );
  }
  body.append(
    note(
      "본인 기본공제와 표준세액공제만 반영했습니다. Only the basic deduction for the taxpayer and the standard " +
        "credit are applied; family deductions, pension and health insurance (소득공제), other credits, " +
        "withholding (3.3%) and prepayments are the return's. " +
        `신고·납부 기한 Due by ${krIncomeTaxDue(year)}. 전년도 세액이 30만원을 넘으면 11월 30일까지 중간예납. ` +
        "Over 300,000 won of tax last year, half is prepaid by 30 November. Rates per the OpenAccountants " +
        "Korean income tax guide (Yeong Min Lee); confirm them on Hometax.",
    ),
  );
}

/**
 * Income and expense for the year, a column for each class and one for what
 * has none, and the books' total beside them so the columns can be seen to add
 * up to the profit and loss.
 */
export function renderProfitByClass(body: HTMLElement, year: number): void {
  const from = taxYearStart(year);
  const to = taxYearEnd(year);
  const title = document.createElement("h3");
  title.textContent = `Profit and loss by class — ${from} to ${to}`;
  body.append(title);
  const incomeType = /revenue|income|sales/i;
  const costType = /expense|overhead|direct|cost/i;
  const accounts = state.chart.filter((a) => incomeType.test(a.type) || costType.test(a.type));
  const codes = new Set(accounts.map((a) => a.code.trim()));
  const columns = profitAndLossByClass(postedJournals(), state.ledger.classes?.assigned ?? {}, (code) => codes.has(code), {
    from,
    to,
  });
  if (columns.length === 0) {
    body.append(note("Nothing posted to income or expense in this year."));
    return;
  }
  const table = document.createElement("table");
  table.className = "report-table";
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const text of ["Account", ...columns.map((c) => c.name), "Total"]) {
    const th = document.createElement("th");
    th.textContent = text;
    headRow.append(th);
  }
  head.append(headRow);
  const tbody = document.createElement("tbody");
  const row = (label: string, figures: number[], total = false): void => {
    const tr = document.createElement("tr");
    if (total) tr.className = "report-total";
    const name = document.createElement("td");
    name.className = "report-name";
    name.textContent = label;
    tr.append(name);
    for (const figure of [...figures, figures.reduce((s, f) => s + f, 0)]) {
      const td = document.createElement("td");
      td.className = "report-amount";
      td.textContent = money(figure);
      tr.append(td);
    }
    tbody.append(tr);
  };
  const net = columns.map(() => 0);
  for (const side of ["income", "cost"] as const) {
    const rows = accounts.filter((a) =>
      side === "income" ? incomeType.test(a.type) : !incomeType.test(a.type) && costType.test(a.type),
    );
    const sums = columns.map(() => 0);
    for (const account of rows) {
      // Credits are negative in the journals: income is turned round.
      const figures = columns.map((c) => {
        const got = c.byAccount.get(account.code.trim()) ?? 0;
        return side === "income" ? -got : got;
      });
      if (figures.every((f) => f === 0)) continue;
      row(`${account.code} ${account.name}`.trim(), figures);
      figures.forEach((f, i) => (sums[i] = (sums[i] ?? 0) + f));
    }
    row(side === "income" ? "Total income" : "Total expenses", sums, true);
    sums.forEach((f, i) => (net[i] = (net[i] ?? 0) + (side === "income" ? f : -f)));
  }
  row("Net profit", net, true);
  table.append(head, tbody);
  const scroller = document.createElement("div");
  scroller.className = "table-scroll";
  scroller.append(table);
  body.append(scroller, note("Classes are given on the Classes page. An invoice's payment goes with the invoice."));
}
