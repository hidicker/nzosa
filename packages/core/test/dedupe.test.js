import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dedupe, dedupeKey, importFile } from "../dist/index.js";

const sample = (name) =>
  readFileSync(fileURLToPath(new URL(`../../../samples/${name}`, import.meta.url)), "utf8");

test("a clean import has nothing to deduplicate", () => {
  const { transactions } = importFile(sample("bnz-account.csv"), { file: "july.csv" });
  const result = dedupe(transactions);

  assert.equal(result.stats.total, 5);
  assert.equal(result.stats.duplicate, 0);
  assert.equal(result.kept.length, 5);
});

test("re-importing the same statement adds nothing", () => {
  // The overlapping-download problem this whole stage exists to solve.
  const july = importFile(sample("bnz-account.csv"), { file: "july.csv" }).transactions;
  const again = importFile(sample("bnz-account.csv"), { file: "july-reexport.csv" }).transactions;

  const result = dedupe([...july, ...again]);

  assert.equal(result.stats.duplicate, 5);
  assert.equal(result.kept.length, 5);
  // The rows already in the ledger are the ones kept.
  assert.deepEqual(
    result.kept.map((t) => t.source.file),
    Array(5).fill("july.csv"),
  );
});

test("never deletes: duplicates are classified, and every row comes back", () => {
  const july = importFile(sample("bnz-account.csv"), { file: "july.csv" }).transactions;
  const result = dedupe([...july, ...july]);

  assert.equal(result.entries.length, 10, "one entry per input row, always");
  for (const entry of result.entries) {
    assert.ok(entry.transaction, "the original row is always attached");
  }
});

test("a duplicate points at the row it duplicates and says why", () => {
  const july = importFile(sample("bnz-account.csv"), { file: "july.csv" }).transactions;
  const again = importFile(sample("bnz-account.csv"), { file: "august.csv" }).transactions;

  const result = dedupe([...july, ...again]);
  const duplicate = result.entries.find((entry) => entry.status === "duplicate");

  assert.equal(duplicate.duplicateOf, july[0].id);
  assert.match(duplicate.reason, /Identical to an earlier row from july\.csv:5/);
});

test("identical purchases within one export are all kept", () => {
  // Two identical coffees on one day. A bank export should not list one
  // transaction twice, so repeats inside a single file are real and are
  // numbered rather than collapsed.
  const { transactions } = importFile(sample("bnz-card.csv"), { file: "card.csv" });
  const coffee = transactions.filter((t) => t.otherParty === "LOCAL CAFE");

  assert.equal(coffee.length, 2);
  assert.deepEqual(
    coffee.map((t) => t.occurrence),
    [1, 2],
  );
  assert.notEqual(coffee[0].id, coffee[1].id, "each repeat gets its own id");

  const result = dedupe(transactions);
  assert.equal(result.stats.duplicate, 0);
  assert.equal(result.kept.length, 5);
});

test("re-importing a file with genuine repeats is still idempotent", () => {
  // The pair of properties that has to hold at once: three real repeats stay
  // three, and importing the same file again adds nothing. Numbering the
  // repeats is what makes both true; an allowlist alone made the second false.
  const first = importFile(sample("bnz-card.csv"), { file: "card.csv" }).transactions;
  const again = importFile(sample("bnz-card.csv"), { file: "card-reexport.csv" }).transactions;

  const result = dedupe([...first, ...again]);

  assert.equal(result.kept.length, 5, "still five, not ten");
  assert.equal(result.stats.duplicate, 5);
  assert.deepEqual(
    result.kept.map((t) => t.source.file),
    Array(5).fill("card.csv"),
  );
});

test("the allowlist still forces a cross-file repeat to be kept", () => {
  // Occurrence numbering handles repeats inside one file. The allowlist remains
  // for the case it cannot see: the same transaction legitimately arriving in
  // two separate exports.
  const [original] = importFile(sample("bnz-card.csv"), { file: "card.csv" }).transactions;
  const separate = { ...original, source: { ...original.source, file: "other.csv" } };

  assert.equal(dedupe([original, separate]).stats.duplicate, 1);

  const allowed = dedupe([original, separate], {
    legitimateDuplicates: [dedupeKey(original)],
  });
  assert.equal(allowed.stats.duplicate, 0);
  assert.equal(allowed.kept.length, 2);
  assert.match(allowed.entries[1].reason, /legitimate repeat/);
});

test("a re-export with a different serial is flagged, not dropped", () => {
  const [original] = importFile(sample("bnz-account.csv"), { file: "july.csv" }).transactions;
  const reexported = { ...original, serial: "99881", id: "reexport" };

  const result = dedupe([original, reexported]);

  assert.equal(result.stats.duplicate, 0, "a serial change is never auto-deleted");
  assert.equal(result.stats.review, 1);
  assert.equal(result.kept.length, 2, "both survive until a human decides");

  const flagged = result.entries[1];
  assert.equal(flagged.duplicateOf, original.id);
  assert.match(flagged.reason, /serial or reference differs/);
});

