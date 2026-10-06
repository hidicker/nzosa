import { moduleOn } from "./modules.js";
import { bookYears, postedJournals, varianceInput } from "./books.js";
import { ir3For, rentalSchedulesFor, reportLookups } from "./daily/reports.js";
import { state } from "./state.js";
import { note } from "./ui.js";
import { computeOurReturns } from "./variance.js";
import {
  accountTreatment,
  emptyEntityModel,
  entityOfAccount,
  formatAmount,
  ir10Summary,
  ownersOf,
} from "@nzosa/core";
import type { GstReturnResult } from "@nzosa/core";

/**
 * A year-end review of the accounts, in one prompt.
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
 * It was briefly three prompts -- the year, GST, income tax -- which was a
 * wrong reading of what had been wrong with it. The first version carried
 * account totals and nothing else and then asked whether the GST treatments
 * were right, a question its own contents could not answer. The fault was the
 * missing data, not the number of questions, and splitting it afterwards
 * solved nothing: everything it needs comes to about eight thousand
 * characters, which is nothing to any model that can read it at all.
 *
 * One prompt is also the better shape for where this goes. It is carried to
 * an assistant and pasted in, and that is a conversation: everything in one
 * context can be asked about afterwards. Three pastes are three conversations
 * that cannot see each other, each spending its own lookups fetching the same
 * guides.
 */

export const OPENACCOUNTANTS_MCP = "https://www.openaccountants.com/api/mcp";
export const OPENACCOUNTANTS_CONNECT = "https://www.openaccountants.com/connect";

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
  return bookYears();
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
/** Whether an account type is income or expense, as opposed to the balance sheet. */
const profitAndLoss = (type: string): boolean =>
  /revenue|income|sales|expense|cost|overhead|depreciation/i.test(type);

/**
 * Totals for the year, by chart account, each with the entity it belongs to.
 *
 * The entity was the missing fact behind the worst of the first reviews: with
 * every account in one list, a household's spending read as a rental's
 * expenses, and the model "corrected" a profit nobody had claimed. Personal
 * accounts are therefore listed apart, under what they are.
 */
function accountTotals(period: Period): string[] {
  const accounts = chartAccounts();
  const { sectionOf } = reportLookups();
  const totals = new Map<string, number>();
  const model = state.ledger.entities ?? emptyEntityModel();

  for (const journal of postedJournals()) {
    if (journal.date < period.from || journal.date > period.to) continue;
    for (const line of journal.lines) {
      const code = line.accountCode.trim();
      if (!accounts.has(code)) continue;
      totals.set(code, (totals.get(code) ?? 0) + line.amount);
    }
  }

  const full = new Map(state.chart.map((one) => [one.code.trim(), one]));
  const taxed: string[] = [];
  const personal: string[] = [];
  for (const [code, amount] of [...totals.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))) {
    const account = accounts.get(code);
    const where = sectionOf(code);
    const whole = full.get(code);
    const entity = whole === undefined ? undefined : entityOfAccount(model, whole);
    const treated = whole === undefined ? null : accountTreatment(whole);
    // A balance sheet account has no GST treatment and needs none; saying "none
    // set" read to the model as a fault in every loan and bank account.
    const tax =
      account !== undefined && account.taxCode !== ""
        ? account.taxCode
        : treated !== null
          ? treated.treatment
          : profitAndLoss(account?.type ?? "")
            ? "NO GST TREATMENT SET"
            : "balance sheet, outside GST";
    const line =
      `- ${code} ${account?.name ?? ""} [${account?.type ?? "?"}` +
      (where === null ? "" : `, ${where}`) +
      `; ${entity === undefined ? "entity not set" : `${entity.name}, ${kindWords(entity.kind)}`}` +
      `]: ${money(amount)} · GST: ${tax}`;
    (entity?.kind === "personal" ? personal : taxed).push(line);
  }

  const lines = ["Account totals for the year, with the entity and the GST treatment of each:", ...taxed];
  if (personal.length > 0) {
    lines.push(
      "",
      "PERSONAL ACCOUNTS. These are the household's own money, recorded so the bank accounts",
      "reconcile. They are not in any tax figure: not a rental schedule, not the IR3, not GST.",
      "Never treat them as deductions or as part of a profit. Only check them for taxable income",
      "passing through (interest, dividends, salary) that should be on an owner's IR3 and is not.",
      ...personal,
    );
  }
  return lines;
}

