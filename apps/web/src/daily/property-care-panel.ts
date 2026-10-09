import { record } from "../books.js";
import { state } from "../state.js";
import { savePart } from "../store.js";
import { note } from "../ui.js";
import { completeTask, taskOpen } from "@nzosa/core";
import type { CareRepeat, CareTask, IsoDate, PropertyCare } from "@nzosa/core";
import { booksLocale } from "../country.js";

/**
 * A rental property's jobs and issues outstanding, and its Healthy Homes and
 * insurance ticks, under the property on the Tenancies page. Beside the books,
 * like the tenancies: nothing here posts.
 */

const REPEATS: readonly [CareRepeat | "", string][] = [
  ["", "Once"],
  ["monthly", "Monthly"],
  ["quarterly", "Every 3 months"],
  ["six-monthly", "Every 6 months"],
  ["yearly", "Yearly"],
];

function today(): IsoDate {
  return new Date().toISOString().slice(0, 10);
}

function said(date: IsoDate | undefined): string {
  return date === undefined ? "" : new Date(`${date}T00:00:00`).toLocaleDateString(booksLocale());
}

function careOf(entityId: string): PropertyCare {
  return state.ledger.propertyCare?.[entityId] ?? { tasks: [] };
}

async function saveCare(entityId: string, next: PropertyCare, what: string, rerender: () => void): Promise<void> {
  const before = state.ledger.propertyCare ?? {};
  const after = { ...before, [entityId]: next };
  state.ledger = { ...state.ledger, propertyCare: after };
  state.persistent = await savePart(state.ledger);
  await record("propertyCare", what, before, after);
  rerender();
}

function tick(
  label: string,
  held: { current: boolean; checked?: IsoDate | undefined } | undefined,
  change: (value: { current: boolean; checked: IsoDate }) => void,
): HTMLElement {
  const wrap = document.createElement("label");
  wrap.className = "feed-auto";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = held?.current === true;
  box.addEventListener("change", () => change({ current: box.checked, checked: today() }));
  wrap.append(box, ` ${label}`);
  if (held?.checked !== undefined) {
    const when = document.createElement("span");
    when.className = "rental-year-meta";
    when.textContent = ` ${held.current ? "ticked" : "unticked"} ${said(held.checked)}`;
    wrap.append(when);
  }
  return wrap;
}

function repeatSelect(value: CareRepeat | undefined): HTMLSelectElement {
  const select = document.createElement("select");
  for (const [code, caption] of REPEATS) {
    const option = document.createElement("option");
    option.value = code;
    option.textContent = caption;
    option.selected = (value ?? "") === code;
    select.append(option);
  }
  return select;
}

