import { record } from "./books.js";
import { showPage } from "./app.js";
import type { PageName } from "./app.js";
import { onboarding, sourceForTheseBooks } from "./migrate/onboarding-state.js";
import { state } from "./state.js";
import { savePart } from "./store.js";
import { emptyEntityModel } from "@nzosa/core";
import type { JurisdictionId } from "@nzosa/core";
import { booksCountry } from "./country.js";

/**
 * Modules: what a set of books uses, so the rest can stay out of the way.
 *
 * Personal and rental books have no use for invoices, payroll, an IR10 or a
 * company's shareholders, and books that never came from Xero have no use for
 * its files and wording. Each module says whether it is on: explicitly, where
 * somebody has chosen, and otherwise from what the books already show -- the
 * entities' kinds and GST registration, where the books came from, whether
 * there are employees. Most modules follow the entities and are never asked.
 *
 * Off only ever hides. Nothing is posted, coded or reported differently, and
 * turning a module back on finds everything where it was.
 */

export type ModuleId =
  | "xero"
  | "sheet"
  | "rentals"
  | "personal"
  | "business"
  | "company"
  | "vehicle"
  | "payroll"
  | "gst"
  | "assets"
  | "nonprofit"
  | "trust"
  | "ir7"
  | "contacts"
  | "items"
  | "time"
  | "aupayroll"
  | "classes"
  | "jobs"
  | "budgets"
  | "register"
  | "statements";

/** Where an automatic answer comes from, said beside it. */
type Basis = "entities" | "source" | "data";

interface ModuleInfo {
  id: ModuleId;
  name: string;
  what: string;
  basis: Basis;
  inferred: () => boolean;
  /** What the books hold for it, said when it is off: "2 employees". */
  holds?: () => string | null;
  /**
   * The countries it exists in, where it is one country's forms and rules --
   * New Zealand's IR3, PAYE, GST return. Absent where it works anywhere.
   */
  countries?: readonly JurisdictionId[];
  /** The page it adds, opened from the Apps page. */
  opens?: string;
}

function entities() {
  return (state.ledger.entities ?? emptyEntityModel()).entities;
}

function source(): string | undefined {
  return sourceForTheseBooks() ?? onboarding().source;
}

const count = (n: number, one: string, many = `${one}s`): string | null => (n === 0 ? null : `${n} ${n === 1 ? one : many}`);

const xeroHeld = (): boolean => Object.keys(state.ledger.xeroBankNumbers ?? {}).length > 0;
const businesses = () => entities().filter((e) => (e.kind ?? "business") === "business");



