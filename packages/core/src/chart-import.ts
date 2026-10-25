import type { Account } from "./chart.js";

/**
 * Bringing accounts into a chart that already has some: from a CSV (Xero's
 * layout, which this app also writes) or from hledger's account list.
 *
 * Worked out first and shown, then applied only when asked: a dry run. What
 * is applied only adds and updates, never removes -- an account left out of a
 * file is an account the file did not mention, not one to delete, and deleting
 * would lose what was coded to it. A different name on the same code is said
 * and left alone: renaming is done on the account itself, where the codings
 * that name it move with it.
 */

/** Read hledger's accounts: `account` directives from a journal, or the output of `hledger accounts`. */
export function parseHledgerAccounts(text: string): { accounts: Account[]; problems: string[] } {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const directives = lines.filter((l) => /^account\s+\S/.test(l));
  const problems: string[] = [];
  const found: { name: string; type?: string }[] = [];
  if (directives.length > 0) {
    for (const line of directives) {
      // `account assets:bank:checking   ; type: C` -- the name ends at two spaces or a comment.
      const body = line.replace(/^account\s+/, "");
      const name = body.split(/\s{2,}|\t|;/)[0]?.trim() ?? "";
      const tag = /;.*\btype:\s*([A-Za-z]+)/.exec(body)?.[1];
      if (name !== "") found.push({ name, ...(tag !== undefined ? { type: tag } : {}) });
    }
  } else {
    for (const raw of lines) {
      const name = raw.trim();
      if (name === "" || name.startsWith(";") || name.startsWith("#")) continue;
      if (!/^[^\s;][^;\t]*$/.test(name) || /\s{2,}/.test(name)) {
        problems.push(`not an account name: ${name.slice(0, 60)}`);
        continue;
      }
      found.push({ name });
    }
  }
  // A parent is only a heading when one of its own children is listed too.
  const names = new Set(found.map((f) => f.name));
  const accounts: Account[] = [];
  for (const f of found) {
    if ([...names].some((other) => other.startsWith(`${f.name}:`))) continue;
    const type = hledgerType(f.name, f.type);
    if (type === null) {
      problems.push(`${f.name}: not under assets, liabilities, equity, income or expenses, and no type: tag`);
      continue;
    }
    accounts.push({ code: "", name: hledgerName(f.name), type, taxCode: "", description: `hledger: ${f.name}` });
  }
  return { accounts, problems };
}

/** The name an hledger account takes: its path below the top level, words capitalised. */
function hledgerName(path: string): string {
  const parts = path.split(":").map((p) => p.trim()).filter((p) => p !== "");
  const below = parts.length > 1 ? parts.slice(1) : parts;
  return below.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(": ");
}

/** The chart type for an hledger account, from its type: tag, or from where it sits. */
function hledgerType(path: string, tag: string | undefined): string | null {
  const lower = path.toLowerCase();
  const top = lower.split(":")[0] ?? "";
  const letter = (tag ?? "").charAt(0).toUpperCase();
  const isAsset = letter === "A" || letter === "C" || (letter === "" && /^assets?$/.test(top));
  if (letter === "C" || (isAsset && /\b(bank|checking|cheque|savings|cash)\b/.test(lower))) return "Bank";
  if (isAsset) return /\b(fixed|equipment|vehicles?|plant|buildings?|furniture)\b/.test(lower) ? "Fixed Asset" : "Current Asset";
  if (letter === "L" || (letter === "" && /^liabilit(y|ies)$/.test(top))) {
    return /\b(loan|mortgage)\b/.test(lower) ? "Non-current Liability" : "Current Liability";
  }
  if (letter === "E" || (letter === "" && top === "equity")) return "Equity";
  if (letter === "R" || (letter === "" && /^(income|revenues?)$/.test(top))) return "Revenue";
  if (letter === "X" || (letter === "" && /^expenses?$/.test(top))) return "Expense";
  return null;
}

/** Where a new account of each type is numbered from, as the usual charts here number them. */
const CODE_RANGES: readonly (readonly [RegExp, number, number])[] = [
  [/^(revenue|sales|other income)$/i, 200, 299],
  [/^(direct costs)$/i, 300, 399],
  [/^(expense|overhead)$/i, 400, 599],
  [/^(current asset|inventory|prepayment)$/i, 600, 699],
  [/^(fixed asset|non-current asset)$/i, 700, 799],
  [/^(current liability)$/i, 800, 899],
  [/^(non-current liability|liability)$/i, 900, 949],
  [/^(equity)$/i, 950, 999],
];

/** Types that are the same kind of account under different names: an expense is an overhead. */
function family(type: string): string {
  const t = type.trim().toLowerCase();
  if (/^(revenue|sales|other income)$/.test(t)) return "income";
  if (/^(expense|overhead|direct costs)$/.test(t)) return "expense";
  return t;
}

function commonest(counts: Map<string, number> | undefined): string {
  if (counts === undefined) return "";
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "";
}

/**
 * The tax code most of a chart's accounts of each kind carry: what a new one
 * of that kind is given. Expenses, overheads and direct costs count as one
 * kind, and so do revenue, sales and other income.
 */
export function usualTaxCodes(chart: readonly Account[]): (type: string) => string {
  const byType = new Map<string, Map<string, number>>();
  const byFamily = new Map<string, Map<string, number>>();
  const add = (map: Map<string, Map<string, number>>, key: string, code: string): void => {
    const counts = map.get(key) ?? new Map<string, number>();
    counts.set(code, (counts.get(code) ?? 0) + 1);
    map.set(key, counts);
  };
  for (const a of chart) {
    if (a.taxCode === "") continue;
    add(byType, a.type.toLowerCase(), a.taxCode);
    add(byFamily, family(a.type), a.taxCode);
  }
  // By the family first: a handful of accounts typed Expense say less than all the overheads beside them.
  return (type) => commonest(byFamily.get(family(type))) || commonest(byType.get(type.toLowerCase()));
}

