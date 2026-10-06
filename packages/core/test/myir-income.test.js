import assert from "node:assert/strict";
import test from "node:test";
import { myirIncomePrompt, myirTaxExtras, readMyirIncome } from "../dist/index.js";

// An answer in the shape asked for, figures invented: wages, interest,
// dividends with imputation, two PIE funds, and schedular payments.
const answer = {
  from: "2025-04-01",
  to: "2026-03-31",
  totalIncome: 12100.0,
  totalDeductions: 3350.0,
  lines: [
    { kind: "salary", payer: "EXAMPLE EMPLOYER LTD", gross: 1000, tax: 300 },
    { kind: "interest", payer: "EXAMPLE BANK", gross: 100, tax: 30 },
    { kind: "dividends", payer: "EXAMPLE NOMINEES", gross: 50, tax: 5, imputation: 15 },
    { kind: "pie", payer: "EXAMPLE KIWISAVER", gross: 9000, tax: 2520 },
    { kind: "pie", payer: "EXAMPLE FUND", gross: 950, tax: 280 },
    { kind: "schedular", payer: "EXAMPLE CLIENT", gross: 1000, tax: 200 },
  ],
};

test("myIR's income details are read, payer by payer, and checked against its totals", () => {
  const read = readMyirIncome(JSON.stringify(answer));
  assert.deepEqual(read.problems, []);
  assert.equal(read.income.year, 2026);
  assert.equal(read.income.lines.length, 6);
  const extras = myirTaxExtras(read.income, "Pat Example");
  assert.equal(extras[0].category, "salary");
  assert.equal(extras[2].imputation, 1500);
  assert.equal(extras[5].category, "other");
  assert.match(extras[5].note, /Schedular payments/);
  assert.ok(extras.every((e) => e.owner === "Pat Example" && e.year === 2026));
});

test("lines that do not add up to myIR's totals are refused", () => {
  const short = { ...answer, lines: answer.lines.slice(1) };
  const read = readMyirIncome(JSON.stringify(short));
  assert.equal(read.income, undefined);
  assert.ok(read.problems.some((p) => /income comes to/.test(p)));
});

test("the prompt asks for every kind of income myIR lists, and no name", () => {
  const prompt = myirIncomePrompt();
  for (const kind of ["salary", "schedular", "interest", "dividends", "pie", "maori", "other"]) {
    assert.match(prompt, new RegExp(`"${kind}"`));
  }
  assert.match(prompt, /Do not include the IRD number or the person's name/);
});

test("each payer's dated amounts are kept, and have to make its totals", async () => {
  const { taxTypeOf } = await import("../dist/index.js");
  const withDates = {
    ...answer,
    lines: answer.lines.map((l, i) =>
      i === 1
        ? { ...l, details: [{ date: "2025-12-31", gross: 60, tax: 18 }, { date: "2026-01-31", gross: 40, tax: 12 }] }
        : l,
    ),
  };
  const read = readMyirIncome(JSON.stringify(withDates));
  assert.deepEqual(read.problems, []);
  const extras = myirTaxExtras(read.income, "Pat Example");
  assert.equal(extras[1].details.length, 2);
  assert.equal(taxTypeOf(extras[0]), "PAYE deductions");
  assert.equal(taxTypeOf(extras[1]), "RWT");
  assert.equal(taxTypeOf(extras[3]), "PIE tax credits");
  assert.equal(taxTypeOf(extras[5]), "tax on schedular payments");

  const wrong = JSON.parse(JSON.stringify(withDates));
  wrong.lines[1].details[1].gross = 45;
  const refused = readMyirIncome(JSON.stringify(wrong));
  assert.equal(refused.income, undefined);
  assert.ok(refused.problems.some((p) => /dated amounts come to/.test(p)));
});
