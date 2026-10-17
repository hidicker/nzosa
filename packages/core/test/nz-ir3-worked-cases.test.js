import test from "node:test";
import assert from "node:assert/strict";
import { ir3Return, incomeTaxOn } from "../dist/index.js";

// OpenAccountants' NZ IR3 guide, worked case C1, on IRD's rates "from 1 April
// 2025": a sole trader with taxable income of $90,000 pays $19,577.50.
test("IR3: a sole trader's $90,000 profit is box 24, and the tax on it is $19,577.50", () => {
  const ret = ir3Return({
    owner: "Mere Rua",
    year: 2026,
    extras: [],
    rentals: [],
    selfEmployed: [{ business: "Rua Design", net: 9_000_000 }],
  });
  const box = (id) => ret.boxes.find((b) => b.box === id)?.amount;
  assert.equal(box("24"), 9_000_000);
  assert.equal(ret.taxableIncome, 9_000_000);
  assert.equal(ret.taxOnIncome, 1_957_750);
  assert.equal(box("33"), 0); // over $70,000: no IETC
});

// Case C2: income $68,000, the IETC abates 13 cents a dollar over $66,000: $260.
test("IETC at $68,000 is $260", () => {
  const ret = ir3Return({ owner: "A", year: 2026, extras: [], rentals: [], selfEmployed: [{ business: "B", net: 6_800_000 }], ietcEligible: true });
  assert.equal(ret.boxes.find((b) => b.box === "33")?.amount, 26_000);
});

test("tax bands on $90,000, 2026-27 as 2025-26", () => {
  assert.equal(incomeTaxOn(9_000_000, 2027), 1_957_750);
});
