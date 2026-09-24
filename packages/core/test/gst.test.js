import test from "node:test";
import assert from "node:assert/strict";
import {
  gstContent,
  gstDueDate,
  gstPeriods,
  gstReturn,
  gstResolver,
} from "../dist/index.js";

function txn(date, amount, fields = {}) {
  return {
    id: `${date}:${amount}`,
    date,
    amount,
    currency: "NZD",
    serial: "",
    trn: "",
    particulars: "",
    code: "",
    reference: "",
    otherParty: "",
    origin: "",
    type: "",
    batch: "",
    otherPartyAccount: "",
    account: "acct",
    extras: {},
    source: { importer: "test", file: "t.csv", line: 1 },
    ...fields,
  };
}

const PERIOD = { from: "2025-04-01", to: "2025-05-31", label: "2025-05", due: "2025-06-28" };

// ---------------------------------------------------------------- GST content

test("extracts GST as 3/23 of a GST-inclusive amount", () => {
  assert.equal(gstContent(11500), 1500, "15% GST on 100.00 is 15.00");
  assert.equal(gstContent(2300), 300);
  assert.equal(gstContent(0), 0);
});

test("rounds a credit note as the mirror image of the invoice", () => {
  // Rounding half away from zero, so reversing a transaction reverses its GST
  // exactly rather than leaving a cent behind.
  assert.equal(gstContent(-11500), -1500);
  for (const amount of [1, 7, 99, 12345, 999999]) {
    assert.equal(gstContent(-amount), -gstContent(amount), `symmetric at ${amount}`);
  }
});

// ------------------------------------------------------------------- the boxes

test("builds a return following the GST101A arithmetic", () => {
  const resolve = () => ({ treatment: "standard", side: "sales" });
  const result = gstReturn([txn("2025-04-10", 115000)], PERIOD, {
    resolve,
    basis: "payments",
  });

  const b = result.boxes;
  assert.equal(b.box5, 115000);
  assert.equal(b.box6, 0);
  assert.equal(b.box7, 115000);
  assert.equal(b.box8, 15000, "Box 7 x 3 / 23");
  assert.equal(b.box10, 15000);
  assert.equal(b.box15, 15000);
  assert.equal(b.outcome, "pay");
});

test("purchases land in Box 11 as a positive cost", () => {
  const resolve = () => ({ treatment: "standard", side: "purchases" });
  const result = gstReturn([txn("2025-04-10", -23000)], PERIOD, {
    resolve,
    basis: "payments",
  });

  assert.equal(result.boxes.box11, 23000, "ledger negative becomes a positive cost");
  assert.equal(result.boxes.box12, 3000);
  assert.equal(result.boxes.box14, 3000);
  assert.equal(result.boxes.box15, 3000);
  assert.equal(result.boxes.outcome, "refund", "Box 14 larger than Box 10 is a refund");
});

test("zero-rated supplies appear in Box 5 and are removed by Box 6", () => {
  const resolve = (t) => ({
    treatment: t.amount === 50000 ? "zero-rated" : "standard",
    side: "sales",
  });
  const result = gstReturn([txn("2025-04-10", 115000), txn("2025-04-11", 50000)], PERIOD, {
    resolve,
    basis: "payments",
  });

  assert.equal(result.boxes.box5, 165000, "zero-rated is included in Box 5");
  assert.equal(result.boxes.box6, 50000);
  assert.equal(result.boxes.box7, 115000);
  assert.equal(result.boxes.box8, 15000, "no GST on the zero-rated supply");
});

test("exempt and out-of-scope never reach the return", () => {
  const resolve = (t) => ({
    treatment: t.otherParty === "IRD" ? "out-of-scope" : "exempt",
    side: "none",
  });
  const result = gstReturn(
    [txn("2025-04-10", 115000, { otherParty: "IRD" }), txn("2025-04-11", -5000)],
    PERIOD,
    { resolve, basis: "payments" },
  );

  assert.equal(result.boxes.box5, 0);
  assert.equal(result.boxes.box11, 0);
  assert.equal(result.lines.length, 0);
  assert.equal(result.excluded.length, 2, "excluded rows are still reported, not dropped");
});

