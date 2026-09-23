import { postedJournals, varianceInput } from "./books.js";
import { reportLookups } from "./daily/reports.js";
import { state } from "./state.js";
import { note } from "./ui.js";
import { computeOurReturns } from "./variance.js";
import {
  accountTreatment,
  emptyEntityModel,
  financialYearOf,
  formatAmount,
  ir10Summary,
} from "@nzosa/core";
import type { GstReturnResult } from "@nzosa/core";

/**
 * A year-end review of the accounts, asked in whichever of three ways.
 *
 * Not the coding queue. That asks about one transaction at a time and gets a
 * code back; this asks what a reviewer would ask at year end and gets prose
 * back, which nothing here can check. So nothing here pretends to: the answer
 * is shown as what it is, a draft for a person to read.
 *
 * It points the model at OpenAccountants, a library of tax guides written
 * against primary sources -- the Acts, and Inland Revenue's own material --
 * and served over MCP. A model with that connected can say which source a
 * figure came from; a model without it cannot say anything about where its
 * answer came from at all.
 *
 * What it is not: reviewed. The library carries a verification status per
 * guide and every New Zealand one is an unreviewed draft today. So the prompt
 * asks for that status to be repeated rather than for an accountant's name,
 * because asking for a name where there is none invites one to be invented.
 *
 * Three prompts rather than one, because they are three different jobs. The
 * first version carried account totals and nothing else, and then asked
 * whether the GST treatments were right -- a question its own contents could
 * not answer, since a net figure says nothing about whether a supply is
 * standard-rated. A GST review wants every period's boxes, what was filed
 * against them and the treatment on each account; an income tax review wants
 * the IR10, whether it balances, and the depreciation. Asking for all of it
 * at once answered none of it properly.
 */

export const OPENACCOUNTANTS_MCP = "https://www.openaccountants.com/api/mcp";
export const OPENACCOUNTANTS_CONNECT = "https://www.openaccountants.com/connect";

export type ReviewFocus = "year" | "gst" | "incometax";

export const REVIEW_FOCUSES: { id: ReviewFocus; label: string; blurb: string }[] = [
  {
    id: "year",
    label: "The year as a whole",
    blurb:
      "What sits in an account it does not belong in, what is missing, and what needs a " +
      "record the books do not hold.",
  },
  {
    id: "gst",
    label: "GST: treatments, returns and what was filed",
    blurb:
      "Every period's boxes as these books compute them, against what was filed, with the " +
      "treatment set on each account and whatever the return left out.",
  },
  {
    id: "incometax",
    label: "Income tax and the IR10",
    blurb:
      "The IR10 boxes as they stand, whether the balance sheet holds together, depreciation, " +
      "drawings and ring-fencing.",
  },
];

/** The New Zealand guides that library holds, so the model can name them. */
const NZ_GUIDES = [
  "nz-income-tax-ir3",
  "nz-gst-return",
  "nz-provisional-tax",
  "nz-acc-levies",
  "nz-capital-gains",
  "nz-tax-residency",
  "nz-timing-deductions-when-expense-incurred",
  "nz-motor-vehicle-expenses-logbook-business-use",
];

export function yearsInBooks(): number[] {
  return [...new Set(state.ledger.transactions.map((t) => financialYearOf(t.date)))].sort(
    (a, b) => b - a,
  );
}

function kindWords(kind: string | undefined): string {
  if (kind === "residential") return "residential rental (losses ring-fenced)";
  if (kind === "commercial") return "commercial rental";
  if (kind === "personal") return "personal affairs";
  return "business";
}

const money = (cents: number): string => formatAmount(cents);

interface Period {
  from: string;
  to: string;
}

const periodOf = (year: number): Period => ({ from: `${year - 1}-04-01`, to: `${year}-03-31` });

/**
 * Chart accounts only, and never a bank one.
 *
 * A posted line's account is the chart code where there is one and the bank
 * account's own id where there is not -- so taking them all put a real bank
 * account number into a prompt, which is the one thing the panel that turns
 * this on promises never leaves this machine. A reviewer does not need it:
 * what the bank holds is a balance, and the question is about the accounts
 * the money moved through.
 */
