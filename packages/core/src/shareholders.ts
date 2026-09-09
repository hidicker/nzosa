import type { Cents } from "./money.js";
import type { IsoDate } from "./dates.js";
import type { Account } from "./chart.js";
import type { PostedJournal } from "./posting.js";
import type { OpeningBalances } from "./balance-sheet.js";

/**
 * The shareholder current account, and why it is worth its own schedule.
 *
 * In a closely held New Zealand company the shareholder's current account is
 * usually the busiest account in the books: money put in, drawings taken out,
 * expenses paid personally, and often the year's profit left in rather than
 * distributed. It ends up carrying the answer to a question the balance sheet
 * only hints at -- does the company owe the shareholder, or the other way
 * round?
 *
 * Which way it points has tax consequences. A credit balance is simply a debt
 * the company owes and nothing follows from it. A **debit** balance means the
 * shareholder has taken more out than they put in: the company has lent them
 * money. Inland Revenue does not let that sit interest-free. A close company
 * either charges interest at the prescribed rate or faces fringe benefit tax on
 * the loan, and where the shareholder is also an employee the choice is between
 * those two rather than neither.
 *
 * This works out the schedule and says which way the account points. It does
 * not calculate the interest or the FBT: the prescribed rate changes quarterly,
 * the treatment depends on facts these books do not hold, and a figure produced
 * from a stale rate would be worse than a plain warning that one is owed.
 */

export interface ShareholderMovement {
  code: string;
  name: string;
  /** Debit positive: money out to the shareholder increases this. */
  drawings: Cents;
  /** Credit positive: money in from the shareholder increases this. */
  introduced: Cents;
}

export interface ShareholderSchedule {
  from: IsoDate;
  to: IsoDate;
  /** Credit positive: what the company owed the shareholder at the start. */
  opening: Cents;
  /** Put in during the period. */
  introduced: Cents;
  /** Taken out during the period. */
  drawings: Cents;
  /** Credit positive: what the company owes at the end. */
  closing: Cents;
  /** The accounts this was built from. */
  movements: ShareholderMovement[];
  /**
   * True when the shareholder owes the company rather than the other way round.
   *
   * The case that needs a practitioner: an overdrawn account is a loan from the
   * company, and Inland Revenue expects interest at the prescribed rate or
   * fringe benefit tax on it.
   */
  overdrawn: boolean;
}

/** Which accounts hold a shareholder's dealings with the company. */
export interface ShareholderAccounts {
  /** Where money the shareholder puts in is recorded, e.g. 910 and 970. */
  introducedCodes?: readonly string[];
  /** Where money the shareholder takes out is recorded, e.g. 980. */
  drawingsCodes?: readonly string[];
}

const DEFAULT_INTRODUCED = ["910", "970"];
const DEFAULT_DRAWINGS = ["980"];

/**
 * Build the current account schedule for a period.
 *
 * Signs follow the schedule a reader expects rather than the ledger: the
 * opening and closing balances are credit positive, because the ordinary state
 * of the account is the company owing the shareholder, and a schedule that
 * showed that as a negative would read as an overdraft when it is the opposite.
 */
export function shareholderSchedule(options: {
  from: IsoDate;
  to: IsoDate;
  journals: readonly PostedJournal[];
  openingBalances?: OpeningBalances;
  chart: readonly Account[];
  accounts?: ShareholderAccounts;
}): ShareholderSchedule {
  const { from, to, journals, openingBalances, chart } = options;
  const introducedCodes = new Set(options.accounts?.introducedCodes ?? DEFAULT_INTRODUCED);
  const drawingsCodes = new Set(options.accounts?.drawingsCodes ?? DEFAULT_DRAWINGS);
  const codes = new Set([...introducedCodes, ...drawingsCodes]);
  const byCode = new Map(chart.map((a) => [a.code, a]));

  const openingAccounts = openingBalances?.accounts ?? {};
  const openingAt = openingBalances?.asAt ?? null;

  // Debit positive throughout, and turned round once at the end.
  let openingRaw = 0;
  for (const code of codes) openingRaw += openingAccounts[code] ?? 0;

  const movementIn = new Map<string, Cents>();
  const movementOut = new Map<string, Cents>();

  for (const journal of journals) {
    if (journal.date > to) continue;
    // Before the opening balances is already inside them.
    if (openingAt !== null && journal.date < openingAt) continue;
    for (const line of journal.lines) {
      const code = line.accountCode || line.accountName;
      if (!codes.has(code)) continue;
      if (journal.date < from) {
        openingRaw += line.amount;
        continue;
      }
      // A credit puts money in; a debit takes it out. Which account it is
      // recorded against does not decide that -- a drawing posted to the loan
      // account is still a drawing -- so the direction of the entry does.
      if (line.amount < 0) movementIn.set(code, (movementIn.get(code) ?? 0) - line.amount);
      else movementOut.set(code, (movementOut.get(code) ?? 0) + line.amount);
    }
  }

  const introduced = [...movementIn.values()].reduce((sum, v) => sum + v, 0);
  const drawings = [...movementOut.values()].reduce((sum, v) => sum + v, 0);

  const opening = -openingRaw;
  const closing = opening + introduced - drawings;

  const movements: ShareholderMovement[] = [...codes]
    .map((code) => ({
      code,
      name: byCode.get(code)?.name ?? code,
      introduced: movementIn.get(code) ?? 0,
      drawings: movementOut.get(code) ?? 0,
    }))
    .filter((m) => m.introduced !== 0 || m.drawings !== 0)
    .sort((a, b) => a.code.localeCompare(b.code));

  return {
    from,
    to,
    opening,
    introduced,
    drawings,
    closing,
    movements,
    overdrawn: closing < 0,
  };
}

/**
 * What to tell a practitioner about an overdrawn account, or null when there is
 * nothing to say.
 *
 * Deliberately not a calculation. The prescribed rate for fringe benefit tax on
 * a low-interest loan is set quarterly by Inland Revenue, and whether the
 * shareholder is also an employee changes which regime applies -- neither of
 * which these books know. A wrong figure carries further than no figure.
 */
export function overdrawnWarning(schedule: ShareholderSchedule): string | null {
  if (!schedule.overdrawn) return null;
  const amount = (-schedule.closing / 100).toLocaleString("en-NZ", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return (
    `The shareholder current account is overdrawn by ${amount} at ${schedule.to}: the ` +
    "shareholder owes the company rather than the other way round. A close company is " +
    "expected to charge interest on that at Inland Revenue's prescribed rate, or to account " +
    "for fringe benefit tax on it where the shareholder is also an employee. The rate is set " +
    "quarterly and the choice depends on facts these books do not hold, so this is a matter " +
    "for whoever prepares the return rather than a figure taken from here."
  );
}
