import type { Cents } from "./money.js";

/**
 * Products and services: what is sold, kept as a list so an invoice line can
 * be filled in from a name. Looked up by name; nothing is posted from them.
 */
export interface Item {
  id: string;
  name: string;
  kind: "service" | "product";
  /** What a line says, if not the name. */
  description?: string;
  /** The usual price in cents. */
  price?: Cents;
  /** The chart code a sale of it is coded to. */
  accountCode?: string;
  active?: boolean;
}

export function itemKey(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim();
}

/** The item a line's words name, by its name, ignoring case and spacing. */
export function findItem(items: readonly Item[], words: string): Item | undefined {
  const key = itemKey(words);
  if (key === "") return undefined;
  return items.find((i) => i.active !== false && itemKey(i.name) === key);
}
