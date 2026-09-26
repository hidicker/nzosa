/**
 * Asking a model on somebody's own key, whichever company the key is from.
 *
 * Four: Google (Gemini), Anthropic (Claude), OpenAI (ChatGPT) and OpenRouter,
 * which fronts most of the rest behind one key. The provider is read from the
 * key itself -- every one of them starts its keys differently -- so nobody is
 * asked to choose from a list they may not understand.
 *
 * This file imports nothing, on purpose. Three places ask a model on a
 * person's own key: the app on their computer, the Supabase function behind
 * books on the server, and the online demo's page. The first and last use this
 * directly; the function runs in Deno, which cannot reach this package, and
 * uses a copy at supabase/functions/_shared/ai-providers.ts. A test fails if
 * the two ever differ, so there is one of these in practice, not three.
 *
 * No model names are fixed here beyond Gemini's short preference list. Each
 * key is asked what it may use, and the cheap fast model is chosen from what
 * it says -- names like "haiku", "mini" and "flash" -- because any list written
 * today is a generation out of date within the year.
 */

export type AiProvider = "gemini" | "anthropic" | "openai" | "openrouter" | "jev";

export const PROVIDER_NAMES: Record<AiProvider, string> = {
  gemini: "Google Gemini",
  anthropic: "Anthropic Claude",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  jev: "Jev (TypeSafe AI)",
};

/** Where Jev answers, and the model it answers with unless told otherwise. */
export const JEV_DECIDE_URL = "https://jevtypesafeai.com/api/v1/decide";
export const JEV_MODEL = "jev-latest";

/**
 * Which company a key is from, by how it starts.
 *
 * Works on the first six characters alone, so a key shown masked as
 * "sk-ant…1234" still says whose it is. Anything unrecognised is taken to be
 * Google's, which is what every key was before the others were offered.
 */
export function detectProvider(key: string): AiProvider {
  const k = key.trim();
  if (k.startsWith("jv_")) return "jev";
  if (k.startsWith("sk-ant")) return "anthropic";
  if (k.startsWith("sk-or-")) return "openrouter";
  if (k.startsWith("sk-")) return "openai";
  return "gemini";
}

export interface ProviderModel {
  name: string;
  label: string;
}

