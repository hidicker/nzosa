/**
 * Choosing between several names for the same account.
 *
 * Accepting a raw label from another system leaves aliases behind: a bare
 * `200` beside the canonical `NB Sales - 200`, both live, both carrying real
 * transactions. Any code that reaches for "the code with 200 in it" and takes
 * the first match gets whichever sorts first, which is the alias — and the
 * account quietly becomes two accounts, splitting its own total.
 *
 * That mistake was made three times in three different places before this
 * function existed. It exists so it can only be made once.
 */

/**
 * A prefix one chart puts in front of every account name: `NB Sales - 200`.
 *
 * It is a house convention rather than anything about accounting, so it lives
 * in one place and is named as such. It is stripped from **both** sides of a
 * comparison, which is what keeps it harmless to a chart that does not use it
 * -- and to one with a real account beginning with those letters. Stripping
 * only the candidate meant `NB Power` could not match itself.
 */
const HOUSE_PREFIX = /^NB\s+/i;

/** An account name with the house prefix and any trailing code removed. */
export function bareAccountName(candidate: string): string {
  return candidate
    .replace(HOUSE_PREFIX, "")
    .replace(/\s*-\s*\d{3,4}\s*$/, "")
    .trim()
    .toLowerCase();
}

/** Rank a candidate name: a real account name beats a bare number. */
function rank(candidate: string): number {
  return (HOUSE_PREFIX.test(candidate) ? 4 : 0) + (/[a-z]{3}/i.test(candidate) ? 2 : 0);
}

/**
 * The best of the known codes carrying this account number.
 *
 * Returns null when nothing does, which is a real answer: an account nothing
 * has ever coded to should be added deliberately, not invented here.
 */
export function canonicalCodeFor(
  accountNumber: string,
  known: readonly string[],
): string | null {
  const digits = accountNumber.trim();
  if (digits === "") return null;
  const escaped = digits.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\b${escaped}\\b`);

  let best: string | null = null;
  let bestRank = -1;
  for (const candidate of known) {
    if (!pattern.test(candidate)) continue;
    const score = rank(candidate);
    if (score > bestRank || (score === bestRank && best !== null && candidate.length > best.length)) {
      best = candidate;
      bestRank = score;
    }
  }
  return best;
}

/**
 * The best known name for an account, by number first and then by name.
 *
 * The number is the stronger evidence: two systems spell `Cost of Goods Sold`
 * differently far more often than they disagree about it being 310.
 */
export function matchAccountName(
  label: string,
  known: readonly string[],
): string | null {
  const digits = /\b(\d{3,4})\b/.exec(label)?.[1];
  if (digits !== undefined) {
    const byNumber = canonicalCodeFor(digits, known);
    if (byNumber !== null) return byNumber;
  }
  // Both sides through the same normaliser. The label being looked for can
  // carry the prefix just as a candidate can, and stripping it from only one
  // of them stopped an account whose name really does begin with those
  // letters from matching itself.
  const wanted = bareAccountName(label.replace(/^\d{3,4}\s*[-\u2013]?\s*/, ""));
  const byName = known.find((candidate) => bareAccountName(candidate) === wanted);
  if (byName !== undefined) return byName;

  // Last: the same words, in a different order.
  //
  // An accounting system writes an account as "code name", this app writes it
  // as "name - code", and both steps above assume the code is a number --
  // which it need not be. A chart with an account coded "Donation" gives
  // "Donation Charitable Donation" on one side and "Charitable Donation -
  // Donation" on the other: no number to match on, and the names do not match
  // either, because each of them contains the other's code. They are plainly
  // the same account, and their words say so.
  //
  // Compared as a sorted set rather than by stripping, because real account
  // names contain the separator that stripping would key on -- "Travel -
  // National", "Entertainment - Non deductible" -- and a rule that cut those
  // in half would do far more damage than this repairs.
  const words = (text: string): string =>
    text
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, " ")
      .trim()
      .split(" ")
      .filter((word) => word !== "")
      .sort()
      .join(" ");
  const asWords = words(label);
  if (asWords === "") return null;
  return known.find((candidate) => words(candidate) === asWords) ?? null;
}
