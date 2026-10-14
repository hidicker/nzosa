import { redraw } from "../app.js";
import { record } from "../books.js";
import { $, state } from "../state.js";
import { savePart } from "../store.js";
import { askOnPage, note } from "../ui.js";
import {
  MAX_SCHEDULES,
  RECURRING_FREQUENCIES,
  formatAmount,
  generateDue,
  nextDate,
  scheduleFromInvoice,
  scheduleProblem,
} from "@nzosa/core";
import type { RecurringFrequency, RecurringInvoice } from "@nzosa/core";

/**
 * Invoices that repeat, on the Invoices page.
 *
 * Nothing here runs on its own. A schedule makes its invoices when somebody
 * presses the button, and they arrive as drafts: not in the books, and not
 * in a return, until they are looked at and sent.
 */

const today = (): string => new Date().toISOString().slice(0, 10);

const schedules = (): RecurringInvoice[] => state.ledger.recurring ?? [];

/** Said once above the panel after something happens, then cleared. */
let said = "";

async function saveSchedules(next: RecurringInvoice[], what: string): Promise<void> {
  const before = schedules();
  state.ledger = { ...state.ledger, recurring: next };
  state.persistent = await savePart(state.ledger, "invoices");
  await record("invoice", what, before, next);
  redraw("invoices");
}

function button(label: string, onClick: () => void, title?: string, primary = false): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  if (primary) b.className = "primary";
  if (title !== undefined) b.title = title;
  b.addEventListener("click", onClick);
  return b;
}

/** Make what is due, after showing what that would be. */
async function createDue(): Promise<void> {
  const run = generateDue(schedules(), state.ledger.invoices ?? [], today());
  if (run.invoices.length === 0) {
    said =
      run.skipped.length > 0
        ? "Nothing could be made: " + run.skipped.map((s) => `${s.contact} — ${s.message}`).join("; ") + "."
        : "Nothing is due yet.";
    redraw("invoices");
    return;
  }
  const listed = run.invoices
    .slice(0, 12)
    .map((i) => `${i.number}  ${i.issued}  ${i.contact}  ${formatAmount(i.total)}`)
    .join("\n");
  const more = run.invoices.length > 12 ? `\n…and ${run.invoices.length - 12} more` : "";
  const yes = await askOnPage(
    `Create ${run.invoices.length} draft invoice${run.invoices.length === 1 ? "" : "s"}?\n\n${listed}${more}\n\n` +
      "They are drafts: not in the books until you send them.",
    "Create drafts",
  );
  if (!yes) return;

  state.ledger = {
    ...state.ledger,
    invoices: [...(state.ledger.invoices ?? []), ...run.invoices],
    recurring: run.schedules,
  };
  state.persistent = await savePart(state.ledger, "invoices");
  await record(
    "invoice",
    `Created ${run.invoices.length} repeating invoice${run.invoices.length === 1 ? "" : "s"} as drafts`,
    null,
    run.invoices,
  );
  said =
    `Created ${run.invoices.length} draft invoice${run.invoices.length === 1 ? "" : "s"}.` +
    (run.skipped.length > 0
      ? " Not made: " + run.skipped.map((s) => `${s.contact} — ${s.message}`).join("; ") + "."
      : "");
  redraw("invoices");
}

function scheduleTable(list: RecurringInvoice[]): HTMLTableElement {
  const table = document.createElement("table");
  table.className = "report";
  table.innerHTML =
    "<thead><tr><th>Contact</th><th>How often</th><th>Next</th><th>Made</th>" +
    "<th class=\"report-amount\">Amount</th><th></th></tr></thead>";
  const tbody = document.createElement("tbody");

  for (const schedule of list) {
    const tr = document.createElement("tr");
    const next = nextDate(schedule);
    const problem = scheduleProblem(schedule);
    const total = schedule.lines.reduce((sum, line) => sum + line.gross, 0);

    const cells: [string, string | undefined][] = [
      [schedule.contact || "(no contact)", undefined],
      [schedule.frequency, undefined],
      [
        !schedule.active ? "paused" : next === null ? "ended" : next,
        problem === null ? undefined : `Will be skipped: ${problem}.`,
      ],
      [String(schedule.made), undefined],
    ];
    for (const [text, title] of cells) {
      const td = document.createElement("td");
      td.textContent = text;
      if (title !== undefined) {
        td.title = title;
        td.classList.add("match-off");
      }
      tr.append(td);
    }
    const amount = document.createElement("td");
    amount.className = "report-amount";
    amount.textContent = formatAmount(total);
    tr.append(amount);

    const actions = document.createElement("td");
    actions.className = "report-amount";
    actions.append(
      button(schedule.active ? "pause" : "resume", () => {
        void saveSchedules(
          schedules().map((s) => (s.id === schedule.id ? { ...s, active: !s.active } : s)),
          `${schedule.active ? "Paused" : "Resumed"} repeating invoice for ${schedule.contact}`,
        );
      }),
      button("stop", () => {
        void (async () => {
          const yes = await askOnPage(
            `Stop and remove the repeating invoice for ${schedule.contact}? ` +
              `The ${schedule.made} invoice${schedule.made === 1 ? "" : "s"} already made stay.`,
            "Remove",
          );
          if (!yes) return;
          await saveSchedules(
            schedules().filter((s) => s.id !== schedule.id),
            `Removed repeating invoice for ${schedule.contact}`,
          );
        })();
      }),
    );
    tr.append(actions);
    tbody.append(tr);
  }
  table.append(tbody);
  return table;
}

