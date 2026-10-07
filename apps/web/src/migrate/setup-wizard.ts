import { JURISDICTIONS, jurisdictionOf } from "@nzosa/core";
import { edition } from "../edition.js";
import { redraw, showPage } from "../app.js";
import { allMyirCards } from "../daily/myir-cards.js";
import {
  CLEAR_PHRASE,
  accountsForEditing,
  clearEverything,
  ledgerAccountFor,
  reclassify,
  saveEntities,
  bankLabel,
  banks,
  tidyChart,
  useRules,
  wipe,
} from "../books.js";
import {
  applyChartColumns,
  codingMatches,
  ruleSuggestions,
  unmatchedCodingNames,
} from "../migrate/coding-reconciliation.js";
import { bankEntityTable, loadXeroBankAccounts } from "../daily/entities.js";
import {
  dailyFileBalances,
  dayBeforeBooks,
  fedFromBankFeed,
  feedTieNow,
  startBankBalances,
  startBankBalancesFromFile,
} from "../daily/opening-balances.js";
import { balanceChecksNow } from "../daily/bank-import.js";
import { incomeReturnPanel } from "../daily/income-returns.js";
import { addStandardForAll, openStandardAccounts } from "../daily/standard-accounts-panel.js";
import { describeRules } from "../rules-ui.js";
import type { RuleFileShape } from "../rules-ui.js";
import { $, state } from "../state.js";
import { save, switchLedger, writesToFolder } from "../store.js";
import type { StoredLedger } from "../store.js";
import { note, setLoadingStatus } from "../ui.js";
import {
  DEFAULT_ENTITY_NAME,
  accountEntityKey,
  emptyEntityModel,
  entityId,
  parseChartOfAccounts,
  parseFixedAssets,
  parseXeroAllocations,
  parseXeroInvoices,
  parseXeroJournalReport,
  starterChart,
} from "@nzosa/core";
import type { Account, Entity } from "@nzosa/core";
import { DEMO_SEEDED, markDemoSeeded, record } from "../books.js";
import { isDemoBuild } from "../ai-consent.js";
import { savePart } from "../store.js";
import { anyModuleOn, applyModules, moduleOn, modulesHere, modulesPanel } from "../modules.js";
import { onboarding, rememberSource, sourceForTheseBooks } from "./onboarding-state.js";
import { booksLocale, moneyPlaces } from "../country.js";

/**
 * Setting a set of books up, and the steps that say what is left to do.
 *
 * Everything here runs once. The wizard that lists what an incoming system has
 * to hand over and ticks each off as it arrives, the name the first entity is
 * given, the starter chart offered to books that have none, the demo data, and
 * the control that clears the lot and starts again.
 *
 * A ledger in use reaches none of it. The steps exist because the order
 * matters and nobody is told it -- bank statements before rules, rules before
 * coding, coding before a return -- and once that order has been followed
 * there is nothing left for this file to say.
 *
 * Clearing is the exception worth naming: it lives here because it is how a
 * migration is begun again after one that went wrong, and it is guarded by a
 * typed phrase rather than a confirm box for the same reason.
 */

/**
 * Everything the app loads for itself on startup.
 *
 * These live together in one folder — `data/` beside the app — rather than
 * scattered, because "which file is it reading?" should have one answer. Each
 * is optional: a missing file is not an error, it is a setup that has not been
 * done yet, and the page works without any of them.
 *
 * Nothing here overwrites work. Each entry says how to tell whether the app
 * already holds that kind of data, and loads only when it does not — so a file
 * you loaded by hand is never quietly replaced by the one on disk.
 */
interface StartupFile {
  file: string;
  what: string;
  /** True when the app already holds this, so the file is left alone. */
  have: () => boolean;
  /** Reads the file and returns what it found, or null if it held nothing. */
  load: (text: string) => Promise<string | null>;
}

function startupFiles(): StartupFile[] {
  return [
    {
      // First, because a ledger carries its own chart and coding decisions:
      // anything it brings makes the separate files below unnecessary.
      file: "ledger.json",
      what: "ledger",
      have: () => state.ledger.transactions.length > 0,
      load: async (text) => {
        // A backup file works here too, so "download a backup, drop it in as
        // ledger.json" is a way to seed a copy -- the ledger is inside it.
        const raw = JSON.parse(text) as Partial<StoredLedger> & {
          format?: string;
          ledger?: Partial<StoredLedger>;
        };
        const parsed = raw.format === "nzosa-backup" && raw.ledger ? raw.ledger : raw;
        if (!Array.isArray(parsed.transactions) || parsed.transactions.length === 0) return null;
        state.ledger = { ...state.ledger, ...parsed, version: 1 };
        state.chart = state.ledger.chart ?? [];
        reclassify();
        state.persistent = await save(state.ledger);
        const decisions = Object.keys(parsed.overrides ?? {}).length;
        const matched = Object.keys(parsed.invoiceMatches ?? {}).length;
        return (
          `${parsed.transactions.length} transactions` +
          (decisions > 0 ? `, ${decisions} codings` : "") +
          (matched > 0 ? `, ${matched} invoice matches` : "")
        );
      },
    },
    {
      file: "rules.json",
      what: "coding rules",
      have: () => state.rules !== undefined,
      load: async (text) => {
        const incoming = JSON.parse(text) as RuleFileShape;
        if (!Array.isArray(incoming.rules) || incoming.rules.length === 0) return null;
        await useRules(incoming, "rules.json", "Loaded");
        return describeRules(incoming);
      },
    },
    {
      file: "chart-of-accounts.csv",
      what: "chart of accounts",
      have: () => state.chart.length > 0,
      load: async (text) => {
        const parsed = parseChartOfAccounts(text);
        if (parsed.accounts.length === 0) return null;
        state.chart = parsed.accounts;
        state.ledger = { ...state.ledger, chart: parsed.accounts };
        state.persistent = await save(state.ledger);
        await applyChartColumns(parsed.accounts);
        await tidyChart();
        return `${state.chart.length} accounts`;
      },
    },
    {
      file: "invoices.csv",
      what: "invoices",
      have: () => (state.ledger.invoices ?? []).length > 0,
      load: async (text) => {
        const parsed = parseXeroInvoices(text);
        if (parsed.invoices.length === 0) return null;
        state.ledger = { ...state.ledger, invoices: parsed.invoices };
        state.persistent = await save(state.ledger);
        return `${parsed.invoices.length} invoices`;
      },
    },
    {
      file: "allocations.csv",
      what: "payment allocations",
      have: () => (state.ledger.allocations ?? []).length > 0,
      load: async (text) => {
        const parsed = parseXeroAllocations(text);
        if (parsed.allocations.length === 0) return null;
        state.ledger = { ...state.ledger, allocations: parsed.allocations };
        state.persistent = await save(state.ledger);
        return `${parsed.allocations.length} allocations`;
      },
    },
    {
      file: "assets.csv",
      what: "fixed assets",
      have: () => (state.ledger.assets ?? []).length > 0,
      load: async (text) => {
        const parsed = parseFixedAssets(text);
        if (parsed.assets.length === 0) return null;
        state.ledger = { ...state.ledger, assets: parsed.assets };
        state.persistent = await save(state.ledger);
        return `${parsed.assets.length} assets`;
      },
    },
    {
      file: "journals.csv",
      what: "general ledger",
      have: () => (state.ledger.journals ?? []).length > 0,
      load: async (text) => {
        const parsed = parseXeroJournalReport(text);
        if (parsed.journals.length === 0) return null;
        state.ledger = { ...state.ledger, journals: parsed.journals };
        state.persistent = await save(state.ledger);
        return `${parsed.journals.length} journals`;
      },
    },
  ];
}

/**
 * Read the startup folder.
 *
 * Failures are quiet on purpose: the folder is optional, and an app that
 * refuses to start because an optional file is absent is worse than one that
 * starts empty. What did load is reported, so it is never a mystery.
 */
