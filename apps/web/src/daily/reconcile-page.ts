import { offerAsset } from "./assets.js";
import { redraw, showPage } from "../app.js";
import {
  accountsForEditing,
  bankLabel,
  codingProgress,
  invoiceAssignments,
  invoiceBalanceMap,
  persistRules,
  reclassify,
  reconcileRows,
  record,
  sameEntityBanks,
  accountDecided,
  codingRefusedForTransfer,
  transfersAlsoCoded,
  clearingWithoutInvoice,
} from "../books.js";
import { codingReconciliationWaiting } from "../migrate/coding-reconciliation.js";
import { combobox } from "../combobox.js";
import {
  GST_OPTIONS,
  classificationToRate,
  describeFlow,
  knownCodes,
  rateLabel,
  rateToClassification,
  transferCandidates,
} from "../reconcile.js";
import type { GstRate, Suggestion } from "../reconcile.js";
import type { RuleFileShape } from "../rules-ui.js";
import { splitEditor } from "../split-ui.js";
import { $, state } from "../state.js";
import { startNewAccount } from "./entities.js";
import { aiSuggestionFor } from "../ai.js";
import { save, savePart } from "../store.js";
import { note } from "../ui.js";
import { fillAccounts, unresolvedNote } from "../widgets.js";
import {
  accountLabel,
  canonicalCodeFor,
  formatAmount,
  invoiceCandidates as coreInvoiceCandidates,
  keywordFor,
  matchAccountName,
  matchPayoutTransfers,
  splitAccountLabel,
  splitPartId,
} from "@nzosa/core";
import type {
  CategoryRule,
  Cents,
  GstClassification,
  GstSide,
  GstTreatment,
  Invoice,
  InvoiceKind,
  Payout,
  PayoutTransfer,
  RuleSet,
  SplitPart,
  Transaction,
} from "@nzosa/core";


/** An unconfirmed edit to one line: kept across redraws until the line is confirmed. */
interface Draft {
  code?: string;
  gst?: string;
  contact?: string;
  description?: string;
}
const drafts = new Map<string, Draft>();

/**
 * Payees that identify nobody.
 *
 * A bank line often has nothing in it but the transfer's own vocabulary, and a
 * rule on one of these words is a rule on everything.
 */
const GENERIC_PAYEES = new Set([
  "PAYMENT",
  "TRANSFER",
  "DIRECT CREDIT",
  "DIRECT DEBIT",
  "AUTOMATIC PAYMENT",
  "BILL PAYMENT",
  "INTERNET XFR",
  "DEPOSIT",
  "WITHDRAWAL",
  "EFTPOS",
  "VISA PURCHASE",
  "CREDIT",
  "DEBIT",
]);

/**
 * The coding queue: deciding what each bank line is.
 *
 * A statement line arrives with no opinion about itself. The rules offer one,
 * a person accepts it or replaces it, and that acceptance is what separates a
 * guess from a decision -- which is the whole reason a return built from these
 * books can be defended a year later.
 *
 * A line is not always one thing. It can be a transfer between two of your own
 * accounts, which posts twice and is coded neither time; a payment settling an
 * invoice already recorded, which must not be counted as a second sale; a
 * processor payout that is a sale, a fee and a surcharge in one amount; or a
 * meal that is half entertainment. Each of those is offered here and confirmed
 * by hand, because getting one wrong moves a GST return.
 */

export function renderReconcile(): void {
  fillAccounts("reconcile-accounts", state.reconcileAccounts, renderReconcile);
  const body = $("reconcile-body");
  body.textContent = "";

  if (state.ledger.transactions.length === 0) {
    body.append(note("No transactions yet. Import a bank file first."));
    return;
  }

  // Above the queue, because this is the page somebody works from and a row
  // that might be counted twice is worth knowing about before coding it.
  const unresolved = unresolvedNote();
  if (unresolved) body.append(unresolved);

  const codingWarning = codingReconciliationWarning();
  if (codingWarning) body.append(codingWarning);

  // Payouts before anything else, because coding one as it arrives is the
  // mistake this page is most likely to make: it looks like an ordinary
  // receipt and is three postings wearing one figure.
  const payouts = payoutBanner();
  if (payouts) body.append(payouts);

  // A rule written out of the last coding, said once. The tool did something
  // nobody pressed a button for, so it says so, says what it reached, and
  // says where to undo it.
  const made = state.lastRule;
  if (made !== null) {
    state.lastRule = null;
    const said = document.createElement("p");
    said.className = "rule-made";
    said.textContent =
      `Rule added from that coding: anything matching "${made.keyword}" now suggests ` +
      `${made.code}. ` +
      (made.alsoCoded > 0
        ? `It suggests a code for ${made.alsoCoded} other line${made.alsoCoded === 1 ? "" : "s"}, ` +
          "still yours to confirm. "
        : "") +
      "Change or remove it on the Rules page.";
    body.append(said);
  }

  const { all, shown } = reconcileRows();

  const linkedNow = state.ledger.transfers ?? {};
  const done = all.filter(
    (one) => one.confirmed || linkedNow[one.transaction.id] !== undefined,
  ).length;
  // How many the filter matched belongs at the top. It was only said at the
  // foot of the list, which meant scrolling past two hundred rows to find out
  // whether you were looking at forty lines or four thousand.
  const showing: Record<typeof state.reconcileFilter, string> = {
    todo: `${shown.length} still to confirm`,
    suggested: `${shown.length} suggested and waiting`,
    ai: `${shown.length} suggested by the model, none of them agreed to yet`,
    nocode: `${shown.length} with nothing suggested`,
    coded: `${shown.length} coded`,
    all: `${shown.length} lines`,
  };
  $("reconcile-hint").textContent =
    `${showing[state.reconcileFilter]}. ${done} of ${all.length} coded in all. ` +
    "Accept the suggestion or change it; either way the line is coded and stays that way.";

  // Any made before a line could not be both. Said at the top, because the
  // account they were coded to is short by exactly these.
  const clashes = transfersAlsoCoded();
  if (clashes.length > 0) {
    body.append(
      note(
        `${clashes.length} line${clashes.length === 1 ? " is" : "s are"} recorded as a transfer and ` +
          "coded to an account as well. Only the transfer posts, so the account is short: " +
          clashes.map((t) => `${t.date} ${formatAmount(t.amount)} ${t.otherParty}`).join("; ") +
          '. Set the filter to All, find each one, and press "not a transfer" on any that is not.',
      ),
    );
  }

  // A payment coded to receivables with no invoice matched leaves that invoice
  // owing for ever. Said at the top for the same reason as the transfers.
  const unsettled = clearingWithoutInvoice();
  if (unsettled.length > 0) {
    body.append(
      note(
        `${unsettled.length} line${unsettled.length === 1 ? " is" : "s are"} coded to Accounts ` +
          "Receivable or Payable without being matched to an invoice, so no invoice is marked " +
          "paid: " +
          unsettled.map((t) => `${t.date} ${formatAmount(t.amount)} ${t.otherParty}`).join("; ") +
          '. Set the filter to All, find each one, and match it under "Settles which invoice?".',
      ),
    );
  }

  if (shown.length === 0) {
    body.append(note("Nothing left to code here."));
    return;
  }

  const codes = knownCodes(
    state.rules,
    state.ledger.overrides ?? {},
    state.chart,
  );
  for (const one of shown.slice(0, 200)) body.append(renderLine(one, codes));
  if (shown.length > 200) {
    body.append(note(`Showing the first 200 of ${shown.length}.`));
  }
}

/** Everything the bank actually said, for when the summary is not enough. */
function rawFields(transaction: Transaction): HTMLElement {
  const table = document.createElement("table");
  table.className = "code-raw";
  const body = document.createElement("tbody");
  const rows: [string, string][] = [
    [
      "Account",
      `${transaction.extras?.["accountLabel"] ?? ""} ${transaction.account}`.trim(),
    ],
    ["Other party", transaction.otherParty],
    ["Other party account", transaction.otherPartyAccount ?? ""],
    ["Particulars", transaction.particulars ?? ""],
    ["Code", transaction.code ?? ""],
    ["Reference", transaction.reference ?? ""],
    ["Type", transaction.type ?? ""],
    [
      "Serial / TRN",
      `${transaction.serial ?? ""} ${transaction.trn ?? ""}`.trim(),
    ],
    ["Source", `${transaction.source.file} line ${transaction.source.line}`],
    ["Id", transaction.id],
  ];
  for (const [name, value] of rows) {
    if (value === "") continue;
    const tr = document.createElement("tr");
    const th = document.createElement("th");
    th.textContent = name;
    const td = document.createElement("td");
    td.textContent = value;
    tr.append(th, td);
    body.append(tr);
  }
  table.append(body);
  return table;
}

