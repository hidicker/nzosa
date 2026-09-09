import type { Cents } from "./money.js";
import { bareAccountName } from "./coding-names.js";
import { parseAmount } from "./money.js";
import type { IsoDate } from "./dates.js";
import { daysBetween, parseDate } from "./dates.js";
import type { Account } from "./chart.js";
import type { Journal, JournalLine } from "./journals.js";
import type { Transaction } from "./types.js";
import type { SheetRows, Workbook } from "./xlsx.js";
import { csvToSheet } from "./xlsx.js";

/**
 * Checking our coding against a system that already has one.
 *
 * The rules here were largely derived from those systems, so agreement on the
 * lines they came from proves little. What this measures is the part that
 * matters: a keyword taken from three transactions is applied to every
 * transaction it matches, and this shows where that generalisation held and
 * where it did not.
 *
 * Two reference sources, because the business is split between them: Xero
 * holds the trading company, and the workbook holds the properties. Both
 * reduce to the same shape -- a date, an amount, and the account someone put
 * it to -- so the comparison does not care which it is reading.
 */

export interface ReferenceLine {
  date: IsoDate;
  amount: Cents;
  /** Account code, where the source gives one. */
  code: string;
  /** How the source names the account, for display. */
  label: string;
  /** Which file this came from. */
  source: string;
  /**
   * The bank account the posting sat on.
   *
   * Without it a comparison will happily marry a Rimu Lane transfer to an Arrow
   * Rock loan of the same amount a few days apart, and report the coding as
   * wrong. Xero holds one entity; the ledger holds nine accounts.
   */
  account?: string;
  /** GST rate as the source names it, e.g. `15% GST on Expenses`. */
  gstRate?: string;
  /**
   * The postings behind one payment, when it was split across accounts.
   *
   * A courier payment is freight plus border GST plus an entry fee, each with
   * its own GST treatment; collapsing it to a single account loses the part
   * that matters most. Only present when there is more than one part and they
   * sum to the payment exactly.
   */
  parts?: ReferencePart[];
}

export interface ReferencePart {
  code: string;
  label: string;
  /** Signed the same way as the payment: money out negative. */
  amount: Cents;
  gstRate: string;
  description: string;
}

/** Normalise an account to something two systems can be compared on. */
export function accountKey(text: string, chart: readonly Account[] = []): string | null {
  if (text.trim() === "") return null;
  const digits = /\b(\d{3,4})\b/.exec(text);
  if (digits?.[1]) return digits[1];

  // The workbook writes `Sales` where Xero writes `200 Sales`, so a name has to
  // be resolvable to the same thing as a number or every one of those pairs is
  // reported as a difference.
  // Both sides through the same normaliser, so a chart account whose name
  // begins with the house prefix still matches a label that carries it.
  const cleaned = bareAccountName(text);
  for (const account of chart) {
    if (bareAccountName(account.name) === cleaned) return account.code;
  }
  return cleaned;
}

/** A journal's ledger side is what the payment was for. */
export function referenceFromJournals(
  journals: readonly Journal[],
  isBankLine: (line: JournalLine) => boolean,
  isStructural: (line: JournalLine) => boolean,
  source: string,
): ReferenceLine[] {
  const out: ReferenceLine[] = [];

  for (const journal of journals) {
    const bank = journal.lines.filter(isBankLine);
    if (bank.length !== 1) continue;
    const first = bank[0];
    if (!first) continue;

    const others = journal.lines.filter((line) => line !== first);
    const ledger = others.filter((line) => !isStructural(line));
    // As above: structural only counts as plumbing when the entry has another
    // side. A GST payment has none, and it is still a GST payment.
    const candidates = ledger.length > 0 ? ledger : others;
    if (candidates.length === 0) continue;

    // Freight plus border GST plus an entry fee is one payment for freight.
    // The largest posting is what it was for; the rest are consequences.
    const principal = candidates.reduce((a, b) => (Math.abs(b.amount) > Math.abs(a.amount) ? b : a));
    out.push({
      date: journal.date,
      amount: first.amount,
      code: principal.accountCode,
      label: `${principal.accountCode} ${principal.accountName}`.trim(),
      source,
    });
  }

  return out;
}

/** Column headings the reconciled sheet must have for this to be one. */
const SHEET_REQUIRED = ["Date", "Amount"];

