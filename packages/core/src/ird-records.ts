import type { Cents } from "./money.js";
import { parseAmount } from "./money.js";
import type { IsoDate } from "./dates.js";
import { parseDate } from "./dates.js";
import { parseCsvRecords } from "./csv.js";

/**
 * Records downloaded from myIR, and what they say about these books.
 *
 * Inland Revenue holds the figures that were actually filed and assessed, and
 * the payments it actually received. Everybody with a myIR login can export
 * them, and they are better evidence than another accounting system's copy:
 * a GST return Xero prepared and one Inland Revenue assessed are usually the
 * same, and when they are not, Inland Revenue's is the one that counts.
 *
 * Four exports are read:
 *
 *  * the **GST return summary** -- each filed period's boxes;
 *  * any tax account's **transactions** -- GST, FBT, income tax, PAYE:
 *    assessments, payments, refunds, interest and penalties by date;
 *  * the **employer summary** -- each month's wages and deductions, as filed
 *    in employment information;
 *  * an **individual return's confirmation** (IR3), as the text of the PDF
 *    myIR gives -- copied and pasted, since these books do not read PDFs
 *    without AI.
 *
 * Nothing here decides who is right. It lines the two up and says where they
 * differ, and names the figures these books do not hold at all.
 */

/** The heading every myIR export starts with. */
export interface IrdHeading {
  /** IRD number and account, e.g. `123-456-789-GST001`. Kept for matching; never shown whole. */
  accountId: string;
  /** Whose account, as Inland Revenue names it. */
  name: string;
  from: IsoDate | null;
  to: IsoDate | null;
}

/** One filed GST return, as Inland Revenue holds it. Box numbers are the GST101A's. */
export interface IrdGstPeriod {
  periodEnd: IsoDate;
  /** Box 5. */
  totalSales: Cents;
  /** Box 6. */
  zeroRated: Cents;
  /** Box 9. */
  debitAdjustments: Cents;
  /** Box 10. */
  gstCollected: Cents;
  /** Box 11. */
  totalExpenses: Cents;
  /** Box 13. */
  creditAdjustments: Cents;
  /** Box 14. */
  gstPaid: Cents;
  /** Box 15, signed as Inland Revenue prints it. */
  paymentOrRefund: Cents;
}

export interface IrdAccountRow {
  periodEnd: IsoDate | null;
  /** GST, FBT, INC, EMP -- as the export names it. */
  taxType: string;
  date: IsoDate;
  /** Assessment, Payment, Direct credit refund, Interest, Penalty... */
  transaction: string;
  /**
   * Signed as the export prints it: an assessment of tax to pay positive, a
   * payment received negative, a refund paid out positive. A bank line for
   * the same payment or refund has the same sign.
   */
  amount: Cents;
}

export interface IrdEmployerMonth {
  monthEnd: IsoDate;
  gross: Cents;
  notLiableAcc: Cents;
  paye: Cents;
  childSupport: Cents;
  studentLoan: Cents;
  kiwiSaver: Cents;
  employerKiwiSaverNet: Cents;
  esct: Cents;
  ess: Cents;
  priorGross: Cents;
  priorPaye: Cents;
  totalDeductions: Cents;
}

/** The IR3 confirmation's figures, keyed as below; absent where the return did not show them. */
export type Ir3ConfirmationField =
  | "grossEarnings" | "notLiableAcc" | "paye" | "earnersLevy"
  | "interestGross" | "interestRwt"
  | "dividendsGross" | "imputationCredits" | "dividendRwt"
  | "residentialGross" | "brightLine" | "residentialOther" | "residentialTotal"
  | "residentialDeductions" | "residentialBroughtForward" | "residentialClaimed"
  | "residentialNet" | "residentialCarriedForward"
  | "otherRents" | "pieIncome" | "pieRemaining" | "pieDeductions"
  | "otherIncome" | "propertySale" | "rlwtCredit"
  | "totalIncome" | "totalTaxCredits" | "totalDeductions"
  | "taxableIncome" | "taxOnIncome" | "pieCredit"
  | "residualIncomeTax" | "provisionalTax";

