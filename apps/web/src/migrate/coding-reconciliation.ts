import { moduleOn } from "../modules.js";
import { matchSuggestions, wireSheetAi } from "./sheet-ai.js";
import { redraw, showPage } from "../app.js";
import {
  AI_BATCH,
  AI_OWN_BATCH,
  aiSuggestionFor,
  askAboutLines,
  rateForSuggestion,
  waitingForAnswers,
} from "../ai.js";
import { aiRoute, aiStatus } from "../ai-backend.js";
import { aiAllowed, isDemoBuild } from "../ai-consent.js";
import { AI_CHANGED } from "../ai-key-panel.js";
import { carrySection } from "../ai-carry.js";
import {
  unregisteredCode,
  accountDecided,
  bankLabel,
  codingRefusedForTransfer,
  accountsFor,
  ensureDefaultEntity,
  invoiceAssignments,
  unpairTransfer,
  mapToOurVocabulary,
  persistRules,
  reclassify,
  record,
  sameEntityBanks,
  shownSuggestions,
  tidyChart,
  ruleCaution,
  gstLookups,
  accountRate,
} from "../books.js";
import {
  compareCodings,
  inferAccountMapping,
  loadReference,
  readChosenColumns,
} from "../check-ui.js";
import type { CodingBatchEntry } from "../events.js";
import { fillAccounts } from "../widgets.js";
import { combobox } from "../combobox.js";
import { autoLinkBankRows, startNewAccount } from "../daily/entities.js";
import { knownCodes, rateLabel, rateToClassification, suggest, transferCandidates } from "../reconcile.js";
import type { Suggestion } from "../reconcile.js";
import type { AiSuggestion, GstSide, GstTreatment } from "@nzosa/core";
import type { RuleFileShape } from "../rules-ui.js";
import { $, state } from "../state.js";
import { save, savePart } from "../store.js";
import { amountCell, download, nameCell, note } from "../ui.js";
import {
  accountEntityKey,
  accountTreatment,
  coverage,
  dedupeReference,
  emptyEntityModel,
  entityId,
  formatAmount,
  inferRules,
  labelForChartAccount,
  parseOwners,
} from "@nzosa/core";
import type {
  Account,
  CodedExample,
  CodingRow,
  EntityKind,
  ReferenceLine,
  ReferencePart,
  RuleProposal,
  RuleSet,
  SheetRows,
  SplitPart,
  Transaction,
} from "@nzosa/core";
import { clearCheck } from "../migrate/file-intake.js";

/** What the imported coding is called, mid-sentence: Xero, or the spreadsheet these books came from. */
const imported = (): string => (moduleOn("xero") ? "Xero" : moduleOn("sheet") ? "the spreadsheet" : "the import");
/** The same, starting a heading or a button. */
const Imported = (): string => { const said = imported(); return said.charAt(0).toUpperCase() + said.slice(1); };

/**
 * Import reconciliation: agreeing this ledger with the one it came from.
 *
 * Books arrive from somewhere else, and the first job is not to code them but
 * to find where the two systems disagree. Which lines the old system coded and
 * this one has not, which it split and this one did not, where the GST rate
 * differs, which accounts in the incoming chart have no counterpart here. Each
 * difference is shown with both answers and a button to take one.
 *
 * It is a migration screen, and that is why it is a module of its own. Nothing
 * here runs once the books are in: a ledger being kept day to day has no other
 * system to agree with, and none of this is reachable from the coding queue,
 * the reports or a GST return. Someone auditing what this tool does with money
 * every day can skip the file; someone checking that a migration was faithful
 * has it in one place rather than spread through main.ts.
 *
 * Taking an answer is a decision, not an import: it writes a confirmed
 * override with a note saying where it came from, exactly as accepting a
 * suggestion by hand does, so a return built afterwards can be defended
 * without knowing which screen made the entry.
 */

/**
 * Accept every suggestion currently on screen.
 *
 * The point is the search box: narrow to one payee, see that the suggestion is
 * right for all of them, and say so once instead of forty times. The filter
 * and the search decide what "on screen" means, so this only ever accepts what
 * you are looking at.
 *
 * Lines with no suggestion are skipped rather than confirmed blank. Accepting
 * nothing is not a decision, and a line no rule could code is exactly the one
 * that deserves a person's attention.
 */
/**
 * Record a batch of transfers, each as its own entry in the change log.
 *
 * One entry apiece rather than one for the batch, because a transfer is
 * undone one at a time everywhere else in this app and a batch that could
 * only be undone whole would be the odd one out.
 */
async function pairAll(pairs: readonly { out: Transaction; into: Transaction }[]): Promise<void> {
  const transfers = { ...(state.ledger.transfers ?? {}) };
  for (const { out, into } of pairs) {
    transfers[out.id] = into.id;
    transfers[into.id] = out.id;
  }
  state.ledger = { ...state.ledger, transfers };
  state.persistent = await savePart(state.ledger, "transfers");

  for (const { out, into } of pairs) {
    await record(
      "transfer",
      `${out.date} ${formatAmount(out.amount)} \u2014 transfer from ` +
        `${bankLabel(out.account)} to ${bankLabel(into.account)}`,
      null,
      { from: out.id, to: into.id },
      out.id,
    );
  }
}

export async function acceptAllShown(): Promise<void> {
  /**
   * A suggestion is not only a code.
   *
   * "Suggested, not yet confirmed" gathers lines settled by a split or matched
   * to an invoice as well as lines a rule coded, because all three are waiting
   * to be agreed to -- and the tick confirms all three. This did not: it took
   * only the ones with a code, so accepting a screen left the split and
   * invoice lines sitting on it, still listed as waiting, to be ticked one at
   * a time. Which is the work the button exists to save.
   */
  const splits = state.ledger.splits ?? {};
  const invoices = invoiceAssignments();
  const settledElsewhere = (one: Suggestion): boolean =>
    splits[one.transaction.id] !== undefined || invoices.has(one.transaction.id);

  /**
   * What a model proposed counts as a suggestion too.
   *
   * It is not in `one.code`, and deliberately: nothing in the books has
   * answered these lines, and a proposal nobody has agreed to is not written
   * into them. The row paints it into the account picker and the tick saves
   * it. This knew nothing about any of that, so a screen filtered to "AI
   * suggested" -- twelve lines, each showing an account -- met "nothing on
   * screen to accept", which is the third kind of suggestion this button has
   * been blind to while looking straight at it.
   *
   * One kind is held back. A suggestion carrying a caution is money moving the
   * opposite way to the account it names, which is why that row is red; swept
   * up in a batch, the red would have been for nothing.
   */
  const modelSaid = (one: Suggestion): AiSuggestion | undefined =>
    one.code === null ? aiSuggestionFor(one.transaction.id) : undefined;
  // A rule's suggestion running against the money is held back the same way.
  const codeFor = (one: Suggestion): string | null => {
    if (one.code !== null) return ruleCaution(one) === undefined ? one.code : null;
    const said = modelSaid(one);
    return said === undefined || said.caution !== undefined || said.code === ""
      ? null
      : said.code;
  };

  const offered = shownSuggestions().filter(
    (one) => !one.confirmed && (codeFor(one) !== null || settledElsewhere(one)),
  );
  const cautioned = shownSuggestions().filter(
    (one) => !one.confirmed && modelSaid(one)?.caution !== undefined,
  ).length;
  const ruleCautioned = shownSuggestions().filter(
    (one) => ruleCaution(one) !== undefined && !settledElsewhere(one),
  ).length;

  /**
   * Lines that are a transfer, or could be one, are left for a person.
   *
   * A line is a transfer or it is coded to an account, never both: posted, the
   * transfer wins and the account silently gets nothing. Accepting a screen in
   * one go is exactly when that went wrong -- on real books two customer
   * receipts were paired with card purchases of the same amount while coded to
   * sales, and the sales left the profit and loss. So the batch neither codes
   * nor pairs a line that has a possible partner. It confirms the rest, and
   * leaves these unconfirmed to be looked at one at a time.
   *
   * A partner that already has an account has been decided as not a transfer,
   * so it holds nothing back; nor does a line already sent back with "not a
   * transfer".
   */
  const transfersNow = state.ledger.transfers ?? {};
  const rejected = new Set(state.ledger.rejectedTransfers ?? []);
  const decided = accountDecided();
  const unavailable = new Set([
    ...Object.keys(transfersNow),
    ...state.ledger.transactions.filter((t) => decided(t.id)).map((t) => t.id),
    // A receipt that settles an invoice is not a movement between your own
    // accounts, whatever else has the same amount on the same day.
    ...invoices.keys(),
  ]);
  const couldBeTransfer = (one: Suggestion): boolean =>
    !rejected.has(one.transaction.id) &&
    transferCandidates(one.transaction, state.ledger.transactions, {
      sameEntity: sameEntityBanks(one.transaction.account).accounts,
      taken: unavailable,
    }).length > 0;

  // A recorded transfer is settled already, and never coded on top.
  const eligible = offered.filter((one) => transfersNow[one.transaction.id] === undefined);
  const held = new Set(eligible.filter(couldBeTransfer).map((one) => one.transaction.id));
  const lines = eligible.filter((one) => !held.has(one.transaction.id));

  /**
   * Transfers proposed and waiting to be agreed to.
   *
   * These are not lines with a coding to accept: nothing coded them, and the
   * only thing their tick does is pair them. So they were not in `offered` at
   * all, and a screen made entirely of them met "nothing on screen to accept",
   * which was both wrong and unhelpful -- there were thirty-two things on it
   * to accept.
   *
   * Only where the matcher found exactly one partner. Two candidates is a
   * question, and a question answered in bulk is a question nobody answered.
   * And only where nothing else has claimed the line, so pairing can never
   * quietly drop a coding -- that is the failure this batch was taught to
   * avoid, and it stays avoided by not touching those lines rather than by
   * asking about them here.
   */
  const shown = shownSuggestions();
  const pairs: { out: Transaction; into: Transaction }[] = [];
  const claimed = new Set<string>();
  for (const one of shown) {
    const id = one.transaction.id;
    if (one.confirmed || one.code !== null) continue;
    // A line a model has answered is not paired here either, whether its
    // answer was taken or held back for its caution. Coding and pairing are
    // the two things a line cannot both be, and choosing between them on
    // somebody's behalf is the whole of what this button must not do.
    if (modelSaid(one) !== undefined) continue;
    if (transfersNow[id] !== undefined || claimed.has(id)) continue;
    if (settledElsewhere(one) || decided(id)) continue;
    if (rejected.has(id)) continue;
    const candidates = transferCandidates(one.transaction, state.ledger.transactions, {
      sameEntity: sameEntityBanks(one.transaction.account).accounts,
      taken: new Set([...unavailable, ...claimed]),
    });
    if (candidates.length !== 1) continue;
    const partner = candidates[0]?.transaction;
    if (partner === undefined || claimed.has(partner.id)) continue;
    claimed.add(id);
    claimed.add(partner.id);
    pairs.push(
      one.transaction.amount < 0
        ? { out: one.transaction, into: partner }
        : { out: partner, into: one.transaction },
    );
  }

  if (lines.length === 0 && pairs.length === 0) {
    alert(
      held.size > 0
        ? `Nothing accepted: the ${held.size === 1 ? "line" : `${held.size} lines`} left could be a ` +
            "transfer with more than one possible match. Check each one individually."
        : "Nothing to accept: every line shown is already settled or has no suggestion.",
    );
    return;
  }

  // A screen of nothing but proposed transfers: its own question, because
  // pairing is not coding and agreeing to it in bulk deserves to be asked for
  // in those words.
  if (lines.length === 0) {
    if (
      !confirm(
        `Pair ${pairs.length} transfer${pairs.length === 1 ? "" : "s"} between your own accounts?` +
          "\n\n" +
          pairs
            .slice(0, 6)
            .map(
              ({ out, into }) =>
                `  ${out.date} ${formatAmount(out.amount)}: ${bankLabel(out.account)} to ${bankLabel(into.account)}`,
            )
            .join("\n") +
          (pairs.length > 6 ? `\n  ...and ${pairs.length - 6} more` : "") +
          "\n\nEach is the same amount the other way between two of your own accounts, within " +
          "four days, with exactly one match. None is coded yet. Undo any with \"not a transfer\".",
      )
    ) {
      return;
    }
    await pairAll(pairs);
    reclassify();
    redraw("reconcile");
    return;
  }

  const accounts = new Set(
    lines.map((one) => codeFor(one)).filter((code): code is string => code !== null),
  );
  const elsewhere = lines.filter((one) => codeFor(one) === null).length;
  const guessed = lines.filter((one) => modelSaid(one) !== undefined).length;
  const summary =
    accounts.size === 0
      ? "settled by their splits or the invoices they pay"
      : accounts.size === 1
        ? `all to ${[...accounts][0]}`
        : `across ${accounts.size} accounts`;
  if (
    !confirm(
      `Accept ${lines.length} suggestion${lines.length === 1 ? "" : "s"}, ${summary}?` +
        "\n\n" +
        (held.size > 0
          ? `${held.size} line${held.size === 1 ? " matches" : "s match"} the same amount in another ` +
            `of your accounts and could be a transfer; ${held.size === 1 ? "it is" : "they are"} ` +
            "left for you to check one at a time.\n\n"
          : "") +
        (elsewhere > 0
          ? `${elsewhere} ${elsewhere === 1 ? "is" : "are"} settled by a split or an invoice ` +
            "and confirmed as that.\n\n"
          : "") +
        (pairs.length > 0
          ? `${pairs.length} proposed transfer${pairs.length === 1 ? " is" : "s are"} also shown. ` +
            "Press Accept all again afterwards to pair them.\n\n"
          : "") +
        // Said out loud, and counted apart from the rules. A rule is
        // something these books were told; a model's answer is something
        // guessed, and agreeing to a screen of them without being told which
        // is which is not agreeing to the same thing.
        (guessed > 0
          ? `${guessed} ${guessed === 1 ? "was" : "were"} suggested by AI rather than a rule, ` +
            "and will be recorded as such.\n\n"
          : "") +
        (cautioned > 0
          ? `${cautioned} AI suggestion${cautioned === 1 ? " is" : "s are"} left out: the ` +
            "money goes the opposite way to the account suggested.\n\n"
          : "") +
        (ruleCautioned > 0
          ? `${ruleCautioned} rule suggestion${ruleCautioned === 1 ? " is" : "s are"} left out: ` +
            "money in to an expense or out of income, correct only for a refund.\n\n"
          : "") +
        "They are confirmed exactly as shown. History can undo the whole batch.",
    )
  ) {
    return;
  }

  const overrides = { ...(state.ledger.overrides ?? {}) };
  const batch: CodingBatchEntry[] = [];
  const today = new Date().toISOString().slice(0, 10);
  for (const one of lines) {
    batch.push({ id: one.transaction.id, before: overrides[one.transaction.id] ?? null });
    const code = codeFor(one);
    const said = modelSaid(one);
    // A model's account is not what the line was classified by -- that was
    // the uncoded default -- so its GST is the account's own, as picking the
    // account by hand would give.
    const history = one.code === null && code !== null ? rateForSuggestion(one.transaction, code) : null;
    const own =
      one.code === null && code !== null
        ? history !== null
          ? rateToClassification(history.rate, one.transaction.amount)
          : accountDefault(code, one.transaction.amount)
        : null;
    overrides[one.transaction.id] = {
      ...(code !== null ? { code } : {}),
      confirmed: true,
      treatment: own?.treatment ?? one.classification.treatment,
      side: own?.side ?? one.classification.side,
      // Read a year later by somebody asking why an account was chosen, where
      // "a rule said so" and "a model guessed, this confidently, because"
      // are not the same answer. Written down at the moment it stops being a
      // suggestion, because the suggestion itself is only in memory and does
      // not survive the reload.
      note:
        said === undefined
          ? (one.description ?? "Suggestion accepted unchanged, with others")
          : "AI suggestion accepted unchanged, with others" +
            (said.via === undefined ? "" : ` (${said.via})`) +
            ` — ${Math.round(said.confidence * 100)}% sure: ${said.because}`,
      at: today,
    };
  }

  state.ledger = { ...state.ledger, overrides };
  state.persistent = await save(state.ledger);
  await record(
    "codingBatch",
    `Accepted ${lines.length} suggestions ${summary}` +
      (guessed > 0 ? ` (${guessed} from the model)` : ""),
    batch,
    null,
  );
  reclassify();
  redraw("reconcile");
}

