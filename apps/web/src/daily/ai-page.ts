import { redraw, showPage } from "../app.js";
import { accountsFor, saveEntities, unregisteredCode } from "../books.js";
import { $, state } from "../state.js";
import { backendKind, save } from "../store.js";
import { note } from "../ui.js";
import { suggest } from "../reconcile.js";
import { confirmLine } from "./reconcile-page.js";
import {
  askAbout,
  briefing,
  emptyEntityModel,
  parseSuggestions,
  unmatched,
  wholePrompt,
} from "@nzosa/core";
import type { AiSuggestion, AskedAbout, Entity } from "@nzosa/core";
import type { Suggestion } from "../reconcile.js";

/**
 * Asking a model about the lines nothing in these books recognises.
 *
 * The rules go first and always. What reaches this page is what no rule, no
 * default and no override had anything to say about -- so the model is never
 * asked a question these books had already answered, and every suggestion
 * accepted here can become a rule, which means it is never asked again either.
 *
 * Three things this page is careful about, in order of how much they matter.
 *
 * It is off until somebody turns it on, per set of books, and it says exactly
 * what would leave this machine before it leaves it. Payee names and amounts
 * are client data; whether they may be sent to a model provider is a decision
 * for the person whose data it is, and for their clients, not for a default.
 *
 * It costs money, so it runs when asked and not before. There is no coding
 * that quietly calls a model. And there is a cap per day, because the way a
 * bill surprises somebody is a loop nobody watched.
 *
 * And what comes back is a suggestion. It arrives beside the payee it is
 * about, with the model's own reason and its own confidence, and it does
 * nothing until somebody agrees with it.
 */

interface AiStatus {
  configured: boolean;
  key: string;
  model: string;
  usedToday: number;
  limit: number;
}

let status: AiStatus | null = null;
let found: AiSuggestion[] = [];
let asked: AskedAbout[] = [];
let said = "";
let working = false;

async function api(path: string, init?: RequestInit): Promise<Response | null> {
  try {
    return await fetch(path, init);
  } catch {
    return null;
  }
}

export function renderAi(): void {
  const body = $("ai-body");
  body.textContent = "";

  if (backendKind() !== "folder") {
    body.append(
      note(
        "Suggestions need somewhere to keep the key that is not this browser, and somewhere " +
          "to ask from that is not this page. That is the app running on your own computer, " +
          "where the key sits in a file only you can read and the question goes out from " +
          "your machine. A copy running in a browser has neither, so this is not offered here.",
      ),
    );
    return;
  }

  if (state.ledger.aiEnabled !== true) {
    body.append(offerIt());
    return;
  }

  body.append(keyPanel(), briefingPanel(), askPanel());
  if (found.length > 0) body.append(resultsPanel());
  void refreshStatus();
}

async function refreshStatus(): Promise<void> {
  const response = await api("/api/ai");
  if (response === null || !response.ok) return;
  const next = (await response.json()) as AiStatus;
  const changed =
    status === null ||
    status.configured !== next.configured ||
    status.usedToday !== next.usedToday ||
    status.key !== next.key;
  status = next;
  if (changed) redraw("ai");
}

// --- turning it on ---------------------------------------------------------

/**
 * What would be sent, said before anything is.
 *
 * Not a tick box with a link to a policy. The four lines below are the whole
 * of what leaves this machine, and somebody who reads them knows as much about
 * it as the person who wrote the code.
 */
