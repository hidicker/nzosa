import type { IsoDate } from "./dates.js";
import type { Cents } from "./money.js";
import type { PostedJournal } from "./posting.js";
import { KILOMETRE_RATES } from "./year-end-adjustments.js";
import type { VehicleFuel } from "./year-end-adjustments.js";

/**
 * Trips in a private vehicle, claimed at Inland Revenue's kilometre rates.
 *
 * The case is an owner driving their own car to look after a rental: the car
 * is not in the books, so there are no running costs to take a private share
 * out of -- the claim is the business kilometres at the rates, and nothing
 * else. Inland Revenue's statement on the rates (OS 19/04a) names rental
 * property owners among those who may use them.
 *
 * The rules this follows, from that statement:
 *
 * - Tier 1 is for the business share of the first 14,000 km the vehicle
 *   travels in the income year, business and private together; Tier 2 for the
 *   business share of the rest. So the year's total matters, and the
 *   statement asks for the odometer to be read at every balance date.
 * - The rates are GST-inclusive and no GST can be claimed on them, even by a
 *   GST-registered property.
 * - The rates replace the vehicle's actual costs and depreciation; one method
 *   for as long as the vehicle is owned.
 *
 * Each trip names the property it was for, and the year's claim for a vehicle
 * is shared among the properties by their kilometres. A property's share is
 * posted as a journal at the balance date: its Travel account debited, and the
 * owners' funds introduced credited -- the owner paid for the car, not the
 * property's bank account.
 */

export interface Vehicle {
  id: string;
  /** What the owner calls it: "Ana's Corolla". */
  name: string;
  fuel: VehicleFuel;
  /** Whose it is, for the owner's own reference. */
  owner?: string;
}

export interface Trip {
  id: string;
  vehicleId: string;
  date: IsoDate;
  /** The property the trip was for. */
  entityId: string;
  /** Kilometres one way, or the whole trip when `returnTrip` is not set. */
  km: number;
  /** There and back: the kilometres count twice. */
  returnTrip?: boolean;
  from?: string;
  to?: string;
  /** Why the trip was made: an inspection, meeting a tradesperson. */
  purpose: string;
}

/** A vehicle's odometer for a year, read at each end, or its total travel. */
export interface VehicleYear {
  vehicleId: string;
  /** The income year, named by the 31 March it ends on. */
  year: number;
  /** The year's travel, business and private, where the readings are not. */
  totalKm?: number;
  odometerStart?: number;
  odometerEnd?: number;
}

export interface TripLog {
  vehicles: Vehicle[];
  trips: Trip[];
  years: VehicleYear[];
}

export const emptyTripLog = (): TripLog => ({ vehicles: [], trips: [], years: [] });

const TIER_ONE_KM = 14_000;

const yearStart = (year: number): IsoDate => `${year - 1}-04-01`;
const yearEnd = (year: number): IsoDate => `${year}-03-31`;

/** The income year a date falls in, named by the 31 March it ends on. */
export function incomeYearOf(date: IsoDate): number {
  return Number(date.slice(0, 4)) + (date.slice(5) > "03-31" ? 1 : 0);
}

/** A trip's kilometres, there and back where it was a return trip. */
export const tripKm = (trip: Trip): number => trip.km * (trip.returnTrip === true ? 2 : 1);

/** The vehicle's total travel in the year, from the odometer or as entered; null when unknown. */
export function totalKmFor(log: TripLog, vehicleId: string, year: number): number | null {
  const held = log.years.find((y) => y.vehicleId === vehicleId && y.year === year);
  if (held === undefined) return null;
  if (held.odometerStart !== undefined && held.odometerEnd !== undefined && held.odometerEnd >= held.odometerStart) {
    return held.odometerEnd - held.odometerStart;
  }
  return held.totalKm ?? null;
}

export interface TripClaim {
  vehicle: Vehicle;
  year: number;
  businessKm: number;
  /** The vehicle's whole travel in the year; null when not entered. */
  totalKm: number | null;
  rates: { tier1: number; tier2: number } | null;
  tier1Km: number;
  tier2Km: number;
  /** The year's claim for the vehicle, in cents. */
  claim: Cents;
  /** The claim shared among the properties by their kilometres. */
  byEntity: { entityId: string; km: number; claim: Cents }[];
  notes: string[];
}

/**
 * The year's kilometre-rate claim for each vehicle with trips in it.
 *
 * With the year's total known, the business share of the first 14,000 km is
 * at Tier 1 and the business share of the rest at Tier 2, as Inland Revenue's
 * example works it. Without it, the business kilometres up to 14,000 are put
 * at Tier 1 -- right only if the car went no further than that in the year --
 * and a note says so.
 */