export async function loadCheckFiles(files: File[]): Promise<void> {
  // The journal report the ledger already holds goes in with the files, so an
  // Account Transactions export loaded on its own is still read knowing which
  // postings belong to which payment.
  const loaded = await loadReference(files, {
    ...(state.ledger.journals ? { journals: state.ledger.journals } : {}),
  });

  // A journal report dropped here is kept, not used once. It is the only file
  // that identifies a payment, and every export loaded afterwards wants it.
  if (loaded.journals.length > 0) {
    state.ledger = { ...state.ledger, journals: loaded.journals };
    state.persistent = await savePart(state.ledger, "journals");
  }

  // The payouts the same file describes. Kept whether or not anything is done
  // with them yet: they are the only record tying a bank line to the invoice,
  // the surcharge and the fee it is really made of.
  if (loaded.payouts.length > 0) {
    state.ledger = { ...state.ledger, payouts: loaded.payouts };
    state.persistent = await savePart(state.ledger);
  }
  // Accumulated, because a year often comes out of the accounting system as
  // several exports and all of them are wanted -- but deduplicated, because
  // loading the same one twice used to double it, and a doubled reference is
  // unusable rather than merely untidy: every transaction then matches two
  // identical rows, nothing is an unambiguous pair, and the account mapping
  // comes back empty, which is the difference between coding suggestions and
  // silence.
  const before = state.reference.length + loaded.lines.length;
  state.reference = dedupeReference([...state.reference, ...loaded.lines]);
  const dropped = before - state.reference.length;
  // Kept with the ledger. The Check page compares against it and the rule
  // suggestions are drawn from it, and neither should need the same export
  // loaded again after every reload.
  state.ledger = { ...state.ledger, reference: state.reference };
  state.persistent = await savePart(state.ledger, "reference");
  if (loaded.chart.length > 0) {
    state.chart = loaded.chart;
    state.ledger = { ...state.ledger, chart: loaded.chart };
    state.persistent = await save(state.ledger);
    await applyChartColumns(loaded.chart);
  }
  await ensureDefaultEntity();
  await tidyChart();
  // Bank rows whose names plainly contain an account these books hold.
  if (loaded.chart.length > 0) await autoLinkBankRows();
  // Payment allocations come out of the same export, so they are taken while
  // it is open rather than asked for again as a separate file. Only when it
  // carries some: loading a workbook or a journal report must not wipe the
  // allocations another file already supplied.
  if (loaded.allocations.length > 0) {
    state.ledger = { ...state.ledger, allocations: loaded.allocations };
    state.persistent = await savePart(state.ledger, "allocations");
  }

  state.checkProblems = loaded.problems;
  // Said rather than done quietly: somebody who loads the same export twice
  // should be told the second one added nothing, not left wondering why the
  // count did not move.
  if (dropped > 0) {
    state.checkProblems = [
      ...state.checkProblems,
      `${dropped} line${dropped === 1 ? "" : "s"} were already loaded from an earlier ` +
        "export and were not added again.",
    ];
  }
  // Files that hold a table nothing could name. Kept so the columns can be
  // pointed out rather than the file refused.
  state.checkUnreadable = loaded.unreadable;

  // Coding history in, rules out: what the other system coded the same way
  // again and again becomes a rule without a further page to visit. Only
  // where there is history to learn from, and never at the cost of the
  // exceptions -- see adoptRulesFromHistory.
  if (loaded.lines.length > 0) {
    const adopted = await adoptRulesFromHistory();
    const said: string[] = [];
    if (adopted.rules > 0) {
      said.push(
        `${adopted.rules} rule${adopted.rules === 1 ? "" : "s"} made from the latest coding in ` +
          "that file; they are on the Rules page.",
      );
    }
    if (adopted.kept > 0) {
      said.push(
        `${adopted.kept} line${adopted.kept === 1 ? "" : "s"} it coded differently from its rule ` +
          "kept as it had them.",
      );
    }
    if (adopted.adopted > 0) {
      said.push(
        `${adopted.adopted} line${adopted.adopted === 1 ? "" : "s"} no rule covers coded as it had them.`,
      );
    }
    if (said.length > 0) state.checkProblems = [...state.checkProblems, said.join(" ")];
  }
  // The chart can be loaded from either page, so redraw whichever is showing.
  // Redrawing the check page while the user is looking at the accounts page
  // made loading a chart look like it had done nothing at all.
  showPage(state.page);
}

/**
 * Whether one of our accounts is the account a reference line sat on.
 *
 * Uses a mapping inferred from the payments rather than the account names: the
 * two systems name things nothing alike, and a card called `Kea Coffee Roaster`
 * here is `BNZ Visa - Business Card` there, sharing not one word.
 *
 * An account with no inferred pairing is left unconstrained rather than
 * excluded -- too few sightings to be sure is a reason to stay quiet, not a
 * reason to drop every line on that account.
 */
function sameAccount(ours: Transaction, theirs: ReferenceLine): boolean {
  if (theirs.account === undefined) return true;
  const expected = state.accountMap.get(ours.account);
  if (expected !== undefined) return expected === theirs.account;
  // No pairing was inferred for this account. When the reference produced
  // pairings for other accounts it has had its chance, so silence here means
  // the reference does not cover this account at all -- Xero holds one entity
  // and the ledger holds nine. Leaving it unconstrained lets a Rimu Lane transfer
  // marry an Kea Coffee loan of the same amount.
  return state.accountMap.size === 0;
}

/** The GST rate our own classification implies, in the reference's wording. */
function ourGstRate(transaction: Transaction): string | null {
  const one = state.suggestions?.get(transaction.id);
  if (!one) return null;
  return rateLabel(one.classification);
}

/**
 * Ask which columns to read, for a table nothing could name.
 *
 * A spreadsheet is somebody's own: the headings are whatever they chose, and a
 * reader that guesses will sometimes be wrong. Rather than refuse the file and
 * leave a person to work out what it wanted, its headings are shown and the
 * three that matter are chosen.
 */
function columnPicker(file: {
  name: string;
  sheet: SheetRows;
  headings: { index: number; name: string }[];
}): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "column-picker";

  const heading = document.createElement("h3");
  heading.textContent = `Which columns in ${file.name}?`;
  wrap.append(heading);

  wrap.append(
    note(
      "This table's layout was not recognised. Choose the three columns below to read it.",
    ),
  );

  const form = document.createElement("div");
  form.className = "feed-form";

  // A guess for each, so the common case is a glance rather than three
  // decisions: the headings usually say what they are.
  const guess = (...words: string[]): number => {
    const hit = file.headings.find((c) =>
      words.some((w) => c.name.toLowerCase() === w) ,
    ) ?? file.headings.find((c) => words.some((w) => c.name.toLowerCase().includes(w)));
    return hit?.index ?? file.headings[0]?.index ?? 1;
  };

  const pick = (label: string, chosen: number): HTMLSelectElement => {
    const select = document.createElement("select");
    for (const column of file.headings) {
      const option = document.createElement("option");
      option.value = String(column.index);
      option.textContent = column.name;
      option.selected = column.index === chosen;
      select.append(option);
    }
    const wrapper = document.createElement("label");
    wrapper.append(`${label} `, select);
    form.append(wrapper);
    return select;
  };

  const date = pick("Date", guess("date"));
  const amount = pick("Amount", guess("amount", "value", "total"));
  const code = pick("Coded to", guess("what", "account", "code", "coding", "category"));

  const load = document.createElement("button");
  load.type = "button";
  load.className = "primary";
  load.textContent = "Read it";
  const said = document.createElement("p");
  said.className = "feed-said";

  load.addEventListener("click", () => {
    const lines = readChosenColumns(
      file.sheet,
      { date: Number(date.value), amount: Number(amount.value), code: Number(code.value) },
      file.name,
    );
    if (lines.length === 0) {
      said.textContent =
        "Nothing read from those columns. Check the date and amount are the right way round.";
      return;
    }
    state.reference = [...state.reference, ...lines];
    state.ledger = { ...state.ledger, reference: state.reference };
    state.checkUnreadable = state.checkUnreadable.filter((f) => f !== file);
    void savePart(state.ledger, "reference").then(() => redraw("check"));
  });

  form.append(load);
  wrap.append(form, said);
  return wrap;
}

/**
 * Our coding against the imported coding, and what is still asking for a
 * decision.
 *
 * One calculation for the page and for anything that reports on it. The
 * Reconcile page's "items outstanding" banner kept a copy of its own, which
 * drifted: it missed invoice-settled payments posting to receivables, the
 * account aliases, and differences already kept -- so it counted items this
 * page no longer showed.
 */
/**
 * The comparison with the reference file, remembered until what it is worked
 * from changes.
 *
 * It codes every bank line twice and matches them against every line of the
 * file -- well over a second on books of a couple of thousand lines -- and the
 * Actions badge, Actions required and this page each asked for it, on every
 * page change. Everything it reads is replaced rather than changed in place
 * (the books, the rules, the reference, the chart), as the other caches in
 * books.ts rely on, so the same objects mean the same answer.
 */
let comparison: { key: readonly unknown[]; value: ReturnType<typeof compareAfresh> } | null = null;

export function compareWithReference(): ReturnType<typeof compareAfresh> {
  const key = [state.ledger, state.rules, state.reference, state.chart, state.checkAccounts.join("|")] as const;
  if (comparison !== null && comparison.key.every((part, i) => part === key[i])) {
    // The page reads the suggestions it leaves behind, as it always did.
    state.suggestions = comparison.value.suggestionsMap;
    return comparison.value;
  }
  const value = compareAfresh();
  comparison = { key, value };
  return value;
}

function compareAfresh() {
  const suggestions = suggest(
    state.ledger.transactions,
    state.rules,
    state.ledger.overrides ?? {},
    accountsFor(state.checkAccounts),
    unregisteredCode(),
    gstLookups(),
  );
  const suggestionsMap = new Map(suggestions.map((one) => [one.transaction.id, one]));
  state.suggestions = suggestionsMap;

  // The rules' own opinion, with any human decision taken out of the way.
  const proposals = suggest(
    state.ledger.transactions,
    state.rules,
    {},
    accountsFor(state.checkAccounts),
    unregisteredCode(),
    gstLookups(),
  );
  const proposedBy = new Map(proposals.map((one) => [one.transaction.id, one.code]));

  // A payment matched to an invoice posts to receivables or payables, whatever
  // code it carries. Matching codes it from the invoice -- Sales, say -- but
  // the invoice booked the sale, and the payment only clears the debtor. The
  // other system reports the same payment against Accounts Receivable, so
  // compared by its own code it read as a disagreement that could not be
  // settled: accepting the other coding changed nothing that posts.
  const assignedTo = invoiceAssignments();
  const invoiceKind = new Map((state.ledger.invoices ?? []).map((i) => [i.number, i.kind]));
  const clearingLabel = (kind: string | undefined): string => {
    const receivable = kind !== "purchase";
    const wanted = receivable ? "accounts receivable" : "accounts payable";
    const account = state.chart.find((a) => a.type.trim().toLowerCase() === wanted);
    return account !== undefined
      ? `${account.code} ${account.name}`.trim()
      : receivable
        ? "610 Accounts Receivable"
        : "800 Accounts Payable";
  };
  const coded = suggestions.map((one) => {
    const settles = assignedTo.get(one.transaction.id);
    return {
      transaction: one.transaction,
      code:
        settles !== undefined && settles !== ""
          ? clearingLabel(invoiceKind.get(settles))
          : one.code,
    };
  });
  state.accountMap = inferAccountMapping(coded, state.reference);

  const result = compareCodings(coded, state.reference, {
    chart: state.chart,
    accountMatches: sameAccount,
    aliases: (state.rules as { aliases?: Record<string, string> } | undefined)?.aliases ?? {},
    gstRateOf: ourGstRate,
  });

  /**
   * Every payment the other system split, whether or not we have split it too.
   *
   * Comparing one of these on a single code is meaningless in both directions.
   * If we hold one line, the comparison is against whichever part happens to be
   * largest -- it agrees or differs by accident. If we hold a split, the parent
   * has no single code at all, so it silently landed in "agree" and disappeared,
   * which is why four courier payments could not be found anywhere on this page.
   *
   * So they come out of the code and GST comparisons entirely and get their own
   * section, where the question is the one actually worth asking: do our parts
   * match theirs.
   */
  const ourSplits = state.ledger.splits ?? {};
  const isSplit = (r: CodingRow): boolean => (r.theirs?.parts?.length ?? 0) > 1;
  // Uncoded lines belong here too. A payment the other system split can sit on
  // this ledger split -- and split differently -- without ever having been
  // coded, and until uncoded rows started carrying the other side there was no
  // way for one to reach this section at all. A split done differently from
  // theirs is exactly the disagreement worth seeing.
  const splitRows = [...result.agreed, ...result.differed, ...result.uncoded].filter(isSplit);

  // Only the ones still asking for something.
  //
  // The section listed every payment the other system splits, whether or not
  // it had been split here -- so taking a split left the row exactly where it
  // was, offering to reload the split you had just accepted, and the only way
  // to tell it had worked was to count. A split whose parts match theirs is
  // finished, and belongs off the page with everything else that agrees.
  //
  // Matched on the amounts rather than the count: two parts against two parts
  // is not agreement if they are 40/60 here and 50/50 there.
  const sameParts = (row: CodingRow): boolean => {
    const held = ourSplits[row.transaction.id];
    const theirs = row.theirs?.parts;
    if (held === undefined || theirs === undefined) return false;
    if (held.length !== theirs.length) return false;
    const sorted = (amounts: readonly number[]): string =>
      [...amounts].sort((a, b) => a - b).join(",");
    return sorted(held.map((p) => p.amount)) === sorted(theirs.map((p) => p.amount));
  };
  const splitsToDo = splitRows.filter((row) => !sameParts(row));

  /**
   * Lines this ledger has already settled another way.
   *
   * A receipt matched to an invoice is already posted, and posted the same way
   * the other system posts it: Dr Bank, Cr Accounts Receivable, clearing the
   * debtor the invoice raised. `postTransaction` does that from the invoice
   * link, so "Accounts Receivable" is not a coding this ledger is missing -- it
   * is the coding this ledger already has.
   *
   * Which is why offering it is worse than useless. The settles branch returns
   * before it reads any parts, so an adopted code changes nothing about the
   * posting -- a button that appears to act and does not. What it does change is
   * the evidence: an override saying this payee means Accounts Receivable is a
   * rule waiting to be inferred, and that rule would fire on the next receipt
   * that has no invoice behind it, crediting a control account with no sale
   * recognised anywhere.
   *
   * A recorded transfer is the same case: both legs are posted as one movement
   * by `postTransfer`, and neither wants a code.
   *
   * So they are held out of the adoption section the way splits are -- not a
   * disagreement and not a gap, but work already done.
   */
  const assigned = invoiceAssignments();
  const ourTransfers = state.ledger.transfers ?? {};
  const settledElsewhere = (row: CodingRow): boolean =>
    assigned.has(row.transaction.id) || ourTransfers[row.transaction.id] !== undefined;

  /**
   * Transfers, and the file's words for lines it left out, compared on their
   * own terms.
   *
   * A recorded transfer used to leave this page without a word, whatever the
   * file said: a line paired here as a transfer that the file coded to rates
   * vanished as "already settled", when the file was saying it was rates. So a
   * transfer is now always set against the file -- agreeing where the file
   * says transfer too, listed where it names an account -- and a line the file
   * calls a transfer is offered its pairing here.
   *
   * Lines whose name is matched to "ignore" are taken out of every comparison
   * and listed apart. Only lines that are in both: one in the file and not in
   * the ledger is still listed as that, since it may be missing from the bank.
   */
  const kinds = referenceKinds();
  const kindOf = (row: CodingRow): ReferenceKind | undefined =>
    row.theirs === null ? undefined : kinds[row.theirs.code];
  const transferHere = (row: CodingRow): boolean => ourTransfers[row.transaction.id] !== undefined;
  const special = (row: CodingRow): boolean => kindOf(row) !== undefined || transferHere(row);
  const withFile = [...result.agreed, ...result.differed, ...result.uncoded].filter(
    (r) => r.theirs !== null && !isSplit(r),
  );
  const transferAgrees = withFile.filter((r) => transferHere(r) && kindOf(r) === "transfer");
  const transferDiffers = withFile.filter((r) => transferHere(r) && kindOf(r) === undefined);
  const ignoredRows = withFile.filter((r) => kindOf(r) === "ignore");

  // The other side of each line the file calls a transfer, looked for as the
  // Reconcile page looks: same money the other way, an account of the same
  // entity, within four days, and nobody else's partner already.
  const decided = accountDecided();
  const unavailable = new Set([
    ...Object.keys(ourTransfers),
    ...state.ledger.transactions.filter((t) => decided(t.id)).map((t) => t.id),
    ...assigned.keys(),
  ]);
  const overridesNow = state.ledger.overrides ?? {};
  const fileSaysTransfer = withFile
    .filter((r) => !transferHere(r) && kindOf(r) === "transfer")
    .map((row) => {
      const own = overridesNow[row.transaction.id];
      const codedAs = decided(row.transaction.id)
        ? own?.confirmed === true && (own.code ?? "") !== ""
          ? (own.code ?? "")
          : "an invoice or a split"
        : null;
      const partners =
        codedAs !== null
          ? []
          : transferCandidates(row.transaction, state.ledger.transactions, {
              sameEntity: sameEntityBanks(row.transaction.account).accounts,
              taken: unavailable,
            }).map((one) => one.transaction);
      return { row, codedAs, partners };
    });

  const comparable = result.uncoded.filter((r) => r.theirs !== null && !isSplit(r) && !special(r));
  const adoptable = comparable.filter((r) => !settledElsewhere(r));
  const alreadySettled = comparable.length - adoptable.length;


  const gstFlags = [...result.agreed, ...result.differed].filter(
    (r) => r.gstDiffers && !isSplit(r) && !special(r),
  );
  // A difference somebody has looked at and settled is no longer a question.
  // Keeping it on the list would make the one action that says "mine is right"
  // do nothing visible, which reads as a broken button rather than a decision.
  const settled = (r: CodingRow): boolean =>
    (state.ledger.overrides ?? {})[r.transaction.id]?.note ===
    "Checked against the imported coding and kept, on the Coding reconciliation page.";
  const differed = result.differed.filter((r) => !isSplit(r) && !settled(r) && !special(r));
  const kept = result.differed.filter((r) => !isSplit(r) && settled(r) && !special(r)).length;

  /**
   * Lines where a rule's suggestion is what the other system had, and nobody
   * has confirmed it here.
   *
   * Counted as agreeing, and offered nothing: "Use Xero/Imported" lived only
   * in the sections for disagreements and for lines not coded here. Once the
   * file had taught the rules, the rules suggested exactly the other system's
   * coding -- so those lines left both sections for "agree", and sat
   * unconfirmed on Reconcile with no way to take them together. On one set of
   * books, seventy-five of them.
   *
   * Held back as everywhere else: a split, a GST rate that differs, a line
   * settled by an invoice or a transfer, and a suggestion running against the
   * money.
   */
  const agreedToConfirm = result.agreed.filter((r) => {
    if (isSplit(r) || r.gstDiffers !== undefined || settledElsewhere(r) || special(r)) return false;
    const one = state.suggestions?.get(r.transaction.id);
    return one !== undefined && !one.confirmed && one.code !== null && ruleCaution(one) === undefined;
  });

  return {
    suggestions,
    suggestionsMap,
    proposedBy,
    coded,
    result,
    splitRows,
    splitsToDo,
    adoptable,
    alreadySettled,
    gstFlags,
    differed,
    kept,
    agreedToConfirm,
    transferAgrees,
    transferDiffers,
    fileSaysTransfer,
    ignoredRows,
  };
}

