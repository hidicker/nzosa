import { depreciationSchedule } from "./assets.js";
import type { FixedAsset } from "./assets.js";
import type { Account } from "./chart.js";
import { financialYearOf } from "./dates.js";
import { postDepreciation } from "./posting.js";
import type { PostedJournal } from "./posting.js";
import type { Transaction } from "./types.js";

/**
 * Depreciation, posted year by year against the right contra account.
 *
 * The charge itself is arithmetic the asset register decides. What this adds
 * is where it lands: a chart carries one accumulated depreciation account per
 * class of asset, and the schedule groups by the asset's own type, so the two
 * have to be matched by name.
 *
 * Matched by scoring rather than by first hit, and the reason is a bug this
 * had: "Roasting Equipment" shares the word *equipment* with "Office
 * Equipment", and taking the first account that matched put an entire year of
 * roasting depreciation against the office contra. The distinctive word is
 * the long one, so a longer match counts for more.
 */
export interface DepreciationJournalsOptions {
  assets: readonly FixedAsset[];
  /** Only the years the transactions reach are posted. */
  transactions: readonly Transaction[];
  chart: readonly Account[];
  /** Where the charge goes when the chart has no account named Depreciation. */
  fallbackExpenseCode?: string;
  /**
   * Today, for the year in progress. That year is posted month by month, for
   * the months already finished, rather than as a whole year dated a 31 March
   * still to come: a profit and loss to 30 September then carries six
   * months' depreciation, not twelve. Without it every year is posted whole.
   */
  today?: string;
}

/**
 * The account whose name best fits a class of asset.
 *
 * Used for both halves of an asset posting -- the asset account and the
 * accumulated depreciation contra -- because the question is the same one and
 * getting two answers to it is how a class's depreciation ends up credited
 * against another class's contra.
 */
export function bestAccountMatch(
  candidates: readonly Account[],
  type: string,
): Account | undefined {
  const words = type.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  let best = 0;
  let chosen = candidates[0];
  for (const account of candidates) {
    const name = account.name.toLowerCase();
    const score = words.reduce((sum, w) => (name.includes(w) ? sum + w.length : sum), 0);
    if (score > best) {
      best = score;
      chosen = account;
    }
  }
  return chosen;
}

export function depreciationJournals(options: DepreciationJournalsOptions): PostedJournal[] {
  const { assets, transactions, chart } = options;
  if (assets.length === 0) return [];

  const years = [...new Set(transactions.map((t) => financialYearOf(t.date)))];
  const accumulated = chart.filter((a) => /accumulated depreciation/i.test(a.name));
  const expense = chart.find((a) => /^depreciation$/i.test(a.name.trim()));

  const post = (type: string, amount: number, date: string): PostedJournal => {
    const contra = bestAccountMatch(accumulated, type);
    return postDepreciation({
      name: type,
      expenseCode: expense?.code ?? options.fallbackExpenseCode ?? "416",
      expenseName: expense?.name ?? "Depreciation",
      accumulatedCode: contra?.code ?? "",
      accumulatedName: contra?.name ?? `Less Accumulated Depreciation — ${type}`,
      amount,
      date,
    });
  };
  const byType = (to: string, year: number): Map<string, number> =>
    new Map(
      depreciationSchedule(assets, { from: `${year - 1}-04-01`, to }).byType.map((g) => [g.type, g.depreciation]),
    );

  const out: PostedJournal[] = [];
  const current = options.today === undefined ? null : financialYearOf(options.today);
  for (const year of years) {
    if (year === current && options.today !== undefined) {
      // Month by month, each the change in the year's depreciation to date,
      // so the months always add up to what the schedule says for them --
      // and an asset sold part-way through the year, which takes none that
      // year, has what was charged taken back in the month it went.
      let before = new Map<string, number>();
      for (const end of monthEndsOfYear(year)) {
        if (end >= options.today) break;
        const now = byType(end, year);
        for (const type of new Set([...now.keys(), ...before.keys()])) {
          const change = (now.get(type) ?? 0) - (before.get(type) ?? 0);
          if (change !== 0) out.push(post(type, change, end));
        }
        before = now;
      }
      continue;
    }
    for (const [type, amount] of byType(`${year}-03-31`, year)) {
      if (amount !== 0) out.push(post(type, amount, `${year}-03-31`));
    }
  }
  return out;
}

/** The last day of each month of a financial year, April to March. */
function monthEndsOfYear(year: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < 12; i++) {
    const month = ((3 + i) % 12) + 1; // 4..12, then 1..3
    const y = month >= 4 ? year - 1 : year;
    const last = new Date(Date.UTC(y, month, 0)).getUTCDate();
    out.push(`${y}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}`);
  }
  return out;
}
