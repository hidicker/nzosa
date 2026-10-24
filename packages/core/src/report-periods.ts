/**
 * The stretches of a financial year a report can be run for.
 *
 * Reports ran for a whole financial year and nothing else, which answers
 * the accountant at year end and nobody in the middle of it: how did last
 * month go, how is this quarter against the same quarter last year. A period
 * here is always inside one financial year -- the year still decides which
 * return, which opening balances and which lock a report is read against --
 * and is named by what it is: the whole year, the year so far, a quarter, a
 * month, or two dates somebody chose.
 */

import type { DateRange, IsoDate } from "./dates.js";

export type PeriodChoice =
  | { kind: "year" }
  | { kind: "ytd" }
  | { kind: "quarter"; index: 1 | 2 | 3 | 4 }
  | { kind: "month"; index: number }
  | { kind: "custom"; from: IsoDate; to: IsoDate };

export interface PeriodOption {
  /** What the choice is called in a list: "Whole year", "Q2 (Jul–Sep 2025)", "August 2025". */
  label: string;
  /** The choice, written as a value for a select: "year", "ytd", "q2", "m05", "custom". */
  value: string;
  range: DateRange;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = MONTHS.map((m) => m.slice(0, 3));

function parts(date: string): [number, number, number] {
  const [y = "0", m = "1", d = "1"] = date.split("-");
  return [Number(y), Number(m), Number(d)];
}

function iso(year: number, month: number, day: number): IsoDate {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` as IsoDate;
}

function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The first day of the month `count` months after the month `date` is in. */
function monthStart(date: string, count: number): IsoDate {
  const [y, m] = parts(date);
  const index = y * 12 + (m - 1) + count;
  return iso(Math.floor(index / 12), (index % 12) + 1, 1);
}

/** The last day of the month a date is in. */
function monthEnd(date: string): IsoDate {
  const [y, m] = parts(date);
  return iso(y, m, daysIn(y, m));
}

/**
 * The financial year's months, in order: each one's first and last day.
 * A year that is not twelve whole months (a first year, cut short) has the
 * months it has, the first and last cut to the year.
 */
export function yearMonths(year: DateRange): DateRange[] {
  const months: DateRange[] = [];
  for (let start = monthStart(year.from, 0); start <= year.to; start = monthStart(start, 1)) {
    const from = start < year.from ? year.from : start;
    const end = monthEnd(start);
    months.push({ from, to: end > year.to ? year.to : end });
  }
  return months;
}

/** The choice a select's value stands for, or the whole year for one it does not know. */
export function periodChoiceFrom(value: string, custom?: { from: string; to: string }): PeriodChoice {
  if (value === "ytd") return { kind: "ytd" };
  const quarter = /^q([1-4])$/.exec(value);
  if (quarter) return { kind: "quarter", index: Number(quarter[1]) as 1 | 2 | 3 | 4 };
  const month = /^m(\d{2})$/.exec(value);
  if (month) return { kind: "month", index: Number(month[1]) };
  if (value === "custom" && custom !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(custom.from) && /^\d{4}-\d{2}-\d{2}$/.test(custom.to)) {
    return { kind: "custom", from: custom.from as IsoDate, to: custom.to as IsoDate };
  }
  return { kind: "year" };
}

/**
 * The dates a choice covers, inside the year. A month or quarter the year does
 * not have, or chosen dates that fall outside it, come back cut to the year;
 * dates the wrong way round are put the right way.
 */
export function periodRange(year: DateRange, choice: PeriodChoice, today: IsoDate): DateRange {
  const clamp = (range: DateRange): DateRange => {
    const from = range.from < year.from ? year.from : range.from > year.to ? year.to : range.from;
    const to = range.to > year.to ? year.to : range.to < year.from ? year.from : range.to;
    return from <= to ? { from, to } : { from: to, to: from };
  };
  const months = yearMonths(year);
  switch (choice.kind) {
    case "year":
      return year;
    case "ytd":
      return clamp({ from: year.from, to: today });
    case "quarter": {
      const first = months[(choice.index - 1) * 3];
      const last = months[Math.min(choice.index * 3, months.length) - 1];
      return first === undefined || last === undefined ? year : clamp({ from: first.from, to: last.to });
    }
    case "month": {
      const month = months[choice.index - 1];
      return month === undefined ? year : month;
    }
    case "custom":
      return clamp(choice.from <= choice.to ? { from: choice.from, to: choice.to } : { from: choice.to, to: choice.from });
  }
}

/** "August 2025", "Jul–Sep 2025", "1 Apr 2025 to 15 Oct 2025": a range in words. */
export function periodSaid(range: DateRange): string {
  const [fy, fm, fd] = parts(range.from);
  const [ty, tm, td] = parts(range.to);
  const wholeMonths = fd === 1 && td === daysIn(ty, tm);
  if (wholeMonths && fy === ty && fm === tm) return `${MONTHS[fm - 1]} ${fy}`;
  if (wholeMonths) {
    return fy === ty ? `${SHORT[fm - 1]}–${SHORT[tm - 1]} ${ty}` : `${SHORT[fm - 1]} ${fy}–${SHORT[tm - 1]} ${ty}`;
  }
  return `${fd} ${SHORT[fm - 1]} ${fy} to ${td} ${SHORT[tm - 1]} ${ty}`;
}

/** Every choice for a year, for a select: the year, the year so far, its quarters and months, and chosen dates. */
export function periodOptions(year: DateRange, today: IsoDate): PeriodOption[] {
  const options: PeriodOption[] = [{ label: "Whole year", value: "year", range: year }];
  if (today >= year.from && today < year.to) {
    options.push({ label: `Year to date (to ${periodSaid({ from: today, to: today }).split(" to ")[0]})`, value: "ytd", range: { from: year.from, to: today } });
  }
  const months = yearMonths(year);
  for (let q = 1; q <= 4 && (q - 1) * 3 < months.length; q++) {
    const range = periodRange(year, { kind: "quarter", index: q as 1 | 2 | 3 | 4 }, today);
    options.push({ label: `Q${q} (${periodSaid(range)})`, value: `q${q}`, range });
  }
  months.forEach((range, i) => options.push({ label: periodSaid(range), value: `m${String(i + 1).padStart(2, "0")}`, range }));
  options.push({ label: "Choose dates…", value: "custom", range: year });
  return options;
}

/**
 * The same stretch a year earlier: a month's same month, a quarter's same
 * quarter, any other dates moved back a year (29 February to the 28th).
 */
export function yearEarlier(range: DateRange): DateRange {
  const back = (date: string, end: boolean): IsoDate => {
    const [y, m, d] = parts(date);
    // A month's last day stays its month's last day: 29 Feb 2024 back to 28 Feb 2023,
    // and 28 Feb 2025 (the end of February) back to 29 Feb 2024.
    const last = d === daysIn(y, m);
    const day = end && last ? daysIn(y - 1, m) : Math.min(d, daysIn(y - 1, m));
    return iso(y - 1, m, day);
  };
  return { from: back(range.from, false), to: back(range.to, true) };
}