/**
 * Headings a column of codings might carry.
 *
 * A spreadsheet is somebody's own, and the one this was written against heads
 * that column `What`. Nobody else's does. Rather than require a rename nothing
 * documents, the common words are accepted -- and when none of them fits, the
 * columns can be pointed out by hand instead of the file being refused.
 *
 * The last match wins: a sheet often describes a line before it codes it, and
 * the coding is the rightmost of the two.
 */
const CODING_HEADINGS = ["What", "Account", "Code", "Coding", "Category", "Class"];

/** Which columns a sheet is to be read from, when they are chosen by hand. */
export interface SheetColumns {
  /** Column numbers, 1-based, as a spreadsheet counts them. */
  date: number;
  amount: number;
  code: number;
}

/**
 * The headings a sheet appears to have, so they can be shown and chosen from.
 *
 * The heading row is taken to be the one with the most filled cells in the
 * first stretch of the sheet, which is what a heading row is.
 */
export function sheetHeadings(sheet: SheetRows): { row: number; columns: { index: number; name: string }[] } {
  let best = { row: -1, filled: 0 };
  for (const key of [...sheet.rows.keys()].sort((a, b) => a - b).slice(0, 25)) {
    const row = sheet.rows.get(key);
    if (!row) continue;
    const filled = [...row.values()].filter((v) => v.trim() !== "").length;
    if (filled > best.filled) best = { row: key, filled };
  }
  if (best.row < 0) return { row: -1, columns: [] };

  const row = sheet.rows.get(best.row);
  const columns: { index: number; name: string }[] = [];
  for (const [index, value] of [...(row?.entries() ?? [])].sort((a, b) => a[0] - b[0])) {
    if (value.trim() !== "") columns.push({ index, name: value.trim() });
  }
  return { row: best.row, columns };
}

/** Read a sheet from columns chosen by hand rather than found by heading. */
export function readSheetColumns(
  sheet: SheetRows,
  columns: SheetColumns,
  source: string,
): ReferenceLine[] {
  const out: ReferenceLine[] = [];
  for (const key of [...sheet.rows.keys()].sort((a, b) => a - b)) {
    const row = sheet.rows.get(key);
    if (!row) continue;
    const code = (row.get(columns.code) ?? "").trim();
    if (code === "") continue;
    const date = parseDate(row.get(columns.date) ?? "");
    const amount = parseAmount(row.get(columns.amount) ?? "");
    if (date === null || amount === null) continue;
    out.push({ date, amount, code, label: code, source });
  }
  return out;
}

/**
 * Read the workbook's reconciled sheet.
 *
 * The coding lives in a column headed `What`, of which there are two -- an
 * early one holding a description and a later one holding the account. The
 * rightmost is the account, so the last match wins.
 */
export function parseReconciledSheet(workbook: Workbook, source: string): ReferenceLine[] {
  const sheet =
    workbook.sheets.find((s) => /reconciled/i.test(s.name)) ??
    workbook.sheets.find((s) => /duplicatesremoved2/i.test(s.name));
  if (!sheet) return [];
  return readSheet(sheet, source);
}

/**
 * The same reconciled sheet, arriving as CSV rather than as a workbook.
 *
 * The working spreadsheet gets pasted out as a CSV as often as it gets saved
 * as a workbook, and refusing one of the two meant the properties had no
 * reference source at all -- the Xero export only covers the company.
 */
export function parseReconciledCsv(text: string, source: string): ReferenceLine[] {
  return readSheet(csvToSheet(text, source), source);
}

