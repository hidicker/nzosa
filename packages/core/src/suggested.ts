/**
 * What a person's own AI app suggests for the books, waiting to be used.
 *
 * Somebody working in Claude on their computer (or any app that speaks MCP)
 * can ask it to code lines, split one, or write a journal. The app never
 * changes the books: what it suggests is kept beside them, in a file of its
 * own, as a set of suggestions made together, and the books take a
 * suggestion only when somebody uses it in NZOSA -- the code on Reconcile, the
 * split in the split editor, the journal in the journal editor -- through the
 * same checks as if they had typed it.
 *
 * The file is written only by the MCP server and read only by the page; what
 * the page has done with each suggestion is kept in the books' decisions.
 * Two writers of one file is how a suggestion goes missing.
 */

import type { Cents } from "./money.js";
import type { IsoDate } from "./dates.js";

export interface SuggestedCoding {
  kind: "coding";
  transaction: string;
  /** As the books name it: "Motor Vehicle Expenses - 449". */
  code: string;
  because: string;
}

export interface SuggestedSplitPart {
  /** Signed, in the line's own direction. */
  amount: Cents;
  code: string;
  note?: string;
}

export interface SuggestedSplit {
  kind: "split";
  transaction: string;
  parts: SuggestedSplitPart[];
  because: string;
}

export interface SuggestedJournalLine {
  code: string;
  debit: Cents;
  credit: Cents;
  description?: string;
}

export interface SuggestedJournal {
  kind: "journal";
  date: IsoDate;
  narration: string;
  lines: SuggestedJournalLine[];
  because: string;
}

/** Bring a page up in NZOSA, where it is open, for the person to look at. */
export interface SuggestedShow {
  kind: "show";
  page: string;
  search?: string;
  /** When it was asked: showing the same page twice is two requests. */
  at?: string;
}

export type SuggestedItem = SuggestedCoding | SuggestedSplit | SuggestedJournal | SuggestedShow;

export interface SuggestedSet {
  /** From what is in it, so the same set sent twice is kept once. */
  id: string;
  at: string;
  /** The app that suggested it, as it names itself: "claude-ai", "Claude Desktop". */
  from: string;
  items: SuggestedItem[];
}

export interface SuggestedFile {
  version: 1;
  sets: SuggestedSet[];
}

/** What the page did with one suggestion. */
export type SuggestionDone = "used" | "declined" | "passed";

/** How many sets the file keeps, newest first. */
export const SUGGESTED_SETS_KEPT = 200;

/** One suggestion's name, for remembering what was done with it. */
export function suggestionKey(setId: string, index: number): string {
  return `${setId}:${index}`;
}

/** A short fingerprint of some text: the same text, the same name. Not a secret. */
function fingerprint(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

export function suggestedSetId(items: readonly SuggestedItem[]): string {
  return fingerprint(JSON.stringify(items));
}

/** The file as read, or an empty one where it is missing or not one of these. */
export function readSuggestedFile(value: unknown): SuggestedFile {
  const held = value as Partial<SuggestedFile> | null;
  if (held === null || typeof held !== "object" || !Array.isArray(held.sets)) return { version: 1, sets: [] };
  return { version: 1, sets: held.sets.filter((s) => s !== null && typeof s === "object" && Array.isArray(s.items)) };
}

/**
 * Add a set, newest first. A set already held (the same suggestions, sent
 * again after a dropped answer) is not added twice: the one held is returned.
 */
export function addSuggestedSet(
  file: SuggestedFile,
  items: readonly SuggestedItem[],
  from: string,
  at: string,
): { file: SuggestedFile; set: SuggestedSet; already: boolean } {
  const id = suggestedSetId(items);
  const held = file.sets.find((s) => s.id === id);
  if (held !== undefined) return { file, set: held, already: true };
  const set: SuggestedSet = { id, at, from, items: [...items] };
  return { file: { version: 1, sets: [set, ...file.sets].slice(0, SUGGESTED_SETS_KEPT) }, set, already: false };
}

/** The suggestions nothing has been done with yet, oldest first. */
export function suggestionsWaiting(
  file: SuggestedFile,
  done: Readonly<Record<string, SuggestionDone>>,
): { key: string; set: SuggestedSet; item: SuggestedItem }[] {
  const out: { key: string; set: SuggestedSet; item: SuggestedItem }[] = [];
  for (const set of [...file.sets].reverse()) {
    set.items.forEach((item, index) => {
      const key = suggestionKey(set.id, index);
      if (done[key] === undefined) out.push({ key, set, item });
    });
  }
  return out;
}

/** The app's name as a person reads it. */
export function suggesterName(from: string): string {
  if (/claude/i.test(from)) return "Claude";
  if (/chatgpt|openai/i.test(from)) return "ChatGPT";
  if (/cursor/i.test(from)) return "Cursor";
  return from.trim() === "" ? "your AI app" : from.trim();
}
