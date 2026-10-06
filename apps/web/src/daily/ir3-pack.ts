import type { Cents, Entity, Ir3Return, OwnerRentalSchedule, TaxExtra } from "@nzosa/core";
import { emptyEntityModel } from "@nzosa/core";
import { ledgerName } from "../store.js";
import { state } from "../state.js";

/**
 * A person's year-end pack: the IR3 laid out the way an accountant's
 * individual taxpayer summary is.
 *
 * The same pages, in the same order -- the summary and what is to pay, the
 * income behind it payer by payer, PIE income, a schedule for each rental at
 * this person's share, and the return box by box -- so it can be read beside
 * last year's pack, handed to whoever files the return, or filed from. Built
 * as a page of its own for the browser to print or save as a PDF: the app
 * has no server to make one, and every browser already does it well.
 *
 * Every figure comes from `ir3Return` and what was entered for the year, so
 * this draws and adds nothing up of its own beyond the totals of its tables.
 */

function esc(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}

/** Two decimals with thousands separators; negative in brackets, as the accounts show them. */
function money(cents: number): string {
  const text = (Math.abs(cents) / 100).toLocaleString("en-NZ", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return cents < 0 ? `(${text})` : text;
}

function row(label: string, amount: number | string | null, cls = ""): string {
  const value = amount === null ? "" : typeof amount === "string" ? esc(amount) : money(amount);
  return `<tr class="${cls}"><td>${esc(label)}</td><td class="amt">${value}</td></tr>`;
}

function table(head: readonly string[], rows: readonly (readonly (string | number)[])[], totals?: readonly (string | number)[]): string {
  const cell = (v: string | number, i: number): string =>
    i === 0 ? `<td>${esc(String(v))}</td>` : `<td class="amt">${typeof v === "number" ? money(v) : esc(v)}</td>`;
  return (
    `<table class="grid"><thead><tr>${head.map((h, i) => `<th${i === 0 ? "" : ' class="amt"'}>${esc(h)}</th>`).join("")}</tr></thead><tbody>` +
    rows.map((r) => `<tr>${r.map(cell).join("")}</tr>`).join("") +
    (totals === undefined ? "" : `<tr class="total">${totals.map(cell).join("")}</tr>`) +
    "</tbody></table>"
  );
}

function boxOf(result: Ir3Return, id: string): Cents {
  return result.boxes.find((b) => b.box === id)?.amount ?? 0;
}

function addressOf(property: string): string {
  const entity: Entity | undefined = (state.ledger.entities ?? emptyEntityModel()).entities.find(
    (e) => e.name === property,
  );
  return entity?.address ?? "";
}

function propertyName(schedule: OwnerRentalSchedule): string {
  return schedule.percent >= 100 ? schedule.property : `${schedule.property} - ${schedule.percent}% share`;
}

/** One property's schedule at this person's share, as the IR3R sets it out. */
function scheduleSection(schedule: OwnerRentalSchedule, year: number): string {
  const title = schedule.residential
    ? `Residential property income schedule - ${propertyName(schedule)}`
    : `Rental income schedule - ${propertyName(schedule)}`;
  const address = addressOf(schedule.property);
  const lines: string[] = [];
  lines.push(`<h2>${esc(title)}</h2>`);
  if (address !== "") lines.push(`<p class="address">${esc(address).replace(/\n/g, "<br>")}</p>`);
  lines.push('<table class="sched"><tbody>');
  lines.push(row("Income", null, "sub"));
  lines.push(row(schedule.residential ? "Gross residential rental income" : "Total rents", schedule.rents));
  lines.push(row(schedule.residential ? "Net bright-line profits (excludes bright-line losses)" : "Other income", schedule.residential ? 0 : schedule.otherIncome));
  if (schedule.residential && schedule.otherIncome !== 0) lines.push(row("Other residential income", schedule.otherIncome));
  lines.push(row("Total income", schedule.totalIncome, "total"));
  lines.push(row("Expenses", null, "sub"));
  for (const heading of schedule.headings) {
    if (heading.heading === "other") continue;
    lines.push(row(heading.label, heading.amount));
  }
  const other = schedule.headings.find((h) => h.heading === "other");
  if (schedule.other.length > 0) {
    lines.push(row("Other", null));
    for (const line of schedule.other) lines.push(row(`    ${line.name}`, line.amount, "indent"));
  } else {
    lines.push(row("Other", other?.amount ?? 0));
  }
  lines.push(row("Total expenses", schedule.totalExpenses, "total"));
  lines.push(row("Net rents", schedule.netRents, "total"));
  lines.push("</tbody></table>");
  for (const said of schedule.notes ?? []) lines.push(`<p class="note">${esc(said)}</p>`);
  lines.push(`<p class="note">Year to 31 March ${year}.</p>`);
  return `<section class="page">${lines.join("")}</section>`;
}

export function ir3PackHtml(
  result: Ir3Return,
  extras: readonly TaxExtra[],
  provisionalPaid: Cents | undefined,
  /** The year-end checklist and its answers, as a page to sign. */
  checklist?: string,
): string {
  const { owner, year } = result;
  const mine = extras.filter((e) => e.owner === owner && e.year === year);
  const of = (category: TaxExtra["category"]) => mine.filter((e) => e.category === category);
  const period = `1 April ${year - 1} - 31 March ${year}`;
  const made = new Date().toLocaleDateString("en-NZ", { day: "2-digit", month: "short", year: "numeric" });
  const header =
    `<header><div class="who">${esc(owner)}</div><div class="what">${year} Individual taxpayer summary (IR3)<br>${esc(period)}</div></header>`;
  const footer =
    `<footer>Prepared from the books “${esc(ledgerName() || "these books")}” on ${esc(made)}. ` +
    "Not filed: check every figure before filing.</footer>";
  const page = (body: string): string => `<section class="page">${header}${body}${footer}</section>`;

  // --- the summary -------------------------------------------------------
  const earnings = boxOf(result, "11B");
  const interest = boxOf(result, "13B");
  const dividends = boxOf(result, "14B");
  const residential = boxOf(result, "22H");
  const rents = boxOf(result, "23");
  const otherIncome = boxOf(result, "27");
  const imputation = boxOf(result, "14");
  const ietc = boxOf(result, "33");
  const paye = boxOf(result, "11E");
  const interestRwt = boxOf(result, "13A");
  const dividendRwt = boxOf(result, "14A");
  const otherCredits = boxOf(result, "21A") - paye - interestRwt - dividendRwt;

  const s: string[] = ['<table class="sched"><tbody>'];
  s.push(row("Income", null, "sub"));
  if (earnings !== 0) s.push(row("Income with tax deducted", earnings));
  if (interest !== 0) s.push(row("Income from interest", interest));
  if (dividends !== 0) s.push(row("Income from dividends", dividends));
  if (residential !== 0) s.push(row("Net residential income", residential));
  if (rents !== 0) s.push(row("Rental income", rents));
  if (otherIncome !== 0) s.push(row("Other income", otherIncome));
  s.push(row("Taxable income", result.taxableIncome, "total"));
  if (result.taxOnIncome !== null) {
    s.push(row("Tax on taxable income", result.taxOnIncome));
    if (imputation !== 0 || ietc !== 0) {
      s.push(row("Less non-refundable tax credits", null, "sub"));
      if (imputation !== 0) s.push(row("Imputation credits", imputation));
      if (ietc !== 0) s.push(row("Independent earner tax credit", ietc));
    }
    s.push(row("Tax payable", result.taxOnIncome - imputation - ietc, "total"));
    if (paye !== 0 || interestRwt !== 0 || dividendRwt !== 0 || otherCredits !== 0) {
      s.push(row("Less refundable tax credits", null, "sub"));
    }
    if (paye !== 0) s.push(row("PAYE deductions", paye));
    if (interestRwt !== 0) s.push(row("Interest RWT", interestRwt));
    if (dividendRwt !== 0) s.push(row("Dividend RWT", dividendRwt));
    if (otherCredits !== 0) s.push(row("Other tax credits", otherCredits));
  }
  if (result.residualIncomeTax !== null) s.push(row(`${year} residual tax`, result.residualIncomeTax, "total"));
  if (provisionalPaid !== undefined) s.push(row(`Less ${year} provisional tax paid`, provisionalPaid));
  if (result.refundOrToPay !== null) {
    s.push(row(result.refundOrToPay < 0 ? `${year} refund due` : `${year} tax to pay`, result.refundOrToPay, "total"));
  }
  s.push("</tbody></table>");

  if (result.nextYearProvisional !== null) {
    const [a = 0, b = 0, c = 0] = result.instalments;
    s.push(`<h3>${year + 1} Provisional tax</h3>`);
    s.push(
      `<p>${year + 1} provisional tax of $${money(result.nextYearProvisional)} will be payable. ` +
        `This amount is ${year} residual income tax plus 5%.</p>`,
    );
    s.push(
      table(
        ["Payment schedule (standard dates)", "Amount"],
        [
          [`1st instalment, 28 August ${year}`, a],
          [`2nd instalment, 15 January ${year + 1}`, b],
          [`3rd instalment, 7 May ${year + 1}`, c],
        ],
        ["Total", result.nextYearProvisional],
      ),
    );
  }
  if (provisionalPaid === undefined && result.residualIncomeTax !== null) {
    s.push('<p class="note">Provisional tax paid for the year was not entered, so no refund or tax to pay is worked out.</p>');
  }
  const pages: string[] = [page(s.join(""))];

  // --- the details behind it ---------------------------------------------
  const d: string[] = [];
  const salary = of("salary");
  if (salary.length > 0) {
    d.push("<h3>Details of income from which tax was deducted</h3>");
    d.push(
      table(
        ["Employer / payer", "PAYE deductions", "Gross earnings"],
        salary.map((e) => [e.payer, e.credits, e.gross]),
        ["", salary.reduce((t, e) => t + e.credits, 0), earnings],
      ),
    );
    const levy = boxOf(result, "11A") - paye;
    if (levy !== 0) d.push(`<p>Less ACC earner levy on $${money(earnings)} earnings liable for levy: ${money(levy)}. Total tax deductions ${money(paye)}.</p>`);
  }
  const interestLines = of("interest");
  if (interestLines.length > 0) {
    d.push("<h3>Interest</h3>");
    d.push(table(["Payer", "RWT", "Gross interest"], interestLines.map((e) => [e.payer, e.credits, e.gross]), ["", interestRwt, interest]));
  }
  const dividendLines = of("dividends");
  if (dividendLines.length > 0) {
    d.push("<h3>Dividends</h3>");
    d.push(
      table(
        ["Payer", "Imputation credits", "RWT", "Gross dividends"],
        dividendLines.map((e) => [e.payer, e.imputation ?? 0, e.credits, e.gross]),
        ["", imputation, dividendRwt, dividends],
      ),
    );
  }
  const other = of("other");
  if (other.length > 0) {
    d.push("<h3>Other income</h3>");
    d.push(table(["Payer", "Tax credits", "Gross"], other.map((e) => [e.payer, e.credits, e.gross]), ["", otherCredits, otherIncome]));
  }
  const portfolio = result.residential;
  if (portfolio.properties.length > 0) {
    d.push("<h3>Residential property - income</h3>");
    d.push(
      table(
        ["Property / portfolio", "Gross residential rental income", "Net bright-line profits", "Other residential income", "Total residential income"],
        portfolio.properties.map((p) => [propertyName(p), p.rents, 0, p.otherIncome, p.totalIncome]),
        ["", portfolio.grossRents, portfolio.brightLine, portfolio.otherIncome, portfolio.totalIncome],
      ),
    );
    d.push("<h3>Residential property - deductions</h3>");
    d.push(
      table(
        ["Property / portfolio", "Deductions", "Net residential income"],
        portfolio.properties.map((p) => [propertyName(p), p.totalExpenses, p.netRents]),
        ["", portfolio.deductions, portfolio.totalIncome - portfolio.deductions],
      ),
    );
    d.push(
      table(
        ["Portfolio", "Amount"],
        [
          ["Excess deductions brought forward", portfolio.broughtForward],
          ["Deductions claimed this year", portfolio.claimed],
          ["Net residential income", portfolio.netIncome],
          ["Excess deductions carried forward", portfolio.carriedForward],
        ],
      ),
    );
  }
  if (result.otherRentals.length > 0) {
    d.push("<h3>Income from rents</h3>");
    d.push(table(["Description", "Net revenue"], result.otherRentals.map((r) => [propertyName(r), r.netRents]), ["", rents]));
  }
  if (d.length > 0) pages.push(page(d.join("")));

  // --- PIE income ---------------------------------------------------------
  const pie = of("pie");
  if (pie.length > 0) {
    pages.push(
      page(
        "<h3>PIE income</h3>" +
          table(
            ["Description", "PIE tax credits", "PIE income / (loss)"],
            pie.map((e) => [e.payer, e.credits, e.gross]),
            ["", boxOf(result, "35A"), boxOf(result, "35B")],
          ) +
          '<p class="note">PIE income taxed at the correct prescribed investor rate is not part of taxable income.</p>',
      ),
    );
  }

  // --- one schedule per rental ---------------------------------------------
  for (const property of [...portfolio.properties, ...result.otherRentals]) {
    pages.push(scheduleSection(property, year).replace('<section class="page">', `<section class="page">${header}`).replace("</section>", `${footer}</section>`));
  }

  // --- the return, box by box -----------------------------------------------
  pages.push(
    page(
      "<h3>The return, box by box</h3>" +
        `<table class="grid"><thead><tr><th>Box</th><th>Description</th><th class="amt">Amount</th></tr></thead><tbody>` +
        result.boxes
          .map(
            (b) =>
              `<tr class="${b.total === true ? "total" : ""}"><td>${esc(b.box)}</td><td>${esc(b.title)}</td>` +
              `<td class="amt">${b.text !== undefined ? esc(b.text) : money(b.amount ?? 0)}</td></tr>`,
          )
          .join("") +
        "</tbody></table>" +
        (result.notes.length > 0 ? `<h3>Notes</h3><ul>${result.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""),
    ),
  );

  if (checklist !== undefined) pages.push(page(checklist));

  return (
    "<!doctype html><html lang=\"en-NZ\"><head><meta charset=\"utf-8\">" +
    `<title>${esc(owner)} - ${year} IR3</title><style>${PACK_STYLE}</style></head><body>` +
    '<div class="bar"><button onclick="window.print()">Print or save as PDF</button></div>' +
    pages.join("") +
    "</body></html>"
  );
}

const PACK_STYLE = `
  body { font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #111; background: #eee; margin: 0; }
  .bar { position: sticky; top: 0; background: #fff; border-bottom: 1px solid #ccc; padding: 8px 16px; }
  .bar button { font: inherit; padding: 6px 14px; }
  .page { background: #fff; max-width: 760px; margin: 16px auto; padding: 32px 40px; box-shadow: 0 1px 4px rgba(0,0,0,.15); }
  header { display: flex; justify-content: space-between; border-bottom: 2px solid #111; padding-bottom: 6px; margin-bottom: 16px; }
  header .who { font-weight: 700; }
  header .what { text-align: right; }
  footer { margin-top: 24px; border-top: 1px solid #999; padding-top: 6px; font-size: 11px; color: #555; }
  h2 { font-size: 15px; margin: 0 0 8px; }
  h3 { font-size: 13px; margin: 18px 0 6px; }
  table { border-collapse: collapse; width: 100%; }
  td, th { padding: 3px 6px; vertical-align: top; }
  th { text-align: left; border-bottom: 1px solid #111; font-weight: 600; }
  .amt { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .sched td:first-child { width: 70%; }
  tr.sub td { font-weight: 600; padding-top: 10px; }
  tr.total td { border-top: 1px solid #111; font-weight: 600; }
  tr.indent td:first-child { padding-left: 24px; }
  .grid tbody tr td { border-bottom: 1px solid #e3e3e3; }
  .address { margin: 0 0 12px; color: #333; }
  .note { color: #444; font-size: 12px; }
  @media print {
    body { background: #fff; }
    .bar { display: none; }
    .page { box-shadow: none; margin: 0; max-width: none; padding: 0; page-break-after: always; }
  }
`;
