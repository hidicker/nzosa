import { applyPartOps, copySize, entityId, partChanges, partCopy, writeQueue } from "@nzosa/core";
import type { AbaSettings, CreditApplication, InvoiceMessage, JobsHeld, WordingKind } from "@nzosa/core";
import type { PartCopy, PartOp } from "@nzosa/core";
import type {
  AuPayroll,
  Item,
  BankLayout,
  StockCount,
  TimeEntry,
  BankReconciliation,
  Contact,
  LeaveSettings,
  LeaveTaken,
  AgentStatement,
  Prepayment,
  Tenancy,
  VehicleUse,
  TripLog,
  Ir3Details,
  FiledIncomeReturn,
  Account, BalanceSection, Cents, LineChoice, DonationReceipt, Grant, Ir9Inputs, Ir7Inputs, Ir4Inputs, SocietyInputs, TrustInputs, PerformanceInputs, PropertyCare, Tier4Line, Employee, EntityModel, FixedAsset, Invoice, Journal, LockDates, ManualJournal, OpeningDocuments,
  PayRun, PaymentAllocation, Payout, PayrollContact, RecurringInvoice, TaxExtra,
} from "@nzosa/core";

import type {
  FiledReturn,
  IrdRecord,
  OpeningBalances,
  ReferenceLine,
  Overrides,
  RuleSet,
  SalesTaxRate,
  Splits,
  Transaction,
  VarianceNote,
} from "@nzosa/core";
import type { LedgerEvent } from "./events.js";
import { MAX_EVENTS } from "./events.js";
import { cloudConfigured } from "./cloud-config.js";
import { currentSession, loadPart as loadCloudPart, loadNamedParts, loadParts as loadCloudParts, rpc, saveChanges as saveCloudChanges, savePart as saveCloudPart, signedIn } from "./cloud.js";
import type { PartChange, SaveOutcome } from "./cloud.js";

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

/**
 * Payroll, kept as a part of its own: the employer's details, the employees,
 * and every pay run as it was worked out. A pay run's figures are stored, not
 * recomputed, because they are what was paid and filed; its journal is derived
 * from them each time, like depreciation's.
 */
export interface PayrollData {
  employerIrd?: string | undefined;
  /** Who IR should contact about the payday filing return. */
  contact?: PayrollContact | undefined;
  /** Chart codes a pay run posts to; until wages, wages payable and PAYE payable are set, none post. */
  accounts?: {
    wages?: string | undefined;
    kiwiSaverExpense?: string | undefined;
    wagesPayable?: string | undefined;
    payePayable?: string | undefined;
    kiwiSaverPayable?: string | undefined;
  } | undefined;
  employees: Employee[];
  payRuns: PayRun[];
  /** Leave taken, under the Holidays Act, that balances are worked from. */
  leave?: LeaveTaken[] | undefined;
  /** Each employee's days a week, pay-as-you-go 8%, and opening balances. */
  leaveSettings?: LeaveSettings[] | undefined;
  /** The account wages are paid from, for the bank's bulk payment file. */
  payFrom?: string | undefined;
}

/** A filed return as kept: whose it is, and where it was read from. */
/** A myIR record, and whose it is: an entity's account, or an owner's IR3. */
export type StoredIrdRecord = IrdRecord & {
  id: string;
  entityId?: string;
  owner?: string;
  file: string;
  savedAt: string;
};

/** One answer on a person's year-end checklist. */
export interface PersonalYearAnswer {
  answer: "yes" | "no" | "na";
  detail?: string;
}

export type StoredIncomeReturn = FiledIncomeReturn & {
  /** A company's: the entity it is for; absent in books of one. */
  entityId?: string;
  /** An individual's: whose return it is, as the entities name their owners. */
  owner?: string;
  /** When it was read in, and from what. */
  savedAt: string;
  source: string;
};

/**
 * Who files these books' returns.
 *
 * A tax agent changes the dates: an individual's return is due 7 July without
 * one and up to 31 March of the next year with one (an extension of time), and
 * terminal tax moves from 7 February to 7 April. Undefined means nobody has said.
 */
export interface Filing {
  taxAgent: boolean;
  /** The agent or accountant, for the record. */
  agentName?: string;
}

