import type { Account } from "./chart.js";
import type { Contact } from "./contacts.js";
import type { IsoDate } from "./dates.js";
import type { IifFile, ReadBooks } from "./iif.js";
import { booksFromEntries } from "./iif.js";
import type { ImportProblem } from "./types.js";
import type { QuickBooksChart, QuickBooksEntry, QuickBooksLedgerOptions } from "./quickbooks.js";
import { quickBooksPlacement } from "./quickbooks.js";

/**
 * GnuCash's own file, read as books: its XML (what a .gnucash file holds once
 * ungzipped; the page does that), each account into the chart and each
 * transaction as an entry, then made into bank lines and journals by the same
 * road an IIF file takes. Its scheduled-transaction templates are left out --
 * they are patterns, not postings -- and so is anything in a currency other
 * than the books', which these books cannot yet hold.
 */

/** Whether text is GnuCash's XML. */
export function isGnuCashXml(text: string): boolean {
  return /<gnc-v2[\s>]/.test(text.slice(0, 4000));
}

function decode(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

/** The text of the first `<tag>` directly inside a block, decoded; "" when absent. */
function field(block: string, tag: string): string {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(block);
  return m?.[1] === undefined ? "" : decode(m[1].trim());
}

function blocks(text: string, tag: string): string[] {
  return [...text.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g"))].map((m) => m[1] ?? "");
}

/** A GnuCash amount, "-12345/100", in cents. */
function cents(value: string): number | null {
  const m = /^\s*(-?\d+)\/(\d+)\s*$/.exec(value);
  if (m === null) return null;
  const denominator = Number(m[2]);
  if (denominator === 0) return null;
  return Math.round((Number(m[1]) * 100) / denominator);
}

/** GnuCash's account types, as the QuickBooks-shaped chart names them. */
function qbType(gnc: string, path: string): string | null {
  const p = path.toLowerCase();
  switch (gnc) {
    case "BANK":
    case "CASH":
      return "Bank";
    case "CREDIT":
      return "Credit Card";
    case "RECEIVABLE":
      return "Accounts receivable (A/R)";
    case "PAYABLE":
      return "Accounts payable (A/P)";
    case "ASSET":
      return /\b(fixed|equipment|vehicles?|plant|buildings?|property|furniture)\b/.test(p) ? "Fixed Assets" : "Other Current Assets";
    case "STOCK":
    case "MUTUAL":
      return "Other Assets";
    case "LIABILITY":
      return /\b(loan|mortgage)\b/.test(p) ? "Long Term Liabilities" : "Other Current Liabilities";
    case "EQUITY":
      return "Equity";
    case "INCOME":
      return "Income";
    case "EXPENSE":
      return "Expenses";
    default:
      return null;
  }
}

interface GncAccount {
  id: string;
  name: string;
  type: string;
  parent: string;
  code: string;
  description: string;
  placeholder: boolean;
  currency: string;
}

export function parseGnuCash(xml: string, options: { currency?: string } = {}): IifFile {
  const currency = (options.currency ?? "NZD").toUpperCase();
  const problems: ImportProblem[] = [];
  // Scheduled transactions' templates are accounts and transactions too, of a kind that never posted.
  const book = xml.replace(/<gnc:template-transactions>[\s\S]*?<\/gnc:template-transactions>/g, "");

  const raw: GncAccount[] = blocks(book, "gnc:account").map((b) => ({
    id: field(b, "act:id"),
    name: field(b, "act:name"),
    type: field(b, "act:type").toUpperCase(),
    parent: field(b, "act:parent"),
    code: field(b, "act:code"),
    description: field(b, "act:description"),
    placeholder: /<slot:key>placeholder<\/slot:key>\s*<slot:value[^>]*>true<\/slot:value>/.test(b),
    currency: field(field(b, "act:commodity"), "cmdty:id").toUpperCase(),
  }));
  const byId = new Map(raw.map((a) => [a.id, a]));
  // The whole name below the root, as GnuCash shows it: "Expenses:Auto:Fuel".
  const pathOf = (a: GncAccount): string[] => {
    const names: string[] = [];
    let at: GncAccount | undefined = a;
    for (let guard = 0; at !== undefined && at.type !== "ROOT" && guard < 50; guard += 1) {
      names.unshift(at.name);
      at = byId.get(at.parent);
    }
    return names;
  };
  // Headings -- placeholders like Assets or Current Assets, which only gather
  // -- are left off the name, so "Assets:Current Assets:Checking Account" is
  // "Checking Account"; where that would give two accounts one name, the
  // whole path is kept for them.
  const short = new Map<string, string>();
  const full = new Map<string, string>();
  for (const a of raw) {
    if (a.type === "ROOT") continue;
    const chain: GncAccount[] = [];
    let at: GncAccount | undefined = a;
    for (let guard = 0; at !== undefined && at.type !== "ROOT" && guard < 50; guard += 1) {
      chain.unshift(at);
      at = byId.get(at.parent);
    }
    full.set(a.id, pathOf(a).join(":"));
    short.set(a.id, chain.filter((x, i) => i === chain.length - 1 || !x.placeholder).map((x) => x.name).join(":"));
  }
  const counts = new Map<string, number>();
  for (const name of short.values()) counts.set(name, (counts.get(name) ?? 0) + 1);
  const nameOf = new Map<string, string>();
  for (const [id, name] of short) nameOf.set(id, (counts.get(name) ?? 0) > 1 ? (full.get(id) ?? name) : name);

  const accounts: Account[] = [];
  const debitNormal: string[] = [];
  const bankNames: string[] = [];
  const cardNames: string[] = [];
  const next = new Map<number, number>();
  const used = new Set<string>();
  const transactionBlocks = blocks(book, "gnc:transaction");
  for (const b of transactionBlocks) for (const s of blocks(b, "trn:split")) used.add(field(s, "split:account"));
  for (const a of raw) {
    if (a.type === "ROOT" || a.type === "TRADING") continue;
    // A placeholder with nothing posted to it is a heading, not an account.
    if (a.placeholder && !used.has(a.id)) continue;
    const name = nameOf.get(a.id) ?? a.name;
    const type = qbType(a.type, name);
    if (type === null) {
      problems.push({ line: 0, row: [], message: `${name}: GnuCash type ${a.type} is not one these books keep; left out` });
      continue;
    }
    const place = quickBooksPlacement(type, /retained earnings/i.test(name) ? "Retained Earnings" : "");
    let code = "";
    if (place.base !== null) {
      if (a.code !== "" && !accounts.some((x) => x.code === a.code)) code = a.code;
      else {
        let n = next.get(place.base) ?? place.base;
        while (accounts.some((x) => x.code === String(n))) n += 10;
        code = String(n);
        next.set(place.base, n + 10);
      }
    }
    accounts.push({ code, name, type: place.type, taxCode: "", description: a.type === "CREDIT" ? "Credit Card" : a.description });
    if (place.debit) debitNormal.push(name);
    if (place.bank) bankNames.push(name);
    if (place.card) cardNames.push(name);
  }
  const kept = new Set(accounts.map((a) => a.name));

  const entries: QuickBooksEntry[] = [];
  for (const b of transactionBlocks) {
    const date = /^(\d{4}-\d{2}-\d{2})/.exec(field(field(b, "trn:date-posted"), "ts:date"))?.[1] as IsoDate | undefined;
    const description = field(b, "trn:description");
    const num = field(b, "trn:num");
    if (date === undefined) {
      problems.push({ line: 0, row: [], message: `${description || "A transaction"}: no date it was posted; left out` });
      continue;
    }
    const inCurrency = field(field(b, "trn:currency"), "cmdty:id").toUpperCase();
    if (inCurrency !== "" && inCurrency !== currency) {
      problems.push({ line: 0, row: [], message: `${date} ${description}: in ${inCurrency}, not ${currency}; left out` });
      continue;
    }
    const legs: QuickBooksEntry["legs"] = [];
    let bad = false;
    for (const s of blocks(b, "trn:split")) {
      const amount = cents(field(s, "split:value"));
      const account = nameOf.get(field(s, "split:account"));
      if (amount === null || account === undefined || !kept.has(account)) {
        bad = true;
        break;
      }
      if (amount === 0) continue;
      const memo = field(s, "split:memo");
      legs.push({ account, debit: amount, ...(memo !== "" ? { memo } : {}) });
    }
    if (bad) {
      problems.push({ line: 0, row: [], message: `${date} ${description}: a split names an account or amount that cannot be read; left out` });
      continue;
    }
    if (legs.length === 0) continue;
    const sum = legs.reduce((s, l) => s + l.debit, 0);
    if (sum !== 0) {
      problems.push({ line: 0, row: [], message: `${date} ${description}: does not balance by ${sum / 100}; left out` });
      continue;
    }
    entries.push({ date, type: legs.some((l) => bankNames.includes(l.account)) ? "Transaction" : "Journal Entry", num, name: description, memo: description, legs });
  }

  // Customers and vendors from GnuCash's business features, where it was used.
  const contacts: Omit<Contact, "id">[] = [];
  for (const [tag, prefix, kind] of [["gnc:GncCustomer", "cust", "customer"], ["gnc:GncVendor", "vendor", "vendor"]] as const) {
    for (const c of blocks(book, tag)) {
      const name = field(c, `${prefix}:name`);
      if (name === "") continue;
      const addr = field(c, `${prefix}:addr`);
      const address = ["addr:addr1", "addr:addr2", "addr:addr3", "addr:addr4"].map((t) => field(addr, t)).filter((p) => p !== "").join("\n");
      const email = field(addr, "addr:email");
      const phone = field(addr, "addr:phone");
      contacts.push({
        name,
        kind,
        source: "GnuCash",
        ...(email !== "" ? { email } : {}),
        ...(phone !== "" ? { phone } : {}),
        ...(address !== "" ? { address } : {}),
      });
    }
  }

  const chart: QuickBooksChart = { accounts, debitNormal, bankNames, cardNames };
  return { chart, entries, contacts, classes: new Map(), items: [], problems };
}

/** A GnuCash file as books, on the chart these books hold where they hold one. */
export function parseGnuCashBooks(xml: string, chart: QuickBooksChart | null, options: QuickBooksLedgerOptions = {}): ReadBooks {
  const file = parseGnuCash(xml, options.currency !== undefined ? { currency: options.currency } : {});
  return booksFromEntries(file, chart, { ...options, file: options.file ?? "books.gnucash" }, "gnucash");
}
