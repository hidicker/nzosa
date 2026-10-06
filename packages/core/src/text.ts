/**
 * Reading a file whose encoding nobody wrote down.
 *
 * Xero writes its CSV exports in Windows-1252. Read as UTF-8 they come back
 * with replacement characters wherever a dash, a curly quote or an ellipsis
 * appeared, and an account called "Less Accumulated Depreciation - Vehicles"
 * with an en dash arrives unreadable. That name then goes into the chart, onto
 * the balance sheet, and into anything matching this ledger's accounts against
 * the accounting system's.
 *
 * The obvious fallback -- decode again as Windows-1252 -- is not enough on its
 * own. `TextDecoder("windows-1252")` does not reliably map the 0x80 to 0x9F
 * range on every runtime: on the one this was written against, byte 0x96 came
 * back as U+0096, an invisible control character, rather than as an en dash. So
 * that range is mapped here, from the table the encoding standard gives. It is
 * thirty-two characters and it is the whole of the difference between
 * Windows-1252 and Latin-1.
 */

/** Windows-1252, bytes 0x80 to 0x9F. `null` where the encoding defines none. */
const C1: readonly (number | null)[] = [
  0x20ac, null, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021,
  0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, null, 0x017d, null,
  null, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, null, 0x017e, 0x0178,
];

/** Decode bytes as Windows-1252, including the range Latin-1 leaves blank. */
export function decodeWindows1252(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) {
    if (byte >= 0x80 && byte <= 0x9f) {
      const mapped = C1[byte - 0x80];
      // A byte the encoding does not define is kept rather than dropped: it is
      // somebody's data, and losing it silently is worse than showing it oddly.
      out += String.fromCodePoint(mapped ?? byte);
      continue;
    }
    out += String.fromCharCode(byte);
  }
  return out;
}

/**
 * Decode a file, preferring UTF-8 and falling back to Windows-1252.
 *
 * The test is whether a strict UTF-8 read succeeds. Checking the loose read for
 * replacement characters would also work, except that a file may legitimately
 * contain one, and then a perfectly good UTF-8 file gets read as something else.
 */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return decodeWindows1252(bytes);
  }
}
