/**
 * A change just saved that moved figures in a period once locked, waiting to
 * be written down with what History calls it.
 *
 * The save guard finds it; the change is named a moment later, when History
 * records it. Kept here, apart from both, so neither has to import the other.
 */

let pending: { moved: string[]; at: number } | null = null;

/** How long a note waits for its name: a save is recorded straight after it. */
const FRESH_MS = 10_000;

/** What the save just made moved, in a period that had been locked. */
export function noteLockedMove(moved: string[]): void {
  pending = { moved, at: Date.now() };
}

/** The figures the last save moved in a once-locked period, once, while fresh. */
export function takeLockedMove(): string[] | null {
  const held = pending;
  pending = null;
  return held !== null && Date.now() - held.at <= FRESH_MS ? held.moved : null;
}
