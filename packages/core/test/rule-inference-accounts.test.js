import assert from "node:assert/strict";
import test from "node:test";
import { inferRules, coverage } from "../dist/index.js";

const paid = (over) => ({
  id: String(Math.random()), date: "2026-03-03", account: "02-1100-0022001-000",
  amount: -50000, currency: "NZD", otherParty: "", particulars: "", code: "",
  reference: "", otherPartyAccount: "", origin: "", type: "", batch: "",
  occurrence: 1, extras: {}, source: { importer: "bnz-account", file: "f.csv", line: 2 },
  ...over,
});

test("a supplier whose payee changes every time is still gathered", () => {
  // No keyword can hold these together: the bank writes the job into the
  // payee, so every payment arrives under a different name. They all name the
  // same account.
  const examples = [
    { transaction: paid({ otherParty: "Acme Advisory Services year end", otherPartyAccount: "12-3456-0012345-00" }), code: "412 Consulting" },
    { transaction: paid({ otherParty: "Acme Advisory Services GST return Q2", otherPartyAccount: "12-3456-0012345-00" }), code: "412 Consulting" },
  ];
  const proposals = inferRules(examples);
  const byAccount = proposals.filter((p) => p.rule.where?.otherPartyAccount);
  assert.equal(byAccount.length, 1);
  assert.equal(byAccount[0].rule.code, "412 Consulting");
  assert.equal(byAccount[0].rule.where.otherPartyAccount, "12-3456-0012345-00");
  assert.equal(byAccount[0].seen, 2);
});

test("two sightings are enough for an account, three for a keyword", () => {
  // An account number is the counterparty; a keyword is a guess about which
  // words identify one. The evidence is not the same kind, so the bar is not
  // the same height.
  const two = [
    { transaction: paid({ otherParty: "Ridgeline Freight", otherPartyAccount: "12-3456-0078901-00" }), code: "425 Freight" },
    { transaction: paid({ otherParty: "Ridgeline Freight", otherPartyAccount: "12-3456-0078901-00" }), code: "425 Freight" },
  ];
  const proposals = inferRules(two);
  assert.equal(proposals.some((p) => p.rule.where?.otherPartyAccount), true, "account rule proposed");
  assert.equal(proposals.some((p) => p.rule.keyword && !p.rule.where), false, "keyword rule not proposed on two");
});

test("a transfer between your own accounts proposes nothing", () => {
  // Money moving from one of your accounts to another is not a supplier, and
  // a coding rule for it would be wrong in a way that reaches a return.
  const examples = [
    { transaction: paid({ account: "02-1100-0022001-000", otherPartyAccount: "02-1100-0022002-000" }), code: "Savings" },
    { transaction: paid({ account: "02-1100-0022002-000", otherPartyAccount: "02-1100-0022001-000" }), code: "Savings" },
    { transaction: paid({ account: "02-1100-0022001-000", otherPartyAccount: "02-1100-0022002-000" }), code: "Savings" },
  ];
  assert.deepEqual(inferRules(examples).filter((p) => p.rule.where?.otherPartyAccount), []);
});

test("an account coded inconsistently is left alone", () => {
  const examples = [
    { transaction: paid({ otherPartyAccount: "12-3456-0078901-00" }), code: "425 Freight" },
    { transaction: paid({ otherPartyAccount: "12-3456-0078901-00" }), code: "449 Motor Vehicle" },
    { transaction: paid({ otherPartyAccount: "12-3456-0078901-00" }), code: "310 Cost of Goods" },
  ];
  assert.deepEqual(inferRules(examples).filter((p) => p.rule.where?.otherPartyAccount), []);
});

test("the number is written as the bank spells it", () => {
  // Grouped on the normalised form so a padded suffix does not split one
  // counterparty in two, but a rule quoting a number nobody recognises is a
  // rule nobody can check.
  const examples = [
    { transaction: paid({ otherPartyAccount: "12-3456-0012345-00" }), code: "412 Consulting" },
    { transaction: paid({ otherPartyAccount: "12-3456-0012345-000" }), code: "412 Consulting" },
  ];
  const [proposal] = inferRules(examples).filter((p) => p.rule.where?.otherPartyAccount);
  assert.equal(proposal.seen, 2, "the padded suffix did not split it");
  assert.equal(proposal.rule.where.otherPartyAccount, "12-3456-0012345-00");
});

test("the proposals it makes actually code what it claims", () => {
  // Counted with the engine rather than by trusting the proposal.
  const examples = [
    { transaction: paid({ id: "a", otherParty: "one", otherPartyAccount: "12-3456-0078901-00" }), code: "425 Freight" },
    { transaction: paid({ id: "b", otherParty: "two", otherPartyAccount: "12-3456-0078901-00" }), code: "425 Freight" },
  ];
  const proposals = inferRules(examples);
  const covered = coverage(examples.map((e) => e.transaction), proposals);
  assert.equal(covered.covered, 2);
});
