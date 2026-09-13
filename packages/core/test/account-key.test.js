import assert from "node:assert/strict";
import test from "node:test";
import { accountKey, compareCodings } from "../dist/index.js";

const account = (code, name, type = "Expense") => ({
  code, name, type, taxCode: "No GST", description: "",
});

const CHART = [
  account("400", "Advertising"),
  account("Donation", "Charitable Donation"),
  account("", "Rimu Lane Rental Income", "Revenue"),
];

test("a numbered account is keyed on its number, whatever it is wrapped in", () => {
  assert.equal(accountKey("400 Advertising", CHART), "400");
  assert.equal(accountKey("Advertising - 400", CHART), "400");
  assert.equal(accountKey("Advertising", CHART), "400", "resolved through the chart");
});

test("an account whose code is a word is keyed on that word, in either arrangement", () => {
  // Nothing says a code has to be digits. This chart uses "Donation", and the
  // same account is written "Charitable Donation - Donation" by this ledger
  // and "Donation Charitable Donation" by the other system. Compared as
  // strings they differ for ever: the line is reported as a disagreement,
  // accepting the other coding writes the code already held, and the row comes
  // straight back. Nobody can settle it, which is worse than being wrong.
  const ours = accountKey("Charitable Donation - Donation", CHART);
  const theirs = accountKey("Donation Charitable Donation", CHART);
  assert.equal(ours, "Donation");
  assert.equal(theirs, "Donation");
  assert.equal(ours, theirs);
});

test("the bare name of a word-coded account resolves too", () => {
  assert.equal(accountKey("Charitable Donation", CHART), "Donation");
});

test("an account the chart has never heard of is keyed on itself", () => {
  assert.equal(accountKey("Something Else Entirely", CHART), "something else entirely");
});

test("nothing is not an account", () => {
  assert.equal(accountKey("", CHART), null);
  assert.equal(accountKey("   ", CHART), null);
});

test("a word-coded account no longer reads as a disagreement", () => {
  // The whole point: this row used to sit in `differed` and stay there.
  const transaction = {
    id: "t1", date: "2026-04-06", amount: -8034, account: "BNZ 01",
    otherParty: "FIFESHIRE FOUNDATION NELSON", particulars: "", code: "",
    reference: "", description: "", currency: "NZD", source: "bank",
  };
  const result = compareCodings(
    [{ transaction, code: "Charitable Donation - Donation" }],
    [{ date: "2026-04-06", amount: -8034, code: "Donation Charitable Donation",
       label: "Donation Charitable Donation", source: "xero.xlsx" }],
    { chart: CHART },
  );
  assert.equal(result.differed.length, 0, "they are the same account");
  assert.equal(result.agreed.length, 1);
});
