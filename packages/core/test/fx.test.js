import assert from "node:assert/strict";
import test from "node:test";
import {
  accountingInvoice, accountingSplits, accountingTransactions, convert, foreignInUse, isForeign, missingRates,
  rateOn, realisedFxJournals, revaluationJournals, trialBalance,
} from "../dist/index.js";

// Invented rates: NZD for one USD.
const rates = { USD: [{ date: "2026-01-01", rate: 1.6 }, { date: "2026-02-01", rate: 1.7 }, { date: "2026-03-31", rate: 1.75 }] };
const line = (over) => ({
  id: "t1", date: "2026-02-10", amount: 100000, currency: "USD", serial: "", trn: "", particulars: "", code: "",
  reference: "", otherParty: "Acme Inc", origin: "", type: "", batch: "", otherPartyAccount: "", account: "wise-USD-1",
  source: { importer: "wise", file: "x" }, ...over,
});
const invoice = (over) => ({
  number: "INV-9", kind: "sales", contact: "Acme Inc", reference: "", issued: "2026-01-15", due: null,
  total: 100000, tax: 0, paid: 0, outstanding: 100000, currency: "USD", status: "Awaiting Payment",
  lines: [{ description: "Design", accountCode: "200", taxType: "Zero Rated", net: 100000, tax: 0, gross: 100000 }], ...over,
});

test("the rate on a day: the latest on or before it, the first before any, 1 for the books' own", () => {
  assert.equal(rateOn(rates, "USD", "2026-02-10", "NZD"), 1.7);
  assert.equal(rateOn(rates, "usd", "2025-12-01", "NZD"), 1.6);
  assert.equal(rateOn(rates, "NZD", "2026-02-10", "NZD"), 1);
  assert.equal(rateOn(rates, "AUD", "2026-02-10", "NZD"), null);
  assert.equal(isForeign("", "NZD"), false);
  assert.equal(convert(-12345, 1.7), -20987);
});

test("books with nothing foreign get back exactly what they gave", () => {
  const nzd = [line({ currency: "NZD" }), line({ id: "t2", currency: "" })];
  assert.equal(accountingTransactions(nzd, "NZD", rates), nzd);
  const splits = { t1: [{ amount: 50000, note: "a" }, { amount: 50000, note: "b" }] };
  assert.equal(accountingSplits(splits, nzd, "NZD", rates), splits);
  const doc = invoice({ currency: "NZD" });
  assert.equal(accountingInvoice(doc, "NZD", rates), doc);
});

test("a USD line and its split become NZD at the line's date, the split to the line's total", () => {
  const [t] = accountingTransactions([line({ amount: 100001 })], "NZD", rates);
  assert.equal(t.amount, 170002);
  assert.equal(t.currency, "NZD");
  assert.equal(t.extras.fxCurrency, "USD");
  const parts = accountingSplits({ t1: [{ amount: 33333, note: "a" }, { amount: 66668, note: "b" }] }, [line({ amount: 100001 })], "NZD", rates).t1;
  assert.equal(parts[0].amount + parts[1].amount, 170002);
});

test("a USD invoice is booked at its date's rate", () => {
  const doc = accountingInvoice(invoice(), "NZD", rates);
  assert.deepEqual([doc.total, doc.lines[0].gross, doc.lines[0].net, doc.currency], [160000, 160000, 160000, "NZD"]);
});

test("paid at a better rate: the difference is a gain, and the receivable clears", () => {
  const control = { code: "610", name: "Accounts Receivable" };
  const fxAccount = { code: "499", name: "Realised Currency Gains" };
  const [j] = realisedFxJournals(
    [{ invoice: invoice(), date: "2026-02-10", amount: 100000, currency: "USD", id: "t1" }],
    "NZD", rates, { controlFor: () => control, account: fxAccount },
  );
  // Booked 1,600.00 at 1.60; 1,700.00 arrived at 1.70: a 100.00 gain.
  assert.deepEqual(j.lines.map((l) => [l.accountCode, l.amount]), [["610", 10000], ["499", -10000]]);
  // With the invoice and the payment as posted, the receivable is nothing.
  const posted = [
    { transactionId: "INV-9", date: "2026-01-15", narration: "", source: "invoice", taxBasis: "invoice",
      lines: [{ accountCode: "610", accountName: "", amount: 160000, taxType: "NONE" }, { accountCode: "200", accountName: "", amount: -160000, taxType: "NONE" }] },
    { transactionId: "t1", date: "2026-02-10", narration: "", source: "bank", taxBasis: "payments",
      lines: [{ accountCode: "wise-USD-1", accountName: "", amount: 170000, taxType: "NONE" }, { accountCode: "610", accountName: "", amount: -170000, taxType: "NONE" }] },
    j,
  ];
  const tb = trialBalance(posted);
  assert.equal(tb.rows.filter((r) => r.accountCode === "610").reduce((s, r) => s + r.balance, 0), 0);
  assert.equal(tb.imbalance, 0);
});

