import assert from "node:assert/strict";
import test from "node:test";
import { defaultIr7ExpensePlacement, defaultIr7IncomeClass, emptyIr7Inputs, ir7AttributionRows, ir7Rows, ir7Worksheet, splitByShare } from "../dist/index.js";

const income = [
  { code: "200", name: "Sales", amount: 5_000_000 },
  { code: "260", name: "Residential rent", amount: 1_200_000 },
  { code: "270", name: "Interest received", amount: 20_000 },
  { code: "290", name: "Capital contributed", amount: 9_000_000 },
];
const expenses = [
  { code: "400", name: "Materials", amount: 1_000_000 },
  { code: "440", name: "Residential rates", amount: 300_000 },
  { code: "450", name: "Bank fees", amount: 5_000 },
];
const pair = [
  { id: "a", name: "Hemi Totara", percent: 60, irdNumber: "11111111" },
  { id: "b", name: "Aroha Totara", percent: 40, irdNumber: "22222222" },
];
const sheet = (over = {}, holders = pair, kind = "partnership") =>
  ir7Worksheet({ income, expenses, holders, kind, inputs: { ...emptyIr7Inputs(), ...over } });

test("accounts are classed from their names, and every class can be changed", () => {
  assert.equal(defaultIr7IncomeClass({ name: "Capital contributed" }), "notIncome");
  assert.equal(defaultIr7IncomeClass({ name: "Interest received" }), "interest");
  assert.equal(defaultIr7IncomeClass({ name: "Residential rent" }), "residential");
  assert.equal(defaultIr7IncomeClass({ name: "Sales" }), "business");
  assert.equal(defaultIr7ExpensePlacement({ name: "Partner salary" }), "none");
  assert.equal(defaultIr7ExpensePlacement({ name: "Bank fees" }), "general");
  assert.equal(defaultIr7ExpensePlacement({ name: "Residential rates" }), "residential");
});

test("the income is totalled by source, and the expenses taken off", () => {
  const s = sheet();
  assert.equal(s.box.business, 5_000_000 - 1_000_000, "sales less materials");
  assert.equal(s.box.interest, 20_000);
  assert.equal(s.box.residentialIncome, 1_200_000);
  assert.equal(s.box.residentialDeductions, 300_000, "kept apart: each partner applies the ring-fencing");
  assert.equal(s.box.totalIncome, 4_000_000 + 20_000 + 1_200_000);
  assert.equal(s.box.expenses, 5_000);
  assert.equal(s.box.afterExpenses, 5_215_000);
  assert.equal(s.incomeBy.notIncome, 9_000_000, "capital put in is not income");
});

test("income is attributed by share, and the attributions add up to the return", () => {
  const s = sheet();
  const [a, b] = s.attributions;
  assert.equal(a.total + b.total, s.box.afterExpenses);
  assert.equal(a.total, 3_129_000);
  assert.equal(a.interest, 12_000);
  assert.equal(b.interest, 8_000);
  assert.equal(a.residential, 720_000);
  assert.equal(a.residentialDeductions, 180_000);
  assert.deepEqual(s.problems, []);
});

