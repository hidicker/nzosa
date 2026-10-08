import type { IsoDate } from "./dates.js";
import type { GstReturnResult } from "./gst.js";
import type { PostedJournal } from "./posting.js";

/**
 * Lock dates: periods that are finished, and stay as they were finished.
 *
 * Two, as an accountant keeps them. The GST lock covers periods whose returns
 * have been filed: nothing may change what those returns say, though a
 * coding that leaves the GST alone -- one expense account for another -- is
 * still allowed. The year lock covers years that are signed off: nothing
 * dated in them may change at all.
 *
 * The rule is enforced by what the books say, not by which button was
 * pressed. A change is refused when it moves a figure in a locked period,
 * whichever page made it, so no route into the books is left unguarded --
 * including routes added later.
 */
export interface LockDates {
  /** The last day of the last filed GST period. */
  gst?: IsoDate;
  /** The last day of the last year signed off. */
  year?: IsoDate;
}

/** The figures a lock protects, as text that is equal when the figures are. */
export interface LockedFigures {
  year: string;
  gst: string;
}

/** The later of the two locks, or undefined when neither is set. */
export function lockedThrough(locks: LockDates | undefined): IsoDate | undefined {
  const dates = [locks?.gst, locks?.year].filter((d): d is IsoDate => d !== undefined && d !== "");
  return dates.length === 0 ? undefined : dates.reduce((a, b) => (a > b ? a : b));
}

/** The first day nothing is locked on: the day after the later lock. */
export function firstOpenDay(locks: LockDates | undefined): IsoDate | undefined {
  const through = lockedThrough(locks);
  if (through === undefined) return undefined;
  const next = new Date(`${through}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10) as IsoDate;
}

/**
 * What the locked periods hold.
 *
 * For the year lock, every posting dated on or before it, totalled by day and
 * account: the same books reached by another route -- a journal rebuilt, a
 * line re-imported under a new id -- total the same, and are the same. For
 * the GST lock, every return whose period ends on or before it, box by box.
 */
export function lockedFigures(
  locks: LockDates | undefined,
  journals: readonly PostedJournal[],
  returns: readonly GstReturnResult[],
): LockedFigures {
  let year = "";
  if (locks?.year) {
    const totals = new Map<string, number>();
    for (const journal of journals) {
      if (journal.date > locks.year) continue;
      for (const line of journal.lines) {
        const key = `${journal.date}|${line.accountCode}|${line.accountName}`;
        totals.set(key, (totals.get(key) ?? 0) + line.amount);
      }
    }
    year = [...totals.entries()]
      .filter(([, amount]) => amount !== 0)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, amount]) => `${key}=${amount}`)
      .join("\n");
  }
  let gst = "";
  if (locks?.gst) {
    gst = returns
      .filter((r) => r.period.to <= locks.gst!)
      .sort((a, b) => (a.period.to < b.period.to ? -1 : 1))
      .map((r) => `${r.period.from}..${r.period.to}:${JSON.stringify(r.boxes)}`)
      .join("\n");
  }
  return { year, gst };
}

/**
 * Which lock a change would break, if any, in words to show.
 *
 * Null when the locked figures are the same before and after.
 */
export function lockBroken(
  locks: LockDates | undefined,
  before: LockedFigures,
  after: LockedFigures,
): string | null {
  if (locks?.year && before.year !== after.year) {
    return `That would change the books up to ${locks.year}, which are locked as a finished year.`;
  }
  if (locks?.gst && before.gst !== after.gst) {
    return `That would change a GST return up to ${locks.gst}, which is locked as filed.`;
  }
  return null;
}
