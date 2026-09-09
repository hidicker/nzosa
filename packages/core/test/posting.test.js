import assert from "node:assert/strict";
import test from "node:test";
import {
  postTransaction,
  postInvoice,
  postDepreciation,
  postTransfer,
  journalImbalance,
  trialBalance,
  taxSummary,
  taxTypeFor,
  taxTypeFromRate,
} from "../dist/posting.js";

const bank = (amount, extra = {}) => ({
  id: "t1",
  date: "2025-06-01",
  amount,
  currency: "NZD",
  account: "bank-01",
  serial: "",
  trn: "",
  particulars: "",
  code: "",
  reference: "",
  otherParty: "Stationery Depot",
  origin: "",
  type: "",
  batch: "",
  otherPartyAccount: "",
  ...extra,
});

const standard = (side) => ({ treatment: "standard", side });
const outOfScope = { treatment: "out-of-scope", side: "none" };

test("an expense posts supply, tax and bank, and balances", () => {
  const journal = postTransaction(bank(-23000), [
    { amount: -23000, code: "400", classification: standard("purchases") },
  ]);

  assert.equal(journalImbalance(journal), 0);
  const byAccount = Object.fromEntries(journal.lines.map((l) => [l.accountCode, l]));
  assert.equal(byAccount["400"].amount, 20000, "expense debited net");
  assert.equal(byAccount["400"].taxType, "INPUT2");
  assert.equal(byAccount["400"].taxBase, -23000, "gross kept for Box 11");
  assert.equal(byAccount["820"].amount, 3000, "GST debited to the control account");
  assert.equal(byAccount["bank-01"].amount, -23000, "bank credited in full");
});

test("a sale posts the mirror image", () => {
  const journal = postTransaction(bank(115000), [
    { amount: 115000, code: "200", classification: standard("sales") },
  ]);

  assert.equal(journalImbalance(journal), 0);
  const byAccount = Object.fromEntries(journal.lines.map((l) => [l.accountCode, l]));
  assert.equal(byAccount["bank-01"].amount, 115000, "bank debited");
  assert.equal(byAccount["200"].amount, -100000, "sales credited net");
  assert.equal(byAccount["820"].amount, -15000, "GST credited");
  assert.equal(byAccount["200"].taxType, "OUTPUT2");
});

test("border GST posts the whole line to the tax account, with no supply", () => {
  const journal = postTransaction(bank(-93660), [
    { amount: -93660, code: "820", classification: standard("imports") },
  ]);

  assert.equal(journalImbalance(journal), 0);
  assert.equal(journal.lines.length, 2, "no expense line: the payment is only tax");
  const gst = journal.lines.find((l) => l.accountCode === "820");
  assert.equal(gst.amount, 93660);
  assert.equal(gst.taxType, "GSTONIMPORTS");
});

test("an out-of-scope line posts no tax at all", () => {
  const journal = postTransaction(bank(-50000), [
    { amount: -50000, code: "980", classification: outOfScope },
  ]);

  assert.equal(journalImbalance(journal), 0);
  assert.equal(journal.lines.length, 2);
  assert.equal(journal.lines.every((l) => l.accountCode !== "820"), true);
  assert.equal(journal.lines[1].taxType, "NONE");
});

test("a split posts every part against one bank line, still balanced", () => {
  // The DHL courier payment: entry fee GST, the fee itself, border GST.
  const journal = postTransaction(bank(-103902), [
    { amount: -1393, code: "820", classification: standard("imports") },
    { amount: -9287, code: "310", classification: outOfScope },
    { amount: -93660, code: "820", classification: standard("imports") },
    { amount: -3600, code: "310", classification: standard("purchases") },
    { amount: 4038, code: "310", classification: standard("purchases") },
  ]);

  assert.equal(journalImbalance(journal), 0, "a five-part split still balances");
  const bankLine = journal.lines.find((l) => l.accountCode === "bank-01");
  assert.equal(bankLine.amount, -103902, "one bank line for the whole payment");
});

