import { accountsFor, nothingHasAnswered, unregisteredCode } from "./books.js";
import { knownCodes, suggest } from "./reconcile.js";
import type { Suggestion } from "./reconcile.js";
import { state } from "./state.js";
import {
  askAbout,
  briefing,
  directionCaution,
  emptyEntityModel,
  labelForCode,
  parseSuggestions,
  wholePrompt,
} from "@nzosa/core";
import type { AiSuggestion, AskedAbout } from "@nzosa/core";

/**
 * Suggestions from a model, and the asking for them.
 *
 * Kept apart from both pages that use it: the AI page sets it up, and the
 * Reconcile page is where the answers are worked through, because that is
 * where somebody already is when a line has nothing on it.
 *
 * They live in memory and not in the ledger. A suggestion is a proposal
 * nobody has agreed to, and a proposal written into the books would be
 * indistinguishable, a month later, from a coding somebody meant. Accepting
 * one writes it the ordinary way, through the same tick as everything else.
 */

/**
 * How many to ask about at once.
 *
 * Small on purpose. A batch of twenty is a screen of answers somebody can
 * actually read before accepting, it keeps one careless press from spending a
 * day's allowance, and a model given twenty lines pays more attention to each
 * of them than one given four hundred.
 */
export const AI_BATCH = 20;

export interface AiModel {
  name: string;
  label: string;
}

export interface AiStatus {
  configured: boolean;
  key: string;
  model: string;
  models: AiModel[];
  usedToday: number;
  limit: number;
}

/** What came back, by transaction. Emptied by a reload, and that is right. */
const found = new Map<string, AiSuggestion>();

export function aiSuggestionFor(id: string): AiSuggestion | undefined {
  return found.get(id);
}

export function aiSuggestionCount(): number {
  return found.size;
}

export function forgetAiSuggestions(): void {
  found.clear();
}

export async function aiRequest(path: string, init?: RequestInit): Promise<Response | null> {
  try {
    return await fetch(path, init);
  } catch {
    return null;
  }
}

export async function aiStatus(): Promise<AiStatus | null> {
  const response = await aiRequest("/api/ai");
  if (response === null || !response.ok) return null;
  return (await response.json().catch(() => null)) as AiStatus | null;
}

/** Every line, coded the way the Reconcile page codes them: rules first. */
export function allLines(): Suggestion[] {
  return suggest(
    state.ledger.transactions,
    state.rules,
    state.ledger.overrides ?? {},
    accountsFor([]),
    unregisteredCode(),
  );
}

/**
 * The lines nothing in these books has answered, oldest first.
 *
 * "Nothing has answered" rather than "no code": a recorded transfer, a split,
 * a matched invoice and an offered transfer are all answers, and three of them
 * are better answers than a code would be. Asking about those was paying to
 * describe decisions already taken -- a hundred and seventeen of them on one
 * real set of books -- and then offering an account for a transfer, which is
 * how a movement between your own accounts gets filed as income.
 *
 * Oldest first because that is the order somebody works in, so the twenty
 * asked about are the twenty they are about to reach -- and never one already
 * answered, because asking twice is the one way to spend an allowance on
 * nothing.
 */
export function waitingForAnswers(lines = allLines()): Suggestion[] {
  return lines
    .filter((one) => nothingHasAnswered(one) && !found.has(one.transaction.id))
    .sort((a, b) => a.transaction.date.localeCompare(b.transaction.date));
}

interface Asking {
  prompt: string;
  asked: AskedAbout[];
  codes: string[];
}

/** What would be sent about these lines, in full, so it can be read first. */
export function whatWouldBeAsked(lines: readonly Suggestion[], howMany = AI_BATCH): Asking {
  const labels = new Map(
    state.ledger.transactions.map((t) => [
      t.id,
      String(t.extras?.["accountLabel"] ?? t.account),
    ]),
  );
  const asked = lines
    .slice(0, Math.max(1, howMany))
    .map((one) => askAbout(one.transaction, labels.get(one.transaction.id) ?? ""));

  const model = state.ledger.entities ?? emptyEntityModel();
  const books = {
    ...briefing(model, state.chart, (entity) => entity.about ?? ""),
    about: state.ledger.booksAbout ?? "",
  };
  // Work already done, as worked examples.
  const coded = allLines()
    .filter((one) => one.confirmed && (one.code ?? "").trim() !== "")
    .map((one) => ({ payee: one.transaction.otherParty, code: one.code ?? "" }));

  return {
    prompt: wholePrompt(books, asked, coded),
    asked,
    codes: books.accounts.map((account) => account.code),
  };
}

