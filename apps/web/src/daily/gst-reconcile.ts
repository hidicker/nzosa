import { recomputeVariance, record, recordFiledReturn, varianceInput } from "../books.js";
import { $, state } from "../state.js";
import { save } from "../store.js";
import { computeOurReturns, detailFor } from "../variance.js";
import type { VarianceRow } from "../variance.js";
import { fillAccounts, unresolvedNote } from "../widgets.js";
import {
  filedReturnFromBoxes,
  filedReturnFromOurs,
  formatAmount,
  gstBoxesFrom,
  gstWithin,
  parseAmount,
} from "@nzosa/core";
import type { FiledReturn, GstReturnResult, VarianceNote } from "@nzosa/core";
import { loadFiledReturns } from "../migrate/file-intake.js";

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

  // Returns are recorded here as well as loaded: the books' own return marked
  // as filed, or one filed some other way typed in from myIR.
  body.append(filedReturnTools());

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
      `${assumedLines} line${assumedLines === 1 ? "" : "s"} in these periods have no coding or ` +
      `GST treatment and were assumed standard-rated (${formatAmount(assumedTax)} of GST). Code ` +
      `them, or set a GST treatment on their account, before relying on the differences below.`;
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
    `${detail.matched} lines agree exactly` +
    (detail.grouped > 0
      ? `, and ${detail.grouped} bank line${detail.grouped === 1 ? " matches" : "s match"} ` +
        "the other system's split across invoices"
      : "") +
    `. Filed GST ${formatAmount(detail.filedGst)}, ours ${formatAmount(detail.ourGst)}.`;
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
  wrap.append(explanationsFor(row));
  return wrap;
}

/**
 * The explanations for one period, and a way to add one.
 *
 * A difference that has been looked at and understood -- a card line dated a
 * day later by the other system, a receipt it later reversed -- is worth
 * writing down once, so the period's "Left" column shows only what nobody has
 * explained yet. There was no way to write one here: they could only arrive
 * in a file.
 *
 * Signed as the comparison is, ours less filed, so notes add up to the
 * difference they explain.
 */
function explanationsFor(row: VarianceRow): HTMLElement {
  const box = document.createElement("div");
  box.className = "variance-explanations";

  const heading = document.createElement("h4");
  heading.textContent = "Explanations";
  box.append(heading);

  const all = state.ledger.varianceNotes ?? [];
  const mine = all.filter((note) => note.period === row.periodEnd);
  for (const note of mine) {
    const line = document.createElement("p");
    line.className = "variance-note";
    line.textContent = `${formatAmount(note.amount)} — ${note.reason} `;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "link-button";
    remove.textContent = "remove";
    remove.addEventListener("click", () =>
      void saveExplanations(
        all.filter((one) => one !== note),
        `Removed explanation for ${row.periodEnd}: ${note.reason}`,
      ),
    );
    line.append(remove);
    box.append(line);
  }

  const form = document.createElement("div");
  form.className = "page-actions";
  const amount = document.createElement("input");
  amount.type = "text";
  amount.inputMode = "decimal";
  amount.size = 10;
  const left = row.left ?? 0;
  amount.placeholder = left === 0 ? "Amount" : formatAmount(left);
  amount.title = "How much of the difference this explains, ours less filed";
  const reason = document.createElement("input");
  reason.type = "text";
  reason.size = 60;
  reason.placeholder = "What differs, and which side is right";
  const add = document.createElement("button");
  add.type = "button";
  add.textContent = "Add explanation";
  add.addEventListener("click", () => {
    const cents = parseAmount(amount.value.trim());
    if (cents === null || cents === 0) {
      alert("Enter the amount this explains, ours less filed: negative where ours is lower.");
      return;
    }
    if (reason.value.trim() === "") {
      alert("Say what the difference is.");
      return;
    }
    const note: VarianceNote = {
      period: row.periodEnd,
      amount: cents,
      reason: reason.value.trim(),
      at: new Date().toISOString().slice(0, 10),
    };
    void saveExplanations(
      [...all, note],
      `Explained ${formatAmount(cents)} of ${row.periodEnd}: ${note.reason}`,
    );
  });
  form.append(amount, reason, add);
  box.append(form);
  return box;
}

async function saveExplanations(notes: VarianceNote[], summary: string): Promise<void> {
  const before = state.ledger.varianceNotes ?? [];
  state.ledger = { ...state.ledger, varianceNotes: notes };
  state.persistent = await save(state.ledger);
  await record("varianceNote", summary, before, notes, "varianceNotes");
  recomputeVariance();
  renderVariance();
}

/** Loading filed returns to compare against. */
export function wireGstReconcile(): void {

  $("variance-pick").addEventListener("click", () => $<HTMLInputElement>("variance-input").click());
  $<HTMLInputElement>("variance-input").addEventListener("change", (e) => {
    const files = [...((e.target as HTMLInputElement).files ?? [])];
    if (files.length > 0) void loadFiledReturns(files);
    (e.target as HTMLInputElement).value = "";
  });
}

