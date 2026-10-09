/**
 * Inviting somebody to a set of books, and telling them so by email.
 *
 * The invitation itself is made exactly as before, by the database's
 * invite_to_book, called with the caller's own token -- so only an owner can
 * invite, and the rules stay in one place. Then an email goes from NZOSA's
 * mailbox saying who invited them, to which books, and how to accept.
 *
 * The email is the same whether or not the address has an account here, as
 * the page's words are: inviting must never be a way to find out who is
 * registered. And it is limited (see invitation_email_take), so nobody can use
 * a set of books to send mail to strangers.
 *
 * Inviting again sends the email again, within those limits. Where the email
 * cannot be sent, the invitation still stands and the page says so: the person
 * will see it on their Books page when they sign in.
 */

import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { letter } from "./letter.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SMTP_HOST = Deno.env.get("SMTP_HOST") ?? "";
const SMTP_USER = Deno.env.get("SMTP_USER") ?? "";
const SMTP_PASSWORD = Deno.env.get("SMTP_PASSWORD") ?? "";
const APP_URL = Deno.env.get("APP_URL") ?? "https://nbparagliding.nz/nzosa/";
/** Where a warning goes when one person sends a lot of invitations. A secret, so the address is not in the code. */
const ALERT_EMAIL = Deno.env.get("ALERT_EMAIL") ?? "";

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
};

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

/** The database's function, as the caller; its own words if it refuses. */
async function asCaller(jwt: string, fn: string, args: unknown): Promise<{ ok: boolean; body: unknown }> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${jwt}`, "content-type": "application/json" },
    body: JSON.stringify(args),
  });
  return { ok: response.ok, body: await response.json().catch(() => null) };
}

async function asService(fn: string, args: unknown): Promise<unknown> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!response.ok) throw new Error(`database said ${response.status}`);
  return await response.json().catch(() => null);
}

/** Who is asking, by their token: their id and the address they signed in with. */
async function caller(jwt: string): Promise<{ id: string; email: string }> {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${jwt}` },
  });
  if (!response.ok) return { id: "", email: "" };
  const user = (await response.json().catch(() => null)) as { id?: string; email?: string } | null;
  return { id: user?.id ?? "", email: user?.email ?? "" };
}

/** Past this many in a day, the site's owner hears about it, once. */
const ALERT_AFTER = 10;

async function send(to: string, subject: string, text: string, html: string): Promise<void> {
  const client = new SMTPClient({
    connection: {
      hostname: SMTP_HOST,
      port: 465,
      tls: true,
      auth: { username: SMTP_USER, password: SMTP_PASSWORD },
    },
  });
  try {
    await client.send({ from: `NZOSA <${SMTP_USER}>`, to, subject, content: text, ...(html !== "" ? { html } : {}) });
  } finally {
    await client.close();
  }
}

const NOT_EMAILED: Record<string, string> = {
  "address-limit": "An email has already gone to that address three times today, so no more were sent.",
  "books-limit": "These books have sent their 20 invitation emails for today, so no email was sent.",
  "no-invitation": "There is no invitation waiting for that address.",
  "person-limit": "You have sent 100 invitation emails today, the most one person may, so no more were sent.",
};

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (request.method !== "POST") return reply({ error: "POST only" }, 405);

  const jwt = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (jwt === "") return reply({ error: "not signed in" }, 401);

  let body: { book?: string; email?: string; role?: string };
  try {
    body = await request.json();
  } catch {
    return reply({ error: "expected JSON" }, 400);
  }
  const book = String(body.book ?? "");
  const email = String(body.email ?? "").trim();
  const role = String(body.role ?? "bookkeeper");
  if (book === "" || email === "") return reply({ error: "which books, and whom?" }, 400);

  // The invitation first, as the caller: the database decides whether they may.
  const made = await asCaller(jwt, "invite_to_book", { book, who: email, as_role: role });
  if (!made.ok) {
    const said = (made.body as { message?: string } | null)?.message ?? "Could not make that invitation.";
    return reply({ error: said }, 400);
  }

  if (SMTP_HOST === "" || SMTP_USER === "" || SMTP_PASSWORD === "") {
    return reply({ invited: true, emailed: false, said: "Email is not set up on this server." });
  }

  try {
    const who = await caller(jwt);
    if (who.id === "") return reply({ invited: true, emailed: false, said: "No email was sent." });
    const take = (await asService("invitation_email_take", { book, who: email, inviter: who.id })) as {
      ok: boolean;
      why?: string;
      books?: string;
      role?: string;
      email?: string;
      sent_today?: number;
    };
    if (!take.ok) {
      return reply({ invited: true, emailed: false, said: NOT_EMAILED[take.why ?? ""] ?? "No email was sent." });
    }
    const { subject, text, html } = letter(take.books ?? "", take.role ?? role, who.email, APP_URL);
    await send(take.email ?? email, subject, text, html);
    if (take.sent_today === ALERT_AFTER + 1 && ALERT_EMAIL !== "") {
      // Told once, on the eleventh: never in the way of the invitation itself.
      await send(
        ALERT_EMAIL,
        `NZOSA: ${who.email || who.id} has sent ${ALERT_AFTER + 1} invitation emails today`,
        [
          `${who.email || "An account"} (user ${who.id}) has now sent ${ALERT_AFTER + 1} invitation emails in the last 24 hours.`,
          `The latest was to ${take.email ?? email}, for the books "${take.books ?? ""}".`,
          "",
          "One person may send at most 100 a day. If this looks like misuse, the account can be removed under",
          "Authentication, Users in the Supabase dashboard.",
        ].join("\n"),
        "",
      ).catch((error) => console.error("invite alert:", (error as Error).message));
    }
    return reply({ invited: true, emailed: true });
  } catch (error) {
    console.error("invite email:", (error as Error).message);
    return reply({ invited: true, emailed: false, said: "The email could not be sent just now." });
  }
});
