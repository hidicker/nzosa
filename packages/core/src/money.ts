/**
 * Money is represented as an integer number of minor units (cents for NZD).
 *
 * Bank exports and spreadsheets round-trip amounts through IEEE floats, which
 * is how the source workbook ended up with values like `-78.08000000000001`
 * and `-195.00000000000003`. Every amount is snapped to an integer here on the
 * way in, so a cent is always exactly a cent and dedupe keys compare equal.
 */

export type Cents = number;

const CURRENCY_MINOR_UNITS: Readonly<Record<string, number>> = {
  JPY: 0,
  KRW: 0,
  VND: 0,
  CLP: 0,
  ISK: 0,
  BHD: 3,
  JOD: 3,
  KWD: 3,
  OMR: 3,
  TND: 3,
};

/** Number of decimal places a currency is quoted in. Defaults to 2. */
export function minorUnits(currency: string): number {
  return CURRENCY_MINOR_UNITS[currency.toUpperCase()] ?? 2;
}

/**
 * Parse a bank-export amount into minor units.
 *
 * Handles thousands separators, currency symbols, unicode minus/dashes,
 * accounting-style `(123.45)` negatives, and trailing `CR`/`DR` markers.
 * Returns `null` for anything that is not recognisably a number, so callers
 * can report a row-level error rather than silently importing a zero.
 */
export function parseAmount(input: unknown, currency = "NZD"): Cents | null {
  if (input === null || input === undefined) return null;

  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    return roundToMinor(input, currency);
  }

  let text = String(input).trim();
  if (text === "") return null;

  // Normalise unicode dashes to ASCII hyphen before anything else.
  text = text.replace(/[\u2010-\u2015\u2212]/g, "-");

  let negative = false;

  // Accounting negatives: (1,234.56)
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1).trim();
  }

  // Trailing or leading CR/DR markers. CR is a credit (money in) on a bank
  // statement, DR a debit (money out) -- only DR flips the sign.
  const crdr = text.match(/^(?:(CR|DR)\s+)?(.*?)(?:\s*(CR|DR))?$/i);
  if (crdr) {
    const marker = (crdr[1] ?? crdr[3] ?? "").toUpperCase();
    if (marker === "DR") negative = !negative;
    if (marker) text = (crdr[2] ?? "").trim();
  }

  if (text.startsWith("-")) {
    negative = !negative;
    text = text.slice(1).trim();
  } else if (text.startsWith("+")) {
    text = text.slice(1).trim();
  }

  // Strip currency symbols, codes and spaces, keeping digits and separators.
  text = text.replace(/[^\d.,]/g, "");
  if (text === "") return null;

  text = normaliseSeparators(text, currency);
  if (!/^\d*\.?\d*$/.test(text) || text === "." || text === "") return null;

  const value = Number(text);
  if (!Number.isFinite(value)) return null;

  const cents = roundToMinor(value, currency);
  return negative ? -cents : cents;
}

/**
 * Decide which of `.` and `,` is the decimal mark.
 *
 * Wise exports in particular can use either depending on the account locale,
 * so this is inferred per value rather than configured globally.
 *
 * The currency is consulted because three digits after a single separator are
 * not always a thousands group. Dinars and rials are written to three places,
 * so `12.345` BHD is twelve and a bit -- reading it as a group of thousands
 * multiplied it by a thousand.
 */
function normaliseSeparators(text: string, currency: string): string {
  const lastDot = text.lastIndexOf(".");
  const lastComma = text.lastIndexOf(",");

  if (lastDot === -1 && lastComma === -1) return text;

  if (lastDot !== -1 && lastComma !== -1) {
    // Whichever comes last is the decimal mark; the other groups thousands.
    return lastDot > lastComma
      ? text.replace(/,/g, "")
      : text.replace(/\./g, "").replace(",", ".");
  }

  const sepIndex = lastDot !== -1 ? lastDot : lastComma;
  const sep = lastDot !== -1 ? "." : ",";
  const decimals = text.length - sepIndex - 1;
  const occurrences = text.split(sep).length - 1;

  // `1.234.567`: more than one separator can only be grouping.
  if (occurrences > 1) return text.split(sep).join("");

  if (decimals === 3) {
    // A currency written to three places means it as a decimal mark.
    if (minorUnits(currency) === 3) return sep === "," ? text.replace(",", ".") : text;

    // Otherwise three digits usually mean a thousands group -- `1,234` -- and
    // that is what a European-formatted export relies on. But grouping puts a
    // separator every three digits from the right, so a group can only ever
    // follow one, two or three digits: `1.234`, `12.345`, `123.456`. Four or
    // more before the separator cannot be a group, and `1234.567` is a
    // decimal, which the old rule multiplied by a thousand.
    if (sepIndex > 3) return sep === "," ? text.replace(",", ".") : text;

    return text.split(sep).join("");
  }

  return sep === "," ? text.replace(",", ".") : text;
}

function roundToMinor(value: number, currency: string): Cents {
  const factor = 10 ** minorUnits(currency);
  // Nudge by an epsilon proportional to the value so that a float that is a
  // hair below the true half-cent (78.07999999999999) still rounds correctly,
  // without dragging genuine half-cents in the wrong direction.
  const scaled = value * factor;
  const nudged = scaled + Math.sign(scaled) * Math.abs(scaled) * Number.EPSILON * 4;
  return Math.round(nudged);
}

/** Render minor units as a plain decimal string, e.g. `-78.08`. */
export function formatAmount(cents: Cents, currency = "NZD"): string {
  const places = minorUnits(currency);
  if (places === 0) return String(cents);
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const factor = 10 ** places;
  const whole = Math.floor(abs / factor);
  const frac = String(abs % factor).padStart(places, "0");
  return `${sign}${whole}.${frac}`;
}
