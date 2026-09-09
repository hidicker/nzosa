import assert from "node:assert/strict";
import test from "node:test";
import {
  generalLedgerRows,
  generalLedgerTotals,
  formatGeneralLedger,
} from "../dist/general-ledger.js";

/** An accountant's fee paid from the bank: money out, the cost, and the GST. */
const fee = {
  transactionId: "t-fee",
  date: "2026-08-28",
  narration: "Accountant",
  source: "bank",
  taxBasis: "both",
  lines: [
    { accountCode: "02-1100-0022001-000", accountName: "Trading Account", amount: -90726, taxType: "NONE", description: "Accountant" },
    { accountCode: "412", accountName: "Consulting & Accounting", amount: 78892, taxType: "INPUT2", taxBase: -90726, description: "Accountant" },
    { accountCode: "820", accountName: "GST", amount: 11834, taxType: "INPUT2", description: "GST" },
  ],
};

const transfer = {
  transactionId: "transfer:a:b",
  date: "2026-08-28",
  narration: "Transfer — Trading to Loan",
  source: "transfer",
  taxBasis: "both",
  lines: [
    { accountCode: "02-1100-0022001-000", accountName: "Trading Account", amount: -9717, taxType: "NONE", description: "" },
    { accountCode: "loan-1001", accountName: "Home Loan", amount: 9717, taxType: "NONE", description: "" },
  ],
};

test("one bank payment becomes three rows, not one", () => {
  // This is the whole point of the report: the money out, the cost it paid
  // for, and the tax inside it, each on its own line.
  const rows = generalLedgerRows([fee]);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.accountCode), ["02-1100-0022001-000", "412", "820"]);
  assert.deepEqual(rows.map((r) => r.credit), [90726, 0, 0]);
  assert.deepEqual(rows.map((r) => r.debit), [0, 78892, 11834]);
});

test("the gross a tax was worked out from rides with the line", () => {
  // Box 11 wants the gross and Box 12 wants the tax, so a listing that dropped
  // this would make the return unprovable from it.
  const [, cost, gst] = generalLedgerRows([fee]);
  assert.equal(cost.taxBase, -90726);
  assert.equal(gst.taxBase, null);
});

test("a balanced set of books comes to nothing", () => {
  const totals = generalLedgerTotals(generalLedgerRows([fee, transfer]));
  assert.equal(totals.debit, 78892 + 11834 + 9717);
  assert.equal(totals.credit, 90726 + 9717);
  assert.equal(totals.difference, 0);
});

test("an entry that does not balance is not hidden", () => {
  // A listing that quietly adds up when the books do not is worse than no
  // listing: the difference is the thing worth chasing.
  const broken = { ...fee, lines: [fee.lines[0], fee.lines[1]] };
  assert.equal(generalLedgerTotals(generalLedgerRows([broken])).difference, -11834);
});

test("the lines of one entry stay together, in date order", () => {
  const later = { ...fee, transactionId: "t-late", date: "2026-09-01" };
  const rows = generalLedgerRows([later, transfer, fee]);
  assert.deepEqual(
    rows.map((r) => `${r.date}/${r.journal}`),
    [
      "2026-08-28/t-fee", "2026-08-28/t-fee", "2026-08-28/t-fee",
      "2026-08-28/transfer:a:b", "2026-08-28/transfer:a:b",
      "2026-09-01/t-late", "2026-09-01/t-late", "2026-09-01/t-late",
    ],
  );
});

test("the file says what it is, and carries its own proof", () => {
  const csv = formatGeneralLedger([fee], {
    entity: "Kea Coffee Roasters Limited",
    period: { from: "2026-04-01", to: "2027-03-31" },
  });
  const lines = csv.trimEnd().split("\r\n");
  assert.equal(lines[0], "General Ledger");
  assert.equal(lines[1], "Kea Coffee Roasters Limited");
  assert.equal(lines[2], "For the period 2026-04-01 to 2027-03-31");
  assert.match(lines[3] ?? "", /^Date,Source,Journal,Narration,Account Code,Account,Description,Debit,Credit,Tax Type,Tax Base,Deductible %$/);
  // Totals in the file, so somebody handed it does not have to add it up.
  assert.match(csv, /Totals,,,,90726\.00/.test(csv) ? /x^/ : /Totals/);
  assert.match(csv, /Debits less credits: 0\.00/);
});

test("a payee with a comma stays in one column", () => {
  const csv = formatGeneralLedger([
    { ...fee, narration: 'Smith, Jones & Co "the firm"' },
  ]);
  assert.match(csv, /"Smith, Jones & Co ""the firm"""/);
});