/** How a request is made. Passed in so this runs anywhere, and in tests offline. */
export type AiFetcher = (
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface CallOptions {
  /**
   * The request is made from a web page rather than a server. Anthropic
   * refuses those unless told the caller knows the key is visible to the page
   * -- which, in the demo, it is: it is the visitor's own, in their own tab.
   */
  browser?: boolean;
}

interface ErrorBody {
  error?: { message?: string } | string;
  message?: string;
}

async function readJson(
  response: { ok: boolean; status: number; json: () => Promise<unknown> },
  who: string,
): Promise<Record<string, unknown>> {
  const body = (await response.json().catch(() => null)) as (Record<string, unknown> & ErrorBody) | null;
  if (!response.ok) {
    // The provider's own words where it gave any: "invalid x-api-key" tells
    // somebody what to do, "HTTP 401" does not.
    const said =
      typeof body?.error === "object" && body.error !== null
        ? body.error.message
        : typeof body?.error === "string"
          ? body.error
          : body?.message;
    // A Claude key made for several workspaces must name one on every request.
    // Anthropic's own words for that talk about headers, which mean nothing to
    // somebody pasting a key into a box -- so it is said as what to do instead.
    if (who === "Anthropic" && said !== undefined && /workspace/i.test(said)) {
      throw new Error(
        "This Claude key works across more than one workspace, so Anthropic needs to be told " +
          "which one to use. Make a key for a single workspace instead: in the Claude Console, " +
          "Settings, API keys, Create key, and choose a workspace (Default is fine). Then paste " +
          "that key here.",
      );
    }
    throw new Error(said !== undefined && said !== "" ? said : `${who} answered ${response.status}.`);
  }
  return body ?? {};
}

// --- Google -----------------------------------------------------------------

const GEMINI_NOT_FOR_THIS =
  /image|tts|audio|video|robotics|computer-use|transcribe|lyria|deep-research|antigravity|nano-banana|omni|embedding|aqa/i;
const GEMINI_PREFERRED = ["gemini-3.6-flash", "gemini-flash-latest", "gemini-3.6-pro"];

function geminiOrder(models: ProviderModel[]): ProviderModel[] {
  const rank = (model: ProviderModel): number => {
    const preferred = GEMINI_PREFERRED.indexOf(model.name);
    if (preferred >= 0) return preferred;
    const family = /^gemini/.test(model.name) ? 10 : 1000;
    const version = /latest/.test(model.name)
      ? 99
      : Number((model.name.match(/\d+(\.\d+)?/) ?? ["0"])[0]);
    return family + (100 - version);
  };
  return [...models].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

// --- ordering for the rest ----------------------------------------------------

/** The version number in a model's name, for newest-first; 0 where there is none. */
function versionOf(name: string): number {
  const found = name.match(/(\d+(?:[.-]\d+)?)/);
  return found === null ? 0 : Number(found[1]!.replace("-", "."));
}

/**
 * Cheap and fast first, newest first within that.
 *
 * Coding a bank line is a small job asked many times. The small model of each
 * family does it well and costs a fraction; somebody who wants the big one can
 * choose it, and the page says what the choice costs.
 */
function cheapFirst(models: ProviderModel[], cheap: RegExp): ProviderModel[] {
  return [...models].sort((a, b) => {
    const ca = cheap.test(a.name) ? 0 : 1;
    const cb = cheap.test(b.name) ? 0 : 1;
    if (ca !== cb) return ca - cb;
    const va = versionOf(a.name);
    const vb = versionOf(b.name);
    if (va !== vb) return vb - va;
    // Undated before dated: "claude-haiku-4-5" is the alias of its newest date.
    if (a.name.length !== b.name.length) return a.name.length - b.name.length;
    return a.name.localeCompare(b.name);
  });
}

const OPENAI_NOT_FOR_THIS =
  /audio|realtime|tts|transcribe|whisper|image|dall-e|embedding|moderation|search|instruct|codex|computer-use|deep-research|babbage|davinci/i;

// --- listing: which models a key may use, and whether it works at all -------

/**
 * Every model this key may use for this kind of question, the one to start on
 * first.
 *
 * Also how a key is checked before it is kept: a key that cannot list cannot do
 * anything, and one that can gives names to offer rather than a guess. Except
 * OpenRouter, whose list is public and so proves nothing about the key -- that
 * is checked separately first.
 */
export async function listModels(
  provider: AiProvider,
  key: string,
  fetcher: AiFetcher,
  options: CallOptions = {},
): Promise<ProviderModel[]> {
  if (provider === "jev") {
    // Jev lists no models, so the key is checked by asking it one small
    // yes-or-no question: a fraction of a cent, and proof the key works.
    await readJson(
      await fetcher(JEV_DECIDE_URL, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: JEV_MODEL,
          state: "A key check.",
          questions: { ok: { type: "noul", instructions: "Is this a key check?" } },
        }),
      }),
      "Jev",
    );
    return [{ name: JEV_MODEL, label: "jev-latest" }];
  }

  if (provider === "anthropic") {
    const headers: Record<string, string> = {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    };
    if (options.browser === true) headers["anthropic-dangerous-direct-browser-access"] = "true";
    const body = await readJson(
      await fetcher("https://api.anthropic.com/v1/models?limit=100", { headers }),
      "Anthropic",
    );
    const models = ((body["data"] ?? []) as { id?: string; display_name?: string }[])
      .filter((m) => typeof m.id === "string" && m.id.startsWith("claude-"))
      .map((m) => ({ name: m.id as string, label: m.display_name ?? (m.id as string) }));
    return cheapFirst(models, /haiku/i);
  }

  if (provider === "openai") {
    const body = await readJson(
      await fetcher("https://api.openai.com/v1/models", {
        headers: { authorization: `Bearer ${key}` },
      }),
      "OpenAI",
    );
    const models = ((body["data"] ?? []) as { id?: string }[])
      .map((m) => String(m.id ?? ""))
      .filter((id) => /^(gpt-|o\d|chatgpt-)/i.test(id) && !OPENAI_NOT_FOR_THIS.test(id))
      .map((id) => ({ name: id, label: id }));
    // GPT before the o-series, which reasons at length and costs accordingly.
    const gpt = cheapFirst(models.filter((m) => m.name.startsWith("gpt-")), /mini|nano/i);
    const rest = cheapFirst(models.filter((m) => !m.name.startsWith("gpt-")), /mini/i);
    return [...gpt, ...rest];
  }

  if (provider === "openrouter") {
    // The model list is public, so the key is checked on its own first.
    await readJson(
      await fetcher("https://openrouter.ai/api/v1/key", {
        headers: { authorization: `Bearer ${key}` },
      }),
      "OpenRouter",
    );
    const body = await readJson(
      await fetcher("https://openrouter.ai/api/v1/models", {
        headers: { authorization: `Bearer ${key}` },
      }),
      "OpenRouter",
    );
    const models = (
      (body["data"] ?? []) as {
        id?: string;
        name?: string;
        architecture?: { output_modalities?: string[] };
      }[]
    )
      .filter((m) => typeof m.id === "string")
      .filter((m) => {
        const out = m.architecture?.output_modalities;
        return out === undefined || (out.includes("text") && !out.includes("image"));
      })
      .map((m) => ({ name: m.id as string, label: m.name ?? (m.id as string) }));
    // Hundreds of them. The cheap fast ones of the big families first, and a
    // list somebody can actually scroll.
    return cheapFirst(models, /flash|mini|haiku/i).slice(0, 150);
  }

  const body = await readJson(
    await fetcher("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", {
      headers: { "x-goog-api-key": key },
    }),
    "Google",
  );
  return geminiOrder(
    (
      (body["models"] ?? []) as {
        name?: string;
        displayName?: string;
        supportedGenerationMethods?: string[];
      }[]
    )
      .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
      .map((m) => ({
        name: String(m.name ?? "").replace(/^models\//, ""),
        label: String(m.displayName ?? m.name ?? ""),
      }))
      .filter((m) => m.name !== "" && !GEMINI_NOT_FOR_THIS.test(m.name)),
  );
}

