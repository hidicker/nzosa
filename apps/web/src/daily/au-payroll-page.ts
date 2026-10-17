import { redraw } from "../app.js";
import { record } from "../books.js";
import { booksMoney } from "../country.js";
import { $, state } from "../state.js";
import { save } from "../store.js";
import { note } from "../ui.js";
import {
  auPayLine,
  auWithholding,
  earnedBeforePay,
  parseAmount,
  stpYearToDate,
  superDueDate,
} from "@nzosa/core";
import type { Account, AuEmployee, AuPayFrequency, AuPayRun, AuPayroll, IsoDate } from "@nzosa/core";

/**
 * Payroll for Australian books: employees, pay runs, the PAYG withheld and the
 * super guarantee on each, when each pay's super is due, and the figures each
 * pay event reports through Single Touch Payroll.
 *
 * The PAYG figure starts as the ATO's Schedule 1 formula gives it and is the
 * employer's to change where a declaration varies it. NZOSA does not lodge STP: that is
 * done through STP-enabled software (the ATO lists free and low-cost ones for
 * small employers), with the figures shown here.
 */

const today = (): string => new Date().toLocaleDateString("en-CA");
const money = (cents: number): string => booksMoney(cents);

function held(): AuPayroll {
  return state.ledger.auPayroll ?? { employees: [], payRuns: [] };
}

async function keep(next: AuPayroll, what: string): Promise<void> {
  const before = held();
  state.ledger = { ...state.ledger, auPayroll: next };
  state.persistent = await save(state.ledger);
  await record("aupayroll", what, before, next);
  redraw("aupayroll");
}

/** The accounts pay runs post to, added to the chart where the books lack them. */
const PAYROLL_ACCOUNTS: [string, string, string][] = [
  ["477", "Wages and Salaries", "Expense"],
  ["478", "Superannuation", "Expense"],
  ["804", "Wages Payable", "Current Liability"],
  ["825", "PAYG Withholdings Payable", "Current Liability"],
  ["826", "Superannuation Payable", "Current Liability"],
];

async function ensureAccounts(): Promise<void> {
  const missing = PAYROLL_ACCOUNTS.filter(([code]) => !state.chart.some((a) => a.code === code));
  if (missing.length === 0) return;
  const added: Account[] = missing.map(([code, name, type]) => ({
    code,
    name,
    type,
    taxCode: "BAS Excluded",
    description: "",
  }) as Account);
  state.chart = [...state.chart, ...added];
  const model = state.ledger.entities;
  const owner = model?.entities.find((e) => e.kind !== "personal" && e.kind !== "residential")?.id ?? model?.entities[0]?.id;
  state.ledger = {
    ...state.ledger,
    chart: state.chart,
    ...(model !== undefined && owner !== undefined
      ? { entities: { ...model, accounts: { ...model.accounts, ...Object.fromEntries(added.map((a) => [a.code, owner])) } } }
      : {}),
  };
}

function field(labelText: string, control: HTMLElement, hint = ""): HTMLLabelElement {
  const label = document.createElement("label");
  label.className = "account-add-field";
  const span = document.createElement("span");
  span.textContent = labelText;
  label.append(span, control);
  if (hint !== "") {
    const small = document.createElement("small");
    small.className = "field-hint";
    small.textContent = hint;
    label.append(small);
  }
  return label;
}

function input(type: string, value = "", placeholder = ""): HTMLInputElement {
  const el = document.createElement("input");
  el.type = type;
  el.value = value;
  el.placeholder = placeholder;
  return el;
}

function checkbox(text: string, checked: boolean): [HTMLLabelElement, HTMLInputElement] {
  const label = document.createElement("label");
  label.className = "checkbox";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = checked;
  label.append(box, ` ${text}`);
  return [label, box];
}

