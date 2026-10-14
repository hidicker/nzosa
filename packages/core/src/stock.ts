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

/**
 * Stock tracked line by line: the perpetual method, alongside the counts.
 *
 * A bill line for a stocked product (its `itemCode` the product's id or name)
 * adds what it says to what is on hand, at what it cost; the line is coded to
 * the inventory account, so the books hold it there. An invoice line takes it
 * out again at the average cost of what is on hand, and that cost is posted
 * from inventory to cost of goods sold on the invoice's date. A count puts the
 * quantity to what was counted, as its own journal puts the account.
 */
export interface StockItemLike {
  id: string;
  name: string;
  kind: "service" | "product";
  unitCost?: Cents;
}

export interface StockDocumentLike {
  number: string;
  kind: "sales" | "purchase";
  issued: string;
  /** Credit notes put stock back (a customer's return) or take it out (one sent back). */
  credit: boolean;
  lines: { itemCode?: string; quantity?: number; net: Cents; description: string }[];
}

export interface StockOnHand {
  quantity: number;
  value: Cents;
}

export interface StockCostJournal {
  /** `<invoice number>:cost`. */
  transactionId: string;
  date: string;
  number: string;
  cost: Cents;
}

function itemFor(items: readonly StockItemLike[], code: string | undefined): StockItemLike | undefined {
  if (code === undefined || code.trim() === "") return undefined;
  const key = code.trim().toLowerCase();
  return items.find((i) => i.id === code || i.name.trim().toLowerCase() === key);
}

export function trackStock(
  items: readonly StockItemLike[],
  documents: readonly StockDocumentLike[],
  counts: readonly StockCount[],
): { onHand: Map<string, StockOnHand>; costs: StockCostJournal[] } {
  const stocked = items.filter((i) => i.kind === "product" && i.unitCost !== undefined);
  type Move =
    | { date: string; order: number; kind: "in" | "out"; item: StockItemLike; quantity: number; net: Cents; number: string }
    | { date: string; order: number; kind: "count"; item: StockItemLike; quantity: number; unitCost: Cents };
  const moves: Move[] = [];
  for (const doc of documents) {
    for (const line of doc.lines) {
      const item = itemFor(stocked, line.itemCode);
      if (item === undefined) continue;
      const quantity = Math.abs(line.quantity ?? 1);
      if (quantity === 0) continue;
      // A purchase brings stock in, a sale takes it out; a credit note the other way.
      const incoming = (doc.kind === "purchase") !== doc.credit;
      moves.push({
        date: doc.issued,
        order: incoming ? 0 : 1,
        kind: incoming ? "in" : "out",
        item,
        quantity,
        net: Math.abs(line.net),
        number: doc.kind === "sales" ? doc.number : "",
      });
    }
  }
  for (const count of counts) {
    for (const line of count.lines) {
      const item = stocked.find((i) => i.id === line.itemId);
      if (item !== undefined) moves.push({ date: count.date, order: 2, kind: "count", item, quantity: line.quantity, unitCost: line.unitCost });
    }
  }
  moves.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);

  const onHand = new Map<string, StockOnHand>();
  const costs = new Map<string, StockCostJournal>();
  for (const move of moves) {
    const held = onHand.get(move.item.id) ?? { quantity: 0, value: 0 };
    if (move.kind === "count") {
      held.quantity = move.quantity;
      held.value = Math.round(move.quantity * move.unitCost);
    } else {
      // What is on hand is worth its average; with none, the product's cost.
      const average = held.quantity > 0 ? held.value / held.quantity : (move.item.unitCost ?? 0);
      if (move.number === "") {
        // Bought, or sent back to the supplier: at what the bill says.
        const sign = move.kind === "in" ? 1 : -1;
        held.quantity += sign * move.quantity;
        held.value += sign * move.net;
      } else {
        // Sold, or returned by the customer: at the average.
        const cost = Math.round(move.quantity * average);
        const sign = move.kind === "out" ? 1 : -1;
        held.quantity -= sign * move.quantity;
        held.value -= sign * cost;
        if (move.number !== "") {
          const id = `${move.number}:cost`;
          const journal = costs.get(id) ?? { transactionId: id, date: move.date, number: move.number, cost: 0 };
          journal.cost += sign * cost;
          costs.set(id, journal);
        }
      }
    }
    onHand.set(move.item.id, held);
  }
  return { onHand, costs: [...costs.values()].filter((j) => j.cost !== 0) };
}
