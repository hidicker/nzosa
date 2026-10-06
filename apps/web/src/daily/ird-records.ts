import { redraw } from "../app.js";
import { filedKey } from "@nzosa/core";
import { allMyirCards } from "./myir-cards.js";
import { asCsvText, entityBankAccounts, recomputeVariance, record, varianceInput } from "../books.js";
import { gstSummaryReturns } from "@nzosa/core";
import { $, state } from "../state.js";
import { save } from "../store.js";
import type { StoredIncomeReturn, StoredIrdRecord } from "../store.js";
import { amountCell, nameCell, note } from "../ui.js";
import { computeOurReturns } from "../variance.js";
import { ir3For } from "./reports.js";
import {
  checkAccountTransactions,
  checkEmployerMonths,
  checkGstReturns,
  checkIr3,
  emptyEntityModel,
  ownersOf,
  readIr3Confirmation,
  readIrdExport,
} from "@nzosa/core";
import type {
  BankLineRef,
  Cents,
  FiledIr3,
  GstBoxes,
  IrdCheck,
  IrdRecord,
  IsoDate,
  PayrollMonth,
} from "@nzosa/core";

/**
 * IRD records: what Inland Revenue holds, beside what these books say.
 *
 * Everybody with a myIR login can download their returns, their tax account
 * transactions and their employer summary. They are what was actually filed
 * and assessed, so they are the check that counts: a figure these books hold
 * is compared with Inland Revenue's and flagged where the two differ, and a
 * figure these books do not hold is listed as such, so it can be journalled or
 * entered rather than quietly missing.
 */

/** A record read and waiting to be told whose it is, and any read after it. */
let pending: { record: IrdRecord; file: string } | null = null;
const waiting: { record: IrdRecord; file: string }[] = [];
/** Records whose every row is showing, not only the ones that need looking at. */
const showingAll = new Set<string>();
let message = "";

const money = (cents: Cents | null): string =>
  cents === null ? "" : (cents / 100).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function entities() {
  return (state.ledger.entities ?? emptyEntityModel()).entities;
}

function entityName(id: string | undefined): string {
  return entities().find((e) => e.id === id)?.name ?? "";
}

/**
 * Whose account a record is, where that can be told.
 *
 * By GST number first -- an IRD account id starts with the IRD number, and an
 * entity's GST number is the same number -- then by name, then the only
 * entity there is.
 */
export function guessEntity(record: IrdRecord): string | undefined {
  if (record.kind === "ir3") return undefined;
  const digits = record.accountId.replace(/\D/g, "").slice(0, 9);
  const all = entities();
  const byNumber = all.find((e) => (e.gstNumber ?? "").replace(/\D/g, "") === digits && digits !== "");
  if (byNumber) return byNumber.id;
  const name = record.name.toLowerCase();
  const byName = all.filter((e) => {
    const words = e.name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
    return words.length > 0 && words.every((w) => name.includes(w));
  });
  if (byName.length === 1) return byName[0]?.id;
  return all.length === 1 ? all[0]?.id : undefined;
}

function describe(one: IrdRecord): string {
  switch (one.kind) {
    case "gst-returns":
      return `GST returns, ${one.periods.length} period${one.periods.length === 1 ? "" : "s"}`;
    case "account":
      return `${one.taxType || "Tax"} account transactions, ${one.rows.length} line${one.rows.length === 1 ? "" : "s"}`;
    case "employer":
      return `Employer summary, ${one.months.length} month${one.months.length === 1 ? "" : "s"}`;
    case "ir3":
      return `IR3 confirmation for the year to 31 March ${one.year}`;
  }
}

function range(one: IrdRecord): string {
  if (one.kind === "ir3") return one.received ? `received ${one.received}` : "";
  return `${one.from ?? "?"} to ${one.to ?? "?"}`;
}

// --- what these books say ----------------------------------------------------

/** The day these books' bank lines start, for the entity when one is given. */
function booksStart(entityId: string | undefined): IsoDate | undefined {
  const model = state.ledger.entities ?? emptyEntityModel();
  const banks = entityId === undefined
    ? null
    : new Set(Object.entries(model.banks).filter(([, ids]) => ids.includes(entityId)).map(([b]) => b));
  const dates = state.ledger.transactions
    .filter((t) => banks === null || banks.size === 0 || banks.has(t.account))
    .map((t) => t.date)
    .sort();
  return dates[0] as IsoDate | undefined;
}

