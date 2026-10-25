import { redraw } from "../app.js";
import { bankLabel, reconcileRows, record, settledAlready } from "../books.js";
import { rpc } from "../cloud.js";
import { state } from "../state.js";
import { backendKind, openCloudBookId, save } from "../store.js";
import { addTransactions } from "./bank-import.js";
import { download, nameCell, note } from "../ui.js";
import { booksLocale, moneyPlaces, noSalesTax } from "../country.js";
import { changesIntoLocked, firstOpenDay, laterLocks, locksMovedBack } from "@nzosa/core";
import type { IsoDate, LockDates, Transaction } from "@nzosa/core";

/**
 * Setting the lock dates, and the bank lines that arrive for a locked period.
 *
 * The locks themselves are kept by the save guard in lock.ts; this is where a
 * person sets them. Locking needs every line up to the date confirmed: a line
 * still on a suggestion would move with the next rule or AI answer, and a
 * finished period cannot have figures that move on their own.
 */

function today(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" });
}

/** For books online, an owner or the accountant moves a lock. Elsewhere there is one person. */
async function mayMoveLocks(): Promise<boolean> {
  if (backendKind() !== "cloud") return true;
  const book = openCloudBookId();
  if (book === "") return true;
  return (await rpc<boolean>("has_role", { book, roles: ["owner", "accountant"] })) === true;
}

/** Lines dated up to `day` still waiting to be confirmed on Reconcile. */
function unconfirmedThrough(day: string): number {
  return reconcileRows().all.filter((one) => one.transaction.date <= day && !settledAlready(one)).length;
}

export function renderLockDates(): void {
  const body = document.getElementById("setup-locks");
  if (body === null) return;
  body.textContent = "";
  const locks = state.ledger.lockDates ?? {};

  const heading = document.createElement("h3");
  heading.textContent = "Lock dates";
  body.append(heading);
  body.append(
    note(
      "Finished periods stay as they were finished. " +
        (noSalesTax()
          ? "The year lock keeps everything up to a signed-off year end from changing. "
          : "The GST lock keeps filed GST returns from changing; the year lock keeps everything " +
            "up to a signed-off year end from changing. ") +
        "A change that would alter a locked figure is refused, whichever page it comes from.",
    ),
  );

  const lastFiled = state.filed.map((f) => f.periodEnd).sort().pop();
  const fields = document.createElement("div");
  fields.className = "agent-fields";
  const field = (label: string, value: string | undefined, hint: string): HTMLInputElement => {
    const wrap = document.createElement("label");
    wrap.append(label);
    const input = document.createElement("input");
    input.type = "date";
    input.value = value ?? "";
    input.max = today();
    wrap.append(input);
    if (hint !== "") {
      const small = document.createElement("small");
      small.textContent = hint;
      wrap.append(small);
    }
    fields.append(wrap);
    return input;
  };
  const gst = field(
    "GST locked up to",
    locks.gst,
    lastFiled === undefined ? "" : `Last GST return marked as filed: period to ${lastFiled}.`,
  );
  // No sales tax, no returns to lock.
  if (noSalesTax()) gst.closest("label")!.hidden = true;
  const year = field("Year locked up to", locks.year, "The last day of the last year signed off.");
  body.append(fields);

  const said = document.createElement("p");
  said.className = "feed-said";
  const saveIt = document.createElement("button");
  saveIt.type = "button";
  saveIt.className = "primary";
  saveIt.textContent = "Save lock dates";
  saveIt.disabled = true;
  void mayMoveLocks().then((may) => {
    saveIt.disabled = !may;
    if (!may) said.textContent = "Only an owner or the accountant of these books can move a lock.";
  });
  saveIt.addEventListener("click", () => {
    const next: LockDates = {
      ...(gst.value !== "" ? { gst: gst.value as IsoDate } : {}),
      ...(year.value !== "" ? { year: year.value as IsoDate } : {}),
    };
    // Moving a lock later takes in more of the books: they have to be finished.
    for (const [was, now] of [
      [locks.gst, next.gst],
      [locks.year, next.year],
    ] as const) {
      if (now === undefined || (was !== undefined && now <= was)) continue;
      const open = unconfirmedThrough(now);
      if (open > 0) {
        said.textContent =
          `${open} line${open === 1 ? " is" : "s are"} dated up to ${now} and not yet confirmed on ` +
          "Reconcile. Confirm them first: a locked period cannot hold figures that may still change.";
        return;
      }
    }
    void setLocks(next);
  });
  body.append(saveIt, said);
  lockedChangesSection(body);
}