export const MODULES: readonly ModuleInfo[] = [
  {
    id: "contacts",
    name: "Customers & vendors",
    what: "Who the books deal with: addresses, terms and credit limits, statements, reminders and late fees.",
    basis: "data",
    // On for businesses outside New Zealand, where it came first; asked for in
    // New Zealand -- unless the books already raise invoices, which have
    // customers whether or not anybody has listed them.
    inferred: () =>
      (state.ledger.contacts ?? []).length > 0 ||
      (state.ledger.invoices ?? []).length > 0 ||
      (booksCountry().id !== "nz" && businesses().length > 0),
    holds: () => count((state.ledger.contacts ?? []).length, "customer or vendor", "customers and vendors"),
    opens: "contacts",
  },
  {
    id: "items",
    name: "Products & stock",
    what: "A price list that fills in invoice lines, and products kept in stock, tracked and counted.",
    basis: "data",
    inferred: () => (state.ledger.items ?? []).length > 0,
    holds: () => count((state.ledger.items ?? []).length, "product or service", "products and services"),
    opens: "items",
  },
  {
    id: "time",
    name: "Time",
    what: "Hours worked for customers, and the invoice drafted from what is not billed yet.",
    basis: "data",
    inferred: () => (state.ledger.timeEntries ?? []).length > 0,
    holds: () => count((state.ledger.timeEntries ?? []).length, "time entry", "time entries"),
    opens: "time",
  },
  {
    id: "classes",
    name: "Classes",
    what: "A second way to cut the profit and loss: by department, location or job.",
    basis: "data",
    inferred: () => (state.ledger.classes?.names ?? []).length > 0,
    holds: () => count((state.ledger.classes?.names ?? []).length, "class", "classes"),
    opens: "classes",
  },
  {
    id: "jobs",
    name: "Jobs",
    what: "Work done for a customer, and what each job made: its invoices, bills and bank lines, income less costs.",
    basis: "data",
    inferred: () => (state.ledger.jobs?.jobs ?? []).length > 0,
    holds: () => count((state.ledger.jobs?.jobs ?? []).length, "job", "jobs"),
    opens: "jobs",
  },
  {
    id: "budgets",
    name: "Budgets",
    what: "A budget for each income and expense account, and the budget beside what the books hold.",
    basis: "data",
    inferred: () => Object.keys(state.ledger.budgets ?? {}).length > 0,
    holds: () => count(Object.keys(state.ledger.budgets ?? {}).length, "year's budget", "years' budgets"),
    opens: "budgets",
  },
  {
    id: "register",
    name: "Registers",
    what: "Cash, petty cash and accounts with no bank feed, typed in line by line.",
    basis: "data",
    inferred: () => state.ledger.transactions.some((t) => t.source.importer === "register"),
    holds: () => count(state.ledger.transactions.filter((t) => t.source.importer === "register").length, "typed entry", "typed entries"),
    opens: "register",
  },
  {
    id: "statements",
    name: "Statement reconciliation",
    what: "Tick a bank statement's lines off against the books until the difference is nothing.",
    basis: "data",
    // New Zealand's books check each day's balance instead, so it is asked for there.
    inferred: () => booksCountry().id !== "nz" || (state.ledger.reconciliations ?? []).length > 0,
    holds: () => count((state.ledger.reconciliations ?? []).length, "statement"),
    opens: "statements",
  },
  {
    id: "ir7",
    opens: "ir7",
    countries: ["nz"],
    name: "Partnerships and look-through companies",
    what: "The IR7 return and each partner or owner's share of the income.",
    basis: "entities",
    inferred: () => entities().some((e) => e.structure === "partnership" || (e.structure === "company" && e.lookThrough === true)),
  },
  {
    id: "trust",
    opens: "trustpeople",
    countries: ["nz"],
    name: "Trusts and estates",
    what: "A trust's people, beneficiary accounts and the IR6 return.",
    basis: "entities",
    inferred: () => entities().some((e) => e.kind === "trust"),
    holds: () => count(entities().filter((e) => e.kind === "trust").length, "trust"),
  },
  {
    id: "nonprofit",
    opens: "grants",
    countries: ["nz"],
    name: "Non-profit",
    what: "Grants and what became of them, and the reports a charity, society or club files.",
    basis: "entities",
    inferred: () => entities().some((e) => e.kind === "nonprofit"),
    holds: () => count((state.ledger.grants ?? []).length, "grant"),
  },
  {
    id: "rentals",
    opens: "tenancies",
    countries: ["nz"],
    name: "Rentals",
    what: "Rental year end, rental information, property manager statements and rental schedules.",
    basis: "entities",
    inferred: () => entities().some((e) => e.kind === "residential" || e.kind === "commercial"),
  },
  {
    id: "personal",
    opens: "personalyear",
    countries: ["nz"],
    name: "Personal",
    what: "Personal year end and each person's IR3.",
    basis: "entities",
    inferred: () => entities().some((e) => e.kind === "personal"),
  },
  {
    id: "business",
    opens: "invoices",
    name: "Business",
    what: "Invoices, money owed to you, prepayments, and the business's own tax return.",
    basis: "entities",
    inferred: () => businesses().length > 0,
    holds: () => count((state.ledger.invoices ?? []).length, "invoice"),
  },
  {
    id: "company",
    opens: "bills",
    name: "Company",
    what: "Shareholders and their current accounts, and bills.",
    basis: "entities",
    inferred: () =>
      businesses().some((e) => e.structure === undefined || e.structure === "company") ||
      entities().some((e) => (e.shareholders ?? []).length > 0),
  },
  {
    id: "gst",
    opens: "gst",
    countries: ["nz"],
    name: "GST",
    what: "GST returns, and reconciling them with what was filed.",
    basis: "entities",
    inferred: () => entities().some((e) => e.gstRegistered === true),
  },
  {
    id: "xero",
    opens: "check",
    name: "Xero import and check",
    what: "Bringing books across from Xero, and checking these against it.",
    basis: "source",
    inferred: () => source() === "xero" || xeroHeld(),
  },
  {
    id: "sheet",
    opens: "check",
    name: "Spreadsheet, QuickBooks, MYOB or GnuCash import",
    what: "Bringing in a coded spreadsheet, or books from QuickBooks, SlowBooks, MYOB or GnuCash, and checking these books' coding against it.",
    basis: "source",
    // Coded history from Xero is the Xero module's; this one is for a
    // spreadsheet. Loading Xero's files switched it on as well, and with it
    // the spreadsheet's steps and menus nobody needed.
    inferred: () =>
      source() === "sheet" ||
      (source() !== "xero" && !xeroHeld() && (state.ledger.reference ?? state.reference).length > 0),
  },
  {
    id: "payroll",
    opens: "payroll",
    countries: ["nz"],
    name: "Payroll",
    what: "Employees, pay runs, PAYE and employer filing.",
    basis: "data",
    inferred: () => (state.ledger.payroll?.employees ?? []).length > 0,
    holds: () => count((state.ledger.payroll?.employees ?? []).length, "employee"),
  },
  {
    id: "aupayroll",
    opens: "aupayroll",
    countries: ["au"],
    name: "Payroll",
    what: "Employees, pay runs, PAYG withholding, super and Single Touch Payroll figures.",
    basis: "data",
    inferred: () => (state.ledger.auPayroll?.employees ?? []).length > 0,
    holds: () => count((state.ledger.auPayroll?.employees ?? []).length, "employee"),
  },
  {
    id: "vehicle",
    countries: ["nz"],
    name: "Company vehicle",
    what: "A vehicle's private use, taken out of a business's costs at year end.",
    basis: "data",
    inferred: () => (state.ledger.vehicleUse ?? []).length > 0,
    holds: () => count((state.ledger.vehicleUse ?? []).length, "vehicle entry", "vehicle entries"),
  },
  {
    id: "assets",
    opens: "assets",
    name: "Fixed assets",
    what: "The asset register and depreciation.",
    basis: "data",
    inferred: () =>
      (state.ledger.assets ?? []).length > 0 ||
      businesses().length > 0 ||
      entities().some((e) => e.kind === "nonprofit" || e.kind === "trust"),
    holds: () => count((state.ledger.assets ?? []).length, "asset"),
  },
];

