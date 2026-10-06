/**
 * Xero's list of its bank accounts, and which feed account each one is.
 *
 * A chart of accounts names a bank account the way Xero does -- "Visa -
 * Business Card" -- and a bank feed names it the way the bank does, which for
 * a card is usually the holder's name. The two share nothing to match on. What
 * they share is the number, and Xero prints it in one place: the Uncoded
 * Statement Lines export for all bank accounts (Accounting > Bank accounts >
 * Uncoded statement lines > Export), which heads each account's section with
 * its name and, on the next line, its number -- the whole number for a bank
 * account, the last four digits for a card, an id for PayPal or Wise.
 */

export interface XeroBankAccount {
  name: string;
  /** As Xero prints it: `0212340056789001`, `1234`, `ABC123XYZ`. */
  number: string;
}

const SECTION_HEADER = /^date,payee,particulars\s*\|\s*reference\s*\|\s*code,spent,received/i;

/** Whether text is that export: at least one section headed as it heads them. */
export function isXeroBankAccountList(text: string): boolean {
  return text.split(/\r?\n/).some((line) => SECTION_HEADER.test(line.trim()));
}

/** Each account's name and number: the two lines above each section's column headings. */
export function parseXeroBankAccountList(text: string): XeroBankAccount[] {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/^"|"$/g, "").trim());
  const out: XeroBankAccount[] = [];
  lines.forEach((line, index) => {
    if (!SECTION_HEADER.test(line)) return;
    const name = lines[index - 2] ?? "";
    const number = lines[index - 1] ?? "";
    if (name !== "" && number !== "") out.push({ name, number });
  });
  return out;
}

const digits = (text: string): string => text.replace(/\D/g, "");

/**
 * The one feed account a Xero bank account's number points to, or null.
 *
 * A whole account number must match whole, digit for digit. Four digits are a
 * card's last four, matched at the end of the feed account's id or name. An
 * id of letters and digits -- PayPal's -- must appear in the id. Anything
 * matching more than one account, or none, is left for a person: a guess
 * between two cards is how one card's spending ends up in the other's books.
 */
export function feedAccountForNumber(
  number: string,
  feed: readonly { id: string; label: string }[],
): string | null {
  const wanted = digits(number);
  let matches: { id: string; label: string }[];
  if (/[a-z]/i.test(number)) {
    const id = number.trim().toLowerCase();
    matches = feed.filter((f) => f.id.toLowerCase().includes(id) || f.label.toLowerCase().includes(id));
  } else if (wanted.length >= 10) {
    matches = feed.filter((f) => digits(f.id) === wanted);
  } else if (wanted.length >= 4) {
    matches = feed.filter((f) => digits(f.id).endsWith(wanted) || digits(f.label).endsWith(wanted));
  } else {
    matches = [];
  }
  return matches.length === 1 ? (matches[0]?.id ?? null) : null;
}