/** Each lock dates in words: "GST to 2026-03-31, year to 2026-03-31". */
function locksSaid(l: LockDates | null | undefined): string {
  if (l === null || l === undefined || (l.gst === undefined && l.year === undefined)) return "none";
  return [l.gst ? `GST to ${l.gst}` : "", l.year ? `year to ${l.year}` : ""].filter((p) => p !== "").join(", ");
}

/** The History entries of locks moved back and changes made into periods that had been locked, oldest first. */
function lockedChanges(): { at: string; who: string; what: string; locked: string; undone: boolean }[] {
  return [...changesIntoLocked(state.events)].reverse().map((e) => ({
    at: e.at,
    who: e.who,
    what:
      e.kind === "lockDates" && locksMovedBack(e.before as LockDates | null, e.after as LockDates | null)
        ? `Lock moved back: ${locksSaid(e.before as LockDates | null)} → ${locksSaid(e.after as LockDates | null)}`
        : e.summary,
    locked: e.intoLocked === undefined ? "" : `Changed a period locked ${locksSaid(e.intoLocked)}`,
    undone: e.reverted === true,
  }));
}

/** The same list as CSV, for the accountant. Null when there is nothing in it. */
export function lockedChangesCsv(): string | null {
  const rows = lockedChanges();
  if (rows.length === 0) return null;
  const cell = (t: string): string => (/[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t);
  return (
    [["When", "Who", "What", "Locked period", "Undone"], ...rows.map((r) => [r.at, r.who, r.what, r.locked, r.undone ? "yes" : ""])]
      .map((r) => r.map(cell).join(","))
      .join("\r\n") + "\r\n"
  );
}

/**
 * Changes made into locked periods. A lock refuses any change inside it, so
 * the way into a finished period is to move its lock back: each time that was
 * done is listed, and every change made while it was open that moved a figure
 * in the period it had covered.
 */
function lockedChangesSection(body: HTMLElement): void {
  const rows = lockedChanges();
  const heading = document.createElement("h4");
  heading.textContent = `Changes made into locked periods${rows.length === 0 ? "" : ` (${rows.length})`}`;
  body.append(heading);
  if (rows.length === 0) {
    body.append(note("None. A lock moved back, and anything changed in the period it opened, will be listed here for whoever signs the period off."));
    return;
  }
  body.append(note("Each time a lock was moved back or taken off, and each change that then moved a figure in the period it had covered. From History."));
  const table = document.createElement("table");
  table.className = "report-table owner-table";
  table.innerHTML = "<thead><tr><th>When</th><th>Who</th><th>What</th><th>Locked period</th></tr></thead>";
  const tbody = document.createElement("tbody");
  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.append(
      nameCell(new Date(r.at).toLocaleString(booksLocale())),
      nameCell(r.who),
      nameCell(r.undone ? `${r.what} (undone)` : r.what),
      nameCell(r.locked),
    );
    tbody.append(tr);
  }
  table.append(tbody);
  const scroller = document.createElement("div");
  scroller.className = "table-scroll";
  scroller.append(table);
  const csv = document.createElement("button");
  csv.type = "button";
  csv.className = "small";
  csv.textContent = "Download CSV";
  csv.addEventListener("click", () => {
    const text = lockedChangesCsv();
    if (text !== null) download(text, `changes-into-locked-periods-${today()}.csv`, "text/csv");
  });
  body.append(scroller, csv);
}

