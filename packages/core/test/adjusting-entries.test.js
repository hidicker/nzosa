import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adjustingEntries,
  adjustingEntriesCsv,
  isAdjustingEntry,
  postManualJournal,
  reversalOf,
  withoutAdjusting,
} from "../dist/index.js";

const accrual = {
  id: "a1",
  date: "2026-03-31",
  narration: "Accrue March power, invoiced in April",
  lines: [
    { code: "Power - 445", amount: 21000 },
    { code: "Accruals - 820", amount: -21000 },
  ],
  adjusting: true,
};
const plain = {
  id: "p1",
  date: "2026-02-10",
  narration: "Move a personal cost to drawings",
  lines: [
    { code: "Drawings - 980", amount: 5000 },
    { code: "General Expenses - 429", amount: -5000 },
  ],
};
const manual = [accrual, plain];
const bank = { transactionId: "t1", date: "2026-03-01", narration: "Sale", lines: [], source: "bank", taxBasis: "both" };
const vehicle = { transactionId: "ye:vehicle", date: "2026-03-31", narration: "Private use", lines: [], source: "adjustment", taxBasis: "payments" };
const posted = [bank, postManualJournal(accrual), postManualJournal(plain), vehicle];

test("a marked manual journal and a year-end adjustment are adjusting entries; others are not", () => {
  assert.deepEqual(
    posted.map((j) => isAdjustingEntry(j, manual)),
    [false, true, false, true],
  );
});

test("leaving them out keeps everything else", () => {
  assert.deepEqual(
    withoutAdjusting(posted, manual).map((j) => j.transactionId),
    ["t1", "manual:p1"],
  );
});

test("the list is the period's, oldest first", () => {
  assert.deepEqual(
    adjustingEntries(posted, manual, { from: "2025-04-01", to: "2026-03-31" }).map((j) => j.transactionId),
    ["manual:a1", "ye:vehicle"],
  );
  assert.deepEqual(adjustingEntries(posted, manual, { from: "2026-04-01", to: "2027-03-31" }), []);
});

test("a reversal of an adjusting entry is one too", () => {
  assert.equal(reversalOf(accrual, "2026-04-01", "r1").adjusting, true);
  assert.equal(reversalOf(plain, "2026-04-01", "r2").adjusting, undefined);
});

test("the CSV has a row per line, debits and credits apart, text quoted where it must be", () => {
  const csv = adjustingEntriesCsv([postManualJournal({ ...accrual, narration: 'Accrue "March", power' })]);
  assert.equal(
    csv,
    "Date,Narration,Kind,Account code,Account,Description,Debit,Credit\r\n" +
      '2026-03-31,"Accrue ""March"", power",Manual journal,Power - 445,Power - 445,"Accrue ""March"", power",210.00,\r\n' +
      '2026-03-31,"Accrue ""March"", power",Manual journal,Accruals - 820,Accruals - 820,"Accrue ""March"", power",,210.00\r\n',
  );
});