test("the two rounding methods differ by a cent, and both are available", () => {
  // 3/23 of $10.00 is 130.43 cents, which rounds down to 130 on each line.
  // Three of those is 390; the form calculates on the $30.00 total instead,
  // giving 391.30 -> 391. Neither is wrong. The default is per-line because it
  // is what the systems people migrate from actually file, so a return can be
  // reconciled against the ones already lodged.
  const resolve = () => ({ treatment: "standard", side: "sales" });
  const amounts = [1000, 1000, 1000];
  const lines = amounts.map((a, i) => txn(`2025-04-1${i}`, a));

  const perTransaction = amounts.reduce((n, a) => n + gstContent(a), 0);
  assert.equal(perTransaction, 390, "summing each line loses a cent");

  const byDefault = gstReturn(lines, PERIOD, { resolve, basis: "payments" });
  assert.equal(byDefault.boxes.box8, 390, "the default sums the lines");

  const byForm = gstReturn(lines, PERIOD, { resolve, basis: "payments", rounding: "form" });
  assert.equal(byForm.boxes.box8, 391, "the form calculates on the box total");
  assert.equal(byForm.boxes.box8, gstContent(3000));
});

test("only transactions inside the period count", () => {
  const resolve = () => ({ treatment: "standard", side: "sales" });
  const result = gstReturn(
    [txn("2025-03-31", 100000), txn("2025-04-01", 200000), txn("2025-06-01", 400000)],
    PERIOD,
    { resolve, basis: "payments" },
  );

  assert.equal(result.boxes.box5, 200000, "boundaries are inclusive at both ends");
});

test("a percentage share splits every amount", () => {
  // Rimu Lane is held 50/50 and each owner files their own half.
  const resolve = () => ({ treatment: "standard", side: "sales" });
  const result = gstReturn([txn("2025-04-10", 115001)], PERIOD, {
    resolve,
    basis: "payments",
    sharePercent: 50,
  });

  // Checked on the line, where the share is applied: Box 5 is worked back
  // from the GST in the default mode and is not a sum of lines.
  assert.equal(result.lines[0].amount, 57501, "rounded half away from zero");
  assert.equal(result.boxes.box7, result.boxes.box5 - result.boxes.box6);
  assert.equal(result.sharePercent, 50);
});

test("a nil return is reported as nil, not as a payment", () => {
  const resolve = () => ({ treatment: "standard", side: "sales" });
  const result = gstReturn([], PERIOD, { resolve, basis: "payments" });
  assert.equal(result.boxes.box15, 0);
  assert.equal(result.boxes.outcome, "nil");
});

test("adjustments feed Boxes 9 and 13", () => {
  const resolve = () => ({ treatment: "standard", side: "sales" });
  const result = gstReturn([txn("2025-04-10", 115000)], PERIOD, {
    resolve,
    basis: "payments",
    adjustments: 500,
    creditAdjustments: 200,
  });

  assert.equal(result.boxes.box9, 500);
  assert.equal(result.boxes.box10, 15500);
  assert.equal(result.boxes.box13, 200);
  assert.equal(result.boxes.box14, 200);
  assert.equal(result.boxes.box15, 15300);
});

// ----------------------------------------------------------------- the periods

test("generates two-monthly periods on the Jan/Mar/May cycle", () => {
  const periods = gstPeriods(
    { from: "2025-04-01", to: "2026-03-31" },
    { months: 2, anchorMonth: 3 },
  );

  assert.deepEqual(
    periods.map((p) => `${p.from}..${p.to}`),
    [
      "2025-04-01..2025-05-31",
      "2025-06-01..2025-07-31",
      "2025-08-01..2025-09-30",
      "2025-10-01..2025-11-30",
      "2025-12-01..2026-01-31",
      "2026-02-01..2026-03-31",
    ],
  );
});

