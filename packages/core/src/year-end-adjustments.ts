import type { IsoDate } from "./dates.js";
import type { Cents } from "./money.js";
import type { PostedJournal, PostedLine } from "./posting.js";

/**
 * Year-end adjustments: the private use of a vehicle, and prepayments.
 *
 * Both are corrections made once a year to what the bank lines posted, and
 * both are made the way an accountant makes them -- as a journal dated at the
 * balance date -- rather than by changing how any transaction posts. Every
 * coding in these books posts exactly as it did before; these journals are
 * added beside them, derived each time from what was entered, so changing a
 * percentage or a date can never leave an old journal behind. That is the same
 * rule depreciation already follows.
 */

const GST_NUMERATOR = 3;
const GST_DENOMINATOR = 23;
const gstIn = (inclusive: Cents): Cents => Math.round((inclusive * GST_NUMERATOR) / GST_DENOMINATOR);

const yearStart = (year: number): IsoDate => `${year - 1}-04-01`;
const yearEnd = (year: number): IsoDate => `${year}-03-31`;

function dayNumber(date: IsoDate): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

function addMonths(date: IsoDate, months: number): IsoDate {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1 + months, d));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

function addYears(date: IsoDate, years: number): IsoDate {
  return addMonths(date, years * 12);
}

// --- vehicles -----------------------------------------------------------------

/**
 * How much a vehicle is used for the business, for one entity and one year.
 *
 * For a sole trader, partnership or trust. A company's vehicles used
 * privately by its shareholder-employees are a fringe benefit, and Inland
 * Revenue's GST guide is plain that "companies and employers registered for
 * FBT do not need to make a private use adjustment" -- so this is not for them.
 */
export interface VehicleUse {
  entityId: string;
  /** The income year, named by the 31 March it ends on. */
  year: number;
  /** Business use, 0 to 100, as the logbook found it. */
  businessPercent: number;
  /**
   * The first day of the logbook's test period, at least 90 days long.
   * Absent means there is no logbook, and section DE 4 then limits a sole
   * trader or partnership to 25% business use.
   */
  logbookFrom?: IsoDate;
  /** Chart codes of the vehicle's running-cost accounts. */
  accounts: string[];
  /**
   * Asset classes on the register whose depreciation is this vehicle's --
   * "Motor Vehicles", say. Depreciation is a vehicle cost like fuel, and its
   * private share comes out the same way.
   */
  assetTypes?: string[];
  /** Where the private share goes: the owner's drawings or current account. */
  counterCode: string;
  counterName?: string;
  /**
   * Business use has changed by more than 20% since the logbook was kept.
   * Inland Revenue lets a logbook stand for three years only "if the
   * proportion of business use doesn't change by more than 20%".
   */
  changedSinceLogbook?: boolean;
  /**
   * Actual costs (the default), or Inland Revenue's kilometre rates. With
   * kilometre rates the rate is the whole claim: the year's actual costs and
   * depreciation come out in full, and no GST can be claimed on them.
   */
  method?: "actual" | "kilometre";
  /** For kilometre rates: the year's business and total kilometres. */
  businessKm?: number;
  totalKm?: number;
  fuel?: VehicleFuel;
  /** Tier 1 and Tier 2 rates in cents per km, for a year no rates are held for. */
  rates?: { tier1: number; tier2: number };
}

export type VehicleFuel = "petrol" | "diesel" | "hybrid" | "electric";

/**
 * Inland Revenue's kilometre rates, cents per km, by income year. Tier 1 is
 * the business share of the first 14,000 km the vehicle travels in the year;
 * Tier 2 the business share of the rest. Published after each year ends
 * ("Kilometre rates 2025-2026", set by OS 19/04 (KM 2026), 2 June 2026).
 */
export const KILOMETRE_RATES: Readonly<Record<number, Record<VehicleFuel, { tier1: number; tier2: number }>>> = {
  2026: {
    petrol: { tier1: 120, tier2: 37 },
    diesel: { tier1: 130, tier2: 38 },
    hybrid: { tier1: 90, tier2: 24 },
    electric: { tier1: 122, tier2: 23 },
  },
};

/** The kilometre-rate claim for a year's travel, in cents. */
export function kilometreClaim(
  businessKm: number,
  totalKm: number,
  rates: { tier1: number; tier2: number },
): Cents {
  if (totalKm <= 0 || businessKm <= 0) return 0;
  const share = Math.min(1, businessKm / totalKm);
  const tier1Km = Math.min(totalKm, 14_000) * share;
  const tier2Km = Math.max(0, totalKm - 14_000) * share;
  return Math.round(tier1Km * rates.tier1 + tier2Km * rates.tier2);
}

