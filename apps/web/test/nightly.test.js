import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

/**
 * The morning run is the page's own code, bundled to run with no page. These
 * build it the way apps/web/nightly.js does and run it on invented books, so
 * a change that reaches for the page from code the morning uses -- document,
 * a window, a save -- fails here rather than at six in the morning.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = mkdtempSync(join(tmpdir(), "nzosa-nightly-"));
const bundle = join(out, "nightly-run.mjs");
await build({
  entryPoints: [join(root, "src", "nightly-run.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: ["node20"],
  define: { __NZOSA_EDITION__: '"nz"' },
  outfile: bundle,
  logLevel: "silent",
});
test.after(() => rmSync(out, { recursive: true, force: true }));

let fresh = 0;
/** A fresh copy each time: the run keeps its state in the module. */
async function run(input) {
  fresh += 1;
  const { morningRun } = await import(`${pathToFileURL(bundle).href}?n=${fresh}`);
  return morningRun(input);
}

const chart = [
  { code: "200", name: "Sales", type: "Revenue", taxCode: "15% GST on Income", description: "" },
  { code: "429", name: "General Expenses", type: "Overhead", taxCode: "15% GST on Expenses", description: "" },
  { code: "449", name: "Motor Vehicle Expenses", type: "Overhead", taxCode: "15% GST on Expenses", description: "" },
  { code: "489", name: "Telephone & Internet", type: "Overhead", taxCode: "15% GST on Expenses", description: "" },
];

function line(id, date, amount, otherParty) {
  return {
    id, date, amount, currency: "NZD", account: "12-3456-7890123-00", serial: "", trn: "",
    particulars: "", code: "", reference: "", otherParty, origin: "", type: "", batch: "",
    otherPartyAccount: "", occurrence: 1,
  };
}

function parts(transactions) {
  return {
    decisions: { version: 1, data: { chart } },
    transactions: { version: 1, data: transactions },
    rules: { version: 1, data: {} },
  };
}

test("fuel and a phone plan are suggested from the list of known businesses, with no AI", async () => {
  const result = await run({
    parts: parts([
      line("a1", "2026-05-02", -6150, "Z RIMU"),
      line("a2", "2026-05-03", -4500, "SPARK NZ"),
      line("a3", "2026-05-04", -1200, "KOWHAI CAFE"),
    ]),
    maxLines: 200,
  });
  const byId = new Map(result.suggestions.map((s) => [s.id, s.code]));
  assert.match(byId.get("a1") ?? "", /449/);
  assert.match(byId.get("a2") ?? "", /489/);
  assert.equal(byId.has("a3"), false, "an unknown cafe is left for the AI or a person");
  assert.equal(result.added, 0);
});

test("the feed's new lines are seen as waiting, the AI asked about them, and nothing written", async () => {
  let asked = "";
  const result = await run({
    parts: parts([line("a1", "2026-05-02", -6150, "Z RIMU")]),
    feed: {
      links: { acc_totara: "12-3456-7890123-00" },
      fetch: async () => [
        { _id: "trans_1", _account: "acc_totara", date: "2026-05-06T00:00:00Z", description: "TOTARA TRADING", amount: -88 },
        { _id: "trans_2", _account: "acc_other", date: "2026-05-06T00:00:00Z", description: "NOT OURS", amount: -5 },
      ],
    },
    ask: async (prompt) => {
      asked = prompt;
      const id = /"id": "([^"]+)"/.exec(prompt.slice(prompt.indexOf("Transactions to code")))?.[1];
      return { text: JSON.stringify([{ id, code: "429", confidence: 0.7, because: "supplies" }]) };
    },
    maxLines: 200,
  });
  assert.equal(result.added, 1, "the linked account's line, not the other");
  assert.equal(result.items.length, 2, "the inbox keeps what the bank gave, as it gave it");
  assert.ok(asked.includes("TOTARA TRADING"));
  assert.ok(!asked.includes('"payee": "Z RIMU"'), "a line the list answered is not paid for again");
  assert.ok(result.suggestions.some((s) => /429/.test(s.code) && s.because === "supplies"));
});

test("at most the lines allowed are asked about", async () => {
  const many = Array.from({ length: 30 }, (_, i) =>
    line(`m${i}`, `2026-06-${String((i % 28) + 1).padStart(2, "0")}`, -(1000 + i), `KOWHAI SUPPLIER ${i}`),
  );
  let asking = 0;
  await run({
    parts: parts(many),
    ask: async (_prompt, count) => {
      asking += count;
      return { text: "[]" };
    },
    maxLines: 12,
  });
  assert.equal(asking, 12);
});
