import { redraw } from "../app.js";
import { payrollAccounts, reclassify, record } from "../books.js";
import { $, state } from "../state.js";
import { savePart, partChanged } from "../store.js";
import { download, escapeHtml, note } from "../ui.js";
import {
  accountEntityKey,
  buildPayRun,
  cleanIrdNumber,
  emptyEntityModel,
  formatAmount,
  formatIrdNumber,
  generatePaydayFilingCsv,
  isValidIrdNumber,
  kiwiSaverDefaultRate,
  parseAmount,
  paydayFilingProblems,
} from "@nzosa/core";
import type {
  Account,
  Cents,
  Employee,
  ExtraPayKind,
  IsoDate,
  PayFrequency,
  PayLine,
  PayLineInput,
  TaxCode,
} from "@nzosa/core";
import type { PayrollData } from "../store.js";

/**
 * Payroll and payday filing.
 *
 * The figures are worked out in core, to Inland Revenue's payroll calculation
 * specification for the year of the payday, and tested against IR's own
 * casebook. This page takes the employees and the hours, keeps each pay run as
 * it was paid, makes the Employment Information file for myIR, and says where
 * the pay run posts in the books -- which it does by itself once the accounts
 * are chosen, the way depreciation does.
 */

type PayrollTab = "runs" | "employees";

let activeTab: PayrollTab = "runs";
let editingEmployeeId: string | null = null; // null = closed, "" = new, id = editing
let creatingPayRun = false;
let expandedPayRunId: string | null = null;

// Pay run form state
let payRunDraft = {
  frequency: "weekly" as PayFrequency,
  periodStart: "",
  periodEnd: "",
  payDate: "",
  inputs: new Map<string, Omit<PayLineInput, "employeeId">>(),
};

const TAX_CODE_OPTIONS: Array<{ code: TaxCode; label: string }> = [
  { code: "M", label: "M - Primary employment (no student loan)" },
  { code: "M SL", label: "M SL - Primary employment with student loan" },
  { code: "ME", label: "ME - Primary with Independent Earner Tax Credit (IETC)" },
  { code: "ME SL", label: "ME SL - Primary with IETC & student loan" },
  { code: "SB", label: "SB - Secondary income under $15,600 (10.5%)" },
  { code: "SB SL", label: "SB SL - Secondary under $15,600 with student loan" },
  { code: "S", label: "S - Secondary income $15,601 - $53,500 (17.5%)" },
  { code: "S SL", label: "S SL - Secondary $15,601 - $53,500 with student loan" },
  { code: "SH", label: "SH - Secondary income $53,501 - $78,100 (30%)" },
  { code: "SH SL", label: "SH SL - Secondary $53,501 - $78,100 with student loan" },
  { code: "ST", label: "ST - Secondary income $78,101 - $180,000 (33%)" },
  { code: "ST SL", label: "ST SL - Secondary $78,101 - $180,000 with student loan" },
  { code: "SA", label: "SA - Secondary income over $180,000 (39%)" },
  { code: "SA SL", label: "SA SL - Secondary over $180,000 with student loan" },
  { code: "CAE", label: "CAE - Casual agricultural employee (17.5%)" },
  { code: "EDW", label: "EDW - Election day worker (17.5%)" },
  { code: "NSW", label: "NSW - Non-resident seasonal worker (10.5%)" },
  { code: "ND", label: "ND - No notification: no IR330 or no IRD number (45%)" },
  { code: "STC", label: "STC - Tailored tax code, rate from IR's certificate" },
  { code: "WT", label: "WT - Schedular payments to a contractor, elected rate" },
];

/** The payroll as last saved, so a change can be recorded against it. */
let committed: string | null = null;

function getPayroll(): PayrollData {
  if (!state.ledger.payroll) {
    state.ledger.payroll = { employerIrd: "", employees: [], payRuns: [] };
  }
  return state.ledger.payroll;
}

async function commitPayroll(payroll: PayrollData, what = "Payroll changed"): Promise<void> {
  const before = committed === null ? null : (JSON.parse(committed) as PayrollData);
  state.ledger = { ...state.ledger, payroll };
  partChanged("payroll");
  state.persistent = await savePart(state.ledger, "payroll");
  await record("payroll", what, before, payroll);
  committed = JSON.stringify(payroll);
  // A pay run posts a journal, so what the books say has changed.
  reclassify();
  redraw("payroll");
}

/** The accounts a pay run posts to, and what to add when the chart has none. */
const PAYROLL_ACCOUNTS: {
  key: keyof NonNullable<PayrollData["accounts"]>;
  label: string;
  required: boolean;
  find: RegExp;
  make: { code: string; name: string; type: string };
}[] = [
  { key: "wages", label: "Wages and salaries (expense)", required: true, find: /^wages|salar/i, make: { code: "477", name: "Wages and Salaries", type: "Expense" } },
  { key: "kiwiSaverExpense", label: "KiwiSaver employer contributions (expense)", required: false, find: /kiwisaver.*(employer|contribution)|superannuation/i, make: { code: "478", name: "KiwiSaver Employer Contributions", type: "Expense" } },
  { key: "wagesPayable", label: "Wages payable (liability)", required: true, find: /wages.*payable|payroll.*clearing/i, make: { code: "804", name: "Wages Payable", type: "Current Liability" } },
  { key: "payePayable", label: "PAYE payable (liability)", required: true, find: /paye/i, make: { code: "825", name: "PAYE Payable", type: "Current Liability" } },
  { key: "kiwiSaverPayable", label: "KiwiSaver payable (liability)", required: false, find: /kiwisaver.*payable/i, make: { code: "826", name: "KiwiSaver Payable", type: "Current Liability" } },
];

/** Add whichever payroll accounts are not chosen, for the entity that employs. */
async function addPayrollAccounts(payroll: PayrollData, entityId: string): Promise<void> {
  const chart = [...state.chart];
  const model = state.ledger.entities ?? emptyEntityModel();
  const assigned = { ...model.accounts };
  const accounts = { ...(payroll.accounts ?? {}) };
  const added: string[] = [];
  for (const spec of PAYROLL_ACCOUNTS) {
    if ((accounts[spec.key] ?? "") !== "") continue;
    const used = new Set(chart.map((a) => a.code));
    let n = Number(spec.make.code);
    while (used.has(String(n))) n += 1;
    const account: Account = {
      code: String(n),
      name: spec.make.name,
      type: spec.make.type,
      taxCode: "No GST",
      description: "Added for payroll",
    };
    chart.push(account);
    if (entityId !== "") assigned[accountEntityKey(account)] = entityId;
    accounts[spec.key] = account.code;
    added.push(`${account.code} ${account.name}`);
  }
  if (added.length === 0) return;
  state.chart = chart;
  state.ledger = { ...state.ledger, chart, entities: { ...model, accounts: assigned } };
  state.persistent = await savePart(state.ledger, "chart", "entities");
  await record("chart", `Payroll accounts added: ${added.join(", ")}`, null, added);
  payroll.accounts = accounts;
  await commitPayroll(payroll, "Payroll accounts chosen");
}

