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
  // allowance. See ai-demo.ts. Books kept in the browser on the hosted site
  // are in the same position and go the same way -- without it they had no
  // AI at all, not even the shared allowance a downloaded copy is offered.
  if (isDemoBuild() || kind === "browser") return "demo";
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
  if (aiRoute() === "demo") {
    return {
      ...empty,
      error: isDemoBuild() ? "Not offered in the demo." : "Not offered for books kept in this browser.",
    };
  }
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

/**
 * The lines themselves, for a provider that is asked about each one rather
 * than given the prompt (Jev). The same fields the prompt describes.
 */
export interface AskedLines {
  lines: readonly unknown[];
  codes: readonly string[];
  about: string;
}

/**
 * A document read with these books' own key, on this computer only.
 *
 * Not through the shared allowance and not from hosted books yet: a whole tax
 * return is somebody's own to send, under their own key. Where that is not
 * the route, null -- and the page offers the prompt to carry instead.
 */
export async function aiReadDocument(prompt: string, file: File): Promise<AiAnswer | null> {
  if (aiRoute() !== "folder") return null;
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  const response = await local("/api/ai/document", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt, pdf: btoa(binary), filename: file.name }),
  });
  if (response === null) return { error: "Could not reach the app." };
  const said = (await response.json().catch(() => ({}))) as AiAnswer;
  if (!response.ok) return { error: said.error ?? "The model would not answer." };
  return said;
}

/**
 * A question asked in full, with these books' own key.
 *
 * For reading a spreadsheet: never through the shared allowance. On this
 * computer through the app, and for books online through their function.
 * Null where it cannot be asked -- books kept in a browser -- so the page
 * offers the prompt to copy instead.
 */
export async function aiAsk(prompt: string): Promise<AiAnswer | null> {
  if (aiRoute() === "cloud") {
    const answer = await hosted<AiAnswer>("ask", { prompt });
    return answer.ok ? answer.body : { error: answer.error };
  }
  if (aiRoute() !== "folder") return null;
  const response = await local("/api/ai/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  if (response === null) return { error: "Could not reach the app." };
  const said = (await response.json().catch(() => ({}))) as AiAnswer;
  if (!response.ok) return { error: said.error ?? "The model would not answer." };
  return said;
}

export async function aiSuggest(prompt: string, asking: number, asked?: AskedLines): Promise<AiAnswer> {
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
    body: JSON.stringify({ prompt, asking, ...(asked ?? {}) }),
  });
  if (response === null) return { error: "Could not reach the app." };
  const said = (await response.json().catch(() => ({}))) as AiAnswer;
  if (!response.ok) return { error: said.error ?? "The model would not answer." };
  return said;
}
