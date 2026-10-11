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
