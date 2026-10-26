import { redraw } from "../app.js";
import { postedJournals, record } from "../books.js";
import { booksMoney } from "../country.js";
import { $, state } from "../state.js";
import { save } from "../store.js";
import { askOnPage, askTextOnPage, note, tellOnPage } from "../ui.js";
import { taxYearEnd, taxYearOf, taxYearStart } from "../tax-year.js";
import { jobLabel, jobProfits } from "@nzosa/core";
import type { Job, JobsHeld } from "@nzosa/core";
import { sources } from "./classes-page.js";

/**
 * Jobs: work done for a customer, and what it made. Each job belongs to a
 * customer; invoices, bills, bank lines and journals are given to it, and its
 * profit is what they post to income less what they post to costs. Giving a
 * job posts nothing.
 */

/** "all" for every year, or a year. */
let span: "all" | number = "all";
/** The job whose work is listed below the table, or "". */
let open = "";
let query = "";
let showClosed = false;

/** Rows drawn at once: a year of bank lines is thousands. */
const SHOWN = 300;

export const heldJobs = (): JobsHeld => state.ledger.jobs ?? { jobs: [], assigned: {} };

/** Jobs, whole, as one change on History. */
export async function keepJobs(next: JobsHeld, what: string): Promise<void> {
  const before = heldJobs();
  state.ledger = { ...state.ledger, jobs: next };
  state.persistent = await save(state.ledger);
  await record("jobs", what, before, next);
  redraw("jobs");
}

/** Which side of a profit an account is on, from its type. */
export function profitSide(): (code: string) => "income" | "cost" | null {
  const income = /revenue|income|sales/i;
  const cost = /expense|overhead|direct|cost/i;
  const sides = new Map<string, "income" | "cost">();
  for (const a of state.chart) {
    if (income.test(a.type)) sides.set(a.code.trim(), "income");
    else if (cost.test(a.type)) sides.set(a.code.trim(), "cost");
  }
  return (code) => sides.get(code) ?? null;
}

/** The open jobs, this customer's first, for a document's Job box. */
export function jobChoices(customer: string): Job[] {
  const who = customer.trim().toLowerCase();
  return heldJobs()
    .jobs.filter((j) => j.closed !== true)
    .sort((a, b) => {
      const mineA = a.customer.trim().toLowerCase() === who ? 0 : 1;
      const mineB = b.customer.trim().toLowerCase() === who ? 0 : 1;
      return mineA - mineB || jobLabel(a).localeCompare(jobLabel(b));
    });
}

/** Give a document (by its number) to a job, or take it off one; renumbered, it keeps it. */
export async function giveDocument(number: string, jobId: string, was?: string): Promise<void> {
  const held = heldJobs();
  const current = held.assigned[was ?? number] ?? "";
  if (current === jobId && (was === undefined || was === number)) return;
  const assigned = { ...held.assigned };
  if (was !== undefined) delete assigned[was];
  delete assigned[number];
  if (jobId !== "") assigned[number] = jobId;
  const job = held.jobs.find((j) => j.id === jobId);
  await keepJobs({ ...held, assigned }, job === undefined ? `${number} taken off its job` : `${number} given to ${jobLabel(job)}`);
}

function addSection(body: HTMLElement): void {
  const held = heldJobs();
  const row = document.createElement("div");
  row.className = "contacts-controls";
  const name = document.createElement("input");
  name.type = "text";
  name.placeholder = "A new job, such as Deck at 12 Kowhai Rd";
  const customer = document.createElement("input");
  customer.type = "text";
  customer.placeholder = "Whose: the customer";
  const list = document.createElement("datalist");
  list.id = "jobs-customers";
  const names = new Set<string>();
  for (const c of state.ledger.contacts ?? []) if (c.active !== false && c.kind !== "vendor") names.add(c.name);
  for (const i of state.ledger.invoices ?? []) if (i.kind === "sales" && i.contact.trim() !== "") names.add(i.contact.trim());
  for (const n of [...names].sort((a, b) => a.localeCompare(b))) {
    const option = document.createElement("option");
    option.value = n;
    list.append(option);
  }
  customer.setAttribute("list", list.id);
  const add = document.createElement("button");
  add.type = "button";
  add.className = "primary";
  add.textContent = "Add job";
  add.addEventListener("click", async () => {
    const said = name.value.trim();
    if (said === "") return;
    const whose = customer.value.trim();
    if (held.jobs.some((j) => j.name.toLowerCase() === said.toLowerCase() && j.customer.toLowerCase() === whose.toLowerCase())) {
      await tellOnPage(`${whose === "" ? said : `${said} for ${whose}`} is already a job.`);
      return;
    }
    const job: Job = {
      id: `job${Date.now().toString(36)}`,
      name: said,
      customer: whose,
      started: new Date().toLocaleDateString("en-CA"),
    };
    open = job.id;
    void keepJobs({ ...held, jobs: [...held.jobs, job] }, `Added job ${jobLabel(job)}`);
  });
  for (const input of [name, customer]) {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") add.click();
    });
  }
  row.append(name, customer, list, add);
  body.append(row);
}