/**
 * The GST returns these books work out for one entity, by period end.
 *
 * The same returns the GST reconciliation compares, for the entity the record
 * belongs to rather than whichever is chosen at the top of the page.
 */
function ourGstReturns(entityId: string | undefined, from: IsoDate, to: IsoDate): Map<string, { from: string; boxes: GstBoxes }> {
  const was = { entity: state.entityFilter, accounts: state.varianceAccounts };
  state.entityFilter = entityId ?? "";
  state.varianceAccounts = [];
  try {
    const out = new Map<string, { from: string; boxes: GstBoxes }>();
    for (const r of computeOurReturns(varianceInput(), from, to)) {
      const b = r.boxes;
      out.set(r.period.to, {
        from: r.period.from,
        boxes: {
          box5: b.box5, box6: b.box6, box9: b.box9, box10: b.box10,
          box11: b.box11, box13: b.box13, box14: b.box14,
          box15: b.outcome === "refund" ? -b.box15 : b.box15,
        },
      });
    }
    return out;
  } finally {
    state.entityFilter = was.entity;
    state.varianceAccounts = was.accounts;
  }
}

function gstOurs(entityId: string | undefined, periodEnds: readonly string[]) {
  const sorted = [...periodEnds].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first === undefined || last === undefined) return () => null;
  // Back far enough that the first period is whole.
  const from = `${Number(first.slice(0, 4)) - 1}${first.slice(4)}` as IsoDate;
  const returns = ourGstReturns(entityId, from, last as IsoDate);
  const start = booksStart(entityId);
  return (periodEnd: IsoDate): GstBoxes | null | "outside-books" => {
    const ours = returns.get(periodEnd);
    if (start === undefined || periodEnd < start) return "outside-books";
    if (ours === undefined) return null;
    if (ours.from < start) return "outside-books";
    return ours.boxes;
  };
}

function bankLines(entityId: string | undefined): BankLineRef[] {
  const was = state.entityFilter;
  state.entityFilter = entityId ?? "";
  const mine = entityBankAccounts();
  state.entityFilter = was;
  return state.ledger.transactions
    .filter((t) => mine.length === 0 || mine.includes(t.account))
    .map((t) => ({ id: t.id, date: t.date as IsoDate, amount: t.amount, who: t.otherParty || t.particulars || "" }));
}

/** Pay runs added up by the month they were paid in, as employment information is filed. */
function payrollMonths(): Map<string, PayrollMonth> {
  const out = new Map<string, PayrollMonth>();
  for (const run of state.ledger.payroll?.payRuns ?? []) {
    const month = run.payDate.slice(0, 7);
    const held = out.get(month) ?? {
      gross: 0, notLiableAcc: 0, paye: 0, childSupport: 0, studentLoan: 0, kiwiSaver: 0,
      employerKiwiSaverNet: 0, esct: 0, ess: 0, priorGross: 0, priorPaye: 0,
    };
    held.gross += run.totalGross;
    held.notLiableAcc += run.lines.reduce((sum, l) => sum + l.earningsNotLiableAcc, 0);
    held.paye += run.totalPaye;
    held.childSupport += run.totalChildSupport;
    held.studentLoan += run.totalStudentLoan + (run.totalSlcir ?? 0) + (run.totalSlbor ?? 0);
    held.kiwiSaver += run.totalKiwiSaverEmployee;
    held.employerKiwiSaverNet += run.totalKiwiSaverEmployerNet ?? run.totalKiwiSaverEmployer - run.totalEsct;
    held.esct += run.totalEsct;
    held.ess += run.totalEss ?? 0;
    held.priorGross += run.totalPriorGross ?? 0;
    held.priorPaye += run.totalPriorPaye ?? 0;
    out.set(month, held);
  }
  return out;
}

