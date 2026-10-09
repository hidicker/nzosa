import type { IsoDate } from "./dates.js";

/**
 * Looking after a rental property, beside its books: the jobs and issues
 * outstanding, the ones that come round again (the heat pump serviced every
 * year), and two questions a landlord is asked -- does it meet the Healthy
 * Homes standards, and is it insured.
 *
 * Nothing here posts. A repair is still paid from the bank and coded there;
 * this is the list of what needs doing.
 */

export type CareRepeat = "monthly" | "quarterly" | "six-monthly" | "yearly";

export interface CareTask {
  id: string;
  /** What needs doing: "Heat pump service", "Leaking tap in the laundry". */
  what: string;
  /** When it is due, if it has a date. */
  due?: IsoDate | undefined;
  /** Comes round again: ticking it done moves it on to its next due date. */
  repeat?: CareRepeat | undefined;
  /** The day it was last done. A job that does not repeat is finished then. */
  done?: IsoDate | undefined;
}

export interface PropertyCare {
  tasks: CareTask[];
  /** Meets the Healthy Homes standards, and when that was last checked. */
  healthyHomes?: { current: boolean; checked?: IsoDate | undefined } | undefined;
  /** The property is insured, and when that was last checked. */
  insured?: { current: boolean; checked?: IsoDate | undefined } | undefined;
}

export const REPEAT_MONTHS: Record<CareRepeat, number> = {
  monthly: 1,
  quarterly: 3,
  "six-monthly": 6,
  yearly: 12,
};

/** The same day so many months on, or the month's last day where it has none. */
export function monthsAfter(date: IsoDate, months: number): IsoDate {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const month = m - 1 + months;
  const year = y + Math.floor(month / 12);
  const mm = (month % 12) + 1;
  const last = new Date(Date.UTC(year, mm, 0)).getUTCDate();
  return `${year}-${String(mm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/**
 * A job ticked done on a day. One that does not repeat is finished. One that
 * does comes round again a period after the date it was due -- not after the
 * day it was done, so an annual service done a fortnight late is still due in
 * the same month next year rather than drifting later every year. Where it had
 * no due date, a period after it was done.
 */
export function completeTask(task: CareTask, on: IsoDate): CareTask {
  if (task.repeat === undefined) return { ...task, done: on };
  const months = REPEAT_MONTHS[task.repeat];
  let next = monthsAfter(task.due ?? on, months);
  // Done well after it fell due, more than a period behind: the next one is
  // a period from when it was actually done, not one already gone by.
  while (next <= on) next = monthsAfter(next, months);
  return { ...task, done: on, due: next };
}

/** Whether a job is still to do: not finished, or repeating. */
export function taskOpen(task: CareTask): boolean {
  return task.repeat !== undefined || task.done === undefined;
}

/** Jobs still to do whose due date has passed. */
export function overdueTasks(care: PropertyCare | undefined, asAt: IsoDate): CareTask[] {
  return (care?.tasks ?? []).filter((t) => taskOpen(t) && t.due !== undefined && t.due < asAt);
}
