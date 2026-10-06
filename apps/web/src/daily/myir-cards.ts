import { moduleOn } from "../modules.js";
import { asCsvText } from "../books.js";
import { state } from "../state.js";
import { note } from "../ui.js";
import { MYIR_NOTE, emptyEntityModel, readIr3Confirmation, readIrdExport } from "@nzosa/core";
import type { IrdRecord } from "@nzosa/core";
import { guessEntity, keepIrdRecord } from "./ird-records.js";
import { incomeReturnPanel } from "./income-returns.js";
import { myirIncomePanel } from "./myir-income-panel.js";
import { taxYearEnd, taxYearOf } from "../tax-year.js";

/**
 * Everything myIR can give these books, as cards to load it from wherever
 * the person is.
 *
 * Each kind of download is described once -- what it is, where in myIR it
 * comes from, what it is used for -- and shown on whichever page needs it:
 * Start here, Personal year end, GST reconciliation, and Inland Revenue
 * records, which lists them all. A file loaded on any of them is kept once,
 * with the other myIR records, and read by every page that uses it. So
 * nobody is sent off to another page half way through setting up.
 *
 * Each card says whether its file is missing altogether, or missing for
 * particular years -- the ones these books cover.
 */

export type MyirFileId =
  | "gst-returns"
  | "gst-account"
  | "income-tax-account"
  | "employer"
  | "employer-account"
  | "income-details"
  | "income-return"
  | "ir3-confirmation";

interface MyirFile {
  title: string;
  /** Where in myIR it is, as the person would follow it. */
  where: string;
  /** Whether that wording has been checked against myIR, rather than written from what it is. */
  whereChecked: boolean;
  usedFor: string;
}

/** Said with every transaction report: one year at a time leaves the others missing. */
const ALL_DATES = " Choose all dates, back from today, so every year is in it.";
const RETURN_LETTER =
  "Income Tax → Returns and transactions → Returns → View or amend return → " +
  "Download or print return → Print Letter";

export const MYIR_FILES: Record<MyirFileId, MyirFile> = {
  "gst-returns": {
    title: "GST return summary",
    where: "In myIR: GST → More → GST return summary report (Excel).",
    whereChecked: true,
    usedFor: "Every GST return as filed, set against the books' own returns for the same periods.",
  },
  "gst-account": {
    title: "GST account transactions",
    where: `In myIR: GST → More → GST Transaction summary report (Excel).${ALL_DATES}`,
    whereChecked: true,
    usedFor: "Assessments, payments and refunds, to reconcile the GST account in the books.",
  },
  "income-tax-account": {
    title: "Income tax account transactions",
    where: `In myIR: Income Tax → More → Transaction summary report (Excel).${ALL_DATES}`,
    whereChecked: true,
    usedFor: "Provisional tax paid for each year, and what was assessed and refunded.",
  },
  employer: {
    title: "PAYE return summary",
    where: "In myIR: Payroll → More → PAYE return summary report (Excel).",
    whereChecked: true,
    usedFor: "Each month's wages and deductions as filed, set against the pay runs.",
  },
  "employer-account": {
    title: "Payroll account transactions",
    where: `In myIR: Payroll → More → Transaction summary report (Excel).${ALL_DATES}`,
    whereChecked: true,
    usedFor: "What was assessed and paid for employer deductions each month, against what the pay runs owed.",
  },
  "income-details": {
    title: "Income from myIR",
    where: "In myIR: Income Tax → More → Print Income Details → Current Year or Last Year (PDF).",
    whereChecked: true,
    usedFor: "Wages and PAYE, interest and RWT, dividends, PIE income -- payer by payer -- for the IR3.",
  },
  "income-return": {
    title: "Filed income tax return (IR3 or IR4)",
    where: `In myIR: ${RETURN_LETTER} (PDF, all pages).`,
    whereChecked: true,
    usedFor: "Losses and rental deductions carried forward, and last year's residual income tax for provisional tax.",
  },
  "ir3-confirmation": {
    title: "IR3 confirmation",
    where: `In myIR: ${RETURN_LETTER}; select all of its text and copy it.`,
    whereChecked: true,
    usedFor: "The filed IR3's figures, when there is no PDF of the return to read.",
  },
};

