import { redraw } from "../app.js";
import { addTransactions } from "../daily/bank-import.js";
import { bankLabel, banks } from "../books.js";
import { aiAsk, aiRoute, aiStatus } from "../ai-backend.js";
import { state } from "../state.js";
import { savePart } from "../store.js";
import { amountCell, nameCell, note } from "../ui.js";
import {
  checkAgainstSheetTotals,
  checkPrompt,
  conversionPrompt,
  dedupeReference,
  joinConversions,
  lineTotals,
  parseCsvRecords,
  readCheckAnswer,
  readConversionAnswer,
  readXlsx,
  roughTokens,
  sheetLinesToReference,
  sheetLinesToTransactions,
  sheetParts,
  sheetToCsv,
} from "@nzosa/core";
import type { CheckResult, SheetConversion, SheetPart, SheetTab } from "@nzosa/core";

/**
 * Any spreadsheet, read with AI: the page.
 *
 * Load the file; for each part, copy the prompt into an AI and paste its
 * answer back, or ask with these books' own key; see every line's totals, and
 * the sheet's own totals beside them; ask a second time for a check; then keep
 * the lines -- as coded history by default, or as transactions if chosen.
 *
 * Held in this module rather than in the books until kept: nothing reaches the
 * books before somebody has seen it and said yes.
 */

/** Beyond this many parts, the file is better split by the person than by us. */
const MOST_PARTS = 40;
/** A part whose prompt is beyond this many tokens is too wide to send. */
const MOST_TOKENS = 150_000;

interface Held {
  file: string;
  tabs: SheetTab[];
  parts: SheetPart[];
  answers: (SheetConversion | null)[];
  checks: (CheckResult | null)[];
  said: string;
}

let held: Held | null = null;
let keyHere = false;

function text(tag: string, content: string, className = ""): HTMLElement {
  const el = document.createElement(tag);
  el.textContent = content;
  if (className !== "") el.className = className;
  return el;
}

function button(label: string, onClick: () => void, primary = false): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  if (primary) b.className = "primary";
  b.addEventListener("click", onClick);
  return b;
}

function dollars(cents: number): string {
  return (cents / 100).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** A workbook's tabs, or a CSV as one tab, as rows of cells numbered as the sheet numbers them. */
async function tabsOf(file: File): Promise<SheetTab[]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const zipped = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const toRows = (csv: string): string[][] => parseCsvRecords(csv, { skipEmptyRows: false }).map((r) => r.fields);
  if (zipped) {
    const book = await readXlsx(bytes);
    return book.sheets.map((sheet) => ({ name: sheet.name, rows: toRows(sheetToCsv(sheet)) }));
  }
  let csv = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (csv.includes("�")) csv = new TextDecoder("windows-1252").decode(bytes);
  return [{ name: file.name.replace(/\.[^.]+$/, ""), rows: toRows(csv) }];
}

async function load(file: File): Promise<void> {
  // Asked again each time: a key added since the page opened counts.
  keyHere = aiRoute() === "folder" && (await aiStatus().catch(() => null))?.configured === true;
  const tabs = await tabsOf(file);
  const parts = sheetParts(tabs);
  const rows = tabs.reduce((sum, tab) => sum + tab.rows.length, 0);
  const widest = Math.max(0, ...parts.map((part) => roughTokens(conversionPrompt(part))));
  let said = "";
  if (parts.length === 0) said = "There is nothing in this file to read.";
  else if (parts.length > MOST_PARTS) {
    said =
      `This file is too big to read in one go: ${rows.toLocaleString("en-NZ")} rows would be ` +
      `${parts.length} requests. Split it into smaller files, a year at a time, and read each.`;
  } else if (widest > MOST_TOKENS) {
    said =
      "This file is too wide to read: a part of it comes to about " +
      `${widest.toLocaleString("en-NZ")} tokens. Remove columns it does not need, then try again.`;
  }
  held = {
    file: file.name,
    tabs,
    parts: said === "" ? parts : [],
    answers: parts.map(() => null),
    checks: parts.map(() => null),
    said,
  };
  renderSheetAi();
}

function copy(prompt: string, said: HTMLElement): void {
  void navigator.clipboard.writeText(prompt).then(
    () => {
      said.textContent = "Copied. Paste it into your AI, then paste its answer below.";
    },
    () => {
      // The prompt itself, rather than an apology.
      said.textContent = "This browser would not reach the clipboard. Copy the prompt from here:";
      const box = document.createElement("textarea");
      box.className = "ai-paste";
      box.readOnly = true;
      box.value = prompt;
      said.append(box);
    },
  );
}

