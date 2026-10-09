import { redraw } from "../app.js";
import { bookYears, postedJournals, record } from "../books.js";
import { $, state } from "../state.js";
import { savePart } from "../store.js";
import { amountCell, nameCell, note } from "../ui.js";
import {
  accountEntityKey,
  currentAssetsAt,
  emptyEntityModel,
  operatingPaymentsFrom,
  parseAmount,
  reportingStandard,
  smallSocietyProblems,
  smallSocietyReportHtml,
  smallSocietyStatements,
  standardName,
  tier3Problems,
  tier3ReportHtml,
  tier3Statements,
  statementFromFigures,
} from "@nzosa/core";
import type { Account, Cents, Entity, ReportingStandard, SocietyInputs, SocietyYearFigures, Tier3Inputs } from "@nzosa/core";
import { taxYearEnd, taxYearEndSaid, taxYearStart } from "../tax-year.js";
import { booksLocale, moneyPlaces } from "../country.js";
import { inputsFor as performanceInputs, legalFormOf, statementFor } from "./performance-report-page.js";

/**
 * Which financial reporting standard a society or charity uses, from its last
 * two years' operating payments and current assets, and the statements for the
 * two the Annual report page does not cover: a small society's minimum
 * statements for the Companies Office, and a Tier 3 performance report. See
 * core's small-society.ts and tier3-report.ts for what the sources say.
 */

let chosen = "";
let chosenYear = 0;

const key = (entity: Entity, year: number): string => `${entity.id}:${year}`;

function inputsFor(entity: Entity, year: number): SocietyInputs {
  return state.ledger.societyReports?.[key(entity, year)] ?? {};
}

function money(cents: number): string {
  const text = (Math.abs(cents) / 100).toLocaleString(booksLocale(), {
    minimumFractionDigits: moneyPlaces(),
    maximumFractionDigits: moneyPlaces(),
  });
  return cents < 0 ? `(${text})` : text;
}

async function saveInputs(entity: Entity, year: number, next: SocietyInputs, what: string): Promise<void> {
  const before = state.ledger.societyReports ?? {};
  const after = { ...before, [key(entity, year)]: next };
  state.ledger = { ...state.ledger, societyReports: after };
  state.persistent = await savePart(state.ledger);
  await record("societyReport", what, before, after);
}

function heading(text: string): HTMLElement {
  const h = document.createElement("h3");
  h.textContent = text;
  return h;
}

function textArea(value: string, rows: number, placeholder: string, onChange: (v: string) => void): HTMLTextAreaElement {
  const box = document.createElement("textarea");
  box.rows = rows;
  box.value = value;
  box.placeholder = placeholder;
  box.addEventListener("change", () => onChange(box.value));
  return box;
}

function labelled(label: string, control: HTMLElement): HTMLLabelElement {
  const wrap = document.createElement("label");
  wrap.className = "year-end-field";
  wrap.style.display = "block";
  wrap.append(`${label} `, control);
  return wrap;
}

function openReport(html: string): void {
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function wrapTable(table: HTMLElement): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "table-scroll";
  wrap.append(table);
  return wrap;
}

function statementTable(rows: { label: string; amount: number; strong?: boolean }[]): HTMLElement {
  const table = document.createElement("table");
  table.className = "report-table";
  const tbody = document.createElement("tbody");
  for (const r of rows) {
    const tr = document.createElement("tr");
    const label = nameCell(r.label);
    if (r.strong === true) label.style.fontWeight = "600";
    tr.append(label, amountCell(money(r.amount)));
    tbody.append(tr);
  }
  table.append(tbody);
  return wrapTable(table);
}

interface PriorYear {
  year: number;
  operatingPayments: Cents;
  currentAssets: Cents;
  totalExpenses: Cents;
  /** Which of the three were not entered, and so came from the books. */
  fromBooks: string[];
}

