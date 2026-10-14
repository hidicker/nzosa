import { test } from "node:test";
import assert from "node:assert/strict";
import { collectionLetter, lateFee, reminderStageFor } from "../dist/index.js";

const supplier = { name: "Ellis Design Studio", address: "1 Main St" };
const lines = [
  { number: "INV-1", issued: "2026-01-05", due: "2026-02-04", total: 50000, owing: 50000, reference: "" },
  { number: "INV-2", issued: "2026-03-01", due: "2026-03-31", total: 20000, owing: 0, reference: "" },
  { number: "INV-3", issued: "2026-03-10", due: "2026-04-30", total: 30000, owing: 30000, reference: "" },
];

test("a reminder lists only what is past due, more firmly as it gets later", () => {
  assert.equal(reminderStageFor(10), 1);
  assert.equal(reminderStageFor(45), 2);
  assert.equal(reminderStageFor(90), 3);
  const html = collectionLetter("Acme <Co>", lines, "2026-04-15", supplier, 3, { dateStyle: "mdy", lang: "en-US" });
  assert.match(html, /Final notice/);
  assert.match(html, /INV-1/);
  assert.doesNotMatch(html, /INV-2|INV-3/);
  assert.match(html, /Acme &lt;Co&gt;/);
  assert.match(html, /<td class="n">70<\/td>/);
});

test("a late fee is a percentage of what is past due, never under the minimum", () => {
  assert.equal(lateFee(50000, 1.5), 750);
  assert.equal(lateFee(10000, 1.5, 2500), 2500);
  assert.equal(lateFee(0, 1.5, 2500), 0);
});