function profitTable(body: HTMLElement): void {
  const held = heldJobs();
  const range = span === "all" ? undefined : { from: taxYearStart(span), to: taxYearEnd(span) };
  const profits = jobProfits(postedJournals(), held, profitSide(), range).filter(
    (p) => showClosed || p.job.closed !== true || p.job.id === open,
  );
  const table = document.createElement("table");
  table.className = "report-table owner-table jobs-table";
  table.innerHTML =
    "<thead><tr><th>Job</th><th>Customer</th><th>Income</th><th>Costs</th><th>Profit</th><th>Margin</th><th>Given</th><th></th></tr></thead>";
  const tbody = document.createElement("tbody");
  const totals = { income: 0, costs: 0 };
  for (const p of profits.sort((a, b) => a.job.name.localeCompare(b.job.name))) {
    totals.income += p.income;
    totals.costs += p.costs;
    const tr = document.createElement("tr");
    if (p.job.closed === true) tr.classList.add("job-closed");
    if (p.job.id === open) tr.classList.add("job-open");
    const cell = (text: string, cls: string): void => {
      const td = document.createElement("td");
      td.className = cls;
      td.textContent = text;
      tr.append(td);
    };
    cell(p.job.name + (p.job.closed === true ? " (finished)" : ""), "report-name");
    cell(p.job.customer, "report-name");
    cell(booksMoney(p.income), "report-amount");
    cell(booksMoney(p.costs), "report-amount");
    cell(booksMoney(p.profit), `report-amount${p.profit < 0 ? " match-off" : ""}`);
    cell(p.margin === null ? "" : `${Math.round(p.margin * 100)}%`, "report-amount");
    cell(String(p.sources), "report-amount");
    const actions = document.createElement("td");
    const button = (label: string, act: () => void): void => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "small";
      b.textContent = label;
      b.addEventListener("click", act);
      actions.append(b, " ");
    };
    button(open === p.job.id ? "Hide work" : "Work", () => {
      open = open === p.job.id ? "" : p.job.id;
      redraw("jobs");
    });
    button("Rename", async () => {
      const next = (await askTextOnPage(`Rename ${p.job.name} to`, p.job.name))?.trim();
      if (next === undefined || next === "" || next === p.job.name) return;
      void keepJobs(
        { ...held, jobs: held.jobs.map((j) => (j.id === p.job.id ? { ...j, name: next } : j)) },
        `Renamed job ${p.job.name} to ${next}`,
      );
    });
    button(p.job.closed === true ? "Reopen" : "Finished", () => {
      void keepJobs(
        {
          ...held,
          jobs: held.jobs.map((j) => {
            if (j.id !== p.job.id) return j;
            const { closed: _was, ...rest } = j;
            return p.job.closed === true ? rest : { ...rest, closed: true };
          }),
        },
        `${jobLabel(p.job)} ${p.job.closed === true ? "reopened" : "finished"}`,
      );
    });
    button("Remove", async () => {
      const given = Object.values(held.assigned).filter((id) => id === p.job.id).length;
      if (!await askOnPage(`Remove ${jobLabel(p.job)}?${given > 0 ? ` The ${given} given to it go back to no job.` : ""}`)) return;
      const assigned = Object.fromEntries(Object.entries(held.assigned).filter(([, id]) => id !== p.job.id));
      if (open === p.job.id) open = "";
      void keepJobs({ jobs: held.jobs.filter((j) => j.id !== p.job.id), assigned }, `Removed job ${jobLabel(p.job)}`);
    });
    tr.append(actions);
    tbody.append(tr);
  }
  const total = document.createElement("tr");
  total.className = "report-total";
  for (const [text, cls] of [
    ["Total", "report-name"],
    ["", "report-name"],
    [booksMoney(totals.income), "report-amount"],
    [booksMoney(totals.costs), "report-amount"],
    [booksMoney(totals.income - totals.costs), "report-amount"],
    [totals.income === 0 ? "" : `${Math.round(((totals.income - totals.costs) / totals.income) * 100)}%`, "report-amount"],
    ["", ""],
    ["", ""],
  ] as const) {
    const td = document.createElement("td");
    td.className = cls;
    td.textContent = text;
    total.append(td);
  }
  tbody.append(total);
  table.append(tbody);
  const scroller = document.createElement("div");
  scroller.className = "table-scroll";
  scroller.append(table);
  body.append(scroller);
}

