import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyChartPlan,
  applyItemPlan,
  chartImportPlan,
  formatChartOfAccounts,
  formatItemsCsv,
  itemImportPlan,
  parseChartOfAccounts,
  parseHledgerAccounts,
  parseItemsCsv,
  starterChart,
  usualTaxCodes,
} from "../dist/index.js";

const chart = [
  { code: "200", name: "Sales", type: "Revenue", taxCode: "15% GST on Income", description: "" },
  { code: "400", name: "Advertising", type: "Overhead", taxCode: "15% GST on Expenses", description: "" },
  { code: "401", name: "ACC Levy", type: "Expense", taxCode: "15% GST on Expenses", description: "" },
];

test("hledger account directives become accounts, typed by tag or by where they sit; parents with children are headings", () => {
  const { accounts, problems } = parseHledgerAccounts(
    [
      "account assets",
      "account assets:bank:checking   ; type: C",
      "account assets:receivable",
      "account liabilities:loan:car",
      "account equity:opening balances",
      "account income:consulting",
      "account expenses:office supplies  ; a comment",
      "account misc:thing",
      "2026-01-01 opening",
      "  assets:bank:checking  100",
    ].join("\n"),
  );
  assert.deepEqual(
    accounts.map((a) => [a.name, a.type]),
    [
      ["Bank: Checking", "Bank"],
      ["Receivable", "Current Asset"],
      ["Loan: Car", "Non-current Liability"],
      ["Opening balances", "Equity"],
      ["Consulting", "Revenue"],
      ["Office supplies", "Expense"],
    ],
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0], /misc:thing/);
});

test("the output of `hledger accounts` reads the same way", () => {
  const { accounts } = parseHledgerAccounts("assets:cash\nexpenses:food\nexpenses:rent\n");
  assert.deepEqual(accounts.map((a) => a.name), ["Cash", "Food", "Rent"]);
  assert.equal(accounts[0].type, "Bank");
});

test("the dry run adds, updates what the file says, notes a rename, and numbers new accounts by type", () => {
  const incoming = [
    { code: "200", name: "Sales", type: "Revenue", taxCode: "", description: "" },
    { code: "400", name: "Advertising & Marketing", type: "Overhead", taxCode: "No GST", description: "" },
    { code: "", name: "Consulting", type: "Revenue", taxCode: "", description: "hledger: income:consulting" },
    { code: "", name: "Office supplies", type: "Expense", taxCode: "", description: "" },
    { code: "", name: "Bank: Checking", type: "Bank", taxCode: "", description: "" },
    { code: "", name: "acc levy", type: "Expense", taxCode: "", description: "" },
    { code: "", name: "Consulting", type: "Revenue", taxCode: "", description: "" },
  ];
  const plan = chartImportPlan(chart, incoming, { taxCodeFor: usualTaxCodes(chart) });
  assert.deepEqual(plan.add.map((a) => [a.code, a.name, a.taxCode]), [
    ["201", "Consulting", "15% GST on Income"],
    ["402", "Office supplies", "15% GST on Expenses"],
    ["", "Bank: Checking", ""],
  ]);
  assert.deepEqual(plan.change.map((c) => [c.before.code, c.fields]), [["400", ["tax code"]]]);
  assert.deepEqual(plan.renamed, [{ code: "400", held: "Advertising", file: "Advertising & Marketing" }]);
  assert.equal(plan.unchanged, 2);
  assert.deepEqual(plan.coded, ["Consulting (201)", "Office supplies (402)"]);
  assert.match(plan.problems[0], /Consulting is in the file twice/);

  const after = applyChartPlan(chart, plan);
  assert.equal(after.length, 6);
  assert.equal(after[1].name, "Advertising", "a rename is said, not applied");
  assert.equal(after[1].taxCode, "No GST");
  assert.equal(chart[1].taxCode, "15% GST on Expenses", "the chart given is not changed");
});

test("a chart written here and read back changes nothing", () => {
  const starter = starterChart();
  const plan = chartImportPlan(starter, parseChartOfAccounts(formatChartOfAccounts(starter)).accounts);
  assert.equal(plan.add.length, 0);
  assert.equal(plan.change.length, 0);
  assert.equal(plan.unchanged, starter.length);
});