test("the trial balance proves the whole ledger holds together", () => {
  const journals = [
    postTransaction(bank(-23000), [
      { amount: -23000, code: "400", classification: standard("purchases") },
    ]),
    postTransaction({ ...bank(115000), id: "t2" }, [
      { amount: 115000, code: "200", classification: standard("sales") },
    ]),
  ];

  const balance = trialBalance(journals);
  assert.equal(balance.imbalance, 0, "debits equal credits across the ledger");
  assert.equal(balance.unbalanced.length, 0);

  const gst = balance.rows.find((r) => r.accountCode === "820");
  assert.equal(gst.balance, 3000 - 15000, "GST account nets input against output");
});

test("the return reads tax tags, not the GST account balance", () => {
  const journals = [
    postTransaction(bank(-23000), [
      { amount: -23000, code: "400", classification: standard("purchases") },
    ]),
    postTransaction({ ...bank(115000), id: "t2" }, [
      { amount: 115000, code: "200", classification: standard("sales") },
    ]),
    // Posted to the GST account with no tax type: it moves the account but must
    // reach no box. This is the mistake that hid $3,330.06 of border GST.
    postTransaction({ ...bank(-10000), id: "t3" }, [
      { amount: -10000, code: "820", classification: outOfScope },
    ]),
  ];

  const summary = taxSummary(journals);
  assert.equal(summary.box5, 115000, "gross sales");
  assert.equal(summary.box8, 15000, "GST on sales");
  assert.equal(summary.box11, 23000, "gross purchases");
  assert.equal(summary.box12, 3000, "GST on purchases");
  assert.equal(summary.box13, 0, "the untagged line reaches no box");

  const balance = trialBalance(journals);
  const gst = balance.rows.find((r) => r.accountCode === "820");
  assert.notEqual(
    gst.balance,
    summary.box12 - summary.box8,
    "the account balance and the return are different numbers, by design",
  );
});

test("tax types map from the classification", () => {
  assert.equal(taxTypeFor({ treatment: "standard", side: "sales" }), "OUTPUT2");
  assert.equal(taxTypeFor({ treatment: "standard", side: "purchases" }), "INPUT2");
  assert.equal(taxTypeFor({ treatment: "standard", side: "imports" }), "GSTONIMPORTS");
  assert.equal(taxTypeFor({ treatment: "zero-rated", side: "sales" }), "ZERORATED");
  assert.equal(taxTypeFor({ treatment: "out-of-scope", side: "none" }), "NONE");
});


const invoice = {
  number: "INV-001", kind: "sales", contact: "Ana Rewi", reference: "",
  issued: "2025-02-01", due: null, total: 115000, tax: 15000, paid: 115000,
  outstanding: 0, currency: "NZD", status: "PAID",
  lines: [{ description: "Sample course", accountCode: "200",
            taxType: "15% GST on Income", net: 100000, tax: 15000, gross: 115000 }],
};

test("an invoice posts receivable, sales and GST, and balances", () => {
  const journal = postInvoice(invoice);
  assert.equal(journalImbalance(journal), 0);
  const by = Object.fromEntries(journal.lines.map((l) => [l.accountCode, l]));
  assert.equal(by["610"].amount, 115000, "receivable debited gross");
  assert.equal(by["200"].amount, -100000, "sales credited net");
  assert.equal(by["820"].amount, -15000, "GST credited");
  assert.equal(journal.source, "invoice");
  assert.equal(journal.taxBasis, "invoice", "on a payments basis this is not due yet");
});

test("a bill posts the mirror image into payables", () => {
  const journal = postInvoice({ ...invoice, kind: "purchase", number: "BILL-1",
    lines: [{ ...invoice.lines[0], accountCode: "453", taxType: "15% GST on Expenses" }] });
  assert.equal(journalImbalance(journal), 0);
  const by = Object.fromEntries(journal.lines.map((l) => [l.accountCode, l]));
  assert.equal(by["800"].amount, -115000, "payable credited");
  assert.equal(by["453"].amount, 100000, "expense debited net");
  assert.equal(by["453"].taxType, "INPUT2");
});

