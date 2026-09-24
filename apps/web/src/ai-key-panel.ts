import { redraw } from "./app.js";
import type { PageName } from "./app.js";
import { aiClearKey, aiRoute, aiSetKey, aiSetModel, aiStatus } from "./ai-backend.js";
import type { AiStatus } from "./ai-backend.js";
import { note } from "./ui.js";
import { PROVIDER_NAMES, detectProvider } from "@nzosa/core";

/**
 * Connecting a key, in one place, for every page that needs one.
 *
 * There are two pages that ask a model something now -- the coding
 * suggestions and the year-end check -- and there will not be one key each.
 * A key belongs to a set of books, not to a page, so the panel and the status
 * behind it live here and both pages show the same thing: connect it on
 * either, and the other already has it.
 *
 * What each page adds underneath is its own business, and is passed in.
 * Sharing the connection is the point; sharing the sentence about what the
 * connection is for would mean the year-end check telling somebody about
 * lines nothing recognises.
 */

let status: AiStatus | null = null;
/** Pages showing the panel now, so a change on one redraws the other. */
const watching = new Set<PageName>();

export function aiStatusNow(): AiStatus | null {
  return status;
}

/** Whether a key of some kind -- theirs or the site's -- can be asked. */
export function canAskAutomatically(): boolean {
  return status?.configured === true || status?.sharedKey === true;
}

/**
 * Fetch the status and redraw if it moved.
 *
 * Every page that draws the panel registers itself, so removing a key on one
 * does not leave the other offering a model it no longer has.
 */
export async function refreshAiStatus(from: PageName): Promise<void> {
  watching.add(from);
  const next = await aiStatus();
  if (next === null) return;
  const changed =
    status === null ||
    status.configured !== next.configured ||
    status.usedToday !== next.usedToday ||
    status.model !== next.model ||
    status.key !== next.key ||
    // The shared allowance moves too -- in the demo, with every visitor's ask.
    status.sharedKey !== next.sharedKey ||
    status.demoLimit !== next.demoLimit ||
    status.demoUsed !== next.demoUsed;
  status = next;
  if (changed) for (const page of watching) redraw(page);
}

/** Forget what we knew, for when a key has just been removed. */
export function forgetAiStatus(): void {
  status = null;
}

function panel(title: string): [HTMLElement, HTMLElement] {
  const box = document.createElement("div");
  box.className = "ai-panel";
  const inner = document.createElement("div");
  if (title !== "") {
    const heading = document.createElement("h3");
    heading.textContent = title;
    box.append(heading);
  }
  box.append(inner);
  return [box, inner];
}

export interface KeyPanelOptions {
  /** Which page is drawing it, so a change can redraw the right one. */
  page: PageName;
  /** The heading over it. */
  title: string;
  /**
   * What the shared key is counted in on this page -- "transactions" where it
   * is coding, "reviews" where it is not. The allowance is the same one.
   */
  countedIn?: string;
  /** Anything this page wants to say once a key is set. */
  whenSet?: () => HTMLElement[];
}

export function aiKeyPanel(options: KeyPanelOptions): HTMLElement {
  const [box, inner] = panel(options.title);
  const counted = options.countedIn ?? "transactions";

  // Something to try before bringing a key at all, where the site offers one
  // -- said plainly, because somebody about to use somebody else's key should
  // know that is what they are doing, and on whose model.
  if (status?.configured !== true && status?.sharedKey === true) {
    const left = Math.max(0, (status.demoLimit ?? 0) - (status.demoUsed ?? 0));
    inner.append(
      // The shared key first, then how to bring your own: that is the order
      // somebody meets them in, and what they can do today before what they
      // could do instead.
      note(
        "A demo AI key is provided so you can try this, with a limited number of " +
          "suggestions: " +
          (aiRoute() === "cloud"
            ? `${left} ${counted} left on your account.`
            : `${left} ${counted} left, shared by everybody without a key of their own.`) +
          (aiRoute() === "folder"
            ? " It belongs to whoever runs nbparagliding.nz, so what you send goes to Google " +
              "through their account."
            : ""),
      ),
    );
  }
  if (status?.configured === true) {
    inner.append(
      note(
        // Whose key it is, read from how it starts: the page never holds the
        // key itself, only its first and last few characters.
        `Set: ${status.key} (${PROVIDER_NAMES[detectProvider(status.key)]}). ` +
          (aiRoute() === "demo"
            ? "It is kept in this browser tab only and forgotten when the tab closes. It is " +
              "sent from this page straight to Google and never to this site's server."
            : (aiRoute() === "cloud"
                ? "It is kept in the server's vault, which only the function that asks Google " +
                  "can open, beside the bank feed's tokens."
                : "It is kept in a file on this computer that only your user account can read, " +
                  "beside the bank feed's tokens.") +
              " It is never sent back to this page, and it serves every page here that asks a " +
              "model anything."),
      ),
    );

    // The models this key may actually use, as Google listed them. Hard-coding
    // one is how a working app becomes an error message months later: they are
    // retired, and the message says so to somebody who cannot act on it.
    const models = status.models ?? [];
    if (models.length > 0) {
      const label = document.createElement("label");
      label.className = "ai-model";
      label.append("Model ");
      const pick = document.createElement("select");
      for (const model of models) {
        const option = document.createElement("option");
        option.value = model.name;
        option.textContent =
          model.label === "" || model.label === model.name
            ? model.name
            : `${model.label} (${model.name})`;
        option.selected = model.name === status?.model;
        pick.append(option);
      }
      pick.addEventListener("change", () => {
        pick.disabled = true;
        void aiSetModel(pick.value).then(() => refreshAiStatus(options.page));
      });
      label.append(pick);
      inner.append(label);
      inner.append(
        note(
          `${models.length} models on this key. The cheap fast one is chosen to start; a ` +
            "bigger one costs more and is worth trying where the answers are poor.",
        ),
      );
    }

    for (const extra of options.whenSet?.() ?? []) inner.append(extra);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove the key";
    remove.addEventListener("click", () => {
      remove.disabled = true;
      void aiClearKey().then(() => {
        status = null;
        void refreshAiStatus(options.page);
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
      "To use your own key instead, paste it below and press Check it and keep it. A key " +
        "from Google Gemini, Anthropic Claude, OpenAI (ChatGPT) or OpenRouter all work, " +
        "and the app works out which it is. OpenRouter reaches most other models too. You " +
        "pay that company for what you use.",
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
    trouble.textContent = "Checking the key…";
    void aiSetKey(key).then((answer) => {
      save.disabled = false;
      if (!answer.ok) {
        trouble.textContent = answer.error;
        return;
      }
      // Out of this page the moment it is somewhere better.
      input.value = "";
      void refreshAiStatus(options.page);
    });
  });

  const row = document.createElement("div");
  row.className = "migration-actions";
  row.append(input, save);
  inner.append(row, trouble);
  return box;
}