/** Whose a card is: an entity's account, or a person's return. */
export interface MyirContext {
  entityId?: string;
  owner?: string;
  /** For a card about one year: Personal year end's. */
  year?: number;
}

function fyOf(date: string): number {
  return taxYearOf(date);
}

/** The years of these books that have ended: the ones a file could be missing for. */
export function bookYearsEnded(): number[] {
  const today = new Date().toISOString().slice(0, 10);
  const years = new Set(state.ledger.transactions.map((t) => fyOf(t.date)));
  return [...years].filter((y) => taxYearEnd(y) < today).sort();
}

/** The person's own entity: a personal one they alone own. */
function ownEntity(owner: string): string | undefined {
  return (state.ledger.entities ?? emptyEntityModel()).entities.find(
    (e) => e.kind === "personal" && (e.owners ?? []).length === 1 && e.owners?.[0]?.name === owner,
  )?.id;
}

function forEntity(record: { entityId?: string; owner?: string; name?: string }, ctx: MyirContext): boolean {
  // An entity's card for one owner's registration: that owner's file only.
  if (ctx.entityId !== undefined && ctx.owner !== undefined) {
    return record.entityId === ctx.entityId && record.owner === ctx.owner;
  }
  const entityId = ctx.entityId ?? (ctx.owner !== undefined ? ownEntity(ctx.owner) : undefined);
  if (entityId === undefined) return true;
  return record.entityId === undefined || record.entityId === entityId;
}

/** The financial years a kind of file covers, for this context. */
export function yearsCovered(id: MyirFileId, ctx: MyirContext): Set<number> {
  const out = new Set<number>();
  const records = state.ledger.irdRecords ?? [];
  const range = (from: string | null, to: string | null): void => {
    if (from === null || to === null) return;
    for (let y = fyOf(from); y <= fyOf(to); y++) out.add(y);
  };
  switch (id) {
    case "gst-returns":
      for (const r of records) if (r.kind === "gst-returns" && forEntity(r, ctx)) for (const p of r.periods) out.add(fyOf(p.periodEnd));
      // Returns held from elsewhere count where nobody's registration is asked about.
      if (ctx.owner === undefined || ctx.entityId === undefined) for (const f of state.filed) out.add(fyOf(f.periodEnd));
      break;
    case "gst-account":
    case "income-tax-account": {
      const want = id === "gst-account" ? /gst/i : /income|inc/i;
      for (const r of records) {
        if (r.kind !== "account" || !want.test(`${r.taxType} ${r.accountId}`) || !forEntity(r, ctx)) continue;
        range(r.from, r.to);
      }
      break;
    }
    case "employer":
      for (const r of records) if (r.kind === "employer" && forEntity(r, ctx)) for (const m of r.months) out.add(fyOf(m.monthEnd));
      break;
    case "employer-account":
      for (const r of records) {
        if (r.kind === "account" && /emp|paye|employer/i.test(`${r.taxType} ${r.accountId}`) && forEntity(r, ctx)) range(r.from, r.to);
      }
      break;
    case "income-details":
      for (const e of state.ledger.taxExtras ?? []) {
        if ((e.note ?? "").startsWith(MYIR_NOTE) && (ctx.owner === undefined || e.owner === ctx.owner)) out.add(e.year);
      }
      break;
    case "income-return":
    case "ir3-confirmation":
      for (const r of state.ledger.incomeReturns ?? []) {
        if (ctx.owner !== undefined && r.owner !== ctx.owner) continue;
        if (ctx.entityId !== undefined && r.entityId !== undefined && r.entityId !== ctx.entityId) continue;
        out.add(fyOf(r.balanceDate));
      }
      break;
  }
  return out;
}

