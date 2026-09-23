import { redraw, showPage } from "../app.js";
import { $, state } from "../state.js";
import { note } from "../ui.js";
import {
  OPENACCOUNTANTS_CONNECT,
  OPENACCOUNTANTS_MCP,
  reviewDisclaimer,
  reviewPossible,
  reviewPrompt,
  yearsInBooks,
} from "../ai-review.js";
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
 * One way to ask: download the workbook, copy the prompt, paste both into an
 * assistant that has OpenAccountants connected, and paste the answer back.
 *
 * There was a second -- a button that asked the key on the AI suggestions
 * page, with this page driving the guide library itself through an MCP client
 * of ours. It worked, and it is still here: packages/core/src/mcp.ts holds
 * the client and ai-review-run.ts the loop, tested and unused. It is not
 * offered because it is not yet the equal of the route below. Three
 * anonymous lookups against a review that wants eight, each guide truncated
 * to fit, a cheap model, no workbook and no follow-up questions. Better to
 * offer one route that is good than two where the near one is worse and
 * looks easier.
 */

/**
 * The year last chosen, kept across redraws.
 *
 * The picker was rebuilt on every render and reset itself, so reading an
 * answer put the year back to the newest and the heading above it then named
 * a year nobody had asked about.
 */
let chosenYear = 0;
let result: { text: string; year: number } | null = null;

export function renderAiCheck(): void {
  const body = $("ai-check-body");
  body.textContent = "";

  if (state.ledger.aiEnabled !== true) {
    body.append(
      step("Not on yet", "AI accounts check"),
      note(
        "Sending anything about these books to a model is off until it is turned on, and " +
          "that is done on the AI suggestions page, where what would be sent is set out in " +
          "full. Turn it on there and this page works too — it is the same decision, and " +
          "this page needs no key at all.",
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

  body.append(whatTheGuidesAre());

  const pickYear = yearPicker();
  body.append(step("Choose", "Which year"), pickYear.box);
  body.append(
    step("Take it to an assistant", "Download, copy, paste back"),
    carryPanel(pickYear.pick),
  );

  if (result !== null) body.append(answerPanel(result));
  body.append(reviewDisclaimer());
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
        "For more information on OpenAccountants: ",
    ),
  );
  const connect = document.createElement("a");
  connect.href = OPENACCOUNTANTS_CONNECT;
  connect.target = "_blank";
  connect.rel = "noopener noreferrer";
  connect.textContent = "openaccountants.com";
  // Not the MCP address as well. It belongs in the connect steps, where there
  // is a button to copy it and a reason to; here it was a second link nobody
  // is being asked to do anything with.
  why.append(connect);
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
      "The library allows three lookups to anyone not signed in, and a review of a whole " +
        "year wants more than three. Your assistant asks you to sign in the first time it " +
        "uses the connector — a free account, once — and after that the lookups are yours. " +
        "Nothing here signs you in or holds an account of yours.",
    ),
  );
  return box;
}

// --- what is being asked ---------------------------------------------------

/**
 * Which year, chosen before either the workbook or the prompt is made.
 *
 * The element is handed on rather than its value: the buttons below are
 * built now and pressed later, and what matters is what it says then.
 */
function yearPicker(): { box: HTMLElement; pick: HTMLSelectElement } {
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

  const label = document.createElement("label");
  label.className = "ai-model";
  label.append("Which year ", pickYear);
  inner.append(label);

  return { box, pick: pickYear };
}

/**
 * The same prompt, addressed to an assistant that has the connector.
 *
 * It opens by naming OpenAccountants because the library says to: an
 * assistant with a connector installed will often answer from memory anyway
 * unless the question reaches for it by name. Telling somebody to type that
 * themselves and then handing them a prompt without it is how the advice gets
 * lost between the reading and the pasting, so it is in the text they copy.
 */
function promptForAssistant(year: number): string {
  return (
    "Using OpenAccountants, work through the review below. Look the rules up in the " +
    "guides rather than answering from memory." +
    "\n\n" +
    reviewPrompt(year)
  );
}

function carryPanel(pickYear: HTMLSelectElement): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "ai-carry";

  wrap.append(
    note(
      "Nothing is set up and nothing is charged here. The work happens in an assistant you " +
        "already use — it reads the guides, checks them against the figures below, and you " +
        "can ask it follow-up questions afterwards, which is most of the value.",
    ),
    // The setup is one-off and the reason for it is not obvious, so it is
    // said before the steps rather than after them.
    note(
      "It needs OpenAccountants connected to that assistant, once. That is what lets it " +
        "look the rules up rather than answering from memory, and it is what gets you past " +
        "the three free lookups.",
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
    const text = promptForAssistant(Number(pickYear.value));
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
    shown.textContent = promptForAssistant(Number(pickYear.value));
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
    result = { text, year: Number(pickYear.value) };
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
 * from this route is worth having at all -- so it is worth four lines rather
 * than four words.
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
function answerPanel(got: { text: string; year: number }): HTMLElement {
  const [box, inner] = panel();

  const heading = document.createElement("h3");
  heading.textContent = `Review of the year to 31 March ${got.year}`;
  inner.append(heading);

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