/** Render employer IRD configuration bar at top. */
function renderEmployerBar(container: HTMLElement): void {
  const payroll = getPayroll();
  container.textContent = "";

  const bar = document.createElement("div");
  bar.className = "payroll-employer-bar";

  const label = document.createElement("label");
  label.className = "payroll-employer-label";
  label.innerHTML = "<strong>Employer IRD Number:</strong>";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "payroll-ird-input";
  input.placeholder = "e.g. 12-345-678";
  input.value = payroll.employerIrd ? formatIrdNumber(payroll.employerIrd) : "";

  const feedback = document.createElement("span");
  feedback.className = "payroll-ird-feedback";

  const validate = () => {
    const raw = input.value.trim();
    if (!raw) {
      feedback.textContent = "Required for IRD Payday Filing (EI CSV)";
      feedback.className = "payroll-ird-feedback hint";
      return;
    }
    if (isValidIrdNumber(raw)) {
      feedback.textContent = "✓ Valid IRD number";
      feedback.className = "payroll-ird-feedback valid";
    } else {
      feedback.textContent = "⚠ Invalid IRD number (modulus-11 check failed)";
      feedback.className = "payroll-ird-feedback invalid";
    }
  };

  input.addEventListener("input", validate);
  input.addEventListener("change", async () => {
    const raw = input.value.trim();
    payroll.employerIrd = cleanIrdNumber(raw);
    await commitPayroll(payroll);
  });

  validate();

  bar.append(label, input, feedback);
  container.append(bar);
  renderContact(container, payroll);
  renderAccounts(container, payroll);
}

/** Who IR should contact: the payday filing file will not go without it. */
function renderContact(container: HTMLElement, payroll: PayrollData): void {
  const row = document.createElement("div");
  row.className = "payroll-employer-bar";
  const box = (label: string, key: "name" | "phone" | "email", max: number): HTMLLabelElement => {
    const wrap = document.createElement("label");
    wrap.className = "payroll-employer-label";
    const input = document.createElement("input");
    input.type = key === "email" ? "email" : "text";
    input.value = payroll.contact?.[key] ?? "";
    input.maxLength = max;
    input.addEventListener("change", () => {
      const contact = payroll.contact ?? { name: "", phone: "", email: "" };
      payroll.contact = { ...contact, [key]: input.value.trim() };
      void commitPayroll(payroll, "Payroll contact changed");
    });
    wrap.append(`${label} `, input);
    return wrap;
  };
  row.append(box("Payroll contact", "name", 20), box("Phone", "phone", 12), box("Email", "email", 60));
  container.append(row);
}

/** Where pay runs post. Nothing posts until the three that must be there are chosen. */
function renderAccounts(container: HTMLElement, payroll: PayrollData): void {
  const details = document.createElement("details");
  details.className = "payroll-accounts";
  const ready = payrollAccounts() !== null;
  details.open = !ready;
  const summary = document.createElement("summary");
  summary.textContent = ready
    ? "Pay runs post to the books. The accounts they use"
    : "Pay runs are not in the books yet: choose the accounts they post to";
  details.append(summary);

  const chosen = payroll.accounts ?? {};
  const grid = document.createElement("div");
  grid.className = "payroll-form-grid";
  for (const spec of PAYROLL_ACCOUNTS) {
    const field = document.createElement("div");
    field.className = "payroll-form-field";
    const label = document.createElement("label");
    label.textContent = spec.required ? `${spec.label} *` : spec.label;
    const pick = document.createElement("select");
    const none = document.createElement("option");
    none.value = "";
    none.textContent = spec.required
      ? "Choose..."
      : spec.key === "kiwiSaverExpense"
        ? "None: use the wages account"
        : "None: use PAYE payable";
    pick.append(none);
    for (const account of state.chart.filter((a) => a.code !== "")) {
      const option = document.createElement("option");
      option.value = account.code;
      option.textContent = `${account.code} ${account.name}`;
      option.selected = account.code === (chosen[spec.key] ?? "");
      pick.append(option);
    }
    // A likely account, offered rather than chosen.
    if ((chosen[spec.key] ?? "") === "") {
      const guess = state.chart.find((a) => spec.find.test(a.name));
      if (guess !== undefined) label.textContent += ` (perhaps ${guess.code} ${guess.name})`;
    }
    pick.addEventListener("change", () => {
      payroll.accounts = { ...(payroll.accounts ?? {}), [spec.key]: pick.value };
      void commitPayroll(payroll, "Payroll accounts chosen");
    });
    field.append(label, pick);
    grid.append(field);
  }
  details.append(grid);

  const missing = PAYROLL_ACCOUNTS.filter((spec) => (chosen[spec.key] ?? "") === "");
  if (missing.length > 0) {
    const model = state.ledger.entities ?? emptyEntityModel();
    const employers = model.entities.filter((e) => e.kind !== "personal");
    const row = document.createElement("div");
    row.className = "payroll-form-actions";
    const entity = document.createElement("select");
    for (const e of employers) {
      const option = document.createElement("option");
      option.value = e.id;
      option.textContent = e.name;
      entity.append(option);
    }
    const add = document.createElement("button");
    add.type = "button";
    add.textContent = `Add the ${missing.length} not chosen to the chart`;
    add.addEventListener("click", () => {
      add.disabled = true;
      void addPayrollAccounts(payroll, entity.value);
    });
    if (employers.length > 0) row.append("For ", entity, " ");
    row.append(add);
    details.append(row);
  }

  details.append(
    note(
      "Each pay run posts on its payday: gross pay and the employer's KiwiSaver as expenses, " +
        "net pay to wages payable, and PAYE, student loan, child support, ESCT and KiwiSaver to " +
        "the payables. Then code the bank payment of net pay to wages payable, and the payment " +
        "to Inland Revenue to PAYE payable (and KiwiSaver payable). Coding either to wages " +
        "would count the wages twice.",
    ),
  );
  container.append(details);
}