function table(head: readonly string[], rows: readonly (readonly (string | HTMLElement)[])[]): HTMLTableElement {
  const t = document.createElement("table");
  t.className = "report-table";
  const thead = document.createElement("thead");
  const hr = document.createElement("tr");
  for (const h of head) {
    const th = document.createElement("th");
    th.textContent = h;
    hr.append(th);
  }
  thead.append(hr);
  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const cell of row) {
      const td = document.createElement("td");
      if (typeof cell === "string") td.textContent = cell;
      else td.append(cell);
      tr.append(td);
    }
    tbody.append(tr);
  }
  t.append(thead, tbody);
  return t;
}

function button(text: string, onClick: () => void, primary = false): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = text;
  if (primary) b.className = "primary";
  b.addEventListener("click", onClick);
  return b;
}

// --- employees -------------------------------------------------------------------

function employeeForm(): HTMLElement {
  const wrap = document.createElement("details");
  wrap.className = "payroll-add";
  const summary = document.createElement("summary");
  summary.textContent = "Add an employee";
  wrap.append(summary);
  const grid = document.createElement("div");
  grid.className = "agent-fields";
  const name = input("text", "", "Their name");
  const frequency = document.createElement("select");
  for (const f of ["weekly", "fortnightly", "monthly"] as const) {
    const o = document.createElement("option");
    o.value = f;
    o.textContent = f[0]!.toUpperCase() + f.slice(1);
    o.selected = f === "fortnightly";
    frequency.append(o);
  }
  const usual = input("text", "", "e.g. 2,400.00");
  const fund = input("text", "", "e.g. AustralianSuper");
  const [tftLabel, tft] = checkbox("Claims the tax-free threshold from you", true);
  const [tfnLabel, tfn] = checkbox("Gave a tax file number (TFN declaration)", true);
  const [foreignLabel, foreign] = checkbox("Foreign resident for tax", false);
  const [loanLabel, loan] = checkbox("Has a study or training support loan (HELP)", false);
  grid.append(
    field("Name", name),
    field("Paid", frequency),
    field("Usual gross pay", usual, "Each pay run starts with it; change it there for the pay."),
    field("Super fund", fund),
  );
  const said = document.createElement("p");
  said.className = "feed-said";
  const add = button(
    "Add employee",
    () => {
      const who = name.value.trim();
      if (who === "") {
        said.textContent = "Give the employee's name.";
        return;
      }
      const gross = usual.value.trim() === "" ? undefined : parseAmount(usual.value, "AUD");
      if (gross === null) {
        said.textContent = "The usual gross pay is not a number.";
        return;
      }
      const now = held();
      const employee: AuEmployee = {
        id: `emp-${Date.now().toString(36)}`,
        name: who,
        taxFreeThreshold: tft.checked,
        tfnProvided: tfn.checked,
        ...(foreign.checked ? { foreignResident: true } : {}),
        ...(loan.checked ? { studyLoan: true } : {}),
        superFund: fund.value.trim(),
        payFrequency: frequency.value as AuPayFrequency,
        ...(gross !== undefined ? { usualGross: gross } : {}),
      };
      void keep({ ...now, employees: [...now.employees, employee] }, `Added employee ${who}`);
    },
    true,
  );
  wrap.append(grid, tftLabel, tfnLabel, foreignLabel, loanLabel, add, said);
  return wrap;
}

function employeesSection(body: HTMLElement): void {
  const h = document.createElement("h3");
  h.textContent = "Employees";
  body.append(h);
  const { employees } = held();
  if (employees.length === 0) {
    body.append(note("No employees yet. Add one below; a sole trader's own drawings are not wages and need no payroll."));
  } else {
    body.append(
      table(
        ["Name", "Paid", "Usual gross", "Tax", "Super fund", ""],
        employees.map((e) => [
          e.name + (e.ended !== undefined ? ` (left ${e.ended})` : ""),
          e.payFrequency,
          e.usualGross === undefined ? "" : money(e.usualGross),
          [
            e.tfnProvided ? "" : "no TFN: 47%",
            e.foreignResident === true ? "foreign resident" : e.taxFreeThreshold ? "tax-free threshold" : "no tax-free threshold",
            e.studyLoan === true ? "study loan" : "",
          ]
            .filter(Boolean)
            .join(", "),
          e.superFund,
          e.ended === undefined
            ? button("Mark as left", () => {
                const now = held();
                void keep(
                  { ...now, employees: now.employees.map((x) => (x.id === e.id ? { ...x, ended: today() as IsoDate } : x)) },
                  `${e.name} has left`,
                );
              })
            : "",
        ]),
      ),
    );
  }
  body.append(employeeForm());
}

