import { aiSuggest } from "./ai-backend.js";
import { accountsFor, gstLookups, invoiceBalanceMap, nothingHasAnswered, unregisteredCode } from "./books.js";
import { classificationToRate, knownCodes, rateLabel, suggest } from "./reconcile.js";
import type { GstRate } from "./reconcile.js";
import type { Suggestion } from "./reconcile.js";
import { state } from "./state.js";
import {
  accountEntityKey,
  accountForBusiness,
  askAbout,
  businessOf,
  describeBusiness,
  briefing,
  directionCaution,
  emptyEntityModel,
  invoiceCandidates,
  keywordFor,
  splitAccountLabel,
  labelForCode,
  parseSuggestions,
  wholePrompt,
} from "@nzosa/core";
import type { AiSuggestion, AskedAbout, EntityKind, JevOption } from "@nzosa/core";

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

/**
 * The most in one call, for somebody spending their own money.
 *
 * The twenty above is the shared key's, where a trial that can be emptied in
 * ten presses is not one. On a key of their own the only reasons to keep a
 * batch small are reading the answers and the attention a model gives each
 * line -- both of which hold at a hundred.
 */
export const AI_OWN_BATCH = 100;

/** What came back, by transaction. Emptied by a reload, and that is right. */
const found = new Map<string, AiSuggestion>();

export function aiSuggestionFor(id: string): AiSuggestion | undefined {
  return found.get(id);
}

export function aiSuggestionCount(): number {
  return found.size;
}

/** Every suggestion held, to keep beside the books between openings. */
export function allAiSuggestions(): AiSuggestion[] {
  return [...found.values()];
}

/**
 * Put back suggestions kept from earlier -- the morning run's, or the last
 * session's -- for the lines still waiting, and only where the account is one
 * these books still have. A line answered since, or an account since removed,
 * is not brought back to life by a note written before it.
 */
export function restoreAiSuggestions(kept: readonly AiSuggestion[]): number {
  const waiting = new Set(waitingForAnswers().map((one) => one.transaction.id));
  const labels = knownCodes(state.rules, state.ledger.overrides ?? {}, state.chart);
  let back = 0;
  for (const one of kept) {
    if (!waiting.has(one.id) || found.has(one.id)) continue;
    const label = labelForCode(splitAccountLabel(one.code).code || one.code, labels);
    if (label === null) continue;
    found.set(one.id, { ...one, code: label });
    back += 1;
  }
  return back;
}

/** Told whenever a model's answers arrive, so they can be kept. */
let keeper: ((all: AiSuggestion[]) => void) | null = null;

export function keepAiSuggestionsWith(keep: (all: AiSuggestion[]) => void): void {
  keeper = keep;
}

export function forgetAiSuggestions(): void {
  found.clear();
  directoryFor = null;
}

/** Where a suggestion came from when it was the list of known businesses. */
export const DIRECTORY_VIA = "NZ business list";

/** Account types money spent can be coded to. */
const SPENDING = /expense|overhead|direct cost|cost of sales|depreciation/i;

let directoryFor: { ledger: unknown; chart: unknown } | null = null;

/**
 * Suggest accounts from the list of well-known New Zealand businesses, for
 * the lines nothing else has answered -- before any model is asked, and free.
 *
 * Only money spent, and only where what the business sells settles the
 * account and the chart has exactly one account that fits: fuel to the one
 * motor vehicle account, a phone plan to the one telephone account. Never on
 * a personal entity's account, where the answer is drawings, not a cost.
 * Where the bank account serves several entities it is left alone, because
 * which entity's account is the question a list cannot answer.
 *
 * Kept with the model's suggestions, as a proposal to accept or change, and
 * so a line answered here is not paid for again by asking a model.
 */
