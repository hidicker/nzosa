import assert from "node:assert/strict";
import test from "node:test";
import { emailForContact, invoiceDocument, invoiceEmail } from "../dist/index.js";

const line = (over) => ({
  description: "Tandem flight", accountCode: "200", taxType: "15% GST on Income",
  net: 20000, tax: 3000, gross: 23000, ...over,
});

const invoice = (over) => ({
  number: "INV-1042", kind: "sales", contact: "Kea Cafe Group", reference: "PO 88",
  issued: "2026-05-01", due: "2026-05-31", total: 23000, tax: 3000, paid: 0,
  outstanding: 23000, currency: "NZD", status: "AUTHORISED", lines: [line()], ...over,
});

const supplier = {
  name: "Kereru Gliders Ltd",
  address: "12 Sample Street\nNelson 7010",
  gstNumber: "123-456-789",
  payTo: "02-1100-0022001-000",
};

test("the document carries what a customer needs to pay it", () => {
  const html = invoiceDocument(invoice(), supplier);
  for (const wanted of [
    "Kereru Gliders Ltd", "12 Sample Street", "GST 123-456-789",
    "Kea Cafe Group", "INV-1042", "01/05/2026", "31/05/2026", "PO 88",
    "Tandem flight", "02-1100-0022001-000", "230.00", "30.00", "200.00",
  ]) {
    assert.ok(html.includes(wanted), `missing ${wanted}`);
  }
});

test("a supplier with no GST number issues an invoice, not a tax invoice", () => {
  // Calling it a tax invoice when no GST was charged says the customer can
  // claim something they cannot.
  const html = invoiceDocument(
    invoice({ tax: 0, total: 20000, outstanding: 20000, lines: [line({ tax: 0, gross: 20000 })] }),
    { name: "Sole Trader" },
  );
  assert.ok(html.includes("<h1>Invoice</h1>"), "should be a plain invoice");
  assert.equal(html.includes("Tax invoice"), false);
  assert.equal(html.includes("GST 1"), false);
});

test("a part-paid invoice shows what is still owed", () => {
  const html = invoiceDocument(
    invoice({ paid: 10000, outstanding: 13000 }),
    supplier,
  );
  assert.ok(html.includes("Already paid"));
  assert.ok(html.includes("Amount due"));
  assert.ok(html.includes("-100.00"), "the payment should read as a deduction");
  assert.ok(html.includes("130.00"));
});

test("lines that do not come to the invoice total are flagged, not corrected", () => {
  // An imported invoice says what the other system said. Quietly recomputing
  // would send the customer a different figure from the one in the books.
  const html = invoiceDocument(invoice({ total: 25000, outstanding: 25000 }), supplier);
  assert.match(html, /lines come to 230.00 and the invoice total is recorded as 250.00/);
  assert.ok(html.includes("250.00"), "the recorded total is what is billed");
});

test("nothing a customer typed can become markup", () => {
  const nasty = '<script>alert(1)</script> & "quoted"';
  const html = invoiceDocument(
    invoice({ contact: nasty, lines: [line({ description: nasty })] }),
    { ...supplier, name: nasty },
  );
  assert.equal(html.includes("<script>"), false);
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("&amp;"));
});

test("an address keeps the lines it was written on", () => {
  const html = invoiceDocument(invoice(), supplier);
  assert.ok(html.includes("12 Sample Street<br>Nelson 7010"));
});

test("no due date means no due line", () => {
  const html = invoiceDocument(invoice({ due: null }), supplier);
  assert.equal(html.includes("Due</span>"), false);
});

test("it is one file, with its styles inside it", () => {
  const html = invoiceDocument(invoice(), supplier);
  assert.equal(/<link|<img|src=/.test(html), false, "nothing to fetch from elsewhere");
  assert.ok(html.startsWith("<!doctype html>"));
});

test("the email names the invoice, what is owing and how to pay", () => {
  const { subject, body } = invoiceEmail(invoice({ paid: 5000, outstanding: 18000 }), supplier);
  assert.equal(subject, "Tax invoice INV-1042 from Kereru Gliders Ltd");
  for (const wanted of ["INV-1042", "180.00", "31/05/2026", "PO 88", "02-1100-0022001-000", "Kereru Gliders Ltd"]) {
    assert.ok(body.includes(wanted), `missing ${wanted}`);
  }
  assert.ok(!body.includes("230.00"));
});

test("the email is addressed to the customer's saved address, and only a real one", () => {
  assert.equal(invoiceEmail(invoice({ email: " accounts@kea.example " }), supplier).to, "accounts@kea.example");
  assert.equal(invoiceEmail(invoice({ email: "not an address" }), supplier).to, "");
  assert.equal(invoiceEmail(invoice(), supplier).to, "");
});

test("a customer's address is remembered by name, newest first", () => {
  const books = [
    invoice({ number: "A", issued: "2026-01-01", email: "old@kea.example" }),
    invoice({ number: "B", issued: "2026-03-01", contact: " kea  cafe group", email: "new@kea.example" }),
    invoice({ number: "C", issued: "2026-04-01" }),
    invoice({ number: "D", issued: "2026-05-01", contact: "Other", email: "other@x.example" }),
    invoice({ number: "E", issued: "2026-06-01", kind: "purchase", email: "bill@kea.example" }),
  ];
  assert.equal(emailForContact(books, "Kea Cafe Group"), "new@kea.example");
  assert.equal(emailForContact(books, "Nobody"), null);
  assert.equal(emailForContact(books, ""), null);
});

test("an unregistered supplier's email says invoice, not tax invoice", () => {
  const { subject } = invoiceEmail(invoice({ tax: 0 }), { name: "Sole Trader" });
  assert.equal(subject, "Invoice INV-1042 from Sole Trader");
});
