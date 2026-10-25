import type { Cents } from "./money.js";
import type { IsoDate } from "./dates.js";
import type { Invoice } from "./invoices.js";
import type { ManualJournal } from "./manual-journals.js";
import type { Overrides, TransactionOverride } from "./overrides.js";
import type { SplitPart, Splits } from "./splits.js";

/**
 * Moving chosen lines from one account to another, in one change.
 *
 * A line in an account comes from one of four places: a bank line coded to
 * it, one part of a split bank line, a line of a manual journal, or a line of
 * an invoice or bill. Each is moved where it is kept -- the bank line's
 * coding, the split part, the journal line, the document line -- so the
 * books post it to the new account exactly as if it had been coded there in
 * the first place, GST and all.
 *
 * What was there before each touched item is returned with what is there
 * after, so the move can be undone as one change, and refused as an undo
 * once any of those items has been changed again since.
 */

/** Where a line in an account is kept. */
export type LineRef =
  | { kind: "bank"; id: string }
  | { kind: "split"; id: string; part: number }
  | { kind: "journal"; id: string; line: number }
  | { kind: "invoice"; invoiceKind: Invoice["kind"]; number: string; line: number };

/** One line an account holds, to be listed and ticked. */
export interface AccountLine {
  ref: LineRef;
  date: IsoDate;
  /** Who: the other party, the contact, or the journal's narration. */
  who: string;
  description: string;
  /** As it posts to the account: money out of the business negative. */
  amount: Cents;
  /** Bank line, split, journal, invoice or bill, in a word. */
  source: string;
}

/** What a move can change. */
export interface MovableBooks {
  overrides: Overrides;
  splits: Splits;
  manualJournals: readonly ManualJournal[];
  invoices: readonly Invoice[];
}

/** Each touched item, as it was or as it is. Null: the bank line had no coding of its own. */
export interface MoveSnapshot {
  overrides: Record<string, TransactionOverride | null>;
  splits: Record<string, SplitPart[]>;
  journals: Record<string, ManualJournal>;
  /** Keyed `sales:INV-1` or `purchase:BILL-1`. */
  invoices: Record<string, Invoice>;
}

export interface MoveResult {
  books: MovableBooks;
  before: MoveSnapshot;
  after: MoveSnapshot;
  moved: number;
}

const invoiceKey = (kind: Invoice["kind"], number: string): string => `${kind}:${number}`;

/** A stable key for a line, to tick it by. */
export function lineKey(ref: LineRef): string {
  switch (ref.kind) {
    case "bank":
      return `bank:${ref.id}`;
    case "split":
      return `split:${ref.id}:${ref.part}`;
    case "journal":
      return `journal:${ref.id}:${ref.line}`;
    case "invoice":
      return `invoice:${invoiceKey(ref.invoiceKind, ref.number)}:${ref.line}`;
  }
}

/**
 * Move lines to another account.
 *
 * `label` is the account as codings and journals name it ("Advertising -
 * 400"); `code` as documents hold it ("400"). `note` is why, kept on each
 * bank line's coding as every hand-made coding is.
 */
export function moveLines(
  books: MovableBooks,
  refs: readonly LineRef[],
  target: { label: string; code: string },
  note: string,
  at: string,
): MoveResult {
  const overrides: Record<string, TransactionOverride> = { ...books.overrides };
  const splits: Record<string, readonly SplitPart[]> = { ...books.splits };
  const journals = new Map(books.manualJournals.map((j) => [j.id, j]));
  const invoices = new Map(books.invoices.map((i) => [invoiceKey(i.kind, i.number), i]));
  const before: MoveSnapshot = { overrides: {}, splits: {}, journals: {}, invoices: {} };
  let moved = 0;

  for (const ref of refs) {
    if (ref.kind === "bank") {
      const was = overrides[ref.id];
      if (!(ref.id in before.overrides)) before.overrides[ref.id] = was === undefined ? null : { ...was };
      overrides[ref.id] = { ...(was ?? {}), code: target.label, confirmed: true, note, at };
      moved += 1;
    } else if (ref.kind === "split") {
      const parts = splits[ref.id];
      const part = parts?.[ref.part];
      if (parts === undefined || part === undefined) continue;
      if (!(ref.id in before.splits)) before.splits[ref.id] = parts.map((p) => ({ ...p }));
      splits[ref.id] = parts.map((p, i) => (i === ref.part ? { ...p, code: target.label } : p));
      moved += 1;
    } else if (ref.kind === "journal") {
      const journal = journals.get(ref.id);
      const line = journal?.lines[ref.line];
      if (journal === undefined || line === undefined || journal.deleted !== undefined) continue;
      if (!(ref.id in before.journals)) before.journals[ref.id] = journal;
      journals.set(ref.id, { ...journal, lines: journal.lines.map((l, i) => (i === ref.line ? { ...l, code: target.label } : l)) });
      moved += 1;
    } else {
      const key = invoiceKey(ref.invoiceKind, ref.number);
      const invoice = invoices.get(key);
      const line = invoice?.lines[ref.line];
      if (invoice === undefined || line === undefined) continue;
      if (!(key in before.invoices)) before.invoices[key] = invoice;
      invoices.set(key, { ...invoice, lines: invoice.lines.map((l, i) => (i === ref.line ? { ...l, accountCode: target.code } : l)) });
      moved += 1;
    }
  }

  const after: MoveSnapshot = {
    overrides: Object.fromEntries(Object.keys(before.overrides).map((id) => [id, overrides[id] ?? null])),
    splits: Object.fromEntries(Object.keys(before.splits).map((id) => [id, [...(splits[id] ?? [])]])),
    journals: Object.fromEntries(Object.keys(before.journals).map((id) => [id, journals.get(id)!])),
    invoices: Object.fromEntries(Object.keys(before.invoices).map((key) => [key, invoices.get(key)!])),
  };
  return {
    books: {
      overrides,
      splits,
      manualJournals: books.manualJournals.map((j) => journals.get(j.id) ?? j),
      invoices: books.invoices.map((i) => invoices.get(invoiceKey(i.kind, i.number)) ?? i),
    },
    before,
    after,
    moved,
  };
}

