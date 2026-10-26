import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { returnFingerprint, sha256Hex } from "../dist/index.js";

test("SHA-256 as the standard has it", () => {
  for (const text of ["", "abc", "a".repeat(1000), "Kia ora — ā ē", "x".repeat(55), "y".repeat(56), "z".repeat(64)]) {
    assert.equal(sha256Hex(text), createHash("sha256").update(text, "utf8").digest("hex"), JSON.stringify(text.slice(0, 10)));
  }
});

test("the same figures give the same fingerprint, whatever their order; a changed one another", () => {
  const a = returnFingerprint("GST 2026-02-01..2026-03-31", { box5: 2300000, box6: 0, box15: -12345 });
  const b = returnFingerprint("GST 2026-02-01..2026-03-31", { box15: -12345, box6: 0, box5: 2300000 });
  const c = returnFingerprint("GST 2026-02-01..2026-03-31", { box5: 2300001, box6: 0, box15: -12345 });
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[0-9A-F]{4} [0-9A-F]{4} [0-9A-F]{4} [0-9A-F]{4}$/);
});
