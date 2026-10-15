import { test } from "node:test";
import assert from "node:assert/strict";
import { applyDueDates, identifyExport, isDueDateList, isProductList, parseDueDates, parseProductList } from "../dist/index.js";

// SlowBooks Pro's items, invoices and bills CSV exports.
const ITEMS = [
  "ID,Name,Type,Description,Rate,Cost,Taxable",
  "1,Design hour,service,Garden design,95.00,,N",
  "2,Garden gnome,inventory,Painted gnome,25.00,9.50,Y",
  "3,Mulch bag,non-inventory,,12.00,6.00,Y",
].join("\n");
const INVOICES = [
  "Invoice #,Customer,Date,Due Date,Status,Subtotal,Tax,Total,Paid,Balance",
  "1001,Acme Co,2026-03-02,2026-04-01,partial,1200.00,0.00,1200.00,500.00,700.00",
  "1002,Beta LLC,2026-03-10,2026-04-09,sent,800.00,0.00,800.00,0.00,800.00",
].join("\n");
const BILLS = [
  "Bill #,Vendor,Date,Due,Terms,Status,Class,Job,Total,Paid,Balance",
  "HH-7,Hicks Hardware,2026-03-12,2026-04-11,Net 30,unpaid,,,450.00,0.00,450.00",
].join("\n");

test("a products and services list", () => {
  assert.equal(isProductList(ITEMS), true);
  assert.equal(identifyExport(ITEMS).kind, "product-list");
  assert.deepEqual(
    parseProductList(ITEMS).map((p) => [p.item.name, p.item.kind, p.item.price, p.item.unitCost, p.onHand]),
    [
      ["Design hour", "service", 9500, undefined, undefined],
      ["Garden gnome", "product", 2500, 950, undefined],
      ["Mulch bag", "product", 1200, undefined, undefined],
    ],
  );
});

test("due dates from invoice and bill lists, filled in where a document has none", () => {
  assert.equal(isDueDateList(INVOICES), true);
  assert.equal(identifyExport(INVOICES).kind, "due-dates");
  const dates = [...parseDueDates(INVOICES), ...parseDueDates(BILLS)];
  assert.deepEqual(dates.map((d) => [d.kind, d.number, d.due]), [
    ["sales", "1001", "2026-04-01"],
    ["sales", "1002", "2026-04-09"],
    ["purchase", "HH-7", "2026-04-11"],
  ]);
  const doc = (kind, number, contact, due = null) => ({ kind, number, contact, due, issued: "2026-03-01", lines: [] });
  const { invoices, filled } = applyDueDates(
    [doc("sales", "1001", "Acme Co"), doc("sales", "1002", "Someone else"), doc("purchase", "HH-7", "Hicks Hardware", "2026-05-01")],
    dates,
  );
  assert.equal(filled, 2);
  assert.deepEqual(invoices.map((i) => i.due), ["2026-04-01", "2026-04-09", "2026-05-01"]);
});

test("a bill with no number is found by vendor, date and amount, as QuickBooks' A/P aging gives it", () => {
  const AGING = [
    "Craig's Design,,,,,,,",
    "A/P Aging Detail Report,,,,,,,",
    "",
    ",Date,Transaction type,Num,Vendor display name,Due date,Past due,Amount,Open balance",
    ",08/04/2026,Bill,,PG&E,09/03/2026,42,86.44,86.44",
  ].join("\n");
  const dates = parseDueDates(AGING, false);
  assert.deepEqual(dates.map((d) => [d.kind, d.number, d.contact, d.issued, d.amount, d.due]), [
    ["purchase", "", "PG&E", "2026-08-04", 8644, "2026-09-03"],
  ]);
  const bill = (number, issued, total) => ({ kind: "purchase", number, contact: "PG&E", issued, total, due: null, lines: [] });
  const { invoices } = applyDueDates([bill("BILL-1", "2026-08-04", 8644), bill("BILL-2", "2026-09-02", 11409)], dates);
  assert.deepEqual(invoices.map((i) => i.due), ["2026-09-03", null]);
});
