import { test } from "node:test";
import assert from "node:assert/strict";
import { givingStatementHtml } from "../dist/index.js";

const org = { name: "Kowhai Tennis Club", address: "1 Court Road" };
const np = { irdNumber: "123-456-789", registeredCharity: true, charityNumber: "CC12345" };
const taxYearOf = (d) => (d.slice(5) <= "03-31" ? Number(d.slice(0, 4)) : Number(d.slice(0, 4)) + 1);
const receipts = [
  { id: "1", entityId: "e", number: "R-1", date: "2025-05-01", amount: 5000, donor: "Ana Smith", issued: "2025-05-01", signedBy: "T", designation: "Treasurer" },
  { id: "2", entityId: "e", number: "R-2", date: "2025-09-10", amount: 2500, donor: "ana smith ", address: "3 Rata St", issued: "2025-09-10", signedBy: "T", designation: "Treasurer" },
  { id: "3", entityId: "e", number: "R-3", date: "2025-10-01", amount: 9900, donor: "Ana Smith", issued: "2025-10-01", signedBy: "T", designation: "Treasurer", voided: { on: "2025-10-02", why: "wrong" } },
  { id: "4", entityId: "e", number: "R-4", date: "2026-04-02", amount: 1000, donor: "Ana Smith", issued: "2026-04-02", signedBy: "T", designation: "Treasurer" },
  { id: "5", entityId: "e", number: "R-5", date: "2025-12-24", amount: 20000, donor: "Ben <Jones>", issued: "2025-12-24", signedBy: "T", designation: "Treasurer" },
];

test("one donor's year: each standing receipt, in date order, and the total; voided and other years left out", () => {
  const html = givingStatementHtml(org, np, receipts, 2026, taxYearOf, ["Ana Smith"]);
  assert.equal((html.match(/<section>/g) ?? []).length, 1);
  assert.match(html, /R-1[\s\S]*R-2/);
  assert.doesNotMatch(html, /R-3|R-4|R-5/);
  assert.match(html, /Total<\/td><td><\/td><td class="num">\$75\.00/);
  assert.match(html, /3 Rata St/);
  assert.match(html, /CC12345/);
});

test("every donor, one to a page, names escaped", () => {
  const html = givingStatementHtml(org, np, receipts, 2026, taxYearOf);
  assert.equal((html.match(/<section>/g) ?? []).length, 2);
  assert.match(html, /Ben &lt;Jones&gt;/);
  assert.doesNotMatch(html, /<Jones>/);
});
