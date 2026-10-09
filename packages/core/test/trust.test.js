import assert from "node:assert/strict";
import test from "node:test";
import {
  ageOn,
  beneficiaryRule,
  emptyTrust,
  emptyTrustInputs,
  incomeAndExpenses,
  individualTax,
  ir6bRows,
  trustRows,
  trustStatements,
  trustWorksheet,
  trusteeRate,
  allocationJournal,
  defaultTrustIncomeClass,
  defaultExpensePlacement,
} from "../dist/index.js";

const chart = [
  { code: "200", name: "Rent received", type: "Revenue", taxCode: "", description: "" },
  { code: "270", name: "Interest received", type: "Other Income", taxCode: "", description: "" },
  { code: "275", name: "Dividends received", type: "Other Income", taxCode: "", description: "" },
  { code: "280", name: "Capital gains", type: "Other Income", taxCode: "", description: "" },
  { code: "469", name: "Rates", type: "Expense", taxCode: "", description: "" },
  { code: "412", name: "Accounting fees", type: "Expense", taxCode: "", description: "" },
  { code: "100", name: "Bank", type: "Bank", taxCode: "", description: "" },
  { code: "710", name: "Land and buildings", type: "Fixed Asset", taxCode: "", description: "" },
  { code: "800", name: "Loans from associated persons", type: "Current Liability", taxCode: "", description: "" },
  { code: "850", name: "Current account Ana", type: "Current Liability", taxCode: "", description: "" },
  { code: "960", name: "Settled funds", type: "Equity", taxCode: "", description: "" },
];

function line(code, amount) {
  return { accountCode: code, accountName: code, amount, taxType: "NONE", description: "" };
}
function journal(date, ...lines) {
  return { transactionId: date + lines[0].accountCode, date, narration: "", lines, source: "bank", taxBasis: "both" };
}

const journals = [
  journal("2026-04-01", line("100", 20_000_000), line("960", -20_000_000)), // settled
  journal("2026-05-01", line("100", 3_000_000), line("200", -3_000_000)), // rent
  journal("2026-06-01", line("100", 400_000), line("270", -400_000)), // interest
  journal("2026-07-01", line("100", 900_000), line("280", -900_000)), // capital gain
  journal("2026-08-01", line("469", 500_000), line("100", -500_000)), // rates
  journal("2026-09-01", line("412", 100_000), line("100", -100_000)), // accounting
  journal("2026-11-01", line("960", 300_000), line("850", -300_000)), // credited to Ana's account
  journal("2026-12-01", line("850", 150_000), line("100", -150_000)), // Ana withdrew some
];
const { income, expenses } = incomeAndExpenses({ journals, chart, from: "2026-04-01", to: "2027-03-31" });

const ana = { id: "ana", name: "Ana Kowhai", born: "1980-02-02", residence: "NZ", irdNumber: "11111111", accountCode: "850" };
const kiri = { id: "kiri", name: "Kiri Kowhai", born: "2015-06-01", residence: "NZ", accountCode: "852" };
const trust = { ...emptyTrust("complying"), beneficiaries: [ana, kiri], settlors: [{ id: "s1", name: "Hemi Kowhai" }] };
const BALANCE = "2027-03-31";

test("income tax on a person's whole income follows the year's table", () => {
  assert.equal(individualTax(6_000_000, 2027), 1_022_050, "$60,000 in 2027: 10.5% to 15,600, 17.5% to 53,500, then 30%");
  assert.equal(individualTax(1_000_000, 2027), 105_000);
  assert.equal(individualTax(0, 2027), 0);
  assert.equal(individualTax(20_000_000, 2027), 5_707_750, "$200,000 reaches the 39% band");
  assert.ok(individualTax(1_000_000, 2026) === 105_000, "10.5% up to $14,000 in 2026 too");
  assert.equal(individualTax(1_560_000, 2026), 147_000 + Math.round(160_000 * 0.1282), "the 2026 table has a 12.82% step to $15,600");
});

test("ages are counted in whole years on the balance date", () => {
  assert.equal(ageOn("2011-03-31", "2027-03-31"), 16);
  assert.equal(ageOn("2011-04-01", "2027-03-31"), 15);
});

