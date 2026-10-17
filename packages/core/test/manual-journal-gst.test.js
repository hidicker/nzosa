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

// The page draws a GST-inclusive line as its net and its GST; it must be what is posted.
test("splitManualGst gives the net and GST that the journal posts", async () => {
  const { splitManualGst, postManualJournal } = await import("../dist/index.js");
  assert.deepEqual(splitManualGst(-3182), { net: -2767, tax: -415 });
  assert.deepEqual(splitManualGst(3182), { net: 2767, tax: 415 });
  const posted = postManualJournal({
    id: "g1",
    date: "2025-04-01",
    narration: "From Xero: Google - 10 Jan 2025 Google One Received",
    lines: [
      { code: "BNZ Visa - Business Card", amount: 3182 },
      { code: "Subscriptions - 485", amount: -3182, gst: "INPUT2" },
    ],
  });
  const amounts = posted.lines.map((l) => l.amount);
  assert.deepEqual(amounts, [3182, -2767, -415]);
  assert.equal(amounts.reduce((a, b) => a + b, 0), 0);
});

test("a journal's GST is the books' rate: one eleventh in Australia, 3/23 in New Zealand", async () => {
  const { setSalesTaxFraction, splitManualGst, NZ_GST } = await import("../dist/index.js");
  assert.deepEqual(splitManualGst(-11000), { net: -9565, tax: -1435 });
  setSalesTaxFraction({ num: 1, den: 11 });
  try {
    assert.deepEqual(splitManualGst(-11000), { net: -10000, tax: -1000 });
    assert.deepEqual(splitManualGst(5000), { net: 4545, tax: 455 });
  } finally {
    setSalesTaxFraction(NZ_GST);
  }
});

test("a journal's GST is on the return for the journal's date, as Xero's cash basis default has it", async () => {
  const { journalGstFor, gstReturn } = await import("../dist/index.js");
  const journals = [
    refund("INPUT2"),
    {
      id: "s1",
      date: "2025-05-10",
      narration: "Sale the bank feed missed",
      lines: [
        { code: "BNZ Visa", amount: 2300 },
        { code: "200", amount: -2300, gst: "OUTPUT2" },
      ],
    },
    { ...refund("INPUT2"), id: "late", date: "2025-07-01" },
    { ...refund("INPUT2"), id: "gone", deleted: { at: "2025-05-01", by: "me" } },
  ];
  const period = { from: "2025-04-01", to: "2025-05-31" };
  const { purchases, sales } = journalGstFor(journals, period);
  // The refund is a credit on expenses: it reduces purchases.
  assert.deepEqual(purchases.map((p) => [p.gross, p.gst]), [[-3182, -415]]);
  assert.deepEqual(sales.map((p) => [p.gross, p.gst]), [[2300, 300]]);
  const ret = gstReturn([], period, { resolve: () => ({ treatment: "out-of-scope", side: "none" }), basis: "payments", otherPurchases: purchases, otherSales: sales });
  assert.equal(ret.boxes.box5, 2300);
  assert.equal(ret.boxes.box8, 300);
  assert.equal(ret.boxes.box12, -415);
});
