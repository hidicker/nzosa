import type { Cents } from "./money.js";
import type { IsoDate } from "./dates.js";
import type { Account } from "./chart.js";
import type { PostedJournal } from "./posting.js";
import { defaultTier4Line } from "./tier4-report.js";
import type { CashStatement, PerformanceInputs, Tier4Line } from "./tier4-report.js";

/**
 * The Tier 3 performance report, for a not-for-profit entity that reports on
 * the accrual basis: a charity or society with operating payments of $140,000
 * or more (or one that chooses it), and under $5 million of expenses.
 *
 * Built from the XRB's Tier 3 (NFP) Standard (PBE SFR-A (NFP), issued May
 * 2023, for periods beginning on or after 1 April 2024), read in October 2026.
 * Check it again before relying on this for a filing. The report is, in the
 * standard's order:
 *
 * 1. Entity information;
 * 2. a statement of service performance;
 * 3. a statement of financial performance: revenue and expenses, each in the
 *    standard's categories, to a surplus or deficit (income tax, if any, on a
 *    separate line below it);
 * 4. a statement of financial position: assets, liabilities and accumulated
 *    funds, with assets and liabilities in the standard's categories and split
 *    between current and non-current;
 * 5. a statement of cash flows: cash received and paid from operating and from
 *    other activities (the cash statement of the Tier 4 report has the same
 *    categories, and is used);
 * 6. a statement of accounting policies, which says the entity is eligible and
 *    has elected Tier 3, that everything is on the accrual basis and the entity
 *    is a going concern, and whether it is GST registered and whether the
 *    report includes or excludes GST;
 * 7. notes.
 *
 * What is built from the books here is the money: the statement of financial
 * performance, the statement of financial position, the cash flows and the
 * movements in each class of fixed asset and each fund. What the organisation
 * did, who is related to whom, and what it is committed to are the
 * committee's to say.
 */

export type Tier3Revenue =
  | "donations"
  | "generalGrants"
  | "capitalGrants"
  | "governmentService"
  | "otherService"
  | "membership"
  | "commercial"
  | "investment"
  | "otherRevenue";

export const TIER3_REVENUE: readonly (readonly [Tier3Revenue, string])[] = [
  ["donations", "Donations, koha, bequests and other general fundraising activities"],
  ["generalGrants", "General grants"],
  ["capitalGrants", "Capital grants and donations"],
  ["governmentService", "Government service delivery grants and contracts"],
  ["otherService", "Non-government service delivery grants and contracts"],
  ["membership", "Membership fees and subscriptions"],
  ["commercial", "Revenue from commercial activities"],
  ["investment", "Interest, dividends and other investment revenue"],
  ["otherRevenue", "Other revenue"],
];

export type Tier3Expense = "fundraising" | "employee" | "volunteer" | "commercial" | "service" | "grantsPaid" | "other";

export const TIER3_EXPENSES: readonly (readonly [Tier3Expense, string])[] = [
  ["fundraising", "Expenses related to fundraising"],
  ["employee", "Employee remuneration and other related expenses"],
  ["volunteer", "Volunteer related expenses"],
  ["commercial", "Expenses related to commercial activities"],
  ["service", "Other expenses related to service delivery"],
  ["grantsPaid", "Grants and donations made"],
  ["other", "Other expenses"],
];

export type Tier3Asset = "cash" | "debtors" | "inventory" | "property" | "investments";

export const TIER3_ASSETS: readonly (readonly [Tier3Asset, string])[] = [
  ["cash", "Cash and short-term deposits"],
  ["debtors", "Debtors and prepayments"],
  ["inventory", "Inventory"],
  ["property", "Property, plant and equipment"],
  ["investments", "Investments"],
];

export type Tier3Liability = "overdraft" | "creditors" | "employee" | "deferred" | "loans";

export const TIER3_LIABILITIES: readonly (readonly [Tier3Liability, string])[] = [
  ["overdraft", "Bank overdraft"],
  ["creditors", "Creditors and accrued expenses"],
  ["employee", "Employee costs payable"],
  ["deferred", "Deferred revenue"],
  ["loans", "Loans"],
];

