import assert from "node:assert/strict";
import test from "node:test";
import { fromAkahu, akahuAccountId, matchLedgerAccount } from "../dist/akahu.js";
import { dedupeKey, looseKey } from "../dist/dedupe.js";

const item = (extra = {}) => ({
  _id: "trans_abc",
  _account: "acc_123",
  date: "2026-03-13T00:00:00.000Z",
  description: "HARBOUR ROASTERY",
  amount: -10.8,
  type: "DEBIT",
  meta: { particulars: "NELSON", code: "NZD1080", reference: "", other_account: "" },
  ...extra,
});

const options = { accountFor: (id) => (id === "acc_123" ? "bnz-card-3884" : null) };

test("a feed transaction becomes an ordinary transaction", () => {
  const { transactions, problems } = fromAkahu([item()], options);
  assert.deepEqual(problems, []);
  assert.equal(transactions.length, 1);

  const t = transactions[0];
  assert.equal(t.date, "2026-03-13", "the timestamp becomes a day");
  assert.equal(t.amount, -1080, "dollars become cents, money out stays negative");
  assert.equal(t.account, "bnz-card-3884");
  assert.equal(t.otherParty, "HARBOUR ROASTERY");
  assert.equal(t.particulars, "NELSON");
  assert.equal(t.code, "NZD1080");
  assert.equal(t.currency, "NZD");
  assert.equal(t.extras.akahuId, "trans_abc");
});

test("a merchant name is preferred over the raw description", () => {
  const { transactions } = fromAkahu([item({ merchant: { name: "Harbour Roastery" } })], options);
  assert.equal(transactions[0].otherParty, "Harbour Roastery");
});

test("an account this ledger does not know is skipped, not invented", () => {
  // A feed can carry personal accounts. Filing them under an Akahu id would
  // put somebody's own spending into the company's books.
  const { transactions, unmappedAccounts } = fromAkahu([item({ _account: "acc_other" })], options);
  assert.equal(transactions.length, 0);
  assert.deepEqual(unmappedAccounts, ["acc_other"]);
});

test("an unreadable date or amount is reported rather than guessed", () => {
  const { transactions, problems } = fromAkahu(
    [item({ date: "not a date" }), item({ amount: "" })],
    options,
  );
  assert.equal(transactions.length, 0);
  assert.equal(problems.length, 2);
  assert.match(problems[0].message, /unreadable date/);
  assert.match(problems[1].message, /unreadable amount/);
});

test("a feed transaction is not identical to the same one from a file", () => {
  // Worth stating plainly, because it was assumed and it is not true. A feed
  // carries no export sequence numbers, names the payee its own way, and folds
  // the reference fields into its description -- so neither the strict key nor
  // the loose one, which both compare the payee, sees these as the same thing.
  // Recognising them is dedupe's job and is tested there; what belongs here is
  // that the fields it needs come through.
  const fromFeed = fromAkahu([item()], options).transactions[0];

  const fromFile = {
    ...fromFeed,
    serial: "0012",
    trn: "005",
    otherParty: "HARBOUR ROASTERY NELSON",
    source: { importer: "bnz-card", file: "x.csv", line: 4 },
  };

  assert.notEqual(dedupeKey(fromFeed), dedupeKey(fromFile));
  assert.notEqual(looseKey(fromFeed), looseKey(fromFile), "the payee differs, so this differs too");

  // What both sides do carry identically is what the payer typed.
  assert.equal(fromFeed.particulars, "NELSON");
  assert.equal(fromFeed.code, "NZD1080");
});

test("a new account is named the way an imported file would name it", () => {
  // Starting from a feed and starting from a download have to arrive at the
  // same account, or the first import after a switch builds a second ledger
  // beside the first.
  const id = (name, formatted_account) => akahuAccountId({ _id: "acc_1", name, formatted_account });

  // The feed writes a two digit suffix where a file writes three.
  assert.equal(id("Everyday", "02-1234-0056789-00"), "02-1234-0056789-000");
  assert.equal(id("Sample Street", "02-1234-0056789-66"), "02-1234-0056789-066");

  // A card has no number, only a masked one, and an import names it from the
  // account name and those four digits.
  assert.equal(id("Bank Visa Platinum", "xxxx-xxxx-xxxx-1122"), "bank-visa-platinum-1122");
  assert.equal(id("Sample Trading", "xxxx-xxxx-xxxx-3344"), "sample-trading-3344");

  assert.equal(id("Visa Platinum", ""), "visa-platinum");
  assert.equal(id("", ""), "acc_1");
});

test("a feed account is matched to the one already in the books", () => {
  // The same account, written with a two digit suffix by one system and three
  // by the other. Treating them as different would put the feed's transactions
  // in a second account beside a reconciled history.
  const ours = [
    "02-1234-0056789-000",
    "02-1234-0056789-001",
    "02-1234-0056789-066",
    "bank-visa-platinum-1122",
  ];

  const bank = (formatted_account) => ({ _id: "acc_1", name: "x", formatted_account });

  assert.equal(matchLedgerAccount(bank("02-1234-0056789-01"), ours), "02-1234-0056789-001");
  assert.equal(matchLedgerAccount(bank("02-1234-0056789-66"), ours), "02-1234-0056789-066");
  assert.equal(matchLedgerAccount(bank("02-1234-0056789-000"), ours), "02-1234-0056789-000");
});

test("a masked card is matched by the four digits an import names it by", () => {
  const ours = ["bank-visa-platinum-1122", "02-1234-0056789-001"];
  const card = { _id: "acc_2", name: "Visa", formatted_account: "xxxx-xxxx-xxxx-1122" };
  assert.equal(matchLedgerAccount(card, ours), "bank-visa-platinum-1122");
});

test("an account nothing matches, or two that do, is left for a person", () => {
  const ours = ["bnz-card-3884", "other-card-3884"];

  assert.equal(
    matchLedgerAccount({ _id: "a", name: "x", formatted_account: "xxxx-xxxx-xxxx-1122" }, ours),
    null,
    "two accounts end in the same four digits",
  );
  assert.equal(
    matchLedgerAccount({ _id: "a", name: "x", formatted_account: "09-2000-0055005-00" }, ours),
    null,
    "nothing matches",
  );
  assert.equal(matchLedgerAccount({ _id: "a", name: "x" }, ours), null, "no number at all");
});
