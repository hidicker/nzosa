import assert from "node:assert/strict";
import test from "node:test";
import { betweenAccountPlan, betweenEntityJournals, overdrawnCurrentAccounts, personPositions, pairKey } from "../dist/index.js";

const model = {
  entities: [
    { id: "ana", name: "Ana", kind: "personal", owners: [{ name: "Ana", percent: 100 }] },
    { id: "tom", name: "Tom", kind: "personal", owners: [{ name: "Tom", percent: 100 }] },
    { id: "both", name: "Both", kind: "personal", owners: [{ name: "Ana", percent: 50 }, { name: "Tom", percent: 50 }] },
    { id: "totara", name: "Totara Street", kind: "commercial", gstRegistered: true, owners: [{ name: "Ana", percent: 50 }, { name: "Tom", percent: 50 }] },
    { id: "kowhai", name: "Kowhai Road", kind: "residential", owners: [{ name: "Ana", percent: 100 }] },
    { id: "co", name: "Rimu Ltd", kind: "business", structure: "company", owners: [{ name: "Ana", percent: 100 }] },
  ],
  accounts: {
    "473TS": "totara", "820TS": "totara", "200TS": "totara",
    "429KR": "kowhai", "400AN": "ana", "429CO": "co", "400BO": "both",
  },
  banks: { platinum: ["both"], payment: ["both"], totara1: ["totara"], ana: ["ana"], cobank: ["co"], kowhaibank: ["kowhai"] },
};
const banks = new Set(Object.keys(model.banks));
const options = (overrides) => ({
  model,
  bankOwner: (account) => model.banks[account]?.[0],
  isBank: (code) => banks.has(code),
  ...(overrides ? { overrides } : {}),
});
const journal = (id, date, lines) => ({
  transactionId: id,
  date,
  narration: id,
  lines: lines.map(([accountCode, amount]) => ({ accountCode, accountName: accountCode, amount, taxType: "NONE", description: "" })),
  source: "bank",
  taxBasis: "both",
});
const linesOf = (result) => result.journals.flatMap((j) => j.lines.map((l) => `${l.accountName} ${l.amount}`)).sort();
const balanced = (result) => result.journals.every((j) => j.lines.reduce((s, l) => s + l.amount, 0) === 0);

test("a Totara Street repair on the joint card: the owners put the money in, half each", () => {
  const r = betweenEntityJournals([journal("repair", "2026-03-24", [["platinum", -115000], ["473TS", 100000], ["820TS", 15000]])], options());
  assert.deepEqual(linesOf(r), [
    "Ana: drawings 57500",
    "Ana: funds introduced -57500",
    "Tom: drawings 57500",
    "Tom: funds introduced -57500",
  ]);
  assert.ok(balanced(r));
  assert.equal(r.journals[0].source, "between");
});

test("the Totara Street lease paid into the joint account: the owners draw it, and the GST stays with Totara Street", () => {
  const r = betweenEntityJournals([journal("lease", "2026-03-29", [["payment", 1150000], ["200TS", -1000000], ["820TS", -150000]])], options());
  assert.deepEqual(linesOf(r), [
    "Ana: drawings 575000",
    "Ana: funds introduced -575000",
    "Tom: drawings 575000",
    "Tom: funds introduced -575000",
  ]);
  assert.ok(balanced(r));
});

test("a line that stays with the account's owner needs nothing", () => {
  const r = betweenEntityJournals([journal("own", "2026-03-01", [["totara1", -5000], ["473TS", 5000]]), journal("joint", "2026-03-02", [["payment", -2000], ["400BO", 2000]])], options());
  assert.equal(r.journals.length, 0);
});

test("the joint account paying for a property one of them owns alone: Ana owes Tom her half", () => {
  const r = betweenEntityJournals([journal("rates", "2026-02-01", [["payment", -10000], ["429KR", 10000]])], options());
  assert.deepEqual(linesOf(r), ["Ana: drawings 5000", "Ana: funds introduced -10000", "Tom: drawings 5000"]);
  const { positions, owes, byEntity } = personPositions(r.journals, r.accounts, model, "2026-03-31");
  assert.deepEqual(positions, [{ person: "Ana", net: 5000 }, { person: "Tom", net: -5000 }]);
  assert.deepEqual(
    byEntity.map((b) => `${b.entityId} ${b.person} ${b.net}`).sort(),
    ["both Ana -5000", "both Tom -5000", "kowhai Ana 10000"],
  );
  assert.deepEqual(owes, [{ from: "Ana", to: "Tom", amount: 5000 }]);
});