function renderLine(one: Suggestion, codes: readonly string[]): HTMLElement {
  const row = document.createElement("div");
  row.className = one.confirmed ? "code-row done" : "code-row";
  // Which transaction this row is. Nothing on the page needed it, and that is
  // why it was missing -- but a row that cannot be named can only be found by
  // its date and amount, which is a guess whenever two lines share both.
  row.dataset["id"] = one.transaction.id;

  const bank = document.createElement("div");
  bank.className = "code-bank";
  const date = document.createElement("div");
  date.className = "code-date";
  date.textContent = one.transaction.date;
  const who = document.createElement("div");
  who.className = "code-who";
  who.textContent = one.transaction.otherParty || "--";
  const flow = describeFlow(one.transaction, state.ledger.transactions);
  const flowLine = document.createElement("div");
  flowLine.className = flow.internal ? "code-flow internal" : "code-flow";
  const arrow = flow.direction === "out" ? "out to" : "in from";
  const here =
    one.transaction.extras?.["accountLabel"] ?? one.transaction.account;
  flowLine.textContent =
    flow.direction === "out"
      ? `${here} → ${flow.counterparty}`
      : `${flow.counterparty} → ${here}`;
  flowLine.title =
    `Money ${arrow} ${flow.counterparty}` +
    (flow.bothLegs
      ? ". Both sides of this transfer are in the ledger, so it is a movement between your own accounts."
      : flow.internal
        ? ". That account is in the ledger but the matching opposite entry was not found."
        : ".");

  const what = document.createElement("div");
  what.className = "code-what";
  what.textContent = [one.transaction.particulars, one.transaction.reference]
    .filter((part) => part !== undefined && part !== "")
    .join(" · ");
  const details = document.createElement("button");
  details.type = "button";
  details.className = "code-details";
  details.textContent =
    state.expanded === one.transaction.id ? "hide details" : "details";
  details.addEventListener("click", () => {
    state.expanded =
      state.expanded === one.transaction.id ? null : one.transaction.id;
    redraw("reconcile");
  });

  bank.append(date, who, what, flowLine, details);
  if (state.expanded === one.transaction.id)
    bank.append(rawFields(one.transaction));

  const amount = document.createElement("div");
  amount.className =
    one.transaction.amount < 0 ? "code-amount out" : "code-amount in";
  amount.textContent = formatAmount(one.transaction.amount);

  const form = document.createElement("div");
  form.className = "code-form";

  // What a model proposed, where the rules proposed nothing. Offered in the
  // picker the same as a rule's suggestion is, because it is the same kind of
  // thing -- something to agree with or change -- and refusing to put it there
  // would mean retyping an answer that is already on screen.
  const fromModel = one.code === null ? aiSuggestionFor(one.transaction.id) : undefined;
  // What was typed on this line and not yet confirmed, so confirming another
  // line -- which redraws the list -- does not throw it away.
  const draft = drafts.get(one.transaction.id) ?? {};
  const keep = (patch: Draft): void => {
    drafts.set(one.transaction.id, { ...(drafts.get(one.transaction.id) ?? {}), ...patch });
  };
  const codeSelect = combobox(
    codes,
    draft.code ?? one.code ?? fromModel?.code ?? null,
    "Search accounts…",
    () => keep({ code: codeSelect.value }),
    { label: "+ Add new account…", onPick: (typed) => startNewAccount(typed) },
  );

  /**
   * What is standing in for the account, said where the account would be.
   *
   * It was said at the foot of the row, under everything, in the same grey as
   * the reason a rule matched -- so a line that was finished and only wanted a
   * tick read exactly like a line that wanted reading. The account picker is
   * where somebody looks to find out what a line is coded to, so that is where
   * this belongs, and it takes the picker's place rather than sitting beside a
   * dimmed one.
   */
  const insteadOfAccount = document.createElement("div");
  insteadOfAccount.className = "code-instead";
  insteadOfAccount.hidden = true;

  const gstSelect = document.createElement("select");
  gstSelect.className = "gst-select";
  const currentRate = classificationToRate(one.classification);
  for (const rate of GST_OPTIONS) {
    const option = document.createElement("option");
    option.value = rate.value;
    option.textContent = rate.label;
    option.title = rate.hint;
    option.selected = rate.value === (draft.gst ?? currentRate);
    gstSelect.append(option);
  }
  gstSelect.addEventListener("change", () => keep({ gst: gstSelect.value }));

  // Who it was to or from, in readable words rather than the bank's shouting.
  // Editable per line, because a rule cannot know that one payment to a builder
  // was for a different property.
  const to = document.createElement("input");
  to.type = "text";
  to.className = "code-contact";
  to.placeholder = "To";
  to.value = draft.contact ?? one.contact;
  to.addEventListener("input", () => keep({ contact: to.value }));
  to.title =
    "Who this was to or from. Set it for every matching line on the Rules page.";

  const description = document.createElement("input");
  description.type = "text";
  description.className = "code-description";
  description.placeholder = "Description";
  description.value = draft.description ?? one.note ?? "";
  description.addEventListener("input", () => keep({ description: description.value }));

  const ok = document.createElement("button");
  ok.type = "button";
  ok.className = "primary";
  // A confirmed line can still be changed, and used to look as though it could:
  // the account picker, the rate and the description all stayed editable while
  // the button that saves them was disabled. Changing your mind about a coding
  // appeared to work and did nothing at all.
  // A tick rather than the word, because this button is pressed more than
  // anything else in the app and reads faster as a mark than as two letters.
  // The word stays on the change: "Update" is not the same promise as "confirm
  // this", and a tick would say both.
  ok.textContent = one.confirmed ? "Update" : "✓";
  ok.title = one.confirmed
    ? "Save a change to this coding"
    : "Confirm this line as coded";
  // The glyph is not a name. Anything reading this aloud, or listing the
  // buttons on the page, needs the words.
  if (!one.confirmed) {
    ok.setAttribute("aria-label", "Confirm this line as coded");
    ok.classList.add("code-tick");
  }
  ok.addEventListener("click", () => {
    // A transfer chosen on this row is what the tick is confirming. Coding it
    // as well would file the same money twice.
    if (pendingTransfer !== null) {
      void linkTransfer(one.transaction, pendingTransfer);
      return;
    }
    // An account is required. A line confirmed with nothing on it posts
    // nowhere, and confirming used to take it out of the queue, so it left no
    // trace at all: it was neither in the reports nor in the work outstanding.
    // A split or an invoice match is an account by another route, and both
    // count.
    const hasSplit = (state.ledger.splits ?? {})[one.transaction.id] !== undefined;
    const hasInvoice = invoiceAssignments().has(one.transaction.id);
    if (codeSelect.value.trim() === "" && !hasSplit && !hasInvoice) {
      alert(
        "This line needs an account before it can be confirmed.\n\n" +
          "Pick one, split it into parts, or match it to an invoice. Confirming " +
          "with nothing on it would take it off the list and post it nowhere.",
      );

      return;
    }
    void confirmLine(
      one,
      codeSelect.value,
      gstSelect.value as GstRate,
      description.value,
      to.value,
    );
  });

  const splitButton = document.createElement("button");
  splitButton.type = "button";
  splitButton.textContent = (state.ledger.splits ?? {})[one.transaction.id]
    ? "Edit split"
    : "Split";
  splitButton.addEventListener("click", () => {
    state.splitting =
      state.splitting === one.transaction.id ? null : one.transaction.id;
    redraw("reconcile");
  });

  const reason = document.createElement("div");
  reason.className = "code-reason";
  reason.textContent = one.confirmed
    ? (one.note ?? "Confirmed")
    : (state.ledger.splits ?? {})[one.transaction.id]
      ? "Coded by its split, below. The tick agrees to it."
      : fromModel !== undefined
        ? // Named as a model's, and never as a rule's. Somebody deciding whether
          // to press the tick is owed the difference between "your own rule says
          // so" and "something guessed, this confidently, because".
          `AI suggestion${fromModel.via === undefined ? "" : ` (${fromModel.via})`}, ` +
          `${Math.round(fromModel.confidence * 100)}% sure · ${fromModel.because}` +
          (fromModel.caution === undefined ? "" : ` · ${fromModel.caution}`)
        : `${rateLabel(one.classification)} · ${one.reason}`;
  if (fromModel !== undefined) reason.classList.add("code-reason-ai");
  // A suggestion that does not sit right is not the same colour as one that
  // does: money in coded to an account money goes out of wants reading twice.
  if (fromModel?.caution !== undefined) reason.classList.add("code-reason-caution");

  form.append(codeSelect.element, insteadOfAccount, gstSelect, to, description, ok, splitButton);
  row.append(bank, amount, form, reason);

  /**
   * A row with a transfer on it is not a row to code.
   *
   * The dropdown offers its only candidate already chosen, which saves a
   * click and reads, to somebody working down a list, exactly like a row that
   * needs coding -- so the account gets picked, the tick gets pressed, and a
   * movement between two of your own accounts is filed as income. That
   * mistake is quiet and it is the expensive direction, which is why the
   * coding half of the row goes flat while a transfer is chosen: there is
   * nothing to decide there until somebody says it is not a transfer.
   */
  const codingControls: HTMLElement[] = [gstSelect, to, description];
  const comboInput = codeSelect.element.querySelector("input");

  /**
   * Which transfer this row would confirm, or nothing.
   *
   * The tick is the one thing that settles a row, whichever kind of row it is.
   * It used to be switched off while a transfer was chosen, which left the row
   * with a chosen answer, a greyed-out everything, and no way to say yes
   * except a second button -- so it looked finished and was not.
   */
  let pendingTransfer: string | null = null;

  /**
   * Two reasons the coding half of a row can have nothing left to decide.
   *
   * A transfer is not a supply, so there is no account and no GST to pick. An
   * invoice already carries both: settling one posts bank against receivables
   * or payables and takes the tax treatment from the invoice, so the account
   * and rate on this row are read by nothing at all. Leaving them live invited
   * a decision that could not have any effect, which is worse than asking
   * nothing -- somebody picks an account, sees no change, and stops trusting
   * the row.
   *
   * Held as two flags rather than one, because either can be true on its own
   * and each has its own way back.
   */
  let transferChosen = false;
  let invoiceChosen = false;
  let splitChosen = false;

  const applyCoding = (): void => {
    const off = transferChosen || invoiceChosen || splitChosen;
    for (const control of codingControls) {
      (control as HTMLInputElement | HTMLSelectElement).disabled = off;
    }
    if (comboInput instanceof HTMLInputElement) comboInput.disabled = off;
    codeSelect.element.classList.toggle("is-transfer", off);
    codeSelect.element.hidden = off;
    form.classList.toggle("coding-off", off);

    insteadOfAccount.hidden = !off;
    insteadOfAccount.textContent = splitChosen
      ? "Split across accounts"
      : invoiceChosen
        ? "Pays an invoice"
        : pendingTransfer === null
          ? "Transfer between your own accounts"
          : "Transfer — agree to it with the tick";
    insteadOfAccount.classList.toggle(
      "code-instead-ready",
      off && (pendingTransfer !== null || invoiceChosen || splitChosen),
    );

    // Only a transfer already on record leaves nothing for the tick to do. An
    // invoice match still wants confirming, and so does a transfer that has
    // been chosen but not yet agreed to.
    ok.disabled =
      transferChosen &&
      !invoiceChosen &&
      !splitChosen &&
      pendingTransfer === null;
    // The one control still worth pressing must not be dimmed with the ones
    // that are finished with. Flattening the whole row made the tick read as
    // already pressed, which is the opposite of what it was waiting to say.
    ok.classList.toggle("tick-live", !ok.disabled);
    ok.title = transferChosen
      ? pendingTransfer === null
        ? "Already recorded as a transfer between your own accounts."
        : "Confirm this as a transfer between your own accounts"
      : splitChosen
        ? "The accounts and the GST come from the split below."
        : invoiceChosen
          ? "The account and the GST come from the invoice this settles."
          : one.confirmed
            ? "Save a change to this coding"
            : "Confirm this line as coded";
  };

  const setCodingOff = (
    off: boolean,
    partnerId: string | null = null,
  ): void => {
    transferChosen = off;
    pendingTransfer = off ? partnerId : null;
    applyCoding();
  };

  /** The same, for a bank line that settles an invoice. */
  const setInvoiceChosen = (chosen: boolean): void => {
    invoiceChosen = chosen;
    applyCoding();
  };

  /** And for one divided across accounts, which no single box can express. */
  const setSplitChosen = (chosen: boolean): void => {
    splitChosen = chosen;
    applyCoding();
  };

  // All three built before any is placed, because each needs its own switch
  // thrown first and none reads the others.
  const splitRow = splitLineFor(one.transaction, setSplitChosen);
  const transferRow = transferLineFor(one.transaction, setCodingOff);
  const invoiceRow = invoiceLineFor(one.transaction, setInvoiceChosen);

  // The transfer first. It is the stronger claim on the line -- a movement
  // between accounts you hold is not income or spending at all -- and it used
  // to sit under the invoice offer, where somebody meeting the page for the
  // first time read the invoice line and stopped.
  // The split first: it says what the line *is*, and the other two are offers
  // about a line whose nature is already settled.
  if (splitRow) row.append(splitRow);
  if (transferRow) row.append(transferRow);
  if (invoiceRow) row.append(invoiceRow);

  // Shown, not enforced. The code on offer may well be the right principal
  // account; what it cannot do is carry two GST treatments at once. Once the
  // line has been split the caution has been answered, so it goes.
  if (
    one.warn !== undefined &&
    !(state.ledger.splits ?? {})[one.transaction.id]
  ) {
    const caution = document.createElement("div");
    caution.className = "code-warn";
    caution.textContent = one.warn;
    row.append(caution);
  }

  if (state.splitting === one.transaction.id) {
    const parts = (state.ledger.splits ?? {})[one.transaction.id] ?? [];
    const editor = splitEditor({
      transaction: one.transaction,
      parts,
      codes,
      onSave: (saved) => void saveSplit(one.transaction.id, saved),
      onRemove: () => void saveSplit(one.transaction.id, null),
      onCancel: () => {
        state.splitting = null;
        redraw("reconcile");
      },
    });
    editor.classList.add("split-attached");
    row.append(editor);
  }
  return row;
}

