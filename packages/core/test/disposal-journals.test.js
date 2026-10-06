import assert from "node:assert/strict";
import test from "node:test";
import { depreciationSchedule, disposalJournals, proceedsFromDisposalJournals } from "../dist/index.js";

const account = (code, name, type) => ({ code, name, type, taxCode: "No GST", description: "" });

const CHART = [
  account("710", "Office Equipment", "Fixed Asset"),
  account("711", "Less Accumulated Depreciation on Office Equipment", "Fixed Asset"),
  account("730", "Roasting Equipment", "Fixed Asset"),
  account("731", "Less Accumulated Depreciation on Roasting Equipment", "Fixed Asset"),
];

const asset = (over = {}) => ({
  number: "FA-0036", name: "Roaster", type: "Roasting Equipment", status: "Disposed",
  purchased: "2023-04-01", depreciationFrom: "2023-04-01", cost: 1000000,
  rate: 20, method: "DV", averaging: "", disposed: "2025-09-01", ...over,
});

const txn = (date) => ({
  id: date, date, account: "090", amount: 1000, otherParty: "", particulars: "",
  code: "", reference: "", description: "", currency: "NZD", source: "bank",
});

const run = (over = {}) =>
  disposalJournals({
    assets: [asset()], proceeds: { "FA-0036": 400000 },
    transactions: [txn("2025-06-01")], chart: CHART, ...over,
  });

test("nothing is posted for an asset whose proceeds are unknown", () => {
  // The register says it was sold; it does not say for how much. Scrapped for
  // nothing and sold for book value are different entries, and guessing
  // between them is guessing at a gain.
  assert.deepEqual(run({ proceeds: {} }), []);
  assert.deepEqual(run({ proceeds: { "FA-9999": 1 } }), [], "proceeds for a different asset");
});

test("no assets at all, nothing to post", () => {
  assert.deepEqual(run({ assets: [] }), []);
});

test("a disposal posts a balanced journal", () => {
  const [journal] = run();
  assert.ok(journal, "one disposal, one journal");
  assert.equal(journal.lines.reduce((s, l) => s + l.amount, 0), 0);
});

test("the asset and its contra are both the roasting ones, not the office ones", () => {
  // Office Equipment comes first in the chart and shares the word "equipment".
  // One wrong lookup here credits a class's depreciation to another's contra.
  const [journal] = run();
  const codes = journal.lines.map((l) => l.accountCode);
  assert.ok(codes.includes("730"), "the roasting asset account");
  assert.ok(codes.includes("731"), "and the roasting contra");
  assert.ok(!codes.includes("710"), "not the office asset account");
  assert.ok(!codes.includes("711"), "not the office contra");
});

test("it is dated when the asset actually left", () => {
  const [journal] = run();
  assert.equal(journal.date, "2025-09-01");
});

test("an asset disposed outside the years traded is not posted", () => {
  // The transactions reach the 2026 year only. A disposal in 2030 belongs to a
  // year this ledger does not cover.
  const late = asset({ disposed: "2029-09-01" });
  assert.deepEqual(
    disposalJournals({
      assets: [late], proceeds: { "FA-0036": 1 },
      transactions: [txn("2025-06-01")], chart: CHART,
    }),
    [],
  );
});

test("a chart naming neither account still posts somewhere nameable", () => {
  const [journal] = run({ chart: [] });
  const codes = journal.lines.map((l) => l.accountCode);
  assert.ok(codes.includes("730") && codes.includes("731"), "the conventional pair");
});

const disposalJournal = (id, narration, lines) => ({
  id, date: "2025-09-01", narration, postedDate: null, postedBy: "",
  lines: lines.map(([accountCode, accountName, amount], line) => ({
    accountCode, accountName, description: "", amount, line,
  })),
});
const bookValue = () =>
  depreciationSchedule([asset()], { from: "2025-04-01", to: "2026-03-31" })
    .rows.find((r) => r.asset.number === "FA-0036").bookValueAtDisposal;
const worked = (journals) =>
  proceedsFromDisposalJournals({
    assets: [asset()], journals, transactions: [txn("2025-06-01")],
  }).get("FA-0036");
const NARRATION = "Disposal of asset FA-0036 on 1 Sep 2025";

test("proceeds are worked back from a disposal journal: book value, plus recovered, plus gain, less loss", () => {
  const gain = [disposalJournal("12", NARRATION, [
    ["300", "Depreciation Recovered", -10000],
    ["301", "Capital Gain (Loss) on Disposal of Assets", -5000],
  ])];
  assert.equal(worked(gain), bookValue() + 15000);
  const loss = [disposalJournal("12", NARRATION, [["470", "Loss on sale of Fixed Assets", 4392]])];
  assert.equal(worked(loss), bookValue() - 4392);
});

test("a disposal that was reversed is not read, though its own narration never says so", () => {
  // Only the reversal says "Reversed". The disposal it undid reads like any
  // other, and reading it gave 790.57 for a sale of 1,130.43 on real books.
  const journals = [
    disposalJournal("10", NARRATION, [["470", "Loss on sale of Fixed Assets", 26086]]),
    disposalJournal("11", `Reversed: ${NARRATION} - Reversal of ID 10`, [["470", "Loss on sale of Fixed Assets", -26086]]),
    disposalJournal("12", NARRATION, [["301", "Capital Gain (Loss) on Disposal of Assets", -26086]]),
  ];
  assert.equal(worked(journals), bookValue() + 26086);
});

test("an asset number inside a longer one is not taken for it", () => {
  const journals = [disposalJournal("12", "Disposal of asset FA-00361 on 1 Sep 2025", [["300", "Depreciation Recovered", -10000]])];
  assert.equal(worked(journals), undefined);
});

test("no disposal journal, no proceeds: nothing is guessed", () => {
  assert.equal(worked([]), undefined);
  assert.equal(
    worked([disposalJournal("5", "Depreciation of FA-0036 on 31 Aug 2025.", [["416", "Depreciation", 100]])]),
    undefined,
  );
});
