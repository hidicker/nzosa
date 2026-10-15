import { test } from "node:test";
import assert from "node:assert/strict";
import { detect, identifyExport, importFile, isQuickBooksBankExport, quickBooksBankCoding } from "../dist/index.js";

// QuickBooks Online's bank register export, as its sample company gives it.
const FILE = [
  "Date,Bank description,Spent,Received,From/To,Match/Categorize",
  '"11/13/2026","Books By Bessie","","$55.00","",""',
  '"10/14/2026","A Rental","$1,200.00","","","Equipment Rental"',
  '"09/18/2026","Hicks Hardware","$228.75","","Hicks Hardware","Supplies"',
  '"09/10/2026","Chin\'s Gas","$185.00","","Chin\'s Gas and Oil","Automobile:Fuel"',
].join("\r\n");

test("QuickBooks' bank register is a bank file", () => {
  assert.equal(isQuickBooksBankExport(FILE), true);
  assert.equal(detect(FILE)?.importer, "quickbooks-bank");
  assert.equal(identifyExport(FILE).kind, "bank");
});

test("its lines, money out as minus, the dates month first as the file shows", () => {
  const read = importFile(FILE, { file: "checking.csv", account: "checking", defaultCurrency: "USD" });
  assert.deepEqual(
    read.transactions.map((t) => [t.date, t.amount, t.otherParty]),
    [
      ["2026-11-13", 5500, "Books By Bessie"],
      ["2026-10-14", -120000, "A Rental"],
      ["2026-09-18", -22875, "Hicks Hardware"],
      ["2026-09-10", -18500, "Chin's Gas and Oil"],
    ],
  );
});

test("the account QuickBooks put each line to is its coding", () => {
  assert.deepEqual(
    quickBooksBankCoding(FILE, "checking.csv").map((r) => [r.date, r.amount, r.code]),
    [
      ["2026-10-14", -120000, "Equipment Rental"],
      ["2026-09-18", -22875, "Supplies"],
      ["2026-09-10", -18500, "Automobile:Fuel"],
    ],
  );
});