function chartAccounts(): Map<string, { name: string; type: string; taxCode: string }> {
  return new Map(
    state.chart
      .filter((account) => account.code.trim() !== "")
      .filter((account) => account.type.trim().toLowerCase() !== "bank")
      .map((account) => [
        account.code.trim(),
        {
          name: account.name.trim(),
          type: account.type.trim(),
          taxCode: (account.taxCode ?? "").trim(),
        },
      ]),
  );
}

/**
 * Totals for the year, by chart account, with how each one is treated.
 *
 * The treatment is the addition that mattered. The review was being asked
 * whether the GST treatments were right while being sent nothing but net
 * totals, which nobody could have answered: a figure says nothing about
 * whether the supply behind it is standard-rated, zero-rated or exempt.
 */
function accountTotals(period: Period): string[] {
  const accounts = chartAccounts();
  const { sectionOf } = reportLookups();
  const totals = new Map<string, number>();

  for (const journal of postedJournals()) {
    if (journal.date < period.from || journal.date > period.to) continue;
    for (const line of journal.lines) {
      const code = line.accountCode.trim();
      if (!accounts.has(code)) continue;
      totals.set(code, (totals.get(code) ?? 0) + line.amount);
    }
  }

  const full = new Map(state.chart.map((one) => [one.code.trim(), one]));
  return [...totals.entries()]
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .map(([code, amount]) => {
      const account = accounts.get(code);
      const where = sectionOf(code);
      const whole = full.get(code);
      const treated = whole === undefined ? null : accountTreatment(whole);
      const tax =
        account !== undefined && account.taxCode !== ""
          ? account.taxCode
          : treated === null
            ? "NO GST TREATMENT SET"
            : treated.treatment;
      return (
        `- ${code} ${account?.name ?? ""} [${account?.type ?? "?"}` +
        (where === null ? "" : `, ${where}`) +
        `]: ${money(amount)} · GST: ${tax}`
      );
    });
}

/** What has not been answered, said wherever it changes a figure. */
function uncodedBlock(period: Period): string[] {
  let uncoded = 0;
  let gross = 0;
  for (const transaction of state.ledger.transactions) {
    if (transaction.date < period.from || transaction.date > period.to) continue;
    const override = (state.ledger.overrides ?? {})[transaction.id];
    if (override?.code === undefined || override.code === "") {
      uncoded += 1;
      gross += transaction.amount;
    }
  }
  if (uncoded === 0) return [];
  return [
    "",
    `NOT YET CODED: ${uncoded} transactions, ${money(gross)} in total. Any conclusion about`,
    "profit, GST or tax is short by whatever those turn out to be, and your answer must say so.",
  ];
}

function entitiesBlock(): string[] {
  const model = state.ledger.entities ?? emptyEntityModel();
  const lines = ["Entities in these books:"];
  for (const entity of model.entities) {
    lines.push(
      `- ${entity.name}: ${kindWords(entity.kind)}, ` +
        `${entity.gstRegistered === false ? "NOT GST registered" : "GST registered"}` +
        (entity.owners !== undefined && entity.owners.length > 0
          ? `, owned ${entity.owners.map((o) => `${o.name} ${o.percent}%`).join(" / ")}`
          : "") +
        (entity.about ? `. ${entity.about}` : ""),
    );
  }
  return lines;
}

/** The instructions all three share. */
function preamble(year: number, what: string): string[] {
  return [
    "You are reviewing a small New Zealand set of books at year end, as an accountant would",
    "before signing anything off.",
    "",
    `What to look at this time: ${what}`,
    "",
    "Use the OpenAccountants MCP connector for the rules rather than your training data:",
    `  ${OPENACCOUNTANTS_MCP}`,
    "Its New Zealand guides include " + NZ_GUIDES.join(", ") + ".",
    "Name the guide you used for every figure or rule you rely on, and repeat that guide's",
    "verification status exactly as the guide gives it. Most New Zealand guides are unreviewed",
    "drafts written from primary sources; say so where that is what they say, and never",
    "describe one as reviewed or signed off unless it tells you it is. Where the connector is",
    "not available to you, or a lookup is refused, say so plainly at the top of your answer",
    "rather than answering from memory as though it were.",
    "",
    "Answer in plain English, most serious first, each point naming the account and the figure.",
    "Say what you are unsure of, and say what you would need to see to be sure. This is a",
    "draft for a qualified person to review, not advice, and you should say so at the end.",
    "",
    `Financial year: 1 April ${year - 1} to 31 March ${year}.`,
    "",
  ];
}

