import assert from "node:assert/strict";
import test from "node:test";
import { similarContacts } from "../dist/index.js";

const held = [
  { id: "1", name: "Kea Café Ltd", kind: "customer" },
  { id: "2", name: "Harbour Cafe", kind: "customer" },
  { id: "3", name: "Green Bean Importers Limited", kind: "vendor" },
  { id: "4", name: "BP", kind: "vendor" },
  { id: "5", name: "Smith & Sons", kind: "vendor" },
];
const names = (name, except) => similarContacts(name, held, except).map((c) => c.name);

test("the same name written another way", () => {
  assert.deepEqual(names("kea cafe"), ["Kea Café Ltd"]);
  assert.deepEqual(names("Smith and Sons Ltd"), ["Smith & Sons"]);
  assert.deepEqual(names("Green Bean Importers"), ["Green Bean Importers Limited"]);
});

test("a letter or so apart", () => {
  assert.deepEqual(names("Harbor Cafe"), ["Harbour Cafe"]);
  assert.deepEqual(names("Green Bean Imprters Ltd"), ["Green Bean Importers Limited"]);
});

test("different names, and short ones, are not flagged", () => {
  assert.deepEqual(names("Tui Bakery"), []);
  assert.deepEqual(names("BPX"), []);
  assert.deepEqual(names("Harbour Fish"), []);
  assert.deepEqual(names(""), []);
});

test("the contact being edited is not a duplicate of itself", () => {
  assert.deepEqual(names("Harbour Cafe", "2"), []);
});