async function saveSplit(id: string, parts: SplitPart[] | null): Promise<void> {
  const splits = { ...(state.ledger.splits ?? {}) };
  if (parts === null) delete splits[id];
  else splits[id] = parts;
  state.ledger = { ...state.ledger, splits };
  state.persistent = await save(state.ledger);
  state.splitting = null;
  redraw("reconcile");
}

/**
 * Candidate invoices for one bank line.
 *
 * Ranked by how much the evidence is worth, the same order the matcher uses:
 * the invoice number appearing in the bank reference is the customer telling
 * you what they are paying, and beats an amount that merely agrees.
 */
export function invoiceCandidates(transaction: Transaction): Invoice[] {
  return coreInvoiceCandidates(transaction, {
    invoices: state.ledger.invoices ?? [],
    balances: invoiceBalanceMap(),
  });
}

/**
 * Payment-processor payouts: one bank line that is really three postings.
 *
 * A customer pays a 300.00 invoice through Stripe, is surcharged 8.70 to cover
 * the fee, Stripe keeps 11.72, and 296.98 reaches the bank. Coded as it
 * arrives, that figure goes to sales -- overstating income, leaving the invoice
 * outstanding for ever, and losing a deductible fee that was never recorded.
 *
 * Splitting it puts each piece where it belongs, and the split is not inferred:
 * the export carries the processor's charge id on all three rows, so the
 * grouping is read rather than guessed. Which is just as well, because the
 * payout equals none of the figures involved -- searching for an invoice of
 * 296.98 finds nothing, whatever else is tried.
 */
function payoutMatches(): PayoutTransfer[] {
  return matchPayoutTransfers({
    payouts: state.ledger.payouts ?? [],
    transactions: state.ledger.transactions,
  });
}

function payoutsToApply(): PayoutTransfer[] {
  const splits = state.ledger.splits ?? {};
  return payoutMatches().filter(
    ({ transaction }) => splits[transaction.id] === undefined,
  );
}

/**
 * Turn one payout into a split on its bank line.
 *
 * Each part keeps the account the export gave it, and the part that clears the
 * debtor is recorded as settling its invoice rather than coded -- so the
 * invoice closes, which is the whole point.
 */
async function applyPayout(
  payouts: readonly Payout[],
  transaction: Transaction,
): Promise<void> {
  const known = knownCodes(state.rules, state.ledger.overrides ?? {});
  const receivable = (account: string): boolean => /receivable/i.test(account);

  const parts: SplitPart[] = [];
  const invoiceOf = new Map<number, string>();
  // Several charges can reach the bank as one transfer, and then the line is
  // every part of every one of them. Each keeps its own invoice: settling two
  // invoices from one receipt is exactly the case that must not be collapsed.
  for (const payout of payouts) {
    const invoice = payout.invoices[0];
    for (const part of payout.parts) {
      if (part.amount === 0) continue;
      const settles = receivable(part.account) && invoice !== undefined;
      if (settles) invoiceOf.set(parts.length, invoice);
      // The export writes "200 - Sales" and this ledger may know it as
      // "Sales - 200" or "200 Sales". `matchAccountName` reads all of them;
      // `canonicalCodeFor` wants a bare number and returns nothing for a label,
      // which left every part of a payout uncoded.
      //
      // Falling back to the chart, because the account this most needs is the
      // one nothing has ever been coded to: a ledger that has been booking
      // payouts as sales has no processor-fee coding to recognise, and that
      // missing expense is half the reason to do this at all.
      const code = settles
        ? null
        : (matchAccountName(part.account, known) ??
          chartLabelFor(part.account));
      parts.push({
        amount: part.amount,
        note: settles
          ? `Settles ${invoice} (${payout.reference})`
          : `${part.source} (${payout.reference})`,
        ...(code !== null ? { code } : {}),
        // The GST comes from the export rather than being assumed. A processor's
        // fee is charged from offshore and carries no New Zealand GST, and
        // treating it as standard-rated strips out 15% that was never there --
        // 332.51 of fees reported as 289.14, which is the ratio exactly.
        ...(settles ? {} : gstFor(part, part.amount)),
      });
    }
  }
  if (parts.length < 2) return;

  const before = {
    split: (state.ledger.splits ?? {})[transaction.id] ?? null,
    match: (state.ledger.invoiceMatches ?? {})[transaction.id] ?? null,
  };
  const splits = { ...(state.ledger.splits ?? {}), [transaction.id]: parts };
  const invoiceMatches = { ...(state.ledger.invoiceMatches ?? {}) };
  delete invoiceMatches[transaction.id];
  for (const [index, number] of invoiceOf) {
    invoiceMatches[splitPartId(transaction.id, index)] = number;
  }

  state.ledger = { ...state.ledger, splits, invoiceMatches };
  state.persistent = await save(state.ledger);
  const settled = [...invoiceOf.values()];
  const references = payouts.map((p) => p.reference).join(", ");
  await record(
    "split",
    `${transaction.date} ${formatAmount(transaction.amount)} split as ` +
      `${payouts.length === 1 ? "a payout" : `${payouts.length} payouts`} (${references})` +
      (settled.length > 0 ? `, settling ${settled.join(", ")}` : ""),
    before.split,
    parts,
    transaction.id,
  );
  reclassify();
}

