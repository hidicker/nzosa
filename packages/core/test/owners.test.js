import assert from "node:assert/strict";
import test from "node:test";
import { parseOwners, formatOwners, ownersTotal } from "../dist/index.js";

test("semicolons, commas and 'and' all separate owners", () => {
  // A comma used not to split at all, so this became one owner named
  // "Hamish 50%, Jaehee" holding 50% -- silently, and onto a return.
  for (const written of [
    "Hamish 50%; Jaehee 50%",
    "Hamish 50%, Jaehee 50%",
    "Hamish 50% and Jaehee 50%",
    "Hamish 50%,Jaehee 50%",
  ]) {
    assert.deepEqual(
      parseOwners(written),
      [{ name: "Hamish", percent: 50 }, { name: "Jaehee", percent: 50 }],
      written,
    );
  }
});

test("a bare name owns the whole thing", () => {
  assert.deepEqual(parseOwners("Ana Whitcombe"), [{ name: "Ana Whitcombe", percent: 100 }]);
});

test("'and' inside a name is part of the name", () => {
  // Only a share can be followed by a separator, so "and" between two words
  // of a name is left where it is.
  assert.deepEqual(parseOwners("Rose and Crown Ltd"), [
    { name: "Rose and Crown Ltd", percent: 100 },
  ]);
  assert.deepEqual(parseOwners("Rose and Crown Ltd 60%; Ana 40%"), [
    { name: "Rose and Crown Ltd", percent: 60 },
    { name: "Ana", percent: 40 },
  ]);
});

test("decimals and spacing survive", () => {
  assert.deepEqual(parseOwners("Ana 33.34 % ; Tom 33.33%; Sam 33.33%"), [
    { name: "Ana", percent: 33.34 },
    { name: "Tom", percent: 33.33 },
    { name: "Sam", percent: 33.33 },
  ]);
});

test("what it wrote, it reads back", () => {
  const owners = [{ name: "Ana Whitcombe", percent: 50 }, { name: "Tom Whitcombe", percent: 50 }];
  assert.deepEqual(parseOwners(formatOwners(owners)), owners);
});

test("shares are added up and said out loud", () => {
  const ok = ownersTotal(parseOwners("Hamish 50%; Jaehee 50%"));
  assert.equal(ok.ok, true);
  assert.equal(ok.said, "Hamish 50%, Jaehee 50%");

  // Somebody's income unreported, which is the whole reason for tracking it.
  const short = ownersTotal(parseOwners("Hamish 50%; Jaehee 40%"));
  assert.equal(short.ok, false);
  assert.match(short.said, /totals 90%, not 100%/);

  // And the case the old comma bug produced: one owner at half.
  const half = ownersTotal(parseOwners("Hamish 50%"));
  assert.equal(half.ok, false);
  assert.match(half.said, /totals 50%, not 100%/);
});

test("no owners is not a problem", () => {
  assert.deepEqual(ownersTotal([]), { percent: 0, ok: true, said: "" });
});

test("thirds that do not quite make 100 are still a problem", () => {
  assert.equal(ownersTotal(parseOwners("A 33%; B 33%; C 33%")).ok, false);
  assert.equal(ownersTotal(parseOwners("A 33.34%; B 33.33%; C 33.33%")).ok, true);
});
