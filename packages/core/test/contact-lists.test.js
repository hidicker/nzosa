import test from "node:test";
import assert from "node:assert/strict";
import { identifyExport, isContactList, mergeContacts, parseContactList, findContact } from "../dist/index.js";

const CUSTOMERS =
  "Customer,Company name,Phone,Email,Billing address,Open balance\n" +
  "Amy's Bird Sanctuary,Amy's Bird Sanctuary,(650) 555-3311,amy@example.com,\"4581 Finch St.\nBayshore, CA\",239.00\n" +
  "Diego Rodriguez,,(650) 555-4477,diego@example.com,,0.00\n" +
  "Freeman Sporting Goods:55 Twin Lane,Freeman Sporting Goods,(650) 555-0001,,,50.00\n";

const VENDORS =
  "Vendor,Company,Phone,Email,Track payments for 1099,Tax ID\n" +
  "Tania's Nursery,Tania's Nursery,(650) 555-0100,tania@example.com,No,\n" +
  "Priya Nair,,(650) 555-0199,priya@example.com,Yes,12-3456789\n";

test("a list of customers or vendors is recognised, and a statement or ledger is not", () => {
  assert.equal(isContactList(CUSTOMERS), true);
  assert.equal(isContactList(VENDORS), true);
  assert.equal(identifyExport(CUSTOMERS).kind, "contact-list");
  assert.equal(isContactList("Date,Amount,Description\n2026-01-01,10.00,x\n"), false);
  assert.equal(isContactList("Name,Date,Amount,Email\nA,2026-01-01,10.00,a@b.c\n"), false);
});

test("customers and vendors are read with what the list holds", () => {
  const customers = parseContactList(CUSTOMERS).contacts;
  assert.equal(customers.length, 3);
  assert.equal(customers[0].kind, "customer");
  assert.equal(customers[0].email, "amy@example.com");
  assert.match(customers[0].address, /Finch St\.\nBayshore/);
  assert.equal(customers[1].company, undefined, "a company the same as the name is not repeated");
  const vendors = parseContactList(VENDORS);
  assert.equal(vendors.kind, "vendor");
  assert.equal(vendors.contacts[1].is1099, true);
  assert.equal(vendors.contacts[1].taxId, "12-3456789");
  assert.equal(vendors.contacts[0].is1099, undefined);
});

test("contacts merge by name, keeping what is held and adding what is new", () => {
  const held = mergeContacts([], [{ name: "Priya Nair", kind: "vendor", email: "mine@example.com" }]);
  const merged = mergeContacts(held, [
    { name: "priya  nair", kind: "customer", email: "other@example.com", phone: "555" },
    { name: "New Co", kind: "vendor" },
  ]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].email, "mine@example.com");
  assert.equal(merged[0].phone, "555");
  assert.equal(merged[0].kind, "both");
  assert.equal(findContact(merged, "NEW CO").name, "New Co");
  const jobs = mergeContacts([], [{ name: "Freeman Sporting Goods", kind: "customer" }]);
  assert.equal(findContact(jobs, "Freeman Sporting Goods:55 Twin Lane").name, "Freeman Sporting Goods");
});