/**
 * The GST treatment a rate name describes.
 *
 * An empty rate is not a missing answer, it is the answer: the accounting
 * system had nothing to charge, which for a payment processor's fee is because
 * the service was supplied from outside New Zealand.
 */
function gstFor(
  part: { gstRate: string; hasGst: boolean },
  amount: Cents,
): { treatment: GstTreatment; side: GstSide } {
  const side = amount > 0 ? ("sales" as const) : ("purchases" as const);
  const said = part.gstRate.trim().toLowerCase();

  // The rate when the export gives one, which it does on a ledger row.
  if (said !== "") {
    if (said.includes("no gst"))
      return { treatment: "out-of-scope", side: "none" };
    if (said.includes("zero")) return { treatment: "zero-rated", side };
    return { treatment: "standard", side };
  }

  // A bank row carries no rate, but it does name the accounts the posting
  // reached, and a GST control account among them says the amount is
  // tax-inclusive. A processor's fee reaches no such account, because it is
  // supplied from offshore and carries none.
  return part.hasGst
    ? { treatment: "standard", side }
    : { treatment: "out-of-scope", side: "none" };
}

/** An account the chart knows, labelled the way this app writes codings. */
function chartLabelFor(account: string): string | null {
  const digits = splitAccountLabel(account).code;
  if (digits === "") return null;
  const held = state.chart.find((a) => a.code === digits);
  return held === undefined ? null : accountLabel(held.code, held.name);
}

/** The Reconcile page's offer to split every payout it recognises. */
function payoutBanner(): HTMLElement | null {
  const waiting = payoutsToApply();
  if (waiting.length === 0) return null;

  const wrap = document.createElement("div");
  wrap.className = "payout-banner";

  const said = document.createElement("span");
  const total = waiting.reduce(
    (sum, { transaction }) => sum + transaction.amount,
    0,
  );
  said.textContent =
    `${waiting.length} bank line${waiting.length === 1 ? " is" : "s are"} a payment-processor ` +
    `payout, ${formatAmount(total)} in all. Each is really an invoice payment, the customer's ` +
    "surcharge and the processor's fee, and coding it as one figure overstates sales, leaves " +
    "the invoice outstanding and loses the fee.";
  wrap.append(said);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "primary";
  button.textContent = `Split ${waiting.length}`;
  button.addEventListener("click", () => void applyAllPayouts());
  wrap.append(button);
  return wrap;
}

async function applyAllPayouts(): Promise<void> {
  const waiting = payoutsToApply();
  if (waiting.length === 0) return;
  const invoices = waiting.filter((w) =>
    w.payouts.some((p) => p.invoices.length > 0),
  ).length;
  const shared = waiting.filter((w) => w.payouts.length > 1).length;
  const ok = confirm(
    `Split ${waiting.length} payout${waiting.length === 1 ? "" : "s"} into their parts?\n\n` +
      `${invoices} of them name the invoice they settle, which will be closed.\n` +
      (shared > 0
        ? `${shared} arrived as one transfer covering several charges.\n`
        : "") +
      "The processor's fee goes to the fee account the export names, and the surcharge to sales.\n\n" +
      "Each bank line keeps its total; only what it is made of changes.",
  );
  if (!ok) return;
  for (const { payouts, transaction } of waiting)
    await applyPayout(payouts, transaction);
  redraw("reconcile");
}

/**
 * The split row under a bank line: what it was divided into.
 *
 * A line split across two accounts is coded -- it just is not coded to one
 * thing, so the single account box on the row cannot say what it is. It said
 * nothing instead: an empty account and "No rule or default matched" on a
 * payment already divided correctly, which reads as work still to do and kept
 * the line in the to-do list for ever. The reports had it right the whole time,
 * expanding the split into its parts; this was the row disagreeing with them.
 *
 * Said the way the invoice and transfer rows say theirs, because it is the same
 * sentence: this is settled, and here is what by.
 */
function splitLineFor(
  transaction: Transaction,
  setSplitChosen: (chosen: boolean) => void = () => {},
): HTMLElement | null {
  const parts = (state.ledger.splits ?? {})[transaction.id];
  if (parts === undefined || parts.length === 0) {
    setSplitChosen(false);
    return null;
  }
  setSplitChosen(true);

  const wrap = document.createElement("div");
  wrap.className = "code-split";

  const matchesFor = state.ledger.invoiceMatches ?? {};

  const label = document.createElement("span");
  label.className = "split-matched";
  // What the split is for, in its own words. A payment divided to settle two
  // invoices is not "split across accounts" to the person who made it; it is
  // one payment clearing two bills.
  const settling = parts.filter(
    (_, index) => (matchesFor[splitPartId(transaction.id, index)] ?? "") !== "",
  ).length;
  label.textContent =
    settling > 1
      ? `Settles ${settling} invoices`
      : `Split across ${parts.length} accounts`;

  const detail = document.createElement("span");
  detail.className = "split-parts";
  // Each part with its own rate, because the rate is the whole reason the line
  // was split: half an entertainment bill carries GST and half does not, and a
  // row showing only the accounts would hide the point of it.
  detail.textContent = parts
    .map((part, index) => {
      // An invoice on a part outranks its account. The invoice says what the
      // money was and at what rate; repeating the account beside it says the
      // same thing twice in a row that has to stay readable.
      const settles = matchesFor[splitPartId(transaction.id, index)];
      if (settles !== undefined && settles !== "") {
        return `settles ${settles} ${formatAmount(part.amount)}`;
      }
      const rate = rateLabel({
        treatment: part.treatment ?? "standard",
        side: part.side ?? "none",
      } as GstClassification);
      return `${part.code ?? "not coded"} ${formatAmount(part.amount)} · ${rate}`;
    })
    .join("  |  ");

  wrap.append(label, detail);
  return wrap;
}

/**
 * The account earlier lines like this one were transfers to, where most were.
 *
 * Same bank account, same payee words, same direction: a fortnightly payment
 * to your own ANZ account looks the same every time, and its history says
 * where it goes even before this one's other side has arrived.
 */
function usualTransferPartner(
  transaction: Transaction,
  transfers: Readonly<Record<string, string>>,
): string | null {
  const who = (transaction.otherParty ?? "").trim().toLowerCase();
  if (who === "") return null;
  const byId = new Map(state.ledger.transactions.map((t) => [t.id, t]));
  const counts = new Map<string, number>();
  for (const t of state.ledger.transactions) {
    if (t.id === transaction.id || t.account !== transaction.account) continue;
    if (Math.sign(t.amount) !== Math.sign(transaction.amount)) continue;
    if ((t.otherParty ?? "").trim().toLowerCase() !== who) continue;
    const partner = byId.get(transfers[t.id] ?? "");
    if (partner === undefined) continue;
    counts.set(partner.account, (counts.get(partner.account) ?? 0) + 1);
  }
  const best = [...counts.entries()].sort((x, y) => y[1] - x[1])[0];
  return best !== undefined && best[1] >= 2 ? best[0] : null;
}

/**
 * The transfer row under a bank line: the leg it pairs with, or which it might.
 *
 * Only offered where there is something to offer, so an ordinary payment is not
 * cluttered with a question that has no answer.
 */