test("the other two-monthly cycle ends in even months", () => {
  const periods = gstPeriods(
    { from: "2025-04-01", to: "2025-08-31" },
    { months: 2, anchorMonth: 2 },
  );
  assert.deepEqual(
    periods.map((p) => p.to),
    ["2025-04-30", "2025-06-30", "2025-08-31"],
  );
});

test("handles monthly and six-monthly filers", () => {
  const monthly = gstPeriods({ from: "2025-04-01", to: "2025-06-30" }, { months: 1, anchorMonth: 1 });
  assert.deepEqual(monthly.map((p) => p.to), ["2025-04-30", "2025-05-31", "2025-06-30"]);

  const sixMonthly = gstPeriods({ from: "2025-04-01", to: "2026-03-31" }, { months: 6, anchorMonth: 3 });
  assert.deepEqual(
    sixMonthly.map((p) => `${p.from}..${p.to}`),
    ["2025-04-01..2025-09-30", "2025-10-01..2026-03-31"],
  );
});

test("includes a period that starts before the range but ends inside it", () => {
  const periods = gstPeriods({ from: "2025-05-15", to: "2025-05-20" }, { months: 2, anchorMonth: 3 });
  assert.equal(periods.length, 1);
  assert.equal(periods[0].from, "2025-04-01");
});

test("period ends fall on the true last day of the month", () => {
  const periods = gstPeriods({ from: "2024-01-01", to: "2024-03-31" }, { months: 1, anchorMonth: 1 });
  assert.deepEqual(periods.map((p) => p.to), ["2024-01-31", "2024-02-29", "2024-03-31"]);
});

// --------------------------------------------------------------- the due dates

test("returns are due the 28th of the following month", () => {
  assert.equal(gstDueDate("2025-05-31"), "2025-06-28");
  assert.equal(gstDueDate("2025-07-31"), "2025-08-28");
  assert.equal(gstDueDate("2025-09-30"), "2025-10-28");
  assert.equal(gstDueDate("2026-01-31"), "2026-02-28");
});

test("the two statutory exceptions are applied", () => {
  assert.equal(gstDueDate("2025-11-30"), "2026-01-15", "November is due 15 January");
  assert.equal(gstDueDate("2026-03-31"), "2026-05-07", "March is due 7 May");
});

// -------------------------------------------------------------- default rules

test("a transfer within one entity is excluded, on both account numbers", () => {
  const entity = ["02-1100-0022001-001", "02-1100-0022002-002"];
  const resolve = gstResolver({ ownAccounts: entity });
  const classification = resolve(
    txn("2025-04-10", -100000, {
      account: "02-1100-0022001-001",
      otherPartyAccount: "02-1100-0022002-002",
      otherParty: "Payment",
    }),
  );

  assert.equal(classification.treatment, "out-of-scope");
  assert.equal(classification.side, "none");
  assert.match(classification.reason, /own accounts/);
});

test("money arriving from outside the entity is income, not an internal transfer", () => {
  // The failure this guards against silently deletes real income: a customer
  // pays into a personal account, the money is swept into the company, and
  // treating that sweep as internal makes the receipt vanish from Box 5.
  const resolve = gstResolver({ ownAccounts: ["02-1100-0022001-001"] });
  const classification = resolve(
    txn("2025-04-10", 300000, {
      account: "02-1100-0022001-001",
      otherPartyAccount: "02-1100-0022002-002",
      otherParty: "Payment",
      reference: "INTERNET XFR",
    }),
  );

  assert.equal(classification.treatment, "standard");
  assert.equal(classification.side, "sales");
});

test("a payment to an account you do not own is not treated as a transfer", () => {
  const resolve = gstResolver({ ownAccounts: ["02-1100-0022001-001"] });
  const classification = resolve(
    txn("2025-04-10", -100000, {
      account: "02-1100-0022001-001",
      otherPartyAccount: "12-3100-0044004-000",
      otherParty: "Blulink",
    }),
  );
  assert.equal(classification.treatment, "standard");
});

