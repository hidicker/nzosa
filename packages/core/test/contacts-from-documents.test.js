import { test } from "node:test";
import assert from "node:assert/strict";
import { contactsFromDocuments, mergeContacts } from "../dist/index.js";

test("imported invoices and bills become customers and vendors, one record per name", () => {
  const documents = [
    { contact: "Ridgeway Bank", kind: "sales", email: "accounts@ridgeway.example" },
    { contact: "ridgeway bank ", kind: "sales" },
    { contact: "Hamilton Smith Ltd", kind: "purchase" },
    { contact: "Hamilton Smith Ltd", kind: "sales", email: "hs@example.test" },
    { contact: "  ", kind: "sales" },
  ];
  const found = contactsFromDocuments(documents, "Xero");
  assert.deepEqual(found, [
    { name: "Ridgeway Bank", kind: "customer", source: "Xero", email: "accounts@ridgeway.example" },
    { name: "Hamilton Smith Ltd", kind: "both", source: "Xero", email: "hs@example.test" },
  ]);
});

test("a record already held keeps what it has and gains only what it lacked", () => {
  const held = [{ id: "ridgeway-bank", name: "Ridgeway Bank", kind: "customer", email: "kept@example.test" }];
  const merged = mergeContacts(held, contactsFromDocuments([
    { contact: "Ridgeway Bank", kind: "purchase", email: "other@example.test" },
    { contact: "New Customer", kind: "sales" },
  ], "Xero"));
  assert.equal(merged.length, 2);
  assert.equal(merged[0].email, "kept@example.test");
  assert.equal(merged[0].kind, "both");
  assert.equal(merged[1].name, "New Customer");
});
