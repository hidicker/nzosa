import type { Cents } from "./money.js";
import type { IsoDate } from "./dates.js";
import type { NonProfit } from "./non-profit.js";

/**
 * Donation receipts, for a donee organisation.
 *
 * A donor can claim back one-third of what they gave only if the organisation
 * is an approved donee organisation and the receipt has all the right details.
 * A receipt missing one is a donor who cannot claim, and nothing tells the
 * organisation. So the receipt is built here with every detail Inland Revenue
 * asks for, and the program refuses to issue one that lacks any.
 *
 * What a receipt must show, from Inland Revenue's "Requirements for creating
 * donation receipts" and IR255 (read October 2026; check them again before
 * relying on this for a filing):
 *
 * - the organisation's full name on its letterhead, and its IRD number, and its
 *   Charities Services registration number if it has one;
 * - the donor's full name, and their address if the organisation holds it;
 * - the amount and the date -- or, for regular payments, the total for the
 *   year ended 31 March;
 * - a clear statement that it is a donation;
 * - the name, designation and signature of an authorised person, who should
 *   not sign their own receipt or a family member's;
 * - a receipt number different for each receipt;
 * - the word "copy" or "replacement" on any later reissue. A wrong receipt is
 *   cancelled and a new one issued; it is never altered.
 *
 * Not donations: membership fees, raffle tickets, purchases, gifts of goods or
 * property (cryptoassets included), debt forgiven, or a gift that gives the
 * donor or their family a direct benefit. A payment that is part donation and
 * part something else is receipted for the donation only.
 *
 * Copies of every receipt issued are kept for seven years. This register is
 * where they are kept: receipts are voided, never deleted.
 */

export interface DonationReceipt {
  id: string;
  entityId: string;
  /** Different for every receipt, voided ones included. */
  number: string;
  /** The day of the donation, or the last day covered by an annual receipt. */
  date: IsoDate;
  /** The tax year it covers when it is a total for the year: 2027 is April 2026 to March 2027. */
  year?: number | undefined;
  amount: Cents;
  donor: string;
  address?: string | undefined;
  /** The bank lines it covers, so the same money is not receipted twice. */
  transactionIds?: string[] | undefined;
  issued: IsoDate;
  /** Who signed, as it stood the day it was issued. */
  signedBy: string;
  designation: string;
  /** The receipt this one replaces, which has been voided. */
  replaces?: string | undefined;
  voided?: { on: IsoDate; why: string } | undefined;
}

/** The smallest donation Inland Revenue gives a credit for. */
export const MIN_CREDIT_DONATION: Cents = 500;

/** The next receipt number: DR-0001 and up, across every organisation in the books. */
export function nextReceiptNumber(receipts: readonly DonationReceipt[]): string {
  let highest = 0;
  for (const r of receipts) {
    const n = /^DR-(\d+)$/.exec(r.number)?.[1];
    if (n !== undefined) highest = Math.max(highest, Number(n));
  }
  return `DR-${String(highest + 1).padStart(4, "0")}`;
}

/** What is missing on the organisation's side, said in words to act on. */
export function organisationProblems(np: NonProfit | undefined): string[] {
  const out: string[] = [];
  if (np === undefined) return ["This organisation has no not-for-profit settings."];
  if (np.donee !== true) {
    out.push("It is not marked as a donee organisation: only an approved donee organisation can issue receipts donors can claim on.");
  }
  if ((np.irdNumber ?? "").trim() === "") out.push("Its IRD number is needed on every receipt.");
  if (np.registeredCharity === true && (np.charityNumber ?? "").trim() === "") {
    out.push("Its Charities Services registration number is needed on every receipt.");
  }
  const who = np.signatory;
  if (who === undefined || who.name.trim() === "" || who.designation.trim() === "") {
    out.push("Name an authorised person and their designation (Treasurer, Secretary...) to sign receipts.");
  }
  return out;
}

/** What is missing or wrong with one receipt before it is issued. */
export function receiptProblems(np: NonProfit | undefined, receipt: Pick<DonationReceipt, "donor" | "amount" | "signedBy">): string[] {
  const out = organisationProblems(np);
  if (receipt.donor.trim() === "") out.push("The donor's full name is needed.");
  if (receipt.amount <= 0) out.push("The amount is needed.");
  const signer = receipt.signedBy.trim().toLowerCase();
  if (signer !== "" && signer === receipt.donor.trim().toLowerCase()) {
    out.push("The person authorised to sign should not sign a receipt for their own donation, or a family member's. Have somebody else sign.");
  }
  return out;
}

/** Whether a donation is large enough for the credit; below it the receipt can still be issued. */
export function belowCreditMinimum(amount: Cents): boolean {
  return amount > 0 && amount < MIN_CREDIT_DONATION;
}

