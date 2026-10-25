import { redraw } from "../app.js";
import { reclassify, record } from "../books.js";
import { state } from "../state.js";
import { savePart } from "../store.js";
import { download, note } from "../ui.js";
import { applyChartPlan, chartImportPlan, formatChartOfAccounts, parseChartOfAccounts, parseHledgerAccounts, usualTaxCodes } from "@nzosa/core";
import type { Account, ChartImportPlan } from "@nzosa/core";

/**
 * The chart of accounts as a file: downloaded as CSV, and accounts brought in
 * from a CSV or from hledger -- shown first as what would change, applied
 * only when asked. Bringing accounts in adds and updates; it never removes.
 */

let pending: { file: string; plan: ChartImportPlan; read: string[] } | null = null;

const today = (): string => new Date().toLocaleDateString("en-CA");

async function readFile(file: File): Promise<void> {
  const text = await file.text();
  const read: string[] = [];
  let incoming;
  // hledger knows assets from expenses, not an overhead from a direct cost.
  let inferredTypes = false;
  if (/^﻿?\s*\*?Code\s*,/im.test(text) || /\*Name/.test(text)) {
    const parsed = parseChartOfAccounts(text);
    incoming = parsed.accounts;
    read.push(...parsed.problems.map((p) => `line ${p.line}: ${p.message}`));
  } else {
    const parsed = parseHledgerAccounts(text);
    incoming = parsed.accounts;
    inferredTypes = true;
    read.push(...parsed.problems);
  }
  if (incoming.length === 0) {
    pending = { file: file.name, plan: { add: [], change: [], renamed: [], unchanged: 0, coded: [], problems: [] }, read: [...read, "No accounts were found in it. A CSV needs *Code, *Name and *Type columns; an hledger file, account directives or the output of hledger accounts."] };
  } else {
    pending = { file: file.name, plan: chartImportPlan(state.chart, incoming, { taxCodeFor: usualTaxCodes(state.chart), inferredTypes }), read };
  }
  redraw("entities");
}

async function apply(plan: ChartImportPlan, file: string): Promise<void> {
  const chart = applyChartPlan(state.chart, plan);
  state.chart = chart;
  state.ledger = { ...state.ledger, chart };
  state.persistent = await savePart(state.ledger, "chart");
  const key = (a: { code: string; name: string }): string => `${a.code}|${a.name}`;
  // One History entry an account, as the chart keeps them, so each can be undone alone.
  for (const added of plan.add) await record("chart", `${added.name} added from ${file}`, null, added, key(added));
  for (const c of plan.change) await record("chart", `${c.after.name}: ${c.fields.join(", ")} from ${file}`, c.before, c.after, key(c.after));
  pending = null;
  reclassify();
  redraw("entities");
}

/** An account's value for one of the fields a plan names. */
function field(a: Account, name: string): string {
  if (name === "type") return a.type;
  if (name === "tax code") return a.taxCode;
  if (name === "description") return a.description;
  if (name === "parent") return a.parent ?? "";
  return a.gstTreatment ?? "";
}

function list(title: string, rows: string[]): HTMLElement | null {
  if (rows.length === 0) return null;
  const box = document.createElement("div");
  const h = document.createElement("h4");
  h.textContent = `${title} (${rows.length})`;
  const ul = document.createElement("ul");
  for (const r of rows.slice(0, 200)) {
    const li = document.createElement("li");
    li.textContent = r;
    ul.append(li);
  }
  box.append(h, ul);
  if (rows.length > 200) box.append(note(`…and ${rows.length - 200} more.`));
  return box;
}

/** The buttons, and the dry run of a file brought in, at the top of the chart. */
export function chartFileTools(): HTMLElement {
  const wrap = document.createElement("div");
  const actions = document.createElement("div");
  actions.className = "migration-actions";
  const save = document.createElement("button");
  save.type = "button";
  save.textContent = "Download the chart (CSV)";
  save.addEventListener("click", () => download(formatChartOfAccounts(state.chart), `chart-of-accounts-${today()}.csv`, "text/csv"));
  const input = document.createElement("input");
  input.type = "file";
  input.hidden = true;
  input.accept = ".csv,.journal,.hledger,.ledger,.txt,text/csv,text/plain";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file !== undefined) void readFile(file);
  });
  const bring = document.createElement("button");
  bring.type = "button";
  bring.textContent = "Bring in accounts…";
  bring.title = "From a chart CSV (Xero's layout, or one downloaded here) or from hledger. Shown first; nothing changes until you apply it.";
  bring.addEventListener("click", () => input.click());
  actions.append(save, bring, input);
  wrap.append(actions);

  if (pending === null) return wrap;
  const { file, plan, read } = pending;
  const box = document.createElement("div");
  box.className = "invoice-editor";
  const h = document.createElement("h4");
  h.textContent = `What ${file} would do`;
  box.append(h);
  const nothing = plan.add.length === 0 && plan.change.length === 0;
  box.append(
    note(
      nothing
        ? `Nothing to change: ${plan.unchanged} account${plan.unchanged === 1 ? " is" : "s are"} already as the file has them.`
        : `${plan.add.length} to add, ${plan.change.length} to update, ${plan.unchanged} already the same. ` +
            "Nothing is removed: an account the file leaves out stays as it is.",
    ),
  );
  for (const part of [
    list("Added", plan.add.map((a) => `${a.code === "" ? "" : `${a.code} `}${a.name} · ${a.type}${a.taxCode === "" ? "" : ` · ${a.taxCode}`}`)),
    list("Updated", plan.change.map((c) => `${c.before.code} ${c.before.name}: ${c.fields.map((f) => `${f} "${field(c.before, f)}" → "${field(c.after, f)}"`).join("; ")}`)),
    list("Given a code, as the file had none", plan.coded),
    list("Another name in the file, left as it is here (rename it on the account itself)", plan.renamed.map((r) => `${r.code}: "${r.held}" here, "${r.file}" in the file`)),
    list("Not brought in", [...read, ...plan.problems]),
  ]) {
    if (part !== null) box.append(part);
  }
  const buttons = document.createElement("div");
  buttons.className = "migration-actions";
  if (!nothing) {
    const go = document.createElement("button");
    go.type = "button";
    go.className = "primary";
    go.textContent = "Apply these changes";
    go.addEventListener("click", () => void apply(plan, file));
    buttons.append(go);
  }
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = nothing ? "Close" : "Leave the chart as it is";
  cancel.addEventListener("click", () => {
    pending = null;
    redraw("entities");
  });
  buttons.append(cancel);
  box.append(buttons);
  wrap.append(box);
  return wrap;
}
