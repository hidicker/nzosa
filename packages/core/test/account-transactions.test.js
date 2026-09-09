import assert from "node:assert/strict";
import test from "node:test";
import { formatAccountTransactions, accountTransactionRows, gstRateName } from "../dist/account-transactions.js";

const tx = (over) => ({
  id: "t1", date: "2025-09-26", account: "02-1100-0022001-000", amount: -11500,
  currency: "NZD", otherParty: "Tui Glider Works", particulars: "Gear",
  code: "", reference: "INV-88", ...over,
});

const standard = () => ({ treatment: "standard", side: "purchases" });

test("a spend is written as Xero writes one", () => {
  const csv = formatAccountTransactions([tx()], {
    codeOf: () => "730 - Roasting Equipment",
    classify: standard,
    accountName: () => "BNZ 01 - Trading Account",
    entity: "Kea Coffee Roasters Limited",
    period: { from: "2025-09-01", to: "2025-09-30" },
  });
  const lines = csv.trimEnd().split("\r\n");
  assert.equal(lines[0], "Account Transactions");
  assert.equal(lines[1], "Exported by NZOSA");
  assert.equal(lines[2], "Kea Coffee Roasters Limited");
  assert.equal(lines[3], "For the period 2025-09-01 to 2025-09-30");
  assert.match(lines[4] ?? "", /^Date,Source,Contact,Contact Group,Description,Invoice Number,Reference,Debit,Credit,Gross,Net,GST,GST Rate,GST Rate Name,Account Code,Account,Account Type,Related account$/);

  const row = (lines[5] ?? "").split(",");
  assert.equal(row[0], "2025-09-26");
  assert.equal(row[1], "Spend Money");
  // Money out is a credit on this report, and the debit column stays at zero.
  assert.equal(row[7], "0.0000");
  assert.equal(row[8], "115.0000");
  assert.equal(row[9], "-115.0000");
  assert.equal(row[10], "-100.0000");
  assert.equal(row[11], "-15.0000");
});

test("the GST account is named beside the coding, as the report does", () => {
  const [row] = accountTransactionRows([tx()], {
    codeOf: () => "730 - Roasting Equipment",
    classify: standard,
  });
  assert.equal(row.relatedAccount, "730 - Roasting Equipment, 820 - GST");
});

test("no GST means no GST account beside it", () => {
  const [row] = accountTransactionRows([tx()], {
    codeOf: () => "880 - Owner Drawings",
    classify: () => ({ treatment: "out-of-scope", side: "none" }),
  });
  assert.equal(row.relatedAccount, "880 - Owner Drawings");
  assert.equal(row.gst, 0);
  assert.equal(row.gstRate, 0);
});

test("a line nothing coded says so rather than looking coded to nothing", () => {
  const [row] = accountTransactionRows([tx()], { codeOf: () => "", classify: standard });
  assert.equal(row.relatedAccount, "(not coded)");
});

test("half-deductible entertainment claims half the GST and all of the cost", () => {
  const [row] = accountTransactionRows([tx({ amount: -23000 })], {
    codeOf: () => "420 - Entertainment",
    classify: () => ({ treatment: "standard", side: "purchases", deductiblePercent: 50 }),
  });
  // 230.00 gross carries 30.00 of GST; half of it may be claimed.
  assert.equal(row.gst, -1500);
  assert.equal(row.gross, -23000);
  assert.equal(row.net, -21500);
});

test("money in is a receipt", () => {
  const [row] = accountTransactionRows([tx({ amount: 23000 })], {
    codeOf: () => "200 - Sales",
    classify: () => ({ treatment: "standard", side: "sales" }),
  });
  assert.equal(row.source, "Receive Money");
  assert.equal(row.gstRateName, "15% GST on Income");
  assert.equal(row.gst, 3000);
});

test("the rate names are the ones an accountant already reads", () => {
  assert.equal(gstRateName({ treatment: "standard", side: "sales" }), "15% GST on Income");
  assert.equal(gstRateName({ treatment: "standard", side: "purchases" }), "15% GST on Expenses");
  assert.equal(gstRateName({ treatment: "zero-rated", side: "sales" }), "Zero Rated");
  assert.equal(gstRateName({ treatment: "exempt", side: "none" }), "Exempt");
  assert.equal(gstRateName({ treatment: "out-of-scope", side: "none" }), "No GST");
  assert.equal(gstRateName({ treatment: "standard", side: "imports" }), "GST on Imports");
});

test("a payee with a comma in it does not become two columns", () => {
  const csv = formatAccountTransactions([tx({ otherParty: 'Smith, Jones & Co "the firm"' })], {
    codeOf: () => "412 - Legal",
    classify: standard,
  });
  const line = csv.trimEnd().split("\r\n").at(-1) ?? "";
  assert.match(line, /"Smith, Jones & Co ""the firm"""/);
});

test("rows come out in date order", () => {
  const rows = accountTransactionRows(
    [tx({ id: "b", date: "2025-09-30" }), tx({ id: "a", date: "2025-09-01" })],
    { codeOf: () => "730 - Gear", classify: standard },
  );
  assert.deepEqual(rows.map((r) => r.date), ["2025-09-01", "2025-09-30"]);
});