export interface VehicleAdjustment {
  /** The percentage actually used, after the no-logbook limit. */
  businessPercent: number;
  /** The private share taken out of each account, ex GST. */
  byAccount: { code: string; name: string; privateShare: Cents }[];
  /** GST claimed on the private share, taken back in Box 9. */
  privateGst: Cents;
  journal: PostedJournal | null;
  notes: string[];
}

/** Section DE 4: without a logbook, 25% business use at most. */
export const NO_LOGBOOK_LIMIT = 25;

/**
 * The private share of a year's vehicle costs, as a journal and a GST figure.
 *
 * Worked from what the books actually posted to the vehicle accounts in the
 * year, so the GST taken back is only GST that was claimed: a line with no
 * GST on it (the ACC part of a registration, say) gives none back.
 *
 * The journal: each vehicle account is credited with its private share, the
 * GST account is credited with the GST on that share -- the input tax is being
 * given back -- and drawings are debited with the two together. The same GST
 * figure goes in Box 9 of the return that covers the balance date, so the
 * books' GST account and the returns agree.
 */
export function vehicleAdjustment(
  use: VehicleUse,
  journals: readonly PostedJournal[],
  options: { gstAccountCode?: string; gstAccountName?: string } = {},
): VehicleAdjustment {
  const notes: string[] = [];
  const end = yearEnd(use.year);
  const from = yearStart(use.year);

  const kilometre = use.method === "kilometre";
  let percent = Math.min(100, Math.max(0, use.businessPercent));
  if (kilometre && (use.totalKm ?? 0) > 0) {
    percent = Math.min(100, Math.round(((use.businessKm ?? 0) / (use.totalKm ?? 1)) * 1000) / 10);
  }
  const logbookValid =
    use.logbookFrom !== undefined &&
    use.logbookFrom <= end &&
    // Good for three years from the test period (IRD: "up to 3 years").
    addYears(use.logbookFrom, 3) > from &&
    use.changedSinceLogbook !== true;
  if (!logbookValid) {
    if (use.logbookFrom !== undefined && use.changedSinceLogbook === true) {
      notes.push(
        "Business use has changed by more than 20% since the logbook, so it no longer sets " +
          "the business use. A new 90-day logbook is needed; until then the no-logbook limit applies.",
      );
    } else if (use.logbookFrom !== undefined) {
      notes.push(
        "The logbook is more than three years old, so it no longer sets the business use. " +
          "A new 90-day logbook is needed; until then the no-logbook limit applies.",
      );
    }
    if (percent > NO_LOGBOOK_LIMIT) {
      notes.push(
        `Without a current logbook, business use is limited to ${NO_LOGBOOK_LIMIT}% ` +
          `(section DE 4), so ${NO_LOGBOOK_LIMIT}% is used rather than ${percent}%.`,
      );
      percent = NO_LOGBOOK_LIMIT;
    }
  }
  // With kilometre rates every actual cost is private: the rate is the claim.
  const privateShare = kilometre ? 1 : (100 - percent) / 100;
  let claim = 0;
  if (kilometre) {
    const rates = use.rates ?? KILOMETRE_RATES[use.year]?.[use.fuel ?? "petrol"];
    if (rates === undefined) {
      notes.push(
        `No kilometre rates are held for the year to 31 March ${use.year}; Inland Revenue ` +
          "publishes them after the year ends. Enter them to work out the claim.",
      );
    } else {
      const total = use.totalKm ?? 0;
      claim = kilometreClaim((percent / 100) * total, total, rates);
      notes.push(
        `Kilometre rates: ${percent}% of ${total.toLocaleString("en-NZ")} km at ` +
          `${rates.tier1}c (first 14,000 km) and ${rates.tier2}c (beyond). The year's actual ` +
          "vehicle costs, depreciation and the GST claimed on them come out in full, because " +
          "the rate replaces them and no GST can be claimed when using it.",
      );
    }
  }

  const accounts = new Set(use.accounts.map((c) => c.trim()));
  const assetTypes = (use.assetTypes ?? []).map((t) => t.trim().toLowerCase());
  const totals = new Map<string, { name: string; net: Cents }>();
  let gstClaimed = 0;

  for (const journal of journals) {
    if (journal.source === "adjustment") continue;
    if (journal.date < from || journal.date > end) continue;

    // A class's depreciation journal: its expense line is this vehicle's.
    const isVehicleDepreciation =
      journal.source === "depreciation" &&
      assetTypes.some((type) => journal.narration.toLowerCase().endsWith(type));

    for (const line of journal.lines) {
      const code = line.accountCode.trim();
      const onVehicleAccount = accounts.has(code);
      const vehicleDepreciationExpense = isVehicleDepreciation && line.amount > 0;
      if (!onVehicleAccount && !vehicleDepreciationExpense) continue;
      const held = totals.get(code) ?? { name: line.accountName, net: 0 };
      held.net += line.amount;
      totals.set(code, held);
      // Only GST actually claimed on these lines: the supply line carries
      // the GST-inclusive base, negative for a purchase.
      if (onVehicleAccount && line.taxType === "INPUT2" && line.taxBase !== undefined) {
        gstClaimed += gstIn(-line.taxBase);
      }
    }
  }

  const byAccount = [...totals.entries()]
    .map(([code, { name, net }]) => ({ code, name, privateShare: Math.round(net * privateShare) }))
    .filter((a) => a.privateShare !== 0)
    .sort((a, b) => a.code.localeCompare(b.code));
  const privateGst = Math.round(gstClaimed * privateShare);

  if (byAccount.length === 0 && privateGst === 0 && claim === 0) {
    return { businessPercent: percent, byAccount, privateGst, journal: null, notes };
  }

  const gstCode = options.gstAccountCode ?? "820";
  const lines: PostedLine[] = byAccount.map((a) => ({
    accountCode: a.code,
    accountName: a.name,
    amount: -a.privateShare,
    taxType: "NONE",
    description: `Private use, ${100 - percent}%`,
  }));
  if (privateGst !== 0) {
    lines.push({
      accountCode: gstCode,
      accountName: options.gstAccountName ?? "GST",
      amount: -privateGst,
      taxType: "NONE",
      description: "GST on the private share, given back (Box 9)",
    });
  }
  if (claim !== 0) {
    const claimCode = use.accounts[0] ?? byAccount[0]?.code ?? "449";
    lines.push({
      accountCode: claimCode,
      accountName: byAccount.find((a) => a.code === claimCode)?.name ?? "Motor Vehicle Expenses",
      amount: claim,
      taxType: "NONE",
      description: "Kilometre-rate claim",
    });
  }
  const toDrawings = byAccount.reduce((sum, a) => sum + a.privateShare, 0) + privateGst - claim;
  lines.push({
    accountCode: use.counterCode,
    accountName: use.counterName ?? "Drawings",
    amount: toDrawings,
    taxType: "NONE",
    description: kilometre ? "Vehicle costs out, kilometre claim in" : "Private share of vehicle costs",
  });

  return {
    businessPercent: percent,
    byAccount,
    privateGst,
    journal: {
      transactionId: `vehicle:${use.entityId}:${use.year}`,
      date: end,
      narration: kilometre
        ? `Vehicle, kilometre rates — ${percent}% business, year to ${end}`
        : `Vehicle private use — ${percent}% business, year to ${end}`,
      lines,
      source: "adjustment",
      taxBasis: "both",
    },
    notes,
  };
}

