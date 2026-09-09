import assert from "node:assert/strict";
import test from "node:test";
import {
  parseDailyBalances,
  matchBalanceAccount,
  checkDailyBalances,
} from "../dist/bank-balances.js";

const tx = (date, amount, account = "02-1100-0022001-001") => ({
  id: `${account}:${date}:${amount}`,
  date,
  amount,
  currency: "NZD",
  account,
  serial: "",
  trn: "",
  particulars: "",
  code: "",
  reference: "",
  otherParty: "",
  origin: "",
  type: "",
  batch: "",
  otherPartyAccount: "",
});

const file = [
  "Kea Coffee Roasters - 02-1100-0022001-001",
  "Date,CCY,Opening Balance,Debits,Credits,Closing Balance",
  '"02/09/2024","NZD","0.00","0.00","1000.00","1000.00"',
  '"03/09/2024","NZD","1000.00","-250.00","0.00","750.00"',
  '"04/09/2024","NZD","750.00","0.00","0.00","750.00"',
].join("\n");

test("reads each account section and its daily closing balances", () => {
  const { sections, problems } = parseDailyBalances(file);
  assert.equal(problems.length, 0);
  assert.equal(sections.length, 1);
  assert.equal(sections[0]?.account, "02-1100-0022001-001");
  assert.equal(sections[0]?.label, "Kea Coffee Roasters");
  assert.deepEqual(
    sections[0]?.days.map((d) => [d.date, d.closing]),
    [
      ["2024-09-02", 100000],
      ["2024-09-03", 75000],
      ["2024-09-04", 75000],
    ],
  );
});

test("several accounts in one file are kept apart", () => {
  const two = [
    file,
    "Spending - 02-1100-0022001-000",
    "Date,CCY,Opening Balance,Debits,Credits,Closing Balance",
    '"02/09/2024","NZD","0.00","0.00","50.00","50.00"',
  ].join("\n");
  const { sections } = parseDailyBalances(two);
  assert.equal(sections.length, 2);
  assert.equal(sections[1]?.account, "02-1100-0022001-000");
  assert.equal(sections[1]?.days.length, 1);
});

test("a complete import ties, whatever the balance was beforehand", () => {
  const { sections } = parseDailyBalances(file);
  // Deliberately short of the bank's figure by a fixed 500: money that was in
  // the account before our data starts. That is not an error.
  const [check] = checkDailyBalances(sections, [
    tx("2024-09-02", 50000),
    tx("2024-09-03", -25000),
  ]);
  assert.deepEqual(check?.breaks, []);
  assert.equal(check?.outBy, 0);
  assert.equal(check?.openingOffset, 50000);
  assert.equal(check?.agreedUntil, "2024-09-04");
});

test("a missing transaction is named on the day it happened", () => {
  const { sections } = parseDailyBalances(file);
  // The 250 payment on the 3rd never made it into the import.
  const [check] = checkDailyBalances(sections, [tx("2024-09-02", 100000)]);
  assert.equal(check?.breaks.length, 1);
  assert.equal(check?.breaks[0]?.date, "2024-09-03");
  assert.equal(check?.breaks[0]?.difference, -25000, "money the bank saw leave and we did not");
  assert.equal(check?.outBy, -25000);
  assert.equal(check?.agreedUntil, "2024-09-02", "the last day both sides agreed");
});

test("a duplicated transaction breaks the other way", () => {
  const { sections } = parseDailyBalances(file);
  const [check] = checkDailyBalances(sections, [
    tx("2024-09-02", 100000),
    tx("2024-09-03", -25000),
    { ...tx("2024-09-03", -25000), id: "again" },
  ]);
  assert.equal(check?.breaks.length, 1);
  assert.equal(check?.breaks[0]?.difference, 25000, "we hold more movement than the bank");
});

test("one break does not make every later day wrong", () => {
  // The whole reason for comparing the offset rather than the balance itself.
  const longer = [
    "Kea Coffee Roasters - 02-1100-0022001-001",
    "Date,CCY,Opening Balance,Debits,Credits,Closing Balance",
    '"02/09/2024","NZD","0.00","0.00","1000.00","1000.00"',
    '"03/09/2024","NZD","1000.00","-250.00","0.00","750.00"',
    '"04/09/2024","NZD","750.00","-100.00","0.00","650.00"',
    '"05/09/2024","NZD","650.00","-100.00","0.00","550.00"',
  ].join("\n");
  const { sections } = parseDailyBalances(longer);
  const [check] = checkDailyBalances(sections, [
    tx("2024-09-02", 100000),
    // the 3rd is missing
    tx("2024-09-04", -10000),
    tx("2024-09-05", -10000),
  ]);
  assert.equal(check?.breaks.length, 1, "one missing transaction, one break");
  assert.equal(check?.breaks[0]?.date, "2024-09-03");
});

test("a weekend transaction lands in the next listed day without complaint", () => {
  // The file lists business days only. Money moving on the Saturday shows up
  // in Monday's closing balance, and our transaction is dated the Saturday.
  const overWeekend = [
    "Kea Coffee Roasters - 02-1100-0022001-001",
    "Date,CCY,Opening Balance,Debits,Credits,Closing Balance",
    '"06/09/2024","NZD","1000.00","0.00","0.00","1000.00"',
    '"09/09/2024","NZD","1000.00","0.00","0.00","800.00"',
  ].join("\n");
  const { sections } = parseDailyBalances(overWeekend);
  const [check] = checkDailyBalances(sections, [
    tx("2024-09-06", 0),
    tx("2024-09-07", -20000),
  ]);
  assert.deepEqual(check?.breaks, []);
});

