import assert from "node:assert/strict";
import test from "node:test";
import { formatItems, parseProductList } from "../dist/index.js";

test("products and services go out as a spreadsheet and come back the same", () => {
  const items = [
    { id: "1", name: "Tandem flight", kind: "service", price: 23000, accountCode: "200" },
    { id: "2", name: "Beans, 1kg", kind: "product", price: 4500, unitCost: 2200, reorderAt: 5, accountCode: "200", description: "Single origin" },
    { id: "3", name: "=SUM(A1)", kind: "product", price: 100, active: false, taxable: false },
  ];
  const text = formatItems(items);
  assert.ok(text.includes("'=SUM(A1)"), "a formula is kept as text");
  const back = parseProductList(text, "NZD");
  assert.deepEqual(back.map((r) => r.item.name), ["Tandem flight", "Beans, 1kg", "'=SUM(A1)"]);
  assert.deepEqual(back[0].item, { name: "Tandem flight", kind: "service", price: 23000 });
  assert.equal(back[0].incomeAccount, "200");
  assert.deepEqual(back[1].item, { name: "Beans, 1kg", kind: "product", description: "Single origin", price: 4500, unitCost: 2200, reorderAt: 5 });
  assert.equal(back[2].item.active, false);
  assert.equal(back[2].item.taxable, false);
});
