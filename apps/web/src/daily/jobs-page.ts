import { redraw } from "../app.js";
import { postedJournals, record } from "../books.js";
import { booksCurrency, booksMoney } from "../country.js";
import { $, state } from "../state.js";
import { savePart } from "../store.js";
import { askOnPage, askTextOnPage, download, note, tellOnPage } from "../ui.js";
import { classSource, jobProfitability, parseAmount, spreadsheetCell } from "@nzosa/core";
import type { AccountKind, Job, JobsHeld } from "@nzosa/core";

/**
 * Jobs: each job's customer, whether it is still going, and what it earned
 * and cost over its whole life; then which bank lines, invoices, bills and
 * journals belong to it. Giving a job posts nothing; the Profit and loss by
 * job report reads it too.
 */

/** The job whose postings are being given out, or "" for none chosen. */
let focus = "";
/** "" for what is no job's, "*" for everything, or a job's id. */
let showing = "";
let query = "";
const SHOWN = 300;

const held = (): JobsHeld => state.ledger.jobs ?? { jobs: [], assigned: {} };

async function keep(next: JobsHeld, what: string): Promise<void> {
  const before = held();
  state.ledger = { ...state.ledger, jobs: next };
  state.persistent = await savePart(state.ledger);
  await record("jobs", what, before, next);
  redraw("jobs");
}

/** What kind of profit-and-loss account a code is, from the chart. */
function kindOfAccount(): AccountKind {
  const kinds = new Map<string, "income" | "direct" | "expense">();
  for (const a of state.chart) {
    const t = a.type.toLowerCase();
    const kind = /revenue|income|sales/.test(t) ? "income" : /direct|cost of/.test(t) ? "direct" : /expense|overhead/.test(t) ? "expense" : null;
    if (kind !== null) kinds.set(a.code.trim(), kind);
  }
  return (code) => kinds.get(code) ?? null;
}

interface Source {
  id: string;
  date: string;
  narration: string;
  net: number;
  accounts: string[];
}

