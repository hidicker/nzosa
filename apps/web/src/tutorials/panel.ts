import { DEMO_PERSONAS, currentDemoPersona } from "../demo-personas.js";
import { loadDemoData } from "../migrate/setup-wizard.js";
import { runLesson } from "./engine.js";
import type { Lesson } from "./engine.js";
import { LESSONS } from "./lessons.js";

/**
 * The Tutorials page: short lessons on the real app, in any order.
 *
 * Shown by itself the first time somebody arrives at the demo, and from the
 * banner after that. Progress is kept in this browser and nowhere else.
 */

const PROGRESS = "nzosa:tutorials";
const SEEN = "nzosa:tutorials-seen";

type Progress = Record<string, { status: "started" | "done"; step: number }>;

function progress(): Progress {
  try {
    const held = JSON.parse(localStorage.getItem(PROGRESS) ?? "{}") as unknown;
    return held !== null && typeof held === "object" ? (held as Progress) : {};
  } catch {
    return {};
  }
}

function saveProgress(next: Progress): void {
  try {
    localStorage.setItem(PROGRESS, JSON.stringify(next));
  } catch {
    // Without storage the lessons still run; they just start at the top.
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

let panel: HTMLDialogElement | null = null;

export function closeTutorials(): void {
  panel?.close();
  panel?.remove();
  panel = null;
}

async function start(lesson: Lesson): Promise<void> {
  closeTutorials();
  const held = progress()[lesson.id];
  const from = held?.status === "started" ? held.step : 0;
  const end = await runLesson(lesson, from);
  const next = progress();
  if (end.how === "done") next[lesson.id] = { status: "done", step: 0 };
  else if (end.how === "later") next[lesson.id] = { status: "started", step: end.step };
  else if (next[lesson.id]?.status !== "done") delete next[lesson.id];
  saveProgress(next);
  // Back to the list after finishing, so the next lesson is one press away.
  if (end.how === "done") openTutorials();
}

function lessonCard(lesson: Lesson, held: Progress[string] | undefined, nextUp: boolean): HTMLElement {
  const card = el("article", nextUp ? "tut-lesson tut-lesson-next" : "tut-lesson");
  const text = el("div", "tut-lesson-text");
  if (nextUp) text.append(el("span", "tut-lesson-flag", "Next up"));
  text.append(el("h3", "tut-lesson-title", lesson.title), el("p", "tut-lesson-summary", lesson.summary));
  const status = held?.status === "done" ? "Done" : held?.status === "started" ? "Started" : "Not started";
  text.append(el("span", "tut-lesson-meta", `${lesson.minutes} min · ${status}`));

  const go = el(
    "button",
    nextUp ? "primary" : "",
    held?.status === "done" ? "Again" : held?.status === "started" ? "Continue" : "Start",
  );
  go.type = "button";
  go.addEventListener("click", () => {
    if (held?.status === "done") {
      const next = progress();
      delete next[lesson.id];
      saveProgress(next);
    }
    void start(lesson);
  });
  card.append(text, go);
  return card;
}

/** Which set of invented books to look at, as cards. Only those ready to show. */
function booksChooser(): HTMLElement | null {
  const ready = DEMO_PERSONAS.filter((p) => p.ready === true);
  if (ready.length < 2) return null;
  const wrap = el("section", "tut-books");
  wrap.append(el("h3", "tut-section-title", "Which books would you like to look at?"));
  const current = currentDemoPersona();
  for (const persona of ready) {
    const choice = el("button", persona.id === current ? "tut-book tut-book-on" : "tut-book");
    choice.type = "button";
    choice.append(el("strong", "", persona.label), el("span", "", persona.shows));
    choice.addEventListener("click", () => {
      if (persona.id === current) return;
      closeTutorials();
      const busy = document.createElement("button");
      void loadDemoData(busy, persona.id);
    });
    wrap.append(choice);
  }
  return wrap;
}

export function openTutorials(): void {
  closeTutorials();
  try {
    localStorage.setItem(SEEN, "yes");
  } catch {
    // Seen or not, the panel is open now.
  }

  const box = document.createElement("dialog");
  box.className = "tut-panel";
  box.setAttribute("aria-label", "Tutorials");

  const head = el("div", "tut-panel-head");
  const close = el("button", "tut-panel-close", "Close");
  close.type = "button";
  close.addEventListener("click", () => closeTutorials());
  head.append(el("h2", "", "Tutorials"), close);

  const body = el("div", "tut-panel-body");
  body.append(
    el(
      "p",
      "tut-panel-intro",
      "Short, hands-on lessons on the real app, using the demo books. Do them in any order, and come back any time.",
    ),
  );
  const chooser = booksChooser();
  if (chooser !== null) body.append(chooser);

  const held = progress();
  const nextUp = LESSONS.find((l) => held[l.id]?.status !== "done");
  for (const lesson of LESSONS) body.append(lessonCard(lesson, held[lesson.id], lesson === nextUp));

  box.append(head, body);
  box.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeTutorials();
  });
  box.addEventListener("click", (event) => {
    // A press on the dimmed space around the panel closes it.
    if (event.target === box) closeTutorials();
  });
  document.body.append(box);
  panel = box;
  box.showModal();
}

/**
 * Open the Tutorials page on a first visit, once the books have loaded.
 *
 * Waits for the loading screen to go, so it opens over the real app rather
 * than over a spinner; gives up quietly if that never happens.
 */
export function openTutorialsOnFirstVisit(): void {
  let seen = true;
  try {
    seen = localStorage.getItem(SEEN) !== null;
  } catch {
    seen = true;
  }
  if (seen) return;

  const began = Date.now();
  const check = window.setInterval(() => {
    const loading = document.getElementById("app-loading");
    const gone = loading === null || loading.hidden || loading.offsetParent === null;
    if (gone) {
      window.clearInterval(check);
      window.setTimeout(() => openTutorials(), 400);
    } else if (Date.now() - began > 20_000) {
      window.clearInterval(check);
    }
  }, 300);
}
