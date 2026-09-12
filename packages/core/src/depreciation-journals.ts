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
}

/** Which accumulated-depreciation account a class of asset belongs against. */
export function contraAccountFor(
  type: string,
  accumulated: readonly Account[],
): Account | undefined {
  const words = type.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  let best = 0;
  let chosen = accumulated[0];
  for (const account of accumulated) {
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

  const out: PostedJournal[] = [];
  for (const year of years) {
    const schedule = depreciationSchedule(assets, {
      from: `${year - 1}-04-01`,
      to: `${year}-03-31`,
    });
    for (const group of schedule.byType) {
      if (group.depreciation === 0) continue;
      const contra = contraAccountFor(group.type, accumulated);
      out.push(
        postDepreciation({
          name: group.type,
          expenseCode: expense?.code ?? options.fallbackExpenseCode ?? "416",
          expenseName: expense?.name ?? "Depreciation",
          accumulatedCode: contra?.code ?? "",
          accumulatedName: contra?.name ?? `Less Accumulated Depreciation — ${group.type}`,
          amount: group.depreciation,
          date: `${year}-03-31`,
        }),
      );
    }
  }
  return out;
}
