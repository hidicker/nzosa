import { redraw } from "../app.js";
import { persistRules, reclassify } from "../books.js";
import { KIND_LABELS, MAX_EVENTS, canReverse, reverse, reverseRule } from "../events.js";
import type { LedgerEvent } from "../events.js";
import type { RuleFileShape } from "../rules-ui.js";
import { $, state } from "../state.js";
import { save, saveEvents } from "../store.js";
import { note } from "../ui.js";
import type { RuleSet } from "@nzosa/core";
import { postedJournals } from "../books.js";
import { daysWork, formatAmount, localDay, sourceIdsOf } from "@nzosa/core";
import type { PostedJournal } from "@nzosa/core";
import { amountCell, nameCell } from "../ui.js";

/**
 * Every change, and the ability to take one back.
 *
 * Books somebody else can check are books that say who changed what and when.
 * Each entry holds the state before and after, so undoing is replacing the
 * after with the before rather than guessing at an inverse -- there is no
 * arithmetic to get wrong, and undoing a bulk acceptance of two hundred
 * codings is the same operation as undoing one.
 */

/** Put one change back, ledger or rules depending on what it touched. */
export async function undo(event: LedgerEvent): Promise<void> {
  const allowed = canReverse(state.events, event);
  if (!allowed.ok) {
    alert(allowed.why);
    return;
  }

  if (event.kind === "rule" || event.kind === "codeTreatment") {
    const file = state.rules as RuleFileShape | undefined;
    if (!file) return;
    state.rules = reverseRule(file, event) as RuleSet;
    await persistRules();
  } else {
    state.ledger = reverse(state.ledger, event);
    state.chart = state.ledger.chart ?? [];
    state.persistent = await save(state.ledger);
  }

  state.events = state.events.map((e) => (e.id === event.id ? { ...e, reverted: true } : e));
  await saveEvents(state.events);
  reclassify();
  redraw("history");
}

export function renderHistory(): void {
  const body = $("history-body");
  body.textContent = "";
  $<HTMLInputElement>("who").value = state.who;

  const kindSelect = $<HTMLSelectElement>("history-kind");
  const chosen = kindSelect.value;
  const kinds = [...new Set(state.events.map((e) => e.kind))];
  kindSelect.textContent = "";
  const all = document.createElement("option");
  all.value = "";
  all.textContent = "Everything";
  kindSelect.append(all);
  for (const kind of kinds) {
    const option = document.createElement("option");
    option.value = kind;
    option.textContent = KIND_LABELS[kind];
    option.selected = kind === chosen;
    kindSelect.append(option);
  }

  todaySection(body);

  if (state.events.length === 0) {
    body.append(
      note(
        "Nothing recorded yet. Every change is recorded here with your name and can be undone.",
      ),
    );
    return;
  }

  const shown = state.events.filter((e) => chosen === "" || e.kind === chosen);
  // Say what the log costs. A deep history is only a good idea while it stays
  // small, and the number is the thing that tells you whether it has.
  const bytes = new Blob([JSON.stringify(state.events)]).size;
  const size =
    bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
  body.append(
    note(
      `${shown.length} of ${state.events.length} changes, ${size}. ` +
        `The last ${MAX_EVENTS.toLocaleString("en-NZ")} are kept; older ones fall off.`,
    ),
  );

  const table = document.createElement("table");
  table.className = "report-table owner-table";
  const head = document.createElement("thead");
  head.innerHTML = "<tr><th>When</th><th>Who</th><th>What</th><th>Change</th><th></th></tr>";
  const tbody = document.createElement("tbody");

  for (const event of shown) {
    const tr = document.createElement("tr");
    if (event.reverted === true) tr.className = "event-reverted";
    const when = event.at.slice(0, 16).replace("T", " ");
    for (const [text, cls] of [
      [when, "report-name"],
      [event.who, "report-name"],
      [KIND_LABELS[event.kind], "report-name"],
      [event.summary, "report-name"],
    ] as const) {
      const td = document.createElement("td");
      td.textContent = text;
      td.className = cls;
      tr.append(td);
    }

    const actions = document.createElement("td");
    actions.className = "report-amount";
    const allowed = canReverse(state.events, event);
    if (event.reverted === true) {
      const label = document.createElement("span");
      label.className = "event-undone";
      label.textContent = "undone";
      actions.append(label);
    } else {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Undo";
      button.disabled = !allowed.ok;
      if (!allowed.ok) button.title = allowed.why;
      button.addEventListener("click", () => void undo(event));
      actions.append(button);
    }
    tr.append(actions);
    tbody.append(tr);
  }

  table.append(head, tbody);
  body.append(table);
}