/** The revenue category an income account falls in, from the line it has in the Tier 4 cash statement. */
export function tier3RevenueOf(account: Pick<Account, "name" | "type">, line: Tier4Line): Tier3Revenue {
  const name = account.name.toLowerCase();
  if (/capital grant|capital donation|building fund|capital appeal/.test(name)) return "capitalGrants";
  switch (line) {
    case "donations":
      return "donations";
    case "generalGrants":
      return "generalGrants";
    case "serviceGrants":
      return /government|council|ministry|\bmsd\b|\bmoh\b|\bacc\b|health nz|te whatu|oranga tamariki|\bdia\b/.test(name) ? "governmentService" : "otherService";
    case "membership":
      return "membership";
    case "sales":
      return "commercial";
    case "interest":
      return "investment";
    default:
      return "otherRevenue";
  }
}

export function tier3ExpenseOf(line: Tier4Line): Tier3Expense {
  switch (line) {
    case "fundraisingCosts":
      return "fundraising";
    case "employee":
      return "employee";
    case "volunteer":
      return "volunteer";
    case "costOfSales":
      return "commercial";
    case "objectives":
      return "service";
    case "grantsPaid":
      return "grantsPaid";
    default:
      return "other";
  }
}

export interface Tier3Line {
  code: string;
  name: string;
  amount: Cents;
}

export interface Tier3Group<K extends string> {
  key: K;
  label: string;
  total: Cents;
  lines: Tier3Line[];
}

export interface Tier3Statements {
  from: IsoDate;
  to: IsoDate;
  revenue: Tier3Group<Tier3Revenue>[];
  expenses: Tier3Group<Tier3Expense>[];
  totalRevenue: Cents;
  totalExpenses: Cents;
  /** Before income tax. */
  surplus: Cents;
  incomeTax: Cents;
  surplusAfterTax: Cents;
  currentAssets: Tier3Group<Tier3Asset>[];
  nonCurrentAssets: Tier3Group<Tier3Asset>[];
  currentLiabilities: Tier3Group<Tier3Liability>[];
  nonCurrentLiabilities: Tier3Group<Tier3Liability>[];
  totalAssets: Cents;
  totalLiabilities: Cents;
  netAssets: Cents;
  /** The funds, each with its balance, and the year's surplus and what was earned before. */
  funds: { label: string; amount: Cents }[];
  /** Fixed assets by account: carrying amount at the start and end, and what was depreciated. */
  propertyNote: { name: string; opening: Cents; closing: Cents }[];
  depreciation: Cents;
  /** Movements in each fund over the year. */
  fundMovements: { label: string; opening: Cents; closing: Cents }[];
  /** Deferred revenue is held, so the notes must say what it is for and when it will be used. */
  deferredRevenueNeeded: boolean;
}

function group<K extends string>(order: readonly (readonly [K, string])[], rows: Map<K, Tier3Line[]>): Tier3Group<K>[] {
  return order
    .map(([key, label]) => {
      const lines = rows.get(key) ?? [];
      return { key, label, total: lines.reduce((s, l) => s + l.amount, 0) as Cents, lines };
    })
    .filter((g) => g.lines.length > 0);
}

function push<K>(map: Map<K, Tier3Line[]>, key: K, line: Tier3Line): void {
  const list = map.get(key) ?? [];
  list.push(line);
  map.set(key, list);
}

const sumOf = (groups: readonly { total: number }[]): Cents => groups.reduce((s, g) => s + g.total, 0) as Cents;

