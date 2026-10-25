import { redraw } from "../app.js";
import { invoiceAssignments, invoicesInPlay, record, reclassify, reportEngine } from "../books.js";
import { combobox } from "../combobox.js";
import { booksMoney, noSalesTax } from "../country.js";
import { movableBooks } from "../events.js";
import { state } from "../state.js";
import { save } from "../store.js";
import { tellOnPage } from "../ui.js";
import { isPosted, knownCodes, lineKey, lockedThrough, moveLines, splitAccountLabel } from "@nzosa/core";
import type { Account, AccountLine } from "@nzosa/core";

/**
 * Moving lines out of one account into another: pick the account, narrow by
 * dates or words, tick the lines, choose where they go. One change, on the
 * History page, undone as one.
 *
 * Every line the account holds is offered whatever it came from -- a bank
 * line, part of a split, a journal line, a line of an invoice or bill -- and
 * each is moved where it is kept, so the books post it as if it had been
 * coded there to begin with. Lines in a locked period are shown and cannot be
 * ticked.
 */

/** Whether a coding, a journal's account or a document's code names this chart account. */
function namesAccount(account: Account): (label: string) => boolean {
  const byName = new Map(state.chart.map((a) => [a.name.trim().toLowerCase(), a]));
  const code = account.code.trim();
  const name = account.name.trim().toLowerCase();
  return (label: string): boolean => {
    if (label.trim() === "") return false;
    const said = splitAccountLabel(label);
    const resolved = said.code || byName.get(said.name.toLowerCase())?.code || "";
    if (code !== "") return resolved === code;
    return said.name.toLowerCase() === name;
  };
}

/** Every line this account holds, newest first. */
export function linesInAccount(account: Account): AccountLine[] {
  const names = namesAccount(account);
  const lines: AccountLine[] = [];
  const engine = reportEngine();
  if (engine !== null) {
    // A bank line settling an invoice, or one leg of a transfer, posts to
    // receivables, payables or the other bank -- never to its coding.
    const settled = invoiceAssignments();
    const transfers = state.ledger.transfers ?? {};
    const splits = state.ledger.splits ?? {};
    for (const t of engine.transactions) {
      if (settled.has(t.id) || transfers[t.id] !== undefined) continue;
      const code = engine.codeOf(t);
      if (code === null || !names(code)) continue;
      const part = /^(.+):(\d+)$/.exec(t.id);
      const parent = part?.[1];
      const isPart = parent !== undefined && splits[parent] !== undefined;
      lines.push({
        ref: isPart ? { kind: "split", id: parent, part: Number(part?.[2]) - 1 } : { kind: "bank", id: t.id },
        date: t.date,
        who: t.otherParty || t.particulars || "",
        description: [t.reference, t.code, t.particulars].filter((s) => (s ?? "").trim() !== "").join(" "),
        amount: -t.amount,
        source: isPart ? "Split bank line" : "Bank line",
      });
    }
  }
  for (const journal of state.ledger.manualJournals ?? []) {
    if (journal.deleted !== undefined) continue;
    journal.lines.forEach((line, index) => {
      if (!names(line.code)) return;
      lines.push({
        ref: { kind: "journal", id: journal.id, line: index },
        date: journal.date,
        who: journal.narration,
        description: line.description ?? "",
        amount: line.amount,
        source: "Journal",
      });
    });
  }
  for (const invoice of invoicesInPlay()) {
    if (!isPosted(invoice)) continue;
    invoice.lines.forEach((line, index) => {
      if (!names(line.accountCode)) return;
      lines.push({
        ref: { kind: "invoice", invoiceKind: invoice.kind, number: invoice.number, line: index },
        date: invoice.issued,
        who: `${invoice.number} ${invoice.contact}`.trim(),
        description: line.description,
        amount: invoice.kind === "sales" ? -line.gross : line.gross,
        source: invoice.kind === "sales" ? "Invoice" : "Bill",
      });
    });
  }
  return lines.sort((a, b) => b.date.localeCompare(a.date));
}