function readSheet(sheet: SheetRows, source: string): ReferenceLine[] {
  let columns: Map<string, number> | null = null;
  for (const key of [...sheet.rows.keys()].sort((a, b) => a - b)) {
    const row = sheet.rows.get(key);
    if (!row) continue;
    const named = new Map<string, number>();
    for (const [column, value] of row) named.set(value.trim(), column);
    if (SHEET_REQUIRED.every((heading) => named.has(heading))) {
      columns = named;
      break;
    }
  }
  if (!columns) return [];

  // The account column is the last one headed with a word a coding goes under.
  let whatColumn = -1;
  for (const key of [...sheet.rows.keys()].sort((a, b) => a - b)) {
    const row = sheet.rows.get(key);
    if (!row) continue;
    let found = false;
    for (const [column, value] of [...row.entries()].sort((a, b) => a[0] - b[0])) {
      if (CODING_HEADINGS.some((heading) => heading.toLowerCase() === value.trim().toLowerCase())) {
        whatColumn = column;
        found = true;
      }
    }
    if (found) break;
  }
  if (whatColumn < 0) return [];

  const dateColumn = columns.get("Date") ?? -1;
  const amountColumn = columns.get("Amount") ?? -1;
  const out: ReferenceLine[] = [];

  for (const key of [...sheet.rows.keys()].sort((a, b) => a - b)) {
    const row = sheet.rows.get(key);
    if (!row) continue;
    const code = (row.get(whatColumn) ?? "").trim();
    if (code === "") continue;
    if (CODING_HEADINGS.some((heading) => heading.toLowerCase() === code.toLowerCase())) continue;

    const date = parseDate(row.get(dateColumn) ?? "");
    const amount = parseAmount(row.get(amountColumn) ?? "");
    if (date === null || amount === null) continue;

    out.push({ date, amount, code, label: code, source });
  }

  return out;
}

/**
 * Read an Account Transactions export.
 *
 * Exported with every column, a bank row carries a `Related account` naming
 * the other side of the posting -- `730 - Roasting Equipment, 820 - GST` --
 * so one row is enough and nothing has to be inferred. That column is only
 * present when all columns are selected, which is why the instructions insist
 * on it.
 *
 * Without it the export is still usable but has to be read the hard way: the
 * postings of one payment are spread over several rows and are tied together
 * only by their contact, since a bank row reads `Vulcan New Zealand` and its
 * ledger row `Vulcan New Zealand - Purchase of wing`.
 */

/**
 * Split the export's blocks back into one payment each, using journal ids.
 *
 * The export groups by contact and date. That is not an identifier, so two
 * payments to one payee on one day become a single block -- and a block with
 * two bank sides looks exactly like a transfer, so it is thrown away whole.
 * The journal report has the identifier the export is missing.
 *
 * Three rules keep this from doing harm:
 *
 *  * It only ever *subdivides*. A block is replaced by its parts or kept as it
 *    was; rows are never moved between blocks, so a wrong journal id cannot
 *    invent a payment out of two real ones.
 *  * A block is only subdivided when *every* row in it resolves to a journal.
 *    A block half-matched would split into a real payment and a remainder, and
 *    the remainder would be read as a payment of its own.
 *  * A row resolves only through a key that appears once in the whole report.
 *    Two journals posting the same amount to the same account on the same day
 *    cannot be told apart, so neither is used and the block stays whole.
 *
 * Failing any of them costs coverage, which is the loss this already has. It
 * must not cost correctness, which would be a new one.
 */
function regroupByJournal(
  groups: Map<string, SheetPosting[]>,
  journals: readonly Journal[] | undefined,
  isBank: (posting: SheetPosting) => boolean,
): SheetPosting[][] {
  const blocks = [...groups.values()];
  // Nothing to group by, so every block gets the arithmetic attempt instead.
  if (journals === undefined || journals.length === 0) {
    return blocks.flatMap((block) => regroupByAmount(block, isBank) ?? [block]);
  }

  const keyOf = (date: IsoDate, code: string, name: string, movement: Cents): string =>
    [date, code.trim(), name.trim(), movement].join("\u0000");

  // Ambiguous keys are removed rather than resolved. A key seen twice names two
  // postings this cannot choose between, and choosing wrongly would put a line
  // on the wrong payment -- a silent mis-coding, which is worse than the
  // dropped block it replaces.
  const owner = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const journal of journals) {
    for (const line of journal.lines) {
      const key = keyOf(journal.date, line.accountCode, line.accountName, line.amount);
      if (owner.has(key) && owner.get(key) !== journal.id) ambiguous.add(key);
      else owner.set(key, journal.id);
    }
  }
  for (const key of ambiguous) owner.delete(key);

  const out: SheetPosting[][] = [];
  for (const block of blocks) {
    const byJournal = new Map<string, SheetPosting[]>();
    let complete = true;
    for (const posting of block) {
      const id = owner.get(keyOf(posting.date, posting.accountCode, posting.account, posting.movement));
      if (id === undefined) {
        complete = false;
        break;
      }
      const list = byJournal.get(id);
      if (list) list.push(posting);
      else byJournal.set(id, [posting]);
    }
    if (complete && byJournal.size > 1) out.push(...byJournal.values());
    else out.push(...(regroupByAmount(block, isBank) ?? [block]));
  }
  return out;
}