/** How many lines the page is still asking about, or 0 with nothing to compare. */
export function codingReconciliationWaiting(): number {
  if (state.reference.length === 0 || state.ledger.transactions.length === 0) return 0;
  const { splitsToDo, differed, adoptable, gstFlags, agreedToConfirm, transferDiffers, fileSaysTransfer } =
    compareWithReference();
  return new Set<string>([
    ...agreedToConfirm.map((r) => r.transaction.id),
    ...transferDiffers.map((r) => r.transaction.id),
    // Only those with something to do here: one partner to pair with.
    ...fileSaysTransfer.filter((one) => one.partners.length === 1).map((one) => one.row.transaction.id),
    ...splitsToDo.map((r) => r.transaction.id),
    ...differed.map((r) => r.transaction.id),
    ...adoptable.map((r) => r.transaction.id),
    ...gstFlags.map((r) => r.transaction.id),
  ]).size;
}

/**
 * Deterministic unique signature for a reference export line.
 * Lines can share amount and date (e.g. Stripe gross-up fees or split deposits),
 * so all identifying attributes from the source are included.
 */
export function referenceLineKey(line: ReferenceLine): string {
  return [
    line.date,
    line.amount,
    line.code,
    line.label ?? "",
    line.account ?? "",
    line.gstRate ?? "",
    line.description ?? "",
    line.contact ?? "",
    line.reference ?? "",
  ].join("|");
}

export function isReferenceIgnored(line: ReferenceLine): boolean {
  const key = referenceLineKey(line);
  return Boolean(state.ledger.ignoredReference?.[key]);
}

export async function ignoreReferenceLine(line: ReferenceLine, reason: string): Promise<void> {
  const key = referenceLineKey(line);
  const now = new Date().toISOString();
  state.ledger = {
    ...state.ledger,
    ignoredReference: {
      ...(state.ledger.ignoredReference ?? {}),
      [key]: { reason, at: now },
    },
  };
  state.persistent = await savePart(state.ledger);
}

export async function unignoreReferenceLine(line: ReferenceLine): Promise<void> {
  const key = referenceLineKey(line);
  if (!state.ledger.ignoredReference) return;
  const copy = { ...state.ledger.ignoredReference };
  delete copy[key];
  if (Object.keys(copy).length === 0) {
    const { ignoredReference: _gone, ...rest } = state.ledger;
    state.ledger = rest;
  } else {
    state.ledger = {
      ...state.ledger,
      ignoredReference: copy,
    };
  }
  state.persistent = await savePart(state.ledger);
}

/** Unmatched lines in the reference file (on or after books start) that have not been dismissed with a reason. */
export function unmatchedReferenceWaiting(): number {
  if (state.reference.length === 0 || state.ledger.transactions.length === 0) return 0;
  const { result } = compareWithReference();
  const booksStart =
    state.ledger.openingBalances?.asAt ??
    state.ledger.transactions.map((t) => t.date).sort()[0] ??
    "";
  const missing = result.unmatched.filter((line) => !(booksStart !== "" && line.date < booksStart));
  const ignored = state.ledger.ignoredReference ?? {};
  return missing.filter((line) => !ignored[referenceLineKey(line)]).length;
}

export function renderCheck(): void {
  fillAccounts("check-accounts", state.checkAccounts, renderCheck);
  const body = $("check-body");
  body.textContent = "";

  for (const problem of state.checkProblems) {
    const line = document.createElement("p");
    line.className = "variance-problems";
    line.textContent = problem;
    body.append(line);
  }

  for (const file of state.checkUnreadable) body.append(columnPicker(file));

  if (state.ledger.transactions.length === 0) {
    body.append(note("No transactions yet. Import a bank file first."));
    return;
  }
  if (state.reference.length === 0) {
    body.append(
      note(
        (moduleOn("xero")
          ? "Load a Xero Account Transactions export (.xlsx) or the workbook (.xlsx) to compare against. "
          : "Load your coded spreadsheet (.xlsx or .csv) to compare against. ") +
          "A chart of accounts (.csv) also helps match account codes to names.",
      ),
    );
    return;
  }

  // Matching the file's names to accounts is a set-up step, done on Start
  // here after the file is loaded. Said here too, because a name not matched
  // is a line on this page that cannot be accepted.
  // Folded away: it is a set-up step, done on Start here. It is here as well
  // because a name not matched is a line on this page that cannot be
  // accepted, and the fix should not be a page away.
  const matches = codingMatches({ open: false });
  if (matches !== null) body.append(matches);

  const {
    proposedBy,
    coded,
    result,
    splitRows,
    splitsToDo,
    adoptable,
    alreadySettled,
    gstFlags,
    differed,
    kept,
    agreedToConfirm,
    transferAgrees,
    transferDiffers,
    fileSaysTransfer,
    ignoredRows,
  } = compareWithReference();

  const checked = result.agreed.length + result.differed.length;
  const rate = checked === 0 ? 0 : (result.agreed.length / checked) * 100;
  // A year of history loaded for its coding is mostly from before these books
  // start, and was listed as "not in your ledger" -- 387 lines of it, as if
  // something were missing. The day the books start is the opening balances'
  // date, or else the first bank line.
  const booksStart =
    state.ledger.openingBalances?.asAt ??
    state.ledger.transactions.map((t) => t.date).sort()[0] ??
    "";
  const beforeStart = result.unmatched.filter((line) => booksStart !== "" && line.date < booksStart);
  const missing = result.unmatched.filter((line) => !(booksStart !== "" && line.date < booksStart));
  const unignoredMissing = missing.filter((line) => !isReferenceIgnored(line));
  const ignoredMissing = missing.filter((line) => isReferenceIgnored(line));

  // Nothing coded on our side means nothing to compare, and a row of zeros
  // reads as "the file matched nothing" rather than "there is nothing here
  // yet to match it against". Which is backwards: the reference is what
  // teaches the rules in the first place, so this is the beginning of the
  // loop rather than a failure of it.
  const nothingCoded =
    checked === 0 && coded.every((one) => one.code === null || one.code === "(uncoded)");
  if (nothingCoded) {
    const why = document.createElement("div");
    why.className = "check-nothing";
    const said = document.createElement("p");
    said.textContent =
      `${state.reference.length} reference lines and ${state.ledger.transactions.length} ` +
      "transactions loaded. No transactions are coded yet; use the suggested rules below " +
      "to code them from this file.";
    why.append(said);
    body.append(why);
  }

  // The rules this file can write, on the page the file lands on.
  //
  // They used to be on Setup, because Setup was once the only place a coded
  // history could be loaded -- and they stayed there after the loading moved,
  // so the answer to "nothing is coded yet" lived on a different page from the
  // question, reached by a button whose only purpose was to bridge the two.
  //
  // Above the comparison while there is nothing to compare, because then they
  // are the whole point of the page. Folded away below it once there are
  // codings, because then the comparison is what somebody came for and a table
  // of eighteen proposals is in the way of it.
  if (nothingCoded) {
    renderRuleSuggestions(body);
  }


  const summary = document.createElement("div");
  summary.className = "check-summary";
  for (const [value, label] of [
    [String(result.agreed.length), "agree"],
    [String(differed.length), "differ"],
    ...(kept > 0 ? ([[String(kept), "kept as ours"]] as const) : []),
    ...(transferAgrees.length > 0
      ? ([[String(transferAgrees.length), "transfers agree with the file"]] as const)
      : []),
    [`${rate.toFixed(1)}%`, "of checkable lines agree"],
    [String(gstFlags.length), "GST rate differs"],
    [
      splitsToDo.length === 0
        ? String(splitRows.length)
        : `${splitRows.length} / ${splitsToDo.length}`,
      splitsToDo.length === 0
        ? `split in ${imported()}, all matched here`
        : `split in ${imported()} / still to match`,
    ],
    [String(result.unreferenced.length), "coded, nothing to check against"],
    [String(result.uncoded.length - alreadySettled), "not coded yet"],
    // The mirror of the line above, and the one nobody was told. A line in the
    // file with no transaction behind it used to vanish without a count.
    [
      ignoredMissing.length > 0
        ? `${unignoredMissing.length} (${ignoredMissing.length} dismissed)`
        : String(missing.length),
      "in the file, not in your ledger",
    ],
  ] as const) {
    const cell = document.createElement("div");
    cell.className = "check-stat";
    const big = document.createElement("span");
    big.className = "check-value";
    big.textContent = value;
    const small = document.createElement("span");
    small.className = "check-label";
    small.textContent = label;
    cell.append(big, small);
    summary.append(cell);
  }
  body.append(summary);

  if (agreedToConfirm.length > 0) {
    const bar = document.createElement("div");
    bar.className = "check-agree-confirm";
    const accept = document.createElement("button");
    accept.type = "button";
    accept.className = "check-batch-btn primary-batch";
    accept.textContent = `Accept the ${agreedToConfirm.length} that agree with ${imported()} (recommended)`;
    accept.addEventListener("click", () => {
      accept.disabled = true;
      accept.classList.add("working");
      void acceptCodesBulk(
        agreedToConfirm.map((r) => ({
          transaction: r.transaction,
          code: r.ours ?? "",
          kind: "agreed",
        })),
      );
    });
    bar.append(
      accept,
      note(
        `${agreedToConfirm.length} line${agreedToConfirm.length === 1 ? " is" : "s are"} suggested ` +
          "here exactly as the file coded them, but not yet confirmed on Reconcile. Accepting " +
          "confirms them as they are. Splits, GST rate differences, invoice payments and " +
          "transfers are left for you.",
      ),
    );
    body.append(bar);
  }

  body.append(
    note(
      `${state.reference.length} reference lines loaded. Only lines in both can be compared; ` +
        "the rest are listed so you can see what is not covered.",
    ),
  );

  if (beforeStart.length > 0) {
    body.append(
      note(
        `${beforeStart.length} more line${beforeStart.length === 1 ? " is" : "s are"} dated before ` +
          `these books start (${booksStart}): history from before them, not something missing.`,
      ),
    );
  }

  // The order is the order somebody should work in.
  //
  // Splits first, because a split changes what a line *is*: a courier payment
  // that is really freight, border GST and a fee cannot be coded to one
  // account at all, so coding it before splitting it means doing it twice.
  if (splitsToDo.length > 0) {
    body.append(section(`${Imported()} splits these`, splitsToDo, proposedBy, false));
    body.append(
      note(
        "Split payments are not included in the counts above. Open one to see its parts; " +
          "loading them replaces any split held here.",
      ),
    );
  }

  // Then the disagreements. They come before the wholesale adoption below
  // because they are what says whether that adoption is safe: nine differing
  // out of a hundred and seventy means the other system's coding can be
  // trusted here, and eighty means it cannot.
  if (differed.length > 0) {
    body.append(
      section(
        "Coding disagrees",
        differed,
        proposedBy,
        false,
        "choose option from the Use column",
      ),
    );
  }

  // Transfers next: they are disagreements too, about what a line is rather
  // than which account it goes to.
  if (transferDiffers.length > 0) body.append(transferDiffersSection(transferDiffers));
  if (fileSaysTransfer.length > 0) body.append(fileSaysTransferSection(fileSaysTransfer));

  // Then the lines we have not coded, that the other system did.
  //
  // These used to be counted and never shown. The comparison was built to
  // check our coding against theirs, so a row with nothing on our side had
  // nothing to compare -- but on a ledger nobody has worked through yet that
  // is exactly backwards: their coding is not the thing to check against, it
  // is the answer.
  //
  // Splits are not adoptable one line at a time -- taking a single code for a
  // payment the other system split across three accounts would be wrong, which
  // is the whole reason splits have a section of their own. So they are left
  // to it rather than listed in both.
  if (adoptable.length > 0) {
    body.append(section("Not coded here, coded in the file", adoptable, proposedBy, false));
    body.append(
      note(
        `Coded in the file but not here. “Use ${imported()}” takes the file's coding for ` +
          "one line; useful where no rule fits, such as a payee that changes each time.",
      ),
    );
  }

  // Folded away, but listed: a word in the file that means "leave this out"
  // is the file's decision, and one of them may still turn out to matter.
  if (ignoredRows.length > 0) body.append(ignoredSection(ignoredRows));

  // Said rather than silently dropped. A row leaving a section without a word
  // is how somebody comes to trust a count that is quietly wrong.
  if (alreadySettled > 0) {
    body.append(
      note(
        `${alreadySettled} more ${alreadySettled === 1 ? "line is" : "lines are"} not listed ` +
          "because they are already posted the same way here: invoice receipts, bill " +
          "payments and transfers. Nothing needs adopting.",
      ),
    );
  }

  // Then GST, last of the coding work, because a rate is a refinement on a
  // line whose account is already settled -- and settling the account above
  // may well have changed the rate anyway.
  if (gstFlags.length > 0) {
    body.append(section("GST rate disagrees", gstFlags, proposedBy, true));
  }

  // Last, because nothing here can be acted on from this page.
  //
  // These are lines in the file that no transaction here matched -- and until
  // now they simply vanished: no row, no count, no warning, because a
  // comparison can only report where both sides exist. They are worth seeing
  // anyway. Either the bank data is short of something, or the other system
  // holds entries the bank never saw.
  if (missing.length > 0) {
    const heading = document.createElement("h3");
    heading.id = "check-unmatched-heading";
    heading.textContent =
      unignoredMissing.length > 0
        ? `In the file, not in your ledger (${unignoredMissing.length})`
        : `In the file, not in your ledger (all ${ignoredMissing.length} ignored)`;
    body.append(heading);
    body.append(
      note(
        "These match none of your transactions. Either they are missing from your import, " +
          "or they never went through the bank: a journal, an adjustment, or an account " +
          "not imported. Lines can be ignored with a stated reason.",
      ),
    );
    const byAccount = missingByAccount(unignoredMissing);
    if (byAccount !== null) body.append(byAccount);

    if (unignoredMissing.length > 0) {
      const table = document.createElement("table");
      table.className = "report-table owner-table";
      const head = document.createElement("thead");
      head.innerHTML =
        "<tr><th>Date</th><th>Amount</th><th>Coded to</th><th>On their account</th>" +
        "<th>In these books</th><th>Details</th><th></th></tr>";
      const tbody = document.createElement("tbody");
      // Grouped by their account, because the commonest cause by far is a whole
      // account nobody imported, and a list sorted by date hides that.
      const onAccount = (line: ReferenceLine): string => line.bankAccount ?? line.account ?? "";
      for (const line of [...unignoredMissing].sort(
        (a, b) => onAccount(a).localeCompare(onAccount(b)) || a.date.localeCompare(b.date),
      )) {
        const tr = document.createElement("tr");
        tr.append(nameCell(line.date));
        tr.append(amountCell(formatAmount(line.amount)));
        tr.append(nameCell(line.label));
        tr.append(nameCell(onAccount(line)));
        tr.append(nameCell(fileAccountSaid(onAccount(line))));
        const details = [
          line.contact,
          line.invoiceNumber ? `Inv: ${line.invoiceNumber}` : "",
          line.reference ? `Ref: ${line.reference}` : "",
          line.description,
        ]
          .filter(Boolean)
          .join(" · ");
        tr.append(nameCell(details));

        const tdAction = document.createElement("td");
        tdAction.className = "check-actions";

        const ignoreBtn = document.createElement("button");
        ignoreBtn.type = "button";
        ignoreBtn.className = "use-button";
        ignoreBtn.textContent = "Ignore";

        const formWrap = document.createElement("div");
        formWrap.className = "ignore-reason-form";
        formWrap.hidden = true;

        const select = document.createElement("select");
        select.className = "ignore-reason-select";
        select.innerHTML = `
          <option value="" disabled selected>Choose a reason</option>
          <option value="Split invoice payment in single bank deposit">Split invoice payment in single bank deposit</option>
          <option value="Timing / settlement date difference (more than 6 days)">Timing / settlement date difference (more than 6 days)</option>
          <option value="Zero-sum internal journal / fee gross-up">Zero-sum internal journal / fee gross-up</option>
          <option value="Manual reconciliation rounding adjustment">Manual reconciliation rounding adjustment</option>
          <option value="Prior period / before ledger start">Prior period / before ledger start</option>
          <option value="__other__">Other</option>
        `;

        const noteInput = document.createElement("input");
        noteInput.type = "text";
        noteInput.className = "ignore-custom-input";
        noteInput.hidden = true;

        const confirmBtn = document.createElement("button");
        confirmBtn.type = "button";
        confirmBtn.className = "use-button use-recommended";
        confirmBtn.textContent = "Confirm";
        confirmBtn.disabled = true;

        const cancelBtn = document.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.className = "use-button";
        cancelBtn.textContent = "Cancel";

        const updateConfirm = () => {
          if (select.value === "__other__") {
            noteInput.hidden = false;
            noteInput.placeholder = "The reason (required)";
            confirmBtn.disabled = noteInput.value.trim().length === 0;
          } else if (select.value !== "") {
            noteInput.hidden = false;
            noteInput.placeholder = "A note (optional)";
            confirmBtn.disabled = false;
          } else {
            noteInput.hidden = true;
            confirmBtn.disabled = true;
          }
        };

        select.addEventListener("change", () => {
          updateConfirm();
          if (select.value === "__other__") noteInput.focus();
        });

        noteInput.addEventListener("input", updateConfirm);

        ignoreBtn.addEventListener("click", () => {
          ignoreBtn.hidden = true;
          formWrap.hidden = false;
          select.focus();
        });

        cancelBtn.addEventListener("click", () => {
          formWrap.hidden = true;
          ignoreBtn.hidden = false;
          select.value = "";
          noteInput.value = "";
          noteInput.hidden = true;
          confirmBtn.disabled = true;
        });

        confirmBtn.addEventListener("click", () => {
          const sel = select.value;
          const extra = noteInput.value.trim();
          let reason = "";
          if (sel === "__other__") {
            reason = extra;
          } else if (sel !== "") {
            reason = extra ? `${sel} — ${extra}` : sel;
          }
          if (!reason) return;
          confirmBtn.disabled = true;
          confirmBtn.textContent = "Saving…";
          void ignoreReferenceLine(line, reason).then(() => {
            redraw("check");
            redraw("actionsBadge");
            redraw("actions");
          });
        });

        formWrap.append(select, noteInput, confirmBtn, cancelBtn);
        tdAction.append(ignoreBtn, formWrap);
        tr.append(tdAction);
        tbody.append(tr);
      }
      table.append(head, tbody);
      body.append(table);
    } else {
      body.append(
        note(
          "Every line here has been ignored with a reason. They are listed below, and can be restored.",
        ),
      );
    }

    if (ignoredMissing.length > 0) {
      const ignoredFold = document.createElement("details");
      ignoredFold.className = "check-rules-fold ignored-fold";
      const ignoredSummary = document.createElement("summary");
      ignoredSummary.textContent = `Ignored lines (${ignoredMissing.length})`;
      ignoredFold.append(ignoredSummary);

      const ignoredTable = document.createElement("table");
      ignoredTable.className = "report-table owner-table";
      const ignoredHead = document.createElement("thead");
      ignoredHead.innerHTML =
        "<tr><th>Date</th><th>Amount</th><th>Coded to</th><th>On their account</th><th>Reason</th><th>Ignored on</th><th></th></tr>";
      const ignoredTbody = document.createElement("tbody");
      for (const line of [...ignoredMissing].sort(
        (a, b) => (a.account ?? "").localeCompare(b.account ?? "") || a.date.localeCompare(b.date),
      )) {
        const key = referenceLineKey(line);
        const entry = state.ledger.ignoredReference?.[key];
        const tr = document.createElement("tr");
        tr.append(nameCell(line.date));
        tr.append(amountCell(formatAmount(line.amount)));
        tr.append(nameCell(line.label));
        tr.append(nameCell(line.bankAccount ?? line.account ?? ""));
        tr.append(nameCell(entry?.reason ?? "Dismissed"));
        const atStr = entry?.at ? entry.at.slice(0, 10) : "";
        tr.append(nameCell(atStr));

        const tdAction = document.createElement("td");
        tdAction.className = "check-actions";
        const restoreBtn = document.createElement("button");
        restoreBtn.type = "button";
        restoreBtn.className = "use-button";
        restoreBtn.textContent = "Restore";
        restoreBtn.title = "Put this line back in the list above";
        restoreBtn.addEventListener("click", () => {
          restoreBtn.disabled = true;
          restoreBtn.textContent = "Restoring…";
          void unignoreReferenceLine(line).then(() => {
            redraw("check");
            redraw("actionsBadge");
            redraw("actions");
          });
        });
        tdAction.append(restoreBtn);
        tr.append(tdAction);
        ignoredTbody.append(tr);
      }
      ignoredTable.append(ignoredHead, ignoredTbody);
      ignoredFold.append(ignoredTable);
      body.append(ignoredFold);
    }
  }

  // And folded away at the foot once there is a comparison to read. Still
  // here, because more rules can always be drawn out as more of the file is
  // matched -- just not in front of what somebody opened the page for.
  if (!nothingCoded) {
    const fold = document.createElement("details");
    fold.className = "check-rules-fold";
    // Open again if it was open, or a rule was just accepted from it. Accepting
    // the first rule codes some lines, which is what moves the suggestions
    // from the top of the page into this fold -- and closed, the rest of them
    // looked to have been wiped.
    fold.open = rulesFoldOpen;
    fold.addEventListener("toggle", () => {
      rulesFoldOpen = fold.open;
    });
    const summary = document.createElement("summary");
    summary.textContent = "Rules that could be drawn from this file";
    fold.append(summary);
    renderRuleSuggestions(fold, false);
    body.append(fold);
  }
}

