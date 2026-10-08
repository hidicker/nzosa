import assert from "node:assert/strict";
import test from "node:test";
import {
  checkAgainstSheetTotals,
  checkPrompt,
  conversionPrompt,
  joinConversions,
  lineTotals,
  readCheckAnswer,
  readConversionAnswer,
  sheetLinesToReference,
  sheetLinesToTransactions,
  sheetParts,
} from "../dist/index.js";

// An invented rental cashbook: a title row, headings on row 3, a column per
// category, and a total row at the foot.
const rental = {
  name: "Rimu Lane 2025",
  rows: [
    ["Rimu Lane rental cashbook"],
    [],
    ["Date", "Details", "Rent", "Rates", "Insurance", "Repairs"],
    ["3/04/2025", "Tenant rent", "2400", "", "", ""],
    ["10/04/2025", "Council rates", "", "-812.50", "", ""],
    ["22/04/2025", "Totara Insure", "", "", "-120.00", ""],
    ["2/05/2025", "Tenant rent", "2400", "", "", ""],
    ["Total", "", "4800", "-812.50", "-120.00", "0"],
  ],
};

test("a spreadsheet in parts, each with its headings, numbered as the sheet is", () => {
  const big = { name: "Long", rows: [["Date", "Amount", "What"], ...Array.from({ length: 12 }, (_, i) => [`${i + 1}/06/2025`, "-1", "Fees"])] };
  const parts = sheetParts([rental, big], 5);
  assert.equal(parts[0].of, parts.length);
  assert.match(parts[0].text, /^=== Sheet: Rimu Lane 2025 ===/);
  assert.match(parts[0].text, /^3\| Date,Details,Rent/m, "row numbers are the sheet's own, blank rows aside");
  assert.doesNotMatch(parts[0].text, /^2\|/m);
  const long = parts.filter((p) => p.text.includes("Sheet: Long"));
  assert.equal(long.length, 2, "13 rows: 5 kept as headings, then 8 cut every 5");
  assert.match(long[1].text, /^1\| Date,Amount,What/m, "the headings repeated");
  assert.match(conversionPrompt(parts[0]), /POSITIVE for money in and NEGATIVE for money out/);
});

const answer = JSON.stringify({
  lines: [
    { sheet: "Rimu Lane 2025", row: 4, date: "2025-04-03", amount: 2400, description: "Tenant rent", category: "Rent" },
    { sheet: "Rimu Lane 2025", row: 5, date: "2025-04-10", amount: -812.5, description: "Council rates", category: "Rates" },
    { sheet: "Rimu Lane 2025", row: 6, date: "2025-04-22", amount: -120, description: "Totara Insure", category: "Insurance", otherParty: "Totara Insure" },
    { sheet: "Rimu Lane 2025", row: 7, date: "2025-05-02", amount: 2400, description: "Tenant rent", category: "Rent" },
    { sheet: "Rimu Lane 2025", row: 99, date: "2025-13-40", amount: 5, description: "bad", category: "Rent" },
  ],
  totals: [
    { sheet: "Rimu Lane 2025", row: 8, label: "Total Rent", amount: 4800, covers: "category", category: "Rent" },
    { sheet: "Rimu Lane 2025", row: 8, label: "Total Rates", amount: -812.5, covers: "category", category: "Rates" },
    { sheet: "Rimu Lane 2025", row: 8, label: "Total Repairs", amount: 50, covers: "category", category: "Repairs" },
  ],
  skipped: [{ sheet: "Rimu Lane 2025", row: 1, reason: "title" }],
  notes: "One column per category.",
});

test("an answer is read, fences and chatter aside, and a bad line is named not kept", () => {
  const read = readConversionAnswer("Here you go:\n```json\n" + answer + "\n```");
  assert.equal(read.lines.length, 4);
  assert.equal(read.lines[1].amount, -81250);
  assert.equal(read.lines[2].bankFields.otherParty, "Totara Insure");
  assert.equal(read.problems.length, 1);
  assert.match(read.problems[0], /row 99/);
  assert.equal(read.totals.length, 3);
  assert.equal(read.skipped[0].reason, "title");
});

test("totals by category and month, and against the sheet's own", () => {
  const read = readConversionAnswer(answer);
  const totals = lineTotals(read.lines);
  assert.equal(totals.count, 4);
  assert.equal(totals.in, 480000);
  assert.equal(totals.out, -93250);
  assert.equal(totals.byCategory.get("Rent"), 480000);
  assert.equal(totals.byMonth.get("2025-04"), 146750);
  const checks = checkAgainstSheetTotals(read.lines, read.totals);
  assert.deepEqual(checks.map((c) => c.agrees), [true, true, false], "Repairs: the sheet says 50, the lines nothing");
});

test("too big, said and not guessed; parts joined", () => {
  const big = readConversionAnswer(JSON.stringify({ tooBig: true, lines: [], notes: "Split at row 400." }));
  assert.equal(big.tooBig, true);
  assert.equal(big.problems.length, 0);
  const joined = joinConversions([readConversionAnswer(answer), big]);
  assert.equal(joined.tooBig, true);
  assert.equal(joined.lines.length, 4);
  assert.match(joined.problems[0], /^Part 1:/);
});

test("the check: its prompt gives our totals, and its answer is read", () => {
  const totals = lineTotals(readConversionAnswer(answer).lines);
  const prompt = checkPrompt(sheetParts([rental])[0].text, totals);
  assert.match(prompt, /Rent: 4800\.00/);
  assert.match(prompt, /2025-04: 1467\.50/);
  assert.match(prompt, /^5\| 10\/04\/2025,Council rates/m, "the whole sheet goes with it");
  const read = readCheckAnswer(
    JSON.stringify({ agrees: true, differences: [{ what: "category Repairs", sheet: 50, given: 0, rows: [9], note: "missed" }] }),
  );
  assert.equal(read.agrees, false, "a difference listed means it does not agree, whatever it says");
  assert.equal(read.differences[0].sheet, 5000);
  assert.equal(read.differences[0].rows, "9");
  assert.equal(readCheckAnswer("no json here").problems.length, 1);
});

test("lines as coded history, or as transactions", () => {
  const lines = readConversionAnswer(answer).lines;
  const reference = sheetLinesToReference(lines, "rimu.xlsx");
  assert.equal(reference.length, 4);
  assert.equal(reference[0].code, "Rent");
  assert.equal(reference[2].contact, "Totara Insure");
  const transactions = sheetLinesToTransactions(lines, "cash", "rimu.xlsx");
  assert.equal(transactions[1].account, "cash");
  assert.equal(transactions[1].amount, -81250);
  assert.equal(transactions[1].extras.sheetCategory, "Rates");
});

test("the JSON is found even with a paragraph after it, braces and all", () => {
  const read = readCheckAnswer('{"agrees": true, "differences": [], "notes": "fine {really}"}\n\nNote: totals like {Rent: 4800} matched.');
  assert.equal(read.problems.length, 0);
  assert.equal(read.agrees, true);
  assert.match(readCheckAnswer('{"agrees": true, "differences": [').problems[0], /cut off/);
});

test("a 'difference' with the same figure both ways is a confirmation, not a difference", () => {
  const read = readCheckAnswer(JSON.stringify({ agrees: false, differences: [{ what: "money out", sheet: -1587.25, given: -1587.25, note: "verified" }] }));
  assert.equal(read.differences.length, 0);
  assert.equal(read.agrees, true);
});