interface SheetPosting {
  date: IsoDate;
  amount: Cents;
  account: string;
  /** The chart code, when the export carries one. Numbers compare; names do not. */
  accountCode: string;
  accountType: string;
  description: string;
  /**
   * Debit less credit, in minor units.
   *
   * The sign of `Gross` flips for liability accounts, so a GST claim reads
   * negative while the expense beside it reads positive. Debit and credit do
   * not flip, which makes them the only reliable way to tell which direction
   * a posting went.
   */
  movement: Cents;
  /** `730 - Roasting Equipment, 820 - GST`, when the export carries it. */
  related: string;
  /** The GST rate, which sits on the ledger posting, never on the bank one. */
  gstRate: string;
}


/**
 * Split a block by arithmetic, when no journal report says how.
 *
 * The last resort. Each payment's postings sum to its own bank line, so a block
 * of several payments can sometimes be taken apart by finding which postings
 * add up to which bank amount -- and sometimes cannot, because two different
 * arrangements both add up. Guessing between them would put a coding on the
 * wrong payment, which is a silent error; leaving the block whole loses it,
 * which is the error this already makes. So it takes only the unambiguous ones.
 *
 * Four conditions, all of which have to hold:
 *
 *  * The bank amounts are all different. Two payments of the same size cannot
 *    be told apart at all, and calling that "unique" would be a lie about the
 *    one thing this promises.
 *  * The block is small enough to search exhaustively rather than heuristically.
 *  * Exactly one arrangement works. Not the best one, not the first one found.
 *  * Every posting is used, so nothing is left over to become a payment of its
 *    own.
 */
function regroupByAmount(block: SheetPosting[], isBank: (p: SheetPosting) => boolean): SheetPosting[][] | null {
  const banks = block.filter(isBank);
  const others = block.filter((p) => !isBank(p));
  if (banks.length < 2 || others.length === 0) return null;
  if (banks.length > 5 || others.length > 14) return null;

  const targets = banks.map((p) => -p.movement);
  if (new Set(targets).size !== targets.length) return null;

  const buckets: SheetPosting[][] = targets.map(() => []);
  const running = targets.map(() => 0);
  let solutions = 0;
  let found: SheetPosting[][] | null = null;
  let steps = 0;

  const place = (index: number): void => {
    if (solutions > 1) return;
    if (++steps > 200_000) {
      // Give up rather than spend the page's time on it; an unanswered block
      // is the outcome either way.
      solutions = 2;
      return;
    }
    if (index === others.length) {
      if (running.every((total, i) => total === targets[i])) {
        solutions += 1;
        if (solutions === 1) found = buckets.map((b, i) => [...b, banks[i] as SheetPosting]);
      }
      return;
    }
    const posting = others[index] as SheetPosting;
    for (let i = 0; i < targets.length; i += 1) {
      const target = targets[i] as number;
      const next = (running[i] as number) + posting.movement;
      // Overshooting in the direction of the target can never come back, so
      // the branch is dead.
      if (target >= 0 ? next > target : next < target) continue;
      running[i] = next;
      (buckets[i] as SheetPosting[]).push(posting);
      place(index + 1);
      (buckets[i] as SheetPosting[]).pop();
      running[i] = (running[i] as number) - posting.movement;
      if (solutions > 1) return;
    }
  };
  place(0);

  return solutions === 1 ? found : null;
}

export interface AccountTransactionsOptions {
  /**
   * The journal report for the same period, when one has been loaded.
   *
   * The Account Transactions export ties the rows of one payment together by
   * contact and date, which is not an identifier: two payments to the same
   * payee on one day, with no reference between them, arrive as a single block
   * with two bank sides -- and a block with two bank sides is indistinguishable
   * from a transfer, so all of it is dropped. On one real ledger that lost
   * fifty payments, including a restaurant bill split across a deductible and a
   * non-deductible half, which is exactly the kind of thing this page exists to
   * show.
   *
   * The journal report has what the export lacks: a journal id, one per
   * payment. It lacks what the export has -- a GST rate and a gross figure per
   * line, because its own amounts are net with the tax on a line of its own.
   * So neither file answers this alone, and the two are read together: the
   * journal says which rows belong to which payment, the export says what each
   * row was and at what rate.
   */
  journals?: readonly Journal[];
}