export type IrdRecord =
  | ({ kind: "gst-returns"; periods: IrdGstPeriod[] } & IrdHeading)
  | ({ kind: "account"; taxType: string; rows: IrdAccountRow[] } & IrdHeading)
  | ({ kind: "employer"; months: IrdEmployerMonth[] } & IrdHeading)
  | {
      kind: "ir3";
      /** The tax year, named by the 31 March it ends on. */
      year: number;
      received: IsoDate | null;
      /** Whose return, as the confirmation names them: for choosing the owner. */
      name?: string;
      figures: Partial<Record<Ir3ConfirmationField, Cents>>;
      /** Portfolio or property by property; the provisional tax option; the PIR. */
      text: { method?: string; provisionalOption?: string; pirRate?: string; pirWholeYear?: string };
    };

export interface IrdReadResult {
  record: IrdRecord | null;
  problem?: string;
}

const cents = (text: string | undefined): Cents => parseAmount((text ?? "").replace(/[$,\s]/g, "") || "0") ?? 0;
const date = (text: string | undefined): IsoDate | null =>
  text === undefined || text.trim() === "" ? null : parseDate(text.trim(), { dayFirst: true });

/** The tax type an account id ends with: `...-GST001` is GST. */
export function taxTypeOfAccount(accountId: string): string {
  return /-([A-Z]{3})\d*$/.exec(accountId.trim())?.[1] ?? "";
}

/**
 * Read a myIR spreadsheet, given as CSV text (a workbook goes through
 * `sheetToCsv` first).
 *
 * Which export it is comes from its column headings, not its file name: myIR
 * names every download "Report Response Doc" or "Web Transaction Summary"
 * with a timestamp.
 */
export function readIrdExport(csv: string): IrdReadResult {
  const rows = parseCsvRecords(csv, { skipEmptyRows: true }).map((r) => r.fields.map((f) => f.trim()));
  const labelled = (label: string): string =>
    rows.find((r) => (r[0] ?? "").toLowerCase().replace(/:$/, "") === label)?.[1] ?? "";
  const heading: IrdHeading = {
    accountId: labelled("account id"),
    name: labelled("name"),
    from: date(labelled("from")),
    to: date(labelled("to")),
  };
  const headerAt = rows.findIndex((r) => /^(period|month) ending$/i.test(r[0] ?? ""));
  if (headerAt < 0 || heading.accountId === "") {
    return { record: null, problem: "This does not look like a myIR export: no account id or no table." };
  }
  const header = (rows[headerAt] ?? []).map((h) => h.toLowerCase());
  const col = (...starts: string[]): number =>
    header.findIndex((h) => starts.some((s) => h.startsWith(s)));
  const body = rows.slice(headerAt + 1).filter((r) => date(r[0]) !== null);

  if (col("total sales") >= 0) {
    const at = {
      sales: col("total sales"), zero: col("zero-rated"), debit: col("debit adjust"),
      collected: col("total gst collected"), expenses: col("total expenses"),
      credit: col("credit adjust"), paid: col("total gst paid"), result: col("payment"),
    };
    const periods = body.map((r) => ({
      periodEnd: date(r[0]) as IsoDate,
      totalSales: cents(r[at.sales]),
      zeroRated: cents(r[at.zero]),
      debitAdjustments: cents(r[at.debit]),
      gstCollected: cents(r[at.collected]),
      totalExpenses: cents(r[at.expenses]),
      creditAdjustments: cents(r[at.credit]),
      gstPaid: cents(r[at.paid]),
      paymentOrRefund: cents(r[at.result]),
    }));
    return { record: { kind: "gst-returns", ...heading, periods } };
  }

  if (col("transaction") >= 0 && col("account type") >= 0) {
    const at = { type: col("account type"), date: col("date"), what: col("transaction"), amount: col("amount") };
    const accountRows: IrdAccountRow[] = [];
    for (const r of body) {
      const when = date(r[at.date]);
      if (when === null) continue;
      accountRows.push({
        periodEnd: date(r[0]),
        taxType: r[at.type] ?? "",
        date: when,
        transaction: r[at.what] ?? "",
        amount: cents(r[at.amount]),
      });
    }
    return {
      record: {
        kind: "account",
        ...heading,
        taxType: accountRows[0]?.taxType || taxTypeOfAccount(heading.accountId),
        rows: accountRows,
      },
    };
  }

  if (col("gross earnings") >= 0) {
    const at = {
      gross: col("gross earnings"), acc: col("not liable"), paye: col("paye"),
      child: col("child support"), student: col("student loan"), ks: col("kiwisaver deductions"),
      employer: col("net kiwisaver employer"), esct: col("esct"), ess: col("ess"),
      priorGross: col("total prior period gross"), priorPaye: col("total prior period paye"),
      total: col("total deductions"),
    };
    const months = body.map((r) => ({
      monthEnd: date(r[0]) as IsoDate,
      gross: cents(r[at.gross]),
      notLiableAcc: cents(r[at.acc]),
      paye: cents(r[at.paye]),
      childSupport: cents(r[at.child]),
      studentLoan: cents(r[at.student]),
      kiwiSaver: cents(r[at.ks]),
      employerKiwiSaverNet: cents(r[at.employer]),
      esct: cents(r[at.esct]),
      ess: cents(r[at.ess]),
      priorGross: cents(r[at.priorGross]),
      priorPaye: cents(r[at.priorPaye]),
      totalDeductions: cents(r[at.total]),
    }));
    return { record: { kind: "employer", ...heading, months } };
  }

  return { record: null, problem: "A myIR export, but not one of the kinds read here yet." };
}

