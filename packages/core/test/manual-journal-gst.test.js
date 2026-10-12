import test from "node:test";
import assert from "node:assert/strict";
import { postManualJournal, taxSummary } from "../dist/index.js";

const refund = (gst) => ({
  id: "g1",
  date: "2025-04-01",
  narration: "Google One refund the card feed missed",
  lines: [
    { code: "BNZ Visa", amount: 3182 },
    { code: "485", amount: -3182, ...(gst ? { gst } : {}) },
  ],
});

test("a journal line is no GST unless it says otherwise, and reaches no box", () => {
  const posted = postManualJournal(refund(undefined));
  assert.deepEqual(posted.lines.map((l) => [l.accountCode, l.amount, l.taxType]), [
    ["BNZ Visa", 3182, "NONE"],
    ["485", -3182, "NONE"],
  ]);
  const boxes = taxSummary([posted], { basis: "invoice" });
  assert.equal(boxes.box11, 0);
  assert.equal(boxes.box12, 0);
});

test("a refund with GST on expenses: the account net, the GST beside it, and the return reduced", () => {
  const posted = postManualJournal(refund("INPUT2"));
  assert.deepEqual(posted.lines.map((l) => [l.accountCode, l.amount, l.taxType]), [
    ["BNZ Visa", 3182, "NONE"],
    ["485", -2767, "INPUT2"],
    ["820", -415, "INPUT2"],
  ]);
  assert.equal(posted.lines.reduce((s, l) => s + l.amount, 0), 0);
  for (const basis of ["invoice", "payments"]) {
    const boxes = taxSummary([posted], { basis });
    assert.equal(boxes.box11, -3182, `purchases less the refund, ${basis} basis`);
    assert.equal(boxes.box12, -415, `GST claimed less the refund's, ${basis} basis`);
  }
});

test("GST on income: a sale no bank line shows", () => {
  const posted = postManualJournal({
    id: "s1",
    date: "2025-05-01",
    narration: "Cash sale banked with the owner's own money",
    lines: [
      { code: "Owner Funds Introduced", amount: 11500 },
      { code: "200", amount: -11500, gst: "OUTPUT2" },
    ],
  });
  const boxes = taxSummary([posted], { basis: "payments" });
  assert.equal(boxes.box5, 11500);
  assert.equal(boxes.box8, 1500);
});
