import assert from "node:assert/strict";
import test from "node:test";
import { daysWork, localDay, transactionIdsIn } from "../dist/index.js";

const txn = (id, date = "2026-06-01", amount = -1000) => ({
  id, date, amount, account: "BNZ 01", otherParty: "Someone", particulars: "",
  code: "", reference: "", description: "", currency: "NZD", source: "bank",
});
const event = (over) => ({
  id: "e1", at: "2026-09-13T06:14:03.651Z", kind: "coding", who: "someone",
  summary: "coded something", ...over,
});
const journal = (transactionId, lines) => ({
  transactionId, date: "2026-06-01", narration: "", lines, source: "bank", taxBasis: "payments",
});

test("a day is the day where the person is, not in UTC", () => {
  // 06:14 UTC on the 13th is the afternoon of the 13th in New Zealand, but
  // 20:00 UTC on the 12th is already the 13th there. A day's work that used
  // UTC would show the morning's entries under yesterday.
  assert.equal(localDay("2026-09-13T06:14:03.651Z", 0), "2026-09-13");
  assert.equal(localDay("2026-09-12T20:00:00.000Z", 12 * 60), "2026-09-13");
  assert.equal(localDay("2026-09-13T06:14:03.651Z", 12 * 60), "2026-09-13");
});

test("only the decisions of that day are counted", () => {
  const out = daysWork({
    events: [
      event({ id: "a", at: "2026-09-13T01:00:00Z", targetId: "t1" }),
      event({ id: "b", at: "2026-09-12T01:00:00Z", targetId: "t2" }),
    ],
    transactions: [txn("t1"), txn("t2")],
    journals: [],
    on: "2026-09-13",
  });
  assert.deepEqual(out.events.map((e) => e.id), ["a"]);
  assert.deepEqual(out.transactions.map((t) => t.id), ["t1"]);
});

test("changes that post nothing are left out", () => {
  // Renaming an account or editing a rule changes what future coding will say
  // and posts nothing itself; including them buries the entries that did.
  const out = daysWork({
    events: [
      event({ id: "a", kind: "rule", summary: "changed a rule" }),
      event({ id: "b", kind: "chart", summary: "renamed an account" }),
      event({ id: "c", kind: "entities", summary: "assigned an account" }),
    ],
    transactions: [], journals: [], on: "2026-09-13",
  });
  assert.deepEqual(out.events, []);
});

test("a batch counts every line it accepted", () => {
  // Somebody who accepted two hundred codings in one click did two hundred
  // things and should see them.
  const ids = transactionIdsIn(event({
    kind: "codingBatch",
    before: [{ id: "t1", before: null }, { id: "t2", before: null }],
  }));
  assert.deepEqual(ids.sort(), ["t1", "t2"]);
});

test("a transfer counts both of its legs", () => {
  const ids = transactionIdsIn(event({
    kind: "transferBatch", after: [{ from: "a", to: "b" }, { from: "c", to: "d" }],
  }));
  assert.deepEqual(ids.sort(), ["a", "b", "c", "d"]);
});

test("the journals arising from those lines are gathered", () => {
  const out = daysWork({
    events: [event({ targetId: "t1" })],
    transactions: [txn("t1"), txn("t2")],
    journals: [
      journal("t1", [{ accountCode: "400", accountName: "Advertising", amount: 1000, description: "" },
                     { accountCode: "", accountName: "BNZ 01", amount: -1000, description: "" }]),
      journal("t2", [{ accountCode: "400", accountName: "Advertising", amount: 500, description: "" },
                     { accountCode: "", accountName: "BNZ 01", amount: -500, description: "" }]),
    ],
    on: "2026-09-13",
  });
  assert.equal(out.journals.length, 1, "only the one arising from today's decision");
  assert.equal(out.debits, 1000);
  assert.equal(out.credits, 1000, "and it balances, or the posting is wrong");
});

test("a split posts under its parts, and those count too", () => {
  // Splitting a line posts under `id:1`, `id:2` and so on. Without following
  // that, splitting showed the decision and none of the entries it caused.
  const out = daysWork({
    events: [event({ kind: "split", targetId: "t1" })],
    transactions: [txn("t1")],
    journals: [
      journal("t1:1", [{ accountCode: "400", accountName: "A", amount: 600, description: "" },
                       { accountCode: "", accountName: "BNZ", amount: -600, description: "" }]),
      journal("t1:2", [{ accountCode: "420", accountName: "B", amount: 400, description: "" },
                       { accountCode: "", accountName: "BNZ", amount: -400, description: "" }]),
      journal("other", [{ accountCode: "400", accountName: "A", amount: 900, description: "" }]),
    ],
    on: "2026-09-13",
  });
  assert.equal(out.journals.length, 2);
  assert.equal(out.debits, 1000);
  assert.equal(out.credits, 1000);
});