/**
 * Box 13 and what follows from it, explained where the filed return says so.
 *
 * Late claims -- an accountant's corrections to earlier periods, put through
 * a later return -- are in Box 13 of the return they were filed in and in no
 * bank line of these books. Where the filed return held for the period
 * carries them, and they are the whole of the difference, the rows say so
 * rather than standing as unexplained.
 */
function withLateClaims(checks: IrdCheck[]): IrdCheck[] {
  return checks.map((c) => {
    if (c.status !== "differs" || c.ird === null || c.ours === null) return c;
    if (!/^Box 1[345]\b/.test(c.label)) return c;
    const end = c.group.replace("Period ending ", "");
    const filed = state.filed.find((f) => f.periodEnd === end);
    const late = filed?.boxes.box13 ?? 0;
    if (late === 0) return c;
    // Box 13 and 14 are higher by it on the filed side; Box 15 lower.
    const expected = /^Box 15/.test(c.label) ? late : -late;
    if (Math.abs(c.ours - c.ird - expected) > 100) return c;
    return {
      ...c,
      note:
        `Late claims of ${(late / 100).toFixed(2)} in the filed return: adjustments to earlier ` +
        "periods, in no bank line of these books.",
    };
  });
}

function checksFor(held: StoredIrdRecord): IrdCheck[] {
  switch (held.kind) {
    case "gst-returns":
      return withLateClaims(
        checkGstReturns(held.periods, gstOurs(held.entityId, held.periods.map((p) => p.periodEnd))),
      );
    case "account": {
      const start = booksStart(held.entityId);
      const ends = held.rows.map((r) => r.periodEnd).filter((e): e is IsoDate => e !== null);
      const gst = held.taxType === "GST" ? gstOurs(held.entityId, ends) : null;
      const months = held.taxType === "EMP" ? payrollMonths() : null;
      return checkAccountTransactions(held.rows, bankLines(held.entityId), {
        ...(start !== undefined ? { booksStart: start } : {}),
        assessment: (periodEnd) => {
          if (gst !== null) {
            const ours = gst(periodEnd);
            return ours === null || ours === "outside-books" ? undefined : ours.box15;
          }
          if (months !== null) {
            const m = months.get(periodEnd.slice(0, 7));
            return m === undefined
              ? undefined
              : m.paye + m.childSupport + m.studentLoan + m.kiwiSaver + m.employerKiwiSaverNet + m.esct;
          }
          return undefined;
        },
      });
    }
    case "employer": {
      const months = payrollMonths();
      return checkEmployerMonths(held.months, (end) => months.get(end.slice(0, 7)) ?? null);
    }
    case "ir3": {
      if (held.owner === undefined) return checkIr3(held, null);
      const ours = ir3For(held.owner, held.year);
      const byBox = new Map(ours.boxes.map((b) => [b.box, b.amount]));
      return checkIr3(held, (box) => byBox.get(box));
    }
  }
}

// --- the page ----------------------------------------------------------------

/**
 * Who files the returns: a tax agent, or the owners themselves.
 *
 * It moves every date that matters at year end -- an IR3 is due 7 July
 * without an agent and as late as 31 March with one, and terminal tax moves
 * from 7 February to 7 April -- so a review that does not know it calls
 * returns late that are not.
 */
function filingPanel(): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "filing-panel";
  const heading = document.createElement("h3");
  heading.textContent = "Who files these returns";
  wrap.append(heading);

  const filing = state.ledger.filing;
  const choice = document.createElement("select");
  for (const [value, label] of [
    ["", "Not said"],
    ["agent", "A tax agent or accountant files them"],
    ["self", "We file them ourselves"],
  ] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    choice.append(option);
  }
  choice.value = filing === undefined ? "" : filing.taxAgent ? "agent" : "self";

  const agent = document.createElement("input");
  agent.type = "text";
  agent.placeholder = "Agent or accountant (optional)";
  agent.value = filing?.agentName ?? "";
  agent.hidden = choice.value !== "agent";

  const keep = (): void => {
    const next =
      choice.value === ""
        ? undefined
        : {
            taxAgent: choice.value === "agent",
            ...(choice.value === "agent" && agent.value.trim() !== "" ? { agentName: agent.value.trim() } : {}),
          };
    const { filing: _gone, ...rest } = state.ledger;
    state.ledger = next === undefined ? rest : { ...rest, filing: next };
    agent.hidden = choice.value !== "agent";
    void save(state.ledger).then((ok) => {
      state.persistent = ok;
    });
  };
  choice.addEventListener("change", keep);
  agent.addEventListener("change", keep);

  const row = document.createElement("div");
  row.className = "filing-row";
  row.append(choice, agent);
  wrap.append(
    row,
    note(
      "With a tax agent, an individual's return is due as late as 31 March of the next year and " +
        "terminal tax on 7 April, rather than 7 July and 7 February.",
    ),
  );
  return wrap;
}