export async function loadStartupFiles(folder = "data", replace = false): Promise<void> {
  const loaded: string[] = [];
  const problems: string[] = [];

  // Asked for all at once, and read in order below. One at a time, a server
  // slow to say "not found" -- two seconds a file on the demo's host -- left
  // the page blank for the sum of them, and people refreshed or gave up.
  //
  // Asked of the server every time rather than taken from the browser's
  // cache: the demo's files are replaced when the demo is, and a cached copy
  // seeded a returning visitor with the books from before -- half a year's
  // data missing and nothing to say so.
  const entries = startupFiles();
  const asked = entries.map((entry) =>
    // `replace` is for a deliberate load, where the point is to overwrite.
    !replace && entry.have()
      ? null
      : fetch(`${folder}/${entry.file}`, { cache: "no-cache" }).catch(() => null),
  );

  for (const [index, entry] of entries.entries()) {
    const pending = asked[index];
    // Checked again: a file read earlier in this loop may have filled it.
    if (pending === null || pending === undefined || (!replace && entry.have())) continue;
    try {
      setLoadingStatus(`Loading ${entry.what}…`);
      const response = await pending;
      if (response === null || !response.ok) continue;
      // Xero writes Windows-1252; a plain UTF-8 read mangles anything accented.
      const bytes = new Uint8Array(await response.arrayBuffer());
      let text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      if (text.includes("�")) text = new TextDecoder("windows-1252").decode(bytes);

      const found = await entry.load(text);
      if (found !== null) loaded.push(`${entry.what} (${found})`);
    } catch (error) {
      problems.push(`${entry.file}: ${(error as Error).message}`);
    }
  }

  state.startupMessage =
    loaded.length === 0
      ? ""
      : `Loaded from ${folder}/: ${loaded.join(", ")}.` +
        (problems.length > 0 ? ` Could not read ${problems.join("; ")}.` : "");
}

/**
 * What is set up, what is missing, and what each missing thing would buy.
 *
 * The order is the order it has to happen in: bank data is the spine, the chart
 * names the accounts, coded history teaches the rules. Everything else is
 * optional and says so, with what it unlocks — an optional file nobody can see
 * the point of does not get provided.
 */
export interface SetupLink {
  label: string;
  /** The page this goes to, when it goes to one. */
  page?: string;
  /** Something to do in place, for a step that is one click rather than a page. */
  action?: () => void;
}

export interface SetupStep {
  what: string;
  done: boolean;
  detail: string;
  /** What providing it makes possible. Empty for the required ones. */
  unlocks: string;
  /**
   * Where to go and do it.
   *
   * More than one where there is more than one way in: bank data arrives from
   * a feed or from a file, and offering only one of them told half the people
   * reading it that the other was not there.
   */
  page?: string;
  links?: SetupLink[];
  /**
   * Not everybody needs this one, and not doing it is not being behind.
   *
   * Most books are one company or one person, and entities exist for the
   * ledger that holds a company and two rental properties at once. Counting
   * an entity list nobody needs towards "3 of 10 set up" tells the ordinary
   * case it is two thirds finished when it is finished, so an optional step
   * is shown and explained but left out of the count.
   */
  optional?: boolean;
  /**
   * Started but not finished.
   *
   * A step that ticks on the first file of seven says the set-up is done when
   * six things are still missing, and every step after it then reads as
   * optional. Half a tick is the honest mark for half the work.
   */
  partial?: boolean;
  /** Interactive content of its own: a file list, a drop zone. */
  extra?: HTMLElement;
  /**
   * Satisfied by loading a file, so somewhere to drop one is worth offering.
   *
   * The guided start walks these steps one at a time and puts a drop zone on
   * the ones it would help. A step that is a decision rather than a file --
   * the rules, or tying a chart's bank rows to the accounts the import found
   * -- gets no drop zone, because there is nothing to drop on it.
   */
  takesFiles?: boolean;
}

/**
 * Where the Account Transactions export comes from, in one place.
 *
 * Said on the Setup page and again on the Check page, and the two had already
 * drifted into naming different Xero menus. One string cannot disagree with
 * itself.
 */
export const XERO_ACCOUNT_TRANSACTIONS =
  "Xero: Reporting → Account Transactions, select all columns, set grouping to None";

/**
 * Which chart bank accounts have been tied to an account in this ledger.
 *
 * A bank row in a chart carries a name and no account number, so nothing can
 * work out which of the ledger's bank accounts it is -- and until somebody
 * says, three things downstream are quietly wrong. Transfers are the loud one:
 * a movement between two accounts is only recognised as one when both ends are
 * known to belong to the entity, and an unrecognised transfer leaves the
 * receiving leg reading as income. The balance sheet cannot place a balance,
 * and a comparison against the accounting system has nothing to line the
 * accounts up by.
 */
/**
 * Bank accounts whose bank name says whose they are.
 *
 * "Kowhai" is the Kowhai rental's account and "Rimu2" the Rimu one's:
 * a distinctive word of the entity's name in the bank's name for the account.
 * Only where exactly one entity matches, and never on the words every entity
 * or account has -- rental, loan, account -- so a "Housing Loan" is still
 * somebody's decision.
 */
const COMMON_WORDS = new Set([
  "rental", "residential", "commercial", "personal", "joint", "limited", "trust", "account",
  "accounts", "loan", "loans", "home", "housing", "card", "visa", "credit", "savings", "cheque",
  "business", "everyday", "term", "flexible", "advantage", "platinum", "classic", "online",
  "street", "road", "trading", "company", "family", "property", "properties",
]);

function distinctive(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[0-9]+/g, " ")
      .split(/[^a-z]+/)
      .filter((w) => w.length >= 4 && !COMMON_WORDS.has(w)),
  );
}

function banksByName(
  banks: readonly string[],
  entities: readonly { id: string; name: string }[],
): { bank: string; label: string; entityId: string; entity: string }[] {
  const out: { bank: string; label: string; entityId: string; entity: string }[] = [];
  for (const bank of banks) {
    const label = bankLabel(bank);
    if (label === bank) continue;
    const words = distinctive(label);
    const matches = entities.filter((e) => [...distinctive(e.name)].some((w) => words.has(w)));
    const only = matches.length === 1 ? matches[0] : undefined;
    if (only !== undefined) out.push({ bank, label, entityId: only.id, entity: only.name });
  }
  return out;
}

async function tickByName(pairs: readonly { bank: string; entityId: string }[]): Promise<void> {
  const live = state.ledger.entities ?? emptyEntityModel();
  const banks = { ...live.banks };
  for (const { bank, entityId: id } of pairs) {
    if ((banks[bank] ?? []).length === 0) banks[bank] = [id];
  }
  await saveEntities({ ...live, banks }, `${pairs.length} bank accounts ticked by their names`);
}

/**
 * A way to each entity's usual accounts, from the step that says they are
 * missing. The panel is on Entities & accounts, where the code suffix and
 * the list can be seen before anything is added.
 */
function standardAccountButtons(entities: readonly Entity[]): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "migration-actions";
  // A choice, ticked to start with, rather than a button. It was a blue
  // button, which reads as the option already chosen: somebody pressed Next
  // under it believing the accounts were on their way, and the books went on
  // with the business starter chart. Ticked, Next in Start here adds them;
  // "Add now" is for the Setup page, which has no Next.
  const choice = document.createElement("label");
  choice.className = "standard-all-choice";
  const tick = document.createElement("input");
  tick.type = "checkbox";
  tick.checked = true;
  tick.dataset.standardAll = entities.map((e) => e.id).join(",");
  choice.append(
    tick,
    ` Add the usual accounts for ${
      entities.length === 1 ? (entities[0]?.name ?? "it") : `all ${entities.length}`
    } (recommended)`,
  );
  const now = document.createElement("button");
  now.type = "button";
  now.textContent = "Add now";
  now.addEventListener("click", () => {
    now.disabled = true;
    now.textContent = "Adding…";
    void addStandardForAll(entities).then(() => {
      redraw("setup");
      redraw("migration");
    });
  });
  wrap.append(choice, now);
  for (const entity of entities) {
    const go = document.createElement("button");
    go.type = "button";
    go.textContent = `Standard accounts for ${entity.name}…`;
    go.addEventListener("click", () => {
      openStandardAccounts(entity.id);
      showPage("entities");
    });
    wrap.append(go);
  }
  return wrap;
}

