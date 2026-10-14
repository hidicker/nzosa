/**
 * Telling the site's owner that somebody has signed up.
 *
 * Called by the database the moment an account is made (see the
 * 20261014090000_signup_alert migration), with the same key the morning run
 * uses, so only the database can start it. It emails the owner's alert address
 * from NZOSA's mailbox: who, by which way in, and how many accounts there are
 * now against the ceiling.
 *
 * Failing to send is not an error anywhere that matters: the account exists
 * either way, and the database does not wait for this.
 */

import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const KEY = Deno.env.get("NIGHTLY_KEY") ?? "";
const SMTP_HOST = Deno.env.get("SMTP_HOST") ?? "";
const SMTP_USER = Deno.env.get("SMTP_USER") ?? "";
const SMTP_PASSWORD = Deno.env.get("SMTP_PASSWORD") ?? "";
const ALERT_EMAIL = Deno.env.get("ALERT_EMAIL") ?? "";

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Constant-time comparison, so the key cannot be found by timing. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return reply({ error: "POST only" }, 405);
  const sent = request.headers.get("x-nightly-key") ?? "";
  if (KEY === "" || !same(sent, KEY)) return reply({ error: "not allowed" }, 401);
  if (SMTP_HOST === "" || SMTP_USER === "" || SMTP_PASSWORD === "" || ALERT_EMAIL === "") {
    return reply({ sent: false, said: "email is not set up" });
  }

  let body: { email?: string; name?: string; provider?: string; total?: number; ceiling?: number };
  try {
    body = await request.json();
  } catch {
    return reply({ error: "expected JSON" }, 400);
  }
  const email = String(body.email ?? "").slice(0, 200);
  const name = String(body.name ?? "").slice(0, 200);
  const provider = String(body.provider ?? "email").slice(0, 40);
  const total = Number(body.total ?? 0);
  const ceiling = Number(body.ceiling ?? 15);

  const subject = `NZOSA: new online sign-up (${total} of ${ceiling})`;
  const text =
    `Somebody has signed up for NZOSA online.\n\n` +
    `Name: ${name === "" ? "(not given)" : name}\n` +
    `Email: ${email}\n` +
    `Signed up with: ${provider === "google" ? "Google" : "email and password"}\n` +
    `Accounts now: ${total} of ${ceiling}\n`;

  const client = new SMTPClient({
    connection: { hostname: SMTP_HOST, port: 465, tls: true, auth: { username: SMTP_USER, password: SMTP_PASSWORD } },
  });
  try {
    await client.send({ from: `NZOSA <${SMTP_USER}>`, to: ALERT_EMAIL, subject, content: text });
    return reply({ sent: true });
  } catch (error) {
    return reply({ sent: false, said: error instanceof Error ? error.message : "could not send" }, 502);
  } finally {
    await client.close();
  }
});
