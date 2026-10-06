/**
 * Coding rules for the demo book.
 *
 * Deliberately partial. They cover the suppliers that repeat every month and
 * say nothing about one-off customers, which is how a real rule set looks: a
 * keyword can recognise a power company, and nothing sensible can recognise a
 * customer who bought once.
 *
 * Run: node tools/make-demo-rules.mjs
 */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { coding } from "./demo-accounts.mjs";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "apps/web/public/demo");

const rules = {
  _readme:
    "Demo coding rules for an invented business. Rules only ever suggest -- " +
    "every line still has to be confirmed by a person.",
  rules: [
    { priority: 60, keyword: "HIGHLAND BEAN", code: coding("Cost of goods sold"), note: "Green beans" },
    { priority: 60, keyword: "RIMU PROPERTY", code: coding("Rent paid"), note: "Roastery unit rent" },
    { priority: 60, keyword: "TRUSTPOWER", code: coding("Light, power, heating"), note: "Power" },
    { priority: 60, keyword: "PACK IT", code: coding("Packaging"), note: "Bags and boxes" },
    { priority: 60, keyword: "NZ POST", code: coding("Freight and courier"), note: "Courier" },
    { priority: 60, keyword: "FERN ADVISORY", code: coding("Accounting fees"), note: "Accountant" },
    { priority: 60, keyword: "XERO SUBSCRIPTION", code: coding("Subscriptions"), note: "Software" },
    { priority: 60, keyword: "SOUTHERN MACHINERY", code: coding("Repairs and maintenance"), note: "Roaster servicing" },
    { priority: 60, keyword: "NELSON MARKETS", code: coding("Advertising"), note: "Market stall" },
    { priority: 60, keyword: "TRADE SHOW", code: coding("Advertising"), note: "Trade shows" },
    { priority: 60, keyword: "FUEL", code: coding("Motor vehicle expenses"), note: "Van fuel" },
    { priority: 60, keyword: "STATIONERY", code: coding("Office expenses"), note: "Office" },
    { priority: 60, keyword: "AIRLINE TICKET", code: coding("Travel"), note: "Travel" },
    { priority: 60, keyword: "CAFE SUPPLIES", code: coding("General expenses"), note: "Sundries" },
    // The rental keeps its own books, and residential rent is exempt.
    { priority: 70, keyword: "BEATTIE TENANCY", code: coding("Rental: Rent received"), note: "Residential rent" },
    { priority: 70, keyword: "NELSON CITY COUNCIL", code: coding("Rental: Rates"), note: "Rental rates" },
    { priority: 70, keyword: "KAHU PLUMBING", code: coding("Rental: Property repairs"), note: "Rental plumbing" },
    { priority: 70, keyword: "TOPLINE ROOFING", code: coding("Rental: Property repairs"), note: "Rental gutters" },
    { priority: 70, keyword: "KIWI HOME LOANS", code: coding("Rental: Interest"), note: "Rental mortgage interest" },
    // The commercial rental is registered for GST, so its rent and costs carry it.
    { priority: 70, keyword: "HARAKEKE FLORIST", code: coding("Shop: Rent received"), note: "Commercial rent" },
    { priority: 70, keyword: "SOUTHERN DOORS", code: coding("Shop: Repairs"), note: "Commercial repairs" },
    { priority: 70, keyword: "KOWHAI PROPERTY", code: coding("Shop: Property management"), note: "Letting fees" },
    // Insurance goes to two different places depending on which book it is in,
    // so the account is part of the condition rather than the keyword.
    { priority: 80, keyword: "TASMAN INSURANCE", account: "02-1234-0056789-001", code: coding("Rental: Property insurance"), note: "Rental policy" },
    { priority: 80, keyword: "TASMAN INSURANCE", account: "02-1234-0056789-002", code: coding("Shop: Insurance"), note: "Commercial property policy" },
    { priority: 60, keyword: "TASMAN INSURANCE", code: coding("Insurance"), note: "Business policy" },
  ],
  defaults: [],
  codeTreatments: {
    [coding("Rental: Rent received")]: "exempt",
    [coding("Rental: Rates")]: "exempt",
    [coding("Rental: Property repairs")]: "exempt",
    [coding("Rental: Property insurance")]: "exempt",
    [coding("Rental: Interest")]: "exempt",
    [coding("Drawings")]: "out-of-scope",
  },
};

writeFileSync(join(out, "rules.json"), JSON.stringify(rules, null, 2) + "\n");
console.log(`rules:           ${rules.rules.length}`);
console.log(`code treatments: ${Object.keys(rules.codeTreatments).length}`);
