/**
 * Asking a model, for books kept on the server.
 *
 * NZOSA run from a folder keeps its key in a file beside the ledgers and the
 * page never sees it. This is that same arrangement moved to a server: the key
 * is in Supabase Vault and this function is the only thing that can read it.
 *
 * Two identities, as the bank feed does it:
 *
 *   - the caller's own token, to ask the database whether they may touch these
 *     books at all. The answer comes from the same policies every other
 *     request goes through, so this cannot accidentally be more generous than
 *     the rest of the system.
 *   - the service role, only after that, to reach the vault.
 *
 * And two kinds of key. One somebody brought is theirs: they pay Google, and
 * the only limit is a batch size that keeps the answers readable. The
 * project's own key is here so somebody can see this work without having one,
 * and it is paid for by whoever runs this installation -- so it is capped at
 * twenty a batch and a thousand transactions per person, for good rather than
 * per day, a trial being a trial and not an allowance that refills.
 *
 * Per person and not per set of books, because one person may start twenty of
 * those. Counting a person means knowing who they are, so that count is taken
 * by the database from their own token rather than from anything this function
 * says about them.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
/** The installation's own key. Absent, there is simply no shared key on offer. */
const SHARED_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const SHARED_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.6-flash";

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  // Every header the page actually sends. A browser asks first, before the
  // real request, and one missing name here -- apikey was -- means it never
  // sends the request at all.
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
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
  if (!response.ok) {
    // The database's own words, where it had any: a cap that says which cap it
    // was is worth more than "something went wrong".
    const said = (await response.json().catch(() => null)) as { message?: string } | null;
    throw Object.assign(new Error(said?.message ?? `database said ${response.status}`), {
      status: response.status,
    });
  }
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
  if (!response.ok) {
    const said = (await response.json().catch(() => null)) as { message?: string } | null;
    throw Object.assign(new Error(said?.message ?? `database said ${response.status}`), {
      status: response.status,
    });
  }
  return await response.json().catch(() => null);
}

interface Model {
  name: string;
  label: string;
}

const NOT_FOR_THIS =
  /image|tts|audio|video|robotics|computer-use|transcribe|lyria|deep-research|antigravity|nano-banana|omni|embedding|aqa/i;

const PREFERRED = ["gemini-3.6-flash", "gemini-flash-latest", "gemini-3.6-pro"];

function order(models: Model[]): Model[] {
  const rank = (model: Model): number => {
    const preferred = PREFERRED.indexOf(model.name);
    if (preferred >= 0) return preferred;
    const family = /^gemini/.test(model.name) ? 10 : 1000;
    const version = /latest/.test(model.name)
      ? 99
      : Number((model.name.match(/\d+(\.\d+)?/) ?? ["0"])[0]);
    return family + (100 - version);
  };
  return [...models].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/**
 * Every model this key may use that can answer this kind of question.
 *
 * Also how a key is checked. Listing costs nothing and says more than a test
 * question would: a key that cannot list cannot do anything, and one that can
 * gives us names to offer rather than a guess.
 */
async function listModels(key: string): Promise<Model[]> {
  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200",
    { headers: { "x-goog-api-key": key } },
  );
  const body = (await response.json().catch(() => null)) as {
    models?: { name?: string; displayName?: string; supportedGenerationMethods?: string[] }[];
    error?: { message?: string };
  } | null;
  if (!response.ok) throw new Error(body?.error?.message ?? `Google said ${response.status}`);
  return order(
    (body?.models ?? [])
      .filter((model) => (model.supportedGenerationMethods ?? []).includes("generateContent"))
      .map((model) => ({
        name: String(model.name ?? "").replace(/^models\//, ""),
        label: String(model.displayName ?? model.name ?? ""),
      }))
      .filter((model) => model.name !== "" && !NOT_FOR_THIS.test(model.name)),
  );
}

function pick(models: Model[], wanted: string): string {
  const has = (name: string): boolean => models.some((model) => model.name === name);
  if (wanted !== "" && has(wanted)) return wanted;
  for (const name of PREFERRED) if (has(name)) return name;
  return models.find((model) => /flash/i.test(model.name))?.name ?? models[0]?.name ?? "";
}

async function ask(key: string, model: string, prompt: string): Promise<string> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0 },
      }),
    },
  );
  const body = (await response.json().catch(() => null)) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    error?: { message?: string };
  } | null;
  if (!response.ok) throw new Error(body?.error?.message ?? `Google said ${response.status}`);
  return (body?.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? "").join("");
}

/**
 * The same model, asked to hold a conversation it may use tools in.
 *
 * The turn comes back unread. What a function call means, and how to answer
 * it, is the page's business: the tools belong to an MCP server out on the
 * web and the page can reach it itself. What has to be here is the key.
 */
async function talk(
  key: string,
  model: string,
  contents: unknown[],
  tools: unknown[],
): Promise<{ parts: unknown[]; finishReason: string }> {
  const body: Record<string, unknown> = {
    contents,
    generationConfig: { temperature: 0 },
  };
  if (tools.length > 0) body.tools = [{ functionDeclarations: tools }];

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
    },
  );
  const answer = (await response.json().catch(() => null)) as {
    candidates?: { content?: { parts?: unknown[] }; finishReason?: string }[];
    error?: { message?: string };
  } | null;
  if (!response.ok) {
    throw new Error(answer?.error?.message ?? `Google said ${response.status}`);
  }
  const candidate = answer?.candidates?.[0];
  return {
    parts: candidate?.content?.parts ?? [],
    finishReason: candidate?.finishReason ?? "",
  };
}