export function renderIrdRecords(): void {
  const body = $("ird-body");
  body.textContent = "";
  if (message !== "") body.append(note(message));

  if (pending !== null) body.append(pendingPanel(pending));

  body.append(filingPanel());

  // Every file myIR has that these books use -- the same cards Start here,
  // Personal year end and GST reconciliation show -- with where to get each.
  const heading = document.createElement("h3");
  heading.textContent = "What myIR can give these books";
  body.append(heading, ...allMyirCards(() => redraw("ird")).cards);

  const held = state.ledger.irdRecords ?? [];
  if (held.length === 0 && pending === null) {
    body.append(
      note(
        "Nothing loaded yet. In myIR, open the account (GST, income tax, employer or FBT) and " +
          "choose Returns and transactions, then download: the GST return summary, the account's " +
          "transactions, and for an employer the employment information summary. For an IR3, open " +
          "the filed return's confirmation, copy all of its text and paste it here.",
      ),
    );
  }

  const notHeld = new Map<string, Set<string>>();
  for (const one of held) {
    const checks = checksFor(one);
    body.append(recordCard(one, checks));
    for (const c of checks.filter((x) => x.status === "not-held")) {
      const kind = describe(one).replace(/,.*$/, "");
      const list = notHeld.get(kind) ?? new Set<string>();
      list.add(c.label.replace(/ \(box .*\)$/, ""));
      notHeld.set(kind, list);
    }
  }

  if (notHeld.size > 0) {
    const heading = document.createElement("h3");
    heading.textContent = "Figures Inland Revenue has that these books do not";
    body.append(heading);
    const list = document.createElement("ul");
    list.className = "ird-not-held";
    for (const [kind, labels] of notHeld) {
      const item = document.createElement("li");
      item.textContent = `${kind}: ${[...labels].join("; ")}.`;
      list.append(item);
    }
    body.append(list);
  }
}

function pendingPanel(held: { record: IrdRecord; file: string }): HTMLElement {
  const box = document.createElement("div");
  box.className = "invoice-editor ird-pending";
  const heading = document.createElement("h3");
  heading.textContent = `${describe(held.record)} (${range(held.record)})`;
  box.append(heading);

  const choose = document.createElement("select");
  const ir3 = held.record.kind === "ir3";
  const options = ir3
    ? ownersOf(state.ledger.entities ?? emptyEntityModel()).map((o) => ({ value: o, label: o }))
    : entities().map((e) => ({ value: e.id, label: e.name }));
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = ir3 ? "Whose return is it?" : "Whose account is it?";
  choose.append(blank);
  for (const o of options) {
    const option = document.createElement("option");
    option.value = o.value;
    option.textContent = o.label;
    choose.append(option);
  }
  if (!ir3) {
    const guess = guessEntity(held.record);
    if (guess !== undefined) choose.value = guess;
  } else {
    // The owner the confirmation names: every word of the owner's name in it.
    const named = (held.record.kind === "ir3" ? held.record.name ?? "" : "").toLowerCase();
    const matches = options.filter((o) => {
      const words = o.label.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 2);
      return named !== "" && words.length > 0 && words.every((w) => named.includes(w));
    });
    if (matches.length === 1) choose.value = matches[0]?.value ?? "";
    else if (options.length === 1) choose.value = options[0]?.value ?? "";
  }
  if (!ir3) {
    box.append(note(`Inland Revenue's name for the account: ${held.record.kind === "ir3" ? "" : held.record.name}.`));
  } else if (options.length === 0) {
    box.append(note("No owners are set on the Entities page, so this can be kept but not checked against an IR3."));
  }
  box.append(choose);

  const keep = document.createElement("button");
  keep.type = "button";
  keep.className = "primary";
  keep.textContent = "Keep and check";
  keep.addEventListener("click", () => {
    void keepRecord(held, choose.value === "" ? undefined : choose.value);
  });
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => {
    pending = waiting.shift() ?? null;
    redraw("ird");
  });
  const actions = document.createElement("div");
  actions.className = "invoice-actions";
  actions.append(keep, cancel);
  box.append(actions);
  return box;
}