/**
 * The IR3 confirmation's figures, in the order the document shows them.
 *
 * Each group is labels followed by their amounts, the way the confirmation
 * lays them out: three headings side by side, then three amounts beneath. A
 * group whose labels are not found -- a return with no dividends shows no
 * dividend section -- is passed over rather than stealing the next group's
 * amounts.
 */
const IR3_GROUPS: readonly (readonly (readonly [string, Ir3ConfirmationField])[])[] = [
  [["total gross income", "grossEarnings"], ["total income not liable for acc", "notLiableAcc"], ["total paye deducted", "paye"]],
  [["minus acc earners' levy", "earnersLevy"]],
  [["total gross interest", "interestGross"], ["total rwt", "interestRwt"]],
  [["total gross dividends", "dividendsGross"], ["total dividend imputation credits", "imputationCredits"], ["total dividend rwt", "dividendRwt"]],
  [["gross residential rental income", "residentialGross"]],
  [["net bright-line profit", "brightLine"]],
  [["other residential income", "residentialOther"]],
  [["total combined residential income", "residentialTotal"], ["residential rental deductions", "residentialDeductions"]],
  [["deductions brought forward", "residentialBroughtForward"], ["residential deductions claimed", "residentialClaimed"]],
  [["net residential income", "residentialNet"], ["deductions carried forward", "residentialCarriedForward"]],
  [["other net rental income", "otherRents"]],
  [["total pie income", "pieIncome"], ["remaining pie amount", "pieRemaining"], ["total pie deductions", "pieDeductions"]],
  [["total other net income", "otherIncome"]],
  [["profit/loss from sale of property", "propertySale"], ["(rlwt) credit", "rlwtCredit"]],
  [["total income", "totalIncome"], ["total tax credits", "totalTaxCredits"]],
  [["total deductions", "totalDeductions"]],
  [["taxable income", "taxableIncome"]],
  [["tax on taxable income", "taxOnIncome"]],
  [["pie credit", "pieCredit"]],
  [["residual income tax", "residualIncomeTax"]],
  [["provisional tax payment", "provisionalTax"]],
];

const MONEY = /-?\$\s?-?[\d,]+\.\d{2}/g;