interface KeyRow {
  key: string;
  model: string;
}

async function keyFor(book: string): Promise<KeyRow | null> {
  const rows = (await asService("ai_key_for", { book })) as KeyRow[] | null;
  return rows && rows.length > 0 ? (rows[0] ?? null) : null;
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

  // Reading what is set up is for anybody in these books; setting a key, and
  // spending on one, is for the people who write to them.
  const roles = action === "state"
    ? ["owner", "bookkeeper", "accountant"]
    : ["owner", "bookkeeper"];
  // Asking also has to be affordable, which the database decides below.
  const allowed = await asCaller(jwt, "has_role", { book, roles }).catch(() => false);
  if (allowed !== true) return reply({ error: "not your books" }, 403);

  try {
    if (action === "state") {
      const rows = (await asCaller(jwt, "ai_state", { book })) as Record<string, unknown>[] | null;
      const state = rows?.[0] ?? {};
      return reply({
        ...state,
        // Whether there is anything to fall back on, and what it allows. Said
        // plainly, because somebody about to use somebody else's key should
        // know that is what they are doing.
        sharedKey: SHARED_KEY !== "",
        sharedModel: SHARED_MODEL,
      });
    }

    if (action === "set-key") {
      const key = String(body.key ?? "").trim();
      if (key === "") return reply({ error: "no key given" }, 400);
      let models: Model[];
      try {
        models = await listModels(key);
      } catch (error) {
        // Google's own words, which tell somebody what to do about it.
        return reply({ error: (error as Error).message }, 400);
      }
      if (models.length === 0) {
        return reply({ error: "that key can reach Google but has no models on it" }, 400);
      }
      const model = pick(models, String(body.model ?? ""));
      await asCaller(jwt, "set_ai_key", { book, key, model });
      await asCaller(jwt, "set_ai_model", { book, model, models });
      return reply({ configured: true, model, models });
    }

    if (action === "set-model") {
      await asCaller(jwt, "set_ai_model", { book, model: String(body.model ?? "") });
      return reply({ ok: true });
    }

    if (action === "clear-key") {
      await asCaller(jwt, "clear_ai_key", { book });
      return reply({ configured: false });
    }

    if (action === "suggest") {
      const prompt = String(body.prompt ?? "");
      const asking = Number(body.asking ?? 0);
      if (prompt === "" || !Number.isInteger(asking) || asking < 1) {
        return reply({ error: "nothing to ask about" }, 400);
      }

      const theirs = await keyFor(book);
      const demo = theirs === null;
      if (demo && SHARED_KEY === "") {
        return reply({ error: "no key set for these books" }, 400);
      }

      // Counted first. A cap checked afterwards is one that spends the money
      // and then discovers it was not allowed to.
      //
      // Asked as the caller, not as the service role: the allowance is the
      // person's, and auth.uid() inside the database is the only account of
      // who they are that this function cannot get wrong or be lied to about.
      try {
        await asCaller(jwt, "ai_take", { book, asking, demo });
      } catch (error) {
        return reply({ error: (error as Error).message }, 429);
      }

      const key = theirs?.key ?? SHARED_KEY;
      const model = theirs?.model ?? SHARED_MODEL;
      try {
        const text = await ask(key, model, prompt);
        return reply({ text, demo });
      } catch (error) {
        return reply({ error: (error as Error).message }, 502);
      }
    }

    if (action === "converse") {
      const contents = Array.isArray(body.contents) ? (body.contents as unknown[]) : [];
      const tools = Array.isArray(body.tools) ? (body.tools as unknown[]) : [];
      if (contents.length === 0) return reply({ error: "nothing to say" }, 400);
      // A conversation can run long, and a page that will not stop asking is
      // the way a bill surprises somebody. Bounded here as well as on the
      // page, because the page is the thing that might be wrong.
      if (contents.length > 40) return reply({ error: "that conversation is too long" }, 400);

      const theirs = await keyFor(book);
      const demo = theirs === null;
      if (demo && SHARED_KEY === "") {
        return reply({ error: "no key set for these books" }, 400);
      }

      // One turn counts as one, against the same allowance the coding uses.
      // A review is one question however many guides the model reads, but
      // each turn is a paid call and an allowance that ignored them would
      // not be an allowance.
      try {
        await asCaller(jwt, "ai_take", { book, asking: 1, demo });
      } catch (error) {
        return reply({ error: (error as Error).message }, 429);
      }

      try {
        const turn = await talk(
          theirs?.key ?? SHARED_KEY,
          theirs?.model ?? SHARED_MODEL,
          contents,
          tools,
        );
        return reply({ ...turn, demo });
      } catch (error) {
        return reply({ error: (error as Error).message }, 502);
      }
    }

    return reply({ error: "no such action" }, 400);
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500;
    return reply({ error: (error as Error).message }, status === 403 ? 403 : 500);
  }
});