function recordCard(one: StoredIrdRecord, checks: readonly IrdCheck[]): HTMLElement {
  const card = document.createElement("div");
  card.className = "ird-record";
  const heading = document.createElement("h3");
  const whose = one.kind === "ir3" ? (one.owner ?? "no owner said") : (entityName(one.entityId) || "no entity said");
  heading.textContent = `${describe(one)} · ${whose} · ${range(one)}`;
  card.append(heading);

  const count = (status: IrdCheck["status"]): number => checks.filter((c) => c.status === status).length;
  const differs = count("differs");
  const summary = document.createElement("p");
  summary.className = differs > 0 ? "match-off" : "page-hint";
  summary.textContent =
    `${count("agrees")} agree, ${differs} differ` +
    (count("not-held") > 0 ? `, ${count("not-held")} not in these books` : "") +
    (count("outside-books") > 0 ? `, ${count("outside-books")} from before these books start` : "") +
    ".";
  card.append(summary);

  const all = showingAll.has(one.id);
  const shown = all ? checks : checks.filter((c) => c.status === "differs" || c.status === "not-held");
  if (shown.length > 0) {
    const table = document.createElement("table");
    table.className = "report-table ird-table";
    table.innerHTML =
      "<thead><tr><th></th><th>What</th><th>Inland Revenue</th><th>These books</th><th>Difference</th><th>Note</th></tr></thead>";
    const tbody = document.createElement("tbody");
    let lastGroup = "";
    for (const c of shown) {
      const tr = document.createElement("tr");
      tr.className = `ird-${c.status}`;
      tr.append(nameCell(c.group === lastGroup ? "" : c.group), nameCell(c.label));
      lastGroup = c.group;
      tr.append(amountCell(money(c.ird)), amountCell(money(c.ours)));
      const diff = amountCell(c.ird !== null && c.ours !== null && c.status === "differs" ? money(c.ours - c.ird) : "");
      if (c.status === "differs") diff.classList.add("match-off");
      tr.append(diff);
      const status =
        c.status === "agrees" ? "Agrees" :
          c.status === "differs" ? "Differs" :
            c.status === "not-held" ? "Not in these books" : "Before these books";
      tr.append(nameCell(c.note ? `${status}: ${c.note}` : status));
      tbody.append(tr);
    }
    table.append(tbody);
    card.append(table);
  } else {
    card.append(note("Everything in it agrees with these books."));
  }

  const actions = document.createElement("div");
  actions.className = "invoice-actions";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.textContent = all ? "Show only what needs looking at" : "Show every row";
  toggle.addEventListener("click", () => {
    if (all) showingAll.delete(one.id);
    else showingAll.add(one.id);
    redraw("ird");
  });
  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "Remove";
  remove.addEventListener("click", () => void removeRecord(one));
  actions.append(toggle, remove);
  card.append(actions);
  return card;
}

// --- keeping them ------------------------------------------------------------

/** Two records of the same thing for the same account, whose dates overlap: the newer replaces. */
function sameThing(a: StoredIrdRecord, b: IrdRecord, entityId: string | undefined, owner: string | undefined): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "ir3" && b.kind === "ir3") return a.year === b.year && a.owner === owner;
  if (a.kind === "ir3" || b.kind === "ir3") return false;
  if (a.kind === "account" && b.kind === "account" && a.taxType !== b.taxType) return false;
  // Another registration's account is another account: Tom's GST is not a
  // newer copy of Ana's, though both are for the same property and dates.
  if (a.accountId !== b.accountId) return false;
  if ((a.entityId ?? "") !== (entityId ?? "")) return false;
  const aFrom = a.from ?? "0000", aTo = a.to ?? "9999", bFrom = b.from ?? "0000", bTo = b.to ?? "9999";
  return aFrom <= bTo && bFrom <= aTo;
}

