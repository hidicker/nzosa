import { callFunction } from "./cloud.js";
import { backendKind, openCloudBookId } from "./store.js";
import type { AkahuAccount, AkahuTransaction } from "@nzosa/core";

/**
 * Where a bank feed's questions go.
 *
 * Two places can hold a connection, and neither of them is the browser: the
 * local server keeps the tokens in a file beside the ledgers, and the hosted
 * copy keeps them in a vault only its edge function can open. The page asks
 * the same questions either way and never holds a token in either case, which
 * is the property worth keeping as this grew a second home.
 *
 * The shapes are the local server's, because they were first and because the
 * Import page is written against them. The hosted function answers in the same
 * shapes deliberately.
 */

export interface FeedStatus {
  configured: boolean;
  /** Masked. Enough to recognise the app, never enough to use it. */
  appToken: string;
  accounts: Record<string, string>;
  autoFetch: boolean;
  lastFetch: string;
  balances: { at: string; balances: Record<string, number> }[];
}

/** Whether these books can have a feed at all. */
export function feedPossible(): boolean {
  return backendKind() === "folder" || (backendKind() === "cloud" && openCloudBookId() !== "");
}

/** Whether the connection would live on the server rather than on this machine. */
export function feedIsHosted(): boolean {
  return backendKind() === "cloud";
}

async function here<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/feed${path}`, init);
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(body.error ?? `the app said ${response.status}`);
  return body as T;
}

async function there<T>(action: string, args: Record<string, unknown> = {}): Promise<T> {
  return callFunction<T>("akahu", { action, book: openCloudBookId(), ...args });
}

const asJson = (body: unknown): RequestInit => ({
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export async function feedStatus(): Promise<FeedStatus | null> {
  try {
    return feedIsHosted() ? await there<FeedStatus>("status") : await here<FeedStatus>("");
  } catch {
    // A feed that cannot be asked about is not a feed that is disconnected,
    // and the page says so rather than showing an empty form.
    return null;
  }
}

export async function feedConnect(appToken: string, userToken: string): Promise<void> {
  if (feedIsHosted()) {
    await there("connect", { appToken, userToken });
    return;
  }
  await here("", asJson({ appToken, userToken }));
}

export async function feedDisconnect(): Promise<void> {
  if (feedIsHosted()) {
    await there("disconnect");
    return;
  }
  await here("", { method: "DELETE" });
}

export async function feedAutoFetch(autoFetch: boolean): Promise<void> {
  if (feedIsHosted()) {
    await there("settings", { autoFetch });
    return;
  }
  await here("/settings", asJson({ autoFetch }));
}

export async function feedAccounts(): Promise<AkahuAccount[]> {
  const answer = feedIsHosted()
    ? await there<{ accounts?: AkahuAccount[] }>("accounts")
    : await here<{ accounts?: AkahuAccount[] }>("/accounts");
  return answer.accounts ?? [];
}

export async function feedMapping(accounts: Record<string, string>): Promise<void> {
  if (feedIsHosted()) {
    await there("mapping", { accounts });
    return;
  }
  await here("/accounts", asJson({ accounts }));
}

/**
 * Everything since a date.
 *
 * Both sides page through Akahu themselves and answer once, so this is one
 * question rather than a conversation the page has to manage -- and a busy
 * account cannot come back short in a way that looks like a quiet month.
 */
export async function feedTransactions(start: string): Promise<AkahuTransaction[]> {
  if (feedIsHosted()) {
    const answer = await there<{ items?: AkahuTransaction[] }>("transactions", { start });
    return answer.items ?? [];
  }
  const search = start === "" ? "" : `?start=${encodeURIComponent(start)}`;
  const answer = await here<{ items?: AkahuTransaction[] }>(`/transactions${search}`);
  return answer.items ?? [];
}
