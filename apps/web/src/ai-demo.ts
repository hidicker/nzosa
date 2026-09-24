import { CLOUD } from "./cloud-config.js";
import type { AiAnswer, AiModel, AiStatus } from "./ai-backend.js";
import { askModel, detectProvider, listModels, pickModel } from "@nzosa/core";
import type { AiFetcher } from "@nzosa/core";

const byFetch: AiFetcher = (url, init) => fetch(url, init);

/**
 * AI suggestions in the online demo, which has no server of its own.
 *
 * Two ways, as everywhere else. A key of the visitor's own, asked straight
 * from this page -- it never reaches the site's server. Or the site's shared
 * key, through the gemini-demo function, drawing on one allowance every demo
 * visitor shares and that the site owner resets by hand.
 *
 * The visitor's key is kept in this tab's session storage and nowhere else.
 * Not local storage: this page shares an origin with the rest of
 * nbparagliding.nz, which loads other people's scripts -- a chat widget and
 * Google's tag were both found in that origin's storage -- and anything in
 * local storage would be theirs to read. Session storage belongs to the tab,
 * and goes when the tab does. The cost is typing it again in a new tab, which
 * is the right trade for somebody's paid key.
 */

const STORE = "nzosa:demo-ai-key";
const FUNCTION = `${CLOUD.url}/functions/v1/gemini-demo`;

interface Kept {
  key: string;
  model: string;
  models: AiModel[];
}

function kept(): Kept | null {
  try {
    const raw = sessionStorage.getItem(STORE);
    return raw === null ? null : (JSON.parse(raw) as Kept);
  } catch {
    return null;
  }
}

function keep(value: Kept | null): void {
  try {
    if (value === null) sessionStorage.removeItem(STORE);
    else sessionStorage.setItem(STORE, JSON.stringify(value));
  } catch {
    // Storage refused. The key simply is not kept, and the page says so by
    // showing none set -- better than pretending it was.
  }
}

// --- the shared pool --------------------------------------------------------

async function shared<T>(body: Record<string, unknown>): Promise<T & { error?: string }> {
  try {
    const response = await fetch(FUNCTION, {
      method: "POST",
      headers: { apikey: CLOUD.publishableKey, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await response.json().catch(() => ({ error: `the server said ${response.status}` }))) as T & {
      error?: string;
    };
  } catch {
    return { error: "Could not reach the demo's shared key." } as T & { error?: string };
  }
}

/**
 * The shared pool, for any copy with no key of its own.
 *
 * The demo uses it, and so does a copy of NZOSA downloaded and run on
 * somebody's own computer whose books have no key: one allowance for all of
 * them together, reset by the site owner. Nothing here knows or asks who is
 * calling -- the pool is what bounds it.
 */
export async function sharedPoolStatus(): Promise<{ left: number; model: string } | null> {
  const pool = await shared<{ left?: number; model?: string }>({ action: "state" });
  if (pool.error !== undefined || typeof pool.left !== "number") return null;
  return { left: pool.left, model: pool.model ?? "" };
}

export async function sharedPoolSuggest(prompt: string, asking: number): Promise<AiAnswer> {
  const said = await shared<{ text?: string }>({ action: "suggest", prompt, asking });
  return said.error !== undefined ? { error: said.error } : { text: said.text ?? "", demo: true };
}

// --- the four questions every route answers --------------------------------

export async function demoStatus(): Promise<AiStatus> {
  const own = kept();
  const pool = await sharedPoolStatus();
  const left = pool?.left ?? 0;
  return {
    configured: own !== null,
    key: own === null ? "" : `${own.key.slice(0, 6)}…${own.key.slice(-4)}`,
    model: own?.model ?? "",
    models: own?.models ?? [],
    usedToday: 0,
    limit: 0,
    sharedKey: pool !== null,
    sharedModel: pool?.model ?? "",
    // The pool only reports what is left, so that is what is passed on. The
    // allowance itself is whatever the site owner set, and naming a figure
    // here would be naming one they may since have changed.
    demoUsed: 0,
    demoLimit: left,
    ownBatch: 100,
  };
}

export async function demoSetKey(key: string): Promise<{ ok: boolean; error: string }> {
  try {
    // Checked before it is kept, by listing what it may use: a mistyped key
    // is said to be wrong now rather than the first time somebody presses.
    // From this page, so Anthropic is told the key is the visitor's own and
    // visible here -- which, in their own tab, it is.
    const provider = detectProvider(key);
    const models = await listModels(provider, key, byFetch, { browser: true });
    if (models.length === 0) return { ok: false, error: "That key works but has no models this can use." };
    keep({ key, model: pickModel(provider, models, ""), models });
    return { ok: true, error: "" };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

export function demoSetModel(model: string): void {
  const own = kept();
  if (own === null || !own.models.some((one) => one.name === model)) return;
  keep({ ...own, model });
}

export function demoClearKey(): void {
  keep(null);
}

export async function demoSuggest(prompt: string, asking: number): Promise<AiAnswer> {
  const own = kept();
  if (own === null) return sharedPoolSuggest(prompt, asking);
  try {
    return {
      text: await askModel(detectProvider(own.key), own.key, own.model, prompt, byFetch, {
        browser: true,
      }),
    };
  } catch (error) {
    return { error: (error as Error).message };
  }
}
