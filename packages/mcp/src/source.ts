/**
 * Where a set of books is read from, and where suggestions are kept.
 *
 * A folder on this computer (`Sandbox`), or the parts the hosted server hands
 * over for one request (`PartsSource`, for the online connector). The tools
 * see only this, so both answer the same questions with the same checks.
 */

/** The book files a source can be asked for, by their folder names. */
export const BOOK_FILES = [
  "transactions.json",
  "decisions.json",
  "entities.json",
  "chart.json",
  "rules.json",
  "ledger.json",
] as const;

export type BookFile = (typeof BOOK_FILES)[number];

export interface BookSource {
  /** The text of one book file, or undefined when the books do not have it. */
  read(name: BookFile): string | undefined;
  /** Changes whenever any book file does, so a cache knows to let go. */
  stamp(): string;
  /** The suggestions kept beside the books, as text, or undefined when there are none. */
  readSuggested(): string | undefined;
  /** Replace the suggestions, whole. */
  writeSuggested(text: string): void;
}

/** The folder name of each part the server keeps. */
const PART_OF: Record<BookFile, string> = {
  "transactions.json": "transactions",
  "decisions.json": "decisions",
  "entities.json": "entities",
  "chart.json": "chart",
  "rules.json": "rules",
  "ledger.json": "",
};

/**
 * Books handed over whole, as the hosted server holds them: one request's
 * worth, read once. What is suggested is kept in `written` for the caller to
 * save after the request, as the server's part `suggested`.
 */
export class PartsSource implements BookSource {
  written: string | undefined;

  constructor(
    private readonly parts: Readonly<Record<string, unknown>>,
    private readonly name: string,
  ) {}

  read(name: BookFile): string | undefined {
    if (name === "ledger.json") return JSON.stringify({ name: this.name });
    const value = this.parts[PART_OF[name]];
    return value === undefined || value === null ? undefined : JSON.stringify(value);
  }

  stamp(): string {
    return "parts";
  }

  readSuggested(): string | undefined {
    if (this.written !== undefined) return this.written;
    const held = this.parts["suggested"];
    return held === undefined || held === null ? undefined : JSON.stringify(held);
  }

  writeSuggested(text: string): void {
    this.written = text;
  }
}