test("a New Zealand child under 16 is a minor unless the allocation is $1,000 or less", () => {
  assert.equal(beneficiaryRule(kiri, 120_000, BALANCE), "minor", "$1,200 is taxed in full at 39%");
  assert.equal(beneficiaryRule(kiri, 100_000, BALANCE), null, "$1,000 exactly is beneficiary income");
  assert.equal(beneficiaryRule({ ...kiri, disabilityAllowance: true }, 500_000, BALANCE), null);
  assert.equal(beneficiaryRule({ ...kiri, residence: "AU" }, 500_000, BALANCE), null, "the rule is for New Zealand residents");
  assert.equal(beneficiaryRule({ ...kiri, born: "2011-03-31" }, 500_000, BALANCE), null, "16 on balance date is not a minor");
  assert.equal(beneficiaryRule(ana, 500_000, BALANCE), null);
  assert.equal(beneficiaryRule({ ...ana, corporateRule: true }, 1, BALANCE), "corporate");
});

test("trustee income is taxed at 39%, or less in the cases the guide lists", () => {
  assert.equal(trusteeRate(trust, 2027, 1_000_001).rate, 0.39);
  assert.equal(trusteeRate(trust, 2027, 1_000_000).rate, 0.33, "$10,000 or less");
  assert.equal(trusteeRate({ ...trust, disabledBeneficiaryTrust: true }, 2027, 9_000_000).rate, 0.33);
  assert.equal(trusteeRate({ ...trust, energyConsumerTrust: true }, 2027, 9_000_000).rate, 0.33);
  assert.equal(trusteeRate({ ...trust, legacySuperannuation: true }, 2027, 9_000_000).rate, 0.28);
  const estate = { ...trust, estateDeathYear: 2025 };
  assert.equal(trusteeRate(estate, 2025, 9_000_000).rate, 0.33, "the year of death");
  assert.equal(trusteeRate(estate, 2028, 9_000_000).rate, 0.33, "three years after");
  assert.equal(trusteeRate(estate, 2029, 9_000_000).rate, 0.39, "then the full rate");
});

test("the books' accounts are classed from their names, and every class can be changed", () => {
  assert.equal(defaultTrustIncomeClass({ name: "Capital gains" }), "notIncome");
  assert.equal(defaultTrustIncomeClass({ name: "Interest received" }), "interest");
  assert.equal(defaultTrustIncomeClass({ name: "Dividends received" }), "dividends");
  assert.equal(defaultTrustIncomeClass({ name: "Rent received" }), "business");
  assert.equal(defaultExpensePlacement({ name: "Accounting fees" }), "q21");
  assert.equal(defaultExpensePlacement({ name: "Rates" }), "business");
  assert.equal(defaultExpensePlacement({ name: "Depreciation" }), "none");
});

function sheet(inputs, t = trust, year = 2027) {
  return trustWorksheet({ income, expenses, trust: t, inputs: { ...emptyTrustInputs(), ...inputs }, year, balanceDate: BALANCE });
}

test("with nothing allocated, trustee income is taxed in the trust at 39% on what is left after expenses", () => {
  const s = sheet({});
  assert.equal(s.box.interest, 400_000);
  assert.equal(s.box.business, 3_000_000 - 500_000, "rent less the rates");
  assert.equal(s.box.totalIncome, 2_900_000, "the capital gain is not income");
  assert.equal(s.box.trusteeIncome, 2_900_000);
  assert.equal(s.box.expenses, 100_000);
  assert.equal(s.box.taxableTrusteeIncome, 2_800_000);
  assert.equal(s.rate, 0.39);
  assert.equal(s.box.trusteeTax, 1_092_000);
  assert.equal(s.box.residual, 1_092_000);
  assert.equal(s.box.toPay, 1_092_000);
});

test("income allocated to an adult is taxed at their rates; to a minor, in the trust at 39%", () => {
  const s = sheet({ allocations: { ana: 1_000_000, kiri: 500_000 } });
  assert.equal(s.box.beneficiaryIncome, 1_000_000);
  assert.equal(s.box.minorCorporate, 500_000);
  assert.equal(s.box.trusteeIncome, 1_400_000);
  const a = s.beneficiaries.find((b) => b.id === "ana");
  assert.equal(a.tax, 105_000, "$10,000 at 10.5%");
  assert.equal(a.payable, 105_000);
  assert.equal(s.box.beneficiaryTax, 105_000);
  const k = s.beneficiaries.find((b) => b.id === "kiri");
  assert.equal(k.rule, "minor");
  assert.equal(k.payable, 0, "tax on a minor's income is worked out on the IR6");
  assert.equal(s.box.taxableTrusteeIncome, 1_300_000);
  assert.equal(s.box.trusteeTax, 507_000);
  assert.equal(s.box.minorCorporateTax, 195_000);
  assert.equal(s.box.totalTrusteeTax, 702_000);
  assert.equal(s.box.residual, 105_000 + 702_000);
  assert.deepEqual([s.problems.length], [0]);
});

