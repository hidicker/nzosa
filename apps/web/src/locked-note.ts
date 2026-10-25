import type { LockDates } from "@nzosa/core";

/**
 * What the last save did to periods that had been locked: set by the save
 * guard when a change moved a figure in a period that was locked once and is
 * open again, and taken by the History entry that follows the save, so the
 * entry says so.
 */
let pending: LockDates | null = null;

export function noteIntoLocked(locks: LockDates | null): void {
  pending = locks;
}

/** The note for the History entry being written, once. */
export function takeIntoLocked(): LockDates | null {
  const held = pending;
  pending = null;
  return held;
}