export function readIr3Confirmation(pasted: string): IrdReadResult {
  // One line, one kind of apostrophe, one kind of space: a PDF viewer's copy
  // breaks lines where the page did and curls quotes as the font had them.
  const text = pasted.replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();
  const yearMatch = /(\d{4}) individual income tax return/i.exec(text);
  if (yearMatch === null) {
    return { record: null, problem: "This is not an individual income tax return confirmation from myIR." };
  }
  const months: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };
  const receivedMatch = /(\d{1,2})-([A-Za-z]{3})-(\d{4})/.exec(text);
  const received = receivedMatch === null
    ? null
    : `${receivedMatch[3]}-${months[receivedMatch[2]!.toLowerCase()] ?? "01"}-${receivedMatch[1]!.padStart(2, "0")}` as IsoDate;

  // "Name IRD Number Date received" then the three values: the name is what
  // sits between the headings and the IRD number.
  const nameMatch = /date received\s+(.+?)\s+\d{2,3}-\d{3}-\d{3}/i.exec(text);
  const name = nameMatch?.[1]?.trim();

  const figures: Partial<Record<Ir3ConfirmationField, Cents>> = {};
  let cursor = 0;
  for (const group of IR3_GROUPS) {
    let at = cursor;
    let found = true;
    for (const [label] of group) {
      const index = lower.indexOf(label, at);
      if (index < 0) {
        found = false;
        break;
      }
      at = index + label.length;
    }
    if (!found) continue;
    MONEY.lastIndex = at;
    const amounts: string[] = [];
    let end = at;
    for (let n = 0; n < group.length; n++) {
      const match = MONEY.exec(text);
      if (match === null) break;
      amounts.push(match[0]);
      end = match.index + match[0].length;
    }
    if (amounts.length < group.length) continue;
    group.forEach(([, key], n) => {
      const raw = amounts[n] ?? "";
      const negative = raw.includes("-");
      const value = cents(raw.replace(/-/g, ""));
      figures[key] = negative ? -value : value;
    });
    cursor = end;
  }

  const after = (label: string, pattern: RegExp): string | undefined => {
    const index = lower.indexOf(label);
    if (index < 0) return undefined;
    return pattern.exec(text.slice(index + label.length, index + label.length + 60))?.[1];
  };
  const textFields: Extract<IrdRecord, { kind: "ir3" }>["text"] = {};
  const method = after("method", /^\s*(portfolio|property[- ]by[- ]property)/i);
  if (method) textFields.method = method;
  const option = after("provisional tax option", /^\s*([A-Za-z-]+)/);
  if (option) textFields.provisionalOption = option;
  const pir = after("correct pir rate", /^\s*(\d{1,2}(?:\.\d+)?)/);
  if (pir) textFields.pirRate = pir;
  const whole = after("correct pir rate used for the entire year", /^\s*(yes|no)/i);
  if (whole) textFields.pirWholeYear = whole;

  if (Object.keys(figures).length === 0) {
    return { record: null, problem: "No figures could be read. Copy the whole document, all three pages." };
  }
  return {
    record: {
      kind: "ir3",
      year: Number(yearMatch[1]),
      received,
      ...(name ? { name } : {}),
      figures,
      text: textFields,
    },
  };
}

// --- checks -----------------------------------------------------------------

export type CheckStatus = "agrees" | "differs" | "not-held" | "outside-books";

export interface IrdCheck {
  /** What the row is for: a period, a month, a payment. */
  group: string;
  label: string;
  ird: Cents | null;
  ours: Cents | null;
  status: CheckStatus;
  note?: string;
}

/** Within a dollar agrees: returns round, and the two sides round differently. */
export const RETURN_TOLERANCE: Cents = 100;

function check(group: string, label: string, ird: Cents, ours: Cents | null | undefined, tolerance = RETURN_TOLERANCE, note?: string): IrdCheck {
  if (ours === null || ours === undefined) {
    return { group, label, ird, ours: null, status: "not-held", ...(note ? { note } : {}) };
  }
  return {
    group,
    label,
    ird,
    ours,
    status: Math.abs(ird - ours) <= tolerance ? "agrees" : "differs",
    ...(note ? { note } : {}),
  };
}