function offerIt(): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "ai-offer";

  const heading = document.createElement("h3");
  heading.textContent = "Suggestions for the lines nothing recognises";
  wrap.append(heading);

  const what = document.createElement("p");
  what.textContent =
    "Your rules code most of a bank feed on their own. For what is left -- a payee that " +
    "has not been seen before -- a model can propose an account, with its reasons, for you " +
    "to accept or throw away.";
  wrap.append(what);

  const careful = document.createElement("p");
  careful.className = "ai-careful";
  careful.textContent = "This sends some of what is in these books to Google. Exactly this:";
  wrap.append(careful);

  const list = document.createElement("ul");
  for (const line of [
    "The payee, date, amount and reference of each unrecognised transaction -- and only " +
      "those. Never a bank account number, and never a transaction a rule already coded.",
    "Your chart of accounts: the codes and names, so it has something to choose from.",
    "How you coded similar payees before, as examples.",
    "What you write below about what these books are for.",
  ]) {
    const item = document.createElement("li");
    item.textContent = line;
    list.append(item);
  }
  wrap.append(list);

  const whose = document.createElement("p");
  whose.className = "ai-careful";
  whose.textContent =
    "If these are a client's books rather than your own, that is their data and their " +
    "decision. It is off until you turn it on, and it is off separately for every set of " +
    "books.";
  wrap.append(whose);

  const on = document.createElement("button");
  on.type = "button";
  on.className = "primary";
  on.textContent = "Turn on for these books";
  on.addEventListener("click", () => {
    state.ledger.aiEnabled = true;
    void save(state.ledger).then(() => redraw("ai"));
  });
  const row = document.createElement("div");
  row.className = "migration-actions";
  row.append(on);
  wrap.append(row);
  return wrap;
}

function panel(title: string): [HTMLElement, HTMLElement] {
  const box = document.createElement("div");
  box.className = "ai-panel";
  const heading = document.createElement("h3");
  heading.textContent = title;
  const inner = document.createElement("div");
  box.append(heading, inner);
  return [box, inner];
}

// --- the key ---------------------------------------------------------------

function keyPanel(): HTMLElement {
  const [box, inner] = panel("Your Google AI key");

  if (status?.configured === true) {
    inner.append(
      note(
        `Set: ${status.key}, using ${status.model}. It is kept in a file on this computer ` +
          "that only your user account can read, beside the bank feed's tokens, and it is " +
          "never sent to this page.",
      ),
    );
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove the key";
    remove.addEventListener("click", () => {
      remove.disabled = true;
      void api("/api/ai", { method: "DELETE" }).then(() => {
        status = null;
        void refreshStatus().then(() => redraw("ai"));
      });
    });
    const row = document.createElement("div");
    row.className = "migration-actions";
    row.append(remove);
    inner.append(row);
    return box;
  }

  inner.append(
    note(
      "A key of your own, from aistudio.google.com. You pay Google for what you use, which " +
        "for coding a few hundred transactions is cents rather than dollars. NZOSA is open " +
        "source and ships with no key in it, so everybody brings their own.",
    ),
  );

  const input = document.createElement("input");
  input.type = "password";
  input.autocomplete = "off";
  input.placeholder = "Paste the key here";
  input.className = "ai-key-input";

  const trouble = document.createElement("p");
  trouble.className = "cloud-said";

  const save = document.createElement("button");
  save.type = "button";
  save.className = "primary";
  save.textContent = "Check it and keep it";
  save.addEventListener("click", () => {
    const key = input.value.trim();
    if (key === "") return;
    save.disabled = true;
    trouble.textContent = "Asking Google whether it works…";
    void api("/api/ai", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key }),
    }).then(async (response) => {
      save.disabled = false;
      if (response === null) {
        trouble.textContent = "Could not reach the app on this computer.";
        return;
      }
      const answer = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        trouble.textContent = answer.error ?? "That key was not accepted.";
        return;
      }
      // Out of this page the moment it is somewhere better.
      input.value = "";
      void refreshStatus().then(() => redraw("ai"));
    });
  });

  const row = document.createElement("div");
  row.className = "migration-actions";
  row.append(input, save);
  inner.append(row, trouble);
  return box;
}

// --- what these books are --------------------------------------------------

function entitiesOf(): Entity[] {
  return [...(state.ledger.entities ?? emptyEntityModel()).entities];
}

/**
 * The briefing, written once and sent with every question.
 *
 * A model is asked and answers and remembers nothing, so there is no setting
 * it up once and no conversation to continue. What there is instead is better:
 * a description that lives on disk, which can be read, corrected and argued
 * with before it is ever sent, rather than something a model was told once in
 * a session nobody kept.
 */
