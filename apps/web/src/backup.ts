import type { LedgerEvent } from "./events.js";
import { state } from "./state.js";
import {
  ledgerName,
  loadEvents,
  loadRules,
  loadRulesArchive,
  partChanged,
  save,
  saveEvents,
  saveRules,
  saveRulesArchive,
} from "./store.js";
import type { RulesArchive, StoredLedger, StoredRules } from "./store.js";
import { note } from "./ui.js";

/**
 * A copy of everything, in one file, on the person's own computer.
 *
 * Books kept on a server are only as safe as somebody's willingness to pay for
 * the backups, and this project starts on a plan that has none worth the name.
 * A file the person holds themselves needs no plan, no company still being in
 * business, and no trust in either: it opens in any copy of NZOSA, including
 * the one that runs from a folder on their own machine.
 *
 * It replaced "Export ledger", which wrote the ledger alone -- leaving out the
 * coding rules, the rule sets they replaced and the history -- and whose import
 * read back only part of what it wrote, so a round trip into new books quietly
 * lost opening balances, manual journals, invoice matches, transfers and filed
 * returns. Both places now make and read this one file, and a ledger file from
 * before still restores.
 */

const FORMAT = "nzosa-backup";

/** Everything a set of books is made of, whichever way they are stored. */
const BACKUP_PARTS = [
  "transactions",
  "decisions",
  "chart",
  "entities",
  "rules",
  "rulesarchive",
  "invoices",
  "allocations",
  "assets",
  "journals",
  "reference",
  "filed",
  "events",
  "payroll",
] as const;

export interface Backup {
  format: string;
  version: 1;
  takenAt: string;
  /** Which books this was taken from, for the person reading the file later. */
  books: string;
  ledger: StoredLedger;
  rules: StoredRules | null;
  rulesArchive: RulesArchive;
  events: LedgerEvent[];
}

const LAST_BACKUP_KEY = "nzosa:last-backup";

function backupTimes(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(LAST_BACKUP_KEY) ?? "{}");
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

/** When these books were last written to a file here, if ever. */
export function lastBackupAt(books: string): string {
  return backupTimes()[books] ?? "";
}

function markBackedUp(books: string): void {
  try {
    localStorage.setItem(
      LAST_BACKUP_KEY,
      JSON.stringify({ ...backupTimes(), [books]: new Date().toISOString() }),
    );
  } catch {
    // Not remembered. The backup still happened, which is the part that counts.
  }
}

export async function buildBackup(): Promise<Backup> {
  const [rules, rulesArchive, events] = await Promise.all([
    loadRules(),
    loadRulesArchive(),
    loadEvents(),
  ]);
  return {
    format: FORMAT,
    version: 1,
    takenAt: new Date().toISOString(),
    books: ledgerName(),
    ledger: state.ledger,
    rules,
    rulesArchive,
    events,
  };
}

