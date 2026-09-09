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

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "apps/web/public/demo");

const rules = {
  _readme:
    "Demo coding rules for an invented business. Rules only ever suggest -- " +
    "every line still has to be confirmed by a person.",
  rules: [
    { priority: 60, keyword: "HIGHLAND BEAN", code: "Cost of goods sold - 300", note: "Green beans" },
    { priority: 60, keyword: "RIMU PROPERTY", code: "Rent paid - 461", note: "Roastery unit rent" },
    { priority: 60, keyword: "TRUSTPOWER", code: "Light, power, heating - 445", note: "Power" },
    { priority: 60, keyword: "PACK IT", code: "Packaging - 310", note: "Bags and boxes" },
    { priority: 60, keyword: "NZ POST", code: "Freight and courier - 425", note: "Courier" },
    { priority: 60, keyword: "FERN ADVISORY", code: "Accounting fees - 437", note: "Accountant" },
    { priority: 60, keyword: "XERO SUBSCRIPTION", code: "Subscriptions - 469", note: "Software" },
    { priority: 60, keyword: "SOUTHERN MACHINERY", code: "Repairs and maintenance - 458", note: "Roaster servicing" },
    { priority: 60, keyword: "NELSON MARKETS", code: "Advertising - 473", note: "Market stall" },
    { priority: 60, keyword: "TRADE SHOW", code: "Advertising - 473", note: "Trade shows" },
    { priority: 60, keyword: "FUEL", code: "Motor vehicle expenses - 449", note: "Van fuel" },
    { priority: 60, keyword: "STATIONERY", code: "Office expenses - 453", note: "Office" },
    { priority: 60, keyword: "AIRLINE TICKET", code: "Travel - 481", note: "Travel" },
    { priority: 60, keyword: "CAFE SUPPLIES", code: "General expenses - 429", note: "Sundries" },
    // The rental keeps its own books, and residential rent is exempt.
    { priority: 70, keyword: "BEATTIE TENANCY", code: "Rent received - 210", note: "Residential rent" },
    { priority: 70, keyword: "NELSON CITY COUNCIL", code: "Rates - 604", note: "Rental rates" },
    { priority: 70, keyword: "KAHU PLUMBING", code: "Property repairs - 600", note: "Rental plumbing" },
    { priority: 70, keyword: "TOPLINE ROOFING", code: "Property repairs - 600", note: "Rental gutters" },
    // Insurance goes to two different places depending on which book it is in,
    // so the account is part of the condition rather than the keyword.
    { priority: 80, keyword: "TASMAN INSURANCE", account: "02-1234-0056789-001", code: "Property insurance - 608", note: "Rental policy" },
    { priority: 60, keyword: "TASMAN INSURANCE", code: "Insurance - 433", note: "Business policy" },
  ],
  defaults: [],
  codeTreatments: {
    "Rent received - 210": "exempt",
    "Rates - 604": "exempt",
    "Property repairs - 600": "exempt",
    "Property insurance - 608": "exempt",
    "Drawings - 630": "out-of-scope",
  },
};

writeFileSync(join(out, "rules.json"), JSON.stringify(rules, null, 2) + "\n");
console.log(`rules:           ${rules.rules.length}`);
console.log(`code treatments: ${Object.keys(rules.codeTreatments).length}`);
