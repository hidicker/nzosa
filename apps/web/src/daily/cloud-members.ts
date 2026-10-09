import { callFunction, currentSession, rpc } from "../cloud.js";
import { usingOwnProject } from "../cloud-config.js";
import { note } from "../ui.js";

/**
 * Who else can see a set of books kept on the server.
 *
 * Four roles, about what somebody may do rather than who they are: an owner
 * decides who is here; an accountant does everything in the books, lock dates
 * and year end included; a bookkeeper does the daily work but cannot move a
 * lock; read only sees and changes nothing. The accountant was read-only once,
 * the reverse of every other accounting system, where the person who signs
 * the year off can do the most -- and could not then move a lock or correct
 * a coding. Locked periods are what keep a finished year safe now.
 *
 * Nothing here enforces any of that. The database does, on every request; this
 * only asks, and would be handed nothing if it asked for more than it may
 * have.
 */

interface MemberRow {
  user_id: string;
  email: string;
  role: "owner" | "bookkeeper" | "accountant" | "readonly";
  since: string;
}

interface InvitationRow {
  id: string;
  email: string;
  role: "owner" | "bookkeeper" | "accountant" | "readonly";
  sent: string;
}

const ROLES: readonly (readonly [MemberRow["role"], string, string])[] = [
  ["bookkeeper", "Bookkeeper", "Codes, reconciles and saves. Cannot move lock dates or change who else is here."],
  ["accountant", "Accountant", "Everything in the books, lock dates and year end included. Cannot change who else is here."],
  ["readonly", "Read only", "Sees everything, changes nothing."],
  ["owner", "Owner", "Everything, including who else may look."],
];

function roleName(role: string): string {
  return ROLES.find(([value]) => value === role)?.[1] ?? role;
}

/**
 * Invite somebody, which also emails them (supabase/functions/invite). Inviting
 * again sends the email again, within the server's daily limits. The words are
 * the same whether or not that address has an account here.
 */
async function invite(bookId: string, email: string, role: string): Promise<{ ok: boolean; message: string }> {
  const after = "These books stay private until they accept.";
  if (usingOwnProject()) {
    // A project of somebody's own has the tables but not the invite function:
    // the invitation is made by the database itself, and nothing is emailed.
    try {
      const made = await rpc<string>("invite_to_book", { book: bookId, who: email, as_role: role });
      if (made === null) return { ok: false, message: "Could not make that invitation. Only an owner may invite." };
      return {
        ok: true,
        message: `Invited ${email}. No email is sent from your own project: tell them to sign up here with that ` +
          `address, and the invitation will be waiting on their Books page. ${after}`,
      };
    } catch (error) {
      return { ok: false, message: (error as Error).message || "Could not make that invitation." };
    }
  }
  try {
    const answer = await callFunction<{ invited?: boolean; emailed?: boolean; said?: string }>("invite", {
      book: bookId,
      email,
      role,
    });
    if (answer.invited !== true) return { ok: false, message: "Could not send that invitation." };
    return {
      ok: true,
      message: answer.emailed === true
        ? `Invited ${email}, and emailed them how to accept. ${after}`
        : `Invited ${email}, but not by email: ${answer.said ?? "no email was sent."} They will see it ` +
          `on their Books page when they sign in with that address. ${after}`,
    };
  } catch (error) {
    return { ok: false, message: (error as Error).message || "Could not send that invitation." };
  }
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
      void invite(book.id, wanted, role.value).then((result) => {
        go.disabled = false;
        say(said, result.message, !result.ok);
        if (result.ok) {
          email.value = "";
          void draw();
        }
      });
    });

    add.append(email, role, go);
    list.append(add);
    list.append(
      note(
        "They are emailed an invitation from NZOSA saying who invited them and how to accept. " +
          "Read only lets somebody review the books without changing anything.",
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
        const again = document.createElement("button");
        again.type = "button";
        again.textContent = "Send again";
        again.addEventListener("click", () => {
          again.disabled = true;
          say(said, "Sending…");
          void invite(book.id, row.email, row.role).then((result) => {
            again.disabled = false;
            say(said, result.message, !result.ok);
          });
        });
        actions.append(again, " ", take);
        tr.append(who, what, actions);
        rows.append(tr);
      }
      table.append(head, rows);
      list.append(table);
    }
  };

  void draw();
}
