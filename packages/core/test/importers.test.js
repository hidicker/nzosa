import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { detect, importFile } from "../dist/index.js";

const sample = (name) =>
  readFileSync(fileURLToPath(new URL(`../../../samples/${name}`, import.meta.url)), "utf8");

test("detects each sample as the importer that owns it", () => {
  assert.equal(detect(sample("bnz-account.csv")).importer, "bnz-account");
  assert.equal(detect(sample("bnz-card.csv")).importer, "bnz-card");
  assert.equal(detect(sample("anz-loan.csv")).importer, "anz-loan");
  assert.equal(detect(sample("wise.csv")).importer, "wise");
});

test("does not mistake a BNZ account export for a card export", () => {
  // Both feeds share Date/Amount/Payee/Tran Type. Only the account export has
  // This Party Account, and that is what has to break the tie.
  const results = detect(sample("bnz-account.csv"));
  assert.equal(results.importer, "bnz-account");
});

test("refuses a file no importer recognises", () => {
  assert.throws(
    () => importFile("name,colour\nrose,red\n"),
    /No importer recognised/,
  );
});

test("BNZ account: maps every column and reports the footer row", () => {
  const result = importFile(sample("bnz-account.csv"), { file: "bnz-account.csv" });

  assert.equal(result.importer, "bnz-account");
  assert.equal(result.transactions.length, 5);

  // The `Total:` footer is skipped, but visibly, not silently.
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0].message, /Unreadable date/);

  const [first] = result.transactions;
  assert.equal(first.date, "2024-07-01");
  assert.equal(first.amount, -107444);
  assert.equal(first.currency, "NZD");
  assert.equal(first.otherParty, "Transferwise");
  assert.equal(first.particulars, "Whitcombe");
  assert.equal(first.code, "P1000001");
  assert.equal(first.type, "BP");
  assert.equal(first.origin, "02-1255");
  assert.equal(first.trn, "0");
  assert.equal(first.source.file, "bnz-account.csv");
});

test("BNZ account: takes the account from the rows and pads its suffix", () => {
  const result = importFile(sample("bnz-account.csv"), { account: "ignored" });
  assert.equal(result.account, "02-1100-0022002-002");
  for (const transaction of result.transactions) {
    assert.equal(transaction.account, "02-1100-0022002-002");
  }
});

test("BNZ account: reads a quoted thousands amount", () => {
  const result = importFile(sample("bnz-account.csv"));
  const rent = result.transactions.find((t) => t.otherParty === "RENT SAMPLE");
  assert.equal(rent.amount, 125000);
});

test("BNZ card: records the original currency leg from the Code column", () => {
  const result = importFile(sample("bnz-card.csv"), { file: "bnz-card.csv" });
  assert.equal(result.transactions.length, 5);

  const foreign = result.transactions.find((t) => t.otherParty === "SAMPLE US STORE");
  assert.equal(foreign.amount, -4363, "billed amount stays in the account currency");
  assert.deepEqual(foreign.foreign, { currency: "USD", amount: -2900 });

  // A NZD purchase on a NZD card has no foreign leg to record.
  const domestic = result.transactions.find((t) => t.otherParty.startsWith("Spotify"));
  assert.equal(domestic.foreign, undefined);
  assert.equal(domestic.code, "NZD2599");
});

test("ANZ loan: keeps the running principal balance", () => {
  const result = importFile(sample("anz-loan.csv"), { account: "anz-home-loan" });
  assert.equal(result.transactions.length, 4);

  const [drawdown] = result.transactions;
  assert.equal(drawdown.date, "2024-06-01");
  assert.equal(drawdown.amount, -10000000);
  assert.equal(drawdown.particulars, "Loan Drawdown");
  assert.equal(drawdown.extras.principalBalance, "100000.00");
  assert.equal(drawdown.account, "anz-home-loan");
});

test("Wise: signs OUT negative and IN positive, from the right side of the row", () => {
  const result = importFile(sample("wise.csv"), { account: "wise", file: "wise.csv" });

  const out = result.transactions.find((t) => t.reference === "CARD_TRANSACTION-3600000001");
  assert.equal(out.amount, -1210);
  assert.equal(out.currency, "NZD");
  assert.equal(out.otherParty, "FlixBus", "on an OUT, the counterparty is the target");
  assert.deepEqual(out.foreign, { currency: "EUR", amount: -598 });

  const incoming = result.transactions.find((t) => t.reference === "TRANSFER-2000000001");
  assert.equal(incoming.amount, 200000);
  assert.equal(incoming.otherParty, "Sample User", "on an IN, the counterparty is the source");
  assert.equal(incoming.foreign, undefined, "NZD to NZD is not a conversion");
});

test("Wise: keeps both currency legs of one card transaction apart", () => {
  const result = importFile(sample("wise.csv"), { account: "wise" });
  const legs = result.transactions.filter(
    (t) => t.reference === "CARD_TRANSACTION-3600000002",
  );

  assert.equal(legs.length, 2, "one transfer id, two real balance movements");
  assert.deepEqual(
    legs.map((leg) => [leg.currency, leg.amount, leg.account]).sort(),
    [
      ["EUR", -2000, "wise:EUR"],
      ["NZD", -7679, "wise:NZD"],
    ].sort(),
  );
});

test("Wise: reports cancelled transfers instead of importing them", () => {
  const result = importFile(sample("wise.csv"), { account: "wise" });
  assert.equal(result.transactions.length, 5);
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0].message, /CANCELLED never moved money/);
});

test("Wise: records the fee without folding it into the amount", () => {
  const result = importFile(sample("wise.csv"), { account: "wise" });
  const transfer = result.transactions.find((t) => t.reference === "TRANSFER-2000000002");
  assert.equal(transfer.amount, -415100);
  assert.equal(transfer.extras.sourceFee, "11.74");
  assert.equal(transfer.extras.sourceFeeCurrency, "NZD");
});

test("ids are deterministic across imports of the same file", () => {
  const first = importFile(sample("bnz-account.csv"), { file: "july.csv" });
  const second = importFile(sample("bnz-account.csv"), { file: "july-again.csv" });

  // The file name is provenance, not identity: the same transaction keeps its
  // id however the export was named.
  assert.deepEqual(
    first.transactions.map((t) => t.id),
    second.transactions.map((t) => t.id),
  );
});
