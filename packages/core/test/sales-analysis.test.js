import assert from "node:assert/strict";
import test from "node:test";
import { salesByCustomer, salesByItem } from "../dist/index.js";

const line = (description, net, quantity, itemCode) => ({
  description, accountCode: "200", taxType: "15% GST on Income", net, tax: Math.round(net * 0.15), gross: net + Math.round(net * 0.15),
  ...(quantity !== undefined ? { quantity } : {}), ...(itemCode !== undefined ? { itemCode } : {}),
});
const invoice = (number, contact, issued, lines, over = {}) => {
  const total = lines.reduce((s, l) => s + l.gross, 0);
  const tax = lines.reduce((s, l) => s + l.tax, 0);
  return { number, kind: "sales", contact, reference: "", issued, due: null, total, tax, paid: 0, outstanding: total, currency: "NZD", status: "Awaiting Payment", lines, ...over };
};
const credit = (number, contact, issued, lines) => {
  const neg = lines.map((l) => ({ ...l, net: -l.net, tax: -l.tax, gross: -l.gross }));
  return invoice(number, contact, issued, neg);
};

const BOOKS = [
  invoice("1", "Kea Cafe", "2026-04-02", [line("Coffee beans", 10_000, 4, "BEANS"), line("Delivery", 1_000)]),
  invoice("2", "kea  cafe", "2026-05-02", [line("Coffee beans", 5_000, 2, "BEANS")]),
  invoice("3", "Tui Bakery", "2026-05-10", [line("Grinder", 40_000, 1)]),
  credit("CN-1", "Kea Cafe", "2026-05-20", [line("Coffee beans", 2_500, 1, "BEANS")]),
  invoice("4", "Tui Bakery", "2026-07-01", [line("Grinder", 40_000, 1)]),
  invoice("5", "Draft Co", "2026-05-01", [line("x", 9_999)], { status: "Draft" }),
  invoice("6", "Quote Co", "2026-05-01", [line("x", 9_999)], { status: "Estimate" }),
  { ...invoice("B1", "Supplier", "2026-05-01", [line("x", 5_000)]), kind: "purchase" },
];
const MAY_JUN = { from: "2026-04-01", to: "2026-06-30" };

test("by customer: one row a customer, typed two ways or not, credit notes taken off", () => {
  const out = salesByCustomer(BOOKS, MAY_JUN);
  assert.deepEqual(out.rows.map((r) => [r.name, r.count, r.net]), [
    ["Tui Bakery", 1, 40_000],
    ["Kea Cafe", 3, 10_000 + 1_000 + 5_000 - 2_500],
  ]);
  assert.equal(out.total.net, 53_500);
  assert.equal(out.total.gross, out.total.net + out.total.tax);
  assert.equal(out.invoices, 4);
});

test("drafts, estimates, bills and invoices outside the period are left out", () => {
  const names = salesByCustomer(BOOKS, MAY_JUN).rows.map((r) => r.name);
  assert.ok(!names.includes("Draft Co") && !names.includes("Quote Co") && !names.includes("Supplier"));
  assert.equal(salesByCustomer(BOOKS, { from: "2026-07-01", to: "2026-07-31" }).total.net, 40_000);
});

test("by item: the code where there is one, else the description; quantities net of credit notes", () => {
  const out = salesByItem(BOOKS, MAY_JUN);
  const beans = out.rows.find((r) => r.name === "BEANS");
  assert.equal(beans.net, 12_500);
  assert.equal(beans.quantity, 5);
  assert.equal(out.rows.find((r) => r.name === "Delivery").quantity, undefined);
  assert.equal(out.rows[0].name, "Grinder");
  assert.equal(out.total.net, salesByCustomer(BOOKS, MAY_JUN).total.net);
});

test("one entity's sales only, when asked", () => {
  const books = [invoice("1", "A", "2026-05-01", [line("x", 100)], { entityId: "shop" }), invoice("2", "B", "2026-05-01", [line("x", 200)], { entityId: "farm" })];
  assert.deepEqual(salesByCustomer(books, MAY_JUN, "farm").rows.map((r) => r.name), ["B"]);
});
