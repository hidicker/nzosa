import assert from "node:assert/strict";
import test from "node:test";
import {
  computeBalanceSheet,
  expandSplits,
  postInvoice,
  postTransaction,
  splitPartId,
} from "../dist/index.js";

const CHART = [
  { code: "200", name: "Sales", type: "Revenue" },
  { code: "310", name: "Cost of Goods Sold", type: "Direct Costs" },
  { code: "429", name: "Office Expenses", type: "Overhead" },
  { code: "610", name: "Accounts Receivable", type: "Accounts Receivable" },
  { code: "730", name: "Paragliding Equipment", type: "Fixed Asset" },
  { code: "731", name: "Less Accumulated Depreciation on Paragliding", type: "Fixed Asset" },
  { code: "740", name: "Motor Vehicle >1K", type: "Fixed Asset" },
  { code: "741", name: "Less Accumulated Depreciation - Vehicles", type: "Fixed Asset" },
  { code: "980", name: "Owner Drawings", type: "Current Liability" },
  { code: "800", name: "Accounts Payable", type: "Accounts Payable" },
  { code: "820", name: "GST", type: "GST" },
  { code: "860", name: "Rounding", type: "Rounding" },
  { code: "900", name: "Loan", type: "Non-current Liability" },
  { code: "910", name: "Loan from Director", type: "Current Liability" },
  { code: "960", name: "Retained Earnings", type: "Retained Earnings" },
];

/**
 * A sample company's opening position, from the trial balance rather than from
 * the signed statements.
 *
 * The statements round to whole dollars, and a set of figures read off them
 * cannot be made to balance without inventing a rounding: the components round
 * one way and their totals another. The trial balance carries the cents, so it
 * balances on its own and the printed totals fall out of it correctly.
 *
 * It also carries what the statements summarise away -- cost and accumulated
 * depreciation as separate accounts, the vehicle alongside the equipment, and
 * owner drawings apart from the loan they are netted against.
 */
const OPENING = {
  asAt: "2025-04-01",
  accounts: {
    "02-1100-0022001-001": 35594,
    "sample-card-4001": 117682,
    "610": 228000,
    "730": 3624474,
    "731": -1445892,
    "740": 564251,
    "741": -88870,
    "800": -15328,
    "820": 325543,
    "910": -6070000,
    "980": 248868,
    "960": 2475678,
  },
};

const bankLine = (account, amount) => ({
  accountCode: account, accountName: account, amount, taxType: "NONE", description: "",
});
const line = (code, name, amount) => ({
  accountCode: code, accountName: name, amount, taxType: "NONE", description: "",
});
const journal = (date, lines) => ({
  transactionId: date, date, narration: "", lines, source: "bank", taxBasis: "payments",
});

test("the opening sheet reproduces the signed accounts, line for line", () => {
  // Sample Trading Entity, balance sheet as at 31 March 2026, comparative
  // column. Whole dollars, as the statements are stated.
  const sheet = computeBalanceSheet({
    asAt: "2025-04-01", openingBalances: OPENING, journals: [], chart: CHART,
  });
  const dollars = (cents) => Math.round(cents / 100);
  const closing = (section, code) => section.lines.find((l) => l.code === code)?.closing ?? 0;

  assert.equal(dollars(closing(sheet.currentAssets, "02-1100-0022001-001")), 356);
  assert.equal(dollars(closing(sheet.currentAssets, "sample-card-4001")), 1177);
  assert.equal(dollars(closing(sheet.currentAssets, "610")), 2280);
  assert.equal(dollars(closing(sheet.currentAssets, "820")), 3255, "GST was a refund owed, not owed");
  assert.equal(dollars(sheet.currentAssets.total), 7068);
  assert.equal(dollars(closing(sheet.nonCurrentAssets, "730")), 36245, "cost, as the ledger holds it");
  assert.equal(dollars(sheet.nonCurrentAssets.total), 26540, "net of depreciation, as the statements print it");
  assert.equal(dollars(sheet.totalAssets), 33608);

  assert.equal(dollars(closing(sheet.currentLiabilities, "800")), 153);
  assert.equal(
    dollars(closing(sheet.currentLiabilities, "910") + closing(sheet.currentLiabilities, "980")),
    58211,
    "the loan net of drawings, which is what the statements call a shareholder current account",
  );
  assert.equal(dollars(sheet.currentLiabilities.total), 58365);
  assert.equal(dollars(sheet.totalLiabilities), 58365);
  assert.equal(dollars(sheet.nonCurrentLiabilities.total), 0, "the statements show no non-current section");

  assert.equal(dollars(sheet.netAssets), -24757);
  assert.equal(dollars(closing(sheet.equity, "960")), -24757);
  assert.equal(dollars(sheet.totalEquity), -24757);
  assert.equal(sheet.imbalance, 0);
});