test("a card is matched to our account by its last four digits", () => {
  const accounts = ["02-1100-0022001-001", "bnz-advantage-visa-platinum-4003"];
  assert.equal(
    matchBalanceAccount({ account: "XXXX-XXXX-XXXX-4003" }, accounts),
    "bnz-advantage-visa-platinum-4003",
  );
  assert.equal(matchBalanceAccount({ account: "02-1100-0022001-001" }, accounts), "02-1100-0022001-001");
});

test("an ambiguous card is left unmatched rather than guessed", () => {
  const accounts = ["one-card-4003", "another-card-4003"];
  assert.equal(matchBalanceAccount({ account: "XXXX-XXXX-XXXX-4003" }, accounts), null);
});

test("an account we hold nothing for is reported, not skipped", () => {
  const { sections } = parseDailyBalances(file);
  const [check] = checkDailyBalances(sections, [tx("2024-09-02", 5000, "some-other-account")]);
  assert.equal(check?.account, null);
  assert.equal(check?.transactions, 0);
  // And reported as nothing to compare rather than as a disagreement. The
  // bank's balance moves on the 3rd; totalling no transactions against it
  // would have called that a break and the account out by the movement.
  assert.deepEqual(check?.breaks, []);
  assert.equal(check?.outBy, 0);
  assert.equal(check?.openingOffset, 0);
  assert.equal(check?.agreedUntil, null);
});

test("a date that is not a date is reported, not accepted", () => {
  // Month 13 would otherwise become "2024-13-31", which is not a date but
  // sorts after every real one, quietly corrupting the comparison.
  const { sections, problems } = parseDailyBalances(
    ['Acme - 02-1', '"31/13/2024","NZD","0","0","0","5.00"'].join("\n"),
  );
  assert.equal(sections[0]?.days.length, 0);
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? "", /not a valid day\/month\/year/);
});

test("a file written month-first is refused rather than mis-read", () => {
  const { sections, problems } = parseDailyBalances(
    [
      "Acme - 02-1",
      '"04/13/2024","NZD","0","0","0","5.00"',
      '"04/14/2024","NZD","0","0","0","6.00"',
    ].join("\n"),
  );
  assert.equal(sections[0]?.days.length, 0, "nothing is read from it");
  assert.equal(problems.length, 2, "and it says so for every row");
});

test("the 31st of a thirty-day month is refused", () => {
  const { problems } = parseDailyBalances(
    ['Acme - 02-1', '"31/04/2024","NZD","0","0","0","5.00"'].join("\n"),
  );
  assert.equal(problems.length, 1);
});

test("a leap day is accepted in a leap year and refused otherwise", () => {
  const leap = parseDailyBalances(['Acme - 02-1', '"29/02/2024","NZD","0","0","0","5.00"'].join("\n"));
  assert.equal(leap.sections[0]?.days[0]?.date, "2024-02-29");
  const notLeap = parseDailyBalances(['Acme - 02-1', '"29/02/2025","NZD","0","0","0","5.00"'].join("\n"));
  assert.equal(notLeap.problems.length, 1);
});

test("an account name containing a dash keeps the account, not the name", () => {
  const { sections } = parseDailyBalances(
    ['Kea Coffee - Trading - 02-1100-0022001-001', '"01/04/2024","NZD","0","0","0","5.00"'].join("\n"),
  );
  assert.equal(sections[0]?.account, "02-1100-0022001-001");
  assert.equal(sections[0]?.label, "Kea Coffee - Trading");
});

test("rows out of order are put in order before comparing", () => {
  const { sections } = parseDailyBalances(
    [
      "Acme - 02-1",
      '"03/04/2024","NZD","0","0","0","3.00"',
      '"01/04/2024","NZD","0","0","0","1.00"',
    ].join("\n"),
  );
  assert.deepEqual(sections[0]?.days.map((d) => d.date), ["2024-04-01", "2024-04-03"]);
});

test("an accounting negative is a negative, not a zero", () => {
  const csv = [
    "Account,Date,CCY,Opening,Debits,Credits,Closing",
    "Sample Account - 02-1100-0022002-02",
    "01/07/2024,NZD,0.00,0.00,0.00,(530.61)",
  ].join("\r\n");

  const { sections, problems } = parseDailyBalances(csv);
  const days = sections.flatMap((s) => s.days);
  assert.deepEqual(problems, []);
  assert.equal(days.length, 1);
  assert.equal(days[0].closing, -53061, "(530.61) is minus $530.61");
});

test("a closing balance that cannot be read is reported, not silently zero", () => {
  // This file exists to prove a running balance against the bank's own. A
  // figure read as zero either invents a break or hides one, and does it
  // without saying anything.
  const csv = [
    "Account,Date,CCY,Opening,Debits,Credits,Closing",
    "Sample Account - 02-1100-0022002-02",
    "01/07/2024,NZD,0.00,0.00,0.00,not a number",
  ].join("\r\n");

  const { sections, problems } = parseDailyBalances(csv);
  assert.equal(sections.flatMap((s) => s.days).length, 0, "the row is not counted");
  assert.equal(problems.length, 1);
  assert.match(problems[0], /is not a figure/);
});
