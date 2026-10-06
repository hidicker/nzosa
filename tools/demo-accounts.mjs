/**
 * The demo's chart of accounts: each entity's Standard accounts, exactly as
 * the app's Standard accounts button would add them, with the entity's code
 * suffix. And where each of the demo's codings goes in it.
 *
 * Shared by make-demo-ledger.mjs and make-demo-rules.mjs, so the codings and
 * the rules cannot name accounts the chart does not have.
 */
import { standardAccounts } from "../packages/core/dist/index.js";

export const ENTITIES = [
  { name: "Kea Coffee Roasters Limited", kind: "business", suffix: "KC", gstRegistered: true },
  { name: "17 Rimu Lane", kind: "residential", suffix: "RL", gstRegistered: false },
  { name: "4 Matai Street", kind: "commercial", suffix: "MS", gstRegistered: true },
];

/**
 * How a standard account is treated for GST. Residential rent is an exempt
 * supply, so the rental's income and costs are exempt; its balance sheet
 * accounts, like everyone else's untaxed ones, are outside GST.
 */
function treatmentOf(account, entity) {
  if (account.gstTreatment) return account.gstTreatment;
  if (!entity.gstRegistered) {
    return /revenue|income|expense|overhead|depreciation/i.test(account.type) ? "exempt" : "out-of-scope";
  }
  return /^15%/.test(account.taxCode) ? "standard" : "out-of-scope";
}

/** [code, name, type, tax code, description, entity name, GST treatment], entity by entity. */
export const chartRows = ENTITIES.flatMap((entity) =>
  standardAccounts(entity.kind, { suffix: entity.suffix, gstRegistered: entity.gstRegistered }).map((a) => [
    a.code, a.name, a.type, a.taxCode, a.description ?? "", entity.name, treatmentOf(a, entity),
  ]),
);

/**
 * Each account the demo's decisions are written against, by its plain demo
 * name, to the standard account it belongs in. Written once here so the
 * codings, splits and rules read naturally above them.
 */
const PLACED = {
  "Sales": "200KC",
  "Cost of goods sold": "310KC",
  "Packaging": "310KC",
  "Freight and courier": "425KC",
  "General expenses": "429KC",
  "Insurance": "433KC",
  "Accounting fees": "412KC",
  "Light, power, heating": "445KC",
  "Motor vehicle expenses": "449KC",
  "Office expenses": "453KC",
  "Repairs and maintenance": "473KC",
  "Rent paid": "469KC",
  "Subscriptions": "485KC",
  "Advertising": "400KC",
  "Telephone and internet": "489KC",
  "Travel": "493KC",
  "Drawings": "980KC",
  "Rental: Rent received": "200RL",
  "Rental: Property repairs": "473RL",
  "Rental: Rates": "420RL",
  "Rental: Interest": "437RL",
  "Rental: Property insurance": "433RL",
  "Shop: Rent received": "200MS",
  "Shop: Insurance": "433MS",
  "Shop: Repairs": "473MS",
  "Shop: Property management": "450MS",
};

const byCode = new Map(chartRows.map(([code, name]) => [code, name]));

/** A demo account as a coding, `Rates and water - 420RL`, the way the chart names it. */
export function coding(demoName) {
  const code = PLACED[demoName];
  const name = code === undefined ? undefined : byCode.get(code);
  if (name === undefined) throw new Error(`no standard account for ${demoName}`);
  return `${name} - ${code}`;
}
