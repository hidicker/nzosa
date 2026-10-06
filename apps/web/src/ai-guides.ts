import { gstFrequency, postedJournals } from "./books.js";
import { reviewFacts } from "./ai-review.js";
import { ir3For } from "./daily/reports.js";
import { state } from "./state.js";
import { emptyEntityModel, formatAmount, shareholderSchedule, splitByShareholding } from "@nzosa/core";
import type { Cents } from "@nzosa/core";

/**
 * Checking the books against Inland Revenue's own guides.
 *
 * The guides are too long to paste -- IR335 alone is about 50,000 tokens -- so
 * the person attaches the PDF itself to an assistant, beside the workbook, and
 * this writes the prompt: what the guide is for, the facts of the year, and a
 * checklist of what to look up in that guide for these books. One guide at a
 * time, because four long PDFs and a workbook is more than most assistants
 * read well, and a focused check is a better one.
 *
 * Nothing is bundled: IRD publishes a new edition each year, and a link to
 * its own copy is always the current one.
 */

const IRD = "https://www.ird.govt.nz/-/media/project/ir/home/documents/forms-and-guides";
export const IRD_FORMS_INDEX = "https://www.ird.govt.nz/index/all-forms-and-guides";

export type GuideId = "IR375" | "IR3G" | "IR4GU" | "IR335";

export interface IrdGuide {
  id: GuideId;
  title: string;
  /** Where to get it for this year, or null when IRD has not published that year's yet. */
  url: (year: number) => string | null;
  /** How the edition relates to the year being checked, said on the page and in the prompt. */
  edition: (year: number) => string;
  /** Why it applies to these books, or null when it does not. */
  applies: () => string | null;
  /** Facts beyond the shared ones that this guide's checks need. */
  facts: (year: number) => string[];
  checks: string[];
}

const money = (c: Cents): string => formatAmount(c);

/** Whether IRD will have published a yearly guide for the year to 31 March `year` by now. */
function yearlyPublished(year: number): boolean {
  const today = new Date();
  const y = today.getFullYear();
  // Each year's return guides come out around 1 April, as the year ends.
  return year < y || (year === y && today.getMonth() >= 3);
}

function yearly(folder: string, name: string) {
  return {
    url: (year: number): string | null =>
      yearlyPublished(year) ? `${IRD}/ir1---ir99/${folder}/${name}-${year}.pdf` : null,
    edition: (year: number): string =>
      yearlyPublished(year)
        ? `the ${year} edition, for the year to 31 March ${year}`
        : `the ${year} edition, which IRD publishes when the year ends -- until then use the latest and say so`,
  };
}

const entities = () => (state.ledger.entities ?? emptyEntityModel()).entities;

function owners(): string[] {
  return [...new Set(entities().flatMap((e) => (e.owners ?? []).map((o) => o.name)))];
}

function companies() {
  return entities().filter(
    (e) => (e.shareholders ?? []).length > 0 || ((e.owners ?? []).length === 0 && (e.kind ?? "business") === "business"),
  );
}