test("a payment settling an invoice clears the receivable, not the sale again", () => {
  const journal = postTransaction(bank(115000), [], {
    settles: { number: "INV-001", kind: "sales", taxType: "OUTPUT2", total: 115000 },
  });
  assert.equal(journalImbalance(journal), 0);
  const by = Object.fromEntries(journal.lines.map((l) => [l.accountCode, l]));
  assert.equal(by["bank-01"].amount, 115000);
  assert.equal(by["610"].amount, -115000, "receivable cleared");
  assert.equal(by["200"], undefined, "sales is NOT credited a second time");
  assert.equal(journal.taxBasis, "payments");
});

test("the same sale is counted once on each basis, never twice", () => {
  const raised = postInvoice(invoice);
  const settled = postTransaction(bank(115000), [], {
    settles: { number: "INV-001", kind: "sales", taxType: "OUTPUT2", total: 115000 },
  });
  const both = [raised, settled];

  const onInvoice = taxSummary(both, { basis: "invoice" });
  const onPayments = taxSummary(both, { basis: "payments" });

  assert.equal(onInvoice.box5, 115000, "invoice basis: counted when raised");
  assert.equal(onInvoice.box8, 15000);
  assert.equal(onPayments.box5, 115000, "payments basis: counted when paid");
  // The tax line lives on the invoice journal, which the payments basis does
  // not read. The tax is still due, so it comes from the gross instead -- a
  // return showing sales with no GST on them is not a defensible figure.
  assert.equal(onPayments.box8, 15000, "payments basis: tax due when paid");

  // The proof that matters: neither basis sees it twice.
  assert.notEqual(onInvoice.box5, 230000);
  assert.notEqual(onPayments.box5, 230000);
});

test("depreciation posts a charge against accumulated depreciation", () => {
  const journal = postDepreciation({
    name: "Roasting equipment", expenseCode: "416", expenseName: "Depreciation",
    accumulatedCode: "731", accumulatedName: "Less Accumulated Depreciation",
    amount: 1987726, date: "2026-03-31",
  });
  assert.equal(journalImbalance(journal), 0);
  assert.equal(journal.lines[0].amount, 1987726, "expense debited");
  assert.equal(journal.lines[1].amount, -1987726, "contra credited");
  assert.equal(journal.source, "depreciation");
  assert.equal(journal.lines.every((l) => l.taxType === "NONE"), true, "no GST on depreciation");
});

test("tax rates map from the words an export uses", () => {
  assert.equal(taxTypeFromRate("15% GST on Income", "sales"), "OUTPUT2");
  assert.equal(taxTypeFromRate("15% GST on Expenses", "purchase"), "INPUT2");
  assert.equal(taxTypeFromRate("GST on Imports", "purchase"), "GSTONIMPORTS");
  assert.equal(taxTypeFromRate("Zero Rated", "sales"), "ZERORATED");
  assert.equal(taxTypeFromRate("No GST", "sales"), "NONE");
});

test("a transfer posts one balanced journal between the two banks", () => {
  const journal = postTransfer({
    from: { ...bank(-50000), id: "out", account: "bank-01" },
    to: { ...bank(50000), id: "in", account: "bank-02", date: "2025-06-02" },
  });

  assert.equal(journalImbalance(journal), 0);
  assert.equal(journal.lines.length, 2);
  assert.deepEqual(
    journal.lines.map((l) => [l.accountCode, l.amount]),
    [
      ["bank-01", -50000],
      ["bank-02", 50000],
    ],
  );
  // No third account: nothing sits in the middle to be coded wrongly.
  assert.equal(journal.source, "transfer");
});

test("a transfer attracts no GST on either basis", () => {
  const journal = postTransfer({
    from: { ...bank(-50000), id: "out" },
    to: { ...bank(50000), id: "in", account: "bank-02" },
  });

  assert.ok(journal.lines.every((line) => line.taxType === "NONE"));
  for (const basis of ["invoice", "payments"]) {
    const tax = taxSummary([journal], { basis });
    assert.equal(tax.box5, 0, `box5 on ${basis}`);
    assert.equal(tax.box11, 0, `box11 on ${basis}`);
  }
});

