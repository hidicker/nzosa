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
