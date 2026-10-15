import { test } from "node:test";
import assert from "node:assert/strict";
import { outsidePaymentJournals, taxSummary } from "../dist/index.js";

const invoice = (paidOutside) => ({
  number: "INV-9",
  kind: "sales",
  contact: "Slow Payer Ltd",
  reference: "",
  issued: "2026-04-10",
  due: "2026-05-10",
  total: 11500,
  tax: 1500,
  paid: 0,
  outstanding: 11500,
  currency: "NZD",
  status: "Awaiting Payment",
  lines: [{ description: "Work", accountCode: "200", taxType: "15% GST on Income", net: 10000, tax: 1500, gross: 11500 }],
  paidOutside,
});
const options = {
  control: { code: "610", name: "Accounts Receivable" },
  gst: { code: "820", name: "GST" },
};

test("a debt written off: the GST comes back out, and only the invoice basis claims it", () => {
  const [journal] = outsidePaymentJournals(
    invoice([{ date: "2026-09-30", amount: 11500, accountCode: "Bad debts - 465", note: "Written off", writeOff: true }]),
    options,
  );
  assert.deepEqual(
    journal.lines.map((l) => [l.accountCode, l.amount, l.taxType]),
    [
      ["610", -11500, "NONE"],
      ["Bad debts - 465", 10000, "NONE"],
      ["820", 1500, "BADDEBT"],
    ],
  );
  assert.equal(journal.lines.reduce((s, l) => s + l.amount, 0), 0);
  assert.equal(taxSummary([journal], { basis: "invoice" }).box13, 1500);
  // Never returned on the payments basis, so nothing to claim back -- and never received.
  const payments = taxSummary([journal], { basis: "payments" });
  assert.equal(payments.box13, 0);
  assert.equal(payments.box5, 0);
});

test("part of a debt written off claims the GST in that part", () => {
  const [journal] = outsidePaymentJournals(
    invoice([{ date: "2026-09-30", amount: 2300, accountCode: "465", writeOff: true }]),
    options,
  );
  assert.equal(journal.lines.find((l) => l.taxType === "BADDEBT")?.amount, 300);
});

test("a payment received outside the bank is still a payment", () => {
  const [journal] = outsidePaymentJournals(invoice([{ date: "2026-09-30", amount: 11500, accountCode: "880" }]), options);
  assert.equal(taxSummary([journal], { basis: "payments" }).box5, 11500);
});
