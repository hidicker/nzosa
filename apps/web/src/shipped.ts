/**
 * The seed and demo files this copy of the app was built with.
 *
 * Books kept in a browser start from files shipped beside the app -- a demo's
 * invented books, or a `data/` folder somebody added -- and the page used to
 * ask for every file it might use, one 404 after another in the console for
 * each it did not ship. The build lists what it copied (build.js), and the
 * page asks only for those. Null when the list is not known (a development
 * server, a test bundle): then everything is asked for, as before.
 */
declare const __SHIPPED_FILES__: readonly string[] | null | undefined;

const files: ReadonlySet<string> | null =
  typeof __SHIPPED_FILES__ === "undefined" || __SHIPPED_FILES__ === null ? null : new Set(__SHIPPED_FILES__);

/** Whether a file beside the app (`demo/bank-card.csv`, `data/ledger.json`) is worth asking for. */
export function shipped(path: string): boolean {
  return files === null || files.has(path.replace(/^\.?\//, ""));
}
