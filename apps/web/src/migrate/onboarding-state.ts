import { backendKind, ledgerId, openCloudBookId } from "../store.js";
import { state } from "../state.js";
import type { BusinessStructure, EntityKind } from "@nzosa/core";
import { taxYearStart } from "../tax-year.js";

/**
 * What the guided start has been told so far.
 *
 * Kept out of the page that asks the questions because two other places want
 * the answers: Setup, which opens on the source that was chosen, and opening
 * balances, which should already be dated the day these books start rather
 * than making somebody work it out twice.
 *
 * It lives in this browser rather than in the ledger: a half-answered
 * questionnaire is not something a set of books should carry to its
 * accountant. But it is kept for each set of books. Kept once for the person,
 * a new set of books opened on the same computer arrived with the last set's
 * answers -- its start date, its entities -- already ticked off. The one time
 * answers should follow somebody into a new set is when the plan sends them
 * there to start one, and that hands them over explicitly.
 */

export type Source = "xero" | "sheet" | "new";

export type Step =
  | "source"
  | "date"
  | "one"
  | "shared"
  | "entities"
  | "plan"
  | "modules"
  | "ai"
  | "bank"
  | "files"
  | "checklist"
  | "done";

export interface PlannedEntity {
  name: string;
  kind: EntityKind;
  /** For a business: company, sole trader, partnership or trust, once said. */
  structure?: BusinessStructure;
  /** Who owns it and in what shares, as typed: "Ana 50%, Tom 50%". */
  owners?: string;
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
  /** Whether AI is used, and how: an own key, prompts carried to one, or not at all. */
  ai?: "key" | "prompt" | "none";
  /** How the bank transactions are coming in: a live feed, or files. */
  bank?: "feed" | "files";
  /** How far through the rest of the set-up list they have walked. */
  checklistAt?: number;
  /** Whether Xero holds the whole financial year before these books start. */
  xeroYear?: boolean;
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

function keyFor(books: string): string {
  return `${KEY}.${books}`;
}

function parse(held: string | null): Onboarding | null {
  if (held === null) return null;
  try {
    const parsed: unknown = JSON.parse(held);
    return typeof parsed === "object" && parsed !== null ? (parsed as Onboarding) : null;
  } catch {
    return null;
  }
}

/** Nothing in these books yet: no bank lines, no opening balances, no invoices. */
function booksAreEmpty(): boolean {
  const led = state.ledger;
  return (
    led.transactions.length === 0 &&
    led.openingBalances === undefined &&
    (led.invoices ?? []).length === 0
  );
}

export function onboarding(): Onboarding {
  const own = parse(read(keyFor(booksKey())));
  if (own !== null) return own;
  // Answers kept before they were kept for each set of books. Books that hold
  // anything were being set up with them, so they keep them -- as their own
  // copy from now on. New, empty books start with none.
  if (!booksAreEmpty()) {
    const shared = parse(read(KEY));
    if (shared !== null) {
      write(keyFor(booksKey()), JSON.stringify(shared));
      return shared;
    }
  }
  return {};
}

/** Answers are merged in, so one screen never has to restate the ones before it. */
export function rememberOnboarding(patch: Onboarding): Onboarding {
  const next = { ...onboarding(), ...patch };
  write(keyFor(booksKey()), JSON.stringify(next));
  return next;
}

/**
 * Give a set of books about to be opened the answers from this one.
 *
 * For the plan's "start a set of books for these": the person has already
 * said when the books start and what the entities are, and should not be
 * asked again inside the new set. Named explicitly because the open set only
 * changes when the page reloads.
 */
export function carryOnboardingTo(books: string, answers: Onboarding): void {
  write(keyFor(books), JSON.stringify(answers));
}

export function forgetOnboarding(): void {
  // Emptied rather than removed, so books set up before answers were kept
  // for each set do not pick the old shared ones back up.
  write(keyFor(booksKey()), "{}");
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
  return taxYearStart(year + 1);
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