/** What has not been answered, said wherever it changes a figure. */
function uncodedBlock(period: Period): string[] {
  let uncoded = 0;
  let gross = 0;
  // A transfer between the books' own accounts, a split and a payment matched
  // to an invoice are all answered without a code on the line itself. Counted
  // as uncoded, 322 paired transfers once read as 322 lines still to do.
  const transfers = state.ledger.transfers ?? {};
  const splits = state.ledger.splits ?? {};
  const matched = state.ledger.invoiceMatches ?? {};
  for (const transaction of state.ledger.transactions) {
    if (transaction.date < period.from || transaction.date > period.to) continue;
    if (transfers[transaction.id] !== undefined) continue;
    if (splits[transaction.id] !== undefined || matched[transaction.id] !== undefined) continue;
    // A line a person has confirmed with an account is answered. Anything else
    // is posted by a rule's suggestion, or to nothing at all.
    const override = (state.ledger.overrides ?? {})[transaction.id];
    if (override?.confirmed === true && override.code !== undefined && override.code !== "") continue;
    uncoded += 1;
    gross += transaction.amount;
  }
  if (uncoded === 0) return [];
  return [
    "",
    `NOT YET CONFIRMED: ${uncoded} transactions, ${money(gross)} in total, have not been confirmed`,
    "by a person: they are posted as a rule suggested, or not posted at all. Transfers between",
    "the books' own accounts, splits and invoice payments are not among them. Any conclusion",
    "about profit, GST or tax rests on those suggestions, and your answer must say so.",
  ];
}

function entitiesBlock(): string[] {
  const model = state.ledger.entities ?? emptyEntityModel();
  const lines = ["Entities in these books (an account's code ends in its entity's letters):"];
  for (const entity of model.entities) {
    const gst =
      entity.kind === "personal"
        ? "outside GST"
        : entity.gstRegistered === false
          ? "NOT GST registered"
          : entity.gstByOwners === true
            ? "GST: each owner is registered for their own share and files their own return, so " +
              "each payment to Inland Revenue is split between the owners' registrations"
            : `GST registered, filing every ${entity.gstFrequency ?? 2} month${(entity.gstFrequency ?? 2) === 1 ? "" : "s"}`;
    lines.push(
      `- ${entity.name}${entity.codeSuffix ? ` (codes ending ${entity.codeSuffix})` : ""}: ` +
        `${kindWords(entity.kind)}${entity.structure ? `, a ${entity.structure}` : ""}, ${gst}` +
        (entity.owners !== undefined && entity.owners.length > 0
          ? `, owned ${entity.owners.map((o) => `${o.name} ${o.percent}%`).join(" / ")}`
          : "") +
        (entity.about ? `. ${entity.about}` : ""),
    );
  }
  return lines;
}

/** Who files, which decides every due date. */
function filingBlock(year: number): string[] {
  const filing = state.ledger.filing;
  if (filing === undefined) {
    return [
      "Who files the returns: not recorded. If it matters to a due date, give both answers (with",
      "and without a tax agent) rather than calling anything late.",
    ];
  }
  if (filing.taxAgent) {
    return [
      `Who files the returns: a tax agent${filing.agentName ? ` (${filing.agentName})` : ""}, so the`,
      `owners have an extension of time: each ${year} IR3 is due by 31 March ${year + 1} and`,
      `terminal tax by 7 April ${year + 1}. Do not call a return late before then.`,
    ];
  }
  return [
    "Who files the returns: the owners themselves, with no tax agent: each IR3 is due",
    `7 July ${year} and terminal tax 7 February ${year + 1}.`,
  ];
}

