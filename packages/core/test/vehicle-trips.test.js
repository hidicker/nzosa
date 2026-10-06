import test from "node:test";
import assert from "node:assert/strict";
import { KILOMETRE_RATES, incomeYearOf, totalKmFor, tripClaims, tripJournals, tripKm } from "../dist/index.js";

const car = { id: "car", name: "Corolla", fuel: "petrol" };
const trip = (date, entityId, km, extra = {}) => ({
  id: `${date}:${entityId}`,
  vehicleId: "car",
  date,
  entityId,
  km,
  purpose: "Inspection",
  ...extra,
});

test("2024-25 and earlier kilometre rates are as Inland Revenue published them", () => {
  assert.deepEqual(KILOMETRE_RATES[2025].petrol, { tier1: 117, tier2: 37 });
  assert.deepEqual(KILOMETRE_RATES[2025].diesel, { tier1: 126, tier2: 35 });
  assert.deepEqual(KILOMETRE_RATES[2024].electric, { tier1: 104, tier2: 12 });
  assert.deepEqual(KILOMETRE_RATES[2023].hybrid, { tier1: 95, tier2: 20 });
});

test("a return trip counts both ways, and the year a date falls in", () => {
  assert.equal(tripKm(trip("2025-06-01", "ms", 40, { returnTrip: true })), 80);
  assert.equal(incomeYearOf("2025-03-31"), 2025);
  assert.equal(incomeYearOf("2025-04-01"), 2026);
});

test("total travel within 14,000 km: every business km at Tier 1", () => {
  const log = {
    vehicles: [car],
    trips: [trip("2025-05-01", "ms", 100, { returnTrip: true }), trip("2025-09-01", "fa", 50)],
    years: [{ vehicleId: "car", year: 2026, odometerStart: 50_000, odometerEnd: 60_000 }],
  };
  const [claim] = tripClaims(log, 2026);
  assert.equal(claim.businessKm, 250);
  assert.equal(claim.totalKm, 10_000);
  assert.equal(claim.claim, 250 * 120);
  assert.deepEqual(
    claim.byEntity.map((e) => [e.entityId, e.km, e.claim]),
    [["fa", 50, 6_000], ["ms", 200, 24_000]],
  );
});

test("total travel over 14,000 km: Inland Revenue's example one, the business share of each tier", () => {
  // OS 19/04a example one: 60% business of 20,000 km at the 2018-19 rates.
  const log = {
    vehicles: [car],
    trips: [trip("2018-06-01", "ms", 12_000)],
    years: [{ vehicleId: "car", year: 2019, totalKm: 20_000 }],
  };
  const [claim] = tripClaims(log, 2019, () => ({ tier1: 79, tier2: 30 }));
  assert.equal(claim.claim, 771_600); // $6,636 + $1,080
});

test("without the year's total, Tier 1 is assumed and said", () => {
  const log = { vehicles: [car], trips: [trip("2025-05-01", "ms", 100)], years: [] };
  const [claim] = tripClaims(log, 2026);
  assert.equal(claim.totalKm, null);
  assert.equal(claim.claim, 12_000);
  assert.match(claim.notes.join(" "), /odometer/);
});

test("no rates published yet: nothing claimed, and said", () => {
  const log = { vehicles: [car], trips: [trip("2026-05-01", "ms", 100)], years: [] };
  const [claim] = tripClaims(log, 2027);
  assert.equal(claim.claim, 0);
  assert.match(claim.notes.join(" "), /not published/);
});

test("trips outside the year are left out; a trip total over the odometer's is used and flagged", () => {
  const log = {
    vehicles: [car],
    trips: [trip("2025-03-31", "ms", 999), trip("2025-04-01", "ms", 300)],
    years: [{ vehicleId: "car", year: 2026, totalKm: 200 }],
  };
  const [claim] = tripClaims(log, 2026);
  assert.equal(claim.businessKm, 300);
  assert.equal(claim.totalKm, 300);
  assert.match(claim.notes.join(" "), /more than/);
  assert.equal(totalKmFor(log, "car", 2026), 200);
});

test("journals: Travel debited, funds introduced credited, no GST, balanced", () => {
  const log = {
    vehicles: [car],
    trips: [trip("2025-05-01", "ls", 100), trip("2025-05-02", "ms", 50)],
    years: [{ vehicleId: "car", year: 2026, totalKm: 5_000 }],
  };
  const accounts = (id) =>
    id === "nowhere"
      ? null
      : { travel: { code: `493${id.toUpperCase()}`, name: "Travel" }, counter: { code: `970${id.toUpperCase()}`, name: "Funds introduced" } };
  const { journals, notes } = tripJournals(tripClaims(log, 2026), accounts);
  assert.equal(notes.length, 0);
  assert.equal(journals.length, 2);
  const ls = journals.find((j) => j.transactionId === "trips:ls:2026");
  assert.equal(ls.date, "2026-03-31");
  assert.equal(ls.source, "adjustment");
  assert.deepEqual(ls.lines.map((l) => [l.accountCode, l.amount, l.taxType]), [["493LS", 12_000], ["970LS", -12_000]].map(([c, a]) => [c, a, "NONE"]));
  for (const j of journals) assert.equal(j.lines.reduce((s, l) => s + l.amount, 0), 0);
});
