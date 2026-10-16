import { applyDueDates, isIif, isQuickBooksTrialBalance, parseQuickBooksTrialBalance, trialBalance, isSlowBooksLedger, mergeContacts, parseDueDates, parseProductList, parseContactList, parseIifBooks, parseSlowBooksBooks, parseQuickBooksBooks, parseQuickBooksLedger, quickBooksChartFrom, splitPartId } from "@nzosa/core";
import type { Item, ManualJournal, SplitPart } from "@nzosa/core";
import { asCsvText, hasCoding, postedJournals, reconcileRows, record, reclassify, saveManualJournals } from "../books.js";
import { booksCountry, booksCurrency, booksMoney } from "../country.js";
import { addTransactions } from "../daily/bank-import.js";
import { state } from "../state.js";
import { savePart } from "../store.js";

/** Journals made from QuickBooks carry this, so a second drop replaces them. */
const SOURCE = "QuickBooks";

/**
 * Everything in a QuickBooks general ledger, put into the books.
 *
 * The coding in the same file is read with the other coding history (see
 * loadReference). This is the rest: its bank and card postings as bank lines;
 * an entry QuickBooks spread over several accounts as a split on its bank
 * line; and every entry that touches no bank account -- invoices, bills,
 * credit memos, journal entries, stock adjustments -- as a journal, so the
 * profit and loss and the balance sheet come out as they do in QuickBooks.
 *
 * The chart has to be in first, which the drop zone arranges; where it is
 * not, only the bank and card lines can be read, from their names.
 */