/** The type a chart mostly uses for a family: Overhead where its expenses are overheads. */
function usualTypeIn(chart: readonly Account[], type: string): string {
  const counts = new Map<string, number>();
  for (const a of chart) if (family(a.type) === family(type)) counts.set(a.type, (counts.get(a.type) ?? 0) + 1);
  return commonest(counts) || type;
}

export interface ChartChange {
  before: Account;
  after: Account;
  /** What changes: "type", "tax code", "description", "GST treatment", "parent". */
  fields: string[];
}

export interface ChartImportPlan {
  add: Account[];
  change: ChartChange[];
  /** The same code under another name: said, not applied. */
  renamed: { code: string; held: string; file: string }[];
  unchanged: number;
  /** Accounts given a code because the file had none for them. */
  coded: string[];
  problems: string[];
}

const plain = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** What bringing these accounts in would do to the chart, without doing it. */
export function chartImportPlan(
  existing: readonly Account[],
  incoming: readonly Account[],
  options: {
    taxCodeFor?: (type: string) => string;
    /**
     * The types were worked out rather than stated, as hledger's are: an
     * existing account's type is then left alone, and a new one takes the
     * type the chart uses for its kind.
     */
    inferredTypes?: boolean;
  } = {},
): ChartImportPlan {
  const plan: ChartImportPlan = { add: [], change: [], renamed: [], unchanged: 0, coded: [], problems: [] };
  const byCode = new Map(existing.filter((a) => a.code !== "").map((a) => [a.code, a]));
  // A name can belong to several accounts, one an entity: such a name matches none of them.
  const byName = new Map<string, Account[]>();
  for (const a of existing) byName.set(plain(a.name), [...(byName.get(plain(a.name)) ?? []), a]);
  // Numbers in use, an entity's suffix aside: 200KC takes 200.
  const taken = new Set(existing.map((a) => /^\d+/.exec(a.code)?.[0] ?? a.code).filter((c) => c !== ""));
  const seenCodes = new Set<string>();
  const seenNames = new Set<string>();

  for (const given of incoming) {
    let raw = given;
    const name = raw.name.trim();
    if (name === "") continue;
    if (raw.code !== "" && seenCodes.has(raw.code)) {
      plan.problems.push(`${raw.code} is in the file twice; the second (${name}) is left out`);
      continue;
    }
    // With a code, the code is what identifies it; a name alone must be unique.
    if (raw.code === "" && seenNames.has(plain(name))) {
      plan.problems.push(`${name} is in the file twice; the second is left out`);
      continue;
    }
    if (raw.code !== "") seenCodes.add(raw.code);
    else seenNames.add(plain(name));

    const named = raw.code === "" ? (byName.get(plain(name)) ?? []) : [];
    if (named.length > 1) {
      plan.problems.push(`${name} is the name of ${named.length} accounts here (${named.map((a) => a.code).join(", ")}); give it a code to say which`);
      continue;
    }
    const held = raw.code !== "" ? byCode.get(raw.code) : named[0];
    if (held === undefined) {
      if (options.inferredTypes === true) raw = { ...raw, type: usualTypeIn(existing, raw.type) };
      let code = raw.code;
      if (code === "" && raw.type !== "Bank") {
        const range = CODE_RANGES.find(([type]) => type.test(raw.type));
        if (range !== undefined) {
          for (let n = range[1]; n <= range[2]; n += 1) {
            const candidate = String(n);
            if (!taken.has(candidate)) {
              code = candidate;
              break;
            }
          }
        }
        if (code === "") plan.problems.push(`${name}: no code free for a ${raw.type} account; added without one`);
        else plan.coded.push(`${name} (${code})`);
      }
      if (code !== "") taken.add(code);
      const taxCode = raw.taxCode !== "" ? raw.taxCode : (options.taxCodeFor?.(raw.type) ?? "");
      plan.add.push({ ...raw, code, name, taxCode });
      continue;
    }

    if (raw.code !== "" && held.code === raw.code && plain(held.name) !== plain(name)) {
      plan.renamed.push({ code: raw.code, held: held.name, file: name });
    }
    // Only what the file says: an empty cell is a column the file did not fill in.
    const after: Account = { ...held };
    const fields: string[] = [];
    if (raw.type !== "" && raw.type !== held.type && options.inferredTypes !== true) {
      after.type = raw.type;
      fields.push("type");
    }
    if (raw.taxCode !== "" && raw.taxCode !== held.taxCode) {
      after.taxCode = raw.taxCode;
      fields.push("tax code");
    }
    if (raw.description !== "" && raw.description !== held.description && !raw.description.startsWith("hledger: ")) {
      after.description = raw.description;
      fields.push("description");
    }
    if (raw.gstTreatment !== undefined && raw.gstTreatment !== (held.gstTreatment ?? "")) {
      after.gstTreatment = raw.gstTreatment;
      fields.push("GST treatment");
    }
    if (raw.parent !== undefined && raw.parent !== (held.parent ?? "")) {
      after.parent = raw.parent;
      fields.push("parent");
    }
    if (fields.length === 0) plan.unchanged += 1;
    else plan.change.push({ before: held, after, fields });
  }
  return plan;
}

/** The chart with a plan applied: changes in place, additions at the end, nothing removed. */
export function applyChartPlan(existing: readonly Account[], plan: ChartImportPlan): Account[] {
  const changed = new Map(plan.change.map((c) => [c.before, c.after]));
  return [...existing.map((a) => changed.get(a) ?? a), ...plan.add];
}
