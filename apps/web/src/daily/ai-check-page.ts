import { redraw, showPage } from "../app.js";
import { $, state } from "../state.js";
import { note } from "../ui.js";
import { aiRoute } from "../ai-backend.js";
import { aiKeyPanel, canAskAutomatically, refreshAiStatus } from "../ai-key-panel.js";
import { runReview } from "../ai-review-run.js";
import {
  OPENACCOUNTANTS_CONNECT,
  OPENACCOUNTANTS_MCP,
  REVIEW_FOCUSES,
  reviewDisclaimer,
  reviewPossible,
  reviewPrompt,
  yearsInBooks,
} from "../ai-review.js";
import type { ReviewFocus } from "../ai-review.js";
import { downloadExcelReport } from "./excel-export.js";

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
/**
 * What was asked for last, kept across redraws.
 *
 * The pickers were rebuilt on every render and reset themselves, so finishing
 * a run put the year back to the newest and the subject back to the first --
 * and the answer above them was about neither.
 */
let chosenYear = 0;
let chosenFocus: ReviewFocus = "year";
let result:
  | { text: string; consulted: string[]; connected: boolean; year: number; focus: ReviewFocus }
  | null = null;

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

  body.append(whatTheGuidesAre(), whichNeedsAConnector());

  // Both routes ask the same two questions, so the pickers are built once and
  // handed to each. Two pairs would be two answers to keep in step.
  const choose = choosePanel();
  body.append(step("Choose", "Which year, and what to check"), choose.box);

  // The carried route comes first, because it is the one that works for
  // everybody: no key, no cost, and the better answer. It was underneath a
  // key panel most people will never fill in.
  body.append(
    step("Take it to an assistant", "Download, copy, paste back"),
    carryPanel(choose.pickYear, choose.pickFocus),
  );

  if (aiRoute() !== "none") {
    body.append(
      step("Or ask from here", "Your key, and the check"),
      aiKeyPanel({
        page: "aiCheck",
        title: "A Google AI key, asked automatically",
        countedIn: "reviews and transactions",
      }),
      runPanel(choose.pickYear, choose.pickFocus),
    );
  }

  if (result !== null) body.append(answerPanel(result));
  body.append(reviewDisclaimer());
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

/**
 * Which of the two routes needs a connector, which is the opposite of how it
 * reads.
 *
 * The obvious guess is that asking from inside the app is the simple one and
 * pasting into Claude is the one that needs setting up. It is the other way
 * round. An assistant you paste into is on its own and must have
 * OpenAccountants installed; the model asked from here is handed the
 * library's tools by this page and never learns MCP exists. That is why a key
 * for any provider would work from here -- the connector is not the model's
 * job -- and why the paste route has a one-off setup step and this one does
 * not.
 */
function whichNeedsAConnector(): HTMLElement {
  const [box, inner] = panel();
  inner.append(
    note(
      "Which one needs setting up, since it is the opposite of what you would expect. " +
        "Pasting into an assistant needs OpenAccountants connected there, once — it is on " +
        "its own and has to be able to reach the library itself. Asking from here needs no " +
        "connector at all: this page opens the library, hands your model the tools, and " +
        "carries each lookup across. The model never learns MCP exists.",
    ),
  );
  return box;
}

// --- what is being asked ---------------------------------------------------

/**
 * The year and the subject, chosen once for both routes.
 *
 * The elements themselves are handed on rather than their values, because
 * the two routes are built at the same moment and neither can read a choice
 * that has not been made yet.
 */
function choosePanel(): {
  box: HTMLElement;
  pickYear: HTMLSelectElement;
  pickFocus: HTMLSelectElement;
} {
  const [box, inner] = panel();

  const years = yearsInBooks();
  if (chosenYear === 0) chosenYear = years[0] ?? new Date().getFullYear();
  const pickYear = document.createElement("select");
  for (const year of years) {
    const option = document.createElement("option");
    option.value = String(year);
    option.textContent = `Year to 31 March ${year}`;
    option.selected = year === chosenYear;
    pickYear.append(option);
  }
  pickYear.addEventListener("change", () => {
    chosenYear = Number(pickYear.value);
  });

  /**
   * Which review, because they are three different jobs.
   *
   * One prompt that carried account totals and then asked whether the GST
   * treatments were right was asking a question its own contents could not
   * answer. Each of these carries what its question needs: the GST one every
   * period's boxes and what was filed, the income tax one the IR10 and the
   * depreciation.
   */
  const pickFocus = document.createElement("select");
  for (const one of REVIEW_FOCUSES) {
    const option = document.createElement("option");
    option.value = one.id;
    option.textContent = one.label;
    option.title = one.blurb;
    option.selected = one.id === chosenFocus;
    pickFocus.append(option);
  }
  const blurb = document.createElement("p");
  blurb.className = "page-hint";
  const sayBlurb = (): void => {
    blurb.textContent = REVIEW_FOCUSES.find((one) => one.id === chosenFocus)?.blurb ?? "";
  };
  sayBlurb();
  pickFocus.addEventListener("change", () => {
    chosenFocus = pickFocus.value as ReviewFocus;
    sayBlurb();
  });

  const label = document.createElement("label");
  label.className = "ai-model";
  label.append("Which year ", pickYear);
  const focusLabel = document.createElement("label");
  focusLabel.className = "ai-model";
  focusLabel.append("What to check ", pickFocus);
  inner.append(label, focusLabel, blurb);

  return { box, pickYear, pickFocus };
}

