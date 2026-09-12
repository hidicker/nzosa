/**
 * Capture every figure the app can show, so a refactor can be proved harmless.
 *
 * A restructuring must not move a number. The way to know is to write down
 * what the app says before touching it, and compare afterwards -- not to read
 * the diff and reason about whether it looks safe. Anything that differs is a
 * bug, and a figure that changes for the better is still a bug, because it
 * means a behaviour change travelled with a structural one.
 *
 * This runs in the page rather than in Node, because the report code lives in
 * the browser and reads module state. That is exactly what phase 2 of the
 * refactor moves out; until it has, the page is the only place the figures
 * exist. Paste it into the console with the app open, or let the harness drive
 * it, and save what it returns.
 *
 *     const capture = await window.__goldenMaster();
 *
 * One ledger per run: switching books reloads the page. Capture each set of
 * books separately and diff them separately.
 */
(() => {
  const settle = (ms = 320) => new Promise((r) => setTimeout(r, ms));
  const text = (el) => (el ? el.innerText.replace(/\s+/g, " ").trim() : "(missing)");

  const pick = async (id, value) => {
    const el = document.getElementById(id);
    if (!el || el.value === value) return el !== null;
    el.value = value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    return true;
  };

  const go = async (page) => {
    const btn = document.querySelector(`button[data-page="${page}"]`);
    if (!btn) return false;
    btn.click();
    await settle(700);
    return true;
  };

  const values = (id) => {
    const el = document.getElementById(id);
    return el ? [...el.options].map((o) => o.value) : [];
  };

  /** Every combination the reports page offers. */
  async function reports() {
    const out = {};
    if (!(await go("reports"))) return out;
    for (const year of values("report-year")) {
      await pick("report-year", year);
      for (const basis of values("report-basis")) {
        await pick("report-basis", basis);
        for (const gst of values("report-gst")) {
          await pick("report-gst", gst);
          for (const kind of values("report-kind")) {
            await pick("report-kind", kind);
            // The owner selector only changes one report, so it is swept only
            // there rather than multiplying every other variant by two.
            const owners = kind.toLowerCase().includes("owner") ? values("report-owner") : [""];
            for (const owner of owners) {
              if (owner !== "") await pick("report-owner", owner);
              const key = [year, basis, gst, kind, owner].filter(Boolean).join(" | ");
              // The body, not the whole section: the selectors and the hint
              // above it are the same on every variant, so hashing them buries
              // a small report under 25,000 characters of identical chrome.
              out[key] = text(document.getElementById("reports-body"));
            }
          }
        }
      }
    }
    return out;
  }

  /** The GST return, every period the page will show. */
  async function gst() {
    const out = {};
    if (!(await go("gst"))) return out;
    out["variance"] = text(document.getElementById("variance-body"));
    return out;
  }

  /** Opening balances, per financial year and the combined view. */
  async function opening() {
    const out = {};
    if (!(await go("opening"))) return out;
    for (const year of values("opening-year")) {
      await pick("opening-year", year);
      out[year] = text(document.getElementById("opening-body"));
    }
    return out;
  }

  /** What is left to code, and the coding already decided. */
  async function reconcile() {
    const out = {};
    if (!(await go("reconcile"))) return out;
    const body = document.getElementById("page-reconcile");
    out["summary"] = (body?.innerText.match(/[\d,]+ still to confirm[^\n]*/) ?? ["(none)"])[0];
    out["rows"] = String(document.querySelectorAll("#reconcile-body .line").length);
    return out;
  }

  /** Entities, the chart, and what the setup checklist believes. */
  async function standing() {
    const out = {};
    if (await go("entities")) out["entities"] = text(document.getElementById("entities-body"));
    if (await go("setup")) {
      out["setup"] = [...document.querySelectorAll(".setup-step")]
        .map((s) => s.innerText.replace(/\s+/g, " ").trim())
        .join(" ~ ");
    }
    return out;
  }

  /**
   * A SHA-256 of each variant rather than its text.
   *
   * The full capture runs to half a megabyte, which is awkward to move about
   * and pointless to store: the question a golden master answers is "did this
   * change", and a digest answers it exactly. The text stays on
   * `window.__goldenText` for the one variant a diff points at.
   */
  async function digest(value) {
    const bytes = new TextEncoder().encode(value);
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
  }

  /**
   * Wait until the app stops changing under its own power.
   *
   * Opening the app starts work that finishes seconds later -- the bank feed
   * fetches, and new transactions move every figure that rests on a balance.
   * Captured too early, a sweep records a book that is still arriving, and two
   * such sweeps differ for reasons that have nothing to do with the code.
   *
   * Measured, not assumed: on one real ledger box 28 moved from 39,183.31 to
   * 39,232.89 about twenty-five seconds after load, and the whole of a 115
   * variant "difference" was that and nothing else.
   *
   * So: watch one report until it stops moving, and only then begin.
   */
  async function settled(checks = 3, gap = 5000) {
    document.querySelector('button[data-page="reports"]')?.click();
    await settle(700);
    const read = () => document.getElementById("reports-body")?.innerText ?? "";
    let last = read();
    let stable = 0;
    const deadline = Date.now() + 120000;
    while (stable < checks && Date.now() < deadline) {
      await settle(gap);
      const now = read();
      stable = now === last ? stable + 1 : 0;
      last = now;
    }
    return { stable: stable >= checks, waitedMs: gap * (checks + 1) };
  }

  window.__goldenMaster = async function goldenMaster(options = {}) {
    const started = Date.now();
    const quiet = options.skipSettle === true ? { stable: true, waitedMs: 0 } : await settled();
    const sections = {
      reports: await reports(),
      gst: await gst(),
      opening: await opening(),
      reconcile: await reconcile(),
      standing: await standing(),
    };
    window.__goldenText = sections;

    const variants = {};
    for (const [section, group] of Object.entries(sections)) {
      for (const [key, value] of Object.entries(group)) {
        variants[section + "/" + key] = (await digest(value)) + ":" + value.length;
      }
    }
    return {
      ledger: document.getElementById("ledger-open-name")?.textContent?.trim() || "(browser)",
      capturedAt: new Date().toISOString(),
      settled: quiet.stable,
      count: Object.keys(variants).length,
      tookMs: Date.now() - started,
      variants,
    };
  };

  const STORE_KEY = "nzosa:golden-master";

  /**
   * Keep a capture as the baseline to measure against.
   *
   * In the browser's own storage, because that is what survives the reload
   * after a rebuild -- which is the thing that happens between every pair of
   * captures worth comparing. Durable enough for a refactor that takes a day;
   * export it if the work is going to take longer than the browser's patience.
   */
  window.__goldenSave = function goldenSave(capture) {
    localStorage.setItem(STORE_KEY, JSON.stringify(capture));
    return { saved: capture.count, ledger: capture.ledger, at: capture.capturedAt };
  };

  window.__goldenLoad = function goldenLoad() {
    const held = localStorage.getItem(STORE_KEY);
    return held === null ? null : JSON.parse(held);
  };

  /**
   * What moved since the baseline.
   *
   * Reports only the differences, because that is the whole answer: a
   * restructuring that changed nothing produces an empty list, and anything
   * else is a bug to go and look at -- including a figure that looks better.
   */
  window.__goldenDiff = async function goldenDiff(capture) {
    const base = window.__goldenLoad();
    if (base === null) return { error: "no baseline saved" };
    const now = capture ?? (await window.__goldenMaster());
    const changed = [];
    const added = [];
    const removed = [];
    for (const [k, v] of Object.entries(now.variants)) {
      if (!(k in base.variants)) added.push(k);
      else if (base.variants[k] !== v) changed.push({ key: k, was: base.variants[k], now: v });
    }
    for (const k of Object.keys(base.variants)) if (!(k in now.variants)) removed.push(k);
    return {
      baselineFrom: base.capturedAt,
      compared: now.count,
      identical: now.count - changed.length - added.length,
      changed,
      added,
      removed,
      verdict: changed.length + added.length + removed.length === 0 ? "IDENTICAL" : "DIFFERENCES",
    };
  };

  return "ready: __goldenMaster() / __goldenSave(c) / __goldenDiff()";
})();
