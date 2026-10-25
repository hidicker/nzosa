import { test } from "node:test";
import assert from "node:assert/strict";
import { balanceSheetCsv, createZip, crc32, readZipFiles, trialBalanceCsv } from "../dist/index.js";

test("crc32 of a known string", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});

test("a zip written here reads back, names and bytes, UTF-8 names included", async () => {
  const files = [
    { name: "README.txt", data: new TextEncoder().encode("What is in here\r\n") },
    { name: "reports/Māori names.csv", data: new TextEncoder().encode("a,b\r\n1,2\r\n") },
    { name: "empty.csv", data: new Uint8Array(0) },
  ];
  const back = await readZipFiles(createZip(files, new Date(2026, 9, 25, 10, 30)));
  assert.deepEqual(
    back.map((f) => [f.name, new TextDecoder().decode(f.bytes)]),
    files.map((f) => [f.name, new TextDecoder().decode(f.data)]),
  );
});

test("the trial balance as CSV: debits and credits apart, zero rows left out, totals", () => {
  const csv = trialBalanceCsv(
    {
      rows: [
        { accountCode: "090", accountName: "Bank", balance: 50000, lines: 2 },
        { accountCode: "200", accountName: "Sales, retail", balance: -50000, lines: 1 },
        { accountCode: "400", accountName: "Advertising", balance: 0, lines: 2 },
      ],
      imbalance: 0,
      unbalanced: [],
    },
    "Trial balance, FY2026",
  );
  assert.equal(
    csv,
    '"Trial balance, FY2026"\r\n\r\nCode,Account,Debit,Credit\r\n090,Bank,500.00,\r\n200,"Sales, retail",,500.00\r\n,Total,500.00,500.00\r\n',
  );
});

test("the balance sheet as CSV: each section's lines and total, and the proof", () => {
  const section = (title, lines) => ({ title, lines, total: lines.reduce((s, l) => s + l.closing, 0) });
  const sheet = {
    asAt: "2026-03-31",
    openingFrom: null,
    currentAssets: section("Current assets", [{ code: "090", name: "Bank", opening: 0, movement: 1000, closing: 1000 }]),
    nonCurrentAssets: section("Non-current assets", []),
    totalAssets: 1000,
    currentLiabilities: section("Current liabilities", []),
    nonCurrentLiabilities: section("Non-current liabilities", []),
    totalLiabilities: 0,
    netAssets: 1000,
    equity: section("Equity", [{ code: "960", name: "Retained earnings", opening: 0, movement: 1000, closing: 1000 }]),
    totalEquity: 1000,
    profitForPeriod: 1000,
    imbalance: 0,
  };
  const csv = balanceSheetCsv(sheet);
  assert.match(csv, /^Balance sheet as at 2026-03-31\r\n/);
  assert.match(csv, /\r\nCurrent assets,090,Bank,0\.00,10\.00,10\.00\r\n/);
  assert.match(csv, /\r\n,,Net assets,,,10\.00\r\n/);
  assert.doesNotMatch(csv, /Out of balance/);
});
