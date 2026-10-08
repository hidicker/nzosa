import assert from "node:assert/strict";
import test from "node:test";
import { bankFieldScore, compareCodings, dedupeReference, nameAgreement } from "../dist/index.js";

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
  assert.equal(nameAgreement(line("2026-02-20", -2000, "485", "NZSOCC", "Membership"), t), 0);
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
    line("2026-02-20", -2000, "485 Subscriptions", "NZSOCC", "NZSOCC - Membership"),
    line("2026-02-25", -2000, "485 Subscriptions", "NZSOCC", "NZSOCC - Membership"),
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

test("uncoded lines are paired by payee too, not by date alone", () => {
  // On a ledger nobody has coded yet every line is uncoded. A $30 device
  // subscription and a $30 courier bill a day apart each took the other's
  // account when they were paired on the nearest date.
  const coded = [
    { transaction: txn("device", "2026-03-18", -3000, "Kea Devices NZD3000"), code: null },
    { transaction: txn("courier", "2026-03-19", -3000, "RAPIDO AUCKLAND NZD3000"), code: null },
  ];
  const reference = [
    line("2026-03-18", -3000, "425 Freight & Courier", "Rapido", "Rapido - Courier"),
    line("2026-03-19", -3000, "485 Subscriptions", "Kea Devices", "Kea Devices - Plan"),
  ];
  const result = compareCodings(coded, reference, { chart: CHART });
  const theirs = (id) => result.uncoded.find((r) => r.transaction.id === id).theirs.code;
  assert.equal(theirs("device"), "485 Subscriptions");
  assert.equal(theirs("courier"), "425 Freight & Courier");
});

// A dinner split half and half, entered tax-exclusive: each half rounds to
// 26.07 gross, 52.14 in all, and the card was charged 52.13.
const dinner = (amount = -5214) => ({
  ...line("2026-05-12", amount, "420 Entertainment", "Kowhai Bistro", "Kowhai Bistro - team dinner"),
  parts: [
    { code: "420 Entertainment", label: "420 Entertainment", amount: -2607, gstRate: "15% GST on Expenses", description: "" },
    { code: "424 Entertainment - Non deductible", label: "424 Entertainment - Non deductible", amount: -2607, gstRate: "No GST", description: "" },
  ],
});

test("a split a cent from the bank line pairs, and the cent comes off the part without GST", () => {
  const t = txn("t", "2026-05-09", -5213, "KOWHAI BISTRO");
  const result = compareCodings([{ transaction: t, code: null }], [dinner()]);
  const theirs = result.uncoded[0].theirs;
  assert.ok(theirs, "paired");
  assert.equal(theirs.amount, -5213);
  assert.equal(theirs.roundedFrom, -5214);
  assert.deepEqual(theirs.parts.map((p) => p.amount), [-2607, -2606], "the GST half stays as filed");
  assert.equal(result.unmatched.length, 0);
});

test("the same for a line already coded: it is compared, not left with nothing to check", () => {
  const t = txn("t", "2026-05-09", -5213, "KOWHAI BISTRO");
  const result = compareCodings([{ transaction: t, code: "420 Entertainment" }], [dinner()]);
  assert.equal(result.agreed.length, 1);
  assert.equal(result.unreferenced.length, 0);
});

test("a cent away needs the names to agree, and an exact match always wins", () => {
  const stranger = txn("s", "2026-05-09", -5213, "RIMU HARDWARE");
  assert.equal(compareCodings([{ transaction: stranger, code: null }], [dinner()]).uncoded[0].theirs, null);

  const exact = txn("e", "2026-05-12", -5214, "KOWHAI BISTRO");
  const near = txn("n", "2026-05-09", -5213, "KOWHAI BISTRO");
  const result = compareCodings(
    [{ transaction: near, code: null }, { transaction: exact, code: null }],
    [dinner()],
  );
  const byId = new Map(result.uncoded.map((r) => [r.transaction.id, r.theirs]));
  assert.equal(byId.get("e")?.amount, -5214, "the exact one keeps its line");
  assert.equal(byId.get("n"), null);
});

test("two lines a cent away are too close to call, so neither pairs", () => {
  const t = txn("t", "2026-05-09", -5213, "KOWHAI BISTRO");
  const result = compareCodings([{ transaction: t, code: null }], [dinner(-5214), dinner(-5212)]);
  assert.equal(result.uncoded[0].theirs, null);
});

// A card payout recorded by the other system as three entries on one day: the
// invoice payment, a surcharge and the processor's fee, adding up to the one
// bank line of 291.22.
const payout = () => [
  line("2026-06-10", 30000, "610 Accounts Receivable", "Rimu Cafe", "Payment"),
  line("2026-06-10", 870, "200 Sales", "Rimu Cafe", "Card surcharge"),
  line("2026-06-10", -1748, "506 Card Fees", "Kowhai Payments", "Fee"),
];

test("entries on one day that add up to a bank line are that line, not missing", () => {
  const t = txn("t", "2026-06-12", 29122, "KOWHAI PAYMENTS PAYOUT");
  const result = compareCodings([{ transaction: t, code: null }], payout());
  const theirs = result.uncoded[0].theirs;
  assert.ok(theirs, "paired");
  assert.equal(theirs.amount, 29122);
  assert.equal(theirs.combined, 3);
  assert.equal(result.unmatched.length, 0, "none of the three is reported as missing");
  assert.equal(theirs.parts, undefined, "an invoice payment among them is not offered as a coding");
});

