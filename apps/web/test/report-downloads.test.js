import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

/**
 * Download CSV on Reports. Every report either has a download of its own or
 * hides the button: none falls through to the profit and loss, which is what
 * eleven of them did, each saving a P&L under its own name.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = mkdtempSync(join(tmpdir(), "nzosa-report-downloads-"));
const bundle = join(out, "report-downloads.mjs");
await build({
  entryPoints: [join(root, "src", "daily", "report-downloads.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: bundle,
  logLevel: "silent",
});
test.after(() => rmSync(out, { recursive: true, force: true }));
const { REPORT_DOWNLOADS, hasDownload } = await import(pathToFileURL(bundle).href);

/** Every report a person can choose: the page's list, other countries' forms, and Agents. */
function reportKinds() {
  const html = readFileSync(join(root, "public", "index.html"), "utf8");
  const select = html.slice(html.indexOf('<select id="report-kind">'), html.indexOf("</select>", html.indexOf('<select id="report-kind">')));
  const kinds = [...select.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
  const country = readFileSync(join(root, "src", "daily", "country-reports.ts"), "utf8");
  const table = country.slice(country.indexOf("COUNTRY_REPORTS"), country.indexOf("export function addCountryReports"));
  kinds.push(...[...table.matchAll(/\["([a-z]+)", "/g)].map((m) => m[1]));
  kinds.push("agents");
  return kinds;
}

/** Reports with nothing to save as a file of their own. */
const NO_DOWNLOAD = new Set([
  "home",
  "balancesheet",
  "cashflow",
  "shareholders",
  "ir10",
  "manual",
  "yearend",
  "between",
  "charts",
  "agents",
  "schedulee",
  "schedulec",
  "contractors",
  "ustax",
  "salestax",
  "payrolltax",
  "budget",
  "byclass",
  "aurental",
  "bas",
  "krbusiness",
  "krrental",
  "krvat",
  "autax",
  "krtax",
  // Moves lines; there is nothing to save as a file.
  "reclassify",
]);

test("every report kind either has a download or hides the button", () => {
  const kinds = reportKinds();
  assert.ok(kinds.includes("pl") && kinds.includes("krtax"), "the report list was read");
  for (const kind of kinds) {
    if (hasDownload(kind)) assert.ok(!NO_DOWNLOAD.has(kind), `${kind} is in both lists`);
    else assert.ok(NO_DOWNLOAD.has(kind), `${kind} has no download and is not listed as having none`);
  }
  for (const kind of Object.keys(REPORT_DOWNLOADS)) assert.ok(kinds.includes(kind), `${kind} is not a report`);
});

test("the eleven that fell through to the P&L", () => {
  assert.equal(REPORT_DOWNLOADS.general, "General ledger");
  assert.equal(REPORT_DOWNLOADS.journal, "General ledger");
  assert.equal(REPORT_DOWNLOADS.extract, "Account transactions");
  for (const kind of ["balancesheet", "cashflow", "shareholders", "ir10", "manual", "yearend", "between", "charts"]) {
    assert.equal(hasDownload(kind), false, kind);
  }
  assert.equal(hasDownload("toString"), false);
});

test("the page hides the button by the same table, and only pl saves a P&L", () => {
  const source = readFileSync(join(root, "src", "daily", "reports.ts"), "utf8");
  assert.match(source, /\$\("report-download"\)\.hidden = !hasDownload\(/);
  const calls = [...source.matchAll(/downloadProfitAndLoss\(\)/g)];
  assert.equal(calls.length, 2, "defined once, called once");
  assert.match(source, /pl: \(\) => downloadProfitAndLoss\(\),/);
  assert.equal([...source.matchAll(/formatProfitAndLoss\(/g)].length, 1);
});