export function parseAccountTransactionsSheet(
  workbook: Workbook,
  source: string,
  /**
   * Whether a posting is the bank side of the entry.
   *
   * Given the account's code as well as its name, because a name alone is not
   * enough: an expense account called "Stripe Fees" looks exactly like a bank
   * account called "Stripe" to anything matching on words. The export gives
   * every ledger account a code and leaves the bank accounts without one,
   * which settles it.
   */
  isBankAccount: (name: string, accountCode: string) => boolean,
  isStructural: (name: string) => boolean,
  options: AccountTransactionsOptions = {},
): ReferenceLine[] {
  const sheet =
    workbook.sheets.find((s) => /account transaction/i.test(s.name)) ?? workbook.sheets[0];
  if (!sheet) return [];

  let columns: Map<string, number> | null = null;
  for (const key of [...sheet.rows.keys()].sort((a, b) => a - b)) {
    const row = sheet.rows.get(key);
    if (!row) continue;
    const named = new Map<string, number>();
    for (const [column, value] of row) named.set(value.trim(), column);
    if (named.has("Date") && named.has("Account") && (named.has("Gross") || named.has("Debit"))) {
      columns = named;
      break;
    }
  }
  if (!columns) return [];

  const at = (row: Map<number, string>, name: string): string =>
    (row.get(columns?.get(name) ?? -1) ?? "").trim();

  const out: ReferenceLine[] = [];

  const groups = new Map<string, SheetPosting[]>();

  for (const key of [...sheet.rows.keys()].sort((a, b) => a - b)) {
    const row = sheet.rows.get(key);
    if (!row) continue;

    const date = parseDate(at(row, "Date"));
    if (date === null) continue;
    const account = at(row, "Account");
    if (account === "") continue;

    const gross = parseAmount(at(row, "Gross"));
    const debit = parseAmount(at(row, "Debit")) ?? 0;
    const credit = parseAmount(at(row, "Credit")) ?? 0;
    const amount = gross ?? debit - credit;
    if (amount === null) continue;

    const description = at(row, "Description");
    const contact = at(row, "Contact") || description.split(" - ")[0]?.trim() || description;
    const groupKey = `${date}\u0000${at(row, "Source")}\u0000${contact}\u0000${at(row, "Reference")}`;
    const posting: SheetPosting = {
      date,
      amount,
      account,
      accountCode: at(row, "Account Code"),
      accountType: at(row, "Account Type"),
      description: at(row, "Description"),
      movement: debit - credit,
      related: at(row, "Related account"),
      gstRate: at(row, "GST Rate Name"),
    };
    const list = groups.get(groupKey);
    if (list) list.push(posting);
    else groups.set(groupKey, [posting]);
  }

  const isBank = (posting: SheetPosting): boolean =>
    isBankAccount(posting.account, posting.accountCode);
  for (const postings of regroupByJournal(groups, options.journals, isBank)) {
    const bank = postings.filter((p) => isBankAccount(p.account, p.accountCode));
    if (bank.length !== 1) continue;
    const first = bank[0];
    if (!first) continue;

    // The ledger posting carries both the account and the GST rate; the bank
    // side of a payment never carries GST.
    const others = postings.filter(
      (p) => p !== first && !isBankAccount(p.account, p.accountCode),
    );
    const ledger = others.filter((p) => !isStructural(p.account));

    // A structural account is plumbing only when there is something else in
    // the entry. GST, receivables and payables are stripped because an
    // ordinary purchase posts to an expense *and* to GST, and the expense is
    // what it was for -- but a GST payment to Inland Revenue posts to the bank
    // and to GST and to nothing else. Stripping it there left an entry with no
    // ledger side at all, so every GST payment was dropped from the reference
    // and no rule could ever be learnt for the most predictable payment a
    // business makes.
    const candidates = ledger.length > 0 ? ledger : others;
    const principal =
      candidates.length > 0
        ? candidates.reduce((a, b) => (Math.abs(b.amount) > Math.abs(a.amount) ? b : a))
        : undefined;

    // `Related account` on the bank row is the fallback when the ledger side
    // is not in the export, and the only source at all when the export was
    // taken without every column.
    // Prefer the code over the name. `310` and `NB Cost of Goods Sold - 310`
    // are obviously the same account; `Cost of Goods Sold` and
    // `NB Cost of Goods Sold - 310` are only the same if a chart of accounts
    // happens to be loaded, and reporting them as different when it is not
    // buries the real disagreements under dozens of naming ones.
    let code =
      principal === undefined
        ? undefined
        : `${principal.accountCode} ${principal.account}`.trim();
    if (principal === undefined && first.related !== "") {
      const related = first.related
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part !== "");
      // Same rule for the fallback: prefer a real account, but take a
      // structural one over nothing.
      code = related.find((part) => !isStructural(stripCode(part))) ?? related[0];
    }
    if (code === undefined) continue;

    // Postings with no tax rate are the tax component of a gross figure that is
    // already represented by another posting; including them double counts.
    const rated = postings.filter((p) => p !== first && p.gstRate !== "");
    const parts: ReferencePart[] = rated.map((p) => ({
      code: `${p.accountCode} ${p.account}`.trim(),
      label: `${p.accountCode} ${p.account}`.trim(),
      // Magnitude from the gross, direction from the debit, because only the
      // debit keeps its meaning across account types.
      amount: (p.movement > 0 ? -1 : 1) * Math.abs(p.amount),
      gstRate: p.gstRate,
      description: p.description,
    }));
    const partsTotal = parts.reduce((sum, p) => sum + p.amount, 0);

    out.push({
      date: first.date,
      amount: first.amount,
      code,
      label: code,
      source,
      account: first.account,
      ...(principal?.gstRate ? { gstRate: principal.gstRate } : {}),
      // Offered only when they reconstruct the payment exactly. A split that
      // does not add up would change a return with no bank line behind it.
      ...(parts.length > 1 && partsTotal === first.amount ? { parts } : {}),
    });
  }

  return out;
}