/** A GST return's boxes, as either side holds them. Box 15 signed: positive to pay. */
export interface GstBoxes {
  box5: Cents; box6: Cents; box9: Cents; box10: Cents;
  box11: Cents; box13: Cents; box14: Cents; box15: Cents;
}

export function irdPeriodBoxes(period: IrdGstPeriod): GstBoxes {
  return {
    box5: period.totalSales,
    box6: period.zeroRated,
    box9: period.debitAdjustments,
    box10: period.gstCollected,
    box11: period.totalExpenses,
    box13: period.creditAdjustments,
    box14: period.gstPaid,
    // Worked out rather than read, so its sign is the form's own: Box 10 less
    // Box 14, positive to pay. The export's last column is printed with
    // whichever sign Inland Revenue's account used that day.
    box15: period.gstCollected - period.gstPaid,
  };
}

const BOX_LABELS: readonly (readonly [keyof GstBoxes, string])[] = [
  ["box5", "Box 5 Total sales and income"],
  ["box6", "Box 6 Zero-rated supplies"],
  ["box9", "Box 9 Debit adjustments"],
  ["box10", "Box 10 Total GST collected"],
  ["box11", "Box 11 Total purchases and expenses"],
  ["box13", "Box 13 Credit adjustments"],
  ["box14", "Box 14 Total GST credit"],
  ["box15", "Box 15 GST to pay (refund negative)"],
];

/**
 * Each filed period against the return these books work out for it.
 *
 * `ours` has no entry for a period the books cannot produce -- before they
 * start, or a period that does not fall on this entity's cycle -- and those
 * are said as such rather than as differences.
 */
export function checkGstReturns(
  periods: readonly IrdGstPeriod[],
  ours: (periodEnd: IsoDate) => GstBoxes | null | "outside-books",
): IrdCheck[] {
  const out: IrdCheck[] = [];
  for (const period of [...periods].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd))) {
    const group = `Period ending ${period.periodEnd}`;
    const theirs = irdPeriodBoxes(period);
    const mine = ours(period.periodEnd);
    for (const [box, label] of BOX_LABELS) {
      if (mine === "outside-books") {
        out.push({ group, label, ird: theirs[box], ours: null, status: "outside-books", note: "Before these books start." });
      } else if (mine === null) {
        out.push({
          group, label, ird: theirs[box], ours: null, status: "not-held",
          note: "No return is worked out for this period: check the entity's GST filing frequency.",
        });
      } else {
        out.push(check(group, label, theirs[box], mine[box]));
      }
    }
  }
  return out;
}

/** A bank line, as much of one as the payment check needs. */
export interface BankLineRef {
  id: string;
  date: IsoDate;
  amount: Cents;
  who: string;
}

/**
 * Each payment and refund on a tax account, found in the bank.
 *
 * The same amount and sign within ten days: Inland Revenue dates a payment
 * the day it arrives, which is a day or two after the bank sent it, and a
 * refund the day it left. Each bank line answers one payment at most.
 * Interest and penalties Inland Revenue charged are named as not held: no
 * bank line pays them on its own, and a set of books that leaves them out
 * understates what is owed.
 */
