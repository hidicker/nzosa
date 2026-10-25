import assert from "node:assert/strict";
import test from "node:test";
import { formatUnitPrice, lineAmount, parseQuantity, parseUnitPrice } from "../dist/index.js";

test("quantities and prices to four decimal places, and no more", () => {
  assert.equal(parseQuantity("2.5"), 2.5);
  assert.equal(parseQuantity("0.0001"), 0.0001);
  assert.equal(parseQuantity("1,000"), 1000);
  assert.equal(parseQuantity("1.23456"), null);
  assert.equal(parseQuantity("abc"), null);
  assert.equal(parseQuantity(""), null);
  assert.equal(parseUnitPrice("$1.2345"), 12_345);
  assert.equal(parseUnitPrice("15"), 150_000);
  assert.equal(parseUnitPrice("0.5"), 5_000);
  assert.equal(parseUnitPrice("."), null);
});

test("a price is written with two places, or as many as it needs up to four", () => {
  assert.equal(formatUnitPrice(150_000), "15.00");
  assert.equal(formatUnitPrice(12_345), "1.2345");
  assert.equal(formatUnitPrice(12_340), "1.234");
  assert.equal(formatUnitPrice(5_000), "0.50");
});

test("what a line comes to, in whole numbers and rounded to the cent", () => {
  assert.equal(lineAmount(3, 3_333), 100, "3 x 0.3333 is 1.00");
  assert.equal(lineAmount(2.5, 12_345), 309, "2.5 x 1.2345 = 3.08625, so 3.09");
  assert.equal(lineAmount(1_000, 1), 10, "a thousand at 0.0001");
  assert.equal(lineAmount(0.0001, 10_000), 0);
  assert.equal(lineAmount(1.5, 50), 1, "0.0075 rounds half up to a cent");
  assert.equal(lineAmount(12, 199_990), 23_999, "12 x 19.999 = 239.988, so 239.99");
});

import { invoiceDocument } from "../dist/index.js";

test("an invoice with a priced line shows a Price column, and its totals still line up", () => {
  const line = { description: "Beans", accountCode: "200", taxType: "15% GST on Income", net: 268, tax: 41, gross: 309, quantity: 2.5, unitPrice: 12_345 };
  const html = invoiceDocument(
    { number: "I-1", kind: "sales", contact: "Kea", reference: "", issued: "2026-05-01", due: null, total: 309, tax: 41, paid: 0, outstanding: 309, currency: "NZD", status: "AUTHORISED", lines: [line] },
    { name: "Co", gstNumber: "123-456-789" },
  );
  assert.match(html, /<th class="n">Price<\/th>/);
  assert.match(html, /<td class="n">2\.5<\/td><td class="n">1\.2345<\/td>/);
  assert.match(html, /<td colspan="5" class="n">Subtotal/);
  const plain = invoiceDocument(
    { number: "I-2", kind: "sales", contact: "Kea", reference: "", issued: "2026-05-01", due: null, total: 309, tax: 41, paid: 0, outstanding: 309, currency: "NZD", status: "AUTHORISED", lines: [{ ...line, unitPrice: undefined }] },
    { name: "Co", gstNumber: "123-456-789" },
  );
  assert.doesNotMatch(plain, />Price</);
  assert.match(plain, /<td colspan="4" class="n">Subtotal/);
});
