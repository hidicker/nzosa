/**
 * Saving only what changed in a part of the books.
 *
 * Books kept online are saved a part at a time -- the codings, the history,
 * the bank lines -- and each part used to be sent whole on every change. A
 * tick on the Reconcile page changes a few hundred bytes, yet sent the whole
 * of the codings and the whole of the history: most of a megabyte in larger
 * books, which on a slow connection is the wait.
 *
 * So a save now sends a short list of changes instead, and the server applies
 * them to the part it already holds. What the server holds is still the whole
 * part, exactly as before; only the sending is smaller.
 *
 * The list is worked out against a copy of what the server was last known to
 * hold (`PartCopy`). The copy is text, not the objects themselves: the app
 * changes some objects in place, and a copy sharing them would change along
 * with them and hide the very change it was kept to find.
 *
 * Three kinds of change, two levels deep at most:
 *
 * - `set`: a key, or a key inside a key (`overrides` → one line), takes a value.
 * - `del`: a key, or a key inside a key, is removed.
 * - `splice`: a list (the part itself, or a list kept under one key) has
 *   `remove` items taken out at `at` and `insert` put in their place.
 *
 * The database applies the same three (`apply_part_ops`), and `applyPartOps`
 * here is the same rules written for the tests to hold the two together.
 */

export type PartOp =
  | { set: [string] | [string, string]; value: unknown }
  | { del: [string] | [string, string] }
  | { splice: [] | [string]; at: number; remove: number; insert: unknown[] };

/** What the server was last known to hold, as text, for comparing. */
export type PartCopy =
  | { t: "leaf"; json: string }
  | { t: "obj"; keys: Map<string, PartCopy> }
  | { t: "arr"; items: string[] };

/** How deep a part is compared: the part, then one level of keys inside it. */
const DEPTH = 2;

function plainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { toJSON?: unknown }).toJSON !== "function"
  );
}

/** JSON as the server would store it; what JSON leaves out is "absent". */
function text(value: unknown): string | undefined {
  return JSON.stringify(value) as string | undefined;
}

/** An item of a list, as JSON writes one: what it cannot write becomes null. */
function itemText(value: unknown): string {
  return text(value) ?? "null";
}

/** The copy of a value, to compare a later one against. */
export function partCopy(value: unknown, depth = DEPTH): PartCopy {
  if (depth > 0 && Array.isArray(value)) return { t: "arr", items: value.map(itemText) };
  if (depth > 0 && plainObject(value)) {
    const keys = new Map<string, PartCopy>();
    for (const [key, item] of Object.entries(value)) {
      if (text(item) === undefined) continue;
      keys.set(key, partCopy(item, depth - 1));
    }
    return { t: "obj", keys };
  }
  return { t: "leaf", json: text(value) ?? "null" };
}

/** Roughly how many characters a copy stands for: the size of a whole save. */
export function copySize(copy: PartCopy): number {
  if (copy.t === "leaf") return copy.json.length;
  if (copy.t === "arr") return copy.items.reduce((sum, item) => sum + item.length + 1, 2);
  let sum = 2;
  for (const [key, item] of copy.keys) sum += key.length + 4 + copySize(item);
  return sum;
}

export interface PartChanges {
  ops: PartOp[];
  /** The copy of the new value, to keep once the server has it. */
  copy: PartCopy;
}

/**
 * The changes that turn what the server holds (`before`) into `value`.
 *
 * Null where the part has changed shape (a list where there was a key-value
 * part), which only a whole save can say.
 */
export function partChanges(before: PartCopy, value: unknown): PartChanges | null {
  const copy = partCopy(value);
  if (before.t !== copy.t) return null;
  if (copy.t === "leaf") return before.t === "leaf" && before.json === copy.json ? { ops: [], copy } : null;
  const ops: PartOp[] = [];
  if (copy.t === "arr" && before.t === "arr") {
    listOps(before.items, copy.items, value as unknown[], [], 0, true, ops);
    return { ops, copy };
  }
  if (copy.t !== "obj" || before.t !== "obj") return null;
  const values = value as Record<string, unknown>;
  for (const [key, now] of copy.keys) {
    const was = before.keys.get(key);
    if (was === undefined || was.t !== now.t) {
      ops.push({ set: [key], value: values[key] });
      continue;
    }
    if (now.t === "leaf") {
      if (was.t === "leaf" && was.json !== now.json) ops.push({ set: [key], value: values[key] });
      continue;
    }
    if (now.t === "arr" && was.t === "arr") {
      listOps(was.items, now.items, values[key] as unknown[], [key], 0, true, ops);
      continue;
    }
    if (now.t === "obj" && was.t === "obj") {
      const inner = values[key] as Record<string, unknown>;
      for (const [sub, item] of now.keys) {
        const old = was.keys.get(sub);
        if (old === undefined || old.t !== "leaf" || item.t !== "leaf" || old.json !== item.json) {
          ops.push({ set: [key, sub], value: inner[sub] });
        }
      }
      for (const sub of was.keys.keys()) if (!now.keys.has(sub)) ops.push({ del: [key, sub] });
    }
  }
  for (const key of before.keys.keys()) if (!copy.keys.has(key)) ops.push({ del: [key] });
  return { ops, copy };
}

