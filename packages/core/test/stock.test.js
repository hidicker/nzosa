import { test } from "node:test";
import assert from "node:assert/strict";
import { stockAdjustment, stockValue, trackStock } from "../dist/index.js";

test("a count is valued at each product's unit cost", () => {
  assert.equal(stockValue({ lines: [{ itemId: "a", quantity: 12, unitCost: 450 }, { itemId: "b", quantity: 2.5, unitCost: 1999 }] }), 5400 + 4998);
});

test("the inventory account goes to the count, the difference to cost of sales", () => {
  assert.deepEqual(stockAdjustment(100000, 80000, "Inventory - 1300", "Cost of Goods Sold - 5000").map((l) => [l.code, l.amount]), [
    ["Inventory - 1300", 20000],
    ["Cost of Goods Sold - 5000", -20000],
  ]);
  assert.deepEqual(stockAdjustment(50000, 80000, "I", "C").map((l) => l.amount), [-30000, 30000]);
  assert.deepEqual(stockAdjustment(5, 5, "I", "C"), []);
});

test("line by line: bought at cost, sold at the average, put back on a return, reset by a count", () => {
  const items = [
    { id: "gnome", name: "Garden gnome", kind: "product", unitCost: 900 },
    { id: "hour", name: "Design hour", kind: "service" },
  ];
  const line = (itemCode, quantity, net) => ({ itemCode, quantity, net, description: "" });
  const docs = [
    { number: "B1", kind: "purchase", issued: "2026-03-01", credit: false, lines: [line("gnome", 10, 9000)] },
    { number: "B2", kind: "purchase", issued: "2026-03-05", credit: false, lines: [line("Garden gnome", 10, 11000)] },
    { number: "INV-1", kind: "sales", issued: "2026-03-10", credit: false, lines: [line("gnome", 4, 10000), line("hour", 2, 19000)] },
    { number: "CN-1", kind: "sales", issued: "2026-03-12", credit: true, lines: [line("gnome", 1, 2500)] },
    { number: "INV-2", kind: "sales", issued: "2026-03-20", credit: false, lines: [line("gnome", 2, 5000)] },
  ];
  const { onHand, costs } = trackStock(items, docs, []);
  // 20 bought for 200.00, average 10.00: 4 out (40.00), 1 back (10.00), 2 out (20.00).
  assert.deepEqual(costs.map((c) => [c.transactionId, c.cost]), [
    ["INV-1:cost", 4000],
    ["CN-1:cost", -1000],
    ["INV-2:cost", 2000],
  ]);
  assert.deepEqual(onHand.get("gnome"), { quantity: 15, value: 15000 });
  assert.equal(onHand.has("hour"), false);

  const counted = trackStock(items, docs, [{ id: "c", date: "2026-03-15", lines: [{ itemId: "gnome", quantity: 16, unitCost: 1000 }] }]);
  assert.deepEqual(counted.onHand.get("gnome"), { quantity: 14, value: 14000 });
});

test("the lines with an amount and no account", async () => {
  const { linesWithoutAccount } = await import("../dist/index.js");
  const line = (accountCode, gross) => ({ description: "", accountCode, taxType: "No GST", net: gross, tax: 0, gross });
  assert.deepEqual(
    linesWithoutAccount({ lines: [line("200", 500), line("", 300), line(" ", 0), line("  ", 20)] }).map((l) => l.gross),
    [300, 20],
  );
});

test("each item's movements say what changed, why, and where it left the stock", async () => {
  const { stockValuation } = await import("../dist/index.js");
  const items = [
    { id: "gnome", name: "Garden gnome", kind: "product", unitCost: 900, reorderPoint: 15 },
    { id: "pot", name: "Pot", kind: "product", unitCost: 300, reorderPoint: 2 },
    { id: "hour", name: "Design hour", kind: "service" },
  ];
  const line = (itemCode, quantity, net) => ({ itemCode, quantity, net, description: "" });
  const docs = [
    { number: "B1", kind: "purchase", issued: "2026-03-01", credit: false, lines: [line("gnome", 10, 9000)] },
    { number: "B2", kind: "purchase", issued: "2026-03-05", credit: false, lines: [line("gnome", 10, 11000)] },
    { number: "INV-1", kind: "sales", issued: "2026-03-10", credit: false, lines: [line("gnome", 4, 10000)] },
    { number: "CN-1", kind: "sales", issued: "2026-03-12", credit: true, lines: [line("gnome", 1, 2500)] },
    { number: "DN-1", kind: "purchase", issued: "2026-03-14", credit: true, lines: [line("gnome", 2, 2000)] },
  ];
  const counts = [{ id: "c1", date: "2026-03-31", lines: [{ itemId: "gnome", quantity: 14, unitCost: 1000 }] }];
  const { onHand, movements } = trackStock(items, docs, counts);
  const moves = movements.get("gnome");
  assert.deepEqual(moves.map((m) => [m.kind, m.reference, m.quantity, m.onHand]), [
    ["bought", "B1", 10, 10],
    ["bought", "B2", 10, 20],
    ["sold", "INV-1", -4, 16],
    ["returned by customer", "CN-1", 1, 17],
    ["sent back to supplier", "DN-1", -2, 15],
    ["counted", "count", -1, 14],
  ]);
  assert.equal(moves[2].value, -4000, "four sold at the average of 10.00");
  assert.equal(moves.at(-1).valueAfter, 14_000);
  assert.equal(moves.reduce((s, m) => s + m.value, 0), onHand.get("gnome").value, "the movements add up to what is on hand");

  const valued = stockValuation(items, onHand);
  assert.deepEqual(valued.rows.map((r) => [r.name, r.quantity, r.averageCost, r.value, r.low]), [
    ["Garden gnome", 14, 1000, 14_000, true],
    ["Pot", 0, 300, 0, true],
  ]);
  assert.equal(valued.total, 14_000);
});
