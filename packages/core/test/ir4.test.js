import assert from "node:assert/strict";
import test from "node:test";
import { defaultIr4ExpensePlacement, defaultIr4IncomeClass, dividendImputation, emptyIr4Inputs, icaRows, ir4Rows, ir4Worksheet } from "../dist/index.js";

const income = [
  { code: "200", name: "Sales", amount: 20_000_000 },
  { code: "270", name: "Interest received", amount: 70_000 },
  { code: "290", name: "Share capital", amount: 5_000_000 },
];
const expenses = [
  { code: "400", name: "Materials", amount: 12_000_000 },
  { code: "490", name: "Penalties", amount: 40_000 },
];
const sheet = (over = {}, inc = income, exp = expenses) => ir4Worksheet({ income: inc, expenses: exp, inputs: { ...emptyIr4Inputs(), ...over } });

test("accounts are classed from their names, and every class can be changed", () => {
  assert.equal(defaultIr4IncomeClass({ name: "Share capital" }), "notIncome");
  assert.equal(defaultIr4IncomeClass({ name: "Interest received" }), "interest");
  assert.equal(defaultIr4IncomeClass({ name: "Sales" }), "business");
  assert.equal(defaultIr4ExpensePlacement({ name: "Penalties" }), "none");
  assert.equal(defaultIr4ExpensePlacement({ name: "Residential rates" }), "residential");
});

test("income by source: the business profit, interest grossed up for RWT, share capital left out", () => {
  const s = sheet({ rwtInterest: 30_000 });
  assert.equal(s.box.business, 8_000_000, "sales less materials; the penalty is not deductible");
  assert.equal(s.box.interest, 100_000);
  assert.equal(s.box.totalBeforeDonations, 8_100_000);
  assert.equal(s.incomeBy.notIncome, 5_000_000);
  assert.equal(s.box.credits, 30_000);
});

test("tax is 28% of income after donations and losses, less credits and provisional tax paid", () => {
  const s = sheet({ rwtInterest: 30_000, donations: 100_000, lossBroughtForward: 1_000_000, provisionalPaid: 1_000_000 });
  assert.equal(s.box.donations, 100_000);
  assert.equal(s.box.totalIncome, 8_000_000);
  assert.equal(s.box.lossClaimed, 1_000_000);
  assert.equal(s.box.taxableIncome, 7_000_000);
  assert.equal(s.box.tax, 1_960_000);
  assert.equal(s.box.residual, 1_960_000 - 30_000);
  assert.equal(s.box.toPay, 1_930_000 - 1_000_000);
  assert.equal(s.lossCarriedForward, 0);
});

test("donations are limited to the income", () => {
  const s = sheet({ donations: 99_000_000 });
  assert.equal(s.box.donations, s.box.totalBeforeDonations);
  assert.equal(s.box.totalIncome, 0);
  assert.equal(s.box.tax, 0);
});

test("a loss is claimed only up to the income, and the rest carries on; broken continuity loses it", () => {
  const some = sheet({ lossBroughtForward: 20_000_000 });
  assert.equal(some.box.lossClaimed, 8_070_000);
  assert.equal(some.box.taxableIncome, 0);
  assert.equal(some.lossCarriedForward, 20_000_000 - 8_070_000);
  const broken = sheet({ lossBroughtForward: 1_000_000, continuityBroken: true });
  assert.equal(broken.box.lossClaimed, 0);
  assert.equal(broken.lossCarriedForward, 0);
  assert.ok(broken.notes.some((x) => /continuity has broken/.test(x)));
});

test("a loss year carries the loss forward", () => {
  const s = sheet({}, [{ code: "200", name: "Sales", amount: 1_000_000 }], [{ code: "400", name: "Materials", amount: 3_000_000 }]);
  assert.equal(s.box.taxableIncome, -2_000_000);
  assert.equal(s.box.tax, 0);
  assert.equal(s.lossCarriedForward, 2_000_000);
});

test("imputation credits are set against the tax, and the excess becomes a loss, not a refund", () => {
  const s = sheet({}, [{ code: "300", name: "Dividends received", amount: 720_000 }], []);
  const t = sheet({ imputationReceived: 280_000 }, [{ code: "300", name: "Dividends received", amount: 720_000 }], []);
  assert.equal(s.box.dividends, 720_000);
  assert.equal(t.box.dividends, 1_000_000, "credits are added back to give the gross dividend");
  assert.equal(t.box.tax, 280_000);
  assert.equal(t.box.afterImputation, 0, "28% of $10,000 is $2,800, covered exactly");
  const more = sheet({ imputationReceived: 400_000, grossBooks: true }, [{ code: "300", name: "Dividends received", amount: 1_000_000 }], []);
  assert.equal(more.box.afterImputation, 0);
  assert.equal(more.lossCarriedForward, Math.round((400_000 - 280_000) / 0.28));
  assert.ok(more.notes.some((x) => /cannot be refunded/.test(x)));
});

test("overseas tax is a credit up to the tax", () => {
  const s = sheet({ overseasTax: 99_000_000 }, [{ code: "300", name: "Sales", amount: 1_000_000 }], []);
  assert.equal(s.box.overseasCredit, s.box.tax);
  assert.equal(s.box.afterOverseas, 0);
});

