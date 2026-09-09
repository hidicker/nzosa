import { matchText, normaliseAccountNumber } from "@nzosa/core";
import type { CategoryRule } from "@nzosa/core";

/**
 * Editing coding rules in the page.
 *
 * Until now rules could only be changed by editing JSON and reloading, which
 * meant the one thing a person most wants to do while looking at a wrong
 * suggestion -- fix the rule that made it -- was the one thing they could not
 * do here.
 *
 * Two things this deliberately does not do:
 *
 *  * It does not renumber or reorder anything on save. Precedence is priority
 *    then declaration order, and quietly reordering rules would change codings
 *    on lines the user was not looking at.
 *
 *  * It does not recode anything by itself. A changed rule changes what is
 *    *suggested*; lines already confirmed keep the answer a person gave them,
 *    which is the whole point of confirming.
 */

export interface RuleDraft {
  priority: string;
  keyword: string;
  account: string;
  code: string;
  contact: string;
  note: string;
  /**
   * Words that must appear in one named field, rather than anywhere in the line.
   *
   * A keyword searches the whole of what the bank wrote, which is what makes
   * it quick to write and unable to separate two payments to the same payee.
   * These narrow it: payee mentions Inland Revenue *and* particulars mention
   * GST is one rule where a keyword needs five.
   */
  wherePayee: string;
  whereParticulars: string;
  whereCode: string;
  whereReference: string;
  whereOtherAccount: string;
  /** Index in the underlying array, or null for a rule being added. */
  index: number | null;
}

export function toDraft(rule: CategoryRule, index: number): RuleDraft {
  return {
    priority: String(rule.priority ?? 0),
    keyword: rule.keyword ?? "",
    account: rule.account ?? "",
    code: rule.code,
    contact: rule.contact ?? "",
    note: rule.note ?? "",
    wherePayee: rule.where?.otherParty ?? "",
    whereParticulars: rule.where?.particulars ?? "",
    whereCode: rule.where?.code ?? "",
    whereReference: rule.where?.reference ?? "",
    whereOtherAccount: rule.where?.otherPartyAccount ?? "",
    index,
  };
}

export function blankDraft(): RuleDraft {
  return {
    priority: "0", keyword: "", account: "", code: "", contact: "", note: "",
    wherePayee: "", whereParticulars: "", whereCode: "", whereReference: "",
    whereOtherAccount: "",
    index: null,
  };
}

export interface DraftProblem {
  field: keyof RuleDraft;
  message: string;
}

/**
 * Check a draft before it is allowed back into the rule set.
 *
 * A rule with neither a keyword nor an account matches every transaction on
 * every account, so saving one silently recodes the whole ledger. That is the
 * mistake worth being loud about.
 */
export function validateDraft(draft: RuleDraft): DraftProblem[] {
  const problems: DraftProblem[] = [];
  if (draft.code.trim() === "") {
    problems.push({ field: "code", message: "A rule has to say which code to assign." });
  }
  // A field constraint narrows as surely as a keyword does, and a rule that
  // says only "particulars mention GST" is a perfectly good rule. The test is
  // whether anything narrows it at all, not which of them does.
  if (
    draft.keyword.trim() === "" &&
    draft.account.trim() === "" &&
    whereOf(draft) === undefined
  ) {
    problems.push({
      field: "keyword",
      message:
        "Give a keyword, an account, or something a field must contain. A rule with " +
        "none of those matches every transaction.",
    });
  }
  if (draft.priority.trim() !== "" && Number.isNaN(Number(draft.priority))) {
    problems.push({ field: "priority", message: "Priority has to be a number." });
  }
  return problems;
}

/** Turn a validated draft back into a rule, dropping fields left empty. */
export function fromDraft(draft: RuleDraft): CategoryRule {
  const priority = Number(draft.priority);
  const where = whereOf(draft);
  return {
    ...(Number.isFinite(priority) && priority !== 0 ? { priority } : {}),
    ...(draft.keyword.trim() !== "" ? { keyword: draft.keyword.trim() } : {}),
    ...(draft.account.trim() !== "" ? { account: draft.account.trim() } : {}),
    code: draft.code.trim(),
    ...(draft.contact.trim() !== "" ? { contact: draft.contact.trim() } : {}),
    ...(draft.note.trim() !== "" ? { note: draft.note.trim() } : {}),
    ...(where === undefined ? {} : { where }),
  };
}

/** The field constraints a draft carries, or nothing when it names none. */
function whereOf(draft: RuleDraft): CategoryRule["where"] {
  const where = {
    ...(draft.wherePayee.trim() !== "" ? { otherParty: draft.wherePayee.trim() } : {}),
    ...(draft.whereParticulars.trim() !== "" ? { particulars: draft.whereParticulars.trim() } : {}),
    ...(draft.whereCode.trim() !== "" ? { code: draft.whereCode.trim() } : {}),
    ...(draft.whereReference.trim() !== "" ? { reference: draft.whereReference.trim() } : {}),
    ...(draft.whereOtherAccount.trim() !== ""
      ? { otherPartyAccount: draft.whereOtherAccount.trim() }
      : {}),
  };
  return Object.keys(where).length === 0 ? undefined : where;
}

/**
 * How many transactions a rule would newly claim, and how many it would take
 * from another rule.
 *
 * Shown before a save because the count is the only honest way to answer "what
 * does this rule actually do" -- a keyword that looks specific can match three
 * hundred lines, and one that looks broad can match none.
 */
export interface RuleImpact {
  matches: number;
  /** Of those, how many some other rule already codes differently. */
  stolen: number;
}

/** What a rule is tested against: the whole line, and its parts separately. */
export interface ImpactRow {
  account: string;
  text: string;
  otherParty?: string;
  particulars?: string;
  code?: string;
  reference?: string;
  otherPartyAccount?: string;
}

export function ruleImpact(
  draft: RuleDraft,
  transactions: readonly ImpactRow[],
  codeOf: (index: number) => string | null,
): RuleImpact {
  const keyword = matchText(draft.keyword.trim());
  const account = draft.account.trim();
  const code = draft.code.trim();
  const where = whereOf(draft);
  let matches = 0;
  let stolen = 0;

  // The same test the engine will apply, on the same folded spelling. A count
  // offered before saving has to be the count that happens after it: this
  // figure once promised 584 lines and delivered 413, because it was matching
  // by one rule and the engine by another.
  const holds = (value: string | undefined, wanted: string | undefined): boolean =>
    wanted === undefined || matchText(value ?? "").includes(matchText(wanted));
  // Matched as a number, the same way the engine does: a folded comparison
  // would let 0011 match 00110.
  const sameAccount = (value: string | undefined, wanted: string | undefined): boolean =>
    wanted === undefined ||
    normaliseAccountNumber(value ?? "") === normaliseAccountNumber(wanted);

  transactions.forEach((transaction, index) => {
    if (account !== "" && transaction.account !== account) return;
    if (keyword !== "" && !matchText(transaction.text).includes(keyword)) return;
    if (
      where !== undefined &&
      !(
        holds(transaction.otherParty, where.otherParty) &&
        holds(transaction.particulars, where.particulars) &&
        holds(transaction.code, where.code) &&
        holds(transaction.reference, where.reference) &&
        sameAccount(transaction.otherPartyAccount, where.otherPartyAccount)
      )
    ) {
      return;
    }
    matches += 1;
    const current = codeOf(index);
    if (current !== null && current !== code) stolen += 1;
  });

  return { matches, stolen };
}