test("the beneficiary's tax is the extra tax their trust income causes, on top of their own", () => {
  const s = sheet({ allocations: { ana: 1_000_000 }, otherIncome: { ana: 5_000_000 } });
  const a = s.beneficiaries[0];
  assert.equal(a.tax, individualTax(6_000_000, 2027) - individualTax(5_000_000, 2027));
  const agreed = { ...trust, beneficiaries: [{ ...ana, trusteeDoesNotPay: true }, kiri] };
  const none = sheet({ allocations: { ana: 1_000_000 } }, agreed);
  assert.equal(none.beneficiaries[0].trusteePays, false);
  assert.equal(none.box.beneficiaryTax, 0);
  assert.equal(none.box.beneficiaryIncome, 1_000_000, "still beneficiary income");
});

test("a minor allocated $1,000 or less has beneficiary income taxed at their own rate", () => {
  const s = sheet({ allocations: { kiri: 100_000 } });
  assert.equal(s.beneficiaries[0].rule, null);
  assert.equal(s.box.minorCorporate, 0);
  assert.equal(s.box.beneficiaryIncome, 100_000);
});

test("kinds of income and credits go to beneficiaries in proportion to what they were allocated", () => {
  const s = sheet({ allocations: { ana: 1_450_000 }, rwtInterest: 100_000 });
  assert.equal(s.box.interest, 500_000, "the books show interest after RWT, so the RWT is added back");
  assert.equal(s.box.credits, 100_000);
  const a = s.beneficiaries[0];
  assert.equal(a.interest + a.dividends + a.overseas + a.other, a.allocation);
  assert.ok(a.interest > 0 && a.other > 0);
  assert.equal(a.credits + s.box.creditsTrustee, 100_000, "all of the credit is somebody's");
  const gross = sheet({ allocations: { ana: 1_450_000 }, rwtInterest: 100_000, grossBooks: true });
  assert.equal(gross.box.interest, 400_000);
});

test("losses brought forward come off trustee income, and a loss is carried forward", () => {
  const s = sheet({ lossBroughtForward: 1_000_000 });
  assert.equal(s.box.lossClaimed, 1_000_000);
  assert.equal(s.box.taxableTrusteeIncome, 1_800_000);
  assert.equal(s.lossCarriedForward, 0);
  const big = sheet({ lossBroughtForward: 5_000_000 });
  assert.equal(big.box.taxableTrusteeIncome, 0);
  assert.equal(big.lossCarriedForward, 5_000_000 - 2_800_000);
});

test("more allocated than earned is a problem; a trust with a loss allocates nothing", () => {
  const s = sheet({ allocations: { ana: 9_000_000 } });
  assert.ok(s.problems.some((p) => /More income is allocated/.test(p)));
  const lossIncome = [{ code: "270", name: "Interest received", amount: 100_000 }];
  const lossExpenses = [{ code: "469", name: "Rates", amount: 400_000 }];
  const l = trustWorksheet({ income: lossIncome, expenses: lossExpenses, trust, inputs: emptyTrustInputs(), year: 2027, balanceDate: BALANCE });
  assert.equal(l.box.totalIncome, -300_000);
  assert.equal(l.box.business, -400_000);
  assert.equal(l.box.trusteeIncome, 0);
  assert.equal(l.lossCarriedForward, 300_000);
  assert.equal(l.box.trusteeTax, 0);
});

test("residential deductions come off residential rent only, and the excess is carried forward", () => {
  const inc = [{ code: "R", name: "Residential rent", amount: 1_000_000 }];
  const exp = [{ code: "H", name: "Residential rates", amount: 1_500_000 }];
  const s = trustWorksheet({ income: inc, expenses: exp, trust, inputs: emptyTrustInputs(), year: 2027, balanceDate: BALANCE });
  assert.equal(s.box.residentialNet, 0);
  assert.equal(s.box.residentialCarried, 500_000);
  assert.equal(s.box.totalIncome, 0);
});

test("imputation credits that exceed the trustee's tax are not refunded", () => {
  const s = sheet({ imputation: 5_000_000, grossBooks: true });
  assert.equal(s.box.afterImputation, 0);
  assert.ok(s.box.residual <= 0);
  assert.ok(s.lossCarriedForward > 0, "the excess becomes a loss to carry forward");
});

