/**
 * Card payments through Stripe, for books kept on the server.
 *
 * Each business connects its own Stripe account with a key it makes there.
 * The key is in Supabase Vault and this function is the only thing that can
 * read it. The money goes to the business's own Stripe account, and Stripe
 * pays it out to the business's bank: NZOSA holds none of it.
 *
 * What it does, asked by the page:
 *   status   whether a key is connected, and to which account
 *   connect  check a key with Stripe and keep it (an owner)
 *   forget   disconnect, deleting the key (an owner)
 *   link     a payment link for one invoice: its amount, once
 *   check    which of the invoices' links have been paid, when and for how much
 *   close    turn a link off, when its invoice changes or is paid another way
 *
 * Two identities, as in the Wise function: the caller's own token, to ask the
 * database whether they may touch these books, and only then the service
 * role, to reach the vault.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
};

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });
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

interface Held {
  key: string;
  account_name: string;
  connected_at: string;
}

async function heldFor(book: string): Promise<Held | null> {
  const rows = (await asService("stripe_secret", { book })) as Held[] | null;
  return rows && rows.length > 0 ? (rows[0] ?? null) : null;
}

/** Ask Stripe something with the business's key; Stripe's own words on a refusal. */
async function stripe(key: string, method: "GET" | "POST", path: string, form?: Record<string, string>): Promise<Record<string, unknown>> {
  const response = await fetch(`https://api.stripe.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
    ...(form ? { body: new URLSearchParams(form).toString() } : {}),
  });
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || body === null) {
    const error = body?.["error"] as { message?: string } | undefined;
    throw new Error(`Stripe said: ${error?.message ?? `HTTP ${response.status}`}`);
  }
  return body;
}

/** Currencies Stripe counts in whole units: no cents. */
const ZERO_DECIMAL = new Set(["BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"]);

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

  // Connecting and disconnecting is an owner's; making and checking links is
  // for whoever writes to the books; seeing whether it is connected, anyone in them.
  const roles =
    action === "connect" || action === "forget"
      ? ["owner"]
      : action === "status" || action === "check"
        ? ["owner", "bookkeeper", "accountant", "readonly"]
        : ["owner", "bookkeeper"];
  const allowed = await asCaller(jwt, "has_role", { book, roles });
  if (allowed !== true) return reply({ error: "not allowed for these books" }, 403);

  try {
    if (action === "status") {
      const held = await heldFor(book);
      return reply({
        configured: held !== null,
        account: held?.account_name ?? "",
        key: held ? `${held.key.slice(0, 8)}…${held.key.slice(-4)}` : "",
        live: held ? /_live_/.test(held.key) : false,
      });
    }

    if (action === "connect") {
      const key = String(body.key ?? "").trim();
      if (!/^(sk|rk)_(live|test)_[A-Za-z0-9]{10,}$/.test(key)) {
        return reply({ error: "That does not look like a Stripe secret or restricted key (sk_… or rk_…)." }, 400);
      }
      // Proved with Stripe before it is kept: a refusal leaves everything as it was.
      await stripe(key, "GET", "/v1/payment_links?limit=1");
      let name = "";
      try {
        const account = await stripe(key, "GET", "/v1/account");
        const settings = account["settings"] as { dashboard?: { display_name?: string } } | undefined;
        const profile = account["business_profile"] as { name?: string } | undefined;
        name = String(settings?.dashboard?.display_name ?? profile?.name ?? account["email"] ?? "");
      } catch {
        // A restricted key may not read the account; it is still a good key.
      }
      await asService("stripe_store", { book, key, name });
      return reply({ connected: true, account: name, live: /_live_/.test(key) });
    }

    if (action === "forget") {
      await asService("stripe_forget", { book });
      return reply({ forgotten: true });
    }

    const held = await heldFor(book);
    if (held === null) return reply({ error: "Stripe is not connected for these books." }, 400);

    if (action === "link") {
      const invoice = String(body.invoice ?? "").trim();
      const contact = String(body.contact ?? "").trim();
      const currency = String(body.currency ?? "").trim().toUpperCase();
      const cents = Number(body.amount ?? 0);
      if (invoice === "" || !/^[A-Z]{3}$/.test(currency) || !Number.isInteger(cents) || cents <= 0) {
        return reply({ error: "An invoice number, a currency and an amount owing are needed." }, 400);
      }
      const unit = ZERO_DECIMAL.has(currency) ? Math.round(cents / 100) : cents;
      const price = await stripe(held.key, "POST", "/v1/prices", {
        currency: currency.toLowerCase(),
        unit_amount: String(unit),
        "product_data[name]": `Invoice ${invoice}`.slice(0, 200),
      });
      const said = `${invoice}${contact !== "" ? ` ${contact}` : ""}`.slice(0, 200);
      const link = await stripe(held.key, "POST", "/v1/payment_links", {
        "line_items[0][price]": String(price["id"]),
        "line_items[0][quantity]": "1",
        "metadata[nzosa_book]": book,
        "metadata[invoice]": invoice,
        // On the payment, so Stripe's payout and balance exports name the invoice.
        "payment_intent_data[description]": said,
        "payment_intent_data[metadata][invoice]": invoice,
        // Paid once: then it closes.
        "restrictions[completed_sessions][limit]": "1",
        "after_completion[type]": "hosted_confirmation",
        "after_completion[hosted_confirmation][custom_message]": `Thank you. Invoice ${invoice} is paid.`.slice(0, 500),
      });
      return reply({ id: link["id"], url: link["url"] });
    }

    if (action === "check") {
      const links = (Array.isArray(body.links) ? body.links : []) as { invoice?: string; id?: string }[];
      const paid: { invoice: string; id: string; amount: number; currency: string; paidAt: string; payment: string }[] = [];
      for (const one of links.slice(0, 100)) {
        const id = String(one.id ?? "");
        if (!/^plink_[A-Za-z0-9]+$/.test(id)) continue;
        const sessions = await stripe(held.key, "GET", `/v1/checkout/sessions?payment_link=${id}&status=complete&limit=3`);
        for (const s of (sessions["data"] as Record<string, unknown>[] | undefined) ?? []) {
          if (s["payment_status"] !== "paid") continue;
          const currency = String(s["currency"] ?? "").toUpperCase();
          const total = Number(s["amount_total"] ?? 0);
          paid.push({
            invoice: String(one.invoice ?? ""),
            id,
            amount: ZERO_DECIMAL.has(currency) ? total * 100 : total,
            currency,
            paidAt: new Date(Number(s["created"] ?? 0) * 1000).toISOString(),
            payment: String(s["payment_intent"] ?? ""),
          });
        }
      }
      return reply({ paid });
    }

    if (action === "close") {
      const id = String(body.id ?? "");
      if (!/^plink_[A-Za-z0-9]+$/.test(id)) return reply({ error: "which link?" }, 400);
      await stripe(held.key, "POST", `/v1/payment_links/${id}`, { active: "false" });
      return reply({ closed: true });
    }

    return reply({ error: "unknown action" }, 400);
  } catch (error) {
    return reply({ error: (error as Error).message }, 502);
  }
});