/** The statement of financial performance, the statement of financial position and their notes, from the books. */
export function tier3Statements(options: {
  journals: readonly PostedJournal[];
  chart: readonly Account[];
  from: IsoDate;
  to: IsoDate;
  /** An account's line in the Tier 4 cash statement, where it has been set. */
  mapping?: Readonly<Record<string, Tier4Line>> | undefined;
  only?: ((account: Account) => boolean) | undefined;
}): Tier3Statements {
  const { from, to } = options;
  const during = new Map<string, number>();
  const atEnd = new Map<string, number>();
  const atStart = new Map<string, number>();
  for (const j of options.journals) {
    for (const l of j.lines) {
      const code = l.accountCode.trim();
      if (j.date <= to) atEnd.set(code, (atEnd.get(code) ?? 0) + l.amount);
      if (j.date < from) atStart.set(code, (atStart.get(code) ?? 0) + l.amount);
      if (j.date >= from && j.date <= to) during.set(code, (during.get(code) ?? 0) + l.amount);
    }
  }
  const revenue = new Map<Tier3Revenue, Tier3Line[]>();
  const expenses = new Map<Tier3Expense, Tier3Line[]>();
  const currentAssets = new Map<Tier3Asset, Tier3Line[]>();
  const nonCurrentAssets = new Map<Tier3Asset, Tier3Line[]>();
  const currentLiabilities = new Map<Tier3Liability, Tier3Line[]>();
  const nonCurrentLiabilities = new Map<Tier3Liability, Tier3Line[]>();
  const funds: { label: string; amount: Cents }[] = [];
  const fundMovements: { label: string; opening: Cents; closing: Cents }[] = [];
  const propertyNote: { name: string; opening: Cents; closing: Cents }[] = [];
  let incomeTax = 0;
  let depreciation = 0;
  let equityTotal = 0;

  for (const account of options.chart) {
    if (options.only !== undefined && !options.only(account)) continue;
    const code = (account.ledgerAccount ?? "").trim() || account.code.trim();
    if (code === "") continue;
    const type = account.type.toLowerCase();
    const name = account.name.toLowerCase();
    const line = (n: number): Tier3Line => ({ code, name: account.name, amount: n as Cents });
    const ledgerLine = options.mapping?.[account.code.trim()] ?? defaultTier4Line(account);
    const year = during.get(code) ?? 0;
    const end = atEnd.get(code) ?? 0;
    const start = atStart.get(code) ?? 0;

    if (/revenue|other income|sales/.test(type) && !/expense/.test(type)) {
      if (year !== 0) push(revenue, tier3RevenueOf(account, ledgerLine), line(-year));
    } else if (/expense|overhead|direct cost|depreciation/.test(type)) {
      if (year === 0) continue;
      if (ledgerLine === "incomeTax") incomeTax += year;
      else {
        push(expenses, tier3ExpenseOf(ledgerLine), line(year));
        if (/depreciation|amortisation/.test(name) || /depreciation/.test(type)) depreciation += year;
      }
    } else if (/equity/.test(type)) {
      if (end !== 0 || start !== 0) {
        funds.push({ label: account.name, amount: -end as Cents });
        fundMovements.push({ label: account.name, opening: -start as Cents, closing: -end as Cents });
        equityTotal += -end;
      }
    } else if (end !== 0) {
      if (/liabilit|payable/.test(type) || (/bank/.test(type) && end < 0)) {
        const amount = -end;
        const current = !/non-?current|term|long.?term/.test(type);
        let kind: Tier3Liability = "creditors";
        if (/bank/.test(type)) kind = "overdraft";
        else if (/paye|kiwisaver|acc levy|wages|salar|holiday|leave|employee|payroll/.test(name)) kind = "employee";
        else if (/in advance|deferred|unspent|unearned|received in advance/.test(name)) kind = "deferred";
        else if (/loan|mortgage|borrow/.test(name) || /non-?current liab/.test(type)) kind = "loans";
        push(current ? currentLiabilities : nonCurrentLiabilities, kind, line(amount));
      } else if (/asset|bank|receivable|inventory|prepay/.test(type)) {
        let kind: Tier3Asset = "cash";
        let current = true;
        const isInvestment = /invest|shares|bonds|managed fund|unit trust/.test(name);
        if (/fixed/.test(type) || (/non-?current/.test(type) && !isInvestment)) {
          kind = "property";
          current = false;
          propertyNote.push({ name: account.name, opening: start as Cents, closing: end as Cents });
        } else if (isInvestment) {
          kind = "investments";
          current = !/non-?current|long.?term/.test(type) && /term deposit|short/.test(name);
        } else if (/inventory|stock/.test(type) || /inventory|stock on hand/.test(name)) kind = "inventory";
        else if (/receivable|debtor|prepay/.test(type) || /receivable|debtor|prepay/.test(name)) kind = "debtors";
        else kind = "cash";
        push(current ? currentAssets : nonCurrentAssets, kind, line(end));
      }
    }
  }

  const revenueGroups = group(TIER3_REVENUE, revenue);
  const expenseGroups = group(TIER3_EXPENSES, expenses);
  const totalRevenue = sumOf(revenueGroups);
  const totalExpenses = sumOf(expenseGroups);
  const surplus = (totalRevenue - totalExpenses) as Cents;
  const ca = group(TIER3_ASSETS, currentAssets);
  const nca = group(TIER3_ASSETS, nonCurrentAssets);
  const cl = group(TIER3_LIABILITIES, currentLiabilities);
  const ncl = group(TIER3_LIABILITIES, nonCurrentLiabilities);
  const totalAssets = (sumOf(ca) + sumOf(nca)) as Cents;
  const totalLiabilities = (sumOf(cl) + sumOf(ncl)) as Cents;
  const netAssets = (totalAssets - totalLiabilities) as Cents;
  const surplusAfterTax = (surplus - incomeTax) as Cents;
  // The surplus of earlier years, and of this one, that has not been moved into a fund.
  const retained = netAssets - equityTotal - surplusAfterTax;
  const allFunds = [
    ...funds,
    ...(retained !== 0 ? [{ label: "Accumulated surplus from earlier years", amount: retained as Cents }] : []),
    { label: "Surplus or deficit for the year", amount: surplusAfterTax },
  ];

  return {
    from,
    to,
    revenue: revenueGroups,
    expenses: expenseGroups,
    totalRevenue,
    totalExpenses,
    surplus,
    incomeTax: incomeTax as Cents,
    surplusAfterTax,
    currentAssets: ca,
    nonCurrentAssets: nca,
    currentLiabilities: cl,
    nonCurrentLiabilities: ncl,
    totalAssets,
    totalLiabilities,
    netAssets,
    funds: allFunds,
    propertyNote,
    depreciation: depreciation as Cents,
    fundMovements,
    deferredRevenueNeeded: [...cl, ...ncl].some((g) => g.key === "deferred" && g.total !== 0),
  };
}

