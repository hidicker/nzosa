import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  categorise,
  chartTreatments,
  expandSplits,
  gstPeriods,
  gstResolver,
  gstReturn,
  validateSplits,
} from "@nzosa/core";
import type {
  ExpandedSplits,
  RuleFile,
  ImpliedTreatment,
  GstReturnResult,
  RuleSet,
  Transaction,
} from "@nzosa/core";
import type { GstOptions } from "./gst-command.js";
import type { Ledger } from "./ledger.js";

export interface ComputedReturns {
  returns: GstReturnResult[];
  /** Split-expanded transactions and the overrides that go with them. */
  expanded: ExpandedSplits;
  /**
   * The transactions the return was actually built from, after `--accounts`
   * and `--codes` have narrowed it.
   *
   * Reported separately from `expanded` because the header prints this count,
   * and printing the whole ledger's count there said "selected 3253
   * transactions" above a return built from forty of them.
   */
  selected: readonly Transaction[];
}

/**
 * Build the GST returns for a range.
 *
 * Separated from the command that prints them because more than one report
 * needs the same figures: the return itself, and the comparison against what
 * was filed. Two code paths computing a return two ways is exactly how a
 * comparison ends up agreeing with something other than the thing it claims to
 * check.
 */
export function computeGstReturns(
  options: GstOptions,
  ledger: Ledger,
): ComputedReturns | { error: number } {
  const rulesPath = options.rulesPath ?? rulesBesideTheBooks(options.ledger);
  const ruleFile = rulesPath === undefined ? undefined : loadRules(rulesPath);

  // A split that does not balance would change the totals without changing the
  // bank data, so it is reported and left unexpanded rather than trusted.
  const splitProblems = validateSplits(ledger.transactions, ledger.splits ?? {});
  for (const problem of splitProblems) {
    process.stderr.write(`Split on ${problem.id} ignored: ${problem.message}\n`);
  }

  // Splits are expanded before anything is coded, so each part is treated on
  // its own merits. `balances` deliberately does not do this -- it reconciles
  // against exactly what the bank reported.
  const expanded = expandSplits(
    ledger.transactions,
    ledger.splits ?? {},
    ledger.overrides ?? {},
  );

  let selected: Transaction[] =
    options.accounts.length === 0
      ? expanded.transactions
      : expanded.transactions.filter((t) => options.accounts.includes(t.account));

  if (options.accounts.length > 0 && selected.length === 0) {
    process.stderr.write(
      `No transactions on ${options.accounts.join(", ")}. ` +
        `Run "nzosa balances" to see the account ids in this ledger.\n`,
    );
    return { error: 2 };
  }

  // Selecting by account is not always enough. Rent for a property can be paid
  // into a completely different account from the one named after it, so a
  // return often has to be built from coded transactions rather than from a
  // bank account.
  if (options.codes.length > 0) {
    if (rulesPath === undefined) {
      process.stderr.write("--codes needs --rules to say how codes are assigned.\n");
      return { error: 2 };
    }

    const wanted = new Set(options.codes);
    selected = selected.filter((t) => {
      const code = categorise(t, {
        ...(ruleFile as RuleSet),
        overrides: expanded.overrides,
      }).code;
      return code !== null && wanted.has(code);
    });

    if (selected.length === 0) {
      process.stderr.write(
        `No transactions coded to ${options.codes.join(", ")} by ${rulesPath}.\n`,
      );
      return { error: 2 };
    }
  }

  // Coding runs first, so GST can follow from what a transaction is rather than
  // from who it was paid to -- which is how the workbook's rules are keyed.
  const codingRules: RuleSet = {
    ...(ruleFile as RuleSet | undefined),
    overrides: expanded.overrides,
  };

  // Only the accounts being reported on count as the entity's own. A transfer
  // within the entity is not a supply; money arriving from outside it is.
  // The same lookup the app uses, from the core, rather than a second one
  // here that agreed with it on most codes but not on all of them.
  const fromChart = chartTreatments(ledger.chart ?? [], ruleFile, expanded.overrides);
  const chartTreatment = (code: string): ImpliedTreatment | null =>
    fromChart.get(code) ?? null;

  const resolve = gstResolver({
    ownAccounts: new Set(
      options.accounts.length > 0
        ? options.accounts
        : ledger.transactions.map((t) => t.account),
    ),
    // Every account in the ledger belongs to the user, just not all to this
    // entity. That distinction is what tells a sweep from a supplier payment.
    relatedAccounts: new Set(ledger.transactions.map((t) => t.account)),
    ...(ruleFile?.gstRules ? { rules: ruleFile.gstRules } : {}),
    ...(ruleFile?.codeTreatments ? { codeTreatments: ruleFile.codeTreatments } : {}),
    // What the chart says, behind anything said explicitly. Without it a
    // return built from a folder of books assumed standard-rated for every
    // account -- including the ones the chart marks "No GST", which on a real
    // chart is more than half of them.
    ...(fromChart.size > 0 ? { chartTreatment } : {}),
    codeOf: (t) => categorise(t, codingRules).code,
    // Manual answers and split-part coding beat the rule file and the defaults.
    overrides: expanded.overrides,
  });

  const { from, to } = options.range;
  if (from === undefined || to === undefined) return { error: 2 };

  const periods = gstPeriods({ from, to }, {
    months: options.months,
    anchorMonth: options.anchorMonth,
  });

  const returns = periods.map((period) =>
    gstReturn(selected, period, {
      resolve,
      claimIn: (t) => expanded.overrides[t.id]?.claimIn ?? null,
      basis: options.basis,
      rounding: options.rounding,
      sharePercent: options.sharePercent,
    }),
  );

  return { returns, expanded, selected };
}

