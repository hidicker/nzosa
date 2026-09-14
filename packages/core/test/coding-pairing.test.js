import assert from "node:assert/strict";
import test from "node:test";
import { compareCodings, nameAgreement } from "../dist/index.js";

const txn = (id, date, amount, otherParty) => ({
  id, date, amount, account: "BNZ Visa", otherParty, particulars: "",
  code: "", reference: "", description: "", currency: "NZD", source: "bank",
});
const line = (date, amount, code, contact, description = "") => ({
  date, amount, code, label: code, source: "export.xlsx",
  account: "BNZ Visa", gstRate: "15% GST on Expenses", contact, description,
});
const CHART = [
  { code: "425", name: "Freight & Courier", type: "Expense", taxCode: "", description: "" },
  { code: "485", name: "Subscriptions", type: "Expense", taxCode: "", description: "" },
];

test("a name in common counts, and noise does not", () => {
  const t = txn("t", "2026-02-19", -2000, "RAPIDO COURIERS NZD2000");
  assert.ok(nameAgreement(line("2026-02-20", -2000, "425", "Rapido", "Rapido - Courier for a radio"), t) > 0);
  assert.equal(nameAgreement(line("2026-02-20", -2000, "485", "NZHGPA", "Membership"), t), 0);
});

test("a company suffix is not an agreement", () => {
  // Every second payee is a limited company; matching on "ltd" would rank
  // them all equally and settle nothing.
  const t = txn("t", "2026-02-19", -2000, "SOMEBODY LIMITED");
  assert.equal(nameAgreement(line("2026-02-20", -2000, "425", "Another Limited"), t), 0);
});

test("nothing to compare is no agreement, not a match", () => {
  const t = txn("t", "2026-02-19", -2000, "RAPIDO COURIERS");
  assert.equal(nameAgreement(line("2026-02-20", -2000, "425", ""), t), 0);
  assert.equal(nameAgreement(line("2026-02-20", -2000, "425", "Rapido"), txn("t", "2026-02-19", -2000, "")), 0);
});

test("the payee decides which reference a bank line gets, not the date", () => {
  // The real case: three 20.00 entries in one week. Taking the nearest date
  // gave the courier bill to a PayPal payment two days earlier and handed the
  // courier the membership subscription, and neither row could be settled by
  // anybody because each was compared against a bill it never was.
  const coded = [
    { transaction: txn("paypal1", "2026-02-17", -2000, "PayPal"), code: "485 Subscriptions" },
    { transaction: txn("rapido", "2026-02-19", -2000, "RAPIDO COURIERS NZD2000"), code: "425 Freight & Courier" },
    { transaction: txn("paypal2", "2026-02-22", -2000, "PayPal"), code: "485 Subscriptions" },
  ];
  const reference = [
    line("2026-02-20", -2000, "425 Freight & Courier", "Rapido", "Rapido - Courier for a radio"),
    line("2026-02-20", -2000, "485 Subscriptions", "NZHGPA", "NZHGPA - Membership"),
    line("2026-02-25", -2000, "485 Subscriptions", "NZHGPA", "NZHGPA - Membership"),
  ];
  const result = compareCodings(coded, reference, { chart: CHART });
  const all = [...result.agreed, ...result.differed];
  const forRapido = all.find((r) => r.transaction.id === "rapido");
  assert.equal(forRapido.theirs.contact, "Rapido", "the courier bill goes to the courier payment");
  assert.equal(result.differed.length, 0, "and then nothing disagrees at all");
});

test("an earlier line cannot take a reference that plainly belongs to a later one", () => {
  // The two passes have to see each other: settling names first is the whole
  // point, because the date pass is greedy and would have claimed it.
  const coded = [
    { transaction: txn("early", "2026-02-01", -5000, "SOMEONE ELSE"), code: "485 Subscriptions" },
    { transaction: txn("named", "2026-02-05", -5000, "KIWI FREIGHT CO"), code: "425 Freight & Courier" },
  ];
  const reference = [
    line("2026-02-02", -5000, "425 Freight & Courier", "Kiwi Freight", "Kiwi Freight - delivery"),
    line("2026-02-06", -5000, "485 Subscriptions", "Somebody", ""),
  ];
  const result = compareCodings(coded, reference, { chart: CHART });
  const all = [...result.agreed, ...result.differed];
  assert.equal(all.find((r) => r.transaction.id === "named").theirs.contact, "Kiwi Freight");
});

test("with nothing to go on it still pairs by date, as it always did", () => {
  // Older reference data carries no contact at all, and must keep working.
  const coded = [{ transaction: txn("t", "2026-02-19", -2000, "ANYONE"), code: "425 Freight & Courier" }];
  const reference = [
    { date: "2026-02-20", amount: -2000, code: "425 Freight & Courier",
      label: "425 Freight & Courier", source: "old.xlsx" },
  ];
  const result = compareCodings(coded, reference, { chart: CHART });
  assert.equal(result.agreed.length, 1);
});

test("a reference outside the window is still not used", () => {
  const coded = [{ transaction: txn("t", "2026-02-19", -2000, "RAPIDO"), code: "425 Freight & Courier" }];
  const reference = [line("2026-04-01", -2000, "425 Freight & Courier", "Rapido", "Rapido")];
  const result = compareCodings(coded, reference, { chart: CHART });
  assert.equal(result.unreferenced.length, 1, "a name agreeing does not widen the window");
  assert.equal(result.unmatched.length, 1);
});

test("one reference line is never given to two transactions", () => {
  const coded = [
    { transaction: txn("a", "2026-02-19", -2000, "RAPIDO COURIERS"), code: "425 Freight & Courier" },
    { transaction: txn("b", "2026-02-20", -2000, "RAPIDO COURIERS"), code: "425 Freight & Courier" },
  ];
  const reference = [line("2026-02-20", -2000, "425 Freight & Courier", "Rapido", "Rapido")];
  const result = compareCodings(coded, reference, { chart: CHART });
  assert.equal([...result.agreed, ...result.differed].length, 1);
  assert.equal(result.unreferenced.length, 1);
});