/** The two years before `year`: as entered from their statements, else from the books. */
function priorYearFigures(
  entity: Entity,
  year: number,
  statementsFor: (y: number) => ReturnType<typeof smallSocietyStatements>,
): [PriorYear, PriorYear] {
  const one = (y: number): PriorYear => {
    const entered = inputsFor(entity, y).figures ?? {};
    const books = statementsFor(y);
    const fromBooks: string[] = [];
    const pick = (value: Cents | undefined, fallback: Cents, name: string): Cents => {
      if (value !== undefined) return value;
      fromBooks.push(name);
      return fallback;
    };
    return {
      year: y,
      operatingPayments: pick(entered.operatingPayments, operatingPaymentsFrom(books.expenses), "operating payments"),
      currentAssets: pick(entered.currentAssets, currentAssetsAt(books), "current assets"),
      totalExpenses: pick(entered.totalExpenses, books.totalExpenses, "total expenses"),
      fromBooks,
    };
  };
  return [one(year - 1), one(year - 2)];
}

/** Whether a year's own figures have been entered from its statements. */
export function societyFiguresEntered(entity: Entity, year: number): boolean {
  const f = inputsFor(entity, year).figures;
  return f?.operatingPayments !== undefined && f.currentAssets !== undefined && f.totalExpenses !== undefined;
}

/** A box per figure per year, saved under that year: the figures belong to it, not to the year being reported. */
function priorFiguresTable(entity: Entity, years: number[], shown: PriorYear[], after: () => void): HTMLElement {
  const table = document.createElement("table");
  table.className = "report-table";
  const head = document.createElement("thead");
  const hr = document.createElement("tr");
  hr.append(nameCell(""));
  for (const y of years) hr.append(nameCell(`Year ended ${taxYearEndSaid(y)}`));
  head.append(hr);
  const tbody = document.createElement("tbody");
  const rows: [keyof SocietyYearFigures, string, string][] = [
    ["operatingPayments", "Operating payments", "Cash paid out for the year's operations: not depreciation, money owed, or land, buildings and equipment bought"],
    ["currentAssets", "Current assets at year end", "Cash, money owed to it, and anything else to be used or turned into cash within a year"],
    ["totalExpenses", "Total expenses", "The year's total expenses on the accrual basis, from its statement of financial performance"],
  ];
  for (const [field, label, title] of rows) {
    const tr = document.createElement("tr");
    const name = nameCell(label);
    name.title = title;
    tr.append(name);
    years.forEach((y, i) => {
      const td = document.createElement("td");
      const box = document.createElement("input");
      box.type = "text";
      box.className = "payroll-tiny-input";
      box.title = title;
      const entered = inputsFor(entity, y).figures?.[field];
      const fallback = shown[i]?.[field] ?? 0;
      box.value = entered === undefined ? "" : (entered / 100).toFixed(2);
      box.placeholder = `${(fallback / 100).toFixed(2)} (books)`;
      box.style.width = "10em";
      box.addEventListener("change", () => {
        const parsed = box.value.trim() === "" ? null : parseAmount(box.value);
        const next = structuredClone(inputsFor(entity, y));
        const figures: SocietyYearFigures = { ...(next.figures ?? {}) };
        if (parsed === null) delete figures[field];
        else figures[field] = parsed;
        next.figures = figures;
        void saveInputs(entity, y, next, `${entity.name}: ${label.toLowerCase()}, year ended ${taxYearEndSaid(y)}`).then(after);
      });
      td.append(box);
      tr.append(td);
    });
    tbody.append(tr);
  }
  table.append(head, tbody);
  return wrapTable(table);
}

