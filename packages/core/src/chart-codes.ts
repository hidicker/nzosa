import type { Account } from "./chart.js";
import { accountTreatment } from "./chart.js";
import type { GstSide, GstTreatment } from "./gst.js";
import type { GstRulesOptions } from "./gst-rules.js";
import type { Overrides } from "./overrides.js";
import type { RuleSet } from "./rules.js";
import { bareAccountName, canonicalCodeFor } from "./coding-names.js";

/**
 * Which chart account a coding refers to, and what the chart says about it.
 *
 * A transaction is coded to a string -- `Advertising - 400`, `820 GST`, or
 * whatever the rules happened to be written with. Turning that string back
 * into a row of the chart is what lets anything read the account's tax code,
 * and the tax code is where "No GST" lives. On a real chart more than half the
 * accounts carry it, so getting this wrong claims GST on money that never had
 * any.
 *
 * This lived in the browser app, and the command line grew its own simpler
 * version that matched on three fixed shapes. They agreed on every code in use
 * -- and disagreed about `820 GST`, which is written number first. Two
 * implementations of one lookup is how the halves of this project have drifted
 * before, so there is one, here, and both call it.
 */

/**
 * A rule file as it is written on disk: coding rules and GST rules together.
 *
 * They live in one file because they are maintained together -- discovering
 * that a supplier is not GST registered is the same act as discovering how to
 * code their invoices.
 */
export interface RuleFile extends RuleSet {
  gstRules?: GstRulesOptions["rules"];
  codeTreatments?: GstRulesOptions["codeTreatments"];
}

/**
 * Every account a coding may point at.
 *
 * The chart belongs in here and was once missing. Rules, defaults, overrides
 * and GST treatments all name accounts that have been *used*, which is empty
 * on a ledger nobody has coded yet -- so somebody who had just loaded their
 * chart of accounts opened the account picker and found nothing in it, with no
 * way to code a single line by hand.
 */
export function knownCodes(
  rules: RuleSet | undefined,
  overrides: Overrides,
  chart: readonly { code: string; name: string }[] = [],
): string[] {
  const codes = new Set<string>();
  const file = rules as RuleFile | undefined;
  for (const rule of file?.rules ?? []) if (rule.code) codes.add(rule.code);
  for (const fallback of file?.defaults ?? []) if (fallback.code) codes.add(fallback.code);
  for (const override of Object.values(overrides)) if (override.code) codes.add(override.code);
  // A code treatment says what an account is for GST. That is a stronger
  // statement that the account exists than any rule pointing at it, and
  // leaving these out hid sixteen accounts from the picker -- including
  // non-deductible entertainment, which no keyword will ever match because
  // deciding it is non-deductible is a judgement, not a payee.
  for (const code of Object.keys(file?.codeTreatments ?? {})) codes.add(code);

  // Then the chart, for accounts nothing has reached for yet. Added only when
  // no existing name already carries that number, so loading a chart beside a
  // set of rules does not put "Advertising - 400" beside "NB Advertising - 400"
  // and make one account look like two.
  for (const account of chart) {
    const code = account.code.trim();
    const name = account.name.trim();
    if (name === "") continue;
    if (code !== "" && [...codes].some((c) => new RegExp(`\b${code}\b`).test(c))) continue;
    codes.add(code === "" ? name : `${name} - ${code}`);
  }

  return [...codes].sort();
}

/**
 * The name a coding uses for an account, built from its code and name.
 *
 * One function because there were two, disagreeing. Adding an account by hand
 * in the app wrote `400 - Advertising`; every other path wrote
 * `Advertising - 400`. Both name account 400 and nothing matched them to each
 * other, so one account arrived in the books under two names -- which is the
 * alias problem, made rather than inherited.
 *
 * Name first, because that is the order the rest of this reads: the trailing
 * code is what `bareAccountName` strips to compare two spellings of one
 * account, and a code at the front is not stripped and does not match.
 *
 * `housePrefixed` follows a chart that already puts `NB` in front of every
 * name. It is one chart's convention, so it is followed where it is found and
 * never invented.
 */
export function accountLabel(
  code: string,
  name: string,
  housePrefixed = false,
): string {
  const trimmedCode = code.trim();
  const trimmedName = name.trim();
  if (trimmedCode === "") return trimmedName;
  return housePrefixed
    ? `NB ${trimmedName} - ${trimmedCode}`
    : `${trimmedName} - ${trimmedCode}`;
}

/**
 * Match a chart account to the name the codings already use for it.
 *
 * Candidates are scored rather than taken first-found. Overrides can hold a
 * bare `200` alongside the proper `NB Sales - 200`, and whichever sorted first
 * would win -- which put the chart's Sales under `200`, left `NB Sales - 200`
 * unclaimed, and listed the account twice. Matching the code and the name is
 * strictly better evidence than matching either alone.
 */
