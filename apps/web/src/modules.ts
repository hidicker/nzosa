import { record } from "./books.js";
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
  | "assets";

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
    id: "rentals",
    countries: ["nz"],
    name: "Rentals",
    what: "Rental year end, rental information, property manager statements and rental schedules.",
    basis: "entities",
    inferred: () => entities().some((e) => e.kind === "residential" || e.kind === "commercial"),
  },
  {
    id: "personal",
    countries: ["nz"],
    name: "Personal",
    what: "Personal year end and each person's IR3.",
    basis: "entities",
    inferred: () => entities().some((e) => e.kind === "personal"),
  },
  {
    id: "business",
    name: "Business",
    what: "Invoices, money owed to you, the IR10 and prepayments.",
    basis: "entities",
    inferred: () => businesses().length > 0,
    holds: () => count((state.ledger.invoices ?? []).length, "invoice"),
  },
  {
    id: "company",
    name: "Company",
    what: "Shareholders and their current accounts, and bills.",
    basis: "entities",
    inferred: () =>
      businesses().some((e) => e.structure === undefined || e.structure === "company") ||
      entities().some((e) => (e.shareholders ?? []).length > 0),
  },
  {
    id: "gst",
    countries: ["nz"],
    name: "GST",
    what: "GST returns, and reconciling them with what was filed.",
    basis: "entities",
    inferred: () => entities().some((e) => e.gstRegistered === true),
  },
  {
    id: "xero",
    name: "Xero import and check",
    what: "Bringing books across from Xero, and checking these against it.",
    basis: "source",
    inferred: () => source() === "xero" || xeroHeld(),
  },
  {
    id: "sheet",
    name: "Spreadsheet import",
    what: "Bringing in a coded spreadsheet, and checking these books' coding against it.",
    basis: "source",
    inferred: () => source() === "sheet" || (state.ledger.reference ?? state.reference).length > 0,
  },
  {
    id: "payroll",
    countries: ["nz"],
    name: "Payroll",
    what: "Employees, pay runs, PAYE and employer filing.",
    basis: "data",
    inferred: () => (state.ledger.payroll?.employees ?? []).length > 0,
    holds: () => count((state.ledger.payroll?.employees ?? []).length, "employee"),
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
    name: "Fixed assets",
    what: "The asset register and depreciation.",
    basis: "data",
    inferred: () => (state.ledger.assets ?? []).length > 0 || businesses().length > 0,
    holds: () => count((state.ledger.assets ?? []).length, "asset"),
  },
];

/** The modules Start here asks about: the ones nothing else answers. */
export const ASKED: readonly ModuleId[] = ["payroll", "vehicle", "assets", "business"];

const info = (id: ModuleId): ModuleInfo | undefined => MODULES.find((m) => m.id === id);

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
 * Xero being off, for the words that take its place.
 */
export function anyModuleOn(list: string): boolean {
  return list
    .split(/\s+/)
    .filter(Boolean)
    .some((id) => (id.startsWith("!") ? !moduleOn(id.slice(1) as ModuleId) : moduleOn(id as ModuleId)));
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
}

/** How these books came, in words for a sentence: "Xero", "your spreadsheet". */
export function previousSystem(): string {
  if (moduleOn("xero")) return "Xero";
  if (moduleOn("sheet")) return "your spreadsheet";
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
export function modulesPanel(redraw: () => void, only?: readonly ModuleId[]): HTMLElement {
  const grid = document.createElement("div");
  grid.className = "module-tiles";
  for (const module of MODULES.filter((m) => only === undefined || only.includes(m.id))) {
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

    const foot = document.createElement("div");
    foot.className = "module-foot";
    foot.append(chosen === undefined ? `Automatic, ${BASIS[module.basis]}` : "Chosen");
    if (chosen !== undefined) {
      const reset = document.createElement("button");
      reset.type = "button";
      reset.className = "link-button";
      reset.textContent = "Make automatic";
      reset.addEventListener("click", () => {
        void setModule(module.id, null).then(redraw);
      });
      foot.append(" · ", reset);
    }
    tile.append(toggle, foot);
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
