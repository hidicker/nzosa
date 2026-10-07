import test from "node:test";
import assert from "node:assert/strict";
import { SCHEDULE_C, SCHEDULE_E, accountTreatment, formLineFor, starterChart, starterChartFor } from "../dist/index.js";

test("New Zealand's starter chart is the one it always was", () => {
  assert.deepEqual(starterChartFor("nz"), starterChart());
  assert.deepEqual(starterChartFor("generic"), starterChart());
});

test("Australia's tax codes are read for what they mean", () => {
  const chart = starterChartFor("au");
  const treatment = (code) => accountTreatment(chart.find((a) => a.code === code)).treatment;
  assert.equal(treatment("200"), "standard"); // GST on Income
  assert.equal(treatment("404"), "zero-rated"); // GST Free Expenses
  assert.equal(treatment("270"), "exempt"); // Input Taxed
  assert.equal(treatment("416"), "out-of-scope"); // BAS Excluded
});

test("Korea's: 10% VAT standard, No VAT outside, Exempt exempt", () => {
  const chart = starterChartFor("kr");
  const treatment = (code) => accountTreatment(chart.find((a) => a.code === code)).treatment;
  assert.equal(treatment("401"), "standard");
  assert.equal(treatment("451"), "standard");
  assert.equal(treatment("813"), "out-of-scope");
  assert.equal(treatment("821"), "exempt");
});

test("New Zealand's own codes read exactly as before", () => {
  const nz = starterChart();
  for (const account of nz) {
    const code = account.taxCode.toLowerCase();
    assert.ok(!/input taxed|bas excluded|no vat|no sales tax|gst free|vat free/.test(code), account.taxCode);
  }
});

test("the US chart's names fall on the Schedule C and E lines they are meant for", () => {
  const chart = starterChartFor("us");
  const name = (code) => chart.find((a) => a.code === code).name;
  assert.equal(formLineFor(SCHEDULE_C, name("6030"), "expense"), "11");
  assert.equal(formLineFor(SCHEDULE_C, name("6160"), "expense"), "24b");
  assert.equal(formLineFor(SCHEDULE_C, name("6100"), "expense"), "20a");
  assert.equal(formLineFor(SCHEDULE_C, name("6110"), "expense"), "20b");
  assert.equal(formLineFor(SCHEDULE_C, name("5000"), "expense"), "4");
  assert.equal(formLineFor(SCHEDULE_E, name("6190"), "expense"), "11");
  assert.equal(formLineFor(SCHEDULE_E, name("6200"), "expense"), "7");
  assert.equal(formLineFor(SCHEDULE_E, name("4100"), "income"), "3");
});
