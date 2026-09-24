import type { Account } from "./chart.js";
import type { Entity, EntityModel } from "./entities.js";
import type { Cents } from "./money.js";
import type { Transaction } from "./types.js";

/**
 * Asking a model what an unrecognised transaction is.
 *
 * Everything here is text in and text out. Nothing in this file talks to
 * anybody: it builds what would be asked and reads what came back, so the
 * whole of it can be tested without a network, a key, or a bill.
 *
 * Two rules shape the design.
 *
 * The rules engine goes first, always. A rule is deterministic, free, written
 * down, and yours; a model is none of those. So only what no rule and no
 * default matched is ever described to anybody, which is also what keeps both
 * the cost and the disclosure small -- and it shrinks every time a suggestion
 * is accepted and becomes a rule.
 *
 * And a suggestion is a suggestion. What comes back is a proposal in the same
 * shape the rules produce, to be accepted, changed or thrown away by somebody
 * who can see why it was made. Nothing here writes to a ledger.
 */

/** What is known about the books, written once and sent with every batch. */
export interface BooksBriefing {
  /** Free text: what this entity does, in the owner's own words. */
  about: string;
  entities: readonly BriefedEntity[];
  /** Chart accounts the model may choose from. */
  accounts: readonly BriefedAccount[];
}

export interface BriefedEntity {
  name: string;
  kind: string;
  gstRegistered: boolean;
  about: string;
}

export interface BriefedAccount {
  code: string;
  name: string;
  type: string;
  entity: string;
}

/** One transaction, reduced to what a model needs to recognise it. */
export interface AskedAbout {
  id: string;
  date: string;
  /**
   * Which way the money went, in words.
   *
   * A sign can be missed, and was: $800 in from a customer came back coded to
   * Salaries, because a minus is one character and a person's name is a
   * strong hint. Two words cannot be overlooked in the same way.
   */
  direction: "money in" | "money out";
  /** Dollars, unsigned. The direction above is what says which way. */
  amount: string;
  payee: string;
  details: string;
  /** Which of these books' accounts it came from, by label rather than number. */
  paidFrom: string;
}

/** What a model proposed for one transaction. */
export interface AiSuggestion {
  id: string;
  /** A chart code, or empty when the model would not say. */
  code: string;
  /** How sure, 0 to 1. Anything it did not give comes back as 0. */
  confidence: number;
  /** One line, in its words, for somebody deciding whether to accept it. */
  because: string;
  /** Something about it that does not sit right, for the person reading it. */
  caution?: string;
  /** Where it came from, when that is not the configured model. */
  via?: string;
}

/**
 * Which transactions have nobody's answer yet.
 *
 * A null code is the rules engine saying nothing matched -- no rule, no
 * default, no override. A confirmed line has a person's answer on it, whatever
 * the rules think. Everything else in these books has already been answered by
 * something, and asking about it would be paying to be told what is written
 * down.
 */
export function unmatched<T extends { code: string | null; confirmed: boolean }>(
  suggestions: readonly T[],
): T[] {
  return suggestions.filter((one) => one.code === null && !one.confirmed);
}

function dollars(cents: Cents): string {
  const sign = cents < 0 ? "-" : "";
  const whole = Math.abs(cents);
  return `${sign}${Math.floor(whole / 100)}.${String(whole % 100).padStart(2, "0")}`;
}

/**
 * Words a bank puts in the payee field instead of a payee.
 *
 * An internet transfer arrives with "Payment" where the counterparty should
 * be, and the person's name in the particulars. Left alone, every transfer in
 * a year looks like the same payee -- so nothing learned from one of them
 * applies to the next, and the model is handed the word "Payment" and asked
 * who it was.
 */
const BANK_WORDS =
  /^(payment|transfer|deposit|direct credit|direct debit|internet xfr|automatic payment|credit|debit|withdrawal|bill payment|pos w\/d|eftpos)$/i;

/** What the bank said, with the empty fields left out rather than sent as blanks. */
export function askAbout(transaction: Transaction, paidFrom: string): AskedAbout {
  const parts = [transaction.particulars, transaction.code, transaction.reference]
    .map((part) => part.trim())
    .filter((part) => part !== "");
  const said = transaction.otherParty.trim();
  // The first thing in the particulars is the counterparty, where the payee
  // field holds only the bank's word for what kind of transaction it was.
  const payee = said === "" || BANK_WORDS.test(said) ? (parts[0] ?? said) : said;
  return {
    id: transaction.id,
    date: transaction.date,
    direction: transaction.amount < 0 ? "money out" : "money in",
    amount: dollars(Math.abs(transaction.amount)),
    payee,
    details: parts.join(" · "),
    paidFrom,
  };
}

