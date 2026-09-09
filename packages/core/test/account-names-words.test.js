import assert from "node:assert/strict";
import test from "node:test";
import { matchAccountName } from "../dist/index.js";

const known = [
  "Consulting & Accounting - 412",
  "Charitable Donation - Donation",
  "Travel - National - 493",
  "Entertainment - Non deductible - 424",
  "NB Sales - 200",
];

test("an account whose code is a word, not a number, still matches", () => {
  // Xero writes "<code> <name>", this app writes "<name> - <code>". With a
  // numeric code the number settles it; with a code like "Donation" there is
  // no number, and each spelling contains the other's code.
  assert.equal(
    matchAccountName("Donation Charitable Donation", known),
    "Charitable Donation - Donation",
  );
});

test("a numeric code is still matched by its number", () => {
  assert.equal(matchAccountName("412 Consulting & Accounting", known), "Consulting & Accounting - 412");
  assert.equal(matchAccountName("200 Sales", known), "NB Sales - 200");
});

test("a name containing the separator is not cut in half", () => {
  // "Travel - National" and "Entertainment - Non deductible" are real account
  // names. A matcher that stripped everything after a dash would merge them
  // with anything else beginning the same way.
  assert.equal(matchAccountName("493 Travel - National", known), "Travel - National - 493");
  assert.equal(matchAccountName("Travel - National", known), "Travel - National - 493");
  assert.equal(
    matchAccountName("424 Entertainment - Non deductible", known),
    "Entertainment - Non deductible - 424",
  );
});

test("an account nothing knows about is still null", () => {
  assert.equal(matchAccountName("Rates and Insurance", known), null);
  assert.equal(matchAccountName("", known), null);
  assert.equal(matchAccountName("   ", known), null);
});

test("the word order fallback does not merge different accounts", () => {
  // Same words would be needed, not merely some of them.
  assert.equal(matchAccountName("National Travel Expenses", known), null);
  assert.equal(matchAccountName("Donation", known), null);
});
