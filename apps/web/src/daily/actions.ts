import { anyModuleOn, moduleOn, yearEndFigure } from "../modules.js";
import { showPage } from "../app.js";
import {
  invoiceBalanceMap,
  invoicesToMatch,
  proposalOpen,
  nothingHasAnswered,
  reconcileRows,
  settledAlready,
  transferSuggestions,
  gstFrequency,
  betweenEntities,
} from "../books.js";
import { DIRECTORY_VIA, aiSuggestionFor, suggestFromDirectory } from "../ai.js";
import { feedTieNow } from "./opening-balances.js";
import { justBeforeWaiting } from "./bank-import.js";
import {
  checkFinancialYearMilestones,
  diagnoseAllBankBalances,
  openBankReconcileReport,
} from "./balance-diagnostics.js";
import { save } from "../store.js";
import { morningNow } from "../nightly.js";
import { codingReconciliationWaiting, unmatchedReferenceWaiting } from "../migrate/coding-reconciliation.js";
import { bankLinkState, setupSteps } from "../migrate/setup-wizard.js";
import { $, state } from "../state.js";
import { amountCell, nameCell, note } from "../ui.js";
import { banksNeedingOwner, emptyEntityModel, overdrawnCurrentAccounts, owedBetween, gstDueDate, gstPeriods, isCreditNote, isPosted, matchInvoices, overdueTasks, endedWithMoneyLeft, grantOpen, reportsDue } from "@nzosa/core";
import type { IsoDate } from "@nzosa/core";
import { booksLocale, moneyPlaces } from "../country.js";
import { booksCountry } from "../country.js";
import { societyFiguresEntered } from "./society-report-page.js";
import { taxYearEnd, taxYearEndSaid, taxYearOf } from "../tax-year.js";

/**
 * Everything waiting to be done, in one list, each a click from where it is
 * done.
 *
 * The pages each said what they were waiting for, but only once somebody was
 * on them: a proposed invoice match, a credit note nobody had pointed at an
 * invoice, a feed that stopped working on Tuesday. This gathers the questions
 * rather than the answers -- each is counted by the same function the page
 * itself uses, so the two cannot disagree.
 *
 * Red where the figures are wrong or a deadline has passed; amber where work
 * is simply waiting. Nothing more finely graded, because a list that is mostly
 * red teaches people to ignore red.
 */

export type Urgency = "red" | "amber";

export interface ActionItem {
  /** Stable, so a snooze stays on the same item from one day to the next. */
  key: string;
  what: string;
  count: number;
  urgency: Urgency;
  detail: string;
  /** Where it is done. */
  go: () => void;
}

/** Said by the start-up AI run when it could not do what it was asked. */
let aiTrouble = "";
export function sayAiTrouble(said: string): void {
  aiTrouble = said;
}

function today(): IsoDate {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" }) as IsoDate;
}

