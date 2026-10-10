import { postedJournals, varianceInput } from "./books.js";
import { computeOurReturns } from "./variance.js";
import { state } from "./state.js";
import { booksReadOnly, setSaveGuard } from "./store.js";
import type { StoredLedger } from "./store.js";
import { lockBroken, lockedFigures } from "@nzosa/core";
import type { Account, LockDates, LockedFigures } from "@nzosa/core";

/**
 * Keeping locked periods as they were locked.
 *
 * Every save passes through the guard below. It works out what the locked
 * periods hold -- every posting up to the year lock, every GST return up to
 * the GST lock -- for the books about to be written and for the books last
 * written, and refuses the save when the two differ. Refusing puts the books
 * back as they were, so the screen and the file never disagree.
 *
 * Measured against the last books that were allowed, under the locks being
 * saved: moving a lock, which changes no figure, is allowed; anything that
 * moves a figure inside a lock is not, whichever page did it.
 */

export class LockedChange extends Error {}

/** A change by somebody who may only read these books (see booksReadOnly). */
export class ReadOnlyChange extends Error {}

interface Baseline {
  ledger: StoredLedger;
  chart: Account[];
  /** The figures of `ledger`, under the locks named by `key`. */
  figures: LockedFigures | null;
  key: string;
}

let baseline: Baseline | null = null;

function keyOf(locks: LockDates | undefined): string {
  return `${locks?.gst ?? ""}|${locks?.year ?? ""}`;
}

function hasLocks(locks: LockDates | undefined): boolean {
  return (locks?.gst ?? "") !== "" || (locks?.year ?? "") !== "";
}

/** The locked figures of the books in `state`, under `locks`. */
function figuresNow(locks: LockDates | undefined): LockedFigures {
  // Every entity, whichever is chosen on screen: the choice changes how often
  // GST is filed, and with it the periods, which is not a change to the books.
  const chosen = state.entityFilter;
  state.entityFilter = "";
  try {
    return figuresForAll(locks);
  } finally {
    state.entityFilter = chosen;
  }
}

function figuresForAll(locks: LockDates | undefined): LockedFigures {
  // The between-entity journals follow from the rest and from who owns which
  // account; comparing them would refuse giving an account its owner.
  const journals = locks?.year ? postedJournals().filter((j) => j.source !== "between") : [];
  let returns: ReturnType<typeof computeOurReturns> = [];
  if (locks?.gst) {
    const dates = state.ledger.transactions.map((t) => t.date);
    const from = dates.length === 0 ? locks.gst : dates.reduce((a, b) => (a < b ? a : b));
    returns = computeOurReturns({ ...varianceInput(), accounts: [] }, from, locks.gst);
  }
  return lockedFigures(locks, journals, returns);
}

/** The figures of some other books, worked out by borrowing the state for a moment. */
function figuresOf(ledger: StoredLedger, chart: Account[], locks: LockDates | undefined): LockedFigures {
  const held = { ledger: state.ledger, chart: state.chart };
  state.ledger = ledger;
  state.chart = chart;
  try {
    return figuresNow(locks);
  } finally {
    state.ledger = held.ledger;
    state.chart = held.chart;
  }
}

/** Start again from the books as they are: on opening, restoring or clearing them. */
export function resetLockBaseline(): void {
  baseline = { ledger: state.ledger, chart: state.chart, figures: null, key: "" };
}

function guard(ledger: StoredLedger): void {
  // Read only refuses everything, and the same way a lock does: the books go
  // back as they were opened, so nothing on screen pretends to be saved.
  if (booksReadOnly() && baseline !== null) {
    state.ledger = baseline.ledger;
    state.chart = baseline.chart;
    throw new ReadOnlyChange("You can read these books but not change them.");
  }
  const locks = ledger.lockDates;
  if (baseline === null || (!hasLocks(locks) && !hasLocks(baseline.ledger.lockDates))) {
    baseline = { ledger, chart: state.chart, figures: null, key: "" };
    return;
  }
  const key = keyOf(locks);
  const before =
    baseline.figures !== null && baseline.key === key
      ? baseline.figures
      : figuresOf(baseline.ledger, baseline.chart, locks);
  const after = ledger === state.ledger ? figuresNow(locks) : figuresOf(ledger, state.chart, locks);
  const broken = lockBroken(locks, before, after);
  if (broken !== null) {
    // Back as they were, so what is on the screen is what is on file.
    state.ledger = baseline.ledger;
    state.chart = baseline.chart;
    throw new LockedChange(broken);
  }
  baseline = { ledger, chart: state.chart, figures: after, key };
}

/**
 * Install the guard, and say plainly when it refuses.
 *
 * A refused save throws, which stops whatever the page was doing next --
 * recording it in History included -- and arrives here.
 */
export function installLockGuard(redrawPage: () => void): void {
  setSaveGuard(guard);
  window.addEventListener("unhandledrejection", (event) => {
    if (event.reason instanceof ReadOnlyChange) {
      event.preventDefault();
      alert(
        `${event.reason.message}\n\nNothing was changed. An owner of these books can give you ` +
          "more than read-only access.",
      );
      redrawPage();
      return;
    }
    if (!(event.reason instanceof LockedChange)) return;
    event.preventDefault();
    alert(
      `${event.reason.message}\n\nNothing was changed. To change it, move the lock first ` +
        "(Setup → Lock dates).",
    );
    redrawPage();
  });
}