async function keepRecord(held: { record: IrdRecord; file: string }, whose: string | undefined): Promise<void> {
  message = await keepIrdRecord(held, whose);
  pending = waiting.shift() ?? null;
  redraw("ird");
}

/**
 * Keep a myIR record with the books, whoever's it is, and say what was kept.
 *
 * The one way in for every page that takes a myIR file -- this one, Start
 * here, Personal year end, GST reconciliation -- so a file loaded anywhere is
 * the same file everywhere, kept once.
 */
export async function keepIrdRecord(
  held: { record: IrdRecord; file: string },
  whose: string | undefined,
  /** Whose registration an entity's account is, where its owners each register. */
  ownerOfAccount?: string,
): Promise<string> {
  const ir3 = held.record.kind === "ir3";
  const entityId = ir3 ? undefined : whose;
  const owner = ir3 ? whose : ownerOfAccount;
  const entry = {
    ...held.record,
    id: `${held.record.kind}-${Date.now().toString(36)}`,
    file: held.file,
    savedAt: new Date().toISOString(),
    ...(entityId !== undefined ? { entityId } : {}),
    ...(owner !== undefined ? { owner } : {}),
  } as StoredIrdRecord;
  const before = state.ledger.irdRecords ?? [];
  const after = [...before.filter((r) => !sameThing(r, held.record, entityId, owner)), entry];
  state.ledger = { ...state.ledger, irdRecords: after };

  // An IR3 confirmation is also the filed IR3, where none is held for that
  // owner and year: its residential deductions carried forward are next
  // year's brought forward, and its residual income tax sets next year's
  // provisional tax.
  let alsoKept = "";
  if (held.record.kind === "ir3" && owner !== undefined) {
    const balanceDate = `${held.record.year}-03-31` as IsoDate;
    const returns = state.ledger.incomeReturns ?? [];
    if (!returns.some((r) => r.form === "IR3" && r.owner === owner && r.balanceDate === balanceDate)) {
      const filed = filedIr3From(held.record, balanceDate);
      if (filed !== null) {
        const stored = { ...filed, owner, savedAt: new Date().toISOString(), source: "myIR confirmation" } as StoredIncomeReturn;
        state.ledger = { ...state.ledger, incomeReturns: [...returns, stored] };
        alsoKept = " and kept as the filed IR3";
      }
    }
  }

  // A GST return summary is also the returns as filed, for the periods none
  // is held for: the GST reconciliation compares against them, and loading
  // the same file there as well should not be a second errand. A return
  // already held -- from a workbook, typed in, or marked as filed -- stays.
  if (held.record.kind === "gst-returns") {
    const { returns } = gstSummaryReturns(held.record.periods, { account: held.record.accountId });
    // By period and registration: a co-owner's return for the same period is
    // a return of its own, not a second copy of the first.
    const heldPeriods = new Set(state.filed.map((f) => filedKey(f)));
    const fresh = returns.filter((r) => !heldPeriods.has(filedKey(r)));
    if (fresh.length > 0) {
      state.filed = [...state.filed, ...fresh].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
      state.ledger = { ...state.ledger, filedReturns: state.filed };
      alsoKept = ` and ${fresh.length} period${fresh.length === 1 ? "" : "s"} kept as filed GST returns`;
    }
  }

  state.persistent = await save(state.ledger);
  if (held.record.kind === "gst-returns") recomputeVariance();
  await record(
    "irdRecords",
    `${describe(held.record)} read from myIR${alsoKept}` +
      (entityId ? ` (${entityName(entityId)})` : owner ? ` (${owner})` : ""),
    before,
    after,
  );
  redraw("ird");
  return `Kept: ${describe(held.record)}${alsoKept}.`;
}

