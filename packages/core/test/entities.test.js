import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_ENTITY_NAME,
  accountEntityKey,
  defaultEntityModel,
  emptyEntityModel,
  reportsNetOfGst,
} from "../dist/entities.js";
import { isKnownType, sectionForType } from "../dist/reports.js";

const chart = [
  { code: "200", name: "Sales", type: "Revenue" },
  { code: "400", name: "Advertising", type: "Expense" },
  // A bank row in a chart export carries no code, which is why the key falls
  // back to the name.
  { code: "", name: "02-1100-0022001-000", type: "Bank" },
];

test("a ledger's first entity holds every account and every bank account", () => {
  const model = defaultEntityModel(chart, ["02-1100-0022001-000", "visa-4003"]);
  assert.equal(model.entities.length, 1);
  assert.equal(model.entities[0]?.name, DEFAULT_ENTITY_NAME);
  // Nothing is left outside it: an account outside the only entity there is
  // would be excluded from a report that is supposed to cover everything.
  for (const account of chart) {
    assert.equal(model.accounts[accountEntityKey(account)], model.entities[0]?.id);
  }
  assert.deepEqual(model.banks["visa-4003"], [model.entities[0]?.id]);
});

test("the entity a ledger starts with is registered for GST", () => {
  const model = defaultEntityModel(chart, []);
  assert.equal(model.entities[0]?.gstRegistered, true);
  assert.equal(reportsNetOfGst(model.entities[0]), true);
});

test("an entity that is not registered reports what it actually paid", () => {
  // Not registered means the GST it pays is part of the cost, so leaving it
  // out would understate every expense the entity has.
  assert.equal(reportsNetOfGst({ id: "a", name: "A", gstRegistered: false }), false);
});

test("nobody having said is treated as registered", () => {
  // Every entity that existed before the flag did. Assuming registered keeps
  // their reports reading exactly as they did.
  assert.equal(reportsNetOfGst({ id: "a", name: "A" }), true);
  assert.equal(reportsNetOfGst(undefined), true);
});

test("an empty model is still empty", () => {
  const model = emptyEntityModel();
  assert.equal(model.entities.length, 0);
  assert.deepEqual(model.accounts, {});
});

test("a balance-sheet account is placeable, not unrecognised", () => {
  // Both answer null to sectionForType -- neither is income or expense -- but
  // only one of them is something nobody has identified.
  for (const type of ["Accounts Receivable", "Inventory", "Current Asset", "Bank", "Equity"]) {
    assert.equal(sectionForType(type), null, type);
    assert.equal(isKnownType(type), true, type);
  }
  assert.equal(isKnownType(""), false);
  assert.equal(isKnownType("Whatever This Is"), false);
});

test("an accounting system's own accounts are placeable, not unrecognised", () => {
  // Every chart exported from one carries these, nobody creates them, and
  // nobody can act on being told they are unrecognised. They are balance-sheet
  // accounts and were being flagged amber in every chart that had them.
  for (const type of ["GST", "Unpaid Expense Claims", "Historical", "Rounding", "Tracking"]) {
    assert.equal(isKnownType(type), true, type);
    assert.equal(sectionForType(type), null, type);
  }
});

test("income and expense types stay on the profit and loss", () => {
  assert.equal(sectionForType("Revenue"), "income");
  assert.equal(sectionForType("Direct Costs"), "expenses");
  assert.equal(isKnownType("Revenue"), true);
});

test("a purchase nothing decided is marked as assumed", async () => {
  const { gstResolver } = await import("../dist/gst-rules.js");
  const resolve = gstResolver({ codeOf: () => null });
  const spend = {
    id: "t1", date: "2025-09-26", account: "a", amount: -634874,
    currency: "NZD", otherParty: "Someone", particulars: "", code: "", reference: "",
  };
  const classified = resolve(spend);
  // Still standard-rated: this changes no figure. It says so out loud, because
  // claiming three twenty-thirds of something nobody has identified is a guess
  // in the direction Inland Revenue asks about.
  assert.equal(classified.treatment, "standard");
  assert.equal(classified.side, "purchases");
  assert.equal(classified.assumed, true);
});

test("a purchase a treatment decided is not assumed", async () => {
  const { gstResolver } = await import("../dist/gst-rules.js");
  const resolve = gstResolver({
    codeOf: () => "310 Cost of Goods Sold",
    codeTreatments: { "310 Cost of Goods Sold": "standard" },
  });
  const spend = {
    id: "t2", date: "2025-09-26", account: "a", amount: -10000,
    currency: "NZD", otherParty: "Someone", particulars: "", code: "", reference: "",
  };
  assert.equal(resolve(spend).assumed, undefined);
});