/** Few enough single-item changes to send one at a time. */
const SCATTERED = 20;

/** How far into the new list to look for where the old one now starts. */
const LOOK_AHEAD = 500;

/**
 * Changes to one list, for the stretch of it from `base` on.
 *
 * The history is the list that matters: a new entry goes on the front, the
 * oldest falls off the end once there are too many, and an undo marks one
 * entry in the middle. Each is a splice or two rather than the whole list.
 */
function listOps(
  before: readonly string[],
  after: readonly string[],
  values: readonly unknown[],
  path: [] | [string],
  base: number,
  lookAhead: boolean,
  ops: PartOp[],
): void {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  if (start === before.length && start === after.length) return;
  let end = 0;
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  ) {
    end++;
  }

  // Something put on the front, and something taken off the end: neither
  // end matches, but the old list is there further in.
  if (lookAhead && start === 0 && end === 0 && before.length > 0) {
    const limit = Math.min(after.length, LOOK_AHEAD);
    let found = -1;
    for (let i = 1; i < limit; i++) {
      if (after[i] === before[0]) {
        found = i;
        break;
      }
    }
    if (found > 0) {
      let run = 0;
      while (run < before.length && found + run < after.length && before[run] === after[found + run]) run++;
      ops.push({ splice: path, at: base, remove: 0, insert: values.slice(0, found) });
      listOps(before.slice(run), after.slice(found + run), values.slice(found + run), path, base + found + run, false, ops);
      return;
    }
  }

  const oldMiddle = before.length - end - start;
  const newMiddle = after.length - end - start;
  if (oldMiddle === newMiddle) {
    const changed: number[] = [];
    for (let i = start; i < start + oldMiddle && changed.length <= SCATTERED; i++) {
      if (before[i] !== after[i]) changed.push(i);
    }
    if (changed.length <= SCATTERED) {
      for (const i of changed) ops.push({ splice: path, at: base + i, remove: 1, insert: [values[i]] });
      return;
    }
  }
  ops.push({ splice: path, at: base + start, remove: oldMiddle, insert: values.slice(start, start + newMiddle) });
}

/**
 * Apply changes to a part, as the database does.
 *
 * For the tests, and for anything that must know what the server now holds.
 * The value given is not changed.
 */
export function applyPartOps(value: unknown, ops: readonly PartOp[]): unknown {
  let out: unknown = cloneJson(value);
  for (const op of ops) {
    if ("set" in op) {
      const root: Record<string, unknown> = plainObject(out) ? out : {};
      out = root;
      const [key, sub] = op.set;
      const item = cloneJson(op.value);
      if (sub === undefined) {
        root[key] = item;
      } else {
        if (!plainObject(root[key])) root[key] = {};
        (root[key] as Record<string, unknown>)[sub] = item;
      }
      continue;
    }
    if ("del" in op) {
      if (!plainObject(out)) continue;
      const [key, sub] = op.del;
      if (sub === undefined) delete out[key];
      else if (plainObject(out[key])) delete (out[key] as Record<string, unknown>)[sub];
      continue;
    }
    const insert = op.insert.map(cloneJson);
    const [key] = op.splice;
    if (key === undefined) {
      out = spliced(Array.isArray(out) ? out : [], op.at, op.remove, insert);
    } else {
      const root: Record<string, unknown> = plainObject(out) ? out : {};
      out = root;
      root[key] = spliced(Array.isArray(root[key]) ? (root[key] as unknown[]) : [], op.at, op.remove, insert);
    }
  }
  return out;
}

/** A list with a stretch replaced; past the end is at the end. */
function spliced(list: readonly unknown[], at: number, remove: number, insert: readonly unknown[]): unknown[] {
  return [...list.slice(0, at), ...insert, ...list.slice(at + remove)];
}

function cloneJson(value: unknown): unknown {
  const written = text(value);
  return written === undefined ? null : (JSON.parse(written) as unknown);
}