export function suggestFromDirectory(): number {
  if (directoryFor !== null && directoryFor.ledger === state.ledger && directoryFor.chart === state.chart) return 0;
  directoryFor = { ledger: state.ledger, chart: state.chart };
  const model = state.ledger.entities ?? emptyEntityModel();
  const byId = new Map(model.entities.map((entity) => [entity.id, entity]));
  const labels = knownCodes(state.rules, state.ledger.overrides ?? {}, state.chart);
  const spending = state.chart.filter((account) => SPENDING.test(account.type ?? "") && account.code.trim() !== "");
  let got = 0;
  for (const one of waitingForAnswers()) {
    if (one.transaction.amount >= 0) continue;
    const business = businessOf(one.transaction);
    if (business === null) continue;
    const serves = model.banks[one.transaction.account] ?? [];
    if (serves.length > 1) continue;
    const owner = serves.length === 1 ? byId.get(serves[0]!) : undefined;
    if (owner?.kind === "personal") continue;
    const own =
      owner === undefined
        ? []
        : spending.filter((account) => model.accounts[accountEntityKey(account)] === owner.id);
    const pool = own.length > 0 ? own : model.entities.length <= 1 ? spending : [];
    const code = accountForBusiness(
      business,
      pool.map((account) => ({ label: account.code.trim(), name: account.name })),
      paidInForeignCurrency(one.transaction),
    );
    if (code === null) continue;
    const label = labelForCode(code, labels);
    if (label === null) continue;
    found.set(one.transaction.id, {
      id: one.transaction.id,
      code: label,
      confidence: 1,
      because: describeBusiness(business),
      via: DIRECTORY_VIA,
    });
    got += 1;
  }
  return got;
}

