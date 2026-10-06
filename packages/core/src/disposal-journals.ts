import { depreciationSchedule } from "./assets.js";
import type { FixedAsset } from "./assets.js";
import type { Journal } from "./journals.js";
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

/**
 * What each disposed asset sold for, worked back from the disposal journals
 * the other system posted.
 *
 * The register does not carry the proceeds, but a disposal journal carries its
 * outcome -- what was recovered, any capital gain, any loss -- and the book
 * value is our own schedule's. So the proceeds are arithmetic on figures
 * somebody already agreed: book value, plus what was recovered, plus any gain,
 * less any loss. Posted, they give back the same three figures.
 *
 * Only a disposal that still stands is read. A disposal redone is in the report
 * three times -- the first, its reversal, and the one that replaced it -- and
 * the first keeps its ordinary narration: only the reversal says "Reversed",
 * and names the journal it undid. On real books the first attempt at one sale
 * had gone to Other Revenue, and reading it gave proceeds of 790.57 for a sale
 * of 1,130.43. So every journal a reversal names is left out, as is the
 * reversal itself, and of what remains the latest is taken.
 *
 * The accounts are found by code or by name -- 300 Depreciation Recovered, 301
 * Capital Gain, 470 Loss on Sale -- which is how Xero's chart sets them out.
 */
export function proceedsFromDisposalJournals(options: {
  assets: readonly FixedAsset[];
  journals: readonly Journal[];
  /** Only disposals in the years the transactions reach are read. */
  transactions: readonly Transaction[];
}): Map<string, Cents> {
  const { assets, journals, transactions } = options;
  const out = new Map<string, Cents>();
  if (assets.length === 0 || journals.length === 0) return out;

  const undone = new Set<string>();
  for (const journal of journals) {
    const named = /reversal of id\s+(\S+)/i.exec(journal.narration);
    if (named?.[1] !== undefined) undone.add(named[1]);
  }
  const standing = journals.filter(
    (j) =>
      /disposal/i.test(j.narration) &&
      !/^\s*reversed:/i.test(j.narration) &&
      !undone.has(j.id),
  );
  if (standing.length === 0) return out;

  const years = [...new Set(transactions.map((t) => financialYearOf(t.date)))];
  for (const year of years) {
    const schedule = depreciationSchedule(assets, {
      from: `${year - 1}-04-01`,
      to: `${year}-03-31`,
    });
    for (const row of schedule.rows) {
      if (!row.disposedInPeriod) continue;
      const number = row.asset.number;
      // The number standing on its own, so FA-0036 is not found in FA-00361.
      const escaped = number.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const names = new RegExp(`(^|[^A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, "i");
      const journal = standing
        .filter((j) => names.test(j.narration))
        .sort(
          (a, b) =>
            b.date.localeCompare(a.date) ||
            b.id.localeCompare(a.id, undefined, { numeric: true }),
        )[0];
      if (journal === undefined) continue;

      let recovered = 0;
      let gain = 0;
      let loss = 0;
      for (const line of journal.lines) {
        if (line.accountCode === "300" || /depreciation recovered/i.test(line.accountName)) {
          recovered -= line.amount;
        } else if (line.accountCode === "301" || /capital gain/i.test(line.accountName)) {
          gain -= line.amount;
        } else if (
          line.accountCode === "470" ||
          /loss on (the )?(sale|disposal)/i.test(line.accountName)
        ) {
          loss += line.amount;
        }
      }
      out.set(number, row.bookValueAtDisposal + recovered + gain - loss);
    }
  }
  return out;
}
