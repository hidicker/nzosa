/**
 * Wise, for books kept on the server.
 *
 * The desktop app keeps a Wise API token beside the ledgers and the page never
 * sees it. This is that arrangement on a server, as the bank feed's is: the
 * token is in Supabase Vault, and this function is the only thing that can
 * read it.
 *
 * The token belongs to the person: made in their own Wise account, used only
 * to read their own balances and statements, and deleted on disconnect. It can
 * be revoked in Wise at any time without asking anybody.
 *
 * Two identities, as in the bank feed's function: the caller's own token, to
 * ask the database whether they may touch these books at all, and only then
 * the service role, to reach the vault.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  // Every header the page sends, apikey included, or the browser never sends
  // the request at all.
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
};

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

async function asCaller(jwt: string, fn: string, args: unknown): Promise<unknown> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${jwt}`, "content-type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!response.ok) return null;
  return await response.json().catch(() => null);
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

interface WiseHeld {
  token: string;
  accounts: Record<string, string>;
  from_date: string | null;
  last_fetch: string | null;
}

async function heldFor(book: string): Promise<WiseHeld | null> {
  const rows = (await asService("wise_secret", { book })) as WiseHeld[] | null;
  return rows && rows.length > 0 ? (rows[0] ?? null) : null;
}

/** Ask Wise something with the person's token; Wise's own words on a refusal. */
async function wise(token: string, path: string): Promise<unknown> {
  const response = await fetch(`https://api.wise.com${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || body === null) {
    const errors = body?.["errors"] as { message?: string }[] | undefined;
    const said = String(body?.["message"] ?? body?.["error"] ?? errors?.[0]?.message ?? `HTTP ${response.status}`);
    throw new Error(`Wise said: ${said}`);
  }
  return body;
}

interface Profile {
  id: number;
  type?: string;
  businessName?: string;
  fullName?: string;
  details?: { name?: string; firstName?: string; lastName?: string };
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

  // Seeing whether Wise is connected is for anybody in these books; changing
  // it, or reading from Wise, is for the people who write to them.
  const roles = action === "status" ? ["owner", "bookkeeper", "accountant"] : ["owner", "bookkeeper"];
  const allowed = await asCaller(jwt, "has_role", { book, roles });
  if (allowed !== true) return reply({ error: "not your books" }, 403);

  try {
    if (action === "status") {
      const held = await heldFor(book);
      return reply({
        configured: held !== null,
        token: held ? `${held.token.slice(0, 4)}…${held.token.slice(-4)}` : "",
        accounts: held?.accounts ?? {},
        from: held?.from_date ?? "",
        lastFetch: held?.last_fetch ?? "",
      });
    }

    if (action === "connect") {
      const token = String(body.token ?? "").trim();
      if (token.length < 20) return reply({ error: "that does not look like a Wise API token" }, 400);
      // Proved with Wise before it is kept: a refusal leaves everything as it was.
      await wise(token, "/v2/profiles");
      await asService("wise_store", { book, token });
      return reply({ configured: true });
    }

    if (action === "disconnect") {
      await asService("wise_forget", { book });
      return reply({ configured: false });
    }

    const held = await heldFor(book);
    if (held === null) return reply({ error: "Wise is not connected" }, 400);

    if (action === "balances") {
      const profiles = (await wise(held.token, "/v2/profiles")) as Profile[];
      const balances: unknown[] = [];
      for (const profile of Array.isArray(profiles) ? profiles : []) {
        const list = (await wise(held.token, `/2026Q3/profiles/${profile.id}/balances?types=STANDARD`)) as {
          id: number;
          currency?: string;
          amount?: { value?: number; currency?: string };
        }[];
        for (const balance of Array.isArray(list) ? list : []) {
          balances.push({
            profileId: profile.id,
            profileType: String(profile.type ?? ""),
            profileName: String(
              profile.details?.name ?? profile.businessName ?? profile.fullName ??
                [profile.details?.firstName, profile.details?.lastName].filter(Boolean).join(" "),
            ),
            balanceId: balance.id,
            currency: String(balance.currency ?? balance.amount?.currency ?? ""),
            amount: Math.round(Number(balance.amount?.value ?? 0) * 100),
          });
        }
      }
      return reply({ balances });
    }

    if (action === "set") {
      const from = typeof body.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.from) ? body.from : null;
      await asService("wise_set", {
        book,
        mapping: body.accounts ?? null,
        from_day: from,
      });
      return reply({ accounts: body.accounts ?? held.accounts, from: from ?? held.from_date ?? "" });
    }

    if (action === "statement") {
      const profileId = String(body.profileId ?? "");
      const balanceId = String(body.balanceId ?? "");
      const currency = String(body.currency ?? "");
      if (!/^\d+$/.test(profileId) || !/^\d+$/.test(balanceId) || !/^[A-Z]{3}$/.test(currency)) {
        return reply({ error: "which balance?" }, 400);
      }
      const start = String(body.start ?? "");
      // In windows of a year: Wise accepts at most 469 days in one.
      const transactions: unknown[] = [];
      let at = Date.parse(start !== "" ? start : new Date(Date.now() - 365 * 86_400_000).toISOString());
      const stop = Date.now();
      let closing: unknown = null;
      while (at < stop) {
        const next = Math.min(stop, at + 365 * 86_400_000);
        const search = new URLSearchParams({
          currency,
          intervalStart: new Date(at).toISOString(),
          intervalEnd: new Date(next).toISOString(),
          type: "FLAT",
        });
        const statement = (await wise(
          held.token,
          `/2026Q3/profiles/${profileId}/balance-statements/${balanceId}/statement.json?${search.toString()}`,
        )) as { transactions?: unknown[]; endOfStatementBalance?: unknown };
        transactions.push(...(statement.transactions ?? []));
        closing = statement.endOfStatementBalance ?? closing;
        at = next;
      }
      await asService("wise_touch", { book });
      return reply({ transactions, closing });
    }

    return reply({ error: `no such action: ${action}` }, 400);
  } catch (error) {
    return reply({ error: (error as Error).message }, 502);
  }
});