// --- asking from here ------------------------------------------------------

/**
 * The route that uses a key, which needs no connector of its own.
 *
 * Worth being plain about, because the two routes differ in exactly the
 * opposite way to how it reads: an assistant you paste into has to have
 * OpenAccountants installed, and the model asked from here does not -- this
 * page is the connector. The model never learns MCP exists; it is handed
 * tools and it calls them.
 */
function runPanel(
  pickYear: HTMLSelectElement,
  pickFocus: HTMLSelectElement,
): HTMLElement {
  const [box, inner] = panel();

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
    ? "This page connects to the guide library; your model is handed its tools."
    : "Needs a key. Add one above, or use the prompt further up instead.";
  run.addEventListener("click", () => {
    running = true;
    lastSaid = "Starting…";
    redraw("aiCheck");
    const year = Number(pickYear.value);
    const focus = pickFocus.value as ReviewFocus;
    void runReview(reviewPrompt(year, focus), (progress) => {
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
        result = { ...done, year, focus };
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
        "No key set, so this button is off. The route above needs none — it goes into " +
          "whatever assistant you already use.",
      ),
    );
  }

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
/**
 * The same prompt, addressed to an assistant that has the connector.
 *
 * It opens by naming OpenAccountants because the library says to: an
 * assistant with a connector installed will often answer from memory anyway
 * unless the question reaches for it by name. Telling somebody to type that
 * themselves and then handing them a prompt without it is how the advice gets
 * lost between the reading and the pasting, so it is in the text they copy.
 */
function promptForAssistant(year: number, focus: ReviewFocus): string {
  return (
    "Using OpenAccountants, work through the review below. Look the rules up in the " +
    "guides rather than answering from memory." +
    "\n\n" +
    reviewPrompt(year, focus)
  );
}

function carryPanel(
  pickYear: HTMLSelectElement,
  pickFocus: HTMLSelectElement,
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "ai-carry";

  wrap.append(
    note(
      "Often the better answer, and free. Asking from here uses whatever model your key is " +
        "for, which is a fast cheap one; a frontier assistant reads the guides more " +
        "carefully and is better at telling what matters from what does not. It costs " +
        "nothing here, and nothing extra there if you already pay for one.",
    ),
    // The whole reason to bother, said before the instructions rather than
    // after them: three lookups is not enough for a year-end review, and the
    // thing that lifts it is free and takes a minute.
    note(
      "It also gets past the three-lookup limit. Signing in to OpenAccountants — a free " +
        "account — is what lifts it, and your assistant asks you to do that once, the first " +
        "time it uses the connector.",
    ),
    connectSteps(),
  );

  const said = document.createElement("p");
  said.className = "cloud-said";
  const shown = document.createElement("pre");
  shown.className = "ai-prompt";
  shown.hidden = true;

  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "primary";
  copy.textContent = "Copy the review prompt";
  copy.addEventListener("click", () => {
    const text = promptForAssistant(Number(pickYear.value), pickFocus.value as ReviewFocus);
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
  show.textContent = "Show prompt";
  show.addEventListener("click", () => {
    shown.textContent = promptForAssistant(
      Number(pickYear.value),
      pickFocus.value as ReviewFocus,
    );
    shown.hidden = !shown.hidden;
    show.textContent = shown.hidden ? "Show prompt" : "Hide prompt";
  });

  // The workbook, because a prompt can only carry so much.
  //
  // What goes in the prompt is the shape of the year -- totals, boxes,
  // registrations -- and an assistant asked to check whether a particular
  // account holds the wrong thing has to take that on trust. The workbook is
  // the working underneath it: a trial balance, the general ledger, every
  // coded transaction, the depreciation schedule, each GST return and the
  // filed ones beside them. This route can attach a file, so it should.
  const workbook = document.createElement("button");
  workbook.type = "button";
  workbook.className = "primary";
  workbook.textContent = "Download the workbook";
  workbook.addEventListener("click", () => {
    downloadExcelReport(Number(pickYear.value));
  });

  // The file first, then the prompt, because that is the order the work is
  // done in: an attachment added after the message has been sent is an
  // attachment nobody reads.
  const fileHeading = document.createElement("h4");
  fileHeading.textContent = "1. Download the workbook";
  wrap.append(
    fileHeading,
    note(
      "Attach it to the same message as the prompt. It holds the working the prompt only " +
        "summarises: trial balance, general ledger, every transaction and how it was coded, " +
        "the depreciation schedule, each GST return and the filed ones beside them. Without " +
        "it the assistant is checking your totals; with it, it can check the transactions " +
        "behind them. It is your books in full, so send it only where you would send the " +
        "books.",
    ),
    actions([workbook]),
  );

  const promptHeading = document.createElement("h4");
  promptHeading.textContent = "2. Copy the prompt";
  wrap.append(
    promptHeading,
    note(
      "It already opens with “Using OpenAccountants”. An assistant with the connector " +
        "installed will still answer from memory unless the question reaches for it by " +
        "name, which is the library's own advice. Send it in the same message as the " +
        "workbook.",
    ),
    actions([copy, show]),
    said,
    shown,
  );

  const backHeading = document.createElement("h4");
  backHeading.textContent = "3. Paste what it said back";
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
    result = {
      text,
      consulted: [],
      connected: false,
      year: Number(pickYear.value),
      focus: pickFocus.value as ReviewFocus,
    };
    answer.value = "";
    redraw("aiCheck");
  });

  wrap.append(backHeading, answer, actions([read]));
  return wrap;
}

/**
 * The one-off step, spelled out.
 *
 * "Connect OpenAccountants there" was the whole of what this used to say,
 * which assumes somebody knows what a connector is and where their assistant
 * keeps them. It is a two-minute job done once, and the reason the answer
 * from this route is worth more than the one from the button above -- so it
 * is worth four lines rather than four words.
 *
 * Claude is named first because OpenAccountants names it first: their install
 * page marks Claude.ai recommended, and second-guessing the people who wrote
 * the server about which client works best with it would be invention.
 */
function connectSteps(): HTMLElement {
  const wrap = document.createElement("div");

  const heading = document.createElement("h4");
  heading.textContent = "First time only: connect OpenAccountants to your assistant";
  wrap.append(heading);

  const steps = document.createElement("ol");
  steps.className = "ai-connect-steps";

  const add = (text: string, extra?: Node[]): void => {
    const item = document.createElement("li");
    item.append(document.createTextNode(text));
    for (const node of extra ?? []) item.append(node);
    steps.append(item);
  };

  const where = document.createElement("a");
  where.href = OPENACCOUNTANTS_CONNECT;
  where.target = "_blank";
  where.rel = "noopener noreferrer";
  where.textContent = "openaccountants.com/connect";

  // The address belongs to the step that asks for it, inside its list item.
  // It was a list item of its own and drew no number, which was only true
  // because a flex container is not a list-item box -- the right-looking
  // result for a reason that would not survive a change of layout.
  const address = document.createElement("code");
  address.className = "ai-connect-url";
  address.textContent = OPENACCOUNTANTS_MCP;

  const copyUrl = document.createElement("button");
  copyUrl.type = "button";
  copyUrl.textContent = "Copy the address";
  copyUrl.addEventListener("click", () => {
    void navigator.clipboard.writeText(OPENACCOUNTANTS_MCP).then(
      () => {
        copyUrl.textContent = "Copied";
      },
      () => {
        // It is on the screen either way, which is why it is shown rather
        // than hidden behind the button.
        copyUrl.textContent = "Copy it from above";
      },
    );
  });

  const addressRow = document.createElement("div");
  addressRow.className = "ai-connect-url-row";
  addressRow.append(address, copyUrl);

  add(
    "In Claude: Settings → Customize → Connectors → + → Add custom connector. Name it " +
      "OpenAccountants and paste this address:",
    [addressRow],
  );

  add("Add, then Allow tools. Sign in to OpenAccountants when it asks — free, once.");
  add(
    "ChatGPT, Cursor, Windsurf and Copilot Studio take connectors too; Claude is the one " +
      "OpenAccountants recommends. Either way it has to be a desktop app or browser — a " +
      "phone cannot add one. The current steps for each are at ",
    [where, document.createTextNode(".")],
  );

  wrap.append(steps);
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
function answerPanel(got: {
  text: string;
  consulted: string[];
  connected: boolean;
  year: number;
  focus: ReviewFocus;
}): HTMLElement {
  const [box, inner] = panel();

  const heading = document.createElement("h3");
  // Named, because three reviews of the same year look alike at the top and
  // are about entirely different things.
  const what = REVIEW_FOCUSES.find((one) => one.id === got.focus)?.label ?? "Review";
  heading.textContent = `${what} — year to 31 March ${got.year}`;
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
