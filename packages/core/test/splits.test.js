import test from "node:test";
import assert from "node:assert/strict";
import {
  expandSplits,
  splitPartId,
  validateSplits,
  categorise,
  gstResolver,
} from "../dist/index.js";

function txn(id, amount, fields = {}) {
  return {
    id,
    occurrence: 1,
    date: "2026-06-19",
    amount,
    currency: "NZD",
    serial: "",
    trn: "",
    particulars: "",
    code: "",
    reference: "",
    otherParty: "CAFE",
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

const COFFEE = txn("a", -4000);

const SPLIT = {
  a: [
    { amount: -1500, code: "Entertainment", treatment: "standard", note: "client coffee" },
    { amount: -2500, code: "Ana", treatment: "out-of-scope", note: "personal share" },
  ],
};

// --------------------------------------------------------------- validation

test("parts must sum to the transaction exactly", () => {
  // The safety property. The bank saw one number; if the parts do not add back
  // to it, the balance reconciliation stops proving anything.
  assert.deepEqual(validateSplits([COFFEE], SPLIT), []);

  const short = { a: [{ amount: -1500, note: "a" }, { amount: -2000, note: "b" }] };
  const problems = validateSplits([COFFEE], short);
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /parts total -35\.00 but the transaction is -40\.00/);
  assert.match(problems[0].message, /out by 5\.00/);
});

test("a single cent out is still refused", () => {
  const off = { a: [{ amount: -1500, note: "a" }, { amount: -2501, note: "b" }] };
  assert.equal(validateSplits([COFFEE], off).length, 1);
});

test("a split needs at least two parts", () => {
  const one = { a: [{ amount: -4000, note: "all of it" }] };
  assert.match(validateSplits([COFFEE], one)[0].message, /at least two parts/);
});

test("every part needs a note", () => {
  const silent = {
    a: [{ amount: -1500, note: "explained" }, { amount: -2500, note: "  " }],
  };
  assert.match(validateSplits([COFFEE], silent)[0].message, /part 2 has no note/);
});

test("a split naming a transaction that is not there is reported", () => {
  assert.match(
    validateSplits([COFFEE], { missing: SPLIT.a })[0].message,
    /no transaction with this id/,
  );
});

test("a part may point the other way, which is what a net payout needs", () => {
  // Stripe pays out net: a 1000.00 sale less a 27.57 fee arrives as 972.43.
  const payout = txn("s", 97243, { otherParty: "Stripe Payments" });
  const stripe = {
    s: [
      { amount: 100000, code: "Sales", treatment: "standard", note: "gross sale" },
      { amount: -2757, code: "Stripe Fees", treatment: "out-of-scope", note: "processor fee" },
    ],
  };
  assert.deepEqual(validateSplits([payout], stripe), []);
});

// ---------------------------------------------------------------- expansion

test("expansion replaces the transaction with its parts", () => {
  const { transactions } = expandSplits([COFFEE, txn("b", -100)], SPLIT);

  assert.equal(transactions.length, 3, "one split into two, plus the untouched one");
  assert.deepEqual(
    transactions.map((t) => t.amount),
    [-1500, -2500, -100],
  );
  assert.deepEqual(
    transactions.slice(0, 2).map((t) => t.id),
    [splitPartId("a", 0), splitPartId("a", 1)],
  );
});

test("each part can be traced back to its parent", () => {
  const { transactions } = expandSplits([COFFEE], SPLIT);
  assert.equal(transactions[0].extras.splitOf, "a");
  assert.equal(transactions[0].extras.splitPart, "1");
  assert.equal(transactions[0].extras.splitParts, "2");
  // The description survives, so a part still reads like what it came from.
  assert.equal(transactions[0].otherParty, "CAFE");
  assert.equal(transactions[0].date, COFFEE.date);
});

test("a split that does not balance is left unexpanded, not applied", () => {
  // Expanding a broken split would change the totals without changing the bank
  // data, which is the failure worth being strict about.
  const broken = { a: [{ amount: -1500, note: "a" }, { amount: -2000, note: "b" }] };
  const { transactions } = expandSplits([COFFEE], broken);

  assert.equal(transactions.length, 1);
  assert.equal(transactions[0].amount, -4000, "the original survives intact");
});

test("part coding is expressed as overrides, so one mechanism governs", () => {
  const { transactions, overrides } = expandSplits([COFFEE], SPLIT);

  const first = overrides[transactions[0].id];
  assert.equal(first.code, "Entertainment");
  assert.equal(first.treatment, "standard");
  assert.match(first.note, /Split part 1 of 2: client coffee/);

  assert.equal(overrides[transactions[1].id].treatment, "out-of-scope");
});

test("existing overrides are preserved through expansion", () => {
  const existing = { b: { code: "Kept", note: "set by hand earlier" } };
  const { overrides } = expandSplits([COFFEE, txn("b", -100)], SPLIT, existing);
  assert.equal(overrides.b.code, "Kept");
});

test("coding and GST both honour the split parts", () => {
  const { transactions, overrides } = expandSplits([COFFEE], SPLIT);
  const resolve = gstResolver({ overrides });

  assert.equal(categorise(transactions[0], { overrides }).code, "Entertainment");
  assert.equal(categorise(transactions[0], { overrides }).matchedBy, "override");

  assert.equal(resolve(transactions[0]).treatment, "standard");
  assert.equal(resolve(transactions[1]).treatment, "out-of-scope");
});

test("a part with no coding falls through to the rules", () => {
  // Splitting an amount is not the same as deciding what each half is; a part
  // left uncoded should still be picked up by whatever rules exist.
  const partial = {
    a: [
      { amount: -1500, note: "still to be decided" },
      { amount: -2500, code: "Ana", note: "personal" },
    ],
  };
  const { transactions, overrides } = expandSplits([COFFEE], partial);

  assert.equal(overrides[transactions[0].id], undefined);
  assert.equal(categorise(transactions[0], { overrides }).matchedBy, "none");
  assert.equal(categorise(transactions[1], { overrides }).code, "Ana");
});

test("the parts of a split still sum to the original after expansion", () => {
  // The property that keeps `balances` meaningful, asserted end to end.
  const { transactions } = expandSplits([COFFEE], SPLIT);
  const total = transactions
    .filter((t) => t.extras.splitOf === "a")
    .reduce((sum, t) => sum + t.amount, 0);
  assert.equal(total, COFFEE.amount);
});
