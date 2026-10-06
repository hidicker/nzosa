import { download, note } from "../ui.js";
import {
  EXEMPT_INCOME,
  KIWISAVER_ELIGIBILITY,
  KIWISAVER_STATUS,
  LATE_OPT_OUT_REASONS,
  employeeDetailsProblems,
  generateEmployeeDetailsCsv,
  namePartsOf,
  splitName,
} from "@nzosa/core";
import type { Employee, EmployeeDetails, IsoDate } from "@nzosa/core";
import type { PayrollData } from "../store.js";

/**
 * New and leaving employees for Inland Revenue: the details the Employee
 * Details file needs beyond the pay, on the employee's form, and the file
 * itself on the Employees tab. The file's layout and its checks are in core
 * (employee-details.ts), tested against IR's own example.
 */

/** A field laid out as the rest of the employee form lays them out. */
function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "payroll-form-field";
  const caption = document.createElement("label");
  caption.textContent = label;
  wrap.append(caption, control);
  if (hint !== undefined) {
    const said = document.createElement("small");
    said.className = "field-hint";
    said.textContent = hint;
    wrap.append(said);
  }
  return wrap;
}

function text(value: string | undefined, placeholder = "", type = "text"): HTMLInputElement {
  const input = document.createElement("input");
  input.type = type;
  input.value = value ?? "";
  input.placeholder = placeholder;
  return input;
}

function choose(options: readonly (readonly [string, string])[], chosen: string | undefined, blank: string): HTMLSelectElement {
  const select = document.createElement("select");
  for (const [value, caption] of [["", blank] as const, ...options.map(([v, c]) => [v, `${v} -- ${c}`] as const)]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = caption;
    option.selected = (chosen ?? "") === value;
    select.append(option);
  }
  return select;
}

/**
 * The employee details fields for the employee form, folded away: what IR's
 * Employee Details file needs for a new or leaving employee. `read` gives
 * what was entered, or undefined where nothing was.
 */
export function employeeDetailsFields(existing: Employee | undefined): { box: HTMLElement; read: () => EmployeeDetails | undefined } {
  const d = existing?.details ?? {};
  const split = splitName(existing?.name ?? "");
  const box = document.createElement("details");
  box.className = "payroll-template";
  const summary = document.createElement("summary");
  summary.textContent = "For Inland Revenue: employee details (new and leaving employees)";
  const grid = document.createElement("div");
  grid.className = "payroll-form-grid";

  const title = text(d.title, "Mr, Mrs, Ms, Mx…");
  const first = text(d.firstName ?? split.first);
  const middle = text(d.middleName ?? split.middle);
  const last = text(d.lastName ?? split.last);
  const dob = text(d.dateOfBirth, "", "date");
  const email = text(d.email, "name@example.co.nz", "email");
  const mobile = text(d.mobile, "021 123 4567");
  const daytime = text(d.daytimePhone, "04 123 4567");
  const street = text(d.address?.street, "12 Small Street");
  const suburb = text(d.address?.suburb);
  const city = text(d.address?.city);
  const postcode = text(d.address?.postcode);
  const eligibility = choose(KIWISAVER_ELIGIBILITY, d.kiwiSaverEligibility, "Not said");
  const status = choose(KIWISAVER_STATUS, d.kiwiSaverStatus, "Not said");
  const exempt = choose(EXEMPT_INCOME, d.exemptIncome, "None");
  const optedOut = document.createElement("input");
  optedOut.type = "checkbox";
  optedOut.checked = d.optedOut === true;
  const signed = text(d.optOutSigned, "", "date");
  const holder = text(d.optOutAccountHolder, "As on the bank account");
  const late = choose(LATE_OPT_OUT_REASONS, d.lateOptOutReason, "Not late");
  const lateOther = text(d.lateOptOutOther);

  const optOutFields = [
    field("Opt-out notice signed", signed),
    field("Bank account holder", holder, "The refund goes to the bank account above"),
    field("Late opt-out reason", late, "Only if signed more than 56 days after starting"),
    field("Other reason", lateOther),
  ];
  const syncOptOut = (): void => {
    for (const f of optOutFields) f.style.display = optedOut.checked ? "" : "none";
  };
  optedOut.addEventListener("change", syncOptOut);
  syncOptOut();
  const optedOutLabel = document.createElement("label");
  optedOutLabel.className = "payroll-form-field";
  optedOutLabel.append(optedOut, " Opting out of KiwiSaver (auto-enrolled only, within 8 weeks)");

  grid.append(
    field("Title", title),
    field("First name", first),
    field("Middle names", middle),
    field("Last name", last),
    field("Date of birth", dob),
    field("Email", email),
    field("Mobile", mobile),
    field("Daytime phone", daytime),
    field("Street address", street, "Needed if there is no email or phone"),
    field("Suburb", suburb),
    field("Town or city", city),
    field("Postcode", postcode),
    field("KiwiSaver eligibility", eligibility, "NE for every new employee"),
    field("New employee's KiwiSaver status", status, "From their KS2, or AE to auto-enrol"),
    field("Exempt income", exempt),
    optedOutLabel,
    ...optOutFields,
  );
  box.append(
    summary,
    note(
      "What Inland Revenue's Employee Details file needs for a new or leaving employee, besides " +
        "what the pay already holds. Make the file on the Employees tab, under Employee details for myIR.",
    ),
    grid,
  );

  const read = (): EmployeeDetails | undefined => {
    const v = (input: HTMLInputElement | HTMLSelectElement): string => input.value.trim();
    const out: EmployeeDetails = {
      ...(v(title) !== "" ? { title: v(title) } : {}),
      ...(v(first) !== "" ? { firstName: v(first) } : {}),
      ...(v(middle) !== "" ? { middleName: v(middle) } : {}),
      ...(v(last) !== "" ? { lastName: v(last) } : {}),
      ...(v(dob) !== "" ? { dateOfBirth: v(dob) as IsoDate } : {}),
      ...(v(email) !== "" ? { email: v(email) } : {}),
      ...(v(mobile) !== "" ? { mobile: v(mobile) } : {}),
      ...(v(daytime) !== "" ? { daytimePhone: v(daytime) } : {}),
      ...(v(street) !== "" || v(city) !== ""
        ? { address: { street: v(street), city: v(city), postcode: v(postcode), ...(v(suburb) !== "" ? { suburb: v(suburb) } : {}) } }
        : {}),
      ...(v(eligibility) !== "" ? { kiwiSaverEligibility: v(eligibility) as NonNullable<EmployeeDetails["kiwiSaverEligibility"]> } : {}),
      ...(v(status) !== "" ? { kiwiSaverStatus: v(status) as NonNullable<EmployeeDetails["kiwiSaverStatus"]> } : {}),
      ...(v(exempt) !== "" ? { exemptIncome: v(exempt) as NonNullable<EmployeeDetails["exemptIncome"]> } : {}),
      ...(optedOut.checked
        ? {
            optedOut: true,
            ...(v(signed) !== "" ? { optOutSigned: v(signed) as IsoDate } : {}),
            ...(v(holder) !== "" ? { optOutAccountHolder: v(holder) } : {}),
            ...(v(late) !== "" ? { lateOptOutReason: v(late) as NonNullable<EmployeeDetails["lateOptOutReason"]> } : {}),
            ...(v(lateOther) !== "" ? { lateOptOutOther: v(lateOther) } : {}),
          }
        : {}),
    };
    return Object.keys(out).length === 0 ? undefined : out;
  };
  return { box, read };
}