// --- a new pay run -----------------------------------------------------------------

function newPayRun(body: HTMLElement): void {
  const now = held();
  const active = now.employees.filter((e) => e.ended === undefined);
  if (active.length === 0) return;
  const h = document.createElement("h3");
  h.textContent = "New pay run";
  body.append(h);

  const fields = document.createElement("div");
  fields.className = "agent-fields";
  const payDate = input("date", today());
  const from = input("date");
  const to = input("date");
  fields.append(field("Payday", payDate), field("Period from", from), field("Period to", to));
  body.append(fields);

  const rows = active.map((e) => {
    const gross = input("text", e.usualGross === undefined ? "" : (e.usualGross / 100).toFixed(2), "Gross");
    const payg = input("text", "", "PAYG");
    const superCell = document.createElement("span");
    const netCell = document.createElement("span");
    let edited = false;
    payg.addEventListener("input", () => {
      edited = payg.value.trim() !== "";
      redo();
    });
    const redo = (): void => {
      const g = parseAmount(gross.value || "0", "AUD") ?? 0;
      const date = (payDate.value || today()) as IsoDate;
      const given = edited ? (parseAmount(payg.value, "AUD") ?? undefined) : undefined;
      const line = auPayLine(e, g, date, earnedBeforePay(held().payRuns, e.id, date), given);
      if (!edited) payg.value = (line.payg / 100).toFixed(2);
      superCell.textContent = money(line.superGuarantee);
      netCell.textContent = money(line.net);
    };
    gross.addEventListener("input", redo);
    payDate.addEventListener("change", redo);
    redo();
    return { e, gross, payg, superCell, netCell, isEdited: () => edited };
  });
  body.append(
    table(
      ["Employee", "Gross", "PAYG withheld", "Super guarantee", "Net pay"],
      rows.map((r) => [r.e.name, r.gross, r.payg, r.superCell, r.netCell]),
    ),
  );
  if (active.some((e) => e.studyLoan === true)) {
    body.append(
      note(
        "For an employee with a study loan, PAYG withheld includes the study and training support loans component, by the ATO's Schedule 8.",
      ),
    );
  }
  const said = document.createElement("p");
  said.className = "feed-said";
  body.append(
    note(
      "PAYG withheld is worked out by the ATO's Schedule 1 formula for the pay's period and the employee's TFN declaration. Medicare levy variations and tax offsets claimed on a withholding declaration are not taken off: change the figure where they apply.",
    ),
    button(
      "Save pay run",
      () => {
        const date = payDate.value as IsoDate;
        if (date === "") {
          said.textContent = "Give the payday.";
          return;
        }
        const runs = held().payRuns;
        const lines = rows
          .map((r) => {
            const g = parseAmount(r.gross.value || "0", "AUD") ?? 0;
            const given = r.isEdited() ? (parseAmount(r.payg.value, "AUD") ?? undefined) : undefined;
            return auPayLine(r.e, g, date, earnedBeforePay(runs, r.e.id, date), given);
          })
          .filter((l) => l.gross > 0);
        if (lines.length === 0) {
          said.textContent = "Nobody has any pay in this run.";
          return;
        }
        const run: AuPayRun = {
          id: `run-${Date.now().toString(36)}`,
          payDate: date,
          periodStart: (from.value || date) as IsoDate,
          periodEnd: (to.value || date) as IsoDate,
          lines,
        };
        void (async () => {
          await ensureAccounts();
          const current = held();
          await keep({ ...current, payRuns: [...current.payRuns, run].sort((a, b) => a.payDate.localeCompare(b.payDate)) }, `Pay run ${date}`);
        })();
      },
      true,
    ),
    said,
  );
}

