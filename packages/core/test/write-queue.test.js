import test from "node:test";
import assert from "node:assert/strict";
import { writeQueue } from "../dist/index.js";

const later = (ms, value, fail = false) =>
  new Promise((resolve, reject) => setTimeout(() => (fail ? reject(new Error(value)) : resolve(value)), ms));

test("writes run one at a time, in the order asked for, however long each takes", async () => {
  const queue = writeQueue();
  const order = [];
  let running = 0;
  const write = (name, ms) =>
    queue.run(async () => {
      running += 1;
      assert.equal(running, 1, "never two at once");
      order.push(`start ${name}`);
      await later(ms);
      order.push(`end ${name}`);
      running -= 1;
      return name;
    });
  // Twenty ticks in quick succession, the first slowest.
  const all = Array.from({ length: 20 }, (_, i) => write(`t${i}`, i === 0 ? 30 : 1));
  assert.equal(queue.pending(), 20);
  assert.deepEqual(await Promise.all(all), Array.from({ length: 20 }, (_, i) => `t${i}`));
  assert.deepEqual(order.slice(0, 4), ["start t0", "end t0", "start t1", "end t1"]);
  assert.equal(queue.pending(), 0);
});

test("one failing does not stop the rest, and says so to its caller", async () => {
  const queue = writeQueue();
  const first = queue.run(() => later(5, "refused", true));
  const second = queue.run(() => later(1, "saved"));
  await assert.rejects(first, /refused/);
  assert.equal(await second, "saved");
  assert.equal(queue.pending(), 0);
});

test("pending counts what is queued and under way, and nothing once done", async () => {
  const queue = writeQueue();
  assert.equal(queue.pending(), 0);
  const a = queue.run(() => later(5, "a"));
  const b = queue.run(() => later(5, "b"));
  assert.equal(queue.pending(), 2);
  await a;
  await later(0);
  assert.equal(queue.pending(), 1);
  await b;
  await later(0);
  assert.equal(queue.pending(), 0);
});