/** Started or finished within the last 31 days: who the file is usually for. */
function recent(employee: Employee, today: IsoDate): boolean {
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 31 * 86_400_000).toISOString().slice(0, 10);
  return (employee.startDate ?? "") >= since || (employee.finishDate ?? "") >= since;
}

let chosen: Set<string> | null = null;

/**
 * The Employee Details file for myIR: tick who it is for -- new and leaving
 * employees, ticked to begin with -- check it, and download it.
 */
export function employeeDetailsFile(container: HTMLElement, payroll: PayrollData): void {
  if (payroll.employees.length === 0) return;
  const section = document.createElement("div");
  section.className = "payroll-template";
  const heading = document.createElement("h4");
  heading.textContent = "Employee details for myIR";
  section.append(
    heading,
    note(
      "New and leaving employees go to Inland Revenue on an Employee Details file, by the next " +
        "payday filing at the latest. Tick who it is for, then download it and upload it in myIR " +
        "(Payroll → Employees → upload a file). Their details are on each employee's form.",
    ),
  );
  const today = new Date().toISOString().slice(0, 10) as IsoDate;
  chosen ??= new Set(payroll.employees.filter((e) => recent(e, today)).map((e) => e.id));
  const list = document.createElement("div");
  for (const employee of payroll.employees) {
    const label = document.createElement("label");
    label.className = "payroll-form-field";
    const tick = document.createElement("input");
    tick.type = "checkbox";
    tick.checked = chosen.has(employee.id);
    tick.addEventListener("change", () => {
      if (tick.checked) chosen?.add(employee.id);
      else chosen?.delete(employee.id);
    });
    const name = namePartsOf(employee);
    label.append(
      tick,
      ` ${name.first} ${name.last}`.replace(/\s+/g, " ") +
        (employee.finishDate !== undefined ? ` -- leaving ${employee.finishDate}` : employee.startDate !== undefined ? ` -- started ${employee.startDate}` : ""),
    );
    list.append(label);
  }
  const problems = document.createElement("ul");
  problems.className = "variance-problems";
  const make = document.createElement("button");
  make.type = "button";
  make.className = "primary";
  make.textContent = "Download the employee details file";
  make.addEventListener("click", () => {
    const picked = payroll.employees.filter((e) => chosen?.has(e.id));
    const wrong = employeeDetailsProblems(payroll.employerIrd ?? "", picked);
    problems.textContent = "";
    if (wrong.length > 0) {
      for (const said of wrong) {
        const li = document.createElement("li");
        li.textContent = said;
        problems.append(li);
      }
      return;
    }
    const csv = generateEmployeeDetailsCsv(payroll.employerIrd ?? "", picked);
    download(csv, `ED_${today.replace(/-/g, "")}.csv`, "text/csv;charset=utf-8");
  });
  section.append(list, make, problems);
  container.append(section);
}
