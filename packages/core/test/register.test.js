import { test } from "node:test";
import assert from "node:assert/strict";
import { dedupe, isRegisterEntry, registerProblem, registerRows, registerTransaction } from "../dist/index.js";

const coffee = { account: "petty-cash", date: "2026-10-20", payee: "Café Uno", description: "Coffee for a client", amount: -550, currency: "NZD" };

test("a typed entry is a bank line from the register", () => {
  const t = registerTransaction({ ...coffee, reference: "V12" }, "reg-1", []);
  assert.equal(t.id, "reg-1");
  assert.equal(t.amount, -550);
  assert.equal(t.otherParty, "Café Uno");
  assert.equal(t.particulars, "Coffee for a client");
  assert.equal(t.reference, "V12");
  assert.equal(t.account, "petty-cash");
  assert.ok(isRegisterEntry(t));
  assert.equal(isRegisterEntry({ ...t, source: { importer: "bnz-account", file: "x", line: 1 } }), false);
});

test("two coffees alike on one day are two lines, and neither is a duplicate", () => {
  const first = registerTransaction(coffee, "reg-1", []);
  const second = registerTransaction(coffee, "reg-2", [first]);
  assert.equal(first.occurrence, 1);
  assert.equal(second.occurrence, 2);
  const seen = dedupe([first, second], { legitimateDuplicates: [] }).entries;
  assert.deepEqual(seen.map((e) => e.status), ["unique", "unique"]);
  // Corrected later, an entry is not counted against itself.
  assert.equal(registerTransaction(coffee, "reg-2", [first, second]).occurrence, 2);
});

test("what an entry needs", () => {
  assert.equal(registerProblem(coffee), null);
  assert.match(registerProblem({ ...coffee, amount: 0 }), /amount/);
  assert.match(registerProblem({ ...coffee, date: "" }), /date/);
  assert.match(registerProblem({ ...coffee, payee: "", description: " " }), /Who/);
});

test("the running balance starts from the opening figure and goes in date order", () => {
  const lines = [
    registerTransaction({ ...coffee, date: "2026-10-22", amount: -2_000, payee: "Stamps" }, "b", []),
    registerTransaction({ ...coffee, date: "2026-10-01", amount: 20_000, payee: "Float", description: "Topped up" }, "a", []),
    registerTransaction({ ...coffee, account: "other" }, "x", []),
    registerTransaction(coffee, "c", []),
  ];
  const rows = registerRows(lines, "petty-cash", 5_000);
  assert.deepEqual(rows.map((r) => [r.transaction.id, r.balance]), [["a", 25_000], ["c", 24_450], ["b", 22_450]]);
});