test("a transfer is dated when both ends have happened, not the first", () => {
  const journal = postTransfer({
    from: { ...bank(-50000), id: "out", date: "2025-06-01" },
    to: { ...bank(50000), id: "in", account: "bank-02", date: "2025-06-03" },
  });
  assert.equal(journal.date, "2025-06-03");
});

test("the same pair posts the same journal id from either leg", () => {
  const out = { ...bank(-50000), id: "zzz", account: "bank-01" };
  const into = { ...bank(50000), id: "aaa", account: "bank-02" };
  assert.equal(
    postTransfer({ from: out, to: into }).transactionId,
    postTransfer({ from: into, to: out }).transactionId,
  );
});

test("a transfer leaves the trial balance flat", () => {
  const journal = postTransfer({
    from: { ...bank(-50000), id: "out" },
    to: { ...bank(50000), id: "in", account: "bank-02" },
  });
  const balance = trialBalance([journal]);
  const total = balance.rows.reduce((sum, row) => sum + row.balance, 0);
  assert.equal(total, 0);
});

test("an ordinary coded sale counts its tax once, not twice", () => {
  // The journal posts its own GST line. Deriving the tax from the gross as
  // well would double Box 8, which is the risk the settlement fix introduces.
  const journal = postTransaction(bank(115000), [
    { amount: 115000, code: "200", classification: { treatment: "standard", side: "sales" } },
  ]);
  const tax = taxSummary([journal], { basis: "payments" });
  assert.equal(tax.box5, 115000);
  assert.equal(tax.box8, 15000);
});

test("an ordinary coded purchase counts its tax once, not twice", () => {
  const journal = postTransaction(bank(-115000), [
    { amount: -115000, code: "400", classification: { treatment: "standard", side: "purchases" } },
  ]);
  const tax = taxSummary([journal], { basis: "payments" });
  assert.equal(tax.box11, 115000);
  assert.equal(tax.box12, 15000);
});

test("settling a bill claims its GST on the payments basis", () => {
  const bill = {
    number: "BILL-001",
    kind: "purchase",
    contact: "A Supplier",
    reference: "",
    issued: "2025-06-01",
    due: null,
    total: 23000,
    tax: 3000,
    paid: 23000,
    outstanding: 0,
    currency: "NZD",
    status: "Paid",
    lines: [
      {
        description: "Supplies",
        accountCode: "400",
        taxType: "15% GST on Expenses",
        net: 20000,
        tax: 3000,
        gross: 23000,
      },
    ],
  };
  const raised = postInvoice(bill);
  const settled = postTransaction({ ...bank(-23000), id: "pay" }, [], {
    settles: { number: "BILL-001", kind: "purchase", taxType: "INPUT2", total: 23000 },
  });

  const onPayments = taxSummary([raised, settled], { basis: "payments" });
  assert.equal(onPayments.box11, 23000, "the gross falls due when paid");
  assert.equal(onPayments.box12, 3000, "and so does the tax");

  const onInvoice = taxSummary([raised, settled], { basis: "invoice" });
  assert.equal(onInvoice.box11, 23000);
  assert.equal(onInvoice.box12, 3000);
});

test("a zero-rated sale settled by a receipt adds no GST", () => {
  const journal = postTransaction(bank(115000), [], {
    settles: { number: "INV-Z", kind: "sales", taxType: "ZERORATED", total: 115000 },
  });
  const tax = taxSummary([journal], { basis: "payments" });
  assert.equal(tax.box5, 115000);
  assert.equal(tax.box6, 115000);
  assert.equal(tax.box8, 0, "zero-rated means zero, not three twenty-thirds");
});

