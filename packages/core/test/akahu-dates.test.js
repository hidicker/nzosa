import assert from "node:assert/strict";
import test from "node:test";
import { nzDate, fromAkahu } from "../dist/akahu.js";

test("an instant just after local midnight is that day, not the one before", () => {
  // 12:57am on Friday 10 July, sent as the UTC instant it is. Read as UTC it
  // is Thursday the 9th, which is a day nobody in New Zealand was looking at.
  assert.equal(nzDate("2026-07-09T12:57:46.000Z"), "2026-07-10");
});

test("an instant just before local midnight is still that day", () => {
  // 11:59pm on Monday 13 July. This one survived being read as UTC, which is
  // why only one side of a transfer was ever wrong.
  assert.equal(nzDate("2026-07-13T11:59:00.000Z"), "2026-07-13");
});

test("daylight saving is the platform's problem, not a table in here", () => {
  // January is NZDT, thirteen hours ahead: 12:01Z is 1:01am on the 9th.
  assert.equal(nzDate("2026-01-08T12:01:11.000Z"), "2026-01-09");
  // The same clock time in July is NZST, twelve hours ahead, and lands on the
  // 9th as well -- from a different UTC day.
  assert.equal(nzDate("2026-01-09T10:59:58.000Z"), "2026-01-09");
});

test("a date with no time in it is left where it is", () => {
  // Parsed as UTC midnight, which is midday here: the same day either way.
  assert.equal(nzDate("2026-07-09"), "2026-07-09");
});

test("an offset that is already local is honoured", () => {
  assert.equal(nzDate("2026-07-10T00:57:46+12:00"), "2026-07-10");
});

test("nonsense is refused rather than guessed at", () => {
  assert.equal(nzDate(""), null);
  assert.equal(nzDate("not a date"), null);
});

test("the importer files a repayment on the day the country was having", () => {
  const { transactions, problems } = fromAkahu(
    [
      {
        _id: "trans_a", _account: "acc_loan", date: "2026-07-09T12:57:46.000Z",
        description: "02-1100-0022001-00", amount: 483.63, type: "LOAN",
      },
      {
        _id: "trans_b", _account: "acc_cheque", date: "2026-07-13T11:59:00.000Z",
        description: "SCHEDULED REPAYMENT", amount: -483.63, type: "LOAN",
      },
    ],
    { accountFor: (id) => (id === "acc_loan" ? "term-loan-0011" : "02-1100-0022001-000") },
  );
  assert.equal(problems.length, 0);
  assert.deepEqual(transactions.map((t) => t.date), ["2026-07-10", "2026-07-13"]);
  // Three days apart, which is what the two legs of this transfer really are.
  const days = (Date.parse(transactions[1].date) - Date.parse(transactions[0].date)) / 86400000;
  assert.equal(days, 3);
});

test("a date it cannot read is a problem, not a transaction", () => {
  const { transactions, problems } = fromAkahu(
    [{ _id: "t", _account: "acc", date: "whenever", description: "x", amount: 1 }],
    { accountFor: () => "some-account" },
  );
  assert.equal(transactions.length, 0);
  assert.match(problems[0]?.message ?? "", /unreadable date/);
});

test("the feed is asked from a week early, so a line stamped at NZ midnight on the start day is not missed", async () => {
  const { feedRequestFrom, onOrAfter, nzDate } = await import("../dist/index.js");
  // A line on 1 April, stamped at midnight New Zealand time: the evening of
  // 31 March in UTC. Asked from midnight UTC on 1 April, it never came back.
  const stamped = "2026-03-31T11:00:00.000Z";
  assert.equal(nzDate(stamped), "2026-04-01");
  const from = feedRequestFrom("2026-04-01");
  assert.equal(from, "2026-03-25T00:00:00.000Z");
  assert.ok(Date.parse(stamped) >= Date.parse(from), "the request now reaches it");
  const lines = [{ date: "2026-03-30" }, { date: "2026-03-31" }, { date: "2026-04-01" }, { date: "2026-04-02" }];
  assert.deepEqual(onOrAfter(lines, "2026-04-01").map((l) => l.date), ["2026-04-01", "2026-04-02"]);
  assert.equal(onOrAfter(lines, undefined).length, 4, "no start known: everything the feed gave");
});