/** The model to use: the one asked for if the key has it, else the first listed. */
export function pickModel(provider: AiProvider, models: ProviderModel[], wanted = ""): string {
  const has = (name: string): boolean => models.some((m) => m.name === name);
  if (wanted !== "" && has(wanted)) return wanted;
  if (provider === "gemini") {
    for (const name of GEMINI_PREFERRED) if (has(name)) return name;
    return models.find((m) => /flash/i.test(m.name))?.name ?? models[0]?.name ?? "";
  }
  return models[0]?.name ?? "";
}

// --- asking -------------------------------------------------------------------

/**
 * Ask, and return what the model wrote.
 *
 * Only Gemini is asked for JSON by setting: the others are asked by the prompt
 * itself, which already says to reply with the array and nothing else, and
 * whatever wraps it -- prose, code fences -- is stripped by the reader of the
 * answer, which checks every line of it against the chart either way.
 *
 * No temperature for OpenAI or Anthropic: their newer models refuse any
 * setting but the default, and a refusal is worse than a little variety.
 */
export async function askModel(
  provider: AiProvider,
  key: string,
  model: string,
  prompt: string,
  fetcher: AiFetcher,
  options: CallOptions = {},
): Promise<string> {
  if (provider === "jev") {
    // Jev answers typed questions about one thing at a time, not a written
    // prompt. It codes lines on Reconcile through its own adapter; anything
    // asked in prose needs one of the others.
    throw new Error(
      "A Jev key answers coding suggestions on Reconcile only. For this, use a Gemini, " +
        "Claude, OpenAI or OpenRouter key.",
    );
  }

  if (provider === "anthropic") {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    };
    if (options.browser === true) headers["anthropic-dangerous-direct-browser-access"] = "true";
    const body = await readJson(
      await fetcher("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          max_tokens: 16000,
          messages: [{ role: "user", content: prompt }],
        }),
      }),
      "Anthropic",
    );
    return ((body["content"] ?? []) as { type?: string; text?: string }[])
      .filter((part) => part.type === "text")
      .map((part) => part.text ?? "")
      .join("");
  }

  if (provider === "openai" || provider === "openrouter") {
    const url =
      provider === "openai"
        ? "https://api.openai.com/v1/chat/completions"
        : "https://openrouter.ai/api/v1/chat/completions";
    const body = await readJson(
      await fetcher(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }] }),
      }),
      PROVIDER_NAMES[provider],
    );
    const choices = (body["choices"] ?? []) as { message?: { content?: string } }[];
    return choices[0]?.message?.content ?? "";
  }

  const body = await readJson(
    await fetcher(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0 },
        }),
      },
    ),
    "Google",
  );
  const candidates = (body["candidates"] ?? []) as { content?: { parts?: { text?: string }[] } }[];
  return (candidates[0]?.content?.parts ?? []).map((part) => part.text ?? "").join("");
}
