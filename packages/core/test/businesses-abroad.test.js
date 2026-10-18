import test from "node:test";
import assert from "node:assert/strict";
import { accountForBusiness, businessIn, businessOf, describeBusiness, knownBusinessCount, starterChartFor } from "../dist/index.js";

const chart = (country) =>
  starterChartFor(country)
    .filter((a) => /expense|overhead|direct/i.test(a.type))
    .map((a) => ({ label: a.code, name: a.name }));
const account = (text, country) => {
  const business = businessIn(text, country);
  return business === null ? null : accountForBusiness(business, chart(country), false, country);
};

test("each country has its own list, with the global names abroad and New Zealand's own unchanged", () => {
  assert.ok(knownBusinessCount("au") > 500);
  assert.ok(knownBusinessCount("us") > 500);
  assert.equal(businessIn("Z ENERGY", "au"), null);
  assert.equal(businessIn("Z ENERGY")?.kind, "fuel");
  assert.equal(businessIn("BUNNINGS WAREHOUSE", "au")?.kind, "hardware");
  assert.equal(businessIn("ADOBE CREATIVE CLOUD", "us")?.kind, "software");
});

test("Australian lines find the Australian chart's accounts", () => {
  assert.equal(account("AMPOL FOODARY 1234 PARRAMATTA", "au"), "449");
  assert.equal(account("TELSTRA CORP", "au"), "489");
  assert.equal(account("AUSTRALIA POST 3000", "au"), "425");
  assert.equal(account("OFFICEWORKS 0412", "au"), "461");
  assert.match(describeBusiness(businessIn("ATO PAYMENTS", "au"), "au"), /Australian Taxation Office/);
});

test("United States lines find Schedule C's accounts", () => {
  assert.equal(account("SHELL OIL 57444", "us"), "6010");
  assert.equal(account("VERIZON WIRELESS", "us"), "6170");
  assert.equal(account("STAPLES 00123", "us"), "6090");
  assert.equal(account("STATE FARM INSURANCE", "us"), "6050");
  assert.equal(account("DELTA AIR LINES", "us"), null); // flies both ways: the flight says which
  assert.equal(account("SOUTHWEST AIRLINES", "us"), "6150");
  assert.match(describeBusiness(businessIn("IRS USATAXPYMT", "us"), "us"), /IRS/);
  assert.equal(businessOf({ otherParty: "POS 1234 HOME DEPOT" }, "us")?.kind, "hardware");
});

test("people's names are not businesses", () => {
  assert.equal(businessIn("FERGUSON J", "us"), null);
  assert.equal(businessIn("REECE SMITH", "au"), null);
  assert.equal(businessIn("MAVIS JONES", "us"), null);
});
