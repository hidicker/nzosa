import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");

/** A folder of books, written the way the app writes one. */
function folderLedger() {
  const folder = mkdtempSync(join(tmpdir(), "nzosa-folder-"));
  const part = (name, data) =>
    writeFileSync(join(folder, `${name}.json`), JSON.stringify({ version: 1, data }));
  // Every field the type requires: a row short of one is not a ledger the app
  // could have written, and a test built on one reports faults that are its own.
  const row = (over) => ({
    serial: "", trn: "", particulars: "", code: "", reference: "", otherParty: "",
    origin: "", type: "", batch: "", otherPartyAccount: "", occurrence: 1,
    currency: "NZD", account: "02-1100-0022001-000", extras: {},
    source: { importer: "bnz-account", file: "may.csv", line: 2 },
    ...over,
  });
  part("transactions", [
    row({ id: "a", date: "2026-05-01", amount: -11500, otherParty: "Tui Glider Works" }),
    row({ id: "b", date: "2026-05-02", amount: 23000, otherParty: "A Customer" }),
  ]);
  // The app keeps everything keyed by transaction id in one file, flat.
  part("decisions", {
    overrides: { a: { code: "400 Advertising", confirmed: true, treatment: "standard", side: "purchases" } },
    splits: {}, invoiceMatches: {}, transfers: {}, legitimateDuplicates: [], removedDuplicates: [],
  });
  part("chart", [{ code: "400", name: "Advertising", type: "Overhead", taxCode: "", description: "" }]);
  // Metadata, not the books -- reading this as the ledger is the mistake that
  // made every real folder look like an unknown version.
  writeFileSync(join(folder, "ledger.json"), JSON.stringify({ name: "Books", created: "2026-05-01" }));
  return folder;
}

test("the command line reads a folder of books the app wrote", () => {
  const folder = folderLedger();
  const out = execFileSync("node", [CLI, "list", "--ledger", folder], { encoding: "utf8" });
  assert.match(out, /Tui Glider Works/);
  assert.match(out, /A Customer/);
});

test("it reads the decisions, not just the transactions", () => {
  // A coding lives in decisions.json and has to arrive as an override, or
  // every report from the command line would disagree with the app's. The GST
  // return counts them, so it is where the answer shows.
  const folder = folderLedger();
  const out = execFileSync("node", [CLI, "gst", "--ledger", folder, "--year", "2027"], { encoding: "utf8" });
  assert.match(out, /confirmed by a human\s+1 line/);
});

test("ledger.json in that folder is metadata and is not mistaken for the books", () => {
  const folder = folderLedger();
  const out = execFileSync("node", [CLI, "balances", "--ledger", folder], { encoding: "utf8" });
  assert.match(out, /02-1100-0022001-000/);
  assert.doesNotMatch(out, /version/i);
});

test("writing to a folder is refused, and says what to do instead", () => {
  const folder = folderLedger();
  const csv = join(folder, "..", `bank-${Date.now()}.csv`);
  writeFileSync(csv, "Date,Amount,Payee,Tran Type,This Party Account\n01/05/2026,-115.00,Someone,DEB,02-1100-0022001-000\n");
  let message = "";
  try {
    execFileSync("node", [CLI, "import", csv, "--ledger", folder], { encoding: "utf8", stdio: "pipe" });
  } catch (error) {
    message = `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
  // The app writes each part with its own version counter; one file dropped in
  // the middle of that would be ignored by the app and look like the books to
  // the next person.
  assert.match(message, /can read but not write/);
});

test("a folder with nothing in it is empty books, not an error", () => {
  const folder = mkdtempSync(join(tmpdir(), "nzosa-empty-"));
  mkdirSync(join(folder, "sub"), { recursive: true });
  const out = execFileSync("node", [CLI, "list", "--ledger", folder], { encoding: "utf8" });
  assert.match(out, /is empty/);
});

test("a rules file that holds no rules is refused, not quietly ignored", () => {
  // The failure this replaces printed a full GST return built on none of the
  // user's coding, with the same confidence as the right one.
  const folder = folderLedger();
  const notRules = join(folder, "chart.json");
  let message = "";
  try {
    execFileSync("node", [CLI, "gst", "--ledger", folder, "--year", "2027", "--rules", notRules],
      { encoding: "utf8", stdio: "pipe" });
  } catch (error) {
    message = `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
  assert.match(message, /has no "rules"/);
});

test("the rules the app saved beside the books are the ones used", () => {
  // Wrapped twice the way the app writes them: the part envelope, then the
  // record of where they were loaded from.
  const folder = folderLedger();
  writeFileSync(
    join(folder, "rules.json"),
    JSON.stringify({
      version: 3,
      data: {
        version: 3, name: "rules.json", loadedAt: "",
        rules: { rules: [{ priority: 100, keyword: "Tui Glider", code: "400 Advertising" }] },
      },
    }),
  );
  // Selecting by code only works if the rules were read: without them nothing
  // is coded to 400 and the selection is empty.
  const out = execFileSync(
    "node", [CLI, "gst", "--ledger", folder, "--year", "2027", "--codes", "400 Advertising"],
    { encoding: "utf8" },
  );
  assert.match(out, /codes\s+400 Advertising/);
  assert.match(out, /selected\s+1 transactions/);
});

test("an account the chart marks No GST is not treated as standard-rated", () => {
  // The chart is where a tax code lives, and more than half the accounts on a
  // real chart are No GST. Assuming standard-rated for those claims GST on
  // money that never carried any.
  const folder = folderLedger();
  writeFileSync(
    join(folder, "chart.json"),
    JSON.stringify({
      version: 1,
      data: [{ code: "200", name: "Sales", type: "Revenue", taxCode: "No GST", description: "" }],
    }),
  );
  writeFileSync(
    join(folder, "rules.json"),
    JSON.stringify({
      version: 1,
      data: { rules: { rules: [{ priority: 100, keyword: "A Customer", code: "Sales - 200" }] } },
    }),
  );

  const out = execFileSync("node", [CLI, "gst", "--ledger", folder, "--year", "2027"], { encoding: "utf8" });
  // The 230.00 receipt is coded to a No GST account, so none of it is a
  // taxable sale and no GST is returned on it. (The 115.00 payment carries an
  // override, and a decision taken by hand outranks the chart.)
  const may = out.split("\n").find((line) => line.startsWith("2026-05-31"));
  assert.doesNotMatch(may, /230\.00/);
  assert.match(may, /\s0\.00\s+0\.00\s+0\.00\s/);
});
