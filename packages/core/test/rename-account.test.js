import assert from "node:assert/strict";
import test from "node:test";
import { renameAccount, renameProblem } from "../dist/index.js";

const account = (over) => ({ code: "", name: "", type: "", taxCode: "", description: "", ...over });

const CHART = [
  account({ code: "400", name: "Advertising", type: "Overhead", taxCode: "15% GST on Expenses" }),
  account({ code: "485", name: "Subscriptions", type: "Overhead", taxCode: "15% GST on Expenses" }),
];

const BEFORE = {
  chart: CHART,
  overrides: {
    a: { confirmed: true, code: "Advertising - 400" },
    b: { confirmed: true, code: "Subscriptions - 485" },
  },
  splits: {
    c: [
      { amount: -5000, code: "Advertising - 400", note: "the ad" },
      { amount: -1500, code: "Subscriptions - 485", note: "the rest" },
    ],
  },
  rules: {
    rules: [{ priority: 100, keyword: "GOOGLE", code: "Advertising - 400" }],
    defaults: [{ code: "Advertising - 400" }],
    codeTreatments: { "Advertising - 400": "standard", "Subscriptions - 485": "standard" },
  },
  accountEntities: { 400: "e1", 485: "e2" },
};

test("a rename carries every reference to the account with it", () => {
  const after = renameAccount(
    BEFORE,
    { code: "400", name: "Advertising" },
    { code: "401", name: "Marketing" },
    "Advertising - 400",
    "Marketing - 401",
  );

  assert.deepEqual(after.chart[0].code, "401");
  assert.deepEqual(after.chart[0].name, "Marketing");
  assert.equal(after.overrides["a"].code, "Marketing - 401");
  assert.equal(after.splits["c"][0].code, "Marketing - 401");
  assert.equal(after.rules.rules[0].code, "Marketing - 401");
  assert.equal(after.rules.defaults[0].code, "Marketing - 401");
  assert.equal(after.rules.codeTreatments["Marketing - 401"], "standard");
  assert.equal("Advertising - 400" in after.rules.codeTreatments, false);
  assert.equal(after.accountEntities["401"], "e1");
  assert.equal("400" in after.accountEntities, false);

  assert.deepEqual(after.moved, {
    codings: 1, splitParts: 1, rules: 2, treatment: true, entity: true,
  });
});

test("everything else is left exactly as it was", () => {
  const after = renameAccount(
    BEFORE,
    { code: "400", name: "Advertising" },
    { code: "401", name: "Marketing" },
    "Advertising - 400",
    "Marketing - 401",
  );
  assert.equal(after.overrides["b"].code, "Subscriptions - 485");
  assert.equal(after.splits["c"][1].code, "Subscriptions - 485");
  assert.equal(after.rules.codeTreatments["Subscriptions - 485"], "standard");
  assert.equal(after.accountEntities["485"], "e2");
  assert.equal(after.chart[1].name, "Subscriptions");
});

test("what it was given is not touched", () => {
  // The caller saves the result as one change, so a rename lands completely or
  // not at all. Editing the input in place would make half of it land early.
  renameAccount(
    BEFORE,
    { code: "400", name: "Advertising" },
    { code: "401", name: "Marketing" },
    "Advertising - 400",
    "Marketing - 401",
  );
  assert.equal(BEFORE.overrides["a"].code, "Advertising - 400");
  assert.equal(BEFORE.chart[0].code, "400");
  assert.equal(BEFORE.rules.codeTreatments["Advertising - 400"], "standard");
  assert.equal(BEFORE.accountEntities["400"], "e1");
});

test("changing only the name still moves the codings", () => {
  const after = renameAccount(
    BEFORE,
    { code: "400", name: "Advertising" },
    { code: "400", name: "Marketing" },
    "Advertising - 400",
    "Marketing - 400",
  );
  assert.equal(after.overrides["a"].code, "Marketing - 400");
  // The entity key is the code, so it does not move.
  assert.equal(after.moved.entity, false);
  assert.equal(after.accountEntities["400"], "e1");
});

test("a code already in use is refused, and says whose it is", () => {
  const why = renameProblem(CHART, { code: "400", name: "Advertising" }, { code: "485", name: "Marketing" });
  assert.match(why, /already Subscriptions/);
});

test("keeping your own code is not a clash with yourself", () => {
  assert.equal(
    renameProblem(CHART, { code: "400", name: "Advertising" }, { code: "400", name: "Marketing" }),
    null,
  );
});

test("a name and a code are both required", () => {
  const from = { code: "400", name: "Advertising" };
  assert.match(renameProblem(CHART, from, { code: "400", name: "  " }), /needs a name/);
  assert.match(renameProblem(CHART, from, { code: "", name: "Marketing" }), /needs a code/);
});

test("a code is letters, numbers and hyphens", () => {
  const from = { code: "400", name: "Advertising" };
  assert.equal(renameProblem(CHART, from, { code: "400-A", name: "Marketing" }), null);
  assert.match(renameProblem(CHART, from, { code: "4 0 0", name: "Marketing" }), /letters, numbers/);
});
