import { redraw } from "../app.js";
import { persistRules, reclassify } from "../books.js";
import { KIND_LABELS, MAX_EVENTS, canReverse, reverse, reverseRule } from "../events.js";
import type { LedgerEvent } from "../events.js";
import type { RuleFileShape } from "../rules-ui.js";
import { $, state } from "../state.js";
import { save, saveEvents } from "../store.js";
import { note } from "../ui.js";
import type { RuleSet } from "@nzosa/core";

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

  if (state.events.length === 0) {
    body.append(
      note(
        "Nothing recorded yet. From here on, every coding, split, chart edit, entity " +
          "assignment, invoice match and rule change is logged with your name and can be " +
          "undone.",
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
