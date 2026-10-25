import type { Account } from "./chart.js";

/**
 * Sub-accounts: an account set under another -- Vehicle: fuel, Vehicle:
 * insurance -- so a report can show the parent's total with its parts
 * beneath. One level only: a parent is not itself under anything, which
 * keeps every total one step from what it adds up. Nothing posts differently;
 * the parent's own postings, if it has any, are one of its parts.
 */

/** Why an account cannot go under another, or null when it can. */
export function parentProblem(chart: readonly Account[], child: Account, parentCode: string): string | null {
  if (parentCode === "") return null;
  if (parentCode === child.code) return "An account cannot be under itself.";
  const parent = chart.find((a) => a.code === parentCode);
  if (parent === undefined) return `No account ${parentCode} in the chart.`;
  if (parent.parent !== undefined && parent.parent !== "") return `${parent.name} is itself under another account; sub-accounts go one level deep.`;
  if (chart.some((a) => a.parent === child.code)) return `${child.name} has sub-accounts of its own, so it cannot go under another.`;
  return null;
}

export type NestedRow<L> =
  | { kind: "line"; line: L }
  | { kind: "parent"; code: string; label: string; total: number; children: L[] };

/**
 * Report lines set out with sub-accounts under their parents: a parent row
 * carrying the total of its parts, then each part. Lines whose account has
 * no parent, and parents with nothing beneath them, stay as they were. The
 * order is kept: a parent goes where its first part, or its own line, was.
 */
export function nestLines<L>(
  lines: readonly L[],
  parentOf: (line: L) => { code: string; label: string } | null,
  /** The code a line's own account has, so a parent's own postings are found. */
  codeOf: (line: L) => string,
  amountOf: (line: L) => number,
): NestedRow<L>[] {
  const groups = new Map<string, { label: string; children: L[] }>();
  for (const line of lines) {
    const parent = parentOf(line);
    if (parent === null) continue;
    const g = groups.get(parent.code) ?? { label: parent.label, children: [] };
    g.children.push(line);
    groups.set(parent.code, g);
  }
  const out: NestedRow<L>[] = [];
  const placed = new Set<string>();
  const place = (code: string): void => {
    if (placed.has(code)) return;
    placed.add(code);
    const g = groups.get(code)!;
    const own = lines.find((l) => codeOf(l) === code);
    const children = own === undefined ? g.children : [own, ...g.children];
    out.push({ kind: "parent", code, label: g.label, total: children.reduce((s, l) => s + amountOf(l), 0), children });
  };
  for (const line of lines) {
    const parent = parentOf(line);
    if (parent !== null) {
      place(parent.code);
      continue;
    }
    if (groups.has(codeOf(line))) {
      place(codeOf(line));
      continue;
    }
    out.push({ kind: "line", line });
  }
  return out;
}
