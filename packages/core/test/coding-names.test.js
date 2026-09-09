import assert from "node:assert/strict";
import test from "node:test";
import { canonicalCodeFor, matchAccountName } from "../dist/coding-names.js";

const KNOWN = ["200", "200 - Sales", "NB Sales - 200", "NB Cost of Goods Sold - 310", "Sales"];

test("a real account name beats a bare number carrying the same code", () => {
  assert.equal(canonicalCodeFor("200", KNOWN), "NB Sales - 200");
});

test("the longest name wins among equals, so the fullest one is kept", () => {
  assert.equal(canonicalCodeFor("310", KNOWN), "NB Cost of Goods Sold - 310");
});

test("an account nothing codes to is not invented", () => {
  assert.equal(canonicalCodeFor("999", KNOWN), null);
  assert.equal(canonicalCodeFor("", KNOWN), null);
});

test("a label is matched by its number first", () => {
  assert.equal(matchAccountName("200 Sales", KNOWN), "NB Sales - 200");
  assert.equal(matchAccountName("610 Accounts Receivable", KNOWN), null);
});

test("a label with no number falls back to the name", () => {
  assert.equal(matchAccountName("Cost of Goods Sold", KNOWN), "NB Cost of Goods Sold - 310");
});

test("a number inside a larger number is not a match", () => {
  assert.equal(canonicalCodeFor("20", ["NB Sales - 200"]), null);
});

test("an account whose name begins with the house prefix matches itself", () => {
  // The prefix used to be stripped from the candidate but not from the label
  // being looked for, so a chart with a real account called "NB Power" could
  // not find it -- "power" was compared against "nb power".
  const known = ["NB Power - 445", "Cleaning - 408"];
  assert.equal(matchAccountName("NB Power", known), "NB Power - 445");
  assert.equal(matchAccountName("Power", known), "NB Power - 445");
  assert.equal(matchAccountName("Cleaning", known), "Cleaning - 408");
});

test("a chart that uses the prefix throughout is unaffected", () => {
  const known = ["NB Sales - 200", "NB Entertainment - 420"];
  assert.equal(matchAccountName("Sales", known), "NB Sales - 200");
  assert.equal(matchAccountName("NB Sales", known), "NB Sales - 200");
  assert.equal(matchAccountName("200", known), "NB Sales - 200");
  assert.equal(matchAccountName("Entertainment", known), "NB Entertainment - 420");
});