// --- pay runs, super due and STP --------------------------------------------------

function payRunsSection(body: HTMLElement): void {
  const { employees, payRuns } = held();
  if (payRuns.length === 0) return;
  const nameOf = (id: string): string => employees.find((e) => e.id === id)?.name ?? id;
  const h = document.createElement("h3");
  h.textContent = "Pay runs";
  body.append(h);
  const firstPay = new Map<string, string>();
  for (const run of payRuns) for (const l of run.lines) if (!firstPay.has(l.employeeId)) firstPay.set(l.employeeId, run.id);
  const list = [...payRuns].sort((a, b) => b.payDate.localeCompare(a.payDate));
  for (const run of list) {
    const sum = (pick: (l: AuPayRun["lines"][number]) => number): number => run.lines.reduce((s, l) => s + pick(l), 0);
    const anyFirst = run.lines.some((l) => firstPay.get(l.employeeId) === run.id);
    const details = document.createElement("details");
    details.className = "payroll-run";
    const summary = document.createElement("summary");
    summary.textContent =
      `${run.payDate}: gross ${money(sum((l) => l.gross))}, PAYG ${money(sum((l) => l.payg))}, ` +
      `super ${money(sum((l) => l.superGuarantee))} due in the fund by ${superDueDate(run.payDate)}` +
      (anyFirst && run.payDate >= "2026-07-01" ? ` (${superDueDate(run.payDate, true)} for a first contribution)` : "");
    details.append(summary);
    const ytd = stpYearToDate(payRuns, run);
    details.append(
      table(
        ["Employee", "Gross", "PAYG", "Super", "Net", "Year to date: gross", "PAYG", "Super"],
        run.lines.map((l) => {
          const y = ytd.find((t) => t.employeeId === l.employeeId);
          return [
            nameOf(l.employeeId),
            money(l.gross),
            money(l.payg) + (l.paygEstimated ? " (ATO formula)" : ""),
            money(l.superGuarantee),
            money(l.net),
            money(y?.gross ?? 0),
            money(y?.payg ?? 0),
            money(y?.superGuarantee ?? 0),
          ];
        }),
      ),
      note(
        "The pay event's figures for Single Touch Payroll: report them through STP-enabled software on or before payday. " +
          "Pay the net pay from the bank and code it to Wages Payable; the ATO payment to PAYG Withholdings Payable; the fund payment to Superannuation Payable.",
      ),
      button("Remove this pay run", () => {
        const now = held();
        void keep({ ...now, payRuns: now.payRuns.filter((r) => r.id !== run.id) }, `Removed pay run ${run.payDate}`);
      }),
    );
    body.append(details);
  }

  // The year so far, for the BAS and for STP finalisation by 14 July.
  const latest = list[0];
  if (latest !== undefined) {
    const year = Number(latest.payDate.slice(0, 4)) + (Number(latest.payDate.slice(5, 7)) >= 7 ? 1 : 0);
    const totals = auWithholding(payRuns, `${year - 1}-07-01` as IsoDate, `${year}-06-30` as IsoDate);
    body.append(
      note(
        `Year to 30 June ${year}: gross ${money(totals.w1)}, PAYG withheld ${money(totals.w2)}, super guarantee ` +
          `${money(totals.superGuarantee)}. W1 and W2 go on each BAS (Reports, Business activity statement). ` +
          `Finalise each employee's year through STP by 14 July ${year}.`,
      ),
    );
  }
}

export function renderAuPayroll(): void {
  const body = $("aupayroll-body");
  body.textContent = "";
  employeesSection(body);
  newPayRun(body);
  payRunsSection(body);
  body.append(
    note(
      `Super guarantee is 12% of ordinary time earnings, and from 1 July 2026 it must be received by the fund within 7 business ` +
        "days of each payday; earnings paid before then kept the quarterly dates. Payroll tax is the state's, above its " +
        "threshold, and is not worked out here.",
    ),
  );
}
