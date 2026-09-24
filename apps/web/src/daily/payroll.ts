import { redraw } from "../app.js";
import { $, state } from "../state.js";
import { savePart, partChanged } from "../store.js";
import { download, escapeHtml } from "../ui.js";
import {
  buildPayRun,
  cleanIrdNumber,
  createPayrollJournal,
  formatAmount,
  formatIrdNumber,
  generatePaydayFilingCsv,
  isValidIrdNumber,
  parseAmount,
} from "@nzosa/core";
import type {
  Cents,
  Employee,
  IsoDate,
  PayFrequency,
  PayLineInput,
  TaxCode,
} from "@nzosa/core";
import type { PayrollData } from "../store.js";

/**
 * NZ Payroll & Payday Filing (myIR) module.
 *
 * Runs payroll strictly in-browser using core pure functions:
 * - Full New Zealand PAYE threshold bands & ACC earner levy
 * - KiwiSaver employee deductions & compulsory employer contributions
 * - ESCT (Employer Superannuation Contribution Tax)
 * - Student Loan threshold repayments (12%)
 * - IRD Modulus-11 check-digit validation
 * - Employment Information (EI) CSV export for myIR Express File Transfer
 * - Balanced double-entry General Ledger journal postings
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
  inputs: new Map<
    string,
    { hoursWorked?: number | undefined; grossOverride?: Cents | undefined; childSupport?: Cents | undefined }
  >(),
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
  { code: "WT", label: "WT - Schedular payments (withholding tax)" },
  { code: "CAE", label: "CAE - Casual agricultural employee" },
  { code: "EDW", label: "EDW - Election day worker" },
  { code: "ND", label: "ND - Non-declaration rate (45%)" },
];

function getPayroll(): PayrollData {
  if (!state.ledger.payroll) {
    state.ledger.payroll = { employerIrd: "", employees: [], payRuns: [] };
  }
  return state.ledger.payroll;
}

async function commitPayroll(payroll: PayrollData): Promise<void> {
  state.ledger = { ...state.ledger, payroll };
  partChanged("payroll");
  state.persistent = await savePart(state.ledger, "payroll");
  redraw("payroll");
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
      irdFeedback.textContent = "8 or 9 digits required";
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
  grid.append(createField("IRD Number *", irdWrap, "Validated via Modulus-11 algorithm"));

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

  // Pay Frequency
  const freqSelect = document.createElement("select");
  for (const f of ["weekly", "fortnightly", "monthly"] as const) {
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
  const ksSelect = document.createElement("select");
  const ksRates = [
    { rate: 0, label: "0% (Opted out / Not enrolled)" },
    { rate: 0.03, label: "3% (Standard minimum)" },
    { rate: 0.04, label: "4%" },
    { rate: 0.06, label: "6%" },
    { rate: 0.08, label: "8%" },
    { rate: 0.1, label: "10%" },
  ];
  for (const k of ksRates) {
    const o = document.createElement("option");
    o.value = String(k.rate);
    o.textContent = k.label;
    o.selected = (existing?.kiwiSaverRate ?? 0.03) === k.rate;
    ksSelect.append(o);
  }
  grid.append(createField("KiwiSaver Employee Deduction", ksSelect));

  // KiwiSaver Employer Rate
  const ksEmployerSelect = document.createElement("select");
  const ksEmployerRates = [
    { rate: 0.03, label: "3% (Compulsory minimum)" },
    { rate: 0, label: "0% (Employee opted out)" },
    { rate: 0.04, label: "4%" },
    { rate: 0.06, label: "6%" },
  ];
  for (const k of ksEmployerRates) {
    const o = document.createElement("option");
    o.value = String(k.rate);
    o.textContent = k.label;
    o.selected = (existing?.kiwiSaverEmployerRate ?? 0.03) === k.rate;
    ksEmployerSelect.append(o);
  }
  grid.append(createField("KiwiSaver Employer Contribution", ksEmployerSelect));

  // Auto-sync employer KS when employee KS changes
  ksSelect.addEventListener("change", () => {
    if (Number(ksSelect.value) === 0) ksEmployerSelect.value = "0";
    else if (Number(ksEmployerSelect.value) === 0) ksEmployerSelect.value = "0.03";
  });

  // ESCT Rate
  const esctSelect = document.createElement("select");
  const esctTiers = [
    { rate: 0.175, label: "17.5% (Standard tier: $16,801 - $57,600)" },
    { rate: 0.105, label: "10.5% (Tier under $16,800)" },
    { rate: 0.3, label: "30.0% (Tier $57,601 - $84,000)" },
    { rate: 0.33, label: "33.0% (Tier $84,001 - $216,000)" },
    { rate: 0.39, label: "39.0% (Tier over $216,000)" },
  ];
  for (const t of esctTiers) {
    const o = document.createElement("option");
    o.value = String(t.rate);
    o.textContent = t.label;
    o.selected = (existing?.esctRate ?? 0.175) === t.rate;
    esctSelect.append(o);
  }
  grid.append(createField("ESCT Rate", esctSelect, "Employer superannuation tax rate tier"));

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
    if (!isValidIrdNumber(ird)) {
      errorMsg.textContent = "Please enter a valid New Zealand IRD number.";
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
      bankAccount: bankInput.value.trim(),
      startDate: (startInput.value || undefined) as IsoDate | undefined,
      finishDate: (finishInput.value || undefined) as IsoDate | undefined,
    };

    const updated = existing
      ? payroll.employees.map((e) => (e.id === empId ? emp : e))
      : [...payroll.employees, emp];

    payroll.employees = updated;
    editingEmployeeId = null;
    await commitPayroll(payroll);
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

    const ksText = emp.kiwiSaverRate > 0
      ? `${(emp.kiwiSaverRate * 100).toFixed(0)}% (ER ${(emp.kiwiSaverEmployerRate * 100).toFixed(0)}%)`
      : "Opted out";

    const isFinished = emp.finishDate && emp.finishDate <= new Date().toISOString().slice(0, 10);
    const statusBadge = isFinished
      ? '<span class="payroll-badge finished">Finished</span>'
      : '<span class="payroll-badge active">Active</span>';

    tr.innerHTML = `
      <td><strong>${escapeHtml(emp.name)}</strong></td>
      <td><code>${formatIrdNumber(emp.irdNumber)}</code></td>
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
        await commitPayroll(payroll);
      }
    });

    tbody.append(tr);
  }

  table.append(tbody);
  tableWrap.append(table);
  container.append(tableWrap);
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
      const held = payRunDraft.inputs.get(emp.id) ?? {};
      inputs.push({
        employeeId: emp.id,
        hoursWorked: held.hoursWorked,
        grossOverride: held.grossOverride,
        childSupport: held.childSupport,
      });
    }

    const previewRun = buildPayRun({
      employerIrd: payroll.employerIrd || "12345678",
      periodStart: payRunDraft.periodStart as IsoDate,
      periodEnd: payRunDraft.periodEnd as IsoDate,
      payDate: payRunDraft.payDate as IsoDate,
      employees: activeEmployees,
      inputs,
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
      const held = payRunDraft.inputs.get(emp.id) ?? {};
      inputs.push({
        employeeId: emp.id,
        hoursWorked: held.hoursWorked,
        grossOverride: held.grossOverride,
        childSupport: held.childSupport,
      });
    }

    const payRun = buildPayRun({
      employerIrd: payroll.employerIrd,
      periodStart: payRunDraft.periodStart as IsoDate,
      periodEnd: payRunDraft.periodEnd as IsoDate,
      payDate: payRunDraft.payDate as IsoDate,
      employees: activeEmployees,
      inputs,
    });

    payroll.payRuns.unshift(payRun);
    creatingPayRun = false;
    payRunDraft.inputs.clear();
    await commitPayroll(payroll);
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

    const isJournalPosted = (state.ledger.journals ?? []).some(
      (j) => j.id === `payrun-${run.id}`,
    );

    const postedBadge = isJournalPosted
      ? '<span class="payroll-badge posted" title="Posted to General Ledger">✓ Posted to GL</span>'
      : '<span class="payroll-badge unposted" title="Not yet posted to GL">Unposted</span>';

    head.innerHTML = `
      <div class="payroll-run-title-group">
        <h4>Pay Date: <strong>${run.payDate}</strong></h4>
        <span class="payroll-period-text">Period: ${run.periodStart} &rarr; ${run.periodEnd}</span>
        ${postedBadge}
      </div>
      <div class="payroll-run-totals-summary">
        <span class="summary-pill">Gross: <strong>${formatAmount(run.totalGross)}</strong></span>
        <span class="summary-pill">PAYE: <strong>${formatAmount(run.totalPaye)}</strong></span>
        <span class="summary-pill">KiwiSaver: <strong>${formatAmount(run.totalKiwiSaverEmployee + run.totalKiwiSaverEmployer)}</strong></span>
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
      const csv = generatePaydayFilingCsv(run);
      const filename = `EI_Payday_${run.payDate.replace(/-/g, "")}_${run.id.slice(0, 8)}.csv`;
      download(csv, filename, "text/csv;charset=utf-8");
    });

    // 2. Post to Ledger Journal
    const postBtn = document.createElement("button");
    postBtn.type = "button";
    postBtn.className = isJournalPosted ? "payroll-action-btn" : "payroll-action-btn secondary";
    postBtn.innerHTML = `
      <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true" fill="currentColor">
        <path d="M4 16h3l9-9-3-3-9 9z"/><path d="M11 6l3 3"/>
      </svg>
      <span>${isJournalPosted ? "Re-post to Ledger" : "Post to Ledger"}</span>
    `;
    postBtn.title = "Post balanced double-entry payroll journal into General Ledger";
    postBtn.addEventListener("click", async () => {
      const journal = createPayrollJournal(run, state.chart);
      const existingJournals = state.ledger.journals ?? [];
      const filtered = existingJournals.filter((j) => j.id !== journal.id);
      state.ledger = { ...state.ledger, journals: [...filtered, journal] };
      partChanged("journals");
      await savePart(state.ledger, "journals");
      alert(`Payroll journal (${journal.id}) posted successfully to General Ledger!\n\nDebits: Gross Wages + KiwiSaver Employer\nCredits: PAYE Payable + KiwiSaver Payable + Net Wages Payable`);
      redraw("payroll");
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
        payroll.payRuns = payroll.payRuns.filter((r) => r.id !== run.id);
        // Also remove posted journal if present
        if (state.ledger.journals) {
          state.ledger.journals = state.ledger.journals.filter(
            (j) => j.id !== `payrun-${run.id}`,
          );
          partChanged("journals");
          await savePart(state.ledger, "journals");
        }
        await commitPayroll(payroll);
      }
    });

    actionsBar.append(dlBtn, postBtn, viewBtn, delBtn);
    card.append(actionsBar);

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
            <th style="text-align: right;">KiwiSaver (ER)</th>
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
          <td style="text-align: right;">${formatAmount(line.kiwiSaverEmployer)}</td>
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