// --- prepayments ----------------------------------------------------------------

/**
 * The rows of Determination E12, which excuse a prepayment from section EA 3.
 *
 * From the determination itself (Inland Revenue, March 2009, in force for
 * income years ending on or after 1 April 2009): each row names a kind of
 * expenditure, the most its unexpired portions may total across that row, and
 * the longest the expiry may run past the balance date. Null is the
 * determination's dash: no limit.
 */
export interface E12Row {
  id: string;
  label: string;
  /** Most the row's unexpired portions may total, or null for no limit. */
  maxTotal: Cents | null;
  /** Most months from balance date to expiry, or null for unlimited. */
  maxMonths: number | null;
  /** A limit on the year's spending on one contract or association, where the row has one. */
  maxPerContract?: Cents;
}

export const E12_ROWS: readonly E12Row[] = [
  { id: "a", label: "Rent of land or buildings, for a period ending more than a month after balance date", maxTotal: 2_600_000, maxMonths: 6 },
  { id: "b", label: "Rent of land or buildings, other", maxTotal: null, maxMonths: 1 },
  { id: "c", label: "Rent or bailment of livestock or bloodstock", maxTotal: 2_600_000, maxMonths: 6 },
  { id: "d", label: "Consumable aids (held at balance date)", maxTotal: 5_800_000, maxMonths: null },
  { id: "e", label: "Insurance premiums (a contract costing $12,000 or less in the year)", maxTotal: null, maxMonths: 12, maxPerContract: 1_200_000 },
  { id: "f", label: "Equipment service contracts or warranties bought with the asset", maxTotal: null, maxMonths: null },
  { id: "g", label: "Service or maintenance of plant, equipment or machinery (a contract costing $23,000 or less in the year)", maxTotal: null, maxMonths: 3, maxPerContract: 2_300_000 },
  { id: "h", label: "Use or maintenance of telephones and other communication equipment", maxTotal: null, maxMonths: 2 },
  { id: "i", label: "Services, other", maxTotal: 1_400_000, maxMonths: 6 },
  { id: "j", label: "Periodic charges, levies, licences and registrations, other", maxTotal: 1_400_000, maxMonths: 12 },
  { id: "k", label: "Stationery", maxTotal: null, maxMonths: null },
  { id: "l", label: "Subscriptions to newspapers, journals and periodicals", maxTotal: null, maxMonths: null },
  { id: "m", label: "Motor vehicle registration and driver licence fees", maxTotal: null, maxMonths: null },
  { id: "n", label: "Trade, professional or other memberships ($6,000 or less a year per association)", maxTotal: null, maxMonths: 12, maxPerContract: 600_000 },
  { id: "o", label: "Postage and courier", maxTotal: null, maxMonths: null },
  { id: "p", label: "Local authority rates invoiced by balance date", maxTotal: null, maxMonths: null },
  { id: "q", label: "Advance bookings for travel and accommodation", maxTotal: 1_400_000, maxMonths: 6 },
  { id: "r", label: "Advertising", maxTotal: 1_400_000, maxMonths: 6 },
  { id: "s", label: "Road user charges", maxTotal: null, maxMonths: null },
  { id: "t", label: "Audit fees", maxTotal: null, maxMonths: null },
  { id: "u", label: "Mandatory accounting costs", maxTotal: null, maxMonths: null },
  { id: "v", label: "Expenditure under section DB 3(1) (tax advice and return preparation)", maxTotal: null, maxMonths: null },
];