export async function loadQuickBooksBankLines(file: File): Promise<string> {
  const text = await asCsvText(file.name, new Uint8Array(await file.arrayBuffer()));
  const options = { dayFirst: booksCountry().dayFirst, currency: booksCurrency(), file: file.name };

  const slowBooks = isSlowBooksLedger(text);
  const iif = isIif(text) || slowBooks;
  if (state.chart.length === 0 && !iif) {
    const only = parseQuickBooksLedger(text, options);
    if (only.transactions.length === 0) return "no bank or card lines found in it.";
    await addTransactions(only.transactions, { importer: "quickbooks-ledger", file: file.name, problems: only.problems });
    return (
      `${only.transactions.length} bank and card lines. Drop the chart of accounts too, ` +
      "to bring in the invoices, bills and journals."
    );
  }

  const chart = state.chart.length > 0 ? quickBooksChartFrom(state.chart) : null;
  const fromIif = iif
    ? (slowBooks ? parseSlowBooksBooks : parseIifBooks)(text, chart, { currency: booksCurrency(), file: file.name })
    : null;
  const books = fromIif ?? parseQuickBooksBooks(text, chart ?? quickBooksChartFrom([]), options);
  // An IIF file lists its customers and vendors with their details.
  if (fromIif !== null) books.contacts = [...fromIif.listed, ...books.contacts];
  if (books.transactions.length > 0) {
    await addTransactions(books.transactions, {
      importer: slowBooks ? "slowbooks-ledger" : iif ? "quickbooks-iif" : "quickbooks-ledger",
      file: file.name,
      problems: books.problems,
    });
  }

  // Splits, on the lines just added (their ids were made as they went in).
  let splitCount = 0;
  if (books.splits.length > 0) {
    const splits: Record<string, readonly SplitPart[]> = { ...(state.ledger.splits ?? {}) };
    for (const one of books.splits) {
      if (one.transaction.id === "" || splits[one.transaction.id] !== undefined) continue;
      splits[one.transaction.id] = one.parts.map((p) => ({ amount: p.amount, code: p.code, note: p.note }));
      splitCount += 1;
    }
    if (splitCount > 0) {
      state.ledger = { ...state.ledger, splits };
      state.persistent = await savePart(state.ledger);
      await record("split", `${splitCount} split${splitCount === 1 ? "" : "s"} from ${file.name}`, null, splitCount, file.name);
    }
  }

  // Invoices and bills as documents, replacing the last drop's, and what was
  // paid against them: a match where a payment settled one, a split where it
  // settled several.
  let invoiceCount = 0;
  if (books.invoices.length > 0) {
    const keep = (state.ledger.invoices ?? []).filter((i) => i.reference !== "QuickBooks");
    state.ledger = { ...state.ledger, invoices: [...keep, ...books.invoices] };
    invoiceCount = books.invoices.length;
    state.persistent = await savePart(state.ledger, "invoices");
  }
  let paymentCount = 0;
  if (books.payments.length > 0) {
    const matches: Record<string, string> = { ...(state.ledger.invoiceMatches ?? {}) };
    const splits: Record<string, readonly SplitPart[]> = { ...(state.ledger.splits ?? {}) };
    for (const pay of books.payments) {
      const id = pay.transaction.id;
      if (id === "") continue;
      const only = pay.parts.length === 1 ? pay.parts[0] : undefined;
      if (only !== undefined && only.invoiceNumber !== null && only.amount === pay.transaction.amount) {
        matches[id] = only.invoiceNumber;
      } else {
        splits[id] = pay.parts.map((p) => ({ amount: p.amount, code: p.code, note: p.note }));
        pay.parts.forEach((p, index) => {
          if (p.invoiceNumber !== null) matches[splitPartId(id, index)] = p.invoiceNumber;
        });
      }
      paymentCount += 1;
    }
    // Every other line of the file is said not to pay a document: QuickBooks
    // has applied each payment already, and left to guess by amount and date
    // the matcher would settle a bill with the card payment that cleared it.
    for (const t of books.transactions) {
      if (t.id !== "" && matches[t.id] === undefined) matches[t.id] = "";
    }
    state.ledger = { ...state.ledger, invoiceMatches: matches, splits };
    state.persistent = await savePart(state.ledger);
  }

  // Classes, where an IIF file gave them: to the Classes page, as if given there.
  let classCount = 0;
  if (fromIif !== null) {
    const held = state.ledger.classes ?? { names: [], assigned: {} };
    const assigned = { ...held.assigned };
    const names = new Set(held.names);
    for (const [t, klass] of fromIif.classOf.transactions) {
      if (t.id === "" || assigned[t.id] !== undefined) continue;
      assigned[t.id] = klass;
      names.add(klass);
      classCount += 1;
    }
    // The file's whole list of classes, with or without lines given them.
    for (const name of fromIif.classNames) names.add(name);
    for (const [number, klass] of fromIif.classOf.invoices) {
      if (assigned[number] !== undefined) continue;
      assigned[number] = klass;
      names.add(klass);
      classCount += 1;
    }
    if (classCount > 0 || names.size > held.names.length) {
      state.ledger = { ...state.ledger, classes: { names: [...names].sort((x, y) => x.localeCompare(y)), assigned } };
      state.persistent = await savePart(state.ledger);
    }
  }

  // Products and services an IIF file lists, added to those held by name.
  let itemCount = 0;
  if (fromIif !== null && fromIif.items.length > 0) {
    const held = state.ledger.items ?? [];
    const names = new Set(held.map((i) => i.name.trim().toLowerCase()));
    const added = fromIif.items
      .filter((i) => !names.has(i.name.trim().toLowerCase()))
      .map((i, n) => ({ ...i, id: `item-iif-${Date.now().toString(36)}-${n}` }));
    if (added.length > 0) {
      state.ledger = { ...state.ledger, items: [...held, ...added] };
      state.persistent = await savePart(state.ledger);
      itemCount = added.length;
    }
  }

  // Customers and vendors, from the names on the entries.
  let contactCount = 0;
  if (books.contacts.length > 0) {
    const before = (state.ledger.contacts ?? []).length;
    const merged = mergeContacts(state.ledger.contacts ?? [], books.contacts);
    contactCount = merged.length - before;
    state.ledger = { ...state.ledger, contacts: merged };
    state.persistent = await savePart(state.ledger);
  }

  // Transfers between the books' own accounts, paired as they are paired
  // everywhere else, so neither side is coded to an account.
  let transferCount = 0;
  if (books.transfers.length > 0) {
    const transfers: Record<string, string> = { ...(state.ledger.transfers ?? {}) };
    for (const [a, b] of books.transfers) {
      if (a.id === "" || b.id === "" || transfers[a.id] !== undefined || transfers[b.id] !== undefined) continue;
      transfers[a.id] = b.id;
      transfers[b.id] = a.id;
      transferCount += 1;
    }
    if (transferCount > 0) {
      state.ledger = { ...state.ledger, transfers };
      state.persistent = await savePart(state.ledger);
    }
  }

  // Journals, replacing the last drop's rather than adding to them.
  let journalCount = 0;
  if (books.journals.length > 0) {
    const keep = (state.ledger.manualJournals ?? []).filter((j) => j.source !== SOURCE);
    const made: ManualJournal[] = books.journals.map((j, i) => ({
      id: `qb${i + 1}`,
      date: j.date,
      narration: j.narration,
      lines: j.lines.map((l) => ({
        code: l.code,
        amount: l.amount,
        ...(l.description !== undefined ? { description: l.description } : {}),
      })),
      source: SOURCE,
    }));
    journalCount = made.length;
    await saveManualJournals([...keep, ...made], `${journalCount} journals from ${file.name}`);
  } else {
    reclassify();
  }

  const accounts = new Set(books.transactions.map((t) => t.account)).size;
  return (
    `${books.transactions.length} bank and card line${books.transactions.length === 1 ? "" : "s"} ` +
    `on ${accounts} account${accounts === 1 ? "" : "s"}` +
    (splitCount > 0 ? `, ${splitCount} split${splitCount === 1 ? "" : "s"}` : "") +
    (transferCount > 0 ? `, ${transferCount} transfer${transferCount === 1 ? "" : "s"} between accounts` : "") +
    (invoiceCount > 0 ? `, ${invoiceCount} invoices and bills with ${paymentCount} payments applied` : "") +
    (journalCount > 0 ? `, ${journalCount} journals for the rest` : "") +
    (contactCount > 0 ? `, ${contactCount} customers and vendors` : "") +
    (classCount > 0 ? `, ${classCount} given a class` : "") +
    (itemCount > 0 ? `, ${itemCount} products and services` : "") +
    "."
  );
}