/** What the committee says for Tier 3, beside what the Tier 4 report already holds. */
export interface Tier3Inputs {
  /** The organisation's purpose or mission, for Entity Information. */
  purpose?: string | undefined;
  /** Whether it has branches or separate units, and how it is governed. */
  structure?: string | undefined;
  governance?: string | undefined;
  /** Entities it controls, and its reliance on volunteers and donated goods or services. */
  controlled?: string | undefined;
  volunteers?: string | undefined;
  /** Specific accounting policies, and any change in them. */
  policies?: string | undefined;
  policyChanges?: string | undefined;
  /** Notes the standard asks for where they apply. */
  deferredRevenue?: string | undefined;
  inKind?: string | undefined;
  commitments?: string | undefined;
  contingent?: string | undefined;
  reserves?: string | undefined;
  security?: string | undefined;
  heldForOthers?: string | undefined;
  /** The report includes GST (the books are GST-inclusive) or excludes it. */
  gstExclusive?: boolean | undefined;
}

export function tier3Problems(options: {
  statements: Tier3Statements;
  inputs: Tier3Inputs;
  performance: PerformanceInputs;
  gstRegistered: boolean;
}): string[] {
  const out: string[] = [];
  const { statements: s, inputs, performance } = options;
  if ((inputs.purpose ?? "").trim() === "") out.push("Entity information: say what the organisation is for.");
  if ((inputs.governance ?? "").trim() === "") out.push("Entity information: say how it is governed, and who makes the key decisions.");
  if ((inputs.volunteers ?? "").trim() === "") out.push("Entity information: say how much it relies on volunteers and donated goods or services.");
  if (performance.activities.filter((a) => a.what.trim() !== "").length === 0) out.push("The statement of service performance has no activities yet.");
  if (s.funds.length === 0) out.push("No fund or accumulated funds account was found.");
  if (s.deferredRevenueNeeded) out.push("There is deferred revenue: say what the documented expectations over its use are, and when they will be met.");
  if (s.propertyNote.length > 0 && s.depreciation === 0) out.push("Fixed assets are held but no depreciation was recorded this year.");
  if (performance.approvedBy.filter((n) => n.trim() !== "").length < 2) out.push("Two people approve the report: name them on the Annual report page.");
  return out;
}