export const IRD_GUIDES: readonly IrdGuide[] = [
  {
    id: "IR375",
    title: "GST guide (IR375)",
    url: () => `${IRD}/ir300---ir399/ir375/ir375.pdf`,
    edition: () => "IRD's current edition, which covers every GST period until it is replaced",
    applies: () => {
      const registered = entities().filter((e) => e.gstRegistered !== false && e.kind !== "personal");
      return registered.length > 0
        ? `${registered.map((e) => e.name).join(", ")} ${registered.length === 1 ? "is" : "are"} registered for GST`
        : null;
    },
    facts: () => {
      const f = gstFrequency();
      return [
        `Filing frequency used for these returns: ${f === 1 ? "monthly" : f === 6 ? "six-monthly" : "two-monthly"}, payments basis.`,
        "This software halves the GST on part-deductible entertainment in each period, rather than",
        "claiming it in full and adjusting once a year in Box 9.",
      ];
    },
    checks: [
      "Each GST period's boxes 5 to 15, as the guide says each is filled, against the figures above.",
      "The accounting basis and filing frequency: whether these books qualify for them.",
      "Exempt and zero-rated supplies: residential rent is exempt and nothing can be claimed on its costs; commercial rent is standard-rated. Say where an account's treatment is wrong.",
      "Entertainment: the guide's method (claim in full, a yearly adjustment in Box 9) against what these books do, and what that changes.",
      "Private use: vehicles and any home office, and the adjustment the guide requires.",
      "Imports: GST on a Customs document belongs in Box 13, not Box 11.",
      "Taxable supply information: which claims need it at the guide's thresholds.",
      "Bad debts, change-of-use adjustments and late claims, where the figures show any.",
      "Due dates and payment for each period, including the 7 May and 15 January exceptions.",
    ],
  },
  {
    id: "IR3G",
    title: "Individual income tax return guide (IR3G)",
    ...yearly("ir3g", "ir3g"),
    applies: () => {
      const people = owners();
      return people.length > 0 ? `${people.join(" and ")} file${people.length === 1 ? "s" : ""} an IR3` : null;
    },
    facts: (year) => {
      const lines: string[] = [];
      for (const owner of owners()) {
        let result;
        try {
          result = ir3For(owner, year);
        } catch {
          continue;
        }
        lines.push(`IR3 for ${owner}, as these books work it out:`);
        for (const b of result.boxes) {
          lines.push(`  ${b.box} ${b.title}: ${b.amount !== undefined ? money(b.amount) : (b.text ?? "")}`);
        }
        for (const note of result.notes ?? []) lines.push(`  Note: ${note}`);
        lines.push("");
      }
      return lines;
    },
    checks: [
      "Each owner's IR3 boxes above, against what the guide says goes in each.",
      "Income that never reaches these books: salary, interest, dividends, PIE, overseas income, and whether anything the guide lists is missing.",
      "The residential rental schedule: what is deductible, ring-fencing of losses, the interest limitation for this year, and any bright-line sale.",
      "Commercial and other rental income: where it belongs on the IR3.",
      "The independent earner tax credit: eligibility and the amount.",
      "The tax worked out, the residual income tax, and provisional tax for next year.",
      "Deductions the guide allows that these books do not claim, and ones claimed that it does not allow.",
    ],
  },
  {
    id: "IR4GU",
    title: "Company tax return guide (IR4GU)",
    ...yearly("ir4gu", "ir4gu"),
    applies: () => {
      const c = companies();
      return c.length > 0 ? `${c.map((e) => e.name).join(", ")} ${c.length === 1 ? "is" : "are"} a company` : null;
    },
    facts: (year) => {
      const schedule = shareholderSchedule({
        from: `${year - 1}-04-01`,
        to: `${year}-03-31`,
        journals: postedJournals(),
        ...(state.ledger.openingBalances ? { openingBalances: state.ledger.openingBalances } : {}),
        chart: state.chart,
      });
      const lines = [
        "Shareholder current account for the year:",
        `  Opening ${money(schedule.opening)}, put in ${money(schedule.introduced)}, drawn ${money(schedule.drawings)}, closing ${money(schedule.closing)} (credit is owed to shareholders).`,
      ];
      for (const company of companies()) {
        const holders = company.shareholders ?? [];
        if (holders.length === 0) continue;
        for (const part of splitByShareholding(schedule, holders)) {
          lines.push(`  ${company.name}, ${part.name} (${part.percent}%): closing ${money(part.closing)}`);
        }
      }
      return lines;
    },
    checks: [
      "The IR4 boxes, and the IR10 figures above against what the guide says each takes.",
      "Losses brought forward and carried forward, and the shareholder continuity test.",
      "Shareholder current accounts: each shareholder's balance for the IR4, any overdrawn account and the interest or FBT the guide says follows.",
      "Shareholder salaries and how they are taxed and reported.",
      "Non-deductible expenses (entertainment and others) and the tax adjustments box.",
      "Imputation: the credit account and dividends paid, if any.",
      "Anything the guide asks the company to declare that these books do not show.",
    ],
  },
  {
    id: "IR335",
    title: "Employer's guide (IR335)",
    url: () => `${IRD}/ir300---ir399/ir335/ir335.pdf`,
    edition: () => "IRD's current edition, which applies from its date until replaced",
    applies: () => {
      const runs = state.ledger.payroll?.payRuns ?? [];
      return runs.length > 0 ? `${runs.length} pay run${runs.length === 1 ? " is" : "s are"} recorded` : null;
    },
    facts: (year) => {
      const from = `${year - 1}-04-01`;
      const to = `${year}-03-31`;
      const runs = (state.ledger.payroll?.payRuns ?? []).filter((r) => r.payDate >= from && r.payDate <= to);
      const lines = [`Pay runs in the year: ${runs.length}.`];
      for (const run of runs.slice(0, 60)) {
        lines.push(`  Payday ${run.payDate} (${run.periodStart} to ${run.periodEnd}):`);
        for (const l of run.lines) {
          lines.push(
            `    ${l.taxCode}, ${l.frequency ?? ""}: gross ${money(l.gross)}, PAYE ${money(l.paye)}, ` +
              `student loan ${money(l.studentLoan)}, KiwiSaver ${money(l.kiwiSaverEmployee)} + employer ` +
              `${money(l.kiwiSaverEmployer)}, ESCT ${money(l.esct)}, child support ${money(l.childSupport)}` +
              (l.extraPay ? `, extra pay ${money(l.extraPay)}` : ""),
          );
        }
      }
      if (runs.length > 60) lines.push(`  (and ${runs.length - 60} more in the workbook)`);
      return lines;
    },
    checks: [
      "PAYE for each tax code shown, and whether the tax codes are ones an employee can hold.",
      "KiwiSaver: employee and compulsory employer rates for the year, and who must be enrolled.",
      "ESCT: the rate bands and how the rate is set for each employee.",
      "Student loan, child support and other deductions.",
      "Extra pays (bonuses, holiday pay, redundancy) and how the guide says to tax them.",
      "Payday filing: due within two working days of payday, and new and departing employee details.",
      "When deductions must be paid to Inland Revenue.",
      "Records the guide says an employer must keep that these books do not show.",
    ],
  },
];

