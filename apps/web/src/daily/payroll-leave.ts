import { note } from "../ui.js";
import { NZ_REGIONS, formatAmount, leaveBalance, ordinaryWeeklyPayOf, workingDaysBetween } from "@nzosa/core";
import type { Cents, IsoDate, LeaveKind, LeaveSettings, LeaveTaken } from "@nzosa/core";
import type { PayrollData } from "../store.js";

/**
 * Leave on the Payroll page: each employee's balances, what they are worth,
 * and the leave taken that they are worked from.
 *
 * Annual holidays in weeks, as the Holidays Act counts them; sick leave in
 * days. The figure an accountant asks for at balance date -- holiday pay owing
 * -- is the total at the foot, at whatever date is chosen.
 */

let asAt: IsoDate | null = null;

const KINDS: readonly [LeaveKind, string][] = [
  ["annual", "Annual holidays"],
  ["sick", "Sick leave"],
  ["family-violence", "Family violence leave"],
  ["bereavement", "Bereavement leave"],
  ["alternative", "Alternative holiday taken (day in lieu)"],
  ["alternative-earned", "Alternative holiday earned (worked a public holiday)"],
  ["annual-cashup", "Annual leave cashed up (up to a week a year, on request)"],
  ["parental", "Parental leave"],
  ["other", "Other leave"],
];

/** Hours, with the weeks or days they are, as payroll shows a balance. */
function hours(value: number, perUnit: number, unit: string): string {
  const h = value * perUnit;
  return `${Number.isInteger(h) ? h : h.toFixed(2)} h (${Number.isInteger(value) ? value : value.toFixed(2)} ${unit})`;
}

function defaultAsAt(): IsoDate {
  // The last 31 March that has passed: the balance date an accountant asks about.
  const today = new Date().toISOString().slice(0, 10);
  const year = Number(today.slice(0, 4));
  return (today >= `${year}-03-31` ? `${year}-03-31` : `${year - 1}-03-31`) as IsoDate;
}

