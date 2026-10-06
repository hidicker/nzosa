import assert from "node:assert/strict";
import test from "node:test";
import { bestAccountMatch, depreciationJournals } from "../dist/index.js";

const account = (code, name, type = "Fixed Asset") => ({
  code, name, type, taxCode: "No GST", description: "",
});

const ACCUMULATED = [
  account("711", "Less Accumulated Depreciation on Office Equipment"),
  account("731", "Less Accumulated Depreciation on Roasting Equipment"),
  account("741", "Less Accumulated Depreciation on Motor Vehicles"),
];

test("the contra account is scored, not taken first", () => {
  // The bug this exists for: "Roasting Equipment" shares the word "equipment"
  // with "Office Equipment", and the office account comes first. Taking the
  // first match put a whole year of roasting depreciation against the wrong
  // contra -- which still balances, and is still wrong.
  assert.equal(bestAccountMatch(ACCUMULATED, "Roasting Equipment").code, "731");
  assert.equal(bestAccountMatch(ACCUMULATED, "Office Equipment").code, "711");
  assert.equal(bestAccountMatch(ACCUMULATED, "Motor Vehicles").code, "741");
});

test("a longer word outweighs a shorter one", () => {
  // "Roasting" is the distinctive half and the longer half. That is not a
  // coincidence worth relying on, but it is why length is the weight.
  const both = [
    account("711", "Accumulated Depreciation Equipment"),
    account("731", "Accumulated Depreciation Roasting Equipment"),
  ];
  assert.equal(bestAccountMatch(both, "Roasting Equipment").code, "731");
});

test("short words are ignored, so 'the' and 'and' decide nothing", () => {
  const accounts = [
    account("711", "Accumulated Depreciation and the Office"),
    account("731", "Accumulated Depreciation Roasting"),
  ];
  assert.equal(bestAccountMatch(accounts, "Roasting and the Equipment").code, "731");
});

test("a type that matches nothing still lands somewhere rather than nowhere", () => {
  // Better a visible figure against the first contra than a journal quietly
  // posted to an empty account code.
  assert.equal(bestAccountMatch(ACCUMULATED, "Nothing Alike").code, "711");
  assert.equal(bestAccountMatch([], "Nothing Alike"), undefined);
});

const ASSET = {
  number: "FA-0001", name: "Roaster", type: "Roasting Equipment", status: "Registered",
  purchased: "2024-06-01", depreciationFrom: "2024-06-01", cost: 1200000,
  rate: 20, method: "DV", averaging: "", disposed: null,
};
const txn = (date) => ({
  id: date, date, account: "090", amount: 1000, otherParty: "", particulars: "",
  code: "", reference: "", description: "", currency: "NZD", source: "bank",
});

test("no assets, no journals", () => {
  assert.deepEqual(
    depreciationJournals({ assets: [], transactions: [txn("2025-06-01")], chart: ACCUMULATED }),
    [],
  );
});

test("only the years the transactions reach are posted", () => {
  // Depreciation is a year-end entry. A year with no trading in it is not a
  // year this ledger covers, and posting into it invents a period.
  const chart = [...ACCUMULATED, account("416", "Depreciation", "Expense")];
  const one = depreciationJournals({ assets: [ASSET], transactions: [txn("2025-06-01")], chart });
  const two = depreciationJournals({
    assets: [ASSET], chart,
    transactions: [txn("2025-06-01"), txn("2026-06-01")],
  });
  assert.equal(one.length, 1, "one year of trading, one charge");
  assert.equal(two.length, 2);
  assert.deepEqual(two.map((j) => j.date), ["2026-03-31", "2027-03-31"]);
});

test("the charge lands on the depreciation expense account the chart names", () => {
  const chart = [...ACCUMULATED, account("416", "Depreciation", "Expense")];
  const [journal] = depreciationJournals({
    assets: [ASSET], transactions: [txn("2025-06-01")], chart,
  });
  const codes = journal.lines.map((l) => l.accountCode);
  assert.ok(codes.includes("416"), "the expense");
  assert.ok(codes.includes("731"), "and the roasting contra, not the office one");
  assert.equal(journal.lines.reduce((s, l) => s + l.amount, 0), 0, "and it balances");
});

test("without an account named Depreciation the charge still has somewhere to go", () => {
  const [journal] = depreciationJournals({
    assets: [ASSET], transactions: [txn("2025-06-01")], chart: ACCUMULATED,
  });
  assert.ok(journal.lines.some((l) => l.accountCode === "416"), "the conventional code");
});

test("the year in progress is posted month by month, for the months finished", () => {
  // Mid-year, a whole year's charge dated a 31 March still to come made a
  // profit and loss to date carry twelve months of depreciation for six.
  const chart = [...ACCUMULATED, account("416", "Depreciation", "Expense")];
  const transactions = [txn("2025-06-01"), txn("2026-06-01")];
  const whole = depreciationJournals({ assets: [ASSET], transactions, chart });
  const monthly = depreciationJournals({ assets: [ASSET], transactions, chart, today: "2026-09-29" });
  const charge = (j) => j.lines.find((l) => l.accountCode === "416").amount;

  // The finished year is as it was: one charge at its 31 March.
  assert.equal(monthly[0].date, "2026-03-31");
  assert.equal(charge(monthly[0]), charge(whole[0]));

  // The year in progress: April to August, September not finished yet.
  const thisYear = monthly.slice(1);
  assert.deepEqual(thisYear.map((j) => j.date), [
    "2026-04-30", "2026-05-31", "2026-06-30", "2026-07-31", "2026-08-31",
  ]);
  const toDate = thisYear.reduce((s, j) => s + charge(j), 0);
  const fullYear = charge(whole[1]);
  assert.ok(Math.abs(toDate - Math.round((fullYear * 5) / 12)) <= 1, "five twelfths of the year");
  for (const j of thisYear) assert.equal(j.lines.reduce((s, l) => s + l.amount, 0), 0);
});

test("on the last day of the year every month is posted, and they add up to the year", () => {
  const chart = [...ACCUMULATED, account("416", "Depreciation", "Expense")];
  const transactions = [txn("2026-06-01")];
  const whole = depreciationJournals({ assets: [ASSET], transactions, chart });
  const monthly = depreciationJournals({ assets: [ASSET], transactions, chart, today: "2027-04-01" });
  const sum = (list) => list.reduce((s, j) => s + j.lines.find((l) => l.accountCode === "416").amount, 0);
  assert.equal(monthly.length, 1, "the year is finished by then: one charge");
  assert.equal(sum(monthly), sum(whole));
  const lastDay = depreciationJournals({ assets: [ASSET], transactions, chart, today: "2027-03-31" });
  assert.equal(lastDay.length, 11, "March not yet finished on its last day");
});
