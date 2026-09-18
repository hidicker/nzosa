import { cloudConfigured } from "../cloud-config.js";
import {
  createBook,
  currentSession,
  listBooks,
  signIn,
  signOut,
  signUp,
} from "../cloud.js";
import { backupTools } from "../backup.js";
import { renderMembers } from "./cloud-members.js";
import { rpc } from "../cloud.js";
import { openCloudBook, openCloudBookId } from "../store.js";
import { note } from "../ui.js";

/**
 * Books kept on a server, and the way in to them.
 *
 * The same page as the folder's books, because it answers the same question:
 * which set is open. What differs is where they are and that there is somebody
 * to be -- a folder needs no sign-in, and a server cannot do without one.
 *
 * Opening a set reloads the page, exactly as switching folders does. Half the
 * app holding one ledger while half holds another is a class of bug that
 * produces plausible wrong figures, and a reload cannot produce it.
 */

function heading(text: string): HTMLElement {
  const h = document.createElement("h3");
  h.textContent = text;
  return h;
}

function say(box: HTMLElement, message: string, bad = false): void {
  box.textContent = message;
  box.className = bad ? "cloud-said bad" : "cloud-said";
}

/** Signing in, or making an account. */
function signInForm(body: HTMLElement): void {
  body.append(
    note(
      "Books kept on the server can be reached from any computer you sign in " +
        "from, and shared with whoever you add to them. Nothing on this page " +
        "touches the books already in this browser.",
    ),
  );

  const form = document.createElement("form");
  form.className = "cloud-form";

  const email = document.createElement("input");
  email.type = "email";
  email.autocomplete = "email";
  email.placeholder = "you@example.co.nz";
  email.required = true;
  const emailLabel = document.createElement("label");
  emailLabel.append("Email", email);

  const password = document.createElement("input");
  password.type = "password";
  password.autocomplete = "current-password";
  password.placeholder = "At least 10 characters";
  password.required = true;
  password.minLength = 10;
  const passwordLabel = document.createElement("label");
  passwordLabel.append("Password", password);

  const enter = document.createElement("button");
  enter.type = "submit";
  enter.className = "primary";
  enter.textContent = "Sign in";

  const make = document.createElement("button");
  make.type = "button";
  make.textContent = "Create an account";

  const said = document.createElement("p");
  said.className = "cloud-said";

  const working = (on: boolean, what: string): void => {
    enter.disabled = on;
    make.disabled = on;
    if (on) say(said, what);
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    working(true, "Signing in…");
    void signIn(email.value.trim(), password.value).then((result) => {
      if (result.ok) {
        // Everything on screen belongs to the books that were open, so the
        // honest thing is to start again rather than repaint around it.
        location.reload();
        return;
      }
      working(false, "");
      say(said, result.why, true);
    });
  });

  make.addEventListener("click", () => {
    if (email.value.trim() === "" || password.value.length < 10) {
      say(said, "An email address and a password of at least 10 characters.", true);
      return;
    }
    working(true, "Creating the account…");
    void signUp(email.value.trim(), password.value).then((result) => {
      working(false, "");
      if (!result.ok) {
        say(said, result.why, true);
        return;
      }
      if (result.confirm) {
        say(
          said,
          `Check ${email.value.trim()} for a message from NZOSA and follow the link in it. ` +
            "Then come back here and sign in.",
        );
        return;
      }
      location.reload();
    });
  });

  form.append(emailLabel, passwordLabel, enter, make);
  body.append(form, said);
}

interface InvitationForMe {
  id: string;
  books: string;
  role: string;
  invited_by: string;
  sent: string;
}

/**
 * Books somebody has asked you to join.
 *
 * Nothing appears in your list because somebody else decided it should: an
 * invitation waits here until you take it up, and declining ends it.
 */
