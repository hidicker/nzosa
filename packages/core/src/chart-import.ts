import type { Account } from "./chart.js";
import { parseChartOfAccounts } from "./chart.js";
import { parseCsvRecords } from "./csv.js";

/**
 * Bringing accounts into a chart that already has some, from a file: this
 * app's or Xero's chart, any spreadsheet with a code, a name and a type, or
 * hledger's account list. Worked out first as a plan -- what would be added,
 * what would change -- so nothing moves until the person has read it.
 */

export interface ChartFileResult {
  accounts: Account[];
  /** What the file was read as, in words. */
  read: string;
  problems: string[];
}

const plain = (s: string): string => s.replace(/^\*/, "").replace(/\s+/g, " ").trim().toLowerCase();

/** hledger's account types by letter: A L E R X C V. */
const HLEDGER: Record<string, string> = {
  A: "Current Asset",
  C: "Bank",
  L: "Current Liability",
  E: "Equity",
  R: "Revenue",
  X: "Expense",
  V: "Equity",
};

/** A type from an account's top level, where the file did not give one. */
function typeFromTop(full: string): string {
  const top = (full.split(":")[0] ?? "").trim().toLowerCase();
  if (/^assets?$/.test(top)) return /bank|cheque|checking|savings|cash/i.test(full) ? "Bank" : "Current Asset";
  if (/^liabilit/.test(top)) return "Current Liability";
  if (/^equity/.test(top)) return "Equity";
  if (/^(income|revenues?)$/.test(top)) return "Revenue";
  if (/^expenses?$/.test(top)) return "Expense";
  return "";
}

/** An account's name from its path, without the top level: "Auto: Fuel". */
function shortName(full: string): string {
  const parts = full.split(":").map((p) => p.trim()).filter((p) => p !== "");
  return (parts.length > 1 ? parts.slice(1) : parts).join(": ");
}

/**
 * hledger's accounts: `account` directives in a journal, or what
 * `hledger accounts --types` prints. A type comment (`; type: X`) is used
 * where there is one.
 */
export function parseHledgerAccounts(text: string): Account[] {
  const out: Account[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    // Indented lines are a transaction's postings; dated ones start one.
    if (raw.trim() === "" || /^\s/.test(raw) || /^\d/.test(raw)) continue;
    const directive = /^account\s+/.test(raw);
    const body = directive ? raw.replace(/^account\s+/, "") : raw;
    if (!directive && /^(commodity|include|alias|payee|tag|decimal-mark|year|[PDYN~=])(\s|$)/.test(body)) continue;
    // The name runs to two spaces, a tab or a comment; a type may follow.
    const cut = body.search(/ {2,}|\t|;/);
    const full = (cut < 0 ? body : body.slice(0, cut)).trim();
    const rest = cut < 0 ? "" : body.slice(cut);
    if (full === "" || (!directive && !full.includes(":") && typeFromTop(full) === "")) continue;
    const letter = /type:\s*([ALERXCV])\b/i.exec(rest)?.[1]?.toUpperCase();
    const type = (letter !== undefined ? HLEDGER[letter] : undefined) ?? typeFromTop(full);
    const name = shortName(full);
    if (name === "" || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push({ code: "", name, type, taxCode: "", description: `hledger ${full}` });
  }
  return out;
}

/** A chart from a file, whichever kind it is. */
export function readChartFile(text: string): ChartFileResult {
  const ours = parseChartOfAccounts(text);
  if (ours.accounts.length > 0) {
    return { accounts: ours.accounts, read: "a chart of accounts", problems: ours.problems.map((p) => `Line ${p.line}: ${p.message}`) };
  }
  // Any spreadsheet with a name, and a code or a type.
  const records = parseCsvRecords(text);
  const head = records.findIndex((r) => {
    const cells = r.fields.map(plain);
    return cells.some((c) => c === "name" || c === "account name") && cells.some((c) => /^(code|account code|number|account number|type|account type)$/.test(c));
  });
  if (head >= 0) {
    const cells = records[head]!.fields.map(plain);
    const at = (...names: string[]): number => cells.findIndex((c) => names.includes(c));
    const code = at("code", "account code", "number", "account number");
    const name = at("name", "account name");
    const type = at("type", "account type");
    const tax = at("tax code", "tax", "gst");
    const description = at("description");
    const accounts: Account[] = [];
    for (const r of records.slice(head + 1)) {
      const get = (i: number): string => (i < 0 ? "" : (r.fields[i] ?? "").trim());
      if (get(name) === "") continue;
      accounts.push({ code: get(code), name: get(name), type: get(type), taxCode: get(tax), description: get(description) });
    }
    if (accounts.length > 0) return { accounts, read: "a spreadsheet of accounts", problems: [] };
  }
  const ledger = parseHledgerAccounts(text);
  if (ledger.length > 0) return { accounts: ledger, read: "hledger's accounts", problems: [] };
  return { accounts: [], read: "", problems: ["No accounts could be read from this file."] };
}

export interface ChartPlan {
  added: Account[];
  /** A type or tax code the file gives differently. */
  changed: { before: Account; after: Account }[];
  /**
   * Named differently in the file. Not renamed: a coding names its account,
   * and a rename here would leave those codings pointing nowhere. Renaming is
   * done on the chart, which carries the codings with it.
   */
  named: { account: Account; fileName: string }[];
  /** Accounts in the file already in the chart as they are. */
  same: number;
}

/**
 * What bringing these accounts in would do. An account is the same one by
 * its code where both have a code, else by its name. A matched account takes
 * the file's type and tax code where the file gives them, and keeps
 * everything else it has, its name and code included. Nothing is taken out.
 */
export function chartImportPlan(current: readonly Account[], incoming: readonly Account[]): ChartPlan {
  const byCode = new Map(current.filter((a) => a.code.trim() !== "").map((a) => [a.code.trim().toLowerCase(), a]));
  const byName = new Map(current.map((a) => [a.name.trim().toLowerCase(), a]));
  const plan: ChartPlan = { added: [], changed: [], named: [], same: 0 };
  const touched = new Set<Account>();
  for (const one of incoming) {
    const code = one.code.trim().toLowerCase();
    const match = (code !== "" ? byCode.get(code) : undefined) ?? byName.get(one.name.trim().toLowerCase());
    if (match === undefined) {
      if (plan.added.some((a) => (code !== "" && a.code.trim().toLowerCase() === code) || a.name.trim().toLowerCase() === one.name.trim().toLowerCase())) continue;
      plan.added.push(one);
      continue;
    }
    if (touched.has(match)) continue;
    touched.add(match);
    if (one.name.trim() !== "" && one.name.trim().toLowerCase() !== match.name.trim().toLowerCase()) {
      plan.named.push({ account: match, fileName: one.name.trim() });
    }
    const after: Account = {
      ...match,
      ...(one.type.trim() !== "" ? { type: one.type.trim() } : {}),
      ...(one.taxCode.trim() !== "" ? { taxCode: one.taxCode.trim() } : {}),
    };
    if (after.type !== match.type || after.taxCode !== match.taxCode) {
      plan.changed.push({ before: match, after });
    } else {
      plan.same += 1;
    }
  }
  return plan;
}

/** The chart with a plan applied: changed accounts in their place, new ones after. */
export function applyChartPlan(current: readonly Account[], plan: ChartPlan): Account[] {
  const swap = new Map(plan.changed.map((c) => [c.before, c.after]));
  return [...current.map((a) => swap.get(a) ?? a), ...plan.added];
}
