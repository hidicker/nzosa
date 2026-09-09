import { parseCsvRecords, findHeaderRow } from "./csv.js";
import { ColumnReader } from "./importers/shared.js";
import type { Cents } from "./money.js";
import { parseAmount } from "./money.js";
import type { IsoDate, DateRange } from "./dates.js";
import { parseDate } from "./dates.js";

/**
 * Fixed assets and their depreciation.
 *
 * Depreciation is the one figure in a set of accounts that no bank statement
 * can produce: nothing is paid, and the amount depends on decisions taken when
 * the asset was bought — its cost, the method, the rate. So it comes from an
 * asset register, and this reads the one Xero exports.
 *
 * Two conventions matter, and both were confirmed against a signed schedule
 * rather than assumed:
 *
 *  * **Full month averaging.** An asset bought on the 24th depreciates for the
 *    whole of that month. Months are counted inclusively from the depreciation
 *    start date.
 *
 *  * **An asset disposed of during the year takes no depreciation that year.**
 *    Its remaining book value goes to the disposal instead, where it becomes a
 *    loss on sale, depreciation recovered, or a capital gain. Depreciating it
 *    as well would count the same value twice.
 */

export interface FixedAsset {
  number: string;
  name: string;
  type: string;
  /** `Registered`, `Disposed`, and whatever else the register uses. */
  status: string;
  purchased: IsoDate | null;
  /** When depreciation starts, which can differ from the purchase date. */
  depreciationFrom: IsoDate | null;
  cost: Cents;
  /** Annual rate as a percentage, e.g. 67 for 67%. */
  rate: number;
  method: string;
  averaging: string;
  disposed: IsoDate | null;
}

export interface AssetImportResult {
  assets: FixedAsset[];
  problems: { message: string; line: number }[];
}

const REQUIRED = ["*AssetName", "*AssetNumber"];

/** Read a Xero fixed-asset export. */
export function parseFixedAssets(text: string): AssetImportResult {
  const records = parseCsvRecords(text);
  const header = findHeaderRow(records, REQUIRED);
  if (!header) {
    return {
      assets: [],
      problems: [{ message: "Not a fixed asset export: required columns missing.", line: 0 }],
    };
  }

  const reader = new ColumnReader(header.columns);
  const assets: FixedAsset[] = [];
  const problems: { message: string; line: number }[] = [];

  for (let i = header.index + 1; i < records.length; i += 1) {
    const record = records[i];
    if (!record) continue;
    const cells = reader.at(record.fields);
    const name = cells.get("*AssetName");
    if (name === "") continue;

    const cost = parseAmount(cells.get("PurchasePrice")) ?? 0;
    const rate = Number(cells.get("Book_Rate"));
    const purchased = parseDate(cells.get("PurchaseDate"), { dayFirst: true });
    const from = parseDate(cells.get("Book_DepreciationStartDate"), { dayFirst: true }) ?? purchased;

    if (cost > 0 && from === null) {
      problems.push({ message: `${name}: no depreciation start date`, line: record.line });
    }

    assets.push({
      number: cells.get("*AssetNumber"),
      name,
      type: cells.get("AssetType"),
      status: cells.get("AssetStatus"),
      purchased,
      depreciationFrom: from,
      cost,
      rate: Number.isFinite(rate) ? rate : 0,
      method: cells.get("Book_DepreciationMethod"),
      averaging: cells.get("Book_AveragingMethod"),
      disposed: parseDate(cells.get("DisposalDate"), { dayFirst: true }),
    });
  }

  return { assets, problems };
}

export interface DepreciationRow {
  asset: FixedAsset;
  /** Book value at the start of the period. */
  opening: Cents;
  /** Charged in the period. Zero for anything disposed of during it. */
  depreciation: Cents;
  /** Accumulated depreciation at the end of the period. */
  accumulated: Cents;
  /** Book value at the end. Zero once fully written down or disposed of. */
  closing: Cents;
  /** True when the asset left during this period. */
  disposedInPeriod: boolean;
  /** Book value at the moment of disposal, which the disposal is measured against. */
  bookValueAtDisposal: Cents;
}