/** `820 - GST` -> `GST`, so a name test works on either form. */
function stripCode(text: string): string {
  return text.replace(/^\d{3,4}\s*-\s*/, "").trim();
}

export interface CodedTransaction {
  transaction: Transaction;
  /** What our rules and overrides produced, or null. */
  code: string | null;
}

export interface CodingRow {
  transaction: Transaction;
  ours: string | null;
  theirs: ReferenceLine | null;
  /** Set when both sides state a GST rate and they disagree. */
  gstDiffers?: { ours: string; theirs: string };
}

export interface CodingComparison {
  agreed: CodingRow[];
  differed: CodingRow[];
  /** Coded by us, but the reference has nothing to compare against. */
  unreferenced: CodingRow[];
  /**
   * Lines in the reference that no transaction here matched.
   *
   * Not a coding problem: a completeness one. Either the bank data is missing
   * these, or the other system holds entries the bank never saw -- a journal,
   * an adjustment, or an account nobody imported.
   */
  unmatched: ReferenceLine[];
  /**
   * Not coded by us at all.
   *
   * `theirs` is the reference line where the other system did code it, which
   * is the whole value of this bucket on a ledger nobody has worked through
   * yet: not a comparison, an answer waiting to be adopted.
   */
  uncoded: CodingRow[];
  /** Payees ordered by how many differences they account for. */
  worst: { payee: string; wrong: number; right: number }[];
}

export interface CodingCheckOptions {
  chart?: readonly Account[];
  /** How far apart two dates may be and still be the same payment. */
  windowDays?: number;
  /**
   * Whether one of our accounts and one of theirs are the same account.
   *
   * Supplied by the caller because only it knows how the two name things: a
   * ledger account id like `02-1100-0022001-001` against a Xero account called
   * `BNZ 01 - Kea Coffee Roasters Account`.
   */
  accountMatches?: (ours: Transaction, theirs: ReferenceLine) => boolean;
  /** The GST rate our classification implies, for comparison. */
  gstRateOf?: (transaction: Transaction) => string | null;
}

/**
 * Compare our coding against a reference, payment by payment.
 *
 * Matching is on exact amount and nearest date, each reference row used once.
 * Amount alone pairs arbitrarily once a period holds several payments of the
 * same figure, and reports lines that agree as differences.
 */
