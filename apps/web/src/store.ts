import { entityId } from "@nzosa/core";
import type {
  Account, Cents, EntityModel, FixedAsset, Invoice, Journal, ManualJournal,
  PaymentAllocation, Payout, TaxExtra,
} from "@nzosa/core";
import type {
  FiledReturn,
  OpeningBalances,
  ReferenceLine,
  Overrides,
  RuleSet,
  Splits,
  Transaction,
  VarianceNote,
} from "@nzosa/core";
import type { LedgerEvent } from "./events.js";

/**
 * Browser-side ledger storage.
 *
 * IndexedDB rather than localStorage: a few years of transactions across half
 * a dozen accounts runs to megabytes, and localStorage's ~5MB ceiling throws
 * on write when it is reached, which would mean silently losing an import.
 *
 * The stored shape is identical to the CLI's `ledger.json`, so a ledger can be
 * exported here and imported there without conversion, and so the same object
 * is what a Supabase row would hold.
 */

const DB_NAME = "nzosa";
/**
 * What the database was called before the project was renamed.
 *
 * A database name is part of a browser's storage key, so renaming it does not
 * move anything: the old one stays where it is and nothing reads it, and the
 * app opens looking empty with a year of work apparently gone. The first open
 * after an upgrade copies the old database across.
 */
const OLD_DB_NAME = "ledgerflat";
const DB_VERSION = 1;
const STORE = "ledger";
const KEY = "default";
const RULES_KEY = "rules";
const ARCHIVE_KEY = "rules-archive";
const EVENTS_KEY = "events";
const USER_KEY = "user";