async function renderInvitations(body: HTMLElement): Promise<void> {
  const waiting = await rpc<InvitationForMe[]>("my_invitations", {});
  if (waiting === null || waiting.length === 0) return;

  const wrap = document.createElement("div");
  wrap.className = "cloud-invitations";
  const heading = document.createElement("h3");
  heading.textContent = waiting.length === 1 ? "You have an invitation" : "You have invitations";
  wrap.append(heading);

  for (const one of waiting) {
    const row = document.createElement("p");
    row.className = "cloud-who";
    const what = one.role === "accountant"
      ? "to read them"
      : one.role === "owner"
        ? "as an owner"
        : "to code them";
    row.append(
      document.createTextNode(
        `${one.invited_by === "" ? "Somebody" : one.invited_by} invited you to ${one.books}, ${what}.`,
      ),
    );

    const accept = document.createElement("button");
    accept.type = "button";
    accept.className = "primary";
    accept.textContent = "Accept";
    accept.addEventListener("click", () => {
      accept.disabled = true;
      void rpc<string>("accept_invitation", { invitation: one.id }).then(() => location.reload());
    });

    const decline = document.createElement("button");
    decline.type = "button";
    decline.textContent = "Decline";
    decline.addEventListener("click", () => {
      decline.disabled = true;
      void rpc<string>("decline_invitation", { invitation: one.id }).then(() => location.reload());
    });

    row.append(" ", accept, " ", decline);
    wrap.append(row);
  }
  body.append(wrap);
}

/** The sets of books this person may open. */
async function booksList(body: HTMLElement, email: string): Promise<void> {
  const who = document.createElement("p");
  who.className = "cloud-who";
  who.textContent = `Signed in as ${email}.`;
  const out = document.createElement("button");
  out.type = "button";
  out.textContent = "Sign out";
  out.addEventListener("click", () => {
    out.disabled = true;
    void signOut().then(() => {
      // The books that were open were reachable because of who was signed in.
      openCloudBook(null);
      location.reload();
    });
  });
  who.append(" ", out);
  body.append(who);

  const said = document.createElement("p");
  said.className = "cloud-said";
  say(said, "Looking…");
  body.append(said);

  await renderInvitations(body);

  const books = await listBooks();
  const open = openCloudBookId();
  said.textContent = "";

  if (books.length === 0) {
    body.append(
      note(
        "No books on the server yet. Start one below: it is yours, nobody else " +
          "can see it, and you decide who else ever does.",
      ),
    );
  } else {
    const table = document.createElement("table");
    table.className = "report-table books-table";
    const head = document.createElement("thead");
    head.innerHTML = "<tr><th>Books</th><th>Started</th><th></th></tr>";
    const tbody = document.createElement("tbody");
    for (const book of books) {
      const row = document.createElement("tr");

      const name = document.createElement("td");
      name.textContent = book.name;
      if (book.id === open) {
        const here = document.createElement("span");
        here.className = "books-open";
        here.textContent = "open now";
        name.append(" ", here);
      }

      const when = document.createElement("td");
      const [year, month, day] = book.createdAt.slice(0, 10).split("-");
      when.textContent = year && month && day ? `${day}/${month}/${year}` : "";

      const actions = document.createElement("td");
      actions.className = "report-amount";
      if (book.id !== open) {
        const openIt = document.createElement("button");
        openIt.type = "button";
        openIt.textContent = "Open";
        openIt.addEventListener("click", () => {
          openCloudBook({ id: book.id, name: book.name });
          location.reload();
        });
        actions.append(openIt);
      }

      row.append(name, when, actions);
      tbody.append(row);
    }
    table.append(head, tbody);
    body.append(table);
  }

  // Starting a set of books, which is also how somebody's first set is made.
  const add = document.createElement("div");
  add.className = "cloud-add";
  const name = document.createElement("input");
  name.type = "text";
  name.placeholder = "Name for a new set of books";
  const make = document.createElement("button");
  make.type = "button";
  make.className = "primary";
  make.textContent = "Start a new set";
  make.addEventListener("click", () => {
    const wanted = name.value.trim();
    if (wanted === "") return;
    make.disabled = true;
    say(said, "Starting…");
    void createBook(wanted).then((made) => {
      if (made === null) {
        make.disabled = false;
        say(said, "Could not start that set of books.", true);
        return;
      }
      openCloudBook({ id: made.id, name: made.name });
      location.reload();
    });
  });
  add.append(name, make);
  body.append(add);

  const openNow = books.find((book) => book.id === open);
  if (openNow !== undefined) {
    renderMembers(body, openNow);
    backupTools(body, openNow.name, true);
  }
}

/**
 * The hosted half of the Books page.
 *
 * Returns false when this build has no project behind it, so the page can say
 * what it always said: there is one set of books, the one in this browser.
 */
export function renderCloudBooks(body: HTMLElement): boolean {
  if (!cloudConfigured()) return false;

  body.append(heading("Books on the server"));
  const session = currentSession();
  if (session === null) signInForm(body);
  else void booksList(body, session.email);
  return true;
}