function escape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function dateSaid(date: IsoDate): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${d} ${months[m - 1] ?? ""} ${y}`;
}

function amountSaid(cents: Cents): string {
  return `$${(cents / 100).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * The receipt, as a page to print or save as a PDF.
 *
 * A reissue says so at the top: "COPY" for the same receipt again, and
 * "REPLACEMENT" for one that stands in for a cancelled receipt, naming it. A
 * voided receipt prints "CANCELLED", so one that has been withdrawn cannot be
 * mistaken for a good one.
 */
export function receiptHtml(
  organisation: { name: string; address?: string | undefined },
  np: NonProfit,
  receipt: DonationReceipt,
  options: { copy?: boolean; replacedNumber?: string } = {},
): string {
  const mark =
    receipt.voided !== undefined
      ? "CANCELLED"
      : options.replacedNumber !== undefined || receipt.replaces !== undefined
        ? `REPLACEMENT${options.replacedNumber !== undefined ? ` for receipt ${escape(options.replacedNumber)}` : ""}`
        : options.copy === true
          ? "COPY"
          : "";
  const covers =
    receipt.year !== undefined
      ? `Total of donations received in the year ended 31 March ${receipt.year}`
      : `Donation received on ${dateSaid(receipt.date)}`;
  const ids = [
    `IRD number: ${escape((np.irdNumber ?? "").trim())}`,
    ...(np.registeredCharity === true && (np.charityNumber ?? "").trim() !== ""
      ? [`Charities Services registration number: ${escape((np.charityNumber ?? "").trim())}`]
      : []),
  ];
  return `<!doctype html>
<html lang="en-NZ">
<head>
<meta charset="utf-8">
<title>Donation receipt ${escape(receipt.number)}</title>
<style>
  body { font-family: Georgia, "Times New Roman", serif; max-width: 42rem; margin: 2rem auto; padding: 0 1rem; color: #111; }
  header { border-bottom: 2px solid #111; padding-bottom: 0.6rem; margin-bottom: 1.2rem; }
  h1 { margin: 0; font-size: 1.6rem; }
  .ids, .address { font-size: 0.9rem; color: #333; margin: 0.2rem 0 0; white-space: pre-line; }
  .mark { font-family: sans-serif; font-weight: 700; letter-spacing: 0.15em; color: #a00; margin: 0 0 0.6rem; }
  h2 { font-size: 1.15rem; margin: 0 0 0.8rem; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 1.2rem; }
  td { padding: 0.35rem 0; vertical-align: top; border-bottom: 1px solid #ddd; }
  td:first-child { width: 11rem; color: #444; }
  .amount { font-size: 1.3rem; font-weight: 700; }
  .statement { margin: 1rem 0; }
  .sign { margin-top: 3rem; }
  .line { border-top: 1px solid #111; width: 16rem; margin-bottom: 0.2rem; }
  .small { font-size: 0.85rem; color: #333; margin-top: 1.6rem; }
</style>
</head>
<body>
<header>
  <h1>${escape(organisation.name)}</h1>
  ${organisation.address !== undefined && organisation.address.trim() !== "" ? `<p class="address">${escape(organisation.address.trim())}</p>` : ""}
  <p class="ids">${ids.join(" &middot; ")}</p>
</header>
${mark !== "" ? `<p class="mark">${mark}</p>` : ""}
<h2>Receipt for a donation</h2>
<table>
  <tr><td>Receipt number</td><td>${escape(receipt.number)}</td></tr>
  <tr><td>Donor</td><td>${escape(receipt.donor.trim())}${receipt.address !== undefined && receipt.address.trim() !== "" ? `<br>${escape(receipt.address.trim()).replace(/\n/g, "<br>")}` : ""}</td></tr>
  <tr><td>${escape(covers)}</td><td class="amount">${escape(amountSaid(receipt.amount))}</td></tr>
  <tr><td>Issued</td><td>${escape(dateSaid(receipt.issued))}</td></tr>
</table>
<p class="statement">This is a receipt for a <strong>donation</strong>: a gift of money to ${escape(organisation.name)}, a donee organisation approved by Inland Revenue, for which no goods, services or other direct benefit were received.</p>
<div class="sign">
  <div class="line"></div>
  <div>${escape(receipt.signedBy.trim())}</div>
  <div>${escape(receipt.designation.trim())}, ${escape(organisation.name)}</div>
</div>
<p class="small">Individuals who give $5 or more to a donee organisation may be able to claim a donation tax credit of one-third of what they gave. Membership fees, raffle tickets and purchases are not donations and are not included here.</p>
</body>
</html>
`;
}

export interface DonorYear {
  donor: string;
  year: number;
  amount: Cents;
  receipts: number;
}

/**
 * What each donor gave in each tax year, from the receipts that stand: a total
 * for a donor who gave on several days, as an annual summary for them. A
 * voided receipt is not counted, and neither is one a replacement stands in for.
 */
export function donorYears(
  receipts: readonly DonationReceipt[],
  taxYearOf: (date: IsoDate) => number,
): DonorYear[] {
  const totals = new Map<string, DonorYear>();
  for (const r of receipts) {
    if (r.voided !== undefined) continue;
    const year = r.year ?? taxYearOf(r.date);
    const key = `${r.donor.trim().toLowerCase()}|${year}`;
    const held = totals.get(key);
    if (held === undefined) totals.set(key, { donor: r.donor.trim(), year, amount: r.amount, receipts: 1 });
    else totals.set(key, { ...held, amount: (held.amount + r.amount) as Cents, receipts: held.receipts + 1 });
  }
  return [...totals.values()].sort((a, b) => b.year - a.year || a.donor.localeCompare(b.donor));
}
