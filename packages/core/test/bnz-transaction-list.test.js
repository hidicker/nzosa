import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { detect, importFile, dedupe, dedupeKey } from "../dist/index.js";

const text = readFileSync(
  fileURLToPath(new URL("../../../samples/bnz-transaction-list.csv", import.meta.url)),
  "utf8",
);

test("detects the multi-account export and reports the block count", () => {
  const result = detect(text);
  assert.equal(result.importer, "bnz-transaction-list");
  assert.match(result.reason, /2 account block\(s\)/);
});

test("splits blocks into separate accounts and never merges them", () => {
  // Merging ten accounts into one is the failure that would make every balance
  // meaningless, so this is the property most worth pinning down.
  const result = importFile(text, { file: "tl.csv", account: "ignored" });

  assert.equal(result.transactions.length, 7);
  assert.equal(result.account, "2 accounts");

  const accounts = new Set(result.transactions.map((t) => t.account));
  assert.deepEqual(
    [...accounts].sort(),
    ["02-1100-0022001-001", "sample-card-4001"],
  );
});

test("uses the account number for bank blocks and label plus last four for cards", () => {
  const result = importFile(text, { file: "tl.csv" });
  const bank = result.transactions.filter((t) => t.account === "02-1100-0022001-001");
  const card = result.transactions.filter((t) => t.account === "sample-card-4001");

  assert.equal(bank.length, 3);
  assert.equal(card.length, 4);
  // The human-readable name is kept for display; the id is what stays stable.
  assert.equal(bank[0].extras.accountLabel, "Sample Account");
  assert.equal(card[0].extras.accountLabel, "Sample Card");
});

test("ignores a caller-supplied account, because the file names its own", () => {
  const result = importFile(text, { file: "tl.csv", account: "should-be-ignored" });
  assert.equal(
    result.transactions.some((t) => t.account === "should-be-ignored"),
    false,
  );
});

test("maps all thirteen columns", () => {
  const result = importFile(text, { file: "tl.csv" });
  const radio = result.transactions.find((t) => t.otherParty === "SAMPLE RADIO LTD");

  assert.equal(radio.date, "2024-09-02");
  assert.equal(radio.amount, -66239);
  assert.equal(radio.currency, "NZD");
  assert.equal(radio.trn, "000");
  assert.equal(radio.particulars, "Two-Way Radio");
  assert.equal(radio.code, "2 x TwoPack");
  assert.equal(radio.type, "BP");
  assert.equal(radio.origin, "02-1255");
  assert.equal(radio.batch, "0000");
  assert.equal(radio.otherPartyAccount, "12-3100-0044004-000");
});

test("normalises the counterparty account suffix", () => {
  const result = importFile(text, { file: "tl.csv" });
  const transfer = result.transactions.find((t) => t.reference === "INTERNET XFR" && t.amount > 0);
  assert.equal(transfer.otherPartyAccount, "02-1100-0022002-002");
});

test("reads the original currency out of a card row's Code column", () => {
  const result = importFile(text, { file: "tl.csv" });
  const openai = result.transactions.find((t) => t.otherParty.startsWith("OPENAI"));

  assert.equal(openai.amount, -3769, "the billed amount stays in the account currency");
  assert.deepEqual(openai.foreign, { currency: "USD", amount: -2300 });
});

test("skips the Total footer without inventing a transaction", () => {
  const result = importFile(text, { file: "tl.csv" });
  assert.equal(
    result.transactions.some((t) => t.otherParty.startsWith("Total")),
    false,
  );
  assert.equal(result.problems.length, 0, "the footer is structural, not a problem");
});

test("keeps the two legs of a transfer that straddles the year end", () => {
  // This is the real case that broke a set of filed accounts: money leaves the
  // bank on 31 March and lands on the card on 1 April, so the two legs fall in
  // different financial years and must not be netted off.
  const result = importFile(text, { file: "tl.csv" });

  const out = result.transactions.find((t) => t.amount === -17208);
  const arrival = result.transactions.find((t) => t.amount === 17208);

  assert.equal(out.date, "2025-03-31");
  assert.equal(arrival.date, "2025-04-01");
  assert.notEqual(out.account, arrival.account);
});

test("identical same-day card payments are kept, and re-import stays idempotent", () => {
  // Two $20 association payments on one day are real -- a school pays one per
  // student -- but a card feed carries no serial to prove it. Numbering them
  // keeps both, without making a second import of the same file add two more.
  const { transactions } = importFile(text, { file: "tl.csv" });
  const repeats = transactions.filter((t) => t.otherParty === "PAYPAL *SAMPLEASSN");

  assert.equal(repeats.length, 2);
  assert.deepEqual(repeats.map((t) => t.occurrence), [1, 2]);
  assert.equal(dedupe(transactions).stats.duplicate, 0, "both are genuine");
  assert.equal(dedupe(transactions).kept.length, 7);

  const again = importFile(text, { file: "tl-again.csv" }).transactions;
  const merged = dedupe([...transactions, ...again]);
  assert.equal(merged.kept.length, 7, "re-importing adds nothing");
  assert.equal(merged.stats.duplicate, 7);
});