const items = [
  { id: "i1", name: "Flat white", kind: "product", price: 550, accountCode: "200", unitCost: 120, reorderPoint: 10 },
  { id: "i2", name: "Barista training", kind: "service", price: 15000, active: false },
  { id: "i3", name: "Gift card", kind: "service", taxable: false },
];

test("items written as CSV read back as the same items, and plan to change nothing", () => {
  const read = parseItemsCsv(formatItemsCsv(items));
  assert.deepEqual(read.problems, []);
  assert.deepEqual(read.items.map((i) => i.name), ["Flat white", "Barista training", "Gift card"]);
  const plan = itemImportPlan(items, read.items);
  assert.equal(plan.add.length, 0);
  assert.deepEqual(plan.change, []);
  assert.equal(plan.unchanged, 3);
});

test("a list from elsewhere: matched by name ignoring case, new ones added, bad amounts said", () => {
  const csv = "Name,Price,Active,Unit cost\nflat  WHITE,6.00,,\nBarista training,,yes,\nCroissant,4.50,,1.10\nMuffin,abc,,\n";
  const read = parseItemsCsv(csv);
  assert.equal(read.problems.length, 1);
  assert.match(read.problems[0], /Muffin.*price "abc"/);
  const plan = itemImportPlan(items, read.items);
  assert.deepEqual(plan.change.map((c) => [c.before.name, c.fields]), [
    ["Flat white", ["price"]],
    ["Barista training", ["active"]],
  ]);
  assert.deepEqual(plan.add.map((a) => [a.name, a.kind, a.price, a.unitCost]), [
    ["Croissant", "product", 450, 110],
    ["Muffin", "service", undefined, undefined],
  ]);
  const after = applyItemPlan(items, plan, (n) => `new${n}`);
  assert.equal(after[0].price, 600);
  assert.equal(after[0].unitCost, 120, "what the file leaves empty stays");
  assert.equal("active" in after[1], false, "active again is the default, not a flag");
  assert.deepEqual(after.slice(3).map((i) => i.id), ["new0", "new1"]);
});

const entities = [
  { code: "404KC", name: "Bank fees", type: "Overhead", taxCode: "No GST", description: "" },
  { code: "404MS", name: "Bank fees", type: "Overhead", taxCode: "No GST", description: "" },
  { code: "200KC", name: "Sales", type: "Revenue", taxCode: "15% GST on Income", description: "" },
  { code: "400KC", name: "Advertising", type: "Overhead", taxCode: "15% GST on Expenses", description: "" },
];

test("one name under each entity's code is not a duplicate, and reads back unchanged", () => {
  const plan = chartImportPlan(entities, parseChartOfAccounts(formatChartOfAccounts(entities)).accounts);
  assert.deepEqual(plan.problems, []);
  assert.equal(plan.unchanged, 4);
});

test("a name with no code that several accounts carry matches none, and says so", () => {
  const plan = chartImportPlan(entities, [{ code: "", name: "Bank fees", type: "Expense", taxCode: "", description: "" }]);
  assert.equal(plan.add.length, 0);
  assert.match(plan.problems[0], /name of 2 accounts here \(404KC, 404MS\)/);
});

test("worked-out types leave an account's type alone, and a new one takes the chart's word for it", () => {
  const { accounts } = parseHledgerAccounts("account expenses:advertising\naccount expenses:roasting gas\naccount income:workshops\n");
  const plan = chartImportPlan(entities, accounts, { taxCodeFor: usualTaxCodes(entities), inferredTypes: true });
  assert.deepEqual(plan.change, [], "Advertising stays an overhead");
  assert.equal(plan.unchanged, 1);
  assert.deepEqual(plan.add.map((a) => [a.code, a.name, a.type, a.taxCode]), [
    ["401", "Roasting gas", "Overhead", "No GST"],
    ["201", "Workshops", "Revenue", "15% GST on Income"],
  ]);
});