/** One part: its prompt to copy or ask, and its answer to paste. */
function partRow(part: SheetPart, index: number): HTMLElement {
  const state_ = held!;
  const wrap = document.createElement("div");
  wrap.className = "sheet-ai-part";
  const answer = state_.answers[index] ?? null;
  const status = answer === null
    ? "not read yet"
    : answer.tooBig
      ? "the AI said this part is too big"
      : `${answer.lines.length} lines` + (answer.problems.length > 0 ? `, ${answer.problems.length} not readable` : "");
  wrap.append(text("strong", `Part ${part.index} of ${part.of}`), text("span", ` — ${part.rows} rows · ${status}`));
  const said = document.createElement("p");
  said.className = "feed-said";
  const prompt = conversionPrompt(part, state.ledger.booksAbout ?? "");
  const actions = document.createElement("div");
  actions.className = "migration-actions";
  actions.append(button("Copy the prompt", () => copy(prompt, said)));
  if (keyHere) {
    const ask = button("Ask with my key", () => {
      ask.disabled = true;
      said.textContent = "Asking… a part can take a minute.";
      void aiAsk(prompt).then((got) => {
        ask.disabled = false;
        if (got === null || got.error !== undefined) {
          said.textContent = got?.error ?? "Not available here: copy the prompt instead.";
          return;
        }
        state_.answers[index] = readConversionAnswer(got.text ?? "");
        state_.checks[index] = null;
        renderSheetAi();
      });
    });
    actions.append(ask);
  }
  const paste = document.createElement("textarea");
  paste.className = "ai-paste";
  paste.placeholder = "Paste the AI's answer here";
  const read = button("Read the answer", () => {
    state_.answers[index] = readConversionAnswer(paste.value);
    state_.checks[index] = null;
    renderSheetAi();
  });
  wrap.append(actions, paste, read, said);
  return wrap;
}

/** The second request for one part: work its totals out again, and compare. */
function checkRow(part: SheetPart, index: number): HTMLElement | null {
  const state_ = held!;
  const answer = state_.answers[index] ?? null;
  if (answer === null || answer.lines.length === 0) return null;
  const wrap = document.createElement("div");
  wrap.className = "sheet-ai-part";
  const check = state_.checks[index] ?? null;
  const status = check === null
    ? "not checked yet"
    : check.problems.length > 0
      ? check.problems.join(" ")
      : check.agrees
        ? "the check agrees"
        : `${check.differences.length} difference${check.differences.length === 1 ? "" : "s"} found`;
  wrap.append(text("strong", `Check part ${part.index}`), text("span", ` — ${status}`));
  const said = document.createElement("p");
  said.className = "feed-said";
  const prompt = checkPrompt(part.text, lineTotals(answer.lines));
  const actions = document.createElement("div");
  actions.className = "migration-actions";
  actions.append(button("Copy the check prompt", () => copy(prompt, said)));
  if (keyHere) {
    const ask = button("Check with my key", () => {
      ask.disabled = true;
      said.textContent = "Asking…";
      void aiAsk(prompt).then((got) => {
        ask.disabled = false;
        if (got === null || got.error !== undefined) {
          said.textContent = got?.error ?? "Not available here: copy the prompt instead.";
          return;
        }
        state_.checks[index] = readCheckAnswer(got.text ?? "");
        renderSheetAi();
      });
    });
    actions.append(ask);
  }
  const paste = document.createElement("textarea");
  paste.className = "ai-paste";
  paste.placeholder = "Paste the check's answer here";
  const read = button("Read the check", () => {
    state_.checks[index] = readCheckAnswer(paste.value);
    renderSheetAi();
  });
  wrap.append(actions, paste, read, said);
  if (check !== null && check.differences.length > 0) {
    const table = document.createElement("table");
    table.className = "report-table owner-table";
    table.innerHTML = "<thead><tr><th>Total</th><th>From the sheet</th><th>From the lines</th><th>Rows</th><th>Why</th></tr></thead>";
    const tbody = document.createElement("tbody");
    for (const d of check.differences) {
      const tr = document.createElement("tr");
      tr.append(
        nameCell(d.what),
        amountCell(d.sheet === null ? "" : dollars(d.sheet)),
        amountCell(d.given === null ? "" : dollars(d.given)),
        nameCell(d.rows),
        nameCell(d.note),
      );
      tbody.append(tr);
    }
    table.append(tbody);
    wrap.append(table);
  }
  return wrap;
}

