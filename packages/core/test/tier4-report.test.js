import assert from "node:assert/strict";
import test from "node:test";
import {
  cashFlows, cashHeld, cashStatement, defaultTier4Line, emptyInputs, performanceReportHtml, reportProblems,
} from "../dist/index.js";

// An invented club, Kowhai Junior Tennis, with two bank accounts, a term deposit and a petty cash tin.
const chart = [
  { code: "200", name: "Subscriptions", type: "Revenue", taxCode: "", description: "" },
  { code: "210", name: "Donations", type: "Revenue", taxCode: "", description: "" },
  { code: "220", name: "Grants", type: "Revenue", taxCode: "", description: "" },
  { code: "225", name: "Service delivery contract", type: "Revenue", taxCode: "", description: "" },
  { code: "230", name: "Fundraising", type: "Revenue", taxCode: "", description: "" },
  { code: "250", name: "Trading income", type: "Revenue", taxCode: "", description: "" },
  { code: "270", name: "Interest received", type: "Other Income", taxCode: "", description: "" },
  { code: "408", name: "Cost of fundraising", type: "Expense", taxCode: "", description: "" },
  { code: "461", name: "Programme and activity costs", type: "Expense", taxCode: "", description: "" },
  { code: "469", name: "Rent and rates", type: "Expense", taxCode: "", description: "" },
  { code: "477", name: "Salaries and wages", type: "Expense", taxCode: "", description: "" },
  { code: "496", name: "Volunteer costs", type: "Expense", taxCode: "", description: "" },
  { code: "425", name: "Grants and donations paid", type: "Expense", taxCode: "", description: "" },
  { code: "404", name: "Bank fees", type: "Expense", taxCode: "", description: "" },
  { code: "740", name: "Equipment", type: "Fixed Asset", taxCode: "", description: "" },
  { code: "900", name: "Loan", type: "Non-current Liability", taxCode: "", description: "" },
  { code: "820", name: "GST", type: "Current Liability", taxCode: "", description: "" },
  { code: "850", name: "Suspense", type: "Current Liability", taxCode: "", description: "" },
  { code: "610", name: "Accounts Receivable", type: "Accounts Receivable", taxCode: "", description: "" },
];
const accounts = {
  banks: [
    { id: "cheque", label: "Cheque account" },
    { id: "savings", label: "Savings account" },
    { id: "term", label: "Term deposit" },
  ],
  cashCodes: ["090"],
};
// Dated the day the books start: the position at the close of 31 March 2026.
const opening = { asAt: "2026-04-01", accounts: { cheque: 300_000, savings: 200_000, term: 500_000, "090": 5_000 } };

function line(code, amount) {
  return { accountCode: code, accountName: code, amount, taxType: "NONE", description: "" };
}
function journal(date, ...lines) {
  return { transactionId: `${date}${lines[0].accountCode}`, date, narration: "", lines, source: "bank", taxBasis: "both" };
}

