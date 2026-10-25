/**
 * A button that has been pressed and is still waiting says so.
 *
 * Saving to books kept online, asking the AI or the bank, loading a file:
 * each can take from half a second to many, and a button that does not change
 * for that long is pressed again, or doubted. Each button saying so itself
 * meant some three hundred click handlers saying it one by one, and most did
 * not. So it is said here, once, for every button.
 *
 * How: a click on a button is noted as it happens, and every request the app
 * sends is counted while it runs. If, a third of a second after the click,
 * requests started since then are still running, the button shows the working
 * stripes, says what it is waiting on -- "Saving…", "Asking the AI…",
 * "Fetching from the bank…", "Loading…" -- and cannot be pressed again; it
 * goes back as those requests finish. Something quicker shows nothing, so a
 * fast button does not flicker.
 *
 * A button that already says it is working, by its own stripes or aria-busy,
 * is left to do so. One holding more than its words (an icon, a count) keeps
 * them, and shows only the stripes. A button that is redrawn away was
 * finished with, and nothing is put back on it.
 */

type Kind = "ai" | "bank" | "save" | "load";

const SAID: Record<Kind, string> = {
  ai: "Asking the AI…",
  bank: "Fetching from the bank…",
  save: "Saving…",
  load: "Loading…",
};

/** Which says most about the wait, where several are running. */
const FIRST: readonly Kind[] = ["ai", "bank", "save", "load"];

/** How long a press may go unremarked: past this, it is said. */
const QUIET_FOR = 300;

/**
 * How long after a press a request still counts as the press's own. Long
 * enough for a handler that saves after some work of its own; short enough
 * that the morning feed fetch or a save from elsewhere does not keep a button
 * waiting on something it did not start.
 */
const OWN_FOR = 3000;

interface Running {
  kind: Kind;
  started: number;
}

const running = new Set<Running>();

/** What a request is waiting on, read from where it goes. */
export function kindOf(url: string, method: string): Kind {
  const where = url.toLowerCase();
  if (
    /\/functions\/v1\/gemini|\/api\/ai\b|generativelanguage\.googleapis|api\.anthropic\.com|api\.openai\.com|openrouter\.ai|typesafeai\.com/.test(
      where,
    )
  ) {
    return "ai";
  }
  if (/\/functions\/v1\/(akahu|wise)|\/api\/(feed|wise|simplefin)\b/.test(where)) return "bank";
  // Books online read through POSTs as well (a list of members, say): only
  // the calls that write are saving.
  const rpc = /\/rest\/v1\/rpc\/([a-z_]+)/.exec(where)?.[1];
  if (rpc !== undefined) {
    const writes =
      /^(save|delete|restore|create|copy|rename|invite|accept|decline|cancel|claim|clear|add|remove|set|forget)_|_(set|forget|store|put)$/;
    return writes.test(rpc) ? "save" : "load";
  }
  if (method !== "GET" && method !== "HEAD") return "save";
  return "load";
}

function counted(fetcher: typeof fetch): typeof fetch {
  return (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const one: Running = { kind: kindOf(url, method), started: performance.now() };
    running.add(one);
    const done = (): void => {
      running.delete(one);
    };
    const request = fetcher(input, init);
    request.then(done, done);
    return request;
  };
}

/** What is still running that started since `since`, and which says most. */
function waitingOn(since: number): Kind | null {
  const kinds = new Set<Kind>();
  for (const one of running) {
    if (one.started >= since && one.started <= since + OWN_FOR) kinds.add(one.kind);
  }
  return FIRST.find((kind) => kinds.has(kind)) ?? null;
}

