/**
 * A ledger folder: the files that are the books.
 *
 * The folder is the truth. The browser holds a working copy of it and writes
 * every change back here, so what is on disk is what you have — no export step,
 * nothing to remember, and a folder you can copy, back up or put in Dropbox.
 *
 * One file per part rather than one big one. Transactions never change after
 * they are imported and are much the largest thing here; decisions change on
 * every click and are small. Keeping them apart means confirming a coding
 * writes a few kilobytes instead of rewriting several megabytes, which is the
 * whole reason writing on every change is affordable.
 *
 * Every write is to a temporary file that is then renamed into place. A rename
 * within a directory is atomic on every filesystem this will meet, so a crash
 * or a power cut leaves either the old file or the new one, never half of
 * either. That guarantee is what makes it safe to call a file the truth.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

/**
 * The parts a ledger is made of.
 *
 * `transactions` is written once by an import and then only read. Everything
 * else is a decision someone made about them.
 */
export const PARTS = [
  "transactions",
  "decisions",
  "chart",
  "entities",
  "rules",
  "invoices",
  "allocations",
  "assets",
  "journals",
  "reference",
  "rulesarchive",
  "filed",
  "events",
];

const META = "ledger.json";

/** What an empty ledger holds, so a caller never has to test for absence. */
function emptyPart(part) {
  if (part === "transactions" || part === "invoices" || part === "allocations") return [];
  if (part === "assets" || part === "journals" || part === "reference") return [];
  if (part === "chart" || part === "filed" || part === "events") return [];
  // Not {}: the app iterates `entities`, and an object without it is a
  // plausible-looking value that fails at the point of use rather than here.
  if (part === "entities") return { entities: [], accounts: {}, banks: {} };
  return {};
}

/**
 * Read a part, and the version it is at.
 *
 * A version is a counter, not a hash: it only has to say "this is not what you
 * read", and a counter does that without hashing megabytes on every write.
 */
export function readPart(folder, part) {
  const file = join(folder, `${part}.json`);
  if (!existsSync(file)) return { version: 0, data: emptyPart(part) };
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    // Written by this app: {version, data}. Anything else is a plain file
    // somebody put there by hand, which is still worth reading.
    if (parsed && typeof parsed === "object" && "version" in parsed && "data" in parsed) {
      return { version: Number(parsed.version) || 0, data: parsed.data };
    }
    return { version: 0, data: parsed };
  } catch (error) {
    throw new Error(`${part}.json could not be read: ${error.message}`);
  }
}

/**
 * Replace a part, if the caller was looking at the current one.
 *
 * `expected` is the version the caller last read. When it does not match, the
 * write is refused and the current state is handed back rather than one writer
 * silently overwriting another. Nothing does that today -- the CLI is locked
 * out while the server runs -- but the check costs nothing now and is painful
 * to retrofit once two people share a ledger over a network.
 */
/** Whether a part holds nothing: an empty list, or an object with no keys. */
function isEmpty(value) {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") {
    // The decisions file is an object of collections; it is empty when all of
    // them are, not when the wrapper happens to have keys.
    const values = Object.values(value);
    if (values.length === 0) return true;
    return values.every((v) => isEmpty(v));
  }
  return false;
}

export function writePart(folder, part, data, expected, allowEmpty = false) {
  mkdirSync(folder, { recursive: true });
  const current = readPart(folder, part);
  if (expected !== undefined && expected !== null && current.version !== expected) {
    return { ok: false, conflict: current };
  }

  // Emptying a part that holds something is almost always a bug rather than an
  // intention: an app whose memory is incomplete writing over a file that is
  // not. Clearing goes through archiveLedger and never through here, so the
  // only honest caller is one that says outright that it means it.
  if (!allowEmpty && isEmpty(data) && !isEmpty(current.data)) {
    return { ok: false, refusedEmpty: true, current };
  }

  const version = current.version + 1;
  const file = join(folder, `${part}.json`);
  const temporary = join(folder, `.${part}.json.writing`);
  writeFileSync(temporary, JSON.stringify({ version, data }, null, 1));
  renameSync(temporary, file);
  return { ok: true, version };
}

/** Every part, with its version. What the app loads on start. */
export function readLedger(folder) {
  const parts = {};
  const problems = [];
  for (const part of PARTS) {
    try {
      parts[part] = readPart(folder, part);
    } catch (error) {
      parts[part] = { version: 0, data: emptyPart(part) };
      problems.push(error.message);
    }
  }
  return { folder, parts, problems, meta: readMeta(folder) };
}

/** The ledger's own name, so a folder can say what it is. */
export function readMeta(folder) {
  const file = join(folder, META);
  if (!existsSync(file)) return { name: "", created: "" };
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { name: "", created: "" };
  }
}

export function writeMeta(folder, meta) {
  mkdirSync(folder, { recursive: true });
  const file = join(folder, META);
  const temporary = join(folder, `.${META}.writing`);
  writeFileSync(temporary, JSON.stringify(meta, null, 1));
  renameSync(temporary, file);
}