// --- GST -------------------------------------------------------------------

function ourReturns(period: Period): GstReturnResult[] {
  try {
    return computeOurReturns(varianceInput(), period.from, period.to).filter(
      (one) => one.period.to >= period.from && one.period.to <= period.to,
    );
  } catch {
    return [];
  }
}

/**
 * Every period's return, and what was filed against it.
 *
 * The comparison is the review. A return computed from the books and a return
 * actually filed are two claims about the same period, and a year-end check
 * is largely the business of explaining where they differ. Box 8 less Box 12
 * is the figure to compare, because that is the period's own trading -- Box
 * 15 also carries late claims and year-end corrections that no bank data can
 * contain.
 */
function gstBlock(period: Period): string[] {
  const returns = ourReturns(period);
  if (returns.length === 0) {
    return ["GST: no periods in this year hold any transactions."];
  }

  const lines: string[] = [
    `GST basis: ${returns[0]?.basis ?? "payments"}.`,
    "",
    "NOTE ON THIS LEDGER: GST is filed on a payments basis, so the tax point rides on the",
    "clearing line of the settling receipt rather than on the invoice. The accounts are the",
    "same ones Xero uses; the GST timing differs, and that difference is deliberate.",
    "",
    "Each period below is as THESE BOOKS compute it, then what was filed against it, if",
    "anything. Box 5 total sales, 6 zero-rated, 7 exempt, 8 GST on sales, 9 adjustments and",
    "late claims, 11 total purchases, 12 GST on purchases, 13 credit adjustments, 15 net.",
    "",
  ];

  for (const one of returns) {
    const boxes = one.boxes;
    const core = (boxes.box8 ?? 0) - (boxes.box12 ?? 0);
    lines.push(`Period ${one.period.from} to ${one.period.to}`);
    lines.push(
      `  ours: box5 ${money(boxes.box5 ?? 0)}, box8 ${money(boxes.box8 ?? 0)}, ` +
        `box11 ${money(boxes.box11 ?? 0)}, box12 ${money(boxes.box12 ?? 0)}, ` +
        `net (8 less 12) ${money(core)}`,
    );

    const filed = state.filed.find((entry) => entry.periodEnd === one.period.to);
    if (filed === undefined) {
      lines.push("  filed: nothing recorded in these books for this period.");
    } else {
      lines.push(
        `  filed (${filed.status}, ${filed.basis}): box8 ${money(filed.boxes.box8)}, ` +
          `box12 ${money(filed.boxes.box12)}, net ${money(filed.core)}` +
          ` — difference ${money(core - filed.core)}`,
      );
    }

    if (one.excluded.length > 0) {
      lines.push(`  ${one.excluded.length} transactions were excluded from the return.`);
    }
    if (one.lateClaims.length > 0) {
      lines.push(`  ${one.lateClaims.length} late claims, sitting in box 9 or box 13.`);
    }
    if (one.missingTaxPoint.length > 0) {
      lines.push(
        `  ${one.missingTaxPoint.length} transactions have no tax point recorded and were`,
        "    placed by payment date. On an invoice basis this is not yet a true return.",
      );
    }
  }
  return lines;
}

// --- income tax ------------------------------------------------------------

/**
 * The IR10, as these books would fill it in.
 *
 * The imbalance is in it on purpose. Owners' equity is the difference between
 * assets and liabilities, so the form cannot fail to balance -- which makes a
 * non-zero imbalance a statement about the books behind it rather than about
 * the form, and the first thing a reviewer should be told.
 */
