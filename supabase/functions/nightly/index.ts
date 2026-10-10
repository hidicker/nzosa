/**
 * Ready every morning, for books on the server.
 *
 * Started by pg_cron each morning (supabase/migrations/*_nightly_cron.sql),
 * with a key of its own that only the database's vault and this function hold.
 * It looks for the sets of books with "Ready every morning" turned on and, for
 * each one in a call of its own: checks the bank feed, suggests codes from the
 * list of known businesses, then asks the AI about up to 100 waiting lines on
 * the books' own key -- never the shared one.
 *
 * It puts nothing into the books. The bank's new lines and the suggestions go
 * in the books' 'nightly' part, and come in when somebody next opens them,
 * through the page's own import. The run itself is the page's code, bundled
 * into run.js by tools/build-nightly-function.mjs, so the morning and the page
 * agree about every line.
 *
 * Deploy with --no-verify-jwt: pg_cron has no user to sign in as. The key in
 * the x-nightly-key header is the check instead.
 */
import { askModel, detectProvider, type AiFetcher } from "../_shared/ai-providers.ts";
import { allTransactions, balancesNow, type FeedSecrets } from "../_shared/akahu.ts";
import { morningRun } from "./run.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const NIGHTLY_KEY = Deno.env.get("NIGHTLY_KEY") ?? "";
const MAX_LINES = 100;

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const service = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, "content-type": "application/json" };

async function rpc<T>(fn: string, args: unknown): Promise<T> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: service,
    body: JSON.stringify(args),
  });
  if (!response.ok) throw new Error(`${fn}: database said ${response.status}`);
  // A function that returns nothing (feed_record_fetch) answers with no body
  // at all: read as JSON, that threw, and every morning stopped there, before
  // its result was written.
  const text = await response.text();
  return (text === "" ? null : JSON.parse(text)) as T;
}