test("the real figures need no rounding account at all", () => {
  // Taken from the trial balance rather than the printed statements, the
  // opening position balances on its own. A rounding account was only ever
  // needed to paper over figures read off a rounded page.
  const sheet = computeBalanceSheet({
    asAt: "2025-04-01", openingBalances: OPENING, journals: [], chart: CHART,
  });
  const anywhere = [...sheet.currentLiabilities.lines, ...sheet.equity.lines, ...sheet.currentAssets.lines];
  assert.equal(anywhere.find((l) => l.code === "860"), undefined);
  assert.equal(sheet.imbalance, 0);
  assert.equal(sheet.netAssets, -2475678, "exact to the cent");
});

test("a rounding, where one is needed, stays on the side it arose from", () => {
  // Books entered from a rounded page still need somewhere to put the
  // difference, and equity is the wrong place: it would move total
  // liabilities, net assets and retained earnings all at once.
  const rounded = {
    asAt: "2025-04-01",
    accounts: { "610": 100000, "800": -40000, "860": -100, "960": -59900 },
  };
  const sheet = computeBalanceSheet({
    asAt: "2025-04-01", openingBalances: rounded, journals: [], chart: CHART,
  });
  assert.equal(sheet.imbalance, 0);
  assert.ok(sheet.currentLiabilities.lines.find((l) => l.code === "860"), "with the liabilities");
  assert.equal(sheet.equity.lines.find((l) => l.code === "860"), undefined, "not in equity");
});

test("profit comes from the postings, so it cannot disagree with the sheet", () => {
  // A sale of 115.00 including GST, and an expense of 23.00 including GST.
  const journals = [
    journal("2025-06-01", [
      bankLine("02-1100-0022001-001", 11500),
      line("200", "Sales", -10000),
      line("820", "GST", -1500),
    ]),
    journal("2025-06-02", [
      bankLine("02-1100-0022001-001", -2300),
      line("429", "Office Expenses", 2000),
      line("820", "GST", 300),
    ]),
  ];
  const sheet = computeBalanceSheet({
    asAt: "2026-03-31", openingBalances: OPENING, journals, chart: CHART,
  });
  assert.equal(sheet.profitForPeriod, 8000, "100.00 earned less 20.00 spent");
  assert.equal(sheet.imbalance, 0, "the sheet still balances once there is a profit");
});

test("a journal dated before the opening balances is not counted twice", () => {
  const before = [journal("2025-03-31", [
    bankLine("02-1100-0022001-001", 50000),
    line("200", "Sales", -50000),
  ])];
  const sheet = computeBalanceSheet({
    asAt: "2026-03-31", openingBalances: OPENING, journals: before, chart: CHART,
  });
  assert.equal(sheet.profitForPeriod, 0, "last year's sale belongs to last year");
  assert.equal(sheet.imbalance, 0);
});

test("GST moves between assets and liabilities as it falls", () => {
  // A big enough quarter to turn the opening refund into a return owed. The
  // journal balances, because an unbalanced one is a different test.
  const owing = [journal("2025-06-01", [
    bankLine("02-1100-0022001-001", 4600000),
    line("200", "Sales", -4000000),
    line("820", "GST", -600000),
  ])];
  const sheet = computeBalanceSheet({
    asAt: "2026-03-31", openingBalances: OPENING, journals: owing, chart: CHART,
  });
  const asset = sheet.currentAssets.lines.find((l) => l.code === "820");
  const liability = sheet.currentLiabilities.lines.find((l) => l.code === "820");
  assert.equal(asset, undefined, "no longer a refund owed to the company");
  assert.ok(liability, "now a return owed to Inland Revenue");
  assert.equal(liability.closing, 274457, "6,000.00 owed less the 3,255.43 refund carried in");
  assert.equal(sheet.imbalance, 0);
});

