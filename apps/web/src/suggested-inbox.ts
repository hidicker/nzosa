import { readSuggestedFile, suggesterName, suggestionKey, suggestionsWaiting } from "@nzosa/core";
import type { SuggestedFile, SuggestedItem, SuggestedSet, SuggestionDone } from "@nzosa/core";
import { redraw, showPage } from "./app.js";
import { restoreAiSuggestions } from "./ai.js";
import { keepSuggestionsNow } from "./nightly.js";
import { openJournalDraft } from "./daily/reports.js";
import { $, state } from "./state.js";
import { afterNextFrame } from "./busy.js";
import { dollars } from "./ui.js";
import { backendKind, readSuggestedPart, savePart } from "./store.js";

/**
 * What the person's own AI app suggested, taken in.
 *
 * Somebody working in Claude (or another app) with nzosa-mcp --suggest can ask
 * it to code lines, split one, write a journal, or bring up a page. Those wait
 * in a file beside the books that only the MCP server writes. Here they are
 * put where a person decides on them, as if they had been typed:
 *
 * - a code goes on its line on Reconcile as a suggestion, to tick or not;
 * - a split or a journal waits on Actions required, and opens in the split
 *   editor or the journal editor, filled in, to save or cancel;
 * - a page asked for in the last two minutes is brought up.
 *
 * What was done with each is kept in the books' decisions, so nothing is
 * offered twice and the AI app can be told what is still waiting.
 */

let held: SuggestedFile = { version: 1, sets: [] };
let heldText = "";

/** A page asked for longer ago than this is not brought up: the moment has passed. */
const SHOW_FRESH_MS = 2 * 60 * 1000;

/** How often an open page looks for new suggestions: often beside a folder, less often of the server. */
const LOOK_EVERY_MS = 4000;
const LOOK_ONLINE_EVERY_MS = 30_000;

function looks(): boolean {
  const kind = backendKind();
  return kind === "folder" || kind === "cloud";
}

type Waiting = { key: string; set: SuggestedSet; item: SuggestedItem };

function done(): Readonly<Record<string, SuggestionDone>> {
  return state.ledger.suggestionsHandled ?? {};
}

/** Splits and journals still waiting for somebody, oldest first. */
export function suggestionsToLookAt(): Waiting[] {
  return suggestionsWaiting(held, done()).filter((one) => one.item.kind === "split" || one.item.kind === "journal");
}

async function mark(marks: Record<string, SuggestionDone>): Promise<void> {
  if (Object.keys(marks).length === 0) return;
  state.ledger = { ...state.ledger, suggestionsHandled: { ...done(), ...marks } };
  state.persistent = await savePart(state.ledger);
  redraw("actionsBadge");
  if (state.page === "actions") redraw("actions");
}

/** Look for new suggestions, and put any found where they go. */
export async function lookForSuggestions(): Promise<void> {
  if (!looks()) return;
  const raw = await readSuggestedPart();
  if (raw === null) return;
  const text = JSON.stringify(raw);
  if (text === heldText) return;
  heldText = text;
  held = readSuggestedFile(raw);
  await takeIn();
}

async function takeIn(): Promise<void> {
  const waiting = suggestionsWaiting(held, done());
  const marks: Record<string, SuggestionDone> = {};

  // Codes onto their lines: the newest for each line, so a correction asked
  // for in the chat replaces what was suggested before it. One passed over
  // (its line answered, or held by an earlier fault) is tried again each
  // time; only one used or declined is done with. Older ones for the same
  // line are passed over for good.
  let coded = 0;
  const newest = new Map<string, { key: string; set: SuggestedSet; item: SuggestedItem & { kind: "coding" } }>();
  for (const set of held.sets) {
    set.items.forEach((item, index) => {
      if (item.kind !== "coding") return;
      const key = suggestionKey(set.id, index);
      if (!newest.has(item.transaction)) newest.set(item.transaction, { key, set, item });
      else if (done()[key] === undefined) marks[key] = "passed";
    });
  }
  for (const { key, set, item } of newest.values()) {
    const was = done()[key];
    if (was === "used" || was === "declined") continue;
    const back = restoreAiSuggestions(
      [{ id: item.transaction, code: item.code, confidence: 0, because: item.because, via: suggesterName(set.from) }],
      true,
    );
    if (back > 0 || was === undefined) marks[key] = back > 0 ? "used" : "passed";
    coded += back;
  }
  // Kept with the morning's, so a reload still shows them on their lines.
  if (coded > 0) void keepSuggestionsNow();

  // The newest page asked for, if it was asked for just now; the rest are past.
  const shows = waiting.filter((one) => one.item.kind === "show");
  const latest = shows[shows.length - 1];
  for (const { key } of shows) marks[key] = "passed";
  if (latest !== undefined && latest.item.kind === "show") {
    const asked = Date.parse(latest.item.at ?? latest.set.at);
    if (Date.now() - asked <= SHOW_FRESH_MS) {
      marks[latest.key] = "used";
      bringUp(latest.item.page, latest.item.search);
    }
  }

  await mark(marks);
  if (coded > 0 && state.page === "reconcile") redraw("reconcile");
}