/**
 * Which bank accounts these books hold lines for, and which of them no chart
 * row is linked to.
 *
 * The accounts with lines are what matter: one left unlinked is a bank
 * account the chart does not know, so its transfers and its opening balance
 * have nowhere to go. A chart row with no lines -- petty cash, a PayPal
 * account nobody feeds -- has nothing to link, and holding the step open for
 * it hid the one that did.
 */
/**
 * Add the usual accounts where the choice beside them is still ticked.
 *
 * What Next in Start here does on the chart step before moving on. True when
 * accounts were added; false when there was no choice there, or it was
 * unticked.
 */
export async function applyChosenStandardAccounts(root: HTMLElement): Promise<boolean> {
  const tick = root.querySelector<HTMLInputElement>("input[data-standard-all]");
  if (tick === null || !tick.checked) return false;
  const ids = new Set((tick.dataset.standardAll ?? "").split(",").filter((id) => id !== ""));
  const entities = (state.ledger.entities ?? emptyEntityModel()).entities.filter((e) => ids.has(e.id));
  if (entities.length === 0) return false;
  await addStandardForAll(entities);
  redraw("setup");
  return true;
}

export function bankLinkState(): { rows: number; held: number; unlinked: string[] } {
  const rows = accountsForEditing().filter(
    ({ account }) => account.type.trim().toLowerCase() === "bank",
  );
  const linked = new Set(
    rows
      .map(({ account }) => ledgerAccountFor(account.name, account))
      .filter((id): id is string => id !== null),
  );
  const held = [...banks().accounts];
  const unlinked = held.filter((id) => !linked.has(id)).map((id) => bankLabel(id));
  return { rows: rows.length, held: held.length, unlinked };
}

/** Pick Xero's bank account list, and link by the numbers in it. */
function pickXeroBankList(): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".csv,text/csv";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file === undefined) return;
    void loadXeroBankAccounts(file).then((said) => alert(said));
  });
  input.click();
}

let cachedStarterAccounts: Account[] | null = null;

function defaultStarterAccounts(): Account[] {
  if (!cachedStarterAccounts) {
    cachedStarterAccounts = starterChart();
  }
  return cachedStarterAccounts;
}

function isDefaultStarterChart(chart: Account[]): boolean {
  const starter = defaultStarterAccounts();
  if (chart.length !== starter.length) return false;
  for (let i = 0; i < chart.length; i++) {
    const mine = chart[i];
    const theirs = starter[i];
    if (mine === undefined || theirs === undefined) return false;
    if (mine.code !== theirs.code || mine.name !== theirs.name) {
      return false;
    }
  }
  return true;
}

function hasLoadedChart(): boolean {
  if (state.chart.length === 0) return false;
  return !isDefaultStarterChart(state.chart);
}

export interface SourceFile {
  what: string;
  where: string;
  why: string;
  have: boolean;
  page?: string;
}

export function xeroMigrationFiles(): SourceFile[] {
  const led = state.ledger;
  return [
    {
      what: "Chart of accounts",
      where: "Accounting → Chart of accounts → Export",
      why: "Names accounts & GST treatments",
      have: hasLoadedChart(),
      page: "entities",
    },
    {
      what: "Account transactions",
      where: "Reporting → Account Transactions, select all columns, set grouping to None",
      why: "Teaches coding rules from existing work",
      have: state.reference.length > 0,
      page: "check",
    },
    {
      what: "Trial balance",
      where: "Accounting → Reports → Trial Balance (previous year end)",
      why: "Opening balances for balance sheet",
      have: led.openingBalances !== undefined,
      page: "opening",
    },
    {
      what: "Invoices",
      where: "Business → Invoices → Export",
      why: "Accrual income & receipt allocations",
      have: (led.invoices ?? []).length > 0,
      page: "invoices",
    },
    {
      what: "Aged receivables and payables",
      where:
        "Accounting → Reports → Aged Receivables Detail, and Aged Payables Detail, each as at the day before the books start → Export",
      why: "Which earlier invoices and bills were still open",
      have: (led.openingDocuments ?? []).length > 0,
      page: "invoices",
    },
    {
      what: "Fixed assets",
      where: "Accounting → Fixed assets → Export",
      why: "Asset register & depreciation",
      have: (led.assets ?? []).length > 0,
      page: "assets",
    },
    {
      what: "Bank account list",
      where: "Accounting → Bank accounts → Uncoded statement lines → Export (all bank accounts)",
      why: "Links each bank account to its feed by number",
      have: Object.keys(led.xeroBankNumbers ?? {}).length > 0,
      page: "entities",
    },
    {
      what: "Journal report",
      where: "Accounting → Reports → Journal Report (all columns)",
      why: "Accountant year-end journals",
      have: (led.journals ?? []).length > 0,
      page: "reports",
    },
    {
      what: "Filed GST reports",
      where: "Reporting → GST → For each prior return, export Excel",
      why: "Filed return audit history",
      have: state.filed.length > 0,
      page: "returns",
    },
  ];
}

function spreadsheetMigrationFiles(): SourceFile[] {
  return [
    {
      what: "Coded spreadsheet",
      where: "Spreadsheet with account code per transaction",
      why: "Existing coding becomes rules",
      have: state.reference.length > 0,
      page: "check",
    },
  ];
}

function migrationStepContent(source: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "setup-migration-wrap";

  const files = source === "xero" ? xeroMigrationFiles() : spreadsheetMigrationFiles();
  const loaded = files.filter((f) => f.have).length;

  const details = document.createElement("details");
  details.className = "setup-migration-details";

  const summary = document.createElement("summary");
  summary.className = "setup-migration-summary";
  summary.textContent = `Show migration files (${loaded} of ${files.length} loaded)`;
  details.append(summary);

  const box = document.createElement("div");
  box.className = "setup-files";
  for (const file of files) {
    const row = document.createElement("div");
    row.className = file.have ? "setup-file have" : "setup-file";
    const what = document.createElement("div");
    what.className = "setup-file-what";
    if (file.page) {
      const link = document.createElement("a");
      link.href = `#page-${file.page}`;
      link.textContent = file.have ? `✓ ${file.what}` : file.what;
      link.addEventListener("click", (e) => {
        e.preventDefault();
        showPage(file.page!);
      });
      what.append(link);
    } else {
      what.textContent = file.have ? `✓ ${file.what}` : file.what;
    }
    const where = document.createElement("div");
    where.className = "setup-file-where";
    where.textContent = file.where;
    const why = document.createElement("div");
    why.className = "setup-file-why";
    why.textContent = file.why;
    row.append(what, where, why);
    box.append(row);
  }
  details.append(box);
  wrap.append(details);

  const drop = $("setup-drop");
  if (drop) {
    drop.hidden = false;
    wrap.append(drop);
  }

  return wrap;
}

/**
 * Whether the books agree with the bank, and the daily balances only if not.
 *
 * With a bank feed the bank's own balance is already known: worked back
 * through the lines since the start, it is the bank's opening balance, and
 * each account either agrees with the books or is out by an amount. Only an
 * account that is out needs its daily balances, which find the day the two
 * parted -- so the file is asked for then, and for that account, rather than
 * as an optional extra nobody could see the point of.
 *
 * Without a feed, the daily balances are the only outside witness there is:
 * everything else comes from the same two systems, and a total built from the
 * rows cannot say a row is missing.
 */
