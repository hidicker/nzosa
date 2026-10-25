import { everyCodedLine, record, reclassify } from "../books.js";
import { redraw } from "../app.js";
import { combobox } from "../combobox.js";
import { booksMoney } from "../country.js";
import { pickableCodes } from "../reconcile.js";
import { state } from "../state.js";
import { savePart } from "../store.js";
import { note } from "../ui.js";
import { reclassifyLines } from "@nzosa/core";
import { periodHeading, reportRange } from "./report-period.js";

/**
 * Reclassify transactions: move chosen lines from one account to another in
 * one change. Choose the account and the period, untick any line that should
 * stay, choose where they go, and move them. Undone from History as one.
 *
 * Bank lines coded whole only: a split line is coded part by part on
 * Reconcile, and a transfer is not coded at all.
 */

let from = "";
let to = "";
/** Lines left out of the move, by id. Everything else in the list goes. */
const leftOut = new Set<string>();

export function renderReclassify(body: HTMLElement, year: number): void {
  const range = reportRange(year);
  const splits = state.ledger.splits ?? {};
  const lines = everyCodedLine().filter(
    (s) => s.code !== null && s.transaction.date >= range.from && s.transaction.date <= range.to && splits[s.transaction.id] === undefined,
  );
  const counts = new Map<string, number>();
  for (const s of lines) counts.set(s.code ?? "", (counts.get(s.code ?? "") ?? 0) + 1);

  const h = document.createElement("h3");
  h.textContent = `Reclassify transactions, ${periodHeading(year)}`;
  body.append(h);
  if (counts.size === 0) {
    body.append(note("No coded bank lines in this period."));
    return;
  }
  if (!counts.has(from)) {
    from = "";
    leftOut.clear();
  }

  const pick = document.createElement("select");
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "Move lines from…";
  pick.append(blank);
  for (const [code, count] of [...counts].sort((a, b) => a[0].localeCompare(b[0]))) {
    const option = document.createElement("option");
    option.value = code;
    option.textContent = `${code} (${count})`;
    option.selected = code === from;
    pick.append(option);
  }
  pick.addEventListener("change", () => {
    from = pick.value;
    leftOut.clear();
    redraw("reports");
  });
  body.append(pick);
  if (from === "") {
    body.append(note("Choose the account the lines are coded to now. The period is chosen beside the year above."));
    return;
  }

  const chosen = lines.filter((s) => s.code === from).sort((a, b) => a.transaction.date.localeCompare(b.transaction.date));
  const target = combobox(
    pickableCodes(state.rules, state.ledger.overrides ?? {}, state.chart).filter((c) => c !== from),
    to === "" ? null : to,
    "Move them to…",
    () => {
      to = target.value;
      paint();
    },
  );
  const move = document.createElement("button");
  move.type = "button";
  move.className = "primary";
  const said = document.createElement("p");
  said.className = "page-hint";
  const going = (): typeof chosen => chosen.filter((s) => !leftOut.has(s.transaction.id));
  function paint(): void {
    const list = going();
    const total = list.reduce((sum, s) => sum + s.transaction.amount, 0);
    move.textContent = `Move ${list.length} line${list.length === 1 ? "" : "s"}`;
    move.disabled = list.length === 0 || to === "" || to === from;
    said.textContent = `${list.length} of ${chosen.length} chosen, ${booksMoney(total)} in all.`;
  }
  move.addEventListener("click", () => {
    const list = going();
    if (list.length === 0 || to === "" || to === from) return;
    void (async () => {
      const { overrides, before } = reclassifyLines(
        state.ledger.overrides ?? {},
        list.map((s) => s.transaction.id),
        to,
        `Moved from ${from}`,
        new Date().toISOString().slice(0, 10),
      );
      state.ledger = { ...state.ledger, overrides };
      state.persistent = await savePart(state.ledger);
      await record("codingBatch", `${list.length} line${list.length === 1 ? "" : "s"} moved from ${from} to ${to}`, before, null);
      reclassify();
      leftOut.clear();
      from = to;
      redraw("reports");
    })();
  });

  const controls = document.createElement("div");
  controls.className = "migration-actions";
  controls.append(target.element, move);
  body.append(controls, said);

  const table = document.createElement("table");
  table.className = "report-table owner-table";
  table.innerHTML = "<thead><tr><th></th><th>Date</th><th>Payee</th><th>Amount</th><th>Coding</th></tr></thead>";
  const tbody = document.createElement("tbody");
  for (const s of chosen) {
    const tr = document.createElement("tr");
    const tick = document.createElement("input");
    tick.type = "checkbox";
    tick.checked = !leftOut.has(s.transaction.id);
    tick.setAttribute("aria-label", `Move ${s.transaction.date} ${s.contact ?? s.transaction.otherParty}`);
    tick.addEventListener("change", () => {
      if (tick.checked) leftOut.delete(s.transaction.id);
      else leftOut.add(s.transaction.id);
      paint();
    });
    const first = document.createElement("td");
    first.append(tick);
    tr.append(first);
    for (const [text, cls] of [
      [s.transaction.date, "report-date"],
      [s.contact ?? s.transaction.otherParty, "report-name"],
      [booksMoney(s.transaction.amount), "report-amount"],
      [s.confirmed ? "confirmed" : "suggested", "report-name"],
    ] as const) {
      const td = document.createElement("td");
      td.className = cls;
      td.textContent = text;
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(tbody);
  const scroller = document.createElement("div");
  scroller.className = "table-scroll";
  scroller.append(table);
  body.append(
    scroller,
    note("Each line moved is confirmed to its new account, noting where it came from. A GST treatment set by hand stays with the line; otherwise the new account's applies. Undo it as one from History."),
  );
  paint();
}