export interface StoredLedger {
  version: 1;
  /**
   * The country these books are kept in (core's `JurisdictionId`). Undefined
   * is New Zealand, as every set kept before this existed is.
   */
  jurisdiction?: string;
  filing?: Filing;
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
  /** Customers and vendors, looked up by name from invoices and bills. */
  contacts?: Contact[];
  /** Files attached to documents: which, and what each is. The bytes are kept apart (see putAttachmentFile). */
  attachments?: Attachment[] | undefined;
  /** Registers typed into, by account id, kept even before their first line. */
  registers?: string[] | undefined;
  /** Time must be approved before it is invoiced. */
  timeApproval?: boolean | undefined;
  /** Messages kept to print on invoices, one of them the default. */
  invoiceMessages?: InvoiceMessage[] | undefined;
  /** The person's own wording for invoice, statement and reminder emails, where they changed it. */
  emailWording?: Partial<Record<WordingKind, { subject: string; body: string }>> | undefined;
  /** Paying bills by bank file: the account they leave from, and for Australia the ABA details. */
  billPayment?: { payFrom?: string; aba?: AbaSettings } | undefined;
  /** Bank statements an account has been reconciled to, and the lines each cleared. */
  reconciliations?: BankReconciliation[];
  /** Annual budgets in cents: year, then account code. */
  budgets?: Record<string, Record<string, number>>;
  /** Products and services, offered when an invoice line is written. */
  items?: Item[];
  /** Classes: their names, and the class each source of income or expense is given. */
  classes?: { names: string[]; assigned: Record<string, string> };
  /** Jobs done for customers, and which postings belong to each. */
  jobs?: JobsHeld;
  /** Time worked for customers, until it is invoiced. */
  timeEntries?: TimeEntry[];
  /** Stock counted, and the journal each put the inventory account to. */
  stockCounts?: StockCount[];
  /** United States sales tax rates, each owed in its own liability account. */
  salesTaxRates?: SalesTaxRate[];
  /** Bank file layouts pointed out by hand, by the file's headings, with the account their lines go on. */
  bankLayouts?: Record<string, { layout: BankLayout; account: string; accountLabel: string }>;
  /** What an individual's return needs that the books cannot know, by owner and year. */
  ir3Details?: Ir3Details[];
  /**
   * Which rentals each line of an individual's filed IR3 covers, by owner and
   * the line's own name: "Residential" is a portfolio of properties and
   * "Other rental" is net rents, neither named for one property.
   */
  ir3RentalCovers?: Record<string, string[]>;
  /** The year-end checklist's answers, by owner, year and question. */
  personalYearAnswers?: Record<string, PersonalYearAnswer>;
  /**
   * Income tax returns as filed, read in from myIR, by entity and balance
   * date. What the books cannot work out -- the loss carried forward, the
   * imputation balance, last year's residual income tax -- comes from these.
   */
  incomeReturns?: StoredIncomeReturn[];
  /**
   * What Inland Revenue holds, as downloaded from myIR: returns, tax account
   * transactions, the employer summary, an IR3's confirmation. Kept so they
   * are checked against these books every time the page opens, not once.
   */
  irdRecords?: StoredIrdRecord[];
  /**
   * Xero's number for each of its bank accounts, by the name Xero gives it:
   * the whole account number, a card's last four digits, PayPal's id. What
   * links a chart bank row to its bank feed when the names share nothing.
   */
  xeroBankNumbers?: Record<string, string>;
  /**
   * The invoices and bills open the day before the books start, from the old
   * system's aged receivables and payables detail: one list for each kind.
   * What decides which earlier documents are still in play.
   */
  openingDocuments?: OpeningDocuments[];
  /** Said on setting up: every account held nothing on the day the books start. */
  startedAtNothing?: boolean;
  /** Property managers' statements, each posting what the manager did with the rent. */
  agentStatements?: AgentStatement[];
  /** How much each vehicle is used for the business, by entity and year. */
  vehicleUse?: VehicleUse[];
  /** Trips in the owners' own vehicles, claimed at the kilometre rates. */
  tripLog?: TripLog;
  /**
   * Modules chosen on or off. Absent ones follow the books (see modules.ts);
   * this holds only what somebody chose.
   */
  modules?: Partial<Record<string, boolean>>;
  /** Tenancies, for tracking rent owed against rent paid. */
  tenancies?: Tenancy[];
  /** Each rental property's jobs and issues, and its Healthy Homes and insurance ticks, by entity. */
  propertyCare?: Record<string, PropertyCare>;
  /** A not-for-profit's grants, and which bank lines belong to which (see core's grants.ts). */
  grants?: Grant[];
  grantLinks?: Record<string, string>;
  /** Donation receipts issued, cancelled ones kept, for seven years (see core's donation-receipts.ts). */
  donationReceipts?: DonationReceipt[];
  /** A not-for-profit's yearly Performance Report inputs, by `entity:year`, and where its accounts go. */
  performanceReports?: Record<string, PerformanceInputs>;
  tier4Lines?: Record<string, Tier4Line>;
  /** A club or society's IR9 worksheet choices, by `entity:year`. */
  ir9Returns?: Record<string, Ir9Inputs>;
  /** A trust's IR6 choices and beneficiary accounts, by `entity:year` (see core's trust.ts). */
  trustReturns?: Record<string, TrustInputs>;
  /** A partnership or look-through company's IR7 choices, by `entity:year` (see core's ir7.ts). */
  ir7Returns?: Record<string, Ir7Inputs>;
  /** A company's IR4 and imputation credit account choices, by `entity:year` (see core's ir4.ts). */
  ir4Returns?: Record<string, Ir4Inputs>;
  /** A society's reporting standard and its small-society or Tier 3 statements' inputs, by `entity:year`. */
  societyReports?: Record<string, SocietyInputs>;
  /** Payments that buy something running past a balance date. */
  prepayments?: Prepayment[];
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
   * Credit note number to the invoice it credits.
   *
   * Nominated by a person rather than read from the file: an accounting
   * system's export does not carry the link -- the reference is free text --
   * and guessing from the contact and the amount would settle the wrong
   * invoice quietly, which is worse than leaving it unapplied.
   */
  creditNotes?: Record<string, string>;
  /**
   * Credit held on account and applied in parts: by the credit note or the
   * overpaid document it came from, the documents it went to and how much.
   */
  creditApplications?: Record<string, CreditApplication[]>;
  /**
   * Bank transaction id to the opposite leg of the transfer it is half of.
   *
   * Written for both legs, so either one finds its partner in a single lookup
   * and neither can be left pointing at a leg that does not point back.
   */
  transfers?: Record<string, string>;
  singleEntityConfirmed?: boolean;
  /** Whether these books may be described to a model at all. Off until asked. */
  aiEnabled?: boolean;
  /**
   * Ask the AI about waiting lines each time these books open, on a key of the
   * owner's own. Off until turned on.
   */
  aiAutoSuggest?: boolean;
  /**
   * Get these books ready every morning: check the bank feed and suggest codes
   * for waiting lines on the owner's own key, before anybody opens them. What
   * the morning finds waits beside the books (see nightly.ts) until they are
   * opened; nothing goes into them unattended. Off until turned on.
   */
  nightly?: boolean;
  /**
   * The bank's own balance, day by day, as last loaded for each account. Kept
   * so the check can be run again against the books as they stand -- the
   * answer is worked out each time, never stored.
   */
  dailyBalances?: BalanceSection[];
  /**
   * Bank feed lines dated in the week before the books start, held for a
   * decision rather than dropped: a card payment made on the 30th and cleared
   * by the bank on the 1st belongs to these books, and its date says otherwise.
   */
  beforeStart?: Transaction[];
  /** The feed ids of those left out, so a later fetch does not offer them again. */
  beforeStartLeft?: string[];
  /** Periods that are finished: filed GST returns, and years signed off. */
  lockDates?: LockDates;
  /**
   * How far each lock has ever reached. A lock moved back leaves the period
   * it opened marked, so a change made there while it was open is reported.
   */
  lockedOnce?: LockDates;
  /**
   * Bank lines that arrived dated in a locked period, held for a decision
   * rather than posted there: a feed line from last month after its return
   * was filed would otherwise change the return.
   */
  lockedArrivals?: Transaction[];
  /**
   * For each confirmed line that passes money between entities: whose money
   * paid it and how it is recorded, as settled when it was confirmed. See
   * core's between-entities.ts.
   */
  betweenLines?: Record<string, LineChoice>;
  /**
   * The day these books began keeping each confirmed line's own GST, whatever
   * the entity's registration later says. Before it, an unregistered entity's
   * lines showed no GST whatever was stored with them; the step that set this
   * stored "no GST" on those lines, so nothing moved.
   */
  gstKeptFrom?: string;
  /** Actions required, put off until a day: item to the day it comes back. */
  snoozed?: Record<string, string>;
  /** Unmatched lines in external reference exports (e.g. Xero) dismissed with a reason. Key is line key -> { reason, at }. */
  ignoredReference?: Record<string, { reason: string; at: string }>;
  /** What these books are, for the briefing that goes with every question. */
  booksAbout?: string;
  payroll?: PayrollData;
  /** Australian payroll: employees, pay runs, PAYG withheld and super. Kept with the decisions. */
  auPayroll?: AuPayroll;
  /** Invoices set to repeat. Kept with the decisions: a person chose them. */
  recurring?: RecurringInvoice[];
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

/**
 * The online demo keeps its books apart from the app's.
 *
 * The two are served from the same site, so they share the browser's storage
 * for it: under one name, the app opened whatever the demo had loaded, and the
 * demo opened -- and offered the shared AI pool -- books somebody kept in the
 * hosted app. Found in the review of 5 October 2026.
 */
const DEMO_DB_NAME = "nzosa-demo";
const inDemo = (): boolean =>
  typeof document !== "undefined" && document.documentElement.dataset["demo"] === "yes";

async function open(): Promise<IDBDatabase> {
  if (inDemo()) return openNamed(DEMO_DB_NAME, true);
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
  "payroll",
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
type Backend = "folder" | "browser" | "cloud";

let backend: Backend = "browser";
let folderName = "";
// The folder itself, which the display name is free to differ from.
let folderId = "";
// When that folder was made: a deleted folder remade under the same name is a new set.
let folderCreated = "";

/**
 * Which hosted books are open, when the books are hosted.
 *
 * Kept in this browser rather than with the books themselves: which set
 * somebody last had open is a fact about them and this screen, and the books
 * are on a server that several people may reach from several computers.
 */
const CLOUD_BOOK_KEY = "nzosa:cloud-book";
let cloudBook: { id: string; name: string } | null = null;

/**
 * Every part the server handed over when these books were opened.
 *
 * Kept whole so the rules, the rule sets they replaced and the history can be
 * read from it. They are parts like any other on the server, but the app asks
 * for them separately, and asking again for what was just sent would be a
 * second request that could disagree with the first.
 */
let cloudParts: Record<string, { version: number; data: unknown }> = {};

function rememberedCloudBook(): { id: string; name: string } | null {
  try {
    const raw = localStorage.getItem(CLOUD_BOOK_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as { id?: string; name?: string };
    return typeof parsed.id === "string" && parsed.id !== ""
      ? { id: parsed.id, name: String(parsed.name ?? "") }
      : null;
  } catch {
    return null;
  }
}

/**
 * Whether the person signed in may only read the books open.
 *
 * The server is what stops them: save_part refuses anybody but an owner,
 * bookkeeper or accountant. This is so the page does not let them work
 * on a change that can never be written -- it refuses at once instead, and
 * says why. Not knowing the role (the list could not be read) counts as read
 * only, the same direction the server errs in.
 */
let readOnly = false;

export function booksReadOnly(): boolean {
  return readOnly;
}

/**
 * Write nothing, from here on. For the morning run, which reads the books to
 * work out what is waiting and must never save them: it has no person behind
 * it to attribute a change to, and the books may be open somewhere else.
 */
export function holdWrites(): void {
  readOnly = true;
}

async function readOnlyMember(bookId: string): Promise<boolean> {
  const me = currentSession()?.userId ?? "";
  const rows = await rpc<{ user_id: string; role: string }[]>("book_member_list", { book: bookId });
  const mine = rows?.find((row) => row.user_id === me);
  return mine === undefined || mine.role === "readonly";
}

/** Open a set of hosted books, or none. The page reloads around it, as switching always does. */
export function openCloudBook(book: { id: string; name: string } | null): void {
  try {
    if (book === null) localStorage.removeItem(CLOUD_BOOK_KEY);
    else localStorage.setItem(CLOUD_BOOK_KEY, JSON.stringify(book));
  } catch {
    // Not remembered, so the picker asks again next time.
  }
  cloudBook = book;
}

/** Which set of hosted books is open, for a screen that has to say. */
export function openCloudBookId(): string {
  return (cloudBook ?? rememberedCloudBook())?.id ?? "";
}

/** What the open set of hosted books is called. */
export function openCloudBookName(): string {
  return (cloudBook ?? rememberedCloudBook())?.name ?? "";
}

/** Where the books this session is holding actually live. */
export function backendKind(): Backend {
  return backend;
}

/**
 * A save that did not happen, and somebody to tell.
 *
 * Failing to save to a server is not like failing to save in a browser. The
 * usual reason is that these books have moved on somewhere else -- another
 * computer, a colleague, another tab -- and this page is holding work built on
 * what has since been replaced. Nothing here is thrown away: the page keeps
 * what it has. But carrying on in silence would let somebody code all
 * afternoon into a copy that can never be written, which is exactly the way to
 * lose a day's work while being told nothing.
 *
 * Reported through a handler rather than drawn here, because storage has no
 * business knowing what a banner is.
 */
export interface SaveTrouble {
  /** "offline": NZOSA on this computer did not answer, and it is tried again. */
  kind: "conflict" | "refused" | "failed" | "offline";
  why: string;
}

let tellAboutTrouble: (trouble: SaveTrouble) => void = () => {};

export function onSaveTrouble(handler: (trouble: SaveTrouble) => void): void {
  tellAboutTrouble = handler;
}

let tellSavedAgain: () => void = () => {};

/** Told when every part that failed to save has since been saved. */
export function onSavedAgain(handler: () => void): void {
  tellSavedAgain = handler;
}

/**
 * Parts whose last write failed and has not been made good since.
 *
 * A tick on Reconcile moves on before its save is answered, so by the time a
 * write fails nothing is pending any more, and leaving the page would lose the
 * change without a word. Set by a failed write, cleared by a later one of the
 * same part that succeeds.
 */
const unsavedParts = new Set<string>();

/** Whether a change made here has not reached where the books are kept. */
export function hasUnsavedChanges(): boolean {
  return unsavedParts.size > 0;
}

function markUnsaved(part: string): void {
  unsavedParts.add(part);
}

function markSaved(part: string): void {
  if (!unsavedParts.delete(part)) return;
  if (unsavedParts.size === 0) tellSavedAgain();
}

/**
 * Folder writes that failed because nothing answered, held to try again.
 *
 * Only those: a 409 means these books moved on somewhere else, and sending
 * the same thing again would be refused again (or worse, overwrite it). The
 * latest value for each part is kept, so a retry sends what is in memory now.
 */
const retryParts = new Map<string, unknown>();
let retryTimer: ReturnType<typeof setTimeout> | null = null;
const RETRY_EVERY_MS = 10_000;

function retryLater(part: string, data: unknown): void {
  retryParts.set(part, data);
  if (retryTimer === null) retryTimer = setTimeout(() => void retryNow(), RETRY_EVERY_MS);
}

async function retryNow(): Promise<void> {
  if (retryTimer !== null) clearTimeout(retryTimer);
  retryTimer = null;
  const held = [...retryParts];
  retryParts.clear();
  // Each goes back through putPart, which holds it again if it still fails.
  for (const [part, data] of held) await putPart(part, data);
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    if (retryParts.size > 0) void retryNow();
  });
}

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
 * One write to the server at a time.
 *
 * Each write says which version of the part it was built on, and the server
 * refuses one built on a version it no longer holds. Two saves started
 * together -- the steps that run as the books open, a change made while one
 * is still going -- both claimed the same version, and the second was refused
 * as if somebody else had changed the books ("These books changed somewhere
 * else"). Queued, each write reads the version the one before it left.
 */
const writes = writeQueue();
function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  return writes.run(work);
}

/**
 * How many writes to the books are still queued or on their way.
 *
 * A tick on Reconcile no longer waits for its save before the page moves on,
 * so leaving the page straight after has to be warned about while any is.
 */
export function savesPending(): number {
  return writes.pending();
}

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
  "payroll",
] as const;