const journals = [
  // Money in: a subscription with GST inside it (115.00 = 100.00 + 15.00).
  journal("2026-05-01", line("cheque", 11_500), line("200", -10_000), line("820", -1_500)),
  // A donation, no GST.
  journal("2026-05-02", line("cheque", 50_000), line("210", -50_000)),
  // A grant with GST, and a service contract.
  journal("2026-06-01", line("cheque", 230_000), line("220", -200_000), line("820", -30_000)),
  journal("2026-06-15", line("savings", 100_000), line("225", -100_000)),
  journal("2026-07-01", line("cheque", 23_000), line("250", -20_000), line("820", -3_000)),
  journal("2026-07-10", line("cheque", 8_000), line("230", -8_000)),
  journal("2026-09-30", line("savings", 700), line("270", -700)),
  // Money out.
  journal("2026-08-01", line("461", 57_500), line("820", 7_500), line("cheque", -65_000)),
  journal("2026-08-05", line("469", 40_000), line("cheque", -40_000)),
  journal("2026-08-10", line("477", 120_000), line("cheque", -120_000)),
  journal("2026-08-15", line("496", 3_000), line("cheque", -3_000)),
  journal("2026-08-20", line("408", 2_000), line("cheque", -2_000)),
  journal("2026-08-25", line("425", 10_000), line("cheque", -10_000)),
  journal("2026-08-26", line("404", 500), line("cheque", -500)),
  // A refund of a donation: a receipt coded to Donations that went the other way.
  journal("2026-09-01", line("210", 4_000), line("cheque", -4_000)),
  // A refund of an expense: a payment that came in.
  journal("2026-09-02", line("cheque", 1_000), line("469", -1_000)),
  // GST paid to Inland Revenue, and a refund.
  journal("2026-10-28", line("820", 8_000), line("cheque", -8_000)),
  journal("2027-01-28", line("cheque", 500), line("820", -500)),
  // Equipment bought, and an old piece sold.
  journal("2026-11-01", line("740", 30_000), line("cheque", -30_000)),
  journal("2026-11-20", line("cheque", 5_000), line("740", -5_000)),
  // A loan received, and part repaid.
  journal("2026-12-01", line("cheque", 100_000), line("900", -100_000)),
  journal("2027-02-01", line("900", 20_000), line("cheque", -20_000)),
  // Moves between its own accounts: savings to cheque, cheque to term deposit, cash to bank.
  journal("2026-12-10", line("cheque", 50_000), line("savings", -50_000)),
  journal("2027-01-10", line("term", 100_000), line("cheque", -100_000)),
  journal("2027-02-10", line("cheque", 2_000), line("090", -2_000)),
  // An unreconciled line left in suspense, and a payment against an invoice.
  journal("2027-03-01", line("cheque", 1_200), line("850", -1_200)),
  journal("2027-03-05", line("cheque", 3_000), line("610", -3_000)),
  // Last year: not part of this one.
  journal("2026-02-01", line("cheque", 99_999), line("210", -99_999)),
];

const options = { journals, chart, accounts, opening, year: 2027, from: "2026-04-01", to: "2027-03-31", mapping: {} };

test("accounts are placed under the standard's lines from what they are called", () => {
  const where = (name, type = "Revenue") => defaultTier4Line({ name, type });
  assert.equal(where("Subscriptions"), "membership");
  assert.equal(where("Donations"), "donations");
  assert.equal(where("Fundraising"), "donations");
  assert.equal(where("Grants"), "generalGrants");
  assert.equal(where("Service delivery contract"), "serviceGrants");
  assert.equal(where("Sales of donated goods"), "sales");
  assert.equal(where("Interest received", "Other Income"), "interest");
  assert.equal(where("Cost of fundraising", "Expense"), "fundraisingCosts");
  assert.equal(where("Salaries and wages", "Expense"), "employee");
  assert.equal(where("Volunteer costs", "Expense"), "volunteer");
  assert.equal(where("Grants and donations paid", "Expense"), "grantsPaid");
  assert.equal(where("Bank fees", "Expense"), "otherPaid");
  assert.equal(where("Rent and rates", "Expense"), "objectives");
  assert.equal(where("Equipment", "Fixed Asset"), "purchaseAssets");
  assert.equal(where("GST", "Current Liability"), "gst");
});

test("every line of the statement comes out as it should, GST inclusive", () => {
  const f = cashFlows(options).lines;
  assert.equal(f.membership, 11_500, "subscription with its GST inside it");
  assert.equal(f.donations, 58_000, "donations and fundraising, the refund is not taken off");
  assert.equal(f.generalGrants, 230_000);
  assert.equal(f.serviceGrants, 100_000);
  assert.equal(f.sales, 23_000);
  assert.equal(f.interest, 700);
  assert.equal(f.objectives, 65_000 + 40_000, "programme and rent; the rent refund is cash received, not netted");
  assert.equal(f.employee, 120_000);
  assert.equal(f.volunteer, 3_000);
  assert.equal(f.fundraisingCosts, 2_000);
  assert.equal(f.grantsPaid, 10_000);
  assert.equal(f.otherPaid, 500 + 4_000, "bank fees, and the refunded donation shown as cash paid");
  assert.equal(f.otherReceived, 1_000 + 1_200 + 3_000, "the expense refund, the suspense line, and the invoice payment");
  assert.equal(f.gst, 8_000 - 500, "paid to Inland Revenue less the refund");
  assert.equal(f.purchaseAssets, 30_000);
  assert.equal(f.saleAssets, 5_000);
  assert.equal(f.loansReceived, 100_000);
  assert.equal(f.loansRepaid, 20_000);
});

