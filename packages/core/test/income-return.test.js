import assert from "node:assert/strict";
import test from "node:test";
import { incomeReturnPrompt, ir10Differences, readIncomeReturn } from "../dist/index.js";

// An invented company's year: a profit of 5,000.40 set against 12,000.00 of
// losses brought forward, leaving 6,999.60 to carry forward.
const answer = {
  form: "IR4",
  balanceDate: "2026-03-31",
  netIncome: 5000.4,
  netLossBroughtForward: 12000,
  netLossClaimed: 5000.4,
  lossCarriedForward: 6999.6,
  residualIncomeTax: 0,
  taxToPay: 0,
  provisionalTaxMethod: "Standard",
  imputationOpening: 0,
  imputationClosing: 0,
  lowestEconomicInterest: 100,
  ir10: {
    2: 60000, 3: 0, 4: 20000, 5: 0, 6: 40000, 7: 0, 8: 0, 9: 0, 10: 200, 11: 40200,
    13: 10000, 16: 800, 24: 24400, 25: 35200, 26: 0, 27: 5000, 28: 0, 29: 5000,
    30: 3000, 31: 9000, 33: 4000, 43: 16000, 45: 500, 48: 500, 49: 20000, 50: 20500, 51: -4500,
  },
};

test("a return that adds up is read, in cents, with nothing to flag", () => {
  const read = readIncomeReturn(JSON.stringify(answer));
  assert.deepEqual(read.problems, []);
  assert.equal(read.filed.lossCarriedForward, 699960);
  assert.equal(read.filed.netLossClaimed, 500040);
  assert.equal(read.filed.ir10[2], 6000000);
  assert.equal(read.filed.ir10[51], -450000);
  assert.equal(read.filed.lowestEconomicInterest, 100);
});

test("a misread loss is caught by the return's own arithmetic", () => {
  const read = readIncomeReturn(JSON.stringify({ ...answer, lossCarriedForward: 9699.6 }));
  assert.ok(read.problems.some((p) => /Loss carried forward should be 6999\.60/.test(p)));
});

test("an IR10 total that does not add up is caught", () => {
  const read = readIncomeReturn(JSON.stringify({ ...answer, ir10: { ...answer.ir10, 25: 32500 } }));
  assert.ok(read.problems.some((p) => /box 25 \(total expenses\)/.test(p)));
});

test("a code fence, prose around it, and stray keys are tolerated; the wrong form is not", () => {
  const wrapped = "Here you go:\n```json\n" + JSON.stringify({ ...answer, irdNumber: "999-999-999" }) + "\n```";
  const read = readIncomeReturn(wrapped);
  assert.deepEqual(read.problems, []);
  assert.equal(read.filed.irdNumber, undefined, "only the keys asked for are kept");
  assert.ok(readIncomeReturn(JSON.stringify({ ...answer, form: "IR9" })).problems.some((p) => /only the IR4 and IR3/.test(p)));
  assert.ok(
    readIncomeReturn(JSON.stringify(answer), "IR3").problems.some((p) => /an IR3 was being read/.test(p)),
    "an IR4 answer is refused where an IR3 was asked for",
  );
  assert.ok(readIncomeReturn("no json here").problems.length > 0);
});

test("the prompt asks for JSON only, by IR10 box number, without the IRD number", () => {
  const prompt = incomeReturnPrompt();
  assert.match(prompt, /one JSON object and nothing else/);
  assert.match(prompt, /"29": Current year taxable profit\/loss/);
  assert.match(prompt, /Do not include the IRD number/);
});

test("only boxes that differ by more than a dollar are reported", () => {
  const diffs = ir10Differences({ 2: 6000000, 31: 900000, 45: 50000 }, { 2: 6000050, 31: 880000 });
  assert.deepEqual(diffs.map((d) => d.box), [31, 45]);
});

// An invented individual: wages, some interest, and a half share of a
// residential rental that made a loss, ring-fenced against the property.
const person = {
  form: "IR3",
  balanceDate: "2026-03-31",
  salaryWages: 60000, payeDeducted: 11000,
  interestGross: 200, rwtOnInterest: 60,
  rentalIncome: -1500,
  totalIncome: 60200,
  taxableIncome: 60200,
  taxOnIncome: 11100,
  totalTaxCredits: 11060,
  residualIncomeTax: 40,
  taxToPay: 40,
  rentals: [
    { property: "12 Totara Street", grossIncome: 9000, expenses: 10500, netIncome: -1500,
      ringFencedLossBroughtForward: 2000, ringFencedLossUsed: 0, ringFencedLossCarriedForward: 3500 },
  ],
};

test("an IR3 that adds up is read, with its rental schedules", () => {
  const read = readIncomeReturn(JSON.stringify(person), "IR3");
  assert.deepEqual(read.problems, []);
  assert.equal(read.filed.form, "IR3");
  assert.equal(read.filed.residualIncomeTax, 4000);
  assert.equal(read.filed.rentals[0].ringFencedLossCarriedForward, 350000);
});