export function checkAccountTransactions(
  rows: readonly IrdAccountRow[],
  bank: readonly BankLineRef[],
  options: {
    /** Before this, the books hold no bank lines, so a missing one is not a difference. */
    booksStart?: IsoDate;
    /** Box 15 as these books work it out, by period end; for the assessments. */
    assessment?: (periodEnd: IsoDate) => Cents | null | undefined;
  } = {},
): IrdCheck[] {
  const used = new Set<string>();
  const out: IrdCheck[] = [];
  for (const row of [...rows].sort((a, b) => a.date.localeCompare(b.date))) {
    const what = row.transaction.toLowerCase();
    const group = `${row.date} ${row.transaction}` + (row.periodEnd ? ` (period ending ${row.periodEnd})` : "");
    if (what.includes("assessment")) {
      const ours = row.periodEnd === null ? undefined : options.assessment?.(row.periodEnd);
      out.push(
        ours === undefined
          ? { group, label: "Tax assessed", ird: row.amount, ours: null, status: "not-held", note: "Not worked out in these books." }
          : check(group, "Tax assessed", row.amount, ours),
      );
      continue;
    }
    // "Late payment penalty" is a penalty, not a payment: charges first.
    const charge = what.includes("penalt") || what.includes("interest");
    if (!charge && (what.includes("payment") || what.includes("refund"))) {
      if (options.booksStart !== undefined && row.date < options.booksStart) {
        out.push({ group, label: "Bank line", ird: row.amount, ours: null, status: "outside-books", note: "Before these books start." });
        continue;
      }
      const match = bank.find(
        (b) =>
          !used.has(b.id) &&
          b.amount === row.amount &&
          Math.abs(Date.parse(b.date) - Date.parse(row.date)) <= 10 * 86_400_000,
      );
      if (match !== undefined) used.add(match.id);
      out.push(
        match === undefined
          ? { group, label: "Bank line", ird: row.amount, ours: null, status: "differs", note: "No bank line of this amount within ten days." }
          : { group, label: "Bank line", ird: row.amount, ours: match.amount, status: "agrees", note: `${match.date} ${match.who}`.trim() },
      );
      continue;
    }
    // Interest, penalties, transfers between tax types, remissions.
    out.push({
      group,
      label: row.transaction,
      ird: row.amount,
      ours: null,
      status: "not-held",
      note:
        what.includes("interest")
          ? "Use-of-money interest: journal it. Interest charged is deductible; interest paid to you is income."
          : what.includes("penalt")
            ? "A penalty: journal it. Penalties are not deductible."
            : "Not in these books: journal it if it changes what is owed.",
    });
  }
  return out;
}

/** One month of pay runs, added up the way employment information reports it. */
export interface PayrollMonth {
  gross: Cents; notLiableAcc: Cents; paye: Cents; childSupport: Cents; studentLoan: Cents;
  kiwiSaver: Cents; employerKiwiSaverNet: Cents; esct: Cents; ess: Cents;
  priorGross: Cents; priorPaye: Cents;
}

const EMPLOYER_LABELS: readonly (readonly [keyof PayrollMonth, string])[] = [
  ["gross", "Gross earnings"],
  ["notLiableAcc", "Not liable for ACC earners' levy"],
  ["paye", "PAYE"],
  ["childSupport", "Child support"],
  ["studentLoan", "Student loan"],
  ["kiwiSaver", "KiwiSaver deductions"],
  ["employerKiwiSaverNet", "Net KiwiSaver employer contributions"],
  ["esct", "ESCT"],
  ["ess", "ESS benefits"],
  ["priorGross", "Prior period gross adjustments"],
  ["priorPaye", "Prior period PAYE adjustments"],
];

export function checkEmployerMonths(
  months: readonly IrdEmployerMonth[],
  ours: (monthEnd: IsoDate) => PayrollMonth | null,
): IrdCheck[] {
  const out: IrdCheck[] = [];
  for (const month of [...months].sort((a, b) => a.monthEnd.localeCompare(b.monthEnd))) {
    const group = `Month ending ${month.monthEnd}`;
    const mine = ours(month.monthEnd);
    for (const [key, label] of EMPLOYER_LABELS) {
      if (mine === null) {
        if (month[key] !== 0) {
          out.push({ group, label, ird: month[key], ours: null, status: "not-held", note: "No pay runs in these books for this month." });
        }
        continue;
      }
      // To the cent: payroll figures are not rounded to the dollar.
      out.push(check(group, label, month[key], mine[key], 0));
    }
    if (mine !== null) {
      const deductions =
        mine.paye + mine.childSupport + mine.studentLoan + mine.kiwiSaver + mine.employerKiwiSaverNet + mine.esct;
      out.push(check(group, "Total deductions (paid to Inland Revenue)", month.totalDeductions, deductions, 0));
    }
  }
  return out;
}