/** Not in the determination at all: always adjusted. */
export const NOT_IN_E12 = "none";

/** A payment that buys something running past the balance date. */
export interface Prepayment {
  id: string;
  /** The bank line that paid it. */
  transactionId: string;
  /** The expense account it was coded to. */
  accountCode: string;
  /** What it covers, first and last day. */
  from: IsoDate;
  to: IsoDate;
  /** Its row in Determination E12, or "none". */
  category: string;
  description?: string;
}

export interface PrepaymentLine {
  prepayment: Prepayment;
  /** What was deducted for it, ex GST where GST was claimed. */
  amount: Cents;
  /** The part not yet used at this balance date. */
  unexpired: Cents;
  /** Excused by E12, and why; null if it has to be adjusted. */
  excusedBy: string | null;
}

export interface PrepaymentYear {
  year: number;
  lines: PrepaymentLine[];
  journals: PostedJournal[];
  notes: string[];
}

/** The part of a prepayment not yet used at a date, by days. */
export function unexpiredAt(amount: Cents, from: IsoDate, to: IsoDate, at: IsoDate): Cents {
  const total = dayNumber(to) - dayNumber(from) + 1;
  if (total <= 0) return 0;
  if (at >= to) return 0;
  if (at < from) return amount;
  const left = dayNumber(to) - dayNumber(at);
  return Math.round((amount * left) / total);
}

/** What the books deducted for a payment on its account, from the posted journals. */
function deducted(p: Prepayment, journals: readonly PostedJournal[]): { amount: Cents; paid: IsoDate | null } {
  let amount = 0;
  let paid: IsoDate | null = null;
  for (const journal of journals) {
    if (journal.transactionId !== p.transactionId || journal.source === "adjustment") continue;
    for (const line of journal.lines) {
      if (line.accountCode.trim() !== p.accountCode.trim()) continue;
      amount += line.amount;
      paid = journal.date;
    }
  }
  return { amount, paid };
}