async function partsOf(book: string): Promise<Record<string, { version: number; data: unknown }>> {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/book_parts?book_id=eq.${encodeURIComponent(book)}&select=part,version,data`,
    { headers: service },
  );
  if (!response.ok) throw new Error(`reading the books: database said ${response.status}`);
  const rows = (await response.json()) as { part: string; version: number; data: unknown }[];
  return Object.fromEntries(rows.map((row) => [row.part, { version: row.version, data: row.data }]));
}

const byFetch: AiFetcher = (url, init) => fetch(url, init);

interface LogEntry {
  at: string;
  added: number;
  suggested: number;
  said: string;
  failed?: string;
}

/** How many runs the log keeps, as the page's MORNING_LOG_LENGTH. */
const LOG_LENGTH = 30;

interface Morning {
  log?: LogEntry[];
  inbox?: { at: string; items: { _id?: string }[] };
  suggestions?: { at: string; list: unknown[] };
  unsure?: { signature: string; ids: Record<string, string> };
}

async function runBook(book: string): Promise<string> {
  const parts = await partsOf(book);
  const decisions = (parts["decisions"]?.data ?? {}) as Record<string, unknown>;
  if (decisions["nightly"] !== true) return "not turned on";

  const feed = (await rpc<FeedSecrets[]>("feed_secrets", { book }))[0] ?? null;
  const key = (await rpc<{ key: string; model: string }[]>("ai_key_for", { book }))[0] ?? null;
  const morning = (parts["nightly"]?.data ?? {}) as Morning;
  // A Jev key is asked line by line through its own route, which the morning
  // run does not have yet; it says so rather than sending a prompt Jev ignores.
  const ownKey = key !== null && decisions["aiEnabled"] === true && detectProvider(key.key) !== "jev";

  const result = await morningRun({
    parts,
    kept: (morning.suggestions?.list ?? []) as never,
    maxLines: MAX_LINES,
    ...(morning.unsure !== undefined ? { unsure: morning.unsure } : {}),
    ...(feed !== null && feed.settings?.autoFetch !== false
      ? { feed: { links: feed.accounts ?? {}, fetch: (from: string) => allTransactions(feed, from, "") } }
      : {}),
    ...(ownKey
      ? {
          ask: async (prompt: string) => {
            try {
              return { text: await askModel(detectProvider(key!.key), key!.key, key!.model, prompt, byFetch) };
            } catch (error) {
              return { error: (error as Error).message };
            }
          },
        }
      : {}),
  });
  // The balances as they stand, as the feed's own fetch keeps them: the
  // history the bank will not give is built a fetch at a time.
  if (feed !== null && feed.settings?.autoFetch !== false) {
    await rpc("feed_record_fetch", { book, seen: await balancesNow(feed) });
  }

  // Anything still waiting from a morning nobody opened the books after stays,
  // once, by the bank's own id.
  const fresh = result.items as { _id?: string }[];
  const seen = new Set(fresh.map((item) => item._id));
  // Not what the books have taken in since, or the inbox of a morning nobody opened
  // the books after would carry every old line forward and grow.
  const inBooks = new Set(
    ((parts["transactions"]?.data ?? []) as { extras?: { akahuId?: string } }[]).map((t) => t.extras?.akahuId).filter(Boolean),
  );
  const items = [...(morning.inbox?.items ?? []).filter((item) => !seen.has(item._id) && !inBooks.has(item._id as string)), ...fresh];
  const at = new Date().toISOString();
  const said = result.said + (ownKey ? "" : key !== null && detectProvider(key.key) === "jev"
    ? "; a Jev key is not asked in the morning yet"
    : "; no key of the books' own, or AI is off for them");
  const ran = { at, added: result.added, suggested: result.suggestions.length, said };
  await rpc("nightly_put", {
    book,
    value: {
      ...(items.length > 0 ? { inbox: { at, items } } : {}),
      suggestions: { at, list: result.suggestions },
      unsure: result.unsure,
      ran,
      log: [ran, ...(morning.log ?? [])].slice(0, LOG_LENGTH),
    },
  });
  return said;
}

/**
 * Note a run that stopped, beside the books, keeping everything else as it
 * was: without it, a run broken for days left nothing behind to see. Best
 * effort; the error is in the function's own log either way.
 */
async function logFailure(book: string, message: string): Promise<void> {
  try {
    const parts = await partsOf(book);
    const morning = (parts["nightly"]?.data ?? {}) as Morning;
    const entry: LogEntry = { at: new Date().toISOString(), added: 0, suggested: 0, said: "", failed: message };
    await rpc("nightly_put", { book, value: { ...morning, log: [entry, ...(morning.log ?? [])].slice(0, LOG_LENGTH) } });
  } catch (error) {
    console.error(`morning run for ${book}: could not note the failure:`, (error as Error).message);
  }
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return reply({ error: "POST only" }, 405);
  if (NIGHTLY_KEY === "" || request.headers.get("x-nightly-key") !== NIGHTLY_KEY) {
    return reply({ error: "not the morning run" }, 403);
  }
  const body = (await request.json().catch(() => ({}))) as { book?: string };

  // One set of books: do it, and say what happened.
  if (typeof body.book === "string" && body.book !== "") {
    try {
      return reply({ book: body.book, said: await runBook(body.book) });
    } catch (error) {
      console.error(`morning run for ${body.book}:`, (error as Error).message);
      await logFailure(body.book, (error as Error).message);
      return reply({ book: body.book, error: (error as Error).message }, 500);
    }
  }

  // The morning itself: each set of books in a call of its own, so one slow
  // bank or one long AI answer cannot run another set out of time.
  const books = await rpc<{ book_id: string }[]>("nightly_books", {});
  const self = `${SUPABASE_URL}/functions/v1/nightly`;
  const calls = Promise.allSettled(
    books.map((one) =>
      fetch(self, {
        method: "POST",
        headers: { "content-type": "application/json", "x-nightly-key": NIGHTLY_KEY },
        body: JSON.stringify({ book: one.book_id }),
      }).then(async (response) => console.log(await response.text())),
    ),
  );
  // @ts-ignore EdgeRuntime is Supabase's: keep working after the reply.
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(calls);
  else await calls;
  return reply({ started: books.length });
});
