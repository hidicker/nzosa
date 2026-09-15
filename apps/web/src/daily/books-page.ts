import { CLEAR_PHRASE, clearEverything } from "../books.js";
import { $ } from "../state.js";
import {
  archiveOther,
  currentLedger,
  ledgers,
  listArchives,
  restoreArchive,
  switchLedger,
  writesToFolder,
} from "../store.js";
import { note } from "../ui.js";
import { reclassify } from "../books.js";
import { render } from "../daily/bank-import.js";
import { state } from "../state.js";
import { clear, emptyLedger } from "../store.js";

/**
 * The dated copies kept beside these books.
 *
 * Clearing has always moved the files into `archive/<stamp>/` rather than
 * deleting them, and the app has always said there was no undo -- which was
 * false, and false in the direction that makes somebody stop looking. A safety
 * net nobody can reach is not one.
 */
async function renderArchives(body: HTMLElement, whose = ""): Promise<void> {
  const archives = await listArchives();
  if (archives.length === 0) return;

  const heading = document.createElement("h3");
  // Named, because this list sits under a table of several sets of books and
  // "Earlier copies" alone does not say of what. Putting one back replaces a
  // whole set of books, which is not a thing to do from a guess.
  heading.textContent = whose === "" ? "Earlier copies" : `Earlier copies of ${whose}`;
  body.append(heading);

  body.append(
    note(
      "Taken whenever " +
        (whose === "" ? "these books were" : `${whose} was`) +
        " cleared or restored over. Putting one back keeps a copy of what it " +
        "replaces, so this is reversible too.",
    ),
  );

  const table = document.createElement("table");
  table.className = "report-table owner-table";
  const head = document.createElement("thead");
  head.innerHTML =
    "<tr><th>Books</th><th>Taken</th><th>Transactions</th><th>Invoices</th>" +
    "<th>Accounts</th><th></th></tr>";
  const tbody = document.createElement("tbody");

  for (const archive of archives) {
    const tr = document.createElement("tr");

    const books = document.createElement("td");
    books.className = "report-name";
    books.textContent = whose;
    tr.append(books);

    // The folder name is a timestamp with the punctuation swapped out, which
    // is unambiguous but not a date anybody reads. Shown as one.
    const [year, month, day, hour, minute] = archive.stamp.split("-");
    const when = document.createElement("td");
    when.textContent =
      year && month && day ? `${day}/${month}/${year}${hour ? ` ${hour}:${minute ?? "00"}` : ""}` : archive.stamp;
    tr.append(when);

    for (const value of [archive.transactions, archive.invoices, archive.accounts]) {
      const cell = document.createElement("td");
      cell.className = "report-amount";
      cell.textContent = String(value);
      tr.append(cell);
    }

    const actions = document.createElement("td");
    actions.className = "report-amount";
    const put = document.createElement("button");
    put.type = "button";
    put.textContent = "Put this back";
    put.addEventListener("click", () => {
      if (
        !confirm(
          `Put back the copy of ${whose || "these books"} from ${when.textContent}?

` +
            `${archive.transactions} transactions and their coding. What is open now is ` +
            `kept as another copy first, so this can be undone.`,
        )
      ) {
        return;
      }
      put.disabled = true;
      put.textContent = "Putting back…";
      void restoreArchive(archive.stamp).then((ok) => {
        if (ok) location.reload();
        else {
          alert("Could not put that copy back.");
          put.disabled = false;
          put.textContent = "Put this back";
        }
      });
    });
    actions.append(put);
    tr.append(actions);
    tbody.append(tr);
  }

  table.append(head, tbody);
  body.append(table);
}

/**
 * Choosing which set of books is open.
 *
 * One install can hold several: a company, a trust, last year's closed set,
 * a sandbox to try something in. They are separate folders and nothing is
 * shared between them, which is the point -- a report can only ever be about
 * the books it was run from.
 *
 * Switching reloads rather than swapping the state in place. Half the app
 * holding one ledger while half holds another is a class of bug that produces
 * plausible wrong figures, and a reload cannot produce it.
 */

export async function chooseLedger(value: string): Promise<void> {
  let id = value;
  let label: string | undefined;
  if (id === "\u0000new") {
    const name = prompt(
      "Name for the new set of books.\n\nIt becomes a folder beside the others, " +
        "and starts empty.",
      "",
    );
    if (name === null || name.trim() === "") return;
    // A folder name, so only what a folder name may hold.
    label = name.trim();
    id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (id === "") {
      alert("That name has nothing in it a folder can be called.");
      return;
    }
  }

  if (!(await switchLedger(id, label))) {
    alert("Could not open that set of books.");
    return;
  }
  // Everything on screen belongs to the ledger that was open, so the honest
  // thing is to start again rather than repaint around it.
  location.reload();
}

/**
 * Every set of books in the folder, and the way to empty one.
 *
 * Its own page rather than a corner of Setup, because it is about the books as
 * a whole and not about setting any one of them up -- and because clearing was
 * previously reachable only for whichever books happened to be open, so
 * tidying away an old set meant opening it first, which is the wrong way round.
 *
 * Nothing here deletes anything. Clearing moves the files into a dated copy
 * beside them and empties the folder; the folder stays, and the copy can be put
 * back. That is the same promise the rest of this app makes about the folder
 * being the truth, and a delete button would quietly withdraw it.
 */
