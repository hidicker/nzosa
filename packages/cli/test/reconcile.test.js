import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");

function transaction(date, amount, account = "acct") {
  return {
    id: `${date}-${amount}`,
    date,
    amount,
    currency: "NZD",
    serial: "",
    trn: "",
    particulars: "",
    code: "",
    reference: "",
    otherParty: "Someone",
    origin: "",
    type: "",
    batch: "",
    otherPartyAccount: "",
    account,
    extras: {},
    source: { importer: "test", file: "test.csv", line: 1 },
  };
}

function run(ledger, args = []) {
  const dir = mkdtempSync(join(tmpdir(), "nzosa-"));
  const path = join(dir, "ledger.json");
  writeFileSync(path, JSON.stringify(ledger, null, 2));

  try {
    const stdout = execFileSync(process.execPath, [CLI, "balances", "--ledger", path, ...args], {
      encoding: "utf8",
    });
    return { stdout, code: 0 };
  } catch (error) {
    return { stdout: error.stdout ?? "", code: error.status };
  }
}

test("ties when opening plus movement equals closing", () => {
  const { stdout, code } = run(
    {
      version: 1,
      legitimateDuplicates: [],
      balances: {
        acct: {
          opening: { date: "2025-03-31", amount: "355.94" },
          closing: { date: "2026-03-31", amount: "1355.94" },
        },
      },
      transactions: [transaction("2025-06-01", 150000), transaction("2025-07-01", -50000)],
    },
    ["--year", "2026"],
  );

  assert.match(stdout, /variance\s+0\.00\s+ok/);
  assert.match(stdout, /Every configured account ties/);
  assert.equal(code, 0);
});

test("reports a mismatch and exits non-zero", () => {
  const { stdout, code } = run(
    {
      version: 1,
      legitimateDuplicates: [],
      balances: {
        acct: {
          opening: { date: "2025-03-31", amount: "0.00" },
          closing: { date: "2026-03-31", amount: "900.00" },
        },
      },
      transactions: [transaction("2025-06-01", 100000)],
    },
    ["--year", "2026"],
  );

  assert.match(stdout, /variance\s+100\.00\s+MISMATCH/);
  assert.equal(code, 1);
});

test("a cut-off adjustment reconciles a transfer that straddles the year end", () => {
  // The real case: the bank posts the arriving leg on 1 April, while the target
  // ledger treats the transfer as complete at 31 March and has already included
  // it in the opening balance. Both are defensible; they differ by the amount
  // in transit, and without recording that, correct books look wrong.
  const ledger = {
    version: 1,
    legitimateDuplicates: [],
    balances: {
      acct: {
        opening: { date: "2025-03-31", amount: "1176.82" },
        closing: { date: "2026-03-31", amount: "530.61" },
        cutOff: [
          {
            date: "2025-04-01",
            amount: "172.08",
            note: "already inside the opening balance",
          },
        ],
      },
    },
    transactions: [
      transaction("2025-04-01", 17208),
      transaction("2025-09-01", -64621),
    ],
  };

  const withAdjustment = run(ledger, ["--year", "2026"]);
  assert.match(withAdjustment.stdout, /cut-off\s+-172\.08/);
  assert.match(withAdjustment.stdout, /already inside the opening balance/);
  assert.match(withAdjustment.stdout, /variance\s+0\.00\s+ok/);
  assert.equal(withAdjustment.code, 0);

  // Without it the same books look out by exactly the amount in transit.
  delete ledger.balances.acct.cutOff;
  const without = run(ledger, ["--year", "2026"]);
  assert.match(without.stdout, /variance\s+172\.08\s+MISMATCH/);
  assert.equal(without.code, 1);
});

test("a cut-off entry with an unreadable amount is refused, not ignored", () => {
  // Silently treating a bad adjustment as zero would turn a typo into a
  // reconciliation that appears to tie.
  const { stdout } = run(
    {
      version: 1,
      legitimateDuplicates: [],
      balances: {
        acct: {
          opening: { date: "2025-03-31", amount: "0.00" },
          closing: { date: "2026-03-31", amount: "100.00" },
          cutOff: [{ amount: "one hundred", note: "typo" }],
        },
      },
      transactions: [transaction("2025-06-01", 20000)],
    },
    ["--year", "2026"],
  );

  assert.match(stdout, /is not a number/);
  assert.doesNotMatch(stdout, /variance/);
});

test("restricts to the financial year given", () => {
  const ledger = {
    version: 1,
    legitimateDuplicates: [],
    transactions: [
      transaction("2025-03-31", 10000),
      transaction("2025-04-01", 20000),
      transaction("2026-03-31", 30000),
      transaction("2026-04-01", 40000),
    ],
  };

  const { stdout } = run(ledger, ["--year", "2026"]);
  assert.match(stdout, /2025-04-01 to 2026-03-31/);
  // Only the two dates inside the year are counted: 200.00 + 300.00.
  assert.match(stdout, /500\.00/);
});

test("a 50/50 entertainment split always adds back to the original", () => {
  // IRD allows half of most entertainment as deductible with GST claimable and
  // disallows the other half. An odd number of cents cannot be halved evenly,
  // so one half has to take the extra cent -- and the pair must still sum
  // exactly, or the balance reconciliation stops proving anything.
  const dir = mkdtempSync(join(tmpdir(), "nzosa-"));
  const path = join(dir, "ledger.json");

  for (const amount of [-1979, -1051, -1214, -1, -3, -100000]) {
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        legitimateDuplicates: [],
        transactions: [transaction("2025-08-28", amount)],
      }),
    );

    execFileSync(
      process.execPath,
      [
        CLI,
        "split",
        `2025-08-28-${amount}`,
        "--ledger",
        path,
        "--half",
        "Entertainment|Entertainment Non deductible|team lunch",
      ],
      { encoding: "utf8" },
    );

    const saved = JSON.parse(readFileSync(path, "utf8"));
    const parts = saved.splits[`2025-08-28-${amount}`];

    assert.equal(parts.length, 2, `two parts at ${amount}`);
    assert.equal(
      parts[0].amount + parts[1].amount,
      amount,
      `parts must sum to ${amount}`,
    );
    assert.ok(
      Math.abs(Math.abs(parts[0].amount) - Math.abs(parts[1].amount)) <= 1,
      "the halves differ by at most one cent",
    );
    assert.equal(parts[0].treatment, "standard", "the deductible half claims GST");
    assert.equal(parts[1].treatment, "out-of-scope", "the other half claims none");
  }
});
