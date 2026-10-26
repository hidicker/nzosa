import assert from "node:assert/strict";
import test from "node:test";
import { givingStatementHtml } from "../dist/index.js";

const taxYearOf = (d) => (d.slice(5) >= "04-01" ? Number(d.slice(0, 4)) + 1 : Number(d.slice(0, 4)));
const receipt = (over) => ({
  id: "r", entityId: "e", number: "DR-0001", date: "2026-05-01", amount: 5000, donor: "Ana Kowhai", issued: "2026-05-02",
  signedBy: "Treasurer", designation: "Treasurer", ...over,
});

test("a donor's year: each standing receipt, the total, and that it is not a receipt", () => {
  const receipts = [
    receipt({ id: "1", number: "DR-0001", date: "2026-05-01", amount: 5000 }),
    receipt({ id: "2", number: "DR-0004", date: "2026-11-20", amount: 2500, donor: "ana kowhai " }),
    receipt({ id: "3", number: "DR-0005", date: "2026-12-01", amount: 9900, voided: { on: "2026-12-02", why: "wrong" } }),
    receipt({ id: "4", number: "DR-0007", date: "2027-05-01", amount: 1000 }),
    receipt({ id: "5", number: "DR-0002", date: "2026-06-01", amount: 7000, donor: "Rata Trust" }),
  ];
  const html = givingStatementHtml({ name: "Kereru Club" }, { irdNumber: "123-456-789" }, "Ana Kowhai", 2027, receipts, taxYearOf);
  assert.ok(html.includes("DR-0001") && html.includes("DR-0004"));
  assert.ok(!html.includes("DR-0005"), "voided left out");
  assert.ok(!html.includes("DR-0007"), "another year left out");
  assert.ok(!html.includes("DR-0002"), "another donor left out");
  assert.ok(html.includes("$75.00"));
  assert.ok(html.includes("not a receipt"));
  assert.ok(html.includes("1 April 2026 to 31 March 2027"));
});
