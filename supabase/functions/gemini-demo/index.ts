/**
 * AI suggestions for the online demo, on the site's shared key.
 *
 * Separate from `gemini` on purpose. That one serves books kept on the server
 * and checks, through the caller's own token, that they may touch them. The
 * demo has neither books on the server nor anybody signed in, so it cannot
 * pass those checks -- and loosening them for the demo would loosen them for
 * everybody. So this is its own function, deployed without the gateway's
 * sign-in check, doing two things and nothing else:
 *
 *   state    how much of the demo's allowance is left
 *   suggest  ask the shared model, having first taken the lines from the pool
 *
 * It never reads a key kept with anybody's books. It only knows the shared one.
 *
 * Anybody can call it; the demo page is public and so is its key. What bounds
 * that is the pool: one allowance for every visitor together, in the database,
 * which only the service role can take from and only somebody with access to
 * the project can reset. Taken before Google is asked, so a refusal costs
 * nothing.
 *
 * The pool counts lines as the page declares them, so the prompt itself has a
 * ceiling too. Without one, "1 line" and a prompt the size of a novel would
 * make the shared key a free general-purpose model. A real twenty-line prompt
 * is a small fraction of it.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SHARED_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const SHARED_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.6-flash";

/** The most one request may carry, in characters of prompt. */
const MOST_PROMPT = 30000;
/** The most lines in one request, as for the shared key everywhere else. */
const MOST_LINES = 20;

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
    // The database's own words, which for the cap say what to do next.
    const said = (await response.json().catch(() => null)) as { message?: string } | null;
    throw Object.assign(new Error(said?.message ?? `database said ${response.status}`), {
      status: response.status,
    });
  }
  return await response.json().catch(() => null);
}

async function ask(prompt: string): Promise<string> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(SHARED_MODEL)}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": SHARED_KEY },
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

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (request.method !== "POST") return reply({ error: "POST only" }, 405);
  if (SHARED_KEY === "") return reply({ error: "this site offers no shared key" }, 503);

  let body: { action?: string; prompt?: unknown; asking?: unknown };
  try {
    body = await request.json();
  } catch {
    return reply({ error: "expected JSON" }, 400);
  }

  try {
    if (body.action === "state") {
      const left = Number(await asService("ai_demo_left", {}));
      return reply({ left, model: SHARED_MODEL });
    }

    if (body.action === "suggest") {
      const prompt = typeof body.prompt === "string" ? body.prompt : "";
      const asking = Number(body.asking);
      if (prompt === "" || !Number.isInteger(asking) || asking < 1 || asking > MOST_LINES) {
        return reply({ error: `ask about between 1 and ${MOST_LINES} lines at a time` }, 400);
      }
      if (prompt.length > MOST_PROMPT) {
        return reply({ error: "that is more than the demo will send in one go" }, 413);
      }
      let left: number;
      try {
        left = Number(await asService("ai_demo_take", { asking }));
      } catch (error) {
        return reply({ error: (error as Error).message }, 429);
      }
      try {
        const text = await ask(prompt);
        return reply({ text, demo: true, left });
      } catch (error) {
        // Counted anyway: the lines were taken before asking, and a failure at
        // Google is rare enough that refunding them is not worth a second
        // route into the pool.
        return reply({ error: (error as Error).message, left }, 502);
      }
    }

    return reply({ error: "no such action" }, 400);
  } catch (error) {
    return reply({ error: (error as Error).message }, 500);
  }
});
