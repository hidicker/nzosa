import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startServer } from "../server.js";

/**
 * The local server's answers to requests it should refuse: a body that is not
 * JSON and a malformed % escape are the asker's fault (400, not 500), pages
 * may not be framed, and the two GETs that fetch from the bank refuse a
 * cross-site request.
 */
const root = mkdtempSync(join(tmpdir(), "nzosa-server-"));
const running = await startServer({ port: 0, ledgerRoot: root, ledgerId: "test-books" });
const base = `http://127.0.0.1:${running.port}`;
test.after(() => {
  running.stop();
  rmSync(root, { recursive: true, force: true });
});

test("a body that is not JSON is a 400", async () => {
  const response = await fetch(`${base}/api/ledger/parts/decisions`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: "{not json",
  });
  assert.equal(response.status, 400);
});

test("a malformed % escape is a 400", async () => {
  const response = await fetch(`${base}/%E0%A4%A`);
  assert.equal(response.status, 400);
});

test("pages say they may not be framed", async () => {
  const response = await fetch(`${base}/`);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("content-security-policy"), "frame-ancestors 'none'");
});

test("the bank fetches refuse a cross-site request, and allow one with no Sec-Fetch-Site", async () => {
  for (const path of ["/api/feed/transactions", "/api/wise/statement"]) {
    const cross = await fetch(`${base}${path}`, { headers: { "sec-fetch-site": "cross-site" } });
    assert.equal(cross.status, 403, path);
    const same = await fetch(`${base}${path}`, { headers: { "sec-fetch-site": "same-origin" } });
    assert.equal(same.status, 400, `${path}: on to "not connected"`);
    const none = await fetch(`${base}${path}`);
    assert.equal(none.status, 400, `${path}: on to "not connected"`);
  }
});
