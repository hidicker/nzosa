import { findHeaderRow, parseCsvRecords, spreadsheetCell } from "./csv.js";
import { ColumnReader } from "./importers/shared.js";
import type { Item } from "./items.js";
import { itemKey } from "./items.js";
import { parseAmount } from "./money.js";

/**
 * Products and services as CSV: written out to keep or edit in a spreadsheet,
 * and read back -- or a list from elsewhere read in -- with a dry run first.
 * Matched by name; an item missing from the file is left as it is.
 */

export const ITEM_COLUMNS = ["Name", "Kind", "Description", "Price", "Account", "Unit cost", "Reorder point", "Taxable", "Active"] as const;

const money = (cents: number | undefined): string => (cents === undefined ? "" : (cents / 100).toFixed(2));

export function formatItemsCsv(items: readonly Item[]): string {
  const rows = [ITEM_COLUMNS.join(",")];
  for (const i of items) {
    rows.push(
      [
        i.name,
        i.kind,
        i.description ?? "",
        money(i.price),
        i.accountCode ?? "",
        money(i.unitCost),
        i.reorderPoint === undefined ? "" : String(i.reorderPoint),
        i.taxable === false ? "no" : "yes",
        i.active === false ? "no" : "yes",
      ]
        .map(spreadsheetCell)
        .join(","),
    );
  }
  return `${rows.join("\r\n")}\r\n`;
}

/** An item as read from a file, before it has an id. */
export type ItemRow = Omit<Item, "id"> & {
  /** Whether the file said the kind, rather than it being guessed from a unit cost. */
  kindGiven?: boolean;
};

const NO = /^(no|n|false|0|inactive)$/i;
const YES = /^(yes|y|true|1|active)$/i;

/** A yes or a no in a cell; anything else is unsaid. */
function yesNo(text: string): boolean | undefined {
  if (NO.test(text.trim())) return false;
  if (YES.test(text.trim())) return true;
  return undefined;
}

export function parseItemsCsv(text: string, currency = "NZD"): { items: ItemRow[]; problems: string[] } {
  const records = parseCsvRecords(text);
  const header = findHeaderRow(records, ["Name"]);
  if (header === null) return { items: [], problems: ["No Name column: not a list of items."] };
  const reader = new ColumnReader(header.columns);
  const items: ItemRow[] = [];
  const problems: string[] = [];
  for (let n = header.index + 1; n < records.length; n += 1) {
    const record = records[n];
    if (record === undefined) continue;
    const cells = reader.at(record.fields);
    const name = cells.get("Name", "Item", "Item Name", "*ItemCode", "ItemCode").trim();
    if (name === "") continue;
    const at = `line ${record.line} (${name})`;
    const amount = (text: string, what: string): number | undefined => {
      if (text.trim() === "") return undefined;
      const cents = parseAmount(text, currency);
      if (cents === null || cents < 0) {
        problems.push(`${at}: ${what} "${text}" is not an amount; left empty`);
        return undefined;
      }
      return cents;
    };
    const kindText = cells.get("Kind", "Type").trim().toLowerCase();
    const unitCost = amount(cells.get("Unit cost", "Cost", "PurchasesUnitPrice"), "unit cost");
    const kind: Item["kind"] = kindText === "product" || kindText === "inventory" || (kindText === "" && unitCost !== undefined) ? "product" : "service";
    const price = amount(cells.get("Price", "Sale price", "SalesUnitPrice"), "price");
    const reorderText = cells.get("Reorder point").trim();
    const reorder = reorderText === "" ? undefined : Number(reorderText);
    if (reorder !== undefined && !(Number.isFinite(reorder) && reorder >= 0)) problems.push(`${at}: reorder point "${reorderText}" is not a number; left empty`);
    const description = cells.get("Description", "SalesDescription").trim();
    const account = cells.get("Account", "SalesAccount").trim();
    const taxable = yesNo(cells.get("Taxable"));
    const active = yesNo(cells.get("Active", "Status"));
    items.push({
      name,
      kind,
      ...(kindText !== "" ? { kindGiven: true } : {}),
      ...(description !== "" ? { description } : {}),
      ...(price !== undefined ? { price } : {}),
      ...(account !== "" ? { accountCode: account } : {}),
      ...(unitCost !== undefined && kind === "product" ? { unitCost } : {}),
      ...(reorder !== undefined && Number.isFinite(reorder) && reorder >= 0 ? { reorderPoint: reorder } : {}),
      ...(taxable !== undefined ? { taxable } : {}),
      ...(active !== undefined ? { active } : {}),
    });
  }
  return { items, problems };
}

export interface ItemImportPlan {
  add: ItemRow[];
  change: { before: Item; after: Item; fields: string[] }[];
  unchanged: number;
  problems: string[];
}

const FIELDS: readonly (readonly [keyof Omit<Item, "id" | "name">, string])[] = [
  ["kind", "kind"],
  ["description", "description"],
  ["price", "price"],
  ["accountCode", "account"],
  ["unitCost", "unit cost"],
  ["reorderPoint", "reorder point"],
  ["taxable", "taxable"],
  ["active", "active"],
];

/** What reading these items in would do, by name, without doing it. Only what the file says changes. */
export function itemImportPlan(existing: readonly Item[], incoming: readonly ItemRow[]): ItemImportPlan {
  const plan: ItemImportPlan = { add: [], change: [], unchanged: 0, problems: [] };
  const held = new Map(existing.map((i) => [itemKey(i.name), i]));
  const seen = new Set<string>();
  for (const row of incoming) {
    const key = itemKey(row.name);
    if (seen.has(key)) {
      plan.problems.push(`${row.name} is in the file twice; the second is left out`);
      continue;
    }
    seen.add(key);
    const before = held.get(key);
    if (before === undefined) {
      plan.add.push(row);
      continue;
    }
    const after: Item = { ...before };
    const fields: string[] = [];
    const out = after as unknown as Record<string, unknown>;
    for (const [field, said] of FIELDS) {
      const value = row[field];
      if (value === undefined) continue;
      if (field === "kind" && row.kindGiven !== true) continue;
      // Active and taxable are yes unless said otherwise, so a yes is a change only from a no.
      const yesByDefault = field === "active" || field === "taxable";
      const was = yesByDefault ? (before[field] ?? true) : before[field];
      if (value === was) continue;
      if (yesByDefault && value === true) delete out[field];
      else out[field] = value;
      fields.push(said);
    }
    if (fields.length === 0) plan.unchanged += 1;
    else plan.change.push({ before, after, fields });
  }
  return plan;
}

/** The list with a plan applied; `newId` names each item added. */
export function applyItemPlan(existing: readonly Item[], plan: ItemImportPlan, newId: (n: number) => string): Item[] {
  const changed = new Map(plan.change.map((c) => [c.before, c.after]));
  return [
    ...existing.map((i) => changed.get(i) ?? i),
    ...plan.add.map((row, n) => {
      const { kindGiven: _said, ...item } = row;
      return { ...item, id: newId(n) };
    }),
  ];
}