function briefingPanel(): HTMLElement {
  const [box, inner] = panel("What these books are");
  inner.append(
    note(
      "Sent with every question. A chart of accounts does not say whether “supplies” " +
        "means green beans or gib board, and that is what decides where a payment to a " +
        "wholesaler belongs.",
    ),
  );

  const about = document.createElement("textarea");
  about.className = "ai-about";
  about.rows = 3;
  about.placeholder =
    "A coffee roastery in Nelson. Buys green beans by the sack, sells wholesale to cafes " +
    "and retail online. Two vans.";
  about.value = state.ledger.booksAbout ?? "";
  about.addEventListener("change", () => {
    state.ledger.booksAbout = about.value.trim();
    void save(state.ledger);
  });
  inner.append(about);

  const entities = entitiesOf();
  if (entities.length > 0) {
    const heading = document.createElement("h4");
    heading.textContent = entities.length === 1 ? "The entity" : "Each entity";
    inner.append(heading);
    for (const entity of entities) {
      const row = document.createElement("div");
      row.className = "ai-entity";
      const name = document.createElement("span");
      name.className = "ai-entity-name";
      name.textContent = entity.name;
      const what = document.createElement("input");
      what.type = "text";
      what.placeholder = "What it does";
      what.value = entity.about ?? "";
      what.addEventListener("change", () => {
        const live = state.ledger.entities ?? emptyEntityModel();
        void saveEntities(
          {
            ...live,
            entities: live.entities.map((one) =>
              one.id === entity.id ? { ...one, about: what.value.trim() } : one,
            ),
          },
          `What ${entity.name} does`,
        );
      });
      row.append(name, what);
      inner.append(row);
    }
  }
  return box;
}

// --- asking ----------------------------------------------------------------

/** Every line, coded the way the Reconcile page codes them: rules first. */
function allLines(): Suggestion[] {
  return suggest(
    state.ledger.transactions,
    state.rules,
    state.ledger.overrides ?? {},
    accountsFor([]),
    unregisteredCode(),
  );
}

/** The lines nothing in these books recognises, and what would be said about them. */
function whatWouldBeAsked(): { asked: AskedAbout[]; prompt: string; codes: string[] } {
  const all = allLines();
  const labels = new Map(
    state.ledger.transactions.map((t) => [
      t.id,
      String(t.extras?.["accountLabel"] ?? t.account),
    ]),
  );
  const asking = unmatched(all).map((one) =>
    askAbout(one.transaction, labels.get(one.transaction.id) ?? ""),
  );

  const model = state.ledger.entities ?? emptyEntityModel();
  const books = {
    ...briefing(model, state.chart, (entity) => entity.about ?? ""),
    about: state.ledger.booksAbout ?? "",
  };
  // Work already done, as worked examples: what a confirmed line was coded to.
  const coded = all
    .filter((one) => one.confirmed && (one.code ?? "").trim() !== "")
    .map((one) => ({ payee: one.transaction.otherParty, code: one.code ?? "" }));

  return {
    asked: asking,
    prompt: wholePrompt(books, asking, coded),
    codes: books.accounts.map((account) => account.code),
  };
}