/** A filed return being typed in: boxes as typed, until it is saved. */
interface FiledDraft {
  periodEnd: string;
  basis: string;
  box5: string;
  box6: string;
  box9: string;
  box11: string;
  box13: string;
  box8: string;
  box12: string;
}

let filedDraft: FiledDraft | null = null;

/**
 * The periods these books cover that no filed return is held for, and the ways
 * to record one.
 *
 * Without a workbook to load there used to be nothing on this page at all, so a
 * person filing from these books had no comparison to keep. Each ended period
 * is listed with the return the books produce for it.
 */
function filedReturnTools(): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "filed-tools";
  const dates = state.ledger.transactions.map((t) => t.date).sort();
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (first === undefined || last === undefined) return wrap;

  const today = new Date().toISOString().slice(0, 10);
  let ours: GstReturnResult[] = [];
  try {
    ours = computeOurReturns(varianceInput(), first, last);
  } catch {
    ours = [];
  }
  const ended = ours.filter((r) => r.period.to < today);
  const held = new Set(state.filed.map((f) => f.periodEnd));
  const unfiled = ended.filter((r) => !held.has(r.period.to)).slice(-12).reverse();

  const actions = document.createElement("div");
  actions.className = "page-actions";
  const record = document.createElement("button");
  record.type = "button";
  record.textContent = "Record a filed return";
  record.disabled = filedDraft !== null;
  record.addEventListener("click", () => {
    filedDraft = blankFiledDraft(unfiled[0]?.period.to ?? ended[ended.length - 1]?.period.to ?? "");
    renderVariance();
  });
  actions.append(record);
  wrap.append(actions);
  if (filedDraft !== null) wrap.append(filedEditor(filedDraft, [...ended].reverse()));

  if (unfiled.length > 0) {
    const heading = document.createElement("h3");
    heading.textContent = "Periods with no filed return recorded";
    wrap.append(heading);
    const hint = document.createElement("p");
    hint.className = "variance-note";
    hint.textContent =
      "The return these books produce for each period. If it matches what you filed, mark it " +
      "as filed; later changes then show against it. If you filed different figures, record " +
      "the return as filed instead.";
    wrap.append(hint);

    const table = document.createElement("table");
    table.innerHTML =
      "<thead><tr><th>Period</th><th>Due</th><th>Box 5 sales</th><th>Box 11 purchases</th>" +
      "<th>Box 15</th><th></th></tr></thead>";
    const tbody = document.createElement("tbody");
    for (const result of unfiled) {
      const tr = document.createElement("tr");
      for (const text of [
        `${result.period.from} to ${result.period.to}`,
        result.period.payBy !== undefined && result.period.payBy !== result.period.due
          ? `${result.period.due} (pay by ${result.period.payBy})`
          : result.period.due,
        formatAmount(result.boxes.box5),
        formatAmount(result.boxes.box11),
        result.boxes.outcome === "refund"
          ? `${formatAmount(result.boxes.box15)} refund`
          : `${formatAmount(result.boxes.box15)} to pay`,
      ]) {
        const td = document.createElement("td");
        td.textContent = text;
        tr.append(td);
      }
      const cell = document.createElement("td");
      const mark = document.createElement("button");
      mark.type = "button";
      mark.className = "link-button";
      mark.textContent = "mark as filed";
      mark.addEventListener("click", () => void markFiled(result));
      const other = document.createElement("button");
      other.type = "button";
      other.className = "link-button";
      other.textContent = "record as filed";
      other.disabled = filedDraft !== null;
      other.addEventListener("click", () => {
        filedDraft = blankFiledDraft(result.period.to);
        renderVariance();
      });
      cell.append(mark, " · ", other);
      tr.append(cell);
      tbody.append(tr);
    }
    table.append(tbody);
    wrap.append(table);
  }
  return wrap;
}

function blankFiledDraft(periodEnd: string): FiledDraft {
  return { periodEnd, basis: "Payments basis", box5: "", box6: "", box9: "", box11: "", box13: "", box8: "", box12: "" };
}

async function keepFiled(one: FiledReturn): Promise<void> {
  await recordFiledReturn(one);
  renderVariance();
}

async function markFiled(result: GstReturnResult): Promise<void> {
  const owed =
    result.boxes.outcome === "refund"
      ? `a refund of ${formatAmount(result.boxes.box15)}`
      : `${formatAmount(result.boxes.box15)} to pay`;
  if (
    !confirm(
      `Record the return for ${result.period.from} to ${result.period.to} as filed, with ${owed}? ` +
        "It is kept as these books show it now.",
    )
  ) {
    return;
  }
  await keepFiled(filedReturnFromOurs(result));
}

