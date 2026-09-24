import { redraw, showPage } from "../app.js";
import { saveEntities } from "../books.js";
import { $, state } from "../state.js";
import { save } from "../store.js";
import { note } from "../ui.js";
import { AI_BATCH, aiSuggestionCount, waitingForAnswers, whatWouldBeAsked } from "../ai.js";
import { carrySection } from "../ai-carry.js";
import { aiRoute } from "../ai-backend.js";
import { aiAllowed } from "../ai-consent.js";
import { aiKeyPanel, refreshAiStatus } from "../ai-key-panel.js";
import { emptyEntityModel } from "@nzosa/core";
import type { Entity } from "@nzosa/core";

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


export function renderAi(): void {
  const body = $("ai-body");
  body.textContent = "";

  if (!aiAllowed()) {
    body.append(offerIt());
    return;
  }

  // What both ways need, first and once.
  body.append(step("Set up", "What these books are"), briefingPanel());

  // Then the choice. Neither is better everywhere: one needs no key and can
  // use a model somebody already pays for, the other is a button on the page
  // where the coding is done.
  body.append(
    step("Then, either way", "Two ways to ask"),
    note(
      "The same question, the same checks on the answer, and the same place the answers " +
        "land. What differs is who carries it.",
    ),
    carryPanel(),
  );

  if (aiRoute() === "none") {
    body.append(
      note(
        "The other way -- a key asked automatically -- needs somewhere to keep it that is " +
          "not this browser, and somewhere to ask from that is not this page. That is the " +
          "app running on your own computer, or a set of books on the server. A copy running " +
          "in a browser alone has neither, so only the way above is offered here.",
      ),
    );
    return;
  }

  body.append(
    aiKeyPanel({
      page: "ai",
      title: "Or: a Google AI key, asked automatically",
      countedIn: "transactions",
      whenSet: aboutAsking,
    }),
  );
  body.append(step("And separately", "Checking the finished year"), checkPointer());
  void refreshAiStatus("ai");
}

/**
 * Where the year-end check went.
 *
 * It was a section at the foot of this page, which made it the last thing
 * under a page about coding -- and it is not about coding. It has its own
 * entry under AI now, and this is a signpost rather than a copy: two places
 * to run the same review is two places for it to drift.
 */
function checkPointer(): HTMLElement {
  const [box, inner] = panel("");
  inner.append(
    note(
      "The AI accounts check reads the finished year rather than one line: whether each " +
        "account holds what belongs in it, whether the GST treatments match the " +
        "registration, and what is missing. It uses this same key, and it connects to " +
        "OpenAccountants — tax guides written from the Acts and Inland Revenue's own " +
        "material — so the answer cites what it relied on and how far that guide has been " +
        "checked.",
    ),
  );
  const go = button("Go to the AI accounts check", () => showPage("aicheck"));
  go.className = "primary";
  const row = document.createElement("div");
  row.className = "migration-actions";
  row.append(go);
  inner.append(row);
  return box;
}

/**
 * What asking would do, said under the key rather than beside it.
 *
 * This is the part of the panel that is about coding, so it is this page's
 * and not the shared panel's: the year-end check shares the key and should
 * not inherit a sentence about lines nothing recognises.
 */
function aboutAsking(): HTMLElement[] {
  const out: HTMLElement[] = [];
  const waiting = waitingForAnswers().length;
  const ready = aiSuggestionCount();
  out.push(
    note(
      `${waiting} line${waiting === 1 ? "" : "s"} nothing recognises, asked about ` +
        `${AI_BATCH} at a time.` +
        (ready === 0 ? "" : ` ${ready} suggestion${ready === 1 ? "" : "s"} waiting to be read.`),
    ),
  );

  if (waiting > 0) {
    const details = document.createElement("details");
    details.className = "setup-migration-details";
    const summary = document.createElement("summary");
    summary.className = "setup-migration-summary";
    summary.textContent = "Show exactly what would be sent";
    const pre = document.createElement("pre");
    pre.className = "ai-prompt";
    pre.textContent = whatWouldBeAsked(waitingForAnswers()).prompt;
    details.append(summary, pre);
    out.push(details);
  }

  out.push(
    note(
      "The button is on Reconcile, beside the filter: press AI suggestions and choose " +
        "“Ask with my key”. What comes back appears on the lines themselves.",
    ),
  );
  const go = button("Go to Reconcile", () => showPage("reconcile"));
  go.className = "primary";
  const row = document.createElement("div");
  row.className = "migration-actions";
  row.append(go);
  out.push(row);
  return out;
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

/**
 * Where you are on this page.
 *
 * It read as four boxes of equal weight, and it is not four things: it is one
 * set-up and then a choice between two ways of asking. Saying so is cheaper
 * than hoping somebody infers it from the order.
 */
function step(kicker: string, title: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "ai-step";
  const small = document.createElement("span");
  small.className = "ai-step-kicker";
  small.textContent = kicker;
  const heading = document.createElement("h2");
  heading.textContent = title;
  wrap.append(small, heading);
  return wrap;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

function panel(title: string): [HTMLElement, HTMLElement] {
  const box = document.createElement("div");
  box.className = "ai-panel";
  const inner = document.createElement("div");
  // A panel the step above has already named does not name itself again.
  if (title !== "") {
    const heading = document.createElement("h3");
    heading.textContent = title;
    box.append(heading);
  }
  box.append(inner);
  return [box, inner];
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
  const [box, inner] = panel("");
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

// --- a review of the year, which is a different question ------------------

// --- the route that needs nothing set up -----------------------------------

/**
 * The prompt, for a person to carry to whatever model they already have.
 *
 * No key, no proxy and no cost. It is also often the better answer: a
 * frontier model asked once about two hundred lines will beat a cheap one
 * asked ten times about twenty, and somebody pasting into a window they
 * already pay for is not watching a meter.
 *
 * What comes back goes through the same door as everything else -- the chart
 * check, the account translation, the direction look -- because an answer
 * from a chat window has had even less of this app's care than one from the
 * API, not more.
 */
function carryPanel(): HTMLElement {
  const [box, inner] = panel("");
  inner.append(
    carrySection({
      onRead: ({ got }) => {
        showPage("reconcile");
        void Promise.resolve().then(() => {
          alert(
            `${got} suggestion${got === 1 ? "" : "s"} read. They are on the lines they ` +
              "belong to, under AI suggested.",
          );
        });
      },
      alongside: [button("Go to Reconcile", () => showPage("reconcile"))],
    }),
  );
  return box;
}

// --- asking automatically, which happens on the page where the coding is done -

/**
 * Where the suggestions are, which is not here.
 *
 * This page sets the thing up. The asking is on Reconcile, beside the lines
 * it is about, because a suggestion read anywhere else has to be carried back
 * to the row it belongs to before it can be agreed to.
 */