test("without a receivable among them, the entries are offered as the split they are", () => {
  const t = txn("t", "2026-06-12", -5750, "TOTARA SUPPLIES");
  const lines = [
    line("2026-06-11", -5000, "429 General expenses", "Totara Supplies", "Parts"),
    line("2026-06-11", -750, "425 Freight and courier", "Totara Supplies", "Freight"),
  ];
  const theirs = compareCodings([{ transaction: t, code: null }], lines).uncoded[0].theirs;
  assert.deepEqual(theirs.parts.map((p) => p.amount), [-5000, -750]);
  assert.equal(theirs.code, "429 General expenses", "the largest part names it");
});

test("a single entry that matches always wins over a sum", () => {
  const t = txn("t", "2026-06-12", 29122, "KOWHAI PAYMENTS PAYOUT");
  const single = line("2026-06-12", 29122, "200 Sales", "Kowhai Payments", "Payout");
  const result = compareCodings([{ transaction: t, code: null }], [...payout(), single]);
  assert.equal(result.uncoded[0].theirs.combined, undefined);
  assert.equal(result.unmatched.length, 3, "the three stay unmatched: the bank line was taken");
});

test("part of a busy day adds up only if it names the payee", () => {
  const t = txn("t", "2026-06-12", 5000, "RIMU HARDWARE");
  const day = [
    line("2026-06-10", 3000, "200 Sales", "Kowhai Bistro", ""),
    line("2026-06-10", 2000, "200 Sales", "Totara Lodge", ""),
    line("2026-06-10", 1000, "200 Sales", "Matai Bakery", ""),
  ];
  assert.equal(compareCodings([{ transaction: t, code: null }], day).uncoded[0].theirs, null);
});

// Two equal charges on one day, told apart by the bank's own fields.
const fieldsLine = (code, serial, particulars) => ({
  ...line("2026-07-01", -2000, code, "", ""),
  bankFields: { serial, particulars },
});
const bankLine = (id, serial, particulars) => ({
  ...txn(id, "2026-07-01", -2000, "KOWHAI CAFE"),
  serial,
  particulars,
});

test("the bank's fields decide between equal lines on the same day", () => {
  const a = bankLine("a", "1001", "LUNCH");
  const b = bankLine("b", "1002", "COFFEE");
  const result = compareCodings(
    [{ transaction: a, code: "420 Entertainment" }, { transaction: b, code: "429 General expenses" }],
    [fieldsLine("429 General expenses", "1002", "COFFEE"), fieldsLine("420 Entertainment", "1001", "LUNCH")],
  );
  assert.equal(result.differed.length, 0, "each line found its own");
  assert.equal(result.agreed.length, 2);
});

test("a different serial rules a line out, even on date and amount", () => {
  const a = bankLine("a", "1001", "");
  const result = compareCodings([{ transaction: a, code: "429 General expenses" }], [fieldsLine("429 General expenses", "9999", "")]);
  assert.equal(result.unreferenced.length, 1, "not paired");
  assert.equal(result.unmatched.length, 1);
});

test("with nothing to tell them apart, the line that agrees is the pair", () => {
  const a = txn("a", "2026-07-01", -2000, "KOWHAI CAFE");
  const result = compareCodings(
    [{ transaction: a, code: "420 Entertainment" }],
    [line("2026-07-01", -2000, "429 General expenses", ""), line("2026-07-01", -2000, "420 Entertainment", "")],
  );
  assert.equal(result.agreed.length, 1);
  assert.equal(result.differed.length, 0);
});

test("bankFieldScore: strong fields count most, a clash counts against", () => {
  const t = { ...txn("t", "2026-07-01", -2000, "Rimu Ltd"), serial: "77", particulars: "INV 5", otherPartyAccount: "12-3456-0001234-00" };
  assert.equal(bankFieldScore({ ...line("2026-07-01", -2000, "429", ""), bankFields: { serial: "77", particulars: "inv5" } }, t), 4);
  assert.equal(bankFieldScore({ ...line("2026-07-01", -2000, "429", ""), bankFields: { otherPartyAccount: "12-3456-0009999-00" } }, t), -3);
  assert.equal(bankFieldScore(line("2026-07-01", -2000, "429", ""), t), 0);
});

test("reloading keeps equal lines with different bank fields, and fills in old ones", () => {
  const old = line("2026-07-01", -2000, "429 General expenses", "");
  const first = { ...old, bankFields: { serial: "1001" } };
  const second = { ...old, bankFields: { serial: "1002" } };
  const merged = dedupeReference([old, first, second]);
  assert.equal(merged.length, 2, "the old line took the first's fields; the second is its own");
  assert.deepEqual(merged.map((l) => l.bankFields?.serial), ["1001", "1002"]);
  assert.equal(dedupeReference([first, { ...first }]).length, 1, "the same line twice is one");
});

test("a pasted bank sheet keeps the bank's fields, and its own coding column", async () => {
  const { parseReconciledCsv } = await import("../dist/index.js");
  const csv = [
    "Date,Amount,Particulars,Code,Reference,Other Party,Other Party Account,Serial,What",
    "01/07/2026,-20.00,LUNCH,,,Kowhai Cafe,12-3456-0001234-00,1001,Entertainment",
    "01/07/2026,-20.00,COFFEE,,,Kowhai Cafe,,1002,General expenses",
  ].join("\n");
  const lines = parseReconciledCsv(csv, "sheet.csv");
  assert.equal(lines.length, 2);
  assert.equal(lines[0].code, "Entertainment", "What is the coding, not the bank's Code");
  assert.deepEqual(lines[0].bankFields, {
    particulars: "LUNCH",
    otherParty: "Kowhai Cafe",
    otherPartyAccount: "12-3456-0001234-00",
    serial: "1001",
  });
  assert.equal(lines[1].contact, "Kowhai Cafe");
});
