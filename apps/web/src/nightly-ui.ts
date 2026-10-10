import { record } from "./books.js";
import { aiRoute } from "./ai-backend.js";
import { booksLocale } from "./country.js";
import { readMorning } from "./nightly.js";
import type { Morning } from "./nightly.js";
import { state } from "./state.js";
import { save } from "./store.js";

/**
 * Getting these books ready every morning, before anybody opens them.
 *
 * At six: the bank feed checked, then codes suggested for up to a hundred
 * waiting lines on the books' own key. Nothing goes into the books until they
 * are opened (see nightly.ts). On this computer it is a Windows scheduled
 * task, set up here; for books on the server, the server does it.
 */
export function morningChoice(): HTMLElement {
  const box = document.createElement("div");
  const label = document.createElement("label");
  label.className = "feed-auto";
  const tick = document.createElement("input");
  tick.type = "checkbox";
  tick.checked = state.ledger.nightly === true;
  label.append(
    tick,
    " Get these books ready every morning at 6am: check the bank feed, and suggest codes for up to 100 " +
      "waiting lines where they have an AI key of their own. Nothing goes into the books until you open them.",
  );
  const said = document.createElement("p");
  said.className = "feed-said";
  const history = document.createElement("div");
  box.append(label, said, history);

  const schedule = async (on: boolean): Promise<void> => {
    if (aiRoute() !== "folder") return;
    const response = await fetch("api/nightly/schedule", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ on }),
    }).catch(() => null);
    if (response !== null && !response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      said.textContent = body.error ?? "Could not set up the morning run on this computer.";
    }
  };

  const describe = async (): Promise<void> => {
    const morning = await readMorning();
    history.replaceChildren(...[morningLog(morning)].filter((el): el is HTMLElement => el !== null));
    const last = morning.ran
      ? `Last morning run ${new Date(morning.ran.at).toLocaleString()}: ${morning.ran.said.replace(/\.$/, "")}.`
      : "";
    if (aiRoute() === "folder") {
      const response = await fetch("api/nightly/schedule").catch(() => null);
      const status = (response?.ok ? await response.json() : null) as { supported?: boolean; scheduled?: boolean } | null;
      const where =
        status?.supported !== true
          ? "The morning run is set up automatically on Windows only. Elsewhere, run node apps/web/nightly.js from a scheduler."
          : status.scheduled === true
            ? "Set up on this computer: it runs at 6am, or when the computer is next on if it was asleep."
            : state.ledger.nightly === true
              ? "Not set up on this computer yet."
              : "";
      said.textContent = [where, last].filter((part) => part !== "").join(" ");
      if (status?.supported === true && status.scheduled !== true && state.ledger.nightly === true) {
        const set = document.createElement("button");
        set.type = "button";
        set.textContent = "Set it up on this computer";
        set.addEventListener("click", () => void schedule(true).then(describe));
        said.append(" ", set);
      }
      if (status?.supported === true && status.scheduled === true && state.ledger.nightly !== true) {
        const off = document.createElement("button");
        off.type = "button";
        off.textContent = "Remove it from this computer";
        off.title = "The morning run is one task for every set of books on this computer.";
        off.addEventListener("click", () => void schedule(false).then(describe));
        said.append(" ", off);
      }
      return;
    }
    said.textContent = [
      aiRoute() === "cloud" ? "For books on the server, the server does this, around 6am New Zealand time." : "",
      last,
    ]
      .filter((part) => part !== "")
      .join(" ");
  };

  tick.addEventListener("change", () => {
    const before = state.ledger.nightly === true;
    if (tick.checked) state.ledger = { ...state.ledger, nightly: true };
    else {
      const { nightly: _gone, ...rest } = state.ledger;
      state.ledger = rest;
    }
    void save(state.ledger).then(async (persistent) => {
      state.persistent = persistent;
      await record("nightly", tick.checked ? "Ready every morning: on" : "Ready every morning: off", before, tick.checked);
      if (tick.checked) await schedule(true);
      await describe();
    });
  });
  void describe();
  return box;
}

/**
 * The morning runs, newest first: when, what came in, what was suggested, and
 * what happened, a run that stopped included.
 */
function morningLog(morning: Morning): HTMLElement | null {
  const runs = morning.log ?? [];
  if (runs.length === 0) return null;
  const fold = document.createElement("details");
  const summary = document.createElement("summary");
  const stopped = runs[0]?.failed !== undefined;
  summary.textContent = `Morning runs (${runs.length})${stopped ? ": the last one stopped" : ""}`;
  fold.append(summary);
  const table = document.createElement("table");
  table.className = "report-table";
  const head = document.createElement("thead");
  head.innerHTML = "<tr><th>When</th><th>New from the bank</th><th>Suggestions waiting</th><th>What happened</th></tr>";
  const body = document.createElement("tbody");
  for (const run of runs) {
    const tr = document.createElement("tr");
    const cells = [
      new Date(run.at).toLocaleString(booksLocale(), { dateStyle: "medium", timeStyle: "short" }),
      run.failed === undefined ? String(run.added) : "",
      run.failed === undefined ? String(run.suggested) : "",
      run.failed === undefined ? run.said.replace(/\.$/, "") : `Stopped: ${run.failed}`,
    ];
    for (const [i, text] of cells.entries()) {
      const td = document.createElement("td");
      td.textContent = text;
      if (i === 1 || i === 2) td.className = "report-amount";
      tr.append(td);
    }
    body.append(tr);
  }
  table.append(head, body);
  fold.append(table);
  return fold;
}
