import { redraw } from "../app.js";
import { postedJournals, record } from "../books.js";
import { booksMoney } from "../country.js";
import { $, state } from "../state.js";
import { savePart } from "../store.js";
import { note } from "../ui.js";
import { taxYearEnd, taxYearOf, taxYearStart } from "../tax-year.js";
import { classSource } from "@nzosa/core";

/**
 * Classes: names, and which bank lines, invoices and journals each is given
 * to. Giving a class posts nothing; the Profit and loss by class report reads
 * it.
 */

type Held = { names: string[]; assigned: Record<string, string> };

let year: number | null = null;
/** "" for what has no class, "*" for everything, or a class's name. */
let showing = "";
let query = "";

/** Rows drawn at once: a year of bank lines is thousands. */
const SHOWN = 300;

const held = (): Held => state.ledger.classes ?? { names: [], assigned: {} };

async function keep(next: Held, what: string): Promise<void> {
  const before = held();
  state.ledger = { ...state.ledger, classes: next };
  state.persistent = await savePart(state.ledger);
  await record("classes", what, before, next);
  redraw("classes");
}

interface Source {
  id: string;
  date: string;
  narration: string;
  /** Income less expense the source posts. */
  net: number;
  /** The income and expense accounts it posts to. */
  accounts: string[];
}

/** Everything in the year that posts to income or expense, one row a source. */
function sources(from: string, to: string): Source[] {
  const incomeOrCost = /revenue|income|sales|expense|overhead|direct|cost/i;
  const names = new Map(
    state.chart.filter((a) => incomeOrCost.test(a.type)).map((a) => [a.code.trim(), `${a.code} ${a.name}`.trim()]),
  );
  const out = new Map<string, Source>();
  for (const journal of postedJournals()) {
    if (journal.date < from || journal.date > to) continue;
    let net = 0;
    const touched: string[] = [];
    for (const line of journal.lines) {
      const name = names.get(line.accountCode.trim());
      if (name === undefined) continue;
      if (!touched.includes(name)) touched.push(name);
      net -= line.amount;
    }
    if (touched.length === 0) continue;
    const id = classSource(journal);
    const one = out.get(id) ?? { id, date: journal.date, narration: journal.narration, net: 0, accounts: [] };
    one.net += net;
    for (const name of touched) if (!one.accounts.includes(name)) one.accounts.push(name);
    out.set(id, one);
  }
  return [...out.values()].sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : b.date.localeCompare(a.date)));
}

function select(names: readonly string[], chosen: string, blank: string): HTMLSelectElement {
  const box = document.createElement("select");
  for (const [value, text] of [["", blank], ...names.map((n) => [n, n])] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    option.selected = value === chosen;
    box.append(option);
  }
  return box;
}

function namesSection(body: HTMLElement): void {
  const { names, assigned } = held();
  const row = document.createElement("div");
  row.className = "contacts-controls";
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "A new class, such as Tours or Shop";
  const add = document.createElement("button");
  add.type = "button";
  add.className = "primary";
  add.textContent = "Add class";
  const problem = document.createElement("p");
  problem.className = "cloud-said";
  add.addEventListener("click", () => {
    const said = input.value.trim();
    if (said === "") return;
    if (names.some((n) => n.toLowerCase() === said.toLowerCase())) {
      problem.textContent = `${said} is already a class.`;
      return;
    }
    void keep({ names: [...names, said].sort((a, b) => a.localeCompare(b)), assigned }, `Added class ${said}`);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") add.click();
  });
  row.append(input, add);
  body.append(row, problem);
  if (names.length === 0) return;

  const counts = new Map<string, number>();
  for (const name of Object.values(assigned)) counts.set(name, (counts.get(name) ?? 0) + 1);
  const list = document.createElement("table");
  list.className = "report-table owner-table";
  list.innerHTML = "<thead><tr><th>Class</th><th>Given to</th><th></th></tr></thead>";
  const tbody = document.createElement("tbody");
  for (const name of names) {
    const tr = document.createElement("tr");
    const label = document.createElement("td");
    label.className = "report-name";
    label.textContent = name;
    const used = document.createElement("td");
    used.className = "report-amount";
    used.textContent = String(counts.get(name) ?? 0);
    const actions = document.createElement("td");
    const rename = document.createElement("button");
    rename.type = "button";
    rename.className = "small";
    rename.textContent = "Rename";
    rename.addEventListener("click", () => {
      const next = window.prompt(`Rename ${name} to`, name)?.trim();
      if (next === undefined || next === "" || next === name) return;
      if (names.some((n) => n !== name && n.toLowerCase() === next.toLowerCase())) {
        window.alert(`${next} is already a class.`);
        return;
      }
      const moved = Object.fromEntries(Object.entries(assigned).map(([id, n]) => [id, n === name ? next : n]));
      void keep(
        { names: names.map((n) => (n === name ? next : n)).sort((a, b) => a.localeCompare(b)), assigned: moved },
        `Renamed class ${name} to ${next}`,
      );
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "small";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      const n = counts.get(name) ?? 0;
      if (n > 0 && !window.confirm(`Remove ${name}? The ${n} it is given to go back to having no class.`)) return;
      const left = Object.fromEntries(Object.entries(assigned).filter(([, c]) => c !== name));
      void keep({ names: names.filter((c) => c !== name), assigned: left }, `Removed class ${name}`);
    });
    actions.append(rename, remove);
    tr.append(label, used, actions);
    tbody.append(tr);
  }
  list.append(tbody);
  body.append(list);
}

