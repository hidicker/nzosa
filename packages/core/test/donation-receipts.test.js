import assert from "node:assert/strict";
import test from "node:test";
import { belowCreditMinimum, donorYears, nextReceiptNumber, organisationProblems, receiptHtml, receiptProblems } from "../dist/index.js";

const np = {
  form: "charity", registeredCharity: true, charityNumber: "CC99999", donee: true, irdNumber: "123-456-789",
  signatory: { name: "Rimu Totara", designation: "Treasurer" },
};
const receipt = {
  id: "r1", entityId: "club", number: "DR-0001", date: "2026-08-14", amount: 12_000, donor: "Kowhai Smith",
  address: "1 Rimu Lane\nNelson", issued: "2026-08-15", signedBy: "Rimu Totara", designation: "Treasurer",
};

test("numbers go up from the highest, voided ones included, and are never reused", () => {
  assert.equal(nextReceiptNumber([]), "DR-0001");
  assert.equal(nextReceiptNumber([receipt, { ...receipt, number: "DR-0007", voided: { on: "2026-09-01", why: "wrong name" } }]), "DR-0008");
});

test("everything Inland Revenue asks for is checked before a receipt is issued", () => {
  assert.deepEqual(organisationProblems(np), []);
  assert.match(organisationProblems({ ...np, donee: false }).join(" "), /donee organisation/);
  assert.match(organisationProblems({ ...np, irdNumber: "" }).join(" "), /IRD number/);
  assert.match(organisationProblems({ ...np, charityNumber: "" }).join(" "), /registration number/);
  assert.match(organisationProblems({ ...np, signatory: undefined }).join(" "), /authorised person/);
  assert.match(receiptProblems(np, { ...receipt, donor: " " }).join(" "), /full name/);
  assert.equal(receiptProblems(np, receipt).length, 0);
});

test("the signer is never the donor", () => {
  assert.match(receiptProblems(np, { ...receipt, donor: "rimu totara" }).join(" "), /their own donation/);
});

test("a charity with no number needs none unless it is registered", () => {
  assert.deepEqual(organisationProblems({ form: "club", donee: true, irdNumber: "1", signatory: { name: "A B", designation: "Secretary" } }), []);
});

test("the receipt carries every required detail", () => {
  const html = receiptHtml({ name: "Kowhai Tennis Club", address: "2 Totara St" }, np, receipt);
  for (const needle of ["Kowhai Tennis Club", "IRD number: 123-456-789", "CC99999", "Kowhai Smith", "1 Rimu Lane<br>Nelson", "$120.00", "14 August 2026", "DR-0001", "<strong>donation</strong>", "Rimu Totara", "Treasurer"]) {
    assert.ok(html.includes(needle), needle);
  }
  assert.ok(!html.includes('class="mark"'), "an original has no mark");
});

test("copy, replacement and cancelled are marked", () => {
  const org = { name: "Kowhai Tennis Club" };
  assert.match(receiptHtml(org, np, receipt, { copy: true }), /class="mark">COPY/);
  assert.match(receiptHtml(org, np, { ...receipt, replaces: "r0" }, { replacedNumber: "DR-0003" }), /REPLACEMENT for receipt DR-0003/);
  assert.match(receiptHtml(org, np, { ...receipt, voided: { on: "2026-09-01", why: "x" } }), /CANCELLED/);
});

test("an annual receipt says it is the year's total", () => {
  const html = receiptHtml({ name: "Kowhai Tennis Club" }, np, { ...receipt, year: 2027, date: "2027-03-31", amount: 60_000 });
  assert.match(html, /year ended 31 March 2027/);
});

test("names and addresses cannot break the page", () => {
  const html = receiptHtml({ name: "A & B <Club>" }, np, { ...receipt, donor: '<script>alert("x")</script>' });
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("A &amp; B &lt;Club&gt;"));
});

test("totals per donor per tax year leave out cancelled receipts", () => {
  const year = (d) => Number(d.slice(0, 4)) + (Number(d.slice(5, 7)) >= 4 ? 1 : 0);
  const rows = donorYears([
    receipt,
    { ...receipt, id: "r2", number: "DR-0002", date: "2026-11-02", amount: 3_000 },
    { ...receipt, id: "r3", number: "DR-0003", amount: 9_900, voided: { on: "2026-09-01", why: "x" } },
    { ...receipt, id: "r4", number: "DR-0004", donor: "Other Donor", amount: 500, date: "2026-02-01" },
  ], year);
  const smith = rows.find((r) => r.donor === "Kowhai Smith");
  assert.equal(smith.amount, 15_000);
  assert.equal(smith.receipts, 2);
  assert.equal(rows.find((r) => r.donor === "Other Donor").year, 2026);
});

test("under five dollars is flagged, not refused", () => {
  assert.equal(belowCreditMinimum(499), true);
  assert.equal(belowCreditMinimum(500), false);
});
