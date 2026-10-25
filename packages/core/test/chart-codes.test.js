import assert from "node:assert/strict";
import test from "node:test";
import { chartTreatments, knownCodes, labelForChartAccount } from "../dist/index.js";

const account = (over) => ({ code: "", name: "", type: "", taxCode: "", description: "", ...over });

const CHART = [
  account({ code: "200", name: "Sales", type: "Revenue", taxCode: "15% GST on Income" }),
  account({ code: "400", name: "Advertising", type: "Overhead", taxCode: "15% GST on Expenses" }),
  account({ code: "820", name: "GST", type: "Current Liability", taxCode: "No GST" }),
  account({ code: "", name: "NZD Wise", type: "Bank", taxCode: "No GST" }),
  account({ code: "477", name: "Salaries", type: "Overhead", taxCode: "" }),
];

test("an account answers to every name a coding uses for it", () => {
  // Both of these mean account 820. Keying only the canonical one left the
  // other with no opinion from the chart, which means assumed standard-rated
  // -- so an account marked "No GST" claimed GST under its other name.
  const rules = { rules: [{ priority: 100, keyword: "IRD", code: "820 GST" }] };
  const overrides = { a: { code: "GST - 820" } };
  const map = chartTreatments(CHART, rules, overrides);

  assert.deepEqual(map.get("820 GST"), { treatment: "out-of-scope", side: "none" });
  assert.deepEqual(map.get("GST - 820"), { treatment: "out-of-scope", side: "none" });
});

test("an account with no tax code has no opinion, rather than a default one", () => {
  // "The chart does not say" and "the chart says standard" are different
  // answers, and only one of them should be assumed.
  const map = chartTreatments(CHART, { rules: [] }, {});
  assert.equal(map.has("Salaries - 477"), false);
});

test("a bank account with no number is matched by its name", () => {
  const map = chartTreatments(CHART, { rules: [{ priority: 1, keyword: "wise", code: "NZD Wise" }] }, {});
  assert.deepEqual(map.get("NZD Wise"), { treatment: "out-of-scope", side: "none" });
});

test("a number inside something that is not an account code is left alone", () => {
  // An invoice reference is not an account. Matching it would put one
  // account's treatment onto rows that have nothing to do with it.
  const rules = { rules: [{ priority: 100, keyword: "x", code: "INV-40213" }] };
  const map = chartTreatments(CHART, rules, {});
  assert.equal(map.has("INV-40213"), false);
});

test("the house prefix wins the account's canonical name", () => {
  const known = ["200", "NB Sales - 200"];
  assert.equal(labelForChartAccount(CHART[0], known), "NB Sales - 200");
});

test("an account nothing has coded to yet gets a plain name", () => {
  assert.equal(labelForChartAccount(CHART[1], []), "Advertising - 400");
  assert.equal(labelForChartAccount(CHART[3], []), "NZD Wise");
});

test("the chart fills the picker on books nobody has coded yet", () => {
  const codes = knownCodes(undefined, {}, CHART);
  assert.ok(codes.includes("Advertising - 400"));
  assert.ok(codes.includes("NZD Wise"));
});

test("an inactive account is not offered for new coding, under any of its names", async () => {
  const { pickableCodes } = await import("../dist/index.js");
  const chart = [
    { code: "400", name: "Advertising" },
    { code: "404", name: "Bank Fees", inactive: true },
    { code: "4040", name: "Bank Fees Old" },
    { code: "", name: "Petty cash", inactive: true },
  ];
  const offered = pickableCodes({ rules: [{ code: "Bank Fees - 404", match: "x" }] }, { t1: { code: "Bank Fees - 404" } }, chart);
  assert.ok(offered.includes("Advertising - 400"));
  assert.ok(offered.includes("Bank Fees Old - 4040"), "a longer code that begins the same is a different account");
  assert.ok(!offered.some((c) => /\b404\b/.test(c)));
  assert.ok(!offered.includes("Petty cash"));
  assert.ok(knownCodes({}, {}, chart).includes("Bank Fees - 404"), "the books still know it");
});