test("same amount and payee a day apart is flagged on feeds with no serial", () => {
  const { transactions } = importFile(sample("bnz-card.csv"), { file: "card.csv" });
  const coffee = transactions.find((t) => t.otherParty === "LOCAL CAFE");
  const nextDay = { ...coffee, date: "2024-07-05", id: "nextday" };

  const result = dedupe([coffee, nextDay]);
  const flagged = result.entries.find((entry) => entry.transaction === nextDay);

  assert.equal(flagged.status, "review");
  assert.match(flagged.reason, /1 day\(s\) apart/);
  assert.equal(result.kept.length, 2);
});

test("adjacent-date flagging leaves feeds that carry a serial alone", () => {
  // The BNZ account feed has a serial, so a repeat there is trustworthy.
  const [original] = importFile(sample("bnz-account.csv"), { file: "july.csv" }).transactions;
  const withSerial = { ...original, serial: "12345", id: "a" };
  const nextDay = { ...withSerial, date: "2024-07-02", id: "b" };

  const result = dedupe([withSerial, nextDay]);
  assert.equal(result.stats.review, 0);
  assert.equal(result.stats.unique, 2);
});

test("adjacent-date flagging can be switched off", () => {
  const { transactions } = importFile(sample("bnz-card.csv"), { file: "card.csv" });
  const coffee = transactions.find((t) => t.otherParty === "LOCAL CAFE");
  const nextDay = { ...coffee, date: "2024-07-05", id: "nextday" };

  const result = dedupe([coffee, nextDay], { adjacentDays: 0 });
  assert.equal(result.stats.review, 0);
});

test("a monthly repeat is not adjacent and stays clean", () => {
  // Two identical loan-interest charges a month apart on a feed with no serial.
  const { transactions } = importFile(sample("anz-loan.csv"), { account: "loan" });
  const interest = transactions.filter((t) => t.particulars === "Loan Interest");

  assert.equal(interest.length, 2);
  const result = dedupe(transactions);
  assert.equal(result.stats.duplicate, 0);
  assert.equal(result.stats.review, 0);
});

test("the same amount on two different accounts is two transactions", () => {
  const [original] = importFile(sample("bnz-account.csv"), { file: "july.csv" }).transactions;
  const otherAccount = { ...original, account: "02-1100-0099999-000", id: "other" };

  const result = dedupe([original, otherAccount]);
  assert.equal(result.stats.duplicate, 0);
  assert.equal(result.kept.length, 2);
});

test("dedupe keys cannot collide across field boundaries", () => {
  const [base] = importFile(sample("bnz-account.csv"), { file: "july.csv" }).transactions;
  const a = { ...base, particulars: "AB", code: "C" };
  const b = { ...base, particulars: "A", code: "BC" };

  assert.notEqual(dedupeKey(a), dedupeKey(b));
});

test("Wise dual-currency legs of one transfer are not duplicates", () => {
  const { transactions } = importFile(sample("wise.csv"), { account: "wise" });
  const result = dedupe(transactions);

  assert.equal(result.stats.duplicate, 0);
  assert.equal(result.kept.length, 5);
});

test("the same transaction from a feed and from a file is recognised", () => {
  // The two sources name the payee differently -- a feed normalises it and
  // folds the reference fields into its description -- so everything that
  // compares payees sees two different transactions. What both carry
  // identically is what the person paying typed.
  const shared = {
    date: "2026-08-28",
    amount: -530199,
    currency: "NZD",
    account: "02-1234-0056789-001",
    particulars: "IIT",
    code: "012345678",
    reference: "900000001",
    origin: "",
    type: "",
    batch: "",
    otherPartyAccount: "",
    occurrence: 1,
  };

  const fromFeed = {
    ...shared,
    id: "feed1",
    serial: "",
    trn: "",
    otherParty: "Revenue Department",
    source: { importer: "akahu", file: "feed", line: 1 },
  };
  const fromFile = {
    ...shared,
    id: "file1",
    serial: "0012",
    trn: "050",
    otherParty: "REVENUE DEPARTMENT",
    source: { importer: "bnz-transaction-list", file: "x.csv", line: 9 },
  };

  const { kept, entries } = dedupe([fromFeed, fromFile]);
  assert.equal(kept.length, 1, "one transaction, not two");
  assert.equal(entries[1].status, "duplicate");
  assert.match(entries[1].reason, /A feed dates a transaction when it happened/);
  assert.match(entries[1].reason, /same account, amount and reference/);
});

test("with nothing to check it against, it is asked about rather than dropped", () => {
  // A card purchase carries no particulars, code or reference, so all that is
  // left is an amount on a day -- and two coffees of the same price look
  // exactly like this.
  const shared = {
    date: "2026-08-28",
    amount: -580,
    currency: "NZD",
    account: "bnz-card-3884",
    particulars: "",
    code: "",
    reference: "",
    origin: "",
    type: "",
    batch: "",
    otherPartyAccount: "",
    occurrence: 1,
  };

  const { kept, entries } = dedupe([
    { ...shared, id: "a", serial: "", trn: "", otherParty: "Harbour Roastery",
      source: { importer: "akahu", file: "feed", line: 1 } },
    { ...shared, id: "b", serial: "", trn: "", otherParty: "HARBOUR ROASTERY NELSON",
      source: { importer: "bnz-card", file: "x.csv", line: 9 } },
  ]);

  assert.equal(kept.length, 2, "both kept until somebody says");
  assert.equal(entries[1].status, "review");
});

