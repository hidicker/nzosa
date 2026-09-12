import assert from "node:assert/strict";
import test from "node:test";
import { matchPayouts, sameEntityBanks } from "../dist/index.js";

const payout = (reference, net, date = "2025-04-12") => ({
  reference, date, account: "BNZ 01", net, parts: [], invoices: [],
});

const txn = (id, amount, date = "2025-04-12") => ({
  id, date, account: "BNZ 01", amount, otherParty: "Stripe", particulars: "",
  code: "", reference: "", description: "", currency: "NZD", source: "bank",
});

test("nothing to match against, nothing matched", () => {
  assert.deepEqual(matchPayouts({ payouts: [], transactions: [txn("a", 29698)] }), []);
  assert.deepEqual(matchPayouts({ payouts: [payout("ch_1", 29698)], transactions: [] }), []);
});

test("the amount must be exact, however close the date", () => {
  // A payout's net is the sum of its own parts. A bank line a cent away is a
  // different line, not a rounding.
  const found = matchPayouts({
    payouts: [payout("ch_1", 29698)],
    transactions: [txn("a", 29699)],
  });
  assert.deepEqual(found, []);
});

test("the date is a window, because the bank lags the processor", () => {
  const found = matchPayouts({
    payouts: [payout("ch_1", 29698, "2025-04-12")],
    transactions: [txn("a", 29698, "2025-04-15")],
  });
  assert.equal(found.length, 1);
  assert.equal(found[0].transaction.id, "a");
});

test("a line too far away in time is not the payout", () => {
  assert.deepEqual(
    matchPayouts({
      payouts: [payout("ch_1", 29698, "2025-04-12")],
      transactions: [txn("a", 29698, "2025-06-01")],
    }),
    [],
  );
});

test("the nearest date wins among lines of the same amount", () => {
  const found = matchPayouts({
    payouts: [payout("ch_1", 29698, "2025-04-12")],
    transactions: [txn("far", 29698, "2025-04-20"), txn("near", 29698, "2025-04-13")],
  });
  assert.equal(found[0].transaction.id, "near");
});

test("one bank line settles one payout, not several", () => {
  // Two payouts of the same amount in a week is ordinary for a subscription
  // business. Letting both claim the same line counts the money twice.
  const found = matchPayouts({
    payouts: [payout("ch_1", 29698, "2025-04-12"), payout("ch_2", 29698, "2025-04-13")],
    transactions: [txn("only", 29698, "2025-04-13")],
  });
  assert.equal(found.length, 1, "the second payout finds nothing left");
  assert.equal(found[0].payout.reference, "ch_1");
});

test("two payouts of the same amount take a line each", () => {
  const found = matchPayouts({
    payouts: [payout("ch_1", 29698, "2025-04-12"), payout("ch_2", 29698, "2025-04-20")],
    transactions: [txn("a", 29698, "2025-04-12"), txn("b", 29698, "2025-04-20")],
  });
  assert.deepEqual(found.map((f) => [f.payout.reference, f.transaction.id]),
    [["ch_1", "a"], ["ch_2", "b"]]);
});

const model = (banks) => ({ entities: [], accounts: {}, banks });

test("with nobody saying which accounts are whose, every account is in scope", () => {
  const all = new Set(["BNZ 01", "BNZ Visa", "Someone Else"]);
  const found = sameEntityBanks("BNZ 01", { model: model({}), allBanks: all });
  assert.deepEqual([...found.accounts].sort(), ["BNZ 01", "BNZ Visa", "Someone Else"]);
  assert.equal(found.scoped, false, "and it says so, because that is a guess");
});

test("an account's own entities decide which others are in scope", () => {
  // A movement between two of an entity's own accounts is not a supply. The
  // same movement to somebody else's account is drawings or a loan, and
  // pairing the two moves money between two sets of books.
  const found = sameEntityBanks("BNZ 01", {
    model: model({ "BNZ 01": ["acme"], "BNZ Visa": ["acme"], "Rental": ["other"] }),
    allBanks: new Set(["BNZ 01", "BNZ Visa", "Rental"]),
  });
  assert.deepEqual([...found.accounts].sort(), ["BNZ 01", "BNZ Visa"]);
  assert.equal(found.scoped, true);
});

test("an account serving two entities brings both their accounts into scope", () => {
  const found = sameEntityBanks("Shared", {
    model: model({ Shared: ["a", "b"], "A only": ["a"], "B only": ["b"], "C only": ["c"] }),
    allBanks: new Set(["Shared", "A only", "B only", "C only"]),
  });
  assert.deepEqual([...found.accounts].sort(), ["A only", "B only", "Shared"]);
});
