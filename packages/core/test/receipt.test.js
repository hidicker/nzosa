import assert from "node:assert/strict";
import test from "node:test";
import { invoiceDocument, invoiceEmail, RECEIPT_METHODS, WALK_IN_CUSTOMER } from "../dist/index.js";

const sale = (over = {}) => ({
  number: "INV-1042", kind: "sales", contact: WALK_IN_CUSTOMER, reference: "", issued: "2026-05-01", due: "2026-05-01",
  total: 2300, tax: 300, paid: 0, outstanding: 2300, currency: "NZD", status: "Awaiting Payment",
  lines: [{ description: "Flat white", accountCode: "200", taxType: "15% GST on Income", net: 2000, tax: 300, gross: 2300 }],
  receipt: { paidOn: "2026-05-01", method: "EFTPOS" },
  ...over,
});

test("a sale paid on the spot is a receipt, and a registered supplier's says it is the tax invoice too", () => {
  const html = invoiceDocument(sale(), { name: "Kea Coffee", gstNumber: "123-456-789" });
  assert.match(html, /<h1>Tax invoice \/ receipt<\/h1>/);
  assert.match(html, /Paid in full on 01\/05\/2026, EFTPOS<\/td><td class="n">23\.00/);
  assert.doesNotMatch(html, /Total due|Amount due/);
  const plain = invoiceDocument(sale({ tax: 0, lines: [{ description: "x", accountCode: "200", taxType: "No GST", net: 2300, tax: 0, gross: 2300 }] }), { name: "Sole Trader" });
  assert.match(plain, /<h1>Receipt<\/h1>/);
});

test("a receipt's email thanks them and asks for nothing", () => {
  const mail = invoiceEmail(sale(), { name: "Kea Coffee", gstNumber: "123-456-789", payTo: "12-3456" }, { wording: { subject: "PAY NOW {number}", body: "Pay {amount}" } });
  assert.equal(mail.subject, "Tax invoice / receipt INV-1042 from Kea Coffee");
  assert.match(mail.body, /Thank you for your payment of 23\.00/);
  assert.doesNotMatch(mail.body, /PAY|Payment details/);
});

test("an ordinary invoice is unchanged", () => {
  const { receipt: _r, ...invoice } = sale({ contact: "Kea Cafe" });
  assert.match(invoiceDocument(invoice, { name: "Kea Coffee", gstNumber: "1" }), /<h1>Tax invoice<\/h1>[\s\S]*Total due/);
  assert.ok(RECEIPT_METHODS.includes("Cash"));
});