/**
 * One table of differences.
 *
 * Three codings are shown separately because they are three different things:
 * what the rules propose, what a person decided, and what the other system
 * recorded. Collapsing the first two hides whether anyone has actually looked.
 */
function section(
  title: string,
  rows: readonly CodingRow[],
  proposedBy: ReadonlyMap<string, string | null>,
  gst: boolean,
  suffix?: string,
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "check-section";
  const heading = document.createElement("h3");
  heading.textContent = suffix
    ? `${title} (${rows.length}) - ${suffix}`
    : `${title} (${rows.length})`;
  wrap.append(heading);

  const sortedRows = [...rows].sort(
    (a, b) => Math.abs(b.transaction.amount) - Math.abs(a.transaction.amount),
  );

  const rowOptions = sortedRows.map((row) => {
    const override = (state.ledger.overrides ?? {})[row.transaction.id];
    const proposed = proposedBy.get(row.transaction.id) ?? "";
    // A payment matched to an invoice is compared as a payment of it, so that is
    // what it says. Showing the code matching gave it -- "200 Sales" -- read as
    // agreeing with the other system on a row reporting that it did not.
    const settles = invoiceAssignments().get(row.transaction.id);
    const settlesInvoice = settles !== undefined && settles !== "";
    const coded = settlesInvoice
      ? `settles ${settles}`
      : override?.code === undefined
        ? ""
        : override.confirmed === true
          ? override.code
          : `${override.code} (unconfirmed)`;
    const imported = row.theirs?.label ?? "";
    const parts = row.theirs?.parts;
    const isSplit = Boolean(parts && parts.length > 1);

    const canUseRules = proposed !== "" && proposed !== coded;
    const canUseXero = imported !== "" && !isSplit;
    const canUseSplit = isSplit;

    return {
      row,
      override,
      proposed,
      coded,
      imported,
      parts,
      isSplit,
      canUseRules,
      canUseXero,
      canUseSplit,
      settlesInvoice,
    };
  });

  const totalRows = rowOptions.length;
  const totalXero = rowOptions.filter((o) => o.canUseXero).length;
  const totalRules = rowOptions.filter((o) => o.canUseRules).length;
  const totalSplits = rowOptions.filter((o) => o.canUseSplit).length;

  const actionsBar = document.createElement("div");
  actionsBar.className = "check-section-actions";

  const selectAllLabel = document.createElement("label");
  selectAllLabel.className = "check-select-all-label";
  const selectAllCheckbox = document.createElement("input");
  selectAllCheckbox.type = "checkbox";
  selectAllCheckbox.className = "check-select-all";
  selectAllCheckbox.title = "Select or deselect all rows in this section";
  const selectAllText = document.createElement("span");
  selectAllText.textContent = "Select all";
  selectAllLabel.append(selectAllCheckbox, selectAllText);
  actionsBar.append(selectAllLabel);

  let btnXero: HTMLButtonElement | null = null;
  if (totalXero > 0) {
    btnXero = document.createElement("button");
    btnXero.type = "button";
    btnXero.className = "check-batch-btn primary-batch";
    actionsBar.append(btnXero);
  }

  let btnSplits: HTMLButtonElement | null = null;
  if (totalSplits > 0) {
    btnSplits = document.createElement("button");
    btnSplits.type = "button";
    btnSplits.className = "check-batch-btn primary-batch";
    actionsBar.append(btnSplits);
  }

  let btnRules: HTMLButtonElement | null = null;
  if (totalRules > 0) {
    btnRules = document.createElement("button");
    btnRules.type = "button";
    btnRules.className = "check-batch-btn";
    actionsBar.append(btnRules);
  }

  wrap.append(actionsBar);

  const table = document.createElement("table");
  table.className = "check-table";
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  headRow.innerHTML =
    '<th class="col-check"></th>' +
    '<th class="col-date">Date</th><th class="col-amount">Amount</th>' +
    '<th class="col-payee">Payee</th><th class="col-proposed">Rules propose</th>' +
    '<th class="col-coded">You coded</th>' +
    `<th class="${gst ? "col-gst" : "col-imported"}">${gst ? "GST ours / theirs" : `${Imported()} says`}</th>` +
    '<th class="col-use">Use</th>';

  const thCheck = headRow.querySelector(".col-check") as HTMLElement;
  const thCheckbox = document.createElement("input");
  thCheckbox.type = "checkbox";
  thCheckbox.title = "Select or deselect all rows in this section";
  thCheck.append(thCheckbox);
  head.append(headRow);

  const tbody = document.createElement("tbody");

  const updateToolbar = (): void => {
    const checkedBoxes = Array.from(
      tbody.querySelectorAll<HTMLInputElement>("input.check-row-select:checked"),
    );
    const selectedIds = new Set(checkedBoxes.map((cb) => cb.dataset.id!));
    const selectedCount = selectedIds.size;

    const allChecked = selectedCount === totalRows && totalRows > 0;
    const noneChecked = selectedCount === 0;

    selectAllCheckbox.checked = allChecked;
    selectAllCheckbox.indeterminate = !noneChecked && !allChecked;
    thCheckbox.checked = allChecked;
    thCheckbox.indeterminate = !noneChecked && !allChecked;

    if (btnXero) {
      if (noneChecked) {
        btnXero.textContent = `Use ${imported()} for all (${totalXero}) (recommended)`;
        btnXero.disabled = totalXero === 0;
      } else {
        const count = rowOptions.filter(
          (o) => selectedIds.has(o.row.transaction.id) && o.canUseXero,
        ).length;
        btnXero.textContent = `Use ${imported()} for ${count} selected (recommended)`;
        btnXero.disabled = count === 0;
      }
    }

    if (btnRules) {
      if (noneChecked) {
        btnRules.textContent = `Use rules for all (${totalRules})`;
        btnRules.disabled = totalRules === 0;
      } else {
        const count = rowOptions.filter(
          (o) => selectedIds.has(o.row.transaction.id) && o.canUseRules,
        ).length;
        btnRules.textContent = `Use rules for ${count} selected`;
        btnRules.disabled = count === 0;
      }
    }

    if (btnSplits) {
      if (noneChecked) {
        btnSplits.textContent = `Use all splits (${totalSplits}) (recommended)`;
        btnSplits.disabled = totalSplits === 0;
      } else {
        const count = rowOptions.filter(
          (o) => selectedIds.has(o.row.transaction.id) && o.canUseSplit,
        ).length;
        btnSplits.textContent = `Use split for ${count} selected (recommended)`;
        btnSplits.disabled = count === 0;
      }
    }
  };

  if (btnXero) {
    btnXero.addEventListener("click", () => {
      const selectedIds = new Set(
        Array.from(tbody.querySelectorAll<HTMLInputElement>("input.check-row-select:checked")).map(
          (cb) => cb.dataset.id!,
        ),
      );
      const targets = (
        selectedIds.size > 0
          ? rowOptions.filter((o) => selectedIds.has(o.row.transaction.id) && o.canUseXero)
          : rowOptions.filter((o) => o.canUseXero)
      ).map((o) => ({
        transaction: o.row.transaction,
        code: o.imported,
        kind: "imported",
        ...(gst && o.row.gstDiffers?.theirs !== undefined
          ? { rate: o.row.gstDiffers.theirs }
          : {}),
      }));
      if (targets.length === 0) return;
      btnXero!.disabled = true;
      btnXero!.classList.add("working");
      void acceptCodesBulk(targets);
    });
  }

  if (btnRules) {
    btnRules.addEventListener("click", () => {
      const selectedIds = new Set(
        Array.from(tbody.querySelectorAll<HTMLInputElement>("input.check-row-select:checked")).map(
          (cb) => cb.dataset.id!,
        ),
      );
      const targets = (
        selectedIds.size > 0
          ? rowOptions.filter((o) => selectedIds.has(o.row.transaction.id) && o.canUseRules)
          : rowOptions.filter((o) => o.canUseRules)
      ).map((o) => ({
        transaction: o.row.transaction,
        code: o.proposed,
        kind: "proposed",
      }));
      if (targets.length === 0) return;
      btnRules!.disabled = true;
      btnRules!.classList.add("working");
      void acceptCodesBulk(targets);
    });
  }

  if (btnSplits) {
    btnSplits.addEventListener("click", () => {
      const selectedIds = new Set(
        Array.from(tbody.querySelectorAll<HTMLInputElement>("input.check-row-select:checked")).map(
          (cb) => cb.dataset.id!,
        ),
      );
      const targets = (
        selectedIds.size > 0
          ? rowOptions.filter((o) => selectedIds.has(o.row.transaction.id) && o.canUseSplit)
          : rowOptions.filter((o) => o.canUseSplit)
      ).map((o) => ({
        transaction: o.row.transaction,
        parts: o.parts!,
      }));
      if (targets.length === 0) return;
      btnSplits!.disabled = true;
      btnSplits!.classList.add("working");
      void acceptSplitsBulk(targets);
    });
  }

  const setAllRowsChecked = (checked: boolean) => {
    const rowCheckboxes = tbody.querySelectorAll<HTMLInputElement>("input.check-row-select");
    for (const cb of rowCheckboxes) {
      cb.checked = checked;
    }
    updateToolbar();
  };

  selectAllCheckbox.addEventListener("change", () => {
    setAllRowsChecked(selectAllCheckbox.checked);
  });

  thCheckbox.addEventListener("change", () => {
    setAllRowsChecked(thCheckbox.checked);
  });

  for (const opt of rowOptions) {
    const {
      row, override, proposed, coded, imported, parts, canUseRules, canUseXero, canUseSplit,
      settlesInvoice,
    } = opt;
    const tr = document.createElement("tr");

    const tdCheck = document.createElement("td");
    tdCheck.className = "col-check";
    const rowCheckbox = document.createElement("input");
    rowCheckbox.type = "checkbox";
    rowCheckbox.className = "check-row-select";
    rowCheckbox.dataset.id = row.transaction.id;
    rowCheckbox.addEventListener("change", updateToolbar);
    tdCheck.append(rowCheckbox);
    tr.append(tdCheck);

    tr.addEventListener("click", (e) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.closest("button") ||
          target.closest("a") ||
          target.closest("input") ||
          target.closest("select"))
      ) {
        return;
      }
      rowCheckbox.checked = !rowCheckbox.checked;
      updateToolbar();
    });

    const who = [row.transaction.otherParty, row.transaction.code, row.transaction.reference]
      .filter((part) => part !== undefined && part.trim() !== "")
      .join(" ");

    const cells = [
      row.transaction.date,
      formatAmount(row.transaction.amount),
      who,
      proposed,
      coded,
      gst ? `${row.gstDiffers?.ours ?? ""} / ${row.gstDiffers?.theirs ?? ""}` : imported,
    ];
    const classes = ["col-date", "col-amount", "col-payee", "col-proposed", "col-coded",
                     gst ? "col-gst" : "col-imported"];
    cells.forEach((text, index) => {
      const td = document.createElement("td");
      td.textContent = text;
      td.className = classes[index] ?? "";
      if (text !== "") td.title = text;
      tr.append(td);
    });

    // The file's word is not what accepting codes to: a name matched to an
    // account goes to that account. Showing the word alone made "Ana" look
    // like an account about to be made, when the line would land on Personal
    // spending -- so the account is shown, and the word beneath it.
    if (!gst && imported !== "" && !canUseSplit) {
      const cell = tr.querySelector<HTMLElement>(".col-imported");
      const mapped = mapToOurVocabulary(imported);
      if (cell !== null && mapped !== imported) {
        cell.textContent = mapped ?? imported;
        const said = document.createElement("small");
        said.className = "field-hint";
        said.textContent =
          mapped === null ? "not matched to an account yet" : `“${imported}” in the file`;
        cell.append(document.createElement("br"), said);
        cell.title = mapped === null ? imported : `${mapped} (${imported} in the file)`;
      }
    }

    if (parts && parts.length > 1) {
      const marker = document.createElement("button");
      marker.type = "button";
      marker.className = "split-marker";
      const held = (state.ledger.splits ?? {})[row.transaction.id];
      marker.textContent =
        `${Imported()} splits this into ${parts.length}` +
        (held ? ` — split into ${held.length} here` : " — one line here");
      marker.addEventListener("click", () => {
        state.expandedSplit = state.expandedSplit === row.transaction.id ? null : row.transaction.id;
        redraw("check");
      });
      const cell = tr.querySelector(gst ? ".col-gst" : ".col-imported");
      cell?.append(document.createElement("br"), marker);
    }
    // Said, not done quietly: the file's figure was a cent away, and the cent
    // has been taken up so the parts come to what the bank paid.
    const roundedFrom = row.theirs?.roundedFrom;
    if (roundedFrom !== undefined) {
      const cell = tr.querySelector(gst ? ".col-gst" : ".col-imported");
      const said = document.createElement("small");
      said.textContent =
        `${Imported()} has ${formatAmount(roundedFrom)}, a cent of rounding from the bank's ` +
        `${formatAmount(row.transaction.amount)}` +
        (parts && parts.length > 1 ? "; the cent is taken from the part without GST." : ".");
      cell?.append(document.createElement("br"), said);
    }

    const actions = document.createElement("td");
    actions.className = "check-actions";
    // 1. Recommended choices first: Xero/Imported or split (in green)
    if (canUseXero) {
      actions.append(
        useButton("imported", row.transaction, imported, gst ? row.gstDiffers?.theirs : undefined),
      );
    }
    if (canUseSplit && parts) {
      const useSplit = document.createElement("button");
      useSplit.type = "button";
      useSplit.className = "use-button use-recommended";
      useSplit.textContent = (state.ledger.splits ?? {})[row.transaction.id]
        ? "reload split (recommended)"
        : "use split (recommended)";
      useSplit.addEventListener("click", () => void acceptSplit(row.transaction, parts));
      actions.append(useSplit);
    }
    // 2. Rules proposal second
    if (canUseRules) {
      actions.append(useButton("proposed", row.transaction, proposed));
    }
    // 3. And the answer nobody could give: that the coding here is right.
    //
    // A difference offered only one way out -- take the other system's coding
    // -- and where the rules already agreed with what was coded, the "use
    // rules" button was hidden as redundant. So a line somebody had looked at
    // and judged correct had no button that settled it, and came back on every
    // draw. Disagreeing with the other system is a decision like any other and
    // is recorded like one.
    if (coded !== "") {
      const keep = document.createElement("button");
      keep.type = "button";
      keep.className = "use-button";
      keep.textContent = "keep mine";
      keep.title = `${coded} — records that this was checked and stands`;
      // Keeping a match keeps the coding the line already has; the words
      // "settles INV-0135" are a description, not an account to write back.
      const keeping = settlesInvoice ? (override?.code ?? "") : coded;
      keep.addEventListener("click", () => void keepOurCoding(row.transaction, keeping));
      actions.append(keep);
    }
    tr.append(actions);
    tbody.append(tr);

    if (state.expandedSplit === row.transaction.id && parts) {
      const detail = document.createElement("tr");
      detail.className = "split-detail";
      const cell = document.createElement("td");
      cell.colSpan = 8;
      const table = document.createElement("table");
      const body = document.createElement("tbody");
      for (const part of parts) {
        const line = document.createElement("tr");
        for (const [index, text] of [
          formatAmount(part.amount),
          part.code,
          part.gstRate,
          part.description,
        ].entries()) {
          const td = document.createElement("td");
          td.textContent = text;
          td.style.textAlign = index === 0 ? "right" : "left";
          line.append(td);
        }
        body.append(line);
      }
      table.append(body);
      cell.append(table);
      detail.append(cell);
      tbody.append(detail);
    }
  }

  updateToolbar();

  table.append(head, tbody);
  const scroll = document.createElement("div");
  scroll.className = "check-scroll";
  scroll.append(table);
  wrap.append(scroll);
  return wrap;
}

