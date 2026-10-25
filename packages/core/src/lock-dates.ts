import type { IsoDate } from "./dates.js";
import type { GstReturnResult } from "./gst.js";
import type { PostedJournal } from "./posting.js";
import type { EntityModel } from "./entities.js";
import { reportsNetOfGst } from "./entities.js";

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

/**
 * Whether a bank line arriving now has to be held back from a locked period.
 *
 * Anything dated in a finished year is. A line dated only under the GST lock
 * is held when its bank account pays for an entity registered for GST, whose
 * filed return it could change; an unregistered entity's line has no return to
 * change, so it comes straight in. A bank account the entities do not mention
 * is held while any entity is registered, since it cannot be told apart.
 */
export function heldByLock(
  locks: LockDates | undefined,
  model: EntityModel | undefined,
  line: { date: IsoDate; account: string },
): boolean {
  if (locks?.year && line.date <= locks.year) return true;
  if (!locks?.gst || line.date > locks.gst) return false;
  const entities = model?.entities ?? [];
  if (entities.length === 0) return true;
  const serves = model?.banks[line.account] ?? [];
  const whose = serves.length > 0 ? entities.filter((e) => serves.includes(e.id)) : entities;
  return whose.length === 0 || whose.some((e) => reportsNetOfGst(e));
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
        // By code alone: renaming an account changes no figure. The name stands
        // in only where a line has no code.
        const key = `${journal.date}|${line.accountCode !== "" ? line.accountCode : line.accountName}`;
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

/**
 * Each lock at the later of two settings: how far it has ever reached, when
 * one is the furthest it has been and the other is where it is now.
 */
export function laterLocks(a: LockDates | undefined, b: LockDates | undefined): LockDates {
  const later = (x: IsoDate | undefined, y: IsoDate | undefined): IsoDate | undefined => {
    const xs = x === undefined || x === "" ? undefined : x;
    const ys = y === undefined || y === "" ? undefined : y;
    if (xs === undefined) return ys;
    if (ys === undefined) return xs;
    return xs > ys ? xs : ys;
  };
  const gst = later(a?.gst, b?.gst);
  const year = later(a?.year, b?.year);
  return { ...(gst !== undefined ? { gst } : {}), ...(year !== undefined ? { year } : {}) };
}

/**
 * The periods that were locked once and are open now: each lock that has been
 * moved back, at the date it once reached. Null when no lock is behind where
 * it has been.
 */
export function reopenedLocks(now: LockDates | undefined, once: LockDates | undefined): LockDates | null {
  const reached = laterLocks(once, now);
  const open: LockDates = {};
  if (reached.gst !== undefined && (now?.gst === undefined || now.gst === "" || now.gst < reached.gst)) open.gst = reached.gst;
  if (reached.year !== undefined && (now?.year === undefined || now.year === "" || now.year < reached.year)) open.year = reached.year;
  return open.gst === undefined && open.year === undefined ? null : open;
}

/** Whether a change of locks moves either one back, or takes it off. */
export function locksMovedBack(before: LockDates | null | undefined, after: LockDates | null | undefined): boolean {
  return reopenedLocks(after ?? undefined, before ?? undefined) !== null;
}

/** A History entry, as far as the report of changes into locked periods needs one. */
export interface LockHistoryEntry {
  kind: string;
  before: unknown;
  after: unknown;
  /** Set when the change moved a figure in a period that had been locked. */
  intoLocked?: LockDates;
}

/**
 * The History entries a reviewer of locked periods needs: each time a lock was
 * moved back or taken off, and each change that then moved a figure in a
 * period that had been locked. In the order given.
 */
export function changesIntoLocked<E extends LockHistoryEntry>(events: readonly E[]): E[] {
  return events.filter(
    (e) =>
      e.intoLocked !== undefined ||
      (e.kind === "lockDates" && locksMovedBack(e.before as LockDates | null, e.after as LockDates | null)),
  );
}
