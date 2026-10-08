import assert from "node:assert/strict";
import test from "node:test";
import { accountForBusiness, businessIn, businessOf, describeBusiness, knownBusinessCount, wholePrompt } from "../dist/index.js";

test("the list is a useful size, and every line of it parses", () => {
  assert.ok(knownBusinessCount() >= 600);
});

test("spacing and punctuation do not matter", () => {
  for (const text of ["PAK N SAVE RIMU", "PAKNSAVE", "Pak'nSave Kowhai", "PAK'nSAVE"]) {
    assert.equal(businessIn(text)?.name, "Pak'nSave", text);
  }
  assert.equal(businessIn("McDonald's RIMU")?.name, "McDonald's");
});

test("a one-word name counts only where the payee starts, after the bank's own words", () => {
  assert.equal(businessIn("Z RIMU")?.name, "Z Energy");
  assert.equal(businessIn("POS W/D 4835 Z RIMU")?.name, "Z Energy");
  assert.equal(businessIn("KOWHAI Z TRADING"), null, "not a lone Z in the middle");
  assert.equal(businessIn("ZEBRA KOWHAI LTD"), null, "not the start of a longer word");
  assert.equal(businessIn("RIMU ACCOUNTANTS"), null, "ACC is not ACCOUNTANTS");
  assert.equal(businessIn("PAYMENT TO SPARK"), null);
  assert.equal(businessIn("SPARK NZ")?.name, "Spark");
});

test("the longest name wins, and a name of several words is found anywhere", () => {
  assert.equal(businessIn("UBER EATS AUCKLAND")?.kind, "foodDelivery");
  assert.equal(businessIn("UBER TRIP")?.kind, "transport");
  assert.equal(businessIn("AA INSURANCE")?.kind, "insurance");
  assert.equal(businessIn("TOTARA K DUNEDIN CITY COUNCIL RATES")?.name, "Dunedin City Council");
});

test("the payee first, then the fields a bank moves the name into", () => {
  assert.equal(businessOf({ otherParty: "DD PAYMENT", particulars: "Watercare", reference: "" })?.name, "Watercare");
  assert.equal(businessOf({ otherParty: "Rimu Kowhai", particulars: "lunch" }), null);
});

test("an account is chosen only where exactly one fits", () => {
  const fuel = businessIn("BP RIMU");
  const chart = [
    { label: "449", name: "Motor Vehicle Expenses" },
    { label: "489", name: "Telephone & Internet" },
    { label: "493", name: "Travel - National" },
    { label: "494", name: "Travel - International" },
  ];
  assert.equal(accountForBusiness(fuel, chart), "449");
  assert.equal(accountForBusiness(businessIn("SPARK NZ"), chart), "489");
  assert.equal(accountForBusiness(businessIn("KOREAN AIR SEOUL"), chart), "494");
  assert.equal(accountForBusiness(businessIn("SOUNDS AIR"), chart), "493");
  assert.equal(accountForBusiness(businessIn("AIR NEW ZEALAND"), chart), null, "flies both ways");
  assert.equal(accountForBusiness(businessIn("NEW WORLD RIMU"), chart), null, "a supermarket settles nothing");
  const twoVehicle = [...chart, { label: "450", name: "Motor Vehicle - Ute" }];
  assert.equal(accountForBusiness(fuel, twoVehicle), null, "two motor vehicle accounts: not for a list to choose");
});

test("a model is told what a known business is, for that line only", () => {
  const books = { entities: [], accounts: [], about: "" };
  const line = { id: "1", date: "2026-05-01", direction: "money out", amount: "80.00", payee: "NEW WORLD", details: "", paidFrom: "" };
  const plain = wholePrompt(books, [line]);
  assert.ok(!plain.includes("well-known"));
  const told = wholePrompt(books, [{ ...line, known: describeBusiness(businessIn("NEW WORLD")) }]);
  assert.ok(told.includes("well-known New Zealand businesses"));
  assert.ok(told.includes('"known": "New World: supermarket"'));
});

test("bought in another currency, travel is international; a booking site alone settles nothing", () => {
  const chart = [
    { label: "493", name: "Travel - National" },
    { label: "494", name: "Travel - International" },
  ];
  assert.equal(accountForBusiness(businessIn("UBER TRIP"), chart), "493");
  assert.equal(accountForBusiness(businessIn("UBER TRIP"), chart, true), "494");
  assert.equal(accountForBusiness(businessIn("BOOKING COM"), chart), null);
  assert.equal(accountForBusiness(businessIn("AIRBNB"), chart, true), "494");
});