function filedIr3From(one: Extract<IrdRecord, { kind: "ir3" }>, balanceDate: IsoDate): FiledIr3 | null {
  const f = one.figures;
  if (f.taxableIncome === undefined || f.totalIncome === undefined) return null;
  const residential = f.residentialTotal !== undefined || f.residentialDeductions !== undefined;
  return {
    form: "IR3",
    balanceDate,
    ...(f.grossEarnings !== undefined ? { salaryWages: f.grossEarnings } : {}),
    ...(f.paye !== undefined ? { payeDeducted: f.paye } : {}),
    ...(f.interestGross !== undefined ? { interestGross: f.interestGross } : {}),
    ...(f.interestRwt !== undefined ? { rwtOnInterest: f.interestRwt } : {}),
    ...(f.dividendsGross !== undefined ? { dividendsGross: f.dividendsGross } : {}),
    ...(f.imputationCredits !== undefined ? { imputationCredits: f.imputationCredits } : {}),
    ...(f.dividendRwt !== undefined ? { rwtOnDividends: f.dividendRwt } : {}),
    rentalIncome: (f.residentialNet ?? 0) + (f.otherRents ?? 0),
    ...(f.otherIncome !== undefined ? { otherIncome: f.otherIncome } : {}),
    totalIncome: f.totalIncome,
    taxableIncome: f.taxableIncome,
    taxOnIncome: f.taxOnIncome ?? 0,
    totalTaxCredits: f.totalTaxCredits ?? 0,
    residualIncomeTax: f.residualIncomeTax ?? 0,
    ...(one.text.provisionalOption ? { provisionalTaxMethod: one.text.provisionalOption } : {}),
    // The portfolio as one schedule: the confirmation gives the residential
    // properties together, which is how their losses are ring-fenced.
    rentals: residential
      ? [{
          property: "Residential portfolio",
          grossIncome: f.residentialTotal ?? 0,
          expenses: f.residentialDeductions ?? 0,
          netIncome: (f.residentialTotal ?? 0) - (f.residentialDeductions ?? 0),
          ...(f.residentialBroughtForward !== undefined ? { ringFencedLossBroughtForward: f.residentialBroughtForward } : {}),
          ...(f.residentialCarriedForward !== undefined ? { ringFencedLossCarriedForward: f.residentialCarriedForward } : {}),
        }]
      : [],
  };
}

async function removeRecord(one: StoredIrdRecord): Promise<void> {
  if (!confirm(`Remove ${describe(one)}? History can undo it.`)) return;
  const before = state.ledger.irdRecords ?? [];
  const after = before.filter((r) => r.id !== one.id);
  state.ledger = { ...state.ledger, irdRecords: after };
  state.persistent = await save(state.ledger);
  await record("irdRecords", `${describe(one)} removed`, before, after);
  message = "";
  redraw("ird");
}

/** myIR exports handed over elsewhere, read here to be checked and kept. */
export async function readIrdFiles(files: readonly File[]): Promise<void> {
  await readFiles(files);
}

async function readFiles(files: readonly File[]): Promise<void> {
  const problems: string[] = [];
  for (const file of files) {
    const text = await asCsvText(file.name, new Uint8Array(await file.arrayBuffer()));
    const { record: read, problem } = readIrdExport(text);
    if (read === null) {
      problems.push(`${file.name}: ${problem ?? "not read"}`);
      continue;
    }
    // Each is shown before it is kept, one at a time, so whose it is can be
    // checked: the guess from the name is only a guess.
    waiting.push({ record: read, file: file.name });
  }
  if (pending === null) pending = waiting.shift() ?? null;
  message = problems.join(" ");
  redraw("ird");
}

export function wireIrdRecords(): void {
  $("ird-pick").addEventListener("click", () => $<HTMLInputElement>("ird-input").click());
  $<HTMLInputElement>("ird-input").addEventListener("change", (e) => {
    const input = e.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = "";
    if (files.length > 0) void readFiles(files);
  });
  $("ird-paste-read").addEventListener("click", () => {
    const box = $<HTMLTextAreaElement>("ird-paste");
    const { record: read, problem } = readIr3Confirmation(box.value);
    if (read === null) {
      message = problem ?? "Nothing could be read.";
    } else {
      pending = { record: read, file: "pasted IR3 confirmation" };
      box.value = "";
      message = "";
    }
    redraw("ird");
  });
}