test("a part payment clears only what arrived, leaving the rest in receivables", () => {
  // $1,150 invoice, $400 received. The remaining $750 has to stay in
  // receivables: clearing the invoice total would say the customer had paid in
  // full, and the balance sheet would lose the debt.
  const journal = postTransaction(bank(40000), [], {
    settles: { number: "INV-001", kind: "sales", taxType: "OUTPUT2", total: 115000 },
  });
  assert.equal(journalImbalance(journal), 0);
  const by = Object.fromEntries(journal.lines.map((l) => [l.accountCode, l]));
  assert.equal(by["bank-01"].amount, 40000);
  assert.equal(by["610"].amount, -40000, "receivable cleared by what arrived, not by the total");
  assert.equal(by["200"], undefined, "sales is NOT credited a second time");
});

test("a part payment is taxed on what arrived, not on the invoice", () => {
  // The whole point of the payments basis: GST falls due as the money lands.
  // Taxing the invoice total on the first instalment would bring forward tax
  // on money not yet received.
  const first = postTransaction(bank(40000), [], {
    settles: { number: "INV-001", kind: "sales", taxType: "OUTPUT2", total: 115000 },
  });
  const second = postTransaction({ ...bank(75000), id: "t2" }, [], {
    settles: { number: "INV-001", kind: "sales", taxType: "OUTPUT2", total: 115000 },
  });

  const onFirst = taxSummary([first], { basis: "payments" });
  assert.equal(onFirst.box5, 40000, "only the instalment is a supply this period");

  // Both instalments together are the whole invoice, counted once.
  const both = taxSummary([first, second], { basis: "payments" });
  assert.equal(both.box5, 115000);
  assert.equal(both.box8, 15000);
});

test("part paying a bill claims GST on what was paid", () => {
  const journal = postTransaction(bank(-10000), [], {
    settles: { number: "BILL-001", kind: "purchase", taxType: "INPUT2", total: 23000 },
  });
  assert.equal(journalImbalance(journal), 0);
  const by = Object.fromEntries(journal.lines.map((l) => [l.accountCode, l]));
  assert.equal(by["800"].amount, 10000, "payable cleared by what was paid");

  // Box 11 is gross purchases and Box 12 the GST within them, so the
  // instalment shows in full and only its own tax is claimed.
  const summary = taxSummary([journal], { basis: "payments" });
  assert.equal(summary.box11, 10000, "the instalment, not the whole bill");
  assert.equal(summary.box12, Math.round((10000 * 3) / 23), "claimed on the instalment only");
});

test("a split scales each part by its own deductibility, not the journal's", () => {
  // $115 of stationery, fully deductible, and $115 of client dinner at 50%,
  // paid as one $230 transaction. The percentage used to be read off the first
  // partial line and applied to the whole journal, so the stationery was
  // halved along with the dinner and $50 of claim went missing.
  const journal = postTransaction(bank(-23000), [
    { amount: -11500, code: "461", classification: { treatment: "standard", side: "purchases" } },
    {
      amount: -11500,
      code: "420",
      classification: { treatment: "standard", side: "purchases", deductiblePercent: 50 },
    },
  ]);

  assert.equal(journalImbalance(journal), 0);

  const summary = taxSummary([journal], { basis: "payments" });
  assert.equal(summary.box11, 17250, "the whole stationery plus half the dinner");
  assert.equal(summary.box12, 2250, "and the tax on that, not on half of both");
});

test("a split of two fully deductible parts is unaffected", () => {
  const journal = postTransaction(bank(-23000), [
    { amount: -11500, code: "461", classification: { treatment: "standard", side: "purchases" } },
    { amount: -11500, code: "462", classification: { treatment: "standard", side: "purchases" } },
  ]);
  const summary = taxSummary([journal], { basis: "payments" });
  assert.equal(summary.box11, 23000);
  assert.equal(summary.box12, 3000);
});

test("a wholly half-deductible cost is unchanged by scaling per line", () => {
  const journal = postTransaction(bank(-11500), [
    {
      amount: -11500,
      code: "420",
      classification: { treatment: "standard", side: "purchases", deductiblePercent: 50 },
    },
  ]);
  const summary = taxSummary([journal], { basis: "payments" });
  assert.equal(summary.box11, 5750);
  assert.equal(summary.box12, 750);
});