function askPanel(): HTMLElement {
  const [box, inner] = panel("Ask about what is left");
  const { asked: asking, prompt, codes } = whatWouldBeAsked();

  const left = status === null ? null : status.limit - status.usedToday;
  inner.append(
    note(
      asking.length === 0
        ? "Nothing is waiting: every line has a rule, a default or your own answer."
        : `${asking.length} line${asking.length === 1 ? "" : "s"} nothing recognises.` +
          (left === null ? "" : ` ${status?.usedToday ?? 0} of ${status?.limit ?? 0} asked today.`),
    ),
  );

  // Readable before it is sent, in full, rather than described.
  if (asking.length > 0) {
    const details = document.createElement("details");
    details.className = "setup-migration-details";
    const summary = document.createElement("summary");
    summary.className = "setup-migration-summary";
    summary.textContent = "Show exactly what would be sent";
    const pre = document.createElement("pre");
    pre.className = "ai-prompt";
    pre.textContent = prompt;
    details.append(summary, pre);
    inner.append(details);
  }

  const go = document.createElement("button");
  go.type = "button";
  go.className = "primary";
  go.textContent = working ? "Asking…" : "Get AI recommendations";
  go.disabled = working || asking.length === 0 || status?.configured !== true;
  go.addEventListener("click", () => {
    working = true;
    said = "";
    redraw("ai");
    void api("/api/ai/suggest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt, asking: asking.length }),
    }).then(async (response) => {
      working = false;
      if (response === null) {
        said = "Could not reach the app on this computer.";
        redraw("ai");
        return;
      }
      const answer = (await response.json().catch(() => ({}))) as {
        text?: string;
        error?: string;
      };
      if (!response.ok) {
        said = answer.error ?? "The model would not answer.";
        redraw("ai");
        return;
      }
      asked = asking;
      found = parseSuggestions(answer.text ?? "", {
        asked: asking.map((one) => one.id),
        codes,
      });
      said =
        found.length === 0
          ? "Nothing came back that could be read as an answer. Nothing has changed."
          : "";
      void refreshStatus().then(() => redraw("ai"));
    });
  });

  const row = document.createElement("div");
  row.className = "migration-actions";
  row.append(go);
  if (status?.configured !== true) {
    inner.append(note("A key is needed first."));
  }
  inner.append(row);

  if (said !== "") {
    const trouble = document.createElement("p");
    trouble.className = "cloud-said bad";
    trouble.textContent = said;
    inner.append(trouble);
  }
  return box;
}

// --- what came back --------------------------------------------------------

function resultsPanel(): HTMLElement {
  const [box, inner] = panel("What it suggests");
  inner.append(
    note(
      "Nothing here is coded until you say so. Accepting one codes that line the way the " +
        "Reconcile page would, and it shows up in History as your decision.",
    ),
  );

  const byId = new Map(asked.map((one) => [one.id, one]));
  const named = new Map(state.chart.map((a) => [a.code.trim(), a.name]));
  const lines = allLines();

  const table = document.createElement("table");
  table.className = "report-table ai-table";
  const head = document.createElement("thead");
  head.innerHTML =
    "<tr><th>Payee</th><th>Amount</th><th>Suggested</th><th>Sure</th><th>Why</th><th></th></tr>";
  const tbody = document.createElement("tbody");

  for (const one of found) {
    const about = byId.get(one.id);
    if (about === undefined) continue;
    const row = document.createElement("tr");

    const payee = document.createElement("td");
    payee.className = "report-name";
    payee.textContent = about.payee || "--";

    const amount = document.createElement("td");
    amount.className = "report-amount";
    amount.textContent = about.amount;

    const code = document.createElement("td");
    code.textContent =
      one.code === "" ? "--" : `${one.code} ${named.get(one.code) ?? ""}`.trim();

    const sure = document.createElement("td");
    sure.className = "report-amount";
    sure.textContent = one.code === "" ? "" : `${Math.round(one.confidence * 100)}%`;

    const why = document.createElement("td");
    why.className = "ai-why";
    why.textContent = one.because;

    const act = document.createElement("td");
    if (one.code !== "") {
      const take = document.createElement("button");
      take.type = "button";
      take.textContent = "Accept";
      take.addEventListener("click", () => {
        const line = lines.find((s) => s.transaction.id === one.id);
        if (line === undefined) return;
        take.disabled = true;
        take.textContent = "Coded ✓";
        void confirmLine(line, one.code, "15", "", about.payee);
      });
      act.append(take);
    }

    row.append(payee, amount, code, sure, why, act);
    tbody.append(row);
  }

  table.append(head, tbody);
  inner.append(table);

  const row = document.createElement("div");
  row.className = "migration-actions";
  const clear = document.createElement("button");
  clear.type = "button";
  clear.textContent = "Clear these";
  clear.addEventListener("click", () => {
    found = [];
    asked = [];
    redraw("ai");
  });
  const go = document.createElement("button");
  go.type = "button";
  go.textContent = "Reconcile";
  go.addEventListener("click", () => showPage("reconcile"));
  row.append(clear, go);
  inner.append(row);
  return box;
}
