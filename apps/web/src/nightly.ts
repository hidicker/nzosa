import { allAiSuggestions, keepAiSuggestionsWith, restoreAiSuggestions } from "./ai.js";
import { readNightlyPart, writeNightlyPart } from "./store.js";
import type { AiSuggestion } from "@nzosa/core";

/**
 * What the morning run leaves beside a set of books, and the page's side of it.
 *
 * Every morning, where the books have it turned on, a run checks the bank feed
 * and suggests codes for the lines nothing has answered -- before anybody opens
 * them, so opening is quick and the work is already there. It puts nothing into
 * the books. The bank's new lines wait here, in an inbox, and come in when the
 * books are opened, through the same import as always: the same duplicate
 * check, the same lock dates, the same History. The suggestions wait here too,
 * and go on the lines they are for.
 *
 * The page writes here as well: suggestions it was given are kept, so a reload
 * no longer throws away answers already paid for.
 */

export interface Morning {
  /** The bank feed's items, as Akahu gave them, waiting to come in. */
  inbox?: { at: string; items: unknown[] };
  /** Suggested codes, by transaction, from the business list or a model. */
  suggestions?: { at: string; list: AiSuggestion[] };
  /** What the last morning run did, in a line. */
  ran?: { at: string; added: number; suggested: number; said: string };
}

export async function readMorning(): Promise<Morning> {
  const held = await readNightlyPart();
  return held !== null && typeof held === "object" ? (held as Morning) : {};
}

async function change(patch: (morning: Morning) => Morning): Promise<void> {
  await writeNightlyPart(patch(await readMorning()));
}

/**
 * On opening: the morning's suggestions on their lines, and from now on every
 * answer a model gives kept beside the books.
 */
export async function restoreMorning(morning: Morning): Promise<number> {
  const back = restoreAiSuggestions(morning.suggestions?.list ?? []);
  keepAiSuggestionsWith((all) => {
    void change((now) => ({ ...now, suggestions: { at: new Date().toISOString(), list: all } }));
  });
  return back;
}

/** Keep what is on the lines now, e.g. after accepting some of them. */
export async function keepSuggestionsNow(): Promise<void> {
  await change((now) => ({ ...now, suggestions: { at: new Date().toISOString(), list: allAiSuggestions() } }));
}

/** The inbox has come in: empty it, so the same lines are not offered twice. */
export async function clearInbox(): Promise<void> {
  await change(({ inbox: _gone, ...rest }) => rest);
}

/** How long a morning's inbox stands in for asking the bank again. */
export const INBOX_FRESH_HOURS = 20;

export function inboxIsFresh(morning: Morning, now = Date.now()): boolean {
  const at = morning.inbox?.at;
  return at !== undefined && now - Date.parse(at) < INBOX_FRESH_HOURS * 3600 * 1000;
}
