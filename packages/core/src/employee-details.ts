import type { IsoDate } from "./dates.js";
import type { Employee } from "./payroll.js";
import { PAYROLL_PACKAGE, cleanIrdNumber, isValidIrdNumber } from "./payroll.js";

/**
 * The Employee Details (ED) file: new and departing employees, for myIR.
 *
 * Payday filing needs each new employee's details, and each departing one's
 * finish date, by the next employment information return at the latest. This
 * is IR's CSV for it, from the "Payday Filing File Upload Specification
 * 2026-2027" (July 2026), section 3.2: one HED2 header, then for each employee
 * a DED line and a TED line for each of their tax codes.
 *
 * What the employment information file does not already carry is kept on the
 * employee as `details`: their name in parts, date of birth, how to contact
 * them, their KiwiSaver eligibility and status, and -- where they opt out of
 * KiwiSaver -- the opt-out notice and the bank account for the refund.
 */

/** KiwiSaver eligibility (DED 11). */
export type KiwiSaverEligibility = "NE" | "EE" | "EA";
/** A new employee's KiwiSaver status (DED 12). */
export type KiwiSaverStatus = "AE" | "AK" | "OK" | "NK" | "CT";
/** Employee exempt income (DED 13). */
export type ExemptIncome = "BLH" | "TAO" | "VBS" | "RTA" | "OES" | "HPT";
/** Why an opt-out notice came more than 56 days after starting (DED 40). */
export type LateOptOutReason = "INFO" | "IRIS" | "ERIS" | "EVNT" | "CRIT" | "INER" | "OTHR";

export const KIWISAVER_ELIGIBILITY: readonly (readonly [KiwiSaverEligibility, string])[] = [
  ["NE", "New employee"],
  ["EE", "Existing employee opting in"],
  ["EA", "Existing employee, to be auto-enrolled"],
];
export const KIWISAVER_STATUS: readonly (readonly [KiwiSaverStatus, string])[] = [
  ["AE", "Auto-enrol"],
  ["AK", "Already a KiwiSaver member"],
  ["OK", "Opting in"],
  ["NK", "Not eligible"],
  ["CT", "Casual or temporary"],
];
export const EXEMPT_INCOME: readonly (readonly [ExemptIncome, string])[] = [
  ["BLH", "Board, lodging or use of a house"],
  ["TAO", "Allowances for living overseas"],
  ["VBS", "Voluntary Bonding Scheme payments"],
  ["RTA", "Retiring allowance"],
  ["OES", "Overpaid employer superannuation contribution"],
  ["HPT", "Some honoraria"],
];
export const LATE_OPT_OUT_REASONS: readonly (readonly [LateOptOutReason, string])[] = [
  ["INFO", "No KiwiSaver information pack within seven days of starting"],
  ["IRIS", "IR sent no investment statement for the default scheme"],
  ["ERIS", "The employer gave no investment statement for its scheme"],
  ["EVNT", "Events outside their control"],
  ["CRIT", "Did not meet the criteria to join KiwiSaver"],
  ["INER", "Enrolled under 18 by mistake"],
  ["OTHR", "Other"],
];

export interface EmployeeDetails {
  title?: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  dateOfBirth?: IsoDate;
  email?: string;
  mobile?: string;
  daytimePhone?: string;
  /** A New Zealand postal address. Needed when there is no email or phone. */
  address?: { street: string; suburb?: string; city: string; postcode: string };
  kiwiSaverEligibility?: KiwiSaverEligibility;
  kiwiSaverStatus?: KiwiSaverStatus;
  exemptIncome?: ExemptIncome;
  /** Opting out of KiwiSaver: the refund goes to the employee's bank account. */
  optedOut?: boolean;
  optOutSigned?: IsoDate;
  /** As on the bank account, at most 31 characters. Defaults to their name. */
  optOutAccountHolder?: string;
  lateOptOutReason?: LateOptOutReason;
  lateOptOutOther?: string;
}

/** A name in its parts: the last word is the surname, any between are middle names. */
export function splitName(name: string): { first: string; middle: string; last: string } {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return { first: words[0] ?? "", middle: "", last: "" };
  return { first: words[0] ?? "", middle: words.slice(1, -1).join(" "), last: words[words.length - 1] ?? "" };
}

/** The employee's name in parts: as given, or worked out from their name. */
export function namePartsOf(employee: Employee): { first: string; middle: string; last: string } {
  const split = splitName(employee.name);
  const d = employee.details ?? {};
  return {
    first: d.firstName?.trim() || split.first,
    middle: d.middleName?.trim() ?? split.middle,
    last: d.lastName?.trim() || split.last,
  };
}

/** A New Zealand bank account in IR's four parts: bank, branch, account, suffix. */
export function bankParts(account: string): { bank: string; branch: string; number: string; suffix: string } | null {
  const pieces = account.trim().split(/[\s-]+/).filter(Boolean);
  const digits = account.replace(/\D/g, "");
  if (pieces.length === 4 && pieces.every((p) => /^\d+$/.test(p))) {
    const [bank, branch, number, suffix] = pieces as [string, string, string, string];
    if (bank.length <= 2 && branch.length <= 4 && number.length <= 8 && suffix.length <= 4) {
      return { bank: bank.padStart(2, "0"), branch: branch.padStart(4, "0"), number, suffix: suffix.padStart(4, "0") };
    }
  }
  // Run together: 2 + 4 + 7 + 2 or 3 digits, as banks print them.
  if (digits.length === 15 || digits.length === 16) {
    return { bank: digits.slice(0, 2), branch: digits.slice(2, 6), number: digits.slice(6, 13), suffix: digits.slice(13).padStart(4, "0") };
  }
  return null;
}

