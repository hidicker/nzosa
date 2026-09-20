import { backendKind, ledgerId, openCloudBookId } from "../store.js";
import type { EntityKind } from "@nzosa/core";

/**
 * What the guided start has been told so far.
 *
 * Kept out of the page that asks the questions because two other places want
 * the answers: Setup, which opens on the source that was chosen, and opening
 * balances, which should already be dated the day these books start rather
 * than making somebody work it out twice.
 *
 * It lives in this browser rather than in the ledger. Most of it is a fact
 * about the person and not about any one set of books -- somebody sent off to
 * start a separate set for their rental should not be asked again inside it --
 * and a half-answered questionnaire is not something a set of books should
 * carry to its accountant.
 */

export type Source = "xero" | "sheet" | "new";

export type Step =
  | "source"
  | "date"
  | "one"
  | "shared"
  | "entities"
  | "plan"
  | "bank"
  | "files"
  | "done";

export interface PlannedEntity {
  name: string;
  kind: EntityKind;
  gst: boolean;
  /** In separate books: the set started for it, once it has been. */
  book?: string;
  /** Set once that set of books has been given its entity. */
  ready?: boolean;
}

export interface Onboarding {
  at?: Step;
  source?: Source;
  /** True when there are figures to bring in, so a start date is worth asking. */
  opening?: boolean;
  /** The day these books take over, as an ISO date. */
  startDate?: string;
  /** Decision 1: one entity and nothing else. */
  onlyOne?: boolean;
  /** Decision 2: an account or card used by more than one entity. */
  shared?: boolean;
  entities?: PlannedEntity[];
  /** How the bank transactions are coming in: a live feed, or files. */
  bank?: "feed" | "files";
  /** Set when the questions are behind them, so the page stops asking. */
  finished?: boolean;
}

const KEY = "nzosa.onboarding";
const SOURCE_KEY = "nzosa.migration.source.";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // A browser that blocks storage simply asks again next time.
  }
}

/**
 * Which set of books is open, for answers that belong to one set rather than
 * to the person.
 *
 * The folder rather than what it is called: a folder can be renamed, and two
 * of them are free to carry the same name, so the name is not an identity.
 */
export function booksKey(): string {
  if (backendKind() === "cloud") return openCloudBookId() || "cloud";
  return ledgerId() || "browser";
}

export function onboarding(): Onboarding {
  const held = read(KEY);
  if (held === null) return {};
  try {
    const parsed: unknown = JSON.parse(held);
    return typeof parsed === "object" && parsed !== null ? (parsed as Onboarding) : {};
  } catch {
    return {};
  }
}

/** Answers are merged in, so one screen never has to restate the ones before it. */
export function rememberOnboarding(patch: Onboarding): Onboarding {
  const next = { ...onboarding(), ...patch };
  write(KEY, JSON.stringify(next));
  return next;
}

export function forgetOnboarding(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear if nothing could be kept.
  }
}

/** Where this set of books is coming from. Asked of each set, not of the person. */
export function sourceForTheseBooks(): Source | undefined {
  const value = read(SOURCE_KEY + booksKey());
  return value === "xero" || value === "sheet" || value === "new" ? value : undefined;
}

export function rememberSource(source: Source): void {
  write(SOURCE_KEY + booksKey(), source);
}

/**
 * The first day of the financial year we are in.
 *
 * Not 1 April of this calendar year, which between January and March is a date
 * in the future -- and an opening balance dated in the future is one that
 * every report before it ignores.
 */
export function startOfFinancialYear(today = new Date()): string {
  const year = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
  return `${year}-04-01`;
}

/**
 * The day these books start, if the guided start was told.
 *
 * Undefined rather than a guess, so a caller with a better idea of its own --
 * the date of the earliest transaction, say -- can prefer that over a default
 * nobody actually chose.
 */
export function chosenStartDate(): string | undefined {
  const held = onboarding().startDate;
  return held !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(held) ? held : undefined;
}

/**
 * The day these books start, with a sensible default.
 *
 * Opening balances are dated the day the books take over, so this is what
 * their date field should already say rather than asking for it twice.
 */
export function booksStartDate(): string {
  return chosenStartDate() ?? startOfFinancialYear();
}