function transferLineFor(
  transaction: Transaction,
  /**
   * Switch the row's coding controls off while a transfer is chosen, and tell
   * it which transfer its tick would confirm -- or null where there is nothing
   * left to confirm, because the pairing is already recorded.
   */
  setCodingOff: (off: boolean, partnerId?: string | null) => void = () => {},
): HTMLElement | null {
  const transfers = state.ledger.transfers ?? {};
  const recorded = transfers[transaction.id];
  const settlesInvoice =
    (state.ledger.invoiceMatches ?? {})[transaction.id] !== undefined;
  if (settlesInvoice && recorded === undefined) return null;

  const { accounts, scoped } = sameEntityBanks(transaction.account);
  // A line that already has an account has been decided as not a transfer, so
  // it is nobody's partner. Offering it paired a customer's receipt, already
  // coded to sales, with a card purchase of the same amount -- and the sale
  // left the books.
  const decided = accountDecided();
  const candidates =
    recorded !== undefined
      ? []
      : transferCandidates(transaction, state.ledger.transactions, {
          sameEntity: accounts,
          taken: new Set([
            ...Object.keys(transfers),
            ...state.ledger.transactions
              .filter((t) => t.id !== transaction.id && decided(t.id))
              .map((t) => t.id),
          ]),
        });

  // A rejection outranks the offer. The candidate stays available, so changing
  // your mind is picking it again, but nothing is chosen for you and the row is
  // a row to code.
  const refused = (state.ledger.rejectedTransfers ?? []).includes(
    transaction.id,
  );

  // One candidate is not a choice, so it is shown as the answer rather than as
  // a question -- the same way a receipt the matcher has already tied to an
  // invoice says which invoice rather than asking. It is found, not recorded:
  // the tick is what records it, and until that is pressed the row can still be
  // sent back with one press of "not a transfer".
  //
  // Never on a line that has an account already: that one is still asked, since
  // it may have been coded in error, but nothing is chosen for it.
  const found =
    !refused && !decided(transaction.id) && candidates.length === 1
      ? (candidates[0]?.transaction.id ?? undefined)
      : undefined;
  const partnerId = recorded ?? found;

  if (partnerId === undefined && candidates.length === 0) {
    // Nothing to pair with yet. Where earlier lines like this one -- same
    // payee, same direction, same account -- were transfers, say where this
    // one usually goes: its other side has simply not been imported yet, and
    // it pairs on its own once it is.
    const usual = usualTransferPartner(transaction, transfers);
    if (usual === null || refused) return null;
    const wrap = document.createElement("div");
    wrap.className = "code-transfer";
    const label = document.createElement("span");
    label.className = "transfer-auto";
    label.textContent =
      `Usually a transfer ${transaction.amount < 0 ? "to" : "from"} ${bankLabel(usual)}. ` +
      `That account has no matching line yet — once its transactions are imported, ` +
      "this pairs automatically. Leave it uncoded until then.";
    wrap.append(label);
    return wrap;
  }

  const wrap = document.createElement("div");
  wrap.className = "code-transfer";

  if (partnerId !== undefined) {
    const confirmed = recorded !== undefined;
    setCodingOff(true, confirmed ? null : partnerId);

    const partner = state.ledger.transactions.find((t) => t.id === partnerId);
    const label = document.createElement("span");
    label.className = "transfer-matched";
    // How far apart the legs were, on the ones where it is not obvious.
    //
    // Same day needs no remark. A gap does: a pairing made across three or
    // four days is the one that might be a coincidence rather than a
    // movement, and this is where somebody scanning the page can see which
    // ones those are without opening anything.
    const apart =
      partner === undefined
        ? 0
        : Math.round(
            Math.abs(Date.parse(partner.date) - Date.parse(transaction.date)) /
              86_400_000,
          );
    label.textContent = partner
      ? `Matched to transfer — ${bankLabel(transaction.account)} ` +
        `${transaction.amount < 0 ? "→" : "←"} ${bankLabel(partner.account)}` +
        ` · ${partner.date}` +
        (apart > 0 ? ` · ${apart}d apart` : "")
      : "Matched to transfer — the other leg is no longer in the ledger";
    if (apart > 0) label.classList.add("transfer-stretched");

    // Found rather than agreed to, and said so. The row reads the same either
    // way because it is the same pairing; what differs is whether anybody has
    // looked at it yet, and that is worth one quiet phrase rather than a
    // second control asking the question the tick already asks.
    if (!confirmed) {
      const how = document.createElement("span");
      how.className = "transfer-auto";
      how.textContent = "found automatically";
      label.append(" · ", how);
      label.title =
        "Found by matching your own accounts. Press the tick to record it.";
    }

    // One sentence either way, because it is one thing to the person reading
    // it. Both routes also remember the refusal, or the same candidate is
    // offered again on the next render and greys the row straight back out.
    const undo = document.createElement("button");
    undo.type = "button";
    undo.className = "link-button";
    undo.textContent = "not a transfer";
    undo.addEventListener("click", () => {
      if (confirmed) {
        void unlinkTransfer(transaction.id);
        return;
      }
      void rejectTransfer(transaction.id, true).then(() => redraw("reconcile"));
    });
    wrap.append(label, undo);
    return wrap;
  }

  // More than one leg it could be, so it is a question and stays one.
  const label = document.createElement("span");
  label.textContent = "Transfer between your accounts?";
  // Three states, not two. Scoped by an entity; unscoped because this bank
  // account has not been assigned to one; and unscoped because there are no
  // entities, which is one set of books working exactly as it should and must
  // not be reported as something left undone.
  const usingEntities = (state.ledger.entities?.entities ?? []).length > 0;
  label.title = scoped
    ? "Only accounts belonging to the same entity are offered."
    : usingEntities
      ? "This bank account is not assigned to an entity yet, so every account is offered."
      : "Every account is offered.";

  const select = document.createElement("select");
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "-- not a transfer --";
  select.append(none);
  for (const candidate of candidates.slice(0, 8)) {
    const option = document.createElement("option");
    option.value = candidate.transaction.id;
    const when =
      candidate.daysApart === 0 ? "same day" : `${candidate.daysApart}d apart`;
    option.textContent =
      `${bankLabel(candidate.transaction.account)} · ${candidate.transaction.date} · ` +
      `${formatAmount(candidate.transaction.amount)} · ${when}` +
      (candidate.accountsAgree ? " · accounts agree" : "");
    select.append(option);
  }

  setCodingOff(false, null);
  select.addEventListener("change", () => {
    setCodingOff(
      select.value !== "",
      select.value === "" ? null : select.value,
    );
    // Saying no is a decision, and is kept like one -- otherwise the next
    // render offers the same candidate again and greys the row straight back
    // out, which is what made this look like a control that did nothing.
    void rejectTransfer(transaction.id, select.value === "");
  });

  const link = document.createElement("button");
  link.type = "button";
  link.textContent = "Link as transfer";
  link.className = "primary";
  link.addEventListener("click", () => {
    if (select.value === "") return;
    void linkTransfer(transaction, select.value);
  });

  wrap.append(label, select, link);
  return wrap;
}

/**
 * Join two bank lines as one movement between accounts you hold.
 *
 * Both legs are written together. Coding them separately is right only if the
 * same clearing account is used for both; recorded as a pair there is no
 * account in the middle at all, and re-importing cannot split them because the
 * ids are content hashes.
 */
async function linkTransfer(
  transaction: Transaction,
  partnerId: string,
): Promise<void> {
  const partner = state.ledger.transactions.find((t) => t.id === partnerId);
  if (partner === undefined) return;

  // A line is a transfer or it has an account, never both: posted, the
  // transfer wins and the account silently gets nothing. A split or an invoice
  // match is too much to undo from here; a plain code is removed, once
  // somebody has said so.
  const decided = accountDecided();
  const coded = [transaction, partner].filter((t) => decided(t.id));
  const involved = coded.filter(
    (t) => (state.ledger.splits ?? {})[t.id] !== undefined || invoiceAssignments().has(t.id),
  );
  if (involved.length > 0) {
    alert(
      involved.map((t) => `${t.date} ${formatAmount(t.amount)} ${t.otherParty}`).join("\n") +
        "\n\nThis is split or settles an invoice, so it cannot be a transfer as well. " +
        "Remove the split or the invoice match first.",
    );
    return;
  }
  const overridesNow = state.ledger.overrides ?? {};
  const removed = coded.map((t) => ({ t, before: overridesNow[t.id] ?? null }));
  if (removed.length > 0) {
    const listed = removed
      .map(
        ({ t, before }) =>
          `  ${t.date} ${formatAmount(t.amount)} ${t.otherParty}, coded to ${before?.code ?? ""}`,
      )
      .join("\n");
    if (
      !confirm(
        "A line is either a transfer or coded to an account, not both.\n\n" +
          listed +
          `\n\nRecord the transfer and remove ${removed.length === 1 ? "that coding" : "those codings"}?`,
      )
    ) {
      return;
    }
    const overrides = { ...overridesNow };
    for (const { t } of removed) delete overrides[t.id];
    state.ledger = { ...state.ledger, overrides };
  }

  const out = transaction.amount < 0 ? transaction : partner;
  const into = transaction.amount < 0 ? partner : transaction;

  // Captured before the change: the only moment the old value exists.
  const existing = state.ledger.transfers ?? {};
  const before =
    existing[out.id] !== undefined
      ? { from: out.id, to: existing[out.id] as string }
      : null;

  const transfers = { ...existing, [out.id]: into.id, [into.id]: out.id };
  state.ledger = { ...state.ledger, transfers };
  state.persistent = await savePart(state.ledger, "transfers");
  await record(
    "transfer",
    `${out.date} ${formatAmount(out.amount)} — transfer from ` +
      `${bankLabel(out.account)} to ${bankLabel(into.account)}`,
    before,
    { from: out.id, to: into.id },
    out.id,
  );
  // Each removed coding is its own entry, so the change log can put it back.
  for (const { t, before } of removed) {
    await record(
      "coding",
      `${t.date} ${formatAmount(t.amount)} ${t.otherParty} → coding removed, recorded as a transfer`,
      before,
      null,
      t.id,
    );
  }
  reclassify();
  redraw("reconcile");
}

/**
 * Remember that a line is not a transfer, or that it might be after all.
 *
 * Kept with the decisions rather than in the page, because the offer is made
 * again on every open and an answer that lives only on screen is an answer
 * given once a day for ever.
 */
async function rejectTransfer(
  transactionId: string,
  rejected: boolean,
): Promise<void> {
  const before = state.ledger.rejectedTransfers ?? [];
  const has = before.includes(transactionId);
  if (has === rejected) return;
  const rejectedTransfers = rejected
    ? [...before, transactionId]
    : before.filter((id) => id !== transactionId);
  state.ledger = { ...state.ledger, rejectedTransfers };
  state.persistent = await savePart(state.ledger, "transfers");
}

/** Undo a pairing, removing both legs so half a transfer cannot be left. */
async function unlinkTransfer(transactionId: string): Promise<void> {
  const existing = state.ledger.transfers ?? {};
  const partnerId = existing[transactionId];
  if (partnerId === undefined) return;

  const transfers = { ...existing };
  delete transfers[transactionId];
  delete transfers[partnerId];
  // Both legs, because either one on its own would be offered the other again.
  const rejectedTransfers = [
    ...new Set([
      ...(state.ledger.rejectedTransfers ?? []),
      transactionId,
      partnerId,
    ]),
  ];
  state.ledger = { ...state.ledger, transfers, rejectedTransfers };
  state.persistent = await savePart(state.ledger, "transfers");
  await record(
    "transfer",
    "Unlinked a transfer",
    { from: transactionId, to: partnerId },
    null,
    transactionId,
  );
  reclassify();
  redraw("reconcile");
}

