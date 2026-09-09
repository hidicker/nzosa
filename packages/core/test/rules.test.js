import test from "node:test";
import assert from "node:assert/strict";
import { categorise, categoriseAll } from "../dist/index.js";

function txn(amount, fields = {}) {
  return {
    id: "t",
    date: "2025-06-01",
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

test("matches a keyword against every text field, case-insensitively", () => {
  const set = { rules: [{ keyword: "bright valley", code: "Lease" }] };
  assert.equal(categorise(txn(1000, { otherParty: "BRIGHT VALLEY E" }), set).code, "Lease");
  assert.equal(categorise(txn(1000, { particulars: "Bright Valley" }), set).code, "Lease");
  assert.equal(categorise(txn(1000, { reference: "bright valley ltd" }), set).code, "Lease");
  assert.equal(categorise(txn(1000, { otherParty: "Someone else" }), set).code, null);
});

test("priority decides between competing rules, then declaration order", () => {
  const set = {
    rules: [
      { keyword: "MITRE 10", code: "General", priority: 10 },
      { keyword: "MITRE 10 MEGA NEW LYNN", code: "Rimu Lane Expense", priority: 50 },
    ],
  };
  assert.equal(categorise(txn(-1000, { otherParty: "MITRE 10 MEGA NEW LYNN" }), set).code, "Rimu Lane Expense");
  assert.equal(categorise(txn(-1000, { otherParty: "MITRE 10 NELSON" }), set).code, "General");
});

test("an amount band separates rules that share a keyword", () => {
  // Straight from the workbook: two loan repayments to the same payee, told
  // apart only by how much they are.
  const set = {
    rules: [
      { keyword: "TOTALMONEY", minAmount: 4000, maxAmount: 18000, code: "Loan 05", priority: 20 },
      { keyword: "TOTALMONEY", minAmount: 30000, maxAmount: 75000, code: "Loan 11", priority: 20 },
      { keyword: "TOTALMONEY", code: "Loan 11 (fallback)", priority: 10 },
    ],
  };

  assert.equal(categorise(txn(-8200, { particulars: "TOTALMONEY S" }), set).code, "Loan 05");
  assert.equal(categorise(txn(-48400, { particulars: "TOTALMONEY S" }), set).code, "Loan 11");
  assert.equal(categorise(txn(-99999, { particulars: "TOTALMONEY S" }), set).code, "Loan 11 (fallback)");
});

test("amount bands compare the absolute value, so direction does not matter", () => {
  const set = { rules: [{ keyword: "X", minAmount: 100, maxAmount: 200, code: "Band" }] };
  assert.equal(categorise(txn(-150, { otherParty: "X" }), set).code, "Band");
  assert.equal(categorise(txn(150, { otherParty: "X" }), set).code, "Band");
  assert.equal(categorise(txn(-250, { otherParty: "X" }), set).code, null);
});

test("the same keyword can mean different things on different accounts", () => {
  const set = {
    rules: [
      { keyword: "BUNNINGS", account: "card-a", code: "Mount Expenses" },
      { keyword: "BUNNINGS", account: "card-b", code: "Rimu Lane Expense" },
    ],
  };
  assert.equal(categorise(txn(-5000, { otherParty: "BUNNINGS", account: "card-a" }), set).code, "Mount Expenses");
  assert.equal(categorise(txn(-5000, { otherParty: "BUNNINGS", account: "card-b" }), set).code, "Rimu Lane Expense");
});

test("sign narrows a rule to money in or money out", () => {
  const set = {
    rules: [
      { account: "acct", sign: "CR", code: "Sales" },
      { account: "acct", sign: "DR", code: "Expenses" },
    ],
  };
  assert.equal(categorise(txn(1000), set).code, "Sales");
  assert.equal(categorise(txn(-1000), set).code, "Expenses");
});

test("defaults apply only when no rule matched", () => {
  const set = {
    rules: [{ keyword: "RENT", code: "Rent" }],
    defaults: [{ account: "acct", sign: "DR", code: "Ana", seen: 631, agreed: 587 }],
  };

  const matched = categorise(txn(-1000, { otherParty: "RENT DUE" }), set);
  assert.equal(matched.code, "Rent");
  assert.equal(matched.matchedBy, "rule");
  assert.equal(matched.confidence, undefined, "an explicit rule is an instruction, not an observation");

  const fallback = categorise(txn(-1000, { otherParty: "Anything" }), set);
  assert.equal(fallback.code, "Ana");
  assert.equal(fallback.matchedBy, "default");
  assert.ok(Math.abs(fallback.confidence - 587 / 631) < 1e-9);
  assert.match(fallback.reason, /right 587 of 631 times/);
});

test("a low-confidence default is reported as such rather than hidden", () => {
  // The workbook has defaults that were right 26 times out of 131. Surfacing
  // that number is the difference between a coding you can trust and one you
  // should check.
  const set = { defaults: [{ account: "acct", sign: "DR", code: "Drawings", seen: 131, agreed: 26 }] };
  const result = categorise(txn(-1000), set);
  assert.ok(result.confidence < 0.2);
});

test("an unmatched transaction is reported, never guessed", () => {
  const result = categorise(txn(-1000, { otherParty: "Mystery" }), { rules: [] });
  assert.equal(result.code, null);
  assert.equal(result.matchedBy, "none");
  assert.match(result.reason, /No rule or default matched/);
});

test("every rule carries its reason into the result", () => {
  const set = { rules: [{ keyword: "SAMPLE HANDYMAN", code: "Rimu Lane Expense", note: "handyman, not GST registered" }] };
  assert.equal(
    categorise(txn(-16000, { otherParty: "Sample Handyman Ltd" }), set).reason,
    "handyman, not GST registered",
  );
});

test("categoriseAll keeps each transaction with its coding", () => {
  const set = { rules: [{ keyword: "A", code: "Code A" }] };
  const results = categoriseAll([txn(100, { otherParty: "A" }), txn(200, { otherParty: "B" })], set);

  assert.equal(results.length, 2);
  assert.equal(results[0].categorisation.code, "Code A");
  assert.equal(results[1].categorisation.code, null);
  assert.equal(results[1].transaction.otherParty, "B");
});

test("an empty rule set codes nothing rather than throwing", () => {
  assert.equal(categorise(txn(100), {}).code, null);
});