test("a cent that does not divide goes to somebody: nothing is lost", () => {
  assert.deepEqual(splitByShare(100, [50, 50]), [50, 50]);
  assert.deepEqual(splitByShare(101, [50, 50]), [51, 50]);
  assert.deepEqual(splitByShare(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(splitByShare(-100, [1, 1, 1]), [-34, -33, -33]);
  assert.equal(splitByShare(7, [33.33, 33.33, 33.34]).reduce((x, y) => x + y, 0), 7);
  assert.deepEqual(splitByShare(100, []), []);
});

test("credits follow the income: RWT and imputation are added back to the gross figures and shared", () => {
  const s = sheet({ rwtInterest: 6_000, imputation: 10_000, rwtDividends: 0, overseasTax: 0 });
  assert.equal(s.box.interest, 26_000);
  assert.equal(s.box.dividends, 10_000);
  const [a, b] = s.attributions;
  assert.equal(a.otherCredits + b.otherCredits, 6_000);
  assert.equal(a.imputation + b.imputation, 10_000);
  const gross = sheet({ rwtInterest: 6_000, grossBooks: true });
  assert.equal(gross.box.interest, 20_000);
});

test("shares that do not total 100, or a missing IRD number, are said", () => {
  const off = sheet({}, [{ id: "a", name: "Hemi Totara", percent: 60 }, { id: "b", name: "Aroha Totara", percent: 30, irdNumber: "2" }]);
  assert.ok(off.problems.some((p) => /not 100%/.test(p)));
  assert.ok(off.problems.some((p) => /Hemi Totara has no IRD number/.test(p)));
  assert.ok(sheet({}, []).problems.some((p) => /No partners/.test(p)));
  assert.ok(sheet({}, [], "ltc").problems.some((p) => /No owners/.test(p)));
});

test("a sole owner of a look-through company has all of it", () => {
  const s = sheet({}, [{ id: "o", name: "Moana Totara", percent: 100, irdNumber: "3" }], "ltc");
  assert.equal(s.attributions[0].total, s.box.afterExpenses);
});

test("a loss is attributed as a loss", () => {
  const s = ir7Worksheet({
    income: [{ code: "200", name: "Sales", amount: 100_000 }],
    expenses: [{ code: "400", name: "Materials", amount: 700_000 }],
    holders: pair,
    kind: "partnership",
    inputs: emptyIr7Inputs(),
  });
  assert.equal(s.box.afterExpenses, -600_000);
  assert.equal(s.attributions[0].total, -360_000);
  assert.equal(s.attributions[1].total, -240_000);
});

test("losses extinguished on transition: share of what is left, no more than the share of income", () => {
  const s = sheet({ extinguished: 1_000_000, extinguishedClaimed: 200_000 });
  const [a, b] = s.attributions;
  assert.equal(a.extinguished, 480_000, "60% of $8,000");
  assert.equal(b.extinguished, 320_000);
  assert.equal(s.box.extinguishedDeduction, 800_000);
  const small = ir7Worksheet({
    income: [{ code: "200", name: "Sales", amount: 100_000 }],
    expenses: [],
    holders: pair,
    kind: "ltc",
    inputs: { ...emptyIr7Inputs(), extinguished: 10_000_000 },
  });
  assert.equal(small.attributions[0].extinguished, 60_000, "limited to the share of the income");
});

test("nothing to declare is a nil return", () => {
  const nil = ir7Worksheet({ income: [], expenses: [], holders: pair, kind: "partnership", inputs: emptyIr7Inputs() });
  assert.equal(nil.nil, true);
  assert.equal(sheet().nil, false);
});

test("the rows follow the form's order, and each attribution is complete", () => {
  const s = sheet();
  const boxes = ir7Rows(s).map((r) => r.box);
  assert.ok(boxes.indexOf("17B") < boxes.indexOf("22") && boxes.indexOf("22") < boxes.indexOf("24"));
  assert.deepEqual(ir7AttributionRows(s.attributions[0]).map((r) => r.box), ["26C", "26D", "26E", "26F", "26G", "26H", "26I", "26J", "26K", "26L", "26M", "26N", "26O", "26P"]);
});

function random(seed) {
  let x = seed;
  return () => {
    x = (x * 1664525 + 1013904223) % 4294967296;
    return x / 4294967296;
  };
}

test("whatever the figures and shares, the attributions always add up", () => {
  const next = random(777);
  for (let run = 0; run < 300; run++) {
    const k = 1 + Math.floor(next() * 4);
    const raw = Array.from({ length: k }, () => 1 + Math.floor(next() * 100));
    const sum = raw.reduce((x, y) => x + y, 0);
    const holders = raw.map((r, i) => ({ id: `h${i}`, name: `Holder ${i}`, percent: Math.round((r / sum) * 10000) / 100, irdNumber: "1" }));
    const drift = 100 - holders.reduce((x, h) => x + h.percent, 0);
    holders[0].percent = Math.round((holders[0].percent + drift) * 100) / 100;
    const inc = [
      { code: "A", name: "Sales", amount: Math.floor(next() * 9_000_000) },
      { code: "B", name: "Interest received", amount: Math.floor(next() * 500_000) },
      { code: "C", name: "Residential rent", amount: Math.floor(next() * 2_000_000) },
    ];
    const exp = [{ code: "X", name: "Materials", amount: Math.floor(next() * 6_000_000) }, { code: "Y", name: "Bank fees", amount: Math.floor(next() * 50_000) }];
    const s = ir7Worksheet({ income: inc, expenses: exp, holders, kind: "partnership", inputs: { ...emptyIr7Inputs(), rwtInterest: Math.floor(next() * 100_000), imputation: Math.floor(next() * 5_000) } });
    assert.equal(s.attributions.reduce((x, a) => x + a.total, 0), s.box.afterExpenses);
    assert.equal(s.attributions.reduce((x, a) => x + a.otherCredits, 0), s.box.rwtInterest);
    assert.equal(s.attributions.reduce((x, a) => x + a.residentialDeductions, 0), s.box.residentialDeductions);
    assert.ok(!s.problems.some((p) => /do not add up/.test(p)));
  }
});

import { weightedHolders } from "../dist/index.js";

test("an owner who came part-way through the year is weighted by the days held (IR879)", () => {
  const period = { from: "2025-04-01", to: "2026-03-31" };
  const holders = [
    { id: "c", name: "Charles Totara", percent: 60, irdNumber: "1" },
    { id: "d", name: "Dan Rimu", percent: 40, irdNumber: "2", to: "2025-06-29" },
    { id: "k", name: "Caroline Totara", percent: 40, irdNumber: "3", from: "2025-06-30" },
  ];
  const w = weightedHolders(holders, period);
  assert.equal(w[0].percent, 60);
  assert.ok(Math.abs(w[1].percent - (40 * 90) / 365) < 0.0001);
  assert.ok(Math.abs(w[2].percent - (40 * 275) / 365) < 0.0001);
  const s = ir7Worksheet({
    income: [{ code: "A", name: "Sales", amount: 50_000_000 }],
    expenses: [],
    holders,
    kind: "ltc",
    period,
    inputs: emptyIr7Inputs(),
  });
  assert.deepEqual(s.problems, []);
  assert.equal(s.attributions.reduce((x, a) => x + a.total, 0), s.box.afterExpenses, "nothing lost");
  const caroline = s.attributions.find((a) => a.id === "k");
  assert.ok(Math.abs(caroline.total - 15_068_493) <= 1, "$500,000 x 40% x 275/365 is $150,684.93 in IR879: here the same, in cents");
});

test("shares that do not cover every day of the year are said", () => {
  const period = { from: "2025-04-01", to: "2026-03-31" };
  const s = ir7Worksheet({
    income: [{ code: "A", name: "Sales", amount: 1_000_000 }],
    expenses: [],
    holders: [{ id: "a", name: "A", percent: 100, irdNumber: "1", from: "2025-10-01" }],
    kind: "ltc",
    period,
    inputs: emptyIr7Inputs(),
  });
  assert.ok(s.problems.some((p) => /not 100%/.test(p)));
});