/** Everything that posts to income or expense, one row a source, newest first. */
function sources(): Source[] {
  const kindOf = kindOfAccount();
  const names = new Map(state.chart.map((a) => [a.code.trim(), `${a.code} ${a.name}`.trim()]));
  const out = new Map<string, Source>();
  for (const journal of postedJournals()) {
    let net = 0;
    const touched: string[] = [];
    for (const line of journal.lines) {
      const code = line.accountCode.trim();
      if (kindOf(code) === null) continue;
      const name = names.get(code) ?? code;
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

/** Customers, from contacts and from the invoices: who a job can be for. */
function customers(): string[] {
  const names = new Set<string>();
  for (const c of state.ledger.contacts ?? []) if (c.kind !== "vendor") names.add(c.name.trim());
  for (const i of state.ledger.invoices ?? []) if (i.kind === "sales") names.add(i.contact.trim());
  return [...names].filter((n) => n !== "").sort((a, b) => a.localeCompare(b));
}

function select(options: readonly (readonly [string, string])[], chosen: string): HTMLSelectElement {
  const box = document.createElement("select");
  for (const [value, text] of options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    option.selected = value === chosen;
    box.append(option);
  }
  return box;
}

function addForm(body: HTMLElement): void {
  const { jobs, assigned } = held();
  const row = document.createElement("div");
  row.className = "contacts-controls";
  const name = document.createElement("input");
  name.type = "text";
  name.placeholder = "A new job, such as Deck for the Smiths";
  const customer = document.createElement("input");
  customer.type = "text";
  customer.placeholder = "Customer";
  customer.setAttribute("list", "jobs-customers");
  const list = document.createElement("datalist");
  list.id = "jobs-customers";
  for (const c of customers()) {
    const option = document.createElement("option");
    option.value = c;
    list.append(option);
  }
  const quoted = document.createElement("input");
  quoted.type = "text";
  quoted.inputMode = "decimal";
  quoted.placeholder = "Quoted (optional)";
  quoted.size = 12;
  const add = document.createElement("button");
  add.type = "button";
  add.className = "primary";
  add.textContent = "Add job";
  const problem = document.createElement("p");
  problem.className = "cloud-said";
  add.addEventListener("click", () => {
    const said = name.value.trim();
    if (said === "") return;
    if (jobs.some((j) => j.name.toLowerCase() === said.toLowerCase())) {
      problem.textContent = `${said} is already a job.`;
      return;
    }
    const cents = quoted.value.trim() === "" ? undefined : parseAmount(quoted.value, booksCurrency());
    if (cents === null) {
      problem.textContent = "The quote is not an amount.";
      return;
    }
    const job: Job = {
      id: `job-${Date.now().toString(36)}`,
      name: said,
      customer: customer.value.trim(),
      status: "open",
      started: new Date().toLocaleDateString("en-CA"),
      ...(cents !== undefined ? { quoted: cents } : {}),
    };
    focus = job.id;
    showing = "";
    query = job.customer;
    void keep({ jobs: [...jobs, job], assigned }, `Added job ${said}`);
  });
  row.append(name, customer, list, quoted, add);
  body.append(row, problem);
}

function percent(n: number | null): string {
  return n === null ? "" : `${n}%`;
}

function profitTable(body: HTMLElement): void {
  const h = held();
  if (h.jobs.length === 0) return;
  const results = jobProfitability(postedJournals(), h, kindOfAccount());
  const table = document.createElement("table");
  table.className = "report-table owner-table";
  table.innerHTML =
    "<thead><tr><th>Job</th><th>Customer</th><th>Income</th><th>Direct costs</th><th>Other costs</th><th>Profit</th><th>Margin</th><th>Of quote</th><th></th></tr></thead>";
  const tbody = document.createElement("tbody");
  for (const r of results) {
    const tr = document.createElement("tr");
    if (r.job.status === "closed") tr.className = "event-reverted";
    for (const [text, cls] of [
      [`${r.job.name}${r.job.status === "closed" ? " (finished)" : ""}`, "report-name"],
      [r.job.customer, "report-name"],
      [booksMoney(r.income), "report-amount"],
      [booksMoney(r.directCosts), "report-amount"],
      [booksMoney(r.otherCosts), "report-amount"],
      [booksMoney(r.profit), "report-amount"],
      [percent(r.margin), "report-amount"],
      [r.job.quoted === undefined ? "" : `${percent(r.ofQuote)} of ${booksMoney(r.job.quoted)}`, "report-amount"],
    ] as const) {
      const td = document.createElement("td");
      td.className = cls;
      td.textContent = text;
      tr.append(td);
    }
    const actions = document.createElement("td");
    const button = (label: string, act: () => void): void => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "small";
      b.textContent = label;
      b.addEventListener("click", act);
      actions.append(b, " ");
    };
    button("Give it postings", () => {
      focus = r.job.id;
      showing = "";
      query = r.job.customer;
      redraw("jobs");
      document.getElementById("jobs-assign")?.scrollIntoView({ block: "start" });
    });
    button(r.job.status === "open" ? "Finish" : "Reopen", () => {
      const status = r.job.status === "open" ? "closed" : "open";
      void keep(
        { ...h, jobs: h.jobs.map((j) => (j.id === r.job.id ? { ...j, status } : j)) },
        `${r.job.name} ${status === "closed" ? "finished" : "reopened"}`,
      );
    });
    button("Rename", () => {
      void (async () => {
        const next = (await askTextOnPage(`Rename ${r.job.name} to`, r.job.name))?.trim();
        if (next === undefined || next === "" || next === r.job.name) return;
        if (h.jobs.some((j) => j.id !== r.job.id && j.name.toLowerCase() === next.toLowerCase())) {
          await tellOnPage(`${next} is already a job.`);
          return;
        }
        void keep({ ...h, jobs: h.jobs.map((j) => (j.id === r.job.id ? { ...j, name: next } : j)) }, `Renamed job ${r.job.name} to ${next}`);
      })();
    });
    button("Remove", () => {
      void (async () => {
        if (r.sources > 0 && !(await askOnPage(`Remove ${r.job.name}? The ${r.sources} postings given to it go back to being no job's.`))) return;
        const assigned = Object.fromEntries(Object.entries(h.assigned).filter(([, id]) => id !== r.job.id));
        if (focus === r.job.id) focus = "";
        void keep({ jobs: h.jobs.filter((j) => j.id !== r.job.id), assigned }, `Removed job ${r.job.name}`);
      })();
    });
    tr.append(actions);
    tbody.append(tr);
  }
  table.append(tbody);
  const scroller = document.createElement("div");
  scroller.className = "table-scroll";
  scroller.append(table);
  const save = document.createElement("button");
  save.type = "button";
  save.textContent = "Download (CSV)";
  save.addEventListener("click", () => {
    const money = (c: number): string => (c / 100).toFixed(2);
    const rows = [
      ["Job", "Customer", "Status", "Income", "Direct costs", "Other costs", "Profit", "Margin %", "Quoted", "Of quote %", "First", "Last"],
      ...results.map((r) => [
        r.job.name,
        r.job.customer,
        r.job.status === "open" ? "Open" : "Finished",
        money(r.income),
        money(r.directCosts),
        money(r.otherCosts),
        money(r.profit),
        r.margin === null ? "" : String(r.margin),
        r.job.quoted === undefined ? "" : money(r.job.quoted),
        r.ofQuote === null ? "" : String(r.ofQuote),
        r.first ?? "",
        r.last ?? "",
      ]),
    ];
    download(rows.map((row) => row.map(spreadsheetCell).join(",")).join("\r\n") + "\r\n", "job-profitability.csv", "text/csv");
  });
  body.append(scroller, note("Over each job's whole life, not a year: income less what was spent on it. Margin is profit as a share of income."), save);
}

function assignSection(body: HTMLElement): void {
  const h = held();
  const open = h.jobs.filter((j) => j.status === "open" || j.id === focus);
  const heading = document.createElement("h3");
  heading.id = "jobs-assign";
  heading.textContent = "Giving postings to jobs";
  body.append(heading);
  const controls = document.createElement("div");
  controls.className = "contacts-controls";
  const pickShown = select(
    [
      ["", "No job yet"],
      ["*", "Everything"],
      ...h.jobs.map((j) => [j.id, j.name] as const),
    ],
    showing,
  );
  pickShown.addEventListener("change", () => {
    showing = pickShown.value;
    redraw("jobs");
  });
  const search = document.createElement("input");
  search.type = "search";
  search.id = "jobs-search";
  search.placeholder = "Search the description or account";
  search.value = query;
  search.addEventListener("input", () => {
    query = search.value;
    redraw("jobs");
    document.getElementById("jobs-search")?.focus();
  });
  controls.append(pickShown, search);
  body.append(controls);

  const needle = query.trim().toLowerCase();
  const all = sources();
  const shown = all.filter(
    (s) =>
      (showing === "*" || (h.assigned[s.id] ?? "") === showing) &&
      (needle === "" || [s.narration, ...s.accounts].some((text) => text.toLowerCase().includes(needle))),
  );
  if (shown.length === 0) {
    body.append(note(all.length === 0 ? "Nothing posts to income or expense yet." : "Nothing here. Clear the search, or show everything."));
    return;
  }
  const options = [["", "No job"] as const, ...open.map((j) => [j.id, j.name] as const)];
  const bulk = document.createElement("div");
  bulk.className = "contacts-controls";
  const bulkPick = select([["", "Choose a job"], ...open.map((j) => [j.id, j.name] as const)], focus);
  const bulkGo = document.createElement("button");
  bulkGo.type = "button";
  bulkGo.textContent = `Give it to all ${shown.length} listed`;
  bulkGo.addEventListener("click", () => {
    if (bulkPick.value === "") return;
    const next = { ...h.assigned };
    for (const s of shown) next[s.id] = bulkPick.value;
    const job = h.jobs.find((j) => j.id === bulkPick.value);
    void keep({ ...h, assigned: next }, `Job ${job?.name ?? ""} given to ${shown.length}`);
  });
  bulk.append(bulkPick, bulkGo);
  body.append(bulk);

  const table = document.createElement("table");
  table.className = "report-table owner-table";
  table.innerHTML = "<thead><tr><th>Date</th><th>Description</th><th>Coded to</th><th>Income less expense</th><th>Job</th></tr></thead>";
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
    const current = h.assigned[source.id] ?? "";
    // A finished job still shows where it is given, so the choice is not silently lost.
    const own = h.jobs.find((j) => j.id === current && !open.includes(j));
    const pick = select(own === undefined ? options : [...options, [own.id, `${own.name} (finished)`] as const], current);
    pick.addEventListener("change", () => {
      const next = { ...h.assigned };
      if (pick.value === "") delete next[source.id];
      else next[source.id] = pick.value;
      const job = h.jobs.find((j) => j.id === pick.value);
      void keep({ ...h, assigned: next }, pick.value === "" ? `Job taken off ${source.narration}` : `Job ${job?.name ?? ""} given to ${source.narration}`);
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
  if (shown.length > SHOWN) body.append(note(`The ${SHOWN} most recent of ${shown.length} are shown. Search to find the rest.`));
}

export function renderJobs(): void {
  const body = $("jobs-body");
  body.textContent = "";
  addForm(body);
  if (held().jobs.length === 0) {
    body.append(note("Add a job, then give it the invoices, bills and bank lines that belong to it."));
    return;
  }
  profitTable(body);
  assignSection(body);
}