/**
 * Move the whole ledger aside into a dated folder.
 *
 * Clearing has to actually clear -- a clear that leaves files to reload is not
 * a clear -- but deleting a year of books on one click is not something to be
 * casual about. Moving them keeps both: the ledger is gone, and it is still
 * there if it turns out it should not have been.
 */
export function archiveLedger(folder) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const into = join(folder, "archive", stamp);
  mkdirSync(into, { recursive: true });

  let moved = 0;
  for (const name of readdirSync(folder)) {
    if (name === "archive" || name.startsWith(".")) continue;
    if (!name.endsWith(".json")) continue;
    // Not the meta file. That says what this folder is called, which survives
    // its contents being cleared -- archiving it renamed "My books" back to
    // "my-books" the first time anything was cleared.
    if (name === META) continue;
    renameSync(join(folder, name), join(into, name));
    moved += 1;
  }
  return { archived: join("archive", stamp), moved };
}

/** Ledger folders side by side, so switching books is a list rather than a path. */
export function listLedgers(root) {
  if (!existsSync(root)) return [];
  const out = [];
  for (const name of readdirSync(root, { withFileTypes: true })) {
    if (!name.isDirectory() || name.name === "archive" || name.name.startsWith(".")) continue;
    const folder = join(root, name.name);
    const meta = readMeta(folder);
    const transactions = readPart(folder, "transactions");
    out.push({
      id: name.name,
      name: meta.name || name.name,
      transactions: Array.isArray(transactions.data) ? transactions.data.length : 0,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Who, if anyone, has these books open.
 *
 * A lock is written while an app is using a folder and removed when it stops.
 * It was read only by the command line, and not by the app itself -- so a
 * second copy of the app opened the same folder quite happily, and two of them
 * wrote their own in-memory state over each other. That is how a chart of
 * ninety-three accounts became one of seventy-seven.
 *
 * A lock whose process is gone is ignored rather than obeyed: a crash should
 * not shut somebody out of their own books until they work out which file to
 * delete.
 */
export function heldBy(folder) {
  const lock = join(folder, ".open-by");
  if (!existsSync(lock)) return null;
  try {
    const held = JSON.parse(readFileSync(lock, "utf8"));
    if (typeof held.pid !== "number") return null;
    if (held.pid === process.pid) return null;
    try {
      // Signal 0 asks whether the process exists without disturbing it.
      process.kill(held.pid, 0);
    } catch {
      return null;
    }
    return held;
  } catch {
    return null;
  }
}

/** Remove a temporary file left behind by a write that never finished. */
export function tidy(folder) {
  if (!existsSync(folder)) return;
  for (const name of readdirSync(folder)) {
    if (name.endsWith(".writing")) rmSync(join(folder, name), { force: true });
  }
}

/**
 * The dated copies sitting beside a set of books.
 *
 * Clearing does not delete: it moves the files into `archive/<stamp>/`. That
 * was true from the start and invisible from the app, which told people there
 * was no undo while the undo sat one folder away. Listing them is what turns a
 * safety net into one somebody can actually reach.
 *
 * Newest first, with enough of a summary to tell one from another -- a date
 * alone does not say which copy is the one with the year's coding in it.
 */
export function listArchives(folder) {
  const root = join(folder, "archive");
  if (!existsSync(root)) return [];

  const out = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const at = join(root, entry.name);

    const count = (part) => {
      try {
        const parsed = JSON.parse(readFileSync(join(at, `${part}.json`), "utf8"));
        const data = parsed.data ?? parsed;
        return Array.isArray(data) ? data.length : 0;
      } catch {
        return 0;
      }
    };

    out.push({
      stamp: entry.name,
      transactions: count("transactions"),
      invoices: count("invoices"),
      accounts: count("chart"),
    });
  }

  out.sort((a, b) => b.stamp.localeCompare(a.stamp));
  return out;
}

/**
 * Put a dated copy back.
 *
 * What is there now is archived first, so restoring is itself reversible --
 * somebody reaching for an old copy is already having a bad day, and taking
 * the current one away without a copy would be the second mistake.
 *
 * The meta file is left alone for the same reason archiving skips it: it says
 * what these books are called, which is a fact about the folder rather than
 * about any one copy of its contents.
 */
export function restoreArchive(folder, stamp) {
  if (!/^[0-9-]+$/.test(stamp)) return { ok: false, error: "not a copy name" };

  const from = join(folder, "archive", stamp);
  if (!existsSync(from)) return { ok: false, error: "no such copy" };

  const saved = archiveLedger(folder);

  let restored = 0;
  for (const name of readdirSync(from)) {
    if (!name.endsWith(".json") || name === META) continue;
    copyFileSync(join(from, name), join(folder, name));
    restored += 1;
  }

  return { ok: true, restored, saved: saved.archived };
}
