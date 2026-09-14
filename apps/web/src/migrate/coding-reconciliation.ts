import { redraw, showPage } from "../app.js";
import {
  unregisteredCode,
  accountDecided,
  codingRefusedForTransfer,
  accountsFor,
  ensureDefaultEntity,
  invoiceAssignments,
  mapToOurVocabulary,
  persistRules,
  reclassify,
  record,
  sameEntityBanks,
  shownSuggestions,
  tidyChart,
} from "../books.js";
import {
  compareCodings,
  inferAccountMapping,
  loadReference,
  readChosenColumns,
} from "../check-ui.js";
import type { CodingBatchEntry } from "../events.js";
import { fillAccounts } from "../widgets.js";
import { knownCodes, rateLabel, suggest, transferCandidates } from "../reconcile.js";
import type { Suggestion } from "../reconcile.js";
import type { RuleFileShape } from "../rules-ui.js";
import { $, state } from "../state.js";
import { save, savePart } from "../store.js";
import { amountCell, nameCell, note } from "../ui.js";
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
export async function acceptAllShown(): Promise<void> {
  const offered = shownSuggestions().filter((one) => !one.confirmed && one.code !== null);

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

  if (lines.length === 0) {
    alert(
      held.size > 0
        ? `Nothing accepted: the ${held.size === 1 ? "line" : `${held.size} lines`} left could be a ` +
            "transfer between your own accounts. Check each one on its own."
        : "Nothing on screen to accept: every line here is settled already, or has no suggestion to accept.",
    );
    return;
  }

  const accounts = new Set(lines.map((one) => one.code));
  const summary =
    accounts.size === 1
      ? `all to ${[...accounts][0]}`
      : `across ${accounts.size} accounts`;
  if (
    !confirm(
      `Accept ${lines.length} suggestion${lines.length === 1 ? "" : "s"}, ${summary}?` +
        "\n\n" +
        (held.size > 0
          ? `${held.size} line${held.size === 1 ? " matches" : "s match"} a line of the same amount in ` +
            `another of your accounts and could be a transfer. ${held.size === 1 ? "It is" : "They are"} ` +
            "left unconfirmed -- neither coded nor paired -- to check one at a time.\n\n"
          : "") +
        "This confirms them exactly as shown. The change log can undo the whole batch.",
    )
  ) {
    return;
  }

  const overrides = { ...(state.ledger.overrides ?? {}) };
  const batch: CodingBatchEntry[] = [];
  const today = new Date().toISOString().slice(0, 10);
  for (const one of lines) {
    batch.push({ id: one.transaction.id, before: overrides[one.transaction.id] ?? null });
    overrides[one.transaction.id] = {
      ...(one.code !== null ? { code: one.code } : {}),
      confirmed: true,
      treatment: one.classification.treatment,
      side: one.classification.side,
      note: "Suggestion accepted unchanged, with others",
      at: today,
    };
  }

  state.ledger = { ...state.ledger, overrides };
  state.persistent = await save(state.ledger);
  await record(
    "codingBatch",
    `Accepted ${lines.length} suggestions ${summary}`,
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
      "This looks like a table, but not one of the shapes read automatically. " +
        "Point out the three columns that matter and it will be read as it is.",
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
        "Load a Xero Account Transactions export (.xlsx) or the workbook (.xlsx) to check against. " +
          "A chart of accounts (.csv) helps too: it lets a code and a name be recognised as the same account.",
      ),
    );
    return;
  }

  const suggestions = suggest(
    state.ledger.transactions,
    state.rules,
    state.ledger.overrides ?? {},
    accountsFor(state.checkAccounts),
    unregisteredCode(),
  );
  state.suggestions = new Map(suggestions.map((one) => [one.transaction.id, one]));

  // The rules' own opinion, with any human decision taken out of the way.
  const proposals = suggest(
    state.ledger.transactions,
    state.rules,
    {},
    accountsFor(state.checkAccounts),
    unregisteredCode(),
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

  const checked = result.agreed.length + result.differed.length;
  const rate = checked === 0 ? 0 : (result.agreed.length / checked) * 100;

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
      `${state.reference.length} reference lines loaded, and ${state.ledger.transactions.length} ` +
      "transactions — but none of them is coded yet, so there is nothing to compare. " +
      "That is the right way round: the coding in this file is what writes the rules, " +
      "and they are below.";
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

  const comparable = result.uncoded.filter((r) => r.theirs !== null && !isSplit(r));
  const adoptable = comparable.filter((r) => !settledElsewhere(r));
  const alreadySettled = comparable.length - adoptable.length;


  const gstFlags = [...result.agreed, ...result.differed].filter(
    (r) => r.gstDiffers && !isSplit(r),
  );
  // A difference somebody has looked at and settled is no longer a question.
  // Keeping it on the list would make the one action that says "mine is right"
  // do nothing visible, which reads as a broken button rather than a decision.
  const settled = (r: CodingRow): boolean =>
    (state.ledger.overrides ?? {})[r.transaction.id]?.note ===
    "Checked against the imported coding and kept, on the Coding reconciliation page.";
  const differed = result.differed.filter((r) => !isSplit(r) && !settled(r));
  const kept = result.differed.filter((r) => !isSplit(r) && settled(r)).length;

  const summary = document.createElement("div");
  summary.className = "check-summary";
  for (const [value, label] of [
    [String(result.agreed.length), "agree"],
    [String(differed.length), "differ"],
    ...(kept > 0 ? ([[String(kept), "kept as ours"]] as const) : []),
    [`${rate.toFixed(1)}%`, "of checkable lines agree"],
    [String(gstFlags.length), "GST rate differs"],
    [
      splitsToDo.length === 0
        ? String(splitRows.length)
        : `${splitRows.length} / ${splitsToDo.length}`,
      splitsToDo.length === 0
        ? "split in Xero/Imported, all matched here"
        : "split in Xero/Imported / still to match",
    ],
    [String(result.unreferenced.length), "coded, nothing to check against"],
    [String(result.uncoded.length - alreadySettled), "not coded yet"],
    // The mirror of the line above, and the one nobody was told. A line in the
    // file with no transaction behind it used to vanish without a count.
    [String(result.unmatched.length), "in the file, not in your ledger"],
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

  body.append(
    note(
      `${state.reference.length} reference lines loaded. Only lines that exist on both sides ` +
        "can be checked; the rest are shown so the coverage is visible rather than assumed.",
    ),
  );

  // The order is the order somebody should work in.
  //
  // Splits first, because a split changes what a line *is*: a courier payment
  // that is really freight, border GST and a fee cannot be coded to one
  // account at all, so coding it before splitting it means doing it twice.
  if (splitsToDo.length > 0) {
    body.append(section("Xero/Imported splits these", splitsToDo, proposedBy, false));
    body.append(
      note(
        "A split payment cannot be compared on one code, so these are kept out of the counts " +
          "above. Open one to see its parts; loading them replaces whatever split is held here.",
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
        "These have a coding in the file and none here. “Use Xero/Imported” takes it, one " +
          "line at a time -- which is the way through the ones no rule can gather: a " +
          "supplier whose payee changes with every payment, or one coded to a " +
          "different account each time.",
      ),
    );
  }

  // Said rather than silently dropped. A row leaving a section without a word
  // is how somebody comes to trust a count that is quietly wrong.
  if (alreadySettled > 0) {
    body.append(
      note(
        `${alreadySettled} more ${alreadySettled === 1 ? "line is" : "lines are"} coded in the ` +
          "file and left off that list, because they are already posted here the same way: " +
          "a receipt against an invoice clears Accounts Receivable, a payment on a bill " +
          "clears Accounts Payable, and a transfer is posted as one movement across both " +
          "legs. Nothing is missing on these, so there is nothing to adopt.",
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
  if (result.unmatched.length > 0) {
    const heading = document.createElement("h3");
    heading.textContent = `In the file, not in your ledger (${result.unmatched.length})`;
    body.append(heading);
    body.append(
      note(
        "Nothing here matched one of your transactions, so none of it could be checked. " +
          "That means either these are missing from what you imported, or the other " +
          "system holds them and your bank never saw them -- a journal, an adjustment, " +
          "or an account you have not imported.",
      ),
    );

    const table = document.createElement("table");
    table.className = "report-table owner-table";
    const head = document.createElement("thead");
    head.innerHTML =
      "<tr><th>Date</th><th>Amount</th><th>Coded to</th><th>On their account</th></tr>";
    const tbody = document.createElement("tbody");
    // Grouped by their account, because the commonest cause by far is a whole
    // account nobody imported, and a list sorted by date hides that.
    for (const line of [...result.unmatched].sort(
      (a, b) => (a.account ?? "").localeCompare(b.account ?? "") || a.date.localeCompare(b.date),
    )) {
      const tr = document.createElement("tr");
      tr.append(nameCell(line.date));
      tr.append(amountCell(formatAmount(line.amount)));
      tr.append(nameCell(line.label));
      tr.append(nameCell(line.account ?? ""));
      tbody.append(tr);
    }
    table.append(head, tbody);
    body.append(table);
  }

  // And folded away at the foot once there is a comparison to read. Still
  // here, because more rules can always be drawn out as more of the file is
  // matched -- just not in front of what somebody opened the page for.
  if (!nothingCoded) {
    const fold = document.createElement("details");
    fold.className = "check-rules-fold";
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
    `<th class="${gst ? "col-gst" : "col-imported"}">${gst ? "GST ours / theirs" : "Xero/Imported says"}</th>` +
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
        btnXero.textContent = `Use Xero/Imported for all (${totalXero}) (recommended)`;
        btnXero.disabled = totalXero === 0;
      } else {
        const count = rowOptions.filter(
          (o) => selectedIds.has(o.row.transaction.id) && o.canUseXero,
        ).length;
        btnXero.textContent = `Use Xero/Imported for ${count} selected (recommended)`;
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

    if (parts && parts.length > 1) {
      const marker = document.createElement("button");
      marker.type = "button";
      marker.className = "split-marker";
      const held = (state.ledger.splits ?? {})[row.transaction.id];
      marker.textContent =
        `Xero/Imported splits this into ${parts.length}` +
        (held ? ` — split into ${held.length} here` : " — one line here");
      marker.addEventListener("click", () => {
        state.expandedSplit = state.expandedSplit === row.transaction.id ? null : row.transaction.id;
        redraw("check");
      });
      const cell = tr.querySelector(gst ? ".col-gst" : ".col-imported");
      cell?.append(document.createElement("br"), marker);
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
  button.textContent = kind === "imported" ? "use Xero/Imported (recommended)" : "use rules";
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
    const side = stated?.side ?? (stated !== null ? "none" : one?.classification.side);
    overrides[item.transaction.id] = {
      confirmed: true,
      code: chosen,
      treatment: stated?.treatment ?? one?.classification.treatment ?? "standard",
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
      `Nothing in your chart of accounts matches: "${[...unmapped].join('", "')}". ` +
        (applied > 0
          ? `${applied} other line${applied === 1 ? " was" : "s were"} updated.`
          : "No lines were updated. Add those accounts with their tax codes to find them."),
    );
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
      `${single.transaction.date} ${formatAmount(single.transaction.amount)} ${single.transaction.otherParty} → ${chosenCode} (accepted the ${single.kind === "imported" ? "Xero/Imported" : single.kind} coding)`,
      batchEvents[0].before,
      overrides[single.transaction.id],
      single.transaction.id,
    );
  } else {
    const kindDesc = items[0]?.kind === "imported" ? "Xero/Imported" : "rules";
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
        note: `Xero/Imported: ${part.description}`,
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
        `${item.transaction.date} ${formatAmount(item.transaction.amount)} ${item.transaction.otherParty} split into ${mapped.length} from Xero/Imported`,
        before ?? null,
        mapped,
        item.transaction.id,
      );
    }
  }

  if (unmappedAll.size > 0) {
    alert(
      `No account in your rules matches: ${[...unmappedAll].join(", ")}. ` +
        "Add a code treatment first, otherwise the GST on those parts would only be assumed.",
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
      `Loaded ${applied} splits from Xero/Imported on Coding reconciliation page`,
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
      // The old wording sent people to set a code treatment, which has not been
      // the only way to answer this since the chart's own tax code started
      // being read. What is actually missing is the account.
      alert(
        `Nothing here matches "${code}". Add that account to your chart of ` +
          "accounts -- with its tax code -- and this will find it.",
      );
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
  const side = stated?.side ?? (stated !== null ? "none" : one?.classification.side);
  const kindName = kind === "imported" ? "Xero/Imported" : kind;
  overrides[transaction.id] = {
    confirmed: true,
    code: chosen,
    treatment: stated?.treatment ?? one?.classification.treatment ?? "standard",
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
      note: `Xero/Imported: ${part.description}`,
    });
  }

  if (unmapped.length > 0) {
    alert(
      `No account in your rules matches ${unmapped.join(", ")}. ` +
        "Add a code treatment first, otherwise the GST on those parts would only be assumed.",
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
    `${transaction.date} ${formatAmount(transaction.amount)} ${transaction.otherParty} split into ${mapped.length} from Xero/Imported`,
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
function renderRuleSuggestions(body: HTMLElement, withHeading = true): void {
  if (withHeading) {
    const heading = document.createElement("h3");
    heading.textContent = "Rules from your coded history";
    body.append(heading);
  }

  if (state.reference.length === 0) {
    body.append(
      note(
        "Load your coded history first — a Xero Account Transactions export, or your " +
          "spreadsheet — and the coding you have already done becomes the rules.",
      ),
    );
    return;
  }

  const examples = codedExamples();
  if (examples.length === 0) {
    body.append(note("No transactions could be matched to a coding in that file."));
    return;
  }

  const proposals = inferRules(examples).filter((p) => {
    const known = ((state.rules as RuleFileShape | undefined)?.rules ?? []);
    return !known.some(
      (r) =>
        r.keyword === p.rule.keyword &&
        r.account === p.rule.account &&
        (r.where?.otherPartyAccount ?? "") === (p.rule.where?.otherPartyAccount ?? ""),
    );
  });
  const cover = coverage(state.ledger.transactions, proposals);

  body.append(
    note(
      `${examples.length} of your transactions have a coding in that file. ` +
        `${proposals.length} new rules can be drawn from them, which would code ` +
        `${cover.covered} of ${cover.total} transactions. The rest are one-offs — ` +
        "individual customers and suppliers that no keyword should try to capture.",
    ),
  );

  if (proposals.length === 0) return;

  const acceptAll = document.createElement("button");
  acceptAll.type = "button";
  acceptAll.className = "primary";
  acceptAll.textContent = `Accept all ${proposals.length}`;
  acceptAll.addEventListener("click", () => void acceptProposals(proposals));
  body.append(acceptAll);

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
      [proposal.rule.code, "report-name"],
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
    accept.textContent = "Accept";
    accept.addEventListener("click", () => void acceptProposals([proposal]));
    actions.append(accept);
    tr.append(actions);
    tbody.append(tr);
  }
  table.append(head, tbody);
  body.append(table);
}

/** Add accepted proposals to the rule set, recording each as a change. */
async function acceptProposals(proposals: readonly RuleProposal[]): Promise<void> {
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

/** Loading what the other system coded, clearing it, and accepting in bulk. */
export function wireCodingReconciliation(): void {

  $("accept-all").addEventListener("click", () => void acceptAllShown());
  $("check-pick").addEventListener("click", () => $<HTMLInputElement>("check-input").click());
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