function bankBalancesStep(led: StoredLedger): SetupStep {
  const money = (cents: number): string =>
    `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toLocaleString(booksLocale(), {
      minimumFractionDigits: moneyPlaces(),
      maximumFractionDigits: moneyPlaces(),
    })}`;

  // The bank's daily balances file, whenever one is loaded. It needs nothing
  // else in place: it compares the bank's balance with the lines day by day,
  // so it can say now whether anything is missing or in twice -- and it holds
  // each account's balance on the day before the books start, which is the
  // opening balance itself.
  const fromFile = balanceChecksNow().filter((c) => c.account !== null);
  const fileTies = fromFile.length > 0 && fromFile.every((c) => c.breaks.length === 0);
  const fileLines = fromFile.map((c) => {
    const name = bankLabel(c.account ?? "");
    const first = c.breaks[0];
    return first === undefined
      ? `${name}: agrees with the bank every day.`
      : `${name}: ${money(Math.abs(c.outBy))} ${c.outBy > 0 ? "more at the bank" : "less at the bank"} ` +
          `than in the books, first out on ${first.date}.`;
  });
  const startDay = dayBeforeBooks();
  const offered = led.openingBalances === undefined ? dailyFileBalances(startDay).size : 0;

  // The bank feed's own balance as well, for the accounts it reaches, once
  // the opening balances it is worked from are in.
  const fed = fedFromBankFeed();
  const tie = fed && led.openingBalances !== undefined ? feedTieNow() : null;
  const out = (tie?.rows ?? []).filter((r) => r.ours !== r.bankSays);
  const feedAgrees = tie !== null && tie !== undefined && out.length === 0;
  const feedLines =
    !fed
      ? []
      : led.openingBalances === undefined
        ? ["The bank feed is checked too, once the opening balances are in."]
        : tie === undefined
          ? ["Checking against the bank feed…"]
          : tie === null
            ? ["No balance from the bank feed to check against yet: fetch the feed on Bank import."]
            : feedAgrees
              ? [`Bank feed: every account agrees, from ${tie.asAt} to ${tie.on}.`]
              : out.map((r) => {
                  const apart = r.ours - r.bankSays;
                  return (
                    `Bank feed: ${bankLabel(r.bank)} is ${money(Math.abs(apart))} ` +
                    `${apart > 0 ? "more" : "less"} in the books than at the bank, from ${tie.asAt} to ${tie.on}.`
                  );
                });

  const intro =
    fromFile.length === 0
      ? "Load your bank's daily balances export (every account, from before the books start). " +
        "It shows straight away whether any line is missing or in twice, and gives each " +
        "account's opening balance."
      : fileTies
        ? `Daily balances loaded: all ${fromFile.length} accounts agree with the bank every day.`
        : "Daily balances loaded.";

  const outAnywhere = (fromFile.length > 0 && !fileTies) || out.length > 0;
  return {
    what: "Bank balances agree with the bank",
    takesFiles: !fileTies,
    done: fileTies || feedAgrees,
    // Not optional once something is out: that is a line missing or in twice.
    optional: !outAnywhere,
    detail: [intro, ...(fileTies ? [] : fileLines), ...feedLines]
      .concat(
        offered > 0
          ? [`The file has the balance at ${startDay} for ${offered} account${offered === 1 ? "" : "s"}: ` +
              "use them as the opening balances below."]
          : [],
      )
      .join(" "),
    unlocks: "Proves nothing is missing or counted twice, and fills the opening balances",
    links: [
      ...(offered > 0
        ? [{ label: "Use as opening balances", action: () => startBankBalancesFromFile() }]
        : []),
      { label: "Load daily balances", page: "import" as const },
      ...(led.openingBalances !== undefined ? [{ label: "See the check", page: "opening" as const }] : []),
    ],
  };
}

/**
 * The steps, and whether each is done.
 *
 * `withContent` exists because building a step's `extra` is not free of
 * consequence: the migration step's content takes the live drop zone out of
 * the page and puts it inside itself. Asking this function merely how much is
 * left to do -- which the sidebar does on every navigation -- therefore
 * removed the drop zone from a page nobody was even looking at. Anything that
 * wants the answer rather than the elements asks for it without them.
 */