/** Every line, coded the way the Reconcile page codes them: rules first. */
export function allLines(): Suggestion[] {
  return suggest(
    state.ledger.transactions,
    state.rules,
    state.ledger.overrides ?? {},
    accountsFor([]),
    unregisteredCode(),
    gstLookups(),
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
  const model = state.ledger.entities ?? emptyEntityModel();
  // Whose money it is, beside the account it came from. The bank account's
  // number told the model nothing, so a grocery line on the household's card
  // could have been anybody's -- and it said so, by answering nothing, on
  // seventeen lines of twenty. The owner is what narrows the chart to the
  // accounts that could be right.
  const owners = (account: string): string => {
    const names = (model.banks[account] ?? [])
      .map((id) => model.entities.find((e) => e.id === id)?.name)
      .filter((name): name is string => name !== undefined);
    if (names.length === 0 && model.entities.length === 1) return model.entities[0]?.name ?? "";
    return names.length === 1 ? `${names[0]}'s account` : names.length > 1 ? `shared by ${names.join(" and ")}` : "";
  };
  // The consent screen promises never a bank account number, and the account
  // a line came from is usually one. Its last digits are enough to tell two
  // of them apart; the owner beside it says what matters.
  const masked = (label: string): string => {
    const digits = label.replace(/[^0-9]/g, "");
    return /^\d{2}-?\d{4}-?\d{7}-?\d{2,3}$/.test(label.trim()) || digits.length >= 12
      ? `account \u2026${label.trim().slice(-6)}`
      : label;
  };
  const labels = new Map(
    state.ledger.transactions.map((t) => {
      const label = masked(String(t.extras?.["accountLabel"] ?? t.account));
      const whose = model.entities.length > 1 ? owners(t.account) : "";
      return [t.id, whose === "" ? label : `${label} (${whose})`];
    }),
  );
  const asked = lines
    .slice(0, Math.max(1, howMany))
    .map((one) => {
      const asked = askAbout(one.transaction, labels.get(one.transaction.id) ?? "");
      // What the business is, where the list of well-known ones knows it: one
      // note for this line, never the list.
      const business = businessOf(one.transaction);
      return business === null ? asked : { ...asked, known: describeBusiness(business) };
    });

  const books = {
    ...briefing(model, state.chart, (entity) => entity.about ?? ""),
    about: state.ledger.booksAbout ?? "",
  };
  // Work already done, as worked examples.
  // The payees being asked about first, latest first, and each with the GST
  // it was coded with. It was the first forty payees ever confirmed, whoever
  // they were: the PayPal lines went unanswered with five PayPal codings in
  // the books, and a Wise payment coded without GST came back at 15%.
  const asking = new Set(
    lines.slice(0, Math.max(1, howMany)).map((one) => leadWord(one.transaction)).filter((w) => w !== ""),
  );
  const confirmed = allLines()
    .filter((one) => one.confirmed && (one.code ?? "").trim() !== "")
    .sort((a, b) => b.transaction.date.localeCompare(a.transaction.date));
  const coded = [
    ...confirmed.filter((one) => asking.has(leadWord(one.transaction))),
    ...confirmed.filter((one) => !asking.has(leadWord(one.transaction))),
  ].map((one) => ({
    payee: one.transaction.otherParty,
    code: `${one.code ?? ""} (${rateLabel(one.classification)})`,
  }));

  return {
    prompt: wholePrompt(books, asked, coded),
    asked,
    codes: books.accounts.map((account) => account.code),
  };
}

/**
 * A receipt suggested as income that looks like it pays an open invoice.
 *
 * Suggested as Sales, a payment for a course already invoiced records the
 * income twice -- once on the invoice, once on the bank line -- and leaves the
 * invoice owing. The invoice matcher already scores which invoices a line
 * could be paying; where it finds one, the suggestion says so and is held
 * back from Accept all, for somebody to choose the invoice instead.
 */
function invoiceCaution(id: string, type: string): string | undefined {
  if (!/revenue|income|sales/i.test(type)) return undefined;
  const transaction = state.ledger.transactions.find((t) => t.id === id);
  if (transaction === undefined || transaction.amount <= 0) return undefined;
  const best = invoiceCandidates(transaction, {
    invoices: state.ledger.invoices ?? [],
    balances: invoiceBalanceMap(),
  })[0];
  return best === undefined
    ? undefined
    : `may settle ${best.number}: choose it under "Settles which invoice?"`;
}

/** The first word of what identifies a payee: "PAYPAL", "WISE", "GARMIN". */
function leadWord(transaction: Suggestion["transaction"]): string {
  return keywordFor(transaction).split(" ")[0] ?? "";
}

/** Money that left in another currency, as the bank writes it: "USD3900". */
const FOREIGN = /\b(USD|AUD|EUR|GBP|CAD|KRW|JPY|SGD|HKD|CNY|CHF|THB)\s?\d/;

export function paidInForeignCurrency(transaction: Suggestion["transaction"]): boolean {
  return FOREIGN.test(
    [transaction.otherParty, transaction.particulars, transaction.code, transaction.reference].join(" "),
  );
}

/**
 * The GST rate for a suggested account, from how this payee was coded before.
 *
 * The same payee on the same account, most recent first: a Wise payment for
 * stock was coded without GST every time, and suggesting Cost of Goods Sold at
 * the account's 15% undid that. With no history, a line paid in another
 * currency is an overseas supplier, where NZ GST is charged only sometimes --
 * 0% until the receipt says otherwise. Null leaves it to the account.
 */
export function rateForSuggestion(
  transaction: Suggestion["transaction"],
  code: string,
): { rate: GstRate; why: string } | null {
  const lead = leadWord(transaction);
  if (lead !== "") {
    const before = allLines()
      .filter(
        (one) =>
          one.confirmed &&
          one.code === code &&
          one.transaction.id !== transaction.id &&
          leadWord(one.transaction) === lead,
      )
      .sort((a, b) => b.transaction.date.localeCompare(a.transaction.date))[0];
    if (before !== undefined) {
      return { rate: classificationToRate(before.classification), why: `as ${before.transaction.date}'s was` };
    }
  }
  if (paidInForeignCurrency(transaction)) {
    return { rate: "0", why: "paid overseas: 0% unless the receipt shows NZ GST" };
  }
  return null;
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
  // The free answers first, so a model is never paid to name the account a
  // power company's bill goes to.
  if (suggestFromDirectory() > 0) lines = lines.filter((one) => !found.has(one.transaction.id));
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
  howMany = AI_BATCH,
  /** Who to ask: the books' own route, unless the morning run says otherwise. */
  ask: typeof aiSuggest = aiSuggest,
): Promise<{ got: number; said: string }> {
  const { prompt, asked, codes } = whatWouldBeAsked(lines, howMany);
  if (asked.length === 0) return { got: 0, said: "Nothing is waiting to be asked about." };

  const detail = perLineDetail(lines.slice(0, Math.max(1, howMany)), codes);
  const answer = await ask(prompt, asked.length, {
    lines: asked.map((one, index) => ({ ...one, ...detail[index] })),
    codes,
    about: state.ledger.booksAbout ?? "",
  });
  if (answer.error !== undefined) return { got: 0, said: answer.error };
  // Where the answer came from matters a year later: a suggestion made on the
  // shared key was made on a model somebody else chose and paid for.
  const kept = keepWhatIsUsable(answer.text ?? "", asked, codes, answer.demo === true ? "shared key" : undefined);
  if (kept.got > 0) keeper?.(allAiSuggestions());
  return kept;
}

const KIND_WORDS: Record<EntityKind, string> = {
  business: "business",
  residential: "residential rental",
  commercial: "commercial rental",
  personal: "personal",
};

/**
 * What a provider asked about each line on its own (Jev) is told beyond the
 * prompt's fields.
 *
 * Its choices: the accounts of the entities the line's bank account serves,
 * each with its type and entity -- a rental's line chooses among the
 * rental's accounts, not between three identically named "Rates and water".
 * Whose account it is, with what each entity does in the owner's words. And
 * how the same payee was coded before, which is the strongest evidence
 * there is. A provider given the whole prompt ignores all of this.
 */
function perLineDetail(
  picked: readonly Suggestion[],
  codes: readonly string[],
): { options: JevOption[]; context: string; examples: string[] }[] {
  const model = state.ledger.entities ?? emptyEntityModel();
  const byId = new Map(model.entities.map((entity) => [entity.id, entity]));
  // The chart's own name and type for each code: the list asked about may be
  // bare codes, and a choice between "489" and "493" is no choice at all.
  const chartOf = new Map(state.chart.map((account) => [account.code.trim(), account]));
  const accounts = codes.map((label) => {
    const { code, name } = splitAccountLabel(label);
    const entityId = model.accounts[accountEntityKey({ code, name })];
    const entity = entityId === undefined ? undefined : byId.get(entityId);
    const account = chartOf.get(code);
    const named = account?.name ?? (name !== code ? name : "");
    const about = [
      [named, account?.type ?? ""].filter((part) => part !== "").join(" — "),
      entity === undefined ? "" : `${entity.name}, ${KIND_WORDS[entity.kind ?? "business"]}`,
    ]
      .filter((part) => part !== "")
      .join("; ");
    return { label, entityId, about };
  });
  // The first two words of the payee: one word ("PAYMENT") pairs strangers.
  const lead = (words: string): string => words.split(" ").slice(0, 2).join(" ");
  const history = allLines()
    .filter((one) => one.confirmed && (one.code ?? "") !== "")
    .map((one) => ({ key: lead(keywordFor(one.transaction)), payee: one.transaction.otherParty.trim(), code: one.code ?? "" }));

  return picked.map((one) => {
    const serves = model.banks[one.transaction.account] ?? [];
    const own = accounts.filter((a) => a.entityId !== undefined && serves.includes(a.entityId));
    const options = (own.length >= 2 ? own : accounts).map(({ label, about }) => ({ label, about }));
    // By code: a coding is stored as "Rates and water - 420", the choices may
    // be bare codes, and the two have to be recognised as the same account.
    const codeOf = (label: string): string => splitAccountLabel(label).code || label;
    const allowed = new Set(options.map((option) => codeOf(option.label)));
    const owners = serves.map((id) => byId.get(id)).filter((entity) => entity !== undefined);
    const context =
      owners.length === 0
        ? ""
        : "This bank account belongs to " +
          owners
            .map(
              (entity) =>
                `${entity.name} (${KIND_WORDS[entity.kind ?? "business"]})` +
                ((entity.about ?? "").trim() !== "" ? `: ${(entity.about ?? "").trim()}` : ""),
            )
            .join("; ") +
          ".";
    const key = lead(keywordFor(one.transaction));
    const examples =
      key.length < 6 || !key.includes(" ")
        ? []
        : [
            ...new Map(
              history
                .filter((h) => h.key === key && allowed.has(splitAccountLabel(h.code).code || h.code))
                .map((h) => [h.code, `${h.payee} was coded to ${h.code}`]),
            ).values(),
          ].slice(0, 5);
    return { options, context, examples };
  });
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
  let blank = 0;
  for (const one of back) {
    // A blank is the model saying it does not know, which is worth nothing on
    // a queue of things to decide, and is not an invented account either.
    if (one.code === "") {
      blank += 1;
      continue;
    }
    const label = labelForCode(one.code, labels);
    if (label === null) {
      invented += 1;
      continue;
    }
    const caution =
      [
        directionCaution(facing.get(one.id) ?? "", typeOf.get(one.code) ?? ""),
        invoiceCaution(one.id, typeOf.get(one.code) ?? ""),
      ]
        .filter((part) => part !== undefined)
        .join("; ") || undefined;
    found.set(one.id, {
      ...one,
      code: label,
      ...(caution !== undefined ? { caution } : {}),
      ...(via !== undefined ? { via } : {}),
    });
    got += 1;
  }
  // Said, because silence read as a fault: twenty asked, three shown, and
  // nothing to say the other seventeen were the model declining to guess.
  const unsure =
    blank === 0
      ? ""
      : `${blank} of ${back.length} came back without an account: the model was not sure ` +
        "enough to name one. Those lines are still waiting, for you or for a later ask.";
  return {
    got,
    said:
      back.length === 0
        ? "Nothing there could be read as an answer. Nothing has changed."
        : got === 0 && blank === 0
          ? `Read ${back.length}, and none of them named an account these books have.`
          : [
              invented === 0
                ? ""
                : `${invented} of ${back.length} named an account these books do not have, and ` +
                  "were thrown away. The rest are on the lines they belong to.",
              unsure,
            ]
              .filter((part) => part !== "")
              .join(" "),
  };
}
