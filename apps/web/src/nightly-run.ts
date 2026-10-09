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
  /** Lines a model could not answer on earlier mornings, so they are not paid for again at once. */
  unsure?: UnsureLines | undefined;
  /** Now, for a test. */
  now?: Date | undefined;
}

/** Lines the model was asked about and could not name an account for, and when. */
export interface UnsureLines {
  /** Of the rules and the chart when they were asked: a change in either lets them be asked again. */
  signature: string;
  ids: Record<string, string>;
}

/** How long a line the model could not answer is left alone, unless the rules or the chart change. */
export const UNSURE_DAYS = 14;

/** A short fingerprint of what the model is told it may answer with. */
function signatureOf(rules: unknown, chart: readonly { code: string; name: string }[]): string {
  const text = JSON.stringify(rules ?? null) + chart.map((a) => `${a.code}:${a.name}`).join("|");
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return String(hash >>> 0);
}

export interface MorningResult {
  /** The bank's lines the books would gain. */
  added: number;
  /** What the feed gave, as it gave it, for the inbox. */
  items: unknown[];
  suggestions: AiSuggestion[];
  said: string;
  /** What the model could not answer, to be kept for the next morning. */
  unsure: UnsureLines;
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
    const fetched = await input.feed.fetch(start === undefined ? "" : feedRequestFrom(start));
    // An account with no lines yet is fetched from the books' first day, every time,
    // so most of what comes back is already in the books. The inbox keeps only what
    // is not: it is what the next opening has to bring in, and it is stored beside
    // the books every morning.
    const have = new Set(state.ledger.transactions.map((t) => t.extras?.["akahuId"]).filter((id) => id !== undefined));
    items = (fetched as { _id?: string }[]).filter((item) => item._id === undefined || !have.has(item._id));
    const before = new Set(state.ledger.transactions.map((t) => t.id));
    const read = feedLinesForBooks(fetched as never, input.feed.links, input.feed.labels ?? {});
    mergeIncoming(read.transactions);
    added = state.ledger.transactions.filter((t) => !before.has(t.id)).length;
  }

  const known = suggestFromDirectory();
  const said: string[] = [];
  let asked = 0;
  const now = input.now ?? new Date();
  const signature = signatureOf(state.rules, state.chart);
  // What was not answerable on earlier mornings is left alone while it is recent
  // and nothing the model is told has changed; otherwise the oldest waiting lines
  // would be paid for again every morning and use up the day's allowance.
  const recent = (when: string): boolean => now.getTime() - Date.parse(when) < UNSURE_DAYS * 86_400_000;
  const unsure: Record<string, string> =
    input.unsure !== undefined && input.unsure.signature === signature
      ? Object.fromEntries(Object.entries(input.unsure.ids).filter(([, when]) => recent(when)))
      : {};
  let barren = 0;
  if (input.ask !== undefined) {
    while (asked < input.maxLines) {
      const waiting = waitingForAnswers().filter((one) => unsure[one.transaction.id] === undefined);
      if (waiting.length === 0) break;
      const batch = Math.min(AI_OWN_BATCH, input.maxLines - asked, waiting.length);
      const result = await askAboutLines(waiting, batch, input.ask);
      if (result.said !== "") said.push(result.said);
      if (result.failed === true) break;
      asked += batch;
      // Asked and not answered: remembered. (An error means it was not asked.)
      const answered = new Set(allAiSuggestions().map((s) => s.id));
      for (const one of waiting.slice(0, batch)) {
        if (!answered.has(one.transaction.id)) unsure[one.transaction.id] = now.toISOString();
      }
      barren = result.got === 0 ? barren + 1 : 0;
      if (barren >= 2) break;
    }
  }
  const stillWaiting = new Set(waitingForAnswers().map((one) => one.transaction.id));
  for (const id of Object.keys(unsure)) if (!stillWaiting.has(id)) delete unsure[id];
  const suggestions = allAiSuggestions();
  return {
    added,
    items,
    suggestions,
    unsure: { signature, ids: unsure },
    said: [
      `${added} new line${added === 1 ? "" : "s"} from the bank`,
      `${known} suggested from the list of known businesses`,
      `${suggestions.length} suggestion${suggestions.length === 1 ? "" : "s"} waiting in all`,
      input.ask === undefined ? "no AI asked" : `${asked} line${asked === 1 ? "" : "s"} asked of the AI`,
      ...said,
    ].join("; "),
  };
}