function labelled(text: string, control: HTMLElement): HTMLLabelElement {
  const label = document.createElement("label");
  label.className = "contact-field";
  const span = document.createElement("span");
  span.textContent = text;
  label.append(span, control);
  return label;
}

/** Most lines drawn at once: the rest are reached by narrowing. */
const SHOWN = 400;

export function openMoveLines(account: Account, label: string): void {
  const all = linesInAccount(account);
  if (all.length === 0) {
    void tellOnPage(`Nothing is in ${label} to move.`);
    return;
  }
  const locked = lockedThrough(state.ledger.lockDates);
  const ticked = new Set<string>();

  const box = document.createElement("dialog");
  box.className = "ask-on-page move-lines-view";
  const heading = document.createElement("h3");
  heading.textContent = `Move lines out of ${label}`;

  const fields = document.createElement("div");
  fields.className = "payment-file-fields";
  const from = document.createElement("input");
  from.type = "date";
  const to = document.createElement("input");
  to.type = "date";
  const words = document.createElement("input");
  words.type = "search";
  words.placeholder = "Who or what";
  const options = knownCodes(state.rules, state.ledger.overrides ?? {}, state.chart).filter((c) => c !== label);
  const target = combobox(options, null, "Search accounts…", () => refresh());
  fields.append(labelled("From", from), labelled("To", to), labelled("Containing", words), labelled("Move to", target.element));

  const table = document.createElement("table");
  table.className = "report-table move-lines-table";
  const head = document.createElement("thead");
  const all_ = document.createElement("input");
  all_.type = "checkbox";
  all_.setAttribute("aria-label", "Tick every line shown");
  const headRow = document.createElement("tr");
  const tickHead = document.createElement("th");
  tickHead.append(all_);
  headRow.append(tickHead);
  for (const [text, right] of [["Date", false], ["From", false], ["Who", false], ["Description", false], ["Debit", true], ["Credit", true]] as const) {
    const th = document.createElement("th");
    th.textContent = text;
    if (right) th.style.textAlign = "right";
    headRow.append(th);
  }
  head.append(headRow);
  const body = document.createElement("tbody");
  table.append(head, body);
  const more = document.createElement("p");
  more.className = "payment-file-said";
  const total = document.createElement("p");
  total.className = "payment-file-total";
  const said = document.createElement("p");
  said.className = "cloud-said";
  said.setAttribute("role", "alert");

  const actions = document.createElement("div");
  actions.className = "ask-on-page-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  const go = document.createElement("button");
  go.type = "button";
  go.className = "primary";
  actions.append(cancel, go);

  const isLocked = (line: AccountLine): boolean => locked !== undefined && line.date <= locked;
  const shown = (): AccountLine[] => {
    const needle = words.value.trim().toLowerCase();
    return all.filter(
      (l) =>
        (from.value === "" || l.date >= from.value) &&
        (to.value === "" || l.date <= to.value) &&
        (needle === "" || `${l.who} ${l.description} ${l.source}`.toLowerCase().includes(needle)),
    );
  };
  const chosen = (): AccountLine[] => all.filter((l) => ticked.has(lineKey(l.ref)));

  function refresh(): void {
    const picked = chosen();
    const sum = picked.reduce((s, l) => s + l.amount, 0);
    total.textContent = `${picked.length} ${picked.length === 1 ? "line" : "lines"} ticked, ${booksMoney(Math.abs(sum))} ${sum >= 0 ? "debit" : "credit"}`;
    go.textContent = picked.length === 0 ? "Move" : `Move ${picked.length} ${picked.length === 1 ? "line" : "lines"}`;
    const open = shown().filter((l) => !isLocked(l));
    all_.checked = open.length > 0 && open.every((l) => ticked.has(lineKey(l.ref)));
  }

  function draw(): void {
    body.textContent = "";
    const list = shown();
    for (const line of list.slice(0, SHOWN)) {
      const key = lineKey(line.ref);
      const tr = document.createElement("tr");
      const tickCell = document.createElement("td");
      const tick = document.createElement("input");
      tick.type = "checkbox";
      tick.checked = ticked.has(key);
      tick.disabled = isLocked(line);
      tick.setAttribute("aria-label", `Move ${line.date} ${line.who}`);
      if (tick.disabled) tr.title = `In a locked period, up to ${locked}`;
      tick.addEventListener("change", () => {
        if (tick.checked) ticked.add(key);
        else ticked.delete(key);
        refresh();
      });
      tickCell.append(tick);
      tr.append(tickCell);
      for (const text of [line.date, line.source, line.who, line.description]) {
        const td = document.createElement("td");
        td.textContent = text;
        tr.append(td);
      }
      for (const amount of [line.amount > 0 ? line.amount : 0, line.amount < 0 ? -line.amount : 0]) {
        const td = document.createElement("td");
        td.className = "report-amount";
        td.textContent = amount === 0 ? "" : booksMoney(amount);
        tr.append(td);
      }
      if (tick.disabled) tr.classList.add("move-lines-locked");
      body.append(tr);
    }
    more.textContent =
      (list.length > SHOWN
        ? `Showing ${SHOWN} of ${list.length}. Narrow by dates or words to reach the rest.`
        : `${list.length} of ${all.length} ${all.length === 1 ? "line" : "lines"} in ${label}.`) +
      (noSalesTax() ? "" : " Amounts are as banked or invoiced, GST included.");
    refresh();
  }

  for (const control of [from, to]) control.addEventListener("change", draw);
  words.addEventListener("input", draw);
  all_.addEventListener("change", () => {
    for (const line of shown().slice(0, SHOWN)) {
      if (isLocked(line)) continue;
      if (all_.checked) ticked.add(lineKey(line.ref));
      else ticked.delete(lineKey(line.ref));
    }
    draw();
  });

  const finish = (): void => {
    box.close();
    box.remove();
  };
  cancel.addEventListener("click", finish);
  box.addEventListener("cancel", (event) => {
    event.preventDefault();
    finish();
  });

  go.addEventListener("click", () => {
    said.textContent = "";
    const picked = chosen().filter((l) => !isLocked(l));
    if (picked.length === 0) {
      said.textContent = "Tick the lines to move.";
      return;
    }
    const where = target.value.trim();
    if (where === "") {
      said.textContent = "Choose the account to move them to.";
      return;
    }
    if (where === label) {
      said.textContent = "That is the account they are in already.";
      return;
    }
    const code = splitAccountLabel(where).code || where;
    const at = new Date().toISOString();
    const note = `Moved from ${label} to ${where}`;
    const result = moveLines(movableBooks(state.ledger), picked.map((l) => l.ref), { label: where, code }, note, at);
    go.disabled = true;
    const was = state.ledger;
    void (async () => {
      try {
        state.ledger = {
          ...state.ledger,
          overrides: result.books.overrides,
          splits: result.books.splits,
          manualJournals: [...result.books.manualJournals],
          invoices: [...result.books.invoices],
        };
        state.persistent = await save(state.ledger);
        await record(
          "reclassify",
          `${result.moved} ${result.moved === 1 ? "line" : "lines"} moved from ${label} to ${where}`,
          result.before,
          result.after,
          `move-${at}`,
        );
      } catch (error) {
        // Refused (a locked period, books opened read-only): nothing moved.
        state.ledger = was;
        go.disabled = false;
        said.textContent = error instanceof Error ? error.message : String(error);
        return;
      }
      reclassify();
      finish();
      redraw("entities");
      redraw("reports");
      void tellOnPage(
        `Moved ${result.moved} ${result.moved === 1 ? "line" : "lines"} to ${where}. ` +
          "The History page has it as one change, to undo if it was not right.",
      );
    })();
  });

  const scroll = document.createElement("div");
  scroll.className = "move-lines-scroll";
  scroll.append(table);
  box.append(heading, fields, scroll, more, total, said, actions);
  document.body.append(box);
  draw();
  box.showModal();
}
