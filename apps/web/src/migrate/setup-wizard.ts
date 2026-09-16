import { redraw, showPage } from "../app.js";
import {
  CLEAR_PHRASE,
  accountsForEditing,
  clearEverything,
  ledgerAccountFor,
  reclassify,
  saveEntities,
  tidyChart,
  useRules,
  wipe,
} from "../books.js";
import { applyChartColumns } from "../migrate/coding-reconciliation.js";
import { describeRules } from "../rules-ui.js";
import type { RuleFileShape } from "../rules-ui.js";
import { $, state } from "../state.js";
import { save, switchLedger, writesToFolder } from "../store.js";
import type { StoredLedger } from "../store.js";
import { note, setLoadingStatus } from "../ui.js";
import {
  DEFAULT_ENTITY_NAME,
  emptyEntityModel,
  entityId,
  parseChartOfAccounts,
  parseFixedAssets,
  parseXeroAllocations,
  parseXeroInvoices,
  parseXeroJournalReport,
  starterChart,
} from "@nzosa/core";
import type { Account, } from "@nzosa/core";
import { DEMO_SEEDED, markDemoSeeded, record } from "../books.js";
import { savePart } from "../store.js";

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

  for (const entry of startupFiles()) {
    // `replace` is for a deliberate load, where the point is to overwrite.
    if (!replace && entry.have()) continue;
    try {
      setLoadingStatus(`Loading ${entry.what}…`);
      // Asked of the server every time rather than taken from the browser's
      // cache: the demo's files are replaced when the demo is, and a cached
      // copy seeded a returning visitor with the books from before -- half a
      // year's data missing and nothing to say so.
      const response = await fetch(`${folder}/${entry.file}`, { cache: "no-cache" });
      if (!response.ok) continue;
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

interface SetupStep {
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
function bankLinkState(): { total: number; unlinked: string[] } {
  const rows = accountsForEditing().filter(
    ({ account }) => account.type.trim().toLowerCase() === "bank",
  );
  const unlinked = rows
    .filter(
      ({ account }) =>
        account.ledgerAccount === undefined && ledgerAccountFor(account.name, account) === null,
    )
    .map(({ account }) => account.name);
  return { total: rows.length, unlinked };
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
      what: "Fixed assets",
      where: "Accounting → Fixed assets → Export",
      why: "Asset register & depreciation",
      have: (led.assets ?? []).length > 0,
      page: "assets",
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
 * The steps, and whether each is done.
 *
 * `withContent` exists because building a step's `extra` is not free of
 * consequence: the migration step's content takes the live drop zone out of
 * the page and puts it inside itself. Asking this function merely how much is
 * left to do -- which the sidebar does on every navigation -- therefore
 * removed the drop zone from a page nobody was even looking at. Anything that
 * wants the answer rather than the elements asks for it without them.
 */
function setupSteps(options: { withContent?: boolean } = {}): SetupStep[] {
  const withContent = options.withContent !== false;
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

  const steps: SetupStep[] = [
    {
      what: "Bank transactions",
      done: led.transactions.length > 0,
      detail:
        led.transactions.length > 0
          ? `${led.transactions.length} imported`
          : "Connect a bank feed (best), or drop your bank CSVs, on the Bank import page. " +
            "Everything else hangs off these.",
      unlocks: "",
      links: [{ label: "Bank import", page: "import" }],
    },
  ];

  if (xero || source === "sheet") {
    const files = xero ? xeroMigrationFiles() : spreadsheetMigrationFiles();
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
      ...(withContent ? { extra: migrationStepContent(source) } : {}),
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
        : "The one thing no export contains: a chart arrives with sixty accounts and " +
          "not one of them says whose they are.",
      unlocks: "Every report, and every return, can say who it is for",
      // The field itself, rather than a step telling you to go and find it.
      // It was sitting above the list saying the same words as the first step
      // of the list, and the step had nothing to click -- so the one step you
      // could not act on was the one you had to do first.
      ...(withContent ? { extra: setupNameField() } : {}),
    },
    {
      what: "Chart of accounts",
      done: chartLoaded,
      detail: chartLoaded
        ? `${state.chart.length} accounts, ${typed} with a type set`
        : xero
          ? "Standard starter chart active (66 accounts). Export and drop your Xero chart to use your own."
          : "Standard starter chart active (66 accounts). Load your chart of accounts.",
      unlocks: "Names accounts consistently, and carries entities and GST treatments",
      page: "entities",
    },
    {
      what: "Link bank accounts on chart of accounts",
      done: bankLinks.total > 0 && bankLinks.unlinked.length === 0,
      detail:
        bankLinks.total > 0 && bankLinks.unlinked.length === 0
          ? `${bankLinks.total} bank account${bankLinks.total === 1 ? "" : "s"} mapped to accounts from bank import`
          : bankLinks.unlinked.length > 0
            ? "The bank import pulls in account numbers directly, on the chart of account look at your existing bank accounts and make sure mapped to the accounts from bank import. " +
              `(${bankLinks.unlinked.length} of ${bankLinks.total} not yet mapped: ${bankLinks.unlinked.join(", ")})`
            : "The bank import pulls in account numbers directly, on the chart of account look at your existing bank accounts and make sure mapped to the accounts from bank import.",
      unlocks: "Helps correctly allocate transfers between your own accounts",
      links: [
        {
          label: bankLinks.total > 0 && bankLinks.unlinked.length === 0 ? "Review" : "Go",
          action: () => {
            showPage("entities", "bottom");
          },
        },
      ],
    },
    {
      // Required for a ledger that starts partway through a company's life,
      // and meaningless for one that starts at the beginning -- so it is only
      // optional in the case where it genuinely is. Missing them does not
      // produce a short balance sheet, it produces a wrong one, which is the
      // reason this is its own step rather than a note on the reports page.
      what: "Opening balances",
      done: led.openingBalances !== undefined,
      optional: fromNew,
      detail:
        led.openingBalances !== undefined
          ? `${Object.keys(led.openingBalances.accounts).length} accounts as at ` +
            led.openingBalances.asAt
          : fromNew
            ? "Nothing to bring in when the ledger starts at the beginning of the company: " +
              "everything it has ever done is in the transactions."
            : xero
              ? "Xero: Accounting → Reports → Trial Balance, at your previous year end"
              : "A trial balance at the previous year end, which carries every account " +
                "and the cents, so the figures balance on their own",
      unlocks: "A balance sheet that is a position rather than a movement, and the IR10",
      page: "opening",
    },
    {
      what: "Coded history",
      done: state.reference.length > 0,
      optional: fromNew,
      detail:
        state.reference.length > 0
          ? `${state.reference.length} coded lines loaded`
          : fromNew
            ? "Nothing to load when you are starting from new. Your rules will come " +
              "from the first few codings you make instead."
            : xero
              ? XERO_ACCOUNT_TRANSACTIONS
              : "Your spreadsheet, with a column saying what each line was coded to",
      unlocks: "Teaches the rules, and lets your coding be checked against it",
      page: "check",
    },
    {
      what: "Rules",
      done: ((state.rules as RuleFileShape | undefined)?.rules ?? []).length > 0,
      optional: true,
      detail:
        ((state.rules as RuleFileShape | undefined)?.rules ?? []).length > 0
          ? `${((state.rules as RuleFileShape | undefined)?.rules ?? []).length} rules`
          : fromNew
            ? "Written for you as you code. Coding a transaction by hand offers to " +
              "make a rule from it."
            : state.reference.length > 0
              // The proposals themselves are on the Check page, where the file
              // that produces them is loaded. This says they are waiting and
              // sends you there, rather than repeating the whole table here.
              ? "Optional: your coded history can write these for you. The proposals " +
                "are on the Coding reconciliation page, under the file they came from."
              : "Optional: load a coded history on the Coding reconciliation page and the coding " +
                "you have already done becomes the rules.",
      unlocks: "",
      links:
        state.reference.length > 0 &&
        ((state.rules as RuleFileShape | undefined)?.rules ?? []).length === 0
          ? [
              { label: "See the proposals", page: "check" },
              { label: "Rules", page: "rules" },
            ]
          : [{ label: "Go", page: "rules" }],
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
            : "Only if one set of books holds several things — a company and two " +
              "rentals, say. One company or one person needs none of this.",
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
      done: (led.journals ?? []).length > 0,
      optional: true,
      detail:
        (led.journals ?? []).length > 0
          ? `${(led.journals ?? []).length} journals`
          : fromNew
            ? "Nothing to load when you are starting from new."
            : "Xero: Accounting → Reports → Journal Report, all columns, exported as " +
            "CSV or Excel. Load it on the Fixed assets page's neighbour, Reports.",
      unlocks: "Accrual reports that reproduce a signed set of accounts exactly",
      page: "reports",
    },
    {
      // Asked for by name, because it is the only outside witness there is.
      // Everything else in this list comes from the same two systems; a total
      // built from the rows cannot tell you a row is missing.
      what: "Daily bank balances",
      done: state.balanceChecks.length > 0,
      optional: true,
      detail:
        state.balanceChecks.length > 0
          ? `${state.balanceChecks.filter((c) => c.account !== null && c.breaks.length === 0).length} of ` +
            `${state.balanceChecks.length} accounts tie to the bank`
          : "Optional, however a worthwhile check.",
      unlocks: "Proves nothing is missing or counted twice, and settles questionable duplicates",
      page: "import",
    },
    {
      what: "Filed GST returns",
      done: state.filed.length > 0,
      optional: true,
      detail:
        state.filed.length > 0
          ? `${state.filed.length} periods loaded`
          : fromNew
            ? "Nothing filed yet when you are starting from new."
            : "The returns you have already filed, as they were filed",
      unlocks: "Checks every period against what was actually filed, and finds what moved",
      page: "gst",
    },
  );
  return steps;
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
      : "Only needed once. If one set of books holds several things -- a company and two " +
        "rentals, say -- add the others on Entities & accounts.";

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
  intro.hidden = true;
}

export function renderSetup(): void {
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
        ? "Everything needed is set up. The optional steps below each say what they " +
          "add; come back here whenever you load something new."
        : "Work down the list. Each step opens the page that does it — come back here " +
          "afterwards and it will have ticked itself off. Nothing has to be done in " +
          "one sitting.",
    ),
  );

  // Somewhere to see it working before trusting it with anything, said here
  // rather than only at the foot of the page under a heading nobody scrolls to.
  if (state.ledger.transactions.length === 0) {
    const demo = document.createElement("p");
    demo.className = "setup-demo";
    demo.textContent =
      "Not ready to load your own? There is a complete invented set of books — a " +
      "coffee roastery and a rental, part way through a year, with codings, splits, " +
      "invoices and a transfer. It opens in books of its own, so nothing here is " +
      "touched.";
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

  renderSetupTools(body);
}

/**
 * Demo data, and the way out again.
 *
 * These sit at the foot of Setup because both are about the whole book rather
 * than any one part of it, and because a page that offers to fill the app up
 * should offer to empty it in the same breath.
 */
function renderSetupTools(body: HTMLElement): void {
  const heading = document.createElement("h3");
  heading.textContent = "Demo data";
  body.append(heading);

  body.append(
    note(
      "An invented coffee roastery and a rental, part-way through a year: " +
        "88 bank lines with 35 still to code, two splits, three matched " +
        "invoices and a transfer. Nothing in it is real." +
        (writesToFolder()
          ? " It opens in a set of books of its own called Demo, so whatever you " +
            "are working on is left exactly as it is."
          : " Loading it replaces what is in this browser."),
    ),
  );

  const load = document.createElement("button");
  load.type = "button";
  load.textContent = writesToFolder() ? "Open the demo books" : "Load demo data";
  load.addEventListener("click", () => void loadDemoData(load));
  body.append(load);

  // Clearing lives on the Books page now. It is about a whole set of books
  // rather than about setting one up, and it was reachable there only for
  // whichever books happened to be open -- so tidying an old set away meant
  // opening it first, which is the wrong way round.
  const away = document.createElement("h3");
  away.textContent = "Clearing a set of books";
  body.append(away);

  if (!writesToFolder()) {
    body.append(
      note(
        "There is one set of books here: whatever is in this browser. Clearing it " +
          "cannot be undone, and no copy is kept.",
      ),
    );
    body.append(clearHereControl());
    return;
  }

  body.append(
    note(
      "On the Books page, beside the books it clears. A dated copy is kept first, " +
        "and can be put back.",
    ),
  );
  const goBooks = document.createElement("button");
  goBooks.type = "button";
  goBooks.textContent = "Books";
  goBooks.addEventListener("click", () => showPage("books"));
  body.append(goBooks);
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
 */
function clearHereControl(): HTMLElement {
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
      `This removes ${count} transaction${count === 1 ? "" : "s"} and every coding, ` +
      "rule, invoice, entity and asset with them. Nothing is kept: with no folder " +
      "behind this app there is nowhere to keep a dated copy, so export first if " +
      "you want one.";

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

async function loadDemoData(button: HTMLButtonElement): Promise<void> {
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
  // deliberate seed, and the demo is only the fallback for an empty one.
  await loadStartupFiles();
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
  $<HTMLSelectElement>("setup-source").addEventListener("change", () => redraw("setup"));
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