test("a company paying its own card is internal, despite the masked PAN", () => {
  // Card counterparties are masked -- `xxxx-xxxx-xxxx-4001` -- not account
  // numbers, so matching has to fall back to the last four digits.
  const resolve = gstResolver({
    ownAccounts: ["02-1100-0022001-001", "kea-coffee-roaster-4001"],
  });
  const classification = resolve(
    txn("2025-04-10", -197082, {
      account: "02-1100-0022001-001",
      otherPartyAccount: "xxxx-xxxx-xxxx-4001",
      reference: "INTERNET XFR",
    }),
  );

  assert.equal(classification.treatment, "out-of-scope");

  // A different card is somebody else's.
  const other = resolve(
    txn("2025-04-10", -197082, {
      account: "02-1100-0022001-001",
      otherPartyAccount: "xxxx-xxxx-xxxx-1234",
      reference: "INTERNET XFR",
    }),
  );
  assert.equal(other.treatment, "standard");
});

test("IRD, wages and loan repayments are excluded by keyword", () => {
  const resolve = gstResolver();
  assert.equal(resolve(txn("2025-04-10", -50000, { otherParty: "I.R.D. 123-456-789" })).treatment, "out-of-scope");
  assert.equal(resolve(txn("2025-04-10", -50000, { particulars: "IRD Salary Deductions" })).treatment, "out-of-scope");
  assert.equal(resolve(txn("2025-04-10", -50000, { particulars: "LOAN PAYMT" })).treatment, "exempt");
  assert.equal(resolve(txn("2025-04-10", -50000, { otherParty: "Loan Interest" })).treatment, "exempt");
});

test("unmatched transactions fall through to standard-rated, and say so", () => {
  const resolve = gstResolver();
  const sale = resolve(txn("2025-04-10", 50000, { otherParty: "A Customer" }));
  assert.deepEqual(
    { treatment: sale.treatment, side: sale.side },
    { treatment: "standard", side: "sales" },
  );
  assert.match(sale.reason, /No rule matched/);

  const purchase = resolve(txn("2025-04-10", -50000, { otherParty: "A Supplier" }));
  assert.equal(purchase.side, "purchases");
});

test("a caller's rule beats a default at the same priority", () => {
  const resolve = gstResolver({
    rules: [
      { keyword: "WISE", treatment: "zero-rated", side: "purchases", note: "overseas", priority: 100 },
    ],
  });
  const classification = resolve(txn("2025-04-10", -50000, { otherParty: "Wise" }));
  assert.equal(classification.treatment, "zero-rated");
  assert.equal(classification.reason, "overseas");
});

// ------------------------------------------------------------------- the basis

test("payments basis places a transaction by the date money moved", () => {
  const resolve = () => ({ treatment: "standard", side: "sales" });
  const paid = txn("2025-04-10", 115000, { extras: { taxPointDate: "2025-03-01" } });

  const result = gstReturn([paid], PERIOD, { resolve, basis: "payments" });
  assert.equal(result.boxes.box5, 115000, "the tax point is ignored on a payments basis");
  assert.equal(result.missingTaxPoint.length, 0);
});

test("invoice basis places a transaction by its tax point", () => {
  const resolve = () => ({ treatment: "standard", side: "sales" });
  // Invoiced in March, paid in April. On an invoice basis it belongs to March,
  // so it must fall outside an April-May period.
  const paid = txn("2025-04-10", 115000, { extras: { taxPointDate: "2025-03-01" } });

  const result = gstReturn([paid], PERIOD, { resolve, basis: "invoice" });
  assert.equal(result.boxes.box5, 0, "moved out of the period by its tax point");

  const march = { from: "2025-02-01", to: "2025-03-31", label: "2025-03", due: "2025-05-07" };
  assert.equal(gstReturn([paid], march, { resolve, basis: "invoice" }).boxes.box5, 115000);
});