export function setupSteps(
  options: {
    withContent?: boolean;
    /** Content for this one step only: what the guided walk is showing now. */
    contentFor?: string;
  } = {},
): SetupStep[] {
  const everything = options.withContent !== false;
  const contentFor = (what: string): boolean => everything || options.contentFor === what;
  const led = state.ledger;
  const source = $<HTMLSelectElement>("setup-source").value;
  const xero = source === "xero";
  const fromNew = source === "new";
  const entities = led.entities?.entities ?? [];
  const typed = state.chart.filter((a) => a.type.trim() !== "").length;
  const bankLinks = bankLinkState();
  const chartLoaded = fromNew ? state.chart.length > 0 : hasLoadedChart();

  // Renaming the one entity these books belong to is the smallest useful act
  // of setting them up, and the only one that cannot be inferred: a chart
  // arrives with accounts, but nothing can know whose books these are. Still
  // being called by the placeholder name is a reliable sign nobody has been
  // here yet -- and it stops being true the moment somebody renames it, which
  // is why the step is measured on it rather than on having visited a page.
  const named =
    entities.length > 0 && !entities.some((entity) => entity.name === DEFAULT_ENTITY_NAME);

  // In books of several entities, a chart is only there when each of them
  // has accounts of its own. New books start with the business starter chart,
  // all of it given to the first entity -- so a household and two rentals had
  // Sales and Cost of Goods Sold, the rentals had nothing, and this step said
  // done because sixty-six accounts existed.
  const model = led.entities ?? emptyEntityModel();
  const several = model.entities.length > 1;
  // Accounts of an entity's own: anything but the business starter chart,
  // which new books give to their first entity whatever it is. A household
  // holding Sales and Cost of Goods Sold has not got its accounts yet.
  const starter = new Set(starterChart().map((a) => `${a.code.trim()}|${a.name.trim()}`));
  const owning = new Set<string>();
  for (const account of state.chart) {
    const id = model.accounts[accountEntityKey(account)];
    if (id === undefined) continue;
    const kind = model.entities.find((e) => e.id === id)?.kind ?? "business";
    if (kind === "business" || !starter.has(`${account.code.trim()}|${account.name.trim()}`)) owning.add(id);
  }
  const withoutAccounts = several ? model.entities.filter((e) => !owning.has(e.id)) : [];

  // And which of them each bank account is for, without which a line cannot
  // be placed: its GST, its opening balance and its suggestions all start there.
  const heldBanks = [...new Set(led.transactions.map((t) => t.account))];
  const unticked = several ? heldBanks.filter((bank) => (model.banks[bank] ?? []).length === 0) : [];
  const byName = several ? banksByName(unticked, model.entities) : [];

  const steps: SetupStep[] = [
    {
      what: "Bank transactions",
      done: led.transactions.length > 0,
      detail:
        led.transactions.length > 0
          ? `${led.transactions.length} imported`
          : "Connect a bank feed (recommended), or import bank CSV files, on the Bank import page.",
      unlocks: "",
      links: [{ label: "Bank import", page: "import" }],
    },
  ];

  // Xero only. A spreadsheet migration is one file, its coding, and that is
  // the "Coded history" step below -- after the chart, which it needs. Listing
  // it here as well asked for the coding before there were accounts to read
  // it against.
  if (xero) {
    const files = xeroMigrationFiles();
    const loadedCount = files.filter((f) => f.have).length;
    steps.push({
      what: xero
        ? "Migration from Xero - the more provided the more of the following set-up will be complete"
        : "Migration from spreadsheet - the more provided the more of the following set-up will be complete",
      // Ticked only when every file is in. It used to tick on the first of
      // them, which told somebody with one of seven that the migration was
      // done and left the six that carry opening balances, invoices, assets
      // and past returns looking like extras nobody needed.
      done: loadedCount === files.length,
      partial: loadedCount > 0 && loadedCount < files.length,
      optional: true,
      detail:
        loadedCount === 0
          ? ""
          : loadedCount === files.length
            ? `all ${files.length} loaded`
            : `${loadedCount} of ${files.length} loaded — ` +
              files
                .filter((f) => !f.have)
                .map((f) => f.what)
                .join(", ") +
              " still to come",
      unlocks: "Teaches rules, carries opening balances, invoices, assets, and past returns",
      ...(everything ? { extra: migrationStepContent(source) } : {}),
    });
  }

  steps.push(
    {
      // The chart step used to be judged on this as well, so a chart that had
      // imported perfectly sat unticked and the fix was on another page --
      // two unrelated facts under one tick, and the more confusing of them
      // reported against the wrong one. It is its own step now, and it is
      // done at the top of this page rather than by hunting for a placeholder
      // entity somewhere else.
      what: "Whose books are these?",
      done: named,
      detail: named
        ? entities.map((e) => e.name).join(", ")
        : "The name these books report and file under.",
      unlocks: "Every report, and every return, can say who it is for",
      // The field itself, rather than a step telling you to go and find it.
      // It was sitting above the list saying the same words as the first step
      // of the list, and the step had nothing to click -- so the one step you
      // could not act on was the one you had to do first.
      ...(contentFor("Whose books are these?") ? { extra: setupNameField() } : {}),
    },
    {
      what: "Chart of accounts",
      takesFiles: !(fromNew && several),
      done: chartLoaded && withoutAccounts.length === 0,
      detail:
        withoutAccounts.length > 0
          ? `${withoutAccounts.map((e) => e.name).join(", ")} ` +
            `${withoutAccounts.length === 1 ? "has" : "have"} no accounts yet. Standard accounts adds ` +
            "the usual set for a person, a rental or a business, each with its own code suffix."
          : chartLoaded
            ? `${state.chart.length} accounts, ${typed} with a type set`
            : xero
              ? "Standard starter chart active (66 accounts). Export and drop your Xero chart to use your own."
              : "Standard starter chart active (66 accounts). Load your chart of accounts.",
      unlocks: "Names accounts consistently, and carries entities and GST treatments",
      page: "entities",
      ...(contentFor("Chart of accounts") && withoutAccounts.length > 0
        ? { extra: standardAccountButtons(withoutAccounts) }
        : {}),
    },
    ...(several && heldBanks.length > 0
      ? [
          {
            what: "Which entity each bank account is for",
            done: unticked.length === 0,
            detail:
              unticked.length === 0
                ? `${heldBanks.length} bank account${heldBanks.length === 1 ? "" : "s"}, each ticked to its entity`
                : `${unticked.length} of ${heldBanks.length} not ticked yet. Tick every entity an ` +
                  "account pays for; a shared card is ticked for each.",
            unlocks: "GST, opening balances and suggestions that know whose money a line is",
            page: "entities",
            ...(contentFor("Which entity each bank account is for") ? { extra: bankEntityTable() } : {}),
            ...(byName.length > 0
              ? {
                  links: [
                    {
                      label: `Tick by name: ${byName.map((p) => `${p.label} \u2192 ${p.entity}`).join(", ")}`,
                      action: () => void tickByName(byName),
                    },
                    { label: "Go", page: "entities" as const },
                  ],
                }
              : {}),
          },
        ]
      : []),
    ...(bankLinks.rows === 0 || bankLinks.held === 0
      ? []
      : [{
      what: "Link bank accounts on chart of accounts",
      done: bankLinks.unlinked.length === 0,
      detail:
        bankLinks.unlinked.length === 0
          ? `Every bank account with transactions is linked to its row on the chart.`
          : `${bankLinks.unlinked.length} bank account${bankLinks.unlinked.length === 1 ? " has" : "s have"} ` +
            `transactions but no row on the chart linked to it: ${bankLinks.unlinked.join(", ")}. ` +
            "Choose which chart row each one is. Rows with no transactions, such as petty cash, can " +
            "stay unlinked." +
            (source === "xero"
              ? " Xero's list of its bank accounts links them by number: Accounting \u2192 Bank " +
                "accounts \u2192 Uncoded statement lines \u2192 Export, for all bank accounts."
              : ""),
      unlocks: "Opening balances and transfers land on the right bank account",
      links: [
        ...(source === "xero" && bankLinks.unlinked.length > 0
          ? [{ label: "Load Xero's bank account list", action: () => pickXeroBankList() }]
          : []),
        {
          label: bankLinks.unlinked.length === 0 ? "Review" : "Go",
          action: () => {
            showPage("entities", "bottom");
          },
        },
      ],
    }]),
    // Before the opening balances: the daily balances file supplies them.
    bankBalancesStep(led),
    {
      // Required for a ledger that starts partway through a company's life,
      // and meaningless for one that starts at the beginning -- so it is only
      // optional in the case where it genuinely is. Missing them does not
      // produce a short balance sheet, it produces a wrong one, which is the
      // reason this is its own step rather than a note on the reports page.
      what: "Opening balances",
      // A new set of books has no trial balance to drop; what it has is bank
      // and loan balances, which are entered on the page rather than loaded.
      takesFiles: !fromNew,
      // Needed by new books too: a bank account or a loan that held anything
      // on the day the books start is an opening balance, and without it
      // the balance sheet is a movement rather than a position. Only books
      // where every account really started at nothing can say so and skip it.
      done: led.openingBalances !== undefined || led.startedAtNothing === true,
      detail:
        led.openingBalances !== undefined
          ? `${Object.keys(led.openingBalances.accounts).length} accounts as at ` +
            led.openingBalances.asAt
          : led.startedAtNothing === true
            ? "Every account started at nothing, so there are no opening balances."
            : fromNew
            ? "What each bank account and loan held on the day the books start. Enter bank " +
              "balances takes them from a statement on any date, or from the bank feed. Only " +
              "not needed if every account started at nothing."
            : xero
              ? "Xero: Accounting → Reports → Trial Balance, at your previous year end"
              : "A trial balance at the previous year end, so every account and cent is included",
      unlocks: "A balance sheet that is a position rather than a movement, and the IR10",
      page: "opening",
      ...(fromNew && led.openingBalances === undefined && led.startedAtNothing !== true
        ? {
            links: [
              // Fetched from the feed, the bank's own balances are the default.
              fedFromBankFeed()
                ? {
                    label: "Use the bank feed's balances",
                    action: () => {
                      showPage("opening");
                      void startBankBalances();
                    },
                  }
                : { label: "Go", page: "opening" as const },
              {
                label: "Every account started at nothing",
                action: () => {
                  state.ledger = { ...state.ledger, startedAtNothing: true };
                  void save(state.ledger).then(() => {
                    redraw("setup");
                    redraw("migration");
                  });
                },
              },
            ],
          }
        : {}),
    },
    {
      what: "Coded history",
      takesFiles: true,
      done: state.reference.length > 0,
      optional: fromNew,
      detail:
        state.reference.length > 0
          ? `${state.reference.length} coded lines loaded` +
            (unmatchedCodingNames() > 0
              ? `; ${unmatchedCodingNames()} coding names still to match to your accounts`
              : "")
          : fromNew
            ? "Not needed when starting fresh; rules are made from your first coding decisions."
            : xero
              ? XERO_ACCOUNT_TRANSACTIONS
              : "Your spreadsheet, with a column saying what each line was coded to",
      unlocks: "Teaches the rules, and lets your coding be checked against it",
      page: "check",
      // Once the file is in, the names it codes to have to mean accounts in
      // the chart before any of it can be used -- so the matching is here,
      // the step after loading it, rather than on a page found later.
      ...(state.reference.length > 0 && contentFor("Coded history")
        ? (() => {
            const matches = codingMatches();
            return matches === null ? {} : { extra: matches };
          })()
        : {}),
    },
    {
      what: "Rules",
      done: ((state.rules as RuleFileShape | undefined)?.rules ?? []).length > 0,
      optional: true,
      detail:
        ((state.rules as RuleFileShape | undefined)?.rules ?? []).length > 0
          ? `${((state.rules as RuleFileShape | undefined)?.rules ?? []).length} rules`
          : fromNew
            ? "Made as you code: coding a line by hand can create a rule."
            : state.reference.length > 0
              ? "Rules suggested by your coded history. Accept them all, or one at a time."
              : "Optional: load your coded history on the Coding reconciliation page to turn it into rules.",
      unlocks: "",
      // The suggestions themselves, here on the step. They were only on the
      // Coding reconciliation page, reached by a link; accepting the first one
      // there codes some lines, which folds the rest away at the foot of that
      // page, and they looked to have been wiped.
      ...(state.reference.length > 0 && contentFor("Rules") ? { extra: ruleSuggestions() } : {}),
      links: [{ label: "Go", page: "rules" }],
    },
    {
      what: "More than one entity?",
      done: entities.length > 1 || led.singleEntityConfirmed === true,
      optional: true,
      detail:
        entities.length > 1
          ? entities.map((e) => e.name).join(", ")
          : led.singleEntityConfirmed === true
            ? entities[0] !== undefined && entities[0].name !== DEFAULT_ENTITY_NAME
              ? `Only one entity: ${entities[0].name}.`
              : "Only one entity."
            : "Only if one set of books covers several, such as a company and two rentals.",
      unlocks: "Per-entity reports, and owner shares on a return",
      links: led.singleEntityConfirmed === true
        ? [
            {
              label: "Change",
              action: () => {
                delete led.singleEntityConfirmed;
                void save(led);
                redraw("setup");
              },
            },
            { label: "Review", page: "entities" },
          ]
        : entities.length > 1
          ? [{ label: "Review", page: "entities" }]
          : [
              { label: "Go", page: "entities" },
              {
                label: "Only one entity",
                action: () => {
                  led.singleEntityConfirmed = true;
                  void save(led);
                  redraw("setup");
                },
              },
            ],
    },
    {
      what: "Invoices",
      takesFiles: true,
      done: (led.invoices ?? []).length > 0,
      optional: true,
      detail:
        (led.invoices ?? []).length > 0
          ? `${(led.invoices ?? []).length} invoices, ${(led.allocations ?? []).length} allocations`
          : xero
            ? "Xero: Business → Invoices → Export"
            : "Your invoices, with what each one was for and when it was paid",
      unlocks: "Accrual income, and matching receipts to what they settled",
      page: "invoices",
    },
    {
      what: "Fixed assets",
      takesFiles: true,
      done: (led.assets ?? []).length > 0,
      optional: true,
      detail:
        (led.assets ?? []).length > 0
          ? `${(led.assets ?? []).length} assets`
          : xero
            ? "Xero: Accounting → Fixed assets → Export"
            : "Your asset register: what was bought, when, and for how much",
      unlocks: "Depreciation — the one figure bank data can never produce",
      page: "assets",
    },
    {
      what: "General ledger",
      takesFiles: true,
      done: (led.journals ?? []).length > 0,
      optional: true,
      detail:
        (led.journals ?? []).length > 0
          ? `${(led.journals ?? []).length} journals`
          : fromNew
            ? "Not needed when starting fresh."
            : "Xero: Accounting → Reports → Journal Report, all columns, exported as " +
            "CSV or Excel. Load it on the Reports page.",
      unlocks: "Accrual reports that reproduce a signed set of accounts exactly",
      page: "reports",
    },
    (() => {
      // What myIR can give these books, each file loadable right here, and
      // said plainly where one is missing altogether or for a year.
      const myir = allMyirCards(() => {
        redraw("setup");
        redraw("migration");
      });
      return {
        what: "From Inland Revenue (myIR)",
        done: myir.missing === 0,
        optional: true,
        detail:
          myir.missing === 0
            ? "Everything myIR has that these books use is loaded, for every year they cover."
            : `${myir.missing} of ${myir.cards.length} myIR files still to load, or missing a year. ` +
              "Each says where in myIR to get it, and can be loaded here.",
        unlocks: "Checks against what Inland Revenue holds, and fills in what the books cannot know",
        ...(contentFor("From Inland Revenue (myIR)")
          ? (() => {
              const box = document.createElement("div");
              box.append(...myir.cards);
              return { extra: box };
            })()
          : {}),
      };
    })(),
    {
      what: "Filed GST returns",
      takesFiles: true,
      done: state.filed.length > 0,
      optional: true,
      detail:
        state.filed.length > 0
          ? `${state.filed.length} periods loaded`
          : xero
            ? "The returns you have already filed, as they were filed: Xero's GST return " +
              "workbooks, or myIR's GST return summary"
            // Not Xero's workbooks, which somebody coming from a spreadsheet does
            // not have, but what myIR gives everybody: one file holding every
            // return filed on the GST account.
            : (led.entities?.entities ?? []).some((e) => e.gstRegistered !== false)
              ? "The returns already filed: in myIR, open your GST account and download its " +
                "return summary (Excel). One file holds every period."
              : "Nothing to load: no entity here is registered for GST.",
      unlocks: "Checks every period against what was actually filed, and finds what moved",
      page: "gst",
    },
    {
      what: "Last year's income tax return",
      done: (led.incomeReturns ?? []).length > 0,
      optional: true,
      detail:
        (led.incomeReturns ?? []).length > 0
          ? `${(led.incomeReturns ?? []).length} filed return${(led.incomeReturns ?? []).length === 1 ? "" : "s"} held`
          : "A company's IR4 or a person's IR3 from myIR, read by an AI you choose and checked here",
      unlocks: "The loss carried forward, the imputation balance and last year's tax, and a check of the books against what was filed",
      ...(contentFor("Last year's income tax return")
        ? {
            extra: incomeReturnPanel(() => {
              redraw("setup");
              redraw("migration");
            }),
          }
        : {}),
    },
  );
  // A step for a module that is off is not on the list: no invoices to load
  // for personal books, no Xero journal report for books from a spreadsheet.
  const moduleOf: Record<string, string> = {
    Invoices: "business",
    "Fixed assets": "assets",
    "General ledger": "xero",
    "Filed GST returns": "gst",
  };
  return steps.filter((step) => moduleOf[step.what] === undefined || anyModuleOn(moduleOf[step.what] ?? ""));
}

