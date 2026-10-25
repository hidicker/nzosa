import type { Cents } from "./money.js";

/**
 * Documents in another currency than the books'. An invoice in US dollars is
 * worth, in the books, what its rate says on the day it was issued; it is
 * posted at that. The money that pays it arrives in the books' currency at
 * whatever the rate is that day, and the difference is an exchange gain or
 * loss, not still owing. One payment settles such a document in full; paying
 * it in parts is not yet offered.
 */

/** Just the rate, for what needs no more of the document. */
interface Rated {
  rate?: number | undefined;
}

/** The rate a document is posted at, or null for one in the books' own currency. */
export function foreignRate(document: Rated): number | null {
  const rate = document.rate;
  return rate !== undefined && Number.isFinite(rate) && rate > 0 && rate !== 1 ? rate : null;
}

/** An amount of the document's currency in the books', at its rate. */
export function inBooks(document: Rated, cents: Cents): Cents {
  const rate = foreignRate(document);
  return rate === null ? cents : Math.round(cents * rate);
}

/**
 * What a document is worth in the books: each line's net and tax converted on
 * its own, so the posted lines add up to exactly this and no cent is lost to
 * rounding the total separately.
 */
export function bookedTotal(document: Rated & { lines: readonly { net: Cents; tax: Cents }[] }): Cents {
  return document.lines.reduce((sum, line) => sum + inBooks(document, line.net) + inBooks(document, line.tax), 0);
}
