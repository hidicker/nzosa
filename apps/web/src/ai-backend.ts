import { callFunction } from "./cloud.js";
import { backendKind, openCloudBookId } from "./store.js";
import { isDemoBuild } from "./ai-consent.js";
import {
  demoClearKey,
  demoSetKey,
  demoSetModel,
  demoStatus,
  demoSuggest,
  sharedPoolStatus,
  sharedPoolSuggest,
} from "./ai-demo.js";

/**
 * Where the asking is done, which depends on where the books are.
 *
 * A folder has a server of its own on this machine: the key sits in a file
 * only this user can read and the question goes out from here. Books on the
 * server have an edge function instead, holding the key in Supabase Vault and
 * checking who is asking against the same policies as everything else.
 *
 * Both answer the same four questions, so neither page has to know which one
 * it is talking to. A copy running in a browser has neither, and says so.
 */

export interface AiModel {
  name: string;
  label: string;
}

export interface AiStatus {
  configured: boolean;
  key: string;
  model: string;
  models: AiModel[];
  usedToday: number;
  limit: number;
  /** The shared key this installation offers, when it offers one. */
  sharedKey?: boolean;
  sharedModel?: string;
  /** Of the shared key's allowance for this person, how much is gone. */
  demoUsed?: number;
  demoLimit?: number;
  /** The most that may be asked in one call on a key of their own. */
  ownBatch?: number;
}

/** One part of a model's turn: something said, or something it wants called. */
export interface AiPart {
  text?: string;
  functionCall?: { name?: string; args?: Record<string, unknown> };
}

export interface AiTurn {
  parts: AiPart[];
  finishReason: string;
  error?: string;
}

export interface AiAnswer {
  text?: string;
  error?: string;
  /** True when the answer came from the shared key rather than one of theirs. */
  demo?: boolean;
}

async function local(path: string, init?: RequestInit): Promise<Response | null> {
  try {
    return await fetch(path, init);
  } catch {
    return null;
  }
}

/**
 * Ask the edge function, through the same door the bank feed uses.
 *
 * It throws where the server refused, and what it throws is the server's own
 * words -- which for a cap is the difference between "no" and "these books
 * have used 500 of the 500 the shared key allows".
 */
async function hosted<T>(
  action: string,
  extra: Record<string, unknown> = {},
): Promise<{ ok: true; body: T } | { ok: false; error: string }> {
  const book = openCloudBookId();
  if (book === "") return { ok: false, error: "no books open" };
  try {
    return { ok: true, body: await callFunction<T>("gemini", { action, book, ...extra }) };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

/** Whether this copy can ask at all, and by which route. */
export function aiRoute(): "folder" | "cloud" | "demo" | "none" {
  const kind = backendKind();
  if (kind === "folder") return "folder";
  if (kind === "cloud" && openCloudBookId() !== "") return "cloud";
  // The online demo has neither a folder nor books on the server, but it has
  // its own way: a visitor's key asked from the page, or the demo's shared
  // allowance. See ai-demo.ts.
  if (isDemoBuild()) return "demo";
  return "none";
}

export async function aiStatus(): Promise<AiStatus | null> {
  if (aiRoute() === "demo") return demoStatus();
  if (aiRoute() === "folder") {
    const response = await local("/api/ai");
    if (response === null || !response.ok) return null;
    const own = (await response.json().catch(() => null)) as AiStatus | null;
    if (own === null || own.configured) return own;
    // No key on these books: offer the shared pool, if it can be reached.
    // A copy downloaded and run anywhere gets this, not only this site's
    // owner, which is why the page says whose key it is.
    const pool = await sharedPoolStatus();
    if (pool === null) return own;
    return { ...own, sharedKey: true, sharedModel: pool.model, demoUsed: 0, demoLimit: pool.left };
  }
  if (aiRoute() !== "cloud") return null;

  const answer = await hosted<Record<string, unknown>>("state");
  if (!answer.ok) return null;
  const said = answer.body;
  return {
    configured: said["configured"] === true,
    key: String(said["key"] ?? ""),
    model: String(said["model"] ?? ""),
    models: (said["models"] as AiModel[] | undefined) ?? [],
    usedToday: Number(said["used_today"] ?? 0),
    // The shared key's allowance is the person's, for good, rather than a
    // daily one: a trial is a trial and not something that refills.
    limit: Number(said["per_person"] ?? 0),
    sharedKey: said["sharedKey"] === true,
    sharedModel: String(said["sharedModel"] ?? ""),
    demoUsed: Number(said["demo_used"] ?? 0),
    demoLimit: Number(said["per_person"] ?? 0),
    ownBatch: Number(said["own_batch"] ?? 0),
  };
}

export async function aiSetKey(key: string): Promise<{ ok: boolean; error: string }> {
  if (aiRoute() === "demo") return demoSetKey(key);
  if (aiRoute() === "cloud") {
    const answer = await hosted("set-key", { key });
    return answer.ok ? { ok: true, error: "" } : { ok: false, error: answer.error };
  }
  const response = await local("/api/ai", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key }),
  });
  if (response === null) return { ok: false, error: "Could not reach the app." };
  const said = (await response.json().catch(() => ({}))) as { error?: string };
  return response.ok ? { ok: true, error: "" } : { ok: false, error: said.error ?? "Not accepted." };
}