test("a person paying a company's cost lends it the money; the company paying a private cost is an overdrawn current account", () => {
  const lent = betweenEntityJournals([journal("lend", "2026-01-10", [["ana", -20000], ["429CO", 20000]])], options());
  assert.deepEqual(linesOf(lent), ["Current account: Ana -20000", "Owed between Ana and Rimu Ltd 20000"]);
  assert.deepEqual(overdrawnCurrentAccounts(lent.journals, lent.accounts, "2026-03-31"), []);
  const drawn = betweenEntityJournals([journal("private", "2026-02-10", [["cobank", -5000], ["400AN", 5000]])], options());
  assert.deepEqual(linesOf(drawn), ["Current account: Ana 5000", "Owed between Ana and Rimu Ltd -5000"]);
  assert.deepEqual(overdrawnCurrentAccounts(drawn.journals, drawn.accounts, "2026-03-31"), [{ entityId: "co", person: "Ana", amount: 5000 }]);
  const { positions } = personPositions([...lent.journals, ...drawn.journals], [...lent.accounts, ...drawn.accounts], model, "2026-03-31");
  assert.deepEqual(positions, [], "a loan with a company is the company's, not between people");
});

test("a rental paying a company: the owner draws it from the rental and lends it to the company", () => {
  const r = betweenEntityJournals([journal("fees", "2026-03-05", [["kowhaibank", -3000], ["429CO", 3000]])], options());
  assert.deepEqual(linesOf(r), ["Ana: drawings 3000", "Current account: Ana -3000"]);
});

test("a pair set to a loan keeps a balance between the two instead", () => {
  const r = betweenEntityJournals([journal("repair", "2026-03-24", [["platinum", -115000], ["473TS", 100000], ["820TS", 15000]])], options({ [pairKey("totara", "both")]: "loan" }));
  assert.deepEqual(linesOf(r), ["Owed between Both and Totara Street 115000", "Owed between Totara Street and Both -115000"]);
});

test("a transfer between two entities' accounts balances both", () => {
  const r = betweenEntityJournals([{ ...journal("xfer", "2026-03-30", [["totara1", -50000], ["payment", 50000]]), source: "transfer" }], options());
  assert.ok(balanced(r));
  assert.equal(r.journals.length, 1);
});

test("the accounts are planned the same way in every entity, with each entity's suffix, and found again by name", () => {
  const suffix = { ana: "AN", tom: "TO", both: "BO", totara: "TS", kowhai: "KR", co: "RL" };
  const chart = [
    { code: "970TS", name: "Funds introduced" },
    { code: "951KR", name: "Ana: funds introduced" },
  ];
  const withChart = { ...model, accounts: { ...model.accounts, "970TS": "totara", "951KR": "kowhai" } };
  const plan = betweenAccountPlan(withChart, chart, (e) => suffix[e.id]);
  const of = (id) => plan.filter((a) => a.entityId === id).map((a) => `${a.code} ${a.name}${a.exists ? " (held)" : ""}`);
  assert.deepEqual(of("totara"), ["951TS Ana: funds introduced", "981TS Ana: drawings", "952TS Tom: funds introduced", "982TS Tom: drawings"]);
  assert.deepEqual(of("kowhai"), ["951KR Ana: funds introduced (held)", "981KR Ana: drawings"]);
  assert.deepEqual(of("both"), [
    "951BO Ana: funds introduced", "981BO Ana: drawings", "952BO Tom: funds introduced", "982BO Tom: drawings",
    "936BO Owed between Both and Rimu Ltd",
  ]);
  // A company: a current account for each person who owns anything directly.
  assert.deepEqual(of("co"), ["921RL Current account: Ana", "922RL Current account: Tom"]);
  // A person dealing with the company keeps one balance with it.
  assert.ok(of("ana").includes("936AN Owed between Ana and Rimu Ltd"));
  // Posted with the plan, the journals use the chart's codes.
  const r = betweenEntityJournals([journal("repair", "2026-03-24", [["platinum", -115000], ["473TS", 100000], ["820TS", 15000]])], { ...options(), model: withChart, plan });
  assert.deepEqual(r.journals[0].lines.map((l) => `${l.accountCode} ${l.amount}`).sort(), ["951TS -57500", "952TS -57500", "981BO 57500", "982BO 57500"]);
});

test("a partner's capital introduced is used as their funds introduced", () => {
  const firm = { entities: [
    { id: "p", name: "Ana and Tom", kind: "business", structure: "partnership", owners: [{ name: "Ana", percent: 50 }, { name: "Tom", percent: 50 }] },
    { id: "ana", name: "Ana", kind: "personal", owners: [{ name: "Ana", percent: 100 }] },
  ], accounts: { "951AT": "p" }, banks: {} };
  const plan = betweenAccountPlan(firm, [{ code: "951AT", name: "Ana: capital introduced" }], (e) => (e.id === "p" ? "AT" : "AN"));
  assert.ok(plan.some((a) => a.code === "951AT" && a.role === "introduced" && a.exists));
});

test("without its account in the plan, a journal is left out rather than posted somewhere unknown", () => {
  const r = betweenEntityJournals([journal("repair", "2026-03-24", [["platinum", -115000], ["473TS", 100000], ["820TS", 15000]])], { ...options(), plan: [] });
  assert.equal(r.journals.length, 0);
});