/**
 * What these books are, said once.
 *
 * Assembled here and sent with every batch, because a model is asked and
 * answers and remembers nothing: there is no setting it up once. What that
 * makes possible instead is better -- the briefing is a thing on disk that can
 * be read, corrected and argued with before it is ever sent, rather than
 * something a model was told in a conversation nobody kept.
 *
 * The entity's kind and registration are in it because they change the right
 * answer, not just the wording. A residential rental's losses are ring-fenced,
 * so a suggestion that treats one as an ordinary deduction is wrong; an
 * unregistered entity cannot claim GST back, so a suggestion that assumes it
 * can is wrong twice.
 */
export function briefing(
  model: EntityModel,
  chart: readonly Account[],
  about: (entity: Entity) => string,
): BooksBriefing {
  const named = new Map(model.entities.map((entity) => [entity.id, entity.name]));
  return {
    about: "",
    entities: model.entities.map((entity) => ({
      name: entity.name,
      kind: entity.kind ?? "business",
      gstRegistered: entity.gstRegistered !== false,
      about: about(entity).trim(),
    })),
    accounts: chart
      .filter((account) => account.code.trim() !== "")
      .map((account) => ({
        code: account.code.trim(),
        name: account.name.trim(),
        type: account.type.trim(),
        entity: named.get(account.entity ?? "") ?? "",
      })),
  };
}

/** How an entity's kind changes what an answer may say. */
function kindRule(kind: string): string {
  if (kind === "residential") {
    return "residential rental: losses are ring-fenced against that property's own income";
  }
  if (kind === "commercial") return "commercial rental: not ring-fenced";
  if (kind === "personal") return "personal affairs: most spending is not deductible at all";
  return "business";
}

/**
 * The instruction the model is given, in front of every batch.
 *
 * Long, and deliberately so: everything in it is a way the answer could be
 * wrong in a way somebody would not notice. Being told to pick from the chart
 * rather than invent an account name is what makes the answer usable at all;
 * being told to say when it does not know is what makes the confident ones
 * worth reading.
 */
export function instructions(books: BooksBriefing): string {
  const lines: string[] = [
    "You are helping code bank transactions in a New Zealand set of books.",
    "",
    "Rules:",
    "- Choose one account code from the chart below. Never invent a code or a name.",
    "- direction is the first thing to read. \"money in\" is money the entity received;",
    "  \"money out\" is money it paid. Money in is normally revenue, or a balance sheet",
    "  account such as a loan or a shareholder advance -- not an expense. Code money in to",
    "  an expense account only when it is plainly a refund of that expense, and say so.",
    "  Money out is almost never revenue.",
    "- Code by who the counterparty is and what the reference says. The size of the amount",
    "  is not a reason on its own: $800 is a week's wages, a month's rent or an invoice,",
    "  and which of those it is does not depend on it being $800.",
    "- If nothing in the chart fits, or the counterparty is too vague to place, return an",
    "  empty code rather than a guess. An unanswered line costs a moment; a wrong one",
    "  coded confidently is found at year end, if at all. A payment from a person could be",
    "  a customer, a loan, or an owner putting money in: if the books do not say which,",
    "  neither should you.",
    "- Reply with JSON only: an array of {id, code, confidence, because}.",
    "  confidence is 0 to 1. because is one short sentence naming what in the",
    "  transaction led you there.",
    "",
  ];

  if (books.about.trim() !== "") {
    lines.push("About these books:", books.about.trim(), "");
  }

  if (books.entities.length > 0) {
    lines.push("Entities in these books:");
    for (const entity of books.entities) {
      const registered = entity.gstRegistered ? "GST registered" : "not GST registered";
      lines.push(
        `- ${entity.name} (${kindRule(entity.kind)}; ${registered})` +
          (entity.about === "" ? "" : `: ${entity.about}`),
      );
    }
    lines.push("");
  }

  lines.push("Chart of accounts:");
  for (const account of books.accounts) {
    lines.push(
      `- ${account.code} ${account.name} [${account.type}]` +
        (account.entity === "" ? "" : ` (${account.entity})`),
    );
  }
  return lines.join("\n");
}

/** Transactions that were coded this way before, as worked examples. */
export function examples(
  coded: readonly { payee: string; code: string }[],
  limit = 40,
): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const one of coded) {
    const payee = one.payee.trim();
    if (payee === "" || one.code.trim() === "") continue;
    const key = payee.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`- ${payee} -> ${one.code.trim()}`);
    if (lines.length >= limit) break;
  }
  return lines.length === 0 ? "" : ["How similar payees were coded before:", ...lines].join("\n");
}