/**
 * The name of the books, asked for where it is first wanted.
 *
 * It is the one fact no export contains: a chart arrives with sixty accounts
 * and not one of them says whose they are. It used to be set by finding the
 * placeholder entity on another page and pressing Rename, which is a strange
 * first instruction to give anybody -- and until it was done the chart step
 * sat unticked with a correctly imported chart sitting behind it.
 */
export function setupNameField(): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "setup-name";
  const model = state.ledger.entities ?? emptyEntityModel();
  const first = model.entities[0];
  const placeholderOnly = first !== undefined && first.name === DEFAULT_ENTITY_NAME;

  // No visible label: the step this sits in is headed "Whose books are these?"
  // already, and saying it twice reads as two questions.
  const input = document.createElement("input");
  input.type = "text";
  input.id = "setup-entity-name";
  input.setAttribute("aria-label", "Whose books are these?");
  input.placeholder = "Your company, trust, or your own name";
  input.value = first === undefined || placeholderOnly ? "" : first.name;

  const save = document.createElement("button");
  save.type = "button";
  save.className = "primary";
  save.textContent = first === undefined ? "Save" : "Rename";

  const said = document.createElement("span");
  said.className = "setup-name-said";
  said.textContent =
    model.entities.length > 1
      ? `${model.entities.length} entities. This renames the first; the rest are on ` +
        "Entities & accounts."
      : "If these books cover several, such as a company and two rentals, add the others " +
        "on Entities & accounts.";

  const commit = async (): Promise<void> => {
    const wanted = input.value.trim();
    if (wanted === "") return;
    const live = state.ledger.entities ?? emptyEntityModel();
    const existing = live.entities[0];
    if (existing === undefined) {
      // The id is derived from the name once, when the entity is made. A
      // rename afterwards keeps it: everything assigned to the entity points
      // at the id, and changing it would orphan the lot.
      save.disabled = true;
      save.classList.add("working");
      try {
        await saveEntities({
          ...live,
          entities: [
            ...live.entities,
            { id: entityId(wanted), name: wanted, kind: "business", gstRegistered: true },
          ],
        });
        save.textContent = "Saved ✓";
        redraw("setupBody");
      } finally {
        save.disabled = false;
        save.classList.remove("working");
      }
      return;
    }
    if (existing.name === wanted) {
      save.textContent = "Saved ✓";
      return;
    }
    save.disabled = true;
    save.classList.add("working");
    try {
      await saveEntities(
        {
          ...live,
          entities: live.entities.map((e) => (e.id === existing.id ? { ...e, name: wanted } : e)),
        },
        `Renamed ${existing.name} to ${wanted}`,
      );
      save.textContent = "Renamed ✓";
      redraw("setupBody");
    } finally {
      save.disabled = false;
      save.classList.remove("working");
    }
  };
  save.addEventListener("click", () => void commit());
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") void commit();
  });
  input.addEventListener("input", () => {
    const live = state.ledger.entities ?? emptyEntityModel();
    const existing = live.entities[0];
    const wanted = input.value.trim();
    if (existing && existing.name === wanted) {
      save.textContent = "Saved ✓";
    } else {
      save.textContent = existing === undefined ? "Save" : "Rename";
    }
  });

  wrap.append(input, save, said);
  return wrap;
}

