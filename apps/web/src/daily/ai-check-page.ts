import { redraw, showPage } from "../app.js";
import { $, state } from "../state.js";
import { note } from "../ui.js";
import { aiRoute } from "../ai-backend.js";
import { aiKeyPanel, canAskAutomatically, refreshAiStatus } from "../ai-key-panel.js";
import { runReview } from "../ai-review-run.js";
import {
  OPENACCOUNTANTS_CONNECT,
  OPENACCOUNTANTS_MCP,
  reviewDisclaimer,
  reviewPossible,
  reviewPrompt,
  yearsInBooks,
} from "../ai-review.js";

/**
 * A year-end check of the accounts, against New Zealand tax rules.
 *
 * Its own page rather than a section under the coding suggestions, because it
 * is a different question. Coding asks what one line is and gets an account
 * back, which this app can check against the chart. This asks whether the
 * finished year hangs together -- is anything in the wrong place, does the
 * GST treatment match the registration, what is missing that a business of
 * this kind always has -- and gets prose back, which nothing here can check.
 * So nothing here pretends to: the answer is shown as what it is and goes
 * nowhere near the ledger.
 *
 * Two ways to ask, and they share the key with the suggestions page because a
 * key belongs to a set of books rather than to a page.
 *
 * Run it here, and the guide library is genuinely connected: the tools are
 * listed, offered to the model as functions it may call, and each call is
 * carried across and each answer back. Or copy the prompt into an assistant
 * that has its own connector. The second was the only way until now, because
 * Gemini has no connector of its own -- which is what it says when asked for
 * one, and the reason the loop had to be written here.
 */

let running = false;
let lastSaid = "";
let result: { text: string; consulted: string[]; connected: boolean; year: number } | null = null;

export function renderAiCheck(): void {
  const body = $("ai-check-body");
  body.textContent = "";

  if (state.ledger.aiEnabled !== true) {
    body.append(
      step("Not on yet", "AI accounts check"),
      note(
        "Asking a model anything is off until it is turned on for these books, and that is " +
          "done on the AI suggestions page, where what would be sent is set out in full. " +
          "Turn it on there and this page works too — it is the same key and the same " +
          "decision.",
      ),
      actions([primary("Go to AI suggestions", () => showPage("ai"))]),
    );
    return;
  }

  body.append(
    step("What this is", "Year-end review against New Zealand tax rules"),
    note(
      "A review of the finished year rather than of one line: whether each account holds " +
        "what belongs in it, whether the GST treatments match what each entity is " +
        "registered for, which deductions need a record the books do not show, and what a " +
        "business of this kind usually has that these books do not. It reads the year's " +
        "totals, not its transactions.",
    ),
    sourceNote(),
  );

  if (!reviewPossible()) {
    body.append(note("Nothing to review yet: these books need transactions and a chart first."));
    return;
  }

  if (aiRoute() !== "none") {
    body.append(
      step("The key", "One key, both pages"),
      aiKeyPanel({
        page: "aiCheck",
        title: "A Google AI key, asked automatically",
        countedIn: "reviews and transactions",
      }),
    );
  }

  body.append(whatTheGuidesAre());
  body.append(step("Ask", "Run the check, or carry it yourself"), askPanel());
  if (result !== null) body.append(answerPanel(result));
  void refreshAiStatus("aiCheck");
}

// --- small builders, kept here so the page reads top to bottom -------------

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

