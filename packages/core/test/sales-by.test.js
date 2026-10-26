import { test } from "node:test";
import assert from "node:assert/strict";
import { salesBy } from "../dist/index.js";

const line = (net, extra = {}) => ({ description: "Coffee", accountCode: "200", taxType: "15% GST on Income", net, tax: Math.round(net * 0.15), gross: net + Math.round(net * 0.15), ...extra });
const doc = (number, contact, issued, lines, extra = {}) => ({ number, kind: "sales", contact, reference: "", issued, due: null, total: lines.reduce((s, l) => s + l.gross, 0), paid: 0, outstanding: 0, status: "", lines, ...extra });

const invoices = [
  doc("INV-1", "Harbour Cafe", "2026-05-01", [line(10_000, { itemCode: "beans", quantity: 5 }), line(2_000, { description: "Delivery" })]),
  doc("INV-2", "harbour cafe ", "2026-06-01", [line(4_000, { itemCode: "beans", quantity: 2 })]),
  doc("INV-3", "The Roastery Bar", "2026-06-15", [line(30_000, { itemCode: "beans", quantity: 15 })]),
  doc("CN-1", "The Roastery Bar", "2026-06-20", [line(-2_000, { itemCode: "beans", quantity: 1 })], { total: -2_300 }),
  doc("INV-4", "Harbour Cafe", "2026-08-01", [line(99_000)]),
  doc("INV-5", "Draft Co", "2026-06-01", [line(5_000)], { status: "Draft" }),
  { ...doc("BILL-1", "Bean Co", "2026-06-01", [line(7_000)]), kind: "purchase" },
];
const period = { from: "2026-04-01", to: "2026-07-31" };

test("income by customer: one name however it is written, credit notes off, drafts and bills not in", () => {
  const r = salesBy(invoices, period, "customer");
  assert.deepEqual(r.rows.map((x) => [x.name, x.count, x.net]), [["The Roastery Bar", 2, 28_000], ["Harbour Cafe", 2, 16_000]]);
  assert.equal(r.net, 44_000);
  assert.equal(r.tax, 6_600);
});

test("sales by item: by product, or by the line's words where no product is named", () => {
  const r = salesBy(invoices, period, "item", (code) => (code === "beans" ? "Beans 1kg" : undefined));
  assert.deepEqual(r.rows.map((x) => [x.name, x.quantity, x.net]), [["Beans 1kg", 21, 42_000], ["Delivery", 0, 2_000]]);
});
