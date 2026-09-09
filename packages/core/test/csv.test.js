import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCsv,
  parseCsvRecords,
  findHeaderRow,
  normaliseAccountNumber,
  accountId,
} from "../dist/index.js";

test("parses quoted fields with embedded commas, quotes and newlines", () => {
  const rows = parseCsv('a,"b,c",d\n"say ""hi""","line1\nline2",z\n');
  assert.deepEqual(rows, [
    ["a", "b,c", "d"],
    ['say "hi"', "line1\nline2", "z"],
  ]);
});

test("treats a mid-field quote as literal text", () => {
  // `5" pipe` is a product description, not a broken quoted field.
  assert.deepEqual(parseCsv("PLUMBING,5\" pipe,12.00\n"), [["PLUMBING", '5" pipe', "12.00"]]);
});

test("strips a UTF-8 BOM so the first header still matches", () => {
  const rows = parseCsv("﻿Date,Amount\n01/07/2024,-1.00\n");
  assert.equal(rows[0][0], "Date");
});

test("handles CRLF, LF and a missing trailing newline", () => {
  assert.deepEqual(parseCsv("a,b\r\nc,d\r\n"), [["a", "b"], ["c", "d"]]);
  assert.deepEqual(parseCsv("a,b\nc,d"), [["a", "b"], ["c", "d"]]);
});

test("detects semicolon and tab delimiters", () => {
  assert.deepEqual(parseCsv("a;b;c\n1;2;3\n"), [["a", "b", "c"], ["1", "2", "3"]]);
  assert.deepEqual(parseCsv("a\tb\tc\n1\t2\t3\n"), [["a", "b", "c"], ["1", "2", "3"]]);
});

test("skips blank rows but keeps rows of empty fields with content elsewhere", () => {
  assert.deepEqual(parseCsv("a,b\n\n,\nc,d\n"), [["a", "b"], ["c", "d"]]);
});

test("finds the header row beneath an export preamble", () => {
  const records = parseCsvRecords(
    [
      "ANZ Home Loan statement",
      "Account 01-0100-0100000-00",
      "",
      "Date,Details,Amount,PrincipalBalance",
      "01/06/2024,Loan Drawdown,-100000.00,100000.00",
    ].join("\n"),
  );

  const header = findHeaderRow(records, ["Date", "Details", "Amount"]);
  assert.equal(header.index, 2);
  assert.equal(header.columns.get("principalbalance"), 3);
  // The blank line before the header is dropped from the records, so the row
  // index is 2 while the physical line is 4. Problems must cite the line.
  assert.equal(records[header.index].line, 4);
  assert.equal(records[header.index + 1].line, 5);
});

test("matches header names ignoring case, spaces and punctuation", () => {
  const records = parseCsvRecords("  Other Party Account , Tran Type \nx,y\n");
  const header = findHeaderRow(records, ["otherpartyaccount", "TRAN TYPE"]);
  assert.equal(header.index, 0);
  assert.equal(header.columns.get("otherpartyaccount"), 0);
});

test("returns null when a required column is absent", () => {
  const records = parseCsvRecords("Date,Amount\n01/07/2024,-1.00\n");
  assert.equal(findHeaderRow(records, ["Date", "Amount", "This Party Account"]), null);
});

test("pads NZ account suffixes so one account stays one account", () => {
  // The same account, written two ways by two different BNZ exports.
  assert.equal(normaliseAccountNumber("02-1100-0022002-02"), "02-1100-0022002-002");
  assert.equal(normaliseAccountNumber("02-1100-0022002-002"), "02-1100-0022002-002");
  assert.equal(
    normaliseAccountNumber("02-1100-0022002-02"),
    normaliseAccountNumber("02-1100-0022002-002"),
  );
});

test("leaves non-NZ account identifiers alone", () => {
  assert.equal(normaliseAccountNumber("---"), "---");
  assert.equal(normaliseAccountNumber("GB33BUKB20201555555555"), "GB33BUKB20201555555555");
  assert.equal(normaliseAccountNumber(""), "");
});

test("prefers the account number over the label when building an id", () => {
  assert.equal(accountId("Spending", "02-1100-0022001-00"), "02-1100-0022001-000");
  assert.equal(accountId("BNZ Advantage Visa Platinum"), "bnz-advantage-visa-platinum");
  assert.equal(accountId(""), "unknown");
});

test("keeps line numbers honest across blank rows and quoted newlines", () => {
  // Row 2 is blank and row 3 spans two physical lines, so neither the array
  // index nor a naive newline count would give the right answer here.
  const records = parseCsvRecords('a,b\n\n"multi\nline",c\nd,e\n');

  assert.deepEqual(
    records.map((record) => record.line),
    [1, 3, 5],
  );
  assert.equal(records[1].fields[0], "multi\nline");
});