function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function dateSaid(date: IsoDate): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${d} ${months[m - 1] ?? ""} ${y}`;
}

const dollar = (cents: number): number => Math.round(cents / 100);

function money(whole: number): string {
  const text = Math.abs(whole).toLocaleString("en-NZ");
  return whole < 0 ? `(${text})` : text;
}

/**
 * The Tier 3 report as a page to print or save as a PDF, in the standard's
 * order, whole dollars, with the entity, the year and the rounding at the top
 * of every page. The cash flows are the cash statement of the Tier 4 report.
 */
export function tier3ReportHtml(options: {
  entity: { name: string; legalForm: string };
  gstRegistered: boolean;
  statements: Tier3Statements;
  previous: Tier3Statements | null;
  cash: CashStatement;
  previousCash: CashStatement;
  inputs: Tier3Inputs;
  performance: PerformanceInputs;
}): string {
  const { entity, statements: s, previous: p, inputs, performance } = options;
  const year = `Year ended ${dateSaid(s.to)}`;
  const running = `<p class="running">${escape(entity.name)} &middot; ${escape(year)} &middot; amounts in whole dollars</p>`;
  const th = `<thead><tr><th></th><th class="n">${s.to.slice(0, 4)}<br>$</th><th class="n">${p !== null ? p.to.slice(0, 4) : ""}<br>$</th></tr></thead>`;
  const prevOf = (list: readonly { label: string; total: number }[] | undefined, label: string): number | null =>
    list === undefined ? null : (list.find((g) => g.label === label)?.total ?? 0);
  const num = (n: number | null): string => (n === null ? "" : money(dollar(n)));
  const row = (label: string, cur: number, prev: number | null, cls = ""): string =>
    `<tr class="${cls}"><td>${escape(label)}</td><td class="n">${money(dollar(cur))}</td><td class="n">${num(prev)}</td></tr>`;
  const groups = (list: readonly { label: string; total: number }[], before: readonly { label: string; total: number }[] | undefined): string =>
    list.map((g) => row(g.label, g.total, before === undefined ? null : prevOf(before, g.label), "indent")).join("");

  const performanceStatement = `
<table>${th}<tbody>
<tr class="head"><td colspan="3">Revenue</td></tr>
${groups(s.revenue, p?.revenue)}
${row("Total revenue", s.totalRevenue, p?.totalRevenue ?? null, "strong")}
<tr class="head"><td colspan="3">Expenses</td></tr>
${groups(s.expenses, p?.expenses)}
${row("Total expenses", s.totalExpenses, p?.totalExpenses ?? null, "strong")}
${row("Surplus or (deficit)", s.surplus, p?.surplus ?? null, "strong")}
${s.incomeTax !== 0 || (p?.incomeTax ?? 0) !== 0 ? row("Income tax", s.incomeTax, p?.incomeTax ?? null) + row("Surplus or (deficit) after tax", s.surplusAfterTax, p?.surplusAfterTax ?? null, "strong") : ""}
</tbody></table>`;

  const section = (title: string, cur: readonly { label: string; total: number }[], before: readonly { label: string; total: number }[] | undefined): string =>
    cur.length === 0 ? "" : `<tr class="sub"><td colspan="3">${escape(title)}</td></tr>${groups(cur, before)}`;
  const position = `