/** The invoice row under a bank line: what it settles, or what it might. */
function invoiceLineFor(
  transaction: Transaction,
  /**
   * Quiet the row's coding controls while an invoice is settled by it.
   *
   * The account and the GST both come from the invoice, so there is nothing on
   * this row for either to decide.
   */
  setInvoiceChosen: (chosen: boolean) => void = () => {},
): HTMLElement | null {
  const decided = (state.ledger.invoiceMatches ?? {})[transaction.id];

  // What settles this line, from both sources. The row used to read only the
  // decisions a person had recorded, so a receipt the matcher had already tied
  // to an invoice -- and which was already posted as settling it -- still
  // asked which invoice it settled. Being asked a question the app has already
  // answered is worse than not being asked.
  const assigned = invoiceAssignments().get(transaction.id);

  // An empty string is a decision that this is not an invoice payment at all,
  // which has to be recorded: without it the matcher simply finds the same
  // invoice again on the next render.
  const refused = decided === "";
  const matched = refused ? undefined : (decided ?? assigned);
  const confirmed = decided !== undefined && decided !== "";

  setInvoiceChosen(matched !== undefined);

  const isTransfer =
    (state.ledger.transfers ?? {})[transaction.id] !== undefined;
  if (isTransfer && matched === undefined) return null;

  // Already answered by its own parts. A payment divided to settle two invoices
  // has said which invoices twice over -- in the split line above and in the
  // records behind it -- and asking a third time invites a third answer that
  // would contradict both.
  const parts = (state.ledger.splits ?? {})[transaction.id] ?? [];
  const settledByParts = parts.some(
    (_, index) =>
      ((state.ledger.invoiceMatches ?? {})[
        splitPartId(transaction.id, index)
      ] ?? "") !== "",
  );
  if (settledByParts) {
    setInvoiceChosen(true);
    return null;
  }
  const candidates =
    matched === undefined ? invoiceCandidates(transaction) : [];

  const wrap = document.createElement("div");
  wrap.className = "code-invoice";

  // Every invoice still owing money, not only the ranked candidates. The
  // ranking is a good guess and it is offered first, but a part payment from
  // somebody whose name the bank line never mentions is exactly the case that
  // needs assigning by hand -- and that used to be unreachable.
  const kind: InvoiceKind = transaction.amount > 0 ? "sales" : "purchase";
  const balances = invoiceBalanceMap();
  const paying = Math.abs(transaction.amount);

  const describe = (invoice: Invoice): string => {
    const owing = Math.max(
      (balances.get(invoice.number)?.remaining ?? invoice.total) +
        shareOf(transaction, invoice.number),
      0,
    );
    const after = owing - paying;
    const what =
      after === 0
        ? "settles it"
        : after > 0
          ? `leaves ${formatAmount(after)}`
          : `over by ${formatAmount(-after)}`;
    return (
      `${invoice.number} · ${invoice.contact.slice(0, 24)} · ` +
      `${formatAmount(owing)} owing · ${invoice.issued} · ${what}`
    );
  };

  const suggested = candidates.map(describe);
  const others = (state.ledger.invoices ?? [])
    .filter(
      (invoice) =>
        invoice.kind === kind &&
        // Owing before this payment, so a line already matched can be matched
        // again to the invoice it paid -- including one it overpaid.
        (balances.get(invoice.number)?.remaining ?? invoice.total) +
          shareOf(transaction, invoice.number) >
          0 &&
        !candidates.some((c) => c.number === invoice.number),
    )
    .sort((a, b) => b.issued.localeCompare(a.issued))
    .map(describe);

  const options = [...suggested, ...others];
  if (options.length === 0) return null;

  const numberOf = (text: string): string => text.split(" · ")[0] ?? "";

  const label = document.createElement("span");
  label.textContent =
    candidates.length === 1 ? "Settles invoice?" : "Settles which invoice?";

  // Pre-filled when there is a single candidate, so the decision stays one
  // press. Anything else has to be typed, and the box refuses what is not on
  // the list -- a misspelt number assigns nothing rather than inventing one.
  const picker = combobox(
    options,
    candidates.length === 1 ? (suggested[0] ?? null) : null,
    `search ${options.length} open invoice${options.length === 1 ? "" : "s"}…`,
    // The running total and the "and another" button both depend on what is in
    // the box, so they are redrawn when it changes rather than going stale.
    () => redraw(),
  );

  // One payment can settle several invoices, so the picker gathers rather than
  // decides. Each one added is shown with what it still owed and what is left
  // of the payment, because that running figure is the only way to see whether
  // the set is right before committing to it -- and the arithmetic must not be
  // done for anybody: sums of open invoices collide constantly.
  const gathered: string[] = [];
  const chips = document.createElement("span");
  chips.className = "invoice-gathered";
  const tally = document.createElement("span");
  tally.className = "invoice-tally";

  const owingOn = (number: string): Cents => {
    const invoice = (state.ledger.invoices ?? []).find(
      (i) => i.number === number,
    );
    if (invoice === undefined) return 0;
    return Math.max(
      (invoiceBalanceMap().get(number)?.remaining ?? invoice.total) +
        shareOf(transaction, number),
      0,
    );
  };

  const match = document.createElement("button");
  match.type = "button";

  const add = document.createElement("button");
  add.type = "button";
  add.className = "link-button";
  add.textContent = "and another invoice";

  const redraw = (): void => {
    chips.textContent = "";
    for (const number of gathered) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "invoice-chip";
      chip.textContent = `${number} ${formatAmount(owingOn(number))} ×`;
      chip.title = "Take this one off again";
      chip.addEventListener("click", () => {
        gathered.splice(gathered.indexOf(number), 1);
        redraw();
      });
      chips.append(chip);
    }

    // Counting what is in the box as well as what has been gathered, because
    // the figure has to describe what pressing the button would do. Counting
    // only the chips said "300.00 still unaccounted for" at the exact moment
    // the last invoice had been picked and the set was complete.
    const pending = numberOf(picker.value);
    const all =
      pending === "" || gathered.includes(pending)
        ? gathered
        : [...gathered, pending];
    const taken = all.reduce((sum, number) => sum + owingOn(number), 0);
    const paying = Math.abs(transaction.amount);
    const left = paying - taken;
    tally.textContent =
      all.length === 0
        ? ""
        : left === 0
          ? `${formatAmount(paying)} accounted for exactly`
          : left > 0
            ? `${formatAmount(left)} of this payment still unaccounted for`
            : `${formatAmount(-left)} more than the payment`;
    tally.classList.toggle("invoice-tally-exact", all.length > 0 && left === 0);
    tally.classList.toggle("invoice-tally-over", left < 0);

    match.textContent =
      gathered.length === 0
        ? all.length === 1 && left > 0
          ? `Match, splitting off ${formatAmount(left)}`
          : "Match"
        : `Settle ${gathered.length + 1} invoices`;
    add.hidden = gathered.length === 0 && numberOf(picker.value) === "";
  };

  add.addEventListener("click", () => {
    const number = numberOf(picker.value);
    if (number === "" || gathered.includes(number)) return;
    gathered.push(number);
    picker.clear();
    redraw();
    picker.element.querySelector("input")?.focus();
  });

  match.addEventListener("click", () => {
    const number = numberOf(picker.value);
    const all = number === "" ? [...gathered] : [...gathered, number];
    if (all.length === 0) return;
    if (all.length === 1) {
      const only = all[0] as string;
      // More than the invoice still owes: the rest is split off as a part of
      // its own, as it is with several invoices, rather than left inside this
      // one as an overpayment that misstates it.
      const owed = owingOn(only);
      if (owed > 0 && Math.abs(transaction.amount) > owed) {
        void matchToInvoices(transaction, all);
        return;
      }
      void matchToInvoice(transaction, only);
      return;
    }
    void matchToInvoices(transaction, all);
  });

  const openPicker = (): void => {
    wrap.replaceChildren(label, picker.element, add, chips, tally, match);
    redraw();
    picker.element.querySelector("input")?.focus();
  };

  // Already tied to an invoice: say so plainly instead of asking. Clicking it
  // opens the same picker, so changing the answer is one press either way --
  // including when the matcher got it wrong, which is the case that most needs
  // a way out.
  if (matched !== undefined) {
    const invoice = (state.ledger.invoices ?? []).find(
      (i) => i.number === matched,
    );
    const label2 = document.createElement("button");
    label2.type = "button";
    label2.className = "invoice-matched";
    label2.title = "Click to match it to a different invoice";

    if (invoice) {
      const owing = invoiceBalanceMap().get(invoice.number)?.remaining ?? 0;
      const part = Math.abs(transaction.amount) < invoice.total;
      label2.textContent =
        `Matched to ${invoice.number} — ${invoice.contact} ${formatAmount(invoice.total)}` +
        (part
          ? owing > 0
            ? ` · part payment, ${formatAmount(owing)} still owing`
            : ` · part payment, now settled`
          : "");
    } else {
      label2.textContent = `Matched to ${matched}`;
    }

    // Found by the matcher rather than chosen by a person. Both settle the
    // invoice and both post the same way; the difference is how much it is
    // worth checking, so it is said rather than hidden.
    if (!confirmed) {
      const how = document.createElement("span");
      how.className = "invoice-auto";
      how.textContent = "found automatically";
      label2.append(" · ", how);
    }

    label2.addEventListener("click", () => openPicker());

    // Two different things to undo, so two different words. Undoing your own
    // decision puts the line back to whatever the matcher thinks; saying it is
    // not an invoice payment is a decision in its own right, and has to be, or
    // the matcher claims it again on the next render.
    const undo = document.createElement("button");
    undo.type = "button";
    undo.className = "link-button";
    undo.textContent = confirmed ? "unmatch" : "not an invoice payment";
    undo.addEventListener("click", () =>
      confirmed
        ? void unmatchInvoice(transaction.id)
        : void refuseInvoice(transaction.id),
    );

    wrap.append(label2, undo);
    return wrap;
  }

  // With nothing suggesting an invoice, the picker is a way in rather than a
  // question: every open invoice offered against every bank line would bury
  // the coding controls under something that is usually not being asked. So it
  // waits behind one phrase until somebody says that is what this is.
  if (candidates.length === 0) {
    const open = document.createElement("button");
    open.type = "button";
    open.className = "link-button";
    open.textContent = "match to an invoice";
    open.addEventListener("click", () => openPicker());
    wrap.append(open);
    return wrap;
  }

  wrap.append(label, picker.element, add, chips, tally, match);
  redraw();
  return wrap;
}