export interface StoredLedger {
  version: 1;
  legitimateDuplicates: string[];
  /**
   * Transactions thrown away as duplicates, by id.
   *
   * A decision has to outlive the row it was made about. Without this, a
   * transaction removed from the review queue came back on the next fetch --
   * the feed still holds it, nothing recorded that it had been judged, and it
   * was flagged all over again. Ids are content hashes, so the one that comes
   * back is the one that went.
   */
  removedDuplicates?: string[];
  /**
   * Lines a person has said are not a transfer.
   *
   * Pairing is offered again on every open, and without this a rejection did
   * not survive one: unlink a pair and the next load found the same single
   * candidate and paired it again, so the button appeared to do nothing.
   * Saying no is a decision like any other and is kept like one.
   */
  rejectedTransfers?: string[];
  transactions: Transaction[];
  /**
   * The layers the command line records on top of the bank data.
   *
   * Carried through untouched even though this app does not yet edit them: a
   * ledger that loses its coding decisions on a round trip through the browser
   * is worse than one that cannot be opened here at all, because the loss is
   * silent.
   */
  splits?: Splits;
  overrides?: Overrides;
  varianceNotes?: VarianceNote[];
  /**
   * GST returns as filed, read from the accounting system's workbooks.
   *
   * Kept with the ledger because a filed return is a fact about the year, not
   * about a browser session -- the CLI has always written them here and the
   * page used to hold them in memory and lose them on reload.
   */
  filedReturns?: FiledReturn[];
  /**
   * The accounts the GST comparison is scoped to.
   *
   * Which accounts belong in a return is a fact about the business -- the
   * rentals are not in it -- so it is remembered rather than re-picked every
   * session. Empty means every account.
   */
  varianceAccounts?: string[];
  /**
   * Coded history read from an accounting system, for checking our coding
   * against and for learning rules from.
   *
   * Persisted for the same reason the journals and invoices beside it are: it
   * is a file somebody loaded, and re-loading a large export after every
   * reload is work nobody should have to repeat. Its own part, because it is
   * large and changes rarely.
   */
  reference?: ReferenceLine[];
  /**
   * Which entity each account belongs to, and which entities each bank account
   * serves. Nothing reads this for a figure yet; it is recorded so that a
   * per-entity report has something to stand on when it is written.
   */
  entities?: EntityModel;
  /**
   * The chart of accounts, kept so it does not have to be re-uploaded every
   * session just to name an account or assign it to an entity.
   */
  chart?: Account[];
  /** The fixed asset register, for the one figure bank data cannot produce. */
  assets?: FixedAsset[];
  /** Income that never reaches these accounts, entered by hand. */
  taxExtras?: TaxExtra[];
  /**
   * What each account stood at before this ledger begins.
   *
   * A set of books that starts mid-life needs the balances it inherited, or a
   * balance sheet is only the movement since the first bank line and says so
   * nowhere. Kept with the decisions because it is a statement somebody made
   * from the previous year's signed accounts, not something derived from the
   * bank data -- and it must be written back with them, or it is read on open
   * and dropped by the next save.
   */
  openingBalances?: OpeningBalances;
  /**
   * What a disposed asset sold for, excluding GST, by asset number.
   *
   * Kept with the decisions rather than on the asset, because the asset
   * register is re-imported from the accounting system and would overwrite it.
   * The register does not carry proceeds at all -- it has the cost, the rate
   * and the disposal date, and stops there -- so this is the one figure a
   * disposal needs that has to come from somewhere else.
   */
  assetProceeds?: Record<string, Cents>;
  /**
   * Payment-processor payouts read from an Account Transactions export.
   *
   * Kept because the export is the only place the processor's charge id ties
   * the invoice payment, the surcharge and the fee together, and re-reading it
   * every time would mean keeping the file.
   */
  payouts?: Payout[];
  /**
   * Journals a person wrote, which no bank line implies.
   *
   * Year-end judgements: an expense reclassified because the loan turned out
   * to be personal, a GST balance corrected to what Inland Revenue actually
   * holds. Kept with the decisions because that is what they are.
   */
  manualJournals?: ManualJournal[];
  /**
   * The general ledger, when one has been loaded.
   *
   * Bank data gives a cash profit figure; only a ledger carries invoices,
   * bills and year-end journals, which is what an accrual one is made of.
   */
  journals?: Journal[];
  /** Invoices and bills, for matching money to what it settled. */
  invoices?: Invoice[];
  /** What the accounting system says settled each invoice. */
  allocations?: PaymentAllocation[];
  /**
   * Bank transaction id to the invoice it settles.
   *
   * Recorded once a person accepts a match, so it survives reloading the
   * invoice file and is not re-guessed every time.
   */
  invoiceMatches?: Record<string, string>;
  /**
   * Bank transaction id to the opposite leg of the transfer it is half of.
   *
   * Written for both legs, so either one finds its partner in a single lookup
   * and neither can be left pointing at a leg that does not point back.
   */
  transfers?: Record<string, string>;
}

export function emptyLedger(): StoredLedger {
  return { version: 1, legitimateDuplicates: [], removedDuplicates: [], transactions: [] };
}

function openNamed(name: string, create: boolean): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (create && !db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open the database."));
  });
}