/** The guides these books need, each with why. */
export function guidesForBooks(): { guide: IrdGuide; why: string }[] {
  return IRD_GUIDES.flatMap((guide) => {
    const why = guide.applies();
    return why === null ? [] : [{ guide, why }];
  });
}

/** The prompt that goes with one guide, attached as a PDF, and the workbook. */
export function guidePrompt(guide: IrdGuide, year: number): string {
  const published = guide.url(year) !== null;
  return [
    `Check this small New Zealand set of books against Inland Revenue's ${guide.title}, which I`,
    "have attached as a PDF, along with a workbook of the books themselves.",
    "",
    "Rules:",
    `- The attached ${guide.id} is the authority. For every finding, give the page number and heading`,
    "  in the guide it rests on.",
    `- Where the guide does not cover something, say "not covered by ${guide.id}" rather than`,
    "  answering from memory.",
    `- If no ${guide.id} is attached, or you cannot read it, say so first and stop.`,
    "- The figures below and in the workbook are the facts. Do not assume others; say what you would",
    "  need to see.",
    `- The books are for the year 1 April ${year - 1} to 31 March ${year}. Use ${guide.edition(year)}.`,
    ...(published ? [] : ["  Say at the top which edition you were given."]),
    "",
    "Answer in plain English in three groups, most serious first in each:",
    "  WRONG -- what does not match the guide, the figure, and the guide's page.",
    "  CHECK -- what the guide says needs a fact these books do not show.",
    "  FINE -- what you checked and found right, briefly.",
    "Then name the three findings that would change the tax most, and offer to go further into any.",
    "Say at the end that this is a draft for a qualified person to review, not advice.",
    "",
    "THE BOOKS",
    ...reviewFacts(year),
    "",
    ...guide.facts(year),
    "",
    `WHAT TO CHECK AGAINST ${guide.id}`,
    ...guide.checks.map((c) => `- ${c}`),
  ].join("\n");
}