/**
 * Whether two GST rate descriptions mean the same thing.
 *
 * Compared on the rate itself rather than the wording: `15% GST on Expenses`
 * and `15% GST on Income` are the same rate applied to opposite sides, and the
 * side is already implied by the sign of the amount.
 */
function sameRate(ours: string, theirs: string): boolean {
  const percent = (text: string): string => {
    const found = /(\d+(?:\.\d+)?)\s*%/.exec(text);
    if (found?.[1]) return String(Number(found[1]));
    return /no gst|zero|exempt|out of scope/i.test(text) ? "0" : text.trim().toLowerCase();
  };
  return percent(ours) === percent(theirs);
}

/**
 * Work out which of their accounts is which of ours.
 *
 * The two systems name accounts nothing alike: `02-1100-0022001-001` here
 * against `BNZ 01 - Kea Coffee Roasters Account` there, and a card called
 * `Kea Coffee Roaster` here against `BNZ Visa - Business Card`. Matching on the
 * words of the name works for the first pair and fails completely on the
 * second.
 *
 * So the mapping is inferred from the payments themselves. Matching once
 * without regard to account produces a histogram of which pairs of accounts
 * keep coming up together; a pair that dominates is the same account. Being
 * wrong here is cheap to detect and expensive to guess, so a pairing is only
 * accepted when it clearly wins.
 */
/**
 * The same reference line, loaded twice.
 *
 * Reference lines accumulate, because a year often comes out of the accounting
 * system as several exports and all of them are wanted. Loading the same
 * export twice therefore doubled it -- and a doubled reference is not merely
 * untidy, it is unusable: every one of our transactions then matches two
 * identical rows, nothing is an unambiguous pair, and `inferAccountMapping`
 * returns nothing at all. On one real set of books that was the difference
 * between two account pairings and none, and so between coding suggestions and
 * silence.
 *
 * Keyed on what the line is rather than on which file it came from: the same
 * posting exported twice under two filenames is still one posting.
 */
