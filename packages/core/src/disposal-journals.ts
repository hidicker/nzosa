import { depreciationSchedule } from "./assets.js";
import type { FixedAsset } from "./assets.js";
import type { Account } from "./chart.js";
import { financialYearOf } from "./dates.js";
import { bestAccountMatch } from "./depreciation-journals.js";
import { disposalOf } from "./disposal.js";
import type { Cents } from "./money.js";
import { postDisposal } from "./posting.js";
import type { PostedJournal, PostingOptions } from "./posting.js";
import type { Transaction } from "./types.js";

/**
 * Assets that left, posted.
 *
 * An asset register records that something was sold and on what date. It does
 * not record what it fetched, and without that a disposal cannot be posted at
 * all -- the same asset scrapped for nothing and sold for its book value
 * produce entirely different entries. So proceeds are supplied separately, and
 * an asset with none is skipped rather than guessed at.
 *
 * Both halves of the entry are found by name against the asset's own class,
 * the same way the depreciation posting finds them, so a ledger with several
 * classes of asset does not credit one class's depreciation to another's
 * contra account.
 */
export interface DisposalJournalsOptions {
  assets: readonly FixedAsset[];
  /** What each asset fetched, by asset number. Nothing is posted without it. */
  proceeds: Record<string, Cents>;
  /** Only the years the transactions reach are posted. */
  transactions: readonly Transaction[];
  chart: readonly Account[];
  posting?: PostingOptions;
  /** Where the asset and its contra go when the chart names neither. */
  fallbackAssetCode?: string;
  fallbackAccumulatedCode?: string;
}

export function disposalJournals(options: DisposalJournalsOptions): PostedJournal[] {
  const { assets, proceeds, transactions, chart } = options;
  if (assets.length === 0 || Object.keys(proceeds).length === 0) return [];

  const years = [...new Set(transactions.map((t) => financialYearOf(t.date)))];
  const accumulated = chart.filter((a) => /accumulated depreciation/i.test(a.name));
  const fixed = chart.filter(
    (a) => /fixed asset/i.test(a.type) && !/accumulated depreciation/i.test(a.name),
  );

  const out: PostedJournal[] = [];
  for (const year of years) {
    const schedule = depreciationSchedule(assets, {
      from: `${year - 1}-04-01`,
      to: `${year}-03-31`,
    });
    for (const row of schedule.rows) {
      if (!row.disposedInPeriod) continue;
      const sold = proceeds[row.asset.number];
      if (sold === undefined) continue;

      const assetAccount = bestAccountMatch(fixed, row.asset.type);
      const contra = bestAccountMatch(accumulated, row.asset.type);

      const disposal = disposalOf({
        cost: row.asset.cost,
        accumulatedDepreciation: row.asset.cost - row.bookValueAtDisposal,
        proceeds: sold,
      });

      out.push(
        postDisposal(
          {
            assetNumber: row.asset.number,
            assetName: row.asset.name,
            date: row.asset.disposed ?? `${year}-03-31`,
            disposal,
          },
          {
            assetCode: assetAccount?.code ?? options.fallbackAssetCode ?? "730",
            ...(assetAccount?.name ? { assetName: assetAccount.name } : {}),
            accumulatedCode: contra?.code ?? options.fallbackAccumulatedCode ?? "731",
            ...(contra?.name ? { accumulatedName: contra.name } : {}),
          },
          options.posting ?? {},
        ),
      );
    }
  }
  return out;
}
