import assert from "node:assert/strict";
import test from "node:test";
import { payoutGroups, settlingPart } from "../dist/index.js";

const row = (o) => ({
  date: o.date ?? "2025-04-12",
  account: o.account ?? "BNZ 01",
  contact: o.contact ?? "Nick Pando",
  description: o.description ?? "",
  reference: o.reference ?? "",
  invoiceNumber: o.invoice ?? "",
  gstRate: o.gstRate ?? "",
  source: o.source ?? "Receive Money",
  relatedAccount: (o.related ?? "").split(",")[0].trim(),
  relatedAccounts: (o.related ?? "").split(",").map((x) => x.trim()).filter(Boolean),
  amount: o.amount,
  line: o.line ?? 1,
});

/** One Stripe payout, as the export writes it: three rows, one charge id. */
const CH = "ch_3RCx24S4yCINmf4d15PwxhiW";
const PAYOUT = [
  row({ reference: CH, source: "Receive Money", related: "200 - Sales", amount: 870, invoice: "INV-0037", line: 1 }),
  row({ reference: CH, source: "Receivable Payment", related: "610 - Accounts Receivable", amount: 30000, line: 2 }),
  row({ reference: CH, source: "Spend Money", related: "506 - Stripe Fees", amount: -1172, invoice: "INV-0037", line: 3 }),
];

test("three rows sharing a charge id are one payout", () => {
  const [payout] = payoutGroups(PAYOUT);
  assert.equal(payout.reference, CH);
  assert.equal(payout.parts.length, 3);
  assert.equal(payout.net, 29698, "300.00 plus the 8.70 surcharge less the 11.72 fee");
  assert.deepEqual(payout.invoices, ["INV-0037"]);
});

test("the payout never equals the invoice, which is why amounts cannot match it", () => {
  // The whole reason this exists: searching for an open invoice of 296.98
  // finds nothing, because the invoice is 300.00 and the fee took the rest.
  const [payout] = payoutGroups(PAYOUT);
  const settling = settlingPart(payout, (a) => /receivable/i.test(a));
  assert.equal(settling.amount, 30000, "the invoice was paid in full");
  assert.notEqual(payout.net, settling.amount, "but that is not what reached the bank");
});

test("the part that clears the debtor is found by the account, not the wording", () => {
  // A chart names its receivables account whatever it likes, but a payment
  // always posts there.
  const [payout] = payoutGroups(PAYOUT);
  assert.equal(settlingPart(payout, (a) => /receivable/i.test(a)).source, "Receivable Payment");
  assert.equal(settlingPart(payout, (a) => a === "nothing like it"), undefined);
});

test("an ordinary reference is not a charge id", () => {
  // Grouping on any shared reference would join unrelated payments: a customer
  // reuses their own reference, and two of those merged would make a payout
  // that never happened.
  const ordinary = [
    row({ reference: "INV-0037", amount: 30000, line: 1 }),
    row({ reference: "INV-0037", amount: 15000, line: 2 }),
  ];
  assert.deepEqual(payoutGroups(ordinary), []);
});

test("a lone row carrying a charge id is not a payout", () => {
  assert.deepEqual(payoutGroups([PAYOUT[0]]), []);
});

test("the same charge id against two bank accounts is two payouts", () => {
  const split = [
    row({ reference: CH, account: "BNZ 01", amount: 30000, line: 1 }),
    row({ reference: CH, account: "BNZ 01", amount: -1172, line: 2 }),
    row({ reference: CH, account: "BNZ Visa", amount: 5000, line: 3 }),
    row({ reference: CH, account: "BNZ Visa", amount: -100, line: 4 }),
  ];
  const groups = payoutGroups(split);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((g) => g.net).sort((a, b) => a - b), [4900, 28828]);
});

test("other processors' charge ids are recognised too", () => {
  for (const prefix of ["ch", "py", "pi", "po", "txn"]) {
    const reference = `${prefix}_3RCx24S4yCINmf4d`;
    const groups = payoutGroups([
      row({ reference, amount: 1000, line: 1 }),
      row({ reference, amount: -50, line: 2 }),
    ]);
    assert.equal(groups.length, 1, `${prefix}_ should group`);
  }
});

test("what counts as a charge id can be said by the caller", () => {
  const groups = payoutGroups(
    [row({ reference: "PAYOUT-1", amount: 1000, line: 1 }), row({ reference: "PAYOUT-1", amount: -50, line: 2 })],
    { isChargeId: (r) => r.startsWith("PAYOUT-") },
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0].net, 950);
});

test("a payout takes the earliest date of its rows", () => {
  // The bank shows it a day or two later, so the group's own date is the one
  // to search around rather than to match exactly.
  const groups = payoutGroups([
    row({ reference: CH, date: "2025-04-14", amount: 30000, line: 2 }),
    row({ reference: CH, date: "2025-04-12", amount: -1172, line: 1 }),
  ]);
  assert.equal(groups[0].date, "2025-04-12");
});

test("each part keeps the GST rate the export gave it", () => {
  // The fee is charged from offshore and has no New Zealand GST. Assuming
  // 15% on it strips out tax that was never there: on one real ledger,
  // 332.51 of fees reported as 289.14, which is that ratio exactly.
  const [payout] = payoutGroups([
    row({ reference: CH, source: "Receivable Payment", related: "610 - Accounts Receivable", amount: 30000, line: 1 }),
    row({ reference: CH, source: "Receive Money", related: "200 - Sales", amount: 870, gstRate: "15% GST on Income", line: 2 }),
    row({ reference: CH, source: "Spend Money", related: "506 - Stripe Fees", amount: -1172, gstRate: "", line: 3 }),
  ]);
  const fee = payout.parts.find((p) => /stripe/i.test(p.account));
  const surcharge = payout.parts.find((p) => /sales/i.test(p.account));
  assert.equal(fee.gstRate, "", "no rate, which is the answer rather than a gap");
  assert.equal(surcharge.gstRate, "15% GST on Income");
});

test("a part knows whether the posting carried GST, from its own row", () => {
  // The rate name sits on the ledger row and this reads bank rows, so the rate
  // is always blank here. What the bank row does carry is the accounts the
  // posting reached, and a GST control account among them is the export saying
  // the amount is tax-inclusive. Without it every part posts gross.
  const [payout] = payoutGroups([
    row({ reference: CH, source: "Receive Money", related: "200 - Sales, 820 - GST", amount: 870, line: 1 }),
    row({ reference: CH, source: "Spend Money", related: "506 - Stripe Fees", amount: -1172, line: 2 }),
  ]);
  const surcharge = payout.parts.find((p) => /sales/i.test(p.account));
  const fee = payout.parts.find((p) => /stripe/i.test(p.account));
  assert.equal(surcharge.hasGst, true, "the surcharge reached the GST account");
  assert.equal(fee.hasGst, false, "the fee is supplied from offshore and reached none");
  assert.equal(surcharge.account, "200 - Sales", "the first related account still names it");
});