/**
 * Put the lines a move touched back in the accounts the snapshot has them in.
 *
 * Only the accounts: a bill paid since, or a journal's narration corrected,
 * keeps that. A bank line that had no coding of its own goes back to its
 * rule; one that had goes back to that coding.
 */
export function restoreMove(books: MovableBooks, snapshot: MoveSnapshot): MovableBooks {
  const overrides: Record<string, TransactionOverride> = { ...books.overrides };
  for (const [id, value] of Object.entries(snapshot.overrides)) {
    if (value === null) {
      delete overrides[id];
    } else {
      // The four a move sets come back exactly as they were; anything the
      // books added to the coding since stays.
      const { code: _code, confirmed: _confirmed, note: _note, at: _at, ...since } = overrides[id] ?? { note: "" };
      overrides[id] = { ...since, ...value };
    }
  }
  const splits: Record<string, readonly SplitPart[]> = { ...books.splits };
  for (const [id, parts] of Object.entries(snapshot.splits)) {
    const now = splits[id];
    // Split again differently since: the parts no longer line up, so the
    // snapshot's whole split is what is put back.
    splits[id] =
      now === undefined || now.length !== parts.length
        ? parts
        : now.map((p, i) => {
            const was = parts[i]?.code;
            const { code: _code, ...rest } = p;
            return was === undefined ? rest : { ...rest, code: was };
          });
  }
  const withCodes = <L>(now: readonly L[], was: readonly L[], read: (l: L) => string, write: (l: L, code: string) => L): L[] =>
    now.length !== was.length ? [...was] : now.map((l, i) => write(l, read(was[i] as L)));
  return {
    overrides,
    splits,
    manualJournals: books.manualJournals.map((j) => {
      const was = snapshot.journals[j.id];
      return was === undefined ? j : { ...j, lines: withCodes(j.lines, was.lines, (l) => l.code, (l, code) => ({ ...l, code })) };
    }),
    invoices: books.invoices.map((i) => {
      const was = snapshot.invoices[invoiceKey(i.kind, i.number)];
      return was === undefined
        ? i
        : { ...i, lines: withCodes(i.lines, was.lines, (l) => l.accountCode, (l, accountCode) => ({ ...l, accountCode })) };
    }),
  };
}

/**
 * Whether every item a move touched still has its lines in the accounts the
 * move left them in -- so an undo puts back only the move, and does not also
 * throw away a later recoding. Only the accounts are compared: the books add
 * their own details to a confirmed coding afterwards (money between entities,
 * a document's payments), and those are not somebody changing the line.
 */
export function moveStillHolds(books: MovableBooks, after: MoveSnapshot): boolean {
  const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  for (const [id, value] of Object.entries(after.overrides)) {
    if ((books.overrides[id]?.code ?? null) !== (value?.code ?? null)) return false;
  }
  for (const [id, value] of Object.entries(after.splits)) {
    if (!same(books.splits[id]?.map((p) => [p.amount, p.code ?? ""]), value.map((p) => [p.amount, p.code ?? ""]))) return false;
  }
  const journals = new Map(books.manualJournals.map((j) => [j.id, j]));
  for (const [id, value] of Object.entries(after.journals)) {
    const now = journals.get(id);
    if (now === undefined || now.deleted !== undefined) return false;
    if (!same(now.lines.map((l) => [l.code, l.amount]), value.lines.map((l) => [l.code, l.amount]))) return false;
  }
  const invoices = new Map(books.invoices.map((i) => [invoiceKey(i.kind, i.number), i]));
  for (const [key, value] of Object.entries(after.invoices)) {
    const now = invoices.get(key);
    if (now === undefined || !same(now.lines.map((l) => [l.accountCode, l.gross]), value.lines.map((l) => [l.accountCode, l.gross]))) return false;
  }
  return true;
}
