import assert from "node:assert/strict";
import test from "node:test";
import { accountTreatment, parseChartOfAccounts } from "../dist/chart.js";

const account = (taxCode) => ({ code: "200", name: "Sales", type: "Revenue", taxCode, description: "" });

test("reads the tax codes a chart export actually carries", () => {
  assert.deepEqual(accountTreatment(account("15% GST on Income")), {
    treatment: "standard",
    side: "sales",
  });
  assert.deepEqual(accountTreatment(account("15% GST on Expenses")), {
    treatment: "standard",
    side: "purchases",
  });
  assert.deepEqual(accountTreatment(account("No GST")), {
    treatment: "out-of-scope",
    side: "none",
  });
});

test("the specific treatments are checked before the plain rated ones", () => {
  // Both of these contain a word the rated tests look for. Checking income and
  // expenses first would make them standard-rated, which for an import would
  // claim 3/23 of the GST instead of the GST.
  assert.deepEqual(accountTreatment(account("Zero Rated Income")), { treatment: "zero-rated" });
  assert.deepEqual(accountTreatment(account("GST on Imports")), {
    treatment: "standard",
    side: "imports",
  });
  assert.deepEqual(accountTreatment(account("Exempt Expenses")), {
    treatment: "exempt",
    side: "none",
  });
});

test("an account with no tax code implies nothing", () => {
  assert.equal(accountTreatment(account("")), null);
  assert.equal(accountTreatment(account("Something else entirely")), null);
});

test("a chart export keeps its tax code through the import", () => {
  const csv = [
    "*Code,*Name,*Type,*Tax Code,Description",
    "200,Sales,Revenue,15% GST on Income,",
    "429,General Expenses,Expense,15% GST on Expenses,",
    "500,Drawings,Equity,No GST,",
  ].join("\r\n");

  const { accounts, problems } = parseChartOfAccounts(csv);
  assert.deepEqual(problems, []);
  assert.equal(accounts.length, 3);
  assert.deepEqual(
    accounts.map((a) => accountTreatment(a)?.treatment ?? null),
    ["standard", "standard", "out-of-scope"],
  );
});

test("the chart is consulted below a treatment set here, and above assuming", async () => {
  const { gstResolver } = await import("../dist/gst-rules.js");

  const spend = {
    id: "t1",
    date: "2025-06-01",
    amount: -11500,
    currency: "NZD",
    account: "bank-01",
    serial: "",
    trn: "",
    particulars: "",
    code: "",
    reference: "",
    otherParty: "Somewhere",
    origin: "",
    type: "",
    batch: "",
    otherPartyAccount: "",
  };

  const codeOf = () => "500 - Drawings";

  // With nothing said anywhere, an unmatched line is assumed standard-rated.
  const bare = gstResolver({ codeOf })(spend);
  assert.equal(bare.treatment, "standard");

  // The chart knows better.
  const withChart = gstResolver({
    codeOf,
    chartTreatment: () => ({ treatment: "out-of-scope", side: "none" }),
  })(spend);
  assert.equal(withChart.treatment, "out-of-scope");
  assert.match(withChart.reason, /Chart of accounts/);

  // And a treatment set here outranks the chart.
  const decided = gstResolver({
    codeOf,
    codeTreatments: { "500 - Drawings": "exempt" },
    chartTreatment: () => ({ treatment: "out-of-scope", side: "none" }),
  })(spend);
  assert.equal(decided.treatment, "exempt");
});
