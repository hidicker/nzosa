import type { Cents } from "./money.js";
import type { Transaction } from "./types.js";
import { normaliseAccountNumber } from "./accounts.js";
import type { CategoryRule, RuleSet } from "./rules.js";
import { categorise, ruleMatches } from "./rules.js";

/**
 * Learning coding rules from books that already exist.
 *
 * Nobody starts here with rules. They start with years of transactions someone
 * has already coded — in an accounting system, or in a spreadsheet — and the
 * only sensible way to begin is to read that work rather than ask them to
 * retype it as keywords.
 *
 * So: given bank lines paired with the account each was coded to, propose the
 * rules that would reproduce that coding. The user accepts or rejects each one,
 * and every proposal carries the evidence behind it — how many transactions it
 * saw, how many agreed, and what the competing answers were.
 *
 * Four things this gets right because they were got wrong first:
 *
 *  * **Restrict by account id, not by its label.** Three hundred and eighty-two
 *    hand-written rules in this project were restricted by account *name* and
 *    had therefore never fired once.
 *
 *  * **Require real evidence.** A rule built from one sighting is not a rule,
 *    it is that transaction wearing a hat. The spreadsheet this was rebuilt
 *    from had seven hundred rules, most firing once.
 *
 *  * **Conflicts need an account, not a guess.** The same insurer meant two
 *    different accounts depending on which bank account paid it. Where the
 *    evidence splits cleanly by account, say so; where it does not, leave it to
 *    a person.
 *
 *  * **Never take the first match.** Rank, always.
 */

export interface CodedExample {
  transaction: Transaction;
  /** The account this was coded to, in whatever vocabulary the source uses. */
  code: string;
}

export interface RuleProposal {
  rule: CategoryRule;
  /** Transactions this keyword matched, on this account if it is restricted. */
  seen: number;
  /** How many of those were coded the way this rule proposes. */
  agreed: number;
  /** Other accounts the same keyword was coded to, largest first. */
  competing: { code: string; count: number }[];
  /** A few of the bank lines behind it, so a person can recognise them. */
  examples: string[];
  /** Total value it covers, so the big ones can be reviewed first. */
  value: Cents;
}

export interface InferenceOptions {
  /** Fewest sightings before a pattern is worth calling a rule. Default 3. */
  minSightings?: number;
  /** How much of the evidence must agree, 0 to 1. Default 0.8. */
  minAgreement?: number;
  /**
   * Fewest payments to one counterparty account before it is worth a rule.
   * Default 1, lower than `minSightings` because an account number identifies
   * a counterparty exactly where a keyword only guesses at it.
   */
  minAccountSightings?: number;
  /** Priority to put on the proposed rules. Default 100. */
  priority?: number;
}

/**
 * A rule for one bank line that is sure to match that line.
 *
 * Built from `keywordFor`, matched in any order, and then tried on the line
 * it came from, dropping words from the end until it fits. A rule written from
 * a line that does not match that line is worse than no rule: it looks right
 * in the rules table and codes nothing. Null when nothing is left.
 */
export function ruleForLine(
  transaction: Transaction,
  code: string,
  priority = 100,
): CategoryRule | null {
  const words = keywordFor(transaction).split(" ").filter((w) => w !== "");
  while (words.length > 0) {
    const rule: CategoryRule = { priority, keyword: words.join(" "), anyOrder: true, code };
    if (ruleMatches(transaction, rule)) return rule;
    words.pop();
  }
  return null;
}

/**
 * The distinctive part of a bank line.
 *
 * A payee arrives with reference numbers, card suffixes and the bank's own
 * noise attached — `SP GARMIN 8004412075`, `TAUTAHI,MERE`. What identifies it
 * is the words, so the numbers go and what is left is the key.
 */