test("a decision about a line the ledger no longer holds is reported, not dropped", () => {
  // Clearing the books and re-importing changes transaction ids. Saying so
  // beats a day's work that quietly counts fewer entries than decisions.
  const out = daysWork({
    events: [event({ targetId: "gone" })],
    transactions: [], journals: [], on: "2026-09-13",
  });
  assert.deepEqual(out.missing, ["gone"]);
  assert.deepEqual(out.transactions, []);
});

test("the newest decision is first", () => {
  const out = daysWork({
    events: [
      event({ id: "early", at: "2026-09-13T01:00:00Z" }),
      event({ id: "late", at: "2026-09-13T09:00:00Z" }),
    ],
    transactions: [], journals: [], on: "2026-09-13",
  });
  assert.deepEqual(out.events.map((e) => e.id), ["late", "early"]);
});

test("a day with nothing on it is empty rather than wrong", () => {
  const out = daysWork({ events: [], transactions: [], journals: [], on: "2026-09-13" });
  assert.deepEqual(out.events, []);
  assert.equal(out.debits, 0);
  assert.equal(out.credits, 0);
});

test("a transfer leg is explained by its pair, not reported as posting nothing", () => {
  // A transfer between your own accounts posts once for the pair. Without
  // following that, the leg which did not carry the posting looked as though
  // nothing had happened -- which on a day of pairing transfers was most of
  // the page.
  const out = daysWork({
    events: [event({ kind: "transfer", targetId: "legA" })],
    transactions: [txn("legA"), txn("legB")],
    journals: [
      journal("legB", [
        { accountCode: "", accountName: "BNZ 01", amount: -9717, description: "" },
        { accountCode: "", accountName: "Loan", amount: 9717, description: "" },
      ]),
    ],
    transfers: { legA: "legB", legB: "legA" },
    on: "2026-09-13",
  });
  assert.equal(out.journals.length, 1, "the pair's single posting is counted");
  assert.equal(out.debits, 9717);
  assert.equal(out.credits, 9717);
  assert.ok(out.postedWithPair.has("legA"), "and legA is explained by legB");
});

test("a line with no posting and no pair is still reported as posting nothing", () => {
  const out = daysWork({
    events: [event({ targetId: "t1" })],
    transactions: [txn("t1")],
    journals: [],
    on: "2026-09-13",
  });
  assert.equal(out.postedWithPair.size, 0);
});

import { sourceIdsOf } from "../dist/index.js";

test("a journal's id says which bank lines it came from", () => {
  // Not always a transaction id: a split posts under `id:1`, and a transfer
  // posts once for the pair under `transfer:<a>:<b>` with neither leg being
  // the id itself. Reading that wrongly reported fourteen decisions as having
  // posted nothing.
  assert.deepEqual(sourceIdsOf("abc"), ["abc"]);
  assert.deepEqual(sourceIdsOf("abc:1"), ["abc"]);
  assert.deepEqual(sourceIdsOf("abc:12"), ["abc"]);
  assert.deepEqual(sourceIdsOf("transfer:aaa:bbb"), ["aaa", "bbb"]);
});

test("a transfer's single journal is found from either leg", () => {
  const pairJournal = {
    transactionId: "transfer:legA:legB", date: "2026-07-17", narration: "Transfer",
    source: "transfer", taxBasis: "payments",
    lines: [
      { accountCode: "", accountName: "BNZ 01", amount: -9717, description: "" },
      { accountCode: "", accountName: "Loan", amount: 9717, description: "" },
    ],
  };
  for (const leg of ["legA", "legB"]) {
    const out = daysWork({
      events: [event({ kind: "transfer", targetId: leg })],
      transactions: [txn("legA"), txn("legB")],
      journals: [pairJournal],
      transfers: { legA: "legB", legB: "legA" },
      on: "2026-09-13",
    });
    assert.equal(out.journals.length, 1, `found from ${leg}`);
    assert.equal(out.debits, 9717);
    assert.equal(out.credits, 9717);
  }
});
