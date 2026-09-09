import type { Cents } from "./money.js";
import type { IsoDate } from "./dates.js";

/**
 * A difference between our figures and a filed return that is understood and
 * accepted.
 *
 * Not every difference is an error to chase. A filed return can be wrong; a
 * treatment can be a genuine disagreement; a timing difference can be correct
 * on both sides. Once someone has looked and decided, that decision is worth
 * more than the investigation that produced it -- otherwise the same few cents
 * get re-derived from scratch every time the comparison runs, and a real new
 * difference hides among the ones already explained.
 *
 * A note never changes a figure. It records why two figures differ, so the
 * unexplained remainder is the only thing left to look at.
 */
export interface VarianceNote {
  /** The GST period concerned, by its end date. */
  period: IsoDate;
  /**
   * How much of the difference this explains, in minor units.
   *
   * Signed the same way as the comparison: ours minus theirs. A note that
   * explains 2.61 of a 2.61 difference leaves nothing outstanding.
   */
  amount: Cents;
  /** What differs, and which side is right. */
  reason: string;
  /** When the decision was made. */
  at: IsoDate;
}

/** How much of a period's difference has been explained. */
export function explained(notes: readonly VarianceNote[], period: IsoDate): Cents {
  let total = 0;
  for (const note of notes) {
    if (note.period === period) total += note.amount;
  }
  return total;
}

/**
 * What is left of a difference once the accepted ones are taken out.
 *
 * This is the number worth watching. Zero means every difference in the period
 * has been looked at and decided, which is a much stronger statement than the
 * two totals happening to agree.
 */
export function unexplained(
  notes: readonly VarianceNote[],
  period: IsoDate,
  difference: Cents,
): Cents {
  return difference - explained(notes, period);
}
