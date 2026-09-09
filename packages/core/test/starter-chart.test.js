import assert from "node:assert/strict";
import test from "node:test";
import { starterChart, chartTreatments, isKnownType, accountLabel } from "../dist/index.js";

test("the starter chart is a chart somebody could file from", () => {
  const chart = starterChart();
  assert.ok(chart.length > 50, `only ${chart.length} accounts`);

  // Every account has to be placeable on a report, or it arrives amber and
  // the first thing a new user sees is a chart that looks broken.
  const unplaceable = chart.filter((a) => !isKnownType(a.type));
  assert.deepEqual(unplaceable.map((a) => `${a.name}: ${a.type}`), []);

  // And every one has to say how it is treated for GST, or the first return
  // assumes standard-rated across the board.
  const untreated = chart.filter((a) => a.taxCode.trim() === "");
  assert.deepEqual(untreated.map((a) => a.name), []);
});

test("every account has a code, and no two share one", () => {
  const chart = starterChart();
  assert.deepEqual(chart.filter((a) => a.code.trim() === "").map((a) => a.name), []);
  const codes = chart.map((a) => a.code);
  assert.equal(codes.length, new Set(codes).size);
});

test("the chart's treatments are found under the names codings use", () => {
  const chart = starterChart();
  const map = chartTreatments(chart, undefined, {});
  const bank = chart.find((a) => a.name === "Bank Fees");
  const sales = chart.find((a) => a.name === "Sales");
  assert.deepEqual(map.get(accountLabel(bank.code, bank.name)), {
    treatment: "out-of-scope", side: "none",
  });
  assert.deepEqual(map.get(accountLabel(sales.code, sales.name)), {
    treatment: "standard", side: "sales",
  });
});

test("the accounts a New Zealand return needs are in it", () => {
  const chart = starterChart();
  const has = (code) => chart.some((a) => a.code === code);
  // GST control, accounts receivable and payable, retained earnings: without
  // these a set of books cannot be closed off or handed to an accountant.
  for (const code of ["200", "820", "610", "800", "960"]) {
    assert.ok(has(code), `no account ${code}`);
  }
});

test("each call gets its own copy", () => {
  // The caller owns and edits what it gets back; one shared array would let
  // one set of books rename an account in another.
  const first = starterChart();
  first[0].name = "Changed";
  assert.notEqual(starterChart()[0].name, "Changed");
});