test("a bill paid at a worse rate is a loss; paid in NZD, it settles what the NZD buys", () => {
  const bill = invoice({ number: "B-1", kind: "purchase" });
  const opts = { controlFor: () => ({ code: "800", name: "AP" }), account: { code: "499", name: "FX" } };
  const [loss] = realisedFxJournals([{ invoice: bill, date: "2026-02-10", amount: 100000, currency: "USD", id: "p" }], "NZD", rates, opts);
  assert.deepEqual(loss.lines.map((l) => l.amount), [-10000, 10000], "payable debited back, 100.00 loss");
  const [nzd] = realisedFxJournals([{ invoice, ...{ invoice: invoice() }, date: "2026-02-10", amount: 170000, currency: "NZD", id: "n" }], "NZD", rates, opts);
  assert.deepEqual(nzd.lines.map((l) => l.amount), [10000, -10000], "1,700 NZD settles USD 1,000, booked at 1,600: a gain");
});

test("a USD balance revalued at each balance date, the change only", () => {
  const lines = [line({ id: "a", date: "2026-01-10", amount: 100000 }), line({ id: "b", date: "2026-02-10", amount: -50000 })];
  // Booked 1,600 then -850: 750 NZD for USD 500. At 1.75 that is 875: a 125 gain.
  const js = revaluationJournals(lines, "NZD", rates, ["2026-03-31"], { nameOf: () => "Wise USD", account: { code: "498", name: "Unrealised" } });
  assert.equal(js.length, 1);
  assert.deepEqual(js[0].lines.map((l) => [l.accountCode, l.amount]), [["wise-USD-1", 12500], ["498", -12500]]);
  assert.equal(js[0].adjusting, true);
  const twice = revaluationJournals(lines, "NZD", { USD: [...rates.USD, { date: "2026-06-30", rate: 1.75 }] }, ["2026-03-31", "2026-06-30"], { nameOf: () => "", account: { code: "498", name: "" } });
  assert.equal(twice.length, 1, "nothing more when the rate has not moved");
});

test("what is in use, and what has no rate", () => {
  const inUse = foreignInUse([line(), line({ currency: "NZD" }), line({ currency: "AUD", date: "2026-03-01" })], [invoice()], "NZD");
  assert.deepEqual([...inUse.keys()].sort(), ["AUD", "USD"]);
  assert.deepEqual(inUse.get("USD"), { from: "2026-01-15", to: "2026-02-10", lines: 1, documents: 1 });
  assert.deepEqual(missingRates(inUse, rates), ["AUD"]);
});

test("a conversion between two own accounts: the legs differ in NZD, the difference is an exchange line", async () => {
  const { postTransfer } = await import("../dist/index.js");
  const nzdOut = line({ id: "o", amount: -170500, currency: "NZD", account: "bnz" });
  const usdIn = accountingTransactions([line({ id: "i", amount: 100000 })], "NZD", rates)[0];
  const j = postTransfer({ from: nzdOut, to: usdIn }, { exchangeAccount: { code: "499", name: "Realised Currency Gains" } });
  assert.deepEqual(j.lines.map((l) => [l.accountCode, l.amount]), [["bnz", -170500], ["wise-USD-1", 170000], ["499", 500]]);
  const plain = postTransfer({ from: nzdOut, to: line({ id: "n", amount: 170500, currency: "NZD", account: "kiwi" }) }, { exchangeAccount: { code: "499", name: "x" } });
  assert.equal(plain.lines.length, 2, "two NZD accounts: as before");
});
