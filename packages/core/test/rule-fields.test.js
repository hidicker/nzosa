import assert from "node:assert/strict";
import test from "node:test";
import { categorise } from "../dist/rules.js";

const ird = (particulars, amount = -142384) => ({
  id: particulars, date: "2026-08-27", account: "02-1100-0022001-000", amount,
  currency: "NZD", otherParty: "Inland Revenue", particulars, code: "111222333",
  reference: "4455667788",
});

// One rule for every way a person writes it, which is the whole point.
const rules = {
  rules: [
    { priority: 200, where: { otherParty: "Inland Revenue", particulars: "GST" }, code: "820 GST" },
    { priority: 100, keyword: "Inland Revenue", code: "505 Income Tax" },
  ],
};

test("one rule catches every spelling of the same tax", () => {
  for (const p of ["GST", "Q2 GST", "Aug GST", "GST Aug", "GST period 2"]) {
    assert.equal(categorise(ird(p), rules).code, "820 GST", p);
  }
});

test("and leaves the other taxes to the rule below it", () => {
  for (const p of ["IIT", "PSO", "prov tax", "Aug Prov Tax", "Q2 Prov"]) {
    assert.equal(categorise(ird(p), rules).code, "505 Income Tax", p);
  }
});

test("a supplier whose own note says gst is not a tax payment", () => {
  // The reason to match a field rather than the whole line: "incl gst" in
  // somebody's description is not the particulars of a payment to the IRD.
  const supplier = {
    id: "s", date: "2025-01-13", account: "02-1100-0022001-000", amount: -13800,
    currency: "NZD", otherParty: "Kowhai Joinery Ltd", particulars: "widget co incl gst",
    code: "", reference: "",
  };
  assert.equal(categorise(supplier, rules).code, null);
});

test("every named field has to hold, not just one", () => {
  const both = { rules: [{ priority: 100, where: { otherParty: "Inland Revenue", particulars: "GST" }, code: "820" }] };
  // Right payee, wrong particulars.
  assert.equal(categorise(ird("IIT"), both).code, null);
  // Right particulars, wrong payee.
  const other = { ...ird("GST"), otherParty: "Someone Else" };
  assert.equal(categorise(other, both).code, null);
});

test("fields are folded the way keywords are", () => {
  const rule = { rules: [{ priority: 100, where: { particulars: "prov tax" }, code: "505" }] };
  // Case and stray spacing do not decide whether a rule fires.
  assert.equal(categorise(ird("Prov  Tax"), rule).code, "505");
  assert.equal(categorise(ird("PROV TAX"), rule).code, "505");
  // A hyphen survives the fold, because a hyphen is part of names and
  // references that have to keep matching -- INV-4021, O'Brien-Smith. So
  // "PROV-TAX" is a different string from "prov tax" and does not match. That
  // is the contract, recorded here so a change to it is a deliberate one.
  assert.equal(categorise(ird("PROV-TAX"), rule).code, null);
});

test("a rule with fields says what it matched on", () => {
  const { reason } = categorise(ird("GST"), {
    rules: [{ priority: 100, where: { otherParty: "Inland Revenue", particulars: "GST" }, code: "820" }],
  });
  assert.match(reason, /otherParty "Inland Revenue"/);
  assert.match(reason, /particulars "GST"/);
});

test("keyword and fields together narrow rather than widen", () => {
  const rule = { rules: [{ priority: 100, keyword: "Inland Revenue", where: { particulars: "GST" }, code: "820" }] };
  assert.equal(categorise(ird("GST"), rule).code, "820");
  assert.equal(categorise(ird("IIT"), rule).code, null);
});

test("a rule can match the account the money went to", () => {
  // Some banks write the particulars into the payee, so every payment to one
  // supplier arrives under a different name and no keyword can gather them.
  // The account number is the same every time.
  const paid = (payee, amount) => ({
    id: payee, date: "2026-03-03", account: "02-1100-0022001-000", amount,
    currency: "NZD", otherParty: payee, particulars: "", code: "", reference: "",
    otherPartyAccount: "38-9022-0374960-00",
  });
  const rules = { rules: [{
    priority: 100,
    where: { otherPartyAccount: "38-9022-0374960-00" },
    code: "413 Subcontractors",
  }]};

  for (const payee of ["Kowhai Joinery wof prado", "Kowhai Joinery PRO-2625-A", "Kowhai Joinery gear"]) {
    assert.equal(categorise(paid(payee, -100000), rules).code, "413 Subcontractors", payee);
  }
});

test("a padded suffix is the same account", () => {
  // Feeds disagree about how many digits the suffix has, and a rule quoting
  // one form must not miss the other.
  const rules = { rules: [{ priority: 100, where: { otherPartyAccount: "38-9022-0374960-00" }, code: "413" }] };
  const line = (account) => ({
    id: account, date: "2026-03-03", account: "02-1100-0022001-000", amount: -1000,
    currency: "NZD", otherParty: "anyone", particulars: "", code: "", reference: "",
    otherPartyAccount: account,
  });
  assert.equal(categorise(line("38-9022-0374960-000"), rules).code, "413");
  assert.equal(categorise(line("38-9022-0374960-00"), rules).code, "413");
});

test("another account is not caught by it", () => {
  const rules = { rules: [{ priority: 100, where: { otherPartyAccount: "38-9022-0374960-00" }, code: "413" }] };
  const other = {
    id: "x", date: "2026-03-03", account: "02-1100-0022001-000", amount: -1000,
    currency: "NZD", otherParty: "anyone", particulars: "", code: "", reference: "",
    otherPartyAccount: "38-9022-0374961-00",
  };
  assert.equal(categorise(other, rules).code, null);
  // And a line with no counterparty account at all is not a wildcard.
  assert.equal(categorise({ ...other, otherPartyAccount: "" }, rules).code, null);
});