export function propertyCarePanel(entityId: string, rerender: () => void): HTMLElement {
  const box = document.createElement("div");
  box.className = "property-care";
  const care = careOf(entityId);
  const save = (next: PropertyCare, what: string): void => void saveCare(entityId, next, what, rerender);

  const ticks = document.createElement("div");
  ticks.className = "property-care-ticks";
  ticks.append(
    tick("Healthy Homes current", care.healthyHomes, (value) =>
      save({ ...care, healthyHomes: value }, `Healthy Homes ${value.current ? "ticked" : "unticked"}`),
    ),
    tick("Insurance provided", care.insured, (value) =>
      save({ ...care, insured: value }, `Insurance ${value.current ? "ticked" : "unticked"}`),
    ),
  );
  box.append(ticks);

  const heading = document.createElement("h4");
  heading.textContent = "Maintenance & issues outstanding";
  box.append(heading);

  const now = today();
  const open = care.tasks
    .filter(taskOpen)
    .sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999") || a.what.localeCompare(b.what));
  const finished = care.tasks.filter((t) => !taskOpen(t)).sort((a, b) => (b.done ?? "").localeCompare(a.done ?? ""));

  const replace = (task: CareTask, next: CareTask | null, what: string): void => {
    const tasks = care.tasks.flatMap((t) => (t.id !== task.id ? [t] : next === null ? [] : [next]));
    save({ ...care, tasks }, what);
  };

  const table = document.createElement("table");
  table.className = "report-table property-care-table";
  table.innerHTML = "<thead><tr><th>Done</th><th>What</th><th>Due</th><th>Repeats</th><th></th></tr></thead>";
  const rows = document.createElement("tbody");
  for (const task of open) {
    const tr = document.createElement("tr");
    if (task.due !== undefined && task.due < now) tr.className = "property-care-overdue";
    const doneCell = document.createElement("td");
    const done = document.createElement("input");
    done.type = "checkbox";
    done.title = task.repeat ? "Done: moves it on to the next time it is due" : "Done";
    done.addEventListener("change", () => replace(task, completeTask(task, now), `Done: ${task.what}`));
    doneCell.append(done);

    const whatCell = document.createElement("td");
    const what = document.createElement("input");
    what.type = "text";
    what.value = task.what;
    what.addEventListener("change", () => {
      if (what.value.trim() !== "") replace(task, { ...task, what: what.value.trim() }, `Job: ${what.value.trim()}`);
    });
    whatCell.append(what);
    if (task.repeat !== undefined && task.done !== undefined) {
      const last = document.createElement("span");
      last.className = "rental-year-meta";
      last.textContent = ` last done ${said(task.done)}`;
      whatCell.append(last);
    }

    const dueCell = document.createElement("td");
    const due = document.createElement("input");
    due.type = "date";
    due.value = task.due ?? "";
    due.addEventListener("change", () => {
      const { due: _old, ...rest } = task;
      replace(task, due.value === "" ? rest : { ...rest, due: due.value }, `Due date: ${task.what}`);
    });
    dueCell.append(due);

    const repeatCell = document.createElement("td");
    const repeat = repeatSelect(task.repeat);
    repeat.addEventListener("change", () => {
      const { repeat: _old, ...rest } = task;
      replace(task, repeat.value === "" ? rest : { ...rest, repeat: repeat.value as CareRepeat }, `Repeats: ${task.what}`);
    });
    repeatCell.append(repeat);

    const dropCell = document.createElement("td");
    const drop = document.createElement("button");
    drop.type = "button";
    drop.className = "link-button";
    drop.textContent = "✕";
    drop.title = "Remove this job";
    drop.addEventListener("click", () => {
      if (confirm(`Remove "${task.what}"?`)) replace(task, null, `Removed: ${task.what}`);
    });
    dropCell.append(drop);

    tr.append(doneCell, whatCell, dueCell, repeatCell, dropCell);
    rows.append(tr);
  }

  // The row to add one.
  const addRow = document.createElement("tr");
  const what = document.createElement("input");
  what.type = "text";
  what.placeholder = "e.g. Heat pump service";
  const due = document.createElement("input");
  due.type = "date";
  const repeat = repeatSelect(undefined);
  const add = document.createElement("button");
  add.type = "button";
  add.textContent = "Add";
  const addIt = (): void => {
    if (what.value.trim() === "") return;
    const task: CareTask = {
      id: `c${Date.now().toString(36)}`,
      what: what.value.trim(),
      ...(due.value !== "" ? { due: due.value } : {}),
      ...(repeat.value !== "" ? { repeat: repeat.value as CareRepeat } : {}),
    };
    save({ ...care, tasks: [...care.tasks, task] }, `Job added: ${task.what}`);
  };
  add.addEventListener("click", addIt);
  what.addEventListener("keydown", (event) => {
    if (event.key === "Enter") addIt();
  });
  const cells = [document.createElement("td"), document.createElement("td"), document.createElement("td"), document.createElement("td"), document.createElement("td")];
  cells[1]!.append(what);
  cells[2]!.append(due);
  cells[3]!.append(repeat);
  cells[4]!.append(add);
  addRow.append(...cells);
  rows.append(addRow);
  table.append(rows);
  const scroll = document.createElement("div");
  scroll.className = "table-scroll";
  scroll.append(table);
  box.append(scroll);
  if (open.length === 0) box.append(note("Nothing outstanding. Add a job or issue above; one that repeats, like a yearly service, moves on to its next date when ticked."));

  if (finished.length > 0) {
    const fold = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = `Done (${finished.length})`;
    fold.append(summary);
    const list = document.createElement("ul");
    for (const task of finished) {
      const item = document.createElement("li");
      item.append(`${task.what}, done ${said(task.done)} `);
      const undo = document.createElement("button");
      undo.type = "button";
      undo.className = "link-button";
      undo.textContent = "not done";
      undo.addEventListener("click", () => {
        const { done: _old, ...rest } = task;
        replace(task, rest, `Not done: ${task.what}`);
      });
      item.append(undo);
      list.append(item);
    }
    fold.append(list);
    box.append(fold);
  }
  return box;
}
