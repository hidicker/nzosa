import assert from "node:assert/strict";
import test from "node:test";
import { accountEmailFrom, defaultInvoiceMessage, fillWording, invoiceEmail, mailtoLink } from "../dist/index.js";

const invoice = {
  number: "INV-1042", kind: "sales", contact: "Kea Cafe Group", reference: "", issued: "2026-05-01", due: null,
  total: 23000, tax: 3000, paid: 0, outstanding: 23000, currency: "NZD", status: "AUTHORISED", lines: [],
};

test("fill-ins are put in, and a line whose fill-ins are all empty goes", () => {
  const out = fillWording("Hi {customer},\n\nDue: {due}\nOwing: {amount}\n\n\n{note}\n\nBye", { customer: "Ana", due: "", amount: "5.00", note: "" });
  assert.equal(out, "Hi Ana,\r\n\r\nOwing: 5.00\r\n\r\nBye");
});

test("an unknown fill-in is left as written, so a typo shows", () => {
  assert.equal(fillWording("Hi {custmer}", { customer: "Ana" }), "Hi {custmer}");
});

test("the person's own wording is used for an invoice", () => {
  const mail = invoiceEmail(invoice, { name: "Kereru Gliders Ltd", payTo: "02-1100-0022001-000" }, {
    wording: { subject: "{number}: {amount} for {customer}", body: "Kia ora {customer}, {document} {number} is {amount}.\nPay to {payment}.\nDue {due}." },
  });
  assert.equal(mail.subject, "INV-1042: 230.00 for Kea Cafe Group");
  assert.equal(mail.body, "Kia ora Kea Cafe Group, tax invoice INV-1042 is 230.00.\r\nPay to 02-1100-0022001-000.");
});

test("with no reference and no due date, the standard invoice email leaves those lines out", () => {
  const { body } = invoiceEmail(invoice, { name: "Kereru Gliders Ltd" }, { note: "Thanks for the work" });
  assert.doesNotMatch(body, /Due:|Reference:|Payment details:/);
  assert.match(body, /Thanks for the work\r\n\r\nThank you,\r\nKereru Gliders Ltd$/);
});

test("statement and reminder emails", () => {
  const s = accountEmailFrom("statement", "Kea Cafe Group", 45000, "2026-06-30", { name: "Kereru Gliders Ltd", payTo: "02-1100" }, { to: "a@b.example" });
  assert.equal(s.to, "a@b.example");
  assert.equal(s.subject, "Statement from Kereru Gliders Ltd");
  assert.match(s.body, /450\.00 is owing as at 30\/06\/2026\./);
  const r = accountEmailFrom("reminder", "Kea", 1000, "2026-06-30", { name: "Co" }, { dateStyle: "mdy" });
  assert.equal(r.to, "");
  assert.match(r.body, /10\.00 is past due/);
  assert.doesNotMatch(r.body, /Payment details/);
});

test("the default message is the one marked so", () => {
  assert.equal(defaultInvoiceMessage([{ id: "a", name: "A", text: "a" }, { id: "b", name: "B", text: "b", isDefault: true }])?.id, "b");
  assert.equal(defaultInvoiceMessage([{ id: "a", name: "A", text: "a" }]), undefined);
});

test("a mailto link keeps the @ and encodes the rest", () => {
  assert.equal(mailtoLink({ to: "a@b.example", subject: "Hi & bye", body: "x\r\ny" }), "mailto:a@b.example?subject=Hi%20%26%20bye&body=x%0D%0Ay");
});
