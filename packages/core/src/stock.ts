import type { Cents } from "./money.js";

/**
 * Stock, counted: the periodic method. What is on hand is counted at a date
 * and valued at each product's unit cost; the inventory account is then put
 * to that value, the difference going to cost of goods sold. Between counts,
 * purchases are coded to cost of sales as usual.
 */
export interface StockCount {
  id: string;
  date: string;
  lines: { itemId: string; quantity: number; unitCost: Cents }[];
  /** The journal that put the inventory account to the count's value, once posted. */
  journalId?: string;
}

/** What a count is worth, to the cent. */
export function stockValue(count: Pick<StockCount, "lines">): Cents {
  return count.lines.reduce((sum, line) => sum + Math.round(line.quantity * line.unitCost), 0);
}

/**
 * The journal lines that bring the inventory account from what the books hold
 * to what was counted: more stock than the books say lowers cost of goods
 * sold, less raises it. None when they agree.
 */
export function stockAdjustment(
  counted: Cents,
  booked: Cents,
  inventory: string,
  costOfSales: string,
): { code: string; amount: Cents; description: string }[] {
  const change = counted - booked;
  if (change === 0) return [];
  return [
    { code: inventory, amount: change, description: "Stock on hand, as counted" },
    { code: costOfSales, amount: -change, description: change > 0 ? "Stock not yet sold" : "Stock sold or used" },
  ];
}