/**
 * The IR3 confirmation against the IR3 these books prepare, box by box.
 *
 * `ours` gives a figure by IR3 box number. The confirmation's figures with no
 * box here -- the PIE amounts left over, a property sale, RLWT, the PIR -- are
 * listed as not held.
 */
export const IR3_BOX_FOR: Partial<Record<Ir3ConfirmationField, string>> = {
  grossEarnings: "11B",
  paye: "11A",
  interestGross: "13B",
  interestRwt: "13A",
  dividendsGross: "14B",
  imputationCredits: "14",
  dividendRwt: "14A",
  residentialGross: "22A",
  brightLine: "22B",
  residentialOther: "22C",
  residentialTotal: "22D",
  residentialDeductions: "22E",
  residentialBroughtForward: "22F",
  residentialClaimed: "22G",
  residentialNet: "22H",
  residentialCarriedForward: "22I",
  otherRents: "23",
  pieIncome: "35B",
  pieDeductions: "35A",
  otherIncome: "27",
  totalDeductions: "29",
  taxableIncome: "32",
  taxOnIncome: "36",
  residualIncomeTax: "36A",
  provisionalTax: "39B",
};

export const IR3_FIELD_LABELS: Record<Ir3ConfirmationField, string> = {
  grossEarnings: "Total gross income (salary and wages)",
  notLiableAcc: "Total income not liable for ACC earners' levy",
  paye: "Total PAYE deducted",
  earnersLevy: "ACC earners' levy",
  interestGross: "Total gross interest",
  interestRwt: "Total RWT on interest",
  dividendsGross: "Total gross dividends",
  imputationCredits: "Total dividend imputation credits",
  dividendRwt: "Total dividend RWT / foreign dividend payments",
  residentialGross: "Gross residential rental income",
  brightLine: "Net bright-line profit",
  residentialOther: "Other residential income",
  residentialTotal: "Total combined residential income",
  residentialDeductions: "Residential rental deductions",
  residentialBroughtForward: "Excess residential deductions brought forward",
  residentialClaimed: "Residential deductions claimed this year",
  residentialNet: "Net residential income",
  residentialCarriedForward: "Excess residential deductions carried forward",
  otherRents: "Other net rental income",
  pieIncome: "Total PIE income",
  pieRemaining: "Remaining PIE amount",
  pieDeductions: "Total PIE deductions",
  otherIncome: "Total other net income",
  propertySale: "Profit or loss from sale of property",
  rlwtCredit: "Residential land withholding tax credit",
  totalIncome: "Total income",
  totalTaxCredits: "Total tax credits",
  totalDeductions: "Total deductions",
  taxableIncome: "Taxable income",
  taxOnIncome: "Tax on taxable income",
  pieCredit: "PIE credit",
  residualIncomeTax: "Residual income tax",
  provisionalTax: "Provisional tax payment (next year)",
};

export function checkIr3(
  record: Extract<IrdRecord, { kind: "ir3" }>,
  ours: ((box: string) => Cents | null | undefined) | null,
): IrdCheck[] {
  const group = `IR3 for the year to 31 March ${record.year}`;
  const out: IrdCheck[] = [];
  for (const [key, label] of Object.entries(IR3_FIELD_LABELS) as [Ir3ConfirmationField, string][]) {
    const ird = record.figures[key];
    if (ird === undefined) continue;
    const box = IR3_BOX_FOR[key];
    if (box === undefined || ours === null) {
      out.push({
        group, label, ird, ours: null, status: "not-held",
        note: ours === null ? "No IR3 is prepared for this owner and year." : "Not a figure these books work out.",
      });
      continue;
    }
    out.push(check(group, `${label} (box ${box})`, ird, ours(box) ?? null));
  }
  return out;
}
