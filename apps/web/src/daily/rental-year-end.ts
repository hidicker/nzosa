import { showPage } from "../app.js";
import { bookYears } from "../books.js";
import { $, state } from "../state.js";
import { amountCell, nameCell, note } from "../ui.js";
import { emptyEntityModel, isRental } from "@nzosa/core";
import type { Cents, Entity } from "@nzosa/core";
import { renderAgentStatements, rentalSchedulesFor } from "./reports.js";
import { tripsPanel, tripsStatus, vehiclesPanel } from "./vehicle-trips-panel.js";
import { taxYearEnd, taxYearEndSaid } from "../tax-year.js";
import { booksLocale } from "../country.js";

/**
 * Each rental's year end, property by property.
 *
 * What a property's year needs beyond its bank lines: the property manager's
 * statements, which turn the rent paid out into the rent collected and the
 * fees and repairs taken from it, and the trips made to it in the owners' own
 * cars. Its schedule for the year sits at the top, so what each one adds can
 * be seen landing. The people's returns, on Personal year end, then take each
 * owner's share of what is here.
 */

let chosenYear: number | undefined;
/** Which properties are open, so saving a trip does not fold the page up. */
const opened = new Set<string>();
let vehiclesOpen = false;

function money(cents: Cents): string {
  const text = (Math.abs(cents) / 100).toLocaleString(booksLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return cents < 0 ? `(${text})` : text;
}

function link(label: string, page: string): HTMLButtonElement {
  const go = document.createElement("button");
  go.type = "button";
  go.className = "link-button";
  go.textContent = label;
  go.addEventListener("click", () => showPage(page));
  return go;
}

function ownersSaid(entity: Entity): string {
  const owners = entity.owners ?? [];
  return owners.length === 0 ? "no owners set" : owners.map((o) => `${o.name} ${o.percent}%`).join(", ");
}

/** The property's schedule for the year: income, expenses and net. */
function scheduleTable(entity: Entity, year: number): HTMLElement {
  const found = rentalSchedulesFor(year, false).find((s) => s.entity.id === entity.id);
  if (found === undefined) return note("Nothing posted to this property in the year yet.");
  const { now } = found;
  const table = document.createElement("table");
  table.className = "report-table";
  const body = document.createElement("tbody");
  const row = (name: string, amount: Cents | null, strong = false): void => {
    const tr = document.createElement("tr");
    const cell = nameCell(name);
    const figure = amountCell(amount === null ? "" : money(amount));
    if (strong) {
      cell.style.fontWeight = "600";
      figure.style.fontWeight = "600";
    }
    tr.append(cell, figure);
    body.append(tr);
  };
  for (const line of now.income) row(line.name, line.amount);
  row("Total income", now.totalIncome, true);
  for (const line of now.expenses) row(line.name, line.amount);
  row("Total expenses", now.totalExpenses, true);
  row("Net rental income", now.net, true);
  table.append(body);
  const wrap = document.createElement("div");
  wrap.className = "table-scroll";
  wrap.append(table);
  return wrap;
}

/**
 * The cars the trips are made in, with their odometer readings. The same cars
 * under every property: Tier 1 runs out on a car's own kilometres, whichever
 * property each trip was for, so they are entered once and shown in each.
 */
function vehiclesBox(year: number): HTMLElement {
  const status = tripsStatus(year);
  const fleet = state.ledger.tripLog?.vehicles.length ?? 0;
  const box = document.createElement("details");
  box.open = vehiclesOpen;
  box.addEventListener("toggle", () => {
    vehiclesOpen = box.open;
  });
  const summary = document.createElement("summary");
  summary.textContent =
    fleet === 0
      ? "Vehicles: none yet"
      : `Vehicles: ${state.ledger.tripLog?.vehicles.map((v) => v.name).join(", ")}` +
        (status.missingOdometer > 0 ? ` -- ${status.missingOdometer} without the year's odometer readings` : "");
  box.append(summary, vehiclesPanel(year, renderRentalYearEnd));
  return box;
}

export function renderRentalYearEnd(): void {
  const body = $("rentalyear-body");
  body.textContent = "";
  const model = state.ledger.entities ?? emptyEntityModel();
  const rentals = model.entities.filter(isRental);
  if (rentals.length === 0) {
    body.append(
      note(
        "No rental properties yet. On Entities & accounts, give each property an entity of its own, " +
          "residential or commercial, with its owners.",
      ),
      link("Entities & accounts", "entities"),
    );
    return;
  }
  const years = bookYears();
  if (years.length === 0) {
    body.append(note("No transactions yet, so there is no year to finish."));
    return;
  }
  // The latest year that has ended, by default: the one whose returns are due.
  const today = new Date().toISOString().slice(0, 10);
  const ended = years.filter((y) => taxYearEnd(y) < today);
  if (chosenYear === undefined || !years.includes(chosenYear)) chosenYear = ended[0] ?? years[0];
  const year = chosenYear ?? years[0] ?? 0;

  const pick = document.createElement("div");
  pick.className = "page-actions";
  const yearSelect = document.createElement("select");
  yearSelect.setAttribute("aria-label", "Year");
  for (const y of years) {
    const option = document.createElement("option");
    option.value = String(y);
    option.textContent = `Year to ${taxYearEndSaid(y)}`;
    option.selected = y === year;
    yearSelect.append(option);
  }
  yearSelect.addEventListener("change", () => {
    chosenYear = Number(yearSelect.value);
    renderRentalYearEnd();
  });
  pick.append(yearSelect);
  body.append(pick);

  for (const entity of rentals) {
    const section = document.createElement("details");
    section.className = "rental-year";
    section.open = opened.has(entity.id);
    section.addEventListener("toggle", () => {
      if (section.open) opened.add(entity.id);
      else opened.delete(entity.id);
    });
    // The property's name as the heading it is, the owners and the year's net beside it.
    const summary = document.createElement("summary");
    const net = rentalSchedulesFor(year, false).find((s) => s.entity.id === entity.id)?.now.net;
    const name = document.createElement("span");
    name.className = "rental-year-name";
    name.textContent = entity.name;
    const meta = document.createElement("span");
    meta.className = "rental-year-meta";
    meta.textContent = ownersSaid(entity) + (net === undefined ? "" : ` · net rental income ${money(net)}`);
    summary.append(name, meta);
    section.append(summary, scheduleTable(entity, year));

    const statements = document.createElement("div");
    renderAgentStatements(statements, year, { entity: entity.id, redraw: renderRentalYearEnd });
    section.append(statements);

    section.append(vehiclesBox(year));
    const trips = document.createElement("h4");
    trips.textContent = "Trips to the property in your own vehicle";
    section.append(trips, tripsPanel(year, renderRentalYearEnd, entity.id));
    body.append(section);
  }
}
