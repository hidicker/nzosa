import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");

test("a bank file written in Windows-1252 keeps its accented payees", () => {
  // Not only a matter of looking right. The payee is part of the key a
  // transaction's id is hashed from, so a mangled one gives the same row a
  // different id here from the one the app gives it -- and importing the file
  // in both duplicates it instead of recognising it.
  const folder = mkdtempSync(join(tmpdir(), "nzosa-encoding-"));
  const csv = join(folder, "bank.csv");
  const rows =
    "Date,Amount,Payee,Tran Type,This Party Account\r\n" +
    "01/05/2026,-115.00,Caf\u00e9 Kerer\u016b,DEB,02-1100-0022001-000\r\n";
  // Written as single bytes, which is what Windows-1252 is.
  writeFileSync(csv, Buffer.from(rows, "latin1"));

  const ledger = join(folder, "books.json");
  execFileSync("node", [CLI, "import", csv, "--ledger", ledger], { encoding: "utf8" });

  const held = JSON.parse(readFileSync(ledger, "utf8"));
  assert.equal(held.transactions.length, 1);
  // "u016b" is not in Windows-1252, so it arrives as its closest single byte;
  // what matters is that nothing became a replacement character.
  assert.match(held.transactions[0].otherParty, /^Caf\u00e9 Kerer/);
  assert.equal(held.transactions[0].otherParty.includes("\uFFFD"), false);
});

test("a UTF-8 bank file is still read as UTF-8", () => {
  const folder = mkdtempSync(join(tmpdir(), "nzosa-encoding-"));
  const csv = join(folder, "bank.csv");
  writeFileSync(
    csv,
    "Date,Amount,Payee,Tran Type,This Party Account\r\n" +
      "01/05/2026,-115.00,Caf\u00e9 Kerer\u016b,DEB,02-1100-0022001-000\r\n",
    "utf8",
  );

  const ledger = join(folder, "books.json");
  execFileSync("node", [CLI, "import", csv, "--ledger", ledger], { encoding: "utf8" });

  const held = JSON.parse(readFileSync(ledger, "utf8"));
  assert.equal(held.transactions[0].otherParty, "Caf\u00e9 Kerer\u016b");
});