const irdDate = (iso: IsoDate | undefined): string => (iso === undefined ? "" : iso.replace(/-/g, ""));
const irdNumber9 = (raw: string): string => {
  const digits = cleanIrdNumber(raw);
  return digits === "" ? "000000000" : digits.padStart(9, "0");
};
/** Text fields may not hold commas; the file is plain CSV with no quoting. */
const plain = (text: string | undefined, max: number): string =>
  (text ?? "").replace(/[,\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const phone = (text: string | undefined): string => (text ?? "").replace(/\D/g, "").slice(0, 30);
const EMAIL = /^[A-Za-z0-9._-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** What would stop IR accepting the file, said before it is made. */
export function employeeDetailsProblems(employerIrd: string, employees: readonly Employee[]): string[] {
  const problems: string[] = [];
  if (!isValidIrdNumber(employerIrd)) problems.push("the employer IRD number is not a valid one");
  if (employees.length === 0) problems.push("choose at least one employee");
  for (const e of employees) {
    const who = e.name.trim() || "An employee";
    const d = e.details ?? {};
    const name = namePartsOf(e);
    if (name.first === "") problems.push(`${who}: a first name is needed`);
    if (name.last === "") problems.push(`${who}: a last name is needed`);
    if (e.irdNumber !== "" && !isValidIrdNumber(e.irdNumber)) problems.push(`${who}: the IRD number is not a valid one`);
    if (e.startDate === undefined) problems.push(`${who}: the employment start date is needed`);
    if (e.startDate !== undefined && e.finishDate !== undefined && e.finishDate <= e.startDate) {
      problems.push(`${who}: the finish date has to be after the start date`);
    }
    if (d.kiwiSaverEligibility === "NE" && d.kiwiSaverStatus === undefined) {
      problems.push(`${who}: a new employee needs their KiwiSaver status`);
    }
    if (d.email !== undefined && d.email.trim() !== "" && (!EMAIL.test(d.email.trim()) || d.email.includes(".."))) {
      problems.push(`${who}: the email address is not one IR accepts`);
    }
    const contact = (d.email ?? "").trim() !== "" || phone(d.mobile) !== "" || phone(d.daytimePhone) !== "";
    const address = d.address !== undefined && d.address.street.trim() !== "" && d.address.city.trim() !== "";
    if (!contact && !address) problems.push(`${who}: an email, a phone number or a postal address is needed`);
    if (d.optedOut === true) {
      if (d.kiwiSaverEligibility === "EE" || (d.kiwiSaverStatus !== undefined && d.kiwiSaverStatus !== "AE")) {
        problems.push(`${who}: only somebody auto-enrolled can opt out of KiwiSaver`);
      }
      if (bankParts(e.bankAccount) === null) problems.push(`${who}: opting out needs their bank account, for the refund`);
      if (d.optOutSigned === undefined) problems.push(`${who}: opting out needs the date they signed the notice`);
      else if (e.startDate !== undefined && daysBetween(e.startDate, d.optOutSigned) > 56 && d.lateOptOutReason === undefined) {
        problems.push(`${who}: the opt-out notice is more than 56 days after starting, so a reason is needed`);
      }
      if (d.lateOptOutReason === "OTHR" && (d.lateOptOutOther ?? "").trim() === "") {
        problems.push(`${who}: say the other reason for the late opt-out`);
      }
    }
  }
  return problems;
}

/** The Employee Details file for these employees: HED2, then DED and TED for each. */
export function generateEmployeeDetailsCsv(employerIrd: string, employees: readonly Employee[]): string {
  const rows: string[] = [["HED2", irdNumber9(employerIrd), PAYROLL_PACKAGE, String(employees.length)].join(",")];
  for (const e of employees) {
    const d = e.details ?? {};
    const name = namePartsOf(e);
    const out = d.optedOut === true;
    const bank = out ? bankParts(e.bankAccount) : null;
    const lateOut = out && e.startDate !== undefined && d.optOutSigned !== undefined && daysBetween(e.startDate, d.optOutSigned) > 56;
    const address = d.address !== undefined && d.address.street.trim() !== "" ? d.address : undefined;
    rows.push(
      [
        "DED",
        irdNumber9(e.irdNumber),
        plain(e.name, 255),
        plain(d.title, 50),
        plain(name.first, 50),
        plain(name.middle, 50),
        plain(name.last, 50),
        irdDate(d.dateOfBirth),
        irdDate(e.startDate),
        irdDate(e.finishDate),
        d.kiwiSaverEligibility ?? "",
        d.kiwiSaverEligibility === "NE" ? (d.kiwiSaverStatus ?? "") : "",
        d.exemptIncome ?? "",
        plain(d.email, 510),
        phone(d.mobile) === "" ? "" : "NZL",
        phone(d.mobile),
        "",
        phone(d.daytimePhone) === "" ? "" : "NZL",
        phone(d.daytimePhone),
        "",
        address === undefined ? "" : "NZL",
        "",
        "",
        "",
        "",
        "",
        plain(address?.street, 510),
        plain(address?.suburb, 60),
        plain(address?.city, 100),
        plain(address?.postcode, 30),
        "",
        out ? "Y" : "N",
        bank?.bank ?? "",
        bank?.branch ?? "",
        bank?.number ?? "",
        bank?.suffix ?? "",
        "",
        out ? plain(d.optOutAccountHolder || e.name, 31) : "",
        out ? irdDate(d.optOutSigned) : "",
        lateOut ? (d.lateOptOutReason ?? "") : "",
        lateOut && d.lateOptOutReason === "OTHR" ? plain(d.lateOptOutOther, 500) : "",
      ].join(","),
    );
    rows.push(["TED", e.taxCode].join(","));
  }
  return rows.join("\r\n") + "\r\n";
}
