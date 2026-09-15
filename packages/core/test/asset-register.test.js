import assert from "node:assert/strict";
import test from "node:test";
import {
  fixedAssetProblems,
  fixedAssetTemplate,
  formatFixedAssets,
  nextAssetNumber,
  parseFixedAssets,
} from "../dist/index.js";

const van = {
  number: "FA-0007",
  name: "Van, 2019 \"Hiace\", white",
  type: "Motor Vehicles",
  status: "Disposed",
  purchased: "2023-08-03",
  depreciationFrom: "2023-09-01",
  cost: 2_400_055,
  rate: 30,
  method: "Diminishing Value",
  averaging: "Full Month",
  disposed: "2025-11-20",
};
const laptop = {
  number: "FA-0012",
  name: "Laptop",
  type: "Computer Equipment",
  status: "Registered",
  purchased: "2026-02-05",
  depreciationFrom: "2026-02-05",
  cost: 240_000,
  rate: 40,
  method: "Straight Line",
  averaging: "Full Month",
  disposed: null,
};

test("a register written out reads back as the register it was", () => {
  const read = parseFixedAssets(formatFixedAssets([van, laptop]));
  assert.deepEqual(read.problems, []);
  assert.deepEqual(read.assets, [van, laptop]);
});

test("the template loads as one asset, with nothing wrong with it", () => {
  const read = parseFixedAssets(fixedAssetTemplate());
  assert.deepEqual(read.problems, []);
  assert.equal(read.assets.length, 1);
  assert.deepEqual(fixedAssetProblems(read.assets[0], []), []);
});

test("the next asset number follows the register's own pattern", () => {
  assert.equal(nextAssetNumber([]), "FA-0001");
  assert.equal(nextAssetNumber([{ number: "FA-0009" }, { number: "FA-0012" }, { number: "Van" }]), "FA-0013");
  assert.equal(nextAssetNumber([{ number: "A7" }]), "A8");
});

test("an asset needs a name, an unused number, a date, a cost and a rate", () => {
  assert.deepEqual(fixedAssetProblems(laptop, [laptop], "FA-0012"), [], "keeping its own number is fine");
  assert.ok(fixedAssetProblems({ ...laptop, number: "FA-0007" }, [van, laptop], "FA-0012").some((p) => /already/.test(p)));
  assert.ok(fixedAssetProblems({ ...laptop, name: " " }, []).some((p) => /name/.test(p)));
  assert.ok(fixedAssetProblems({ ...laptop, rate: 0 }, []).some((p) => /rate/.test(p)));
  assert.deepEqual(fixedAssetProblems({ ...laptop, rate: 0, method: "No Depreciation" }, []), [], "no rate without depreciation");
  assert.ok(fixedAssetProblems({ ...laptop, disposed: "2025-01-01" }, []).some((p) => /before it was bought/.test(p)));
});
