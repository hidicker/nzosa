import { AI_OWN_BATCH, allAiSuggestions, askAboutLines, restoreAiSuggestions, suggestFromDirectory, waitingForAnswers } from "./ai.js";
import type { AiAnswer, AskedLines } from "./ai-backend.js";
import { applyCountryRules } from "./country.js";
import { feedLinesForBooks, mergeIncoming } from "./daily/bank-import.js";
import { state } from "./state.js";
import { holdWrites, ledgerFromParts } from "./store.js";
import { feedRequestFrom, feedResumeDate } from "@nzosa/core";
import type { AiSuggestion, RuleSet } from "@nzosa/core";

/**
 * The morning run itself: the books worked out without a page.
 *
 * The same code the page runs -- the rules, what counts as waiting, the list of
 * known businesses, what a model is sent and how its answer is read -- bundled
 * to run on its own (build.js makes dist-node/nightly-run.js), so the morning
 * and the page can never disagree about a line. It is handed the books' parts
 * and a way to ask a model, and gives back what it found. Writing is held from
 * the first line: it saves nothing to the books, ever.
 */

export interface MorningInput {
  /** The books' parts, as a folder or the server holds them. */
  parts: Record<string, { version: number; data: unknown }>;
  /**
   * The bank feed: which of its accounts are which of ours, and a way to ask
   * it for everything from a day (worked out here, as the page does: from the
   * last line each linked account already holds, less a week).
   */
  feed?: {
    links: Record<string, string>;
    labels?: Record<string, string>;
    fetch: (from: string) => Promise<unknown[]>;
  };
  /** Suggestions already made, so the same lines are not paid for twice. */
  kept?: AiSuggestion[];
  /** Ask a model, on the books' own key. Absent: the list of businesses only. */
  ask?: (prompt: string, asking: number, asked?: AskedLines) => Promise<AiAnswer>;
  /** The most lines to ask a model about this morning. */
  maxLines: number;
}

export interface MorningResult {
  /** The bank's lines the books would gain. */
  added: number;
  /** What the feed gave, as it gave it, for the inbox. */
  items: unknown[];
  suggestions: AiSuggestion[];
  said: string;
}

function rulesFrom(held: unknown): RuleSet | undefined {
  if (held === null || typeof held !== "object" || Object.keys(held).length === 0) return undefined;
  const file = held as Record<string, unknown>;
  // A rule file written by hand is the set itself; one the app wrote wraps it.
  return (Array.isArray(file["rules"]) ? file : file["rules"]) as RuleSet | undefined;
}

export async function morningRun(input: MorningInput): Promise<MorningResult> {
  holdWrites();
  state.ledger = ledgerFromParts(input.parts);
  applyCountryRules();
  state.chart = state.ledger.chart ?? [];
  state.rules = rulesFrom(input.parts["rules"]?.data);
  restoreAiSuggestions(input.kept ?? []);

  let added = 0;
  let items: unknown[] = [];
  const linked = Object.values(input.feed?.links ?? {}).some((to) => to !== "");
  if (input.feed !== undefined && linked) {
    const start = feedResumeDate({ mapping: input.feed.links, transactions: state.ledger.transactions });
    items = await input.feed.fetch(start === undefined ? "" : feedRequestFrom(start));
    const before = new Set(state.ledger.transactions.map((t) => t.id));
    const read = feedLinesForBooks(items as never, input.feed.links, input.feed.labels ?? {});
    mergeIncoming(read.transactions);
    added = state.ledger.transactions.filter((t) => !before.has(t.id)).length;
  }

  const known = suggestFromDirectory();
  const said: string[] = [];
  let asked = 0;
  if (input.ask !== undefined) {
    while (asked < input.maxLines) {
      const waiting = waitingForAnswers();
      if (waiting.length === 0) break;
      const batch = Math.min(AI_OWN_BATCH, input.maxLines - asked, waiting.length);
      const result = await askAboutLines(waiting, batch, input.ask);
      asked += batch;
      if (result.said !== "") said.push(result.said);
      if (result.got === 0) break;
    }
  }
  const suggestions = allAiSuggestions();
  return {
    added,
    items,
    suggestions,
    said: [
      `${added} new line${added === 1 ? "" : "s"} from the bank`,
      `${known} suggested from the list of known businesses`,
      `${suggestions.length} suggestion${suggestions.length === 1 ? "" : "s"} waiting in all`,
      input.ask === undefined ? "no AI asked" : `${asked} line${asked === 1 ? "" : "s"} asked of the AI`,
      ...said,
    ].join("; "),
  };
}
