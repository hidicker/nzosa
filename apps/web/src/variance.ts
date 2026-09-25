import {
  categorise,
  expandSplits,
  explained,
  gstPeriods,
  gstResolver,
  gstReturn,
  parseFiledReturn,
  readXlsx,
  validateFiledReturn,
} from "@nzosa/core";
import type {
  FiledReturn,
  GstRulesOptions,
  GstReturnResult,
  Overrides,
  RuleSet,
  Splits,
  Transaction,
  VarianceNote,
} from "@nzosa/core";

/**
 * The GST reconciliation view.
 *
 * Everything happens in the page: the filed returns are read from the same
 * `.xlsx` files the accounting system exports, the returns are recomputed from
 * the ledger already loaded here, and the two are compared. No upload, no
 * server, which is what lets this run from a free static host.
 */

export interface VarianceInput {
  transactions: readonly Transaction[];
  splits: Splits;
  overrides: Overrides;
  rules: RuleSet | undefined;
  notes: readonly VarianceNote[];
  accounts: readonly string[];
  /**
   * How the chart of accounts says a code is treated, when nothing else does.
   *
   * Every other report consults this and the return did not, so an account
   * whose treatment came from the chart -- which is where it comes from for
   * anybody who has not hand-set one -- reached the profit and loss correctly
   * treated and reached the GST return as an assumption. The two then differed,
   * and the difference looked like a disagreement with what was filed.
   */
  chartTreatment?: (code: string) => unknown | null;
  /** The side of the return an account is on by its type. */
  sideOf?: (code: string) => "sales" | "purchases" | undefined;
  /**
   * The transfers recorded between your own accounts.
   *
   * The ledger posts a paired transfer as a transfer; the return has to treat
   * it the same way, or a card repayment the books show as a transfer is
   * claimed on the return as a purchase.
   */
  transfers?: Readonly<Record<string, string>>;
  /** Whether a code belongs to an entity not registered for GST. */
  unregistered?: (code: string) => boolean;
  /** Months in a GST period: 1, 2 (the default) or 6. */
  months?: 1 | 2 | 6;
  /** Box 9 debit adjustments for a period: the private use of a vehicle. */
  debitAdjustments?: (period: { from: string; to: string }) => number;
}

export interface VarianceRow {
  periodEnd: string;
  filed: number;
  ours: number | null;
  difference: number | null;
  explained: number;
  left: number | null;
  filedReturn: FiledReturn;
  computed: GstReturnResult | undefined;
}

interface RuleFile extends RuleSet {
  gstRules?: GstRulesOptions["rules"];
  codeTreatments?: GstRulesOptions["codeTreatments"];
}

/** Read filed returns from workbooks chosen in the page. */
export async function readFiledReturns(
  files: readonly File[],
): Promise<{ returns: FiledReturn[]; problems: string[] }> {
  const returns: FiledReturn[] = [];
  const problems: string[] = [];

  for (const file of files) {
    try {
      const workbook = await readXlsx(new Uint8Array(await file.arrayBuffer()));
      const parsed = parseFiledReturn(workbook);
      for (const problem of parsed.problems) problems.push(`${file.name}: ${problem.message}`);
      for (const one of parsed.returns) {
        // A return whose own boxes do not add up has been misread. Storing it
        // would put a wrong baseline somewhere nobody looks again.
        const issues = validateFiledReturn(one);
        if (issues.length > 0) {
          for (const issue of issues) problems.push(`${file.name}: ${issue.message}`);
          continue;
        }
        returns.push(one);
      }
    } catch (error) {
      problems.push(`${file.name}: ${(error as Error).message}`);
    }
  }

  returns.sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  return { returns, problems };
}

/**
 * Recompute our own returns for the periods the filed ones cover.
 *
 * Deliberately the same core calls the command line makes, in the same order,
 * so the two cannot drift apart and quietly compare different things.
 */
export function computeOurReturns(input: VarianceInput, from: string, to: string): GstReturnResult[] {
  const expanded = expandSplits(input.transactions, input.splits, input.overrides);
  const ruleFile = input.rules as RuleFile | undefined;

  const selected =
    input.accounts.length === 0
      ? expanded.transactions
      : expanded.transactions.filter((t) => input.accounts.includes(t.account));

  const codingRules: RuleSet = { ...(ruleFile ?? {}), overrides: expanded.overrides };

  const resolve = gstResolver({
    ownAccounts: new Set(
      input.accounts.length > 0 ? input.accounts : input.transactions.map((t) => t.account),
    ),
    relatedAccounts: new Set(input.transactions.map((t) => t.account)),
    ...(ruleFile?.gstRules ? { rules: ruleFile.gstRules } : {}),
    ...(ruleFile?.codeTreatments ? { codeTreatments: ruleFile.codeTreatments } : {}),
    ...(input.chartTreatment ? { chartTreatment: input.chartTreatment as never } : {}),
    ...(input.sideOf ? { sideOf: input.sideOf } : {}),
    codeOf: (t) => categorise(t, codingRules).code,
    overrides: expanded.overrides,
    ...(input.transfers ? { transfers: input.transfers } : {}),
    ...(input.unregistered ? { unregistered: input.unregistered } : {}),
  });

  // Every cycle for a 31 March balance date ends in March: monthly, the
  // odd months, or September and March.
  return gstPeriods({ from, to }, { months: input.months ?? 2, anchorMonth: 3 }).map((period) =>
    gstReturn(selected, period, {
      resolve,
      claimIn: (t) => expanded.overrides[t.id]?.claimIn ?? null,
      basis: "payments",
      rounding: "per-line",
      adjustments: input.debitAdjustments?.(period) ?? 0,
    }),
  );
}