function primary(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "primary";
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

function actions(children: HTMLElement[]): HTMLElement {
  const row = document.createElement("div");
  row.className = "migration-actions";
  row.append(...children);
  return row;
}

function panel(): [HTMLElement, HTMLElement] {
  const box = document.createElement("div");
  box.className = "ai-panel";
  const inner = document.createElement("div");
  box.append(inner);
  return [box, inner];
}

/** Where the rules come from, which is the whole reason to trust the answer. */
function sourceNote(): HTMLElement {
  const why = document.createElement("p");
  why.className = "ai-careful";
  why.append(
    document.createTextNode(
      "The rules come from OpenAccountants — tax guides written against primary sources, " +
        "the Acts and Inland Revenue's own material — rather than from the model's memory. " +
        "Run the check here and this page connects to it directly and makes the model cite " +
        "what it used and how far that guide has been checked: ",
    ),
  );
  const connect = document.createElement("a");
  connect.href = OPENACCOUNTANTS_CONNECT;
  connect.target = "_blank";
  connect.rel = "noopener noreferrer";
  connect.textContent = "openaccountants.com";
  why.append(connect, document.createTextNode(` (${OPENACCOUNTANTS_MCP})`));
  return why;
}

/**
 * What the guides are, and what they are not.
 *
 * The library's own front page says every skill "reports whether a licensed
 * accountant has signed it off", and for New Zealand today the answer it
 * reports is no: all ten NZ guides come back as engine drafts, verification
 * "research_verified", zero verified facts, no named reviewer. This page said
 * "signed off by named, licensed accountants" until a real run printed the
 * statuses back and showed that it was not true here.
 *
 * Said on the page rather than only in the prompt, because somebody deciding
 * whether to act on the answer is the one who needs it, and by then the
 * prompt is long gone.
 */
function whatTheGuidesAre(): HTMLElement {
  const [box, inner] = panel();
  inner.append(
    note(
      "What the guides are: written from primary sources — the Acts, Inland Revenue's own " +
        "material — and each one carries its own review status. The New Zealand guides are " +
        "drafts today: none has been signed off by a named accountant. That still beats a " +
        "model answering from memory, because you can read what it cited and check it. It " +
        "does not make the answer reviewed, and the check is told to repeat each guide's " +
        "status rather than imply one it does not have.",
    ),
  );
  inner.append(
    note(
      "The library allows three lookups to anyone not signed in, then asks for a free " +
        "account. A check usually wants more than three, so expect the answer to say which " +
        "guides it could not reach — it is told to. Sign in at openaccountants.com if you " +
        "want the rest; nothing here signs you in or holds an account of yours.",
    ),
  );
  return box;
}

// --- asking ----------------------------------------------------------------

function askPanel(): HTMLElement {
  const [box, inner] = panel();

  const years = yearsInBooks();
  const pickYear = document.createElement("select");
  for (const year of years) {
    const option = document.createElement("option");
    option.value = String(year);
    option.textContent = `Year to 31 March ${year}`;
    option.selected = year === years[0];
    pickYear.append(option);
  }
  const label = document.createElement("label");
  label.className = "ai-model";
  label.append("Which year ", pickYear);
  inner.append(label);

  const said = document.createElement("p");
  said.className = "cloud-said";
  said.textContent = lastSaid;

  // What actually leaves this machine, and where each part of it goes. Two
  // destinations, not one, and somebody turning this on is owed the
  // difference: the figures go to Google; the guide library only ever sees
  // the questions the model decides to ask it.
  inner.append(
    note(
      "Running it here sends the year's account totals and your entity descriptions to " +
        "Google, the same as the coding suggestions do. The guide library sees only the " +
        "lookups the model chooses to make — “motor vehicle logbook, NZ” — and never the " +
        "figures. It usually takes a minute: the model reads a few guides before it answers.",
    ),
  );

  const run = document.createElement("button");
  run.type = "button";
  run.className = "primary";
  run.textContent = running ? "Checking…" : "Run the check";
  run.disabled = running || !canAskAutomatically();
  if (running) {
    run.classList.add("working");
    run.setAttribute("aria-busy", "true");
  }
  run.title = canAskAutomatically()
    ? "Connects to the guide library and asks your model."
    : "Needs a key. Add one above, or copy the prompt below into an assistant instead.";
  run.addEventListener("click", () => {
    running = true;
    lastSaid = "Starting…";
    redraw("aiCheck");
    const year = Number(pickYear.value);
    void runReview(reviewPrompt(year), (progress) => {
      // Straight onto the element rather than through a redraw: a redraw
      // mid-run would rebuild the button that is running.
      lastSaid = progress;
      const live = document.querySelector("#ai-check-body .cloud-said");
      if (live !== null) live.textContent = progress;
    }).then(
      (done) => {
        running = false;
        if (done.error !== undefined) {
          lastSaid = done.error;
          redraw("aiCheck");
          return;
        }
        lastSaid = "";
        result = { ...done, year };
        redraw("aiCheck");
      },
      (error: unknown) => {
        running = false;
        lastSaid = (error as Error).message;
        redraw("aiCheck");
      },
    );
  });

  inner.append(actions([run]), said);

  if (!canAskAutomatically()) {
    inner.append(
      note(
        "No key set, so the button above is off. The prompt below needs none: it goes into " +
          "whatever assistant you already use.",
      ),
    );
  }

  inner.append(carryItYourself(pickYear));
  inner.append(reviewDisclaimer());
  return box;
}

/**
 * The other way, which needs nothing set up.
 *
 * Kept because it is often the better answer and sometimes the only one: a
 * frontier assistant with OpenAccountants already connected, asked once, will
 * usually beat a cheap model driven from here -- and a copy of this app
 * running in a browser alone has no key route at all.
 */
function carryItYourself(pickYear: HTMLSelectElement): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "ai-carry";

  const heading = document.createElement("h3");
  heading.textContent = "Or carry it to an assistant yourself";
  wrap.append(
    heading,
    note(
      "Claude, ChatGPT, Cursor and Windsurf take MCP connectors of their own. Connect " +
        "OpenAccountants there, paste this in, and paste what it says back below. Nothing " +
        "is set up and nothing is charged here.",
    ),
  );

  const said = document.createElement("p");
  said.className = "cloud-said";
  const shown = document.createElement("pre");
  shown.className = "ai-prompt";
  shown.hidden = true;

  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = "Copy the review prompt";
  copy.addEventListener("click", () => {
    const text = reviewPrompt(Number(pickYear.value));
    void navigator.clipboard.writeText(text).then(
      () => {
        said.textContent =
          "Copied. Paste it into an assistant with OpenAccountants connected, then paste " +
          "what it says back below.";
      },
      () => {
        shown.textContent = text;
        shown.hidden = false;
        said.textContent =
          "This browser would not let the page reach the clipboard, so here it is to copy " +
          "by hand.";
      },
    );
  });

  const show = document.createElement("button");
  show.type = "button";
  show.textContent = "Show it instead";
  show.addEventListener("click", () => {
    shown.textContent = reviewPrompt(Number(pickYear.value));
    shown.hidden = !shown.hidden;
    show.textContent = shown.hidden ? "Show it instead" : "Hide it";
  });

  wrap.append(actions([copy, show]), said, shown);

  const backHeading = document.createElement("h4");
  backHeading.textContent = "Paste what it said back";
  const answer = document.createElement("textarea");
  answer.className = "ai-about";
  answer.rows = 4;
  answer.placeholder = "The review, as the assistant wrote it";

  const read = document.createElement("button");
  read.type = "button";
  read.textContent = "Keep it on screen";
  read.addEventListener("click", () => {
    const text = answer.value.trim();
    if (text === "") return;
    result = { text, consulted: [], connected: false, year: Number(pickYear.value) };
    answer.value = "";
    redraw("aiCheck");
  });

  wrap.append(backHeading, answer, actions([read]));
  return wrap;
}