/**
 * Where a kind of file stands for these years: held for all of them, missing
 * for some, or not loaded at all. A filed return is wanted for last year only,
 * and income details for the year being finished.
 */
export function myirStatus(id: MyirFileId, ctx: MyirContext, years: readonly number[]): { missing: number[]; loaded: boolean; said: string } {
  const covered = yearsCovered(id, ctx);
  const wanted = id === "income-return" ? years.slice(-1).map((y) => y - 1) : years;
  const missing = wanted.filter((y) => !covered.has(y));
  const loaded = covered.size > 0;
  const said = !loaded
    ? "Not loaded."
    : missing.length === 0
      ? `Loaded${wanted.length > 0 ? `: ${wanted.map((y) => `year to 31 March ${y}`).join(", ")}` : ""}.`
      : `Loaded, but missing for ${missing.map((y) => `the year to 31 March ${y}`).join(", ")}.`;
  return { missing, loaded, said };
}

/** What a kind of file expects myIR's reader to have found in it. */
function matches(id: MyirFileId, record: IrdRecord): boolean {
  if (id === "gst-returns") return record.kind === "gst-returns";
  if (id === "employer") return record.kind === "employer";
  if (record.kind !== "account") return false;
  if (id === "employer-account") return /emp|paye|employer/i.test(`${record.taxType} ${record.accountId}`);
  return id === "gst-account" ? /gst/i.test(`${record.taxType} ${record.accountId}`) : /income|inc/i.test(`${record.taxType} ${record.accountId}`);
}

const said = new Map<string, string>();

/** One card: what the file is, where to get it, how it stands, and a way to load it here. */
export function myirCard(id: MyirFileId, ctx: MyirContext, years: readonly number[], redraw: () => void): HTMLElement {
  const file = MYIR_FILES[id];
  const status = myirStatus(id, ctx, years);
  const key = `${id}|${ctx.entityId ?? ""}|${ctx.owner ?? ""}|${ctx.year ?? ""}`;
  const card = document.createElement("details");
  card.className = `myir-card ${status.missing.length === 0 && status.loaded ? "myir-held" : "myir-missing"}`;
  card.open = status.missing.length > 0 || !status.loaded;
  const summary = document.createElement("summary");
  const entityName = (state.ledger.entities ?? emptyEntityModel()).entities.find((e) => e.id === ctx.entityId)?.name;
  const whose =
    entityName !== undefined && ctx.owner !== undefined
      ? `${entityName}, ${ctx.owner}'s registration`
      : (ctx.owner ?? entityName);
  summary.textContent = `${status.missing.length === 0 && status.loaded ? "✓" : "!"} ${file.title}${whose ? ` — ${whose}` : ""}: ${status.said}`;
  card.append(summary);
  card.append(
    note(`${file.where}${file.whereChecked ? "" : " (Wording to be checked against myIR.)"}`),
    note(`Used for: ${file.usedFor}`),
  );

  if (id === "income-details") {
    if (ctx.owner !== undefined && ctx.year !== undefined) card.append(myirIncomePanel(ctx.owner, ctx.year, redraw));
    else card.append(note("Loaded for a person and year on Personal year end."));
  } else if (id === "income-return") {
    card.append(incomeReturnPanel(redraw));
  } else if (id === "ir3-confirmation") {
    const box = document.createElement("textarea");
    box.rows = 4;
    box.placeholder = "Paste the confirmation's text here";
    const read = document.createElement("button");
    read.type = "button";
    read.textContent = "Read and keep";
    read.addEventListener("click", () => {
      const { record, problem } = readIr3Confirmation(box.value);
      if (record === null) {
        said.set(key, problem ?? "Nothing could be read.");
        redraw();
        return;
      }
      void keepIrdRecord({ record, file: "pasted IR3 confirmation" }, ctx.owner).then((message) => {
        said.set(key, message);
        redraw();
      });
    });
    card.append(box, read);
  } else {
    // An Excel export: read, checked to be the kind this card is for, and
    // kept for the entity or person the card is about.
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xlsx,.csv";
    const entities = (state.ledger.entities ?? emptyEntityModel()).entities;
    const fixed = ctx.entityId ?? (ctx.owner !== undefined ? ownEntity(ctx.owner) : undefined);
    const whom = document.createElement("select");
    whom.hidden = fixed !== undefined;
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "Whose account is it?";
    whom.append(blank, ...entities.map((e) => Object.assign(document.createElement("option"), { value: e.id, textContent: e.name })));
    input.addEventListener("change", () => {
      const chosen = input.files?.[0];
      if (chosen === undefined) return;
      void chosen.arrayBuffer().then(async (buffer) => {
        const text = await asCsvText(chosen.name, new Uint8Array(buffer));
        const { record, problem } = readIrdExport(text);
        if (record === null || !matches(id, record)) {
          said.set(key, `${chosen.name}: ${record === null ? problem ?? "not read" : `not the ${file.title.toLowerCase()}`}.`);
          redraw();
          return;
        }
        const whose = fixed ?? (whom.value || guessEntity(record));
        // An entity's account under one owner's registration is kept as theirs.
        const ownerOfAccount = ctx.entityId !== undefined ? ctx.owner : undefined;
        said.set(key, await keepIrdRecord({ record, file: chosen.name }, whose, ownerOfAccount));
        redraw();
      });
    });
    card.append(whom, input);
  }
  const message = said.get(key);
  if (message !== undefined) card.append(note(message));
  return card;
}

