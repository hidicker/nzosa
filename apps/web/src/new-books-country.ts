import { JURISDICTIONS, accountEntityKey, jurisdictionOf, starterChartFor } from "@nzosa/core";
import type { Account } from "@nzosa/core";
import { edition } from "./edition.js";
import { state } from "./state.js";
import { savePart } from "./store.js";

/**
 * The country a set of books is kept in, chosen as the books are made.
 *
 * It decides the starter chart, the tax year, the currency and the returns,
 * and the starter chart goes in the first time the new books open. Chosen
 * afterwards, the books had already been given New Zealand's chart: 200
 * Sales, 610 and 800 on books kept in the United States. So the choice is
 * held for the moment between making the books and opening them, and put on
 * them before anything else is.
 */

const PENDING = "nzosa.newBooksCountry";
/** Long enough to make the books and open them; short enough not to land on some other set later. */
const FRESH_FOR = 10 * 60 * 1000;

export const WORK_IN_PROGRESS = new Set(["us", "au", "kr"]);
const OFFERED = new Set(["nz", "us", ...WORK_IN_PROGRESS]);
const ORDER = (id: string): number => ["nz", "us", "au", "kr"].indexOf(id) + 1 || 99;

/** The countries a set of books can be kept in, as [id, what to call it], in the order offered. */
export function countryChoices(keep?: string): [string, string][] {
  return [...Object.values(JURISDICTIONS)]
    .filter((one) => OFFERED.has(one.id) || edition() === "international" || one.id === keep)
    .sort((a, b) => ORDER(a.id) - ORDER(b.id))
    .map((one) => [one.id, WORK_IN_PROGRESS.has(one.id) ? `${one.name} (work in progress)` : one.name]);
}

/** Hold the country for the set of books about to be made. */
export function rememberNewBooksCountry(country: string): void {
  try {
    localStorage.setItem(PENDING, JSON.stringify({ country, at: Date.now() }));
  } catch {
    // Without storage the books start in New Zealand, and Setup can change it.
  }
}

/**
 * Put the held country on books that have just been made, before their
 * starter chart goes in. True when it did.
 */
export async function applyNewBooksCountry(): Promise<boolean> {
  let held: { country?: string; at?: number } | null = null;
  try {
    held = JSON.parse(localStorage.getItem(PENDING) ?? "null");
    localStorage.removeItem(PENDING);
  } catch {
    return false;
  }
  if (held === null || typeof held.country !== "string" || typeof held.at !== "number") return false;
  if (Date.now() - held.at > FRESH_FOR) return false;
  // Only on books with nothing in them yet: never over a country somebody chose.
  const fresh =
    state.ledger.jurisdiction === undefined &&
    state.chart.length === 0 &&
    state.ledger.transactions.length === 0 &&
    Object.keys(state.ledger.overrides ?? {}).length === 0;
  if (!fresh || held.country === "nz" || !(held.country in JURISDICTIONS)) return false;
  state.ledger = { ...state.ledger, jurisdiction: held.country };
  state.persistent = await savePart(state.ledger);
  return true;
}

/** Whether a chart is still exactly a country's starter chart, untouched. */
export function isStarterChart(chart: readonly Account[], country: string): boolean {
  const key = (a: Account): string => `${a.code.trim()}|${a.name.trim()}`;
  const starter = new Set(starterChartFor(country).map(key));
  return chart.length === starter.size && chart.every((a) => starter.has(key(a)));
}

/**
 * When the country of empty books changes, the starter chart changes with it:
 * the old country's untouched chart is swapped for the new one's, and the one
 * entity keeps every account. Books with anything in them, a chart that has
 * been changed, or several entities are left as they are.
 */
export function starterChartForNewCountry(from: string, to: string): { chart: Account[]; accounts: Record<string, string> } | null {
  if (state.ledger.transactions.length > 0 || Object.keys(state.ledger.overrides ?? {}).length > 0) return null;
  if ((state.ledger.invoices ?? []).length > 0 || (state.ledger.manualJournals ?? []).length > 0) return null;
  if (!isStarterChart(state.chart, from)) return null;
  const entities = state.ledger.entities?.entities ?? [];
  if (entities.length > 1) return null;
  const chart = starterChartFor(to);
  const only = entities[0];
  const accounts: Record<string, string> = {};
  if (only !== undefined) for (const a of chart) accounts[accountEntityKey(a)] = only.id;
  return { chart, accounts };
}

/**
 * Whether the books' country is settled for good: once they hold anything.
 *
 * The country decides how every line is posted -- the tax year, the currency,
 * GST or none, the returns, the date order files are read in -- and nothing
 * already in the books is converted when it changes. Changed on books with a
 * year in them, it would leave them half one country and half another, with
 * figures that look right and are not. So it is chosen as the books are made,
 * changeable while they are empty, and fixed after that.
 */
export function countryLocked(): boolean {
  const led = state.ledger;
  return (
    led.transactions.length > 0 ||
    (led.invoices ?? []).length > 0 ||
    (led.manualJournals ?? []).length > 0 ||
    led.openingBalances !== undefined ||
    (led.filedReturns ?? []).length > 0
  );
}

/**
 * Whether the chart is still the country's starter chart with nothing coded
 * to it: no codings, splits, journals or rules of anyone's making. Such a chart
 * is replaced outright by one brought from another system, not merged with it.
 */
export function isUnusedStarterChart(): boolean {
  if (!isStarterChart(state.chart, jurisdictionOf(state.ledger.jurisdiction).id)) return false;
  const rules = state.rules as { rules?: unknown[] } | undefined;
  return (
    Object.keys(state.ledger.overrides ?? {}).length === 0 &&
    Object.keys(state.ledger.splits ?? {}).length === 0 &&
    (state.ledger.manualJournals ?? []).length === 0 &&
    (rules?.rules ?? []).length === 0
  );
}