/**
 * Each rental's schedule, as these books set it out.
 *
 * The figures the owners' returns are built from. Without them the model
 * rebuilt a profit from the raw accounts, its own way, and checked that.
 */
function rentalsBlock(year: number): string[] {
  const schedules = rentalSchedulesFor(year, false);
  if (schedules.length === 0) return [];
  const lines = [
    "RENTAL SCHEDULES, as these books set them out (income and expenses of each property for",
    "the year; GST-exclusive where the property is registered, inclusive where it is not):",
  ];
  for (const { entity, now } of schedules) {
    const owners = (entity.owners ?? []).map((o) => `${o.name} ${o.percent}%`).join(" / ");
    lines.push(`${entity.name}: ${kindWords(entity.kind)}${owners === "" ? "" : `, owned ${owners}`}`);
    for (const line of now.income) lines.push(`  income  ${line.name}: ${money(line.amount)}`);
    for (const line of now.expenses) {
      lines.push(`  expense ${line.name}${line.heading ? ` (${line.heading})` : ""}: ${money(line.amount)}`);
    }
    lines.push(
      `  total income ${money(now.totalIncome)}, total expenses ${money(now.totalExpenses)}, ` +
        `net ${money(now.net)}`,
    );
  }
  return lines;
}

/**
 * Each owner's IR3, as these books fill it in: their rental shares, income
 * that never reaches the bank accounts (salary, interest, dividends, entered
 * separately), the tax, and next year's provisional tax.
 */
function ir3Block(year: number): string[] {
  const owners = ownersOf(state.ledger.entities ?? emptyEntityModel());
  if (owners.length === 0) return [];
  const lines = ["EACH OWNER'S IR3, as these books fill it in (box, title, figure):"];
  for (const owner of owners) {
    const ir3 = ir3For(owner, year);
    lines.push(`${owner}:`);
    for (const box of ir3.boxes) {
      if (box.text !== undefined) {
        if (box.text !== "") lines.push(`  ${box.box} ${box.title}: ${box.text}`);
        continue;
      }
      if ((box.amount ?? 0) === 0) continue;
      lines.push(`  ${box.box} ${box.title}: ${money(box.amount ?? 0)}`);
    }
    if (ir3.instalments.length > 0 && ir3.nextYearProvisional !== null) {
      lines.push(`  next year's provisional tax instalments: ${ir3.instalments.map(money).join(", ")}`);
    }
    for (const said of ir3.notes) lines.push(`  note: ${said}`);
  }
  lines.push(
    "Income that never reaches these bank accounts (salary, interest, dividends) is entered on",
    "the IR3 separately; the boxes above include whatever has been entered.",
  );
  return lines;
}

/** Trips in the owners' own vehicles, claimed at Inland Revenue's kilometre rates. */
function tripsBlock(period: Period): string[] {
  const log = state.ledger.tripLog;
  if (log === undefined) return [];
  const trips = log.trips.filter((one) => one.date >= period.from && one.date <= period.to);
  if (trips.length === 0) return [];
  const model = state.ledger.entities ?? emptyEntityModel();
  const lines = [
    "VEHICLE TRIPS, claimed at Inland Revenue's kilometre rates. Each is a record of one trip to",
    "a rental or for a business, kept trip by trip; this is not a business vehicle's logbook test:",
  ];
  for (const trip of trips) {
    const vehicle = log.vehicles.find((one) => one.id === trip.vehicleId);
    const entity = model.entities.find((one) => one.id === trip.entityId);
    lines.push(
      `- ${trip.date} ${entity?.name ?? "?"}: ${trip.km} km${trip.returnTrip ? " return" : ""}` +
        `${vehicle ? `, ${vehicle.fuel}` : ""}, ${trip.purpose}`,
    );
  }
  return lines;
}