/** The decisions file: everything a person chose, kept together and small. */
function decisionsOf(ledger: StoredLedger): Record<string, unknown> {
  return {
    overrides: ledger.overrides ?? {},
    splits: ledger.splits ?? {},
    invoiceMatches: ledger.invoiceMatches ?? {},
    creditNotes: ledger.creditNotes ?? {},
    transfers: ledger.transfers ?? {},
    legitimateDuplicates: ledger.legitimateDuplicates ?? [],
    removedDuplicates: ledger.removedDuplicates ?? [],
    rejectedTransfers: ledger.rejectedTransfers ?? [],
    varianceNotes: ledger.varianceNotes ?? [],
    varianceAccounts: ledger.varianceAccounts ?? [],
    taxExtras: ledger.taxExtras ?? [],
    ...(ledger.contacts && ledger.contacts.length > 0 ? { contacts: ledger.contacts } : {}),
    ...(ledger.reconciliations && ledger.reconciliations.length > 0 ? { reconciliations: ledger.reconciliations } : {}),
    ...(ledger.budgets && Object.keys(ledger.budgets).length > 0 ? { budgets: ledger.budgets } : {}),
    ...(ledger.items && ledger.items.length > 0 ? { items: ledger.items } : {}),
    ...(ledger.timeEntries && ledger.timeEntries.length > 0 ? { timeEntries: ledger.timeEntries } : {}),
    ...(ledger.auPayroll && (ledger.auPayroll.employees.length > 0 || ledger.auPayroll.payRuns.length > 0) ? { auPayroll: ledger.auPayroll } : {}),
    ...(ledger.stockCounts && ledger.stockCounts.length > 0 ? { stockCounts: ledger.stockCounts } : {}),
    ...(ledger.salesTaxRates && ledger.salesTaxRates.length > 0 ? { salesTaxRates: ledger.salesTaxRates } : {}),
    ...(ledger.bankLayouts && Object.keys(ledger.bankLayouts).length > 0 ? { bankLayouts: ledger.bankLayouts } : {}),
    ...(ledger.classes && (ledger.classes.names.length > 0 || Object.keys(ledger.classes.assigned).length > 0) ? { classes: ledger.classes } : {}),
    ...(ledger.jobs && (ledger.jobs.jobs.length > 0 || Object.keys(ledger.jobs.assigned).length > 0) ? { jobs: ledger.jobs } : {}),
    ...(ledger.ir3Details ? { ir3Details: ledger.ir3Details } : {}),
    ...(ledger.ir3RentalCovers ? { ir3RentalCovers: ledger.ir3RentalCovers } : {}),
    ...(ledger.personalYearAnswers ? { personalYearAnswers: ledger.personalYearAnswers } : {}),
    ...(ledger.incomeReturns ? { incomeReturns: ledger.incomeReturns } : {}),
    ...(ledger.irdRecords ? { irdRecords: ledger.irdRecords } : {}),
    ...(ledger.xeroBankNumbers ? { xeroBankNumbers: ledger.xeroBankNumbers } : {}),
    ...(ledger.openingDocuments ? { openingDocuments: ledger.openingDocuments } : {}),
    ...(ledger.agentStatements ? { agentStatements: ledger.agentStatements } : {}),
    ...(ledger.vehicleUse ? { vehicleUse: ledger.vehicleUse } : {}),
    ...(ledger.tripLog ? { tripLog: ledger.tripLog } : {}),
    ...(ledger.modules ? { modules: ledger.modules } : {}),
    ...(ledger.tenancies ? { tenancies: ledger.tenancies } : {}),
    ...(ledger.propertyCare ? { propertyCare: ledger.propertyCare } : {}),
    ...(ledger.grants ? { grants: ledger.grants } : {}),
    ...(ledger.grantLinks ? { grantLinks: ledger.grantLinks } : {}),
    ...(ledger.donationReceipts ? { donationReceipts: ledger.donationReceipts } : {}),
    ...(ledger.performanceReports ? { performanceReports: ledger.performanceReports } : {}),
    ...(ledger.tier4Lines ? { tier4Lines: ledger.tier4Lines } : {}),
    ...(ledger.ir9Returns ? { ir9Returns: ledger.ir9Returns } : {}),
    ...(ledger.trustReturns ? { trustReturns: ledger.trustReturns } : {}),
    ...(ledger.ir7Returns ? { ir7Returns: ledger.ir7Returns } : {}),
    ...(ledger.ir4Returns ? { ir4Returns: ledger.ir4Returns } : {}),
    ...(ledger.societyReports ? { societyReports: ledger.societyReports } : {}),
    ...(ledger.prepayments ? { prepayments: ledger.prepayments } : {}),
    ...(ledger.filing ? { filing: ledger.filing } : {}),
    ...(ledger.jurisdiction ? { jurisdiction: ledger.jurisdiction } : {}),
    // Written back with everything else. Left out, the file was read on open
    // and then quietly erased by the first coding anybody confirmed -- the
    // decisions part is rebuilt from this list, so an omission here is a
    // deletion on disk.
    ...(ledger.openingBalances ? { openingBalances: ledger.openingBalances } : {}),
    ...(ledger.assetProceeds ? { assetProceeds: ledger.assetProceeds } : {}),
    ...(ledger.payouts ? { payouts: ledger.payouts } : {}),
    ...(ledger.manualJournals ? { manualJournals: ledger.manualJournals } : {}),
    ...(ledger.singleEntityConfirmed ? { singleEntityConfirmed: true } : {}),
    ...(ledger.startedAtNothing ? { startedAtNothing: true } : {}),
    ...(ledger.aiEnabled ? { aiEnabled: true } : {}),
    ...(ledger.aiAutoSuggest ? { aiAutoSuggest: true } : {}),
    ...(ledger.nightly ? { nightly: true } : {}),
    ...(ledger.dailyBalances ? { dailyBalances: ledger.dailyBalances } : {}),
    ...(ledger.snoozed ? { snoozed: ledger.snoozed } : {}),
    ...(ledger.ignoredReference ? { ignoredReference: ledger.ignoredReference } : {}),
    ...(ledger.beforeStart ? { beforeStart: ledger.beforeStart } : {}),
    ...(ledger.lockDates ? { lockDates: ledger.lockDates } : {}),
    ...(ledger.lockedOnce ? { lockedOnce: ledger.lockedOnce } : {}),
    ...(ledger.lockedArrivals ? { lockedArrivals: ledger.lockedArrivals } : {}),
    ...(ledger.betweenLines ? { betweenLines: ledger.betweenLines } : {}),
    ...(ledger.gstKeptFrom ? { gstKeptFrom: ledger.gstKeptFrom } : {}),
    ...(ledger.beforeStartLeft ? { beforeStartLeft: ledger.beforeStartLeft } : {}),
    ...(ledger.booksAbout ? { booksAbout: ledger.booksAbout } : {}),
    ...(ledger.recurring && ledger.recurring.length > 0 ? { recurring: ledger.recurring } : {}),
  };
}

