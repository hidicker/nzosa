import assert from "node:assert/strict";
import test from "node:test";
import { nestSubAccounts } from "../dist/index.js";

const parents = { "449.1": "449", "449.2": "449", "493.1": "493" };
const parentOf = (code) => parents[code];
const said = (rows) =>
  rows.map((r) => (r.kind === "line" ? `${r.sub ? "  " : ""}${r.item}` : r.kind === "heading" ? `[${r.code}]` : `total ${r.code}: ${r.items.join("+")}`));

test("sub-accounts sit under their parent, with the group's total after", () => {
  assert.deepEqual(said(nestSubAccounts(["400", "449.2", "449", "449.1", "485"], (c) => c, parentOf)), [
    "400",
    "449",
    "  449.2",
    "  449.1",
    "total 449: 449+449.2+449.1",
    "485",
  ]);
});

test("a parent with nothing of its own heads its sub-accounts", () => {
  assert.deepEqual(said(nestSubAccounts(["400", "493.1"], (c) => c, parentOf)), ["400", "[493]", "  493.1", "total 493: 493.1"]);
});

test("with no sub-accounts, nothing moves and nothing is added", () => {
  assert.deepEqual(said(nestSubAccounts(["485", "400"], (c) => c, () => undefined)), ["485", "400"]);
});

test("a sub-account's parent, and an inactive account, survive the chart file", async () => {
  const { formatChartOfAccounts, parseChartOfAccounts } = await import("../dist/index.js");
  const accounts = [
    { code: "449", name: "Motor Vehicle Expenses", type: "Overhead", taxCode: "15% GST on Expenses", description: "" },
    { code: "4491", name: "Fuel", type: "Overhead", taxCode: "15% GST on Expenses", description: "", parent: "449" },
    { code: "477", name: "Old wages", type: "Overhead", taxCode: "No GST", description: "", inactive: true },
  ];
  const back = parseChartOfAccounts(formatChartOfAccounts(accounts)).accounts;
  assert.equal(back[1].parent, "449");
  assert.equal(back[0].parent, undefined);
  assert.equal(back[2].inactive, true);
});
