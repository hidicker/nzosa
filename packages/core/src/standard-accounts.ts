import type { Account } from "./chart.js";
import type { EntityKind } from "./entities.js";
import { starterChart } from "./starter-chart.js";

/**
 * The accounts each kind of entity starts with.
 *
 * The standard chart is a trading company's: sales, cost of goods sold,
 * inventory, PAYE. For a person or a rental property nearly all of it is noise,
 * and the few accounts that matter are missing. So each kind gets the accounts
 * its own return asks for, and nothing else.
 *
 * A rental's expenses are named for the headings of Inland Revenue's rental
 * schedule -- rates, insurance, interest, agent's fees, repairs -- because the
 * schedule places an account under a heading by its name. Residential and
 * commercial are separate sets because tax treats them differently: residential
 * losses are ring-fenced, commercial ones are not, and a commercial property is
 * usually registered for GST where a residential one never is.
 *
 * A person's set is deliberately small: money received, spending, and the
 * income tax paid, which is not spending and which the return asks for. Two
 * more because the IR3 asks for them apart -- interest received, gross, and
 * the resident withholding tax the bank took from it, which is a credit
 * against the tax rather than a cost -- and owner's equity, which is where a
 * person's opening bank and loan balances are balanced to. Without it the
 * household's starting position had nowhere of its own to go.
 * Personal spending is not deductible, so detail there is a budget rather
 * than a tax figure, and anybody who wants the detail can add it.
 */

interface StandardRow {
  code: string;
  name: string;
  type: string;
  /** GST when the entity is registered; anything else is always "No GST". */
  gst: "income" | "expense" | "none";
  description: string;
}

const RENTAL_EXPENSES: readonly StandardRow[] = [
  { code: "404", name: "Bank fees", type: "Expense", gst: "none", description: "Account and loan fees" },
  { code: "412", name: "Accounting fees", type: "Expense", gst: "expense", description: "Preparing the accounts and return" },
  { code: "416", name: "Depreciation", type: "Depreciation", gst: "none", description: "Chattels and fit-out, posted from the asset register" },
  { code: "420", name: "Rates and water", type: "Expense", gst: "expense", description: "Council rates and water charges" },
  { code: "429", name: "Other expenses", type: "Expense", gst: "expense", description: "Advertising for tenants, travel to inspect, sundry costs" },
  { code: "433", name: "Insurance", type: "Expense", gst: "expense", description: "Building, contents and landlord insurance" },
  { code: "437", name: "Interest", type: "Expense", gst: "none", description: "Mortgage interest on money borrowed for the property" },
  { code: "441", name: "Legal fees", type: "Expense", gst: "expense", description: "Tenancy and property legal costs" },
  { code: "450", name: "Property management fees", type: "Expense", gst: "expense", description: "Letting agent's collection and management fees" },
  { code: "473", name: "Repairs and maintenance", type: "Expense", gst: "expense", description: "Restoring the property to its condition; not improvements" },
  { code: "493", name: "Travel", type: "Expense", gst: "expense", description: "Travel to inspect or look after the property, including mileage" },
];

const RENTAL_BALANCES: readonly StandardRow[] = [
  { code: "615", name: "Held by property manager", type: "Current Asset", gst: "none", description: "Rent a property manager has collected and not yet paid out; their payments to you are coded here" },
  { code: "740", name: "Chattels and fit-out", type: "Fixed Asset", gst: "expense", description: "Depreciable items bought for the property" },
  { code: "802", name: "Tenant bonds held", type: "Current Liability", gst: "none", description: "Bond received from a tenant and paid to Tenancy Services" },
  { code: "970", name: "Funds introduced", type: "Equity", gst: "none", description: "Owner's money paid into the property's accounts" },
  { code: "980", name: "Drawings", type: "Equity", gst: "none", description: "Money taken out of the property's accounts by the owner" },
];

