import type { Cents } from "./money.js";
import type { IsoDate } from "./dates.js";

/**
 * Selling a fixed asset, and the three different things the money can be.
 *
 * New Zealand splits the profit on a sale in a way that matters for tax, and a
 * single "gain on disposal" figure loses the distinction:
 *
 *  * **Depreciation recovered** is assessable income. The company claimed
 *    depreciation as an expense; selling for more than book value says some of
 *    that claim was too generous, and Inland Revenue takes it back. It can
 *    never exceed the depreciation actually claimed.
 *  * **A capital gain** is not assessable. Anything above what the asset cost
 *    is a gain on capital, and taxing it would be wrong.
 *  * **A loss on sale** is deductible, and happens when the asset went for less
 *    than its book value.
 *
 * At most two of the three are ever non-zero, and which two depends only on
 * where the proceeds fall against book value and cost.
 *
 *     proceeds  >  cost           recovered = all of it, and a capital gain
 *     book value < proceeds <= cost  recovered = the part above book value
 *     proceeds <= book value      a loss, and nothing recovered
 */

export interface Disposal {
  /** Original cost, before any depreciation. */
  cost: Cents;
  /** Depreciation claimed up to the disposal. */
  accumulatedDepreciation: Cents;
  /** Cost less the depreciation claimed. */
  bookValue: Cents;
  /** What it sold for, excluding GST. */
  proceeds: Cents;
  /** Assessable: depreciation Inland Revenue takes back. */
  depreciationRecovered: Cents;
  /** Not assessable: proceeds above what the asset cost. */
  capitalGain: Cents;
  /** Deductible: book value the sale did not cover. */
  lossOnSale: Cents;
}

/**
 * Work out a disposal from what the asset cost, what was claimed, and what it
 * fetched.
 *
 * All three inputs are positive. Depreciation is what has actually been
 * claimed, which on a set of books that stops depreciating in the year of
 * disposal is the figure at the end of the year before -- that convention lives
 * in the depreciation schedule, and this takes whatever it produced.
 */
export function disposalOf(options: {
  cost: Cents;
  accumulatedDepreciation: Cents;
  proceeds: Cents;
}): Disposal {
  const cost = Math.max(0, Math.round(options.cost));
  const accumulated = Math.max(0, Math.min(Math.round(options.accumulatedDepreciation), cost));
  const proceeds = Math.max(0, Math.round(options.proceeds));
  const bookValue = cost - accumulated;

  // What the sale made over the written-down value. Negative is a loss.
  const over = proceeds - bookValue;

  // Recovery is capped twice: it cannot exceed the depreciation claimed, and it
  // cannot be more than the sale actually made. Uncapped, an asset sold for
  // more than it cost would recover depreciation that was never claimed.
  const depreciationRecovered = Math.max(0, Math.min(over, accumulated));
  const capitalGain = Math.max(0, proceeds - cost);
  const lossOnSale = Math.max(0, -over);

  return {
    cost,
    accumulatedDepreciation: accumulated,
    bookValue,
    proceeds,
    depreciationRecovered,
    capitalGain,
    lossOnSale,
  };
}

export interface DisposalPosting {
  assetNumber: string;
  assetName: string;
  date: IsoDate;
  disposal: Disposal;
}

/**
 * The accounts a disposal journal touches, which a chart names differently.
 *
 * Defaults are the Xero small business codes, which is what this was written
 * against and what most New Zealand charts derived from it use.
 */
export interface DisposalAccounts {
  /** Where the asset itself is carried, e.g. `730`. */
  assetCode: string;
  assetName?: string;
  /** The contra account holding depreciation claimed, e.g. `731`. */
  accumulatedCode: string;
  accumulatedName?: string;
  /** Depreciation recovered, assessable income. Default `300`. */
  recoveredCode?: string;
  recoveredName?: string;
  /** Capital gain, not assessable. Default `301`. */
  capitalGainCode?: string;
  capitalGainName?: string;
  /** Loss on sale, deductible. Default `470`. */
  lossCode?: string;
  lossName?: string;
}
