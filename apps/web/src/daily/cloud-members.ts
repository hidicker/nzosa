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

interface InvitationRow {
  id: string;
  email: string;
  role: "owner" | "bookkeeper" | "accountant";
  sent: string;
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

    // Inviting somebody. Nothing is shared until they accept, and the answer
    // never says whether that address has an account -- otherwise this becomes
    // a way for anybody to test whether an email is registered here.
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
    go.textContent = "Invite";
    go.addEventListener("click", () => {
      const wanted = email.value.trim();
      if (wanted === "") return;
      go.disabled = true;
      say(said, "Inviting…");
      void rpc<string>("invite_to_book", {
        book: book.id,
        who: wanted,
        as_role: role.value,
      }).then((result) => {
        go.disabled = false;
        if (result === "invited") {
          email.value = "";
          // The same words whether or not that address has an account here.
          say(
            said,
            `Invited ${wanted}. They will see it on their own Books page the next ` +
              "time they sign in, and these books stay private until they accept.",
          );
          void draw();
          return;
        }
        say(said, "Could not send that invitation.", true);
      });
    });

    add.append(email, role, go);
    list.append(add);
    list.append(
      note(
        "Read-only access lets an accountant review the books without changing anything.",
      ),
    );

    // Invitations sent and not yet answered, so an owner can see what is
    // outstanding and take one back.
    const waiting = await rpc<InvitationRow[]>("book_invitation_list", { book: book.id });
    if (waiting !== null && waiting.length > 0) {
      const pending = document.createElement("h4");
      pending.textContent = "Invited, not yet accepted";
      list.append(pending);

      const table = document.createElement("table");
      table.className = "report-table owner-table";
      const head = document.createElement("thead");
      head.innerHTML = "<tr><th>Person</th><th>Would be</th><th></th></tr>";
      const rows = document.createElement("tbody");
      for (const row of waiting) {
        const tr = document.createElement("tr");
        const who = document.createElement("td");
        who.className = "report-name";
        who.textContent = row.email;
        const what = document.createElement("td");
        what.textContent = roleName(row.role);
        const actions = document.createElement("td");
        actions.className = "report-amount";
        const take = document.createElement("button");
        take.type = "button";
        take.textContent = "Withdraw";
        take.addEventListener("click", () => {
          take.disabled = true;
          void rpc<string>("cancel_invitation", { invitation: row.id }).then(() => void draw());
        });
        actions.append(take);
        tr.append(who, what, actions);
        rows.append(tr);
      }
      table.append(head, rows);
      list.append(table);
    }
  };

  void draw();
}
