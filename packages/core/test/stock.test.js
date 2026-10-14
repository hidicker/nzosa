import { test } from "node:test";
import assert from "node:assert/strict";
import { stockAdjustment, stockValue } from "../dist/index.js";

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