test("a day between the two sources does not make it two transactions", () => {
  // A feed dates a transaction when it happened; a bank's own export dates it
  // when it processed. Across the real overlap that was one day for a hundred
  // and one transactions out of a hundred and twelve, and comparing dates
  // exactly counted every one of them twice.
  const shared = {
    amount: -100625,
    currency: "NZD",
    account: "02-1234-0056789-066",
    particulars: "Paving",
    code: "Repairs",
    reference: "900321",
    origin: "",
    type: "",
    batch: "",
    otherPartyAccount: "",
    occurrence: 1,
    serial: "",
    trn: "",
  };

  const { kept, entries } = dedupe([
    { ...shared, id: "a", date: "2026-09-03", otherParty: "A Builder Paving Repairs 900321",
      source: { importer: "akahu", file: "feed", line: 1 } },
    { ...shared, id: "b", date: "2026-09-04", otherParty: "Lou",
      source: { importer: "bnz-transaction-list", file: "x.csv", line: 9 } },
  ]);

  assert.equal(kept.length, 1);
  assert.equal(entries[1].status, "duplicate");
  assert.match(entries[1].reason, /dated 2026-09-03 there and 2026-09-04 here/);
});

test("a week apart is two transactions, not one dated differently", () => {
  // The window is three days: a bank posts on business days and a weekend is
  // two of them. A standing payment a week apart is genuinely two payments.
  const shared = {
    amount: -50000, currency: "NZD", account: "02-1234-0056789-001",
    particulars: "Rent", code: "", reference: "WEEKLY",
    origin: "", type: "", batch: "", otherPartyAccount: "", occurrence: 1,
    serial: "", trn: "",
  };
  const { kept } = dedupe([
    { ...shared, id: "a", date: "2026-09-01", otherParty: "Tenant",
      source: { importer: "akahu", file: "feed", line: 1 } },
    { ...shared, id: "b", date: "2026-09-08", otherParty: "TENANT NAME",
      source: { importer: "bnz-transaction-list", file: "x.csv", line: 9 } },
  ]);
  assert.equal(kept.length, 2);
});

const bare = (extra) => ({
  amount: -348000, currency: "NZD", account: "02-1234-0077665-002",
  particulars: "", code: "", reference: "",
  origin: "", type: "", batch: "", otherPartyAccount: "", occurrence: 1,
  serial: "", trn: "", otherParty: "Wise",
  ...extra,
});

test("with no reference, the payee settles it when the pair is the only one nearby", () => {
  // A transfer carrying no particulars, code or reference leaves only an
  // amount and a payee. One of those in each source, and nothing else like it
  // at the time, can only be one transfer seen twice.
  const { kept, entries } = dedupe([
    bare({ id: "a", date: "2026-07-12", source: { importer: "akahu", file: "feed", line: 1 } }),
    bare({ id: "b", date: "2026-07-13", source: { importer: "bnz-transaction-list", file: "x.csv", line: 9 } }),
  ]);

  assert.equal(kept.length, 1);
  assert.equal(entries[1].status, "duplicate");
  assert.match(entries[1].reason, /the only one of its kind in either source/);
});

test("but two of the same in one source means they are two transfers", () => {
  // The safety condition. Somebody really can send the same amount to the same
  // place twice in a week, and then each source holds both -- so collapsing
  // them would lose a real payment.
  const { kept, entries } = dedupe([
    bare({ id: "a1", date: "2026-07-12", source: { importer: "akahu", file: "feed", line: 1 } }),
    bare({ id: "a2", date: "2026-07-14", source: { importer: "akahu", file: "feed", line: 2 } }),
    bare({ id: "b1", date: "2026-07-13", source: { importer: "bnz-transaction-list", file: "x.csv", line: 9 } }),
    bare({ id: "b2", date: "2026-07-15", source: { importer: "bnz-transaction-list", file: "x.csv", line: 10 } }),
  ]);

  assert.equal(kept.length, 4, "nothing is dropped when there is more than one of a kind");
  assert.ok(
    entries.filter((e) => e.status === "duplicate").length === 0,
    "and none is called a duplicate outright",
  );
});

test("a different payee is still only asked about", () => {
  // Two sources naming the payee differently, with no reference to check it
  // against, is exactly the case that cannot be settled from the data.
  const { kept, entries } = dedupe([
    bare({ id: "a", date: "2026-07-12", otherParty: "Harbour Roastery",
      source: { importer: "akahu", file: "feed", line: 1 } }),
    bare({ id: "b", date: "2026-07-13", otherParty: "HARBOUR ROASTERY NELSON",
      source: { importer: "bnz-card", file: "x.csv", line: 9 } }),
  ]);
  assert.equal(kept.length, 2);
  assert.equal(entries[1].status, "review");
});