/**
 * Nothing above the list any more.
 *
 * The name field used to sit here, repeating the words of the first step
 * directly beneath it. It is in that step now; this clears what the old
 * arrangement may have left behind and takes its own space back.
 */
function renderSetupIntro(): void {
  const intro = $("setup-intro");
  intro.textContent = "";
  // Modules: what these books cover, each on or off, so what does not apply
  // stays out of the way. The sidebar's "Modules" link comes here.
  const box = document.createElement("section");
  box.id = "setup-modules";
  box.className = "modules-box";
  const heading = document.createElement("h3");
  heading.textContent = "Modules";
  const here = modulesHere();
  const on = here.filter((m) => moduleOn(m.id)).length;
  box.append(
    heading,
    note(
      `${on} of ${here.length} on. Anything that belongs to a module that is off is hidden: its ` +
        "pages, reports and questions. Nothing in the books changes, and turning a module back on " +
        "brings it all back. Click one to turn it on or off.",
    ),
    modulesPanel(renderSetupIntro),
  );
  const steps = document.createElement("h3");
  steps.textContent = "Set-up steps";
  const country = countryBox();
  if (country !== null) intro.append(country);
  intro.append(box, steps);
  intro.hidden = false;
}

/**
 * Which country these books are kept in.
 *
 * Only in the international edition, or for books already set to another
 * country: NZOSA as it ships keeps New Zealand's books and never asks. The
 * country decides the tax year, the currency, the rate of GST or VAT, and
 * which returns and pages there are; changing it reloads the app so that
 * everything is drawn again under the new country.
 */
function countryBox(): HTMLElement | null {
  const set = state.ledger.jurisdiction;
  if (edition() !== "international" && (set === undefined || set === "nz")) return null;
  const box = document.createElement("section");
  box.id = "setup-country";
  box.className = "modules-box";
  const heading = document.createElement("h3");
  heading.textContent = "Country";
  const select = document.createElement("select");
  select.setAttribute("aria-label", "Country these books are kept in");
  for (const one of Object.values(JURISDICTIONS)) {
    const option = document.createElement("option");
    option.value = one.id;
    option.textContent = one.name;
    select.append(option);
  }
  select.value = jurisdictionOf(set).id;
  select.addEventListener("change", () => {
    state.ledger = { ...state.ledger, jurisdiction: select.value };
    select.disabled = true;
    void savePart(state.ledger).then(() => location.reload());
  });
  const here = jurisdictionOf(set);
  box.append(
    heading,
    note(
      "The country decides the tax year, the currency, GST or VAT, and which returns these books " +
        `produce. Now: ${here.name} — year to ${here.yearEnd.endDay}/${here.yearEnd.endMonth}, ${here.currency}` +
        (here.salesTax === null ? ", no national sales tax." : `, ${here.salesTax.name} ${Math.round(here.salesTax.rate * 100)}%.`),
    ),
    select,
  );
  return box;
}

export function renderSetup(): void {
  // Nobody has said where these books came from: say what they show, rather
  // than Xero, the first in the list, for books that never saw it.
  if (sourceForTheseBooks() === undefined && onboarding().source === undefined) {
    $<HTMLSelectElement>("setup-source").value = moduleOn("xero") ? "xero" : moduleOn("sheet") ? "sheet" : "new";
  }
  renderSetupIntro();
  redraw("setupBody");
}

export function renderSetupBody(): void {
  const source = $<HTMLSelectElement>("setup-source").value;
  const setupDrop = $("setup-drop");
  if (setupDrop) {
    $("page-setup").append(setupDrop);
    setupDrop.hidden = source === "new";
  }

  const body = $("setup-body");
  body.textContent = "";

  const steps = setupSteps();
  const needed = steps.filter((s) => s.optional !== true);
  const done = needed.filter((s) => s.done).length;
  const extras = steps.filter((s) => s.optional === true && s.done).length;

  const summary = document.createElement("p");
  summary.className = "setup-progress";
  summary.textContent =
    `${done} of ${needed.length} set up.` + (extras > 0 ? ` ${extras} optional as well.` : "");
  body.append(summary);

  // Where to come back to. Each step sends you off to another page, and
  // nothing there says the list you came from is keeping score -- so it looked
  // like a page you pass through once rather than the one you work down.
  body.append(
    note(
      done === needed.length
        ? "Everything needed is set up. The optional steps below each say what they add."
        : "Work down the list. Each step opens its page and is ticked off when done; " +
          "it does not need to be done in one sitting.",
    ),
  );

  // Somewhere to see it working before trusting it with anything, said here
  // rather than only at the foot of the page under a heading nobody scrolls to.
  if (state.ledger.transactions.length === 0) {
    const demo = document.createElement("p");
    demo.className = "setup-demo";
    demo.textContent =
      "Not ready to load your own? Try the sample books: a coffee roaster and a rental " +
      "property part way through a year. They open separately, so nothing here is changed.";
    const open = document.createElement("button");
    open.type = "button";
    open.textContent = writesToFolder() ? "Open the demo books" : "Load demo data";
    open.addEventListener("click", () => void loadDemoData(open));
    demo.append(document.createElement("br"), open);
    body.append(demo);
  }

  const list = document.createElement("div");
  list.className = "setup-steps";
  for (const step of steps) {
    const row = document.createElement("div");
    row.className = step.done ? "setup-step done" : "setup-step";

    const mark = document.createElement("span");
    mark.className = "setup-mark";
    // An optional step nobody has done is not an empty box waiting to be
    // ticked, so it does not get one.
    mark.textContent = step.done
      ? "✓"
      : step.partial === true
        ? "◐"
        : step.optional === true
          ? "–"
          : "";
    if (step.partial === true && !step.done) {
      mark.classList.add("partial");
      mark.title = "Started, not finished";
    } else if (step.optional === true && !step.done) {
      mark.title = "Optional";
    }

    const text = document.createElement("div");
    const title = document.createElement("div");
    title.className = "setup-title";
    const parts = step.what.split(" - ");
    if (parts.length > 1) {
      const strong = document.createElement("strong");
      strong.textContent = parts[0] ?? step.what;
      const rest = document.createElement("span");
      rest.className = "setup-what-sub";
      rest.textContent = ` - ${parts.slice(1).join(" - ")}`;
      title.append(strong, rest);
    } else {
      const strong = document.createElement("strong");
      strong.textContent = step.what;
      title.append(strong);
    }
    text.append(title);
    if (step.detail && step.detail.trim() !== "") {
      const detail = document.createElement("div");
      detail.className = "setup-detail";
      detail.textContent = step.detail;
      text.append(detail);
    }
    if (step.extra) {
      text.append(step.extra);
    }
    if (!step.done && step.unlocks !== "") {
      const unlocks = document.createElement("div");
      unlocks.className = "setup-unlocks";
      unlocks.textContent = `Gives you: ${step.unlocks}`;
      text.append(unlocks);
    }

    row.append(mark, text);
    const links: SetupLink[] = step.links ?? (step.page === undefined
      ? []
      : [{ label: step.done ? "Review" : "Go", page: step.page }]);
    if (links.length > 0) {
      const buttons = document.createElement("div");
      buttons.className = "setup-go";
      for (const link of links) {
        const go = document.createElement("button");
        go.type = "button";
        go.textContent = link.label;
        go.addEventListener("click", () => {
          if (link.action) {
            link.action();
          } else if (link.page) {
            showPage(link.page);
          }
        });
        buttons.append(go);
      }
      row.append(buttons);
    }
    list.append(row);
  }
  body.append(list);

}