function bringUp(page: string, search: string | undefined): void {
  if (page === "reconcile") {
    state.reconcileSearch = search ?? "";
    $<HTMLInputElement>("reconcile-search").value = state.reconcileSearch;
    if (search !== undefined) {
      state.reconcileFilter = "all";
      $<HTMLSelectElement>("reconcile-filter").value = "all";
    }
  }
  if (page === "invoices" || page === "bills") {
    const box = document.getElementById(page === "bills" ? "bill-search" : "invoice-search") as HTMLInputElement | null;
    if (box !== null) box.value = search ?? "";
  }
  showPage(page, "top");
}

/** Keep looking while the page is open and in front. */
export function watchForSuggestions(): void {
  if (!looks()) return;
  void lookForSuggestions();
  setInterval(() => {
    if (document.visibilityState === "visible") void lookForSuggestions();
  }, backendKind() === "cloud" ? LOOK_ONLINE_EVERY_MS : LOOK_EVERY_MS);
  window.addEventListener("focus", () => void lookForSuggestions());
}

function lineSaid(id: string): string {
  const t = state.ledger.transactions.find((x) => x.id === id);
  if (t === undefined) return "a line no longer in these books";
  return `${dollars(Math.abs(t.amount))} ${t.amount < 0 ? "paid to" : "from"} ${t.otherParty || t.particulars || t.reference || "nobody named"} on ${t.date}`;
}

function use(one: Waiting): void {
  const { item, key } = one;
  if (item.kind === "split") {
    state.splitSuggested = {
      id: item.transaction,
      parts: item.parts.map((p) => ({ amount: p.amount, code: p.code, note: p.note ?? "" })),
      saved: () => void mark({ [key]: "used" }),
    };
    state.splitting = item.transaction;
    state.reconcileFocus = item.transaction;
    showPage("reconcile", "top");
    afterNextFrame(() => document.querySelector(".split-attached")?.scrollIntoView({ behavior: "smooth", block: "center" }));
    return;
  }
  if (item.kind === "journal") {
    openJournalDraft(item, () => void mark({ [key]: "used" }));
  }
}

/** Splits and journals the AI app suggested, each to open or decline. Null when there are none. */
export function suggestionsSection(): HTMLElement | null {
  const waiting = suggestionsToLookAt();
  if (waiting.length === 0) return null;
  const section = document.createElement("section");
  section.className = "suggested-inbox milestones-card";
  section.id = "suggested-inbox";
  const heading = document.createElement("h3");
  const names = [...new Set(waiting.map((one) => suggesterName(one.set.from)))];
  heading.textContent = `Suggested by ${names.join(" and ")}`;
  const hint = document.createElement("p");
  hint.className = "page-hint";
  hint.textContent = "Nothing here is in the books yet. Open one to check it and save it, or decline it.";
  section.append(heading, hint);

  const list = document.createElement("ul");
  list.className = "suggested-list";
  for (const one of waiting) {
    const li = document.createElement("li");
    const what = document.createElement("div");
    const because = document.createElement("div");
    because.className = "suggested-because";
    if (one.item.kind === "split") {
      what.textContent =
        `Split ${lineSaid(one.item.transaction)}: ` +
        one.item.parts.map((p) => `${dollars(Math.abs(p.amount))} to ${p.code}`).join(", ");
      because.textContent = one.item.because;
    } else if (one.item.kind === "journal") {
      const total = one.item.lines.reduce((sum, l) => sum + l.debit, 0);
      what.textContent = `Journal of ${dollars(total)} on ${one.item.date}: ${one.item.narration}`;
      because.textContent = one.item.because;
    }
    const open = document.createElement("button");
    open.type = "button";
    open.className = "small primary";
    open.textContent = "Open";
    open.addEventListener("click", () => use(one));
    const decline = document.createElement("button");
    decline.type = "button";
    decline.className = "small";
    decline.textContent = "Decline";
    decline.addEventListener("click", () => void mark({ [one.key]: "declined" }));
    const buttons = document.createElement("div");
    buttons.className = "page-actions";
    buttons.append(open, decline);
    li.append(what, because, buttons);
    list.append(li);
  }
  section.append(list);
  return section;
}
