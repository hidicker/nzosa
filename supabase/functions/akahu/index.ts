/**
 * The bank feed, for books kept on the server.
 *
 * NZOSA run from a folder keeps Akahu's two tokens in a file beside the
 * ledgers, and the page never sees them: it is told whether a connection
 * exists and nothing more. This is that same arrangement, moved to a server --
 * the tokens are held in Supabase Vault, and this function is the only thing
 * that can read them.
 *
 * The tokens belong to the person, not to this service. They come from their
 * own Akahu personal app, they are used only to fetch their own transactions,
 * and disconnecting deletes them. Anybody can revoke them at my.akahu.nz
 * without asking us.
 *
 * Two identities are used here, deliberately:
 *
 *   - the caller's own token, to ask the database whether they may touch these
 *     books at all. The answer comes from the same policies every other
 *     request goes through, so this function cannot accidentally be more
 *     generous than the rest of the system.
 *   - the service role, only after that, to reach the vault.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

/** Ask the database something as the person who called, policies and all. */
async function asCaller(jwt: string, fn: string, args: unknown): Promise<unknown> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      authorization: `Bearer ${jwt}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(args),
  });
  if (!response.ok) return null;
  return await response.json().catch(() => null);
}

/** Ask the database something the caller is not allowed to ask directly. */
async function asService(fn: string, args: unknown): Promise<unknown> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(args),
  });
  if (!response.ok) throw new Error(`database said ${response.status}`);
  return await response.json().catch(() => null);
}

interface FeedSecrets {
  app_token: string;
  user_token: string;
  accounts: Record<string, string>;
  settings: Record<string, unknown>;
}

async function secretsFor(book: string): Promise<FeedSecrets | null> {
  const rows = (await asService("feed_secrets", { book })) as FeedSecrets[] | null;
  return rows && rows.length > 0 ? (rows[0] ?? null) : null;
}

/**
 * Ask Akahu something, as the person whose tokens these are.
 *
 * Both tokens go on every request: the app token says which app is asking, the
 * user token says whose data it may see.
 */
async function akahu(feed: FeedSecrets, path: string, search = ""): Promise<unknown> {
  const response = await fetch(`https://api.akahu.io/v1${path}${search}`, {
    headers: {
      authorization: `Bearer ${feed.user_token}`,
      "X-Akahu-Id": feed.app_token,
    },
  });
  const body = (await response.json().catch(() => ({}))) as { message?: string };
  if (!response.ok) throw new Error(body.message ?? `Akahu said ${response.status}`);
  return body;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (request.method !== "POST") return reply({ error: "POST only" }, 405);

  const jwt = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (jwt === "") return reply({ error: "not signed in" }, 401);

  let body: { action?: string; book?: string; [key: string]: unknown };
  try {
    body = await request.json();
  } catch {
    return reply({ error: "expected JSON" }, 400);
  }

  const book = String(body.book ?? "");
  const action = String(body.action ?? "");
  if (book === "") return reply({ error: "which books?" }, 400);

  // Reading a feed's state is for anybody in these books; changing it, or
  // fetching from the bank, is for the people who write to them.
  const roles = action === "status" ? ["owner", "bookkeeper", "accountant"] : ["owner", "bookkeeper"];
  const allowed = await asCaller(jwt, "has_role", { book, roles });
  if (allowed !== true) return reply({ error: "not your books" }, 403);

  try {
    if (action === "status") {
      const feed = await secretsFor(book);
      return reply({
        configured: feed !== null,
        // Enough to recognise which app it is, never enough to use.
        appToken: feed ? `${feed.app_token.slice(0, 14)}…` : "",
        accounts: feed?.accounts ?? {},
        settings: feed?.settings ?? {},
      });
    }

    if (action === "connect") {
      const appToken = String(body.appToken ?? "").trim();
      const userToken = String(body.userToken ?? "").trim();
      if (!appToken.startsWith("app_token_") || !userToken.startsWith("user_token_")) {
        return reply(
          { error: "an app token starts with app_token_ and a user token with user_token_" },
          400,
        );
      }
      await asService("feed_store", { book, app_token: appToken, user_token: userToken });
      // Proved before it is called connected: a typo in a token should be a
      // message now, not an empty transaction list next week.
      const feed = await secretsFor(book);
      if (feed === null) return reply({ error: "could not store those tokens" }, 500);
      await akahu(feed, "/accounts");
      return reply({ configured: true });
    }

    if (action === "disconnect") {
      await asService("feed_forget", { book });
      return reply({ configured: false });
    }

    if (action === "accounts") {
      const feed = await secretsFor(book);
      if (feed === null) return reply({ error: "no bank feed is connected" }, 400);
      const listed = (await akahu(feed, "/accounts")) as { items?: unknown[] };
      return reply({ accounts: listed.items ?? [] });
    }

    if (action === "mapping") {
      await asService("feed_accounts_set", { book, mapping: body.accounts ?? {} });
      return reply({ accounts: body.accounts ?? {} });
    }

    if (action === "settings") {
      await asService("feed_settings_set", { book, wanted: body.settings ?? {} });
      return reply({ settings: body.settings ?? {} });
    }

    if (action === "transactions") {
      const feed = await secretsFor(book);
      if (feed === null) return reply({ error: "no bank feed is connected" }, 400);
      const start = String(body.start ?? "");
      const search = start === "" ? "" : `?start=${encodeURIComponent(start)}`;
      const got = (await akahu(feed, "/transactions", search)) as { items?: unknown[] };
      await asService("feed_touch", { book });
      return reply({ items: got.items ?? [] });
    }

    return reply({ error: `no such action: ${action}` }, 400);
  } catch (error) {
    // Akahu's own words where there are any: "your token has expired" is worth
    // passing on, and is not something this function should paraphrase.
    return reply({ error: (error as Error).message }, 502);
  }
});