/**
 * A list of customers or vendors, brought in as contact records.
 *
 * By name, adding to what is held: a record already there keeps what it has
 * and takes the details the list adds. Whether it is a customer or a vendor
 * comes from the list's own headings, then from its file name.
 */
export async function loadContactList(file: File): Promise<string> {
  const text = await asCsvText(file.name, new Uint8Array(await file.arrayBuffer()));
  const hint = /vendor|supplier/i.test(file.name) ? "vendor" : /customer|client/i.test(file.name) ? "customer" : null;
  const read = parseContactList(text, hint);
  if (read.contacts.length === 0) return "no customers or vendors found in it.";
  const before = (state.ledger.contacts ?? []).length;
  const merged = mergeContacts(state.ledger.contacts ?? [], read.contacts);
  state.ledger = { ...state.ledger, contacts: merged };
  state.persistent = await savePart(state.ledger);
  const added = merged.length - before;
  const word = read.kind === "vendor" ? "vendor" : read.kind === "customer" ? "customer" : "contact";
  return `${read.contacts.length} ${word}${read.contacts.length === 1 ? "" : "s"}, ${added} new, ${read.contacts.length - added} already held and filled in.`;
}

/**
 * A list of products and services from the system being left (QuickBooks
 * Online, SlowBooks), added to those held by name. Each takes the account its
 * sales go to, found in the chart by name; a product kept in stock with a
 * quantity on hand starts a stock count, so what is on hand starts right.
 */
