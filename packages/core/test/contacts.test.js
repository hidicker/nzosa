import { test } from "node:test";
import assert from "node:assert/strict";
import { lookalikeContact, looseContactKey } from "../dist/index.js";

test("a name that looks like another once punctuation and company words are set aside", () => {
  const held = [{ id: "a", name: "Kea Supplies, Ltd", kind: "vendor" }, { id: "b", name: "The Roastery Bar", kind: "customer" }];
  assert.equal(looseContactKey("Kea Supplies Limited"), "kea supplies");
  assert.equal(lookalikeContact(held, "Kea Supplies Limited")?.id, "a");
  assert.equal(lookalikeContact(held, "Roastery Bar (NZ)")?.id, "b");
  assert.equal(lookalikeContact(held, "Kea Supplies, Ltd"), undefined, "the very name is refused elsewhere, not warned about");
  assert.equal(lookalikeContact(held, "Kea Supplies Limited", "a"), undefined, "a contact is not like itself");
  assert.equal(lookalikeContact(held, "Kea Coffee"), undefined);
  assert.equal(lookalikeContact(held, "Ltd"), undefined);
});
