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

test("each product's movements, with what is on hand and its worth after each", async () => {
  const { trackStock, stockAsAt, lowStock } = await import("../dist/index.js");
  const items = [
    { id: "beans", name: "Beans 1kg", kind: "product", unitCost: 2_000, reorderAt: 5 },
    { id: "cups", name: "Cups", kind: "product", unitCost: 50, reorderAt: 10 },
    { id: "tea", name: "Tea", kind: "product", unitCost: 100 },
  ];
  const docs = [
    { number: "BILL-1", kind: "purchase", issued: "2026-05-01", credit: false, lines: [{ itemCode: "beans", quantity: 10, net: 20_000, description: "" }, { itemCode: "Cups", quantity: 100, net: 5_000, description: "" }] },
    { number: "INV-1", kind: "sales", issued: "2026-05-10", credit: false, lines: [{ itemCode: "beans", quantity: 6, net: 36_000, description: "" }] },
    { number: "CN-1", kind: "sales", issued: "2026-05-12", credit: true, lines: [{ itemCode: "beans", quantity: 1, net: 6_000, description: "" }] },
  ];
  const counts = [{ id: "c1", date: "2026-05-31", lines: [{ itemId: "cups", quantity: 8, unitCost: 50 }] }];
  const { history, onHand } = trackStock(items, docs, counts);
  assert.deepEqual(history.get("beans").map((m) => [m.date, m.what, m.number, m.quantity, m.value, m.onHand, m.worth]), [
    ["2026-05-01", "Bought", "BILL-1", 10, 20_000, 10, 20_000],
    ["2026-05-10", "Sold", "INV-1", -6, -12_000, 4, 8_000],
    ["2026-05-12", "Returned", "CN-1", 1, 2_000, 5, 10_000],
  ]);
  assert.deepEqual(history.get("cups").map((m) => [m.what, m.quantity, m.onHand]), [["Bought", 100, 100], ["Counted", -92, 8]]);
  // As at a date: after the last movement on or before it.
  assert.deepEqual(stockAsAt(history, "2026-05-11").get("beans"), { quantity: 4, value: 8_000 });
  assert.equal(stockAsAt(history, "2026-04-30").get("beans"), undefined);
  // Low: at or below the reorder point, furthest below first; none set, never low.
  assert.deepEqual(lowStock(items, onHand).map((x) => [x.item.id, x.onHand, x.reorderAt]), [["cups", 8, 10], ["beans", 5, 5]]);
});
