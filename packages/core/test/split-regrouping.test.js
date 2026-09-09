import assert from "node:assert/strict";
import test from "node:test";
import { csvToSheet, parseAccountTransactionsSheet } from "../dist/index.js";

// The Account Transactions export, as Xero writes it. Two payments to one payee
// on one day with no reference between them arrive as one block: the export
// ties rows together by contact and date, which is not an identifier.
const HEAD =
  "Date,Source,Contact,Reference,Description,Debit,Credit,Gross,Net,Tax,GST Rate Name," +
  "Account Code,Account,Account Type,Related account";

const row = (o) =>
  [
    o.date, o.source ?? "Spend Money", o.contact, o.reference ?? "", o.description ?? o.contact,
    o.debit ?? 0, o.credit ?? 0, o.gross ?? 0, o.net ?? 0, o.tax ?? 0, o.gstRate ?? "",
    o.code ?? "", o.account, o.type ?? "Expense", o.related ?? "",
  ].join(",");

const NL = String.fromCharCode(10);
const sheet = (rows) => ({ sheets: [csvToSheet([HEAD, ...rows].join(NL), "x.csv")], problems: [] });
const isBank = (name, code) => code === "" && /bnz|visa/i.test(name);
const isStructural = (name) => ["GST", "Accounts Receivable", "Accounts Payable", "Rounding"].includes(name);
const read = (rows, options) =>
  parseAccountTransactionsSheet(sheet(rows), "x.csv", isBank, isStructural, options ?? {});

/** One restaurant bill, split half deductible and half not, as NZ requires. */
const dinner = (amount, deductible, nonDeductible, gst) => [
  row({ date: "2026-04-20", contact: "Sprig Fern", credit: amount / 100, gross: -amount / 100, net: -amount / 100, account: "BNZ Visa - Business Card" }),
  row({ date: "2026-04-20", contact: "Sprig Fern", debit: deductible / 100, gross: (deductible + gst) / 100, net: deductible / 100, tax: gst / 100, gstRate: "15% GST on Expenses", code: "420", account: "Entertainment" }),
  row({ date: "2026-04-20", contact: "Sprig Fern", debit: nonDeductible / 100, gross: nonDeductible / 100, net: nonDeductible / 100, gstRate: "No GST", code: "424", account: "Entertainment - Non deductible" }),
  row({ date: "2026-04-20", contact: "Sprig Fern", debit: gst / 100, gross: -gst / 100, net: -gst / 100, code: "820", account: "GST", type: "Liability" }),
];

const journalFor = (id, amount, deductible, nonDeductible, gst) => ({
  id, date: "2026-04-20", narration: "Sprig Fern", postedDate: "2026-04-21", postedBy: "H",
  lines: [
    { accountCode: "", accountName: "BNZ Visa - Business Card", description: "", amount: -amount },
    { accountCode: "420", accountName: "Entertainment", description: "", amount: deductible },
    { accountCode: "424", accountName: "Entertainment - Non deductible", description: "", amount: nonDeductible },
    { accountCode: "820", accountName: "GST", description: "", amount: gst },
  ],
});

test("two payments to one payee on one day are dropped without help", () => {
  // The block has two bank sides, which is indistinguishable from a transfer,
  // so the whole thing goes -- and with amounts that are ambiguous, nothing
  // can recover it. This is the loss the journal report exists to answer.
  const rows = [
    ...dinner(5500, 2391, 2750, 359),
    ...dinner(5500, 2391, 2750, 359),
  ];
  assert.deepEqual(read(rows), []);
});

test("a journal report tells the two payments apart, with the export's GST rates", () => {
  const rows = [...dinner(5500, 2391, 2750, 359), ...dinner(1350, 587, 675, 88)];
  const journals = [journalFor("2916", 5500, 2391, 2750, 359), journalFor("2917", 1350, 587, 675, 88)];
  const out = read(rows, { journals }).sort((a, b) => a.amount - b.amount);

  assert.equal(out.length, 2, "both payments recovered");
  assert.deepEqual(out.map((l) => l.amount), [-5500, -1350]);

  // The point of reading both files: the journal says which rows go together,
  // the export says the gross and the rate. Gross, so the parts reconstruct
  // the payment -- the journal's own figures are net and never would.
  const big = out.find((l) => l.amount === -5500);
  assert.deepEqual(
    big.parts.map((p) => [p.code, p.amount, p.gstRate]),
    [["420 Entertainment", -2750, "15% GST on Expenses"], ["424 Entertainment - Non deductible", -2750, "No GST"]],
  );
  assert.equal(big.parts.reduce((sum, p) => sum + p.amount, 0), big.amount, "parts reconstruct the payment");
});

test("without a journal report, distinct amounts are recovered by arithmetic", () => {
  const rows = [...dinner(5500, 2391, 2750, 359), ...dinner(1350, 587, 675, 88)];
  const out = read(rows).sort((a, b) => a.amount - b.amount);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((l) => l.amount), [-5500, -1350]);
  assert.equal(out[0].parts.length, 2);
});

test("arithmetic refuses a block where two arrangements both add up", () => {
  // 30.00 and 30.00 of postings against bank lines of 20.00 and 40.00: the
  // 10/20 and 20/10 pairings both reconcile. Guessing would put a coding on
  // the wrong payment, so neither is taken.
  const pay = (amount) =>
    row({ date: "2026-05-01", contact: "Ambiguous Ltd", credit: amount / 100, gross: -amount / 100, net: -amount / 100, account: "BNZ Visa - Business Card" });
  const cost = (amount, code, name) =>
    row({ date: "2026-05-01", contact: "Ambiguous Ltd", debit: amount / 100, gross: amount / 100, net: amount / 100, gstRate: "No GST", code, account: name });
  const rows = [
    pay(2000), pay(4000),
    cost(2000, "429", "Office Expenses"), cost(2000, "461", "Printing"),
    cost(1000, "400", "Advertising"), cost(1000, "425", "Freight"),
  ];
  assert.deepEqual(read(rows), [], "an ambiguous block is left whole, not guessed at");
});

test("arithmetic refuses two payments of the same amount", () => {
  // Nothing distinguishes them, so calling either arrangement unique would be
  // a lie about the one thing this promises.
  const rows = [...dinner(5500, 2391, 2750, 359), ...dinner(5500, 2391, 2750, 359)];
  assert.deepEqual(read(rows), []);
});

test("an ordinary single payment is untouched by either path", () => {
  const rows = dinner(5500, 2391, 2750, 359);
  const plain = read(rows);
  const withJournals = read(rows, { journals: [journalFor("2916", 5500, 2391, 2750, 359)] });
  assert.equal(plain.length, 1);
  assert.deepEqual(plain, withJournals, "the journal changes nothing where the export was already right");
});
