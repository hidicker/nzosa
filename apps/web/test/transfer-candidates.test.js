import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

/**
 * Transfer candidates are looked up among lines of the same amount rather than
 * every line. These hold the result to the plain search it replaced: the same
 * candidates, in the same order, on random books.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = mkdtempSync(join(tmpdir(), "nzosa-transfers-"));
const bundle = join(out, "reconcile.mjs");
await build({
  entryPoints: [join(root, "src", "reconcile.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: ["node20"],
  define: { __NZOSA_EDITION__: '"nz"' },
  outfile: bundle,
  logLevel: "silent",
});
test.after(() => rmSync(out, { recursive: true, force: true }));
const { transferCandidates } = await import(pathToFileURL(bundle).href);

/** The search as it was: every line, one at a time. */
function plain(transaction, all, search) {
  const windowMs = (search.windowDays ?? 4) * 86_400_000;
  const when = Date.parse(transaction.date);
  const candidates = [];
  for (const other of all) {
    if (other.id === transaction.id || search.taken.has(other.id)) continue;
    if (other.amount !== -transaction.amount || other.account === transaction.account) continue;
    if (!search.sameEntity.has(other.account)) continue;
    const gap = Math.abs(Date.parse(other.date) - when);
    if (gap > windowMs) continue;
    candidates.push({
      transaction: other,
      daysApart: Math.round(gap / 86_400_000),
      accountsAgree: (transaction.otherPartyAccount ?? "") === other.account || (other.otherPartyAccount ?? "") === transaction.account,
    });
  }
  candidates.sort((a, b) => (a.accountsAgree !== b.accountsAgree ? (a.accountsAgree ? -1 : 1) : a.daysApart - b.daysApart));
  return candidates;
}

test("the same candidates, in the same order, as searching every line", () => {
  let seed = 3;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = (n) => Math.floor(random() * n);
  const accounts = ["a", "b", "c", "d"];
  for (let round = 0; round < 20; round++) {
    const all = Array.from({ length: 400 }, (_, i) => ({
      id: `t${round}-${i}`,
      date: `2025-0${1 + pick(3)}-${String(1 + pick(28)).padStart(2, "0")}`,
      amount: (pick(2) ? 1 : -1) * (100 * (1 + pick(15))),
      account: accounts[pick(4)],
      otherPartyAccount: pick(3) === 0 ? accounts[pick(4)] : "",
    }));
    const taken = new Set(all.filter(() => pick(10) === 0).map((t) => t.id));
    const sameEntity = new Set(accounts.slice(0, 1 + pick(4)));
    for (const transaction of all) {
      const fast = transferCandidates(transaction, all, { sameEntity, taken });
      const slow = plain(transaction, all, { sameEntity, taken });
      assert.deepEqual(
        fast.map((c) => [c.transaction.id, c.daysApart, c.accountsAgree]),
        slow.map((c) => [c.transaction.id, c.daysApart, c.accountsAgree]),
      );
    }
  }
});

test("a new list of lines is searched afresh", () => {
  const one = { id: "x", date: "2025-01-01", amount: -500, account: "a" };
  const first = [one, { id: "y", date: "2025-01-01", amount: 500, account: "b" }];
  const search = { sameEntity: new Set(["a", "b"]), taken: new Set() };
  assert.equal(transferCandidates(one, first, search).length, 1);
  const second = [...first, { id: "z", date: "2025-01-02", amount: 500, account: "b" }];
  assert.equal(transferCandidates(one, second, search).length, 2);
});