export function labelForChartAccount(
  account: Account,
  known: readonly string[],
): string {
  const code = account.code.trim();
  const name = account.name.trim().toLowerCase();

  // Both together beat either alone: the number says which account, the name
  // confirms it is not a stray alias carrying the same number.
  const byNumber = canonicalCodeFor(code, known);
  const byName = known.find((candidate) => bareAccountName(candidate) === name);
  const best = byNumber ?? byName ?? null;
  if (best !== null) return best;

  // Nothing names it yet, so propose a plain one. It used to propose the
  // house prefix -- `NB Advertising - 400` -- which is one chart's convention
  // and became every new user's account names the moment they loaded theirs.
  return accountLabel(code, account.name);
}

/** What an account's own chart row implies for GST, if anything. */
export type ImpliedTreatment = { treatment: GstTreatment; side?: GstSide };

/**
 * Every coding label the chart has an opinion about, and what that opinion is.
 *
 * Keyed by the label a transaction is actually coded to, so the caller can
 * look one up directly. An account whose tax code says nothing is left out
 * rather than defaulted, because "the chart does not say" and "the chart says
 * standard" are different answers and only one of them should be assumed.
 */
export function chartTreatments(
  chart: readonly Account[],
  rules: RuleSet | undefined,
  overrides: Overrides,
): Map<string, ImpliedTreatment> {
  const known = knownCodes(rules, overrides);
  const map = new Map<string, ImpliedTreatment>();

  for (const account of chart) {
    const implied = accountTreatment(account);
    if (implied !== null) map.set(labelForChartAccount(account, known), implied);
  }

  // One account, more than one name for it.
  //
  // The canonical label is the account's proper name, but a coding can carry
  // any of its aliases -- `820 GST` and `GST - 820` are both in use and both
  // mean account 820. Keying only the canonical one left every alias with no
  // opinion from the chart, which means assumed standard-rated: an account
  // marked "No GST" quietly claimed GST whenever it was reached by its other
  // name.
  //
  // Only where the number settles it. A label with no account number in it is
  // matched by name above, and guessing past that would map one account's
  // treatment onto another's rows.
  const byCode = new Map<string, ImpliedTreatment>();
  for (const account of chart) {
    const code = account.code.trim();
    const implied = accountTreatment(account);
    // First wins, so a duplicate row further down the chart cannot take over
    // an account number that is already spoken for.
    if (code !== "" && implied !== null && !byCode.has(code)) byCode.set(code, implied);
  }
  for (const label of known) {
    if (map.has(label)) continue;
    const digits = /\b(\d{3,4})\b/.exec(label)?.[1];
    const implied = digits === undefined ? undefined : byCode.get(digits);
    if (implied !== undefined) map.set(label, implied);
  }

  return map;
}

/**
 * Split an account label into its code and its name.
 *
 * A label is written either way round and both turn up in one ledger. This
 * app writes `Accounts Receivable - 610`; an Account Transactions export
 * writes `485 Subscriptions`; the two sit side by side in the same book,
 * because some codings came from rules and some were adopted from the export.
 *
 * Reading only one of them is not a cosmetic failure. A posting whose code
 * cannot be recovered carries an empty code, and anything that classifies an
 * account by its code -- a balance sheet deciding what is an asset, an IR10
 * deciding which box -- then falls back to the name, matches nothing in the
 * chart, and files the account wherever its default sends it. On one real
 * ledger that put Sales, Cost of Goods Sold and eight other profit and loss
 * accounts into current assets, and the sheet still balanced, because a
 * misfiled account balances exactly as well as a filed one.
 *
 * The code is a run of three or four digits at one end or the other, with an
 * optional dash. Digits in the middle of a name are left alone: `Motor Vehicle
 * >1K` has a number in it and no code.
 */
export function splitAccountLabel(label: string): { code: string; name: string } {
  const text = label.replace(/^NB\s+/i, "").trim();

  const trailing = /^(.*?)\s*[-–]?\s*(\d{3,4})$/.exec(text);
  if (trailing && (trailing[1] ?? "").trim() !== "") {
    return { code: trailing[2] ?? "", name: (trailing[1] ?? "").trim() };
  }

  const leading = /^(\d{3,4})\s*[-–]?\s*(.*)$/.exec(text);
  if (leading && (leading[2] ?? "").trim() !== "") {
    return { code: leading[1] ?? "", name: (leading[2] ?? "").trim() };
  }

  // A bare number is a code with no name; anything else is a name with no code.
  if (/^\d{3,4}$/.test(text)) return { code: text, name: text };
  return { code: "", name: text };
}