/** Dollars as a person reads them: $1,234.50. */
function dollars(cents: number): string {
  return (cents < 0 ? "-$" : "$") +
    (Math.abs(cents) / 100).toLocaleString(booksLocale(), { minimumFractionDigits: moneyPlaces(), maximumFractionDigits: moneyPlaces() });
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The GST periods whose returns fall due around now, for registered entities. */
function gstDue(now: IsoDate): { periodEnd: IsoDate; due: IsoDate }[] {
  const model = state.ledger.entities ?? emptyEntityModel();
  const registered = model.entities.some((e) => e.gstRegistered === true && e.kind !== "personal");
  if (!registered || state.ledger.transactions.length === 0) return [];
  const filed = new Set(state.filed.map((f) => f.periodEnd));
  const from = state.ledger.transactions.reduce((min, t) => (t.date < min ? t.date : min), now);
  // A period the bank lines never reach is not one these books are doing.
  const last = state.ledger.transactions.reduce((max, t) => (t.date > max ? t.date : max), from);
  const periods = gstPeriods({ from, to: now }, { months: gstFrequency(), anchorMonth: booksCountry().yearEnd.endMonth });
  // Only returns due in the sixty days either side of today. Somebody who files
  // in myIR and never records it here would otherwise see every return since
  // the books began as overdue, for ever.
  const back = new Date(Date.parse(now) - 60 * 86_400_000).toISOString().slice(0, 10);
  const ahead = new Date(Date.parse(now) + 30 * 86_400_000).toISOString().slice(0, 10);
  return periods
    .map((p) => ({ periodEnd: p.to as IsoDate, due: gstDueDate(p.to as IsoDate) }))
    .filter(
      (p, i) =>
        (periods[i]?.from ?? "") <= last &&
        p.periodEnd < now &&
        p.due >= back &&
        p.due <= ahead &&
        !filed.has(p.periodEnd),
    );
}

export function actionItems(): ActionItem[] {
  const items: ActionItem[] = [];
  const now = today();

  if (state.feedProblem !== "") {
    items.push({
      key: "feed",
      what: "Bank feed",
      count: 1,
      urgency: "red",
      detail: `The last fetch failed: ${state.feedProblem}`,
      go: () => showPage("import"),
    });
  }

  // The morning run, where these books have it turned on: said when it has not
  // run, so a computer that was off or not signed in does not fail quietly.
  if (state.ledger.nightly === true) {
    const ran = morningNow().ran;
    const hours = ran === undefined ? Infinity : (Date.now() - Date.parse(ran.at)) / 3_600_000;
    if (hours > 36) {
      const when = ran === undefined ? "" : new Date(ran.at).toLocaleDateString(booksLocale());
      items.push({
        key: "morning",
        what: "Morning run",
        count: 1,
        urgency: hours > 96 ? "red" : "amber",
        detail:
          ran === undefined
            ? "Turned on, but it has not run yet. It runs at 6am, or when the computer is next on and signed in."
            : `It last ran on ${when}. On this computer it runs at 6am if the computer is on and signed in, or when it is next on; books on the server are done by the server.`,
        go: () => showPage("ai"),
      });
    }
  }

  const tie = feedTieNow();
  const off = (tie?.rows ?? []).filter((row) => row.ours !== row.bankSays);
  const diags = diagnoseAllBankBalances();
  // Action Required page ignores pending card timing differences; only red discrepancies require action
  const unagreedDiags = diags.filter((d) => d.urgency === "red");

  if (off.length + unagreedDiags.length > 0) {
    const details: string[] = [];

    for (const d of unagreedDiags) {
      details.push(d.actionDetail);
    }
    for (const row of off) {
      if (!unagreedDiags.some((d) => d.accountId === row.bank)) {
        details.push(`${row.bank}'s opening balance is ${dollars(row.ours - row.bankSays)} different from the bank feed's.`);
      }
    }

    if (details.length > 0) {
      const targetAccount = unagreedDiags[0]?.accountId;
      items.push({
        key: "balances",
        what: "Bank balances",
        count: details.length,
        urgency: "red",
        detail: details.join(" "),
        go: () => {
          if (targetAccount) {
            openBankReconcileReport(targetAccount);
          } else {
            showPage(unagreedDiags.length > 0 ? "import" : "opening");
          }
        },
      });
    }
  }

  // Each 31 March balance against Xero's and the feed's, where either is held.
  const milestones = checkFinancialYearMilestones();
  const unagreedMilestones = milestones.filter((m) => m.compared && !m.agrees);
  if (unagreedMilestones.length > 0) {
    items.push({
      key: "fy-milestones",
      what: "Year-end bank balances",
      count: unagreedMilestones.length,
      urgency: "red",
      detail: `Not agreeing at the year end: ${unagreedMilestones.map((m) => `${m.accountLabel} at ${m.closeDate}`).join(", ")}.`,
      go: () => {
        if (unagreedMilestones[0]?.accountId) {
          openBankReconcileReport(unagreedMilestones[0].accountId);
        } else {
          showPage("reports");
        }
      },
    });
  }

  for (const period of gstDue(now)) {
    const overdue = period.due < now;
    items.push({
      key: `gst:${period.periodEnd}`,
      what: "GST return",
      count: 1,
      urgency: overdue ? "red" : "amber",
      detail:
        `The period to ${period.periodEnd} ${overdue ? "was" : "is"} due ${period.due}` +
        (overdue ? " and is not marked as filed here." : "."),
      go: () => showPage("gst"),
    });
  }

  // Only what asks for a decision. A duplicate already found is dealt with:
  // it is left out of the books, and is listed on Bank import only to be seen.
  const review = state.entries.filter((entry) => entry.status === "review").length;
  if (review > 0) {
    items.push({
      key: "import-review",
      what: "Bank import",
      count: review,
      urgency: "red",
      detail: `${plural(review, "line")} to review: possibly in twice.`,
      go: () => showPage("import"),
    });
  }

  // At each year end, a not-for-profit's figures for the year just finished, as
  // its signed statements give them: they decide the standard for the next two.
  {
    const finished = taxYearOf(new Date().toISOString().slice(0, 10)) - 1;
    const orgs = (state.ledger.entities?.entities ?? []).filter((e) => e.kind === "nonprofit" && !societyFiguresEntered(e, finished));
    if (orgs.length > 0) {
      items.push({
        key: `society-figures-${finished}`,
        what: "Year-end figures for the reporting standard",
        count: orgs.length,
        urgency: "amber",
        detail:
          `${orgs.map((o) => o.name).join(", ")}: enter the operating payments, current assets and total expenses for the year ended ` +
          `${taxYearEndSaid(finished)} from the signed financial statements. They decide which reporting standard applies next.`,
        go: () => showPage("society"),
      });
    }
  }

  // Accounts still ticked for several entities, from before each had one owner.
  {
    const waiting = banksNeedingOwner(state.ledger.entities ?? emptyEntityModel());
    if (waiting.length > 0) {
      items.push({
        key: "bank-owners",
        what: "Bank accounts to give an owner",
        count: waiting.length,
        urgency: "amber",
        detail: "Choose who each bank account belongs to, on Entities & accounts. A suggested owner is shown for each.",
        go: () => showPage("entities"),
      });
    }
  }

  // A company (or trust, or society) owed money by an owner at the year just
  // finished: interest-free, that is a taxable benefit.
  {
    const finished = taxYearOf(new Date().toISOString().slice(0, 10)) - 1;
    const { journals, accounts } = betweenEntities();
    const model = state.ledger.entities ?? emptyEntityModel();
    const overdrawn = overdrawnCurrentAccounts(journals, accounts, taxYearEnd(finished) as IsoDate);
    if (overdrawn.length > 0) {
      const nameOf = (id: string): string => model.entities.find((e) => e.id === id)?.name ?? id;
      items.push({
        key: `overdrawn-${finished}`,
        what: "Overdrawn current accounts",
        count: overdrawn.length,
        urgency: "amber",
        detail:
          overdrawn.map((o) => `${o.person} owes ${nameOf(o.entityId)} $${(o.amount / 100).toFixed(2)}`).join("; ") +
          ` at ${taxYearEndSaid(finished)}. A loan to an owner with no interest is a taxable benefit: charge interest at ` +
          "Inland Revenue's prescribed rate, or clear it with a salary or a dividend. Ask your accountant.",
        go: () => {
          showPage("reports");
          const kind = document.getElementById("report-kind") as HTMLSelectElement | null;
          if (kind !== null) {
            kind.value = "between";
            kind.dispatchEvent(new Event("change"));
          }
        },
      });
    }
  }

  // Loans between entities still to be paid, as things stand today.
  {
    const { journals, accounts } = betweenEntities();
    const model = state.ledger.entities ?? emptyEntityModel();
    const owed = owedBetween(journals, accounts, model, today());
    if (owed.length > 0) {
      const said = owed
        .slice(0, 3)
        .map((o) => `${o.from} owes ${o.to} $${(o.amount / 100).toLocaleString(booksLocale(), { minimumFractionDigits: moneyPlaces(), maximumFractionDigits: moneyPlaces() })}`)
        .join("; ");
      items.push({
        key: "owed-between",
        what: "Money owed between entities",
        count: owed.length,
        urgency: "amber",
        detail:
          `${said}${owed.length > 3 ? `, and ${owed.length - 3} more` : ""}. ` +
          "Pay it with a transfer between their bank accounts.",
        go: () => {
          showPage("reports");
          const kind = document.getElementById("report-kind") as HTMLSelectElement | null;
          if (kind !== null) {
            kind.value = "between";
            kind.dispatchEvent(new Event("change"));
          }
        },
      });
    }
  }

  const lockedLate = (state.ledger.lockedArrivals ?? []).length;
  if (lockedLate > 0) {
    items.push({
      key: "locked-arrivals",
      what: "Lines dated in a locked period",
      count: lockedLate,
      urgency: "amber",
      detail:
        `${plural(lockedLate, "bank line")} arrived after ${lockedLate === 1 ? "its" : "their"} period was ` +
        "locked: bring each in dated the first open day, leave it out, or move the lock.",
      go: () => {
        showPage("import");
        document.getElementById("locked-arrivals")?.scrollIntoView({ block: "start" });
      },
    });
  }

  const justBefore = justBeforeWaiting().length;
  if (justBefore > 0) {
    items.push({
      key: "before-start",
      what: "Lines just before the start",
      count: justBefore,
      urgency: "amber",
      detail:
        `${plural(justBefore, "feed line")} dated in the week before these books start: include ` +
        `${justBefore === 1 ? "it" : "each"} if the bank cleared it on or after the start, or leave it out.`,
      go: () => {
        showPage("import");
        document.getElementById("import-feed")?.scrollIntoView({ block: "start" });
      },
    });
  }

  // Everything waiting on Reconcile, as one line: the split is in the detail.
  suggestFromDirectory();
  const open = reconcileRows().all.filter((one) => !settledAlready(one));
  const proposed = (one: (typeof open)[number]) =>
    one.code === null ? aiSuggestionFor(one.transaction.id) : undefined;
  const byKnown = open.filter((one) => proposed(one)?.via === DIRECTORY_VIA).length;
  const byAi = open.filter((one) => proposed(one) !== undefined).length - byKnown;
  const transfers = transferSuggestions();
  const asTransfer = open.filter((one) => transfers.has(one.transaction.id)).length;
  // A line with a proposal on it has had nothing in the books answer it, but
  // it has a suggestion: counted once, under what suggested it.
  const nothing = open.filter((one) => nothingHasAnswered(one) && proposed(one) === undefined).length;
  const byRules = open.length - byAi - byKnown - nothing - asTransfer;
  const proposals = matchInvoices({
    invoices: invoicesToMatch(),
    transactions: state.ledger.transactions,
    ...(state.ledger.allocations ? { allocations: state.ledger.allocations } : {}),
  }).proposals.filter((p) => proposalOpen(p)).length;
  if (open.length + proposals > 0) {
    // Red once a line sits in a GST period that has ended: that return is
    // being worked out, or was filed, without it.
    const ended = gstPeriods(
      { from: open.reduce((min, one) => (one.transaction.date < min ? one.transaction.date : min), now), to: now },
      { months: gstFrequency(), anchorMonth: booksCountry().yearEnd.endMonth },
    ).filter((p) => p.to < now);
    const lastEnded = ended.length > 0 ? ended[ended.length - 1]!.to : "";
    const late = open.filter((one) => lastEnded !== "" && one.transaction.date <= lastEnded).length;
    items.push({
      key: "reconcile",
      what: "Lines to reconcile",
      count: open.length + proposals,
      urgency: late > 0 ? "red" : "amber",
      detail:
        [
          open.length > 0 ? `${open.length} to confirm` : "",
          byRules > 0 ? `${byRules} suggested by rules` : "",
          byKnown > 0 ? `${byKnown} from the list of known businesses` : "",
          byAi > 0 ? `${byAi} by AI` : "",
          asTransfer > 0 ? plural(asTransfer, "transfer") : "",
          nothing > 0 ? `${nothing} with nothing suggested` : "",
          proposals > 0 ? `${plural(proposals, "invoice match", "invoice matches")} proposed (on Invoices)` : "",
        ]
          .filter((part) => part !== "")
          .join(", ") +
        "." +
        (late > 0 ? ` ${late} ${late === 1 ? "is" : "are"} in a GST period that has ended.` : ""),
      go: () => {
        if (open.length === 0 && proposals > 0) {
          showPage("invoices");
          return;
        }
        state.reconcileFilter = "todo";
        showPage("reconcile");
      },
    });
  }

  const balances = invoiceBalanceMap();
  const credits = state.ledger.creditNotes ?? {};
  const unassigned = [...balances.values()].filter(
    (b) => isCreditNote(b.invoice) && (credits[b.invoice.number] ?? "") === "",
  ).length;
  // Rental properties' jobs and issues past their due date.
  const model = state.ledger.entities ?? emptyEntityModel();
  const late = model.entities.flatMap((entity) =>
    overdueTasks(state.ledger.propertyCare?.[entity.id], now).map((task) => `${task.what} (${entity.name})`),
  );
  if (late.length > 0) {
    items.push({
      key: "property-jobs",
      what: "Property jobs overdue",
      count: late.length,
      urgency: "amber",
      detail: `${late.slice(0, 3).join("; ")}${late.length > 3 ? `; and ${late.length - 3} more` : ""}.`,
      go: () => showPage("tenancies"),
    });
  }

  // Grants: a funder's report due or overdue, and a grant that has ended with
  // money still held for it.
  const grants = (state.ledger.grants ?? []).filter((g) => grantOpen(g));
  const owedReports = reportsDue(grants, now);
  if (owedReports.length > 0) {
    const overdue = owedReports.filter((g) => (g.reportDue ?? "") < now).length;
    items.push({
      key: "grant-reports",
      what: "Grant reports due",
      count: owedReports.length,
      urgency: overdue > 0 ? "red" : "amber",
      detail:
        owedReports
          .slice(0, 3)
          .map((g) => `${g.funder} by ${g.reportDue}`)
          .join("; ") + (owedReports.length > 3 ? `; and ${owedReports.length - 3} more` : "") + ".",
      go: () => showPage("grants"),
    });
  }
  const leftOver = endedWithMoneyLeft(grants, state.ledger.grantLinks ?? {}, state.ledger.transactions, now);
  if (leftOver.length > 0) {
    items.push({
      key: "grant-left",
      what: "Grants ended with money left",
      count: leftOver.length,
      urgency: "amber",
      detail: `${leftOver.map((p) => p.grant.funder).slice(0, 3).join("; ")}: check what the funder wants done with what is left.`,
      go: () => showPage("grants"),
    });
  }

  if (unassigned > 0) {
    items.push({
      key: "credit-notes",
      what: "Credit notes",
      count: unassigned,
      urgency: "amber",
      detail: `${plural(unassigned, "credit note")} not yet assigned to the invoice ${unassigned === 1 ? "it credits" : "they credit"}.`,
      go: () => showPage("invoices"),
    });
  }

  const overdue = [...balances.values()].filter(
    (b) =>
      isPosted(b.invoice) &&
      !isCreditNote(b.invoice) &&
      b.remaining > 0 &&
      (b.invoice.due ?? "") !== "" &&
      (b.invoice.due ?? "") < now,
  );
  const lateSales = overdue.filter((b) => b.invoice.kind === "sales");
  const lateBills = overdue.filter((b) => b.invoice.kind === "purchase");
  if (lateSales.length > 0) {
    items.push({
      key: "invoices-overdue",
      what: "Invoices overdue",
      count: lateSales.length,
      urgency: "amber",
      detail: `${dollars(lateSales.reduce((s, b) => s + b.remaining, 0))} owed to you past its due date.`,
      go: () => showPage("invoices"),
    });
  }
  if (lateBills.length > 0) {
    const month = new Date(Date.parse(now) - 30 * 86_400_000).toISOString().slice(0, 10);
    items.push({
      key: "bills-overdue",
      what: "Bills overdue",
      count: lateBills.length,
      urgency: lateBills.some((b) => (b.invoice.due ?? "") < month) ? "red" : "amber",
      detail: `${dollars(lateBills.reduce((s, b) => s + b.remaining, 0))} you owe past its due date.`,
      go: () => showPage(document.querySelector('button[data-page="bills"]:not([hidden])') ? "bills" : "invoices"),
    });
  }

  const links = bankLinkState();
  // Only where the chart has bank accounts to link to: with none, the report
  // takes every bank line's account as a bank account, and nothing is lost.
  if (links.rows > 0 && links.unlinked.length > 0) {
    items.push({
      key: "bank-links",
      what: "Bank accounts not linked",
      count: links.unlinked.length,
      urgency: "amber",
      detail:
        `${links.unlinked.join(", ")} ${links.unlinked.length === 1 ? "is" : "are"} not linked to a bank ` +
        "account in the chart of accounts.",
      go: () => showPage("entities", "bottom"),
    });
  }

  // The comparison with an imported file, only while that file is in use.
  const comparing = anyModuleOn("xero sheet");
  const compare = comparing ? codingReconciliationWaiting() : 0;
  if (compare > 0) {
    items.push({
      key: "compare-xero",
      what: "Compare with Xero",
      count: compare,
      urgency: "amber",
      detail: `${plural(compare, "line")} where the imported coding is waiting for a decision.`,
      go: () => showPage("check"),
    });
  }

  const unmatched = comparing ? unmatchedReferenceWaiting() : 0;
  if (unmatched > 0) {
    items.push({
      key: "unmatched-reference",
      what: "Lines in file, not in ledger",
      count: unmatched,
      urgency: "amber",
      detail: `${plural(unmatched, "line")} in the imported file not matched to your bank transactions. Review or ignore with reason.`,
      go: () => {
        showPage("check");
        setTimeout(() => {
          document.getElementById("check-unmatched-heading")?.scrollIntoView({ block: "start" });
        }, 50);
      },
    });
  }

  const steps = setupSteps({ withContent: false }).filter((step) => step.optional !== true && !step.done);
  if (steps.length > 0) {
    items.push({
      key: "setup",
      what: "Set-up",
      count: steps.length,
      urgency: "amber",
      detail: `Still to do: ${steps.map((step) => step.what).join(", ")}.`,
      go: () => showPage("setup"),
    });
  }

  if (aiTrouble !== "") {
    items.push({
      key: "ai",
      what: "AI suggestions",
      count: 1,
      urgency: "amber",
      detail: `When the books opened, the AI could not be asked: ${aiTrouble}`,
      go: () => showPage("ai"),
    });
  }

  // Set-up, then Compare with Xero and unmatched lines, lead: the rest depends on them being done.
  // After those, red first, then by how much is waiting.
  const first = ["setup", "compare-xero", "unmatched-reference"];
  const rank = (item: ActionItem): number => {
    const at = first.indexOf(item.key);
    return at === -1 ? first.length : at;
  };
  // What belongs to a module that is off is not asked about.
  const moduleOf: Record<string, string> = {
    "GST return": "gst",
    "Invoices overdue": "business",
    "Credit notes": "business",
    "Bills overdue": "business company",
    "Compare with Xero": "xero",
    "Lines in file, not in ledger": "xero sheet",
  };
  return items
    .filter((item) => moduleOf[item.what] === undefined || anyModuleOn(moduleOf[item.what] ?? ""))
    .sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.urgency === b.urgency ? b.count - a.count : a.urgency === "red" ? -1 : 1),
  );
}