export interface DepreciationSchedule {
  period: DateRange;
  rows: DepreciationRow[];
  /** Rows grouped by asset type, the way a signed schedule presents them. */
  byType: { type: string; rows: DepreciationRow[]; depreciation: Cents; closing: Cents }[];
  totalCost: Cents;
  totalOpening: Cents;
  totalDepreciation: Cents;
  totalClosing: Cents;
  /** Book value written off through disposals in the period. */
  disposedBookValue: Cents;
}

/** Whole months from `from` to `to` inclusive, which is what full-month means. */
function monthsInclusive(from: IsoDate, to: IsoDate): number {
  const fy = Number(from.slice(0, 4));
  const fm = Number(from.slice(5, 7));
  const ty = Number(to.slice(0, 4));
  const tm = Number(to.slice(5, 7));
  return (ty - fy) * 12 + (tm - fm) + 1;
}

/** Straight-line depreciation over a number of months, capped at book value. */
function straightLine(cost: Cents, rate: number, months: number, cap: Cents): Cents {
  if (months <= 0 || rate <= 0) return 0;
  return Math.min(cap, Math.round((cost * rate * months) / (100 * 12)));
}

/**
 * Whether an asset depreciates on its reducing value rather than its cost.
 *
 * Inland Revenue publishes both a diminishing value and a straight line rate
 * for every kind of asset, and the register says which was chosen. Most small
 * businesses take diminishing value on plant, vehicles and computers, so
 * reading the column matters: applying the straight line formula to a DV rate
 * writes the asset off years early.
 */
function isDiminishing(asset: FixedAsset): boolean {
  const method = asset.method.trim().toLowerCase();
  return method.startsWith("dv") || method.includes("diminish");
}

/** A date shifted back by whole months, keeping the day. */
function monthsBefore(date: IsoDate, months: number): IsoDate {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7)) - 1 - months;
  const day = date.slice(8, 10);
  const shifted = new Date(Date.UTC(year, month, 1));
  return `${shifted.toISOString().slice(0, 8)}${day}` as IsoDate;
}

/**
 * What an asset has already depreciated before a period opens.
 *
 * Straight line takes the same slice of cost every year, so the whole run can
 * be worked out in one multiplication. Diminishing value cannot: each year is
 * a percentage of what was left after the last one, so the years are walked.
 *
 * The years are anchored on the period being reported, twelve months at a
 * time. That is what makes the opening value here the closing value of the
 * schedule printed last year.
 */
function priorDepreciationOf(asset: FixedAsset, from: IsoDate, period: DateRange): Cents {
  const dayBefore = (date: IsoDate): IsoDate => {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10) as IsoDate;
  };
  const priorEnd = dayBefore(period.from);
  if (from > priorEnd) return 0;

  if (!isDiminishing(asset)) {
    return straightLine(asset.cost, asset.rate, monthsInclusive(from, priorEnd), asset.cost);
  }

  // How many whole years back the first one starts.
  let years = 0;
  while (years < 200 && monthsBefore(period.from, (years + 1) * 12) > from) years += 1;

  let book = asset.cost;
  let accumulated = 0;
  for (let back = years + 1; back >= 1; back -= 1) {
    const start = monthsBefore(period.from, back * 12);
    const end = dayBefore(monthsBefore(period.from, (back - 1) * 12));
    if (end < from) continue;

    const months = monthsInclusive(from > start ? from : start, end > priorEnd ? priorEnd : end);
    const charge = straightLine(book, asset.rate, months, book);
    accumulated += charge;
    book -= charge;
  }
  return accumulated;
}