/**
 * The prepayment adjustments for one balance date.
 *
 * Section EA 3: the part of an expense that is still unexpired at balance date
 * is added back and deducted the next year instead -- here, a journal on 31
 * March taking it off the expense into Prepayments, and its reversal on the
 * next day, 1 April, putting it back where the next year's accounts will find
 * it. A prepayment running over two balance dates is adjusted at each.
 *
 * Unless Determination E12 excuses it: the determination lists kinds of
 * expenditure small or short enough not to bother with, row by row, and a
 * prepayment it covers is deducted in full when paid. It is tested in the year
 * the expense was deducted, across each row's total as the determination says.
 */
export function prepaymentAdjustments(
  prepayments: readonly Prepayment[],
  journals: readonly PostedJournal[],
  year: number,
  options: { prepaymentsCode?: string; prepaymentsName?: string; accountName?: (code: string) => string } = {},
): PrepaymentYear {
  const notes: string[] = [];
  const end = yearEnd(year);
  const rows = new Map(E12_ROWS.map((r) => [r.id, r]));

  // Each prepayment's amount and the year it was deducted.
  const known = prepayments.map((p) => {
    const { amount, paid } = deducted(p, journals);
    return { p, amount, paid };
  });

  // E12 is judged in the year of the deduction, on each row's total.
  const excused = new Map<string, string | null>();
  const deductedIn = (paid: IsoDate | null): number | null =>
    paid === null ? null : Number(paid.slice(0, 4)) + (paid.slice(5) > "03-31" ? 1 : 0);
  const byYearAndRow = new Map<string, typeof known>();
  for (const k of known) {
    const y = deductedIn(k.paid);
    if (y === null) continue;
    const key = `${y}:${k.p.category}`;
    byYearAndRow.set(key, [...(byYearAndRow.get(key) ?? []), k]);
  }
  for (const [key, group] of byYearAndRow) {
    const [yText, rowId] = key.split(":") as [string, string];
    const y = Number(yText);
    const row = rows.get(rowId);
    const balance = yearEnd(y);
    const total = group.reduce((sum, k) => sum + unexpiredAt(k.amount, k.p.from, k.p.to, balance), 0);
    for (const k of group) {
      if (row === undefined) {
        excused.set(k.p.id, null);
        continue;
      }
      const withinTotal = row.maxTotal === null || total <= row.maxTotal;
      const withinTime = row.maxMonths === null || k.p.to <= addMonths(balance, row.maxMonths);
      const withinContract = row.maxPerContract === undefined || k.amount <= row.maxPerContract;
      excused.set(
        k.p.id,
        withinTotal && withinTime && withinContract ? `Determination E12 row (${row.id}): ${row.label}` : null,
      );
    }
  }

  const lines: PrepaymentLine[] = [];
  const journalLines: PostedLine[] = [];
  const reversal: PostedLine[] = [];
  const code = options.prepaymentsCode ?? "620";
  const name = options.prepaymentsName ?? "Prepayments";

  for (const k of known) {
    if (k.paid === null) {
      notes.push(`${k.p.description ?? k.p.id}: no payment on account ${k.p.accountCode} was found, so it is left out.`);
      continue;
    }
    if (k.paid > end) continue;
    const unexpired = unexpiredAt(k.amount, k.p.from, k.p.to, end);
    if (unexpired === 0) continue;
    const excusedBy = excused.get(k.p.id) ?? null;
    lines.push({ prepayment: k.p, amount: k.amount, unexpired, excusedBy });
    if (excusedBy !== null) continue;
    const accountName = options.accountName?.(k.p.accountCode) ?? k.p.accountCode;
    const what = k.p.description ?? `Prepaid to ${k.p.to}`;
    journalLines.push(
      { accountCode: code, accountName: name, amount: unexpired, taxType: "NONE", description: what },
      { accountCode: k.p.accountCode, accountName, amount: -unexpired, taxType: "NONE", description: what },
    );
    reversal.push(
      { accountCode: k.p.accountCode, accountName, amount: unexpired, taxType: "NONE", description: what },
      { accountCode: code, accountName: name, amount: -unexpired, taxType: "NONE", description: what },
    );
  }

  const journals_: PostedJournal[] = [];
  if (journalLines.length > 0) {
    journals_.push(
      {
        transactionId: `prepayments:${year}`,
        date: end,
        narration: `Prepayments at ${end} (section EA 3)`,
        lines: journalLines,
        source: "adjustment",
        taxBasis: "both",
      },
      {
        transactionId: `prepayments:${year}:reversal`,
        date: `${year}-04-01`,
        narration: `Prepayments at ${end}, released`,
        lines: reversal,
        source: "adjustment",
        taxBasis: "both",
      },
    );
  }
  return { year, lines, journals: journals_, notes };
}