function useButton(
  kind: string,
  transaction: Transaction,
  code: string,
  /** The rate the other system used, where that is what disagrees. */
  rate?: string,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = kind === "imported" ? "use-button use-recommended" : "use-button";
  button.textContent = kind === "imported" ? `use ${imported()} (recommended)` : "use rules";
  button.title = rate === undefined ? code : `${code} · ${rate}`;
  button.addEventListener("click", () => void acceptCode(transaction, code, kind, rate));
  return button;
}

/**
 * Take a payment off the invoice it was matched to, when the coding accepted
 * for it says it was something else.
 *
 * A matched payment posts to receivables whatever its code, so accepting the
 * other system's "200 Sales" for it changed a code nothing reads: the match
 * stayed, the row came straight back, and there was no button that could
 * settle it. A Stripe payout of 500.57 had been matched to an invoice another
 * payment had already paid. So taking an account for it that is not
 * receivables or payables takes it off the invoice too -- recorded as a
 * refusal, or the matcher finds the same invoice again on the next draw.
 *
 * Returns the invoice it came off, or null when it settled none or the account
 * taken agrees with the match. Writes into `matches`; saving is the caller's.
 */
function unmatchForCoding(
  transaction: Transaction,
  chosen: string,
  matches: Record<string, string>,
): string | null {
  const settles = invoiceAssignments().get(transaction.id);
  if (settles === undefined || settles === "") return null;
  if (/\b(610|800)\b|accounts\s+(receivable|payable)/i.test(chosen)) return null;
  matches[transaction.id] = "";
  return settles;
}

/**
 * The file's coding names, matched to the chart's accounts.
 *
 * A spreadsheet is coded in its owner's words -- "Kowhai Rent", "Ana"
 * -- and the chart in an accountant's. Names that happened to read alike were
 * matched already; the rest could not be accepted, compared or turned into
 * rules, and the only remedy offered was to add each to the chart, which made
 * a second account beside the real one.
 *
 * So each name is matched once, here, and kept as an alias in the rules. Every
 * reader of the file's coding already honours those -- accepting its coding,
 * comparing against it, and the rules proposed from it -- so a match made here
 * holds everywhere at once, and for the next file in the same words.
 */
function codingNames(): { lines: Map<string, number>; names: string[]; known: string[] } {
  const lines = new Map<string, number>();
  for (const line of state.reference) lines.set(line.code, (lines.get(line.code) ?? 0) + 1);

  const known = knownCodes(state.rules, state.ledger.overrides ?? {}, state.chart);
  const aliases = (state.rules as { aliases?: Record<string, string> } | undefined)?.aliases ?? {};
  // A name that already is an account needs nothing; one with an alias stays
  // listed, so a match made wrongly can be changed.
  const kinds = referenceKinds();
  const names = [...lines.keys()]
    .filter((name) => aliases[name] !== undefined || kinds[name] !== undefined || !known.includes(name))
    .sort((a, b) => (lines.get(b) ?? 0) - (lines.get(a) ?? 0) || a.localeCompare(b));
  return { lines, names, known };
}

/**
 * Whether the bank account a file names is one these books hold lines for.
 *
 * Matched by number, the only thing a spreadsheet's names and the bank's have
 * in common: the full account number where the name carries one (the suffix
 * read as a number, since one side writes 005 and the other 05), otherwise
 * the last four digits, which is all a card or a loan shows. A name with no
 * number at all -- "ADDED AFTER RECO" -- cannot be placed, and says so.
 */
function fileAccountHere(name: string): { kind: "here"; account: string } | { kind: "missing" } | { kind: "unknown" } {
  const held = [...new Set(state.ledger.transactions.map((t) => t.account))];
  const full = /(\d{2})-(\d{4})-(\d{7})-(\d{2,3})/;
  const key = (text: string): string | null => {
    const m = full.exec(text);
    return m === null ? null : `${m[1]}-${m[2]}-${m[3]}-${Number(m[4])}`;
  };
  const wanted = key(name);
  if (wanted !== null) {
    const found = held.find((account) => key(account) === wanted);
    return found === undefined ? { kind: "missing" } : { kind: "here", account: found };
  }
  const last = /(\d{4})\s*$/.exec(name)?.[1];
  if (last === undefined) return { kind: "unknown" };
  const found = held.filter((account) => new RegExp(`${last}$`).test(account) || bankLabel(account).endsWith(last));
  if (found.length === 1 && found[0] !== undefined) return { kind: "here", account: found[0] };
  return found.length === 0 ? { kind: "missing" } : { kind: "unknown" };
}

function fileAccountSaid(name: string): string {
  if (name === "") return "";
  const here = fileAccountHere(name);
  return here.kind === "here"
    ? `imported (${bankLabel(here.account)})`
    : here.kind === "missing"
      ? "not imported"
      : "cannot tell";
}

/**
 * The lines in the file and not the ledger, counted by the account the file
 * says each is on. A whole account nobody imported is the commonest cause by
 * far, and one row saying so beats sixty lines that leave it to be noticed.
 */
function missingByAccount(lines: readonly ReferenceLine[]): HTMLElement | null {
  const groups = new Map<string, ReferenceLine[]>();
  for (const line of lines) {
    const name = line.bankAccount ?? line.account ?? "";
    groups.set(name, [...(groups.get(name) ?? []), line]);
  }
  if (groups.size === 1 && groups.has("")) return null;
  const rows = [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([name, group]) => {
      const dates = group.map((line) => line.date).sort();
      const first = dates[0] ?? "";
      const last = dates[dates.length - 1] ?? "";
      return [
        name === "" ? "(not said)" : name,
        String(group.length),
        first === last ? first : `${first} to ${last}`,
        name === "" ? "" : fileAccountSaid(name),
      ];
    });
  return plainTable(["Account in the file", "Lines", "Dates", "In these books"], rows);
}

/**
 * What a name in the file means when it is not an account: a transfer between
 * the owner's own accounts, or a line the file left out of its own books.
 * Kept beside the aliases, in the rules, for the same reason they are: the
 * next file from the same spreadsheet uses the same words.
 */
type ReferenceKind = "transfer" | "ignore";
const TRANSFER_CHOICE = "Transfer between own accounts";
const IGNORE_CHOICE = "Not an account (ignore)";

function referenceKinds(): Record<string, ReferenceKind> {
  return (
    (state.rules as { referenceKinds?: Record<string, ReferenceKind> } | undefined)?.referenceKinds ?? {}
  );
}

/** A plain table of rows, for the sections that are not the coding grid. */
function plainTable(
  headings: readonly string[],
  rows: readonly (readonly (string | Node)[])[],
): HTMLTableElement {
  const table = document.createElement("table");
  table.className = "report-table owner-table";
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const heading of headings) {
    const th = document.createElement("th");
    th.textContent = heading;
    headRow.append(th);
  }
  head.append(headRow);
  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const cell of row) {
      const td = document.createElement("td");
      td.append(cell);
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(head, tbody);
  return table;
}

function whoOf(transaction: Transaction): string {
  return [transaction.otherParty, transaction.code, transaction.reference]
    .filter((part) => part !== undefined && part.trim() !== "")
    .join(" ");
}

/** The file's name for a line, as the account it is matched to where it is. */
function fileSays(name: string): string {
  const mapped = mapToOurVocabulary(name);
  return mapped === null || mapped === name ? name : `${mapped} (“${name}” in the file)`;
}

/**
 * Lines paired here as a transfer that the file coded to an account.
 *
 * Either the pairing is wrong -- two unrelated lines of the same amount a day
 * apart -- or the file's coding is. Somebody has to say which, so each is
 * listed with a way to take the file's side.
 */
function transferDiffersSection(rows: readonly CodingRow[]): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "check-section";
  const heading = document.createElement("h3");
  heading.textContent = `A transfer here, an account in the file (${rows.length})`;
  wrap.append(
    heading,
    note(
      "Paired here as a transfer between your own accounts, but the file codes it to an " +
        "account. If the file is right, undo the transfer and use its coding. If the transfer is " +
        `right, match the file's name to “${TRANSFER_CHOICE}” in the table above.`,
    ),
  );
  const transfers = state.ledger.transfers ?? {};
  const byId = new Map(state.ledger.transactions.map((t) => [t.id, t]));
  const lines = [...rows]
    .sort((a, b) => a.transaction.date.localeCompare(b.transaction.date))
    .map((row) => {
      const partner = byId.get(transfers[row.transaction.id] ?? "");
      const name = row.theirs?.code ?? "";
      const mapped = mapToOurVocabulary(name);
      const act = document.createElement("button");
      act.type = "button";
      act.className = "use-button";
      if (mapped === null) {
        act.textContent = "match the file's name";
        act.addEventListener("click", () => {
          if (!showCodingMatch(name)) alert(`"${name}" is not matched to an account.`);
        });
      } else {
        act.textContent = `not a transfer — use ${mapped}`;
        act.addEventListener("click", () => {
          const other =
            partner === undefined ? "" : ` (${partner.date} in ${bankLabel(partner.account)})`;
          if (
            !confirm(
              `Undo this transfer and code ${row.transaction.date} ` +
                `${formatAmount(row.transaction.amount)} to ${mapped}?\n\n` +
                `The other side${other} is left uncoded, to be coded on its own.`,
            )
          ) {
            return;
          }
          act.disabled = true;
          const rate = row.theirs?.gstRate;
          void unpairTransfer(row.transaction.id).then(async () => {
            reclassify();
            await acceptCode(row.transaction, name, "imported", rate === "" ? undefined : rate);
          });
        });
      }
      return [
        row.transaction.date,
        formatAmount(row.transaction.amount),
        whoOf(row.transaction),
        partner === undefined
          ? "transfer"
          : `transfer with ${bankLabel(partner.account)} on ${partner.date}`,
        fileSays(name),
        act,
      ];
    });
  wrap.append(plainTable(["Date", "Amount", "Details", "Here", "The file says", ""], lines));
  return wrap;
}

/**
 * Lines the file calls a transfer that are not one here.
 *
 * Paired from the row where there is exactly one line it can be. Several
 * candidates is a choice for the Reconcile page, which shows them side by
 * side; none at all usually means the other account is not in these books.
 */
function fileSaysTransferSection(
  items: readonly { row: CodingRow; codedAs: string | null; partners: readonly Transaction[] }[],
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "check-section";
  const heading = document.createElement("h3");
  heading.textContent = `The file says transfer (${items.length})`;
  wrap.append(
    heading,
    note(
      "Lines the file codes as a transfer between your own accounts that are not paired as one " +
        "here. Pair those with one possible other side; where there is none, the other account " +
        "is usually not in these books.",
    ),
  );
  // Every line with exactly one other side, paired at once. Both sides of a
  // pair are usually listed, each naming the other, so a pair is taken once;
  // and a line two others both name is left for Reconcile rather than given
  // to whichever came first.
  const pairs: { out: Transaction; into: Transaction }[] = [];
  const claims = new Map<string, number>();
  for (const { codedAs, partners } of items) {
    const only = partners[0];
    if (codedAs === null && partners.length === 1 && only !== undefined) {
      claims.set(only.id, (claims.get(only.id) ?? 0) + 1);
    }
  }
  const paired = new Set<string>();
  for (const { row, codedAs, partners } of items) {
    const only = partners[0];
    if (codedAs !== null || partners.length !== 1 || only === undefined) continue;
    const self = row.transaction;
    if (paired.has(self.id) || paired.has(only.id)) continue;
    // Named by another line besides this one: ambiguous, so not here.
    if ((claims.get(only.id) ?? 0) > 1) continue;
    const out = self.amount < 0 ? self : only;
    const into = out === self ? only : self;
    pairs.push({ out, into });
    paired.add(self.id);
    paired.add(only.id);
  }
  if (pairs.length > 0) {
    const all = document.createElement("button");
    all.type = "button";
    all.className = "check-batch-btn primary-batch";
    all.textContent =
      `Use ${imported()} for all — pair ${pairs.length} transfer${pairs.length === 1 ? "" : "s"} ` +
      "(recommended)";
    all.addEventListener("click", () => {
      all.disabled = true;
      all.classList.add("working");
      void pairAll(pairs).then(() => {
        reclassify();
        redraw("check");
      });
    });
    wrap.append(all);
  }

  const toReconcile = (): HTMLAnchorElement => {
    const link = document.createElement("a");
    link.href = "#page-reconcile";
    link.textContent = "see Reconcile";
    link.addEventListener("click", (event) => {
      event.preventDefault();
      showPage("reconcile");
    });
    return link;
  };
  const lines = [...items]
    .sort((a, b) => a.row.transaction.date.localeCompare(b.row.transaction.date))
    .map(({ row, codedAs, partners }) => {
      const here = codedAs === null ? "not coded" : `coded to ${codedAs}`;
      let act: string | Node;
      const only = partners[0];
      if (codedAs !== null) {
        const span = document.createElement("span");
        span.append("coded here; if it is a transfer, change it on ", toReconcile());
        act = span;
      } else if (partners.length === 1 && only !== undefined) {
        const pair = document.createElement("button");
        pair.type = "button";
        pair.className = "use-button use-recommended";
        pair.textContent = `pair with ${bankLabel(only.account)} on ${only.date}`;
        pair.addEventListener("click", () => {
          pair.disabled = true;
          const out = row.transaction.amount < 0 ? row.transaction : only;
          const into = out === row.transaction ? only : row.transaction;
          void pairAll([{ out, into }]).then(() => {
            reclassify();
            redraw("check");
          });
        });
        act = pair;
      } else if (partners.length > 1) {
        const span = document.createElement("span");
        span.append(`${partners.length} possible other sides — `, toReconcile());
        act = span;
      } else {
        act = "other side not in these books";
      }
      return [
        row.transaction.date,
        formatAmount(row.transaction.amount),
        whoOf(row.transaction),
        here,
        row.theirs?.code ?? "",
        act,
      ];
    });
  wrap.append(plainTable(["Date", "Amount", "Details", "Here", "The file says", ""], lines));
  return wrap;
}

/** Lines the file left out of its own books, folded away. */
function ignoredSection(rows: readonly CodingRow[]): HTMLElement {
  const box = document.createElement("details");
  box.className = "check-section check-ignored";
  const summary = document.createElement("summary");
  summary.textContent = `Ignored in the file (${rows.length})`;
  box.append(
    summary,
    note(
      `Lines whose name in the file is matched to “${IGNORE_CHOICE}”. They are not ` +
        "compared or offered for coding; code them on Reconcile like any other line.",
    ),
  );
  const lines = [...rows]
    .sort((a, b) => a.transaction.date.localeCompare(b.transaction.date))
    .map((row) => {
      const own = (state.ledger.overrides ?? {})[row.transaction.id];
      return [
        row.transaction.date,
        formatAmount(row.transaction.amount),
        whoOf(row.transaction),
        own?.confirmed === true ? (own.code ?? "") : "",
        row.theirs?.code ?? "",
      ];
    });
  box.append(plainTable(["Date", "Amount", "Details", "Coded here", "The file says"], lines));
  return box;
}

