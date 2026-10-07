import {
  AU_RENTAL_SCHEDULE,
  KR_BUSINESS_STATEMENT,
  KR_RENTAL_STATEMENT,
  auResidentTax,
  SCHEDULE_C,
  SCHEDULE_E,
  basDueDate,
  basQuarters,
  contractorTotals,
  emptyEntityModel,
  estimatedTaxDates,
  formSchedule,
  isRental,
  medicareLevy,
  krIncomeTax,
  krIncomeTaxDue,
  krVatPeriods,
  krVatReturn,
  nec1099Threshold,
  simplerBas,
} from "@nzosa/core";
import type { ContractorPayment, Entity, FormDefinition, FormSchedule } from "@nzosa/core";
import { postedJournals, varianceInput } from "../books.js";
import { state } from "../state.js";
import { note } from "../ui.js";
import { computeOurReturns } from "../variance.js";
import { entityYearReport, scheduleName } from "./reports.js";
import { taxYearEnd, taxYearStart } from "../tax-year.js";
import { booksLocale, moneyPlaces } from "../country.js";

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
  (cents / 100).toLocaleString(booksLocale(), { minimumFractionDigits: moneyPlaces(), maximumFractionDigits: moneyPlaces() });

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
 * Contractors paid over the year's 1099-NEC threshold: every payment posted to
 * an account Schedule C puts on line 11 (contract labor), by payee.
 */
export function renderContractors(body: HTMLElement, year: number): void {
  const title = document.createElement("h3");
  title.textContent = `Contractors and 1099-NEC — ${year}`;
  body.append(title);
  const payments: ContractorPayment[] = [];
  for (const journal of postedJournals()) {
    if (!journal.date.startsWith(String(year))) continue;
    for (const line of journal.lines) {
      if (line.amount <= 0) continue;
      // The line carries the bare code ("460B"); the name is the chart's.
      const code = line.accountCode.trim();
      const name = state.chart.find((one) => one.code.trim() === code)?.name ?? scheduleName(code);
      if (!/contract|subcontract|freelanc/.test(name.toLowerCase())) continue;
      payments.push({ payee: journal.narration || "(no payee)", date: journal.date, amount: line.amount });
    }
  }
  const totals = contractorTotals(payments, year);
  if (totals.length === 0) {
    body.append(note("No payments to contract labor accounts this year."));
    return;
  }
  const table = document.createElement("table");
  table.className = "report-table";
  table.innerHTML = "<thead><tr><th>Payee</th><th>Payments</th><th>Total</th><th>1099-NEC</th></tr></thead>";
  const tbody = document.createElement("tbody");
  for (const one of totals) {
    const tr = document.createElement("tr");
    for (const [text, cls] of [
      [one.payee, "report-name"],
      [String(one.payments), "report-amount"],
      [money(one.total), "report-amount"],
      [one.due ? "Due" : "Not due", "report-note"],
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
      `A 1099-NEC is due for each non-corporate payee paid ${money(nec1099Threshold(year))} or more in ${year}, ` +
        "by 31 January of the next year, with their W-9 details. Payments by card or a payment app are " +
        "reported by the network on a 1099-K instead; take those out. Confirm the threshold for the year.",
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

export function addCountryReports(country: string): void {
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
function ownerIncome(year: number): { owner: string; parts: { entity: string; share: number }[]; total: number }[] {
  const byOwner = new Map<string, { entity: string; share: number }[]>();
  for (const entity of entities()) {
    if (entity.kind === "personal") continue;
    if (!isRental(entity) && entity.structure === "company") continue;
    const report = entityYearReport(entity, year);
    if (report === null) continue;
    for (const owner of entity.owners ?? []) {
      const list = byOwner.get(owner.name) ?? [];
      list.push({ entity: entity.name, share: Math.round((report.netProfit * owner.percent) / 100) });
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
    const levy = medicareLevy(one.total);
    body.append(
      heading,
      estimateTable([
        ...one.parts.map((part) => [`Share of ${part.entity}`, money(part.share)] as const),
        ["Taxable income from these books", money(one.total), true],
        ["Tax at resident rates", tax === null ? "rates not held for this year" : money(tax)],
        ["Medicare levy (2%, before the low-income reduction)", money(levy)],
        ["Estimate", tax === null ? "—" : money(tax + levy), true],
      ]),
    );
  }
  body.append(
    note(
      "Only the income these books hold. Salary, interest, dividends, deductions and offsets (the low " +
        "income tax offset among them) are the return's. A net rental loss reduces other income: " +
        "Australia does not ring-fence it. Confirm the rates for the year with the ATO.",
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
    const tax = krIncomeTax(one.total, year);
    body.append(
      heading,
      estimateTable([
        ...one.parts.map((part) => [`${part.entity} 소득 share`, money(part.share)] as const),
        ["종합소득금액 Income from these books", money(one.total), true],
        ["종합소득세 Income tax (before deductions)", tax === null ? "rates not held for this year" : money(tax.incomeTax)],
        ["지방소득세 Local income tax", tax === null ? "—" : money(tax.localTax)],
        ["합계 Estimate", tax === null ? "—" : money(tax.incomeTax + tax.localTax), true],
      ]),
    );
  }
  body.append(
    note(
      `소득공제·세액공제 전 금액입니다. Before deductions and credits, which are the return's. ` +
        `신고·납부 기한 Due by ${krIncomeTaxDue(year)}. Confirm the rates for the year.`,
    ),
  );
}
