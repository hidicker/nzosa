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

/**
 * A not-for-profit's accounts, named for what its members and funders ask
 * about: where the money came from and what it was for.
 *
 * GST follows the treatment of each kind of receipt when the organisation is
 * registered: an unconditional donation is not a supply, so no GST; a grant
 * or a subscription is a taxable supply; selling donated goods is exempt, so
 * the takings carry no GST and the costs of running that shop cannot be
 * claimed. Grants received before they are spent have an account of their
 * own, because a grant with conditions is income only as it is used.
 */
const NON_PROFIT: readonly StandardRow[] = [
  { code: "200", name: "Subscriptions", type: "Revenue", gst: "income", description: "Membership subscriptions and levies" },
  { code: "210", name: "Donations", type: "Revenue", gst: "none", description: "Unconditional gifts from the public and members; no GST. A donor who gets something back is buying, not giving" },
  { code: "220", name: "Grants", type: "Revenue", gst: "income", description: "Grants and sponsorship used for the organisation's purposes; taxable if registered for GST" },
  { code: "230", name: "Fundraising", type: "Revenue", gst: "income", description: "Raffles, events, sausage sizzles and other fundraising" },
  { code: "240", name: "Sales of donated goods", type: "Revenue", gst: "none", description: "Takings from selling gifted goods, such as an op shop; an exempt supply" },
  { code: "250", name: "Trading income", type: "Revenue", gst: "income", description: "Hall hire, bar and canteen takings, fees for services and programmes" },
  { code: "270", name: "Interest received", type: "Other Income", gst: "none", description: "Bank interest" },
  { code: "260", name: "Other income", type: "Other Income", gst: "income", description: "Anything else received" },
  { code: "404", name: "Bank fees", type: "Expense", gst: "none", description: "Account fees" },
  { code: "408", name: "Cost of fundraising", type: "Expense", gst: "expense", description: "What it cost to raise money: raffle prizes, stock for events" },
  { code: "412", name: "Accounting and audit fees", type: "Expense", gst: "expense", description: "Preparing the accounts, any review or audit" },
  { code: "416", name: "Depreciation", type: "Depreciation", gst: "none", description: "Equipment and buildings" },
  { code: "420", name: "Venue and hall hire", type: "Expense", gst: "expense", description: "Meeting rooms, grounds, hall and field hire" },
  { code: "425", name: "Grants and donations paid", type: "Expense", gst: "none", description: "Money given on to people or other organisations; no GST" },
  { code: "429", name: "General expenses", type: "Expense", gst: "expense", description: "Sundry running costs" },
  { code: "433", name: "Insurance", type: "Expense", gst: "expense", description: "Public liability, property and volunteers' cover" },
  { code: "437", name: "Interest", type: "Expense", gst: "none", description: "Interest on borrowing" },
  { code: "445", name: "Light, power, heating", type: "Expense", gst: "expense", description: "Power and gas for the premises" },
  { code: "453", name: "Office expenses", type: "Expense", gst: "expense", description: "Postage, stationery, software and subscriptions" },
  { code: "461", name: "Programme and activity costs", type: "Expense", gst: "expense", description: "What the organisation spends on what it exists to do" },
  { code: "469", name: "Rent and rates", type: "Expense", gst: "expense", description: "Rent, council rates and water" },
  { code: "473", name: "Repairs and maintenance", type: "Expense", gst: "expense", description: "Upkeep of the premises and equipment" },
  { code: "477", name: "Salaries and wages", type: "Expense", gst: "none", description: "Paid staff, including employer KiwiSaver and ACC" },
  { code: "489", name: "Telephone and internet", type: "Expense", gst: "expense", description: "Phone and internet" },
  { code: "493", name: "Travel", type: "Expense", gst: "expense", description: "Travel for the organisation's purposes, including volunteers' mileage" },
  { code: "496", name: "Volunteer costs", type: "Expense", gst: "expense", description: "Thanking and training volunteers" },
  { code: "740", name: "Equipment", type: "Fixed Asset", gst: "expense", description: "Equipment and furniture the organisation owns" },
  { code: "800", name: "Accounts Payable", type: "Accounts Payable", gst: "none", description: "Approved bills not yet paid" },
  { code: "805", name: "Grants received in advance", type: "Current Liability", gst: "none", description: "A grant with conditions, received before it is spent: income only as the conditions are met" },
  { code: "810", name: "Subscriptions in advance", type: "Current Liability", gst: "none", description: "Subscriptions paid for a period that has not started" },
  { code: "820", name: "GST", type: "Current Liability", gst: "none", description: "GST owing to or from Inland Revenue" },
  { code: "960", name: "Special purpose funds", type: "Equity", gst: "none", description: "Money set aside or given for a particular purpose" },
  { code: "970", name: "Accumulated funds", type: "Equity", gst: "none", description: "What the organisation has built up; opening balances are balanced here" },
];

