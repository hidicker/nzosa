/**
 * NZOSA's connector: one set of books online, for an outside AI app.
 *
 * Claude, ChatGPT and other apps that take a remote MCP connector are given
 * this address, one per set of books:
 *
 *   https://<project>.supabase.co/functions/v1/mcp/<book id>
 *
 * The app signs the person in through Supabase's OAuth server (the consent
 * screen is in NZOSA), then asks here with that token. This checks the token
 * with Auth, checks the person is a member of these books, loads the books,
 * and answers with the same tools and checks as the server on a person's own
 * computer (packages/mcp, bundled into ./tools.js by
 * tools/build-mcp-function.mjs). What it suggests is saved as the part
 * `suggested`, and waits in NZOSA until somebody uses or declines it there.
 *
 * Deployed with --no-verify-jwt: the gateway's check would turn an app away
 * before it learned where to sign in. Every request is checked here instead.
 */

// @ts-ignore: built output, see tools/build-mcp-function.mjs
import { answerHosted } from "./tools.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version, mcp-session-id",
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-expose-headers": "www-authenticate, mcp-session-id",
};

/** The parts the tools read, and the one they add to. */
const PARTS = ["transactions", "decisions", "entities", "chart", "rules", "suggested"];

/** Roles that may suggest; a read-only member only reads. */
const SUGGESTERS = new Set(["owner", "bookkeeper", "accountant"]);

/** The most one request may carry. A tool call is a few kilobytes; this is generous. */
const LARGEST_REQUEST = 1_000_000;

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json", ...extra },
  });
}