export function keywordFor(transaction: Transaction): string {
  const source =
    transaction.otherParty.trim() !== ""
      ? transaction.otherParty
      : transaction.particulars.trim() !== ""
        ? transaction.particulars
        : transaction.reference;

  const cleaned = source
    .toUpperCase()
    // Long digit runs are references, wherever they sit. `GOOGLE ADS1752102256`
    // has to become `GOOGLE ADS`, or the rule matches this charge and never
    // next month's.
    .replace(/[0-9]{3,}/g, " ")
    .replace(/\b[0-9][0-9A-Z-]{2,}\b/g, " ")
    .replace(/[^A-Z0-9&' -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Keep it long enough to be distinctive and short enough to generalise:
  // `DHL EXPRESS NZ LTD` should match `DHL EXPRESS NZ LTD 12345` too.
  const words = cleaned.split(" ").filter((w) => w.length > 1);
  return words.slice(0, 4).join(" ").trim();
}

/** One coded line of evidence: when, and to what. */
interface Sighting {
  date: string;
  code: string;
}

/** How many of the latest sightings decide a rule's account. */
const RECENT = 3;

/**
 * What the latest coding says, or null when it has not settled.
 *
 * The most recent lines decide, not the whole history: a payee coded one way
 * for two years and another way since is coded the new way from here on, and
 * a count across all of it let the old habit outvote the current one. The
 * latest few have to agree among themselves; where they do not, the coding
 * is still changing and there is no rule to make. Older lines coded some
 * other way stay as they were -- the caller keeps them -- and are reported
 * as the competing codes.
 */
function latestCoding(
  sightings: readonly Sighting[],
  minSightings: number,
  minAgreement: number,
): { code: string; agreed: number; competing: { code: string; count: number }[] } | null {
  if (sightings.length < minSightings) return null;
  const newest = [...sightings].sort((a, b) => b.date.localeCompare(a.date));
  const recent = newest.slice(0, Math.min(RECENT, newest.length));
  const code = recent[0]?.code;
  if (code === undefined) return null;
  const same = recent.filter((s) => s.code === code).length;
  if (same / recent.length < minAgreement) return null;
  const counts = new Map<string, number>();
  for (const s of sightings) counts.set(s.code, (counts.get(s.code) ?? 0) + 1);
  const competing = [...counts]
    .filter(([other]) => other !== code)
    .sort((a, b) => b[1] - a[1])
    .map(([other, count]) => ({ code: other, count }));
  return { code, agreed: counts.get(code) ?? 0, competing };
}

/**
 * Propose the rules that would reproduce an existing coding.
 *
 * Returns them strongest first — most transactions covered — because that is
 * the order in which reviewing them is worth someone's time.
 */
export function inferRules(
  examples: readonly CodedExample[],
  options: InferenceOptions = {},
): RuleProposal[] {
  const minSightings = options.minSightings ?? 3;
  const minAgreement = options.minAgreement ?? 0.8;
  const priority = options.priority ?? 100;
  // Fewer sightings are asked of a counterparty account than of a keyword,
  // because the evidence is a different kind. A keyword is a guess about which
  // words identify somebody -- it can be too broad, too narrow, or catch a
  // stranger with a similar name -- so it wants repetition before it is
  // trusted. An account number *is* the counterparty. Two payments to the same
  // account, coded the same way, is stronger evidence than three fuzzy
  // matches, and holding both to the same bar left real patterns unproposed.
  // One is enough: nothing is applied by proposing it, the evidence is shown
  // beside it, and a suggestion nobody accepts costs a glance.
  const minAccountSightings = options.minAccountSightings ?? 1;

  // What each keyword was coded to, and on which account.
  const byKeyword = new Map<
    string,
    {
      codes: Map<string, number>;
      sightings: Sighting[];
      accounts: Map<string, Sighting[]>;
      examples: string[];
      value: Cents;
    }
  >();

  /** The same evidence, gathered by the account paid to or received from. */
  const byOtherAccount = new Map<
    string,
    { sightings: Sighting[]; examples: string[]; value: Cents; shown: string }
  >();

  // Our own accounts, so a transfer between them never proposes a coding rule.
  // Money moving from one of your accounts to another is not a supplier.
  const ourAccounts = new Set(examples.map((e) => e.transaction.account));

  for (const example of examples) {
    if (example.code.trim() === "") continue;

    const other = normaliseAccountNumber(example.transaction.otherPartyAccount ?? "");
    if (other !== "" && !ourAccounts.has(other) && !ourAccounts.has(example.transaction.otherPartyAccount)) {
      const seen = byOtherAccount.get(other) ?? {
        sightings: [] as Sighting[],
        examples: [] as string[],
        value: 0,
        // Grouped on the normalised number so a padded suffix does not split
        // one counterparty in two, but written into the rule as the bank
        // spelt it -- a rule quoting a number nobody recognises is a rule
        // nobody can check.
        shown: (example.transaction.otherPartyAccount ?? "").trim(),
      };
      seen.sightings.push({ date: example.transaction.date, code: example.code });
      if (seen.examples.length < 3) {
        const line = [example.transaction.otherParty, example.transaction.particulars]
          .filter((p) => p.trim() !== "")
          .join(" · ");
        if (line !== "" && !seen.examples.includes(line)) seen.examples.push(line);
      }
      seen.value += Math.abs(example.transaction.amount);
      byOtherAccount.set(other, seen);
    }

    const keyword = keywordFor(example.transaction);
    if (keyword.length < 3) continue;

    const entry = byKeyword.get(keyword) ?? {
      codes: new Map<string, number>(),
      sightings: [] as Sighting[],
      accounts: new Map<string, Sighting[]>(),
      examples: [] as string[],
      value: 0,
    };
    entry.codes.set(example.code, (entry.codes.get(example.code) ?? 0) + 1);
    const sighting = { date: example.transaction.date, code: example.code };
    entry.sightings.push(sighting);

    const perAccount = entry.accounts.get(example.transaction.account) ?? [];
    perAccount.push(sighting);
    entry.accounts.set(example.transaction.account, perAccount);

    if (entry.examples.length < 3) {
      const line = [example.transaction.otherParty, example.transaction.particulars]
        .filter((p) => p.trim() !== "")
        .join(" · ");
      if (!entry.examples.includes(line)) entry.examples.push(line);
    }
    entry.value += Math.abs(example.transaction.amount);
    byKeyword.set(keyword, entry);
  }

  const proposals: RuleProposal[] = [];

  for (const [keyword, entry] of byKeyword) {
    // The latest coding across every account agrees: one unrestricted rule.
    const everywhere = latestCoding(entry.sightings, minSightings, minAgreement);
    if (everywhere !== null) {
      proposals.push({
        rule: { priority, keyword, anyOrder: true, code: everywhere.code },
        seen: entry.sightings.length,
        agreed: everywhere.agreed,
        competing: everywhere.competing,
        examples: entry.examples,
        value: entry.value,
      });
      continue;
    }

    // The evidence disagrees overall. It may still be consistent within each
    // bank account, which is the Tower Insurance case: the same payee meaning
    // one thing on the company's account and another on a personal one.
    for (const [account, perAccount] of entry.accounts) {
      const here = latestCoding(perAccount, minSightings, minAgreement);
      if (here === null) continue;

      proposals.push({
        // Restricted by account **id**, never by its label: a rule keyed on a
        // display name silently matches nothing.
        rule: { priority: priority + 100, keyword, anyOrder: true, account, code: here.code },
        seen: perAccount.length,
        agreed: here.agreed,
        competing: here.competing,
        examples: entry.examples,
        value: entry.value,
      });
    }
  }

  // Then the counterparty account, which the keyword pass cannot see.
  //
  // Some banks write the particulars into the payee, so every payment to one
  // supplier arrives under a different name and no keyword can gather them --
  // the accountant whose line reads "Accountant <name> <person> <job>", the
  // subcontractor whose reference changes every month. All of them name the
  // same account number, every time.
  for (const entry of byOtherAccount.values()) {
    const latest = latestCoding(entry.sightings, minAccountSightings, minAgreement);
    if (latest === null) continue;

    proposals.push({
      rule: { priority: priority + 50, where: { otherPartyAccount: entry.shown }, code: latest.code },
      seen: entry.sightings.length,
      agreed: latest.agreed,
      competing: latest.competing,
      examples: entry.examples,
      value: entry.value,
    });
  }

  // Most transactions first: reviewing is someone's time, and the big rules
  // are worth it.
  proposals.sort((a, b) => b.agreed - a.agreed || Math.abs(b.value) - Math.abs(a.value));
  return proposals;
}

/** Which transactions a set of proposals would still leave uncoded. */
export function coverage(
  transactions: readonly Transaction[],
  proposals: readonly RuleProposal[],
): { covered: number; total: number } {
  // Counted with the engine that will actually do the coding, rather than by
  // re-implementing the match.
  //
  // It used to compare a proposal's keyword against `keywordFor` -- the
  // stripped-down form used to *derive* a rule -- while the engine matches
  // against the whole of a line's text. The two disagree, so the figure
  // offered before accepting ("would code 584") was not the figure you got
  // after accepting (413). A promise about what a button will do has to be
  // made by asking the thing that does it.
  const ruleSet: RuleSet = { rules: proposals.map((p) => p.rule) };
  let covered = 0;
  for (const transaction of transactions) {
    if (categorise(transaction, ruleSet).code !== null) covered += 1;
  }
  return { covered, total: transactions.length };
}

export type AccountUse = "income" | "expense" | "mixed";

export interface AccountUsage {
  code: string;
  use: AccountUse;
  /** Money in, money out, and how many transactions. */
  received: Cents;
  paid: Cents;
  count: number;
  /** The account type to propose, in the chart's vocabulary. */
  proposedType: string;
}

/**
 * What an account appears to be, from how money moved through it.
 *
 * A spreadsheet gives a coded column and nothing else — no account types, no
 * GST treatments — and those are exactly what a profit figure and a return
 * need. They are inferable well enough to propose: an account that only ever
 * receives is income, one that only ever pays is a cost, and one that does both
 * in similar measure is neither, which usually means a transfer or a loan.
 *
 * Proposed, never assumed. Getting this wrong moves money between the profit
 * figure and the balance sheet, which is not a mistake to make quietly.
 */
export function inferAccountUsage(examples: readonly CodedExample[]): AccountUsage[] {
  const byCode = new Map<string, { received: Cents; paid: Cents; count: number }>();

  for (const example of examples) {
    if (example.code.trim() === "") continue;
    const entry = byCode.get(example.code) ?? { received: 0, paid: 0, count: 0 };
    if (example.transaction.amount > 0) entry.received += example.transaction.amount;
    else entry.paid += -example.transaction.amount;
    entry.count += 1;
    byCode.set(example.code, entry);
  }

  const out: AccountUsage[] = [];
  for (const [code, entry] of byCode) {
    const total = entry.received + entry.paid;
    const inward = total === 0 ? 0 : entry.received / total;

    // A clear majority one way is a real signal; anything near even is a
    // balance-sheet account wearing a coding.
    const use: AccountUse = inward >= 0.9 ? "income" : inward <= 0.1 ? "expense" : "mixed";
    out.push({
      code,
      use,
      received: entry.received,
      paid: entry.paid,
      count: entry.count,
      proposedType: use === "income" ? "Revenue" : use === "expense" ? "Overhead" : "",
    });
  }

  return out.sort((a, b) => b.count - a.count);
}