export function depreciationSchedule(
  assets: readonly FixedAsset[],
  period: DateRange,
): DepreciationSchedule {
  const rows: DepreciationRow[] = [];
  const dayBefore = (date: IsoDate): IsoDate => {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10) as IsoDate;
  };
  const priorEnd = dayBefore(period.from);

  for (const asset of assets) {
    const from = asset.depreciationFrom;
    if (from === null || asset.cost <= 0) continue;
    // Gone before the period opened: it is on an earlier year's schedule.
    if (asset.disposed !== null && asset.disposed < period.from) continue;
    // Not yet owned: it belongs to a later one.
    if (from > period.to) continue;

    const priorDepreciation = priorDepreciationOf(asset, from, period);
    const opening = asset.cost - priorDepreciation;

    const disposedInPeriod = asset.disposed !== null && asset.disposed <= period.to;

    // An asset disposed of during the year takes no depreciation that year;
    // its book value goes to the disposal instead.
    const months = disposedInPeriod
      ? 0
      : monthsInclusive(from > period.from ? from : period.from, period.to);
    // Diminishing value charges on what is left, straight line on what it cost.
    const base = isDiminishing(asset) ? opening : asset.cost;
    const depreciation = straightLine(base, asset.rate, months, opening);

    rows.push({
      asset,
      opening,
      depreciation,
      accumulated: priorDepreciation + depreciation,
      closing: disposedInPeriod ? 0 : opening - depreciation,
      disposedInPeriod,
      bookValueAtDisposal: disposedInPeriod ? opening : 0,
    });
  }

  rows.sort(
    (a, b) =>
      a.asset.type.localeCompare(b.asset.type) ||
      (a.asset.purchased ?? "").localeCompare(b.asset.purchased ?? ""),
  );

  const byType: DepreciationSchedule["byType"] = [];
  for (const row of rows) {
    let group = byType.find((g) => g.type === row.asset.type);
    if (!group) {
      group = { type: row.asset.type, rows: [], depreciation: 0, closing: 0 };
      byType.push(group);
    }
    group.rows.push(row);
    group.depreciation += row.depreciation;
    group.closing += row.closing;
  }

  return {
    period,
    rows,
    byType,
    totalCost: rows.reduce((sum, r) => sum + r.asset.cost, 0),
    totalOpening: rows.reduce((sum, r) => sum + r.opening, 0),
    totalDepreciation: rows.reduce((sum, r) => sum + r.depreciation, 0),
    totalClosing: rows.reduce((sum, r) => sum + r.closing, 0),
    disposedBookValue: rows.reduce((sum, r) => sum + r.bookValueAtDisposal, 0),
  };
}

/** Render a depreciation schedule as CSV. */
export function formatDepreciationSchedule(schedule: DepreciationSchedule, title: string): string {
  const money = (cents: Cents): string => (cents / 100).toFixed(2);
  const rows: string[][] = [
    [title],
    [`For the period ${schedule.period.from} to ${schedule.period.to}`],
    ["Straight line, full month averaging. Assets disposed of in the period take no depreciation."],
    [],
    ["Type", "Asset", "Number", "Purchased", "Cost", "Rate %", "Opening", "Depreciation",
     "Accum dep", "Closing", "Disposed"],
  ];

  for (const group of schedule.byType) {
    for (const row of group.rows) {
      rows.push([
        row.asset.type, row.asset.name, row.asset.number, row.asset.purchased ?? "",
        money(row.asset.cost), String(row.asset.rate), money(row.opening),
        money(row.depreciation), money(row.accumulated), money(row.closing),
        row.asset.disposed ?? "",
      ]);
    }
    rows.push(["", `Total ${group.type}`, "", "", "", "", "",
               money(group.depreciation), "", money(group.closing), ""]);
    rows.push([]);
  }

  rows.push(["", "Total", "", "", money(schedule.totalCost), "", money(schedule.totalOpening),
             money(schedule.totalDepreciation), "", money(schedule.totalClosing), ""]);
  if (schedule.disposedBookValue !== 0) {
    rows.push([]);
    rows.push([`Book value of assets disposed of in the period: ${money(schedule.disposedBookValue)}`]);
    rows.push(["The gain or loss on each needs its sale price, which the asset register does not carry."]);
  }

  return rows
    .map((row) => row.map((cell) => (/[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(","))
    .join("\r\n") + "\r\n";
}