test("an IR3's misread figures are caught", () => {
  const wrongTotal = readIncomeReturn(JSON.stringify({ ...person, totalIncome: 62200, taxableIncome: 62200 }), "IR3");
  assert.ok(wrongTotal.problems.some((p) => /Total income reads 62200.00/.test(p)));
  const wrongRit = readIncomeReturn(JSON.stringify({ ...person, residualIncomeTax: 400 }), "IR3");
  assert.ok(wrongRit.problems.some((p) => /Residual income tax should be 40.00/.test(p)));
  const wrongFence = readIncomeReturn(
    JSON.stringify({ ...person, rentals: [{ ...person.rentals[0], ringFencedLossCarriedForward: 2000 }] }),
    "IR3",
  );
  assert.ok(wrongFence.problems.some((p) => /Totara Street: ring-fenced loss carried forward should be 3500.00/.test(p)));
  const wrongNet = readIncomeReturn(
    JSON.stringify({ ...person, rentals: [{ ...person.rentals[0], netIncome: -500 }] }),
    "IR3",
  );
  assert.ok(wrongNet.problems.some((p) => /income less expenses is -1500.00/.test(p)));
});

test("the IR3 prompt asks for the rental schedules and no names", () => {
  const prompt = incomeReturnPrompt("IR3");
  assert.match(prompt, /"rentals": an array/);
  assert.match(prompt, /ringFencedLossCarriedForward/);
  assert.match(prompt, /Do not include the IRD number, any name or any address/);
});

test("loss balances given as negatives are read as the amounts they are", () => {
  const negative = { ...answer, netLossBroughtForward: -12000, netLossClaimed: -5000.4, lossCarriedForward: -6999.6 };
  const read = readIncomeReturn(JSON.stringify(negative));
  assert.deepEqual(read.problems, []);
  assert.equal(read.filed.lossCarriedForward, 699960);
  assert.match(incomeReturnPrompt(), /Every\s+loss balance[\s\S]*is a positive amount/);
});

test("a company with no losses: blank loss boxes left out read as nil", () => {
  const { netLossBroughtForward: _a, netLossClaimed: _b, lossCarriedForward: _c, ...rest } = answer;
  const read = readIncomeReturn(JSON.stringify({ ...rest, netIncome: 5000.4 }));
  assert.ok(read.filed, read.problems.join(" "));
  assert.equal(read.filed.netLossBroughtForward, 0);
  assert.equal(read.filed.netLossClaimed, 0);
  assert.equal(read.filed.lossCarriedForward, 0);
});

test("a loss for the year with the carry-forward left out is still caught", () => {
  const { netLossBroughtForward: _a, netLossClaimed: _b, lossCarriedForward: _c, ...rest } = answer;
  const read = readIncomeReturn(JSON.stringify({ ...rest, netIncome: -3000 }));
  assert.ok(read.problems.some((p) => /Loss carried forward should be 3000\.00/.test(p)), read.problems.join(" "));
});

test("the prompt asks for blank loss boxes as 0", () => {
  assert.match(incomeReturnPrompt("IR4"), /blank, or says nil, means there was no loss/);
});

test("a rental shown only as a net figure is kept, and a missing figure is worked out", () => {
  // myIR gives rental income outside the residential portfolio -- a
  // commercial property -- as "Other net rental income", one figure.
  const withOther = {
    ...person,
    rentals: [
      person.rentals[0],
      { property: "Other rental income", netIncome: 5000 },
      { property: "Shop", grossIncome: 8000, netIncome: 6000 },
    ],
  };
  const read = readIncomeReturn(JSON.stringify(withOther), "IR3");
  assert.ok(read.filed, read.problems.join("; "));
  assert.equal(read.filed.rentals.length, 3);
  assert.equal(read.filed.rentals[1].netIncome, 500000);
  assert.equal(read.filed.rentals[1].grossIncome, undefined);
  assert.equal(read.filed.rentals[2].expenses, 200000);

  const nothing = readIncomeReturn(
    JSON.stringify({ ...person, rentals: [{ property: "Shop", grossIncome: 8000 }] }),
    "IR3",
  );
  assert.equal(nothing.filed, undefined);
  assert.ok(nothing.problems.some((p) => /net income is needed/.test(p)));
});

test("an IR3 with IETC and rentals given only in the schedules adds up", () => {
  // Invented, in the shape of a real one: interest, a residential portfolio
  // and other net rental income, with the independent earner tax credit.
  const answer = {
    form: "IR3",
    balanceDate: "2026-03-31",
    interestGross: 45.12,
    rwtOnInterest: 7.89,
    totalIncome: 69646.07,
    taxableIncome: 69646.07,
    taxOnIncome: 13114.3,
    ietc: 46.01,
    totalTaxCredits: 7.89,
    residualIncomeTax: 13060.4,
    rentals: [
      { property: "Residential", grossIncome: 20753.76, expenses: 5834.19, netIncome: 14919.57 },
      { property: "Other rental", netIncome: 54681.38 },
    ],
  };
  const read = readIncomeReturn(JSON.stringify(answer), "IR3");
  assert.deepEqual(read.problems, []);
  assert.equal(read.filed.rentalIncome, 6960095);
  assert.equal(read.filed.ietc, 4601);
});