/** The day an item comes back, if it is snoozed past today. */
function snoozedUntil(key: string, now = today()): string | undefined {
  const until = (state.ledger.snoozed ?? {})[key];
  return until !== undefined && until > now ? until : undefined;
}

function tomorrow(now = today()): IsoDate {
  return new Date(Date.parse(now) + 86_400_000).toISOString().slice(0, 10) as IsoDate;
}

/** Put an item off until a day, or bring it back with `until` undefined. */
async function snooze(key: string, until: string | undefined): Promise<void> {
  const now = today();
  // Past snoozes go as new ones are made, so the list never outgrows its use.
  const kept = Object.fromEntries(
    Object.entries(state.ledger.snoozed ?? {}).filter(([k, day]) => k !== key && day > now),
  );
  if (until !== undefined) kept[key] = until;
  if (Object.keys(kept).length === 0) {
    const { snoozed: _gone, ...rest } = state.ledger;
    state.ledger = rest;
  } else {
    state.ledger = { ...state.ledger, snoozed: kept };
  }
  state.persistent = await save(state.ledger);
  renderActions();
}

/** Snooze, then a day to snooze until: tomorrow unless another is chosen. */
function snoozeControl(item: ActionItem): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "actions-snooze";
  const open = document.createElement("button");
  open.type = "button";
  open.className = "link-button";
  open.textContent = "Snooze";
  const form = document.createElement("span");
  form.className = "actions-snooze-form";
  form.hidden = true;
  const day = document.createElement("input");
  day.type = "date";
  day.value = tomorrow();
  day.min = tomorrow();
  day.setAttribute("aria-label", `Snooze ${item.what} until`);
  const ok = document.createElement("button");
  ok.type = "button";
  ok.textContent = "Snooze until";
  ok.addEventListener("click", () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day.value) || day.value <= today()) return;
    void snooze(item.key, day.value);
  });
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "link-button";
  cancel.textContent = "cancel";
  cancel.addEventListener("click", () => {
    form.hidden = true;
    open.hidden = false;
  });
  open.addEventListener("click", () => {
    form.hidden = false;
    open.hidden = true;
    day.focus();
  });
  form.append(ok, day, cancel);
  wrap.append(open, form);
  return wrap;
}