/**
 * Open the match table on the page showing, at one of the file's names.
 *
 * False when there is no table on screen to open, so the caller can say what
 * to do instead.
 */
function showCodingMatch(name: string): boolean {
  const page = document.getElementById(`page-${state.page}`) ?? document;
  const box = page.querySelector<HTMLDetailsElement>("details.coding-matches");
  if (box === null) return false;
  box.open = true;
  const row = [...box.querySelectorAll<HTMLElement>("tr[data-coding-name]")].find(
    (one) => one.dataset.codingName === name,
  );
  (row ?? box).scrollIntoView({ block: "center" });
  row?.querySelector<HTMLInputElement>("input")?.focus();
  return true;
}

/** How many of the file's coding names have no account yet. */
export function unmatchedCodingNames(): number {
  const kinds = referenceKinds();
  return codingNames().names.filter(
    (name) => kinds[name] === undefined && mapToOurVocabulary(name) === null,
  ).length;
}

/**
 * Choices made in the match table and not saved yet, by the file's name.
 *
 * Kept outside the table, which is rebuilt whenever its page is drawn: going
 * to the chart to add a missing account and coming back used to find every
 * pick made so far gone. Shared by Start here and Coding reconciliation, which
 * show the same table. Emptied when the matches are saved.
 */
const matchDrafts = new Map<string, string>();

export function codingMatches(options: { open?: boolean } = {}): HTMLElement | null {
  const { lines, names, known } = codingNames();
  if (names.length === 0) return null;
  const aliases = (state.rules as { aliases?: Record<string, string> } | undefined)?.aliases ?? {};
  const kinds = referenceKinds();
  const choiceFor = (kind: ReferenceKind): string => (kind === "transfer" ? TRANSFER_CHOICE : IGNORE_CHOICE);

  const unmatched = names.filter((name) => kinds[name] === undefined && mapToOurVocabulary(name) === null);

  const box = document.createElement("details");
  box.className = "coding-matches";
  box.open = options.open ?? unmatched.length > 0;
  const summary = document.createElement("summary");
  summary.textContent =
    unmatched.length > 0
      ? `Match the file's coding to your accounts (${unmatched.length} of ${names.length} not matched)`
      : `The file's coding, matched to your accounts (${names.length})`;
  box.append(summary);
  box.append(
    note(
      "Each name your file codes to, and the account in your chart it means. Lines whose " +
        "name is not matched cannot be accepted or turned into rules. " +
        `“${TRANSFER_CHOICE}” is for money moved between your own accounts: those lines ` +
        `are paired here rather than coded. “${IGNORE_CHOICE}” is for a word the file ` +
        "uses for lines it left out, such as “Ignore” or “Pending”.",
    ),
  );
  if (state.chart.length === 0) {
    box.append(note("There is no chart of accounts yet. Set it up first, then match these to it."));
  }

  const table = document.createElement("table");
  table.className = "report-table";
  const head = document.createElement("thead");
  head.innerHTML = "<tr><th>In the file</th><th>Lines</th><th>Your account</th><th></th></tr>";
  const tbody = document.createElement("tbody");
  const pickers: { name: string; picker: ReturnType<typeof combobox>; was: string; wasKind?: ReferenceKind }[] =
    [];
  const choices = [TRANSFER_CHOICE, IGNORE_CHOICE, ...known];

  for (const name of names) {
    const tr = document.createElement("tr");
    tr.dataset.codingName = name;
    const theirs = document.createElement("td");
    theirs.className = "report-name";
    theirs.textContent = name;
    const count = document.createElement("td");
    count.className = "report-amount";
    count.textContent = String(lines.get(name) ?? 0);

    // What it resolves to now: a match made here, or one read from the names.
    const kind = kinds[name];
    const resolved = kind !== undefined ? choiceFor(kind) : mapToOurVocabulary(name);
    const status = document.createElement("td");
    status.className = "field-hint";
    status.textContent =
      kind === "transfer"
        ? "a transfer"
        : kind === "ignore"
          ? "ignored"
          : aliases[name] !== undefined
            ? "matched"
            : resolved !== null
              ? "matched by name"
              : "not matched";

    const draft = matchDrafts.get(name);
    if (draft !== undefined && draft !== (resolved ?? "")) status.textContent = "to save";
    const cell = document.createElement("td");
    const picker = combobox(
      choices,
      draft ?? resolved,
      "Search accounts…",
      () => {
        matchDrafts.set(name, picker.value);
        status.textContent = picker.value === "" ? "not matched" : "to save";
      },
      // A name the chart has no account for yet. The table keeps what has
      // been chosen while the chart page is open, and the new account is in
      // the list on the way back.
      { label: "+ Add new account\u2026", onPick: (typed) => startNewAccount(typed === "" ? name : typed) },
    );
    cell.append(picker.element);
    pickers.push({ name, picker, was: aliases[name] ?? "", ...(kind !== undefined ? { wasKind: kind } : {}) });

    tr.append(theirs, count, cell, status);
    tbody.append(tr);
  }
  table.append(head, tbody);
  box.append(table);

  // Suggested by AI, into the same picks a person makes: drafts, marked "to
  // save", that nothing keeps until Save matches is pressed.
  if (unmatched.length > 0 && state.chart.length > 0) {
    box.append(
      matchSuggestions(unmatched, lines, known, (matches) => {
        for (const [name, match] of matches) {
          matchDrafts.set(
            name,
            match.kind === "transfer" ? TRANSFER_CHOICE : match.kind === "ignore" ? IGNORE_CHOICE : match.account,
          );
        }
        redraw("check");
        redraw("migration");
      }),
    );
  }

  const keep = document.createElement("button");
  keep.type = "button";
  keep.className = "primary";
  keep.textContent = "Save matches";
  keep.addEventListener("click", () => {
    const next: Record<string, string> = { ...aliases };
    const nextKinds: Record<string, ReferenceKind> = { ...kinds };
    let changed = 0;
    for (const { name, picker, was, wasKind } of pickers) {
      const chosen = picker.value;
      // A name is an account, a transfer, ignored, or not decided -- one of
      // them, so choosing one clears whichever it was before.
      const kind: ReferenceKind | undefined =
        chosen === TRANSFER_CHOICE ? "transfer" : chosen === IGNORE_CHOICE ? "ignore" : undefined;
      if (kind !== undefined) {
        if (kind === wasKind) continue;
        nextKinds[name] = kind;
        delete next[name];
        changed += 1;
        continue;
      }
      if (wasKind !== undefined) {
        delete nextKinds[name];
        changed += 1;
      }
      // One read from the names alone is saved too, once somebody has seen it
      // and said yes: an account renamed later would otherwise stop matching.
      if (chosen === "") {
        if (was !== "") {
          delete next[name];
          changed += 1;
        }
        continue;
      }
      if (chosen === was || chosen === name) continue;
      next[name] = chosen;
      changed += 1;
    }
    matchDrafts.clear();
    if (changed === 0) return;
    const file = (state.rules as RuleFileShape | undefined) ?? { rules: [] };
    state.rules = { ...file, aliases: next, referenceKinds: nextKinds } as RuleSet;
    state.rulesName = state.rulesName === "" ? "rules.json" : state.rulesName;
    void record(
      "rule",
      `Matched ${changed} of the file's coding name${changed === 1 ? "" : "s"} to accounts`,
      { aliases, referenceKinds: kinds },
      { aliases: next, referenceKinds: nextKinds },
    ).then(async () => {
      reclassify();
      await persistRules();
      redraw("check");
      redraw("setup");
      redraw("migration");
    });
  });
  box.append(keep);
  return box;
}

/**
 * Accept multiple offered codings in one batch.
 */
async function acceptCodesBulk(
  items: readonly {
    transaction: Transaction;
    code: string;
    kind: string;
    rate?: string;
  }[],
): Promise<void> {
  if (items.length === 0) return;

  const overrides = { ...(state.ledger.overrides ?? {}) };
  const invoiceMatches = { ...(state.ledger.invoiceMatches ?? {}) };
  const unmatched: { transaction: Transaction; number: string }[] = [];
  const batchEvents: CodingBatchEntry[] = [];
  const unmapped = new Set<string>();
  let applied = 0;

  for (const item of items) {
    // One leg of a recorded transfer has no account of its own, and coding it
    // as well is what took two sales out of real books. Left as it is; the row
    // still shows the difference for somebody to look at.
    if ((state.ledger.transfers ?? {})[item.transaction.id] !== undefined) continue;
    let chosen = item.code;
    if (item.kind === "imported") {
      const mapped = mapToOurVocabulary(item.code);
      if (mapped === null) {
        unmapped.add(item.code);
        continue;
      }
      chosen = mapped;
    }

    const one = state.suggestions?.get(item.transaction.id);
    const stated =
      item.rate === undefined || item.rate.trim() === ""
        ? null
        : accountTreatment({ code: "", name: "", type: "", taxCode: item.rate, description: "" });

    const wasCoded = overrides[item.transaction.id];
    // A line accepted because it agrees keeps the treatment it was suggested
    // with: that is the one that agreed with the file's GST rate. The
    // account's default could differ from both.
    const own =
      stated === null && !(item.kind === "agreed" && one !== undefined)
        ? accountDefault(chosen, item.transaction.amount)
        : null;
    const side = stated?.side ?? (stated !== null ? "none" : (own?.side ?? one?.classification.side));
    overrides[item.transaction.id] = {
      confirmed: true,
      code: chosen,
      treatment: stated?.treatment ?? own?.treatment ?? one?.classification.treatment ?? "standard",
      ...(side !== undefined && side !== "none" ? { side } : {}),
      note:
        stated === null
          ? `Accepted the ${item.kind} coding on the Coding reconciliation page.`
          : `Accepted the ${item.kind} coding and its rate (${item.rate}) on the Coding reconciliation page.`,
      at: new Date().toISOString().slice(0, 10),
    };
    batchEvents.push({
      id: item.transaction.id,
      before: wasCoded ?? null,
    });
    const off = unmatchForCoding(item.transaction, chosen, invoiceMatches);
    if (off !== null) unmatched.push({ transaction: item.transaction, number: off });
    applied++;
  }

  if (unmapped.size > 0) {
    alert(
      `Not matched to an account yet: "${[...unmapped].join('", "')}". ` +
        (applied > 0
          ? `${applied} other line${applied === 1 ? " was" : "s were"} updated. `
          : "No lines were updated. ") +
        "Match those names in the file's coding table, then accept them again.",
    );
    showCodingMatch([...unmapped][0] ?? "");
  }

  if (applied === 0) {
    redraw("check");
    return;
  }

  state.ledger = {
    ...state.ledger,
    overrides,
    ...(unmatched.length > 0 ? { invoiceMatches } : {}),
  };
  state.persistent =
    unmatched.length > 0
      ? await savePart(state.ledger, "invoiceMatches")
      : await savePart(state.ledger);

  if (applied === 1 && batchEvents[0]) {
    const single = items[0]!;
    const chosenCode = single.kind === "imported" ? (mapToOurVocabulary(single.code) ?? single.code) : single.code;
    await record(
      "coding",
      `${single.transaction.date} ${formatAmount(single.transaction.amount)} ${single.transaction.otherParty} → ${chosenCode} (accepted the ${single.kind === "imported" ? "${imported()}" : single.kind} coding)`,
      batchEvents[0].before,
      overrides[single.transaction.id],
      single.transaction.id,
    );
  } else {
    const kindDesc =
      items[0]?.kind === "imported" ? `${Imported()}` : items[0]?.kind === "agreed" ? "agreeing" : "rules";
    await record(
      "codingBatch",
      `Accepted ${kindDesc} coding for ${applied} lines on Coding reconciliation page`,
      batchEvents,
      null,
    );
  }
  // Each its own entry, so the change log can put any one match back.
  for (const { transaction, number } of unmatched) {
    await record(
      "invoiceMatch",
      `Not an invoice payment (was ${number}), from the imported coding`,
      number,
      "",
      transaction.id,
    );
  }
  reclassify();

  redraw("check");
}

/**
 * Accept multiple splits recorded by the other system.
 */
async function acceptSplitsBulk(
  items: readonly { transaction: Transaction; parts: readonly ReferencePart[] }[],
): Promise<void> {
  if (items.length === 0) return;

  const splits = { ...(state.ledger.splits ?? {}) };
  const unmappedAll = new Set<string>();
  const mismatchIds = new Set<string>();
  let applied = 0;

  for (const item of items) {
    const mapped: SplitPart[] = [];
    const unmapped: string[] = [];
    const side = item.transaction.amount < 0 ? "purchases" : "sales";

    for (const part of item.parts) {
      const code = mapToOurVocabulary(part.code);
      if (code === null) {
        unmapped.push(part.code);
        unmappedAll.add(part.code);
      }
      const isTax = /(^|[ ])GST([ ]|$)/i.test(part.code) && !/^15%/.test(part.gstRate);
      const rated = /^15%/.test(part.gstRate);

      mapped.push({
        amount: part.amount,
        ...(code !== null ? { code } : {}),
        treatment: isTax || rated ? "standard" : "out-of-scope",
        side: isTax ? "imports" : rated ? side : "none",
        note: `${Imported()}: ${part.description}`,
      });
    }

    if (unmapped.length > 0) continue;

    const total = mapped.reduce((sum, part) => sum + part.amount, 0);
    if (total !== item.transaction.amount) {
      mismatchIds.add(item.transaction.id);
      continue;
    }

    const before = splits[item.transaction.id];
    splits[item.transaction.id] = mapped;
    applied++;

    if (items.length === 1) {
      await record(
        "split",
        `${item.transaction.date} ${formatAmount(item.transaction.amount)} ${item.transaction.otherParty} split into ${mapped.length} from ${imported()}`,
        before ?? null,
        mapped,
        item.transaction.id,
      );
    }
  }

  if (unmappedAll.size > 0) {
    alert(
      `No account in your rules matches: ${[...unmappedAll].join(", ")}. ` +
        "Set a GST treatment for it first so the GST is not assumed.",
    );
  }

  if (mismatchIds.size > 0) {
    alert(`${mismatchIds.size} split(s) could not be applied because part amounts did not match the bank line.`);
  }

  if (applied === 0) {
    redraw("check");
    return;
  }

  state.ledger = { ...state.ledger, splits };
  state.persistent = await savePart(state.ledger);
  if (items.length > 1) {
    await record(
      "codingBatch",
      `Loaded ${applied} splits from ${imported()} on Coding reconciliation page`,
      [],
      null,
    );
  }
  state.expandedSplit = null;
  redraw("check");
}

/**
 * Accept one of the offered codings.
 *
 * An imported code arrives in the other system's vocabulary -- `910 - Loan from
 * Director` where the rules say `NB Loan from director - 910` -- and storing it
 * raw would leave a code with no GST treatment, which the engine silently
 * assumes to be standard-rated. So it is mapped back to the name already in
 * use, and refused when it cannot be.
 */
async function acceptCode(
  transaction: Transaction,
  code: string,
  kind: string,
  rate?: string,
): Promise<void> {
  let chosen = code;
  if (kind === "imported") {
    const mapped = mapToOurVocabulary(code);
    if (mapped === null) {
      // What is missing is which account the file's word means. Sending
      // people to add it to the chart made a second account beside the one
      // it meant, so the answer is the match table, opened at that name.
      if (!showCodingMatch(code)) {
        alert(`"${code}" is not matched to an account. Match it in the file's coding table.`);
      }
      return;
    }
    chosen = mapped;
  }

  if (codingRefusedForTransfer(transaction)) return;

  const one = state.suggestions?.get(transaction.id);

  // A rate named by the other system is read with the same rules a chart's tax
  // code is read with, rather than a second interpretation of the same words.
  const stated =
    rate === undefined || rate.trim() === ""
      ? null
      : accountTreatment({ code: "", name: "", type: "", taxCode: rate, description: "" });

  const overrides = { ...(state.ledger.overrides ?? {}) };
  const wasCoded = overrides[transaction.id];
  const own = stated === null ? accountDefault(chosen, transaction.amount) : null;
  const side = stated?.side ?? (stated !== null ? "none" : (own?.side ?? one?.classification.side));
  const kindName = kind === "imported" ? `${Imported()}` : kind;
  overrides[transaction.id] = {
    confirmed: true,
    code: chosen,
    treatment: stated?.treatment ?? own?.treatment ?? one?.classification.treatment ?? "standard",
    ...(side !== undefined && side !== "none" ? { side } : {}),
    note:
      stated === null
        ? `Accepted the ${kindName} coding on the Coding reconciliation page.`
        : `Accepted the ${kindName} coding and its rate (${rate}) on the Coding reconciliation page.`,
    at: new Date().toISOString().slice(0, 10),
  };
  const invoiceMatches = { ...(state.ledger.invoiceMatches ?? {}) };
  const off = unmatchForCoding(transaction, chosen, invoiceMatches);
  state.ledger = { ...state.ledger, overrides, ...(off !== null ? { invoiceMatches } : {}) };
  state.persistent =
    off !== null ? await savePart(state.ledger, "invoiceMatches") : await savePart(state.ledger);
  await record(
    "coding",
    `${transaction.date} ${formatAmount(transaction.amount)} ${transaction.otherParty} → ${chosen} (accepted the ${kindName} coding)`,
    wasCoded ?? null,
    overrides[transaction.id],
    transaction.id,
  );
  if (off !== null) {
    await record(
      "invoiceMatch",
      `Not an invoice payment (was ${off}), from the imported coding`,
      off,
      "",
      transaction.id,
    );
    reclassify();
  }
  redraw("check");
}

