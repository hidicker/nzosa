import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, sep } from "node:path";

/**
 * The one door to the disk.
 *
 * The server is read-only because nothing here opens a file for writing, and it
 * is confined to one folder because nothing here opens a file except through
 * this. A tool never sees a path: it asks for one of a short list of file names
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

export class Sandbox {
  readonly root: string;

  constructor(folder: string) {
    if (!existsSync(folder) || !statSync(folder).isDirectory()) {
      throw new Error(`${folder} is not a folder of NZOSA books.`);
    }
    this.root = realpathSync(folder);
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

  /** When any book file last changed, so a cache knows to let go. */
  stamp(): string {
    return BOOK_FILES.map((name) => {
      const path = join(this.root, name);
      return existsSync(path) ? String(statSync(path).mtimeMs) : "-";
    }).join("|");
  }
}
