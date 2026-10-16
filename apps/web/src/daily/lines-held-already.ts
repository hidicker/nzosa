/**
 * Lines of a bank file found to be lines the books already held, by file.
 *
 * QuickBooks' bank register carries, beside each line, the account QuickBooks
 * suggests for it. For a line its general ledger already booked, the ledger
 * says where it went and the suggestion is only a guess: read as coding, it
 * proposed moving a hardware purchase QuickBooks had booked to stock over to
 * Supplies. So the coding is read only for the lines that came in.
 */
const held = new Map<string, string[]>();

const key = (date: string, amount: number): string => `${date}|${amount}`;

export function rememberHeldAlready(file: string, lines: readonly { date: string; amount: number }[]): void {
  held.set(file, lines.map((l) => key(l.date, l.amount)));
}

/** The lines of `file` that are not ones the books already held, one for one. */
export function notHeldAlready<T extends { date: string; amount: number }>(file: string, lines: readonly T[]): T[] {
  const pool = new Map<string, number>();
  for (const k of held.get(file) ?? []) pool.set(k, (pool.get(k) ?? 0) + 1);
  return lines.filter((l) => {
    const left = pool.get(key(l.date, l.amount)) ?? 0;
    if (left === 0) return true;
    pool.set(key(l.date, l.amount), left - 1);
    return false;
  });
}