/** Everything read so far: counts, problems, the sheet's own totals, and totals by category and month. */
function summary(joined: SheetConversion): HTMLElement {
  const wrap = document.createElement("div");
  const totals = lineTotals(joined.lines);
  wrap.append(
    note(
      `${totals.count} lines read: ${dollars(totals.in)} in, ${dollars(totals.out)} out.` +
        (joined.skipped.length > 0 ? ` ${joined.skipped.length} rows with figures were left out by the AI, each with a reason.` : "") +
        (joined.problems.length > 0 ? ` ${joined.problems.length} lines could not be read and are not kept.` : ""),
    ),
  );
  if (joined.notes !== "") wrap.append(note(`The AI said: ${joined.notes}`));
  if (joined.problems.length > 0) {
    const list = document.createElement("ul");
    for (const problem of joined.problems.slice(0, 10)) list.append(text("li", problem));
    if (joined.problems.length > 10) list.append(text("li", `and ${joined.problems.length - 10} more`));
    wrap.append(list);
  }
  const checks = checkAgainstSheetTotals(joined.lines, joined.totals).filter((c) => c.agrees !== null);
  if (checks.length > 0) {
    const off = checks.filter((c) => c.agrees === false).length;
    wrap.append(
      text(
        "h4",
        off === 0
          ? `The sheet's own totals: all ${checks.length} agree with the lines`
          : `The sheet's own totals: ${off} of ${checks.length} do not agree with the lines`,
      ),
    );
    const table = document.createElement("table");
    table.className = "report-table owner-table";
    table.innerHTML = "<thead><tr><th>Sheet total</th><th>Sheet says</th><th>Lines come to</th><th></th></tr></thead>";
    const tbody = document.createElement("tbody");
    for (const c of checks) {
      const tr = document.createElement("tr");
      tr.append(
        nameCell(
          `${c.total.label}${c.total.category ? ` — ${c.total.category}` : c.total.month ? ` — ${c.total.month}` : ""}` +
            ` (${c.total.sheet} row ${c.total.row})`,
        ),
        amountCell(dollars(c.total.amount)),
        amountCell(dollars(c.ours ?? 0)),
        nameCell(c.agrees ? "agrees" : "differs"),
      );
      if (!c.agrees) tr.className = "match-off";
      tbody.append(tr);
    }
    table.append(tbody);
    wrap.append(table);
  }
  const byCategory = document.createElement("details");
  byCategory.append(text("summary", `Totals by category (${totals.byCategory.size}) and by month (${totals.byMonth.size})`));
  const table = document.createElement("table");
  table.className = "report-table owner-table";
  const tbody = document.createElement("tbody");
  for (const [name, cents] of [...totals.byCategory.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const tr = document.createElement("tr");
    tr.append(nameCell(name), amountCell(dollars(cents)));
    tbody.append(tr);
  }
  for (const [month, cents] of [...totals.byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const tr = document.createElement("tr");
    tr.append(nameCell(month), amountCell(dollars(cents)));
    tbody.append(tr);
  }
  table.append(tbody);
  byCategory.append(table);
  wrap.append(byCategory);
  return wrap;
}

/** Keep the lines: coded history by default, transactions if chosen. */
function keep(joined: SheetConversion): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "sheet-ai-keep";
  wrap.append(text("h4", "Keep them"));
  const choice = (value: string, label: string, checked: boolean): [HTMLLabelElement, HTMLInputElement] => {
    const l = document.createElement("label");
    l.className = "feed-auto";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "sheet-ai-as";
    input.value = value;
    input.checked = checked;
    l.append(input, ` ${label}`);
    return [l, input];
  };
  const [historyLabel] = choice(
    "history",
    "As coded history (recommended): compared with your bank lines on this page, and used to make rules.",
    true,
  );
  const [txLabel, txInput] = choice(
    "transactions",
    "As transactions: only for money no bank export or feed holds, such as cash. Beside a bank feed for the same account, it is the same money twice.",
    false,
  );
  const account = document.createElement("select");
  const known = [...banks().accounts];
  for (const id of known) account.append(new Option(bankLabel(id), id));
  account.append(new Option("Cash (a new account)", "cash"));
  const accountLabel = document.createElement("label");
  accountLabel.append("Lines that do not say their bank account go to: ", account);
  accountLabel.hidden = true;
  txInput.addEventListener("change", () => (accountLabel.hidden = !txInput.checked));
  for (const radio of [historyLabel, txLabel]) {
    radio.querySelector("input")?.addEventListener("change", () => (accountLabel.hidden = !txInput.checked));
  }
  const said = document.createElement("p");
  said.className = "feed-said";
  const go = button(`Keep ${joined.lines.length} line${joined.lines.length === 1 ? "" : "s"}`, () => {
    go.disabled = true;
    void (async () => {
      const source = held?.file ?? "spreadsheet";
      if (txInput.checked) {
        if (!confirm(`Add ${joined.lines.length} lines to the books as transactions? Check none of them is already in from a bank feed or file.`)) {
          go.disabled = false;
          return;
        }
        await addTransactions(sheetLinesToTransactions(joined.lines, account.value, source), {
          importer: "spreadsheet (AI)",
          file: source,
          problems: [],
        });
        said.textContent =
          `${joined.lines.length} line${joined.lines.length === 1 ? "" : "s"} added as transactions. Review them on Bank import.`;
      } else {
        const before = state.reference.length;
        state.reference = dedupeReference([...state.reference, ...sheetLinesToReference(joined.lines, source)]);
        state.ledger = { ...state.ledger, reference: state.reference };
        state.persistent = await savePart(state.ledger, "reference");
        const kept = state.reference.length - before;
        said.textContent =
          `${kept} line${kept === 1 ? "" : "s"} kept as coded history. They are compared with your bank lines on this page.`;
        redraw("check");
      }
      held = null;
      renderSheetAi(said.textContent ?? "");
    })();
  }, true);
  wrap.append(historyLabel, txLabel, accountLabel, go, said);
  return wrap;
}

/** Draw the panel; `done` is said once the lines have been kept. */
export function renderSheetAi(done = ""): void {
  const body = document.getElementById("sheet-ai-body");
  if (body === null) return;
  body.textContent = "";
  if (done !== "") body.append(note(done));

  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".xlsx,.csv,text/csv";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) void load(file);
  });
  body.append(input);

  if (held === null) return;
  if (held.said !== "") {
    body.append(note(held.said));
    return;
  }
  const rows = held.tabs.reduce((sum, tab) => sum + tab.rows.length, 0);
  body.append(
    note(
      `${held.file}: ${held.tabs.length} tab${held.tabs.length === 1 ? "" : "s"}, ${rows.toLocaleString("en-NZ")} rows, ` +
        `read in ${held.parts.length} part${held.parts.length === 1 ? "" : "s"}. Each part's prompt holds that part of the sheet ` +
        "in full, and goes to the AI you paste it into" + (keyHere ? ", or to your key's provider if you ask with your key." : "."),
    ),
  );
  held.parts.forEach((part, i) => body.append(partRow(part, i)));

  const read = held.answers.filter((a): a is SheetConversion => a !== null);
  if (read.length === 0) return;
  const joined = joinConversions(read);
  if (joined.tooBig) {
    body.append(note("The AI said a part was too big to answer in full. Split the file into smaller ones and read each."));
  }
  body.append(text("h4", "What was read"), summary(joined));
  body.append(text("h4", "Check it a second time"));
  body.append(
    note(
      "A separate request works each part's totals out from the sheet again and compares them with the lines. " +
        "Starting from the sheet, not from the first answer, it catches what the first got wrong.",
    ),
  );
  held.parts.forEach((part, i) => {
    const row = checkRow(part, i);
    if (row !== null) body.append(row);
  });
  if (read.length === held.parts.length && !joined.tooBig && joined.lines.length > 0) body.append(keep(joined));
  else if (read.length < held.parts.length) body.append(note(`${held.parts.length - read.length} part(s) still to read before the lines can be kept.`));
}

/** Once, when the app starts: whether a key of the books' own can be asked from here. */
export function wireSheetAi(): void {
  renderSheetAi();
  if (aiRoute() !== "folder") return;
  void aiStatus().then((status) => {
    keyHere = status?.configured === true;
    renderSheetAi();
  });
}