/**
 * Record that a receipt settles an invoice, and code it from the invoice.
 *
 * The invoice knows what was sold and at what tax rate, which is better
 * evidence than any keyword — so the coding follows it rather than being
 * guessed again. Only when the invoice has a single account: a split invoice
 * is a split, and belongs in the split editor where the parts must balance.
 */
async function matchToInvoice(
  transaction: Transaction,
  number: string,
): Promise<void> {
  const invoice = (state.ledger.invoices ?? []).find(
    (i) => i.number === number,
  );
  // Captured before the change, because that is the only moment it exists.
  const wasMatched =
    (state.ledger.invoiceMatches ?? {})[transaction.id] ?? null;
  const wasCodedBefore = (state.ledger.overrides ?? {})[transaction.id];
  const invoiceMatches = {
    ...(state.ledger.invoiceMatches ?? {}),
    [transaction.id]: number,
  };
  const overrides = { ...(state.ledger.overrides ?? {}) };

  const codes = new Set(
    (invoice?.lines ?? []).map((l) => l.accountCode).filter((c) => c !== ""),
  );
  const only = codes.size === 1 ? [...codes][0] : undefined;
  let coded = false;
  if (invoice && only !== undefined) {
    const code = canonicalCodeFor(only, knownCodes(state.rules, overrides));
    if (code !== null) {
      // Choosing the invoice is the decision. The invoice already says which
      // account the sale belongs to and at what rate -- better evidence than
      // any keyword -- so asking for OK afterwards only asked the same question
      // twice. This is the one path that codes a line without a separate
      // confirmation, and it is a person's explicit choice that starts it.
      //
      // Only when the invoice names a single account. Several accounts is a
      // split, whose parts have to balance, and it stays unconfirmed so the
      // split editor gets the decision instead.
      overrides[transaction.id] = {
        ...(overrides[transaction.id] ?? {}),
        code,
        treatment: "standard",
        side: transaction.amount > 0 ? "sales" : "purchases",
        confirmed: true,
        note: `Settles ${number} (${invoice.contact}). Coded from the invoice.`,
        at: new Date().toISOString().slice(0, 10),
      };
      coded = true;
    }
  }

  state.ledger = { ...state.ledger, invoiceMatches, overrides };
  // savePart still writes the core record, which is where the override lives.
  state.persistent = await savePart(state.ledger, "invoiceMatches");
  await record(
    "invoiceMatch",
    `${transaction.date} ${formatAmount(transaction.amount)} settles ${number}` +
      (invoice ? ` (${invoice.contact})` : "") +
      (coded ? ", coded from the invoice" : ", still to code"),
    // The coding rides with the match, so undoing one undoes both.
    wasMatched === null
      ? null
      : { number: wasMatched, override: wasCodedBefore },
    { number, override: overrides[transaction.id] },
    transaction.id,
  );
  reclassify();
  redraw("reconcile");
}

/**
 * Settle several invoices from one payment.
 *
 * A customer pays two invoices with one transfer and the bank shows one line.
 * Matched to either invoice alone it is wrong twice over: one invoice is
 * overpaid and the other is still outstanding. So the payment is divided --
 * one part per invoice, each part settling its own -- and every part is
 * addressed by the id `expandSplits` already gives it, so the postings, the
 * balances and the history all read a part the same way they read a payment.
 *
 * Amounts are taken from what each invoice still owes, in the order chosen,
 * until the money runs out. Anything left over becomes a part of its own with
 * no invoice on it: an overpayment is real and hiding it inside the last
 * invoice would misstate both that invoice and the account it posts to.
 *
 * One invoice is enough when the payment is more than it owes. Xero splits such
 * a receipt into the payment and an adjustment; left whole, the invoice reads
 * as overpaid and the extra is hidden inside it.
 *
 * What each invoice owes is counted before this payment. Re-matching a line
 * already tied to an invoice otherwise set the payment against itself, and an
 * invoice it had overpaid by 0.72 offered 0.72 to settle.
 *
 * No arithmetic is guessed at. Sums of open invoices collide constantly -- on
 * one real ledger 1,295 combinations of two or three matched some receipt
 * exactly -- so which invoices a payment settles is a question only the person
 * paying attention can answer, and this records their answer.
 */
async function matchToInvoices(
  transaction: Transaction,
  numbers: readonly string[],
): Promise<void> {
  const invoices = state.ledger.invoices ?? [];
  const chosen = numbers
    .map((number) => invoices.find((i) => i.number === number))
    .filter((i): i is Invoice => i !== undefined);
  if (chosen.length === 0) return;

  const balances = invoiceBalanceMap();
  const sign = transaction.amount < 0 ? -1 : 1;
  let left = Math.abs(transaction.amount);

  const parts: SplitPart[] = [];
  const assigned: string[] = [];
  for (const invoice of chosen) {
    if (left <= 0) break;
    const owing = Math.max(
      (balances.get(invoice.number)?.remaining ?? invoice.total) +
        shareOf(transaction, invoice.number),
      0,
    );
    const take = Math.min(owing, left);
    if (take <= 0) continue;
    parts.push({
      amount: sign * take,
      treatment: "standard",
      side: transaction.amount > 0 ? "sales" : "purchases",
      note: `Settles ${invoice.number} (${invoice.contact})`,
      ...(codeFromInvoice(invoice) !== null
        ? { code: codeFromInvoice(invoice) as string }
        : {}),
    });
    assigned.push(invoice.number);
    left -= take;
  }

  // Whatever the invoices did not account for. Left uncoded on purpose: it is
  // the part somebody has to look at.
  if (left > 0) {
    parts.push({
      amount: sign * left,
      note: "Not accounted for by the invoices chosen",
    });
  }
  if (parts.length < 2) return;

  const before = {
    split: (state.ledger.splits ?? {})[transaction.id] ?? null,
    match: (state.ledger.invoiceMatches ?? {})[transaction.id] ?? null,
  };

  const splits = { ...(state.ledger.splits ?? {}), [transaction.id]: parts };
  const invoiceMatches = { ...(state.ledger.invoiceMatches ?? {}) };
  // The payment itself no longer settles one invoice; its parts do.
  delete invoiceMatches[transaction.id];
  assigned.forEach((number, index) => {
    invoiceMatches[splitPartId(transaction.id, index)] = number;
  });

  state.ledger = { ...state.ledger, splits, invoiceMatches };
  state.persistent = await save(state.ledger);
  await record(
    "invoiceMatch",
    `${transaction.date} ${formatAmount(transaction.amount)} settles ` +
      `${assigned.join(", ")}` +
      (left > 0 ? `, with ${formatAmount(sign * left)} left over` : ""),
    before,
    { split: parts, matches: assigned },
    transaction.id,
  );
  reclassify();
  redraw("reconcile");
}

/**
 * How much of an invoice this bank line already pays, directly or through its
 * split parts.
 *
 * The balances count every payment matched to an invoice, this one included.
 * Asking what an invoice owes *before* this payment means adding its own share
 * back, or re-matching a line reads the invoice as already paid by it.
 */
function shareOf(transaction: Transaction, number: string): number {
  const assigned = invoiceAssignments();
  if (assigned.get(transaction.id) === number) return Math.abs(transaction.amount);
  const parts = (state.ledger.splits ?? {})[transaction.id] ?? [];
  return parts.reduce(
    (sum, part, index) =>
      assigned.get(splitPartId(transaction.id, index)) === number
        ? sum + Math.abs(part.amount)
        : sum,
    0,
  );
}

/** The single account an invoice codes to, when it has only one. */
function codeFromInvoice(invoice: Invoice): string | null {
  const codes = new Set(
    (invoice.lines ?? []).map((l) => l.accountCode).filter((c) => c !== ""),
  );
  if (codes.size !== 1) return null;
  return canonicalCodeFor(
    [...codes][0] as string,
    knownCodes(state.rules, state.ledger.overrides ?? {}),
  );
}

/**
 * Record that a bank line is not an invoice payment at all.
 *
 * Deleting the match is not enough when the matcher is the one that made it:
 * it finds the same invoice again on the next render, and the line cannot be
 * got rid of. So a refusal is stored as its own decision, and outranks
 * anything found automatically.
 */
