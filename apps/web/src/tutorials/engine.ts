import { showPage } from "../app.js";

/**
 * A lesson run over the real app: a card says one thing at a time, and a ring
 * shows where on the screen it is.
 *
 * Only ever looks. Nothing here changes the books: a hands-on step asks the
 * person to press the real button, and waits until they have. The ring takes
 * no clicks, so whatever it circles works exactly as it does without it.
 */

export interface LessonStep {
  title: string;
  body: string;
  /** Go to this page first. */
  page?: string;
  /** What to circle. Nothing, or nothing found, shows the card alone. */
  target?: () => Element | null;
  /**
   * A hands-on step: what to do, said in bold. The lesson waits until
   * `done` says it has happened, or the person skips it.
   */
  task?: string;
  done?: () => boolean;
  /** Run as the step starts: remember what to watch, for `done`. */
  before?: () => void;
}

export interface Lesson {
  id: string;
  title: string;
  /** One sentence for the Tutorials page. */
  summary: string;
  minutes: number;
  steps: LessonStep[];
}

export interface LessonEnd {
  /** "done" at the end, "later" to pick up where it stopped, "skipped". */
  how: "done" | "later" | "skipped";
  /** The step to resume at, for "later". */
  step: number;
}

let running: (() => void) | null = null;

/** Stop whatever lesson is running, as if "Continue later" were pressed. */
export function stopLesson(): void {
  running?.();
}

export function lessonRunning(): boolean {
  return running !== null;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Run a lesson from a step. Resolves once it ends, however it ends. */
export function runLesson(lesson: Lesson, from = 0): Promise<LessonEnd> {
  stopLesson();

  return new Promise((resolve) => {
    let index = Math.min(Math.max(from, 0), lesson.steps.length - 1);
    let frame = 0;
    let poll = 0;

    const ring = el("div", "tut-ring");
    ring.setAttribute("aria-hidden", "true");
    const card = el("section", "tut-card");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-live", "polite");
    card.setAttribute("aria-label", lesson.title);
    document.body.append(ring, card);

    const finish = (how: LessonEnd["how"]): void => {
      cancelAnimationFrame(frame);
      window.clearInterval(poll);
      document.removeEventListener("keydown", onKey);
      ring.remove();
      card.remove();
      running = null;
      resolve({ how, step: index });
    };
    running = () => finish("later");

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") finish("later");
    };
    document.addEventListener("keydown", onKey);

    /** Keep the ring on its target as the page scrolls, redraws or resizes. */
    const follow = (): void => {
      const step = lesson.steps[index];
      const target = step?.target?.() ?? null;
      const box = target instanceof HTMLElement && target.offsetParent !== null ? target.getBoundingClientRect() : null;
      if (box === null || box.width === 0) {
        ring.hidden = true;
        card.classList.remove("tut-card-top");
      } else {
        ring.hidden = false;
        const pad = 6;
        ring.style.left = `${box.left - pad}px`;
        ring.style.top = `${box.top - pad}px`;
        ring.style.width = `${box.width + pad * 2}px`;
        ring.style.height = `${box.height + pad * 2}px`;
        // The card goes wherever the thing it talks about is not.
        card.classList.toggle("tut-card-top", box.top + box.height / 2 > window.innerHeight * 0.55);
      }
      frame = requestAnimationFrame(follow);
    };

    const show = (): void => {
      window.clearInterval(poll);
      const step = lesson.steps[index];
      if (step === undefined) {
        finish("done");
        return;
      }
      if (step.page !== undefined) showPage(step.page);
      step.before?.();

      card.textContent = "";
      const top = el("div", "tut-card-head");
      top.append(el("span", "tut-card-lesson", lesson.title), el("span", "tut-card-count", `${index + 1} of ${lesson.steps.length}`));
      card.append(top, el("h3", "tut-card-title", step.title), el("p", "tut-card-body", step.body));
      if (step.task !== undefined) card.append(el("p", "tut-card-task", step.task));

      const buttons = el("div", "tut-card-buttons");
      const back = el("button", "", "Back");
      back.type = "button";
      back.disabled = index === 0;
      back.addEventListener("click", () => {
        index -= 1;
        show();
      });
      const later = el("button", "tut-quiet", "Continue later");
      later.type = "button";
      later.addEventListener("click", () => finish("later"));
      const skip = el("button", "tut-quiet", "Skip");
      skip.type = "button";
      skip.title = "Leave this lesson";
      skip.addEventListener("click", () => finish("skipped"));

      const last = index === lesson.steps.length - 1;
      const next = el("button", "primary", last ? "Finish" : "Next");
      next.type = "button";
      next.addEventListener("click", () => {
        index += 1;
        show();
      });
      const waiting = step.done !== undefined && !step.done();
      if (waiting) {
        next.textContent = "Skip this step";
        next.className = "";
        poll = window.setInterval(() => {
          if (step.done?.() !== true) return;
          window.clearInterval(poll);
          card.classList.add("tut-card-done");
          window.setTimeout(() => {
            card.classList.remove("tut-card-done");
            index += 1;
            show();
          }, 700);
        }, 250);
      }
      buttons.append(back, later, skip, next);
      card.append(buttons);

      const target = step.target?.();
      if (target instanceof HTMLElement) target.scrollIntoView({ block: "center", behavior: "smooth" });
      (waiting ? skip : next).focus({ preventScroll: true });
    };

    show();
    follow();
  });
}