/** What each folder part holds, taken from the ledger in memory. */
function partValue(ledger: StoredLedger, part: string): unknown {
  if (part === "transactions") return ledger.transactions;
  if (part === "decisions") return decisionsOf(ledger);
  if (part === "filed") return ledger.filedReturns ?? [];
  if (part === "payroll") return ledger.payroll ?? { employerIrd: "", employees: [], payRuns: [] };
  if (part === "rules" || part === "rulesarchive" || part === "events") return undefined;
  return (ledger as unknown as Record<string, unknown>)[part];
}

async function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`api/${path}`, { cache: "no-store", ...init });
}

/** Write one part, unless what is in memory is the object already sent. */
function putPart(part: string, data: unknown): Promise<boolean> {
  return oneAtATime(() => putPartNow(part, data));
}

async function putPartNow(part: string, data: unknown): Promise<boolean> {
  if (data === undefined) return true;
  if (lastWritten.get(part) === data) {
    markSaved(part);
    return true;
  }
  // A newer write of this part supersedes one waiting to be tried again.
  retryParts.delete(part);
  let response: Response;
  try {
    response = await api(`ledger/parts/${part}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: versions.get(part) ?? 0, data }),
    });
  } catch {
    // Nothing answered: NZOSA on this computer was closed, or the connection
    // to it dropped. Said at once, and tried again until it is back.
    markUnsaved(part);
    retryLater(part, data);
    tellAboutTrouble({
      kind: "offline",
      why:
        "NZOSA on this computer isn't answering, so your last change is not saved yet. " +
        "It will keep trying: leave this page open, and start NZOSA again if it was closed.",
    });
    return false;
  }
  try {
    if (response.status === 409) {
      // Someone else changed it underneath. Take their version so the next
      // write is built on it rather than fighting. Never tried again.
      const body = (await response.json()) as { current?: { version?: number } };
      versions.set(part, body.current?.version ?? 0);
      markUnsaved(part);
      tellAboutTrouble({
        kind: "conflict",
        why:
          "These books changed somewhere else, so your last change was not saved. " +
          "Reload to get the latest, then make it again.",
      });
      return false;
    }
    if (!response.ok) {
      markUnsaved(part);
      tellAboutTrouble({
        kind: "failed",
        why: `Your last change could not be saved to the folder (the app said ${response.status}). Reload, then make it again.`,
      });
      return false;
    }
    const body = (await response.json()) as { version: number };
    versions.set(part, body.version);
    lastWritten.set(part, data);
    markSaved(part);
    return true;
  } catch {
    markUnsaved(part);
    tellAboutTrouble({
      kind: "failed",
      why: "Your last change could not be saved to the folder. Reload, then make it again.",
    });
    return false;
  }
}

/** Ask whether there is a folder behind this app, and read it if so. */
async function loadFromFolder(): Promise<StoredLedger | null> {
  // The folder is the app running on this computer, which is always served
  // over plain http from localhost. Asked from a website it is never there,
  // and every opening logged a "not found" for it.
  if (location.protocol === "https:" && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return null;
  let status: { writable?: boolean; name?: string; ledger?: string; created?: string } | null = null;
  try {
    const response = await api("status");
    if (!response.ok) return null;
    status = (await response.json()) as { writable?: boolean; name?: string; ledger?: string; created?: string };
  } catch {
    return null;
  }
  if (status?.writable !== true) return null;

  const response = await api("ledger");
  if (!response.ok) return null;
  const body = (await response.json()) as {
    parts: Record<string, { version: number; data: unknown }>;
  };

  const ledger = ledgerFromParts(body.parts);

  backend = "folder";
  folderName = status.name ?? "";
  folderId = status.ledger ?? "";
  folderCreated = status.created ?? "";
  return ledger;
}

/**
 * Build a ledger from the parts a folder or a server handed over.
 *
 * Every part arrives with the version it is at, which is kept so a later write
 * can say what it is replacing, and remembered as written so an unchanged part
 * is not sent back.
 */
export function ledgerFromParts(
  parts: Record<string, { version: number; data: unknown }>,
): StoredLedger {
  const body = { parts };
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
    if (part === "payroll") {
      ledger["payroll"] = held.data ?? { employerIrd: "", employees: [], payRuns: [] };
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

  // The decisions object read back is not the one the app will hold once it
  // spreads the keys out, so nothing may be skipped on the first write.
  lastWritten.delete("decisions");
  return ledger as unknown as StoredLedger;
}

/**
 * The hosted books, when somebody is signed in and has opened a set.
 *
 * Tried after the folder and before this browser's own copy: a local server
 * means the folder is the truth, and with neither a folder nor a sign-in there
 * is nothing but the browser. A set of books that cannot be read is not opened
 * at all -- the app falls back rather than showing empty books that the next
 * save would write over the real ones.
 */
async function loadFromCloud(): Promise<StoredLedger | null> {
  if (!cloudConfigured() || !signedIn()) return null;
  const book = cloudBook ?? rememberedCloudBook();
  if (book === null) return null;

  const parts = await loadCloudParts(book.id);
  if (parts === null) return null;
  // Copied before anything can change them, so the first save of each part
  // can be worked out as changes to what the server holds.
  serverCopies.clear();
  for (const [part, held] of Object.entries(parts)) serverCopies.set(part, partCopy(held.data));

  const ledger = ledgerFromParts(parts);
  // A part the server does not hold is an empty part, not an unread one. The
  // folder says so outright -- it answers every part, with version 0 for those
  // that do not exist yet -- but a set of books just made on the server holds
  // no parts at all. Without this, every save to new books skipped every part
  // and reported success: transactions arrived, were shown, and were written
  // nowhere, with nothing on screen to say so.
  //
  // Only after a read that succeeded. A read that failed never gets here, so
  // this cannot turn "could not load" into "empty, go ahead and overwrite".
  for (const part of FOLDER_PARTS) loadedParts.add(part);
  readOnly = await readOnlyMember(book.id);
  cloudParts = parts;
  backend = "cloud";
  cloudBook = book;
  folderName = book.name;
  return ledger;
}

/**
 * Write to the hosted books, skipping the parts that did not change.
 *
 * The same rule the folder follows, with one addition: every write says which
 * version it replaces. A save built on a stale read is refused by the server,
 * because the alternative is one person's morning quietly overwriting
 * another's.
 */
async function writeCloud(
  ledger: StoredLedger,
  parts: readonly string[],
): Promise<boolean> {
  const book = cloudBook;
  if (book === null) return false;
  // Every changed part asked for at once, before any is answered, so they
  // go to the server together.
  const asked: [string, Promise<SaveOutcome>][] = [];
  for (const part of parts) {
    const value = partValue(ledger, part);
    if (value === undefined) continue;
    if (!loadedParts.has(part) && !changedParts.has(part)) continue;
    if (lastWritten.get(part) === value) continue;
    asked.push([part, sendToCloud(part, value)]);
  }
  let ok = true;
  for (const [part, outcome] of asked) {
    const result = await outcome;
    if (result.kind === "saved") {
      markSaved(part);
      continue;
    }
    markUnsaved(part);
    // Said once: the parts of one save fail together.
    if (ok) tellCloudTrouble(result);
    ok = false;
  }
  return ok;
}

/**
 * A save to hosted books that was not made, said out loud.
 *
 * Not one to retry: on a conflict somebody else's save is now the truth, and
 * this page is holding something built on what it replaced.
 */
function tellCloudTrouble(outcome: Exclude<SaveOutcome, { kind: "saved" }>): void {
  tellAboutTrouble(
    outcome.kind === "conflict"
      ? {
          kind: "conflict",
          why:
            "These books changed somewhere else, so your last change was not saved. " +
            "Reload to get the latest, then make it again.",
        }
      : { kind: outcome.kind, why: outcome.why },
  );
}

/**
 * What the server holds of each part of the hosted books, as text.
 *
 * Read when the books are opened and kept up with every save, so a save can
 * send what changed rather than the whole part. Text rather than the objects:
 * the app changes some objects in place, and a copy sharing them would change
 * with them and hide the change. A part missing here is sent whole.
 */
const serverCopies = new Map<string, PartCopy>();

/** Whether the server takes changes; a project of somebody's own set up before it did, does not. */
let changesTaken = true;

/** Saves of hosted books asked for and not yet sent: the latest value of each part. */
const waitingToSend = new Map<string, { value: unknown; answer: ((outcome: SaveOutcome) => void)[] }>();
let sendQueued = false;

/**
 * Ask for one part of the hosted books to be saved.
 *
 * Everything asked for before the request goes -- a coding and the history
 * entry recording it, or several ticks while a save is still on its way --
 * goes in one request, as what changed in each part. A part asked for twice
 * sends the later value, and both are answered with how it went.
 */
function sendToCloud(part: string, value: unknown): Promise<SaveOutcome> {
  return new Promise((resolve) => {
    const held = waitingToSend.get(part);
    if (held === undefined) {
      waitingToSend.set(part, { value, answer: [resolve] });
    } else {
      held.value = value;
      held.answer.push(resolve);
    }
    if (!sendQueued) {
      sendQueued = true;
      void oneAtATime(sendWaiting);
    }
  });
}

/** The changes are sent instead of the whole part when no more than this share of its size. */
const CHANGES_AT_MOST = 0.5;

/** How many times a save refused because the books changed is caught up and tried again. */
const CATCH_UP_TRIES = 3;

async function sendWaiting(): Promise<void> {
  sendQueued = false;
  const batch = new Map(waitingToSend);
  waitingToSend.clear();
  const answer = (part: string, outcome: SaveOutcome): void => {
    for (const one of batch.get(part)?.answer ?? []) one(outcome);
  };
  const book = cloudBook;
  if (book === null) {
    for (const part of batch.keys()) answer(part, { kind: "failed", why: "No books are open." });
    return;
  }

  for (let tries = 0; ; tries++) {
    // Worked out now rather than when asked: the version and the server's copy
    // are the ones the save before this left.
    const sending: { part: string; value: unknown; copy: PartCopy; change: PartChange }[] = [];
    for (const [part, { value }] of batch) {
      const version = versions.get(part) ?? 0;
      const before = serverCopies.get(part);
      const found = changesTaken && before !== undefined && version > 0 ? partChanges(before, value) : null;
      if (found !== null && found.ops.length === 0) {
        // What the server already holds: nothing to send.
        lastWritten.set(part, value);
        answer(part, { kind: "saved", version });
        continue;
      }
      if (found !== null && JSON.stringify(found.ops).length <= copySize(found.copy) * CHANGES_AT_MOST) {
        sending.push({ part, value, copy: found.copy, change: { part, version, ops: found.ops } });
        continue;
      }
      sending.push({ part, value, copy: found?.copy ?? partCopy(value), change: { part, version, data: value } });
    }
    if (sending.length === 0) return;

    const saved = (one: { part: string; value: unknown; copy: PartCopy }, version: number): void => {
      versions.set(one.part, version);
      lastWritten.set(one.part, one.value);
      serverCopies.set(one.part, one.copy);
      answer(one.part, { kind: "saved", version });
    };

    if (!changesTaken) {
      await sendEachWhole(book.id, sending, saved, answer);
      return;
    }
    const outcome = await saveCloudChanges(book.id, sending.map((one) => one.change));
    if (outcome.kind === "saved") {
      sending.forEach((one, i) => saved(one, outcome.versions[i] ?? 0));
      if (tries > 0) booksInMemory?.shown();
      return;
    }
    if (outcome.kind === "missing") {
      changesTaken = false;
      await sendEachWhole(book.id, sending, saved, answer);
      return;
    }
    if (outcome.kind === "conflict" && tries < CATCH_UP_TRIES) {
      // Somebody else saved these books since they were read here. Take in
      // what they changed and try again with this change on top of theirs --
      // unless both changed the same thing, which only a person can settle.
      const parts = [...batch.keys()];
      const caughtUp = await catchUp(book.id, parts);
      if (caughtUp !== null) {
        for (const part of parts) {
          const held = batch.get(part);
          if (held === undefined) continue;
          held.value = caughtUp.get(part) ?? held.value;
          // A later save of the same part was built on what was just
          // replaced: this one now carries everything in memory, so it is
          // answered with this.
          const later = waitingToSend.get(part);
          if (later !== undefined) {
            held.answer.push(...later.answer);
            waitingToSend.delete(part);
          }
        }
        continue;
      }
    }
    for (const one of sending) answer(one.part, outcome);
    return;
  }
}

/** A project without save_part_changes: each part whole, as before it. */
async function sendEachWhole(
  bookId: string,
  sending: readonly { part: string; value: unknown; copy: PartCopy }[],
  saved: (one: { part: string; value: unknown; copy: PartCopy }, version: number) => void,
  answer: (part: string, outcome: SaveOutcome) => void,
): Promise<void> {
  for (const one of sending) {
    const outcome = await saveCloudPart(bookId, one.part, one.value, versions.get(one.part) ?? 0);
    if (outcome.kind === "saved") saved(one, outcome.version);
    else answer(one.part, outcome);
  }
}

/**
 * The books as this page holds them, for taking in what somebody else saved.
 *
 * Storage keeps no books of its own -- the page does -- so the page hands over
 * how to read and replace them. Without it, a save refused because the books
 * changed elsewhere is only reported, as it always was.
 */
export interface BooksInMemory {
  ledger(): StoredLedger;
  setLedger(ledger: StoredLedger): void;
  events(): readonly LedgerEvent[];
  setEvents(events: LedgerEvent[]): void;
  /** The rules as they are saved; undefined when there are none. */
  rules(): unknown;
  setRules(stored: unknown): void;
  /** After something taken in: show it. */
  shown(): void;
}

let booksInMemory: BooksInMemory | null = null;

export function keepBooksInMemory(memory: BooksInMemory): void {
  booksInMemory = memory;
}

/** A part as the page holds it now, as it would be saved. */
function heldNow(memory: BooksInMemory, part: string): unknown {
  if (part === "events") return memory.events();
  if (part === "rules") return memory.rules();
  if (part === "rulesarchive") return undefined;
  const ledger = memory.ledger();
  return partValue(beforeSave?.(ledger) ?? ledger, part);
}

/** Put a part back into the page's books. */
function holdNow(memory: BooksInMemory, part: string, value: unknown): void {
  if (part === "events") {
    memory.setEvents(value as LedgerEvent[]);
    return;
  }
  if (part === "rules") {
    memory.setRules(value);
    return;
  }
  const ledger = { ...memory.ledger() } as unknown as Record<string, unknown>;
  if (part === "decisions") {
    const was = decisionsOf(memory.ledger());
    for (const key of Object.keys(was)) delete ledger[key];
    Object.assign(ledger, value as Record<string, unknown>);
  } else if (part === "filed") {
    ledger["filedReturns"] = value;
  } else {
    ledger[part] = value;
  }
  memory.setLedger(ledger as unknown as StoredLedger);
}

/** Where a change lands: a key, or a key inside one ("" for a part that is a list). */
function placeOf(op: PartOp): string {
  const path = "set" in op ? op.set : "del" in op ? op.del : op.splice;
  return path.join("\u0001");
}

/** Whether two sets of changes touch the same thing (a key, or anything inside it). */
function overlap(mine: readonly PartOp[], theirs: readonly PartOp[]): boolean {
  const places = new Set(theirs.map(placeOf));
  const tops = new Set([...places].map((place) => place.split("\u0001")[0]));
  // The same change made on both sides -- two people accepting the same
  // suggestion for a line -- is no disagreement.
  const same = new Set(theirs.map(sameText));
  for (const op of mine) {
    if (same.has(sameText(op))) continue;
    const place = placeOf(op);
    if (places.has(place)) return true;
    const [top, inner] = place.split("\u0001");
    // A whole key replaced on one side, and something inside it on the other.
    if (inner === undefined ? tops.has(place) : places.has(top ?? "")) return true;
  }
  return false;
}

/** A change as text, with keys in order, so the same change reads the same from either side. */
function sameText(op: PartOp): string {
  return JSON.stringify(op, (_key, value: unknown) =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : value,
  );
}

/**
 * The history, with both sides' entries.
 *
 * Every save adds to it, so two people working at once always both change
 * it, and never the same entry: their new entries and this page's are put
 * together, newest (this page's) first, and an entry this page marked undone
 * stays marked.
 */
function bothHistories(base: PartCopy, mine: readonly LedgerEvent[], theirs: readonly LedgerEvent[]): LedgerEvent[] {
  const had = new Map<string, string>();
  if (base.t === "arr") {
    for (const item of base.items) {
      const id = (JSON.parse(item) as { id?: unknown } | null)?.id;
      if (typeof id === "string") had.set(id, item);
    }
  }
  const theirIds = new Set(theirs.map((event) => event.id));
  const mineNew = mine.filter((event) => !had.has(event.id) && !theirIds.has(event.id));
  const mineChanged = new Map(
    mine.filter((event) => had.has(event.id) && had.get(event.id) !== JSON.stringify(event)).map((event) => [event.id, event]),
  );
  return [...mineNew, ...theirs.map((event) => mineChanged.get(event.id) ?? event)].slice(0, MAX_EVENTS);
}

/**
 * Take in what somebody else saved to these parts since this page read them.
 *
 * All of it or none: if any part cannot be put together -- both changed the
 * same coding, say -- nothing in memory is touched and null comes back. What
 * comes back is each part as it is now to be saved.
 */
async function catchUp(bookId: string, parts: readonly string[]): Promise<Map<string, unknown> | null> {
  const memory = booksInMemory;
  if (memory === null) return null;
  const fresh = await loadNamedParts(bookId, parts);
  if (fresh === null) return null;

  const taking: { part: string; next: unknown; held: { version: number; data: unknown } }[] = [];
  for (const part of parts) {
    const held = fresh[part];
    // A part this page was the first to write, that somebody else wrote first.
    if (held === undefined) {
      if ((versions.get(part) ?? 0) === 0) continue;
      return null;
    }
    if (held.version === versions.get(part)) continue;
    const base = serverCopies.get(part);
    const now = heldNow(memory, part);
    if (base === undefined || now === undefined) return null;
    if (part === "events") {
      if (!Array.isArray(now) || !Array.isArray(held.data)) return null;
      taking.push({ part, held, next: bothHistories(base, now as LedgerEvent[], held.data as LedgerEvent[]) });
      continue;
    }
    const theirs = partChanges(base, held.data);
    const mine = partChanges(base, now);
    if (theirs === null || mine === null || overlap(mine.ops, theirs.ops)) return null;
    taking.push({ part, held, next: applyPartOps(now, theirs.ops) });
  }

  const now = new Map<string, unknown>();
  for (const { part, next, held } of taking) {
    holdNow(memory, part, next);
    versions.set(part, held.version);
    serverCopies.set(part, partCopy(held.data));
    lastWritten.delete(part);
    cloudParts[part] = held;
  }
  for (const part of parts) {
    const value = heldNow(memory, part);
    if (value !== undefined) now.set(part, value);
  }
  return now;
}

/**
 * Copy a whole set of books into a set on the server, replacing what it holds.
 *
 * How books held in a browser -- a backup restored there, or what somebody
 * built before signing in -- become books on the server. Usually the set is
 * new and empty; it can also be one an earlier attempt left part-filled, so
 * each part is written over whatever version the server already has. The set
 * is then opened, and from there on it saves like any other.
 */
export async function copyToCloudBook(
  bookId: string,
  ledger: StoredLedger,
  extra: { rules: unknown; rulesarchive: unknown; events: unknown },
): Promise<{ ok: true } | { ok: false; why: string }> {
  const held = await loadCloudParts(bookId);
  if (held === null) return { ok: false, why: "The set on the server could not be read." };
  const writes: [string, unknown][] = [
    ...FOLDER_PARTS.map((part): [string, unknown] => [part, partValue(ledger, part)]),
    ["rules", extra.rules ?? {}],
    ["rulesarchive", extra.rulesarchive],
    ["events", extra.events],
  ];
  for (const [part, value] of writes) {
    if (value === undefined) continue;
    const outcome = await saveCloudPart(bookId, part, value, held[part]?.version ?? 0);
    if (outcome.kind !== "saved") {
      return {
        ok: false,
        why: `The ${part} could not be saved to the server: ${outcome.kind === "conflict" ? "the set is not empty" : outcome.why}.`,
      };
    }
  }
  return { ok: true };
}

/**
 * Write one of the parts the app saves on its own -- the rules, the rule sets
 * they replaced, the history -- to hosted books.
 *
 * Under the same rules as every other part: an unchanged part is not sent, a
 * write says which version it replaces, and a refusal is said out loud.
 */
async function putCloudPart(part: string, data: unknown): Promise<boolean> {
  const book = cloudBook;
  if (book === null || readOnly) return false;
  if (data === undefined) return true;
  if (lastWritten.get(part) === data) return true;

  const outcome = await sendToCloud(part, data);
  if (outcome.kind === "saved") return true;
  tellCloudTrouble(outcome);
  return false;
}

/** A part as the server sent it when these books were opened. */
function cloudPart<T>(part: string): T | null {
  const held = cloudParts[part];
  return held === undefined ? null : (held.data as T);
}

/**
 * What the morning run left beside these books: the bank's new lines waiting
 * to come in, and suggested codes. Never part of the books, and never held
 * back by somebody being read only: it is a note on the side, not a change.
 *
 * In a folder, a file of its own (the server's /api/nightly); on the server,
 * a part of its own, written with its version like any other.
 */
export async function readNightlyPart(): Promise<unknown | null> {
  if (backend === "folder") {
    try {
      const response = await api("nightly");
      return response.ok ? ((await response.json()) as unknown) : null;
    } catch {
      return null;
    }
  }
  if (backend === "cloud") {
    const book = cloudBook;
    if (book === null) return null;
    const held = await loadCloudPart(book.id, "nightly");
    if (held === null) return null;
    nightlyVersion = held.version;
    return held.data;
  }
  return null;
}

let nightlyVersion = 0;

export async function writeNightlyPart(data: unknown): Promise<boolean> {
  if (backend === "folder") {
    try {
      const response = await api("nightly", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
  if (backend === "cloud" && !readOnly) {
    const book = cloudBook;
    if (book === null) return false;
    // Twice at most: the morning run may have written it since it was read.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const outcome = await saveCloudPart(book.id, "nightly", data, nightlyVersion);
      if (outcome.kind === "saved") {
        nightlyVersion = outcome.version;
        return true;
      }
      if (outcome.kind !== "conflict") return false;
      nightlyVersion = (await loadCloudPart(book.id, "nightly"))?.version ?? 0;
    }
  }
  return false;
}

interface FolderStatus {
  ledger?: string;
  ledgers?: Array<{ id: string; name: string; transactions: number }>;
}

/**
 * What the folder's server says of itself: the books beside each other, and
 * which is open. One request however many ask while it is on its way -- the
 * books list asks for both as every page is drawn -- and nothing kept after.
 */
function folderStatus(): Promise<FolderStatus | null> {
  statusAsked ??= (async (): Promise<FolderStatus | null> => {
    try {
      const response = await api("status");
      return response.ok ? ((await response.json()) as FolderStatus) : null;
    } catch {
      return null;
    }
  })().finally(() => {
    statusAsked = null;
  });
  return statusAsked;
}

let statusAsked: Promise<FolderStatus | null> | null = null;

/** The ledgers side by side in the same place, for the picker. */
export async function ledgers(): Promise<
  Array<{ id: string; name: string; transactions: number }>
> {
  if (backend !== "folder") return [];
  return (await folderStatus())?.ledgers ?? [];
}

/** Which ledger the folder is currently open on. */
export async function currentLedger(): Promise<string> {
  if (backend !== "folder") return "";
  return (await folderStatus())?.ledger ?? "";
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

/** Copy a set of books into a new folder, leaving the original as it was. */
export async function copyLedger(
  from: string,
  to: string,
  name: string,
): Promise<{ ok: boolean; why: string }> {
  if (backend !== "folder") return { ok: false, why: "These books have no folder to copy." };
  try {
    const response = await api("ledger/copy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from, ledger: to, name }),
    });
    if (response.ok) return { ok: true, why: "" };
    const said = (await response.json().catch(() => ({}))) as { error?: string };
    return { ok: false, why: said.error ?? "Could not copy those books." };
  } catch {
    return { ok: false, why: "Could not reach the app's server to copy the books." };
  }
}

/** Which folder this browser is a working copy of, for the app to show. */
export function ledgerName(): string {
  return folderName;
}

/** Which folder, as opposed to what it is called. Empty when there is no folder. */
export function ledgerId(): string {
  return folderId;
}

/** When the open folder was made, or empty when that is not known. */
export function ledgerCreated(): string {
  return folderCreated;
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

  const fromCloud = await loadFromCloud();
  if (fromCloud !== null) return { ledger: fromCloud, persistent: true };

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

/**
 * Asked before anything is written, and able to refuse by throwing.
 *
 * The lock dates use it: one place every change to the books passes through,
 * rather than a check beside each of a hundred saves where the one forgotten
 * is the one that changes a filed return.
 */
let saveGuard: ((ledger: StoredLedger) => void) | null = null;
export function setSaveGuard(guard: (ledger: StoredLedger) => void): void {
  saveGuard = guard;
}

/**
 * Asked before anything is written, and able to add to it: the choices for
 * lines just confirmed are stored with the same save that confirmed them.
 */
let beforeSave: ((ledger: StoredLedger) => StoredLedger) | null = null;
export function setBeforeSave(step: (ledger: StoredLedger) => StoredLedger): void {
  beforeSave = step;
}

/** Write the whole ledger, every part. Used on import and first run. */
export async function save(given: StoredLedger): Promise<boolean> {
  const ledger = beforeSave?.(given) ?? given;
  saveGuard?.(ledger);
  if (readOnly) return false;
  if (backend === "folder") return writeFolder(ledger, FOLDER_PARTS);
  if (backend === "cloud") return writeCloud(ledger, FOLDER_PARTS);
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
  given: StoredLedger,
  ...parts: readonly LedgerPart[]
): Promise<boolean> {
  const ledger = beforeSave?.(given) ?? given;
  saveGuard?.(ledger);
  if (readOnly) return false;
  if (backend === "folder") {
    // A named part still goes through the same routine, because the decisions
    // file has to be written whatever else changed: a coding and a chart edit
    // both arrive here naming only what the caller thought moved.
    return writeFolder(ledger, [...parts, "transactions", "decisions"]);
  }
  if (backend === "cloud") {
    return writeCloud(ledger, [...parts, "transactions", "decisions"]);
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
  if (backend === "cloud") {
    const held = cloudPart<Record<string, unknown>>("rules");
    if (held === null || Object.keys(held).length === 0) return null;
    return held as unknown as StoredRules;
  }
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
  if (backend === "cloud") return putCloudPart("rules", stored ?? {});
  if (backend === "folder") return putPart("rules", stored ?? {});
  return put(RULES_KEY, stored);
}

export async function loadRulesArchive(): Promise<RulesArchive> {
  if (backend === "cloud") {
    const held = cloudPart<RulesArchive>("rulesarchive");
    return held && Array.isArray(held.entries) ? held : { version: 1, entries: [] };
  }
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
  if (backend === "cloud") return putCloudPart("rulesarchive", archive);
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
  if (backend === "cloud") {
    const held = cloudPart<LedgerEvent[]>("events");
    return Array.isArray(held) ? held : [];
  }
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
  if (backend === "cloud") return putCloudPart("events", events);
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

// --- attachments ---------------------------------------------------------------

/** A file attached to a document: what it is, and what it belongs to. */
export interface Attachment {
  id: string;
  name: string;
  type: string;
  /** Bytes. */
  size: number;
  addedAt: string;
  to: { kind: "invoice" | "journal" | "contact" | "line"; id: string };
}

/**
 * Where the bytes of an attached file live: in the books' folder when there
 * is one, in this browser's own database when the books are kept here.
 * Books kept online have nowhere for them yet (that needs a storage bucket on
 * the project), so attaching says so rather than keeping a file somewhere it
 * would quietly be lost.
 */
export function attachmentsKeptHere(): boolean {
  return backend === "folder" || backend === "browser";
}

const ATTACHMENT_KEY = (id: string): string => `attachment:${id}`;

export async function putAttachmentFile(id: string, type: string, data: string): Promise<void> {
  if (backend === "folder") {
    const response = await fetch(`/api/attachments/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type, data }),
    });
    if (!response.ok) throw new Error(`The file could not be kept (${response.status}).`);
    return;
  }
  if (backend !== "browser") throw new Error("Files are not kept with books online yet.");
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ type, data }, ATTACHMENT_KEY(id));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function getAttachmentFile(id: string): Promise<{ type: string; data: string } | null> {
  if (backend === "folder") {
    const response = await fetch(`/api/attachments/${encodeURIComponent(id)}`);
    return response.ok ? ((await response.json()) as { type: string; data: string }) : null;
  }
  if (backend !== "browser") return null;
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).get(ATTACHMENT_KEY(id));
    request.onsuccess = () => resolve((request.result as { type: string; data: string } | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteAttachmentFile(id: string): Promise<void> {
  if (backend === "folder") {
    await fetch(`/api/attachments/${encodeURIComponent(id)}`, { method: "DELETE" });
    return;
  }
  if (backend !== "browser") return;
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(ATTACHMENT_KEY(id));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
