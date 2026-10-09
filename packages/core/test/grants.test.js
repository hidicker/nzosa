import assert from "node:assert/strict";
import test from "node:test";
import { endedWithMoneyLeft, grantPosition, grantReportRows, grantYearEnd, reportsDue, unspentForBooks } from "../dist/index.js";

function line(id, date, amount, otherParty, particulars = "") {
  return {
    id, date, amount, currency: "NZD", account: "12-3456-7890123-00", serial: "", trn: "", particulars,
    code: "", reference: "", otherParty, origin: "", type: "", batch: "", otherPartyAccount: "", occurrence: 1,
  };
}

const grant = {
  id: "g1", entityId: "club", funder: "Kowhai Community Trust", purpose: "Junior coaching",
  amount: 500_000, conditional: true, from: "2026-04-01", to: "2027-03-31",
};
const lines = [
  line("a", "2026-05-01", 500_000, "KOWHAI COMMUNITY TRUST"),
  line("b", "2026-06-10", -120_000, "RIMU SPORTS", "coach fees"),
  line("c", "2026-09-02", -80_000, "TOTARA COACHING", "term 3"),
  line("d", "2027-01-15", -50_000, "RIMU SPORTS", "balls"),
  line("e", "2026-07-01", -9_999, "SOMEONE ELSE"),
];
const links = { a: "g1", b: "g1", c: "g1", d: "g1" };

test("received, spent and what is held, to a date", () => {
  const p = grantPosition(grant, links, lines, "2026-12-31");
  assert.equal(p.received, 500_000);
  assert.equal(p.spent, 200_000, "the January spending is after the date");
  assert.equal(p.held, 300_000);
  assert.equal(p.awaiting, 0);
  assert.equal(grantPosition(grant, links, lines, "2027-03-31").spent, 250_000);
  assert.equal(grantPosition(grant, {}, lines, "2027-03-31").awaiting, 500_000, "nothing linked: all still awaited");
});

test("a line not linked to the grant is not counted", () => {
  assert.equal(grantPosition(grant, links, lines, "2027-03-31").spending.some((l) => l.id === "e"), false);
});

test("only a conditional grant leaves a liability, and net of GST when registered", () => {
  const p = grantPosition(grant, links, lines, "2026-12-31");
  assert.equal(unspentForBooks(p, false), 300_000);
  assert.equal(unspentForBooks(p, true), 300_000 - 39_130, "3/23 of 3,000.00 is 391.30");
  assert.equal(unspentForBooks({ ...p, grant: { ...grant, conditional: false } }, false), 0);
  assert.equal(unspentForBooks({ ...p, held: 0 }, false), 0);
  assert.equal(unspentForBooks({ ...p, held: -5_000 }, false), 0, "overspent is not a liability");
});

test("the year-end entry and its reversal come to nothing, and are linked", () => {
  const [entry, back] = grantYearEnd(grant, 300_000, "2027-03-31", { income: "Grants - 220", inAdvance: "Grants received in advance - 805" }, "2027-04-01");
  assert.equal(entry.lines[0].amount, 300_000, "debit the income");
  assert.equal(entry.lines[1].amount, -300_000, "credit the liability");
  assert.equal(back.date, "2027-04-01");
  assert.equal(back.reverses, entry.id);
  assert.equal(entry.lines.concat(back.lines).reduce((s, l) => s + l.amount, 0), 0);
  assert.equal(grantYearEnd(grant, 0, "2027-03-31", { income: "a", inAdvance: "b" }, "2027-04-01"), null);
});

test("reports due and money left after the period", () => {
  const due = [
    { ...grant, id: "x", reportDue: "2026-10-05" },
    { ...grant, id: "y", reportDue: "2026-10-05", reported: "2026-10-01" },
    { ...grant, id: "z", reportDue: "2027-06-01" },
    { ...grant, id: "w", reportDue: "2026-09-01", closed: "2026-09-30" },
  ];
  assert.deepEqual(reportsDue(due, "2026-10-01").map((g) => g.id), ["x"]);
  const ended = endedWithMoneyLeft([grant], links, lines, "2027-06-01");
  assert.equal(ended.length, 1);
  assert.equal(ended[0].held, 250_000);
  assert.equal(endedWithMoneyLeft([grant], links, lines, "2027-02-01").length, 0, "still within its period");
});

test("the funder's report says what was received, spent and left", () => {
  const rows = grantReportRows(grantPosition(grant, links, lines, "2027-03-31"), "Kowhai Junior Tennis", "2027-03-31");
  const flat = rows.map((r) => r.join("|"));
  assert.ok(flat.includes("Awarded|5000.00"));
  assert.ok(flat.includes("Spent|2500.00"));
  assert.ok(flat.includes("Held for this grant|2500.00"));
  assert.ok(flat.some((r) => r.includes("RIMU SPORTS") && r.includes("coach fees") && r.includes("1200.00")));
  assert.ok(flat.some((r) => r.includes("Total spent") && r.includes("2500.00")));
});