export function tripClaims(
  log: TripLog,
  year: number,
  ratesFor: (year: number, fuel: VehicleFuel) => { tier1: number; tier2: number } | undefined = (y, fuel) =>
    KILOMETRE_RATES[y]?.[fuel],
): TripClaim[] {
  const from = yearStart(year);
  const to = yearEnd(year);
  const out: TripClaim[] = [];

  for (const vehicle of log.vehicles) {
    const trips = log.trips.filter((t) => t.vehicleId === vehicle.id && t.date >= from && t.date <= to);
    if (trips.length === 0) continue;
    const notes: string[] = [];

    const kmByEntity = new Map<string, number>();
    for (const trip of trips) kmByEntity.set(trip.entityId, (kmByEntity.get(trip.entityId) ?? 0) + tripKm(trip));
    const businessKm = [...kmByEntity.values()].reduce((sum, km) => sum + km, 0);

    let totalKm = totalKmFor(log, vehicle.id, year);
    if (totalKm !== null && businessKm > totalKm) {
      notes.push(
        `The trips come to ${businessKm.toLocaleString("en-NZ")} km, more than the ` +
          `${totalKm.toLocaleString("en-NZ")} km the vehicle travelled in the year. Check the ` +
          "odometer readings; the trips are used as the total until then.",
      );
      totalKm = businessKm;
    }

    let tier1Km: number;
    let tier2Km: number;
    if (totalKm !== null && totalKm > 0) {
      const share = businessKm / totalKm;
      tier1Km = Math.min(totalKm, TIER_ONE_KM) * share;
      tier2Km = Math.max(0, totalKm - TIER_ONE_KM) * share;
    } else {
      tier1Km = Math.min(businessKm, TIER_ONE_KM);
      tier2Km = businessKm - tier1Km;
      notes.push(
        "The vehicle's total travel for the year is not entered, so the trips are all put at the " +
          "Tier 1 rate, as if the car went no more than 14,000 km in the year. Inland Revenue asks " +
          "for the odometer to be read at each 31 March: enter the readings to be sure.",
      );
    }

    const rates = ratesFor(year, vehicle.fuel) ?? null;
    let claim = 0;
    if (rates === null) {
      notes.push(
        `Inland Revenue has not published kilometre rates for the year to 31 March ${year} yet ` +
          "(they come out after the year ends), so nothing is claimed until they are added.",
      );
    } else {
      claim = Math.round(tier1Km * rates.tier1 + tier2Km * rates.tier2);
    }

    // Shared by kilometres, the last property taking the rounding.
    const entries = [...kmByEntity.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    let given = 0;
    const byEntity = entries.map(([entityId, km], index) => {
      const share = index === entries.length - 1 ? claim - given : Math.round((claim * km) / businessKm);
      given += share;
      return { entityId, km, claim: share };
    });

    out.push({ vehicle, year, businessKm, totalKm, rates, tier1Km, tier2Km, claim, byEntity, notes });
  }
  return out;
}

/** The accounts a property's claim posts to. */
export interface TripAccounts {
  travel: { code: string; name: string };
  /** The owners' funds introduced: the owner paid for the car. */
  counter: { code: string; name: string };
}

/**
 * The year's journals for the claims, one per property: Travel debited, funds
 * introduced credited, dated at the balance date. No GST on either side.
 * A property with no accounts to post to is left out, and said so.
 */
export function tripJournals(
  claims: readonly TripClaim[],
  accountsFor: (entityId: string) => TripAccounts | null,
): { journals: PostedJournal[]; notes: string[] } {
  const notes: string[] = [];
  const byEntity = new Map<string, { km: number; claim: Cents; year: number }>();
  for (const one of claims) {
    for (const part of one.byEntity) {
      const held = byEntity.get(part.entityId) ?? { km: 0, claim: 0, year: one.year };
      held.km += part.km;
      held.claim += part.claim;
      byEntity.set(part.entityId, held);
    }
  }

  const journals: PostedJournal[] = [];
  for (const [entityId, { km, claim, year }] of [...byEntity.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (claim === 0) continue;
    const accounts = accountsFor(entityId);
    if (accounts === null) {
      notes.push(`No Travel or funds introduced account for ${entityId}, so its vehicle claim is not posted.`);
      continue;
    }
    const said = `Vehicle trips, ${km.toLocaleString("en-NZ")} km at Inland Revenue's kilometre rates`;
    journals.push({
      transactionId: `trips:${entityId}:${year}`,
      date: yearEnd(year),
      narration: `${said}, year to ${yearEnd(year)}`,
      source: "adjustment",
      taxBasis: "both",
      lines: [
        { accountCode: accounts.travel.code, accountName: accounts.travel.name, amount: claim, taxType: "NONE", description: said },
        {
          accountCode: accounts.counter.code,
          accountName: accounts.counter.name,
          amount: -claim,
          taxType: "NONE",
          description: "Paid by the owner, in their own vehicle",
        },
      ],
    });
  }
  return { journals, notes };
}
