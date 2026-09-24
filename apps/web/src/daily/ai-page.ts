import { redraw, showPage } from "../app.js";
import { saveEntities } from "../books.js";
import { $, state } from "../state.js";
import { save } from "../store.js";
import { note } from "../ui.js";
import { aiSuggestionCount, waitingForAnswers, whatWouldBeAsked } from "../ai.js";
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
  body.append(step("Set up", "Tell us about the business"), briefingPanel());

  // Then the choice. Neither is better everywhere: one needs no key and can
  // use a model somebody already pays for, the other is a button on the page
  // where the coding is done.
  body.append(
    step("Then, either way", "Two ways to ask AI"),
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
      title: "Or ask automatically: add any AI key",
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
  if (ready > 0) {
    out.push(note(`${ready} suggestion${ready === 1 ? "" : "s"} waiting to be read on Reconcile.`));
  }

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
    "Asked on a key of your own, it goes to Google on your account. Without one, it can " +
    "go through a shared key belonging to whoever runs nbparagliding.nz, and so through " +
    "their account. If these are a client's books rather than your own, that is their " +
    "data and their decision. It is off until you turn it on, and it is off separately " +
    "for every set of books.";
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
/**
 * An example for each kind of entity, shown greyed in its box.
 *
 * The coffee roastery is the example the page has always had, and it goes on
 * the first business, where it fits. The rest say what a rental or a person's
 * own affairs look like to somebody coding them -- which is the whole of what
 * these boxes are for.
 */
function exampleFor(entity: Entity, firstBusiness: boolean): string {
  if (entity.kind === "residential") {
    return "A house let to long-term tenants. Rent in; rates, insurance, mortgage interest " +
      "and repairs out.";
  }
  if (entity.kind === "commercial") {
    return "A shop unit leased to a business tenant, who pays rent plus GST and repays the " +
      "outgoings.";
  }
  if (entity.kind === "personal") {
    return "Personal spending: household bills, groceries, a car, and money moved to and " +
      "from the business.";
  }
  return firstBusiness
    ? "A coffee roastery in Nelson. Buys green beans by the sack, sells wholesale to cafes " +
        "and retail online. Two vans."
    : "What it does, who it sells to, and what it buys most of.";
}

/**
 * What each entity does, which goes with every question to a model.
 *
 * One box per entity and no box for the books as a whole. The books box asked
 * the same question again one level up, and with the entities listed beneath
 * it, somebody had to decide which of two places a sentence belonged in.
 *
 * Anything written in the old books box is moved into the first business, once,
 * rather than dropped or left sending text nobody can see any more.
 */
function briefingPanel(): HTMLElement {
  const [box, inner] = panel("");
  inner.append(
    note(
      "This goes with every question to the AI and makes its suggestions better. A chart " +
        "of accounts does not say whether “supplies” means green beans or gib board.",
    ),
  );

  const entities = entitiesOf();
  const legacy = (state.ledger.booksAbout ?? "").trim();
  if (legacy !== "" && entities.length > 0) {
    const target = entities.find((one) => (one.kind ?? "business") === "business") ?? entities[0];
    if (target !== undefined) {
      const had = (target.about ?? "").trim();
      const merged = had.includes(legacy) ? had : [had, legacy].filter((t) => t !== "").join(" ");
      state.ledger.booksAbout = "";
      void save(state.ledger);
      if (merged !== had) {
        const live = state.ledger.entities ?? emptyEntityModel();
        void saveEntities(
          {
            ...live,
            entities: live.entities.map((one) =>
              one.id === target.id ? { ...one, about: merged } : one,
            ),
          },
          `What ${target.name} does, moved from the books' description`,
        );
        target.about = merged;
      }
    }
  }

  let businessSeen = false;
  for (const entity of entities) {
    const isBusiness = (entity.kind ?? "business") === "business";
    const firstBusiness = isBusiness && !businessSeen;
    if (isBusiness) businessSeen = true;

    const row = document.createElement("div");
    row.className = "ai-entity";
    const name = document.createElement("span");
    name.className = "ai-entity-name";
    name.textContent = entity.name;
    // Two lines rather than one: a sentence about a business does not fit in
    // a single-line box, and one cut off at the edge reads as one unfinished.
    const what = document.createElement("textarea");
    what.className = "ai-about";
    what.rows = 2;
    what.placeholder = exampleFor(entity, firstBusiness);
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