/**
 * The clear control, where there is only one set of books to clear.
 *
 * With a folder behind the app, clearing belongs on the Books page beside the
 * books it clears. Without one there is no Books page worth the name -- there
 * is one browser holding one ledger -- and the two pages pointed at each other:
 * Setup said clearing was on Books, Books said it was on Setup, and there was
 * no way to do it at all. That matters most on exactly the copy that has no
 * folder, because that is the one somebody is trying out and wants to reset.
 * It lives on the Books page for them now, with the backups.
 */
export function clearHereControl(): HTMLElement {
  const wrap = document.createElement("div");

  const start = document.createElement("button");
  start.type = "button";
  start.textContent = "Clear these books…";

  const area = document.createElement("div");
  area.hidden = true;

  start.addEventListener("click", () => {
    area.hidden = !area.hidden;
    if (area.hidden) {
      area.textContent = "";
      return;
    }

    const what = document.createElement("p");
    const count = state.ledger.transactions.length;
    what.textContent =
      `This removes ${count} transaction${count === 1 ? "" : "s"} and all coding, rules, ` +
      "invoices, entities and assets. No copy is kept; download a backup first if you want one.";

    const label = document.createElement("label");
    const says = document.createElement("span");
    says.textContent = `Type "${CLEAR_PHRASE}" to enable the button.`;
    const typed = document.createElement("input");
    typed.type = "text";
    typed.placeholder = CLEAR_PHRASE;
    typed.autocomplete = "off";
    label.append(says, typed);

    const go = document.createElement("button");
    go.type = "button";
    go.className = "danger";
    go.textContent = "Clear these books";
    go.disabled = true;
    typed.addEventListener("input", () => {
      go.disabled = typed.value.trim() !== CLEAR_PHRASE;
    });
    go.addEventListener("click", () => {
      go.disabled = true;
      go.textContent = "Clearing…";
      void clearEverything(go);
    });

    const form = document.createElement("div");
    form.className = "clear-form";
    form.append(label, go);
    area.append(what, form);
    typed.focus();
  });

  wrap.append(start, area);
  return wrap;
}

export async function loadDemoData(button: HTMLButtonElement): Promise<void> {
  if (writesToFolder()) {
    button.disabled = true;
    button.textContent = "Opening…";
    if (!(await switchLedger("demo", "Demo"))) {
      alert("Could not open the demo books.");
      button.disabled = false;
      button.textContent = "Open the demo books";
      return;
    }
    // The demo ledger is the open one now. Filling it cannot touch anything
    // else, and if it already holds the demo the reload simply shows it.
    await loadStartupFiles("demo", true);
    location.reload();
    return;
  }

  if (
    state.ledger.transactions.length > 0 &&
    !confirm(
      `This replaces everything in the browser: ${state.ledger.transactions.length} ` +
        `transactions and the coding on them. There is no undo.\n\nGo ahead?`,
    )
  ) {
    return;
  }

  button.disabled = true;
  button.textContent = "Loading…";
  try {
    await wipe();
    await loadStartupFiles("demo", true);
    reclassify();
    state.entityFilter = "";
    showPage("reconcile");
  } catch (error) {
    alert(`Could not load the demo data: ${(error as Error).message}`);
    button.disabled = false;
    button.textContent = "Load demo data";
  }
}

/**
 * Give a brand new set of books the standard chart of accounts.
 *
 * Starting empty is honest and useless. With no chart there is nothing to code
 * to, the account picker is empty, and the first thing anybody has to do is go
 * and find a chart of accounts somewhere else -- and what they would find is
 * very nearly this one, because it is the standard New Zealand small-company
 * chart, in the numbering an accountant here expects.
 *
 * Only when the books are genuinely new: no chart, nothing imported, nothing
 * coded. Someone who has deliberately cleared their chart down to the accounts
 * they use has a ledger with transactions in it, and must not find sixty-six
 * accounts back the next time they open the app.
 */
export async function seedStarterChart(): Promise<void> {
  if (state.chart.length > 0) return;
  if (state.ledger.transactions.length > 0) return;
  if (Object.keys(state.ledger.overrides ?? {}).length > 0) return;

  const chart = starterChart();
  state.chart = chart;
  state.ledger = { ...state.ledger, chart };
  state.persistent = await savePart(state.ledger, "chart");
  await record(
    "chart",
    `Started with the standard chart of accounts, ${chart.length} accounts`,
    null,
    null,
  );
}

/**
 * What a browser with nothing in it should open on.
 *
 * With no folder behind the app there is nowhere for real books to live
 * durably, so a copy served as plain files is a demonstration whether or not
 * it says so. Somebody arriving at an empty one has nothing to look at and no
 * way to tell whether any of it works, and the honest fix is to fill it: the
 * invented books are already shipped beside the app, so they load themselves.
 *
 * Never over anything. Only a ledger with no transactions in it is seeded, and
 * only once -- the flag is what stops a deliberate clear from being undone on
 * the next refresh, which looks exactly like the clear not having worked.
 * `wipe()` sets it for the same reason, so clearing means cleared.
 *
 * A folder-backed app never reaches here. There the books are the folder, and
 * a demo belongs in a folder of its own.
 */
export async function seedBrowser(): Promise<void> {
  // A copy that ships its own data still wins: `data/` is somebody's
  // deliberate seed, and the demo is only the fallback for an empty one. The
  // demo build has no `data/`, and asking for its seven files first was most
  // of the wait before the demo appeared.
  if (!isDemoBuild()) await loadStartupFiles();
  if (state.ledger.transactions.length > 0) return;

  let already = true;
  try {
    already = localStorage.getItem(DEMO_SEEDED) !== null;
  } catch {
    // Storage can throw outright rather than come back empty -- a browser set
    // to block site data, or a preview pane. Treated as "already", because
    // seeding on every single load is worse than never seeding.
    already = true;
  }
  if (already) return;

  await loadStartupFiles("demo", true);
  if (state.ledger.transactions.length === 0) return; // nothing shipped; say nothing
  markDemoSeeded();
  reclassify();
  state.startupMessage =
    "These are demo books — an invented coffee roastery and two rentals owned by " +
    "a couple, part way through a year. Nothing here is real, and you can change anything. To keep " +
    "books of your own, run NZOSA on your own computer: see the guide for owners.";
}

/** Choosing which system the books are coming from. */
export function wireSetup(): void {
  // The sidebar's sub-links under Setup: Modules, and the steps.
  for (const link of document.querySelectorAll<HTMLAnchorElement>("#sidebar-setup-sublinks a")) {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      if (state.page !== "setup") showPage("setup");
      document.getElementById((link.getAttribute("href") ?? "").slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  $<HTMLSelectElement>("setup-source").addEventListener("change", () => {
    // The same question Start here asks: the Xero and spreadsheet modules follow it.
    const value = $<HTMLSelectElement>("setup-source").value;
    if (value === "xero" || value === "sheet" || value === "new") rememberSource(value);
    applyModules();
    redraw("setup");
  });
}

/**
 * Mark the sidebar while there is set-up left to do.
 *
 * Set-up is the one page whose job is to be finished with, and nothing said
 * whether it had been. Somebody who left it half done -- a chart loaded, the
 * banks not yet linked -- had no reason to go back, and the reports quietly
 * carried on being wrong in the way the unfinished step was there to prevent.
 *
 * The required steps only. An optional one never done is not work outstanding,
 * and colouring the menu for ever because nobody loaded a past GST return
 * would teach people to ignore the colour.
 */
export function markSetupProgress(): void {
  const button = document.querySelector<HTMLButtonElement>(
    '.sidebar-nav button[data-page="setup"]',
  );
  if (!button) return;

  const needed = setupSteps({ withContent: false }).filter((step) => step.optional !== true);
  const left = needed.filter((step) => !step.done).length;
  button.classList.toggle("needs-doing", left > 0);
  button.title =
    left > 0
      ? `${left} set-up step${left === 1 ? "" : "s"} still to do`
      : "Set-up is complete";
}