export function renderClasses(): void {
  const body = $("classes-body");
  body.textContent = "";
  namesSection(body);
  const { names, assigned } = held();
  if (names.length === 0) {
    body.append(note("Add a class first, then give it to bank lines, invoices and journals below."));
    return;
  }

  const thisYear = taxYearOf(new Date().toISOString().slice(0, 10));
  if (year === null) year = thisYear;
  const controls = document.createElement("div");
  controls.className = "contacts-controls";
  const pickYear = document.createElement("select");
  for (const y of [thisYear - 2, thisYear - 1, thisYear]) {
    const option = document.createElement("option");
    option.value = String(y);
    option.textContent = `${taxYearStart(y)} to ${taxYearEnd(y)}`;
    option.selected = y === year;
    pickYear.append(option);
  }
  pickYear.addEventListener("change", () => {
    year = Number(pickYear.value);
    redraw("classes");
  });
  const pickShown = select(names, showing, "No class yet");
  const every = document.createElement("option");
  every.value = "*";
  every.textContent = "Everything";
  every.selected = showing === "*";
  pickShown.insertBefore(every, pickShown.firstChild);
  pickShown.addEventListener("change", () => {
    showing = pickShown.value;
    redraw("classes");
  });
  const search = document.createElement("input");
  search.type = "search";
  search.id = "classes-search";
  search.placeholder = "Search the description or account";
  search.value = query;
  search.addEventListener("input", () => {
    query = search.value;
    redraw("classes");
    document.getElementById("classes-search")?.focus();
  });
  controls.append(pickYear, pickShown, search);
  body.append(controls);

  const needle = query.trim().toLowerCase();
  const all = sources(taxYearStart(year), taxYearEnd(year));
  const shown = all.filter(
    (s) =>
      (showing === "*" || (assigned[s.id] ?? "") === showing) &&
      (needle === "" || [s.narration, ...s.accounts].some((text) => text.toLowerCase().includes(needle))),
  );
  if (shown.length === 0) {
    body.append(note(all.length === 0 ? "Nothing posted to income or expense in this year." : "Nothing here."));
    return;
  }

  // One class to everything listed: a search for a supplier, then one choice.
  const bulk = document.createElement("div");
  bulk.className = "contacts-controls";
  const bulkPick = select(names, "", "Choose a class");
  const bulkGo = document.createElement("button");
  bulkGo.type = "button";
  bulkGo.textContent = `Give it to all ${shown.length} listed`;
  bulkGo.addEventListener("click", () => {
    if (bulkPick.value === "") return;
    const next = { ...assigned };
    for (const s of shown) next[s.id] = bulkPick.value;
    void keep({ names, assigned: next }, `Class ${bulkPick.value} given to ${shown.length}`);
  });
  bulk.append(bulkPick, bulkGo);
  body.append(bulk);

  const table = document.createElement("table");
  table.className = "report-table owner-table";
  table.innerHTML = "<thead><tr><th>Date</th><th>Description</th><th>Coded to</th><th>Income less expense</th><th>Class</th></tr></thead>";
  const tbody = document.createElement("tbody");
  for (const source of shown.slice(0, SHOWN)) {
    const tr = document.createElement("tr");
    for (const [text, cls] of [
      [source.date, "report-name"],
      [source.narration, "report-name"],
      [source.accounts.join(", "), "report-name"],
      [booksMoney(source.net), "report-amount"],
    ] as const) {
      const td = document.createElement("td");
      td.className = cls;
      td.textContent = text;
      tr.append(td);
    }
    const cell = document.createElement("td");
    const pick = select(names, assigned[source.id] ?? "", "No class");
    pick.addEventListener("change", () => {
      const next = { ...assigned };
      if (pick.value === "") delete next[source.id];
      else next[source.id] = pick.value;
      void keep(
        { names, assigned: next },
        pick.value === "" ? `Class taken off ${source.narration}` : `Class ${pick.value} given to ${source.narration}`,
      );
    });
    cell.append(pick);
    tr.append(cell);
    tbody.append(tr);
  }
  table.append(tbody);
  const scroller = document.createElement("div");
  scroller.className = "table-scroll";
  scroller.append(table);
  body.append(scroller);
  if (shown.length > SHOWN) {
    body.append(note(`The ${SHOWN} most recent of ${shown.length} are shown. Search to find the rest.`));
  }
}
