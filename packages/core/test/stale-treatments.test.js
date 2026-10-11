import test from "node:test";
import assert from "node:assert/strict";
import { withoutStaleTreatments, knownCodes, labelForChartAccount } from "../dist/index.js";

const purchases = { code: "300", name: "Purchases", type: "Direct Costs", taxCode: "15% GST on Expenses" };

test("a standard chart's name left on a number the loaded chart calls something else goes", () => {
  // The Demo Company's 300 Purchases came out as Depreciation Recovered.
  const rules = { rules: [], codeTreatments: { "Depreciation Recovered - 300": "out-of-scope", "Advertising - 400": "standard" } };
  const chart = [purchases, { code: "400", name: "Advertising", type: "Overhead", taxCode: "" }];
  const tidied = withoutStaleTreatments(rules, new Set(), chart);
  assert.deepEqual(Object.keys(tidied.codeTreatments), ["Advertising - 400"]);
  const known = knownCodes(tidied, {}, chart);
  assert.equal(labelForChartAccount(purchases, known), "Purchases - 300");
});

test("a treatment something is coded to stays, whatever the chart says", () => {
  const rules = { rules: [], codeTreatments: { "Depreciation Recovered - 300": "out-of-scope" } };
  const kept = withoutStaleTreatments(rules, new Set(["Depreciation Recovered - 300"]), [purchases]);
  assert.equal(kept, rules);
});

test("the same name with the code in front is the same account", () => {
  const rules = { rules: [], codeTreatments: { "300 - Purchases": "standard", "300": "standard" } };
  assert.equal(withoutStaleTreatments(rules, new Set(), [purchases]), rules);
});
