/**
 * Not-for-profit organisations: charities, incorporated societies, clubs and
 * charitable trusts.
 *
 * One kind of entity rather than four. What changes how an organisation is
 * treated is a handful of facts about it -- is it a registered charity, is it
 * a donee organisation, is it registered for GST, has Inland Revenue approved
 * it for the $1,000 deduction -- and they cut across the legal forms: a club is
 * usually an incorporated society, many societies are also charities, and a
 * charitable trust is a charity. So the form sets sensible starting answers and
 * the facts are held beside it, each one changeable on its own.
 *
 * Sources, all read from the official pages in October 2026 and to be checked
 * again before anything here is relied on for a filing:
 *
 * - Reporting by charities: Charities Services, "Which tier will I use", and
 *   the XRB's Tier 4 standard (cash basis, operating payments under $140,000).
 * - Reporting by incorporated societies: Companies Office, "Financial
 *   reporting standards for small societies" ($50,000 test, two years).
 * - Donations: Inland Revenue's donation tax credit pages and IR255.
 * - GST: IS 20/09 (unconditional gifts) and IR375: donations are not a supply,
 *   grants are taxable if registered, donated goods are exempt.
 * - Clubs and societies: Inland Revenue's IR9 pages (the $1,000 deduction).
 */

export type NonProfitForm = "charity" | "society" | "club" | "charitable-trust";

/** The words for each form, in the order they are offered. */
export const NON_PROFIT_FORMS: readonly (readonly [NonProfitForm, string])[] = [
  ["charity", "Registered charity"],
  ["society", "Incorporated society"],
  ["club", "Club"],
  ["charitable-trust", "Charitable trust"],
];

export interface NonProfit {
  form: NonProfitForm;
  /** On the Charities Register. */
  registeredCharity?: boolean | undefined;
  /** The registration number printed on a donation receipt (CC12345). */
  charityNumber?: string | undefined;
  /** A donee organisation: donors can claim a tax credit for what they give. */
  donee?: boolean | undefined;
  /** Inland Revenue has approved it as a not-for-profit for the $1,000 deduction. */
  deduction?: boolean | undefined;
  /** Its IRD number, as a donation receipt shows it. */
  irdNumber?: string | undefined;
  /**
   * Who is authorised to sign donation receipts, and their designation. Not
   * the donor, and not the donor's family: see donation-receipts.ts.
   */
  signatory?: { name: string; designation: string } | undefined;
}

/** What a form usually is, as a starting point. Every answer can be changed. */
export function nonProfitDefaults(form: NonProfitForm): NonProfit {
  switch (form) {
    case "charity":
    case "charitable-trust":
      // A charitable trust is a charity; one with only charitable purposes
      // has to register to be a donee organisation at all.
      return { form, registeredCharity: true };
    case "society":
    case "club":
      return { form };
  }
}

export function nonProfitFormName(form: NonProfitForm): string {
  return NON_PROFIT_FORMS.find(([value]) => value === form)?.[1] ?? "Not-for-profit";
}

/**
 * The returns and reports this organisation owes, in plain words. A line each,
 * for the entity's page: what to file and with whom.
 */
export function nonProfitReporting(np: NonProfit): string[] {
  const out: string[] = [];
  if (np.registeredCharity === true) {
    out.push(
      "Annual return and performance report to Charities Services. A charity with operating payments " +
        "under $140,000 can report on a cash basis (Tier 4).",
    );
  } else if (np.form === "society") {
    out.push(
      "Financial statements to the Companies Office within 6 months of balance date. A society under " +
        "$50,000 in both operating payments and current assets (each of the last two years) needs only " +
        "income and expenditure, assets and liabilities, and any security over property; a larger one " +
        "uses the Tier 4 cash standard if operating payments are under $140,000.",
    );
  }
  if (np.registeredCharity !== true && (np.form === "club" || np.form === "society")) {
    out.push(
      "An income tax return (IR9) each year unless all its income is exempt. Subscriptions from members " +
        "are not income; profit from trading with members is taxable unless an exemption applies.",
    );
  }
  return out;
}

/** Things worth saying about the answers given. Advice, never a refusal. */
export function nonProfitNotes(np: NonProfit, gstRegistered: boolean): string[] {
  const notes: string[] = [];
  if (np.donee === true && np.registeredCharity !== true) {
    notes.push(
      "Since 1 April 2020 an organisation with only charitable purposes has to be a registered charity " +
        "to be a donee organisation. If this one has other purposes too, Inland Revenue approves it " +
        "separately.",
    );
  }
  if (np.donee === true && (np.charityNumber ?? "").trim() === "" && np.registeredCharity === true) {
    notes.push("Donation receipts carry the charity's registration number: enter it above.");
  }
  if (np.donee === true && (np.irdNumber ?? "").trim() === "") {
    notes.push("Donation receipts carry the organisation's IRD number: enter it above.");
  }
  if (np.registeredCharity !== true && np.deduction !== true) {
    notes.push(
      "A not-for-profit that is not a registered charity can claim a $1,000 deduction against its " +
        "taxable income if Inland Revenue approves it as a not-for-profit (the IR9 asks).",
    );
  }
  if (np.deduction === true && np.registeredCharity === true) {
    notes.push("A registered charity's income is generally exempt, so the $1,000 deduction is not needed.");
  }
  if (gstRegistered) {
    notes.push(
      "GST: unconditional donations are not a taxable supply, grants and subscriptions are, and selling " +
        "donated goods is exempt. A non-profit that makes only exempt supplies should not be registered.",
    );
  } else {
    notes.push(
      "Not registered for GST. Registration is optional below $60,000 of taxable turnover; donations " +
        "do not count towards it.",
    );
  }
  return notes;
}
