import { currentSession, rpc } from "../cloud.js";
import { note } from "../ui.js";

/**
 * Who else can see a set of books kept on the server.
 *
 * Three roles, and they are about what somebody may do rather than who they
 * are: an owner decides who is here, a bookkeeper codes, an accountant reads.
 * The read-only one is the point of the whole arrangement -- handing a year to
 * an accountant should not mean handing them the ability to change it.
 *
 * Nothing here enforces any of that. The database does, on every request; this
 * only asks, and would be handed nothing if it asked for more than it may
 * have.
 */

interface MemberRow {
  user_id: string;
  email: string;
  role: "owner" | "bookkeeper" | "accountant";
  since: string;
}

const ROLES: readonly (readonly [MemberRow["role"], string, string])[] = [
  ["bookkeeper", "Bookkeeper", "Codes and saves. Cannot change who else is here."],
  ["accountant", "Accountant (read only)", "Sees everything, changes nothing."],
  ["owner", "Owner", "Everything, including who else may look."],
];

function roleName(role: string): string {
  return ROLES.find(([value]) => value === role)?.[1] ?? role;
}

function say(box: HTMLElement, message: string, bad = false): void {
  box.textContent = message;
  box.className = bad ? "cloud-said bad" : "cloud-said";
}

export function renderMembers(body: HTMLElement, book: { id: string; name: string }): void {
  const heading = document.createElement("h3");
  heading.textContent = "Who can see these books";
  body.append(heading);

  const said = document.createElement("p");
  said.className = "cloud-said";
  say(said, "Looking…");
  body.append(said);

  const list = document.createElement("div");
  body.append(list);

  const draw = async (): Promise<void> => {
    const rows = await rpc<MemberRow[]>("book_member_list", { book: book.id });
    if (rows === null) {
      say(said, "Could not read who is in these books.", true);
      return;
    }
    said.textContent = "";
    list.textContent = "";

    const me = currentSession()?.userId ?? "";
    const iAmOwner = rows.some((row) => row.user_id === me && row.role === "owner");
    const owners = rows.filter((row) => row.role === "owner").length;

    const table = document.createElement("table");
    table.className = "report-table owner-table";
    const head = document.createElement("thead");
    head.innerHTML = "<tr><th>Person</th><th>Can</th><th></th></tr>";
    const tbody = document.createElement("tbody");

    for (const row of rows) {
      const tr = document.createElement("tr");

      const who = document.createElement("td");
      who.className = "report-name";
      who.textContent = row.email + (row.user_id === me ? " (you)" : "");
      tr.append(who);

      const what = document.createElement("td");
      what.textContent = roleName(row.role);
      tr.append(what);

      const actions = document.createElement("td");
      actions.className = "report-amount";
      // The last owner is not removable, so the button is not offered rather
      // than offered and then refused.
      const lastOwner = row.role === "owner" && owners <= 1;
      if (iAmOwner && !lastOwner) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "danger";
        remove.textContent = row.user_id === me ? "Leave" : "Remove";
        remove.addEventListener("click", () => {
          if (
            !confirm(
              row.user_id === me
                ? `Leave ${book.name}? You will not be able to open it again unless somebody adds you back.`
                : `Remove ${row.email} from ${book.name}? They keep any backup they have already downloaded.`,
            )
          ) {
            return;
          }
          remove.disabled = true;
          void rpc<string>("remove_book_member", { book: book.id, who: row.user_id }).then(
            (result) => {
              if (result === "removed") {
                if (row.user_id === me) {
                  location.reload();
                  return;
                }
                void draw();
                return;
              }
              remove.disabled = false;
              say(
                said,
                result === "last owner"
                  ? "These books need an owner. Make somebody else an owner first."
                  : "Could not remove that person.",
                true,
              );
            },
          );
        });
        actions.append(remove);
      }
      tr.append(actions);
      tbody.append(tr);
    }

    table.append(head, tbody);
    list.append(table);

    if (!iAmOwner) {
      list.append(note("Only an owner can add or remove people."));
      return;
    }

    // Adding somebody. The address has to belong to an account already: an
    // invitation to a stranger means this system sending mail to an address
    // nobody has verified, which is a different thing with different risks.
    const add = document.createElement("div");
    add.className = "cloud-add";

    const email = document.createElement("input");
    email.type = "email";
    email.placeholder = "Their email address";

    const role = document.createElement("select");
    for (const [value, caption, why] of ROLES) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = caption;
      option.title = why;
      role.append(option);
    }

    const go = document.createElement("button");
    go.type = "button";
    go.className = "primary";
    go.textContent = "Add";
    go.addEventListener("click", () => {
      const wanted = email.value.trim();
      if (wanted === "") return;
      go.disabled = true;
      say(said, "Adding…");
      void rpc<string>("add_book_member", {
        book: book.id,
        who: wanted,
        as_role: role.value,
      }).then((result) => {
        go.disabled = false;
        if (result === "added") {
          email.value = "";
          void draw();
          return;
        }
        say(
          said,
          result === "no account"
            ? `There is no account for ${wanted} yet. Ask them to create one here first, ` +
              "then add them."
            : "Could not add that person.",
          true,
        );
      });
    });

    add.append(email, role, go);
    list.append(add);
    list.append(
      note(
        "An accountant who only reads cannot change a figure, which is what makes it safe " +
          "to hand over a year while you carry on working.",
      ),
    );
  };

  void draw();
}