/**
 * The same question, addressed to a person to carry.
 *
 * No key, no proxy, no cost: the prompt goes on the clipboard, into whatever
 * model somebody already pays for, and the answer comes back through the same
 * door and the same checks. It is the only route that works at all on a copy
 * running in a browser, and on a bigger model than a per-transaction budget
 * would buy it is likely to be the better answer as well.
 */
export function promptToCarry(lines: readonly Suggestion[], howMany: number): {
  text: string;
  asked: AskedAbout[];
  codes: string[];
} {
  const { prompt, asked, codes } = whatWouldBeAsked(lines, howMany);
  return {
    text:
      "Below is a set of bank transactions from a New Zealand set of books, and the " +
      "chart of accounts they are coded to. Follow the instructions in it and reply " +
      "with the JSON array and nothing else -- no explanation around it. Keep every id " +
      "exactly as given.\n\n" +
      prompt,
    asked,
    codes,
  };
}

/**
 * Ask about a batch, and keep what comes back.
 *
 * Says what happened in words rather than returning a flag, because every one
 * of these is something a person has to read: no key, none left today, the
 * model would not answer, or an answer nothing could be made of.
 */
export async function askAboutLines(
  lines: readonly Suggestion[],
): Promise<{ got: number; said: string }> {
  const { prompt, asked, codes } = whatWouldBeAsked(lines);
  if (asked.length === 0) return { got: 0, said: "Nothing is waiting to be asked about." };

  const response = await aiRequest("/api/ai/suggest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt, asking: asked.length }),
  });
  if (response === null) {
    return { got: 0, said: "Could not reach the app on this computer." };
  }
  const answer = (await response.json().catch(() => ({}))) as { text?: string; error?: string };
  if (!response.ok) {
    return { got: 0, said: answer.error ?? "The model would not answer." };
  }

  return keepWhatIsUsable(answer.text ?? "", asked, codes);
}

/**
 * Read an answer and keep the part of it that can be trusted.
 *
 * One place, whether the answer came from the configured model or was pasted
 * back from somewhere else, because an answer from a chat window deserves
 * exactly the same suspicion as one from the API -- more, if anything, since
 * nothing about it was under this app's control at all.
 */
export function keepWhatIsUsable(
  text: string,
  asked: readonly AskedAbout[],
  codes: readonly string[],
  via?: string,
): { got: number; said: string } {
  const back = parseSuggestions(text, {
    asked: asked.map((one) => one.id),
    codes,
  });

  // Checked twice, against two different lists, because the cost of a wrong
  // one is a posting to an account nobody meant. The chart says the number
  // exists; this says which account in these books that number is, and a
  // number that answers to no account -- or to two -- is thrown away rather
  // than coded to a name the books have never used.
  const labels = knownCodes(state.rules, state.ledger.overrides ?? {}, state.chart);
  const typeOf = new Map(
    state.chart.map((account) => [account.code.trim(), account.type ?? ""]),
  );
  const facing = new Map(asked.map((one) => [one.id, one.direction]));

  let got = 0;
  let invented = 0;
  for (const one of back) {
    // A blank is the model saying it does not know, which is worth nothing on
    // a queue of things to decide, and is not an invented account either.
    if (one.code === "") continue;
    const label = labelForCode(one.code, labels);
    if (label === null) {
      invented += 1;
      continue;
    }
    const caution = directionCaution(
      facing.get(one.id) ?? "",
      typeOf.get(one.code) ?? "",
    );
    found.set(one.id, {
      ...one,
      code: label,
      ...(caution !== undefined ? { caution } : {}),
      ...(via !== undefined ? { via } : {}),
    });
    got += 1;
  }
  return {
    got,
    said:
      back.length === 0
        ? "Nothing there could be read as an answer. Nothing has changed."
        : got === 0
          ? `Read ${back.length}, and none of them named an account these books have.`
          : invented === 0
            ? ""
            : `${invented} of ${back.length} named an account these books do not have, and ` +
              "were thrown away. The rest are on the lines they belong to.",
  };
}