export function renderActions(): void {
  const body = $("actions-body");
  body.textContent = "";
  const all = actionItems();
  const items = all.filter((item) => snoozedUntil(item.key) === undefined);
  const resting = all.filter((item) => snoozedUntil(item.key) !== undefined);
  markActions(all);
  if (items.length === 0) body.append(note("Nothing waiting."));
  if (items.length > 0) {
    const list = document.createElement("ul");
    list.className = "actions-list";
    for (const item of items) {
      const li = document.createElement("li");
      li.className = `actions-row actions-${item.urgency}`;
      const go = document.createElement("button");
      go.type = "button";
      go.className = "actions-item";
      const dot = document.createElement("span");
      dot.className = "actions-dot";
      dot.setAttribute("aria-label", item.urgency === "red" ? "Urgent" : "Waiting");
      const what = document.createElement("strong");
      what.textContent = `${item.what} (${item.count})`;
      const detail = document.createElement("span");
      detail.className = "actions-detail";
      detail.textContent = item.detail;
      go.append(dot, what, detail);
      go.addEventListener("click", item.go);
      li.append(go, snoozeControl(item));
      list.append(li);
    }
    body.append(
      list,
      note("Red: the figures are wrong or a deadline has passed. Amber: work is waiting."),
    );
  }
  if (resting.length > 0) {
    const fold = document.createElement("details");
    fold.className = "actions-snoozed";
    const summary = document.createElement("summary");
    summary.textContent = `Snoozed (${resting.length})`;
    fold.append(summary);
    const list = document.createElement("ul");
    list.className = "actions-list";
    for (const item of resting) {
      const li = document.createElement("li");
      li.className = "actions-resting";
      li.append(`${item.what} (${item.count}) — until ${snoozedUntil(item.key)} `);
      const wake = document.createElement("button");
      wake.type = "button";
      wake.className = "link-button";
      wake.textContent = "bring back now";
      wake.addEventListener("click", () => void snooze(item.key, undefined));
      li.append(wake);
      list.append(li);
    }
    fold.append(list);
    body.append(fold);
  }
  const ran = state.ledger.nightly === true ? morningNow().ran : undefined;
  if (ran !== undefined && Date.now() - Date.parse(ran.at) <= 36 * 3_600_000) {
    body.append(note(`Morning run, ${new Date(ran.at).toLocaleString(booksLocale())}: ${ran.said.replace(/\.$/, "")}.`));
  }
  body.append(renderMilestonesSection());
}