test("nothing is netted, and moves between its own accounts are left out", () => {
  const flows = cashFlows(options);
  assert.equal(flows.lines.donations, 58_000);
  assert.equal(flows.uncoded.count, 1, "the suspense line is noticed");
  assert.equal(flows.clearing, 1, "and so is the invoice payment");
});

test("the statement's closing cash is the cash the books hold", () => {
  const s = cashStatement(options);
  assert.equal(s.dollars.opening, 10_050, "300,000 + 200,000 + 500,000 + 5,000 cents is $10,050");
  assert.equal(s.movementCents, s.closingCents - 1_005_000, "what was classified is exactly what moved");
  assert.equal(Math.round(s.closingCents / 100), s.dollars.held, "represented by the cash held");
  assert.ok(Math.abs(s.dollars.closing - s.dollars.held) <= 2, "the rounded statement agrees with the books");
});

test("the term deposit and the petty cash tin are shown as what they are", () => {
  const held = cashHeld({ journals, accounts, opening, on: "2027-03-31" });
  assert.equal(held.termDeposits, 500_000 + 100_000);
  assert.equal(held.cash, 5_000 - 2_000);
  assert.ok(held.bank > 0);
});

test("a line the user chooses overrides the default", () => {
  const f = cashFlows({ ...options, mapping: { "250": "otherReceived" } }).lines;
  assert.equal(f.sales, 0);
  assert.equal(f.otherReceived, 1_000 + 1_200 + 3_000 + 23_000);
});

test("rounded to whole dollars, with totals built from the rounded lines", () => {
  const s = cashStatement(options).dollars;
  const sum = ["donations", "generalGrants", "serviceGrants", "membership", "sales", "interest", "otherReceived"].reduce((t, k) => t + s.lines[k], 0);
  assert.equal(s.receivedTotal, sum);
  assert.equal(s.operatingSurplus, s.receivedTotal - s.paidTotal - s.lines.gst);
  assert.equal(s.increase, s.operatingSurplus + s.otherSurplus - s.lines.incomeTax);
});

test("the report names the entity and year on every page, with the previous year beside", () => {
  const statement = cashStatement(options);
  const previous = cashStatement({ ...options, year: 2026, from: "2025-04-01", to: "2026-03-31" });
  const inputs = { ...emptyInputs(), activities: [{ what: "Junior coaching sessions", howMuch: "96 sessions, 40 children" }], approvedOn: "2027-06-20", approvedBy: ["Rimu Totara", "Kowhai Smith"] };
  const html = performanceReportHtml({ entity: { name: "Kowhai Junior Tennis", legalForm: "Incorporated society" }, gstRegistered: true, statement, previous, inputs });
  assert.equal((html.match(/class="running"/g) ?? []).length, 3, "every page");
  assert.ok(html.includes("Year ended 31 March 2027"));
  for (const needle of ["Statement of Cash Received and Cash Paid", "Membership fees or subscriptions", "Total GST paid or refunded in the financial year", "Represented by:", "Tier 4 (NFP) Standard", "inclusive of GST", "Junior coaching sessions", "20 June 2027", "Rimu Totara"]) {
    assert.ok(html.includes(needle), needle);
  }
  assert.ok(html.includes('<th class="n">2027<br>$</th><th class="n">2026<br>$</th>'), "both years");
});

test("what is missing is said", () => {
  const statement = cashStatement(options);
  const previous = cashStatement({ ...options, year: 2026, from: "2025-04-01", to: "2026-03-31" });
  const problems = reportProblems({ entity: { name: "x", legalForm: "y" }, inputs: emptyInputs(), statement, previous }).join(" ");
  assert.match(problems, /main activities/);
  assert.match(problems, /approved the report/);
  assert.match(problems, /not coded yet/);
  assert.match(problems, /settle invoices or bills/);
});

test("names cannot break the page", () => {
  const statement = cashStatement(options);
  const html = performanceReportHtml({ entity: { name: "A & B <Club>", legalForm: "Club" }, gstRegistered: false, statement, previous: statement, inputs: emptyInputs() });
  assert.ok(html.includes("A &amp; B &lt;Club&gt;"));
  assert.ok(html.includes("not registered for GST"));
});