export async function aiSetModel(model: string): Promise<void> {
  if (aiRoute() === "demo") {
    demoSetModel(model);
    return;
  }
  if (aiRoute() === "folder") {
    await local("/api/ai", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model }),
    });
    return;
  }
  await hosted("set-model", { model });
}

export async function aiClearKey(): Promise<void> {
  if (aiRoute() === "demo") {
    demoClearKey();
    return;
  }
  if (aiRoute() === "folder") {
    await local("/api/ai", { method: "DELETE" });
    return;
  }
  await hosted("clear-key");
}

/**
 * One turn of a conversation the model may use tools in.
 *
 * The loop is not here and not on either server: it is on the page. The tools
 * belong to an MCP server out on the web, the page can reach it directly, and
 * the only thing that has to stay behind a server is the key. Keeping the
 * conversation on the page also means the same loop serves books in a folder
 * and books on the server, rather than one written twice in two languages.
 */
export async function aiConverse(
  contents: readonly unknown[],
  tools: readonly unknown[],
): Promise<AiTurn> {
  const empty = { parts: [] as AiPart[], finishReason: "" };
  if (aiRoute() === "demo") return { ...empty, error: "Not offered in the demo." };
  if (aiRoute() === "cloud") {
    const answer = await hosted<AiTurn>("converse", { contents, tools });
    return answer.ok ? answer.body : { ...empty, error: answer.error };
  }
  const response = await local("/api/ai/converse", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents, tools }),
  });
  if (response === null) return { ...empty, error: "Could not reach the app." };
  const said = (await response.json().catch(() => ({}))) as AiTurn;
  if (!response.ok) {
    return { ...empty, error: said.error ?? "The model would not answer." };
  }
  return { parts: said.parts ?? [], finishReason: said.finishReason ?? "" };
}

export async function aiSuggest(prompt: string, asking: number): Promise<AiAnswer> {
  if (aiRoute() === "demo") return demoSuggest(prompt, asking);
  if (aiRoute() === "folder") {
    // Asked of this computer's app first, which knows whether these books
    // have a key. Without one, the shared pool -- never a guess at the error.
    const response = await local("/api/ai");
    const own = response !== null && response.ok
      ? ((await response.json().catch(() => null)) as AiStatus | null)
      : null;
    if (own !== null && !own.configured) return sharedPoolSuggest(prompt, asking);
  }
  if (aiRoute() === "cloud") {
    const answer = await hosted<AiAnswer>("suggest", { prompt, asking });
    return answer.ok ? answer.body : { error: answer.error };
  }
  const response = await local("/api/ai/suggest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt, asking }),
  });
  if (response === null) return { error: "Could not reach the app." };
  const said = (await response.json().catch(() => ({}))) as AiAnswer;
  if (!response.ok) return { error: said.error ?? "The model would not answer." };
  return said;
}