export async function loadProductList(file: File): Promise<string> {
  const text = await asCsvText(file.name, new Uint8Array(await file.arrayBuffer()));
  const read = parseProductList(text, booksCurrency());
  if (read.length === 0) return "no products or services found in it.";
  const codeFor = (name: string | undefined): string | undefined => {
    if (name === undefined) return undefined;
    const wanted = name.trim().toLowerCase();
    // QuickBooks writes a sub-account as "Parent:Child"; the chart keeps the whole name.
    const found = state.chart.find((a) => a.name.trim().toLowerCase() === wanted || a.name.trim().toLowerCase().endsWith(`:${wanted}`));
    return found === undefined || found.code.trim() === "" ? undefined : found.code.trim();
  };
  const held = state.ledger.items ?? [];
  const names = new Set(held.map((i) => i.name.trim().toLowerCase()));
  const stamp = Date.now().toString(36);
  const added: Item[] = [];
  for (const [n, one] of read.entries()) {
    if (names.has(one.item.name.trim().toLowerCase())) continue;
    const code = codeFor(one.incomeAccount);
    added.push({ ...one.item, id: `item-${stamp}-${n}`, ...(code !== undefined ? { accountCode: code } : {}) });
  }
  if (added.length === 0) return `${read.length} products and services, all already held.`;
  const items = [...held, ...added];
  // Stock on hand today, for the products that say how many there are.
  const counted = added
    .map((item) => ({ item, onHand: read.find((r) => r.item.name === item.name)?.onHand }))
    .filter((c): c is { item: Item; onHand: number } => c.onHand !== undefined && c.item.unitCost !== undefined);
  const counts =
    counted.length === 0
      ? state.ledger.stockCounts
      : [
          ...(state.ledger.stockCounts ?? []),
          {
            id: `count-${stamp}`,
            date: new Date().toLocaleDateString("en-CA"),
            lines: counted.map((c) => ({ itemId: c.item.id, quantity: c.onHand, unitCost: c.item.unitCost ?? 0 })),
          },
        ];
  state.ledger = { ...state.ledger, items, ...(counts !== undefined ? { stockCounts: counts } : {}) };
  state.persistent = await savePart(state.ledger);
  await record("items", `${added.length} products and services from ${file.name}`, held, items);
  return (
    `${added.length} products and services` +
    (counted.length > 0 ? `, ${counted.length} with a quantity on hand counted into stock` : "") +
    "."
  );
}

/** When invoices and bills already brought in are due, from a list of them. */
export async function loadDueDates(file: File): Promise<string> {
  const text = await asCsvText(file.name, new Uint8Array(await file.arrayBuffer()));
  const dates = parseDueDates(text, booksCountry().dayFirst);
  if (dates.length === 0) return "no due dates found in it.";
  const { invoices, filled } = applyDueDates(state.ledger.invoices ?? [], dates);
  if (filled === 0) {
    return `${dates.length} due dates, none for an invoice or bill held without one. Bring in the ledger first.`;
  }
  state.ledger = { ...state.ledger, invoices };
  state.persistent = await savePart(state.ledger, "invoices");
  return `due dates filled in on ${filled} invoice${filled === 1 ? "" : "s"} and bills.`;
}

/**
 * QuickBooks' trial balance, where the general ledger already brought every
 * balance from the start: not opening balances -- used as those it would count
 * everything twice -- but the figures to check the books against. Each balance
 * sheet account it names is set beside what the books hold on the same day.
 * Null when it is not that: a trial balance dated before the ledger begins is
 * the opening balances for a ledger exported for part of the history.
 */
export async function checkAgainstTrialBalance(file: File): Promise<string | null> {
  const text = await asCsvText(file.name, new Uint8Array(await file.arrayBuffer()));
  return trialBalanceCheck(text);
}

