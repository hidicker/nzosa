import { record, reclassify, tripAccounts, tripsFor } from "../books.js";
import { state } from "../state.js";
import { savePart } from "../store.js";
import { amountCell, nameCell, note } from "../ui.js";
import { KILOMETRE_RATES, emptyEntityModel, emptyTripLog, isRental, ownersOf, totalKmFor, tripKm } from "@nzosa/core";
import type { Cents, Trip, TripLog, VehicleFuel } from "@nzosa/core";
import { taxYearEnd, taxYearStart } from "../tax-year.js";

/**
 * Trips to the rentals in the owners' own cars, and the year's claim for them.
 *
 * What is entered is the facts -- the vehicles, each trip, the odometer at
 * each 31 March -- and the claim and its journals are worked out from them
 * every time, in core, where Inland Revenue's rules are tested. Shown wherever
 * the year is being finished (Personal year end, Year-end adjustments), not on
 * a page of its own.
 */

const FUELS: { value: VehicleFuel; label: string }[] = [
  { value: "petrol", label: "Petrol" },
  { value: "diesel", label: "Diesel" },
  { value: "hybrid", label: "Petrol hybrid" },
  { value: "electric", label: "Electric" },
];

/** What the last trip added said, so the next one starts from it: most trips repeat. */
let lastTrip: Partial<Trip> = {};

