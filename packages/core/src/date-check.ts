import type { IsoDate } from "./dates.js";

/**
 * Whether a date typed for a document or an entry looks like a slip: a year
 * typed wrong (2025 for 2026), or a date far ahead or long ago. Said as a
 * question, not refused: a bill can be back-dated on purpose, a journal can
 * belong to a year being finished.
 *
 * - A date whose day and month are close to today's but whose year is not,
 *   is most likely this year's: "did you mean ...?".
 * - Otherwise, more than 90 days ahead, or more than two years ago, is
 *   worth a second look (two years back covers last year being finished).
 */
export function dateLooksWrong(date: IsoDate, today: IsoDate): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  const day = (iso: string): number => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;
  const gap = day(date) - day(today);
  const year = Number(date.slice(0, 4));
  const thisYear = Number(today.slice(0, 4));
  if (year !== thisYear) {
    // The same day and month in a nearer year.
    for (const y of [thisYear, thisYear - 1, thisYear + 1]) {
      if (y === year) continue;
      const moved = `${y}${date.slice(4)}`;
      if (!Number.isNaN(day(moved)) && Math.abs(day(moved) - day(today)) <= 45 && Math.abs(gap) > 180) {
        return `${date} is ${describe(gap)}. Did you mean ${moved}?`;
      }
    }
  }
  if (gap > 90) return `${date} is ${describe(gap)}. Check the year.`;
  if (gap < -730) return `${date} is ${describe(gap)}. Check the year.`;
  return null;
}

function describe(days: number): string {
  const ahead = days > 0;
  const n = Math.abs(Math.round(days));
  const months = Math.round(n / 30.44);
  const span = n < 60 ? `${n} days` : months < 24 ? `${months} months` : `${Math.round(n / 365.25)} years`;
  return ahead ? `${span} from today` : `${span} ago`;
}