/** The modules Start here asks about: the ones nothing else answers. */
export const ASKED: readonly ModuleId[] = [
  "payroll",
  "aupayroll",
  "vehicle",
  "assets",
  "business",
  "contacts",
  "items",
  "time",
  "classes",
  "jobs",
  "budgets",
  "register",
  "statements",
];

const info = (id: ModuleId): ModuleInfo | undefined => MODULES.find((m) => m.id === id);

/** The modules that exist in these books' country: all of them in New Zealand. */
export function modulesHere(): readonly ModuleInfo[] {
  const here = booksCountry().id;
  return MODULES.filter((m) => m.countries === undefined || m.countries.includes(here));
}

/** Whether a module is on: as chosen, or as the books show. */
export function moduleOn(id: ModuleId): boolean {
  // A module belonging to another country's tax system is off, whatever was
  // chosen: these books cannot file that country's forms.
  const countries = info(id)?.countries;
  if (countries !== undefined && !countries.includes(booksCountry().id)) return false;
  const chosen = state.ledger.modules?.[id];
  return chosen ?? info(id)?.inferred() ?? true;
}

/**
 * Whether any of a space-separated list of modules is on. `!xero` stands for
 * Xero being off, for the words that take its place. `a+b` is a and b, and a
 * country's id (`nz`) is whether the books are kept there: the IR10 is
 * `business+nz`, a business's return in New Zealand.
 */
const COUNTRIES = new Set(["nz", "au", "us", "kr", "generic"]);
function termOn(term: string): boolean {
  if (term.startsWith("!")) return !termOn(term.slice(1));
  if (COUNTRIES.has(term)) return booksCountry().id === term;
  return moduleOn(term as ModuleId);
}
export function anyModuleOn(list: string): boolean {
  return list
    .split(/\s+/)
    .filter(Boolean)
    .some((either) => either.split("+").every(termOn));
}

/** Choose a module on or off, or -- with null -- back to following the books. */
export async function setModule(id: ModuleId, on: boolean | null): Promise<void> {
  const before = state.ledger.modules ?? {};
  const after: Partial<Record<ModuleId, boolean>> = { ...before };
  if (on === null) delete after[id];
  else after[id] = on;
  state.ledger = { ...state.ledger, modules: after };
  state.persistent = await savePart(state.ledger);
  const name = info(id)?.name ?? id;
  await record("modules", on === null ? `${name}: automatic` : `${name}: ${on ? "on" : "off"}`, before, after);
  applyModules();
}

/**
 * Hide everything marked for a module that is off: `data-module="payroll"`,
 * or several, any of which shows it, or `!xero` for what shows when it is off.
 */