/** Statements from property managers, which put what never reached the bank into the books. */
function agentStatementsBlock(period: Period): string[] {
  const statements = (state.ledger.agentStatements ?? []).filter(
    (one) => one.to >= period.from && one.from <= period.to,
  );
  if (statements.length === 0) return [];
  const model = state.ledger.entities ?? emptyEntityModel();
  const sum = (list: readonly { amount: number }[]): number => list.reduce((t, l) => t + l.amount, 0);
  const lines = [
    "PROPERTY MANAGER STATEMENTS entered (rent collected and costs paid by the manager, which the",
    "bank only sees net):",
  ];
  for (const one of statements) {
    const entity = model.entities.find((e) => e.id === one.entity);
    lines.push(
      `- ${entity?.name ?? one.entity}, ${one.agent}, ${one.from} to ${one.to}: income ` +
        `${money(sum(one.income))}, expenses ${money(sum(one.expenses))}, paid to owners ` +
        `${money(one.paidToOwner)}, held at end ${money(one.heldAtEnd)}`,
    );
  }
  return lines;
}

/** The instructions all three share. */
function preamble(year: number): string[] {
  return [
    "You are reviewing a small New Zealand set of books at year end, as an accountant would",
    "before signing anything off. Everything you need is below: the entities and what kind each",
    "is, who files the returns, every GST period against what was filed, the figures each return",
    "is built from (rental schedules and each owner's IR3, or the IR10 for a business), the asset",
    "register, and every account's total with its entity and GST treatment.",
    "",
    "Check the figures these books produce; do not rebuild them your own way. Where you think one",
    "is wrong, say which figure, why, and what it should be. Each entity is taxed on its own: a",
    "rental's income and expenses go on its owners' IR3s by their shares, a business has its own",
    "return, and personal accounts are in no tax figure at all.",
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
    moduleOn("xero")
      ? "same ones Xero uses; the GST timing differs, and that difference is deliberate."
      : "same as on an invoice basis; the GST timing differs, and that difference is deliberate.",
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

/** Which kinds of entity these books hold, which decides what is worth asking. */
function kinds(): { business: boolean; company: boolean; rentals: boolean; residential: boolean; personal: boolean } {
  const entities = (state.ledger.entities ?? emptyEntityModel()).entities;
  const business = entities.length === 0 || entities.some((one) => (one.kind ?? "business") === "business");
  return {
    business,
    company: entities.some(
      (one) => (one.kind ?? "business") === "business" && (one.structure === undefined || one.structure === "company"),
    ),
    rentals: entities.some((one) => one.kind === "residential" || one.kind === "commercial"),
    residential: entities.some((one) => one.kind === "residential"),
    personal: entities.some((one) => one.kind === "personal"),
  };
}

/**
 * The facts of the year, as every review is given them: the entities and who
 * files, each GST period against what was filed, the figures each return is
 * built from -- rental schedules and each owner's IR3, and the IR10 only where
 * there is a business -- the assets, trips and property manager statements,
 * and every account's total with its entity and GST treatment. Shared by the
 * OpenAccountants review and the checks against Inland Revenue's own guides.
 */
export function reviewFacts(year: number): string[] {
  const period = periodOf(year);
  const has = kinds();
  const section = (lines: string[]): string[] => (lines.length === 0 ? [] : [...lines, ""]);
  return [
    ...section(entitiesBlock()),
    ...section(filingBlock(year)),
    ...section(gstBlock(period)),
    ...section(rentalsBlock(year)),
    ...section(ir3Block(year)),
    // An IR10 is a business's return. For rentals and personal books it is the
    // wrong form, and sending one merged every entity into a single "profit".
    ...section(has.business ? ir10Block(year) : []),
    ...section(assetsBlock(period)),
    ...section(tripsBlock(period)),
    ...section(agentStatementsBlock(period)),
    ...section(invoicesBlock(period)),
    ...accountTotals(period),
    ...uncodedBlock(period),
  ];
}

export function reviewPrompt(year: number): string {
  const model = state.ledger.entities ?? emptyEntityModel();
  const registered = model.entities.some((one) => one.kind !== "personal" && one.gstRegistered !== false);
  const has = kinds();

  return [
    ...preamble(year),
    ...reviewFacts(year),
    "",
    "WHAT TO CHECK. Work through these in order, and say which you could not answer and why.",
    "",
    "Coding",
    "- Anything in an account it does not belong in, and why you think so.",
    "- Anything expensed that should have been capitalised and depreciated, and the reverse.",
    "- What is missing entirely: a category of cost this kind of entity always has and these",
    "  books do not.",
    "",
    "GST",
    "- Any account whose GST treatment cannot be right for what it holds: zero-rated or",
    "  exempt where the supply is standard-rated, standard-rated where nothing can be",
    "  claimed, and anything with no treatment set at all. Balance sheet accounts are",
    "  outside GST and need no treatment.",
    "- GST claimed on a purchase where the supplier did not charge New Zealand GST.",
    "- Anything claimed that an entity not registered for GST cannot claim.",
    "- Where our figure and the filed figure differ, what would explain it and what would",
    "  not. Name the period and both figures.",
    "- Periods with nothing filed recorded here: say that the filed returns should be loaded",
    "  (myIR's GST return summary). Payments to Inland Revenue are not the filed return; do not",
    "  rebuild one from them.",
    "- Excluded transactions, late claims and missing tax points: whether each is right.",
    ...(registered
      ? []
      : ["- No entity here is registered, so say plainly whether any GST should be claimed."]),
    "",
    ...(has.rentals
      ? [
          "Rentals",
          "- Check each rental schedule above: anything in it that is not deductible, or not in",
          "  full, and anything missing (rates, insurance, depreciation on chattels, accounting fees).",
          "- Interest: whether each loan's interest belongs to the property it is charged to,",
          "  which turns on what the borrowed money was used for. Say what you would need to see.",
          ...(has.residential
            ? [
                "- Residential rentals: the interest deduction rules for the year, and ring-fencing of",
                "  any loss, with any loss brought forward.",
              ]
            : []),
          "- Repairs against capital improvements, and any insurance payout: what it compensates",
          "  decides how it is treated.",
          "- Property manager statements: whether the rent and costs they record are in the schedule.",
          "- Vehicle trips: whether the trips recorded support the kilometre claim.",
          "",
        ]
      : []),
    ...(has.business
      ? [
          "Business",
          "- Anything in the profit and loss that is not deductible, or not in full: drawings,",
          "  entertainment, fines, private use, capital dressed up as repairs.",
          "- Depreciation: whether the rates and methods suit the assets, and whether anything",
          "  bought this year is missing from the register.",
          ...(has.company
            ? [
                "- Shareholder current accounts and drawings: whether they sit where they belong, and",
                "  whether anything about them would be treated as income.",
              ]
            : []),
          "- What the IR10 needs that these books do not hold.",
          "",
        ]
      : []),
    ...(ownersOf(model).length > 0
      ? [
          "Each owner's IR3",
          "- Whether each owner's IR3 above takes the right share of each rental, and whether any",
          "  income is missing from it: interest, dividends or salary, including any that passes",
          "  through the personal accounts or a loan account.",
          "- Provisional tax: whether what was paid matches what was due, and next year's figure.",
          "- Due dates, given who files the returns (above).",
          "",
        ]
      : []),
    "Records",
    "- Deductions that need something the books do not show -- an apportionment, a written",
    "  agreement, an invoice -- and say which.",
    "",
    // The last instruction, because this is a conversation rather than a
    // report: whoever pasted it is sitting in front of an assistant that
    // still has all of this in front of it, and the useful next move is a
    // question rather than a filing.
    "Finish by naming the three findings that would change the numbers most, and offer to go",
    "further into any of them. Whoever is reading this can ask you follow-up questions, and",
    "you still have every figure above.",
  ].join("\n");
}

/** The words this library asks to travel with anything made from it. */
export function reviewDisclaimer(): HTMLElement {
  return note(
    "The result is a draft for a qualified person to review, not tax, legal or accounting " +
      "advice. It may be incomplete, out of date or wrong; do not file, pay or amend anything " +
      "based on it.",
  );
}

/** Whether there is anything to review at all. */
export function reviewPossible(): boolean {
  return state.ledger.transactions.length > 0 && state.chart.length > 0;
}