export async function renderBooks(): Promise<void> {
  const body = $("books-body");
  body.textContent = "";

  if (!writesToFolder()) {
    body.append(
      note(
        "This copy has no folder behind it, so there is only one set of books: " +
          "whatever is in this browser. Clearing it is on the Setup page.",
      ),
    );
    return;
  }

  const books = await ledgers();
  const open = await currentLedger();

  const table = document.createElement("table");
  table.className = "report-table books-table";
  const head = document.createElement("thead");
  head.innerHTML = "<tr><th>Books</th><th>Transactions</th><th></th></tr>";
  const tbody = document.createElement("tbody");

  for (const book of books) {
    const tr = document.createElement("tr");
    const isOpen = book.id === open;

    const name = document.createElement("td");
    name.textContent = book.name;
    if (isOpen) {
      const here = document.createElement("span");
      here.className = "books-open";
      here.textContent = "open now";
      name.append(" ", here);
    }
    tr.append(name);

    const count = document.createElement("td");
    count.className = "report-amount";
    count.textContent = String(book.transactions);
    tr.append(count);

    const actions = document.createElement("td");
    actions.className = "report-amount";

    if (!isOpen) {
      const openIt = document.createElement("button");
      openIt.type = "button";
      openIt.textContent = "Open";
      openIt.addEventListener("click", () => void chooseLedger(book.id));
      actions.append(openIt);
    }

    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "row-remove";
    clear.textContent = "Clear…";
    actions.append(clear);
    tr.append(actions);
    tbody.append(tr);

    // The confirmation opens under the row it belongs to, so the books being
    // cleared and the sentence agreeing to it are never a scroll apart.
    const confirmRow = document.createElement("tr");
    confirmRow.hidden = true;
    const cell = document.createElement("td");
    cell.colSpan = 3;
    cell.className = "books-confirm";
    confirmRow.append(cell);
    tbody.append(confirmRow);

    clear.addEventListener("click", () => {
      confirmRow.hidden = !confirmRow.hidden;
      if (confirmRow.hidden) {
        cell.textContent = "";
        return;
      }

      const what = document.createElement("p");
      what.textContent =
        `Clearing ${book.name} removes its ${book.transactions} transactions and ` +
        "every coding, rule, invoice, entity and asset with them. A dated copy is " +
        "kept beside it first" +
        (isOpen ? " and can be put back below." : ", and can be put back by opening those books.");

      const label = document.createElement("label");
      const says = document.createElement("span");
      says.textContent = `Type "${CLEAR_PHRASE}" to enable the button.`;
      const typed = document.createElement("input");
      typed.type = "text";
      typed.placeholder = CLEAR_PHRASE;
      typed.autocomplete = "off";
      label.append(says, typed);

      const go = document.createElement("button");
      go.type = "button";
      go.className = "danger";
      go.textContent = `Clear ${book.name}`;
      go.disabled = true;
      typed.addEventListener("input", () => {
        go.disabled = typed.value.trim() !== CLEAR_PHRASE;
      });

      go.addEventListener("click", () => {
        go.disabled = true;
        go.textContent = "Clearing…";
        // The open books go through the same routine as the Setup page always
        // used, because the page is holding a working copy of them and has to
        // be told to forget it. Books that are not open have no working copy
        // here, so the server does the whole job.
        if (isOpen) {
          void clearEverything(go);
          return;
        }
        void archiveOther(book.id).then((result: { ok: boolean; why: string }) => {
          if (result.ok) void renderBooks();
          else {
            alert(result.why);
            go.disabled = false;
            go.textContent = `Clear ${book.name}`;
          }
        });
      });

      const form = document.createElement("div");
      form.className = "clear-form";
      form.append(label, go);
      cell.append(what, form);
      typed.focus();
    });
  }

  table.append(head, tbody);
  body.append(table);

  // Starting a new set of books used to live in the menu's dropdown, which is
  // where you would look for it only if you already knew it was there.
  const make = document.createElement("button");
  make.type = "button";
  make.className = "books-new";
  make.textContent = "New set of books…";
  make.addEventListener("click", () => void chooseLedger("\u0000new"));
  body.append(make);

  // Named, since the table above lists several sets and this list is of one.
  const openName = books.find((b) => b.id === open)?.name ?? "";
  await renderArchives(body, openName);
}

/**
 * Which set of books is open, in the corner of the menu.
 *
 * This was a dropdown that also switched between them. Switching lives on the
 * Books page now, where there is room to say what each set holds before you
 * open it -- but the name stays here, because not knowing which books you are
 * coding into is how a morning's work ends up in the wrong ones.
 */
export async function renderOpenBooks(): Promise<void> {
  const button = $("ledger-open");
  if (!writesToFolder()) {
    button.hidden = true;
    return;
  }
  const [all, current] = await Promise.all([ledgers(), currentLedger()]);
  const open = all.find((one) => one.id === current);
  $("ledger-open-name").textContent = open?.name ?? current;
  button.hidden = false;
}

/** Clearing these books and starting again. */
export function wireBooksPage(): void {

  $("clear-button").addEventListener("click", () => {
    const count = state.ledger.transactions.length;
    if (count === 0) return;
    if (!confirm(`Delete all ${count} transactions from this browser? This cannot be undone.`)) {
      return;
    }
    void (async () => {
      await clear();
      state.ledger = emptyLedger();
      state.reports = [];
      reclassify();
      render();
    })();
  });
}
