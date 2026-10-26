import { localDay, periodChoiceFrom, periodOptions, periodRange, periodSaid, yearEarlier } from "@nzosa/core";
import type { DateRange } from "@nzosa/core";
import { $ } from "../state.js";
import { taxYearEnd, taxYearStart } from "../tax-year.js";

/**
 * Which part of the chosen year a report covers.
 *
 * The reports a month or a quarter means something for -- the profit and
 * loss, the balance sheet (as at the period's last day), the cash flow, the
 * trial balance, the general ledger and account transactions -- take the
 * period chosen beside the year. The rest are returns and year-end work, run
 * for the whole year whatever is chosen, and the control is hidden for them.
 */
export const PERIOD_REPORTS: ReadonlySet<string> = new Set([
  "pl",
  "balancesheet",
  "cashflow",
  "journal",
  "general",
  "extract",
  "bycustomer",
  "byitem",
]);

/** The two that offer a column for the same period a year earlier. */
export const COMPARE_REPORTS: ReadonlySet<string> = new Set(["pl", "balancesheet"]);

/** Today, in this computer's time zone. */
function today(): string {
  return localDay(new Date().toISOString(), -new Date().getTimezoneOffset());
}

function kindNow(): string {
  return document.getElementById("report-kind") instanceof HTMLSelectElement
    ? $<HTMLSelectElement>("report-kind").value
    : "";
}

function fullYear(year: number): DateRange {
  return { from: taxYearStart(year), to: taxYearEnd(year) };
}

/** The dates the report now showing covers, in the year chosen. */
export function reportRange(year: number): DateRange {
  if (!PERIOD_REPORTS.has(kindNow())) return fullYear(year);
  const select = document.getElementById("report-period");
  if (!(select instanceof HTMLSelectElement)) return fullYear(year);
  const from = (document.getElementById("report-from") as HTMLInputElement | null)?.value ?? "";
  const to = (document.getElementById("report-to") as HTMLInputElement | null)?.value ?? "";
  return periodRange(fullYear(year), periodChoiceFrom(select.value, { from, to }), today());
}

/** Whether the period is the whole year. */
export function wholeYear(year: number): boolean {
  const range = reportRange(year);
  const full = fullYear(year);
  return range.from === full.from && range.to === full.to;
}

/** The period in a heading: "FY2026" for the whole year, else "Jul–Sep 2025". */
export function periodHeading(year: number): string {
  return wholeYear(year) ? `FY${year}` : periodSaid(reportRange(year));
}

/** The period in a file name: "fy2026", or "2025-07-01-to-2025-09-30". */
export function periodFileName(year: number): string {
  if (wholeYear(year)) return `fy${year}`;
  const range = reportRange(year);
  return `${range.from}-to-${range.to}`;
}

/** Whether a column for the same period a year earlier is asked for, and offered. */
export function comparing(): boolean {
  const box = document.getElementById("report-compare");
  return COMPARE_REPORTS.has(kindNow()) && box instanceof HTMLInputElement && box.checked;
}

/** The same period a year earlier. */
export function earlierRange(year: number): DateRange {
  return yearEarlier(reportRange(year));
}

/**
 * Fill the period choices for the year, keeping the one chosen where the year
 * has it, and show only what the report in hand uses.
 */
export function drawPeriodControls(year: number | undefined, kind: string): void {
  const select = document.getElementById("report-period");
  const dates = document.getElementById("report-dates");
  const compare = document.getElementById("report-compare-label");
  if (!(select instanceof HTMLSelectElement)) return;
  const usesPeriod = year !== undefined && PERIOD_REPORTS.has(kind);
  select.hidden = !usesPeriod;
  if (compare !== null) compare.hidden = !(year !== undefined && COMPARE_REPORTS.has(kind));
  if (!usesPeriod) {
    if (dates !== null) dates.hidden = true;
    return;
  }
  const chosen = select.value;
  const options = periodOptions(fullYear(year), today());
  select.textContent = "";
  for (const option of options) {
    const element = document.createElement("option");
    element.value = option.value;
    element.textContent = option.label;
    select.append(element);
  }
  select.value = options.some((o) => o.value === chosen) ? chosen : "year";
  const custom = select.value === "custom";
  if (dates !== null) dates.hidden = !custom;
  if (custom) {
    // Chosen dates start as the year, and are kept inside it when the year changes.
    const full = fullYear(year);
    for (const [id, fallback] of [["report-from", full.from], ["report-to", full.to]] as const) {
      const input = document.getElementById(id);
      if (!(input instanceof HTMLInputElement)) continue;
      input.min = full.from;
      input.max = full.to;
      if (input.value === "" || input.value < full.from || input.value > full.to) input.value = fallback;
    }
  }
}