// --- what came back --------------------------------------------------------

/**
 * The answer, held on the page and nowhere else.
 *
 * A review is somebody's reading of the books, not a fact about them. Written
 * into the ledger it would be indistinguishable a year later from something
 * the books themselves say, so it is not written into the ledger. Closing the
 * page loses it, which is the right trade.
 */
function answerPanel(
  got: { text: string; consulted: string[]; connected: boolean; year: number },
): HTMLElement {
  const [box, inner] = panel();

  const heading = document.createElement("h3");
  heading.textContent = `Review of the year to 31 March ${got.year}`;
  inner.append(heading);

  // Whether the guides were actually read is the first thing worth knowing
  // about the answer, so it is said above it rather than below.
  if (got.consulted.length > 0) {
    const what = document.createElement("details");
    what.className = "setup-migration-details";
    const summary = document.createElement("summary");
    summary.className = "setup-migration-summary";
    summary.textContent = `${got.consulted.length} lookup${got.consulted.length === 1 ? "" : "s"} in the guide library`;
    const list = document.createElement("ul");
    for (const one of got.consulted) {
      const item = document.createElement("li");
      item.textContent = one;
      list.append(item);
    }
    what.append(summary, list);
    inner.append(what);
  } else if (got.connected) {
    inner.append(
      note(
        "The model answered without looking anything up, so this is its own memory of New " +
          "Zealand tax rather than a guide anybody signed. Worth less than it reads.",
      ),
    );
  }

  const text = document.createElement("pre");
  text.className = "ai-prompt";
  text.textContent = got.text;

  const forget = document.createElement("button");
  forget.type = "button";
  forget.textContent = "Clear it";
  forget.addEventListener("click", () => {
    result = null;
    redraw("aiCheck");
  });

  inner.append(text, reviewDisclaimer(), actions([forget]));
  return box;
}
