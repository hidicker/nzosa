import type { IsoDate } from "./dates.js";
import type { GstReturnResult } from "./gst.js";
import type { PostedJournal } from "./posting.js";
import type { EntityModel } from "./entities.js";
import { reportsNetOfGst } from "./entities.js";
import { formatAmount } from "./money.js";

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
 * The furthest each lock has reached, of two: so moving a lock back to make a
 * change leaves on record how far the books had been finished.
 */
export function furthestLocks(a: LockDates | undefined, b: LockDates | undefined): LockDates {
  const later = (x: IsoDate | undefined, y: IsoDate | undefined): IsoDate | undefined =>
    x === undefined || x === "" ? (y === "" ? undefined : y) : y === undefined || y === "" ? x : x > y ? x : y;
  const gst = later(a?.gst, b?.gst);
  const year = later(a?.year, b?.year);
  return { ...(gst !== undefined ? { gst } : {}), ...(year !== undefined ? { year } : {}) };
}

/** A change made in a period that had been locked, as it is reported. */
export interface LockedChange {
  /** When it was made, as a full timestamp. */
  at: string;
  who: string;
  /** What the change was, as History has it. */
  summary: string;
  /** Each figure it moved: an account on a day, or a box of a return. */
  moved: string[];
}


/**
 * What moved between two sets of locked figures, in words: each account on a
 * day whose total changed, and each box of a return that did.
 */
export function lockedDifferences(before: LockedFigures, after: LockedFigures): string[] {
  const out: string[] = [];
  const totals = (text: string): Map<string, number> =>
    new Map(
      text
        .split("\n")
        .filter((l) => l.includes("="))
        .map((l) => {
          const at = l.lastIndexOf("=");
          return [l.slice(0, at), Number(l.slice(at + 1))] as [string, number];
        }),
    );
  const was = totals(before.year);
  const now = totals(after.year);
  for (const key of [...new Set([...was.keys(), ...now.keys()])].sort()) {
    const a = was.get(key) ?? 0;
    const b = now.get(key) ?? 0;
    if (a === b) continue;
    const [day, account] = key.split("|");
    out.push(`${day} ${account}: ${formatAmount(a)} to ${formatAmount(b)}`);
  }
  const returns = (text: string): Map<string, Record<string, number>> =>
    new Map(
      text
        .split("\n")
        .filter((l) => l.includes(":"))
        .map((l) => {
          const at = l.indexOf(":");
          return [l.slice(0, at), JSON.parse(l.slice(at + 1)) as Record<string, number>] as [string, Record<string, number>];
        }),
    );
  const filedWas = returns(before.gst);
  const filedNow = returns(after.gst);
  for (const period of [...new Set([...filedWas.keys(), ...filedNow.keys()])].sort()) {
    const a = filedWas.get(period) ?? {};
    const b = filedNow.get(period) ?? {};
    const boxes = [...new Set([...Object.keys(a), ...Object.keys(b)])]
      .filter((box) => (a[box] ?? 0) !== (b[box] ?? 0))
      .sort((x, y) => Number(x.replace(/\D/g, "")) - Number(y.replace(/\D/g, "")));
    if (boxes.length === 0) continue;
    const [from, to] = period.split("..");
    out.push(
      `GST return ${from} to ${to}: ` +
        boxes.map((box) => `${box.replace(/^box/i, "Box ")} ${formatAmount(a[box] ?? 0)} to ${formatAmount(b[box] ?? 0)}`).join(", "),
    );
  }
  return out;
}
