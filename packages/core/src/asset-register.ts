import type { FixedAsset } from "./assets.js";

/**
 * The asset register kept here, rather than only read from another system.
 *
 * The register used to arrive one way: a fixed asset export from Xero. Anyone
 * without Xero had no way to record a van, and anyone with it had to go back
 * to Xero to add a laptop. So the register is written as well as read, in the
 * same shape the importer takes -- the template somebody fills in on a sheet,
 * the export of what is held, and a Xero export all load the same way, and a
 * register exported and loaded again is the register it was.
 */

/** The columns of a Xero fixed asset export, in its order. */
export const FIXED_ASSET_COLUMNS = [
  "*AssetName",
  "*AssetNumber",
  "AssetStatus",
  "PurchaseDate",
  "PurchasePrice",
  "AssetType",
  "Description",
  "TrackingCategory1",
  "TrackingOption1",
  "TrackingCategory2",
  "TrackingOption2",
  "SerialNumber",
  "WarrantyExpiry",
  "Book_DepreciationStartDate",
  "Book_CostLimit",
  "Book_ResidualValue",
  "Book_DepreciationMethod",
  "Book_AveragingMethod",
  "Book_Rate",
  "Book_EffectiveLife",
  "Book_OpeningBookAccumulatedDepreciation",
  "Book_BookValue",
  "AccumulatedDepreciation",
  "InvestmentBoost",
  "DepreciationToDate",
  "DisposalDate",
] as const;

/** The methods the depreciation engine works, as a register writes them. */
export const DEPRECIATION_METHODS: readonly { value: string; label: string }[] = [
  { value: "Diminishing Value", label: "Diminishing value" },
  { value: "Straight Line", label: "Straight line" },
  { value: "No Depreciation", label: "No depreciation" },
];

/** Whether a method charges nothing at all. */
export function isNoDepreciation(method: string): boolean {
  return /^\s*(no\b|none\b)/i.test(method);
}

const dayFirst = (iso: string | null): string =>
  iso === null ? "" : `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const quote = (value: string): string => `"${value.replace(/"/g, '""')}"`;

/**
 * A register as a fixed asset export: the file the importer reads back.
 *
 * Dates are written day first and amounts to the cent, as the export writes
 * them. Columns this register does not hold are left empty rather than
 * invented.
 */
export function formatFixedAssets(assets: readonly FixedAsset[]): string {
  const rows = assets.map((asset) => {
    const cells: Partial<Record<(typeof FIXED_ASSET_COLUMNS)[number], string>> = {
      "*AssetName": asset.name,
      "*AssetNumber": asset.number,
      AssetStatus: asset.disposed !== null ? "Disposed" : asset.status.trim() || "Registered",
      PurchaseDate: dayFirst(asset.purchased),
      PurchasePrice: (asset.cost / 100).toFixed(2),
      AssetType: asset.type,
      Book_DepreciationStartDate: dayFirst(asset.depreciationFrom),
      Book_DepreciationMethod: asset.method,
      Book_AveragingMethod: asset.averaging.trim() || "Full Month",
      Book_Rate: String(asset.rate),
      DisposalDate: dayFirst(asset.disposed),
    };
    return FIXED_ASSET_COLUMNS.map((column) => quote(cells[column] ?? "")).join(",");
  });
  return [FIXED_ASSET_COLUMNS.join(","), ...rows].join("\r\n") + "\r\n";
}

/**
 * A register template: the columns, and one invented asset showing how they
 * are filled in. Delete the example row and add your own.
 */
export function fixedAssetTemplate(): string {
  return formatFixedAssets([
    {
      number: "FA-0001",
      name: "Delivery van (example -- replace with your own)",
      type: "Motor Vehicles",
      status: "Registered",
      purchased: "2025-07-01",
      depreciationFrom: "2025-07-01",
      cost: 2_400_000,
      rate: 30,
      method: "Diminishing Value",
      averaging: "Full Month",
      disposed: null,
    },
  ]);
}

/**
 * The number the next asset should take.
 *
 * Follows the register's own pattern -- prefix and width from its highest
 * number -- so FA-0012 is followed by FA-0013, and a register numbered some
 * other way carries on in its own style.
 */
export function nextAssetNumber(assets: readonly Pick<FixedAsset, "number">[]): string {
  let prefix = "FA-";
  let width = 4;
  let highest = 0;
  for (const { number } of assets) {
    const match = /^(.*?)(\d+)$/.exec(number.trim());
    if (!match?.[2]) continue;
    const value = Number(match[2]);
    if (value >= highest) {
      highest = value;
      prefix = match[1] ?? prefix;
      width = match[2].length;
    }
  }
  return `${prefix}${String(highest + 1).padStart(width, "0")}`;
}

/**
 * Everything stopping an asset being saved, or an empty list.
 *
 * `replacing` is the number of the asset being edited, so an asset keeping its
 * own number is not told the number is taken.
 */
export function fixedAssetProblems(
  asset: FixedAsset,
  register: readonly FixedAsset[],
  replacing?: string,
): string[] {
  const problems: string[] = [];
  if (asset.name.trim() === "") problems.push("give the asset a name");
  if (asset.number.trim() === "") {
    problems.push("give it an asset number");
  } else if (register.some((other) => other.number === asset.number && other.number !== replacing)) {
    problems.push(`${asset.number} is already another asset's number`);
  }
  if (asset.purchased === null) problems.push("give the date it was bought");
  if (!(asset.cost > 0)) problems.push("give what it cost");
  if (!isNoDepreciation(asset.method) && !(asset.rate > 0 && asset.rate <= 100)) {
    problems.push("give a depreciation rate above 0 and up to 100 percent");
  }
  if (asset.purchased !== null && asset.depreciationFrom !== null && asset.depreciationFrom < asset.purchased) {
    problems.push("depreciation cannot start before the asset was bought");
  }
  if (asset.purchased !== null && asset.disposed !== null && asset.disposed < asset.purchased) {
    problems.push("it cannot be disposed of before it was bought");
  }
  return problems;
}
