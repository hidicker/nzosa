import assert from "node:assert/strict";
import test from "node:test";
import {
  earnerLevyOn,
  ietcOn,
  incomeTaxOn,
  ir3Return,
  ownerRentalSchedule,
  rentalHeadingFor,
  rentalSchedule,
  residentialPortfolio,
} from "../dist/index.js";

// A profit and loss holds income as money in and expenses as money out.
const line = (code, net) => ({ code, net, gross: net, gst: 0, count: 1, transactionIds: [] });
const report = (income, expenses) => ({
  period: { from: "2025-04-01", to: "2026-03-31" },
  income: income.map(([code, amount]) => line(code, amount)),
  expenses: expenses.map(([code, amount]) => line(code, -amount)),
  unclassified: [],
  totalIncome: income.reduce((s, [, a]) => s + a, 0),
  totalExpenses: expenses.reduce((s, [, a]) => s + a, 0),
  netProfit: 0,
  uncoded: { count: 0, gross: 0 },
});
const names = {
  R: "Rent - Totara Place",
  RT: "Rates - Totara Place",
  IN: "Insurance - Totara Place",
  PM: "Property Management Fees",
  RM: "Repairs and Maintenance - Totara",
  TR: "Travel to inspect Totara Place",
  INT: "Interest - Residential",
  SR: "Rent - Shop - Kowhai Road",
  SI: "Insurance - Shop",
};
const nameOf = (code) => names[code] ?? code;

const TOTARA = {
  id: "totara", name: "Totara Place", kind: "residential", gstRegistered: false,
  owners: [{ name: "Ana", percent: 50 }, { name: "Tom", percent: 50 }],
};
const SHOP = {
  id: "shop", name: "Kowhai Road Shop", kind: "commercial", gstRegistered: true,
  owners: [{ name: "Ana", percent: 50 }, { name: "Tom", percent: 50 }],
};

test("expenses go under the headings the form asks for", () => {
  assert.equal(rentalHeadingFor("Rates - Residential - Totara"), "rates");
  assert.equal(rentalHeadingFor("Water - Totara Place"), "rates");
  assert.equal(rentalHeadingFor("Insurance Residential Kowhai"), "insurance");
  assert.equal(rentalHeadingFor("Interest - Residential"), "interest");
  assert.equal(rentalHeadingFor("Property Management Fees - Residential"), "agent");
  assert.equal(rentalHeadingFor("Repairs and Maintenance - Kowhai Rd"), "repairs");
  assert.equal(rentalHeadingFor("Travel - Residential - Kowhai Road"), "other");
});

test("an owner's share is taken line by line, under each heading", () => {
  const schedule = rentalSchedule(
    TOTARA,
    report([["R", 3_210_001]], [["RT", 310_001], ["IN", 180_000], ["PM", 250_000], ["TR", 12_000]]),
    nameOf,
  );
  assert.equal(schedule.totalIncome, 3_210_001);
  assert.equal(schedule.totalExpenses, 752_001);
  assert.equal(schedule.net, 2_458_000);

  const ana = ownerRentalSchedule(schedule, "Ana");
  assert.equal(ana.rents, 1_605_001, "half of each line, rounded to the cent");
  assert.equal(ana.headings.find((h) => h.heading === "rates").amount, 155_001);
  assert.equal(ana.headings.find((h) => h.heading === "agent").amount, 125_000);
  assert.deepEqual(ana.other.map((o) => [o.name, o.amount]), [["Travel to inspect Totara Place", 6_000]]);
  assert.equal(ana.totalExpenses, 376_001);
  assert.equal(ana.netRents, 1_229_000);
  assert.equal(ownerRentalSchedule(schedule, "Someone else"), null);
});

test("a residential loss is ring-fenced and carried forward, not set against other income", () => {
  const schedule = rentalSchedule(TOTARA, report([["R", 1_000_000]], [["INT", 1_400_000]]), nameOf);
  const share = ownerRentalSchedule(schedule, "Tom");
  const portfolio = residentialPortfolio([share], 100_000);
  assert.equal(portfolio.totalIncome, 500_000);
  assert.equal(portfolio.deductions, 700_000);
  assert.equal(portfolio.claimed, 500_000, "only as much as the residential income");
  assert.equal(portfolio.netIncome, 0);
  assert.equal(portfolio.carriedForward, 300_000, "this year's excess and last year's unused");
});

test("tax is worked on whole dollars of taxable income", () => {
  assert.equal(incomeTaxOn(8_000_099, 2026), 1_627_750);
  assert.equal(incomeTaxOn(1_000_000, 2026), 105_000);
  assert.equal(incomeTaxOn(1_000_000, 2019), null, "no rates held for that year");
});

test("the independent earner tax credit abates above its threshold and stops", () => {
  assert.equal(ietcOn(5_000_000, 2026), 52_000);
  assert.equal(ietcOn(6_800_000, 2026), 26_000);
  assert.equal(ietcOn(7_000_001, 2026), 0);
  assert.equal(ietcOn(2_000_000, 2026), 0);
});

test("the earner levy inside PAYE is not a credit", () => {
  assert.equal(earnerLevyOn(3_000_000, 2026), 50_100);
});

test("an individual's return combines rental shares with income from outside the books", () => {
  const home = rentalSchedule(TOTARA, report([["R", 4_000_000]], [["RT", 400_000], ["RM", 800_000]]), nameOf);
  const shop = rentalSchedule(SHOP, report([["SR", 3_000_000]], [["SI", 400_000]]), nameOf);
  const extras = [
    { owner: "Ana", year: 2026, category: "salary", payer: "Employer Ltd", gross: 3_000_000, credits: 400_000 },
    { owner: "Ana", year: 2026, category: "interest", payer: "A Bank", gross: 10_000, credits: 3_300 },
    { owner: "Ana", year: 2026, category: "pie", payer: "A Fund", gross: 50_000, credits: 14_000 },
    { owner: "Tom", year: 2026, category: "interest", payer: "A Bank", gross: 99_999, credits: 1 },
  ];
  const result = ir3Return({
    owner: "Ana",
    year: 2026,
    extras,
    rentals: [ownerRentalSchedule(home, "Ana"), ownerRentalSchedule(shop, "Ana")],
    provisionalTaxPaid: 600_000,
  });
  const box = (id) => result.boxes.find((b) => b.box === id)?.amount;

  assert.equal(box("11E"), 349_900, "PAYE less the earner levy");
  assert.equal(box("22A"), 2_000_000);
  assert.equal(box("22E"), 600_000);
  assert.equal(box("22H"), 1_400_000);
  assert.equal(box("23"), 1_300_000, "a commercial rental is net rents");
  assert.equal(box("32"), 5_710_000, "PIE income is not taxable income again");
  assert.equal(box("35B"), 50_000);
  assert.equal(box("36"), 935_050);
  assert.equal(box("33"), 52_000);
  assert.equal(box("21A"), 353_200);
  assert.equal(result.residualIncomeTax, 529_850);
  assert.equal(box("36B"), -70_150, "a refund");
  assert.equal(result.nextYearProvisional, 556_300);
  assert.deepEqual(result.instalments, [185_400, 185_400, 185_500]);
  assert.ok(result.notes.some((n) => /independent earner/.test(n)), "the assumption is said");
});
