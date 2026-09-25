import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyLedger, readMeta } from "../../../apps/web/ledger-folder.js";

/** A set of books with a lock, a name and an archive, as the app leaves one. */
function books() {
  const root = mkdtempSync(join(tmpdir(), "nzosa-copy-"));
  const from = join(root, "kowhai");
  mkdirSync(join(from, "archive", "2026-01-01-00-00-00"), { recursive: true });
  writeFileSync(join(from, "transactions.json"), JSON.stringify({ version: 1, data: [{ id: "a" }] }));
  writeFileSync(join(from, "decisions.json"), JSON.stringify({ version: 1, data: { overrides: {} } }));
  writeFileSync(join(from, "ledger.json"), JSON.stringify({ name: "Kowhai books", created: "2026-01-01" }));
  writeFileSync(join(from, ".open-by"), JSON.stringify({ pid: 1 }));
  writeFileSync(join(from, "archive", "2026-01-01-00-00-00", "transactions.json"), "{}");
  return { root, from };
}

test("a copy holds the books, under its own name, and nothing else", () => {
  const { root, from } = books();
  const to = join(root, "kowhai-copy");
  const result = copyLedger(from, to, "Kowhai books copy");
  assert.equal(result.copied, 2);
  assert.deepEqual(
    JSON.parse(readFileSync(join(to, "transactions.json"), "utf8")),
    { version: 1, data: [{ id: "a" }] },
  );
  assert.equal(readMeta(to).name, "Kowhai books copy");
  assert.equal(readMeta(to).copiedFrom, "Kowhai books");
  assert.equal(existsSync(join(to, ".open-by")), false, "the copy is open nowhere");
  assert.equal(existsSync(join(to, "archive")), false, "archives stay with their own books");
  assert.equal(readMeta(from).name, "Kowhai books", "the original is untouched");
});

test("a copy never lands on books that already exist", () => {
  const { root, from } = books();
  const to = join(root, "taken");
  mkdirSync(to);
  writeFileSync(join(to, "transactions.json"), "{}");
  assert.throws(() => copyLedger(from, to, "Taken"), /already exists/);
  assert.throws(() => copyLedger(join(root, "nowhere"), join(root, "x"), "X"), /do not exist/);
});
