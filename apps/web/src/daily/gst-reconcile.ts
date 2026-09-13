import { recomputeVariance } from "../books.js";
import { $, state } from "../state.js";
import { save } from "../store.js";
import { } from "../ui.js";
import { detailFor } from "../variance.js";
import type { VarianceRow } from "../variance.js";
import { fillAccounts, unresolvedNote } from "../widgets.js";
import { formatAmount, gstWithin } from "@nzosa/core";

/**
 * Agreeing a filed GST return with what the books now say.
 *
 * A return is filed from the books as they stood that day. The books then keep
 * moving -- a coding corrected, a split entered, a statement imported late --
 * and by the next return the two no longer agree. That difference is not an
 * error to be hidden; it is the amount that has to be explained, or corrected
 * in the next period.
 *
 * So each filed return is kept as filed, and every box is shown beside what
 * the same period would produce today, with the transactions behind the
 * difference reachable from the figure. An adjustment nobody can point at a
 * transaction for is one that cannot be defended to Inland Revenue.
 */

export function renderVariance(): void {
  fillAccounts("variance-accounts", state.varianceAccounts, () => {
    // Remembered with the ledger: re-picking the same accounts after every
    // reload is work, and getting it wrong quietly changes every figure below.
    state.ledger = { ...state.ledger, varianceAccounts: [...state.varianceAccounts] };
    void save(state.ledger);
    recomputeVariance();
    renderVariance();
  });
  const body = $("variance-body");
  const hint = $("variance-hint");
  body.innerHTML = "";

  // A return is the figure it matters most to be right about.
  const unresolved = unresolvedNote();
  if (unresolved) body.append(unresolved);

  if (state.varianceProblems.length > 0) {
    const list = document.createElement("div");
    list.className = "variance-problems";
    for (const problem of state.varianceProblems) {
      const line = document.createElement("p");
      line.className = "variance-note";
      line.textContent = problem;
      list.append(line);
    }
    body.append(list);
  }

  if (state.varianceRows.length === 0) return;

  // What the figures below are guessing at.
  //
  // A transaction nothing has coded still reaches a return: it falls through
  // every rule and is treated as standard-rated, which puts it in Box 11 and
  // claims three twenty-thirds of it in Box 12. On books that are part-way
  // coded that is a real amount of tax claimed on nobody's authority, and it
  // is claimed silently -- the difference against the filed return looks like
  // a disagreement rather than a gap in the coding. Said once, above the
  // table, because it explains most of what is in it.
  let assumedLines = 0;
  let assumedTax = 0;
  for (const row of state.varianceRows) {
    for (const line of row.computed?.lines ?? []) {
      if (line.classification.assumed !== true) continue;
      assumedLines += 1;
      assumedTax += Math.abs(gstWithin(line.amount, line.classification));
    }
  }
  if (assumedLines > 0) {
    const warning = document.createElement("p");
    warning.className = "variance-note warn";
    warning.textContent =
      `${assumedLines} line${assumedLines === 1 ? "" : "s"} in these periods have no coding and no ` +
      `GST treatment, so they were assumed to be standard-rated. That is ${formatAmount(assumedTax)} ` +
      `of GST claimed or charged on an assumption. Code them, or set a treatment on their account, ` +
      `before treating the differences below as disagreements.`;
    body.append(warning);
  }

  hint.textContent =
    "Box 8 less Box 12 on both sides, so late claims and year-end adjustments do not distort it. Click a period for its lines.";

  const table = document.createElement("table");
  table.innerHTML =
    "<thead><tr><th>Period</th><th>Filed</th><th>Ours</th><th>Difference</th>" +
    "<th>Explained</th><th>Left</th></tr></thead>";
  const tbody = document.createElement("tbody");

  for (const row of state.varianceRows) {
    const tr = document.createElement("tr");
    tr.className = row.left === 0 ? "settled" : row.left === null ? "" : "open";
    const cells = [
      row.periodEnd,
      formatAmount(row.filed),
      row.ours === null ? "--" : formatAmount(row.ours),
      row.difference === null ? "" : formatAmount(row.difference),
      formatAmount(row.explained),
      row.left === null ? "" : formatAmount(row.left),
    ];
    cells.forEach((text, index) => {
      const td = document.createElement("td");
      td.textContent = text;
      if (index === 5) td.className = "left";
      tr.append(td);
    });
    tr.addEventListener("click", () => {
      state.openPeriod = state.openPeriod === row.periodEnd ? null : row.periodEnd;
      renderVariance();
    });
    tbody.append(tr);
  }

  table.append(tbody);
  body.append(table);

  const open = state.varianceRows.find((row) => row.periodEnd === state.openPeriod);
  if (open) body.append(renderDetail(open));
}

function renderDetail(row: VarianceRow): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "variance-detail";
  const detail = detailFor(row);

  const title = document.createElement("h3");
  title.textContent = `${row.periodEnd} — ${row.filedReturn.basis}`;
  wrap.append(title);

  if (!detail) {
    const none = document.createElement("p");
    none.className = "variance-note";
    none.textContent = "No computed return for this period, so there is nothing to line up.";
    wrap.append(none);
    return wrap;
  }

  const summary = document.createElement("p");
  summary.className = "variance-note";
  summary.textContent =
    `${detail.matched} lines agree exactly. ` +
    `Filed GST ${formatAmount(detail.filedGst)}, ours ${formatAmount(detail.ourGst)}.`;
  wrap.append(summary);

  const section = (heading: string, lines: readonly { date: string; amount: number; who: string; what: string }[]) => {
    if (lines.length === 0) return;
    const h = document.createElement("h4");
    h.textContent = `${heading} (${lines.length})`;
    wrap.append(h);
    const table = document.createElement("table");
    table.innerHTML = "<thead><tr><th>Date</th><th>Amount</th><th>GST</th><th>Who</th><th>What</th></tr></thead>";
    const tbody = document.createElement("tbody");
    for (const line of [...lines].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))) {
      const tr = document.createElement("tr");
      for (const [index, text] of [
        line.date,
        formatAmount(line.amount),
        formatAmount(Math.round((line.amount * 3) / 23)),
        line.who,
        line.what,
      ].entries()) {
        const td = document.createElement("td");
        td.textContent = text;
        if (index >= 3) td.style.textAlign = "left";
        tr.append(td);
      }
      tbody.append(tr);
    }
    table.append(tbody);
    wrap.append(table);
  };

  section("In the filed return, not in ours", detail.onlyFiled);
  section("In ours, not in the filed return", detail.onlyOurs);
  return wrap;
}