/** Every key and value in a store, or nothing if the store is not there. */
async function readAll(db: IDBDatabase): Promise<Array<[IDBValidKey, unknown]>> {
  if (!db.objectStoreNames.contains(STORE)) return [];
  const store = db.transaction(STORE, "readonly").objectStore(STORE);
  const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
    const request = store.getAllKeys();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const values = await new Promise<unknown[]>((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return keys.map((key, index) => [key, values[index]]);
}

/**
 * Bring across whatever the old database held, once.
 *
 * Only when the new one is empty, so it can never overwrite newer work: a
 * browser that has already used the renamed app is left alone. Failure is
 * silent on purpose -- an app that refuses to start because an old database
 * could not be read is worse than one that starts empty and says so.
 */
let migrated = false;

async function migrateFromOldName(fresh: IDBDatabase): Promise<void> {
  if (migrated) return;
  migrated = true;
  try {
    if ((await readAll(fresh)).length > 0) return;
    const old = await openNamed(OLD_DB_NAME, false);
    const rows = await readAll(old);
    if (rows.length > 0) {
      await new Promise<void>((resolve, reject) => {
        const tx = fresh.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        for (const [key, value] of rows) store.put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    }
    old.close();
  } catch {
    // Nothing to bring across, or no permission to look. Carry on.
  }
}

async function open(): Promise<IDBDatabase> {
  const db = await openNamed(DB_NAME, true);
  await migrateFromOldName(db);
  return db;
}

/**
 * Load the ledger.
 *
 * Returns an empty ledger rather than throwing when storage is unavailable --
 * a private window, or a browser configured to block site data. The app still
 * works in that session; it just will not remember anything, and the UI says so.
 */
/**
 * Ask the browser to keep this data.
 *
 * IndexedDB survives closing the tab and the browser without being asked; what
 * it does not survive by default is the browser deciding it needs the space.
 * Storage granted this way is exempt from that: it goes only when the user
 * clears it deliberately.
 *
 * The request is silent in every browser worth using — it is granted on the
 * strength of the site being installed, bookmarked or used repeatedly. A
 * refusal is not an error; it means the data is merely very likely to survive
 * rather than certain to, and the page says so.
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/**
 * The parts a ledger is stored as.
 *
 * One record per kind rather than one record for everything. Changing an
 * account's type used to rewrite two and a half megabytes — every transaction,
 * every journal, every filed return — to change twenty kilobytes of chart.
 * That is harmless at this size and gets slower in exactly the way that is hard
 * to notice until it is bad.
 *
 * The in-memory shape is unchanged: callers still hold one `StoredLedger`, and
 * this is only how it is written down.
 */
const PARTS = [
  "chart",
  "entities",
  "assets",
  "journals",
  "invoices",
  "allocations",
  "invoiceMatches",
  "transfers",
  "reference",
  "taxExtras",
] as const;


/**
 * Where the books actually live.
 *
 * When the app is served by its own local server there is a folder behind it,
 * and that folder is the truth: every change is written there before it counts
 * as saved, and the browser holds only a working copy. When there is no server
 * -- a copy put on a static host to try out -- there is nowhere to write, and
 * the browser is all there is.
 *
 * Which of the two is decided once, by asking, rather than configured. An app
 * that has to be told where its data is will one day be told wrong.
 */
type Backend = "folder" | "browser";

let backend: Backend = "browser";
let folderName = "";

/**
 * The version each part was last read or written at.
 *
 * Sent back with every write so the server can refuse one built on a stale
 * read. Nothing produces a conflict today -- one writer, and the command line
 * is locked out while the server runs -- but this is the seam a shared ledger
 * would need, and it is far cheaper to carry unused than to add later.
 */
const versions = new Map<string, number>();

/**
 * What was last sent for each part, by reference.
 *
 * The app replaces these wholesale rather than mutating them, so an unchanged
 * reference means unchanged content. Comparing references costs nothing;
 * comparing two megabytes of transactions on every keystroke would not.
 */
const lastWritten = new Map<string, unknown>();

/**
 * The parts this session actually read from the folder.
 *
 * A part the app never loaded is a part it cannot have meaningfully changed,
 * so writing one would only ever overwrite a file with whatever the empty
 * ledger happens to hold. That is not hypothetical: it emptied real books
 * during testing.
 */
const loadedParts = new Set<string>();

/** Parts as the folder keeps them: what maps onto which file. */
const FOLDER_PARTS = [
  "transactions",
  "decisions",
  "chart",
  "entities",
  "rules",
  "rulesarchive",
  "invoices",
  "allocations",
  "assets",
  "journals",
  "reference",
  "filed",
  "events",
] as const;

/** The decisions file: everything a person chose, kept together and small. */
function decisionsOf(ledger: StoredLedger): Record<string, unknown> {
  return {
    overrides: ledger.overrides ?? {},
    splits: ledger.splits ?? {},
    invoiceMatches: ledger.invoiceMatches ?? {},
    transfers: ledger.transfers ?? {},
    legitimateDuplicates: ledger.legitimateDuplicates ?? [],
    removedDuplicates: ledger.removedDuplicates ?? [],
    rejectedTransfers: ledger.rejectedTransfers ?? [],
    varianceNotes: ledger.varianceNotes ?? [],
    varianceAccounts: ledger.varianceAccounts ?? [],
    taxExtras: ledger.taxExtras ?? [],
    // Written back with everything else. Left out, the file was read on open
    // and then quietly erased by the first coding anybody confirmed -- the
    // decisions part is rebuilt from this list, so an omission here is a
    // deletion on disk.
    ...(ledger.openingBalances ? { openingBalances: ledger.openingBalances } : {}),
    ...(ledger.assetProceeds ? { assetProceeds: ledger.assetProceeds } : {}),
    ...(ledger.payouts ? { payouts: ledger.payouts } : {}),
    ...(ledger.manualJournals ? { manualJournals: ledger.manualJournals } : {}),
  };
}

/** What each folder part holds, taken from the ledger in memory. */
function partValue(ledger: StoredLedger, part: string): unknown {
  if (part === "transactions") return ledger.transactions;
  if (part === "decisions") return decisionsOf(ledger);
  if (part === "filed") return ledger.filedReturns ?? [];
  if (part === "rules" || part === "rulesarchive" || part === "events") return undefined;
  return (ledger as unknown as Record<string, unknown>)[part];
}

async function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`api/${path}`, { cache: "no-store", ...init });
}

/** Write one part, unless what is in memory is the object already sent. */
async function putPart(part: string, data: unknown): Promise<boolean> {
  if (data === undefined) return true;
  if (lastWritten.get(part) === data) return true;
  try {
    const response = await api(`ledger/parts/${part}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: versions.get(part) ?? 0, data }),
    });
    if (response.status === 409) {
      // Someone else changed it underneath. Take their version so the next
      // write is built on it rather than fighting.
      const body = (await response.json()) as { current?: { version?: number } };
      versions.set(part, body.current?.version ?? 0);
      return false;
    }
    if (!response.ok) return false;
    const body = (await response.json()) as { version: number };
    versions.set(part, body.version);
    lastWritten.set(part, data);
    return true;
  } catch {
    return false;
  }
}

/** Ask whether there is a folder behind this app, and read it if so. */
async function loadFromFolder(): Promise<StoredLedger | null> {
  let status: { writable?: boolean; name?: string } | null = null;
  try {
    const response = await api("status");
    if (!response.ok) return null;
    status = (await response.json()) as { writable?: boolean; name?: string };
  } catch {
    return null;
  }
  if (status?.writable !== true) return null;

  const response = await api("ledger");
  if (!response.ok) return null;
  const body = (await response.json()) as {
    parts: Record<string, { version: number; data: unknown }>;
  };

  const ledger = emptyLedger() as unknown as Record<string, unknown>;
  for (const part of FOLDER_PARTS) {
    const held = body.parts[part];
    if (!held) continue;
    versions.set(part, held.version);
    lastWritten.set(part, held.data);
    loadedParts.add(part);

    if (part === "decisions") {
      const decisions = (held.data ?? {}) as Record<string, unknown>;
      for (const [key, value] of Object.entries(decisions)) ledger[key] = value;
      continue;
    }
    if (part === "transactions") {
      ledger["transactions"] = held.data ?? [];
      continue;
    }
    if (part === "filed") {
      ledger["filedReturns"] = held.data ?? [];
      continue;
    }
    if (part === "rules" || part === "rulesarchive" || part === "events") continue;
    if (part === "entities") {
      // A folder written before the shape was settled, or edited by hand, can
      // hold a bare object. Reading it as "no entities" beats throwing on the
      // first page that iterates them.
      const model = held.data as
        | { entities?: unknown; accounts?: unknown; banks?: unknown }
        | null;
      if (!Array.isArray(model?.entities)) {
        ledger[part] = { entities: [], accounts: {}, banks: {} };
        continue;
      }

      // `banks` maps a bank account to the entities it serves, which is a list
      // even when it holds one. A hand-written file naming a single entity as a
      // bare string got as far as the Reconcile page and then threw on
      // `ids.some`, taking the whole page with it -- so it is widened here,
      // once, rather than guarded at each of the dozen places that read it.
      const banks: Record<string, string[]> = {};
      for (const [account, value] of Object.entries(
        (model.banks ?? {}) as Record<string, unknown>,
      )) {
        if (typeof value === "string") banks[account] = [value];
        else if (Array.isArray(value)) banks[account] = value.filter((v) => typeof v === "string");
        else banks[account] = [];
      }

      // An entity with no id cannot be referred to, and something has to refer
      // to it. The name is what a hand-written file uses, so the id is derived
      // from the name and the references keep working.
      const entities = (model.entities as { id?: string; name?: string }[]).map((entity) => ({
        ...entity,
        id: entity.id ?? entityId(String(entity.name ?? "")),
      }));
      const known = new Map(entities.map((e) => [e.name ?? "", e.id]));
      for (const [account, ids] of Object.entries(banks)) {
        banks[account] = ids.map((id) => known.get(id) ?? id);
      }

      ledger[part] = { ...model, entities, accounts: model.accounts ?? {}, banks };
      continue;
    }
    ledger[part] = held.data;
  }

  backend = "folder";
  folderName = status.name ?? "";
  // The decisions object read back is not the one the app will hold once it
  // spreads the keys out, so nothing may be skipped on the first write.
  lastWritten.delete("decisions");
  return ledger as unknown as StoredLedger;
}

/** The ledgers side by side in the same place, for the picker. */
export async function ledgers(): Promise<
  Array<{ id: string; name: string; transactions: number }>
> {
  if (backend !== "folder") return [];
  try {
    const response = await api("status");
    if (!response.ok) return [];
    const body = (await response.json()) as {
      ledgers?: Array<{ id: string; name: string; transactions: number }>;
    };
    return body.ledgers ?? [];
  } catch {
    return [];
  }
}

/** Which ledger the folder is currently open on. */
export async function currentLedger(): Promise<string> {
  if (backend !== "folder") return "";
  try {
    const response = await api("status");
    if (!response.ok) return "";
    return ((await response.json()) as { ledger?: string }).ledger ?? "";
  } catch {
    return "";
  }
}

/**
 * Open a different set of books.
 *
 * The server moves its lock and starts reading the other folder; the page then
 * reloads rather than trying to swap a ledger out underneath a rendered screen.
 * A reload is a few hundred milliseconds and is obviously correct, which is
 * worth more here than saving them.
 */
export async function switchLedger(id: string, name?: string): Promise<boolean> {
  if (backend !== "folder") return false;
  try {
    const response = await api("ledger/switch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ledger: id, ...(name !== undefined ? { name } : {}) }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Which folder this browser is a working copy of, for the app to show. */
export function ledgerName(): string {
  return folderName;
}

/** True when there is a folder behind the app rather than only a browser. */
export function writesToFolder(): boolean {
  return backend === "folder";
}

export type LedgerPart = (typeof PARTS)[number];

/** Everything not split out: the transactional record and its decisions. */
type CoreLedger = Omit<StoredLedger, LedgerPart>;

export async function load(): Promise<{ ledger: StoredLedger; persistent: boolean }> {
  // The folder first, when there is one: it is the truth, and the browser copy
  // is only what is left of the last time the app ran.
  const fromFolder = await loadFromFolder();
  if (fromFolder !== null) return { ledger: fromFolder, persistent: true };

  try {
    const db = await open();
    const read = <T>(key: string): Promise<T | undefined> =>
      new Promise((resolve, reject) => {
        const request = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
        request.onsuccess = () => resolve(request.result as T | undefined);
        request.onerror = () => reject(request.error);
      });

    const core = await read<CoreLedger>(KEY);
    const ledger = { ...emptyLedger(), ...(core ?? {}) } as StoredLedger;

    // Anything written before the split still lives on the core record, so a
    // part is only read separately when it is not already there.
    for (const part of PARTS) {
      if (ledger[part] !== undefined) continue;
      const value = await read<unknown>(`ledger:${part}`);
      if (value !== undefined) (ledger as unknown as Record<string, unknown>)[part] = value;
    }

    db.close();
    return { ledger, persistent: true };
  } catch {
    return { ledger: emptyLedger(), persistent: false };
  }
}

/** Write the whole ledger, every part. Used on import and first run. */
export async function save(ledger: StoredLedger): Promise<boolean> {
  if (backend === "folder") return writeFolder(ledger, FOLDER_PARTS);
  return write(ledger, PARTS);
}

/**
 * Write to the folder, skipping the parts that did not change.
 *
 * Callers say "save the ledger" without saying what moved, so the unchanged
 * parts are recognised rather than declared -- which is what keeps confirming
 * one coding from rewriting two megabytes of transactions beside it.
 */
async function writeFolder(
  ledger: StoredLedger,
  parts: readonly string[],
): Promise<boolean> {
  let ok = true;
  for (const part of parts) {
    const value = partValue(ledger, part);
    if (value === undefined) continue;
    // Never a part this session did not read. `filed` and `transactions` have
    // a fallback of an empty list, so without this a page that never loaded
    // them would write those empty lists straight over the files.
    if (!loadedParts.has(part) && !changedParts.has(part)) continue;
    if (!(await putPart(part, value))) ok = false;
  }
  return ok;
}

/**
 * Parts the app has deliberately created since loading.
 *
 * A ledger that starts empty has nothing to read, so nothing may be written
 * until something is imported -- at which point that part becomes writable.
 */
const changedParts = new Set<string>();

/** Say that a part now holds something worth writing, loaded or not. */
export function partChanged(...parts: readonly string[]): void {
  for (const part of parts) changedParts.add(part);
}

/**
 * Write only the parts that changed.
 *
 * The point of the split: coding a transaction writes the codings, not the
 * chart of accounts and the general ledger along with them.
 */
export async function savePart(
  ledger: StoredLedger,
  ...parts: readonly LedgerPart[]
): Promise<boolean> {
  if (backend === "folder") {
    // A named part still goes through the same routine, because the decisions
    // file has to be written whatever else changed: a coding and a chart edit
    // both arrive here naming only what the caller thought moved.
    return writeFolder(ledger, [...parts, "transactions", "decisions"]);
  }
  return write(ledger, parts);
}

async function write(
  ledger: StoredLedger,
  parts: readonly LedgerPart[],
): Promise<boolean> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);

      // The core record never carries the split parts, or they would be
      // written twice and could disagree with each other.
      const core = { ...ledger } as unknown as Record<string, unknown>;
      for (const part of PARTS) delete core[part];
      store.put(core, KEY);

      for (const part of parts) {
        const value = ledger[part];
        if (value === undefined) store.delete(`ledger:${part}`);
        else store.put(value, `ledger:${part}`);
      }

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
    return true;
  } catch {
    return false;
  }
}

/**
 * A rule set, with where it came from.
 *
 * Rules are kept separately from the ledger because they belong to different
 * lifetimes: the ledger is a record of what happened, a rule set is a working
 * opinion about how to code it, and either can be replaced without the other.
 */
export interface StoredRules {
  version: 1;
  /** The file it was loaded from, for saying what is in use. */
  name: string;
  loadedAt: string;
  rules: RuleSet;
}

/**
 * Rule sets that have been replaced.
 *
 * Replacing a rule set changes how every uncoded line is suggested, so the one
 * being displaced is kept rather than dropped. Getting it back should not
 * depend on the user still having the file.
 */
export interface RulesArchive {
  version: 1;
  entries: { name: string; replacedAt: string; rules: RuleSet }[];
}

/** A dated copy of these books, kept when they were cleared or restored over. */
export interface LedgerArchive {
  /** Folder name, which is the moment it was taken: `2026-09-04-13-05-54`. */
  stamp: string;
  transactions: number;
  invoices: number;
  accounts: number;
}

/**
 * The copies kept beside these books, newest first.
 *
 * Only when the folder is the truth. A browser-backed ledger keeps no copies,
 * so there is nothing to list and nothing to promise.
 */
export async function listArchives(ledger = ""): Promise<LedgerArchive[]> {
  if (backend !== "folder") return [];
  try {
    const where = ledger === "" ? "" : `?ledger=${encodeURIComponent(ledger)}`;
    const response = await api(`ledger/archives${where}`);
    if (!response.ok) return [];
    const body = (await response.json()) as { archives?: LedgerArchive[] };
    return body.archives ?? [];
  } catch {
    return [];
  }
}

/** Put a dated copy back, keeping a copy of what it replaces. */
export async function restoreArchive(stamp: string, ledger = ""): Promise<boolean> {
  if (backend !== "folder") return false;
  try {
    const response = await api("ledger/restore", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stamp, ...(ledger === "" ? {} : { ledger }) }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Clear another set of books, without opening it.
 *
 * The same archive-then-empty as clearing the open one, aimed elsewhere. The
 * server refuses a folder another NZOSA is holding, because clearing books
 * somebody else is writing to is how two processes end up disagreeing about
 * what the books are.
 *
 * Nothing local is touched: the caller is not looking at these books, so there
 * is no working copy to keep in step.
 */
export async function archiveOther(ledger: string): Promise<{ ok: boolean; why: string }> {
  if (backend !== "folder") return { ok: false, why: "There is no folder behind this app." };
  try {
    const response = await api("ledger/archive", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ledger }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      ledger?: string;
    };
    if (!response.ok) return { ok: false, why: body.error ?? "Those books could not be cleared." };

    // An older NZOSA takes no notice of which books were named and clears
    // whichever ones are open. Refusing on the answer rather than trusting the
    // request is what stops "clear the spare set" from clearing the set in
    // front of you, in the one situation where that is possible: a server left
    // running from before this existed.
    if (body.ledger !== ledger) {
      return {
        ok: false,
        why:
          "This NZOSA is running an older server, which would clear whichever " +
          "books are open rather than the ones you chose. Nothing has been " +
          "cleared. Stop NZOSA and start it again, then try once more.",
      };
    }
    return { ok: true, why: "" };
  } catch (error) {
    return { ok: false, why: (error as Error).message };
  }
}

/**
 * Empty the store completely.
 *
 * Every key, not a list of the ones we know about: a key added by a later
 * version and forgotten here would survive a clear and reappear attached to a
 * book that no longer exists. Clearing the object store cannot miss one.
 */
export async function clearStore(): Promise<boolean> {
  if (backend === "folder") {
    try {
      // The content type is required by the server on anything that changes
      // something, even with no body: it is what a cross-site form cannot set.
      const response = await api("ledger/archive", {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      if (!response.ok) return false;
      versions.clear();
      lastWritten.clear();
      loadedParts.clear();
      // The files are gone, so writing an empty part is now the truth rather
      // than an accident, and every part is fair game again.
      for (const part of FOLDER_PARTS) changedParts.add(part);
      return true;
    } catch {
      return false;
    }
  }
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
    return true;
  } catch {
    return false;
  }
}

/** A part read straight from the folder, or null when there is no folder. */
async function folderPart<T>(part: string): Promise<T | null> {
  if (backend !== "folder") return null;
  try {
    const response = await api("ledger");
    if (!response.ok) return null;
    const body = (await response.json()) as {
      parts: Record<string, { version: number; data: unknown }>;
    };
    const held = body.parts[part];
    if (!held) return null;
    versions.set(part, held.version);
    lastWritten.set(part, held.data);
    return held.data as T;
  } catch {
    return null;
  }
}

export async function loadRules(): Promise<StoredRules | null> {
  if (backend === "folder") {
    const held = await folderPart<Record<string, unknown> | null>("rules");
    if (held === null || Object.keys(held).length === 0) return null;
    // A rule file dropped into the folder by hand is the rule set itself, with
    // a `rules` array in it. One this app wrote is that set wrapped with where
    // it came from. Accept either, so an editable file in the folder works.
    if (Array.isArray(held["rules"])) {
      return { version: 1, rules: held as unknown as RuleSet, name: "rules.json", loadedAt: "" };
    }
    return held as unknown as StoredRules;
  }
  try {
    const db = await open();
    const stored = await new Promise<StoredRules | undefined>((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(RULES_KEY);
      request.onsuccess = () => resolve(request.result as StoredRules | undefined);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return stored ?? null;
  } catch {
    return null;
  }
}

export async function saveRules(stored: StoredRules | null): Promise<boolean> {
  if (backend === "folder") return putPart("rules", stored ?? {});
  return put(RULES_KEY, stored);
}

export async function loadRulesArchive(): Promise<RulesArchive> {
  if (backend === "folder") {
    const held = await folderPart<RulesArchive>("rulesarchive");
    return held && Array.isArray(held.entries) ? held : { version: 1, entries: [] };
  }
  try {
    const db = await open();
    const stored = await new Promise<RulesArchive | undefined>((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(ARCHIVE_KEY);
      request.onsuccess = () => resolve(request.result as RulesArchive | undefined);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return stored ?? { version: 1, entries: [] };
  } catch {
    return { version: 1, entries: [] };
  }
}

export async function saveRulesArchive(archive: RulesArchive): Promise<boolean> {
  if (backend === "folder") return putPart("rulesarchive", archive);
  return put(ARCHIVE_KEY, archive);
}

async function put(key: string, value: unknown): Promise<boolean> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      if (value === null) tx.objectStore(STORE).delete(key);
      else tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
    return true;
  } catch {
    return false;
  }
}

/** Delete everything. Used by the "clear" control, which always confirms first. */
export async function clear(): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/**
 * The change log, and who is making the changes.
 *
 * Both live outside the ledger on purpose. The log is local history rather
 * than part of the record, so an exported ledger does not carry it; the name
 * belongs to this browser rather than to the books.
 */
export async function loadEvents(): Promise<LedgerEvent[]> {
  if (backend === "folder") {
    const held = await folderPart<LedgerEvent[]>("events");
    return Array.isArray(held) ? held : [];
  }
  try {
    const db = await open();
    const events = await new Promise<LedgerEvent[] | undefined>((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(EVENTS_KEY);
      request.onsuccess = () => resolve(request.result as LedgerEvent[] | undefined);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return events ?? [];
  } catch {
    return [];
  }
}

export async function saveEvents(events: readonly LedgerEvent[]): Promise<boolean> {
  if (backend === "folder") return putPart("events", events);
  return put(EVENTS_KEY, events);
}

export async function loadUser(): Promise<string> {
  try {
    const db = await open();
    const who = await new Promise<string | undefined>((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(USER_KEY);
      request.onsuccess = () => resolve(request.result as string | undefined);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return who ?? "";
  } catch {
    return "";
  }
}

export async function saveUser(who: string): Promise<boolean> {
  return put(USER_KEY, who);
}
