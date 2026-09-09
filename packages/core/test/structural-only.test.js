import assert from "node:assert/strict";
import test from "node:test";
import { referenceFromJournals } from "../dist/index.js";

const line = (accountCode, accountName, amount) => ({
  accountCode, accountName, amount, description: "", gstRate: "", taxType: "",
});
const journal = (lines) => ({ id: "j", date: "2026-02-26", narration: "IRD", lines });

const isBank = (l) => l.accountCode === "" && /bank|bnz/i.test(l.accountName);
const isStructural = (l) => ["GST", "Accounts Receivable", "Accounts Payable", "Rounding"].includes(l.accountName);

test("a GST payment is coded to GST, not thrown away", () => {
  // The only posting other than the bank is the GST control account. Stripping
  // it as plumbing left nothing, and every GST payment vanished from the
  // reference -- so no rule could ever be learnt for the most predictable
  // payment a business makes.
  const out = referenceFromJournals(
    [journal([line("", "BNZ 01 - Trading Account", -195544), line("820", "GST", 195544)])],
    isBank, isStructural, "export.xlsx",
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].label, "820 GST");
  assert.equal(out[0].amount, -195544);
});

test("an ordinary purchase still ignores its GST line", () => {
  // Here GST *is* plumbing: the expense is what the payment was for, and
  // reporting it as a GST payment would be wrong.
  const out = referenceFromJournals(
    [journal([
      line("", "BNZ 01 - Trading Account", -23000),
      line("429", "Office Expenses", 20000),
      line("820", "GST", 3000),
    ])],
    isBank, isStructural, "export.xlsx",
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].label, "429 Office Expenses");
});

test("a receivable settled on its own is still the receivable", () => {
  const out = referenceFromJournals(
    [journal([line("", "BNZ 01 - Trading Account", 50000), line("610", "Accounts Receivable", -50000)])],
    isBank, isStructural, "export.xlsx",
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].label, "610 Accounts Receivable");
});

test("an entry with nothing but a bank line is still dropped", () => {
  const out = referenceFromJournals(
    [journal([line("", "BNZ 01 - Trading Account", -1000)])],
    isBank, isStructural, "export.xlsx",
  );
  assert.deepEqual(out, []);
});
