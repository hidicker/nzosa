import type { IsoDate } from "./dates.js";
import type { FiledBoxes, FiledReturn } from "./filed-returns.js";
import type { GstReturnResult } from "./gst.js";
import type { Cents } from "./money.js";

/**
 * A filed GST return, recorded without an accounting system's workbook.
 *
 * Filed returns used to arrive one way: the GST return spreadsheets Xero
 * exports. Anyone who files from these books, or from somewhere else, had no
 * way to say what was filed, so the reconciliation had nothing to compare and
 * the page stayed empty. Two ways in, neither needing a file:
 *
 *  * The boxes typed from the return as filed -- the ones a person reads off
 *    myIR -- with the rest worked out the way the form works them out.
 *  * The return these books produce for a period, recorded as the one filed,
 *    for anyone filing straight from here.
 */

/**
 * The boxes a person types from a filed return.
 *
 * Box 8 and Box 12 are optional: worked out as three twenty-thirds when left
 * out, taken as typed when given, because a return as filed carries its own
 * rounding and the comparison is with the figure that was filed.
 */
export interface EnteredGstBoxes {
  box5: Cents;
  box6: Cents;
  box9: Cents;
  box11: Cents;
  box13: Cents;
  box8?: Cents;
  box12?: Cents;
}

/** Every box of a GST101A, from the ones typed. */
export function gstBoxesFrom(entered: EnteredGstBoxes): FiledBoxes {
  const box7 = entered.box5 - entered.box6;
  const box8 = entered.box8 ?? Math.round((box7 * 3) / 23);
  const box10 = box8 + entered.box9;
  const box12 = entered.box12 ?? Math.round((entered.box11 * 3) / 23);
  const box14 = box12 + entered.box13;
  return {
    box5: entered.box5,
    box6: entered.box6,
    box7,
    box8,
    box9: entered.box9,
    box10,
    box11: entered.box11,
    box12,
    box13: entered.box13,
    box14,
    box15: box10 - box14,
  };
}

/** A filed return from its boxes, carrying the figure the comparison is made on. */
export function filedReturnFromBoxes(options: {
  periodStart: IsoDate | null;
  periodEnd: IsoDate;
  basis: string;
  status: string;
  boxes: FiledBoxes;
}): FiledReturn {
  return {
    periodEnd: options.periodEnd,
    periodStart: options.periodStart,
    basis: options.basis,
    status: options.status,
    boxes: options.boxes,
    lines: [],
    // Box 8 less Box 12: the period's own trading, as every filed return is
    // compared, so late claims in Boxes 9 and 13 are not read as a difference.
    core: options.boxes.box8 - options.boxes.box12,
  };
}

/**
 * The return these books produce for a period, recorded as the one filed.
 *
 * Kept as it stands on the day it is recorded. The books will move afterwards
 * -- a coding corrected, a statement imported late -- and the reconciliation
 * then shows exactly how far, which is the point of keeping it.
 */
export function filedReturnFromOurs(result: GstReturnResult, status = "Filed from these books"): FiledReturn {
  const b = result.boxes;
  const basis = String(result.basis);
  return filedReturnFromBoxes({
    periodStart: result.period.from,
    periodEnd: result.period.to,
    basis: `${basis.charAt(0).toUpperCase()}${basis.slice(1)} basis`,
    status,
    boxes: {
      box5: b.box5,
      box6: b.box6,
      box7: b.box7,
      box8: b.box8,
      box9: b.box9,
      box10: b.box10,
      box11: b.box11,
      box12: b.box12,
      box13: b.box13,
      box14: b.box14,
      box15: b.box15,
    },
  });
}
