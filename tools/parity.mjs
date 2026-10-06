/**
 * Parity: two builds of NZOSA, the same books, the same answers.
 *
 * Opens each build's app on a fresh copy of the same set of books, in
 * headless Chrome, and walks it the way a person would: every page under
 * every entity, every report for every year, basis and owner, each year end
 * with every property opened, the AI check's prompts and the workbook. What is
 * on screen is captured as text. The two captures must be identical, word for
 * word and figure for figure; any difference is printed, line by line.
 *
 * Nothing in either app is changed to make this possible -- it reads what a
 * person reads -- so the build it checks is the build that ships. The books are
 * copied first, because opening books can write to them, and never written back.
 *
 *   node tools/parity.mjs --a <repo> --b <repo> --ledgers <folder> --books a,b,c [--out <folder>]
 *
 * --a and --b are two checkouts (say, main and the international worktree),
 * each built with `npm run build`. Run a build against itself first: two runs
 * must agree, or a difference later proves nothing.
 */
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : fallback;
};
const repoA = resolve(arg("a", "."));
const repoB = resolve(arg("b", "."));
const ledgers = resolve(arg("ledgers", join(repoA, "ledgers")));
const books = (arg("books", "") || "").split(",").filter(Boolean);
const outDir = resolve(arg("out", join(tmpdir(), "nzosa-parity")));
const chromePath = arg("chrome", "C:/Program Files/Google/Chrome/Application/chrome.exe");
if (books.length === 0) {
  console.error("usage: node tools/parity.mjs --a <repo> --b <repo> --ledgers <folder> --books a,b");
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A copy of a set of books, less its lock. The ".open-by" file says which
 * NZOSA has the books open; copied, it made the copy look open too, and the
 * build refused to start on it.
 */
function copyBooks(from, to) {
  cpSync(from, to, { recursive: true, filter: (path) => !path.endsWith(".open-by") });
}

/** One build serving one copy of one set of books, until stopped. */
async function serveBooks(repo, folder, book, port) {
  const child = spawn(
    process.execPath,
    [join(repo, "apps/web/build.js"), "--serve", "--port", String(port), "--ledgers", folder, "--ledger", book],
    { cwd: repo, stdio: ["ignore", "pipe", "pipe"] },
  );
  let said = "";
  child.stdout.on("data", (d) => (said += d));
  child.stderr.on("data", (d) => (said += d));
  for (let i = 0; i < 240; i++) {
    await wait(500);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/`);
      if (r.ok) return child;
    } catch {}
  }
  child.kill();
  throw new Error(`${repo} did not start on ${port}. It said:
${said.slice(-1500)}`);
}

/** Headless Chrome, driven over its DevTools protocol. */
async function openChrome(port) {
  const chrome = spawn(
    chromePath,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      "--no-first-run",
      "--hide-scrollbars",
      `--user-data-dir=${mkdtempSync(join(tmpdir(), "parity-chrome-"))}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    await wait(250);
    try {
      target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page");
    } catch {}
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  });
  const send = (method, params = {}) =>
    new Promise((r) => {
      const n = ++id;
      pending.set(n, r);
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  return {
    send,
    async evaluate(expression) {
      const reply = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (reply.result?.exceptionDetails) throw new Error(JSON.stringify(reply.result.exceptionDetails).slice(0, 500));
      return reply.result?.result?.value;
    },
    close() {
      ws.close();
      chrome.kill();
    },
  };
}

/**
 * Walk the app and capture what it shows. Runs in the page. Only navigates,
 * chooses from selects and opens details: it presses nothing that acts.
 */
const CAPTURE = String.raw`
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const text = (el) => (el?.innerText ?? "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const stable = async (el) => {
    let last = null;
    for (let i = 0; i < 40; i++) {
      await wait(200);
      const now = text(el);
      if (now === last) return now;
      last = now;
    }
    return last ?? "";
  };
  for (let i = 0; i < 150; i++) {
    const l = document.getElementById("app-loading");
    if (!l || l.hidden || getComputedStyle(l).display === "none") break;
    await wait(200);
  }
  await wait(2500);
  // Writes back are suppressed nowhere: the books are a copy. But nothing here
  // clicks a button that acts -- only navigation, selects and details.
  window.confirm = () => false;
  window.prompt = () => null;
  window.alert = () => {};
  const out = {};
  out["_meta"] = JSON.stringify({
    title: document.getElementById("page-title")?.textContent ?? "",
    nav: document.querySelectorAll(".sidebar-nav button[data-page], .sidebar-nav button[data-report]").length,
    start: (document.body?.innerText ?? "").slice(0, 300),
  });
  const choose = async (select, value) => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const visible = (el) => el && !el.hidden && el.offsetParent !== null;
  const navButtons = () =>
    [...document.querySelectorAll(".sidebar-nav button[data-page], .sidebar-nav button[data-report]")].filter(visible);
  // Every sidebar section open: a collapsed one hides its pages, and pages
  // nobody can see are pages nobody compared.
  for (const heading of document.querySelectorAll('.sidebar-heading[aria-expanded="false"]')) heading.click();
  await wait(300);
  const filter = document.getElementById("entity-filter");
  const entityValues = filter ? [...filter.options].map((o) => o.value) : [""];

  for (const entity of entityValues) {
    if (filter) await choose(filter, entity);
    await wait(300);
    const tag = "entity=" + (entity || "all");
    for (const button of navButtons()) {
      const page = button.dataset.page ?? "reports";
      const key = tag + " | " + (button.dataset.page ? "page " + page : "report " + button.dataset.report);
      button.click();
      const body = document.getElementById("page-" + page);
      out[key] = await stable(body);

      if (page === "reports" && !button.dataset.report) {
        const kind = document.getElementById("report-kind");
        for (const k of [...kind.options].map((o) => o.value)) {
          await choose(kind, k);
          await wait(200);
          const year = document.getElementById("report-year");
          const basis = document.getElementById("report-basis");
          const owner = document.getElementById("report-owner");
          const years = visible(year) ? [...year.options].map((o) => o.value) : [null];
          const bases = visible(basis) ? [...basis.options].map((o) => o.value) : [null];
          const owners = visible(owner) ? [...owner.options].map((o) => o.value) : [null];
          for (const y of years) {
            if (y !== null) await choose(year, y);
            for (const b of bases) {
              if (b !== null) await choose(basis, b);
              for (const o of owners) {
                if (o !== null) await choose(owner, o);
                out[tag + " | reports kind=" + k + " year=" + y + " basis=" + b + " owner=" + o] = await stable(
                  document.getElementById("reports-body"),
                );
              }
            }
          }
        }
      }

      // Pages with a year of their own: every year, everything opened.
      if (["rentalyear", "personalyear", "aicheck"].includes(page)) {
        const select = body.querySelector("select");
        const values = select ? [...select.options].map((o) => o.value) : [null];
        for (const v of values) {
          if (v !== null) await choose(select, v);
          await wait(300);
          for (const d of body.querySelectorAll("details:not([open])")) d.open = true;
          for (const b of [...body.querySelectorAll("button")].filter((x) => x.textContent.trim() === "Show prompt")) b.click();
          out[key + " year=" + v] = await stable(body);
        }
      }
    }
  }

  // The workbook, for every year it offers, captured rather than saved.
  const ai = [...navButtons()].find((b) => b.dataset.page === "aicheck");
  if (ai) {
    ai.click();
    await wait(800);
    const body = document.getElementById("page-aicheck");
    const select = body.querySelector("select");
    const values = select ? [...select.options].map((o) => o.value) : [null];
    for (const v of values) {
      if (v !== null) await choose(select, v);
      await wait(300);
      let blob = null;
      const make = URL.createObjectURL;
      const click = HTMLAnchorElement.prototype.click;
      URL.createObjectURL = (b) => ((blob = b), "blob:parity");
      HTMLAnchorElement.prototype.click = function () {};
      const go = [...body.querySelectorAll("button")].find((x) => x.textContent.trim() === "Download the workbook");
      if (go) go.click();
      for (let i = 0; i < 100 && blob === null; i++) await wait(100);
      URL.createObjectURL = make;
      HTMLAnchorElement.prototype.click = click;
      if (blob !== null) {
        // Stored, not compressed: the sheets' XML is readable as it stands.
        const raw = new TextDecoder("utf-8").decode(new Uint8Array(await blob.arrayBuffer()));
        const sheets = raw.split(/(?=<\?xml)/).filter((s) => s.includes("<sheetData>"));
        sheets.forEach((s, i) => {
          out["workbook year=" + v + " sheet " + (i + 1)] = s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        });
      }
    }
  }
  return out;
})()
`;

function diffText(a, b) {
  const x = (a ?? "").split("\n");
  const y = (b ?? "").split("\n");
  const lines = [];
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n && lines.length < 12; i++) {
    if (x[i] !== y[i]) lines.push(`    line ${i + 1}\n      A: ${x[i] ?? "(none)"}\n      B: ${y[i] ?? "(none)"}`);
  }
  return lines.join("\n");
}

async function captureSide(repo, label, book, port, chromePort) {
  const folder = mkdtempSync(join(tmpdir(), `parity-${label}-`));
  copyBooks(join(ledgers, book), join(folder, book));
  const server = await serveBooks(repo, folder, book, port);
  const chrome = await openChrome(chromePort);
  try {
    await chrome.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await chrome.send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
    await wait(1500);
    return await chrome.evaluate(CAPTURE);
  } finally {
    chrome.close();
    server.kill();
    await wait(800);
    rmSync(folder, { recursive: true, force: true });
  }
}

// --probe "<script>": open the first set of books in build A and print what
// the script returns. For finding out what the capture should look at.
const probe = arg("probe", "");
if (probe !== "") {
  const folder = mkdtempSync(join(tmpdir(), "parity-probe-"));
  copyBooks(join(ledgers, books[0]), join(folder, books[0]));
  const server = await serveBooks(repoA, folder, books[0], 3459);
  const chrome = await openChrome(9449);
  await chrome.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await chrome.send("Page.navigate", { url: "http://127.0.0.1:3459/" });
  await wait(6000);
  try {
    console.log(JSON.stringify(await chrome.evaluate(probe), null, 1));
  } finally {
    chrome.close();
    server.kill();
    await wait(800);
    rmSync(folder, { recursive: true, force: true });
  }
  process.exit(0);
}

let failed = 0;
for (const book of books) {
  if (!existsSync(join(ledgers, book))) {
    console.error(`No books called ${book} in ${ledgers}`);
    failed++;
    continue;
  }
  console.log(`\n== ${book}`);
  const a = await captureSide(repoA, "a", book, 3451, 9441);
  const b = await captureSide(repoB, "b", book, 3452, 9442);
  writeFileSync(join(outDir, `${book}.a.json`), JSON.stringify(a, null, 1));
  writeFileSync(join(outDir, `${book}.b.json`), JSON.stringify(b, null, 1));
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  let differ = 0;
  for (const key of keys) {
    if (a[key] === b[key]) continue;
    differ++;
    if (differ <= 25) {
      console.log(`  DIFFERS: ${key}${a[key] === undefined ? " (only in B)" : b[key] === undefined ? " (only in A)" : ""}`);
      if (a[key] !== undefined && b[key] !== undefined) console.log(diffText(a[key], b[key]));
    }
  }
  console.log(`  ${keys.length} views compared, ${differ} differ`);
  // Seeing nothing is not agreeing. A capture this small means the app did not
  // open, and a pass would prove nothing.
  if (keys.length < 20) {
    console.log("  TOO FEW VIEWS: the app did not open properly. What it showed:", a["_meta"] ?? "(nothing)");
    failed++;
  }
  if (differ > 0) failed++;
}
console.log(failed === 0 ? "\nPARITY: identical" : `\nPARITY: ${failed} set(s) of books differ`);
process.exit(failed === 0 ? 0 : 1);