/** Each bank account's 31 March balance against Xero's and the bank feed's. */
function renderMilestonesSection(): HTMLElement {
  const container = document.createElement("section");
  container.className = "milestones-card";

  const milestones = checkFinancialYearMilestones();
  const compared = milestones.filter((m) => m.compared);
  const off = compared.filter((m) => !m.agrees);

  const header = document.createElement("div");
  header.className = "milestones-head";
  const titleWrap = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = "Year-end bank balances";
  titleWrap.append(
    title,
    note(
      `Each bank account's 31 March balance in these books, against ${moduleOn("xero") ? "Xero's year-end figure" : "the year-end figure in Opening balances"} and the bank feed's balance worked back.`,
    ),
  );

  const badge = document.createElement("span");
  if (milestones.length === 0) {
    badge.className = "status-pill none";
    badge.textContent = "No year ends yet";
  } else if (compared.length === 0) {
    badge.className = "status-pill none";
    badge.textContent = "Nothing to compare";
  } else if (off.length === 0) {
    badge.className = "status-pill ok";
    badge.textContent = "All agree";
  } else {
    badge.className = "status-pill off";
    badge.textContent = `${off.length} not agreeing`;
  }
  header.append(titleWrap, badge);
  container.append(header);

  if (milestones.length > 0 && compared.length === 0) {
    container.append(
      note(`Load a trial balance${moduleOn("xero") ? " from Xero" : ""}, or connect the bank feed, to check these balances.`),
    );
  }

  if (milestones.length > 0) {
    const tableWrap = document.createElement("div");
    tableWrap.className = "table-scroll";
    const table = document.createElement("table");
    table.className = "report-table match-table";
    table.innerHTML =
      "<thead><tr><th>Year end</th><th>Account</th><th class=\"report-amount\">These books</th>" +
      `<th class="report-amount">${yearEndFigure()}</th><th class="report-amount">Bank feed</th><th>Status</th><th></th></tr></thead>`;
    const tbody = document.createElement("tbody");
    for (const m of milestones) {
      const tr = document.createElement("tr");
      const status = document.createElement("td");
      const pill = document.createElement("span");
      pill.className = `status-pill ${!m.compared ? "none" : m.agrees ? "ok" : "off"}`;
      pill.textContent = m.notes;
      status.append(pill);

      const action = document.createElement("td");
      action.className = "report-amount";
      const view = document.createElement("button");
      view.type = "button";
      view.className = "link-button";
      view.textContent = "View report";
      view.addEventListener("click", () => openBankReconcileReport(m.accountId));
      action.append(view);

      tr.append(
        nameCell(m.closeDate),
        nameCell(m.accountLabel),
        amountCell(dollars(m.ledgerBalance)),
        amountCell(m.xeroBalance !== null ? dollars(m.xeroBalance) : "—"),
        amountCell(m.akahuBalance !== null ? dollars(m.akahuBalance) : "—"),
        status,
        action,
      );
      tbody.append(tr);
    }
    table.append(tbody);
    tableWrap.append(table);
    container.append(tableWrap);
  }

  return container;
}

/** The menu's count, coloured by the most urgent thing waiting. Snoozed items are not counted. */
export function markActions(all = actionItems()): void {
  const items = all.filter((item) => snoozedUntil(item.key) === undefined);
  const button = document.querySelector<HTMLButtonElement>('.sidebar-nav button[data-page="actions"]');
  if (!button) return;
  const badge = button.querySelector<HTMLElement>(".actions-badge");
  // One per kind of thing waiting, not the sum of their rows: forty unmatched
  // lines are one job, and the page lists each kind with its own count.
  const total = items.length;
  const red = items.some((item) => item.urgency === "red");
  if (badge) {
    badge.hidden = total === 0;
    badge.textContent = total > 99 ? "99+" : String(total);
    badge.classList.toggle("actions-red", red);
    badge.classList.toggle("actions-amber", !red);
  }
  button.title = total === 0 ? "Nothing waiting" : `${total} ${total === 1 ? "action" : "actions"} waiting${red ? ", some urgent" : ""}`;
}