export function applyModules(): void {
  for (const element of document.querySelectorAll<HTMLElement>("[data-module]")) {
    element.hidden = !anyModuleOn(element.dataset["module"] ?? "");
  }
  // A sidebar section with every page in it hidden goes too, rather than
  // leaving a heading with nothing under it (Year end, in books with no
  // rentals, no personal books and no adjustments to make).
  for (const group of document.querySelectorAll<HTMLElement>(".sidebar-group")) {
    group.hidden = ![...group.querySelectorAll<HTMLElement>(".sidebar-group-items > button")].some((b) => !b.hidden);
  }
  // Whatever else follows the modules: the reports a module adds.
  window.dispatchEvent(new Event("nzosa:modules-changed"));
}

/** How these books came, in words for a sentence: "Xero", "your spreadsheet". */
export function previousSystem(): string {
  if (moduleOn("xero")) return "Xero";
  if (moduleOn("sheet")) {
    // QuickBooks' and SlowBooks' files come through the same door.
    for (const t of state.ledger.transactions) {
      const importer = t.source?.importer ?? "";
      if (importer.startsWith("quickbooks")) return "QuickBooks";
      if (importer.startsWith("slowbooks")) return "SlowBooks";
      if (importer.startsWith("myob")) return "MYOB";
      if (importer.startsWith("gnucash")) return "GnuCash";
    }
    return "your spreadsheet";
  }
  return "your previous system";
}

/** What a year-end balance loaded from a trial balance is called: Xero's, where it came from Xero. */
export function yearEndFigure(): string {
  return moduleOn("xero") ? "Xero" : "Year-end figure";
}

/** The same, starting a sentence: "Xero", "Your spreadsheet". */
export function PreviousSystem(): string {
  const said = previousSystem();
  return said.charAt(0).toUpperCase() + said.slice(1);
}

const BASIS: Record<Basis, string> = {
  entities: "from your entities",
  source: "from where these books came from",
  data: "from what these books hold",
};

/**
 * Every module as a tile to click on or off, for Set up and Start here. Each
 * says whether it follows the books or was chosen, and a chosen one can go
 * back to following them.
 */
/**
 * `opening`: an Open button on each tile that is on, for the Modules page. Not
 * in Start here or Setup, where it would take somebody away part way through.
 */
export function modulesPanel(redraw: () => void, only?: readonly ModuleId[], opening = false): HTMLElement {
  const grid = document.createElement("div");
  grid.className = "module-tiles";
  for (const module of modulesHere().filter((m) => only === undefined || only.includes(m.id))) {
    const chosen = state.ledger.modules?.[module.id];
    const on = moduleOn(module.id);
    const tile = document.createElement("div");
    tile.className = `module-tile ${on ? "on" : "off"}`;

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "module-toggle";
    toggle.setAttribute("aria-pressed", String(on));
    toggle.title = on ? `Turn ${module.name} off` : `Turn ${module.name} on`;
    const top = document.createElement("span");
    top.className = "module-top";
    const name = document.createElement("span");
    name.className = "module-name";
    name.textContent = module.name;
    const pill = document.createElement("span");
    pill.className = "module-state";
    pill.textContent = on ? "On" : "Off";
    top.append(name, pill);
    const what = document.createElement("span");
    what.className = "module-what";
    what.textContent = module.what;
    toggle.append(top, what);
    toggle.addEventListener("click", () => {
      toggle.disabled = true;
      void setModule(module.id, !on).then(redraw);
    });

    // Said only for the exception. Every tile used to end "Automatic, from
    // your entities", which is the answer for nearly all of them and so told
    // nobody anything; what is worth a line is a module somebody has chosen
    // by hand, with the way back. The rest say it on hover.
    tile.title = chosen === undefined ? `Automatic, ${BASIS[module.basis]}` : "";
    tile.append(toggle);
    if (chosen !== undefined) {
      const foot = document.createElement("div");
      foot.className = "module-foot";
      const reset = document.createElement("button");
      reset.type = "button";
      reset.className = "link-button";
      reset.textContent = "Make automatic";
      reset.addEventListener("click", () => {
        void setModule(module.id, null).then(redraw);
      });
      foot.append("Chosen · ", reset);
      tile.append(foot);
    }
    if (opening && on && module.opens !== undefined) {
      const opens = module.opens;
      const go = document.createElement("button");
      go.type = "button";
      go.className = "small module-open";
      go.textContent = "Open";
      go.addEventListener("click", () => showPage(opens as PageName));
      tile.append(go);
    }
    const held = on ? null : (module.holds?.() ?? null);
    if (held !== null) {
      const warn = document.createElement("div");
      warn.className = "module-held";
      warn.textContent = `Off, but these books hold ${held}. Nothing is lost; it is only hidden.`;
      tile.append(warn);
    }
    grid.append(tile);
  }
  return grid;
}