/**
 * Whose GST files are wanted: each registered entity, or -- where its owners
 * each register for their own share -- each owner's registration for it.
 */
export function gstContexts(): MyirContext[] {
  const model = state.ledger.entities ?? emptyEntityModel();
  const out: MyirContext[] = [];
  for (const entity of model.entities.filter((e) => e.gstRegistered === true)) {
    const owners = entity.owners ?? [];
    if (entity.gstByOwners === true && owners.length > 1) {
      for (const owner of owners) out.push({ entityId: entity.id, owner: owner.name });
    } else {
      out.push({ entityId: entity.id });
    }
  }
  return out;
}

/** The cards Start here and Inland Revenue records show: every file these books could use. */
export function allMyirCards(redraw: () => void): { cards: HTMLElement[]; missing: number } {
  const model = state.ledger.entities ?? emptyEntityModel();
  const years = bookYearsEnded();
  const out: HTMLElement[] = [];
  let missing = 0;
  const add = (id: MyirFileId, ctx: MyirContext): void => {
    const status = myirStatus(id, ctx, years);
    if (!status.loaded || status.missing.length > 0) missing += 1;
    out.push(myirCard(id, ctx, years, redraw));
  };
  // GST: one set per registered entity -- in a person's books, often one
  // registration covering several activities, so the first will usually do.
  for (const ctx of moduleOn("gst") ? gstContexts() : []) {
    add("gst-returns", ctx);
    add("gst-account", ctx);
  }
  // Income tax: each person who owns something here, and each company.
  for (const owner of new Set(model.entities.flatMap((e) => (e.owners ?? []).map((o) => o.name)))) {
    if (ownEntity(owner) === undefined) continue;
    add("income-tax-account", { owner });
  }
  for (const company of model.entities.filter((e) => e.kind === "business" && e.structure === "company")) {
    add("income-tax-account", { entityId: company.id });
  }
  add("income-return", {});
  if (moduleOn("payroll") && (state.ledger.payroll?.employees ?? []).length > 0) {
    add("employer", {});
    add("employer-account", {});
  }
  return { cards: out, missing };
}