/** The work of the job opened: what is given to it, and what could be. */
function workSection(body: HTMLElement, job: Job): void {
  const held = heldJobs();
  const heading = document.createElement("h3");
  heading.textContent = `Work for ${jobLabel(job)}`;
  body.append(heading);

  const range = span === "all" ? { from: "0000-01-01", to: "9999-12-31" } : { from: taxYearStart(span), to: taxYearEnd(span) };
  const controls = document.createElement("div");
  controls.className = "contacts-controls";
  const search = document.createElement("input");
  search.type = "search";
  search.id = "jobs-search";
  search.placeholder =
    span === "all" ? "Search for its invoices, bills and bank lines" : `Search ${range.from} to ${range.to} for its invoices, bills and bank lines`;
  search.value = query;
  search.addEventListener("input", () => {
    query = search.value;
    redraw("jobs");
    document.getElementById("jobs-search")?.focus();
  });
  controls.append(search);
  body.append(controls);

  // What is given to this job, and -- searched for -- what is not given to any.
  const needle = query.trim().toLowerCase();
  const all = sources(range.from, range.to);
  const given = all.filter((s) => held.assigned[s.id] === job.id);
  const free = needle === "" ? [] : all.filter(
    (s) => held.assigned[s.id] === undefined && [s.id, s.narration, ...s.accounts].some((t) => t.toLowerCase().includes(needle)),
  );
  const rows = [...given, ...free];
  if (rows.length === 0) {
    body.append(
      note(
        "Nothing given to this job in the year yet. Search above for its invoices, bills and bank lines, " +
          "or choose the job on an invoice or bill when you write it.",
      ),
    );
    return;
  }
  if (free.length > 1) {
    const all = document.createElement("button");
    all.type = "button";
    all.textContent = `Give all ${free.length} found to this job`;
    all.addEventListener("click", () => {
      const assigned = { ...held.assigned };
      for (const s of free) assigned[s.id] = job.id;
      void keepJobs({ ...held, assigned }, `${free.length} given to ${jobLabel(job)}`);
    });
    body.append(all);
  }
  const table = document.createElement("table");
  table.className = "report-table owner-table";
  table.innerHTML = "<thead><tr><th>Date</th><th>Description</th><th>Coded to</th><th>Income less expense</th><th></th></tr></thead>";
  const tbody = document.createElement("tbody");
  for (const source of rows.slice(0, SHOWN)) {
    const tr = document.createElement("tr");
    for (const [text, cls] of [
      [source.date, "report-name"],
      [source.narration || source.id, "report-name"],
      [source.accounts.join(", "), "report-name"],
      [booksMoney(source.net), "report-amount"],
    ] as const) {
      const td = document.createElement("td");
      td.className = cls;
      td.textContent = text;
      tr.append(td);
    }
    const cell = document.createElement("td");
    const mine = held.assigned[source.id] === job.id;
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "small";
    toggle.textContent = mine ? "Take off" : "Give to this job";
    toggle.addEventListener("click", () => {
      const assigned = { ...held.assigned };
      if (mine) delete assigned[source.id];
      else assigned[source.id] = job.id;
      void keepJobs(
        { ...held, assigned },
        mine ? `${source.narration || source.id} taken off ${jobLabel(job)}` : `${source.narration || source.id} given to ${jobLabel(job)}`,
      );
    });
    cell.append(toggle);
    tr.append(cell);
    tbody.append(tr);
  }
  table.append(tbody);
  const scroller = document.createElement("div");
  scroller.className = "table-scroll";
  scroller.append(table);
  body.append(scroller);
}

export function renderJobs(): void {
  const body = $("jobs-body");
  body.textContent = "";
  addSection(body);
  const held = heldJobs();
  if (held.jobs.length === 0) {
    body.append(note("Add a job, then give it the invoices, bills and bank lines that belong to it."));
    return;
  }

  const controls = document.createElement("div");
  controls.className = "contacts-controls";
  const pick = document.createElement("select");
  const thisYear = taxYearOf(new Date().toLocaleDateString("en-CA"));
  for (const [value, text] of [
    ["all", "Since each job began"],
    ...[thisYear, thisYear - 1, thisYear - 2].map((y) => [String(y), `${taxYearStart(y)} to ${taxYearEnd(y)}`]),
  ] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    option.selected = String(span) === value;
    pick.append(option);
  }
  pick.addEventListener("change", () => {
    span = pick.value === "all" ? "all" : Number(pick.value);
    redraw("jobs");
  });
  const closed = document.createElement("label");
  closed.className = "checkbox";
  const tick = document.createElement("input");
  tick.type = "checkbox";
  tick.checked = showClosed;
  tick.addEventListener("change", () => {
    showClosed = tick.checked;
    redraw("jobs");
  });
  closed.append(tick, " Show finished jobs");
  controls.append(pick, closed);
  body.append(controls);

  profitTable(body);
  const job = held.jobs.find((j) => j.id === open);
  if (job !== undefined) workSection(body, job);
}