/**
 * Load a split recorded by the other system.
 *
 * The parts are mapped into our own vocabulary and GST model on the way in, and
 * the whole thing is refused unless they still sum to the bank line.
 */
async function acceptSplit(transaction: Transaction, parts: readonly ReferencePart[]): Promise<void> {
  const mapped: SplitPart[] = [];
  const unmapped: string[] = [];

  // The whole payment went one way; a part with the opposite sign is a refund
  // of that same thing, not income. Taking the side from each part own sign
  // would move a courier refund into Box 5.
  const side = transaction.amount < 0 ? "purchases" : "sales";

  for (const part of parts) {
    const code = mapToOurVocabulary(part.code);
    if (code === null) unmapped.push(part.code);

    // A posting to the GST control account is not an expense carrying GST --
    // it is the tax itself, which belongs in Box 13 whole rather than having
    // 3/23 taken out of it.
    const isTax = /(^|[ ])GST([ ]|$)/i.test(part.code) && !/^15%/.test(part.gstRate);
    const rated = /^15%/.test(part.gstRate);

    mapped.push({
      amount: part.amount,
      ...(code !== null ? { code } : {}),
      treatment: isTax || rated ? "standard" : "out-of-scope",
      side: isTax ? "imports" : rated ? side : "none",
      note: `${Imported()}: ${part.description}`,
    });
  }

  if (unmapped.length > 0) {
    alert(
      `No account in your rules matches ${unmapped.join(", ")}. ` +
        "Set a GST treatment for it first so the GST is not assumed.",
    );
    return;
  }

  const total = mapped.reduce((sum, part) => sum + part.amount, 0);
  if (total !== transaction.amount) {
    alert(`The parts total ${formatAmount(total)} but the bank line is ${formatAmount(transaction.amount)}.`);
    return;
  }

  const before = (state.ledger.splits ?? {})[transaction.id];
  const splits = { ...(state.ledger.splits ?? {}), [transaction.id]: mapped };
  state.ledger = { ...state.ledger, splits };
  state.persistent = await savePart(state.ledger);
  await record(
    "split",
    `${transaction.date} ${formatAmount(transaction.amount)} ${transaction.otherParty} split into ${mapped.length} from ${imported()}`,
    before ?? null,
    mapped,
    transaction.id,
  );
  state.expandedSplit = null;
  redraw("check");
}

/** Turn the chart file's wording back into a stored treatment. */
function parseTreatment(text: string): unknown | null {
  const value = text.trim();
  if (value === "") return null;
  if (value === "imports") return { treatment: "standard", side: "imports" };
  // A chart written before partial deduction was removed may still say
  // "standard 50%". The treatment is kept and the percentage dropped: a part
  // deduction is expressed by splitting the line, as Xero does it, so there is
  // nothing here for a percentage to mean.
  const percent = /^(\S+)\s+\d{1,3}%$/.exec(value);
  if (percent?.[1]) return percent[1];
  return value;
}

/**
 * Take the entity and GST columns from a loaded chart.
 *
 * Entities are matched by name and created when they are new, so a chart
 * written on one machine brings its entities with it rather than arriving with
 * every account pointing at nothing.
 */
export async function applyChartColumns(chart: readonly Account[]): Promise<void> {
  // A plain accounting-package export carries no columns of ours, but its tax
  // codes are still worth reading: they are the same information, written by
  // whoever set the chart up.
  const carries = chart.some(
    (a) => a.entity !== undefined || a.gstTreatment !== undefined || a.taxCode !== "",
  );
  if (!carries) return;

  const model = state.ledger.entities ?? emptyEntityModel();
  const entities = [...model.entities];
  const accounts = { ...model.accounts };
  const byName = new Map(entities.map((e) => [e.name.toLowerCase(), e]));

  const file = state.rules as RuleFileShape | undefined;
  const codeTreatments = { ...(file?.codeTreatments ?? {}) };
  const known = knownCodes(state.rules, state.ledger.overrides ?? {});
  let treatmentsSet = 0;

  const ledgerAccounts = new Set(state.ledger.transactions.map((t) => t.account));
  // Books of one entity, and a chart that does not say whose its accounts
  // are: they are that entity's. A Xero chart arrives with no entity column,
  // and its accounts sat "not yet given an entity" in books that have only
  // one -- out of that entity's reports until somebody noticed. Only the
  // accounts arriving here, and only unassigned ones: an account already left
  // out of the one entity may have been left out on purpose.
  const only =
    model.entities.length === 1 && !chart.some((a) => (a.entity ?? "") !== "")
      ? model.entities[0]?.id
      : undefined;
  const banks: Record<string, string[]> = Object.fromEntries(
    Object.entries(model.banks).map(([id, ids]) => [id, [...ids]]),
  );

  for (const account of chart) {
    // A bank-account row names a ledger account, and its entity column can
    // hold several: one current account often pays for more than one.
    if (account.type === "Bank" && ledgerAccounts.has(account.name.trim())) {
      const wanted = (account.entity ?? "")
        .split(";")
        .map((n) => n.trim())
        .filter((n) => n !== "");
      const ids: string[] = [];
      for (const name of wanted) {
        let entity = byName.get(name.toLowerCase());
        if (!entity) {
          entity = { id: entityId(name), name };
          entities.push(entity);
          byName.set(name.toLowerCase(), entity);
        }
        ids.push(entity.id);
      }
      if (ids.length > 0) banks[account.name.trim()] = ids;
      else delete banks[account.name.trim()];
      continue;
    }
    if (account.entity !== undefined && account.entity !== "") {
      let entity = byName.get(account.entity.toLowerCase());
      if (!entity) {
        entity = { id: entityId(account.entity), name: account.entity };
        entities.push(entity);
        byName.set(account.entity.toLowerCase(), entity);
      }
      // Ownership and kind are facts about the entity, repeated on each of its
      // accounts in the file. The first row carrying them wins.
      if (account.entityOwners !== undefined && (entity.owners ?? []).length === 0) {
        entity.owners = parseOwners(account.entityOwners);
      }
      if (account.entityKind !== undefined && entity.kind === undefined) {
        entity.kind = account.entityKind as EntityKind;
      }
      accounts[accountEntityKey(account)] = entity.id;
    } else if (only !== undefined && account.type !== "Bank" && accounts[accountEntityKey(account)] === undefined) {
      accounts[accountEntityKey(account)] = only;
    }
    // Our own column first, then the file's tax code. One is a decision taken
    // in this app and the other is what the chart was set up with, so the
    // decision wins -- but an account with no decision is no longer left with
    // nothing when the file plainly says how it is treated.
    const label = labelForChartAccount(account, known);
    const own =
      account.gstTreatment !== undefined ? parseTreatment(account.gstTreatment) : null;
    const fromTaxCode = own === null ? accountTreatment(account) : null;

    if (own !== null) {
      codeTreatments[label] = own;
      treatmentsSet += 1;
    } else if (fromTaxCode !== null && codeTreatments[label] === undefined) {
      // Only where nothing has been said already: a treatment set by hand in
      // the rules is a later decision than the chart it was set against.
      codeTreatments[label] = fromTaxCode;
      treatmentsSet += 1;
    }
  }

  if (treatmentsSet > 0) {
    // Again without requiring one to exist first. A chart export carries how
    // every account is treated, and reading that and then throwing it away
    // because no rule file had been loaded left a new set of books with no GST
    // treatments at all -- and no way to tell, because the chart plainly had
    // them.
    if (state.rules === undefined) {
      state.rulesName = "rules.json";
      state.rulesLoadedAt = new Date().toISOString();
    }
    state.rules = { ...(file ?? { rules: [] }), codeTreatments } as RuleSet;
    state.rulesDirty = true;
    reclassify();
    void persistRules();
  }
  state.ledger = { ...state.ledger, entities: { ...model, entities, accounts, banks } };
  state.persistent = await save(state.ledger);
}

/** Worked examples for inference: our transactions paired with their coding. */
function codedExamples(): CodedExample[] {
  // Your own confirmed codings count as evidence, not only the accounting
  // system's. They were ignored, so a payment nobody else had coded could be
  // coded here fifty times and never suggest a rule -- and the ones you code
  // by hand are exactly the ones no rule covers yet.
  //
  // Only confirmed ones: a suggestion nobody has looked at is the rule's own
  // opinion, and learning a rule from it would be the software agreeing with
  // itself.
  const overrides = state.ledger.overrides ?? {};
  const yours: CodedExample[] = state.ledger.transactions
    .filter((t) => overrides[t.id]?.confirmed === true && (overrides[t.id]?.code ?? "") !== "")
    .map((t) => ({ transaction: t, code: overrides[t.id]?.code ?? "" }));

  if (state.reference.length === 0) return yours;
  const coded = state.ledger.transactions.map((t) => ({
    transaction: t,
    code: (state.suggestions?.get(t.id)?.code ?? null) ?? "(uncoded)",
  }));
  const mapping = inferAccountMapping(coded, state.reference);
  const sameAccount = (ours: Transaction, theirs: { account?: string }) => {
    if (theirs.account === undefined) return true;
    const expected = mapping.get(ours.account);
    return expected !== undefined ? expected === theirs.account : mapping.size === 0;
  };
  const result = compareCodings(coded, state.reference, {
    chart: state.chart,
    accountMatches: sameAccount,
    aliases: (state.rules as { aliases?: Record<string, string> } | undefined)?.aliases ?? {},
  });
  const theirs = [...result.agreed, ...result.differed]
    .filter((r) => r.theirs !== null)
    .map((r) => ({ transaction: r.transaction, code: r.theirs?.label ?? "" }));

  // Both sources, with yours last so that where a transaction appears in both
  // the agreement is counted twice rather than the disagreement hidden -- the
  // inference weighs them, and seeing both is the point.
  return [...theirs, ...yours];
}

/**
 * Rules proposed from coded history, with the evidence behind each one.
 *
 * Nothing is applied until it is accepted. Every proposal shows how many
 * transactions it saw, how many agreed, and what the competing answers were —
 * because a rule you cannot see the evidence for is a rule you cannot argue
 * with later.
 */
let rulesFoldOpen = false;

/** A rule's code as the account it codes to, where the file's name is matched. */
function codedAs(code: string): string {
  const to = mapToOurVocabulary(code);
  return to === null || to === "" ? `${code} (not matched)` : to === code ? code : `${to} (\u201c${code}\u201d)`;
}

/**
 * The rules the coded history suggests, for the Rules step on Start here.
 *
 * Accepting one redraws whichever page is showing, so the rest stay where
 * they were -- on this step -- rather than being looked for on another page.
 */
export function ruleSuggestions(): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "setup-rule-suggestions";
  renderRuleSuggestions(wrap, false);
  return wrap;
}

function renderRuleSuggestions(body: HTMLElement, withHeading = true): void {
  if (withHeading) {
    const heading = document.createElement("h3");
    heading.textContent = "Rules from your coded history";
    body.append(heading);
  }

  if (state.reference.length === 0) {
    body.append(
      note(
        `Load your coded history first — ${moduleOn("xero") ? "a Xero Account Transactions export, or your spreadsheet" : "your coded spreadsheet"} — ` +
          "and the coding you have already done becomes the rules.",
      ),
    );
    return;
  }

  const examples = codedExamples();
  if (examples.length === 0) {
    body.append(note("No transactions could be matched to a coding in that file."));
    return;
  }

  const drawn = inferRules(examples).filter((p) => {
    const known = ((state.rules as RuleFileShape | undefined)?.rules ?? []);
    return !known.some(
      (r) =>
        r.keyword === p.rule.keyword &&
        r.account === p.rule.account &&
        (r.where?.otherPartyAccount ?? "") === (p.rule.where?.otherPartyAccount ?? ""),
    );
  });
  // Not from the file's words for transfers or for lines it left out: those
  // name no account, and a rule cannot code to one.
  const kinds = referenceKinds();
  const proposals = drawn.filter((p) => kinds[p.rule.code] === undefined);
  const cover = coverage(state.ledger.transactions, proposals);

  if (proposals.length === 0) {
    body.append(
      note(
        `${examples.length} of your transactions have a coding in that file, and your rules ` +
          "already hold everything it can teach. What is left is one-off customers and " +
          "suppliers, better coded individually.",
      ),
    );
    return;
  }

  body.append(
    note(
      `${examples.length} of your transactions have a coding in that file. ` +
        `${proposals.length} new rules can be drawn from them, which would code ` +
        `${cover.covered} of ${cover.total} transactions. The rest are one-off customers and ` +
        "suppliers, better coded individually.",
    ),
  );

  if (proposals.length === 0) return;

  // A rule codes to an account, so one learned from a name the file uses has
  // to know which account that name is. Accepting one that did not used to do
  // nothing at all, without a word; now it says so and waits for the match.
  const ready = proposals.filter((p) => {
    const to = mapToOurVocabulary(p.rule.code);
    return to !== null && to !== "";
  });
  const waiting = proposals.length - ready.length;
  if (waiting > 0) {
    body.append(
      note(
        `${waiting} of these ${waiting === 1 ? "is" : "are"} for a name in the file not matched to ` +
          "an account yet. Match the name in the file's coding table, and the rule can be accepted.",
      ),
    );
  }

  if (ready.length > 0) {
    const acceptAll = document.createElement("button");
    acceptAll.type = "button";
    acceptAll.className = "primary";
    acceptAll.textContent = `Accept all ${ready.length}`;
    acceptAll.addEventListener("click", () => {
      acceptAll.disabled = true;
      void acceptProposals(ready);
    });
    body.append(acceptAll);
  }

  const table = document.createElement("table");
  table.className = "report-table owner-table setup-table";
  const head = document.createElement("thead");
  head.innerHTML =
    "<tr><th>Evidence</th><th>When the line says</th><th>Code it to</th>" +
    "<th>Account</th><th>Also seen as</th><th></th></tr>";
  const tbody = document.createElement("tbody");

  for (const proposal of proposals.slice(0, 200)) {
    const tr = document.createElement("tr");
    const competing =
      proposal.competing.length === 0
        ? ""
        : proposal.competing.map((c) => `${c.code} ×${c.count}`).join(", ");
    for (const [text, cls] of [
      [`${proposal.agreed} of ${proposal.seen}`, "report-amount"],
      // What the rule actually matches on. A rule keyed on the account the
      // money went to has no keyword, and a row reading "18 of 18 -> 200
      // Sales" with nothing in this column cannot be judged at all.
      [
        proposal.rule.keyword ??
          (proposal.rule.where?.otherPartyAccount !== undefined
            ? `paid to/from ${proposal.rule.where.otherPartyAccount}`
            : ""),
        "report-name",
      ],
      [codedAs(proposal.rule.code), "report-name"],
      [proposal.rule.account ?? "any", "report-name"],
      [competing, "report-name"],
    ] as const) {
      const td = document.createElement("td");
      td.textContent = text;
      td.className = cls;
      if (text !== "") td.title = proposal.examples.join("\n");
      tr.append(td);
    }
    const actions = document.createElement("td");
    actions.className = "report-amount";
    const accept = document.createElement("button");
    accept.type = "button";
    const to = mapToOurVocabulary(proposal.rule.code);
    if (to === null || to === "") {
      accept.textContent = "Match the name";
      accept.addEventListener("click", () => {
        if (!showCodingMatch(proposal.rule.code)) {
          alert(
            `"${proposal.rule.code}" is not matched to an account yet. Match it in the file's ` +
              "coding table, on the Coded history step or the Coding reconciliation page.",
          );
        }
      });
    } else {
      accept.textContent = "Accept";
      accept.addEventListener("click", () => {
        accept.disabled = true;
        void acceptProposals([proposal]);
      });
    }
    actions.append(accept);
    tr.append(actions);
    tbody.append(tr);
  }
  table.append(head, tbody);
  body.append(table);
}

/**
 * Rules from the coded history, made without asking, exceptions kept.
 *
 * A payee coded the same way at least three times in four out of five --
 * what the proposals already require -- becomes a rule. The fifth is the
 * catch: a rule codes every line it matches, including the one the other
 * system coded to something else on purpose. So once the rules are in, every
 * line the file coded differently from what they now say is confirmed with
 * the file's own account and rate, exactly as "use Xero/Imported" would.
 * The rules only ever fill in what the file agrees with.
 */
async function adoptRulesFromHistory(): Promise<{ rules: number; kept: number; adopted: number }> {
  const examples = codedExamples();
  if (examples.length === 0) return { rules: 0, kept: 0, adopted: 0 };
  const file = (state.rules as RuleFileShape | undefined) ?? { rules: [] };
  const known = file.rules ?? [];
  const proposals = inferRules(examples).filter(
    (p) =>
      !known.some(
        (r) =>
          r.keyword === p.rule.keyword &&
          r.account === p.rule.account &&
          (r.where?.otherPartyAccount ?? "") === (p.rule.where?.otherPartyAccount ?? ""),
      ),
  );
  const usable = inOurVocabulary(proposals);

  const rules = [...known];
  for (const proposal of usable) {
    rules.push(proposal.rule);
    // One entry each, with its place in the list, so History can take any
    // one of them back.
    void record(
      "rule",
      `Made from the imported coding: ${proposal.rule.keyword ?? proposal.rule.where?.otherPartyAccount ?? ""}` +
        ` → ${proposal.rule.code} (${proposal.agreed} of ${proposal.seen} agreed)`,
      null,
      proposal.rule,
      String(rules.length - 1),
    );
  }
  if (usable.length > 0) {
    state.rules = { ...file, rules } as RuleSet;
    state.rulesName = state.rulesName === "" ? "suggested-rules.json" : state.rulesName;
    reclassify();
    await persistRules();
  }

  // Then the file's own coding, wherever no rule speaks for a line: the
  // exceptions -- lines it coded otherwise than the rules now do, another
  // account or the same account at another rate -- and the payees seen too
  // seldom for a rule, which were left as a hundred and more lines to accept
  // by hand. Only lines nobody has decided yet; splits, invoice payments and
  // transfers are settled on their own terms and are not among these.
  const overrides = state.ledger.overrides ?? {};
  const { differed, gstFlags, adoptable } = compareWithReference();
  const seen = new Set<string>();
  const keep = [...differed, ...gstFlags, ...adoptable]
    .filter((r) => r.theirs !== null && overrides[r.transaction.id]?.confirmed !== true)
    .filter((r) => !seen.has(r.transaction.id) && seen.add(r.transaction.id) !== undefined)
    .map((r) => ({
      transaction: r.transaction,
      code: r.theirs?.label ?? "",
      kind: "imported",
      ...((r.theirs?.gstRate ?? "") !== "" ? { rate: r.theirs?.gstRate ?? "" } : {}),
    }))
    .filter((item) => item.code !== "");
  const exceptions = new Set([...differed, ...gstFlags].map((r) => r.transaction.id));
  if (keep.length > 0) await acceptCodesBulk(keep);
  return {
    rules: usable.length,
    kept: keep.filter((k) => exceptions.has(k.transaction.id)).length,
    adopted: keep.filter((k) => !exceptions.has(k.transaction.id)).length,
  };
}