function rpcError(id: unknown, code: number, message: string): unknown {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

/** Where this set of books is, as the app was given it. */
function resourceFor(book: string): string {
  return `${SUPABASE_URL}/functions/v1/mcp/${book}`;
}

/** Turned away for want of a token: says where to sign in (RFC 9728). */
function signInFirst(book: string, why: string): Response {
  const metadata = `${resourceFor(book)}/.well-known/oauth-protected-resource`;
  return json({ error: "invalid_token", error_description: why }, 401, {
    "www-authenticate": `Bearer resource_metadata="${metadata}", error="invalid_token"`,
  });
}

async function service(path: string, init: RequestInit = {}): Promise<Response> {
  return await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

/** Who the token belongs to, checked by Auth itself; null when it is not good. */
async function personFor(token: string): Promise<string | null> {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null;
  const user = (await response.json().catch(() => null)) as { id?: string } | null;
  return typeof user?.id === "string" && user.id !== "" ? user.id : null;
}

/** The token's own claims. Read only after Auth has said the token is good. */
function claimsOf(token: string): Record<string, unknown> {
  try {
    const part = token.split(".")[1] ?? "";
    const text = atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "="));
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const clientNames = new Map<string, string>();

/** The app's name as it registered itself ("Claude"), for saying who suggested what. */
async function clientName(clientId: string): Promise<string> {
  if (clientId === "") return "";
  const known = clientNames.get(clientId);
  if (known !== undefined) return known;
  let name = "";
  try {
    const response = await service(`/auth/v1/admin/oauth/clients/${encodeURIComponent(clientId)}`);
    if (response.ok) {
      const client = (await response.json()) as { client_name?: string; name?: string };
      name = (client.client_name ?? client.name ?? "").slice(0, 60);
    }
  } catch {
    name = "";
  }
  clientNames.set(clientId, name);
  return name;
}

/** The person's role in these books, or null when they are not a member (or no longer). */
async function roleIn(book: string, person: string): Promise<string | null> {
  const response = await service(
    `/rest/v1/book_members?select=role,access_until&book_id=eq.${book}&user_id=eq.${person}`,
  );
  if (!response.ok) return null;
  const rows = (await response.json()) as { role: string; access_until: string | null }[];
  const row = rows[0];
  if (row === undefined) return null;
  const today = new Date().toISOString().slice(0, 10);
  if (row.access_until !== null && row.access_until < today) return null;
  return row.role;
}

async function booksNamed(book: string): Promise<string | null> {
  const response = await service(`/rest/v1/books?select=name&id=eq.${book}&deleted_at=is.null`);
  if (!response.ok) return null;
  const rows = (await response.json()) as { name: string }[];
  return rows[0]?.name ?? null;
}

async function partsOf(book: string): Promise<Record<string, unknown>> {
  const response = await service(
    `/rest/v1/book_parts?select=part,data&book_id=eq.${book}&part=in.(${PARTS.join(",")})`,
  );
  if (!response.ok) throw new Error(`the books could not be read (${response.status})`);
  const rows = (await response.json()) as { part: string; data: unknown }[];
  return Object.fromEntries(rows.map((r) => [r.part, r.data]));
}

/** Save the sets this request added, beside any added meanwhile. */
async function keepSuggested(book: string, person: string, before: unknown, after: unknown): Promise<void> {
  const held = new Set(
    ((before as { sets?: { id: string }[] } | undefined)?.sets ?? []).map((s) => s.id),
  );
  const added = ((after as { sets?: { id: string }[] }).sets ?? []).filter((s) => !held.has(s.id));
  if (added.length === 0) return;
  const response = await service("/rest/v1/rpc/suggested_add", {
    method: "POST",
    body: JSON.stringify({ p_book: book, p_sets: added, p_by: person }),
  });
  if (!response.ok) throw new Error(`the suggestion could not be kept (${response.status})`);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

  const path = new URL(request.url).pathname;
  const match = /\/mcp\/([0-9a-f-]{36})(\/.*)?$/i.exec(path);
  if (match === null) {
    return json({ error: "This address needs the books' id after /mcp/. Copy it from the AI page in NZOSA." }, 404);
  }
  const book = (match[1] as string).toLowerCase();
  const rest = match[2] ?? "";

  // Where to sign in, for an app connecting the first time (RFC 9728).
  if (rest === "/.well-known/oauth-protected-resource" && request.method === "GET") {
    return json({
      resource: resourceFor(book),
      authorization_servers: [`${SUPABASE_URL}/auth/v1`],
      bearer_methods_supported: ["header"],
      resource_name: "NZOSA books",
    });
  }
  if (rest !== "" && rest !== "/") return json({ error: "Not found." }, 404);

  // Streamable HTTP without a stream: answers come back to each POST.
  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { ...CORS, allow: "POST, OPTIONS" } });
  }

  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (token === "") return signInFirst(book, "Sign in to NZOSA to connect these books.");
  const person = await personFor(token);
  if (person === null) return signInFirst(book, "That sign-in has expired or is not NZOSA's. Connect again.");

  const text = await request.text();
  if (text.length > LARGEST_REQUEST) return json(rpcError(null, -32600, "That request is too large."), 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json(rpcError(null, -32700, "Parse error"), 400);
  }
  const firstId = Array.isArray(body) ? null : (body as { id?: unknown })?.id;

  const role = await roleIn(book, person);
  const name = role === null ? null : await booksNamed(book);
  if (role === null || name === null) {
    return json(rpcError(firstId, -32001, "These books are not open to you. Ask their owner to add you, or connect the books you work on."), 403);
  }

  try {
    const parts = await partsOf(book);
    const claims = claimsOf(token);
    const client = await clientName(typeof claims["client_id"] === "string" ? (claims["client_id"] as string) : "");
    const answer = answerHosted({ body, parts, name, suggest: SUGGESTERS.has(role), client });
    if (answer.suggested !== undefined) await keepSuggested(book, person, parts["suggested"], answer.suggested);
    if (answer.reply === undefined) return new Response(null, { status: 202, headers: CORS });
    return json(answer.reply);
  } catch (error) {
    return json(rpcError(firstId, -32603, `Could not answer: ${(error as Error).message}`), 500);
  }
});
