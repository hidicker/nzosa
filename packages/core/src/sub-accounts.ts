/**
 * Sub-accounts: an account set under another -- Motor vehicle: fuel, under
 * Motor vehicle -- so a report can show the detail and the total of the group.
 *
 * One level only. A sub-account names its parent by code; the parent is an
 * ordinary account, posted to or not. Nothing is posted differently: the
 * report only orders the lines and adds a total under each group.
 */

/** A row of a report set out with sub-accounts. */
export type NestedRow<T> =
  | { kind: "line"; item: T; sub: boolean }
  /** A parent with nothing posted to it itself, heading its sub-accounts. */
  | { kind: "heading"; code: string }
  /** After a group: the parent and its sub-accounts together. */
  | { kind: "total"; code: string; items: T[] };

/**
 * Lines in their order, each sub-account moved under its parent, and a total
 * after each parent that has any. `codeOf` is a line's account code;
 * `parentOf` a code's parent's code, if it is a sub-account.
 */
export function nestSubAccounts<T>(
  items: readonly T[],
  codeOf: (item: T) => string,
  parentOf: (code: string) => string | undefined,
): NestedRow<T>[] {
  const present = new Set(items.map(codeOf));
  const childrenOf = new Map<string, T[]>();
  for (const item of items) {
    const parent = parentOf(codeOf(item));
    if (parent === undefined || parent === codeOf(item)) continue;
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), item]);
  }
  const placed = new Set<string>();
  const out: NestedRow<T>[] = [];
  const group = (code: string, parent: T | undefined): void => {
    if (placed.has(code)) return;
    placed.add(code);
    const children = childrenOf.get(code) ?? [];
    if (parent !== undefined) out.push({ kind: "line", item: parent, sub: false });
    else out.push({ kind: "heading", code });
    for (const child of children) out.push({ kind: "line", item: child, sub: true });
    if (children.length > 0) out.push({ kind: "total", code, items: parent !== undefined ? [parent, ...children] : children });
  };
  for (const item of items) {
    const code = codeOf(item);
    const parent = parentOf(code);
    if (parent !== undefined && parent !== code && childrenOf.has(parent)) {
      // A sub-account comes with its parent, wherever the parent falls; one
      // whose parent has nothing of its own brings a heading in its place.
      if (!present.has(parent)) group(parent, undefined);
      continue;
    }
    group(code, item);
  }
  return out;
}