export function dedupeReference(lines: readonly ReferenceLine[]): ReferenceLine[] {
  const seen = new Set<string>();
  const out: ReferenceLine[] = [];
  for (const line of lines) {
    const key = [
      line.date,
      line.amount,
      line.code,
      line.label,
      line.account ?? "",
      line.gstRate ?? "",
      (line.parts ?? []).length,
    ].join("\u0000");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

export function inferAccountMapping(
  coded: readonly CodedTransaction[],
  reference: readonly ReferenceLine[],
  windowDays = 6,
): Map<string, string> {
  const byAmount = new Map<Cents, ReferenceLine[]>();
  for (const line of reference) {
    if (line.account === undefined) continue;
    const list = byAmount.get(line.amount);
    if (list) list.push(line);
    else byAmount.set(line.amount, [line]);
  }

  const votes = new Map<string, Map<string, number>>();
  for (const entry of coded) {
    const near = (byAmount.get(entry.transaction.amount) ?? []).filter(
      (l) => Math.abs(daysBetween(l.date, entry.transaction.date)) <= windowDays,
    );
    // Only unambiguous pairs vote: several candidates means the amount is a
    // common one, and a guess from it would be noise.
    const only = near.length === 1 ? near[0] : undefined;
    if (!only?.account) continue;
    const forAccount = votes.get(entry.transaction.account) ?? new Map<string, number>();
    forAccount.set(only.account, (forAccount.get(only.account) ?? 0) + 1);
    votes.set(entry.transaction.account, forAccount);
  }

  const mapping = new Map<string, string>();
  for (const [ours, counts] of votes) {
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const first = ranked[0];
    const second = ranked[1];
    if (!first) continue;
    // A clear winner: at least three sightings and twice the runner-up.
    if (first[1] >= 3 && (!second || first[1] >= second[1] * 2)) mapping.set(ours, first[0]);
  }
  return mapping;
}

export function compareCodings(
  coded: readonly CodedTransaction[],
  reference: readonly ReferenceLine[],
  options: CodingCheckOptions = {},
): CodingComparison {
  const chart = options.chart ?? [];
  const windowDays = options.windowDays ?? 6;

  const byAmount = new Map<Cents, ReferenceLine[]>();
  for (const line of reference) {
    const list = byAmount.get(line.amount);
    if (list) list.push(line);
    else byAmount.set(line.amount, [line]);
  }

  const used = new Set<ReferenceLine>();
  const agreed: CodingRow[] = [];
  const differed: CodingRow[] = [];
  const unreferenced: CodingRow[] = [];
  const uncoded: CodingRow[] = [];
  const unpaired: CodedTransaction[] = [];
  const tally = new Map<string, { wrong: number; right: number }>();

  for (const entry of [...coded].sort((a, b) => a.transaction.date.localeCompare(b.transaction.date))) {
    // An uncoded transaction still gets looked up. It used to be filed here
    // with `theirs: null` before any lookup was attempted, which threw away
    // the one thing worth having: on a ledger nobody has coded yet, the
    // reference is not something to check against, it is the answer. Somebody
    // loading a file that says what a payment was, and being told only that
    // the payment is "not coded yet", is being kept from their own data.
    //
    // Matched the same way as everything else, and after the coded ones so a
    // reference line is never taken from a comparison to feed a suggestion.
    if (entry.code === null) {
      unpaired.push(entry);
      continue;
    }

    const candidates = (byAmount.get(entry.transaction.amount) ?? []).filter(
      (l) =>
        !used.has(l) &&
        // A reference line that names its account may only pair with a
        // transaction on that same account.
        (l.account === undefined ||
          options.accountMatches === undefined ||
          options.accountMatches(entry.transaction, l)),
    );
    let best: ReferenceLine | undefined;
    let bestGap = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      const gap = Math.abs(daysBetween(candidate.date, entry.transaction.date));
      if (gap < bestGap) {
        best = candidate;
        bestGap = gap;
      }
    }

    if (!best || bestGap > windowDays) {
      unreferenced.push({ transaction: entry.transaction, ours: entry.code, theirs: null });
      continue;
    }

    used.add(best);
    const row: CodingRow = { transaction: entry.transaction, ours: entry.code, theirs: best };

    // A GST rate that disagrees changes a return even when the account agrees,
    // so it is reported separately rather than folded into the code check.
    const ourRate = options.gstRateOf?.(entry.transaction) ?? null;
    const theirRate = best.gstRate ?? "";
    if (ourRate !== null && theirRate !== "" && !sameRate(ourRate, theirRate)) {
      row.gstDiffers = { ours: ourRate, theirs: theirRate };
    }
    const payee = entry.transaction.otherParty || "(no payee)";
    const score = tally.get(payee) ?? { wrong: 0, right: 0 };

    if (accountKey(entry.code, chart) === accountKey(best.code, chart)) {
      agreed.push(row);
      score.right += 1;
    } else {
      differed.push(row);
      score.wrong += 1;
    }
    tally.set(payee, score);
  }

  const worst = [...tally.entries()]
    .filter(([, score]) => score.wrong > 0)
    .map(([payee, score]) => ({ payee, ...score }))
    .sort((a, b) => b.wrong - a.wrong);

  // Now the uncoded ones, against whatever reference lines are left.
  for (const entry of unpaired) {
    const candidates = (byAmount.get(entry.transaction.amount) ?? []).filter(
      (l) =>
        !used.has(l) &&
        (l.account === undefined ||
          options.accountMatches === undefined ||
          options.accountMatches(entry.transaction, l)),
    );
    let best: ReferenceLine | undefined;
    let bestGap = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      const gap = Math.abs(daysBetween(candidate.date, entry.transaction.date));
      if (gap < bestGap) {
        best = candidate;
        bestGap = gap;
      }
    }
    if (best && bestGap <= windowDays) {
      used.add(best);
      uncoded.push({ transaction: entry.transaction, ours: null, theirs: best });
    } else {
      uncoded.push({ transaction: entry.transaction, ours: null, theirs: null });
    }
  }

  // Reference lines nothing here ever matched.
  //
  // The comparison could only ever report on lines where both sides exist, so
  // a line in the file with no transaction behind it simply vanished -- no
  // row, no count, no warning. That is worth knowing on its own: it means
  // either the bank data is short of something, or the accounting system holds
  // an entry the bank never saw. On one real set of books it was 43 of 383,
  // including every line of an account that had not been imported at all.
  const unmatched = reference.filter((line) => !used.has(line));

  return { agreed, differed, unreferenced, uncoded, unmatched, worst };
}