test("a bank account with no chart code is still a current asset", () => {
  const sheet = computeBalanceSheet({
    asAt: "2025-04-01", openingBalances: OPENING, journals: [], chart: CHART,
  });
  const codes = sheet.currentAssets.lines.map((l) => l.code);
  assert.ok(codes.includes("02-1100-0022001-001"), "the trading account is on the sheet");
  assert.ok(codes.includes("sample-card-4001"), "so is the card");
});

test("no opening balances at all still balances, on movement alone", () => {
  const journals = [journal("2025-06-01", [
    bankLine("02-1100-0022001-001", 11500),
    line("200", "Sales", -10000),
    line("820", "GST", -1500),
  ])];
  const sheet = computeBalanceSheet({ asAt: "2026-03-31", journals, chart: CHART });
  assert.equal(sheet.openingFrom, null);
  assert.equal(sheet.imbalance, 0);
});

test("an opening trial balance that does not balance is reported, not hidden", () => {
  // The figures as they were first written: retained earnings as a credit when
  // the company had a deficit, and no rounding line. The sheet must say so.
  const wrong = { asAt: "2025-04-01", accounts: { ...OPENING.accounts, "960": -2475678 } };
  const sheet = computeBalanceSheet({
    asAt: "2025-04-01", openingBalances: wrong, journals: [], chart: CHART,
  });
  assert.notEqual(sheet.imbalance, 0, "a sheet that does not balance must not report zero");
  assert.equal(sheet.imbalance, -4951356);
});

test("one payment settling two invoices leaves receivables and the sheet flat", () => {
  // The multi-invoice split: the payment is replaced by its parts, each part
  // clears its own receivable, and the balance sheet must not notice the
  // difference between that and two separate payments.
  const invoice = (number, total) => ({
    number, kind: "sales", contact: "Sample Customer", issued: "2026-03-30", total,
    lines: [{
      accountCode: "200", description: "Course", net: Math.round(total / 1.15),
      tax: total - Math.round(total / 1.15), gross: total, taxType: "15% GST on Income",
    }],
  });
  const A = invoice("INV-0135", 50000);
  const B = invoice("INV-0130", 30000);
  const payment = {
    id: "pay1", date: "2026-04-05", account: "02-1100-0022001-001", amount: 80000,
    otherParty: "SAMPLE CUSTOMER", particulars: "", reference: "", otherPartyAccount: "",
    source: "bnz", extras: {},
  };
  const splits = { pay1: [
    { amount: 50000, treatment: "standard", side: "sales", note: "Settles INV-0135", code: "Sales - 200" },
    { amount: 30000, treatment: "standard", side: "sales", note: "Settles INV-0130", code: "Sales - 200" },
  ] };
  const matches = { [splitPartId("pay1", 0)]: A, [splitPartId("pay1", 1)]: B };

  const resolveAccount = (code) => ({ code: /(\d{3,4})/.exec(code)?.[1] ?? code, name: code });
  const journals = [postInvoice(A, { resolveAccount }), postInvoice(B, { resolveAccount })];
  for (const t of expandSplits([payment], splits, {}).transactions) {
    const inv = matches[t.id];
    assert.ok(inv, "every part settles an invoice");
    journals.push(postTransaction(t, [], {
      resolveAccount,
      settles: { number: inv.number, kind: inv.kind, taxType: "OUTPUT2", total: inv.total },
    }));
  }

  const sheet = computeBalanceSheet({ asAt: "2026-04-30", journals, chart: CHART });
  assert.equal(sheet.imbalance, 0, "the sheet balances with a split settling two invoices");

  const receivable = sheet.currentAssets.lines.find((l) => l.code === "610");
  assert.equal(receivable, undefined, "receivables raised and cleared leave nothing behind");

  const bank = sheet.currentAssets.lines.find((l) => l.code === payment.account);
  assert.equal(bank.closing, 80000, "the bank holds exactly what arrived");
});
