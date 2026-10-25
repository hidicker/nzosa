import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { returnFingerprint, sameFingerprint, sha256Hex } from "../dist/index.js";

test("SHA-256 agrees with Node's on empty, short, block-edge, long and non-ASCII text", () => {
  for (const text of ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(64), "x".repeat(1000), "Māori ā ē ī ō ū 🥝"]) {
    assert.equal(sha256Hex(text), createHash("sha256").update(text, "utf8").digest("hex"), JSON.stringify(text.slice(0, 10)));
  }
});

test("a return's fingerprint changes with any figure, and reads back whatever its spacing", () => {
  const period = { from: "2026-01-01", to: "2026-02-28" };
  const boxes = [{ box: "5", amount: 1150000 }, { box: "15", amount: 150000 }];
  const print = returnFingerprint("GST return", period, boxes, "Kea Coffee Roasters Limited");
  assert.match(print, /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
  assert.equal(print, returnFingerprint("GST return", period, boxes, "Kea Coffee Roasters Limited"));
  assert.notEqual(print, returnFingerprint("GST return", period, [{ box: "5", amount: 1150001 }, boxes[1]], "Kea Coffee Roasters Limited"));
  assert.notEqual(print, returnFingerprint("GST return", { ...period, to: "2026-03-31" }, boxes, "Kea Coffee Roasters Limited"));
  assert.equal(sameFingerprint(print.toLowerCase().replace(/-/g, " "), print), true);
  assert.equal(sameFingerprint("", print), false);
  assert.equal(sameFingerprint("0000-0000-0000-0000", print), print === "0000-0000-0000-0000");
});
