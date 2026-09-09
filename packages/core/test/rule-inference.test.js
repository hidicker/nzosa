import assert from "node:assert/strict";
import test from "node:test";
import { inferRules, inferAccountUsage, keywordFor, coverage } from "../dist/rule-inference.js";
import { categorise } from "../dist/rules.js";

const tx = (id, otherParty, amount, account = "bank-01", extra = {}) => ({
  id, date: "2025-06-01", amount, currency: "NZD", account,
  serial: "", trn: "", particulars: "", code: "", reference: "",
  otherParty, origin: "", type: "", batch: "", otherPartyAccount: "", ...extra,
});

test("a keyword drops the reference numbers and keeps the name", () => {
  assert.equal(keywordFor(tx("1", "SP GARMIN 8004412075", -100)), "SP GARMIN");
  assert.equal(keywordFor(tx("2", "DHL EXPRESS NZ LTD", -100)), "DHL EXPRESS NZ LTD");
  assert.equal(keywordFor(tx("3", "TAUTAHI,MERE", 300)), "TAUTAHI MERE");
});

test("a repeated payee coded the same way becomes a rule", () => {
  const proposals = inferRules([
    { transaction: tx("1", "SPOTIFY", -1499), code: "485" },
    { transaction: tx("2", "SPOTIFY", -1499), code: "485" },
    { transaction: tx("3", "SPOTIFY", -1499), code: "485" },
  ]);
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].rule.keyword, "SPOTIFY");
  assert.equal(proposals[0].rule.code, "485");
  assert.equal(proposals[0].seen, 3);
  assert.equal(proposals[0].agreed, 3);
  assert.equal(proposals[0].rule.account, undefined, "no account restriction needed");
});

test("one sighting is not a rule", () => {
  const proposals = inferRules([{ transaction: tx("1", "ONE OFF", -500), code: "453" }]);
  assert.equal(proposals.length, 0, "a single transaction wearing a hat");
});

test("a payee meaning different accounts on different banks is restricted by account", () => {
  // The Tower Insurance case: the company's insurance on one account, the
  // rental's on another.
  const examples = [];
  for (let i = 0; i < 3; i += 1) {
    examples.push({ transaction: tx(`a${i}`, "TOWER INSURANCE", -50000, "arrow"), code: "433" });
    examples.push({ transaction: tx(`b${i}`, "TOWER INSURANCE", -50000, "mount"), code: "Mount Expenses" });
  }
  const proposals = inferRules(examples);

  assert.equal(proposals.length, 2, "one rule per account, not one guess");
  for (const p of proposals) {
    assert.notEqual(p.rule.account, undefined, "restricted");
    assert.ok(["arrow", "mount"].includes(p.rule.account));
  }
  const arrow = proposals.find((p) => p.rule.account === "arrow");
  assert.equal(arrow.rule.code, "433");
  assert.ok(arrow.rule.priority > 100, "an account-restricted rule must outrank a general one");
});

test("an account restriction is the id, never the display label", () => {
  const examples = [];
  for (let i = 0; i < 3; i += 1) {
    examples.push({ transaction: tx(`a${i}`, "TOWER", -100, "02-1100-0022001-001"), code: "433" });
    examples.push({ transaction: tx(`b${i}`, "TOWER", -100, "02-1100-0022001-066"), code: "Mount" });
  }
  const proposals = inferRules(examples);
  for (const p of proposals) {
    assert.match(p.rule.account, /^\d{2}-\d{4}-\d{7}-\d{3}$/, "an id, not a name");
  }
});

test("genuinely mixed evidence proposes nothing and says what it saw", () => {
  const examples = [];
  // Same payee, same account, coded three different ways: a person's problem.
  for (let i = 0; i < 2; i += 1) {
    examples.push({ transaction: tx(`a${i}`, "AMBIGUOUS", -100), code: "400" });
    examples.push({ transaction: tx(`b${i}`, "AMBIGUOUS", -100), code: "453" });
    examples.push({ transaction: tx(`c${i}`, "AMBIGUOUS", -100), code: "485" });
  }
  assert.equal(inferRules(examples).length, 0);
});

test("a small minority does not stop a strong rule, but is reported", () => {
  const examples = [];
  for (let i = 0; i < 9; i += 1) {
    examples.push({ transaction: tx(`a${i}`, "MOSTLY", -100), code: "485" });
  }
  examples.push({ transaction: tx("odd", "MOSTLY", -100), code: "453" });

  const proposals = inferRules(examples);
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].agreed, 9);
  assert.equal(proposals[0].seen, 10);
  assert.deepEqual(proposals[0].competing, [{ code: "453", count: 1 }]);
});

test("coverage says what the proposals would still leave uncoded", () => {
  const examples = [];
  for (let i = 0; i < 3; i += 1) {
    examples.push({ transaction: tx(`s${i}`, "SPOTIFY", -1499), code: "485" });
  }
  const proposals = inferRules(examples);
  const result = coverage(
    [tx("x", "SPOTIFY", -1499), tx("y", "SOMETHING ELSE", -100)],
    proposals,
  );
  assert.equal(result.covered, 1);
  assert.equal(result.total, 2);
});

test("account usage is inferred from which way the money went", () => {
  const usage = inferAccountUsage([
    { transaction: tx("1", "CUSTOMER", 100000), code: "200" },
    { transaction: tx("2", "CUSTOMER", 50000), code: "200" },
    { transaction: tx("3", "SUPPLIER", -30000), code: "310" },
    { transaction: tx("4", "TRANSFER", 50000), code: "980" },
    { transaction: tx("5", "TRANSFER", -50000), code: "980" },
  ]);
  const by = Object.fromEntries(usage.map((u) => [u.code, u]));
  assert.equal(by["200"].use, "income");
  assert.equal(by["200"].proposedType, "Revenue");
  assert.equal(by["310"].use, "expense");
  assert.equal(by["310"].proposedType, "Overhead");
  assert.equal(by["980"].use, "mixed", "money both ways is a balance-sheet account");
  assert.equal(by["980"].proposedType, "", "and gets no type proposed");
});

test("the coverage promised is the coverage the engine delivers", () => {
  // The number shown before accepting a set of rules has to be the number you
  // get after accepting them. It was counted by re-implementing the match
  // against a stripped-down keyword while the engine matched the whole line,
  // so the two disagreed -- on a real ledger, 584 promised against 413 given.
  const examples = [
    { transaction: tx("1", "STRIPE PAYMENTS 4471", 5000), code: "200 Sales" },
    { transaction: tx("2", "STRIPE PAYMENTS 4472", 6000), code: "200 Sales" },
    { transaction: tx("3", "STRIPE PAYMENTS 4473", 7000), code: "200 Sales" },
    { transaction: tx("4", "FUEL STOP APP 88", -4000), code: "449 Motor Vehicle" },
    { transaction: tx("5", "FUEL STOP APP 89", -4100), code: "449 Motor Vehicle" },
    { transaction: tx("6", "FUEL STOP APP 90", -4200), code: "449 Motor Vehicle" },
  ];
  const proposals = inferRules(examples);
  assert.ok(proposals.length > 0, "some rules should be drawn");

  const transactions = examples.map((e) => e.transaction);
  const promised = coverage(transactions, proposals);

  const ruleSet = { rules: proposals.map((p) => p.rule) };
  const actually = transactions.filter((t) => categorise(t, ruleSet).code !== null).length;

  assert.equal(promised.covered, actually, "the estimate is what the engine does");
  assert.equal(promised.total, transactions.length);
});