test("residential deductions come off residential income only", () => {
  const s = sheet({}, [{ code: "R", name: "Residential rent", amount: 1_000_000 }], [{ code: "H", name: "Residential rates", amount: 1_500_000 }]);
  assert.equal(s.box.residentialNet, 0);
  assert.equal(s.box.residentialCarried, 500_000);
  assert.equal(s.box.totalIncome, 0);
});

test("the imputation credit account runs from the opening balance by the year's credits and debits", () => {
  const s = sheet({
    icaOpening: 100_000,
    icaIncomeTaxPaid: 1_000_000,
    rwtInterest: 30_000,
    imputationReceived: 20_000,
    rwtDividends: 5_000,
    icaOtherCredits: 1_000,
    icaRefunds: 50_000,
    icaDividendCredits: 400_000,
    icaOtherDebits: 10_000,
  });
  const i = s.ica;
  assert.equal(i.totalCredits, 1_000_000 + 30_000 + 20_000 + 6_000);
  assert.equal(i.totalDebits, 460_000);
  assert.equal(i.closing, 100_000 + 1_056_000 - 460_000);
  assert.equal(i.furtherTax, 0);
  assert.equal(i.penalty, 0);
  assert.deepEqual(icaRows(s).map((r) => r.box), ["41", "42A", "42B", "42C", "42D", "42E", "43A", "43B", "43C", "43D", "44", "44A", "44B", "45"]);
});

test("a debit balance is further income tax, with a penalty of 10%", () => {
  const s = sheet({ icaOpening: 0, icaDividendCredits: 200_000, icaIncomeTaxPaid: 50_000 });
  assert.equal(s.ica.closing, -150_000);
  assert.equal(s.ica.furtherTax, 150_000);
  assert.equal(s.ica.penalty, 15_000);
  assert.ok(s.problems.some((p) => /20 June/.test(p)));
  const eased = sheet({ icaDividendCredits: 200_000, icaIncomeTaxPaid: 50_000, icaAdjustment: 100_000 });
  assert.equal(eased.ica.furtherTax, 50_000);
});

test("the credit to attach to a dividend is at most 28/72, and no more than the account holds", () => {
  const full = dividendImputation(720_000, 1_000_000);
  assert.equal(full.maximum, 280_000);
  assert.equal(full.credit, 280_000);
  assert.equal(full.gross, 1_000_000);
  assert.equal(full.limitedByAccount, false);
  assert.ok(Math.abs(full.ratio - 28 / 72) < 1e-9);
  const short = dividendImputation(720_000, 100_000);
  assert.equal(short.credit, 100_000);
  assert.equal(short.limitedByAccount, true);
  assert.equal(short.gross, 820_000);
  assert.equal(dividendImputation(720_000, -5_000).credit, 0, "an account in debit allows none");
  assert.equal(dividendImputation(0, 100).ratio, 0);
});

test("the rows follow the form's order", () => {
  const boxes = ir4Rows(sheet()).map((r) => r.box);
  assert.ok(boxes.indexOf("20B") < boxes.indexOf("23") && boxes.indexOf("23") < boxes.indexOf("29") && boxes.indexOf("29") < boxes.indexOf("30L"));
});

function random(seed) {
  let x = seed;
  return () => {
    x = (x * 1664525 + 1013904223) % 4294967296;
    return x / 4294967296;
  };
}

test("whatever the figures, the tax adds up and nothing is negative that should not be", () => {
  const next = random(2468);
  for (let run = 0; run < 300; run++) {
    const inc = [
      { code: "A", name: "Sales", amount: Math.floor(next() * 9_000_000) },
      { code: "B", name: "Interest received", amount: Math.floor(next() * 400_000) },
      { code: "C", name: "Dividends received", amount: Math.floor(next() * 900_000) },
    ];
    const exp = [{ code: "X", name: "Materials", amount: Math.floor(next() * 7_000_000) }];
    const s = ir4Worksheet({
      income: inc,
      expenses: exp,
      inputs: { ...emptyIr4Inputs(), rwtInterest: Math.floor(next() * 90_000), imputationReceived: Math.floor(next() * 300_000), overseasTax: Math.floor(next() * 50_000), donations: Math.floor(next() * 200_000), lossBroughtForward: Math.floor(next() * 4_000_000), provisionalPaid: Math.floor(next() * 500_000), continuityBroken: next() < 0.2 },
    });
    const b = s.box;
    assert.ok(b.tax >= 0 && b.afterOverseas >= 0 && b.afterForeign >= 0 && b.afterImputation >= 0);
    assert.equal(b.totalIncome, b.totalBeforeDonations - b.donations);
    assert.equal(b.taxableIncome, b.totalIncome - b.lossClaimed);
    assert.equal(b.residual, b.afterImputation - b.otherCredits - b.rlwtCredit);
    assert.equal(b.toPay, b.residual - b.provisionalPaid);
    assert.ok(s.lossCarriedForward >= 0);
    assert.ok(b.lossClaimed <= b.lossBroughtForward);
  }
});