test("a non-complying trust's taxable distribution is taxed at 45%", () => {
  const t = { ...trust, type: "non-complying" };
  const s = sheet({ taxableDistributions: { ana: 200_000 }, allocations: { ana: 1_000_000 } }, t);
  assert.equal(s.beneficiaries[0].nonComplyingTax, 90_000);
  assert.equal(s.beneficiaries[0].payable, 105_000 + 90_000);
});

test("a taxable distribution with no income allocated is still reported and taxed at 45%", () => {
  const t = { ...trust, type: "non-complying" };
  const s = sheet({ taxableDistributions: { ana: 200_000 } }, t);
  assert.equal(s.beneficiaries.length, 1);
  assert.equal(s.beneficiaries[0].payable, 90_000);
  assert.equal(s.box.beneficiaryTax, 90_000);
  assert.equal(s.box.taxableDistributions, 200_000);
});

test("provisional tax is due when the residual income tax is over $5,000, at last year's plus 5%", () => {
  const s = sheet({});
  assert.equal(s.provisionalNext, Math.round(1_092_000 * 1.05));
  const small = trustWorksheet({ income: [{ code: "270", name: "Interest received", amount: 100_000 }], expenses: [], trust, inputs: emptyTrustInputs(), year: 2027, balanceDate: BALANCE });
  assert.equal(small.provisionalNext, null);
});

test("each beneficiary's account runs from the opening balance by the year's movements", () => {
  const s = sheet(
    { allocations: { ana: 1_000_000 }, distributionsTaxable: { ana: 1_000_000 }, distributionsNotTaxable: { ana: 200_000 }, withdrawals: { ana: 300_000 }, openingBalances: { ana: 50_000 } },
  );
  const a = s.beneficiaries[0];
  assert.equal(a.closing, 50_000 + 1_000_000 + 200_000 - 300_000);
  const rows = ir6bRows(a);
  assert.deepEqual(rows.map((r) => r.box).slice(-5), ["26U", "26V", "26W", "26X", "26Y"]);
  assert.equal(s.box.totalDistributions, 1_200_000);
});

test("a minor taxed on the IR6 shows only the income and the account on the IR6B", () => {
  const s = sheet({ allocations: { kiri: 500_000 } });
  const rows = ir6bRows(s.beneficiaries[0]);
  assert.ok(rows.some((r) => r.box === "26I"));
  assert.ok(!rows.some((r) => r.box === "26L" || r.box === "26T"));
});

test("the rows follow the form's order", () => {
  const rows = trustRows(sheet({}));
  const boxes = rows.map((r) => r.box);
  assert.ok(boxes.indexOf("19B") < boxes.indexOf("20A"));
  assert.ok(boxes.indexOf("27D") < boxes.indexOf("28C"));
  assert.equal(boxes.at(-1), "28E");
});

test("the disclosure statements come from the books", () => {
  const s = sheet({ withdrawals: { ana: 150_000 } });
  const st = trustStatements({
    journals,
    chart,
    trust,
    inputs: { ...emptyTrustInputs(), placementsOfBalances: { "100": "other" } },
    from: "2026-04-01",
    to: "2027-03-31",
    sheet: s,
  });
  assert.equal(st.profit, 3_000_000 + 400_000 + 900_000 - 500_000 - 100_000, "everything, taxable or not");
  assert.equal(st.untaxedGains, 900_000);
  assert.equal(st.assets.other, 20_000_000 + 3_000_000 + 400_000 + 900_000 - 500_000 - 100_000 - 150_000);
  assert.equal(st.assets.total, st.assets.other);
  assert.equal(st.liabilities.beneficiaryAccounts, 150_000, "Ana's account, from the books");
  assert.equal(st.accumulated, st.assets.total - st.liabilities.total);
  assert.equal(st.withdrawn, 150_000);
  assert.equal(st.taxAdjustments, s.box.totalIncome - st.profit);
});

// A seeded generator, so a failure can be repeated.
function random(seed) {
  let x = seed;
  return () => {
    x = (x * 1664525 + 1013904223) % 4294967296;
    return x / 4294967296;
  };
}

test("individual tax rises with income and never takes more than the top rate of the increase", () => {
  for (const year of [2025, 2026, 2027]) {
    let last = 0;
    for (let dollars = 0; dollars <= 250_000; dollars += 137) {
      const tax = individualTax(dollars * 100, year);
      assert.ok(tax >= last, `tax fell at $${dollars} in ${year}`);
      assert.ok(tax - last <= 137 * 100 * 0.39 + 1, `tax rose too fast at $${dollars} in ${year}`);
      last = tax;
    }
  }
});