/** Choose an invoice already written and say how often it repeats. */
function addForm(): HTMLElement {
  const form = document.createElement("div");
  form.className = "invoice-actions";

  const sales = (state.ledger.invoices ?? [])
    .filter((i) => i.kind === "sales" && i.lines.length > 0)
    .sort((a, b) => b.issued.localeCompare(a.issued))
    .slice(0, 200);

  const source = document.createElement("select");
  source.setAttribute("aria-label", "Invoice to repeat");
  for (const invoice of sales) {
    const option = document.createElement("option");
    option.value = invoice.number;
    option.textContent = `${invoice.number} — ${invoice.contact} ${formatAmount(invoice.total)}`;
    source.append(option);
  }

  const frequency = document.createElement("select");
  frequency.setAttribute("aria-label", "How often");
  for (const f of RECURRING_FREQUENCIES) {
    const option = document.createElement("option");
    option.value = f;
    option.textContent = f;
    if (f === "monthly") option.selected = true;
    frequency.append(option);
  }

  const start = document.createElement("input");
  start.type = "date";
  start.value = today();
  start.setAttribute("aria-label", "Date of the first invoice");
  start.title = "The date of the first invoice made. Every later date is counted from it.";

  const add = button(
    "Repeat this invoice",
    () => {
      const invoice = sales.find((i) => i.number === source.value);
      if (invoice === undefined || start.value === "") return;
      if (schedules().length >= MAX_SCHEDULES) {
        said = `Up to ${MAX_SCHEDULES} repeating invoices are kept. Stop one before adding another.`;
        redraw("invoices");
        return;
      }
      const made = scheduleFromInvoice(
        invoice,
        frequency.value as RecurringFrequency,
        start.value,
        crypto.randomUUID(),
      );
      const problem = scheduleProblem(made);
      if (problem !== null) {
        said = `That invoice cannot repeat: ${problem}.`;
        redraw("invoices");
        return;
      }
      void saveSchedules(
        [...schedules(), made],
        `Set ${invoice.contact} to repeat ${made.frequency} from ${made.start}`,
      );
    },
    "Uses that invoice's contact and lines. The next invoice is made on the date you choose.",
    true,
  );

  form.append(source, frequency, start, add);
  return form;
}

/** The repeating-invoices panel at the top of the Invoices page. */
export function renderRecurring(): void {
  const body = $("recurring-body");
  body.textContent = "";

  const list = schedules();
  const due = generateDue(list, state.ledger.invoices ?? [], today()).invoices.length;

  const details = document.createElement("details");
  details.className = "entity-billing-details";
  details.open = list.length > 0 && (due > 0 || said !== "");
  const summary = document.createElement("summary");
  summary.textContent =
    list.length === 0
      ? "Repeating invoices"
      : `Repeating invoices — ${list.length}${due > 0 ? `, ${due} due` : ""}`;
  details.append(summary);

  if (said !== "") {
    details.append(note(said));
    said = "";
  }

  if (list.length === 0) {
    details.append(
      note(
        "An invoice that goes out on a schedule: the same lines to the same customer every week, month " +
          "or year. Each one is made as a draft when you press the button, so nothing reaches the books unseen.",
      ),
    );
  } else {
    details.append(scheduleTable(list));
    const row = document.createElement("div");
    row.className = "invoice-actions";
    row.append(
      button(
        due > 0 ? `Create ${due} due invoice${due === 1 ? "" : "s"}` : "Create due invoices",
        () => void createDue(),
        "Makes every invoice that has come due, as a draft, after showing you the list.",
        due > 0,
      ),
    );
    details.append(row);
  }

  if ((state.ledger.invoices ?? []).some((i) => i.kind === "sales" && i.lines.length > 0)) {
    details.append(addForm());
  } else if (list.length === 0) {
    details.append(note("Create an invoice first, then set it to repeat here."));
  }

  body.append(details);
}
