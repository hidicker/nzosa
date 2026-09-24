import test from "node:test";
import assert from "node:assert/strict";
import { bondStatus, rentDueDate, rentOn, rentPosition } from "../dist/index.js";

function receipt(date, amount, narration = "SMITH J RENT") {
  return {
    transactionId: `r${date}`,
    date,
    narration,
    source: "bank",
    taxBasis: "both",
    lines: [
      { accountCode: "2110", accountName: "Rent", amount: -amount, taxType: "NONE", description: narration },
      { accountCode: "090", accountName: "Bank", amount, taxType: "NONE", description: "" },
    ],
  };
}

const weekly = {
  id: "t1", entityId: "e", tenant: "J Smith", start: "2026-01-05", frequency: "weekly",
  rents: [{ from: "2026-01-05", amount: 50_000 }, { from: "2026-02-02", amount: 55_000 }],
  accounts: ["2110"],
};

test("due dates: weekly, fortnightly, and monthly keeping the day or the month's last", () => {
  assert.equal(rentDueDate("2026-01-05", "weekly", 2), "2026-01-19");
  assert.equal(rentDueDate("2026-01-05", "fortnightly", 2), "2026-02-02");
  assert.equal(rentDueDate("2026-01-31", "monthly", 1), "2026-02-28");
  assert.equal(rentDueDate("2026-01-31", "monthly", 2), "2026-03-31");
});

test("the rent in force on a date follows every change", () => {
  assert.equal(rentOn(weekly.rents, "2026-01-26"), 50_000);
  assert.equal(rentOn(weekly.rents, "2026-02-02"), 55_000);
});

test("paid up exactly: no balance, paid to the end of the current week", () => {
  const journals = ["2026-01-05", "2026-01-12", "2026-01-19", "2026-01-26"].map((d) => receipt(d, 50_000));
  journals.push(receipt("2026-02-02", 55_000));
  const p = rentPosition(weekly, journals, "2026-02-04");
  assert.equal(p.totalDue, 4 * 50_000 + 55_000);
  assert.equal(p.balance, 0);
  assert.equal(p.paidTo, "2026-02-08");
});

test("behind: a missed week shows as owed, in weeks of the current rent", () => {
  const journals = ["2026-01-05", "2026-01-12", "2026-01-26"].map((d) => receipt(d, 50_000));
  journals.push(receipt("2026-02-02", 55_000));
  const p = rentPosition(weekly, journals, "2026-02-04");
  assert.equal(p.balance, 50_000);
  assert.equal(p.periodsBehind, 0.9);
  assert.equal(p.paidTo, "2026-02-01");
});

test("in advance: paying ahead shows a negative balance", () => {
  const journals = [receipt("2026-01-05", 150_000)];
  const p = rentPosition(weekly, journals, "2026-01-06");
  assert.equal(p.balance, -100_000);
  assert.equal(p.paidTo, "2026-01-25");
});

test("payer words pick one tenant out of a shared account", () => {
  const journals = [receipt("2026-01-05", 50_000), receipt("2026-01-05", 40_000, "BROWN K RENT")];
  const p = rentPosition({ ...weekly, payer: "smith" }, journals, "2026-01-06");
  assert.equal(p.totalPaid, 50_000);
});

test("GST-registered rent is read as the tenant paid it, GST included", () => {
  const withGst = {
    transactionId: "g", date: "2026-01-05", narration: "SHOP RENT", source: "bank", taxBasis: "both",
    lines: [
      { accountCode: "2100", accountName: "Rent", amount: -100_000, taxType: "OUTPUT2", taxBase: 115_000, description: "" },
      { accountCode: "820", accountName: "GST", amount: -15_000, taxType: "OUTPUT2", description: "" },
      { accountCode: "090", accountName: "Bank", amount: 115_000, taxType: "NONE", description: "" },
    ],
  };
  const shop = { ...weekly, frequency: "monthly", rents: [{ from: "2026-01-05", amount: 115_000 }], accounts: ["2100"] };
  const p = rentPosition(shop, [withGst], "2026-01-10");
  assert.equal(p.balance, 0);
});

test("a tenancy ending mid-period owes only the days up to the end", () => {
  const ended = { ...weekly, rents: [{ from: "2026-01-05", amount: 70_000 }], end: "2026-01-14" };
  const p = rentPosition(ended, [], "2026-03-01");
  // Two periods: a full week, then 3 of 7 days.
  assert.equal(p.totalDue, 70_000 + 30_000);
});

test("bond: a residential bond not lodged within 23 working days is flagged", () => {
  assert.match(bondStatus({ amount: 200_000, paidOn: "2026-01-05" }, true, "2026-03-01"), /must be lodged/);
  assert.match(bondStatus({ amount: 200_000, paidOn: "2026-01-05" }, true, "2026-01-10"), /within 23 working days/);
  assert.match(bondStatus({ amount: 200_000, paidOn: "2026-01-05", lodgedOn: "2026-01-20", reference: "123" }, true, "2026-03-01"), /lodged 2026-01-20/);
  assert.match(bondStatus({ amount: 200_000, paidOn: "2026-01-05" }, false, "2026-06-01"), /held by the landlord/);
});