/** Line up filed returns against ours. */
export function buildRows(
  filed: readonly FiledReturn[],
  input: VarianceInput,
): VarianceRow[] {
  if (filed.length === 0) return [];

  const first = filed[0];
  const last = filed[filed.length - 1];
  if (!first || !last) return [];

  const ours = new Map(
    computeOurReturns(input, first.periodStart ?? first.periodEnd, last.periodEnd).map((r) => [
      r.period.to,
      r,
    ]),
  );

  return filed.map((one) => {
    const computed = ours.get(one.periodEnd);
    // Box 8 less Box 12 on both sides. Box 15 also carries Boxes 9 and 13,
    // which hold late claims and year-end corrections that a bank-derived
    // ledger cannot contain -- comparing against it would report those as ours.
    const core = computed ? computed.boxes.box8 - computed.boxes.box12 : null;
    const difference = core === null ? null : core - one.core;
    const accounted = explained(input.notes, one.periodEnd);
    return {
      periodEnd: one.periodEnd,
      filed: one.core,
      ours: core,
      difference,
      explained: accounted,
      left: difference === null ? null : difference - accounted,
      filedReturn: one,
      computed,
    };
  });
}

export interface DetailLine {
  date: string;
  amount: number;
  who: string;
  what: string;
}

export interface Detail {
  matched: number;
  /** Bank lines that match two or three of the filed lines added together. */
  grouped: number;
  onlyFiled: DetailLine[];
  onlyOurs: DetailLine[];
  filedGst: number;
  ourGst: number;
}

const gstOf = (lines: readonly { amount: number }[]): number =>
  lines.reduce((sum, line) => sum + Math.round((line.amount * 3) / 23), 0);

/** The lines behind one period, matched up. */
export function detailFor(row: VarianceRow): Detail | null {
  if (!row.computed) return null;

  const ourLines: DetailLine[] = row.computed.lines
    // Import GST is already a tax figure bound for Box 13, not a rated line.
    .filter((line) => line.classification.side !== "imports")
    .map((line) => {
      return {
        date: line.transaction.date,
        amount: line.amount,
        who: line.transaction.otherParty,
        what: line.transaction.particulars || line.transaction.reference || "",
      };
    });

  const filedLines: DetailLine[] = row.filedReturn.lines
    // Late claims sit in Boxes 9 and 13, so they are no part of this comparison.
    .filter((line) => !line.lateClaim && (/^15%/.test(line.taxRate) || /^15%/.test(line.section)))
    .map((line) => ({
      date: line.date,
      amount: line.gross,
      who: line.contact,
      what: line.description,
    }));

  // Amount alone cannot pair these: a period with three receipts of 800.00
  // would match them arbitrarily and report two as differences. Nearest date
  // wins, within three weeks.
  const available = [...filedLines];
  const onlyOurs: DetailLine[] = [];
  let matched = 0;

  for (const line of [...ourLines].sort((a, b) => a.date.localeCompare(b.date))) {
    let best = -1;
    let bestGap = Number.POSITIVE_INFINITY;
    for (let i = 0; i < available.length; i += 1) {
      const candidate = available[i];
      if (!candidate || candidate.amount !== line.amount) continue;
      const gap = Math.abs(Date.parse(candidate.date) - Date.parse(line.date)) / 86_400_000;
      if (gap < bestGap) {
        best = i;
        bestGap = gap;
      }
    }
    if (best >= 0 && bestGap <= 21) {
      available.splice(best, 1);
      matched += 1;
    } else {
      onlyOurs.push(line);
    }
  }

  // A payment the other system divided between invoices is one line in the
  // bank and two or three in the return: a receipt of 890.00 against lines of
  // 800.00 and 90.00. Paired by amount alone they read as differences on both
  // sides, though the GST agrees, and on real books they were most of what the
  // detail listed. So what is left on our side is tried against two or three
  // filed lines within a week that add up to it exactly -- nearest dates first.
  const near = (a: string, b: string): number => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
  let grouped = 0;
  const unmatchedOurs: DetailLine[] = [];
  for (const line of onlyOurs) {
    const pool = available
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => near(candidate.date, line.date) <= 7);
    let best: { indices: number[]; gap: number } | null = null;
    const consider = (picked: { candidate: DetailLine; index: number }[]): void => {
      if (picked.reduce((sum, p) => sum + p.candidate.amount, 0) !== line.amount) return;
      const gap = picked.reduce((sum, p) => sum + near(p.candidate.date, line.date), 0);
      if (best === null || gap < best.gap) best = { indices: picked.map((p) => p.index), gap };
    };
    for (let i = 0; i < pool.length; i += 1) {
      for (let j = i + 1; j < pool.length; j += 1) {
        const a = pool[i];
        const b = pool[j];
        if (a === undefined || b === undefined) continue;
        consider([a, b]);
        for (let k = j + 1; k < pool.length; k += 1) {
          const c = pool[k];
          if (c !== undefined) consider([a, b, c]);
        }
      }
    }
    const chosen = best as { indices: number[]; gap: number } | null;
    if (chosen === null) {
      unmatchedOurs.push(line);
      continue;
    }
    for (const index of [...chosen.indices].sort((x, y) => y - x)) available.splice(index, 1);
    grouped += 1;
  }

  return {
    matched,
    grouped,
    onlyFiled: available,
    onlyOurs: unmatchedOurs,
    filedGst: gstOf(filedLines),
    ourGst: gstOf(ourLines),
  };
}