/**
 * A trust's accounts. Money a settlor puts in is "settled", not income. What the
 * trust owes a beneficiary sits in a current account for each, which the
 * Trust people page links to the beneficiary. Interest and dividends are kept
 * apart because the IR6 asks for them in separate boxes.
 */
const TRUST: readonly StandardRow[] = [
  { code: "200", name: "Rent received", type: "Revenue", gst: "none", description: "Rent from the trust's property" },
  { code: "210", name: "Business income", type: "Revenue", gst: "none", description: "Trading income, if the trust runs a business" },
  { code: "260", name: "Other income", type: "Other Income", gst: "none", description: "Any other taxable income" },
  { code: "270", name: "Interest received", type: "Other Income", gst: "none", description: "Bank and term deposit interest" },
  { code: "275", name: "Dividends received", type: "Other Income", gst: "none", description: "Dividends from shares and funds" },
  { code: "280", name: "Capital gains", type: "Other Income", gst: "none", description: "Gains on selling investments or property that are not taxable; not income for the IR6" },
  { code: "404", name: "Bank fees", type: "Expense", gst: "none", description: "Account fees" },
  { code: "412", name: "Accounting and tax fees", type: "Expense", gst: "none", description: "Preparing the accounts and the trust's return" },
  { code: "414", name: "Legal fees", type: "Expense", gst: "none", description: "Lawyers' fees" },
  { code: "429", name: "General expenses", type: "Expense", gst: "none", description: "Sundry running costs" },
  { code: "433", name: "Insurance", type: "Expense", gst: "none", description: "Insurance on the trust's property" },
  { code: "437", name: "Interest", type: "Expense", gst: "none", description: "Interest on borrowing" },
  { code: "469", name: "Rates", type: "Expense", gst: "none", description: "Council rates and water" },
  { code: "473", name: "Repairs and maintenance", type: "Expense", gst: "none", description: "Upkeep of the trust's property" },
  { code: "485", name: "Trustee fees", type: "Expense", gst: "none", description: "Fees paid to professional trustees" },
  { code: "700", name: "Investments", type: "Fixed Asset", gst: "none", description: "Shares, units and other investments" },
  { code: "710", name: "Land and buildings", type: "Fixed Asset", gst: "none", description: "Property the trust owns" },
  { code: "720", name: "Loans to associated persons", type: "Current Asset", gst: "none", description: "Money lent to settlors, trustees, beneficiaries or their families" },
  { code: "800", name: "Loans from associated persons", type: "Current Liability", gst: "none", description: "Money borrowed from settlors, trustees, beneficiaries or their families" },
  { code: "850", name: "Beneficiary current account", type: "Current Liability", gst: "none", description: "What the trust owes a beneficiary from income allocated to them but not yet paid; add one for each beneficiary" },
  { code: "960", name: "Settled funds", type: "Equity", gst: "none", description: "Money and property settled on the trust (its corpus)" },
  { code: "970", name: "Accumulated trust funds", type: "Equity", gst: "none", description: "What the trust has built up; opening balances are balanced here" },
];

const STANDARD: Readonly<Record<Exclude<EntityKind, "business">, readonly StandardRow[]>> = {
  nonprofit: NON_PROFIT,
  trust: TRUST,
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
    // Commercial property is billed like a business -- the plumber's invoice
    // for the shop, the body corporate levy -- and approved bills wait here
    // until they are paid.
    { code: "800", name: "Accounts Payable", type: "Accounts Payable", gst: "none", description: "Approved bills not yet paid" },
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
