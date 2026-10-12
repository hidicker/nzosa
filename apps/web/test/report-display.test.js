import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

/** How the reports write money and name balance sheet rows. */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = mkdtempSync(join(tmpdir(), "nzosa-report-display-"));
const bundle = join(out, "entry.mjs");
await build({
  stdin: {
    contents:
      'export { booksMoney } from "./src/country.ts";\n' +
      'export { balanceSheetLabel } from "./src/daily/balance-sheet-label.ts";\n',
    resolveDir: root,
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  define: { __NZOSA_EDITION__: '"nz"' },
  outfile: bundle,
  logLevel: "silent",
});
test.after(() => rmSync(out, { recursive: true, force: true }));
const { booksMoney, balanceSheetLabel } = await import(pathToFileURL(bundle).href);

test("money is never shown as -0.00", () => {
  assert.equal(booksMoney(-0), "0.00");
  assert.equal(booksMoney(-(0)), "0.00");
  assert.equal(booksMoney(0), "0.00");
  assert.equal(booksMoney(-1), "-0.01");
  assert.equal(booksMoney(-123456), "-1,234.56");
  assert.equal(booksMoney(123456), "1,234.56");
});

test("a balance sheet row names its account once", () => {
  assert.equal(balanceSheetLabel({ code: "(uncoded)", name: "(uncoded)" }), "Not coded to an account yet");
  assert.equal(balanceSheetLabel({ code: "kea-card-4021", name: "kea-card-4021" }), "kea-card-4021");
  assert.equal(balanceSheetLabel({ code: "800", name: "Accounts Payable" }), "800 Accounts Payable");
  assert.equal(balanceSheetLabel({ code: "", name: "Retained earnings" }), "Retained earnings");
});