test("whatever the figures, income is shared out and the tax adds up", () => {
  const next = random(12345);
  const pick = (max) => Math.floor(next() * max);
  for (let run = 0; run < 300; run++) {
    const income = [
      { code: "A", name: "Interest received", amount: pick(2_000_000) },
      { code: "B", name: "Rent received", amount: pick(8_000_000) },
      { code: "C", name: "Dividends received", amount: pick(1_000_000) },
    ];
    const expenses = [
      { code: "X", name: "Accounting fees", amount: pick(300_000) },
      { code: "Y", name: "Rates", amount: pick(3_000_000) },
    ];
    const t = { ...trust, type: pick(4) === 0 ? "non-complying" : "complying" };
    const total = income.reduce((s, a) => s + a.amount, 0) - expenses[1].amount;
    const budget = Math.max(0, total);
    const a = pick(Math.floor(budget / 2) + 1);
    const k = pick(Math.floor((budget - a) / 2) + 1);
    const inputs = {
      ...emptyTrustInputs(),
      allocations: { ana: a, kiri: k },
      otherIncome: { ana: pick(9_000_000) },
      rwtInterest: pick(100_000),
      imputation: pick(200_000),
      lossBroughtForward: pick(2) === 0 ? 0 : pick(3_000_000),
      provisionalPaid: pick(500_000),
    };
    const s = trustWorksheet({ income, expenses, trust: t, inputs, year: 2026, balanceDate: "2026-03-31" });
    const b = s.box;
    assert.equal(b.beneficiaryIncome + b.minorCorporate + b.trusteeIncome, Math.max(0, b.totalIncome), "all income is somebody's");
    assert.ok(b.beneficiaryIncome >= 0 && b.trusteeIncome >= 0 && b.minorCorporate >= 0);
    assert.ok(b.beneficiaryTax >= 0 && b.trusteeTax >= 0 && b.minorCorporateTax >= 0);
    assert.equal(b.residual, b.beneficiaryTax + b.trusteeNet, "the residual is the two taxes together");
    assert.equal(b.toPay, b.residual - b.provisionalPaid);
    assert.ok(s.lossCarriedForward >= 0);
    for (const x of s.beneficiaries) {
      assert.equal(x.interest + x.dividends + x.overseas + x.other, x.allocation, "an allocation is all accounted for by kind");
      assert.ok(x.payable >= 0);
      assert.equal(x.closing, x.opening + x.distributionsTaxable + x.distributionsNotTaxable - x.withdrawals);
    }
    // Credits handed to beneficiaries plus the trustee's share are the whole.
    const toBeneficiaries = s.beneficiaries.filter((x) => x.rule === null).reduce((sum, x) => sum + x.credits, 0);
    assert.ok(Math.abs(toBeneficiaries + b.creditsTrustee - b.credits) <= 2, "RWT is not lost or made up");
  }
});

test("the allocation is posted as one balanced journal into each beneficiary's account", () => {
  const s = sheet({ allocations: { ana: 1_000_000, kiri: 500_000 } });
  const label = (code) => `Account - ${code}`;
  const made = allocationJournal({ entityId: "kowhai", year: 2026, date: "2026-03-31", debit: "Accumulated funds - 970", sheet: s, trust, label });
  assert.deepEqual(made.problems, []);
  assert.equal(made.journal.id, "trust-allocation-kowhai-2026");
  assert.equal(made.journal.lines.reduce((sum, l) => sum + l.amount, 0), 0, "balanced");
  assert.equal(made.journal.lines[0].amount, 1_500_000);
  assert.deepEqual(made.journal.lines.slice(1).map((l) => [l.code, l.amount]), [["Account - 850", -1_000_000], ["Account - 852", -500_000]]);
});

test("no journal when a beneficiary has no account, or nothing was allocated", () => {
  const s = sheet({ allocations: { kiri: 500_000 } });
  const bare = { ...trust, beneficiaries: [ana, { ...kiri, accountCode: undefined }] };
  const made = allocationJournal({ entityId: "k", year: 2026, date: "2026-03-31", debit: "X - 970", sheet: s, trust: bare, label: (c) => c });
  assert.equal(made.journal, null);
  assert.match(made.problems[0], /no account/);
  const none = allocationJournal({ entityId: "k", year: 2026, date: "2026-03-31", debit: "X - 970", sheet: sheet({}), trust, label: (c) => c });
  assert.equal(none.journal, null);
  assert.match(none.problems[0], /Nothing is allocated/);
});
