import type { Cents } from "./money.js";
import type { IsoDate } from "./dates.js";
import type { Transaction } from "./types.js";

/**
 * SimpleFIN: a bank feed for the United States and Canada that the person
 * pays for themselves (SimpleFIN Bridge, at simplefin.org), read-only, and
 * open: its protocol is published.
 *
 * The person signs up with the Bridge, connects their banks there, and is
 * given a Setup Token. The token is the claim address in Base64; claimed
 * once, with a POST, it answers with an Access URL -- an address with a user
 * name and password in it -- which is what reads the accounts from then on.
 * A token can be claimed only once, so a token that was intercepted and used
 * shows up as one that will not claim.
 *
 * Each account at the Bridge is its own bank account in these books, named
 * `simplefin-<its id>`. Each transaction carries the Bridge's id, kept as the
 * line's transaction number, so the same line fetched twice is known.
 */

export interface SimpleFinTransaction {
  id: string;
  /** When it posted, in seconds since 1970; 0 while pending. */
  posted: number;
  /** A decimal, positive for money in: "-45.50". */
  amount: string;
  description: string;
  transacted_at?: number;
  pending?: boolean;
  payee?: string;
  memo?: string;
}

export interface SimpleFinAccount {
  id: string;
  name: string;
  conn_id?: string;
  currency: string;
  balance: string;
  "available-balance"?: string;
  "balance-date": number;
  transactions?: SimpleFinTransaction[];
  org?: { name?: string; domain?: string };
}

export interface SimpleFinConnection {
  conn_id: string;
  name: string;
  org_id?: string;
  org_name?: string;
}

export interface SimpleFinAccountSet {
  errlist?: { code: string; msg: string; conn_id?: string; account_id?: string }[];
  errors?: string[];
  connections?: SimpleFinConnection[];
  accounts: SimpleFinAccount[];
}

function decodeBase64(text: string): string | null {
  try {
    const plain = text.trim().replace(/-/g, "+").replace(/_/g, "/");
    if (!/^[A-Za-z0-9+/]+=*$/.test(plain)) return null;
    return atob(plain);
  } catch {
    return null;
  }
}

/** Where a Setup Token is claimed: the address it encodes, if it is one. */
export function simpleFinClaimUrl(token: string): string | null {
  const decoded = decodeBase64(token);
  if (decoded === null) return null;
  let url: URL;
  try {
    url = new URL(decoded.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !/\/claim\/[^/]+$/.test(url.pathname)) return null;
  return url.toString();
}

/** An Access URL taken apart: where to ask, and as whom. Null when it is not one. */
export function simpleFinAccess(accessUrl: string): { base: string; username: string; password: string } | null {
  let url: URL;
  try {
    url = new URL(accessUrl.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username === "" || url.password === "") return null;
  const username = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  url.username = "";
  url.password = "";
  return { base: url.toString().replace(/\/+$/, ""), username, password };
}

/** The bank account in these books an account at the Bridge is. */
export function simpleFinAccountId(account: Pick<SimpleFinAccount, "id">): string {
  const slug = account.id.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `simplefin-${slug || "account"}`;
}

/** A decimal string as cents, exactly: "-45.5" is -4550. Null when it is not a number. */
export function simpleFinCents(amount: string): Cents | null {
  const match = /^\s*([+-]?)(\d*)(?:\.(\d*))?\s*$/.exec(amount);
  if (match === null || (match[2] === "" && (match[3] ?? "") === "")) return null;
  const whole = Number(match[2] || "0");
  const fraction = (match[3] ?? "").padEnd(3, "0");
  // Rounded half away from zero on the third decimal place.
  const cents = whole * 100 + Number(fraction.slice(0, 2)) + (Number(fraction[2]) >= 5 ? 1 : 0);
  return (match[1] === "-" ? -cents : cents) as Cents;
}

/** A moment as the date it was where the books are kept. */
function dayOf(seconds: number, timeZone: string): IsoDate {
  return new Date(seconds * 1000).toLocaleDateString("en-CA", { timeZone }) as IsoDate;
}

export interface SimpleFinImportResult {
  transactions: Transaction[];
  problems: { line: number; row: string[]; message: string }[];
}

/**
 * One account's transactions as bank lines. Pending ones are left out: their
 * amount and date can still change, and they come again once posted.
 */
export function fromSimpleFin(
  account: SimpleFinAccount,
  options: { timeZone?: string; label?: string } = {},
): SimpleFinImportResult {
  const timeZone = options.timeZone ?? "UTC";
  const transactions: Transaction[] = [];
  const problems: SimpleFinImportResult["problems"] = [];
  const id = simpleFinAccountId(account);
  (account.transactions ?? []).forEach((item, index) => {
    const line = index + 1;
    const row = [String(item.posted), item.description ?? "", item.amount ?? ""];
    if (item.pending === true || !(item.posted > 0)) return;
    const amount = simpleFinCents(String(item.amount ?? ""));
    if (amount === null) {
      problems.push({ line, row, message: `unreadable amount ${JSON.stringify(item.amount)}` });
      return;
    }
    // The day it was made where there is one, as a card statement dates it;
    // the day it posted where not.
    const when = typeof item.transacted_at === "number" && item.transacted_at > 0 ? item.transacted_at : item.posted;
    const who = (item.payee ?? "").trim() || (item.description ?? "").trim();
    transactions.push({
      id: "",
      date: dayOf(when, timeZone),
      amount,
      currency: (account.currency || "USD").toUpperCase(),
      account: id,
      serial: "",
      trn: String(item.id ?? ""),
      particulars: (item.description ?? "").trim(),
      code: "",
      reference: (item.memo ?? "").trim(),
      otherParty: who,
      origin: "",
      type: "",
      batch: "",
      otherPartyAccount: "",
      occurrence: 1,
      extras: {
        simplefinId: String(item.id ?? ""),
        ...(options.label ? { accountLabel: options.label } : {}),
      },
      source: { importer: "simplefin", file: "SimpleFIN", line },
    } as Transaction);
  });
  return { transactions, problems };
}

/** What the Bridge said went wrong, in words it says are safe to show. */
export function simpleFinErrors(set: Pick<SimpleFinAccountSet, "errlist" | "errors">): string[] {
  const listed = (set.errlist ?? []).map((e) => e.msg).filter((m) => typeof m === "string" && m !== "");
  return listed.length > 0 ? listed : (set.errors ?? []).filter((m) => typeof m === "string" && m !== "");
}

/**
 * The windows to ask for transactions in. The Bridge asks for no more than
 * 45 days at a time, and says it may refuse more, so a longer history is
 * asked for in pieces of 45 days, each from `start` (inclusive) to `end`
 * (exclusive), in seconds.
 */
export function simpleFinWindows(fromSeconds: number, toSeconds: number, days = 45): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (let at = fromSeconds; at < toSeconds; at += days * 86_400) {
    out.push({ start: at, end: Math.min(toSeconds, at + days * 86_400) });
  }
  return out;
}