test("hybrid basis dates sales by invoice and purchases by payment", () => {
  const resolve = (t) => ({ treatment: "standard", side: t.amount > 0 ? "sales" : "purchases" });
  // Both invoiced in March, both paid in April.
  const sale = txn("2025-04-10", 115000, { extras: { taxPointDate: "2025-03-01" } });
  const bill = txn("2025-04-12", -23000, { extras: { taxPointDate: "2025-03-05" } });
  const march = { from: "2025-02-01", to: "2025-03-31", label: "2025-03", due: "2025-05-07" };

  const inMarch = gstReturn([sale, bill], march, { resolve, basis: "hybrid" });
  assert.equal(inMarch.boxes.box5, 115000, "the sale counts when invoiced");
  assert.equal(inMarch.boxes.box11, 0, "the purchase does not count until paid");

  const inApril = gstReturn([sale, bill], PERIOD, { resolve, basis: "hybrid" });
  assert.equal(inApril.boxes.box5, 0);
  assert.equal(inApril.boxes.box11, 23000, "the purchase counts when paid");
  assert.equal(inApril.missingTaxPoint.length, 0, "a purchase needs no tax point on hybrid");
});

test("invoice basis reports transactions with no tax point instead of guessing", () => {
  // Silently falling back to the payment date would produce a payments-basis
  // return wearing an invoice-basis label, which is the worst outcome.
  const resolve = () => ({ treatment: "standard", side: "sales" });
  const result = gstReturn([txn("2025-04-10", 115000)], PERIOD, {
    resolve,
    basis: "invoice",
  });

  assert.equal(result.missingTaxPoint.length, 1);
  assert.equal(result.boxes.box5, 115000, "still counted, by its payment date");
});

test("the tax point field can be renamed", () => {
  const resolve = () => ({ treatment: "standard", side: "sales" });
  const paid = txn("2025-04-10", 115000, { extras: { invoiceDate: "2025-03-01" } });
  const result = gstReturn([paid], PERIOD, {
    resolve,
    basis: "invoice",
    taxPointField: "invoiceDate",
  });
  assert.equal(result.boxes.box5, 0);
  assert.equal(result.missingTaxPoint.length, 0);
});

// ------------------------------------------------------------------- imports

test("GST paid at the border goes to Box 13 whole, not through Box 11", () => {
  // The amount is the GST itself. Routing it through Box 11 would claim 3/23
  // of the GST -- about 13% of what is actually recoverable.
  const resolve = () => ({ treatment: "standard", side: "imports" });
  const result = gstReturn([txn("2025-04-10", -92370)], PERIOD, {
    resolve,
    basis: "payments",
  });

  assert.equal(result.boxes.box11, 0, "Box 11 excludes imported goods");
  assert.equal(result.boxes.box12, 0);
  assert.equal(result.boxes.box13, 92370, "claimed in full");
  assert.equal(result.boxes.box14, 92370);
  assert.equal(result.boxes.outcome, "refund");
});

test("border GST is recognised by the default rules", () => {
  const resolve = gstResolver();
  const importation = resolve(txn("2025-04-10", -92370, { otherParty: "DHL - GST ON IMPORTATION" }));
  assert.equal(importation.side, "imports");

  const entryFee = resolve(txn("2025-04-10", -1393, { otherParty: "DHL - ENTRY FEE GST" }));
  assert.equal(entryFee.side, "imports");

  // An ordinary courier charge is still a normal Box 11 purchase.
  const freight = resolve(txn("2025-04-10", -9330, { otherParty: "FEDEX EXPRESS NEW ZE" }));
  assert.equal(freight.side, "purchases");
});

test("import GST adds to any credit adjustment rather than replacing it", () => {
  const resolve = () => ({ treatment: "standard", side: "imports" });
  const result = gstReturn([txn("2025-04-10", -1000)], PERIOD, {
    resolve,
    basis: "payments",
    creditAdjustments: 500,
  });
  assert.equal(result.boxes.box13, 1500);
});

