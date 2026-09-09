import assert from "node:assert/strict";
import test from "node:test";
import { checkDailyBalances, judgeDuplicates } from "../dist/bank-balances.js";

const txn = (id, date, amount) => ({
  id, date, amount, currency: "NZD", account: "Sample Account - 02-1100-0022002-02",
  serial: "", trn: "", particulars: "", code: "", reference: "", otherParty: "Cafe",
  origin: "", type: "", batch: "", otherPartyAccount: "",
});

// The bank's own closing balance, one row a day.
const section = (days) => ({
  account: "Sample Account - 02-1100-0022002-02",
  days: days.map(([date, closing]) => ({ date, closing })),
});

test("a second copy is caught: the balance is out by exactly its amount", () => {
  // The bank saw one $56 payment on the 2nd. We hold it twice.
  const ours = [txn("a", "2026-04-01", -1000), txn("b", "2026-04-02", -5600), txn("c", "2026-04-02", -5600)];
  const bank = section([
    ["2026-04-01", -1000],
    ["2026-04-02", -6600],
    ["2026-04-03", -6600],
  ]);

  const checks = checkDailyBalances([bank], ours);
  const [judgement] = judgeDuplicates([txn("c", "2026-04-02", -5600)], checks);

  assert.equal(judgement.verdict, "double counted");
  assert.match(judgement.reason, /out by exactly this amount/);
});

test("two real payments the same size are left alone", () => {
  // The bank saw both, so its balance already includes the pair.
  const ours = [txn("a", "2026-04-01", -1000), txn("b", "2026-04-02", -5600), txn("c", "2026-04-02", -5600)];
  const bank = section([
    ["2026-04-01", -1000],
    ["2026-04-02", -12200],
    ["2026-04-03", -12200],
  ]);

  const checks = checkDailyBalances([bank], ours);
  const [judgement] = judgeDuplicates([txn("c", "2026-04-02", -5600)], checks);

  assert.equal(judgement.verdict, "both real");
  assert.match(judgement.reason, /agrees with keeping both/);
});

test("a day that is out by some other amount is not guessed at", () => {
  // Something else is wrong on that day, so this row cannot be judged by it.
  const ours = [txn("a", "2026-04-01", -1000), txn("b", "2026-04-02", -5600)];
  const bank = section([
    ["2026-04-01", -1000],
    ["2026-04-02", -9999],
    ["2026-04-03", -9999],
  ]);

  const checks = checkDailyBalances([bank], ours);
  const [judgement] = judgeDuplicates([txn("b", "2026-04-02", -5600)], checks);

  assert.equal(judgement.verdict, "cannot tell");
  assert.match(judgement.reason, /rather than this row's amount/);
});

test("two questionable rows on one day cannot be separated by one break", () => {
  const ours = [txn("b", "2026-04-02", -5600), txn("c", "2026-04-02", -5600)];
  const bank = section([["2026-04-01", 0], ["2026-04-02", -5600]]);
  const checks = checkDailyBalances([bank], ours);

  const judgements = judgeDuplicates(
    [txn("b", "2026-04-02", -5600), txn("c", "2026-04-02", -5600)],
    checks,
  );
  for (const j of judgements) {
    assert.equal(j.verdict, "cannot tell");
    assert.match(j.reason, /More than one row in question/);
  }
});

test("with no balances for the account, it says so rather than guessing", () => {
  const judgements = judgeDuplicates([txn("b", "2026-04-02", -5600)], []);
  assert.equal(judgements[0].verdict, "cannot tell");
  assert.match(judgements[0].reason, /No daily balances/);
});
