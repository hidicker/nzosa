import assert from "node:assert/strict";
import test from "node:test";
import { ir3Summary } from "../dist/index.js";

const extra = (category, gross, credits = 0, payer = "SOMEBODY") => ({
  owner: "Alex", year: 2026, category, payer, gross, credits,
});
const YEAR = { owner: "Alex", year: 2026 };
const line = (s, label) => s.income.find((l) => l.label.startsWith(label));
const out = (s, label) => s.excluded.find((l) => l.label.startsWith(label));

test("income arrives gross, with the tax already paid on it", () => {
  // The whole reason these are entered by hand: a bank feed sees 780 of salary
  // landing, not 1,000 earned with 220 of PAYE withheld.
  const s = ir3Summary({ ...YEAR, extras: [
    extra("salary", 100000, 22000),
    extra("interest", 5000, 1650),
  ]});
  assert.equal(line(s, "Salary").amount, 100000);
  assert.equal(line(s, "Salary").credits, 22000);
  assert.equal(line(s, "Interest").credits, 1650);
  assert.equal(s.totalIncome, 105000);
  assert.equal(s.totalCredits, 23650);
});

test("a residential rental profit is taxed", () => {
  const s = ir3Summary({ ...YEAR, extras: [],
    shares: { owner: "Alex", shares: [], residentialIncome: 300000, residentialExpenses: 200000,
      residentialNet: 100000, otherIncome: 0, otherExpenses: 0, otherNet: 0 } });
  assert.equal(line(s, "Residential rental income").amount, 100000);
  assert.equal(s.totalIncome, 100000);
  assert.equal(s.ringFencedLoss, 0);
});

test("a residential rental loss is ring-fenced, not deducted", () => {
  // The rule that costs money if it is got wrong: a loss on residential
  // property cannot reduce salary or business income.
  const s = ir3Summary({ ...YEAR, extras: [extra("salary", 100000, 22000)],
    shares: { owner: "Alex", shares: [], residentialIncome: 200000, residentialExpenses: 350000,
      residentialNet: -150000, otherIncome: 0, otherExpenses: 0, otherNet: 0 } });
  assert.equal(s.totalIncome, 100000, "the salary alone; the loss does not reduce it");
  assert.equal(s.ringFencedLoss, 150000);
  assert.match(out(s, "Residential rental loss").note, /carried forward/);
  assert.equal(line(s, "Residential rental"), undefined, "it is not an income line");
});

test("business income is included and rental is kept apart from it", () => {
  const s = ir3Summary({ ...YEAR, extras: [],
    shares: { owner: "Alex", shares: [], residentialIncome: 0, residentialExpenses: 0,
      residentialNet: 0, otherIncome: 500000, otherExpenses: 200000, otherNet: 300000 } });
  assert.equal(line(s, "Business and other income").amount, 300000);
  assert.equal(s.totalIncome, 300000);
});

test("PIE income is shown but not taxed again", () => {
  // Taxed already at the prescribed investor rate. Adding it to income would
  // tax the same money twice.
  const s = ir3Summary({ ...YEAR, extras: [extra("salary", 100000, 22000), extra("pie", 40000, 11200)] });
  assert.equal(s.totalIncome, 100000, "the salary only");
  const pie = out(s, "PIE income");
  assert.equal(pie.amount, 40000, "still shown, so nobody thinks it was missed");
  assert.match(pie.note, /prescribed investor rate/);
});

test("what the books cannot know is said, so silence is not read as nil", () => {
  const s = ir3Summary({ ...YEAR, extras: [] });
  assert.equal(s.totalIncome, 0);
  assert.ok(s.missing.some((m) => /salary/i.test(m) && /PAYE/.test(m)));
  assert.ok(s.missing.some((m) => /interest/i.test(m) && /RWT/.test(m)));
  assert.ok(s.missing.some((m) => /dividend/i.test(m) && /imputation/i.test(m)));
  assert.ok(s.missing.some((m) => /no entity shares/i.test(m)));
});

test("only this person's year is counted", () => {
  const s = ir3Summary({ ...YEAR, extras: [
    extra("salary", 100000, 22000),
    { ...extra("salary", 999900, 0), owner: "Sam" },
    { ...extra("salary", 888800, 0), year: 2025 },
  ]});
  assert.equal(s.totalIncome, 100000);
});

test("several payers of the same kind add up into one line", () => {
  const s = ir3Summary({ ...YEAR, extras: [
    extra("interest", 5000, 1650, "BNZ"),
    extra("interest", 3000, 990, "ANZ"),
  ]});
  assert.equal(line(s, "Interest").amount, 8000);
  assert.equal(line(s, "Interest").credits, 2640);
});

test("no box numbers are printed", () => {
  // Inland Revenue renumbers the form. A stale number stated with confidence
  // is worse than a named line somebody has to place.
  const s = ir3Summary({ ...YEAR, extras: [extra("salary", 100000, 22000)] });
  for (const l of [...s.income, ...s.excluded]) {
    assert.ok(!/\bbox\s*\d+/i.test(l.label), `"${l.label}" names a box`);
  }
});