/**
 * A trial balance dropped before the coding was accepted, kept for the check
 * to run by itself once it is: dropping the same file twice was the only way
 * before.
 */
let trialBalanceWaiting: string | null = null;
let trialBalanceChecked: string | null = null;

/**
 * What checking the waiting trial balance found, once every line has its
 * account; said on the coding check, where the coding is accepted. Null while
 * nothing is waiting or lines still are.
 */
export function trialBalanceFinding(): string | null {
  if (trialBalanceWaiting !== null) {
    const result = trialBalanceCheck(trialBalanceWaiting);
    if (result !== null && !result.includes("once the coding is accepted")) {
      trialBalanceWaiting = null;
      const asAt = /as at (\d{4}-\d{2}-\d{2})/.exec(result)?.[1] ?? "";
      const found = result.slice(result.indexOf("instead: ") + "instead: ".length);
      trialBalanceChecked = `QuickBooks' trial balance as at ${asAt}, checked now the coding is accepted: ${found}`;
    }
  }
  return trialBalanceChecked;
}

function trialBalanceCheck(text: string): string | null {
  const fromStart = state.ledger.transactions.filter((t) =>
    /^(quickbooks-ledger|quickbooks-iif|slowbooks-ledger)$/.test(t.source?.importer ?? ""),
  );
  if (fromStart.length === 0) return null;
  if (!isQuickBooksTrialBalance(text)) return null;
  const read = parseQuickBooksTrialBalance(text, state.chart);
  const asAt = read.asAt;
  const first = fromStart.reduce((min, t) => (t.date < min ? t.date : min), fromStart[0]?.date ?? "");
  if (asAt === null || asAt < first) return null;

  const said =
    `a trial balance as at ${asAt}. Not needed as opening balances: the general ledger brought every ` +
    "balance from the start. ";
  // A bank line with nothing coded posts nowhere, and every balance it
  // touches would be said to differ: the ledger's coding is accepted first.
  const transfers = state.ledger.transfers ?? {};
  const waiting = reconcileRows().all.filter(
    (one) => fromStart.includes(one.transaction) && !hasCoding(one) && transfers[one.transaction.id] === undefined,
  ).length;
  if (waiting > 0) {
    trialBalanceWaiting = text;
    trialBalanceChecked = null;
    return (
      `${said}It checks the books once the coding is accepted: ${waiting} bank and card ` +
      "line" + (waiting === 1 ? " has" : "s have") + " no account yet. The coding check says what it finds."
    );
  }

  const held = new Map<string, number>();
  for (const row of trialBalance(postedJournals().filter((j) => j.date <= asAt)).rows) {
    const key = row.accountName.trim().toLowerCase();
    held.set(key, (held.get(key) ?? 0) + row.balance);
  }
  // Equity is left out: the books carry the year's profit there as it goes,
  // QuickBooks moves it to retained earnings at each year end.
  const sheet = read.accounts.filter((a) => a.klass === "Asset" || a.klass === "Liability");
  const differ = sheet.filter((a) => (a.byDate[asAt] ?? 0) !== (held.get(a.name.trim().toLowerCase()) ?? 0));
  const checked = `${said}Checked against the books instead: `;
  if (differ.length === 0) return `${checked}all ${sheet.length} asset and liability balances agree.`;
  const shown = differ
    .slice(0, 5)
    .map((a) => `${a.name} (QuickBooks ${booksMoney(a.byDate[asAt] ?? 0)}, here ${booksMoney(held.get(a.name.trim().toLowerCase()) ?? 0)})`)
    .join("; ");
  return (
    `${checked}${sheet.length - differ.length} of ${sheet.length} asset and liability balances agree. ` +
    `Different: ${shown}${differ.length > 5 ? `, and ${differ.length - 5} more` : ""}.`
  );
}
