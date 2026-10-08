/**
 * Akahu, as both functions that talk to it need it: the bank feed (akahu/)
 * and the morning run (nightly/). One copy, so the two cannot drift -- a feed
 * paged differently in the morning would come back short in a way that looks
 * like a quiet month.
 */

export interface FeedSecrets {
  app_token: string;
  user_token: string;
  accounts: Record<string, string>;
  settings: { autoFetch?: boolean };
  balances: Snapshot[];
  last_fetch: string | null;
}

/** A card charge the bank has authorised but not yet settled, in cents. */
export interface PendingItem {
  id?: string;
  account: string;
  date: string;
  description: string;
  amount: number;
  type?: string;
  updatedAt?: string;
}

/** The balances at one fetch. Only the latest carries the pending list. */
export interface Snapshot {
  at: string;
  balances: Record<string, number>;
  rawBalances?: Record<string, number>;
  pendingAmounts?: Record<string, number>;
  pending?: PendingItem[];
}

export interface AkahuReply {
  items?: unknown[];
  cursor?: { next?: string };
  message?: string;
}

/**
 * Ask Akahu something, as the person whose tokens these are.
 *
 * Both tokens go on every request: the app token says which app is asking, the
 * user token says whose data it may see.
 */
export async function akahu(feed: FeedSecrets, path: string, search = ""): Promise<AkahuReply> {
  const response = await fetch(`https://api.akahu.io/v1${path}${search}`, {
    headers: {
      authorization: `Bearer ${feed.user_token}`,
      "X-Akahu-Id": feed.app_token,
    },
  });
  const body = (await response.json().catch(() => ({}))) as AkahuReply;
  if (!response.ok) throw new Error(body.message ?? `Akahu said ${response.status}`);
  return body;
}

/**
 * Everything in the window, not the first page of it.
 *
 * Akahu answers a page at a time and says where the next one starts. Paged
 * through here rather than in the browser, so a fetch is one answer rather
 * than a conversation the page has to manage -- and so a busy account does not
 * quietly come back short, which looks exactly like a month with fewer
 * transactions in it.
 */
export async function allTransactions(feed: FeedSecrets, start: string, end: string): Promise<unknown[]> {
  const items: unknown[] = [];
  let cursor = "";
  for (let page = 0; page < 200; page += 1) {
    const search = new URLSearchParams();
    if (start !== "") search.set("start", start);
    if (end !== "") search.set("end", end);
    if (cursor !== "") search.set("cursor", cursor);
    const body = await akahu(feed, "/transactions", `?${search.toString()}`);
    items.push(...(body.items ?? []));
    cursor = body.cursor?.next ?? "";
    if (cursor === "") break;
  }
  return items;
}

/**
 * The balances as they stand, kept with the date.
 *
 * Akahu gives the balance now and no history, and one figure proves nothing:
 * two of them do. How far a balance moved between one fetch and the next has to
 * equal what the transactions in that window come to. So the history the bank
 * will not give is built here, a fetch at a time, for one extra call.
 */
export async function balancesNow(
  feed: FeedSecrets,
): Promise<Snapshot[]> {
  try {
    const [now, pendingRes] = await Promise.all([
      akahu(feed, "/accounts"),
      akahu(feed, "/transactions/pending").catch(() => ({ items: [] })),
    ]);

    const pendingByAccount: Record<string, number> = {};
    const pending: PendingItem[] = [];
    for (const item of (pendingRes.items ?? []) as {
      _id?: string;
      _account?: string;
      date?: string;
      description?: string;
      amount?: number;
      type?: string;
      updated_at?: string;
    }[]) {
      if (!item._account) continue;
      const cents = Math.round((item.amount ?? 0) * 100);
      pendingByAccount[item._account] = (pendingByAccount[item._account] ?? 0) + cents;
      // The same shape the app's own server keeps, so the page reads either.
      pending.push({
        ...(item._id ? { id: item._id } : {}),
        account: item._account,
        date: item.date ?? "",
        description: item.description ?? "",
        amount: cents,
        ...(item.type ? { type: item.type } : {}),
        ...(item.updated_at ? { updatedAt: item.updated_at } : {}),
      });
    }

    const taken: Record<string, number> = {};
    const raw: Record<string, number> = {};
    for (const account of (now.items ?? []) as {
      _id?: string;
      balance?: { current?: number };
    }[]) {
      if (account._id !== undefined && account.balance?.current !== undefined) {
        const rawCents = Math.round(account.balance.current * 100);
        raw[account._id] = rawCents;
        const pendingCents = pendingByAccount[account._id] ?? 0;
        taken[account._id] = rawCents - pendingCents;
      }
    }
    // The pending list is kept on the latest fetch only: it is what is
    // pending now, and sixty copies of old ones would only grow the row.
    const earlier = (feed.balances ?? []).map(({ pending: _old, ...rest }) => rest);
    return [
      ...earlier,
      {
        at: new Date().toISOString(),
        balances: taken,
        rawBalances: raw,
        pendingAmounts: pendingByAccount,
        pending,
      },
    ].slice(-60);
  } catch {
    // A fetch that worked should not fail because the balances did.
    return feed.balances ?? [];
  }
}
