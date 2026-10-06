/**
 * What an account code looks like when it has to be found inside a label.
 *
 * Three or four digits, as in every New Zealand chart -- `420`, `1001` -- and
 * optionally an entity's suffix of one to three capital letters: `420MS`.
 * The suffix is what lets two rentals in one set of books each have rates at
 * 420 without being the same account. It keeps the number first, so codes
 * still sort by what they are, and it stays within the ten letters and
 * digits an accounting system's code allows.
 *
 * A letter only counts as a suffix when no further letter follows it, so
 * `420Mount` is still code 420 and a name, as it always was.
 *
 * Kept in one place because a pattern repeated in ten files is ten chances for
 * one of them to read `420MS` as `420` -- which is another entity's account.
 */
export const ACCOUNT_CODE = String.raw`\d{3,4}(?:[A-Z]{1,3}(?![A-Za-z]))?`;

const FIRST_CODE = new RegExp(String.raw`\b(${ACCOUNT_CODE})\b`);
const WHOLE_CODE = new RegExp(String.raw`^${ACCOUNT_CODE}$`);

/** The first account code standing on its own in some text, if there is one. */
export function codeIn(text: string): string | undefined {
  return FIRST_CODE.exec(text)?.[1];
}

/** Whether a whole string is an account code, suffix and all. */
export function isAccountCode(text: string): boolean {
  return WHOLE_CODE.test(text);
}
