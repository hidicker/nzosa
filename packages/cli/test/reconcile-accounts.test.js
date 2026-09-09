import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");

const XERO = [
  "Account Transactions",
  "Example Holdings Limited",
  "",
  "Date,Source,Contact,Description,Reference,Debit,Credit,Account,Account Type,Related account",
  "01/05/2026,Spend Money,Tui Glider Works,Toner,,,115.00,Business Bank Account,Asset,Office Expenses",
].join("\r\n");

function books() {
  const folder = mkdtempSync(join(tmpdir(), "nzosa-reconcile-"));
  const part = (name, data) =>
    writeFileSync(join(folder, `${name}.json`), JSON.stringify({ version: 1, data }));
  part("transactions", [
    {
      id: "a", date: "2026-05-01", amount: -11500, currency: "NZD",
      account: "02-1100-0022001-000", serial: "", trn: "", particulars: "", code: "",
      reference: "", otherParty: "Tui Glider Works", origin: "", type: "", batch: "",
      otherPartyAccount: "", occurrence: 1, extras: {},
      source: { importer: "bnz-account", file: "may.csv", line: 2 },
    },
  ]);
  part("decisions", { overrides: {}, splits: {}, transfers: {}, legitimateDuplicates: [] });
  return folder;
}

test("with no --accounts, every account is compared rather than none", () => {
  // The default is an empty list. Read as "no accounts" it emptied our side
  // of the comparison and reported the whole of Xero as a difference -- a
  // report that looks like total disagreement and is really no comparison.
  const folder = books();
  const xero = join(folder, "export.csv");
  writeFileSync(xero, XERO);

  const out = execFileSync(
    "node", [CLI, "reconcile", "--ledger", folder, "--xero", xero, "--from", "2026-04-01", "--to", "2027-03-31"],
    { encoding: "utf8" },
  );
  assert.match(out, /Ours\s+-115\.00\s+1 lines/);
  assert.match(out, /Difference\s+0\.00/);
});

test("--accounts still narrows to the accounts named", () => {
  const folder = books();
  const xero = join(folder, "export.csv");
  writeFileSync(xero, XERO);

  const out = execFileSync(
    "node",
    [CLI, "reconcile", "--ledger", folder, "--xero", xero, "--from", "2026-04-01", "--to", "2027-03-31",
      "--accounts", "02-9999-9999999-000"],
    { encoding: "utf8" },
  );
  assert.match(out, /Ours\s+0\.00\s+0 lines/);
});