/** The whole of what would be sent, so a person can read it before it is. */
export function wholePrompt(
  books: BooksBriefing,
  asked: readonly AskedAbout[],
  coded: readonly { payee: string; code: string }[] = [],
): string {
  const worked = examples(coded);
  return [
    instructions(books),
    ...(worked === "" ? [] : ["", worked]),
    "",
    "Transactions to code:",
    JSON.stringify(asked, null, 1),
  ].join("\n");
}

/**
 * The account these books call that code.
 *
 * A model is asked for a chart code because a number is short, unambiguous
 * and cheap to check. What this app codes to is not a number: it is a label,
 * "ACC Levy Expenses - 401", and writing the bare 401 would post to an
 * account of that name which nothing else in the books has ever heard of --
 * a report keyed on labels would show it as a separate line, and the account
 * it was meant for would be short by exactly that much.
 *
 * So the number is translated back, and a number that translates to nothing,
 * or to more than one thing, is refused. Refused rather than guessed at: two
 * accounts ending in the same number is a chart somebody has to look at, and
 * picking one of them here would hide that from them.
 */
export function labelForCode(code: string, labels: readonly string[]): string | null {
  const wanted = code.trim().toLowerCase();
  if (wanted === "") return null;
  const hits = labels.filter((label) => {
    const at = label.lastIndexOf(" - ");
    if (at < 0) return label.trim().toLowerCase() === wanted;
    return label.slice(at + 3).trim().toLowerCase() === wanted;
  });
  return hits.length === 1 ? (hits[0] ?? null) : null;
}

/**
 * Money in, coded to an expense. Worth a second look rather than a refusal.
 *
 * A refund from a supplier is money in coded to the expense it refunds, and
 * that is correct: refusing it would throw away right answers to catch wrong
 * ones. But money in to an expense account is also exactly what the mistake
 * looks like -- a customer payment filed as Salaries -- so it is marked for
 * the person reading it rather than silently allowed or silently dropped.
 */
export function directionCaution(
  direction: string,
  accountType: string,
): string | undefined {
  const type = accountType.trim().toLowerCase();
  const spending = /expense|overhead|direct costs|cost of sales/.test(type);
  const earning = /revenue|income|sales/.test(type);
  if (direction === "money in" && spending) {
    return "Money in, coded to an account money normally goes out of. Right for a refund, wrong for anything else.";
  }
  if (direction === "money out" && earning) {
    return "Money out, coded to an income account. Right for a refund to a customer, wrong for anything else.";
  }
  return undefined;
}

/**
 * Read what came back, expecting it to be wrong.
 *
 * A model can return prose around its JSON, a code that is not in the chart,
 * a confidence of "high", or an id for a transaction nobody asked about. None
 * of those should reach a ledger, and none of them should throw either: an
 * unreadable answer is a batch with no suggestions in it, which is the same
 * as not having asked.
 */
export function parseSuggestions(
  text: string,
  options: { asked: readonly string[]; codes: readonly string[] },
): AiSuggestion[] {
  const known = new Set(options.codes.map((code) => code.trim()));
  const wanted = new Set(options.asked);

  // Models wrap JSON in prose, and in ```json fences, and sometimes in both.
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const found: AiSuggestion[] = [];
  const answered = new Set<string>();
  for (const row of parsed) {
    if (typeof row !== "object" || row === null) continue;
    const one = row as Record<string, unknown>;
    const id = typeof one["id"] === "string" ? one["id"] : "";
    // Only what was asked about, and only once each.
    if (!wanted.has(id) || answered.has(id)) continue;

    const code = typeof one["code"] === "string" ? one["code"].trim() : "";
    // A code that is not in the chart is not an answer, whatever it says
    // about it. Kept as an unanswered line rather than dropped, so the count
    // of what came back matches the count of what was asked.
    const real = known.has(code) ? code : "";
    // A number, or a number written as text -- Gemini wrote "0.95" in quotes on a
    // real run, which read as no confidence at all.
    const raw = one["confidence"];
    const asNumber =
      typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
    const confidence = Number.isFinite(asNumber) && asNumber >= 0 && asNumber <= 1 ? asNumber : 0;
    const because = typeof one["because"] === "string" ? one["because"].trim() : "";

    answered.add(id);
    found.push({
      id,
      code: real,
      confidence: real === "" ? 0 : confidence,
      because:
        real === "" && code !== ""
          ? `Suggested ${code}, which is not in this chart of accounts.`
          : because,
    });
  }
  return found;
}
