import test from "node:test";
import assert from "node:assert/strict";
import { categorise, keywordMatches, matchText, ruleForLine } from "../dist/index.js";

function txn(amount, fields = {}) {
  return {
    id: "t",
    date: "2024-12-18",
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

// The line that exposed it: the bank writes everything into the payee.
const rent = txn(56000, {
  otherParty: "HARGREAVES T 2/14a 190324 rent",
  particulars: "2/14a",
  code: "190324",
  reference: "rent",
});
const water = txn(6310, {
  otherParty: "HARGREAVES T 2/14a 190324 water",
  particulars: "2/14a",
  code: "190324",
  reference: "water",
});

test("a keyword built from a line with a gap in it never matched as one run", () => {
  const set = { rules: [{ keyword: "HARGREAVES RENT", code: "201" }] };
  assert.equal(categorise(rent, set).code, null);
});

test("in any order, each word has to start a word of the line", () => {
  const line = matchText("HARGREAVES T 2/14a 190324 rent GOOGLE ADS1752102256");
  assert.equal(keywordMatches(line, "HARGREAVES RENT", true), true);
  assert.equal(keywordMatches(line, "RENT HARGREAVES", true), true);
  assert.equal(keywordMatches(line, "GOOGLE ADS", true), true);
  assert.equal(keywordMatches(line, "HARGREAVES RENT", false), false);
  assert.equal(keywordMatches(matchText("PARENT CURRENT"), "RENT", true), false);
  assert.equal(keywordMatches(matchText("RENTAL"), "RENT", true), true);
});

test("a rule written from a line matches that line and its siblings, not the water", () => {
  const rule = ruleForLine(rent, "201");
  assert.deepEqual(rule, { priority: 100, keyword: "HARGREAVES RENT", anyOrder: true, code: "201" });
  const set = { rules: [rule] };
  assert.equal(categorise(rent, set).code, "201");
  assert.equal(categorise({ ...rent, id: "u", date: "2025-01-02" }, set).code, "201");
  assert.equal(categorise(water, set).code, null);
});

test("words that cannot match are dropped from the end until the rule fits its line", () => {
  // ABC123DEF: the digits split it into ABC and DEF, and DEF begins no word.
  const line = txn(-500, { otherParty: "ABCO123DEFS QRST" });
  const rule = ruleForLine(line, "400");
  assert.equal(rule.keyword, "ABCO");
  assert.equal(categorise(line, { rules: [rule] }).code, "400");
  assert.equal(ruleForLine(txn(-1, { otherParty: "123456" }), "400"), null);
});

test("a rule's description comes back with its code", () => {
  const set = { rules: [{ keyword: "HARGREAVES", code: "201", description: "Rent 2/14a Kowhai St" }] };
  assert.equal(categorise(rent, set).description, "Rent 2/14a Kowhai St");
  assert.equal(categorise(rent, { rules: [{ keyword: "HARGREAVES", code: "201" }] }).description, undefined);
});