/** The boxes as typed, and whatever is stopping them being saved. */
function boxesFromDraft(draft: FiledDraft): { boxes: ReturnType<typeof gstBoxesFrom>; problems: string[] } {
  const problems: string[] = [];
  const amount = (text: string, what: string): number => {
    if (text.trim() === "") return 0;
    const parsed = parseAmount(text.trim());
    if (parsed === null) {
      problems.push(`${what}: that is not an amount`);
      return 0;
    }
    return parsed;
  };
  const optional = (text: string, what: string): number | undefined =>
    text.trim() === "" ? undefined : amount(text, what);
  const box8 = optional(draft.box8, "Box 8");
  const box12 = optional(draft.box12, "Box 12");
  const boxes = gstBoxesFrom({
    box5: amount(draft.box5, "Box 5"),
    box6: amount(draft.box6, "Box 6"),
    box9: amount(draft.box9, "Box 9"),
    box11: amount(draft.box11, "Box 11"),
    box13: amount(draft.box13, "Box 13"),
    ...(box8 !== undefined ? { box8 } : {}),
    ...(box12 !== undefined ? { box12 } : {}),
  });
  if (draft.periodEnd === "") problems.push("choose the period");
  if (draft.box5.trim() === "" && draft.box11.trim() === "") problems.push("enter Box 5, Box 11, or both");
  return { boxes, problems };
}

function filedEditor(draft: FiledDraft, periods: readonly GstReturnResult[]): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "split-editor journal-editor";
  const title = document.createElement("h4");
  title.textContent = "Record a filed return";
  wrap.append(title);

  const fields = document.createElement("div");
  fields.className = "agent-fields";
  const field = (label: string, control: HTMLElement): void => {
    const wrapper = document.createElement("label");
    wrapper.append(label, control);
    fields.append(wrapper);
  };
  const preview = document.createElement("p");
  preview.className = "split-balance";
  const save = document.createElement("button");
  save.type = "button";
  save.className = "primary";
  save.textContent = "Save return";

  const period = document.createElement("select");
  const ends = periods.map((r) => r.period.to);
  if (draft.periodEnd !== "" && !ends.includes(draft.periodEnd)) ends.unshift(draft.periodEnd);
  for (const end of ends) {
    const option = document.createElement("option");
    const known = periods.find((r) => r.period.to === end);
    option.value = end;
    option.textContent = known ? `${known.period.from} to ${known.period.to}` : `Ending ${end}`;
    option.selected = end === draft.periodEnd;
    period.append(option);
  }
  period.addEventListener("change", () => {
    draft.periodEnd = period.value;
    refresh();
  });
  field("Period", period);

  const basis = document.createElement("select");
  for (const value of ["Payments basis", "Invoice basis", "Hybrid basis"]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    option.selected = value === draft.basis;
    basis.append(option);
  }
  basis.addEventListener("change", () => {
    draft.basis = basis.value;
  });
  field("Basis", basis);

  const box = (label: string, key: keyof FiledDraft, placeholder = "0.00"): void => {
    const input = document.createElement("input");
    input.type = "text";
    input.inputMode = "decimal";
    input.className = "split-amount";
    input.placeholder = placeholder;
    input.value = draft[key];
    input.addEventListener("input", () => {
      draft[key] = input.value;
      refresh();
    });
    field(label, input);
  };
  box("Box 5 — total sales and income", "box5");
  box("Box 6 — zero-rated supplies", "box6");
  box("Box 9 — adjustments", "box9");
  box("Box 11 — total purchases and expenses", "box11");
  box("Box 13 — credit adjustments", "box13");
  box("Box 8 as filed (optional)", "box8", "worked out");
  box("Box 12 as filed (optional)", "box12", "worked out");
  wrap.append(fields, preview);

  save.addEventListener("click", () => {
    const { boxes, problems } = boxesFromDraft(draft);
    if (problems.length > 0) return;
    const found = periods.find((r) => r.period.to === draft.periodEnd);
    const one = filedReturnFromBoxes({
      periodStart: found?.period.from ?? null,
      periodEnd: draft.periodEnd,
      basis: draft.basis,
      status: "Filed",
      boxes,
    });
    filedDraft = null;
    void keepFiled(one);
  });
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => {
    filedDraft = null;
    renderVariance();
  });
  const buttons = document.createElement("div");
  buttons.className = "page-actions";
  buttons.append(save, cancel);
  wrap.append(buttons);

  function refresh(): void {
    const { boxes, problems } = boxesFromDraft(draft);
    const said =
      `Box 7 ${formatAmount(boxes.box7)} · Box 8 ${formatAmount(boxes.box8)} · Box 10 ${formatAmount(boxes.box10)} · ` +
      `Box 12 ${formatAmount(boxes.box12)} · Box 14 ${formatAmount(boxes.box14)} · Box 15 ` +
      (boxes.box15 < 0 ? `${formatAmount(-boxes.box15)} refund` : `${formatAmount(boxes.box15)} to pay`);
    preview.textContent = problems.length === 0 ? said : `${said}. Still to do: ${problems.join("; ")}.`;
    preview.className = problems.length === 0 ? "split-balance ok" : "split-balance off";
    save.disabled = problems.length > 0;
  }
  refresh();
  return wrap;
}