async function refuseInvoice(transactionId: string): Promise<void> {
  const invoiceMatches = { ...(state.ledger.invoiceMatches ?? {}) };
  const before =
    invoiceMatches[transactionId] ??
    invoiceAssignments().get(transactionId) ??
    null;
  invoiceMatches[transactionId] = "";
  state.ledger = { ...state.ledger, invoiceMatches };
  state.persistent = await savePart(state.ledger, "invoiceMatches");
  await record(
    "invoiceMatch",
    `Not an invoice payment${before ? ` (was ${before})` : ""}`,
    before,
    "",
    transactionId,
  );
  reclassify();
  redraw("reconcile");
}

async function unmatchInvoice(transactionId: string): Promise<void> {
  const invoiceMatches = { ...(state.ledger.invoiceMatches ?? {}) };
  const before = invoiceMatches[transactionId];
  delete invoiceMatches[transactionId];
  state.ledger = { ...state.ledger, invoiceMatches };
  state.persistent = await savePart(state.ledger, "invoiceMatches");
  await record(
    "invoiceMatch",
    `Unmatched ${before ?? ""}`,
    before ?? null,
    null,
    transactionId,
  );
  redraw("reconcile");
}

export async function confirmLine(
  one: Suggestion,
  code: string,
  rate: GstRate,
  description: string,
  contact: string,
): Promise<void> {
  drafts.delete(one.transaction.id);
  // An account is required, by whichever route. The button asks first and
  // says why; this is the rule itself, so no other caller can get round it.
  // A line confirmed with nothing on it posts nowhere and leaves the queue,
  // which is the one combination that hides work rather than recording it.
  if (codingRefusedForTransfer(one.transaction)) return;
  const hasSplit = (state.ledger.splits ?? {})[one.transaction.id] !== undefined;
  const hasInvoice = invoiceAssignments().has(one.transaction.id);
  if (code.trim() === "" && !hasSplit && !hasInvoice) return;

  const { treatment, side } = rateToClassification(
    rate,
    one.transaction.amount,
  );
  // A description is worth having when a suggestion is overruled, but it is not
  // required: blocking the line only moved the friction onto the person doing
  // the work, who then types a full stop. The change log records what changed
  // and who changed it either way. This is still wanted for the note below,
  // which must not claim a changed coding was accepted as it stood.
  const changed =
    code !== (one.code ?? "") ||
    rate !== classificationToRate(one.classification);

  const overrides = { ...(state.ledger.overrides ?? {}) };
  const wasCoded = overrides[one.transaction.id];
  overrides[one.transaction.id] = {
    confirmed: true,
    ...(code !== "" ? { code } : {}),
    treatment,
    side,
    // Stored only when it differs from what the rules already say, so the
    // override records a decision rather than a copy of the suggestion.
    ...(contact.trim() !== "" && contact.trim() !== one.contact
      ? { contact: contact.trim() }
      : {}),
    note:
      description.trim() !== ""
        ? description.trim()
        : changed
          ? "Changed by hand, no description given"
          : "Suggestion accepted unchanged",
    at: new Date().toISOString().slice(0, 10),
  };
  state.ledger = { ...state.ledger, overrides };
  state.persistent = await save(state.ledger);
  await record(
    "coding",
    `${one.transaction.date} ${formatAmount(one.transaction.amount)} ${one.transaction.otherParty} → ${code || "settled by its split or invoice"}`,
    wasCoded ?? null,
    overrides[one.transaction.id],
    one.transaction.id,
  );

  // Nothing suggested a code and a person supplied one: that is a rule being
  // stated, not merely a line being coded.
  if ((one.code ?? "") === "" && code !== "")
    await ruleFromDecision(one.transaction, code);

  // A purchase coded to a fixed asset account is an asset, and only the
  // register depreciates it. Offered here, where the date and the cost are in
  // front of the person, rather than left to be remembered on another page.
  const account = accountsForEditing().find((row) => row.label === code)?.account;
  if (
    account !== undefined &&
    account.type.trim().toLowerCase() === "fixed asset" &&
    !/accumulated/i.test(account.name) &&
    one.transaction.amount < 0
  ) {
    const gross = -one.transaction.amount;
    const cost = rate === "15" ? gross - Math.round((gross * 3) / 23) : gross;
    const held = (state.ledger.assets ?? []).some(
      (asset) => asset.purchased === one.transaction.date && asset.cost === cost,
    );
    if (
      !held &&
      confirm(
        `Coded to ${account.name}. Add this purchase to the fixed asset register, at ` +
          `${formatAmount(cost)}${rate === "15" ? " excluding GST" : ""}, so it is depreciated?`,
      )
    ) {
      offerAsset({
        name: description.trim() || one.transaction.otherParty || "",
        type: account.name,
        purchased: one.transaction.date,
        cost,
      });
      return;
    }
  }

  redraw("reconcile");
}

/**
 * Turn one person's decision about an unsuggested line into a rule.
 *
 * The inference elsewhere refuses to build a rule from a single sighting, and
 * is right to: three sightings and eighty percent agreement is what makes a
 * *guess* about somebody's habits worth acting on. This is not that. Nothing
 * suggested a code, a person read the line and said what it was, and one
 * person saying so is not weak evidence -- it is the answer. What the
 * inference is protecting against is the tool inventing a pattern; this
 * records one it was told.
 *
 * Three things it will not do. It will not write a rule from a keyword too
 * short or too generic to mean anything, because "PAYMENT" as a rule would
 * code half the ledger. It will not add a second rule for a keyword that
 * already has one, because the first one is a decision too and quietly
 * outranking it would be a way of losing work. And it does not hide: the count
 * of lines it newly codes is on the page and in the change log, so a rule that
 * reached further than expected can be found and undone.
 */
async function ruleFromDecision(
  transaction: Transaction,
  code: string,
): Promise<void> {
  const keyword = keywordFor(transaction);
  if (keyword.length < 4 || GENERIC_PAYEES.has(keyword)) return;

  const file = (state.rules as RuleFileShape | undefined) ?? { rules: [] };
  const rules = [...(file.rules ?? [])];
  if (
    rules.some(
      (r) =>
        (r.keyword ?? "").toUpperCase() === keyword && r.account === undefined,
    )
  ) {
    return;
  }

  const rule: CategoryRule = {
    priority: 100,
    keyword,
    code,
    note: "From a coding decision",
  };

  // What it reaches, counted with the engine that will do the coding rather
  // than by re-matching the keyword here -- the two disagree, and a promise
  // about what just happened has to be made by asking the thing that did it.
  //
  // The line that started this is already in the before-count, because its
  // override was written before any of this ran. So the difference is other
  // lines, all of it, with nothing to subtract.
  const before = codedNow();
  state.rules = { ...file, rules: [...rules, rule] } as RuleSet;
  if (state.rulesName === "") state.rulesName = "rules.json";
  reclassify();
  const alsoCoded = Math.max(0, codedNow() - before);

  await record(
    "rule",
    `${keyword} → ${code}, from coding one line by hand` +
      (alsoCoded > 0
        ? `; it also suggests a code for ${alsoCoded} other line${alsoCoded === 1 ? "" : "s"}`
        : ""),
    null,
    rule,
    String(rules.length),
  );
  await persistRules();
  state.lastRule = { keyword, code, alsoCoded };
}

/**
 * How many transactions the engine can put a code on.
 *
 * Suggested or confirmed, which is deliberately not the same as "coded": a
 * rule proposes and a person decides, and a rule that reaches fifty lines has
 * not coded fifty lines. Saying it had would be the tool claiming somebody
 * else's work.
 */
function codedNow(): number {
  return codingProgress().coded;
}

/** Warning banner displayed on Reconcile page when Coding reconciliation has pending items. */
function codingReconciliationWarning(): HTMLElement | null {
  // The Coding reconciliation page's own count, so the two cannot disagree.
  const waiting = codingReconciliationWaiting();
  if (waiting === 0) return null;

  const wrap = document.createElement("div");
  wrap.className = "coding-reconciliation-warning";

  const msg = document.createElement("span");
  msg.textContent =
    "You have coding reconciliation items outstanding, complete those before starting reconciliation.";

  const go = document.createElement("button");
  go.type = "button";
  go.className = "link-button";
  go.textContent = `Go to Coding reconciliation (${waiting} waiting)`;
  go.addEventListener("click", () => showPage("check"));

  wrap.append(msg, " ", go);
  return wrap;
}

/** Searching and filtering the coding queue. */
export function wireReconcile(): void {
  $<HTMLInputElement>("reconcile-search").addEventListener("input", (e) => {
    state.reconcileSearch = (e.target as HTMLInputElement).value;
    redraw("reconcile");
  });
  $<HTMLSelectElement>("reconcile-filter").addEventListener("change", (e) => {
    state.reconcileFilter = (e.target as HTMLSelectElement)
      .value as typeof state.reconcileFilter;
    redraw("reconcile");
  });
  const sort = $<HTMLButtonElement>("reconcile-sort");
  const sayOrder = (): void => {
    sort.textContent = state.reconcileSort === "oldest" ? "Oldest first ↑" : "Newest first ↓";
    sort.title = "Change the order of the lines";
  };
  sayOrder();
  sort.addEventListener("click", () => {
    state.reconcileSort = state.reconcileSort === "oldest" ? "newest" : "oldest";
    try {
      localStorage.setItem("nzosa:reconcile-sort", state.reconcileSort);
    } catch {
      // Not remembered; still applied until the page is reloaded.
    }
    sayOrder();
    redraw("reconcile");
  });
}
