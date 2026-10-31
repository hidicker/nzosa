import { existsSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";

/**
 * The one door to the disk.
 *
 * The books are read-only because nothing here opens a book file for writing
 * -- the one file written is the suggestions file beside them -- and the
 * server is confined to one folder because nothing here opens a file except
 * through this. A tool never sees a path: it asks for one of a short list of file names
 * and gets its text back or nothing.
 *
 * Resolved through the real path, so a link inside the books that points
 * elsewhere is refused as well as a name containing "..".
 */
export const BOOK_FILES = [
  "transactions.json",
  "decisions.json",
  "entities.json",
  "chart.json",
  "rules.json",
  "ledger.json",
] as const;

export type BookFile = (typeof BOOK_FILES)[number];

/**
 * The one file this server may write, and only when started with --suggest:
 * what the person's AI app suggests, kept beside the books and never in them.
 * The app reads it and takes a suggestion only when somebody uses it there.
 */
export const SUGGESTED_FILE = "suggested.json";

export class Sandbox {
  readonly root: string;

  constructor(folder: string) {
    if (!existsSync(folder) || !statSync(folder).isDirectory()) {
      throw new Error(`${folder} is not a folder.`);
    }
    this.root = realpathSync(booksIn(realpathSync(folder)));
  }

  /** The text of one book file, or undefined when the books do not have it. */
  read(name: BookFile): string | undefined {
    if (!(BOOK_FILES as readonly string[]).includes(name)) {
      throw new Error(`${String(name)} is not a file this server reads.`);
    }
    const path = join(this.root, name);
    if (!existsSync(path)) return undefined;
    const real = realpathSync(path);
    if (!real.startsWith(this.root + sep)) {
      throw new Error(`${name} resolves outside the books folder and was not read.`);
    }
    return readFileSync(real, "utf8");
  }

  /** The suggestions file's text, or undefined when there is none yet. */
  readSuggested(): string | undefined {
    const path = this.inside(SUGGESTED_FILE);
    return existsSync(path) ? readFileSync(path, "utf8") : undefined;
  }

  /**
   * Replace the suggestions file, whole: written beside it and renamed over
   * it, so the app never reads half of one.
   */
  writeSuggested(text: string): void {
    const path = this.inside(SUGGESTED_FILE);
    const writing = `${path}.writing`;
    writeFileSync(writing, text, { mode: 0o600 });
    renameSync(writing, path);
  }

  /** A path in the books folder, refused where a link would take it out. */
  private inside(name: string): string {
    const path = join(this.root, name);
    if (existsSync(path) && !realpathSync(path).startsWith(this.root + sep)) {
      throw new Error(`${name} resolves outside the books folder and was not used.`);
    }
    return path;
  }

  /** When any book file last changed, so a cache knows to let go. */
  stamp(): string {
    return BOOK_FILES.map((name) => {
      const path = join(this.root, name);
      return existsSync(path) ? String(statSync(path).mtimeMs) : "-";
    }).join("|");
  }
}

/**
 * The books a chosen folder means.
 *
 * People pick the folder that holds their books, or the one above it. A folder
 * that is not books and has no books in it is an error said out loud, because
 * the alternative is an answer of "no transactions" that reads as a fact about
 * their accounts. Several sets of books below it is also an error: choosing
 * between somebody's personal books and a company's is not this server's call.
 */
function booksIn(folder: string): string {
  const isBooks = (dir: string): boolean => existsSync(join(dir, "transactions.json"));
  if (isBooks(folder)) return folder;
  const inside = readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && isBooks(join(folder, entry.name)))
    .map((entry) => entry.name);
  if (inside.length === 1) return join(folder, inside[0] as string);
  if (inside.length === 0) {
    throw new Error(
      `${folder} holds no NZOSA books (no transactions.json in it, or in any folder directly inside it). ` +
        `Choose the folder NZOSA keeps your books in.`,
    );
  }
  throw new Error(
    `${folder} holds ${inside.length} sets of books: ${inside.join(", ")}. Choose the one you want.`,
  );
}