/**
 * Proposals with their account named the way this chart names it.
 *
 * A proposal learned from an export carries the export's label -- "200 Sales"
 * -- where the chart says "Sales - 200", and a rule coding to the first made
 * it a second account beside the real one: nineteen duplicated accounts on
 * one migration. Translated as accepting the export's coding translates it;
 * one that names nothing in the chart is left out rather than invented.
 */
function inOurVocabulary(proposals: readonly RuleProposal[]): RuleProposal[] {
  const out: RuleProposal[] = [];
  for (const proposal of proposals) {
    const mapped = mapToOurVocabulary(proposal.rule.code);
    if (mapped === null || mapped === "") continue;
    out.push({ ...proposal, rule: { ...proposal.rule, code: mapped } });
  }
  return out;
}

/** Add accepted proposals to the rule set, recording each as a change. */
async function acceptProposals(offered: readonly RuleProposal[]): Promise<void> {
  rulesFoldOpen = true;
  const proposals = inOurVocabulary(offered);
  const file = (state.rules as RuleFileShape | undefined) ?? { rules: [] };
  const rules = [...(file.rules ?? [])];
  for (const proposal of proposals) {
    rules.push(proposal.rule);
    void record(
      "rule",
      `Accepted a suggested rule: ${proposal.rule.keyword} → ${proposal.rule.code}` +
        ` (${proposal.agreed} of ${proposal.seen} agreed)`,
      null,
      proposal.rule,
      String(rules.length - 1),
    );
  }
  state.rules = { ...file, rules } as RuleSet;
  state.rulesName = state.rulesName === "" ? "suggested-rules.json" : state.rulesName;
  reclassify();
  await persistRules();
  // Whichever page is showing, not the one these proposals used to live on.
  // They moved to the Check page and this did not follow, so accepting a rule
  // redrew a hidden Setup and left the proposals sitting on screen looking
  // ignored -- they had in fact been accepted, and said so the moment you
  // navigated away and back.
  showPage(state.page);
}

/**
 * A coding history to fill in on a sheet: the three columns this page reads,
 * and two invented lines showing how. Money in is positive, money out negative.
 */
const CODING_TEMPLATE =
  "Date,Amount,Account,Description\r\n" +
  "15/04/2025,-120.50,Motor Vehicle Expenses,Fuel (example -- replace with your own)\r\n" +
  "30/04/2025,2300.00,Sales,Invoice 1001 (example)\r\n";

/**
 * Asking a model about the next few lines nothing recognises.
 *
 * On the page where the coding is done rather than only on its own, because
 * this is where somebody already is when a line has nothing on it -- and
 * hidden entirely until a key is set, so books that do not use it never see a
 * button they cannot press.
 */
function wireAiButton(): void {
  const group = $("reconcile-ai-group");
  const button = $<HTMLButtonElement>("reconcile-ai");
  const menu = $("reconcile-ai-menu");
  const withKey = $<HTMLButtonElement>("reconcile-ai-key");
  const withPrompt = $<HTMLButtonElement>("reconcile-ai-prompt");
  const paste = $("reconcile-ai-paste");
  const notice = $("reconcile-ai-notice");
  let haveKey = false;
  let ownKey = false;
  let shared: { model: string; left: number } | null = null;
  /**
   * Whether these books have AI turned off.
   *
   * The button is there either way now, from the moment the books open. It
   * used to appear only once AI had been turned on, which meant nobody who had
   * not already found the AI page ever learned there was anything to turn on.
   * Off, it says so when pressed and points at where to change that.
   */
  let aiOff = !aiAllowed();

  const openMenu = (open: boolean): void => {
    menu.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  };

  const say = (): void => {
    const left = waitingForAnswers().length;
    if (aiOff) {
      // Pressable while off: pressing it is how somebody finds out why.
      button.textContent = "AI suggestions";
      button.disabled = false;
      return;
    }
    button.textContent = left === 0 ? "Nothing to ask about" : `AI suggestions (${left})`;
    button.disabled = left === 0;
    withKey.textContent = ownKey
      ? "Ask with my key…"
      : shared !== null
        ? `Ask with the shared key (${Math.min(left, AI_BATCH)} at a time)`
        : "Ask with my key";
    withKey.disabled = !haveKey;
    // A copy running in a browser alone has nowhere to keep a key and nothing
    // to ask from, so there is no key to set anywhere -- and telling somebody
    // to go and set one on a page that cannot is worse than saying nothing.
    // The demo is exactly this case, and it is the first thing a visitor
    // hovers over.
    withKey.title = ownKey
      ? "Asked automatically, and charged to your key."
      : shared !== null
        ? aiRoute() === "folder"
          ? "Asked automatically, using the NZOSA demo key."
          : "Asked automatically, using this site's key."
        : aiRoute() === "none"
          ? "Needs the app on your own computer, or books on the server. Copy a prompt " +
            "instead; it works anywhere without a key."
          : "No key set for these books. Set one on the AI suggestions page.";
    // No count: how many is chosen in the section this opens, so naming one
    // here would be promising a number the next screen then asks about.
    withPrompt.textContent = "Copy a prompt for any AI model";
  };

  /**
   * What can be asked, and on whose key, said again after every ask.
   *
   * Once, at load, was enough when the count only mattered to one person. The
   * demo's allowance is shared by every visitor, so the figure moves under the
   * page as well as because of it, and a count that never updates is a count
   * that is wrong after the first press.
   */
  const learn = (): Promise<void> =>
    aiStatus().then((status) => {
      aiOff = !aiAllowed();
      if (aiOff) {
        group.hidden = false;
        say();
        return;
      }
      ownKey = status?.configured === true;
      // A shared key counts: somebody with none of their own can still ask
      // automatically, up to what the site allows.
      haveKey = ownKey || status?.sharedKey === true;
      shared = null;
      notice.hidden = true;
      if (!ownKey && status?.sharedKey === true) {
        shared = {
          model: status.sharedModel ?? "",
          left: Math.max(0, (status.demoLimit ?? 0) - (status.demoUsed ?? 0)),
        };
        // Said on the page where the asking happens, not only on the page
        // where it is set up: somebody here has not necessarily been there.
        notice.hidden = false;
        notice.textContent = "";
        notice.append(
          document.createTextNode(
            isDemoBuild()
              ? // No sign-in in the demo, so one allowance for everybody rather
                // than one each, and it refills only when the owner says. Kept
                // short: the demo's books are invented, so there is nothing
                // here a visitor needs warning about before pressing it.
                // The model named as the key has it, so the wording follows
                // the key rather than going stale when the model changes.
                `You can try AI Suggestions using a paid key, currently set up with ${modelName(shared.model)}, `
              : // A downloaded copy, and books kept in the browser, share one allowance.
                aiRoute() === "folder" || aiRoute() === "demo"
                ? "No key on these books, so this can use a shared key belonging to whoever " +
                  `runs nbparagliding.nz — ${shared.model || "a flash model"}, with ` +
                  `${shared.left} transactions left in one allowance shared by everybody ` +
                  "without a key, asked twenty at a time. What you send goes to Google through " +
                  "their account, so add a key of your own for a client's books. "
                : "You can try this without a key of your own. This site offers a shared one — " +
                  `${shared.model || "a flash model"}, ${shared.left} transactions left on ` +
                  "your account — asked twenty at a time. What you send goes to Google under " +
                  "the site owner's account, so add a key of your own for a client's books. ",
          ),
        );
        const where = document.createElement("button");
        where.type = "button";
        where.className = "link-button";
        where.textContent = isDemoBuild()
          ? "or add your own key for Claude, OpenAI (ChatGPT), Gemini, OpenRouter or Jev"
          : "Add your own key";
        where.addEventListener("click", () => showPage("ai"));
        notice.append(where);
        // The worry that stops somebody pasting a paid key, answered where
        // they are deciding rather than only on the page the link goes to.
        if (isDemoBuild()) {
          notice.append(
            document.createTextNode(
              ". A key of your own stays in this browser tab and goes only to that provider, " +
                "never to this site.",
            ),
          );
        }
      }
      group.hidden = false;
      say();
    });
  void learn();
  // A key added, changed or removed on the AI page: find out again, rather
  // than go on offering the key that was there when these books opened.
  document.addEventListener(AI_CHANGED, () => void learn());

  /** Off: say so where the button is, with the way to turn it on. */
  const sayItIsOff = (): void => {
    notice.hidden = false;
    notice.textContent = "";
    notice.append(
      document.createTextNode(
        "AI suggestions are turned off for these books. They suggest an account for the " +
          "lines your rules do not recognise. ",
      ),
    );
    const go = document.createElement("button");
    go.type = "button";
    go.className = "link-button";
    go.textContent = "Turn on AI suggestions";
    go.addEventListener("click", () => showPage("ai"));
    notice.append(go);
  };

  button.addEventListener("click", () => {
    if (!aiAllowed()) {
      sayItIsOff();
      return;
    }
    // Turned on since this page was drawn: find out what can be asked, then
    // open the menu as though it had been on all along.
    if (aiOff) {
      notice.hidden = true;
      void learn().then(() => openMenu(true));
      return;
    }
    if (button.disabled) return;
    say();
    openMenu(menu.hidden);
  });

  // A menu that will not close is worse than no menu.
  document.addEventListener("click", (event) => {
    if (!group.contains(event.target as Node)) openMenu(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") openMenu(false);
  });

  const showTheAiOnes = (): void => {
    // Straight to them: a suggestion nobody can find is a suggestion nobody
    // asked for.
    state.reconcileFilter = "ai";
    const filter = document.getElementById("reconcile-filter");
    if (filter instanceof HTMLSelectElement) filter.value = state.reconcileFilter;
  };

  withPrompt.addEventListener("click", () => {
    openMenu(false);
    if (waitingForAnswers().length === 0) return;
    // The whole of it, here: how many, the copying, and somewhere to paste the
    // answer -- rather than a copy that has already happened and a box under
    // it. Choosing how many is part of the question, and on this page the
    // lines it is about are the ones behind it.
    paste.textContent = "";
    paste.hidden = false;
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "Close";
    close.addEventListener("click", () => {
      paste.hidden = true;
    });
    paste.append(
      carrySection({
        onRead: ({ got }) => {
          // Done with, so out of the way: it would otherwise sit open over
          // the suggestions it just produced.
          paste.hidden = true;
          if (got > 0) showTheAiOnes();
          say();
          redraw("reconcile");
        },
        alongside: [close],
      }),
    );
    paste.scrollIntoView({ block: "nearest" });
  });

  /** Ask, and put what comes back where it can be found. */
  const askFor = (howMany: number): void => {
    const waiting = waitingForAnswers();
    if (waiting.length === 0 || !haveKey) return;
    paste.hidden = true;
    button.disabled = true;
    // Said, and moving, for the reason the bank fetch says and moves: the
    // request goes out to a model and comes back when the model is done, and
    // a button that does not change is how somebody comes to press it three
    // times. The same stripes as the feed, so waiting looks the same
    // wherever this app is waiting.
    button.textContent = "Asking AI…";
    button.classList.add("working");
    button.setAttribute("aria-busy", "true");
    void askAboutLines(waiting, howMany)
      .then(({ got, said: trouble }) => {
        if (trouble !== "") alert(trouble);
        if (got > 0) showTheAiOnes();
        redraw("reconcile");
      })
      .catch((error: unknown) => {
        // Nothing below this throws today, but a button left saying "Asking
        // AI" for good is the wrong way to find out that changed.
        alert((error as Error).message);
      })
      .finally(() => {
        button.classList.remove("working");
        button.removeAttribute("aria-busy");
        // Puts the label and the count back, whatever happened -- and the
        // allowance, which that ask has just spent from.
        say();
        void learn();
      });
  };

  withKey.addEventListener("click", () => {
    openMenu(false);
    const waiting = waitingForAnswers();
    if (waiting.length === 0 || !haveKey) return;

    // On the shared key the size is not a choice: twenty is what it allows.
    if (!ownKey) {
      askFor(AI_BATCH);
      return;
    }

    // On their own, it is. Asked here rather than assumed, the same way the
    // prompt route asks it.
    paste.textContent = "";
    paste.hidden = false;
    const heading = document.createElement("h3");
    heading.textContent = "Ask with my key";
    const said = document.createElement("p");
    said.className = "cloud-said";
    said.textContent =
      `${waiting.length} lines are waiting. Choose how many to send (up to ${AI_OWN_BATCH}); ` +
      "they are charged to your key.";

    const howMany = document.createElement("select");
    for (const size of [20, 50, AI_OWN_BATCH, waiting.length]) {
      if (size > Math.min(waiting.length, AI_OWN_BATCH)) continue;
      const option = document.createElement("option");
      option.value = String(size);
      option.textContent = `${size} lines`;
      option.selected = size === Math.min(AI_BATCH, waiting.length);
      howMany.append(option);
    }
    const label = document.createElement("label");
    label.className = "ai-model";
    label.append("How many ", howMany);

    const go = document.createElement("button");
    go.type = "button";
    go.className = "primary";
    go.textContent = "Get suggestions";
    go.addEventListener("click", () => askFor(Number(howMany.value)));

    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "Close";
    close.addEventListener("click", () => {
      paste.hidden = true;
    });

    const row = document.createElement("div");
    row.className = "migration-actions";
    row.append(go, close);
    paste.append(heading, said, label, row);
    paste.scrollIntoView({ block: "nearest" });
  });
}

/**
 * The GST an account gives a line coded to it, where nothing else says.
 *
 * Accepting another system's coding where its export named no rate kept the
 * line's uncoded default -- 15% -- rather than the account's own: Owner
 * Drawings and overseas stock payments went in at 15%, and a return built
 * from them claimed GST nobody paid.
 */
function accountDefault(code: string, amount: number): { treatment: GstTreatment; side: GstSide } | null {
  const rate = accountRate(code);
  return rate === null ? null : rateToClassification(rate, amount);
}

/** Loading what the other system coded, clearing it, and accepting in bulk. */
export function wireCodingReconciliation(): void {
  wireSheetAi();

  $("accept-all").addEventListener("click", () => void acceptAllShown());
  wireAiButton();
  $("check-pick").addEventListener("click", () => $<HTMLInputElement>("check-input").click());
  $("check-template").addEventListener("click", () =>
    download(CODING_TEMPLATE, "coding-history-template.csv", "text/csv"),
  );
  $("check-clear").addEventListener("click", () => clearCheck());
  $<HTMLInputElement>("check-input").addEventListener("change", (e) => {
    const files = [...((e.target as HTMLInputElement).files ?? [])];
    if (files.length > 0) void loadCheckFiles(files);
    (e.target as HTMLInputElement).value = "";
  });
}

/**
 * Record that the coding here is right and the other system's is not.
 *
 * The same shape as accepting: a confirmed override, with a note saying where
 * the decision was made. The code does not change -- it is already what the
 * person wants -- but the line stops being an open question, which is the
 * whole point. A return built afterwards can be defended by pointing at the
 * decision rather than at the absence of one.
 */
async function keepOurCoding(transaction: Transaction, code: string): Promise<void> {
  if (codingRefusedForTransfer(transaction)) return;
  const one = state.suggestions?.get(transaction.id);
  const overrides = { ...(state.ledger.overrides ?? {}) };
  const was = overrides[transaction.id];
  const side = one?.classification.side;

  overrides[transaction.id] = {
    ...(was ?? {}),
    confirmed: true,
    code,
    treatment: was?.treatment ?? one?.classification.treatment ?? "standard",
    ...(side !== undefined && side !== "none" ? { side } : {}),
    note: "Checked against the imported coding and kept, on the Coding reconciliation page.",
    at: new Date().toISOString().slice(0, 10),
  };

  state.ledger = { ...state.ledger, overrides };
  state.persistent = await savePart(state.ledger);
  await record(
    "coding",
    `${transaction.date} ${formatAmount(transaction.amount)} ${transaction.otherParty} → ${code} ` +
      "(kept, against the imported coding)",
    was ?? null,
    overrides[transaction.id],
    transaction.id,
  );
  redraw("check");
}

/** `gemini-3.6-flash` as `Gemini 3.6 Flash`, for saying which model a key uses. */
function modelName(model: string): string {
  if (model.trim() === "") return "a Gemini Flash model";
  return model
    .split(/[-_\s]+/)
    .filter((word) => word !== "")
    .map((word) => (/^[a-z]/.test(word) ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(" ");
}