test("a zero-rated purchase claims no GST, because none was charged", () => {
  // Box 12 is not summed from the lines: the form works it out as 3/23 of Box
  // 11. So anything put in Box 11 claims GST at 15% whether or not any was
  // paid, and a zero-rated purchase had none.
  const resolve = () => ({ treatment: "zero-rated", side: "purchases" });
  const result = gstReturn([txn("2025-04-10", -11500)], PERIOD, { basis: "payments", resolve });

  assert.equal(result.boxes.box11, 0, "not in Box 11");
  assert.equal(result.boxes.box12, 0, "so nothing is claimed");
  assert.equal(result.excluded.length, 1);
  assert.match(result.excluded[0].classification.reason, /no GST was charged/);
});

test("a zero-rated sale still passes through Box 5 and out again at Box 6", () => {
  // The mirror of the case above, and the reason it cannot simply be excluded
  // by treatment: the form asks for zero-rated supplies in Box 5 and removes
  // them at Box 6.
  const resolve = () => ({ treatment: "zero-rated", side: "sales" });
  const result = gstReturn([txn("2025-04-10", 11500)], PERIOD, { basis: "payments", resolve });

  assert.equal(result.boxes.box5, 11500);
  assert.equal(result.boxes.box6, 11500);
  assert.equal(result.boxes.box7, 0);
  assert.equal(result.boxes.box8, 0);
});

test("a transfer recorded between your own accounts is out of scope, however the bank line reads", () => {
  // Card repayments paired as transfers in the ledger fell through to
  // "assumed standard-rated" here: the bank side of an internet transfer
  // claimed GST on the whole repayment, and a direct debit counted both sides.
  const bankLeg = txn("2025-11-17", -150000, {
    id: "bank-leg", account: "bank-01", otherParty: "Sample Company INTERNET XFR",
  });
  const cardLeg = txn("2025-11-17", 150000, {
    id: "card-leg", account: "card-01", otherParty: "CARD REPAYMENT RECEIVED",
  });

  const unpaired = gstResolver({});
  assert.equal(unpaired(bankLeg).assumed, true, "without the pairing it is only a guess");

  const resolve = gstResolver({ transfers: { "bank-leg": "card-leg", "card-leg": "bank-leg" } });
  for (const leg of [bankLeg, cardLeg]) {
    const classification = resolve(leg);
    assert.equal(classification.treatment, "out-of-scope");
    assert.equal(classification.side, "none");
    assert.notEqual(classification.assumed, true);
  }

  const period = { from: "2025-10-01", to: "2025-11-30" };
  const result = gstReturn([bankLeg, cardLeg], period, { resolve, basis: "payments" });
  assert.equal(result.boxes.box5, 0, "nothing in sales");
  assert.equal(result.boxes.box11, 0, "nothing in purchases");
});

test("a refund sits on the side of the return its account is on, not the side its sign suggests", () => {
  // Saved by sign, a subscription refund reached Box 5 as a sale and a refund
  // paid to a customer reached Box 11 as a purchase. The GST came out the same;
  // the boxes did not match the return as filed.
  const refund = txn("2025-04-08", 3669, { id: "refund-in" });
  const repaid = txn("2025-04-09", -80000, { id: "refund-out" });
  const overrides = {
    "refund-in": { treatment: "standard", side: "sales", code: "485 Subscriptions", note: "saved by sign" },
    "refund-out": { treatment: "standard", side: "purchases", code: "200 Sales", note: "saved by sign" },
  };
  const codes = { "refund-in": "485 Subscriptions", "refund-out": "200 Sales" };
  const sides = { "485 Subscriptions": "purchases", "200 Sales": "sales" };
  const resolve = gstResolver({
    overrides,
    codeOf: (t) => codes[t.id] ?? null,
    chartTreatment: (code) => (sides[code] ? { treatment: "standard", side: sides[code] } : null),
  });
  assert.equal(resolve(refund).side, "purchases");
  assert.equal(resolve(repaid).side, "sales");

  const result = gstReturn([refund, repaid], { from: "2025-04-01", to: "2025-05-31" }, { resolve, basis: "payments" });
  // Negative, which is the point: a refund to a customer reduces sales. The
  // figure is -800.02 rather than -800.00 because Box 5 is worked back from
  // the GST (-104.35 x 23/3), the way Xero states it.
  assert.ok(result.boxes.box5 < 0, "a refund to a customer reduces sales");
  assert.equal(result.boxes.box5, -80002);
  // Box 11 is stated from the tax rather than summed from the lines, so the
  // refund shows as the tax it carries: 4.79 off Box 12, and Box 11 down with it.
  assert.equal(result.boxes.box12, -479, "a refund from a supplier reduces the tax claimed");
  assert.ok(result.boxes.box11 < 0, "and reduces purchases, not sales");
});

