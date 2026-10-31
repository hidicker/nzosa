import { answerConnectRequest, connectRequest, currentSession, signIn, signInWithGoogle, signedIn } from "./cloud.js";

/**
 * An outside AI app asking to connect: the screen Supabase's OAuth server
 * sends the person to, with `authorization_id` in the address.
 *
 * Shown instead of the app, because it is a question to answer and go back:
 * allow it, and the browser returns to Claude (or whichever app asked) signed
 * in; refuse, and it returns without. Somebody not yet signed in to NZOSA is
 * asked to first, here, and the question is asked after.
 */

function param(): string | null {
  return new URLSearchParams(location.search).get("authorization_id");
}

/** True when the screen took over: the app is not to start. */
export async function connectInterrupts(): Promise<boolean> {
  const id = param();
  if (id === null || id === "") return false;
  const screen = document.createElement("main");
  screen.className = "connect-screen";
  document.body.textContent = "";
  document.body.append(screen);
  await draw(screen, id);
  return true;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = "", className = ""): HTMLElementTagNameMap[K] {
  const made = document.createElement(tag);
  if (text !== "") made.textContent = text;
  if (className !== "") made.className = className;
  return made;
}

async function draw(screen: HTMLElement, id: string): Promise<void> {
  screen.textContent = "";
  const card = el("section", "", "connect-card");
  screen.append(card);
  card.append(el("h1", "Connect an AI app to NZOSA"));

  if (!signedIn()) {
    signInHere(card, () => void draw(screen, id));
    return;
  }

  const asked = await connectRequest(id);
  if (asked === null) {
    card.append(
      el("p", "This request to connect has expired or was already answered. Go back to your AI app and connect again."),
    );
    return;
  }
  // Allowed before: straight back.
  if (asked.authorization_id === undefined && asked.redirect_url !== undefined) {
    location.assign(asked.redirect_url);
    return;
  }

  const name = asked.client?.client_name ?? asked.client?.name ?? "An AI app";
  card.append(
    el("p", `${name} is asking to connect to NZOSA as ${currentSession()?.email ?? "you"}.`, "connect-who"),
    el("p", "Allowed, it can, for any set of books you give it the connector address of:"),
  );
  const can = el("ul");
  for (const line of [
    "read the books: transactions, accounts, coding and entities;",
    "suggest codes, splits and journals, which wait in NZOSA until you use or decline each one.",
  ]) {
    can.append(el("li", line));
  }
  card.append(can);
  card.append(
    el(
      "p",
      "It cannot change the books, invite anybody, change settings, or see the bank feed's keys. " +
        "What it reads is sent to the company that runs it. A read-only member's app only reads.",
    ),
  );
  const said = el("p", "", "connect-said");
  const allow = el("button", "Allow", "primary");
  const deny = el("button", "Deny");
  allow.type = "button";
  deny.type = "button";
  const decide = async (action: "approve" | "deny"): Promise<void> => {
    allow.disabled = true;
    deny.disabled = true;
    said.textContent = action === "approve" ? "Connecting…" : "Refusing…";
    const back = await answerConnectRequest(id, action);
    if (back === null) {
      said.textContent = "That did not go through. Go back to your AI app and connect again.";
      return;
    }
    location.assign(back);
  };
  allow.addEventListener("click", () => void decide("approve"));
  deny.addEventListener("click", () => void decide("deny"));
  const buttons = el("div", "", "connect-buttons");
  buttons.append(allow, deny);
  card.append(buttons, said);
}

function signInHere(card: HTMLElement, then: () => void): void {
  card.append(el("p", "Sign in to NZOSA first, with the account your books are kept under."));
  const form = el("form", "", "connect-signin");
  const email = el("input");
  email.type = "email";
  email.autocomplete = "username";
  email.placeholder = "Email";
  email.required = true;
  const password = el("input");
  password.type = "password";
  password.autocomplete = "current-password";
  password.placeholder = "Password";
  password.required = true;
  const go = el("button", "Sign in", "primary");
  go.type = "submit";
  const said = el("p", "", "connect-said");
  form.append(email, password, go, said);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    go.disabled = true;
    void signIn(email.value.trim(), password.value).then((result) => {
      go.disabled = false;
      if (result.ok) then();
      else said.textContent = result.why;
    });
  });
  const google = el("button", "Sign in with Google");
  google.type = "button";
  google.addEventListener("click", () => void signInWithGoogle());
  card.append(form, google);
}