/** Filtering the change log by what kind of change it was. */
export function wireHistory(): void {
  $<HTMLSelectElement>("history-kind").addEventListener("change", () => redraw("history"));
}

/**
 * What today's decisions did to the accounts.
 *
 * The log below records changes -- a code replaced, a transfer paired -- and a
 * change is not an answer to "what have I done to the books today". That
 * answer is the journals: the debits and credits those decisions caused, which
 * are what the reports are built from and what an accountant would ask to see.
 *
 * Shown at the top and only when there is something, because on a day nobody
 * has coded anything an empty panel is noise.
 */
function todaySection(body: HTMLElement): void {
  const today = localDay(new Date().toISOString(), -new Date().getTimezoneOffset());
  const work = daysWork({
    events: state.events,
    transactions: state.ledger.transactions,
    journals: postedJournals(),
    on: today,
    offsetMinutes: -new Date().getTimezoneOffset(),
    transfers: state.ledger.transfers ?? {},
  });
  if (work.events.length === 0) return;

  const heading = document.createElement("h3");
  heading.textContent = "Today";
  body.append(heading);

  const decisions = work.events.length;
  const lines = work.transactions.length;
  body.append(
    note(
      `${decisions} decision${decisions === 1 ? "" : "s"} today, about ${lines} bank ` +
        `line${lines === 1 ? "" : "s"}, posting ${work.journals.length} ` +
        `journal${work.journals.length === 1 ? "" : "s"}: ` +
        `${formatAmount(work.debits)} of debits and ${formatAmount(work.credits)} of credits.` +
        (work.debits !== work.credits
          ? " These should agree; report this as a fault."
          : "") +
        (work.missing.length > 0
          ? ` ${work.missing.length} decision${work.missing.length === 1 ? " names a line" : "s name lines"}` +
            " no longer in the books, usually because they were cleared and reloaded."
          : ""),
    ),
  );

  const table = document.createElement("table");
  table.className = "report-table owner-table match-table";
  const head = document.createElement("thead");
  head.innerHTML =
    "<tr><th>Date</th><th>Bank line</th><th>Amount</th><th>Posted to</th><th>Debit</th><th>Credit</th></tr>";
  const tbody = document.createElement("tbody");

  // A journal can belong to two lines at once: a transfer posts once for the
  // pair, and showing it against both legs would double what the day appears
  // to have posted. So it is listed against the first leg that claims it.
  const byTransaction = new Map<string, PostedJournal[]>();
  const claimed = new Set<PostedJournal>();
  for (const transaction of work.transactions) {
    for (const journal of work.journals) {
      if (claimed.has(journal)) continue;
      if (!sourceIdsOf(journal.transactionId).includes(transaction.id)) continue;
      claimed.add(journal);
      const held = byTransaction.get(transaction.id);
      if (held) held.push(journal);
      else byTransaction.set(transaction.id, [journal]);
    }
  }

  for (const transaction of work.transactions) {
    const journals = byTransaction.get(transaction.id) ?? [];
    const rows = journals.flatMap((j) => j.lines);
    // A line with no journal of its own is worth seeing rather than hiding. A
    // transfer posts once for the pair, so one leg is explained by the other
    // and says so; anything else means a decision was made and nothing
    // posted, which is a fault worth noticing.
    if (rows.length === 0) {
      const tr = document.createElement("tr");
      tr.append(nameCell(transaction.date));
      tr.append(nameCell(transaction.otherParty || transaction.particulars || ""));
      tr.append(amountCell(formatAmount(transaction.amount)));
      const pairHasIt = work.journals.some((j) =>
        sourceIdsOf(j.transactionId).includes(transaction.id),
      );
      tr.append(
        nameCell(
          pairHasIt || work.postedWithPair.has(transaction.id)
            ? "posted once, shown against the other leg of this transfer"
            : "nothing posted",
        ),
      );
      tr.append(amountCell(""));
      tr.append(amountCell(""));
      tbody.append(tr);
      continue;
    }
    rows.forEach((line, index) => {
      const tr = document.createElement("tr");
      tr.append(nameCell(index === 0 ? transaction.date : ""));
      tr.append(nameCell(index === 0 ? transaction.otherParty || transaction.particulars || "" : ""));
      tr.append(amountCell(index === 0 ? formatAmount(transaction.amount) : ""));
      tr.append(nameCell(`${line.accountCode} ${line.accountName}`.trim()));
      tr.append(amountCell(line.amount > 0 ? formatAmount(line.amount) : ""));
      tr.append(amountCell(line.amount < 0 ? formatAmount(-line.amount) : ""));
      tbody.append(tr);
    });
  }

  table.append(head, tbody);
  body.append(table);
}