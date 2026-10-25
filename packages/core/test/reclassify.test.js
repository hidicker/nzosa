import assert from "node:assert/strict";
import test from "node:test";
import { reclassifyLines } from "../dist/index.js";

test("lines move to the new account, keeping what a person decided, and the move can be undone as one", () => {
  const held = {
    a: { code: "Advertising - 400", contact: "Kiwi Signs", treatment: "zero-rated", confirmed: true, note: "set by hand" },
    c: { code: "Advertising - 400", note: "x" },
  };
  const { overrides, before } = reclassifyLines(held, ["a", "b", "a"], "Signage - 410", "Moved from Advertising - 400", "2026-10-25");
  assert.deepEqual(overrides.a, { code: "Signage - 410", contact: "Kiwi Signs", treatment: "zero-rated", confirmed: true, note: "Moved from Advertising - 400", at: "2026-10-25" });
  assert.deepEqual(overrides.b, { code: "Signage - 410", confirmed: true, note: "Moved from Advertising - 400", at: "2026-10-25" });
  assert.deepEqual(overrides.c, held.c, "a line not chosen is untouched");
  assert.deepEqual(before, [{ id: "a", before: held.a }, { id: "b", before: null }], "each line once, with what it held");
  assert.equal(held.a.code, "Advertising - 400", "the original is not changed");
});
