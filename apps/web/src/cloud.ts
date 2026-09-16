import { CLOUD, cloudConfigured } from "./cloud-config.js";

/**
 * The hosted books: signing in, and reading and writing parts over the wire.
 *
 * Written against Supabase's REST endpoints directly rather than its client
 * library. The library is most of a megabyte unpacked, and this app has to
 * stay a small static bundle somebody can put on free hosting -- which is the
 * same reason the core has no dependencies at all. What is actually needed is
 * a sign-in, a token refresh, three queries and one function call.
 *
 * Nothing here decides what a person may see. The database does that, on every
 * request, from the policies beside the tables: this module could ask for
 * another user's books and would simply be handed nothing.
 */

const SESSION_KEY = "nzosa:cloud-session";

export interface CloudSession {
  userId: string;
  email: string;
  accessToken: string;
  refreshToken: string;
  /** Unix seconds. Refreshed before it runs out rather than after it fails. */
  expiresAt: number;
}

export interface CloudBook {
  id: string;
  name: string;
  createdAt: string;
}

/** What a part came back as, the version included so a save can be checked. */
export interface CloudPart {
  version: number;
  data: unknown;
}

export type SaveOutcome =
  | { kind: "saved"; version: number }
  | { kind: "conflict" }
  | { kind: "refused"; why: string }
  | { kind: "failed"; why: string };

let session: CloudSession | null = null;

// The session outlives a reload, or signing in would be the first thing
// anybody did every morning. It is this browser's alone: the refresh token is
// no more powerful than being signed in already, and the alternative --
// holding it only in memory -- trades a real annoyance for no real gain.
function remember(next: CloudSession | null): void {
  session = next;
  try {
    if (next === null) localStorage.removeItem(SESSION_KEY);
    else localStorage.setItem(SESSION_KEY, JSON.stringify(next));
  } catch {
    // A browser that refuses storage still works; it just asks again later.
  }
}

function recall(): CloudSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<CloudSession>;
    if (typeof parsed.accessToken !== "string" || typeof parsed.refreshToken !== "string") {
      return null;
    }
    return {
      userId: String(parsed.userId ?? ""),
      email: String(parsed.email ?? ""),
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      expiresAt: Number(parsed.expiresAt ?? 0),
    };
  } catch {
    return null;
  }
}

/** Who is signed in, if anybody. Read from storage once, then held. */
export function currentSession(): CloudSession | null {
  if (session === null) session = recall();
  return session;
}

export function signedIn(): boolean {
  return cloudConfigured() && currentSession() !== null;
}

interface TokenReply {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: { id?: string; email?: string };
  error_description?: string;
  msg?: string;
  message?: string;
}

function sessionFrom(reply: TokenReply): CloudSession | null {
  if (typeof reply.access_token !== "string" || typeof reply.refresh_token !== "string") {
    return null;
  }
  return {
    userId: reply.user?.id ?? "",
    email: reply.user?.email ?? "",
    accessToken: reply.access_token,
    refreshToken: reply.refresh_token,
    expiresAt: Math.floor(Date.now() / 1000) + (reply.expires_in ?? 3600),
  };
}

function why(reply: TokenReply, fallback: string): string {
  return reply.error_description ?? reply.msg ?? reply.message ?? fallback;
}

async function auth(path: string, body: unknown): Promise<TokenReply> {
  const response = await fetch(`${CLOUD.url}/auth/v1/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: CLOUD.publishableKey },
    body: JSON.stringify(body),
  });
  return (await response.json().catch(() => ({}))) as TokenReply;
}

export async function signIn(
  email: string,
  password: string,
): Promise<{ ok: true } | { ok: false; why: string }> {
  const reply = await auth("token?grant_type=password", { email, password });
  const next = sessionFrom(reply);
  if (next === null) return { ok: false, why: why(reply, "Could not sign in.") };
  remember(next);
  return { ok: true };
}

/**
 * Making an account.
 *
 * The project asks for the address to be confirmed, so a sign-up usually comes
 * back with no session: the person has an email to open first. Said plainly,
 * because "nothing happened" is what an unexplained empty reply looks like.
 */
export async function signUp(
  email: string,
  password: string,
): Promise<{ ok: true; confirm: boolean } | { ok: false; why: string }> {
  const reply = await auth("signup", { email, password });
  const next = sessionFrom(reply);
  if (next !== null) {
    remember(next);
    return { ok: true, confirm: false };
  }
  // No session and no error means it worked and is waiting on the email.
  const problem = reply.error_description ?? reply.msg ?? reply.message;
  if (problem !== undefined) return { ok: false, why: problem };
  return { ok: true, confirm: true };
}

export async function signOut(): Promise<void> {
  const held = currentSession();
  if (held !== null) {
    try {
      await fetch(`${CLOUD.url}/auth/v1/logout`, {
        method: "POST",
        headers: {
          apikey: CLOUD.publishableKey,
          authorization: `Bearer ${held.accessToken}`,
        },
      });
    } catch {
      // Signing out locally is what matters; the token expires on its own.
    }
  }
  remember(null);
}

/**
 * A token good for the next minute at least.
 *
 * Refreshed a minute early rather than on the first rejection: a save that
 * fails because a token expired mid-request looks to the person like a save
 * that failed, and this app is not in the business of losing somebody's work
 * to a clock.
 */
async function freshToken(): Promise<string | null> {
  const held = currentSession();
  if (held === null) return null;
  if (held.expiresAt - 60 > Math.floor(Date.now() / 1000)) return held.accessToken;

  const reply = await auth("token?grant_type=refresh_token", { refresh_token: held.refreshToken });
  const next = sessionFrom(reply);
  if (next === null) {
    // The refresh token is gone or revoked: this is a signed-out state, and
    // pretending otherwise would give a page full of empty books instead.
    remember(null);
    return null;
  }
  remember({ ...next, email: next.email === "" ? held.email : next.email });
  return next.accessToken;
}

async function rest(path: string, init: RequestInit = {}): Promise<Response | null> {
  const token = await freshToken();
  if (token === null) return null;
  try {
    return await fetch(`${CLOUD.url}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: CLOUD.publishableKey,
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
    });
  } catch {
    return null;
  }
}