const STANDARD: Readonly<Record<Exclude<EntityKind, "business">, readonly StandardRow[]>> = {
  residential: [
    { code: "200", name: "Rent received", type: "Revenue", gst: "none", description: "Rent from tenants" },
    { code: "260", name: "Other rental income", type: "Other Income", gst: "none", description: "Water recharged, insurance payouts, bond kept for damage" },
    ...RENTAL_EXPENSES.map((row) => ({ ...row, gst: "none" as const })),
    ...RENTAL_BALANCES.map((row) => ({ ...row, gst: "none" as const })),
  ],
  commercial: [
    { code: "200", name: "Rent received", type: "Revenue", gst: "income", description: "Rent from tenants" },
    { code: "250", name: "Outgoings recovered", type: "Revenue", gst: "income", description: "Rates, insurance and running costs recharged to tenants" },
    { code: "260", name: "Other rental income", type: "Other Income", gst: "income", description: "Insurance payouts and other property income" },
    ...RENTAL_EXPENSES,
    ...RENTAL_BALANCES,
    { code: "820", name: "GST", type: "Current Liability", gst: "none", description: "GST owing to or from Inland Revenue" },
  ],
  personal: [
    { code: "200", name: "Personal income", type: "Revenue", gst: "none", description: "Wages and any other money received" },
    { code: "270", name: "Interest received", type: "Other Income", gst: "none", description: "Bank interest, before the withholding tax taken from it" },
    { code: "400", name: "Personal spending", type: "Expense", gst: "none", description: "Everyday spending; not deductible" },
    { code: "625", name: "Income tax paid", type: "Current Asset", gst: "none", description: "Provisional and terminal tax paid to Inland Revenue, set against the tax on the return; not an expense" },
    { code: "626", name: "Resident withholding tax deducted", type: "Current Asset", gst: "none", description: "RWT the bank took from interest, claimed as a credit on the return" },
    { code: "970", name: "Owner's equity", type: "Equity", gst: "none", description: "What is owned less what is owed; opening balances are balanced here" },
  ],
};

const TAX_CODE = {
  income: "15% GST on Income",
  expense: "15% GST on Expenses",
  none: "No GST",
} as const;

/**
 * The standard accounts for one kind of entity, with its code suffix.
 *
 * A business gets the standard company chart. An entity not registered for GST
 * gets "No GST" throughout, because it can neither charge GST nor claim it,
 * and the GST control account is left out as having nothing to hold.
 */
export function standardAccounts(
  kind: EntityKind,
  options: { suffix?: string; gstRegistered?: boolean } = {},
): Account[] {
  const suffix = options.suffix ?? "";
  const registered = options.gstRegistered !== false;
  const withSuffix = (account: Account): Account => ({
    ...account,
    code: account.code === "" ? "" : `${account.code}${suffix}`,
  });

  if (kind === "business") {
    return starterChart()
      .filter((a) => registered || a.type !== "GST")
      .map((a) => withSuffix(registered ? a : { ...a, taxCode: "No GST" }));
  }
  return STANDARD[kind]
    .filter((row) => registered || row.name !== "GST")
    .map((row) =>
      withSuffix({
        code: row.code,
        name: row.name,
        type: row.type,
        taxCode: TAX_CODE[registered ? row.gst : "none"],
        description: row.description,
      }),
    );
}

/**
 * A short suffix for an entity's codes, from its name: its initials, or the
 * first two letters of a one-word name. `Totara Street` is TS, `Ana &
 * Tom joint` is ATJ, `Kowhai` is KO.
 *
 * Never one already taken: a clash tries the name's other letters, then any
 * letter, keeping it to three.
 */
export function suggestSuffix(name: string, taken: ReadonlySet<string> = new Set()): string {
  const words = name.toUpperCase().match(/[A-Z]+/g) ?? [];
  const letters = words.join("");
  const initials = words.map((w) => w[0]).join("").slice(0, 3);
  const first = words.length > 1 ? initials : letters.slice(0, 2);
  const tries = [first, initials, letters.slice(0, 2), letters.slice(0, 3)];
  for (const letter of letters + "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    tries.push(`${first.slice(0, 2)}${letter}`);
  }
  for (const candidate of tries) {
    if (/^[A-Z]{1,3}$/.test(candidate) && !taken.has(candidate)) return candidate;
  }
  return "";
}

/** Whether text is usable as a code suffix: one to three capital letters. */
export function isSuffix(text: string): boolean {
  return /^[A-Z]{1,3}$/.test(text);
}

/** A plain numeric code given a suffix; anything else is left as it is. */
export function suffixedCode(code: string, suffix: string): string {
  return /^\d{3,4}$/.test(code.trim()) ? `${code.trim()}${suffix}` : code;
}
