import { test } from "node:test";
import assert from "node:assert/strict";
import { chartImportPlan, formatChartOfAccounts, nestLines, parentProblem, parseChartOfAccounts } from "../dist/index.js";

const chart = [
  { code: "449", name: "Vehicle", type: "Overhead", taxCode: "", description: "" },
  { code: "450", name: "Vehicle: fuel", type: "Overhead", taxCode: "", description: "", parent: "449" },
  { code: "451", name: "Vehicle: insurance", type: "Overhead", taxCode: "", description: "", parent: "449" },
  { code: "429", name: "General", type: "Overhead", taxCode: "", description: "" },
];

test("one level only, never under itself, and a parent with sub-accounts cannot go under another", () => {
  assert.equal(parentProblem(chart, chart[3], "449"), null);
  assert.match(parentProblem(chart, chart[0], "449"), /under itself/);
  assert.match(parentProblem(chart, chart[3], "450"), /one level deep/);
  assert.match(parentProblem(chart, chart[0], "429"), /has sub-accounts/);
  assert.match(parentProblem(chart, chart[3], "999"), /No account 999/);
});

test("lines set under their parent with its total, the parent's own postings first, order kept", () => {
  const lines = [
    { code: "429", net: 100 },
    { code: "450", net: 300 },
    { code: "449", net: 50 },
    { code: "451", net: 200 },
  ];
  const byCode = new Map(chart.map((a) => [a.code, a]));
  const rows = nestLines(
    lines,
    (l) => {
      const p = byCode.get(l.code)?.parent;
      return p === undefined ? null : { code: p, label: byCode.get(p).name };
    },
    (l) => l.code,
    (l) => l.net,
  );
  assert.deepEqual(rows.map((r) => (r.kind === "line" ? r.line.code : [r.label, r.total, r.children.map((c) => c.code)])), [
    "429",
    ["Vehicle", 550, ["449", "450", "451"]],
  ]);
});

test("the Parent column is written only when there are sub-accounts, and reads back", () => {
  assert.doesNotMatch(formatChartOfAccounts([chart[0], chart[3]]), /Parent/);
  const back = parseChartOfAccounts(formatChartOfAccounts(chart)).accounts;
  assert.equal(back[1].parent, "449");
  assert.equal(chartImportPlan(chart, back).unchanged, 4);
});