function money(cents: Cents): string {
  return `$${(cents / 100).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const km = (n: number): string => `${(Math.round(n * 10) / 10).toLocaleString("en-NZ")} km`;

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function control<K extends keyof HTMLElementTagNameMap>(tag: K, label: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.setAttribute("aria-label", label);
  return element;
}

function options(pick: HTMLSelectElement, values: { value: string; label: string }[], chosen?: string): void {
  for (const one of values) {
    const option = document.createElement("option");
    option.value = one.value;
    option.textContent = one.label;
    option.selected = one.value === chosen;
    pick.append(option);
  }
}

async function saveTripLog(next: TripLog, what: string, after: () => void): Promise<void> {
  const before = state.ledger.tripLog ?? emptyTripLog();
  state.ledger = { ...state.ledger, tripLog: next };
  state.persistent = await savePart(state.ledger);
  await record("tripLog", what, before, next);
  reclassify();
  after();
}

/**
 * The vehicles the trips are made in, and each one's odometer at both ends of
 * the year: shared by every property, since Tier 1 runs out on the car's own
 * kilometres, whichever property the trips were for.
 */
export function vehiclesPanel(year: number, rerender: () => void): HTMLElement {
  const box = document.createElement("div");
  box.className = "vehicle-trips";
  const log = state.ledger.tripLog ?? emptyTripLog();
  const model = state.ledger.entities ?? emptyEntityModel();

  box.append(
    note(
      "Driving your own car to a rental -- to inspect it, meet a tradesperson or buy materials -- is " +
        "claimed at Inland Revenue's kilometre rates. Record each trip: the date, the property, the " +
        "kilometres and why. The rate replaces the car's running costs, so none of those are claimed " +
        "for these trips, and no GST is claimed on it, even for a GST-registered property.",
    ),
  );

  // --- vehicles ---------------------------------------------------------------
  const vehicles = document.createElement("div");
  vehicles.className = "page-actions";
  if (log.vehicles.length === 0) vehicles.append(note("No vehicles yet: add the car the trips are made in."));
  const vName = control("input", "Vehicle name");
  vName.placeholder = "e.g. Ana's Corolla";
  const vFuel = control("select", "Fuel");
  options(vFuel, FUELS, "petrol");
  const vOwner = control("select", "Owner");
  options(vOwner, [
    { value: "", label: "Whose car?" },
    ...ownersOf(model).map((n) => ({ value: n, label: n })),
    { value: "Both owners", label: "Both owners" },
    { value: "Someone else", label: "Someone else" },
  ]);
  const vAdd = document.createElement("button");
  vAdd.type = "button";
  vAdd.textContent = "Add vehicle";
  vAdd.addEventListener("click", () => {
    const name = vName.value.trim();
    if (name === "") {
      alert("Give the vehicle a name.");
      return;
    }
    const vehicle = {
      id: newId(),
      name,
      fuel: vFuel.value as VehicleFuel,
      ...(vOwner.value !== "" ? { owner: vOwner.value } : {}),
    };
    void saveTripLog({ ...log, vehicles: [...log.vehicles, vehicle] }, `Vehicle added: ${name}`, rerender);
  });
  vehicles.append(vName, vFuel, vOwner, vAdd);
  box.append(
    vehicles,
    note(
      "Whose name the car is in makes no difference to the claim: it goes to the property each trip was " +
        "for, shared by the property's owners. What matters is that the car's costs are borne by you -- " +
        "your car, one in both names, or one you pay to use. A car belonging to someone else, whose costs " +
        "you do not pay, is not your expense to claim.",
    ),
  );
  if (log.vehicles.length === 0) return box;

  // --- odometer at each end of the year ------------------------------------------
  const odo = document.createElement("table");
  odo.className = "report-table";
  odo.innerHTML =
    "<thead><tr><th>Vehicle</th><th>Fuel</th><th>Odometer 1 April</th><th>Odometer 31 March</th>" +
    "<th>Year's travel</th></tr></thead>";
  const odoBody = document.createElement("tbody");
  for (const vehicle of log.vehicles) {
    const held = log.years.find((y) => y.vehicleId === vehicle.id && y.year === year);
    const tr = document.createElement("tr");
    const reading = (which: "odometerStart" | "odometerEnd", label: string): HTMLTableCellElement => {
      const cell = document.createElement("td");
      const box_ = control("input", label);
      box_.type = "number";
      box_.min = "0";
      box_.value = held?.[which] !== undefined ? String(held[which]) : "";
      box_.addEventListener("change", () => {
        const value = box_.value.trim() === "" ? undefined : Number(box_.value);
        if (value !== undefined && !(value >= 0)) return;
        const rest = log.years.filter((y) => !(y.vehicleId === vehicle.id && y.year === year));
        const next = { ...(held ?? { vehicleId: vehicle.id, year }) };
        if (value === undefined) delete next[which];
        else next[which] = value;
        void saveTripLog({ ...log, years: [...rest, next] }, `Odometer for ${vehicle.name}, ${year}`, rerender);
      });
      cell.append(box_);
      return cell;
    };
    const total = totalKmFor(log, vehicle.id, year);
    tr.append(
      nameCell(vehicle.name + (vehicle.owner ? ` (${vehicle.owner})` : "")),
      nameCell(FUELS.find((f) => f.value === vehicle.fuel)?.label ?? vehicle.fuel),
      reading("odometerStart", `${vehicle.name} odometer at 1 April ${year - 1}`),
      reading("odometerEnd", `${vehicle.name} odometer at 31 March ${year}`),
      amountCell(total === null ? "not entered" : km(total)),
    );
    odoBody.append(tr);
  }
  odo.append(odoBody);
  const odoWrap = document.createElement("div");
  odoWrap.className = "table-scroll";
  odoWrap.append(odo);
  box.append(odoWrap);
  return box;
}

/**
 * The trips panel for one income year: every property's, or -- given `only` --
 * one property's trips and its share of the claim, as Rental year end shows
 * them under each property. `rerender` redraws whichever page holds it.
 */
export function tripsPanel(year: number, rerender: () => void, only?: string): HTMLElement {
  const box = document.createElement("div");
  box.className = "vehicle-trips";
  const log = state.ledger.tripLog ?? emptyTripLog();
  const model = state.ledger.entities ?? emptyEntityModel();
  const rentals = model.entities.filter(isRental).filter((e) => only === undefined || e.id === only);
  const nameOf = (entityId: string): string => model.entities.find((e) => e.id === entityId)?.name ?? entityId;
  const from = taxYearStart(year);
  const to = taxYearEnd(year);

  if (only === undefined) box.append(vehiclesPanel(year, rerender));
  if (log.vehicles.length === 0) {
    if (only !== undefined) box.append(note("Add the car the trips are made in under Vehicles, above."));
    return box;
  }

  // --- the year's trips ----------------------------------------------------------
  const trips = log.trips
    .filter((t) => t.date >= from && t.date <= to && (only === undefined || t.entityId === only))
    .sort((a, b) => a.date.localeCompare(b.date));
  const table = document.createElement("table");
  table.className = "report-table";
  table.innerHTML =
    "<thead><tr><th>Date</th><th>Vehicle</th>" +
    (only === undefined ? "<th>Property</th>" : "") +
    "<th>From – to</th><th>Purpose</th><th>Km</th><th></th></tr></thead>";
  const tbody = document.createElement("tbody");
  for (const trip of trips) {
    const tr = document.createElement("tr");
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => {
      void saveTripLog(
        { ...log, trips: log.trips.filter((t) => t.id !== trip.id) },
        `Trip removed: ${trip.date} ${nameOf(trip.entityId)}`,
        rerender,
      );
    });
    const cell = document.createElement("td");
    cell.append(remove);
    tr.append(
      nameCell(trip.date),
      nameCell(log.vehicles.find((v) => v.id === trip.vehicleId)?.name ?? "?"),
      ...(only === undefined ? [nameCell(nameOf(trip.entityId))] : []),
      nameCell([trip.from, trip.to].filter(Boolean).join(" – ")),
      nameCell(trip.purpose),
      amountCell(trip.returnTrip === true ? `${trip.km} × 2 = ${tripKm(trip)}` : String(trip.km)),
      cell,
    );
    tbody.append(tr);
  }

  // The next trip, starting from the last one: a form beside the table, so it
  // wraps on a narrow screen rather than pushing the table off the side.
  const add = document.createElement("div");
  add.className = "page-actions";
  const date = control("input", "Trip date");
  date.type = "date";
  date.min = from;
  date.max = to;
  date.value = lastTrip.date !== undefined && lastTrip.date >= from && lastTrip.date <= to ? lastTrip.date : "";
  const vehicle = control("select", "Vehicle");
  options(vehicle, log.vehicles.map((v) => ({ value: v.id, label: v.name })), lastTrip.vehicleId);
  const property = control("select", "Property");
  options(property, rentals.map((e) => ({ value: e.id, label: e.name })), only ?? lastTrip.entityId);
  property.hidden = only !== undefined;
  const fromBox = control("input", "From");
  fromBox.placeholder = "From";
  fromBox.value = lastTrip.from ?? "";
  const toBox = control("input", "To");
  toBox.placeholder = "To";
  toBox.value = lastTrip.to ?? "";
  const purpose = control("input", "Purpose");
  purpose.placeholder = "Why: inspection, tradesperson…";
  purpose.value = lastTrip.purpose ?? "";
  const kmBox = control("input", "Kilometres");
  kmBox.type = "number";
  kmBox.min = "0";
  kmBox.step = "0.1";
  kmBox.value = lastTrip.km !== undefined ? String(lastTrip.km) : "";
  const back = control("input", "There and back");
  back.type = "checkbox";
  back.checked = lastTrip.returnTrip ?? true;
  const backLabel = document.createElement("label");
  backLabel.append(back, " return");
  const save = document.createElement("button");
  save.type = "button";
  save.textContent = "Add trip";
  save.addEventListener("click", () => {
    const distance = Number(kmBox.value);
    const problems = [
      date.value === "" ? "the date" : "",
      vehicle.value === "" ? "the vehicle" : "",
      property.value === "" ? "the property" : "",
      !(distance > 0) ? "the kilometres" : "",
      purpose.value.trim() === "" ? "why the trip was made" : "",
    ].filter(Boolean);
    if (problems.length > 0) {
      alert(`Fill in ${problems.join(", ")}. Inland Revenue expects each trip's purpose to be recorded.`);
      return;
    }
    const trip: Trip = {
      id: newId(),
      vehicleId: vehicle.value,
      date: date.value as Trip["date"],
      entityId: property.value,
      km: distance,
      purpose: purpose.value.trim(),
      ...(back.checked ? { returnTrip: true } : {}),
      ...(fromBox.value.trim() !== "" ? { from: fromBox.value.trim() } : {}),
      ...(toBox.value.trim() !== "" ? { to: toBox.value.trim() } : {}),
    };
    lastTrip = trip;
    void saveTripLog({ ...log, trips: [...log.trips, trip] }, `Trip: ${trip.date} ${nameOf(trip.entityId)}`, rerender);
  });
  kmBox.placeholder = "Km";
  add.append(date, vehicle, property, fromBox, toBox, purpose, kmBox, backLabel, save);
  table.append(tbody);
  if (rentals.length === 0) {
    box.append(note("No rental properties in these books, so there is nothing to claim trips against."));
    return box;
  }
  const wrap = document.createElement("div");
  wrap.className = "table-scroll";
  wrap.append(table);
  if (trips.length > 0) box.append(wrap);
  box.append(add);

  // --- the claim ----------------------------------------------------------------------
  const { claims, journals, notes } = tripsFor(year);
  if (claims.length === 0) {
    box.append(note(`No trips entered for the year to 31 March ${year}.`));
    return box;
  }
  if (only !== undefined) {
    // This property's share of each vehicle's claim, and its journal.
    const mine = claims.flatMap((c) => c.byEntity.filter((e) => e.entityId === only).map((e) => ({ claim: c, part: e })));
    if (mine.length === 0) {
      box.append(note(`No trips to ${nameOf(only)} entered for the year to 31 March ${year}.`));
      return box;
    }
    for (const { claim, part } of mine) {
      const rates = claim.rates ?? KILOMETRE_RATES[year]?.[claim.vehicle.fuel];
      box.append(
        note(
          `${claim.vehicle.name}: ${km(part.km)} to ${nameOf(only)}` +
            (rates !== undefined ? ` at Inland Revenue's ${year} rates (${rates.tier1}c Tier 1, ${rates.tier2}c Tier 2)` : "") +
            ` = ${money(part.claim)}` +
            (claim.byEntity.length > 1 ? `, its share of the car's ${money(claim.claim)} for all the trips.` : "."),
        ),
      );
      for (const said of claim.notes) box.append(note(said));
    }
    const journal = journals.find((j) => j.transactionId === `trips:${only}:${year}`);
    const [debit, credit] = journal?.lines ?? [];
    if (debit !== undefined && credit !== undefined) {
      box.append(
        note(
          `Posted at ${journal?.date}: ${money(debit.amount)} to ${debit.accountCode} ${debit.accountName}, ` +
            `from ${credit.accountCode} ${credit.accountName} (paid by the owner).`,
        ),
      );
    } else if (tripAccounts(only) === null) {
      box.append(note(`Add a Travel account (493) and a Funds introduced account (970) for ${nameOf(only)} to post its claim.`));
    }
    return box;
  }
  for (const claim of claims) {
    const rates = claim.rates ?? KILOMETRE_RATES[year]?.[claim.vehicle.fuel];
    box.append(
      note(
        `${claim.vehicle.name}: ${km(claim.businessKm)} of trips` +
          (claim.totalKm !== null ? ` out of ${km(claim.totalKm)} travelled in the year` : "") +
          (rates !== undefined
            ? `; ${km(claim.tier1Km)} at ${rates.tier1}c (Tier 1)` +
              (claim.tier2Km > 0 ? ` and ${km(claim.tier2Km)} at ${rates.tier2}c (Tier 2)` : "")
            : "") +
          ` = ${money(claim.claim)}. ` +
          claim.byEntity.map((e) => `${nameOf(e.entityId)} ${km(e.km)}, ${money(e.claim)}`).join("; ") +
          ".",
      ),
    );
    for (const said of claim.notes) box.append(note(said));
  }
  for (const said of notes) box.append(note(said));
  for (const journal of journals) {
    const [debit, credit] = journal.lines;
    if (debit === undefined || credit === undefined) continue;
    box.append(
      note(
        `Posted at ${journal.date}: ${money(debit.amount)} to ${debit.accountCode} ${debit.accountName}, ` +
          `from ${credit.accountCode} ${credit.accountName} (paid by the owner).`,
      ),
    );
  }
  const unposted = claims.flatMap((c) => c.byEntity).filter((e) => e.claim !== 0 && tripAccounts(e.entityId) === null);
  if (unposted.length > 0) {
    box.append(
      note(
        "Add a Travel account (493) and a Funds introduced account (970) for " +
          [...new Set(unposted.map((e) => nameOf(e.entityId)))].join(", ") +
          " on Chart of accounts to post its claim.",
      ),
    );
  }
  return box;
}

/** Whether the year's trips are all there is to say: entered, with each vehicle's odometer. */
export function tripsStatus(year: number): { trips: number; missingOdometer: number } {
  const log = state.ledger.tripLog ?? emptyTripLog();
  const trips = log.trips.filter((t) => t.date >= taxYearStart(year) && t.date <= taxYearEnd(year));
  const used = new Set(trips.map((t) => t.vehicleId));
  const missingOdometer = [...used].filter((id) => totalKmFor(log, id, year) === null).length;
  return { trips: trips.length, missingOdometer };
}