export function renderLeave(
  container: HTMLElement,
  payroll: PayrollData,
  commit: (payroll: PayrollData, what: string) => Promise<void>,
): void {
  container.textContent = "";
  const when = asAt ?? defaultAsAt();
  const employees = payroll.employees.filter((e) => e.startDate !== undefined && e.startDate !== "");
  if (payroll.employees.length === 0) {
    container.append(note("No employees yet. Add them on the Employees tab."));
    return;
  }

  const pick = document.createElement("label");
  const date = document.createElement("input");
  date.type = "date";
  date.value = when;
  date.addEventListener("change", () => {
    asAt = (date.value || defaultAsAt()) as IsoDate;
    renderLeave(container, payroll, commit);
  });
  pick.append("Balances as at ", date);
  container.append(pick);

  const missing = payroll.employees.filter((e) => e.startDate === undefined || e.startDate === "");
  if (missing.length > 0) {
    container.append(
      note(
        `${missing.map((e) => e.name).join(", ")} ${missing.length === 1 ? "has" : "have"} no start date, ` +
          "which every leave entitlement is counted from. Add it on the Employees tab.",
      ),
    );
  }

  const settingsOf = (id: string): LeaveSettings | undefined => (payroll.leaveSettings ?? []).find((s) => s.employeeId === id);
  const taken = payroll.leave ?? [];

  // --- balances ---------------------------------------------------------------
  const table = document.createElement("table");
  table.className = "report-table owner-table";
  table.innerHTML =
    "<thead><tr><th>Employee</th><th>Annual leave</th><th>Next anniversary</th><th>Holiday pay (8% since anniversary)</th>" +
    "<th>Sick leave</th><th>Family violence leave</th><th>Alternative holidays</th><th>Weekly rate</th><th>Holiday pay owing</th></tr></thead>";
  const tbody = document.createElement("tbody");
  let total = 0;
  const notes: string[] = [];
  for (const employee of employees) {
    const pays: { date: IsoDate; gross: Cents }[] = [];
    for (const run of payroll.payRuns) {
      // Withholding income -- directors' fees and the like -- is not earnings for holiday pay.
      for (const line of run.lines) {
        if (line.employeeId === employee.id && line.withholding !== true) pays.push({ date: run.payDate, gross: line.gross });
      }
    }
    const settings = settingsOf(employee.id);
    const b = leaveBalance({
      employeeId: employee.id,
      startDate: employee.startDate as IsoDate,
      asAt: when,
      ...(settings !== undefined ? { settings } : {}),
      pays,
      taken,
      ordinaryWeeklyPay: ordinaryWeeklyPayOf(employee),
    });
    total += b.owing;
    for (const said of b.notes) notes.push(`${employee.name}: ${said}`);
    const tr = document.createElement("tr");
    const cells = [
      employee.name + (b.payAsYouGo ? " (pay as you go)" : ""),
      b.payAsYouGo ? "--" : hours(b.annualWeeks, b.hoursPerWeek, "weeks"),
      b.nextAnniversary ?? "",
      b.payAsYouGo ? "--" : formatAmount(b.accruedSinceAnniversary),
      hours(b.sickDays, b.hoursPerDay, "days"),
      hours(b.familyViolenceDays, b.hoursPerDay, "days"),
      hours(b.alternativeDays, b.hoursPerDay, "days"),
      `${formatAmount(b.weeklyRate)} (${b.weeklyRate === b.averageWeeklyEarnings && b.averageWeeklyEarnings > b.ordinaryWeeklyPay ? "average" : "ordinary"})`,
      formatAmount(b.owing),
    ];
    cells.forEach((text, i) => {
      const td = document.createElement("td");
      td.className = i === 0 ? "report-name" : "report-amount";
      td.textContent = text;
      tr.append(td);
    });
    tbody.append(tr);
  }
  const foot = document.createElement("tr");
  foot.className = "report-total";
  foot.innerHTML = `<td class="report-name">Holiday pay owing at ${when}</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td class="report-amount">${formatAmount(total as Cents)}</td>`;
  tbody.append(foot);
  table.append(tbody);
  container.append(table);
  container.append(
    note(
      "Annual holidays: 4 weeks at each anniversary, paid at the greater of ordinary weekly pay and " +
        "average weekly earnings over the last 12 months. Before an anniversary, 8% of gross since " +
        "the last one is owed if employment ends, so it is counted in holiday pay owing. Sick leave: " +
        "10 days at six months, then 10 more each year, the balance held to 20. Family violence " +
        "leave: 10 days a year on the same dates, not carried over. Hours are at the hours a usual " +
        "week and day. The Holidays Act " +
        "leaves some of this to judgement -- what counts as gross earnings, and a week for someone " +
        "with no regular pattern -- so check the figures before relying on them.",
    ),
  );
  for (const said of notes) container.append(note(said));

  // --- each employee's settings -------------------------------------------------
  const h = document.createElement("h3");
  h.textContent = "Leave settings";
  container.append(h);
  for (const employee of payroll.employees) {
    const held = settingsOf(employee.id);
    const row = document.createElement("div");
    row.className = "page-actions";
    const name = document.createElement("strong");
    name.textContent = employee.name;
    const days = document.createElement("input");
    days.type = "number";
    days.min = "1";
    days.max = "7";
    days.step = "0.5";
    days.value = String(held?.daysPerWeek ?? 5);
    days.title = "Days worked in a usual week";
    const weekHours = document.createElement("input");
    weekHours.type = "number";
    weekHours.min = "1";
    weekHours.step = "0.5";
    weekHours.value = String(held?.hoursPerWeek ?? 40);
    weekHours.title = "Hours worked in a usual week";
    const region = document.createElement("select");
    region.title = "Region, for its anniversary day";
    for (const name of ["", ...NZ_REGIONS]) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name === "" ? "No region" : name;
      option.selected = (held?.region ?? "") === name;
      region.append(option);
    }
    const paygLabel = document.createElement("label");
    const payg = document.createElement("input");
    payg.type = "checkbox";
    payg.checked = held?.payAsYouGo === true;
    paygLabel.append(payg, " 8% paid with each pay instead (pay as you go)");
    const openDate = document.createElement("input");
    openDate.type = "date";
    openDate.value = held?.opening?.asAt ?? "";
    openDate.title = "Opening balances as at";
    const openAnnual = document.createElement("input");
    openAnnual.type = "number";
    openAnnual.step = "0.01";
    openAnnual.placeholder = "Annual weeks";
    openAnnual.value = held?.opening ? String(held.opening.annualWeeks) : "";
    const openSick = document.createElement("input");
    openSick.type = "number";
    openSick.step = "0.5";
    openSick.placeholder = "Sick days";
    openSick.value = held?.opening ? String(held.opening.sickDays) : "";
    const keep = document.createElement("button");
    keep.type = "button";
    keep.textContent = "Save";
    keep.addEventListener("click", () => {
      const next: LeaveSettings = {
        employeeId: employee.id,
        daysPerWeek: Number(days.value) || 5,
        hoursPerWeek: Number(weekHours.value) || 40,
        ...(region.value !== "" ? { region: region.value } : {}),
        ...(payg.checked ? { payAsYouGo: true } : {}),
        ...(openDate.value !== ""
          ? {
              opening: {
                asAt: openDate.value as IsoDate,
                annualWeeks: Number(openAnnual.value) || 0,
                sickDays: Number(openSick.value) || 0,
              },
            }
          : {}),
      };
      const leaveSettings = [...(payroll.leaveSettings ?? []).filter((s) => s.employeeId !== employee.id), next];
      void commit({ ...payroll, leaveSettings }, `Leave settings for ${employee.name}`);
    });
    row.append(
      name,
      " Days a week ",
      days,
      " Hours a week ",
      weekHours,
      region,
      paygLabel,
      " Opening balances at ",
      openDate,
      openAnnual,
      openSick,
      keep,
    );
    container.append(row);
  }

  // --- leave taken ----------------------------------------------------------------
  const h2 = document.createElement("h3");
  h2.textContent = "Leave taken";
  container.append(h2);
  const form = document.createElement("div");
  form.className = "page-actions";
  const who = document.createElement("select");
  for (const employee of payroll.employees) {
    const option = document.createElement("option");
    option.value = employee.id;
    option.textContent = employee.name;
    who.append(option);
  }
  const kind = document.createElement("select");
  for (const [value, label] of KINDS) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    kind.append(option);
  }
  const from = document.createElement("input");
  from.type = "date";
  from.title = "First day";
  const until = document.createElement("input");
  until.type = "date";
  until.title = "Last day";
  const howMany = document.createElement("input");
  howMany.type = "number";
  howMany.step = "0.5";
  howMany.min = "0.5";
  howMany.placeholder = "Days";
  const why = document.createElement("input");
  why.type = "text";
  why.placeholder = "Note (optional)";
  // The days a period takes, counted as payroll counts them: weekdays, less
  // public holidays and the employee's regional anniversary. Still a box to
  // change, for somebody who does not work Monday to Friday.
  const count = (): void => {
    if (from.value === "") return;
    const last = until.value === "" ? from.value : until.value;
    if (last < from.value) return;
    const region = settingsOf(who.value)?.region;
    howMany.value = String(workingDaysBetween(from.value as IsoDate, last as IsoDate, region));
  };
  from.addEventListener("change", count);
  until.addEventListener("change", count);
  who.addEventListener("change", count);
  const add = document.createElement("button");
  add.type = "button";
  add.className = "primary";
  add.textContent = "Record";
  add.addEventListener("click", () => {
    const daysTaken = Number(howMany.value);
    if (from.value === "" || !(daysTaken > 0)) return;
    const entry: LeaveTaken = {
      employeeId: who.value,
      kind: kind.value as LeaveKind,
      from: from.value as IsoDate,
      ...(until.value !== "" && until.value > from.value ? { to: until.value as IsoDate } : {}),
      days: daysTaken,
      ...(why.value.trim() !== "" ? { note: why.value.trim() } : {}),
    };
    void commit({ ...payroll, leave: [...taken, entry] }, `Leave recorded for ${who.selectedOptions[0]?.textContent ?? ""}`);
  });
  form.append(who, kind, from, " to ", until, howMany, " days ", why, add);
  container.append(form);

  if (taken.length > 0) {
    const list = document.createElement("table");
    list.className = "report-table owner-table";
    list.innerHTML = "<thead><tr><th>Employee</th><th>Kind</th><th>Dates</th><th>Days</th><th>Note</th><th></th></tr></thead>";
    const lb = document.createElement("tbody");
    for (const entry of [...taken].sort((a, b) => b.from.localeCompare(a.from))) {
      const tr = document.createElement("tr");
      const name = payroll.employees.find((e) => e.id === entry.employeeId)?.name ?? entry.employeeId;
      for (const [text, cls] of [
        [name, "report-name"],
        [KINDS.find(([k]) => k === entry.kind)?.[1] ?? entry.kind, "report-name"],
        [entry.to !== undefined ? `${entry.from} to ${entry.to}` : entry.from, "report-name"],
        [String(entry.days), "report-amount"],
        [entry.note ?? "", "report-name"],
      ] as const) {
        const td = document.createElement("td");
        td.className = cls;
        td.textContent = text;
        tr.append(td);
      }
      const actions = document.createElement("td");
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "danger";
      remove.textContent = "Delete";
      remove.addEventListener("click", () => {
        void commit({ ...payroll, leave: taken.filter((t) => t !== entry) }, `Leave removed for ${name}`);
      });
      actions.append(remove);
      tr.append(actions);
      lb.append(tr);
    }
    list.append(lb);
    container.append(list);
  }
}