export function renderSocietyPage(): void {
  const body = $("society-body");
  body.textContent = "";
  const model = state.ledger.entities ?? emptyEntityModel();
  const entities = model.entities.filter((e) => e.kind === "nonprofit");
  if (entities.length === 0) {
    body.append(note("No not-for-profit organisations. On Entities & accounts, add one: a charity, society or club."));
    return;
  }
  const entity = entities.find((e) => e.id === chosen) ?? entities.find((e) => e.id === state.entityFilter) ?? entities[0];
  if (entity === undefined) return;
  chosen = entity.id;
  const years = bookYears();
  if (years.length === 0) {
    body.append(note("No transactions yet, so there is no year to report on."));
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  if (!years.includes(chosenYear)) chosenYear = years.filter((y) => taxYearEnd(y) < today)[0] ?? years[0] ?? 0;
  const year = chosenYear;
  const np = entity.nonprofit;

  const pick = document.createElement("div");
  pick.className = "page-actions";
  if (entities.length > 1) {
    const who = document.createElement("select");
    for (const e of entities) {
      const option = document.createElement("option");
      option.value = e.id;
      option.textContent = e.name;
      option.selected = e.id === entity.id;
      who.append(option);
    }
    who.addEventListener("change", () => {
      chosen = who.value;
      redraw("society");
    });
    pick.append(who);
  }
  const when = document.createElement("select");
  for (const y of years) {
    const option = document.createElement("option");
    option.value = String(y);
    option.textContent = `Year ended ${taxYearEndSaid(y)}`;
    option.selected = y === year;
    when.append(option);
  }
  when.addEventListener("change", () => {
    chosenYear = Number(when.value);
    redraw("society");
  });
  pick.append(when);
  body.append(pick);

  const patch = (change: (draft: SocietyInputs) => void, what: string): void => {
    const next = structuredClone(inputsFor(entity, year));
    change(next);
    void saveInputs(entity, year, next, what);
    redraw("society");
  };

  const owned = (accountKey: string): boolean => {
    const holder = model.accounts[accountKey];
    return holder === entity.id || (holder === undefined && model.entities.length <= 1);
  };
  const only = (account: Account): boolean => {
    const bank = (account.ledgerAccount ?? "").trim();
    if (bank !== "") return (model.banks[bank] ?? []).includes(entity.id) || (model.banks[bank] === undefined && model.entities.length <= 1);
    return owned(accountEntityKey(account));
  };
  const journals = postedJournals();
  const statementsFor = (y: number) => smallSocietyStatements({ journals, chart: state.chart, from: taxYearStart(y), to: taxYearEnd(y), only });

  // 1. Which standard
  body.append(heading("1. Which standard applies?"));
  const thisYear = statementsFor(year);
  const prior = priorYearFigures(entity, year, statementsFor);
  const answer = reportingStandard({
    registeredCharity: np?.registeredCharity === true,
    donee: np?.donee === true,
    operatingPayments: [prior[0].operatingPayments, prior[1].operatingPayments],
    currentAssets: [prior[0].currentAssets, prior[1].currentAssets],
    totalExpenses: [prior[0].totalExpenses, prior[1].totalExpenses],
  });
  const stored = inputsFor(entity, year);
  const standard: ReportingStandard = stored.standard ?? answer.standard;
  body.append(
    note(
      "The standard is decided by the two years before this one, from their signed financial statements. Enter " +
        "each year's figures as those statements give them. Until you do, the books' own figures are used, and " +
        "they are short wherever the books do not hold the whole of a year.",
    ),
  );
  body.append(priorFiguresTable(entity, [year - 1, year - 2], prior, () => redraw("society")));
  const guessed = prior.filter((p) => p.fromBooks.length > 0);
  if (guessed.length > 0) {
    body.append(
      note(
        `Not yet entered, so taken from the books: ${guessed.map((p) => `${p.fromBooks.join(", ")} for the year ended ${taxYearEndSaid(p.year)}`).join("; ")}. ` +
          "The suggestion below is only as good as those.",
      ),
    );
  }
  const verdict = document.createElement("div");
  verdict.className = "journal-card";
  const title = document.createElement("p");
  title.className = "journal-narration";
  title.textContent = `Suggested: ${standardName(answer.standard)}${guessed.length > 0 ? " (from the books' figures)" : ""}`;
  verdict.append(title);
  for (const reason of answer.reasons) verdict.append(note(reason));
  body.append(verdict);
  const choose = document.createElement("select");
  for (const value of ["small-society", "tier-4", "tier-3", "tier-2"] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = standardName(value);
    option.selected = value === standard;
    choose.append(option);
  }
  choose.addEventListener("change", () =>
    patch((d) => {
      if (choose.value === answer.standard) delete d.standard;
      else d.standard = choose.value as ReportingStandard;
    }, "reporting standard"),
  );
  body.append(labelled("Use:", choose));
  if (np?.registeredCharity === true) {
    body.append(note("A registered charity files its annual return and performance report with Charities Services, under the Tier 4 or Tier 3 standard, whatever its size."));
  } else {
    body.append(note("Financial statements are due at the Companies Office within six months of balance date, after being presented to the members at the annual general meeting."));
  }

  if (standard === "tier-2") {
    body.append(heading("2. Tier 2 or Tier 1"));
    body.append(
      note(
        "Tier 2 and Tier 1 are full accrual reporting under PBE Standards, with an audit or review. NZOSA keeps the books " +
          "for it, but the financial statements need an accountant. The Reports page has the trial balance and ledger they work from.",
      ),
    );
    return;
  }

  if (standard === "tier-4") {
    body.append(heading("2. Tier 4: the Annual report page"));
    body.append(note("The Tier 4 cash performance report is on the Annual report page, with the cash received and paid worked out from the books."));
    const go = document.createElement("button");
    go.type = "button";
    go.textContent = "Open the Annual report page";
    go.addEventListener("click", () => document.querySelector<HTMLElement>('[data-page="performance"]')?.click());
    body.append(go);
    return;
  }

  const perf = performanceInputs(entity, year);
  const signers: [string, string] = [stored.signers?.[0] ?? perf.approvedBy[0] ?? "", stored.signers?.[1] ?? perf.approvedBy[1] ?? ""];

  if (standard === "small-society") {
    body.append(heading("2. Small society: financial statements"));
    const s = thisYear;
    const incomeRows = [
      ...s.income.map((a) => ({ label: a.name, amount: a.amount as number })),
      { label: "Total income", amount: s.totalIncome as number, strong: true },
      ...s.expenses.map((a) => ({ label: a.name, amount: -a.amount as number })),
      { label: "Total expenditure", amount: -s.totalExpenses as number, strong: true },
      { label: s.surplus >= 0 ? "Surplus for the year" : "Deficit for the year", amount: s.surplus as number, strong: true },
    ];
    body.append(statementTable(incomeRows));
    const position = [
      ...[...s.currentAssets, ...s.fixedAssets].map((a) => ({ label: a.name, amount: a.amount as number })),
      { label: "Total assets", amount: s.totalAssets as number, strong: true },
      ...[...s.currentLiabilities, ...s.nonCurrentLiabilities].map((a) => ({ label: a.name, amount: -a.amount as number })),
      { label: "Total liabilities", amount: -s.totalLiabilities as number, strong: true },
      { label: "Net assets (accumulated funds)", amount: s.netAssets as number, strong: true },
    ];
    body.append(statementTable(position));
    body.append(
      labelled(
        "Mortgages, charges and other security interests over its property at the end of the year:",
        textArea(stored.securityInterests ?? "", 3, "Leave empty if there are none", (v) =>
          patch((d) => {
            if (v.trim() === "") delete d.securityInterests;
            else d.securityInterests = v;
          }, "security interests"),
        ),
      ),
    );
    for (const index of [0, 1] as const) {
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = "Full name";
      input.value = signers[index];
      input.addEventListener("change", () =>
        patch((d) => {
          const next: [string, string] = [...(d.signers ?? signers)] as [string, string];
          next[index] = input.value.trim();
          d.signers = next;
        }, "signers"),
      );
      body.append(labelled(`Committee member ${index + 1} signs:`, input));
    }
    const date = document.createElement("input");
    date.type = "date";
    date.value = stored.approvedOn ?? "";
    date.addEventListener("change", () =>
      patch((d) => {
        if (date.value === "") delete d.approvedOn;
        else d.approvedOn = date.value;
      }, "date approved"),
    );
    body.append(labelled("Approved on:", date));
    const problems = smallSocietyProblems({ statements: s, signers });
    const status = document.createElement("div");
    status.className = problems.length > 0 ? "journal-card journal-broken" : "journal-card";
    const line = document.createElement("p");
    line.className = "journal-narration";
    line.textContent = problems.length > 0 ? "Before these are ready:" : "Ready to print, sign and file.";
    status.append(line);
    for (const p of problems) status.append(note(p));
    const open = document.createElement("button");
    open.type = "button";
    open.className = "primary";
    open.textContent = "Open the statements to print or save as PDF";
    open.addEventListener("click", () => {
      const now = inputsFor(entity, year);
      openReport(
        smallSocietyReportHtml({
          name: entity.name,
          statements: s,
          securityInterests: now.securityInterests ?? "",
          signers,
          approvedOn: now.approvedOn,
        }),
      );
    });
    status.append(open);
    body.append(status);
    body.append(
      note(
        "These are the minimum a small society must show: income and expenditure, assets and liabilities at the end of the year (current and non-current), and any security over its property. The Companies Office has an optional Excel template that meets the same requirements. " +
          "The statements are filed as a PDF, dated and signed by two committee members, and the society confirms on filing which standard it used.",
      ),
    );
    return;
  }

  // Tier 3
  body.append(heading("2. Tier 3: performance report"));
  const t3 = stored.tier3 ?? {};
  const setT3 = (name: keyof Tier3Inputs, v: string): void =>
    patch((d) => {
      const next = { ...(d.tier3 ?? {}) } as Record<string, unknown>;
      if (v.trim() === "") delete next[name];
      else next[name] = v;
      d.tier3 = next as Tier3Inputs;
    }, `Tier 3: ${name}`);
  const area = (label: string, name: keyof Tier3Inputs, rows = 2, placeholder = ""): HTMLElement =>
    labelled(label, textArea((t3[name] as string | undefined) ?? "", rows, placeholder, (v) => setT3(name, v)));
  const m = tier3Statements({ journals, chart: state.chart, from: taxYearStart(year), to: taxYearEnd(year), mapping: state.ledger.tier4Lines ?? {}, only });
  const rowsOf = (groups: { label: string; total: number }[], totalLabel: string, total: number) => [
    ...groups.map((g) => ({ label: g.label, amount: g.total })),
    { label: totalLabel, amount: total, strong: true },
  ];
  body.append(Object.assign(document.createElement("h4"), { textContent: "Statement of financial performance" }));
  body.append(
    statementTable([
      ...rowsOf(m.revenue, "Total revenue", m.totalRevenue),
      ...rowsOf(m.expenses.map((g) => ({ label: g.label, total: -g.total })), "Total expenses", -m.totalExpenses),
      { label: m.surplus >= 0 ? "Surplus" : "Deficit", amount: m.surplus, strong: true },
      ...(m.incomeTax !== 0 ? [{ label: "Income tax", amount: -m.incomeTax }, { label: "Surplus (deficit) after tax", amount: m.surplusAfterTax, strong: true }] : []),
    ]),
  );
  body.append(Object.assign(document.createElement("h4"), { textContent: "Statement of financial position" }));
  body.append(
    statementTable([
      ...rowsOf([...m.currentAssets.map((g) => ({ label: `Current: ${g.label}`, total: g.total })), ...m.nonCurrentAssets.map((g) => ({ label: `Non-current: ${g.label}`, total: g.total }))], "Total assets", m.totalAssets),
      ...rowsOf([...m.currentLiabilities.map((g) => ({ label: `Current: ${g.label}`, total: -g.total })), ...m.nonCurrentLiabilities.map((g) => ({ label: `Non-current: ${g.label}`, total: -g.total }))], "Total liabilities", -m.totalLiabilities),
      { label: "Net assets", amount: m.netAssets, strong: true },
      ...m.funds.map((f) => ({ label: `Fund: ${f.label}`, amount: f.amount as number })),
    ]),
  );
  body.append(note("The statement of cash flows is the cash received and paid worked out for the Annual report page, with the same categories. Set which line each account is on there."));

  body.append(Object.assign(document.createElement("h4"), { textContent: "Entity information" }));
  body.append(
    area("Purpose or mission:", "purpose", 2, "The key difference the organisation is trying to make"),
    area("Structure (branches, divisions or units):", "structure", 2, "Leave empty if there are none"),
    area("Governance:", "governance", 2, "Who makes the key decisions"),
    area("Entities it controls:", "controlled", 1, "Leave empty if none"),
    area("Reliance on volunteers and donated goods or services:", "volunteers", 2),
  );
  body.append(Object.assign(document.createElement("h4"), { textContent: "Accounting policies and notes" }));
  body.append(
    area("Specific accounting policies:", "policies", 3, "Revenue, grants with conditions, fixed assets and depreciation, debtors"),
    area("Changes in accounting policies:", "policyChanges", 1, "Leave empty if none"),
    area("Deferred revenue: what the expectations are, and when they will be met:", "deferredRevenue", 2),
    area("Significant goods or services in kind provided to it:", "inKind", 2),
    area("Commitments (leases, purchases, grants promised):", "commitments", 2),
    area("Contingent liabilities and guarantees:", "contingent", 2),
    area("Funds: the purpose of each, and any restriction on it:", "reserves", 2),
    area("Assets used as security for loans:", "security", 2),
    area("Assets held on behalf of others:", "heldForOthers", 2),
  );
  body.append(note("What the organisation did, related parties, errors corrected and who approves the report are entered on the Annual report page, and used here."));

  const problems = tier3Problems({ statements: m, inputs: t3, performance: perf, gstRegistered: entity.gstRegistered === true });
  const status = document.createElement("div");
  status.className = problems.length > 0 ? "journal-card journal-broken" : "journal-card";
  const line = document.createElement("p");
  line.className = "journal-narration";
  line.textContent = problems.length > 0 ? "Before this report is ready:" : "Ready to print, sign and file.";
  status.append(line);
  const list = document.createElement("ul");
  for (const p of problems) list.append(Object.assign(document.createElement("li"), { textContent: p }));
  if (problems.length > 0) status.append(list);
  const open = document.createElement("button");
  open.type = "button";
  open.className = "primary";
  open.textContent = "Open the report to print or save as PDF";
  open.addEventListener("click", () => {
    const cash = statementFor(entity, year);
    const cashBefore = statementFor(entity, year - 1);
    const previousCash = cashBefore.reconciles ? cashBefore : statementFromFigures(year - 1, taxYearStart(year - 1), taxYearEnd(year - 1), perf.previousFigures ?? {});
    const previous = tier3Statements({ journals, chart: state.chart, from: taxYearStart(year - 1), to: taxYearEnd(year - 1), mapping: state.ledger.tier4Lines ?? {}, only });
    openReport(
      tier3ReportHtml({
        entity: { name: entity.name, legalForm: legalFormOf(entity) },
        gstRegistered: entity.gstRegistered === true,
        statements: m,
        previous: previous.totalRevenue !== 0 || previous.totalExpenses !== 0 ? previous : null,
        cash,
        previousCash,
        inputs: inputsFor(entity, year).tier3 ?? {},
        performance: performanceInputs(entity, year),
      }),
    );
  });
  status.append(open);
  body.append(status);
  body.append(
    note(
      "Built from the XRB's Tier 3 (NFP) Standard. Review the categories each account has fallen into, and have an accountant look at the policies and notes before the report is adopted.",
    ),
  );
}
