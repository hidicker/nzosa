import test from "node:test";
import assert from "node:assert/strict";
import { expenseClaimsFromJournals } from "../dist/index.js";

let n = 0;
const line = (accountCode, accountName, amount, description = "") => ({ accountCode, accountName, description, amount, line: n++ });
const journal = (id, date, narration, lines) => ({ id, date, narration, postedDate: null, postedBy: "", lines });

test("a claim is its costs, their GST and what is owed to the person", () => {
  const claims = expenseClaimsFromJournals([
    journal("378", "2026-08-07", "Aroha Smith", [
      line("493", "Travel - National", 1470, "Breakfast"),
      line("493", "Travel - National", 1565, "Parking"),
      line("820", "GST", 455),
      line("801", "Unpaid Expense Claims", -3490),
    ]),
    // Its repayment from the bank is not a claim.
    journal("383", "2026-08-07", "Payment: Aroha Smith", [
      line("801", "Unpaid Expense Claims", 3490),
      line("090", "Business Bank Account", -3490),
    ]),
  ]);
  assert.equal(claims.length, 1);
  const [claim] = claims;
  assert.equal(claim.kind, "purchase");
  assert.equal(claim.claim, true);
  assert.equal(claim.contact, "Aroha Smith");
  assert.equal(claim.total, 3490);
  assert.deepEqual(claim.lines.map((l) => [l.net, l.tax]), [[1470, 220], [1565, 235]]);
});

test("a claim Xero reversed and entered again is there once", () => {
  const posted = (id) => journal(id, "2026-09-22", "Aroha Smith", [
    line("710", "Office Equipment", 10083),
    line("820", "GST", 1512),
    line("801", "Unpaid Expense Claims", -11595),
  ]);
  const claims = expenseClaimsFromJournals([
    posted("473"),
    journal("477", "2026-09-22", "Reversed: Aroha Smith - Reversal of ID 473", [
      line("710", "Office Equipment", -10083),
      line("820", "GST", -1512),
      line("801", "Unpaid Expense Claims", 11595),
    ]),
    posted("478"),
  ]);
  assert.deepEqual(claims.map((c) => [c.number, c.total]), [["Aroha Smith/2026-09-22", 11595]]);
});

test("one dated before the books start is in the opening balance, not here", () => {
  const claims = expenseClaimsFromJournals(
    [journal("1", "2025-03-30", "Aroha Smith", [line("461", "Printing", 2565), line("820", "GST", 385), line("801", "Unpaid Expense Claims", -2950)])],
    "2025-04-01",
  );
  assert.equal(claims.length, 0);
});

test("a claim's GST goes only on the costs whose account carries GST", () => {
  const claimJournal = journal("500", "2026-10-01", "Aroha Smith", [
    line("400", "Advertising", 10000),
    line("493", "Travel - International", 5000),
    line("820", "GST", 1500),
    line("801", "Unpaid Expense Claims", -16500),
  ]);
  const carries = ({ accountCode }) => ({ "400": true, "493": false })[accountCode];
  const [claim] = expenseClaimsFromJournals([claimJournal], undefined, carries);
  assert.deepEqual(
    claim.lines.map((l) => [l.accountCode, l.net, l.tax, l.gross, l.taxType]),
    [
      ["400", 10000, 1500, 11500, "15% GST on Expenses"],
      ["493", 5000, 0, 5000, "No GST"],
    ],
  );
  assert.equal(claim.tax, 1500);
  assert.equal(claim.total, 16500);
  assert.equal(claim.lines.reduce((sum, l) => sum + l.gross, 0), 16500);
});

test("rounding is left to the last cost that carries GST", () => {
  const [claim] = expenseClaimsFromJournals(
    [
      journal("501", "2026-10-01", "Aroha Smith", [
        line("400", "Advertising", 1000),
        line("461", "Printing", 1000),
        line("493", "Travel - International", 333),
        line("404", "Bank Fees", 1000),
        line("820", "GST", 301),
        line("801", "Unpaid Expense Claims", -3634),
      ]),
    ],
    undefined,
    ({ accountCode }) => accountCode !== "404" && accountCode !== "461",
  );
  assert.deepEqual(claim.lines.map((l) => l.tax), [226, 0, 75, 0]);
  assert.equal(claim.lines.reduce((sum, l) => sum + l.tax, 0), 301);
  assert.equal(claim.lines.reduce((sum, l) => sum + l.gross, 0), 3634);
});

test("treatments that cannot account for the GST fall back to the even spread", () => {
  const claimJournal = journal("502", "2026-10-01", "Aroha Smith", [
    line("400", "Advertising", 10000),
    line("493", "Travel - International", 5000),
    line("820", "GST", 1500),
    line("801", "Unpaid Expense Claims", -16500),
  ]);
  const evenly = [[10000, 1000], [5000, 500]];
  const spread = (carries) => expenseClaimsFromJournals([claimJournal], undefined, carries)[0].lines.map((l) => [l.net, l.tax]);
  // Nothing passed, nothing said for one account, no account carrying GST,
  // and GST larger than the taxed cost could hold.
  assert.deepEqual(spread(undefined), evenly);
  assert.deepEqual(spread(({ accountCode }) => (accountCode === "400" ? true : undefined)), evenly);
  assert.deepEqual(spread(() => false), evenly);
  const small = journal("503", "2026-10-01", "Aroha Smith", [
    line("400", "Advertising", 1000),
    line("493", "Travel - International", 14000),
    line("820", "GST", 1500),
    line("801", "Unpaid Expense Claims", -16500),
  ]);
  const [claim] = expenseClaimsFromJournals([small], undefined, ({ accountCode }) => accountCode === "400");
  assert.deepEqual(claim.lines.map((l) => l.tax), [100, 1400]);
});
