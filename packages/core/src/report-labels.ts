import type { Account } from "./chart.js";
import { knownCodes, labelForChartAccount } from "./chart-codes.js";
import { matchAccountName } from "./coding-names.js";
import { accountEntityKey } from "./entities.js";
import type { EntityModel } from "./entities.js";
import type { Overrides } from "./overrides.js";
import { balanceSheetRole, plClassForType, sectionForType } from "./reports.js";
import type { PlClass, ReportSection } from "./reports.js";
import type { RuleSet } from "./rules.js";

/**
 * How a posted line is named on a report.
 *
 * By code where it has one, and by name where it does not. The name half is
 * not a fallback nobody reaches: an account with no code produced an empty
 * label, and a report skips lines it cannot name -- so three rentals whose
 * accounts are all named rather than numbered had nothing at all in their
 * reports, and nothing said why.
 *
 * Built once and returned as a function, because it is called for every line
 * of every journal and the two indexes behind it do not change while it runs.
 */
export function reportLabeller(options: {
  chart: readonly Account[];
  rules?: RuleSet;
  overrides?: Overrides;
}): (line: { accountCode: string; accountName: string }) => string {
  const known = knownCodes(options.rules, options.overrides ?? {});
  const byCode = new Map<string, Account>();
  const byName = new Map<string, Account>();
  for (const account of options.chart) {
    const code = account.code.trim();
    if (code !== "") byCode.set(code, account);
    const name = account.name.trim().toLowerCase();
    if (name !== "" && !byName.has(name)) byName.set(name, account);
  }

  return (line) => {
    const code = line.accountCode.trim();
    const found = code !== "" ? byCode.get(code) : byName.get(line.accountName.trim().toLowerCase());
    if (found) return labelForChartAccount(found, known);
    if (code !== "") return `${code} ${line.accountName}`.trim();
    return line.accountName.trim();
  };
}

/**
 * Which entity each code belongs to, and which part of a report it sits in.
 *
 * Both answered from the same walk of the chart, because a report needs them
 * together for every line and asking separately walks it twice.
 */
export function reportLookups(options: {
  model: EntityModel;
  accounts: readonly { account: Account; label: string }[];
}): {
  entityOfCode: Map<string, string>;
  sectionOf: (code: string) => ReportSection | null;
  /** Which subheading of the profit and loss each code sits under. */
  classOf: (code: string) => PlClass | null;
  /** What a code off the profit and loss is, in words; null for one on it. */
  roleOf: (code: string) => string | null;
} {
  const entityOfCode = new Map<string, string>();
  const sections = new Map<string, ReportSection | null>();
  const classes = new Map<string, PlClass | null>();
  const roles = new Map<string, string | null>();

  for (const { account, label } of options.accounts) {
    const id = options.model.accounts[accountEntityKey(account)];
    if (id !== undefined) entityOfCode.set(label, id);
    sections.set(label, sectionForType(account.type));
    classes.set(label, plClassForType(account.type));
    roles.set(
      label,
      sectionForType(account.type) === null ? balanceSheetRole(account.type, account.name) : null,
    );
  }

  return {
    entityOfCode,
    sectionOf: (code) => sections.get(code) ?? null,
    classOf: (code) => classes.get(code) ?? null,
    roleOf: (code) => roles.get(code) ?? null,
  };
}

/**
 * The same account, said the way this ledger says it.
 *
 * Another system's coding arrives in its own wording, and taking it means
 * finding what we call the same thing. The chart counts as something we know
 * about -- without it, an account that exists only in the chart, which is
 * every account on a freshly imported one before anything has been coded to
 * it, was unknown, and adopting the other system's coding for it was refused
 * with advice to go and set up the very thing already set up.
 */
export function mapToOurVocabulary(
  code: string,
  options: { chart: readonly Account[]; rules?: RuleSet; overrides?: Overrides },
): string | null {
  const known = knownCodes(options.rules, options.overrides ?? {}, options.chart);
  if (known.includes(code)) return code;
  return matchAccountName(code, known);
}

/**
 * The rate to show against an account, as a percentage or a special case.
 *
 * Only `standard` has a percentage this can state. Exempt and zero-rated are
 * neither 15% nor out of scope, and reporting them as 15% would let looking at
 * a page quietly change what they are -- so they are returned as themselves
 * and the caller shows the word.
 *
 * `100` means the whole line is GST, which is what a customs entry is.
 */
export function rateForTreatment(value: unknown): string | null {
  if (value === undefined || value === null) return null;

  const rateFor = (treatment: string | undefined): string =>
    treatment === "out-of-scope"
      ? "0"
      : treatment === "standard" || treatment === undefined
        ? "15"
        : treatment;

  if (typeof value === "string") return rateFor(value);
  const shape = value as { treatment?: string; side?: string };
  if (shape.side === "imports") return "100";
  return rateFor(shape.treatment);
}