test("a line with no account side keeps the side it was given", () => {
  const spend = txn("2025-04-10", -2300, { id: "plain" });
  const resolve = gstResolver({
    overrides: { plain: { treatment: "standard", side: "purchases", note: "by hand" } },
    codeOf: () => null,
  });
  assert.equal(resolve(spend).side, "purchases");
});


test("a line coded to an entity not registered for GST carries none, whatever else says so", () => {
  const rates = txn("2025-06-03", -58360, { id: "rates" });
  const repairs = txn("2025-06-04", -11500, { id: "repairs" });
  const codes = { rates: "Totara Place Rates", repairs: "Shop Repairs" };
  const resolve = gstResolver({
    codeOf: (t) => codes[t.id] ?? null,
    // The chart marks both 15%, and an answer saved before the rates account
    // was given to the rental said standard as well.
    chartTreatment: () => ({ treatment: "standard", side: "purchases" }),
    overrides: { rates: { treatment: "standard", side: "purchases", note: "saved earlier" } },
    unregistered: (code) => code === "Totara Place Rates",
  });
  assert.equal(resolve(rates).treatment, "out-of-scope");
  assert.equal(resolve(rates).side, "none");
  assert.equal(resolve(repairs).treatment, "standard", "the registered entity's account is unchanged");

  const result = gstReturn([rates, repairs], { from: "2025-06-01", to: "2025-07-31" }, { resolve, basis: "payments" });
  assert.equal(result.boxes.box12, 1500, "only the registered entity's purchase is claimed");
});

test("a transfer stays a transfer on an unregistered entity's account", () => {
  const leg = txn("2025-06-03", -10000, { id: "leg" });
  const resolve = gstResolver({
    codeOf: () => "Totara Place Rates",
    unregistered: () => true,
    transfers: { leg: "other" },
  });
  assert.match(resolve(leg).reason, /transfer/);
});

test("Box 7 is always Box 5 less Box 6, whichever way the GST is rounded", () => {
  // A real period read Box 5 7,467.09 against Box 7 7,466.95 with nothing
  // zero-rated: Box 7 had been worked back from the GST and Box 5 had not.
  // The form defines Box 7 as Box 5 less Box 6, so every mode must keep it.
  const lines = [
    txn("2025-04-03", 12999, { id: "s1" }),
    txn("2025-04-04", 33337, { id: "s2" }),
    txn("2025-04-05", 101, { id: "s3" }),
    txn("2025-04-06", 5003, { id: "z1" }),
    txn("2025-04-07", 77777, { id: "s4" }),
  ];
  const resolve = (t) =>
    t.id === "z1" ? { treatment: "zero-rated", side: "sales" } : { treatment: "standard", side: "sales" };
  for (const rounding of ["per-line", "form"]) {
    const b = gstReturn(lines, PERIOD, { resolve, basis: "payments", rounding }).boxes;
    assert.equal(b.box7, b.box5 - b.box6, `${rounding}: Box 7 = Box 5 - Box 6`);
    assert.equal(b.box6, 5003, `${rounding}: zero-rated sales stay whole in Box 6`);
  }
});

test("six-monthly periods end 30 September and 31 March, due 28 October and 7 May", () => {
  const periods = gstPeriods({ from: "2025-04-01", to: "2026-03-31" }, { months: 6, anchorMonth: 3 });
  assert.deepEqual(
    periods.map((p) => [p.from, p.to, p.due]),
    [
      ["2025-04-01", "2025-09-30", "2025-10-28"],
      ["2025-10-01", "2026-03-31", "2026-05-07"],
    ],
  );
});