<table>${th}<tbody>
<tr class="head"><td colspan="3">Assets</td></tr>
${section("Current assets", s.currentAssets, p?.currentAssets)}
${section("Non-current assets", s.nonCurrentAssets, p?.nonCurrentAssets)}
${row("Total assets", s.totalAssets, p?.totalAssets ?? null, "strong")}
<tr class="head"><td colspan="3">Liabilities</td></tr>
${section("Current liabilities", s.currentLiabilities, p?.currentLiabilities)}
${section("Non-current liabilities", s.nonCurrentLiabilities, p?.nonCurrentLiabilities)}
${row("Total liabilities", s.totalLiabilities, p?.totalLiabilities ?? null, "strong")}
${row("Net assets", s.netAssets, p?.netAssets ?? null, "strong")}
<tr class="head"><td colspan="3">Accumulated funds</td></tr>
${s.funds.map((f) => row(f.label, f.amount, null, "indent")).join("")}
${row("Total accumulated funds", s.netAssets, p?.netAssets ?? null, "strong")}
</tbody></table>`;

  const c = options.cash.dollars;
  const pc = options.previousCash.dollars;
  const cr = (label: string, cur: number, prev: number, cls = ""): string =>
    `<tr class="${cls}"><td>${escape(label)}</td><td class="n">${money(cur)}</td><td class="n">${money(prev)}</td></tr>`;
  const lines = (keys: readonly (readonly [Tier4Line, string])[]): string =>
    keys
      .filter(([k]) => c.lines[k] !== 0 || pc.lines[k] !== 0)
      .map(([k, label]) => cr(label, c.lines[k], pc.lines[k], "indent"))
      .join("");
  const received: readonly (readonly [Tier4Line, string])[] = [
    ["donations", "Donations, koha, bequests and other general fundraising activities"],
    ["generalGrants", "General grants"],
    ["serviceGrants", "Service delivery grants and contracts"],
    ["membership", "Membership fees and subscriptions"],
    ["sales", "Gross sales from commercial activities"],
    ["interest", "Interest, dividends and other investment receipts"],
    ["otherReceived", "Other cash received"],
  ];
  const paid: readonly (readonly [Tier4Line, string])[] = [
    ["fundraisingCosts", "Payments related to public fundraising"],
    ["employee", "Employee remuneration and other related payments"],
    ["volunteer", "Volunteer related payments"],
    ["costOfSales", "Payments related to commercial activities"],
    ["objectives", "Other payments related to service delivery"],
    ["grantsPaid", "Grants and donations paid"],
    ["otherPaid", "Other payments"],
    ["gst", "GST paid to or refunded by Inland Revenue"],
  ];
  const otherReceived: readonly (readonly [Tier4Line, string])[] = [
    ["saleAssets", "Sale of property, plant and equipment"],
    ["saleInvestments", "Sale of investments"],
    ["loansReceived", "Cash received from loans from other parties"],
  ];
  const otherPaid: readonly (readonly [Tier4Line, string])[] = [
    ["purchaseAssets", "Payments to acquire property, plant and equipment"],
    ["purchaseInvestments", "Payments to purchase investments"],
    ["loansRepaid", "Repayments of loans from other parties"],
  ];
  const cashFlows = `
<table><thead><tr><th></th><th class="n">${options.cash.year}<br>$</th><th class="n">${options.previousCash.year}<br>$</th></tr></thead><tbody>
<tr class="head"><td colspan="3">Cash flows from operating activities</td></tr>
<tr class="sub"><td colspan="3">Cash received</td></tr>${lines(received)}
<tr class="sub"><td colspan="3">Cash paid</td></tr>${lines(paid)}
${cr("Net cash from operating activities", c.operatingSurplus, pc.operatingSurplus, "strong")}
<tr class="head"><td colspan="3">Cash flows from other activities</td></tr>${lines(otherReceived)}${lines(otherPaid)}
${cr("Net cash from other activities", c.otherSurplus, pc.otherSurplus, "strong")}
${cr("Net increase or (decrease) in cash", c.increase, pc.increase, "strong")}
${cr("Opening cash balance", c.opening, pc.opening)}
${cr("Closing cash balance", c.closing, pc.closing, "strong")}
</tbody></table>`;

  const text = (value: string | undefined, fallback: string): string => ((value ?? "").trim() !== "" ? `<p>${escape((value ?? "").trim()).replace(/\n/g, "<br>")}</p>` : `<p>${fallback}</p>`);
  const activities = performance.activities.filter((a) => a.what.trim() !== "");
  const service =
    activities.length === 0
      ? "<p><em>Not yet written.</em></p>"
      : `<table><thead><tr><th>What we did</th><th>How much</th></tr></thead><tbody>${activities.map((a) => `<tr><td>${escape(a.what)}</td><td>${escape(a.howMuch)}</td></tr>`).join("")}</tbody></table>`;
  const propertyRows = s.propertyNote
    .map((r) => `<tr><td>${escape(r.name)}</td><td class="n">${money(dollar(r.opening))}</td><td class="n">${money(dollar(r.closing))}</td></tr>`)
    .join("");
  const fundRows = s.fundMovements
    .map((r) => `<tr><td>${escape(r.label)}</td><td class="n">${money(dollar(r.opening))}</td><td class="n">${money(dollar(r.closing))}</td></tr>`)
    .join("");
  const related = performance.relatedParties.filter((r) => r.relationship.trim() !== "" || r.what.trim() !== "");
  const approvers = performance.approvedBy.filter((n) => n.trim() !== "");
  const gst = options.gstRegistered
    ? `The entity is registered for GST. The performance report is prepared on a GST-${inputs.gstExclusive === true ? "exclusive" : "inclusive"} basis.`
    : "The entity is not registered for GST, and the performance report includes any GST paid.";

  return `<!doctype html>
