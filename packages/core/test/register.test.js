import assert from "node:assert/strict";
import test from "node:test";
import { dedupe, isTyped, registerLines, typedLine } from "../dist/index.js";

const line = (serial, date, amount, payee, n = 1) =>
  typedLine({ account: "Petty cash", date, amount, currency: "NZD", payee, serial, line: n });

test("a typed line is a bank line like any other, with its own stable identity", () => {
  const one = line("1", "2026-05-01", -1250, "Four Square");
  assert.equal(one.account, "Petty cash");
  assert.equal(one.type, "OUT");
  assert.equal(one.otherParty, "Four Square");
  assert.ok(isTyped(one));
  assert.equal(line("1", "2026-05-01", -1250, "Four Square").id, one.id, "the same line made again is the same line");
});

test("two identical cash purchases stay two lines", () => {
  const a = line("1", "2026-05-01", -500, "Milk");
  const b = line("2", "2026-05-01", -500, "Milk");
  assert.notEqual(a.id, b.id);
  assert.equal(dedupe([a, b]).entries.length, 2);
});

test("the register runs a balance from the opening, in date order", () => {
  const lines = [line("2", "2026-05-03", -2000, "Stamps", 2), line("1", "2026-05-01", 10_000, "Float", 1), { ...line("3", "2026-05-02", -1, "x"), account: "Other" }];
  const run = registerLines(lines, "Petty cash", 500);
  assert.deepEqual(run.map((r) => [r.transaction.otherParty, r.balance]), [["Float", 10_500], ["Stamps", 8_500]]);
});
