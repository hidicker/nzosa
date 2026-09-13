import assert from "node:assert/strict";
import test from "node:test";
import {
  feedResumeDate,
  mapToOurVocabulary,
  rateForTreatment,
  reportLabeller,
  reportLookups,
} from "../dist/index.js";

const account = (code, name, type = "Overhead") => ({
  code, name, type, taxCode: "No GST", description: "",
});

const CHART = [
  account("400", "Advertising"),
  account("200", "Sales", "Revenue"),
  account("", "Rimu Lane Rental Income", "Revenue"),
];

test("a line is named by its code where it has one", () => {
  const label = reportLabeller({ chart: CHART });
  assert.match(label({ accountCode: "400", accountName: "whatever" }), /Advertising/);
});

test("a line with no code is named by its name, not skipped", () => {
  // Not a fallback nobody reaches: three rentals whose accounts are all named
  // rather than numbered produced empty labels, and a report skips lines it
  // cannot name -- so they had nothing in their reports and nothing said why.
  const label = reportLabeller({ chart: CHART });
  const named = label({ accountCode: "", accountName: "Rimu Lane Rental Income" });
  assert.ok(named.includes("Rimu Lane"), named);
  assert.notEqual(named.trim(), "");
});

test("an account the chart has never heard of still gets a label", () => {
  const label = reportLabeller({ chart: CHART });
  assert.equal(label({ accountCode: "999", accountName: "Mystery" }), "999 Mystery");
  assert.equal(label({ accountCode: "", accountName: "Just a name" }), "Just a name");
});

test("each code is placed in a report section and against an entity", () => {
  const lookups = reportLookups({
    model: { entities: [], accounts: { "400": "acme" }, banks: {} },
    accounts: [{ account: account("400", "Advertising"), label: "Advertising - 400" }],
  });
  assert.equal(lookups.entityOfCode.get("Advertising - 400"), "acme");
  assert.equal(lookups.sectionOf("Advertising - 400"), "expenses");
  assert.equal(lookups.sectionOf("never heard of it"), null);
});

test("a code we already know is returned as it stands", () => {
  assert.equal(mapToOurVocabulary("400", { chart: CHART, overrides: { a: { code: "400" } } }), "400");
});

test("the chart counts as something we know about", () => {
  // Every account on a freshly imported chart is one nothing has been coded to
  // yet. Treating those as unknown refused the other system's coding for them,
  // advising the user to set up what was already set up.
  //
  // And the answer is our wording, not theirs: "Advertising" comes back as
  // "Advertising - 400", which is what everything downstream keys on.
  assert.equal(mapToOurVocabulary("Advertising", { chart: CHART }), "Advertising - 400");
});

test("a name nothing in the chart resembles has no answer", () => {
  assert.equal(mapToOurVocabulary("Quite Unlike Anything", { chart: CHART }), null);
});

test("a rate is shown only where there is one to show", () => {
  // Exempt and zero-rated are neither 15% nor out of scope. Reporting them as
  // 15% would let looking at a page quietly change what they are.
  assert.equal(rateForTreatment("standard"), "15");
  assert.equal(rateForTreatment("out-of-scope"), "0");
  assert.equal(rateForTreatment("zero-rated"), "zero-rated");
  assert.equal(rateForTreatment("exempt"), "exempt");
  assert.equal(rateForTreatment(undefined), null);
});

test("a line that is entirely GST reads as 100%", () => {
  assert.equal(rateForTreatment({ treatment: "standard", side: "imports" }), "100");
});

const txn = (account, date) => ({
  id: account + date, date, account, amount: 100, otherParty: "", particulars: "",
  code: "", reference: "", description: "", currency: "NZD", source: "bank",
});

test("nothing is mapped, so there is nowhere to resume from", () => {
  assert.equal(feedResumeDate({ mapping: {}, transactions: [] }), undefined);
  assert.equal(feedResumeDate({ mapping: { feedA: "" }, transactions: [] }), undefined);
});

test("a mapped account with no transactions yet gives no date at all", () => {
  // There is no "resume" for an account that has not started, and guessing
  // would quietly decide how much history it gets.
  assert.equal(
    feedResumeDate({ mapping: { feedA: "BNZ 01" }, transactions: [] }),
    undefined,
  );
});

test("it resumes a week before the earliest-ending account", () => {
  // One fetch covers every account, so starting where the furthest-ahead one
  // ends would skip whatever the others are missing.
  const found = feedResumeDate({
    mapping: { a: "BNZ 01", b: "BNZ Visa" },
    transactions: [txn("BNZ 01", "2026-03-20"), txn("BNZ Visa", "2026-03-10")],
  });
  assert.equal(found, "2026-03-03", "a week before 10 March, not before the 20th");
});

test("the overlap is deliberate, and adjustable", () => {
  // A card charge settles after the date it carries, so resuming exactly where
  // an account ends steps over what is still arriving. A duplicate is caught;
  // a gap is not.
  const on = { mapping: { a: "BNZ 01" }, transactions: [txn("BNZ 01", "2026-03-10")] };
  assert.equal(feedResumeDate({ ...on, overlapDays: 0 }), "2026-03-10");
  assert.equal(feedResumeDate({ ...on, overlapDays: 30 }), "2026-02-08");
});