/** Render employee add/edit form. */
function renderEmployeeEditor(container: HTMLElement): void {
  container.textContent = "";
  if (editingEmployeeId === null) return;

  const payroll = getPayroll();
  const existing =
    editingEmployeeId === ""
      ? undefined
      : payroll.employees.find((e) => e.id === editingEmployeeId);

  const card = document.createElement("div");
  card.className = "payroll-card payroll-editor-card";

  const title = document.createElement("h3");
  title.textContent = existing ? `Edit Employee: ${existing.name}` : "Add New Employee";
  card.append(title);

  const grid = document.createElement("div");
  grid.className = "payroll-form-grid";

  // Helper field
  const createField = (
    labelText: string,
    element: HTMLElement,
    hintText?: string,
    colSpan = 1,
  ): HTMLElement => {
    const field = document.createElement("div");
    field.className = `payroll-form-field${colSpan > 1 ? ` span-${colSpan}` : ""}`;
    const lbl = document.createElement("label");
    lbl.textContent = labelText;
    field.append(lbl, element);
    if (hintText) {
      const hint = document.createElement("small");
      hint.className = "field-hint";
      hint.textContent = hintText;
      field.append(hint);
    }
    return field;
  };

  // Name
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.placeholder = "Full Legal Name";
  nameInput.value = existing?.name ?? "";
  grid.append(createField("Employee Name *", nameInput, "As registered with Inland Revenue", 2));

  // IRD Number
  const irdInput = document.createElement("input");
  irdInput.type = "text";
  irdInput.placeholder = "e.g. 12-345-678";
  irdInput.value = existing?.irdNumber ? formatIrdNumber(existing.irdNumber) : "";
  const irdFeedback = document.createElement("div");
  irdFeedback.className = "payroll-ird-feedback";

  const checkIrd = () => {
    const val = irdInput.value.trim();
    if (!val) {
      irdFeedback.textContent = "None given yet: taxed at the no-notification rate (45%)";
      irdFeedback.className = "payroll-ird-feedback hint";
    } else if (isValidIrdNumber(val)) {
      irdFeedback.textContent = "✓ Valid NZ IRD number";
      irdFeedback.className = "payroll-ird-feedback valid";
    } else {
      irdFeedback.textContent = "⚠ Invalid IRD number";
      irdFeedback.className = "payroll-ird-feedback invalid";
    }
  };
  irdInput.addEventListener("input", checkIrd);
  checkIrd();

  const irdWrap = document.createElement("div");
  irdWrap.append(irdInput, irdFeedback);
  grid.append(createField("IRD Number", irdWrap, "Checked against IR's check digit"));

  // Tax Code
  const taxCodeSelect = document.createElement("select");
  for (const opt of TAX_CODE_OPTIONS) {
    const o = document.createElement("option");
    o.value = opt.code;
    o.textContent = opt.label;
    o.selected = existing?.taxCode === opt.code;
    taxCodeSelect.append(o);
  }
  grid.append(createField("Tax Code (IR330) *", taxCodeSelect, "From employee's IR330 declaration", 2));

  // The rate a WT payee elected on their IR330C, or the one on an STC certificate.
  const rateOfTax = document.createElement("input");
  rateOfTax.type = "number";
  rateOfTax.step = "0.5";
  rateOfTax.min = "0";
  rateOfTax.max = "100";
  rateOfTax.value = existing?.taxRate !== undefined ? String(Math.round(existing.taxRate * 1000) / 10) : "";
  const rateOfTaxField = createField(
    "Tax rate %",
    rateOfTax,
    "WT: the rate on their IR330C (45% if none). STC: the rate on IR's certificate, which already includes the ACC earners' levy.",
  );
  const syncRate = () => {
    rateOfTaxField.style.display = taxCodeSelect.value === "WT" || taxCodeSelect.value === "STC" ? "" : "none";
  };
  taxCodeSelect.addEventListener("change", syncRate);
  syncRate();
  grid.append(rateOfTaxField);

  // Student loan certificates and choices, and a higher rate for extra pays.
  const percentBox = (value: number | undefined): HTMLInputElement => {
    const box = document.createElement("input");
    box.type = "number";
    box.step = "0.5";
    box.min = "0";
    box.max = "100";
    box.value = value !== undefined ? String(Math.round(value * 1000) / 10) : "";
    return box;
  };
  const sdr = percentBox(existing?.studentLoanRate);
  const slcir = percentBox(existing?.slcirRate);
  const slbor = document.createElement("input");
  slbor.type = "text";
  slbor.placeholder = "0.00";
  slbor.value = existing?.slborAmount ? (existing.slborAmount / 100).toFixed(2) : "";
  const electedRate = document.createElement("select");
  for (const [value, caption] of [
    ["", "The rate its pay falls in"],
    ["0.175", "17.5%"],
    ["0.3", "30%"],
    ["0.33", "33%"],
    ["0.39", "39%"],
  ] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = caption;
    option.selected = String(existing?.extraPayRate ?? "") === value;
    electedRate.append(option);
  }
  grid.append(
    createField("Student loan special rate %", sdr, "From an SDR certificate; empty for the standard 12%, 0 for an exemption"),
    createField("Commissioner deductions %", slcir, "If IR has asked for extra (SLCIR), at most 5%"),
    createField("Voluntary extra student loan", slbor, "An amount each pay (SLBOR)"),
    createField("Extra pays taxed at", electedRate, "An employee can choose a higher rate for bonuses"),
  );

  // Pay Frequency
  const freqSelect = document.createElement("select");
  for (const f of ["weekly", "fortnightly", "four-weekly", "monthly"] as const) {
    const o = document.createElement("option");
    o.value = f;
    o.textContent = f.charAt(0).toUpperCase() + f.slice(1);
    o.selected = (existing?.payFrequency ?? "fortnightly") === f;
    freqSelect.append(o);
  }
  grid.append(createField("Pay Frequency *", freqSelect));

  // Remuneration Type (Hourly vs Salary)
  const isSalary = existing?.annualSalary !== undefined && existing.annualSalary > 0;
  const payTypeSelect = document.createElement("select");
  const optHourly = document.createElement("option");
  optHourly.value = "hourly";
  optHourly.textContent = "Hourly Wage";
  optHourly.selected = !isSalary;
  const optSalary = document.createElement("option");
  optSalary.value = "salary";
  optSalary.textContent = "Annual Salary";
  optSalary.selected = isSalary;
  payTypeSelect.append(optHourly, optSalary);

  // Hourly Rate & Hours
  const rateInput = document.createElement("input");
  rateInput.type = "text";
  rateInput.placeholder = "e.g. 35.00";
  rateInput.value = existing?.hourlyRate ? (existing.hourlyRate / 100).toFixed(2) : "30.00";

  const hoursInput = document.createElement("input");
  hoursInput.type = "number";
  hoursInput.step = "0.5";
  hoursInput.placeholder = "e.g. 40";
  hoursInput.value = String(existing?.standardHours ?? 40);

  // Annual Salary
  const salaryInput = document.createElement("input");
  salaryInput.type = "text";
  salaryInput.placeholder = "e.g. 75000.00";
  salaryInput.value = existing?.annualSalary ? (existing.annualSalary / 100).toFixed(2) : "65000.00";

  const rateFieldWrap = createField("Hourly Rate ($/hr)", rateInput);
  const hoursFieldWrap = createField("Standard Hours per Period", hoursInput);
  const salaryFieldWrap = createField("Annual Salary ($)", salaryInput);

  const syncPayType = () => {
    const type = payTypeSelect.value;
    if (type === "hourly") {
      rateFieldWrap.style.display = "";
      hoursFieldWrap.style.display = "";
      salaryFieldWrap.style.display = "none";
    } else {
      rateFieldWrap.style.display = "none";
      hoursFieldWrap.style.display = "none";
      salaryFieldWrap.style.display = "";
    }
  };
  payTypeSelect.addEventListener("change", syncPayType);
  syncPayType();

  grid.append(createField("Pay Structure", payTypeSelect), rateFieldWrap, hoursFieldWrap, salaryFieldWrap);

  // KiwiSaver Employee Rate
  // 3.5% is the default from 1 April 2026; 3% only with IR's approval of a
  // temporary rate reduction.
  const defaultRate = kiwiSaverDefaultRate(new Date().toISOString().slice(0, 10));
  const ksSelect = document.createElement("select");
  const ksRates = [
    { rate: 0, label: "0% (not a member, or on a savings suspension)" },
    { rate: 0.03, label: "3% (only with an approved rate reduction)" },
    { rate: 0.035, label: "3.5% (the default from 1 April 2026)" },
    { rate: 0.04, label: "4%" },
    { rate: 0.06, label: "6%" },
    { rate: 0.08, label: "8%" },
    { rate: 0.1, label: "10%" },
  ];
  for (const k of ksRates) {
    const o = document.createElement("option");
    o.value = String(k.rate);
    o.textContent = k.label;
    o.selected = (existing?.kiwiSaverRate ?? defaultRate) === k.rate;
    ksSelect.append(o);
  }
  grid.append(createField("KiwiSaver Employee Deduction", ksSelect));

  // KiwiSaver Employer Rate
  const ksEmployerSelect = document.createElement("select");
  const ksEmployerRates = [
    { rate: 0.035, label: "3.5% (the compulsory rate from 1 April 2026)" },
    { rate: 0.03, label: "3% (the employee has an approved rate reduction)" },
    { rate: 0, label: "0% (not a member)" },
    { rate: 0.04, label: "4%" },
    { rate: 0.06, label: "6%" },
  ];
  for (const k of ksEmployerRates) {
    const o = document.createElement("option");
    o.value = String(k.rate);
    o.textContent = k.label;
    o.selected = (existing?.kiwiSaverEmployerRate ?? defaultRate) === k.rate;
    ksEmployerSelect.append(o);
  }
  grid.append(createField("KiwiSaver Employer Contribution", ksEmployerSelect));

  // Auto-sync employer KS when employee KS changes
  ksSelect.addEventListener("change", () => {
    const rate = Number(ksSelect.value);
    if (rate === 0) ksEmployerSelect.value = "0";
    else if (rate === 0.03) ksEmployerSelect.value = "0.03";
    else if (Number(ksEmployerSelect.value) <= 0.035) ksEmployerSelect.value = String(defaultRate);
  });

  // ESCT Rate
  const esctSelect = document.createElement("select");
  // The bands from 1 April 2025, on last year's pay plus the employer's gross
  // contributions (or an estimate of this year's for somebody new).
  const esctTiers = [
    { rate: 0, label: "Work it out from this employee's pay" },
    { rate: 0.105, label: "10.5% (up to $18,720)" },
    { rate: 0.175, label: "17.5% ($18,721 to $64,200)" },
    { rate: 0.3, label: "30% ($64,201 to $93,720)" },
    { rate: 0.33, label: "33% ($93,721 to $216,000)" },
    { rate: 0.39, label: "39% (over $216,000)" },
  ];
  for (const t of esctTiers) {
    const o = document.createElement("option");
    o.value = String(t.rate);
    o.textContent = t.label;
    o.selected = (existing?.esctRate ?? 0) === t.rate;
    esctSelect.append(o);
  }
  grid.append(
    createField(
      "ESCT Rate",
      esctSelect,
      "Set each April from last year's pay plus the employer's KiwiSaver contributions",
    ),
  );

  // Section RD 68: the employer's contribution paid as salary instead.
  const asSalary = document.createElement("select");
  for (const [value, caption] of [
    ["", "Employer's cost, taxed by ESCT (usual)"],
    ["gross", "Paid as salary under PAYE: full contribution to the fund"],
    ["net", "Paid as salary under PAYE: tax on it taken out of it"],
  ] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = caption;
    option.selected = (existing?.employerKiwiSaverAsSalary ?? "") === value;
    asSalary.append(option);
  }
  grid.append(
    createField(
      "Employer KiwiSaver",
      asSalary,
      "Only where the employment agreement pays the contribution as part of salary. It is then " +
        "added to pay and taxed by PAYE, with no ESCT, and sent to the fund out of pay.",
      2,
    ),
  );

  // Bank Account
  const bankInput = document.createElement("input");
  bankInput.type = "text";
  bankInput.placeholder = "XX-XXXX-XXXXXXX-XX";
  bankInput.value = existing?.bankAccount ?? "";
  grid.append(createField("Bank Account Number", bankInput, "For direct credit payments"));

  // Start Date
  const startInput = document.createElement("input");
  startInput.type = "date";
  startInput.value = existing?.startDate ?? "";
  grid.append(createField("Start Date", startInput, "Optional"));

  // Finish Date
  const finishInput = document.createElement("input");
  finishInput.type = "date";
  finishInput.value = existing?.finishDate ?? "";
  grid.append(createField("Finish Date", finishInput, "Leave blank if currently employed"));

  card.append(grid);

  // Error message container
  const errorMsg = document.createElement("p");
  errorMsg.className = "payroll-form-error";
  errorMsg.hidden = true;
  card.append(errorMsg);

  // Action buttons
  const actions = document.createElement("div");
  actions.className = "payroll-form-actions";

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "primary";
  saveBtn.textContent = existing ? "Save Changes" : "Create Employee";

  saveBtn.addEventListener("click", async () => {
    const name = nameInput.value.trim();
    const ird = cleanIrdNumber(irdInput.value.trim());

    if (!name) {
      errorMsg.textContent = "Please provide the employee's full name.";
      errorMsg.hidden = false;
      return;
    }
    if (ird !== "" && !isValidIrdNumber(ird)) {
      errorMsg.textContent = "That IRD number does not pass IR's check digit. Leave it empty if they have not given one.";
      errorMsg.hidden = false;
      return;
    }
    const taxRate =
      taxCodeSelect.value === "WT" || taxCodeSelect.value === "STC"
        ? rateOfTax.value.trim() === ""
          ? undefined
          : Number(rateOfTax.value) / 100
        : undefined;
    if (taxCodeSelect.value === "STC" && (taxRate === undefined || !Number.isFinite(taxRate))) {
      errorMsg.textContent = "A tailored tax code needs the rate from IR's certificate.";
      errorMsg.hidden = false;
      return;
    }

    const payType = payTypeSelect.value;
    const hourlyRate = payType === "hourly" ? (parseAmount(rateInput.value.trim()) ?? undefined) : undefined;
    const annualSalary = payType === "salary" ? (parseAmount(salaryInput.value.trim()) ?? undefined) : undefined;
    const standardHours = payType === "hourly" ? Number(hoursInput.value) || 40 : undefined;

    const empId = existing?.id ?? `emp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const emp: Employee = {
      id: empId,
      name,
      irdNumber: ird,
      taxCode: taxCodeSelect.value as TaxCode,
      payFrequency: freqSelect.value as PayFrequency,
      hourlyRate,
      annualSalary,
      standardHours,
      kiwiSaverRate: Number(ksSelect.value),
      kiwiSaverEmployerRate: Number(ksEmployerSelect.value),
      esctRate: Number(esctSelect.value),
      ...(taxRate !== undefined ? { taxRate } : {}),
      ...(sdr.value.trim() !== "" ? { studentLoanRate: Number(sdr.value) / 100 } : {}),
      ...(slcir.value.trim() !== "" && Number(slcir.value) > 0 ? { slcirRate: Math.min(5, Number(slcir.value)) / 100 } : {}),
      ...(slbor.value.trim() !== "" ? { slborAmount: parseAmount(slbor.value.trim()) ?? 0 } : {}),
      ...(electedRate.value !== "" ? { extraPayRate: Number(electedRate.value) } : {}),
      ...(asSalary.value !== "" ? { employerKiwiSaverAsSalary: asSalary.value as "gross" | "net" } : {}),
      bankAccount: bankInput.value.trim(),
      startDate: (startInput.value || undefined) as IsoDate | undefined,
      finishDate: (finishInput.value || undefined) as IsoDate | undefined,
    };

    const updated = existing
      ? payroll.employees.map((e) => (e.id === empId ? emp : e))
      : [...payroll.employees, emp];

    payroll.employees = updated;
    editingEmployeeId = null;
    await commitPayroll(payroll, existing ? `${name}: employee details changed` : `${name}: employee added`);
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => {
    editingEmployeeId = null;
    renderEmployeeEditor(container);
  });

  actions.append(saveBtn, cancelBtn);
  card.append(actions);

  container.append(card);
}

/** Render employee list table. */
function renderEmployeesTable(container: HTMLElement): void {
  const payroll = getPayroll();
  container.textContent = "";

  if (payroll.employees.length === 0) {
    const empty = document.createElement("div");
    empty.className = "payroll-empty";
    empty.innerHTML = `
      <p>No employees set up yet.</p>
      <p>Add your employees with their IRD number, tax code, and KiwiSaver details to run payroll.</p>
    `;
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "primary";
    addBtn.textContent = "+ Add Employee";
    addBtn.addEventListener("click", () => {
      editingEmployeeId = "";
      renderEmployeeEditor($("payroll-editor"));
    });
    empty.append(addBtn);
    container.append(empty);
    return;
  }

  const tableWrap = document.createElement("div");
  tableWrap.className = "table-scroll";

  const table = document.createElement("table");
  table.className = "payroll-table";

  table.innerHTML = `
    <thead>
      <tr>
        <th>Employee Name</th>
        <th>IRD Number</th>
        <th>Tax Code</th>
        <th>Pay Frequency</th>
        <th>Remuneration</th>
        <th>KiwiSaver</th>
        <th>Bank Account</th>
        <th>Status</th>
        <th style="text-align: right;">Actions</th>
      </tr>
    </thead>
  `;

  const tbody = document.createElement("tbody");
  for (const emp of payroll.employees) {
    const tr = document.createElement("tr");

    const rateText = emp.annualSalary
      ? `${formatAmount(emp.annualSalary)}/yr`
      : emp.hourlyRate
        ? `${formatAmount(emp.hourlyRate)}/hr (${emp.standardHours ?? 40}h)`
        : "--";

    const percent = (rate: number): string => `${Math.round(rate * 1000) / 10}%`;
    const ksText = emp.kiwiSaverRate > 0
      ? `${percent(emp.kiwiSaverRate)} (employer ${percent(emp.kiwiSaverEmployerRate)})`
      : "Not a member";

    const isFinished = emp.finishDate && emp.finishDate <= new Date().toISOString().slice(0, 10);
    const statusBadge = isFinished
      ? '<span class="payroll-badge finished">Finished</span>'
      : '<span class="payroll-badge active">Active</span>';

    tr.innerHTML = `
      <td><strong>${escapeHtml(emp.name)}</strong></td>
      <td><code>${emp.irdNumber ? formatIrdNumber(emp.irdNumber) : "none (ND)"}</code></td>
      <td><span class="payroll-tax-badge">${escapeHtml(emp.taxCode)}</span></td>
      <td style="text-transform: capitalize;">${escapeHtml(emp.payFrequency)}</td>
      <td>${rateText}</td>
      <td>${ksText}</td>
      <td><code>${escapeHtml(emp.bankAccount || "--")}</code></td>
      <td>${statusBadge}</td>
      <td style="text-align: right; white-space: nowrap;">
        <button type="button" class="payroll-btn edit-emp" title="Edit employee">Edit</button>
        <button type="button" class="payroll-btn danger del-emp" title="Delete employee">Delete</button>
      </td>
    `;

    tr.querySelector(".edit-emp")?.addEventListener("click", () => {
      editingEmployeeId = emp.id;
      renderEmployeeEditor($("payroll-editor"));
      $("payroll-editor").scrollIntoView({ behavior: "smooth" });
    });

    tr.querySelector(".del-emp")?.addEventListener("click", async () => {
      if (confirm(`Are you sure you want to remove employee "${emp.name}"?`)) {
        payroll.employees = payroll.employees.filter((e) => e.id !== emp.id);
        await commitPayroll(payroll, `${emp.name}: employee removed`);
      }
    });

    tbody.append(tr);
  }

  table.append(tbody);
  tableWrap.append(table);
  container.append(tableWrap);
}

/** Rows open for extras, by employee. */
const extrasOpen = new Set<string>();

/**
 * The less common parts of one employee's pay: an extra pay, payroll giving,
 * a share scheme benefit, corrections to an earlier pay -- and what the
 * figures say about them.
 */
function extrasRow(employeeId: string, line: PayLine, refresh: () => void): HTMLTableRowElement {
  const tr = document.createElement("tr");
  tr.className = "payroll-extras-row";
  const td = document.createElement("td");
  td.colSpan = 9;
  tr.append(td);
  const held = payRunDraft.inputs.get(employeeId) ?? {};
  const set = (patch: Partial<Omit<PayLineInput, "employeeId">>): void => {
    payRunDraft.inputs.set(employeeId, { ...(payRunDraft.inputs.get(employeeId) ?? {}), ...patch });
    refresh();
  };

  const said: string[] = [];
  if (line.extraPay) {
    said.push(`Extra pay ${formatAmount(line.extraPay)} included in gross${line.lumpSumLowRate ? ", taxed at the lowest rate (flagged on the EI)" : ""}.`);
  }
  if (line.childSupportCode === "P") said.push("Child support cut to protect 60% of net pay (code P on the EI).");
  if (line.donationCredit) said.push(`Payroll giving credit ${formatAmount(line.donationCredit)} comes off what IR is paid.`);
  if (line.slcir || line.slbor) said.push(`Extra student loan: ${formatAmount((line.slcir ?? 0) + (line.slbor ?? 0))}.`);

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "payroll-btn";
  const open = extrasOpen.has(employeeId);
  toggle.textContent = open ? "Hide extras" : "Extras: bonus, redundancy, giving, corrections…";
  toggle.addEventListener("click", () => {
    if (open) extrasOpen.delete(employeeId);
    else extrasOpen.add(employeeId);
    refresh();
  });
  td.append(toggle);
  if (said.length > 0) {
    const small = document.createElement("small");
    small.textContent = ` ${said.join(" ")}`;
    td.append(small);
  }
  if (!open) return tr;

  const money = (label: string, value: Cents | undefined, onSet: (c: Cents | undefined) => void): HTMLLabelElement => {
    const wrap = document.createElement("label");
    wrap.className = "year-end-field";
    const box = document.createElement("input");
    box.type = "text";
    box.className = "payroll-tiny-input";
    box.placeholder = "0.00";
    box.value = value ? (value / 100).toFixed(2) : "";
    box.addEventListener("change", () => onSet(parseAmount(box.value.trim()) ?? undefined));
    wrap.append(`${label} `, box);
    return wrap;
  };
  const kind = document.createElement("select");
  for (const [value, caption] of [
    ["bonus", "Bonus or other lump sum"],
    ["termination", "Paid on leaving (e.g. final holiday pay)"],
    ["redundancy", "Redundancy or retiring payment"],
  ] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = caption;
    option.selected = (held.extraPayKind ?? "bonus") === value;
    kind.append(option);
  }
  kind.addEventListener("change", () => set({ extraPayKind: kind.value as ExtraPayKind }));
  const kindWrap = document.createElement("label");
  kindWrap.className = "year-end-field";
  kindWrap.append("Kind ", kind);

  const box = document.createElement("div");
  box.append(
    money("Extra pay", held.extraPay, (c) => set({ extraPay: c })),
    kindWrap,
    money("Payroll giving donation", held.payrollDonation, (c) => set({ payrollDonation: c })),
    money("Share scheme benefit", held.ess, (c) => set({ ess: c })),
    money("Earlier pay: gross correction", held.priorGross, (c) => set({ priorGross: c })),
    money("PAYE correction", held.priorPaye, (c) => set({ priorPaye: c })),
    note(
      "An extra pay is taxed at the rate its annualised pay falls in: the last four weeks times 13 " +
        "for a bonus, the last two pay periods for one paid on leaving. Redundancy carries no ACC " +
        "levy or KiwiSaver. Share scheme benefits are reported only; no PAYE is withheld on them here.",
    ),
  );
  td.append(box);
  return tr;
}

/** Render Pay Run Creation Form with Live Calculations. */
function renderPayRunCreator(container: HTMLElement): void {
  container.textContent = "";
  if (!creatingPayRun) return;

  const payroll = getPayroll();
  if (payroll.employees.length === 0) {
    alert("Please add at least one employee before running payroll.");
    creatingPayRun = false;
    return;
  }

  const card = document.createElement("div");
  card.className = "payroll-card payroll-run-creator";

  const head = document.createElement("div");
  head.className = "payroll-creator-head";
  head.innerHTML = "<h3>New Pay Run &amp; Payday Filing</h3>";
  card.append(head);

  // Default dates
  const today = new Date().toISOString().slice(0, 10);
  if (!payRunDraft.payDate) payRunDraft.payDate = today;
  if (!payRunDraft.periodEnd) payRunDraft.periodEnd = today;
  if (!payRunDraft.periodStart) {
    const d = new Date();
    d.setDate(d.getDate() - 13);
    payRunDraft.periodStart = d.toISOString().slice(0, 10);
  }

  // Header controls
  const controls = document.createElement("div");
  controls.className = "payroll-run-controls";

  const startWrap = document.createElement("label");
  startWrap.innerHTML = "<span>Period Start:</span>";
  const startInput = document.createElement("input");
  startInput.type = "date";
  startInput.value = payRunDraft.periodStart;
  startInput.addEventListener("change", () => {
    payRunDraft.periodStart = startInput.value;
  });
  startWrap.append(startInput);

  const endWrap = document.createElement("label");
  endWrap.innerHTML = "<span>Period End:</span>";
  const endInput = document.createElement("input");
  endInput.type = "date";
  endInput.value = payRunDraft.periodEnd;
  endInput.addEventListener("change", () => {
    payRunDraft.periodEnd = endInput.value;
  });
  endWrap.append(endInput);

  const payDateWrap = document.createElement("label");
  payDateWrap.innerHTML = "<span>Pay Date:</span>";
  const payDateInput = document.createElement("input");
  payDateInput.type = "date";
  payDateInput.value = payRunDraft.payDate;
  payDateInput.addEventListener("change", () => {
    payRunDraft.payDate = payDateInput.value;
  });
  payDateWrap.append(payDateInput);

  controls.append(startWrap, endWrap, payDateWrap);
  card.append(controls);

  // Table of employees and calculated lines
  const tableWrap = document.createElement("div");
  tableWrap.className = "table-scroll";

  const table = document.createElement("table");
  table.className = "payroll-table payroll-run-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>Employee</th>
        <th>Tax Code</th>
        <th>Hours / Gross</th>
        <th>Child Support</th>
        <th style="text-align: right;">Gross Pay</th>
        <th style="text-align: right;">PAYE</th>
        <th style="text-align: right;">KiwiSaver (EE)</th>
        <th style="text-align: right;">Student Loan</th>
        <th style="text-align: right;">Net Pay</th>
      </tr>
    </thead>
  `;

  const tbody = document.createElement("tbody");
  const totalsRow = document.createElement("tr");
  totalsRow.className = "payroll-totals-row";

  const activeEmployees = payroll.employees.filter((e) => {
    if (!e.finishDate) return true;
    return e.finishDate >= payRunDraft.periodStart;
  });

  const recalculateAndRenderRows = () => {
    tbody.textContent = "";

    const inputs: PayLineInput[] = [];
    for (const emp of activeEmployees) {
      inputs.push({ ...(payRunDraft.inputs.get(emp.id) ?? {}), employeeId: emp.id });
    }

    const previewRun = buildPayRun({
      employerIrd: payroll.employerIrd ?? "",
      periodStart: payRunDraft.periodStart as IsoDate,
      periodEnd: payRunDraft.periodEnd as IsoDate,
      payDate: payRunDraft.payDate as IsoDate,
      employees: activeEmployees,
      inputs,
      history: payroll.payRuns,
    });

    for (let i = 0; i < activeEmployees.length; i++) {
      const emp = activeEmployees[i]!;
      const line = previewRun.lines[i]!;
      const tr = document.createElement("tr");

      // Employee Info
      const nameTd = document.createElement("td");
      nameTd.innerHTML = `<strong>${escapeHtml(emp.name)}</strong><br><small class="text-muted">${formatIrdNumber(emp.irdNumber)}</small>`;

      // Tax Code
      const codeTd = document.createElement("td");
      codeTd.innerHTML = `<span class="payroll-tax-badge">${escapeHtml(emp.taxCode)}</span>`;

      // Hours or Gross input
      const hoursTd = document.createElement("td");
      if (emp.annualSalary) {
        hoursTd.innerHTML = `<small>Salary: ${formatAmount(emp.annualSalary)}/yr</small>`;
      } else {
        const hInput = document.createElement("input");
        hInput.type = "number";
        hInput.step = "0.5";
        hInput.className = "payroll-tiny-input";
        const currentHours = payRunDraft.inputs.get(emp.id)?.hoursWorked ?? emp.standardHours ?? 40;
        hInput.value = String(currentHours);
        hInput.addEventListener("input", () => {
          const val = Number(hInput.value) || 0;
          const current = payRunDraft.inputs.get(emp.id) ?? {};
          payRunDraft.inputs.set(emp.id, { ...current, hoursWorked: val });
          recalculateAndRenderRows();
        });
        hoursTd.append(hInput, document.createTextNode(" hrs"));
      }

      // Child support input
      const csTd = document.createElement("td");
      const csInput = document.createElement("input");
      csInput.type = "text";
      csInput.className = "payroll-tiny-input";
      csInput.placeholder = "0.00";
      const currentCs = payRunDraft.inputs.get(emp.id)?.childSupport;
      csInput.value = currentCs ? (currentCs / 100).toFixed(2) : "";
      csInput.addEventListener("change", () => {
        const cents = parseAmount(csInput.value.trim()) ?? undefined;
        const current = payRunDraft.inputs.get(emp.id) ?? {};
        payRunDraft.inputs.set(emp.id, { ...current, childSupport: cents });
        recalculateAndRenderRows();
      });
      csTd.append(csInput);

      // Calculations
      const grossTd = document.createElement("td");
      grossTd.style.textAlign = "right";
      grossTd.textContent = formatAmount(line.gross);

      const payeTd = document.createElement("td");
      payeTd.style.textAlign = "right";
      payeTd.textContent = formatAmount(line.paye);

      const ksTd = document.createElement("td");
      ksTd.style.textAlign = "right";
      ksTd.textContent = formatAmount(line.kiwiSaverEmployee);

      const slTd = document.createElement("td");
      slTd.style.textAlign = "right";
      slTd.textContent = formatAmount(line.studentLoan);

      const netTd = document.createElement("td");
      netTd.style.textAlign = "right";
      netTd.innerHTML = `<strong>${formatAmount(line.netPay)}</strong>`;

      tr.append(nameTd, codeTd, hoursTd, csTd, grossTd, payeTd, ksTd, slTd, netTd);
      tbody.append(tr);
      tbody.append(extrasRow(emp.id, line, recalculateAndRenderRows));
    }

    // Totals row
    totalsRow.innerHTML = `
      <td colspan="4"><strong>Totals (${activeEmployees.length} employees)</strong></td>
      <td style="text-align: right;"><strong>${formatAmount(previewRun.totalGross)}</strong></td>
      <td style="text-align: right;"><strong>${formatAmount(previewRun.totalPaye)}</strong></td>
      <td style="text-align: right;"><strong>${formatAmount(previewRun.totalKiwiSaverEmployee)}</strong></td>
      <td style="text-align: right;"><strong>${formatAmount(previewRun.totalStudentLoan)}</strong></td>
      <td style="text-align: right;"><strong>${formatAmount(previewRun.totalNetPay)}</strong></td>
    `;
    tbody.append(totalsRow);
  };

  recalculateAndRenderRows();

  table.append(tbody);
  tableWrap.append(table);
  card.append(tableWrap);

  // Bottom action buttons
  const actions = document.createElement("div");
  actions.className = "payroll-form-actions";

  const confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.className = "primary";
  confirmBtn.textContent = "Confirm & Save Pay Run";

  confirmBtn.addEventListener("click", async () => {
    if (!payroll.employerIrd || !isValidIrdNumber(payroll.employerIrd)) {
      alert("Please configure a valid Employer IRD Number at the top of the page before saving a pay run.");
      return;
    }
    if (!payRunDraft.periodStart || !payRunDraft.periodEnd || !payRunDraft.payDate) {
      alert("Please ensure period start, period end, and pay date are all specified.");
      return;
    }

    const inputs: PayLineInput[] = [];
    for (const emp of activeEmployees) {
      inputs.push({ ...(payRunDraft.inputs.get(emp.id) ?? {}), employeeId: emp.id });
    }

    const payRun = buildPayRun({
      employerIrd: payroll.employerIrd,
      periodStart: payRunDraft.periodStart as IsoDate,
      periodEnd: payRunDraft.periodEnd as IsoDate,
      payDate: payRunDraft.payDate as IsoDate,
      employees: activeEmployees,
      inputs,
      history: payroll.payRuns,
    });

    payroll.payRuns.unshift(payRun);
    creatingPayRun = false;
    payRunDraft.inputs.clear();
    await commitPayroll(payroll, `Pay run for ${payRun.payDate}`);
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => {
    creatingPayRun = false;
    payRunDraft.inputs.clear();
    renderPayRunCreator(container);
  });

  actions.append(confirmBtn, cancelBtn);
  card.append(actions);

  container.append(card);
}

/** Render Pay Runs History and Management. */
function renderPayRunsList(container: HTMLElement): void {
  const payroll = getPayroll();
  container.textContent = "";

  if (payroll.payRuns.length === 0) {
    const empty = document.createElement("div");
    empty.className = "payroll-empty";
    empty.innerHTML = `
      <p>No pay runs completed yet.</p>
      <p>Click "New pay run" above to compute wages, PAYE, KiwiSaver, and generate Payday Filing exports.</p>
    `;
    container.append(empty);
    return;
  }

  const list = document.createElement("div");
  list.className = "payroll-runs-list";

  for (const run of payroll.payRuns) {
    const card = document.createElement("div");
    card.className = "payroll-run-card";

    // Header info
    const head = document.createElement("div");
    head.className = "payroll-run-card-head";

    const inBooks = payrollAccounts() !== null;
    const postedBadge = inBooks
      ? '<span class="payroll-badge posted" title="Posted on the payday">In the books</span>'
      : '<span class="payroll-badge unposted" title="Choose the payroll accounts above">Not in the books</span>';

    head.innerHTML = `
      <div class="payroll-run-title-group">
        <h4>Pay Date: <strong>${run.payDate}</strong></h4>
        <span class="payroll-period-text">Period: ${run.periodStart} &rarr; ${run.periodEnd}</span>
        ${postedBadge}
      </div>
      <div class="payroll-run-totals-summary">
        <span class="summary-pill">Gross: <strong>${formatAmount(run.totalGross)}</strong></span>
        <span class="summary-pill">PAYE: <strong>${formatAmount(run.totalPaye)}</strong></span>
        <span class="summary-pill">KiwiSaver: <strong>${formatAmount(run.totalKiwiSaverEmployee + (run.totalKiwiSaverEmployerNet ?? run.totalKiwiSaverEmployer - run.totalEsct))}</strong></span>
        <span class="summary-pill accent">Net Pay: <strong>${formatAmount(run.totalNetPay)}</strong></span>
      </div>
    `;
    card.append(head);

    // Action buttons bar
    const actionsBar = document.createElement("div");
    actionsBar.className = "payroll-run-actions";

    // 1. Download Payday Filing CSV (myIR)
    const dlBtn = document.createElement("button");
    dlBtn.type = "button";
    dlBtn.className = "payroll-action-btn primary";
    dlBtn.innerHTML = `
      <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true" fill="currentColor">
        <path d="M10 2v10m0 0 3.5-3.5M10 12 6.5 8.5M4 14v2a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-2"/>
      </svg>
      <span>Download Payday Filing (myIR CSV)</span>
    `;
    dlBtn.title = "Export Inland Revenue Employment Information (EI) CSV";
    dlBtn.addEventListener("click", () => {
      const contact = payroll.contact ?? { name: "", phone: "", email: "" };
      const problems = paydayFilingProblems(run, contact);
      if (problems.length > 0) {
        alert(`The file cannot be made yet: ${problems.join("; ")}.`);
        return;
      }
      const csv = generatePaydayFilingCsv(run, contact);
      const filename = `EI_${run.payDate.replace(/-/g, "")}.csv`;
      download(csv, filename, "text/csv;charset=utf-8");
    });

    // 3. View / Hide Breakdown
    const viewBtn = document.createElement("button");
    viewBtn.type = "button";
    viewBtn.className = "payroll-action-btn";
    const isExpanded = expandedPayRunId === run.id;
    viewBtn.textContent = isExpanded ? "Hide Details" : `View Details (${run.lines.length})`;
    viewBtn.addEventListener("click", () => {
      expandedPayRunId = expandedPayRunId === run.id ? null : run.id;
      renderPayRunsList(container);
    });

    // 4. Delete Pay Run
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "payroll-action-btn danger";
    delBtn.textContent = "Delete";
    delBtn.title = "Delete this pay run";
    delBtn.addEventListener("click", async () => {
      if (confirm(`Are you sure you want to delete the pay run for ${run.payDate}?`)) {
        // Its journal goes with it: journals are derived from the pay runs kept.
        payroll.payRuns = payroll.payRuns.filter((r) => r.id !== run.id);
        await commitPayroll(payroll, `Pay run for ${run.payDate} removed`);
      }
    });

    actionsBar.append(dlBtn, viewBtn, delBtn);
    card.append(actionsBar);
    for (const said of run.notes ?? []) card.append(note(said));

    // Breakdown table if expanded
    if (isExpanded) {
      const detailsWrap = document.createElement("div");
      detailsWrap.className = "payroll-run-breakdown table-scroll";

      const table = document.createElement("table");
      table.className = "payroll-table payroll-breakdown-table";
      table.innerHTML = `
        <thead>
          <tr>
            <th>Employee</th>
            <th>IRD</th>
            <th>Tax Code</th>
            <th style="text-align: right;">Gross</th>
            <th style="text-align: right;">PAYE</th>
            <th style="text-align: right;">Student Loan</th>
            <th style="text-align: right;">KiwiSaver (EE)</th>
            <th style="text-align: right;">KiwiSaver (employer)</th>
            <th style="text-align: right;">ESCT</th>
            <th style="text-align: right;">Child Support</th>
            <th style="text-align: right;">Net Pay</th>
          </tr>
        </thead>
      `;

      const tbody = document.createElement("tbody");
      for (const line of run.lines) {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td><strong>${escapeHtml(line.employeeName)}</strong></td>
          <td><code>${formatIrdNumber(line.irdNumber)}</code></td>
          <td><span class="payroll-tax-badge">${escapeHtml(line.taxCode)}</span></td>
          <td style="text-align: right;">${formatAmount(line.gross)}</td>
          <td style="text-align: right;">${formatAmount(line.paye)}</td>
          <td style="text-align: right;">${formatAmount(line.studentLoan)}</td>
          <td style="text-align: right;">${formatAmount(line.kiwiSaverEmployee)}</td>
          <td style="text-align: right;">${formatAmount(line.employerKiwiSaverAsSalary ? (line.kiwiSaverEmployerNet ?? 0) : line.kiwiSaverEmployer)}${line.employerKiwiSaverAsSalary ? " (as salary)" : ""}</td>
          <td style="text-align: right;">${formatAmount(line.esct)}</td>
          <td style="text-align: right;">${formatAmount(line.childSupport)}</td>
          <td style="text-align: right;"><strong>${formatAmount(line.netPay)}</strong></td>
        `;
        tbody.append(tr);
      }

      table.append(tbody);
      detailsWrap.append(table);
      card.append(detailsWrap);
    }

    list.append(card);
  }

  container.append(list);
}

/** Main Page Renderer */
export function renderPayrollPage(): void {
  committed = JSON.stringify(getPayroll());
  const editorHost = $("payroll-editor");
  const bodyHost = $("payroll-body");
  const employerBarHost = $("payroll-employer-bar");

  // Render Employer IRD Bar
  renderEmployerBar(employerBarHost);

  // Tab button states
  const tabRunsBtn = document.getElementById("payroll-tab-runs");
  const tabEmpBtn = document.getElementById("payroll-tab-employees");
  if (tabRunsBtn && tabEmpBtn) {
    tabRunsBtn.classList.toggle("active", activeTab === "runs");
    tabEmpBtn.classList.toggle("active", activeTab === "employees");
  }

  // Action button visibility
  const newRunBtn = document.getElementById("payroll-new-run");
  const addEmpBtn = document.getElementById("payroll-add-employee");
  if (newRunBtn) newRunBtn.style.display = activeTab === "runs" ? "" : "none";
  if (addEmpBtn) addEmpBtn.style.display = activeTab === "employees" ? "" : "none";

  // Body content
  if (activeTab === "runs") {
    editorHost.textContent = "";
    if (creatingPayRun) {
      renderPayRunCreator(editorHost);
    }
    renderPayRunsList(bodyHost);
  } else {
    renderEmployeeEditor(editorHost);
    renderEmployeesTable(bodyHost);
  }
}

/** Wire DOM event listeners for buttons and tabs */
export function wirePayroll(): void {
  document.getElementById("payroll-tab-runs")?.addEventListener("click", () => {
    activeTab = "runs";
    editingEmployeeId = null;
    redraw("payroll");
  });

  document.getElementById("payroll-tab-employees")?.addEventListener("click", () => {
    activeTab = "employees";
    creatingPayRun = false;
    redraw("payroll");
  });

  document.getElementById("payroll-new-run")?.addEventListener("click", () => {
    activeTab = "runs";
    creatingPayRun = true;
    redraw("payroll");
    $("payroll-editor").scrollIntoView({ behavior: "smooth" });
  });

  document.getElementById("payroll-add-employee")?.addEventListener("click", () => {
    activeTab = "employees";
    editingEmployeeId = "";
    redraw("payroll");
    $("payroll-editor").scrollIntoView({ behavior: "smooth" });
  });
}
