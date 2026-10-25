import assert from "node:assert/strict";
import test from "node:test";
import { duplicateInvoice } from "../dist/index.js";

const original = {
  number: "INV-1014",
  kind: "sales",
  contact: "Harbour Cafe",
  reference: "PO 88",
  issued: "2026-03-01",
  due: "2026-03-31",
  total: 126_500,
  tax: 16_500,
  paid: 50_000,
  outstanding: 76_500,
  currency: "NZD",
  status: "Part paid",
  lines: [{ description: "Coffee", accountCode: "200", taxType: "15% GST on Income", net: 110_000, tax: 16_500, gross: 126_500, quantity: 1 }],
  entityId: "kea",
  email: "cafe@example.com",
  paidOutside: [{ date: "2026-03-10", amount: 50_000, account: "800" }],
  broughtForward: 76_500,
  documentLink: "https://example.com/inv.pdf",
};

test("a copy keeps who, what and the terms, and starts fresh from today", () => {
  const copy = duplicateInvoice(original, "INV-1016", "2026-10-25");
  assert.equal(copy.number, "INV-1016");
  assert.equal(copy.contact, "Harbour Cafe");
  assert.equal(copy.reference, "PO 88");
  assert.equal(copy.entityId, "kea");
  assert.equal(copy.email, "cafe@example.com");
  assert.equal(copy.issued, "2026-10-25");
  assert.equal(copy.due, "2026-11-24", "thirty days after, as the original was");
  assert.equal(copy.paid, 0);
  assert.equal(copy.outstanding, 126_500);
  assert.equal(copy.status, "Awaiting Payment");
  assert.equal("paidOutside" in copy, false);
  assert.equal("broughtForward" in copy, false);
  assert.equal("documentLink" in copy, false);
});

test("the copy's lines are its own: changing them leaves the original alone", () => {
  const copy = duplicateInvoice(original, "INV-1016", "2026-10-25");
  copy.lines[0].description = "Tea";
  assert.equal(original.lines[0].description, "Coffee");
});

test("a bill comes out a draft, an estimate stays an estimate, no due date stays none", () => {
  assert.equal(duplicateInvoice({ ...original, kind: "purchase" }, "B-2", "2026-10-25").status, "Draft");
  assert.equal(duplicateInvoice({ ...original, status: "Estimate" }, "E-2", "2026-10-25").status, "Estimate");
  assert.equal(duplicateInvoice({ ...original, due: null }, "I-2", "2026-10-25").due, null);
});
