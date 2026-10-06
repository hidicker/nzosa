import assert from "node:assert/strict";
import test from "node:test";
import { splitAccountLabel } from "../dist/index.js";

test("a code written at either end is found", () => {
  // Both turn up in one ledger: this app writes the first, an Account
  // Transactions export writes the second, and codings come from both.
  assert.deepEqual(splitAccountLabel("Accounts Receivable - 610"), {
    code: "610",
    name: "Accounts Receivable",
  });
  assert.deepEqual(splitAccountLabel("485 Subscriptions"), {
    code: "485",
    name: "Subscriptions",
  });
});

test("the house prefix is not part of the name", () => {
  assert.deepEqual(splitAccountLabel("NB Power - 445"), { code: "445", name: "Power" });
});

test("an en dash separates as well as a hyphen", () => {
  assert.deepEqual(splitAccountLabel("Rent – 469"), { code: "469", name: "Rent" });
  assert.deepEqual(splitAccountLabel("469 – Rent"), { code: "469", name: "Rent" });
});

test("digits inside a name are not a code", () => {
  // The failure this guards against is silent: an account whose code cannot be
  // recovered is classified by its default, and a profit and loss account
  // filed as a current asset still balances.
  assert.deepEqual(splitAccountLabel("Motor Vehicle >1K"), {
    code: "",
    name: "Motor Vehicle >1K",
  });
  assert.deepEqual(splitAccountLabel("Low Value Assets <1K"), {
    code: "",
    name: "Low Value Assets <1K",
  });
  assert.deepEqual(splitAccountLabel("Travel - International"), {
    code: "",
    name: "Travel - International",
  });
});

test("a chart may code an account with a word", () => {
  assert.deepEqual(splitAccountLabel("Charitable Donation - Donation"), {
    code: "",
    name: "Charitable Donation - Donation",
  });
});

test("a bare number is a code", () => {
  assert.deepEqual(splitAccountLabel("820"), { code: "820", name: "820" });
});

test("nothing at all comes back as nothing", () => {
  assert.deepEqual(splitAccountLabel(""), { code: "", name: "" });
  assert.deepEqual(splitAccountLabel("   "), { code: "", name: "" });
});

test("every coding in a real ledger resolves to a code", () => {
  // Taken from one book, which held both spellings at once.
  const real = [
    "485 Subscriptions", "200 Sales", "449 Motor Vehicle Expenses",
    "454 Instruction and school expenses", "310 Cost of Goods Sold",
    "489 Telephone & Internet", "980 Owner Drawings", "400 Advertising",
    "Accounts Receivable - 610", "425 Freight & Courier",
  ];
  const unresolved = real.filter((label) => splitAccountLabel(label).code === "");
  assert.deepEqual(unresolved, []);
});
