import assert from "node:assert/strict";
import test from "node:test";
import { invoiceBalances } from "../dist/invoices.js";

const invoice = (number, total, extra = {}) => ({
  number,
  kind: "sales",
  contact: "A Customer",
  reference: "",
  issued: "2025-06-01",
  due: null,
  total,
  tax: Math.round((total * 3) / 23),
  paid: 0,
  outstanding: total,
  currency: "NZD",
  status: "AUTHORISED",
  lines: [],
  ...extra,
});

test("an invoice with nothing assigned is owed in full", () => {
  const balances = invoiceBalances([invoice("INV-1", 100000)], []);
  const b = balances.get("INV-1");
  assert.equal(b.assigned, 0);
  assert.equal(b.remaining, 100000);
  assert.equal(b.status, "unpaid");
});

test("a part payment reduces what is owed", () => {
  const balances = invoiceBalances(
    [invoice("INV-1", 100000)],
    [{ invoiceNumber: "INV-1", amount: 40000 }],
  );
  const b = balances.get("INV-1");
  assert.equal(b.assigned, 40000);
  assert.equal(b.remaining, 60000);
  assert.equal(b.status, "part paid");
});

test("several part payments settle it between them", () => {
  const balances = invoiceBalances(
    [invoice("INV-1", 100000)],
    [
      { invoiceNumber: "INV-1", amount: 40000 },
      { invoiceNumber: "INV-1", amount: 35000 },
      { invoiceNumber: "INV-1", amount: 25000 },
    ],
  );
  const b = balances.get("INV-1");
  assert.equal(b.assigned, 100000);
  assert.equal(b.remaining, 0);
  assert.equal(b.status, "paid");
});

test("a bill is settled by money going out, not coming in", () => {
  // The bank signs a payment negative. An invoice is owed in one direction, so
  // the magnitude is what reduces it -- otherwise paying a bill would increase
  // what was owed on it.
  const bill = invoice("BILL-1", 50000, { kind: "purchase" });
  const balances = invoiceBalances([bill], [{ invoiceNumber: "BILL-1", amount: -50000 }]);
  const b = balances.get("BILL-1");
  assert.equal(b.assigned, 50000);
  assert.equal(b.remaining, 0);
  assert.equal(b.status, "paid");
});

test("more arriving than was billed is called out rather than clamped", () => {
  const balances = invoiceBalances(
    [invoice("INV-1", 100000)],
    [{ invoiceNumber: "INV-1", amount: 120000 }],
  );
  const b = balances.get("INV-1");
  assert.equal(b.remaining, -20000);
  assert.equal(b.status, "overpaid");
});

test("what the file believed is kept beside our figure, not merged into it", () => {
  // The file calls it settled; we have found no receipt for it. Both are shown:
  // the difference is a receipt still to be found, which is worth knowing.
  const settledPerFile = invoice("INV-9", 100000, { paid: 100000, outstanding: 0 });
  const balances = invoiceBalances([settledPerFile], []);
  const b = balances.get("INV-9");
  assert.equal(b.remaining, 100000);
  assert.equal(b.status, "unpaid");
  assert.equal(b.fileRemaining, 0);
});

test("an invoice raised here has no file opinion to show", () => {
  const raisedHere = invoice("INV-NEW", 100000, { paid: 0, outstanding: 0 });
  const b = invoiceBalances([raisedHere], []).get("INV-NEW");
  assert.equal(b.fileRemaining, null);
});

test("assignments naming an invoice that is not there are ignored", () => {
  const balances = invoiceBalances(
    [invoice("INV-1", 100000)],
    [{ invoiceNumber: "GONE", amount: 5000 }],
  );
  assert.equal(balances.size, 1);
  assert.equal(balances.get("INV-1").remaining, 100000);
});

test("a refused line does not reduce what is owed", () => {
  // The app records "this is not an invoice payment" as an empty number, and
  // strips those before they reach here. If one ever leaks through it must not
  // be counted against an invoice: the balance would silently drop by a
  // payment somebody had explicitly said was nothing to do with it.
  const balances = invoiceBalances(
    [invoice("INV-1", 100000)],
    [{ invoiceNumber: "", amount: 40000 }],
  );
  assert.equal(balances.get("INV-1").remaining, 100000);
  assert.equal(balances.get("INV-1").status, "unpaid");
});