/**
 * Read a rule set, failing loudly rather than silently coding nothing.
 *
 * Two shapes reach here. A rule file written by hand is the rules themselves.
 * A rule file saved by the app is wrapped twice -- once in the `{ version,
 * data }` envelope every part of a folder of books is written in, and once
 * more in a record of where the rules were loaded from -- and unwrapping it is
 * what lets somebody check the app's figures from the command line against the
 * same rules the app used.
 *
 * The check at the end is the point of the function. Handed a file with no
 * rules in it, the old reader returned an object with no `rules` array, every
 * transaction matched nothing, and a full GST return was printed as though it
 * had worked -- the same table, quietly built on none of the user's coding.
 */
/**
 * The rules that belong to a set of books.
 *
 * A folder written by the app keeps its rules in it, next to the
 * transactions, and they are the rules the app coded with. Without this,
 * checking the app's GST return from the command line meant remembering to
 * pass `--rules` at the same path -- and forgetting produced not an error but
 * a different return, printed with the same confidence as the right one.
 *
 * An explicit `--rules` still wins, for trying a rule set against books it did
 * not come from.
 */
function rulesBesideTheBooks(ledgerPath: string): string | undefined {
  try {
    if (!statSync(ledgerPath).isDirectory()) return undefined;
  } catch {
    return undefined;
  }
  const file = join(ledgerPath, "rules.json");
  return existsSync(file) ? file : undefined;
}

function loadRules(path: string): RuleFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read rules from ${path}: ${(error as Error).message}`);
  }

  // Peel the wrappers, innermost last, stopping at the first level that
  // actually holds rules.
  let held = parsed as Record<string, unknown> | null;
  for (const wrapper of ["data", "rules"] as const) {
    if (held === null || hasRules(held)) break;
    const inner = held[wrapper];
    if (inner !== null && typeof inner === "object" && !Array.isArray(inner)) {
      held = inner as Record<string, unknown>;
    }
  }

  if (held === null || !hasRules(held)) {
    throw new Error(
      `${path} has no "rules", "defaults", "gstRules" or "codeTreatments".`,
    );
  }
  return held as unknown as RuleFile;
}

function hasRules(held: Record<string, unknown>): boolean {
  return (
    Array.isArray(held["rules"]) ||
    Array.isArray(held["defaults"]) ||
    Array.isArray(held["gstRules"]) ||
    held["codeTreatments"] !== undefined
  );
}