function ir10Block(year: number): string[] {
  const model = state.ledger.entities ?? emptyEntityModel();
  const company = model.entities.some((one) => (one.kind ?? "business") === "business");
  let summary;
  try {
    summary = ir10Summary({
      yearEnding: `${year}-03-31`,
      yearStarting: `${year - 1}-04-01`,
      journals: postedJournals(),
      ...(state.ledger.openingBalances
        ? { openingBalances: state.ledger.openingBalances }
        : {}),
      chart: state.chart,
      assets: state.ledger.assets ?? [],
      proceeds: state.ledger.assetProceeds ?? {},
      currentAccountsAsLiabilities: company,
    });
  } catch (error) {
    return [`IR10: could not be worked out — ${(error as Error).message}`];
  }

  const lines = ["IR10 as these books fill it in (box, title, figure):"];
  for (const box of Object.values(summary.boxes).sort((a, b) => a.box - b.box)) {
    if (box.amount === 0 && box.text === undefined) continue;
    lines.push(
      `- ${box.box} ${box.title}: ${box.text ?? money(box.amount)}` +
        (box.calculated ? " (worked out from other boxes)" : ""),
    );
  }
  lines.push(
    "",
    summary.imbalance === 0
      ? "The balance sheet holds together: every account's closing balance sums to zero."
      : `THE BOOKS DO NOT BALANCE: closing balances sum to ${money(summary.imbalance)} rather ` +
        "than zero. Say so first, and treat every figure below it as provisional.",
  );

  if (!state.ledger.openingBalances) {
    lines.push(
      "",
      "No opening balances are set, so the balance sheet starts from nothing and every",
      "brought-forward figure is missing. Say what that makes unanswerable.",
    );
  }
  return lines;
}

/** The asset register, which is where a depreciation question is answered. */
function assetsBlock(period: Period): string[] {
  const assets = state.ledger.assets ?? [];
  if (assets.length === 0) {
    return [
      "No fixed assets are registered. If the expense accounts hold anything that should have",
      "been capitalised, say which and why.",
    ];
  }
  const bought = assets.filter(
    (one) => one.purchased !== null && one.purchased >= period.from && one.purchased <= period.to,
  );
  const gone = assets.filter(
    (one) => one.disposed !== null && one.disposed >= period.from && one.disposed <= period.to,
  );
  const lines = [
    `Fixed assets: ${assets.length} on the register, ${bought.length} bought and ` +
      `${gone.length} disposed of this year.`,
  ];
  for (const asset of bought.slice(0, 40)) {
    lines.push(
      `- bought ${asset.purchased} ${asset.name} [${asset.type}]: ${money(asset.cost)}` +
        `, ${asset.method} ${asset.rate}%`,
    );
  }
  if (bought.length > 40) lines.push(`- ...and ${bought.length - 40} more bought`);
  for (const asset of gone.slice(0, 20)) {
    lines.push(`- disposed ${asset.disposed} ${asset.name}, cost ${money(asset.cost)}`);
  }
  return lines;
}

/** What is owed and owing at the year end, in totals rather than by name. */
function invoicesBlock(period: Period): string[] {
  const invoices = state.ledger.invoices ?? [];
  if (invoices.length === 0) return [];
  const open = invoices.filter((one) => one.issued <= period.to && one.outstanding !== 0);
  if (open.length === 0) return ["No invoices are outstanding at the year end."];
  const owedToUs = open.filter((one) => one.kind === "sales");
  const owedByUs = open.filter((one) => one.kind === "purchase");
  const total = (list: readonly { outstanding: number }[]): number =>
    list.reduce((sum, one) => sum + one.outstanding, 0);
  return [
    `Outstanding at the year end: ${owedToUs.length} sales invoices unpaid, ` +
      `${money(total(owedToUs))} owed to the entity; ${owedByUs.length} bills unpaid, ` +
      `${money(total(owedByUs))} owed by it.`,
    "On a payments basis neither is in the GST return, and both belong on the balance sheet.",
  ];
}

// --- the three prompts -----------------------------------------------------