<html lang="en-NZ">
<head>
<meta charset="utf-8">
<title>${escape(entity.name)} performance report (Tier 3), ${escape(year)}</title>
<style>
  body { font-family: Georgia, "Times New Roman", serif; max-width: 46rem; margin: 2rem auto; padding: 0 1rem; color: #111; }
  section { page-break-after: always; margin-bottom: 3rem; }
  section:last-child { page-break-after: auto; }
  .running { font-family: sans-serif; font-size: 0.8rem; color: #444; border-bottom: 1px solid #999; padding-bottom: 0.3rem; margin: 0 0 1.2rem; }
  h1 { font-size: 1.5rem; margin: 0 0 0.3rem; }
  h2 { font-size: 1.2rem; margin: 0 0 0.8rem; }
  h3 { font-size: 1rem; margin: 1.4rem 0 0.4rem; }
  table { width: 100%; border-collapse: collapse; margin: 0.4rem 0 1rem; font-size: 0.92rem; }
  th { text-align: left; border-bottom: 1px solid #111; padding: 0.25rem 0.3rem; }
  td { padding: 0.2rem 0.3rem; vertical-align: top; }
  .n { text-align: right; width: 6rem; font-variant-numeric: tabular-nums; }
  th.n { text-align: right; }
  tr.strong td { font-weight: 700; border-top: 1px solid #bbb; }
  tr.head td { font-weight: 700; padding-top: 0.8rem; text-transform: uppercase; font-size: 0.8rem; letter-spacing: 0.05em; }
  tr.sub td { font-style: italic; padding-top: 0.4rem; }
  tr.indent td:first-child { padding-left: 1.4rem; }
  .sign { margin-top: 2.5rem; }
  .line { border-top: 1px solid #111; width: 16rem; margin: 2.2rem 0 0.2rem; }
</style>
</head>
<body>
<section>
${running}
<h1>${escape(entity.name)}</h1>
<h2>Performance Report</h2>
<p>${escape(year)}</p>
<h3>Entity Information</h3>
<table><tbody>
<tr><td>Name</td><td>${escape(entity.name)}</td></tr>
${(performance.tradingNames ?? "").trim() !== "" ? `<tr><td>Also trading as</td><td>${escape((performance.tradingNames ?? "").trim())}</td></tr>` : ""}
<tr><td>Type of entity</td><td>${escape(entity.legalForm)}</td></tr>
</tbody></table>
<h3>Purpose</h3>${text(inputs.purpose, "<em>Not yet written.</em>")}
<h3>Structure</h3>${text(inputs.structure, "The organisation has no separate operating units, divisions or branches.")}
<h3>Governance</h3>${text(inputs.governance, "<em>Not yet written.</em>")}
<h3>Controlled entities</h3>${text(inputs.controlled, "The organisation controls no other entities for financial reporting purposes.")}
<h3>Reliance on volunteers and donated goods or services</h3>${text(inputs.volunteers, "<em>Not yet written.</em>")}
</section>
<section>${running}<h2>Statement of Service Performance</h2>${service}</section>
<section>${running}<h2>Statement of Financial Performance</h2>${performanceStatement}</section>
<section>${running}<h2>Statement of Financial Position</h2>${position}</section>
<section>${running}<h2>Statement of Cash Flows</h2>${cashFlows}</section>
<section>
${running}
<h2>Statement of Accounting Policies</h2>
<h3>Basis of preparation</h3>
<p>${escape(entity.name)} is eligible to apply the Tier 3 (NFP) Standard issued by the External Reporting Board (XRB): it does not have public accountability and its expenses are $5 million or less. It has elected to apply the Tier 3 (NFP) Standard. All transactions are reported using the accrual basis of accounting. The performance report has been prepared on the assumption that the entity is a going concern.</p>
<h3>Goods and Services Tax (GST)</h3>
<p>${escape(gst)}</p>
<h3>Specific accounting policies</h3>${text(inputs.policies, "<em>Not yet written: revenue, grants with conditions, fixed assets and depreciation, debtors and any other significant policy.</em>")}
<h3>Changes in accounting policies</h3>${text(inputs.policyChanges, "There have been no changes in accounting policies during the year.")}
</section>
<section>
${running}
<h2>Notes to the Performance Report</h2>
<h3>Deferred revenue</h3>${text(inputs.deferredRevenue, "There is no significant deferred revenue at balance date.")}
<h3>Goods or services in kind</h3>${text(inputs.inKind, "No significant goods or services in kind were provided to the entity.")}
<h3>Property, plant and equipment</h3>
${propertyRows === "" ? "<p>The entity holds no property, plant or equipment.</p>" : `<table><thead><tr><th>Class</th><th class="n">Carrying amount at start<br>$</th><th class="n">Carrying amount at end<br>$</th></tr></thead><tbody>${propertyRows}</tbody></table><p>Depreciation expense for the year: $${money(dollar(s.depreciation))}.</p>`}
<h3>Assets used as security for liabilities</h3>${text(inputs.security, "No assets are used as security for loans.")}
<h3>Assets held on behalf of others</h3>${text(inputs.heldForOthers, "The entity holds no assets on behalf of others.")}
<h3>Changes in accumulated funds</h3>
${fundRows === "" ? "" : `<table><thead><tr><th>Fund</th><th class="n">Opening<br>$</th><th class="n">Closing<br>$</th></tr></thead><tbody>${fundRows}</tbody></table>`}
${text(inputs.reserves, "The purpose of each fund, and any restriction on it, is not yet described.")}
<h3>Commitments</h3>${text(inputs.commitments, "The entity has no significant commitments.")}
<h3>Contingent liabilities and guarantees</h3>${text(inputs.contingent, "The entity has no contingent liabilities or guarantees.")}
<h3>Related party transactions</h3>
${related.length === 0 ? "<p>There were no significant related party transactions in the year.</p>" : `<table><thead><tr><th>Relationship</th><th>Transaction</th><th class="n">$</th></tr></thead><tbody>${related.map((r) => `<tr><td>${escape(r.relationship)}</td><td>${escape(r.what)}</td><td class="n">${money(dollar(r.amount))}</td></tr>`).join("")}</tbody></table>`}
${(performance.relatedBalances ?? "").trim() !== "" ? `<p>${escape((performance.relatedBalances ?? "").trim())}</p>` : ""}
<h3>Correction of errors</h3>
<p>${(performance.errors ?? "").trim() !== "" ? escape((performance.errors ?? "").trim()) : "There were no errors in the previous year's report that have been corrected in this one."}</p>
${(performance.eventsAfter ?? "").trim() !== "" ? `<h3>Events after the balance date</h3><p>${escape((performance.eventsAfter ?? "").trim())}</p>` : ""}
<div class="sign">
<h3>Approval</h3>
<p>This Performance Report was approved by the ${escape(entity.name)} governing body${performance.approvedOn !== undefined ? ` on ${escape(dateSaid(performance.approvedOn))}` : ""}.</p>
${(approvers.length === 0 ? ["", ""] : approvers).map((n) => `<div class="line"></div><div>${escape(n)}</div>`).join("")}
</div>
</section>
</body>
</html>
`;
}
