import { test } from "node:test";
import assert from "node:assert/strict";
import { paidTo } from "../dist/index.js";

const line = (id, date, amount, otherParty) => ({ id, date, amount, otherParty, account: "bank", currency: "NZD", serial: "", trn: "", particulars: "", code: "", reference: "", origin: "", type: "", batch: "", otherPartyAccount: "", occurrence: 1, extras: {}, source: { importer: "x", file: "x", line: 1 } });

test("paid this year and all time: out to them, back from them taken off, bills paid another way", () => {
  const lines = [
    line("a", "2025-06-01", -10_000, "BEAN CO"),
    line("b", "2026-05-01", -20_000, "Bean Co"),
    line("c", "2026-06-01", 3_000, "Bean Co"),
    line("d", "2026-06-02", -5_000, "POS 4021 BEANCO"),
    line("e", "2026-06-03", -7_000, "Other Ltd"),
  ];
  const overrides = { d: { contact: "Bean Co", note: "named" } };
  const bills = [{ number: "B1", kind: "purchase", contact: "Bean Co", reference: "", issued: "2026-07-01", due: null, total: 4_000, paid: 0, outstanding: 0, status: "", lines: [], paidOutside: [{ date: "2026-07-02", amount: 4_000, accountCode: "Owner" }, { date: "2026-07-03", amount: 1, accountCode: "x", writeOff: true }] }];
  const r = paidTo("Bean Co", lines, overrides, bills, { from: "2026-04-01", to: "2027-03-31" });
  assert.equal(r.period, 20_000 - 3_000 + 5_000 + 4_000);
  assert.equal(r.allTime, r.period + 10_000);
  assert.equal(r.payments, 5);
  assert.equal(r.last, "2026-07-02");
  assert.deepEqual(paidTo("", lines, {}, [], { from: "2026-04-01", to: "2027-03-31" }), { period: 0, allTime: 0, payments: 0, last: null });
});
