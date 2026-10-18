import test from "node:test";
import assert from "node:assert/strict";
import {
  fromSimpleFin,
  simpleFinAccess,
  simpleFinAccountId,
  simpleFinCents,
  simpleFinClaimUrl,
  simpleFinErrors,
  simpleFinWindows,
} from "../dist/index.js";

test("a Setup Token is the claim address in Base64", () => {
  // The published demo token.
  assert.equal(
    simpleFinClaimUrl("aHR0cHM6Ly9icmlkZ2Uuc2ltcGxlZmluLm9yZy9zaW1wbGVmaW4vY2xhaW0vZGVtbw=="),
    "https://bridge.simplefin.org/simplefin/claim/demo",
  );
  assert.equal(simpleFinClaimUrl(btoa("http://bridge.example/simplefin/claim/x")), null);
  assert.equal(simpleFinClaimUrl(btoa("https://bridge.example/elsewhere")), null);
  assert.equal(simpleFinClaimUrl("not base64 at all!"), null);
});

test("an Access URL is taken apart into where and as whom", () => {
  assert.deepEqual(simpleFinAccess("https://demo:demo@beta-bridge.simplefin.org/simplefin"), {
    base: "https://beta-bridge.simplefin.org/simplefin",
    username: "demo",
    password: "demo",
  });
  assert.equal(simpleFinAccess("https://beta-bridge.simplefin.org/simplefin"), null);
  assert.equal(simpleFinAccess("http://a:b@bridge.example/simplefin"), null);
});

test("amounts are read exactly from their decimal strings", () => {
  assert.equal(simpleFinCents("-45.50"), -4550);
  assert.equal(simpleFinCents("114965.51"), 11496551);
  assert.equal(simpleFinCents("12"), 1200);
  assert.equal(simpleFinCents("-0.005"), -1);
  assert.equal(simpleFinCents("abc"), null);
  assert.equal(simpleFinCents(""), null);
});

// As the demo Bridge answers, an id repeated across accounts included.
const checking = {
  id: "Demo Checking",
  name: "SimpleFIN Checking",
  currency: "USD",
  balance: "25401.15",
  "balance-date": 1792368000,
  conn_id: "CON-SIMPLEFIN-DEMO",
  transactions: [
    { id: "1792310400", posted: 1792310400, amount: "-117.78", description: "Fishing bait", payee: "John's Fishin Shack", memo: "JOHNS FISHIN SHACK BAIT", transacted_at: 1792310400 },
    { id: "1792339200", posted: 1792339200, amount: "-65.54", description: "Grocery store", payee: "Grocery store", memo: "LOCAL GROCER STORE #1133" },
    { id: "p1", posted: 0, amount: "-9.99", description: "Pending", pending: true },
    { id: "bad", posted: 1792339200, amount: "n/a", description: "Broken" },
  ],
};

test("an account's posted lines become bank lines, pending ones left for later", () => {
  const read = fromSimpleFin(checking, { timeZone: "America/Los_Angeles", label: "SimpleFIN Checking" });
  assert.equal(read.transactions.length, 2);
  assert.equal(read.problems.length, 1);
  const [first] = read.transactions;
  // 08:00 UTC on 18 October, 1 am in Los Angeles: the 18th there.
  assert.equal(first.date, "2026-10-18");
  assert.equal(first.amount, -11778);
  assert.equal(first.account, "simplefin-demo-checking");
  assert.equal(first.otherParty, "John's Fishin Shack");
  assert.equal(first.trn, "1792310400");
  assert.equal(first.source.importer, "simplefin");
  assert.equal(simpleFinAccountId({ id: "Demo Savings" }), "simplefin-demo-savings");
});

test("the Bridge's errors in its own words, and windows it will answer", () => {
  assert.deepEqual(simpleFinErrors({ errlist: [{ code: "con.auth", msg: "Reconnect your bank" }] }), ["Reconnect your bank"]);
  assert.deepEqual(simpleFinErrors({ errors: ["old style"] }), ["old style"]);
  const windows = simpleFinWindows(0, 150 * 86_400);
  assert.deepEqual(windows.map((w) => [w.start / 86_400, w.end / 86_400]), [[0, 45], [45, 90], [90, 135], [135, 150]]);
});
