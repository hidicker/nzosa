/**
 * The morning run, on this computer.
 *
 *   node apps/web/nightly.js [--ledgers <folder>] [--ledger <name>] [--max 100]
 *
 * Run by the "NZOSA morning" scheduled task, which the app sets up when
 * "Ready every morning" is turned on. For each set of books with it on, it
 * checks the bank feed and suggests codes for the lines nothing has answered,
 * and leaves both beside the books in nightly.json. It puts nothing into the
 * books: the bank's new lines come in when the books are next opened, through
 * the same import as always, and the suggestions go on the lines they are for.
 *
 * It talks to the books' own server, as the page does -- the one already
 * running if the books are open, or one it starts for the minute it needs --
 * so the bank feed's tokens and the AI key stay where they always are, and the
 * AI's daily limit counts this too. What it runs is the page's own code,
 * bundled fresh each time (src/nightly-run.ts), so the morning and the page
 * cannot disagree about a line.
 *
 * Only ever on a key of the books' own: never the shared allowance.
 */
import { build } from "esbuild";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { heldBy, listLedgers, readLedger } from "./ledger-folder.js";
import { startServer } from "./server.js";

const root = dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : fallback;
};
const ledgerRoot = resolve(arg("--ledgers", join(root, "..", "..", "ledgers")));
const only = arg("--ledger", "");
const maxLines = Number(arg("--max", "100"));

function log(line) {
  const stamped = `${new Date().toISOString()} ${line}`;
  process.stdout.write(`${stamped}\n`);
  try {
    appendFileSync(join(ledgerRoot, ".nightly.log"), `${stamped}\n`);
  } catch {
    // The log is a convenience; the run does not depend on it.
  }
}

/** The page's code, bundled for Node. Fresh each run, so it is never stale. */
async function bundle() {
  const out = join(root, "dist-node", "nightly-run.mjs");
  mkdirSync(dirname(out), { recursive: true });
  await build({
    entryPoints: [join(root, "src", "nightly-run.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: ["node20"],
    define: { __NZOSA_EDITION__: JSON.stringify(process.env.NZOSA_EDITION ?? "nz") },
    outfile: out,
    logLevel: "warning",
  });
  return out;
}

/** The server for one set of books: the running one, or one of our own. */
async function serverFor(id) {
  const folder = join(ledgerRoot, id);
  const held = heldBy(folder);
  if (held !== null) {
    if (!held.port) throw new Error("open in an NZOSA too old to be asked; skipped until it is restarted");
    return { base: `http://127.0.0.1:${held.port}`, stop: () => {} };
  }
  const started = await startServer({ port: 0, ledgerRoot, ledgerId: id });
  return { base: `http://127.0.0.1:${started.port}`, stop: () => started.stop() };
}

async function api(base, path, init = {}) {
  const response = await fetch(`${base}/api/${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `${path} answered ${response.status}`);
  return body;
}

async function runOne(id, runner) {
  const folder = join(ledgerRoot, id);
  const { parts } = readLedger(folder);
  const decisions = parts.decisions?.data ?? {};
  if (decisions.nightly !== true && only === "") return;

  const server = await serverFor(id);
  try {
    const status = await api(server.base, "status");
    if (status.ledger !== id) throw new Error(`the running NZOSA has ${status.ledger} open, not ${id}`);

    const feed = await api(server.base, "feed");
    const ai = await api(server.base, "ai");
    const morning = await api(server.base, "nightly");
    const ownKey = ai.configured === true && decisions.aiEnabled === true;

    // A fresh copy of the code for each set of books: it keeps its state in
    // the module, and one set of books must never see another's.
    const { morningRun } = await import(`${pathToFileURL(runner).href}?books=${encodeURIComponent(id)}`);
    const result = await morningRun({
      parts,
      kept: morning.suggestions?.list ?? [],
      maxLines: Number.isInteger(maxLines) && maxLines >= 0 ? maxLines : 100,
      ...(morning.unsure !== undefined ? { unsure: morning.unsure } : {}),
      ...(feed.configured && feed.autoFetch !== false
        ? {
            feed: {
              links: feed.accounts ?? {},
              fetch: async (from) =>
                (await api(server.base, `feed/transactions${from === "" ? "" : `?start=${encodeURIComponent(from)}`}`)).items ?? [],
            },
          }
        : {}),
      ...(ownKey
        ? {
            ask: async (prompt, asking, asked) => {
              try {
                return await api(server.base, "ai/suggest", {
                  method: "POST",
                  body: JSON.stringify({ prompt, asking, ...(asked ?? {}) }),
                });
              } catch (error) {
                return { error: error.message };
              }
            },
          }
        : {}),
    });

    // What came in is added to anything still waiting from an earlier morning
    // nobody opened the books after, by the bank's own id.
    // Not what the books have taken in since: an inbox nobody opened the books after
    // would otherwise carry every old line forward, and grow.
    const inBooks = new Set((parts.transactions?.data ?? []).map((t) => t.extras?.akahuId).filter(Boolean));
    const waiting = (morning.inbox?.items ?? []).filter((item) => !inBooks.has(item._id));
    const seen = new Set(result.items.map((item) => item._id));
    const items = [...waiting.filter((item) => !seen.has(item._id)), ...result.items];
    const at = new Date().toISOString();
    await api(server.base, "nightly", {
      method: "PUT",
      body: JSON.stringify({
        ...(items.length > 0 ? { inbox: { at, items } } : {}),
        suggestions: { at, list: result.suggestions },
        unsure: result.unsure,
        ran: { at, added: result.added, suggested: result.suggestions.length, said: result.said },
      }),
    });
    log(`${id}: ${result.said}${ownKey ? "" : " (no key of the books' own, or AI is off for them)"}`);
  } finally {
    server.stop();
  }
}

const runner = await bundle();
const ids = only !== "" ? [only] : listLedgers(ledgerRoot).map((one) => one.id ?? one);
for (const id of ids) {
  try {
    await runOne(id, runner);
  } catch (error) {
    log(`${id}: not run -- ${error.message}`);
  }
}
process.exit(0);
