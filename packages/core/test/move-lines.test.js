import { test } from "node:test";
import assert from "node:assert/strict";
import { lineKey, moveLines, moveStillHolds, restoreMove } from "../dist/index.js";

function books() {
  return {
    overrides: {
      t2: { code: "Advertising - 400", contact: "Meta", treatment: "taxable", note: "Facebook ads", confirmed: true },
    },
    splits: {
      t3: [
        { amount: -3_000, code: "Advertising - 400", note: "ads" },
        { amount: -2_000, code: "Entertainment - 420", note: "lunch" },
      ],
    },
    manualJournals: [
      { id: "j1", date: "2026-08-01", narration: "Accrual", lines: [{ code: "Advertising - 400", amount: 5_000 }, { code: "Accruals - 820", amount: -5_000 }] },
      { id: "j2", date: "2026-08-02", narration: "Gone", lines: [{ code: "Advertising - 400", amount: 100 }, { code: "Bank - 090", amount: -100 }], deleted: { at: "2026-08-03", by: "x" } },
    ],
    invoices: [
      {
        number: "BILL-1", kind: "purchase", contact: "Print Co", reference: "", issued: "2026-08-04", due: null,
        lines: [
          { description: "Flyers", accountCode: "400", taxType: "15% GST on Expenses", net: 1_000, tax: 150, gross: 1_150 },
          { description: "Postage", accountCode: "425", taxType: "15% GST on Expenses", net: 500, tax: 75, gross: 575 },
        ],
        total: 1_725, paid: 0, outstanding: 1_725,
      },
      { number: "BILL-1", kind: "sales", contact: "Not this one", reference: "", issued: "2026-08-04", due: null, lines: [{ description: "x", accountCode: "400", taxType: "", net: 1, tax: 0, gross: 1 }], total: 1, paid: 0, outstanding: 1 },
    ],
  };
}

const target = { label: "Marketing - 401", code: "401" };
const refs = [
  { kind: "bank", id: "t1" },
  { kind: "bank", id: "t2" },
  { kind: "split", id: "t3", part: 0 },
  { kind: "journal", id: "j1", line: 0 },
  { kind: "invoice", invoiceKind: "purchase", number: "BILL-1", line: 0 },
];

test("each kind of line is moved where it is kept", () => {
  const start = books();
  const result = moveLines(start, refs, target, "Moved to Marketing", "2026-10-25");
  assert.equal(result.moved, 5);
  const b = result.books;
  // A rule-coded bank line gets a coding of its own; a hand-coded one keeps its contact and GST.
  assert.deepEqual(b.overrides.t1, { code: "Marketing - 401", confirmed: true, note: "Moved to Marketing", at: "2026-10-25" });
  assert.equal(b.overrides.t2.code, "Marketing - 401");
  assert.equal(b.overrides.t2.contact, "Meta");
  assert.equal(b.overrides.t2.treatment, "taxable");
  // Only the part chosen.
  assert.deepEqual(b.splits.t3.map((p) => p.code), ["Marketing - 401", "Entertainment - 420"]);
  assert.deepEqual(b.manualJournals[0].lines.map((l) => l.code), ["Marketing - 401", "Accruals - 820"]);
  // Documents keep the bare code, and only the bill, not the sale of the same number.
  assert.deepEqual(b.invoices[0].lines.map((l) => l.accountCode), ["401", "425"]);
  assert.equal(b.invoices[1].lines[0].accountCode, "400");
  // Nothing given in was changed in place.
  assert.equal(start.overrides.t2.code, "Advertising - 400");
  assert.equal(start.splits.t3[0].code, "Advertising - 400");
  assert.equal(start.invoices[0].lines[0].accountCode, "400");
});

test("a deleted journal, or a line that is not there, is left alone", () => {
  const result = moveLines(books(), [{ kind: "journal", id: "j2", line: 0 }, { kind: "split", id: "t3", part: 9 }, { kind: "invoice", invoiceKind: "purchase", number: "NOPE", line: 0 }], target, "x", "2026-10-25");
  assert.equal(result.moved, 0);
  assert.deepEqual(result.before, { overrides: {}, splits: {}, journals: {}, invoices: {} });
});

test("undone, every item is as it was, and a change made since elsewhere stays", () => {
  const start = books();
  const result = moveLines(start, refs, target, "Moved", "2026-10-25");
  // Something unrelated changed afterwards.
  const later = { ...result.books, overrides: { ...result.books.overrides, t9: { code: "Rent - 469", note: "rent" } } };
  assert.ok(moveStillHolds(later, result.after));
  const back = restoreMove(later, result.before);
  assert.equal(back.overrides.t1, undefined, "the coding the move made is gone");
  assert.deepEqual(back.overrides.t2, start.overrides.t2);
  assert.deepEqual(back.splits.t3, start.splits.t3);
  assert.deepEqual(back.manualJournals, start.manualJournals);
  assert.deepEqual(back.invoices, start.invoices);
  assert.equal(back.overrides.t9.code, "Rent - 469");
});

test("once a moved item is changed again, the move no longer holds", () => {
  const result = moveLines(books(), refs, target, "Moved", "2026-10-25");
  const changed = { ...result.books, overrides: { ...result.books.overrides, t1: { code: "Rent - 469", note: "again" } } };
  assert.equal(moveStillHolds(changed, result.after), false);
  const bill = result.books.invoices.map((i, n) => (n === 0 ? { ...i, lines: i.lines.map((l, k) => (k === 0 ? { ...l, accountCode: "469" } : l)) } : i));
  assert.equal(moveStillHolds({ ...result.books, invoices: bill }, result.after), false);
});

test("one key a line", () => {
  assert.equal(lineKey({ kind: "split", id: "t3", part: 1 }), "split:t3:1");
  assert.equal(lineKey({ kind: "invoice", invoiceKind: "purchase", number: "BILL-1", line: 0 }), "invoice:purchase:BILL-1:0");
  assert.notEqual(lineKey({ kind: "bank", id: "a" }), lineKey({ kind: "journal", id: "a", line: 0 }));
});

test("undone after the bill was paid and the coding gained details: only the accounts go back", () => {
  const start = books();
  const result = moveLines(start, refs, target, "Moved", "2026-10-25");
  const paid = result.books.invoices.map((i, n) => (n === 0 ? { ...i, paid: 1_725, outstanding: 0 } : i));
  const added = { ...result.books.overrides, t1: { ...result.books.overrides.t1, between: "kea" }, t2: { ...result.books.overrides.t2, between: "kea" } };
  const later = { ...result.books, invoices: paid, overrides: added };
  assert.ok(moveStillHolds(later, result.after), "details added are not a recoding");
  const back = restoreMove(later, result.before);
  assert.equal(back.invoices[0].paid, 1_725, "the payment stays");
  assert.deepEqual(back.invoices[0].lines.map((l) => l.accountCode), ["400", "425"]);
  assert.equal(back.overrides.t1, undefined);
  assert.equal(back.overrides.t2.code, "Advertising - 400");
  assert.equal(back.overrides.t2.note, "Facebook ads");
  assert.equal(back.overrides.t2.between, "kea");
  assert.equal(back.overrides.t2.at, undefined, "no time the move set is left behind");
});
