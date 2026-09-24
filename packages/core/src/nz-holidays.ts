import type { IsoDate } from "./dates.js";

/**
 * New Zealand's national public holidays, and the next working day after a
 * date.
 *
 * For tax due dates. Inland Revenue: "If a due date falls on a weekend or
 * public holiday you can file or pay on the next business day without
 * incurring penalties" (IR328). The 28th of a month lands on a weekend two or
 * three times a year, and on a holiday now and then -- Labour Day was 28
 * October 2024, Matariki 28 June 2024.
 *
 * National holidays only. Regional anniversary days are not days a national
 * tax deadline moves for.
 */

/**
 * Matariki, as fixed by the Te Kāhui o Matariki Public Holiday Act 2022
 * (dates as published by Te Papa and MBIE). It follows the lunar calendar,
 * so it is a table rather than a rule; a year past the table has no Matariki
 * here, which moves no deadline rather than moving one by a guess.
 */
const MATARIKI: Readonly<Record<number, string>> = {
  2022: "06-24", 2023: "07-14", 2024: "06-28", 2025: "06-20", 2026: "07-10",
  2027: "06-25", 2028: "07-14", 2029: "07-06", 2030: "06-21", 2031: "07-11",
  2032: "07-02", 2033: "06-24", 2034: "07-07", 2035: "06-29", 2036: "07-18",
  2037: "07-10", 2038: "06-25", 2039: "07-15", 2040: "07-06", 2041: "07-19",
  2042: "07-11", 2043: "07-03", 2044: "06-24", 2045: "07-07", 2046: "06-29",
  2047: "07-19", 2048: "07-03", 2049: "06-25", 2050: "07-15", 2051: "06-30",
  2052: "06-21",
};

const pad = (n: number): string => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number): IsoDate => `${y}-${pad(m)}-${pad(d)}`;

/** Day of the week, 0 Sunday to 6 Saturday, without time zones. */
function weekday(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function addDays(date: IsoDate, days: number): IsoDate {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Easter Sunday, by the anonymous Gregorian algorithm. */
function easterSunday(y: number): { m: number; d: number } {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { m: month, d: day };
}

/** The nth Monday of a month (n from 1). */
function nthMonday(y: number, m: number, n: number): number {
  const first = weekday(y, m, 1);
  const firstMonday = 1 + ((8 - first) % 7);
  return firstMonday + 7 * (n - 1);
}

/**
 * Every national public holiday observed in a calendar year, as dates.
 *
 * Mondayised as the Holidays Act 2003 has it: Waitangi and Anzac move to the
 * Monday when they fall on a weekend; Christmas, Boxing Day and the two New
 * Year days move to the next weekdays not already holidays.
 */
export function nzPublicHolidays(year: number): Set<IsoDate> {
  const days = new Set<IsoDate>();
  const add = (m: number, d: number): void => {
    days.add(iso(year, m, d));
  };

  // Two consecutive days that each move past the weekend and past each other.
  const pair = (m: number, d: number): void => {
    const w = weekday(year, m, d);
    if (w === 6) {
      add(m, d + 2); // Saturday -> Monday
      add(m, d + 3); // and the day after -> Tuesday
    } else if (w === 5) {
      add(m, d); // Friday
      add(m, d + 3); // the Saturday one -> Monday
    } else if (w === 0) {
      add(m, d + 2); // Sunday -> Tuesday, the Monday is the second day
      add(m, d + 1);
    } else {
      add(m, d);
      add(m, d + 1);
    }
  };

  pair(1, 1); // New Year's Day, Day after New Year's Day
  pair(12, 25); // Christmas Day, Boxing Day

  for (const [m, d] of [
    [2, 6], // Waitangi Day
    [4, 25], // Anzac Day
  ] as const) {
    const w = weekday(year, m, d);
    add(m, w === 6 ? d + 2 : w === 0 ? d + 1 : d);
  }

  const easter = easterSunday(year);
  const sunday = iso(year, easter.m, easter.d);
  days.add(addDays(sunday, -2)); // Good Friday
  days.add(addDays(sunday, 1)); // Easter Monday

  add(6, nthMonday(year, 6, 1)); // King's Birthday
  add(10, nthMonday(year, 10, 4)); // Labour Day

  const matariki = MATARIKI[year];
  if (matariki !== undefined) days.add(`${year}-${matariki}`);

  return days;
}

/** Whether a date is a weekday that is not a national public holiday. */
export function isWorkingDay(date: IsoDate): boolean {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const w = weekday(y, m, d);
  if (w === 0 || w === 6) return false;
  return !nzPublicHolidays(y).has(date);
}

/** The date itself if it is a working day, otherwise the next one after it. */
export function nextWorkingDay(date: IsoDate): IsoDate {
  let day = date;
  for (let guard = 0; guard < 14 && !isWorkingDay(day); guard += 1) day = addDays(day, 1);
  return day;
}
