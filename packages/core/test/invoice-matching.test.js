import assert from "node:assert/strict";
import test from "node:test";
import { matchInvoices } from "../dist/invoice-matching.js";

const invoice = (extra = {}) => ({
  number: "INV-0001",
  kind: "sales",
  contact: "A Customer",
  reference: "",
  issued: "2025-06-01",
  due: null,
  total: 115000,
  tax: 15000,
  paid: 0,
  outstanding: 115000,
  currency: "NZD",
  status: "Awaiting Payment",
  lines: [
    {
      description: "Work",
      accountCode: "200",
      taxType: "15% GST on Income",
      net: 100000,
      tax: 15000,
      gross: 115000,
    },
  ],
  ...extra,
});

const receipt = (extra = {}) => ({
  id: "t1",
  date: "2025-06-10",
  amount: 115000,
  currency: "NZD",
  account: "bank-01",
  serial: "",
  trn: "",
  particulars: "",
  code: "",
  reference: "",
  otherParty: "A Customer",
  origin: "",
  type: "",
  batch: "",
  otherPartyAccount: "",
  ...extra,
});

test("an invoice with nothing paid is still listed, not dropped", () => {
  // It cannot be matched -- there is no money to match it to -- but an invoice
  // awaiting payment, or one just written by hand, has to be visible.
  const result = matchInvoices({ invoices: [invoice()], transactions: [] });

  assert.equal(result.matched.length, 0);
  assert.equal(result.unmatched.length, 1);
  assert.equal(result.unmatched[0]?.number, "INV-0001");
});

test("every invoice reaches exactly one bucket", () => {
  const invoices = [
    invoice({ number: "INV-0001" }),
    invoice({ number: "INV-0002", paid: 115000, outstanding: 0 }),
    invoice({ number: "INV-0003", total: -15000, paid: 0, outstanding: -15000 }),
  ];
  const result = matchInvoices({
    invoices,
    transactions: [receipt({ id: "t2", reference: "INV-0002" })],
  });

  const seen = [
    ...result.matched.map((m) => m.invoice.number),
    ...result.unmatched.map((i) => i.number),
  ];
  assert.equal(seen.length, invoices.length, "no invoice is silently dropped");
  assert.deepEqual([...seen].sort(), ["INV-0001", "INV-0002", "INV-0003"]);
});

test("a receipt naming the invoice settles it outright", () => {
  const result = matchInvoices({
    invoices: [invoice({ paid: 115000, outstanding: 0 })],
    transactions: [receipt({ reference: "INV-0001" })],
  });

  assert.equal(result.matched.length, 1);
  assert.equal(result.matched[0]?.how, "reference");
  assert.equal(result.unmatched.length, 0);
});