test("opening balances mean the start of their day, so that day's postings count", () => {
  const on1Apr = [journal("2026-04-01", line("cheque", 1_000), line("210", -1_000))];
  const held = cashHeld({ journals: on1Apr, accounts, opening, on: "2026-04-01" });
  assert.equal(held.bank, 300_000 + 200_000 + 1_000, "the 1 April posting is added to the closing position of 31 March");
  const before = cashHeld({ journals: on1Apr, accounts, opening, on: "2026-03-31" });
  assert.equal(before.bank, 500_000, "at the close of 31 March, just the opening balances");
});

test("year-end balances are used for the close of their own date, and nothing is claimed before the books began", () => {
  const withYearEnds = { ...opening, asAt: "2026-04-01", byDate: { "2025-03-31": { cheque: 111_100, savings: 0, term: 0, "090": 0 } } };
  assert.equal(cashHeld({ journals: [], accounts, opening: withYearEnds, on: "2025-03-31" }).bank, 111_100);
  assert.equal(cashHeld({ journals: [], accounts, opening: withYearEnds, on: "2025-01-01" }).bank, 0, "before any known balance");
});

test("a year the books cannot account for says so, and typed-in figures stand in for it", async () => {
  const { statementFromFigures } = await import("../dist/index.js");
  const current = cashStatement(options);
  const previous = cashStatement({ ...options, year: 2026, from: "2025-04-01", to: "2026-03-31" });
  assert.equal(current.reconciles, true, "this year agrees with the cash held");
  assert.equal(previous.reconciles, false, "last year began before the books did");
  const typed = statementFromFigures(2026, "2025-04-01", "2026-03-31", {
    opening: 9_000, membership: 4_000, donations: 3_000, objectives: 2_500, gst: 100, bank: 9_050, termDeposits: 0, cash: 250,
  });
  const d = typed.dollars;
  assert.equal(d.receivedTotal, 7_000);
  assert.equal(d.paidTotal, 2_500);
  assert.equal(d.operatingSurplus, 7_000 - 2_500 - 100);
  assert.equal(d.closing, 9_000 + 4_400, "opening plus the year's increase");
  assert.equal(d.held, 9_300);
  const html = performanceReportHtml({
    entity: { name: "Kowhai Junior Tennis", legalForm: "Incorporated society" }, gstRegistered: true,
    statement: current, previous: typed, inputs: emptyInputs(),
  });
  assert.ok(html.includes("4,000"), "last year's figure sits beside this year's");
});

test("last year's figures are checked against this year's opening and against themselves", async () => {
  const { statementFromFigures } = await import("../dist/index.js");
  const current = cashStatement(options);
  const entity = { name: "x", legalForm: "y" };
  const inputs = emptyInputs();
  const good = statementFromFigures(2026, "2025-04-01", "2026-03-31", { opening: 9_000, membership: 4_590, bank: current.dollars.opening, termDeposits: 0, cash: 0 });
  // opening 9,000 + 4,590 received = closing 13,590; this year's opening is 10,050.
  const mismatch = reportProblems({ entity, inputs, statement: current, previous: good }).join(" ");
  assert.match(mismatch, /should be this year's opening balance/);
  const footing = statementFromFigures(2026, "2025-04-01", "2026-03-31", { opening: 5_000, membership: 5_050, bank: 9_999 });
  assert.match(reportProblems({ entity, inputs, statement: current, previous: footing }).join(" "), /do not add up/);
  const right = statementFromFigures(2026, "2025-04-01", "2026-03-31", { opening: 5_000, membership: 5_050, bank: 10_050 });
  const none = reportProblems({ entity, inputs, statement: current, previous: right }).join(" ");
  assert.doesNotMatch(none, /should be this year's opening|do not add up/);
});

test("security over property is printed when a society says there is some", () => {
  const statement = cashStatement(options);
  const entity = { name: "Kowhai Junior Tennis", legalForm: "Incorporated society" };
  const none = performanceReportHtml({ entity, gstRegistered: false, statement, previous: statement, inputs: emptyInputs() });
  assert.ok(!none.includes("security interests"));
  const some = performanceReportHtml({ entity, gstRegistered: false, statement, previous: statement, inputs: { ...emptyInputs(), securityInterests: "A mortgage over the clubrooms, held by a bank." } });
  assert.ok(some.includes("Mortgages, charges and other security interests"));
  assert.ok(some.includes("A mortgage over the clubrooms"));
});
