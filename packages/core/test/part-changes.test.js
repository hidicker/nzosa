import test from "node:test";
import assert from "node:assert/strict";
import { applyPartOps, copySize, partChanges, partCopy } from "../dist/index.js";

/** The changes from `before` to `after`, checked to rebuild `after` exactly. */
function roundTrip(before, after) {
  const changes = partChanges(partCopy(before), after);
  assert.ok(changes !== null, "a part of the same shape gives changes");
  assert.deepEqual(applyPartOps(before, changes.ops), JSON.parse(JSON.stringify(after)));
  assert.deepEqual(changes.copy, partCopy(after), "the copy kept is the new value's");
  return changes.ops;
}

const event = (n, extra = {}) => ({ id: `e${n}`, kind: "coding", summary: `change ${n}`, before: null, after: { code: "6100" }, ...extra });

test("nothing changed is nothing sent", () => {
  const decisions = { overrides: { a: { code: "1" } }, legitimateDuplicates: ["x"], lockDates: { all: "2025-03-31" } };
  assert.deepEqual(roundTrip(decisions, structuredClone(decisions)), []);
  assert.deepEqual(roundTrip([event(1), event(2)], [event(1), event(2)]), []);
});

test("coding one line sends that line alone", () => {
  const overrides = {};
  for (let i = 0; i < 2000; i++) overrides[`t${i}`] = { code: "6100", confirmed: true };
  const before = { overrides, splits: {}, varianceNotes: [] };
  const after = { ...before, overrides: { ...overrides, t5000: { code: "4000", confirmed: true } } };
  assert.deepEqual(roundTrip(before, after), [{ set: ["overrides", "t5000"], value: { code: "4000", confirmed: true } }]);

  const changed = { ...before, overrides: { ...overrides, t7: { code: "4000", confirmed: true } } };
  assert.deepEqual(roundTrip(before, changed), [{ set: ["overrides", "t7"], value: { code: "4000", confirmed: true } }]);
});

test("a coding taken away is a key removed", () => {
  const before = { overrides: { a: { code: "1" }, b: { code: "2" } } };
  const after = { overrides: { a: { code: "1" } } };
  assert.deepEqual(roundTrip(before, after), [{ del: ["overrides", "b"] }]);
});

test("a key that comes and goes at the top, and one set to nothing", () => {
  const before = { overrides: {}, lockDates: { all: "2025-03-31" } };
  const after = { overrides: {}, filing: { taxAgent: true }, lockDates: undefined };
  assert.deepEqual(roundTrip(before, after), [{ set: ["filing"], value: { taxAgent: true } }, { del: ["lockDates"] }]);
});

test("a changed object in place is found, because the copy is text", () => {
  const decisions = { overrides: { a: { code: "1" } } };
  const copy = partCopy(decisions);
  decisions.overrides.a.code = "2";
  decisions.overrides.b = { code: "3" };
  const changes = partChanges(copy, decisions);
  assert.deepEqual(changes.ops, [
    { set: ["overrides", "a"], value: { code: "2" } },
    { set: ["overrides", "b"], value: { code: "3" } },
  ]);
});

test("a history entry on the front is one splice", () => {
  const before = Array.from({ length: 300 }, (_, i) => event(i));
  const after = [event(999), ...before];
  assert.deepEqual(roundTrip(before, after), [{ splice: [], at: 0, remove: 0, insert: [event(999)] }]);
});

test("a full history: one on the front, the oldest off the end", () => {
  const before = Array.from({ length: 5000 }, (_, i) => event(i));
  const after = [event(9999), ...before].slice(0, 5000);
  const ops = roundTrip(before, after);
  assert.equal(ops.length, 2);
  assert.ok(JSON.stringify(ops).length < 500);
});

test("an undo marks one entry in the middle", () => {
  const before = Array.from({ length: 1000 }, (_, i) => event(i));
  const after = before.map((e) => (e.id === "e500" ? { ...e, reverted: true } : e));
  assert.deepEqual(roundTrip(before, after), [{ splice: [], at: 500, remove: 1, insert: [{ ...event(500), reverted: true }] }]);
});

test("a list inside the codings changes by splice", () => {
  const before = { legitimateDuplicates: ["a", "b", "c"], overrides: {} };
  assert.deepEqual(roundTrip(before, { ...before, legitimateDuplicates: ["a", "b", "c", "d"] }), [
    { splice: ["legitimateDuplicates"], at: 3, remove: 0, insert: ["d"] },
  ]);
  roundTrip(before, { ...before, legitimateDuplicates: [] });
  roundTrip(before, { ...before, legitimateDuplicates: ["z", "a", "c"] });
});

test("a part that changes shape needs a whole save", () => {
  assert.equal(partChanges(partCopy([1, 2]), { a: 1 }), null);
  assert.equal(partChanges(partCopy({ a: 1 }), [1]), null);
  assert.equal(partChanges(partCopy("text"), "other"), null);
});

test("keys whose value changes kind are replaced whole", () => {
  roundTrip({ a: [1, 2], b: { x: 1 }, c: 5 }, { a: { x: 1 }, b: [1], c: { y: 2 } });
});

test("the size of a copy is about the size of the JSON", () => {
  const value = { overrides: { a: { code: "1" } }, list: [1, 2, 3], n: 5 };
  const size = copySize(partCopy(value));
  const json = JSON.stringify(value).length;
  assert.ok(Math.abs(size - json) <= 4, `${size} vs ${json}`);
});

test("random changes always rebuild the new value", () => {
  let seed = 7;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const pick = (n) => Math.floor(random() * n);
  const leaf = () => [null, pick(100), `s${pick(50)}`, { code: `${pick(9)}` }, [pick(3)], true][pick(6)];

  for (let round = 0; round < 400; round++) {
    // Key-value parts.
    const before = {};
    for (let i = 0; i < 8; i++) {
      const kind = pick(3);
      before[`k${i}`] = kind === 0 ? leaf() : kind === 1 ? Object.fromEntries(Array.from({ length: pick(6) }, (_, j) => [`s${j}`, leaf()])) : Array.from({ length: pick(6) }, leaf);
    }
    const after = structuredClone(before);
    for (let n = pick(6); n > 0; n--) {
      const key = `k${pick(10)}`;
      const what = pick(5);
      const held = after[key];
      if (what === 0) delete after[key];
      else if (what === 1) after[key] = leaf();
      else if (Array.isArray(held)) {
        const at = pick(held.length + 1);
        held.splice(at, pick(3), ...Array.from({ length: pick(3) }, leaf));
      } else if (held !== null && typeof held === "object" && !Array.isArray(held)) {
        if (pick(2) === 0) delete held[`s${pick(6)}`];
        else held[`s${pick(8)}`] = leaf();
      }
    }
    roundTrip(before, after);

    // Lists.
    const list = Array.from({ length: pick(40) }, (_, i) => event(i));
    const changed = list.slice();
    const what = pick(5);
    if (what === 0) changed.unshift(event(100 + round));
    else if (what === 1) { changed.unshift(event(200 + round), event(300 + round)); changed.splice(-pick(3), 3); }
    else if (what === 2 && changed.length > 0) changed[pick(changed.length)] = { ...changed[0], reverted: true };
    else if (what === 3) changed.splice(pick(changed.length + 1), pick(4), event(400 + round));
    else changed.reverse();
    roundTrip(list, changed);
  }
});