export function reviewPrompt(year: number, focus: ReviewFocus = "year"): string {
  const period = periodOf(year);
  const model = state.ledger.entities ?? emptyEntityModel();
  const registered = model.entities.some((one) => one.gstRegistered !== false);

  if (focus === "gst") {
    return [
      ...preamble(
        year,
        "GST only. The treatment set on each account, every period's return as these books " +
          "compute it, how that compares with what was filed, and what the return left out.",
      ),
      ...entitiesBlock(),
      "",
      ...gstBlock(period),
      "",
      "Account totals for the year, with the GST treatment set on each:",
      ...accountTotals(period),
      "",
      "What to check, in this order:",
      "- Any account whose GST treatment cannot be right for what it holds: zero-rated or",
      "  exempt where the supply is standard-rated, standard-rated where nothing can be",
      "  claimed, and anything with no treatment set at all.",
      "- Anything claimed that an entity not registered for GST cannot claim.",
      "- Where our figure and the filed figure differ, what would explain it and what would",
      "  not. Name the period and both figures.",
      "- Periods with nothing filed against them, and what that means with the year closing.",
      "- Excluded transactions, late claims and missing tax points: whether each is right.",
      ...(registered
        ? []
        : ["- No entity here is registered, so say plainly whether any GST should be claimed."]),
      ...uncodedBlock(period),
    ].join("\n");
  }

  if (focus === "incometax") {
    return [
      ...preamble(
        year,
        "income tax. The IR10 as it stands, whether the balance sheet holds together, " +
          "depreciation, drawings and anything ring-fenced.",
      ),
      ...entitiesBlock(),
      "",
      ...ir10Block(year),
      "",
      ...assetsBlock(period),
      "",
      ...invoicesBlock(period),
      "",
      "Account totals for the year:",
      ...accountTotals(period),
      "",
      "What to check, in this order:",
      "- Anything in the profit and loss that is not deductible, or not in full: drawings,",
      "  entertainment, fines, private use, capital dressed up as repairs.",
      "- Anything expensed that should have been capitalised and depreciated, and the reverse.",
      "- Depreciation: whether the rates and methods suit the assets, and whether anything",
      "  bought this year is missing from the register.",
      "- A residential rental's ring-fencing, and what it changes here.",
      "- Shareholder current accounts and drawings: whether they sit where they belong, and",
      "  whether anything about them would be treated as income.",
      "- What the IR10 needs that these books do not hold.",
      ...uncodedBlock(period),
    ].join("\n");
  }

  return [
    ...preamble(
      year,
      "the year as a whole -- what is in the wrong place, what is missing, and what needs a " +
        "record these books do not hold. There are separate GST and income tax reviews for " +
        "either of those in depth, so keep this one broad.",
    ),
    ...entitiesBlock(),
    "",
    "Account totals for the year, with the GST treatment set on each:",
    ...accountTotals(period),
    "",
    ...invoicesBlock(period),
    "",
    ...assetsBlock(period),
    "",
    "What to check, in this order:",
    "- Anything in an account it does not belong in, and why you think so.",
    "- GST: whether the treatment on each account matches what the entity is registered for,",
    "  and anything claimed that cannot be.",
    "- Deductions that need something the books do not show -- a logbook, an apportionment, a",
    "  written agreement -- and say which.",
    "- Anything a residential rental's ring-fencing would change.",
    "- What is missing entirely: a category of cost this kind of business always has and these",
    "  books do not.",
    ...(registered
      ? [
          "",
          "At least one entity is GST registered, so check the treatments against the",
          "nz-gst-return guide as well as the income tax ones.",
        ]
      : []),
    ...uncodedBlock(period),
  ].join("\n");
}

/** The words this library asks to travel with anything made from it. */
export function reviewDisclaimer(): HTMLElement {
  return note(
    "Whatever comes back is a draft for a qualified person to review — not tax, legal or " +
      "accounting advice. It may be incomplete, out of date or wrong, and nothing should be " +
      "filed, paid or amended on the strength of it. That is OpenAccountants' own condition " +
      "on its guides, and it is this app's position too.",
  );
}

/** Whether there is anything to review at all. */
export function reviewPossible(): boolean {
  return state.ledger.transactions.length > 0 && state.chart.length > 0;
}