async function setLocks(next: LockDates): Promise<void> {
  const before = state.ledger.lockDates ?? null;
  const empty = next.gst === undefined && next.year === undefined;
  // How far the locks have reached is kept whatever they are moved to: it is
  // what marks a change in a period that was locked and has been opened.
  const reached = laterLocks(laterLocks(state.ledger.lockedOnce, before ?? undefined), next);
  const once = reached.gst !== undefined || reached.year !== undefined ? { lockedOnce: reached } : {};
  if (empty) {
    const { lockDates: _gone, lockedOnce: _was, ...rest } = state.ledger;
    state.ledger = { ...rest, ...once };
  } else {
    state.ledger = { ...state.ledger, lockDates: next, ...once };
  }
  state.persistent = await save(state.ledger);
  await record("lockDates", `Lock dates: ${locksSaid(before)} → ${locksSaid(empty ? null : next)}`, before, empty ? null : next);
  redraw("setup");
  redraw("actionsBadge");
}

/**
 * The bank lines that arrived dated in a locked period, each to be brought in
 * dated the first open day, or kept out.
 */
export function renderLockedArrivals(): void {
  const body = document.getElementById("locked-arrivals");
  if (body === null) return;
  body.textContent = "";
  const held = state.ledger.lockedArrivals ?? [];
  if (held.length === 0) return;
  const open = firstOpenDay(state.ledger.lockDates);

  const heading = document.createElement("h4");
  heading.textContent = `Lines dated in a locked period (${held.length})`;
  body.append(heading);
  body.append(
    note(
      "These arrived after their period was locked, so they were kept out of it. Bring one in " +
        `dated ${open ?? "the first open day"}, the first day not locked; leave it out; or move the ` +
        "lock (Setup → Lock dates) to put it in its own period.",
    ),
  );
  const table = document.createElement("table");
  table.className = "report-table owner-table match-table";
  const head = document.createElement("thead");
  head.innerHTML = "<tr><th>Date</th><th>Account</th><th>Payee</th><th>Amount</th><th></th></tr>";
  const tbody = document.createElement("tbody");
  for (const line of held) {
    const tr = document.createElement("tr");
    tr.append(nameCell(line.date), nameCell(bankLabel(line.account)), nameCell(line.otherParty || line.particulars || ""));
    const amount = document.createElement("td");
    amount.className = "report-amount";
    amount.textContent = (line.amount / 100).toLocaleString(booksLocale(), {
      minimumFractionDigits: moneyPlaces(),
      maximumFractionDigits: moneyPlaces(),
    });
    tr.append(amount);
    const actions = document.createElement("td");
    actions.className = "report-amount";
    if (open !== undefined) {
      const bring = document.createElement("button");
      bring.type = "button";
      bring.textContent = `Bring in, dated ${open}`;
      bring.addEventListener("click", () => void decide(line, open));
      actions.append(bring, " ");
    }
    const leave = document.createElement("button");
    leave.type = "button";
    leave.className = "link-button";
    leave.textContent = "Leave out";
    leave.addEventListener("click", () => void decide(line, undefined));
    actions.append(leave);
    tr.append(actions);
    tbody.append(tr);
  }
  table.append(head, tbody);
  body.append(table);
}

async function decide(line: Transaction, dated: IsoDate | undefined): Promise<void> {
  const lockedArrivals = (state.ledger.lockedArrivals ?? []).filter((t) => t.id !== line.id);
  state.ledger = { ...state.ledger, lockedArrivals };
  if (dated === undefined) {
    // Remembered as removed, so the next fetch does not hold it again.
    const removed = new Set(state.ledger.removedDuplicates ?? []);
    removed.add(line.id);
    state.ledger = { ...state.ledger, removedDuplicates: [...removed] };
    state.persistent = await save(state.ledger);
  } else {
    await addTransactions(
      [{ ...line, date: dated, extras: { ...(line.extras ?? {}), bankDate: line.date } }],
      { importer: line.source?.importer ?? "bank", file: "dated after a locked period", problems: [] },
    );
  }
  renderLockedArrivals();
  redraw("actionsBadge");
}
