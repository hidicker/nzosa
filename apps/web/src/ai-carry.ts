import { keepWhatIsUsable, promptToCarry, waitingForAnswers } from "./ai.js";
import { note } from "./ui.js";

/**
 * Carrying the question yourself: the whole of it, in one element.
 *
 * Built here rather than on either page because both want the same thing and
 * a second copy of it is a second thing to keep in step. The AI page shows it
 * as one of two ways to ask; the Reconcile page opens it under the toolbar,
 * where the lines it is about are.
 *
 * It is one conversation with three steps -- how many, copy, paste back --
 * and it ends when the answer is read, so on Reconcile it takes its own space
 * back rather than sitting open over the work it just produced.
 */

export interface CarryDone {
  /** How many suggestions were kept. */
  got: number;
  /** Said to the person, when something is worth saying. */
  said: string;
}

export function carrySection(options: {
  /** What to do once an answer has been read. Where it closes, it closes here. */
  onRead: (done: CarryDone) => void;
  /** Extra buttons beside "Read the answer" -- a way out, usually. */
  alongside?: HTMLElement[];
}): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "ai-carry";

  const heading = document.createElement("h3");
  heading.textContent = "Copy a prompt for any AI model";
  wrap.append(heading);
  // The honest contrast with the other route, which is Google's alone: this
  // one has no idea where the answer came from and does not need to.
  wrap.append(
    note(
      "ChatGPT, Claude, Gemini, Copilot, a local model — anything that can read a " +
        "question and write JSON. Nothing is set up and nothing is charged here.",
    ),
  );

  const waiting = waitingForAnswers();
  wrap.append(
    note(
      waiting.length === 0
        ? "Nothing is waiting: every line has a rule, a default or your own answer."
        : `${waiting.length} line${waiting.length === 1 ? "" : "s"} nothing recognises. ` +
          "Copy the prompt, paste it into ChatGPT, Claude, Gemini or anything else, and " +
          "paste the answer back below. No key needed, and nothing is charged to anybody " +
          "but whoever you pasted it into.",
    ),
  );
  if (waiting.length === 0) return wrap;

  const howMany = document.createElement("select");
  for (const size of [20, 50, 100, 250, waiting.length]) {
    if (size > waiting.length) continue;
    const option = document.createElement("option");
    option.value = String(size);
    option.textContent = size === waiting.length ? `All ${size}` : `${size} lines`;
    option.selected = size === Math.min(50, waiting.length);
    howMany.append(option);
  }
  const label = document.createElement("label");
  label.className = "ai-model";
  label.append("How many ", howMany);
  wrap.append(label);

  const said = document.createElement("p");
  said.className = "cloud-said";

  // Held from the copy to the paste: the answer names transactions by id, and
  // the ids only mean anything against the batch that was copied.
  let carried = promptToCarry(waiting, Number(howMany.value));
  howMany.addEventListener("change", () => {
    carried = promptToCarry(waiting, Number(howMany.value));
    said.textContent = "";
  });

  const shown = document.createElement("pre");
  shown.className = "ai-prompt";
  shown.hidden = true;

  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "primary";
  copy.textContent = "Copy the prompt";
  copy.addEventListener("click", () => {
    carried = promptToCarry(waiting, Number(howMany.value));
    void navigator.clipboard.writeText(carried.text).then(
      () => {
        said.textContent =
          `${carried.asked.length} lines copied. Paste it into your model, then paste its ` +
          "answer into the box below.";
      },
      () => {
        // The prompt itself, rather than an apology: being told the clipboard
        // failed is no use to somebody who still needs the thing on it.
        shown.textContent = carried.text;
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
    carried = promptToCarry(waiting, Number(howMany.value));
    shown.textContent = carried.text;
    shown.hidden = !shown.hidden;
    show.textContent = shown.hidden ? "Show it instead" : "Hide it";
  });

  const row = document.createElement("div");
  row.className = "migration-actions";
  row.append(copy, show);
  wrap.append(row, said, shown);

  const backHeading = document.createElement("h4");
  backHeading.textContent = "Paste the answer back";
  const answer = document.createElement("textarea");
  answer.className = "ai-about";
  answer.rows = 4;
  answer.placeholder = '[{"id": "...", "code": "401", "confidence": 0.8, "because": "..."}]';

  const take = document.createElement("button");
  take.type = "button";
  take.className = "primary";
  take.textContent = "Read the answer";
  take.addEventListener("click", () => {
    if (answer.value.trim() === "") return;
    const done = keepWhatIsUsable(answer.value, carried.asked, carried.codes, "pasted");
    answer.value = "";
    // Trouble stays on screen: it is the one case where closing would throw
    // away the only account of what went wrong.
    if (done.said !== "") {
      said.textContent = done.said;
      return;
    }
    options.onRead(done);
  });

  const backRow = document.createElement("div");
  backRow.className = "migration-actions";
  backRow.append(take, ...(options.alongside ?? []));
  wrap.append(backHeading, answer, backRow);
  return wrap;
}
