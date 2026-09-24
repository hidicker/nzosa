import { CLOUD } from "./cloud-config.js";
import type { AiAnswer, AiModel, AiStatus } from "./ai-backend.js";

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

// --- the models a key may use, as the server functions work them out -------

const NOT_FOR_THIS =
  /image|tts|audio|video|robotics|computer-use|transcribe|lyria|deep-research|antigravity|nano-banana|omni|embedding|aqa/i;
const PREFERRED = ["gemini-3.6-flash", "gemini-flash-latest", "gemini-3.6-pro"];

function order(models: AiModel[]): AiModel[] {
  const rank = (model: AiModel): number => {
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

function pick(models: AiModel[], wanted: string): string {
  const has = (name: string): boolean => models.some((model) => model.name === name);
  if (wanted !== "" && has(wanted)) return wanted;
  for (const name of PREFERRED) if (has(name)) return name;
  return models.find((model) => /flash/i.test(model.name))?.name ?? models[0]?.name ?? "";
}

async function listModels(key: string): Promise<AiModel[]> {
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

// --- the four questions every route answers --------------------------------

export async function demoStatus(): Promise<AiStatus> {
  const own = kept();
  const pool = await shared<{ left?: number; model?: string }>({ action: "state" });
  const left = typeof pool.left === "number" ? pool.left : 0;
  return {
    configured: own !== null,
    key: own === null ? "" : `${own.key.slice(0, 6)}…${own.key.slice(-4)}`,
    model: own?.model ?? "",
    models: own?.models ?? [],
    usedToday: 0,
    limit: 0,
    sharedKey: pool.error === undefined,
    sharedModel: pool.model ?? "",
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
    const models = await listModels(key);
    if (models.length === 0) return { ok: false, error: "That key can reach Google but has no models on it." };
    keep({ key, model: pick(models, ""), models });
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
  if (own === null) {
    const said = await shared<{ text?: string }>({ action: "suggest", prompt, asking });
    return said.error !== undefined ? { error: said.error } : { text: said.text ?? "", demo: true };
  }
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(own.model)}:generateContent`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": own.key },
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
    if (!response.ok) return { error: body?.error?.message ?? `Google said ${response.status}` };
    return { text: (body?.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? "").join("") };
  } catch {
    return { error: "Could not reach Google from this page." };
  }
}
