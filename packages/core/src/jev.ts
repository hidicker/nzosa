import type { AiFetcher } from "./ai-providers.js";
import { JEV_DECIDE_URL, JEV_MODEL } from "./ai-providers.js";

/**
 * Coding suggestions from Jev (TypeSafe AI).
 *
 * Jev does not read a prompt and write an answer. It is asked a typed
 * question about one thing -- here, which of these accounts a bank line
 * belongs to -- and answers with its choice and how sure it is. So each line
 * is its own question, and the answers are written out in the same form every
 * other model's are: a JSON array of id, code, confidence and reason. That
 * text then goes through the same reader as any other answer, which checks
 * every code against the chart, so nothing here can put an account on a line
 * that the books do not have.
 *
 * Only the account is asked. GST follows the account's own setting in these
 * books, so a separate GST guess could only disagree with it.
 */

/** An account Jev may choose for a line, and what it is. */
export interface JevOption {
  label: string;
  /** Its type and entity, e.g. "Expense; Totara Street, residential rental". */
  about: string;
}

/** A line as it is described to any model, and what Jev is to choose between. */
export interface JevLine {
  id: string;
  date: string;
  direction: "money in" | "money out";
  amount: string;
  payee: string;
  details: string;
  paidFrom: string;
  /**
   * The accounts this line may go to: the entity's own, where the bank
   * account says whose it is. Absent, the whole chart. Each must be in it.
   */
  options?: readonly JevOption[];
  /** Whose bank account it is and what that entity does, in words. */
  context?: string;
  /** How this payee was coded before, e.g. "KEA HARDWARE was coded to Repairs - 473". */
  examples?: readonly string[];
}

export interface JevRequest {
  key: string;
  lines: readonly JevLine[];
  /** The chart's account labels; the answer must be one of them. */
  codes: readonly string[];
  /** The owner's own description of these books, when they have given one. */
  about?: string;
  model?: string;
  fetcher: AiFetcher;
  /** How many lines are asked at once. */
  concurrency?: number;
}

/** Jev chooses from at most this many options. */
export const JEV_MOST_OPTIONS = 255;

interface JevAnswer {
  choice?: string;
  confidence?: number;
  probabilities?: Record<string, number>;
}

/** Ask about every line and return the answers as the JSON text a model would write. */
export async function jevSuggest(request: JevRequest): Promise<string> {
  const { codes, lines } = request;
  if (codes.length === 0) throw new Error("There are no accounts in the chart to choose from.");
  if (codes.length > JEV_MOST_OPTIONS) {
    throw new Error(
      `Jev chooses from at most ${JEV_MOST_OPTIONS} accounts; this chart has ${codes.length}.`,
    );
  }
  const inChart = new Set(codes);

  const ask = async (line: JevLine): Promise<{ id: string; code: string; confidence: number; because: string }> => {
    // The line's own choices where it has them, and only ones in the chart;
    // the whole chart otherwise. Short keys, since labels carry punctuation,
    // mapped back to the label when the answer arrives.
    const own = (line.options ?? []).filter((option) => inChart.has(option.label));
    const choices: JevOption[] = own.length >= 2 ? own : codes.map((label) => ({ label, about: "" }));
    const criteria: Record<string, string> = {};
    const labelOf: Record<string, string> = {};
    choices.forEach((option, index) => {
      criteria[`a${index}`] = option.about === "" ? option.label : `${option.label}: ${option.about}`;
      labelOf[`a${index}`] = option.label;
    });
    const response = await request.fetcher(JEV_DECIDE_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${request.key}` },
      body: JSON.stringify({
        model: request.model ?? JEV_MODEL,
        state: describe(line, request.about ?? ""),
        questions: {
          account: {
            type: "choice",
            instructions:
              "Choose the account in this New Zealand chart of accounts that this bank " +
              "transaction should be coded to. Money in is usually income or a refund; money " +
              "out is usually an expense, an asset bought, or a payment of something owed.",
            criteria,
          },
        },
      }),
    });
    const body = (await response.json().catch(() => null)) as
      | { answers?: { account?: JevAnswer }; error?: unknown; message?: unknown }
      | null;
    if (!response.ok) throw new Error(jevError(response.status, body));
    const answer = body?.answers?.account;
    const code = answer?.choice !== undefined ? (labelOf[answer.choice] ?? "") : "";
    const confidence = typeof answer?.confidence === "number" ? answer.confidence : 0;
    return { id: line.id, code, confidence, because: reason(answer, labelOf) };
  };

  const answers: { id: string; code: string; confidence: number; because: string }[] = [];
  // All at once by default: each answer takes well under a second, and a
  // batch is small.
  const width = Math.max(1, request.concurrency ?? 20);
  for (let start = 0; start < lines.length; start += width) {
    answers.push(...(await Promise.all(lines.slice(start, start + width).map(ask))));
  }
  return JSON.stringify(answers);
}

/** One line in words, as the other models are given it. */
function describe(line: JevLine, about: string): string {
  return [
    "A bank transaction from a New Zealand set of books.",
    ...(about.trim() !== "" ? [`About these books: ${about.trim()}`] : []),
    `Direction: ${line.direction}`,
    `Amount: $${line.amount}`,
    `Date: ${line.date}`,
    `Payee: ${line.payee}`,
    ...(line.details.trim() !== "" ? [`Details: ${line.details}`] : []),
    ...(line.paidFrom.trim() !== "" ? [`Bank account: ${line.paidFrom}`] : []),
    ...(line.context !== undefined && line.context.trim() !== "" ? [line.context.trim()] : []),
    ...((line.examples ?? []).length > 0
      ? ["How this payee was coded before:", ...(line.examples ?? []).map((e) => `- ${e}`)]
      : []),
  ].join("\n");
}

/** How sure, and the runner-up, for somebody deciding whether to accept it. */
function reason(answer: JevAnswer | undefined, criteria: Record<string, string>): string {
  if (answer?.choice === undefined) return "";
  const ranked = Object.entries(answer.probabilities ?? {}).sort((a, b) => b[1] - a[1]);
  const second = ranked.find(([key]) => key !== answer.choice);
  return (
    "Jev's choice from the chart" +
    (second !== undefined && second[1] >= 0.05
      ? `; next most likely ${criteria[second[0]] ?? second[0]} (${Math.round(second[1] * 100)}%)`
      : "") +
    "."
  );
}

/** Jev's error in words somebody can act on. */
function jevError(status: number, body: { error?: unknown; message?: unknown } | null): string {
  const said =
    typeof body?.error === "string"
      ? body.error
      : typeof body?.message === "string"
        ? body.message
        : "";
  const plain: Record<number, string> = {
    400: "Jev could not read the question",
    401: "Jev did not accept the key",
    402: "The Jev account has no credit left",
    403: "The Jev account is not active",
    502: "Jev could not answer just now",
  };
  return `${plain[status] ?? `Jev answered ${status}`}${said !== "" ? `: ${said}` : ""}.`;
}