function download(backup: Backup): void {
  const stamp = backup.takenAt.slice(0, 10);
  const books = (backup.books === "" ? "books" : backup.books)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const blob = new Blob([`${JSON.stringify(backup, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `nzosa-backup-${books}-${stamp}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Put a backup back.
 *
 * Everything, not the ledger alone: rules, the rule sets they replaced and the
 * history go back too, or a restore would quietly cost somebody their coding
 * rules and any record of how the books got to where they were.
 *
 * Every part is marked as changed first. A save writes only what this session
 * read or touched -- which is what stops a coding from rewriting megabytes of
 * transactions -- and a restore has touched all of it by definition.
 */
export async function restoreBackup(
  file: File,
): Promise<{ ok: true } | { ok: false; why: string }> {
  let parsed: Partial<Backup>;
  try {
    parsed = JSON.parse(await file.text()) as Partial<Backup>;
  } catch {
    return { ok: false, why: "That file is not readable as a backup." };
  }
  const isBackup = parsed.format === FORMAT && Array.isArray(parsed.ledger?.transactions);
  // A ledger file from the old "Export ledger" is the ledger on its own. People
  // have these, so it still restores -- and every field in it comes back now.
  const old = parsed as unknown as Partial<StoredLedger>;
  const isOldLedger = !isBackup && old.version === 1 && Array.isArray(old.transactions);
  if (!isBackup && !isOldLedger) {
    return {
      ok: false,
      why:
        "That is not an NZOSA backup, or a ledger file from an earlier version. " +
        "Nothing was changed.",
    };
  }

  partChanged(...BACKUP_PARTS);
  // A backup is everything, so it replaces everything. An old ledger file holds
  // the ledger alone, so whatever it does not mention is kept rather than wiped.
  state.ledger = (isBackup
    ? { ...parsed.ledger, version: 1 }
    : { ...state.ledger, ...old, version: 1 }) as StoredLedger;
  state.chart = state.ledger.chart ?? [];
  const saved = await save(state.ledger);
  if (parsed.rules) await saveRules(parsed.rules);
  if (parsed.rulesArchive) await saveRulesArchive(parsed.rulesArchive);
  if (Array.isArray(parsed.events)) await saveEvents(parsed.events);
  return saved
    ? { ok: true }
    : { ok: false, why: "Some of it could not be written. Nothing was cleared first." };
}

/** Take a backup of the books open now and save it to this computer. */
export async function downloadBackupNow(books: string): Promise<void> {
  download(await buildBackup());
  markBackedUp(books);
}

/**
 * Restore from a file somebody picked, having said first what it replaces.
 *
 * What is open now is named and counted rather than described: "these books"
 * is not a thing anybody can check before agreeing to replace it.
 */
export async function restoreWithConfirm(file: File, books: string): Promise<void> {
  const count = state.ledger.transactions.length;
  if (
    !confirm(
      `Restore from ${file.name}?\n\n` +
        `This replaces what is in ${books === "" ? "the books open now" : books} ` +
        `(${count} transaction${count === 1 ? "" : "s"}) with what is in that file.`,
    )
  ) {
    return;
  }
  const result = await restoreBackup(file);
  if (result.ok) {
    location.reload();
    return;
  }
  alert(result.why);
}

/**
 * The backup controls, for wherever books are chosen.
 *
 * Said plainly rather than hidden behind a tidy label: what it holds, where it
 * goes, and when one was last taken from these books. A backup nobody
 * remembers to take is the same as no backup, so the page keeps score.
 */
export function backupTools(body: HTMLElement, books: string, hosted: boolean): void {
  const heading = document.createElement("h3");
  heading.textContent = "Backup";
  body.append(heading);

  body.append(
    note(
      hosted
        ? "One file with everything in these books: the transactions and every coding, " +
          "the chart, entities, invoices, assets, the rules and the history. It saves to " +
          "this computer, and opens in any copy of NZOSA — including one running from a " +
          "folder of your own. Take one whenever you have done a solid piece of work."
        : "One file with everything in these books, the rules and the history included. " +
          "The folder itself is the truth here, so this is for keeping a copy somewhere " +
          "else: another disk, or another computer.",
    ),
  );

  const when = lastBackupAt(books);
  const said = document.createElement("p");
  said.className = "cloud-said";
  if (when === "") {
    said.textContent = "No backup taken from this browser yet.";
    said.classList.add("bad");
  } else {
    const [year, month, day] = when.slice(0, 10).split("-");
    const days = Math.floor((Date.now() - new Date(when).getTime()) / 86_400_000);
    said.textContent = `Last backup ${day}/${month}/${year}` + (days > 7 ? ` — ${days} days ago.` : ".");
    if (days > 7) said.classList.add("bad");
  }

  const take = document.createElement("button");
  take.type = "button";
  take.className = "primary";
  take.textContent = "Download a backup";
  take.addEventListener("click", () => {
    take.disabled = true;
    take.textContent = "Gathering…";
    void buildBackup()
      .then((backup) => {
        download(backup);
        markBackedUp(books);
        said.textContent = "Backup saved to this computer just now.";
        said.classList.remove("bad");
      })
      .finally(() => {
        take.disabled = false;
        take.textContent = "Download a backup";
      });
  });

  const pick = document.createElement("button");
  pick.type = "button";
  pick.textContent = "Restore from a backup…";
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.hidden = true;
  pick.addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    // What is open now is what a restore replaces, so it is named and counted
    // rather than described: "these books" is not a thing anybody can check.
    const count = state.ledger.transactions.length;
    if (
      !confirm(
        `Restore from ${file.name}?\n\n` +
          `This replaces everything in ${books === "" ? "the books open now" : books} ` +
          `(${count} transaction${count === 1 ? "" : "s"}) with what is in that file.`,
      )
    ) {
      return;
    }
    pick.disabled = true;
    pick.textContent = "Restoring…";
    void restoreBackup(file).then((result) => {
      if (result.ok) {
        location.reload();
        return;
      }
      pick.disabled = false;
      pick.textContent = "Restore from a backup…";
      said.textContent = result.why;
      said.classList.add("bad");
    });
  });

  const row = document.createElement("div");
  row.className = "backup-tools";
  row.append(take, pick, input);
  body.append(said, row);
}