/** Every set of books this person is a member of. */
export async function listBooks(): Promise<CloudBook[]> {
  const response = await rest("books?select=id,name,created_at&order=name.asc");
  if (response === null || !response.ok) return [];
  const rows = (await response.json().catch(() => [])) as {
    id: string;
    name: string;
    created_at: string;
  }[];
  return rows.map((row) => ({ id: row.id, name: row.name, createdAt: row.created_at }));
}

/**
 * A new set of books, owned by whoever made it.
 *
 * `created_by` is sent because the policy insists it is the person signing the
 * request -- the database will not take anybody else's word for who owns a set
 * of books -- and the membership row is written by a trigger, so a book is
 * never left with no one able to open it.
 */
export async function createBook(name: string): Promise<CloudBook | null> {
  const held = currentSession();
  if (held === null) return null;
  const response = await rest("books?select=id,name,created_at", {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({ name, created_by: held.userId }),
  });
  if (response === null || !response.ok) return null;
  const rows = (await response.json().catch(() => [])) as {
    id: string;
    name: string;
    created_at: string;
  }[];
  const made = rows[0];
  return made === undefined
    ? null
    : { id: made.id, name: made.name, createdAt: made.created_at };
}

/** Every part of one set of books, with the version each is at. */
export async function loadParts(bookId: string): Promise<Record<string, CloudPart>> {
  const response = await rest(
    `book_parts?book_id=eq.${encodeURIComponent(bookId)}&select=part,version,data`,
  );
  if (response === null || !response.ok) return {};
  const rows = (await response.json().catch(() => [])) as {
    part: string;
    version: number;
    data: unknown;
  }[];
  const parts: Record<string, CloudPart> = {};
  for (const row of rows) parts[row.part] = { version: row.version, data: row.data };
  return parts;
}

interface PostgrestError {
  code?: string;
  message?: string;
}

/**
 * Write one part, saying which version it replaces.
 *
 * The version is the whole point. Two people with the same books open will
 * sooner or later save the same part, and whoever saves second would otherwise
 * wipe out the first without either of them seeing anything. The database
 * refuses that save; the caller reloads and tries again.
 *
 * Errors are told apart by the code the database raised rather than by the
 * HTTP status, because the status depends on how PostgREST happens to map it.
 */
export async function savePart(
  bookId: string,
  part: string,
  data: unknown,
  version: number,
): Promise<SaveOutcome> {
  const response = await rest("rpc/save_part", {
    method: "POST",
    body: JSON.stringify({ p_book: bookId, p_part: part, p_data: data, p_version: version }),
  });
  if (response === null) return { kind: "failed", why: "Not signed in, or no connection." };

  if (response.ok) {
    const next = (await response.json().catch(() => null)) as number | null;
    return typeof next === "number"
      ? { kind: "saved", version: next }
      : { kind: "failed", why: "The server did not say which version it wrote." };
  }

  const error = (await response.json().catch(() => ({}))) as PostgrestError;
  if (error.code === "40001") return { kind: "conflict" };
  if (error.code === "42501") {
    return { kind: "refused", why: "You do not have permission to change these books." };
  }
  return { kind: "failed", why: error.message ?? `Save failed (${response.status}).` };
}

/** Whether a set of books has a bank feed connected. The tokens stay server-side. */
export async function feedStatus(
  bookId: string,
): Promise<{ connected: boolean; accounts: unknown; settings: unknown } | null> {
  const response = await rest("rpc/feed_status", {
    method: "POST",
    body: JSON.stringify({ book: bookId }),
  });
  if (response === null || !response.ok) return null;
  const rows = (await response.json().catch(() => [])) as {
    connected: boolean;
    accounts: unknown;
    settings: unknown;
  }[];
  const row = rows[0];
  return row === undefined
    ? { connected: false, accounts: {}, settings: {} }
    : { connected: row.connected, accounts: row.accounts, settings: row.settings };
}