function pressed(button: HTMLButtonElement): void {
  const at = performance.now();
  setTimeout(() => {
    const kind = waitingOn(at);
    if (kind === null || !button.isConnected) return;
    // Saying so itself already, or told not to here.
    if (button.classList.contains("working") || button.getAttribute("aria-busy") === "true") return;
    if (button.dataset["busy"] === "off") return;

    const words = button.textContent ?? "";
    const plain = button.children.length === 0;
    const wasDisabled = button.disabled;
    let shown = SAID[kind];
    button.classList.add("working");
    button.setAttribute("aria-busy", "true");
    button.disabled = true;
    if (plain) button.textContent = shown;

    const check = (): void => {
      if (!button.isConnected) return;
      const now = waitingOn(at);
      if (now !== null) {
        // Saved, and now asking the AI: say the wait that is left.
        if (plain && SAID[now] !== shown && button.textContent === shown) {
          shown = SAID[now];
          button.textContent = shown;
        }
        setTimeout(check, 150);
        return;
      }
      button.classList.remove("working");
      button.removeAttribute("aria-busy");
      button.disabled = wasDisabled;
      // Only the words put here: a handler that has since said something
      // of its own on the button keeps it.
      if (plain && button.textContent === shown) button.textContent = words;
    };
    setTimeout(check, 150);
  }, QUIET_FOR);
}

/**
 * A menu press, shown before its page is drawn.
 *
 * Drawing a page asks nothing of the server, so the watch above never sees
 * it, and in large books it can still take a second or two -- during which
 * the browser cannot so much as show that the button was pressed. So the
 * button is marked first, the screen is given one frame to show it, and the
 * page is drawn after.
 */
export function afterPress(button: HTMLElement, open: () => void): void {
  button.classList.add("opening");
  document.body.classList.add("page-opening");
  afterNextFrame(() => {
    try {
      open();
    } finally {
      button.classList.remove("opening");
      document.body.classList.remove("page-opening");
    }
  });
}

/**
 * A button that says it is working while `work` runs, shown before it starts.
 *
 * For work done in the page itself -- accepting thousands of suggestions --
 * which sends nothing the watch above could notice, and holds the page while
 * it runs: the button is marked, the screen is given a frame to show it, and
 * only then does the work begin. Put back as it was however the work ends.
 */
export async function showWorking<T>(button: HTMLElement | null, words: string, work: () => Promise<T>): Promise<T> {
  if (button === null) return work();
  const was = button.textContent ?? "";
  const plain = button.children.length === 0;
  const wasDisabled = button instanceof HTMLButtonElement ? button.disabled : false;
  button.classList.add("working");
  button.setAttribute("aria-busy", "true");
  if (button instanceof HTMLButtonElement) button.disabled = true;
  if (plain) button.textContent = words;
  await new Promise<void>((resolve) => afterNextFrame(resolve));
  try {
    return await work();
  } finally {
    button.classList.remove("working");
    button.removeAttribute("aria-busy");
    if (button instanceof HTMLButtonElement) button.disabled = wasDisabled;
    if (plain && button.textContent === words) button.textContent = was;
  }
}

/**
 * Run `work` once the screen has had a chance to show what changed.
 *
 * After the next frame -- or 50 ms, whichever comes first: a tab that is not
 * on screen draws no frames, and waiting on a frame alone left a menu press
 * made there (or a tick, or a test running out of sight) never acted on.
 */
export function afterNextFrame(work: () => void): void {
  let gone = false;
  const go = (): void => {
    if (gone) return;
    gone = true;
    setTimeout(work, 0);
  };
  requestAnimationFrame(go);
  setTimeout(go, 50);
}

let started = false;

/** Count requests and watch presses, once, as the app starts. */
export function watchBusyButtons(): void {
  if (started) return;
  started = true;
  window.fetch = counted(window.fetch.bind(window));
  // In the capture phase, so the press is noted before its handler sends
  // anything.
  document.addEventListener(
    "click",
    (event) => {
      const button = (event.target as Element | null)?.closest?.("button");
      if (!(button instanceof HTMLButtonElement) || button.disabled) return;
      pressed(button);
    },
    true,
  );
}
