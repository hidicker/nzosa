#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import {
  parseDailyBalances,
  checkDailyBalances,
  detectAll,
  financialYear,
  formatAmount,
  importFile,
  importers,
  inRange,
  parseAmount,
  parseDate,
} from "@nzosa/core";
import type {
  DateRange,
  DedupeEntry,
  GstBasis,
  GstRounding,
  GstSide,
  GstTreatment,
  ImportProblem,
  Transaction,
} from "@nzosa/core";
import { loadLedger, merge, saveLedger } from "./ledger.js";
import { runGst } from "./gst-command.js";
import type { GstOptions } from "./gst-command.js";
import { runOverride } from "./override-command.js";
import type { OverrideOptions } from "./override-command.js";
import { runSplit } from "./split-command.js";
import type { SplitOptions } from "./split-command.js";
import { runInvoices } from "./invoice-command.js";
import type { InvoiceOptions } from "./invoice-command.js";
import { runExplain } from "./explain-command.js";
import type { ExplainOptions } from "./explain-command.js";
import { runJournals } from "./journal-command.js";
import { runVariance } from "./variance-command.js";
import type { VarianceOptions } from "./variance-command.js";
import type { JournalOptions } from "./journal-command.js";
import { reconcileCommand } from "./reconcile-command.js";
import type { ReconcileOptions } from "./reconcile-command.js";
import type { AccountBalances } from "./ledger.js";

const USAGE = `nzosa -- bank flat files in, a clean transaction ledger out.

Usage:
  nzosa import <file...> [options]   Import files into a ledger
  nzosa detect <file...>             Show which importer matches a file
  nzosa list [options]               Show what is in the ledger
  nzosa balances [options]           Per-account totals, and reconcile
                                          them against known balances, or a
                                          bank daily balance export
  nzosa gst [options]                GST101A returns for each period
  nzosa override <id> [options]      Correct one transaction by hand
  nzosa split <id> [options]         Divide one transaction into parts
  nzosa invoices [options]           Import invoices, match them to money
  nzosa variance [options]          Our GST returns against the filed
                                         ones, and what is still unexplained
  nzosa explain [options]           Record why our figures and a filed
                                         return differ, and accept it
  nzosa journals [options]          Read a general ledger, and show what
                                         it holds that bank data cannot
  nzosa reconcile [options]         Check our reporting against a Xero
                                         Account Transactions export
  nzosa formats                      List supported bank formats

Options:
  --ledger <path>     Ledger file to read and write   (default: ledger.json)
  --account <id>      Account id for files that do not name their own account
  --currency <code>   Account currency                (default: NZD)
  --month-first       Read ambiguous dates as MM/DD/YYYY rather than DD/MM/YYYY
  --year <n>          Restrict to a financial year, labelled by the year it
                      ends in: --year 2026 is 1 Apr 2025 to 31 Mar 2026
  --fy-end <MM-DD>    Financial year end               (default: 03-31)
  --from <date>       Restrict to dates on or after this ISO date
  --to <date>         Restrict to dates on or before this ISO date
  --dry-run           Import and report, but do not write the ledger
  --json              Emit JSON instead of a table
  --help              Show this message

GST options:
  --months <1|2|6>    GST period length                (default: 2)
  --anchor <1-12>     A month a period ends in, which fixes the cycle.
                      3 = Jan/Mar/May/Jul/Sep/Nov      (default: 3)
  --basis <b>         payments, invoice or hybrid      (default: payments)
  --rounding <mode>   form (3/23 of the box total, as GST101A says) or
                      per-line (round each line, as Xero does) (default: form)
  --share <percent>   Your share, for co-owned property (default: 100)
  --accounts <ids>    Comma-separated account ids to include
  --rules <path>      JSON rule set for coding transactions
  --codes <codes>     Comma-separated codes to include (needs --rules).
                      Use when income for an entity is banked elsewhere.
  --detail            List the transactions behind each box
  --format <f>        plain (summary table) or xero (mirrors Xero's GST return)

Variance options:
  --import <path>     GST return workbook (.xlsx) to load. Repeatable.
  --period <date>     Show the lines behind one period

Explain options:
  --period <date>     GST period end the note concerns
  --amount <n>        How much of the difference it explains, in dollars
  --note <why>        What differs, and which side is right
  --list              Show every accepted difference
  --clear             With --period, remove that period's notes

Journal options:
  --import <path>     Xero Journal Report to load
  --code <code>       Only journals touching this account code, e.g. 820

Reconcile options:
  --xero <path>       Xero Account Transactions export to compare against
  --window <days>     How far apart two dates may be and still be the same
                      event                              (default: 5)
  --all               Also list days that agree in total but not line by line
  --whole             Compare whole bank lines against grouped Xero events,
                      for a ledger with no splits recorded yet

Override options:
  --code <code>       Account code to assign, replacing the rules
  --gst <treatment>   standard, zero-rated, exempt or out-of-scope
  --side <side>       sales, purchases, imports or none
  --note <why>        Why. Required when changing a coding or GST treatment
  --confirm           Accept the suggested coding; records that a human agreed
  --claim-in <date>   Claim this transaction's GST in the return ending on
                      this date, as a late claim, instead of its own period
  --clear             Remove the override on this transaction
  --list              Show every override recorded

Split options:
  --half <spec>       Split 50/50 into a GST-claimable half and a
                      non-deductible half, as IRD requires for entertainment.
                      Format: deductibleCode|nonDeductibleCode|note
  --part <spec>       Repeatable. Format: amount|code|gst|note
                      e.g. --part "-15.00|NB Entertainment - 420|standard|client coffee"
                      The parts must sum to the transaction exactly.
  --clear             Remove the split on this transaction
  --list              Show every split recorded

Invoice options:
  --import <path>     Load a Xero sales-invoice CSV export
  --allocations <p>   Load payment allocations from an Account Transactions CSV
  --list              Show every invoice held
  --match             Match invoices to receipts and report
  --apply             Code the matched receipts from their invoice lines
  --accept <id>       Accept one proposed near-match, creating its write-off
  --tolerance <n>     Largest difference to propose, in dollars (default: 5)

Examples:
  nzosa detect statements/*.csv
  nzosa import spending-july.csv --account 02-1100-0022001-00
  nzosa balances --year 2026
  nzosa balances --daily daily-balances.csv
  nzosa gst --year 2026 --accounts 02-1100-0022001-001
  nzosa gst --year 2026 --share 50 --detail
  nzosa override a1b2c3 --gst out-of-scope --note "overseas supplier"
  nzosa split a1b2c3 --part "-15.00|Entertainment|standard|client coffee" \
                          --part "-35.00|Ana||personal groceries"
`;

interface Options {
  ledger: string;
  account: string | undefined;
  currency: string | undefined;
  dayFirst: boolean;
  dryRun: boolean;
  json: boolean;
  range: Partial<DateRange>;
  months: 1 | 2 | 6;
  anchorMonth: number;
  basis: GstBasis;
  rounding: GstRounding;
  sharePercent: number;
  accounts: string[];
  rulesPath: string | undefined;
  /** A bank daily balance export to check the imported transactions against. */
  daily: string | undefined;
  codes: string[];
  detail: boolean;
  format: "plain" | "xero";
  xero: string | undefined;
  window: number;
  all: boolean;
  whole: boolean;
  code: string | undefined;
  claimIn: string | undefined;
  period: string | undefined;
  amount: string | undefined;
  treatment: GstTreatment | undefined;
  side: GstSide | undefined;
  note: string | undefined;
  confirm: boolean;
  clear: boolean;
  list: boolean;
  parts: string[];
  half: string | undefined;
  importPath: string | undefined;
  importPaths: string[];
  allocationsPath: string | undefined;
  match: boolean;
  apply: boolean;
  accept: string | undefined;
  tolerance: number;
  files: string[];
}

function parseArgs(argv: readonly string[]): { command: string; options: Options } {
  const options: Options = {
    ledger: "ledger.json",
    account: undefined,
    currency: undefined,
    dayFirst: true,
    dryRun: false,
    json: false,
    range: {},
    months: 2,
    anchorMonth: 3,
    basis: "payments",
    rounding: "form",
    sharePercent: 100,
    accounts: [],
    rulesPath: undefined,
    daily: undefined,
    codes: [],
    detail: false,
    format: "plain",
    xero: undefined,
    window: 5,
    all: false,
    whole: false,
    code: undefined,
    claimIn: undefined,
    period: undefined,
    amount: undefined,
    treatment: undefined,
    side: undefined,
    note: undefined,
    confirm: false,
    clear: false,
    list: false,
    parts: [],
    half: undefined,
    importPath: undefined,
    importPaths: [],
    allocationsPath: undefined,
    match: false,
    apply: false,
    accept: undefined,
    tolerance: 5,
    files: [],
  };

  // The financial year end is applied after the whole argument list is read,
  // so --year and --fy-end can be given in either order.
  let year: number | undefined;
  let fyEnd = "03-31";
  let command = "";

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;

    switch (arg) {
      case "--help":
      case "-h":
        command = command || "help";
        break;
      case "--ledger":
        options.ledger = argv[++i] ?? options.ledger;
        break;
      case "--account":
        options.account = argv[++i];
        break;
      case "--currency":
        options.currency = argv[++i];
        break;
      case "--month-first":
        options.dayFirst = false;
        break;
      case "--year": {
        const value = Number(argv[++i]);
        if (!Number.isInteger(value)) throw new Error("--year needs a year, e.g. --year 2026");
        year = value;
        break;
      }
      case "--fy-end":
        fyEnd = argv[++i] ?? fyEnd;
        break;
      case "--from":
      case "--to": {
        const raw = argv[++i] ?? "";
        const date = parseDate(raw);
        if (date === null) throw new Error(`${arg} needs a date, got ${JSON.stringify(raw)}`);
        if (arg === "--from") options.range.from = date;
        else options.range.to = date;
        break;
      }
      case "--months": {
        const value = Number(argv[++i]);
        if (value !== 1 && value !== 2 && value !== 6) {
          throw new Error("--months must be 1, 2 or 6");
        }
        options.months = value;
        break;
      }
      case "--anchor": {
        const value = Number(argv[++i]);
        if (!Number.isInteger(value) || value < 1 || value > 12) {
          throw new Error("--anchor must be a month number, 1 to 12");
        }
        options.anchorMonth = value;
        break;
      }
      case "--basis": {
        const value = argv[++i];
        if (value !== "payments" && value !== "invoice" && value !== "hybrid") {
          throw new Error("--basis must be payments, invoice or hybrid");
        }
        options.basis = value;
        break;
      }
      case "--rounding": {
        const value = argv[++i];
        if (value !== "form" && value !== "per-line") {
          throw new Error("--rounding must be form or per-line");
        }
        options.rounding = value;
        break;
      }
      case "--share": {
        const value = Number(argv[++i]);
        if (!Number.isFinite(value) || value <= 0 || value > 100) {
          throw new Error("--share must be a percentage between 0 and 100");
        }
        options.sharePercent = value;
        break;
      }
      case "--accounts":
        options.accounts = (argv[++i] ?? "")
          .split(",")
          .map((id) => id.trim())
          .filter((id) => id !== "");
        break;
      case "--rules":
        options.rulesPath = argv[++i];
        break;
      case "--daily":
        options.daily = argv[++i];
        break;
      case "--codes":
        options.codes = (argv[++i] ?? "")
          .split(",")
          .map((code) => code.trim())
          .filter((code) => code !== "");
        break;
      case "--detail":
        options.detail = true;
        break;
      case "--xero":
        options.xero = argv[++i];
        break;
      case "--all":
        options.all = true;
        break;
      case "--whole":
        options.whole = true;
        break;
      case "--window": {
        const value = Number(argv[++i]);
        if (!Number.isFinite(value) || value < 0) throw new Error("--window needs a number of days");
        options.window = value;
        break;
      }
      case "--format": {
        const value = argv[++i];
        if (value !== "plain" && value !== "xero") {
          throw new Error("--format must be plain or xero");
        }
        options.format = value;
        break;
      }
      case "--claim-in": {
        const value = argv[++i];
        const date = parseDate(value);
        if (date === null) throw new Error(`--claim-in needs a date, got ${JSON.stringify(value)}`);
        options.claimIn = date;
        break;
      }
      case "--period":
        options.period = argv[++i];
        break;
      case "--amount":
        options.amount = argv[++i];
        break;
      case "--code":
        options.code = argv[++i];
        break;
      case "--gst": {
        const value = argv[++i];
        if (
          value !== "standard" &&
          value !== "zero-rated" &&
          value !== "exempt" &&
          value !== "out-of-scope"
        ) {
          throw new Error("--gst must be standard, zero-rated, exempt or out-of-scope");
        }
        options.treatment = value;
        break;
      }
      case "--side": {
        const value = argv[++i];
        if (
          value !== "sales" &&
          value !== "purchases" &&
          value !== "imports" &&
          value !== "none"
        ) {
          throw new Error("--side must be sales, purchases, imports or none");
        }
        options.side = value;
        break;
      }
      case "--note":
        options.note = argv[++i];
        break;
      case "--import": {
        const value = argv[++i];
        options.importPath = value;
        if (value !== undefined) options.importPaths.push(value);
        break;
      }
      case "--allocations":
        options.allocationsPath = argv[++i];
        break;
      case "--match":
        options.match = true;
        break;
      case "--apply":
        options.apply = true;
        break;
      case "--accept":
        options.accept = argv[++i];
        break;
      case "--tolerance": {
        const value = Number(argv[++i]);
        if (!Number.isFinite(value) || value < 0) throw new Error("--tolerance needs a number");
        options.tolerance = value;
        break;
      }
      case "--half":
        options.half = argv[++i];
        break;
      case "--part": {
        const value = argv[++i];
        if (value === undefined) throw new Error("--part needs a value");
        options.parts.push(value);
        break;
      }
      case "--confirm":
        options.confirm = true;
        break;
      case "--clear":
        options.clear = true;
        break;
      case "--list":
        options.list = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--json":
        options.json = true;
        break;
      default:
        if (arg.startsWith("-")) throw new Error(`Unknown option ${arg}`);
        if (command === "") command = arg;
        else options.files.push(arg);
    }
  }

  if (year !== undefined) {
    const match = /^(\d{1,2})-(\d{1,2})$/.exec(fyEnd);
    if (!match) throw new Error(`--fy-end needs MM-DD, got ${JSON.stringify(fyEnd)}`);
    const range = financialYear(year, {
      endMonth: Number(match[1]),
      endDay: Number(match[2]),
    });
    // An explicit --from/--to still wins, so a year can be narrowed to a quarter.
    options.range = { ...range, ...options.range };
  }

  return { command: command || "help", options };
}

/** Apply --year / --from / --to. */
function withinRange(options: Options, transactions: readonly Transaction[]): Transaction[] {
  if (options.range.from === undefined && options.range.to === undefined) {
    return [...transactions];
  }
  return transactions.filter((t) => inRange(t.date, options.range));
}

function describeRange(range: Partial<DateRange>): string {
  if (range.from === undefined && range.to === undefined) return "all dates";
  return `${range.from ?? "start"} to ${range.to ?? "end"}`;
}

async function main(argv: readonly string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n\n${USAGE}`);
    return 2;
  }

  const { command, options } = parsed;

  switch (command) {
    case "help":
      process.stdout.write(USAGE);
      return 0;
    case "formats":
      return runFormats(options);
    case "detect":
      return runDetect(options);
    case "import":
      return runImport(options);
    case "list":
      return runList(options);
    case "balances":
      return runBalances(options);
    case "variance":
      return runVariance(options satisfies VarianceOptions);
    case "gst":
      return runGst(options satisfies GstOptions);
    case "override":
      return runOverride({
        ...options,
        target: options.files[0],
      } satisfies OverrideOptions);
    case "invoices":
      return runInvoices(options satisfies InvoiceOptions);
    case "explain":
      return runExplain(options satisfies ExplainOptions);
    case "journals":
      return runJournals(options satisfies JournalOptions);
    case "reconcile":
      return reconcileCommand(options satisfies ReconcileOptions);
    case "split":
      return runSplit({
        ...options,
        target: options.files[0],
      } satisfies SplitOptions);
    default:
      process.stderr.write(`Unknown command "${command}".\n\n${USAGE}`);
      return 2;
  }
}

function runFormats(options: Options): number {
  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(
        importers.map(({ id, label, description }) => ({ id, label, description })),
        null,
        2,
      )}\n`,
    );
    return 0;
  }

  for (const importer of importers) {
    process.stdout.write(`${importer.id.padEnd(14)} ${importer.label}\n`);
    process.stdout.write(`${" ".repeat(15)}${importer.description}\n\n`);
  }
  return 0;
}

function runDetect(options: Options): number {
  if (options.files.length === 0) {
    process.stderr.write("detect needs at least one file.\n");
    return 2;
  }

  const report = options.files.map((file) => {
    const results = detectAll(read(file));
    return { file, results };
  });

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  }

  for (const { file, results } of report) {
    const best = results[0];
    process.stdout.write(`${basename(file)}\n`);
    if (!best || best.score === 0) {
      process.stdout.write("  no importer recognised this file\n");
      for (const result of results) {
        process.stdout.write(`    ${result.importer.padEnd(14)} ${result.reason}\n`);
      }
    } else {
      process.stdout.write(`  ${best.importer} (score ${best.score}) -- ${best.reason}\n`);
    }
    process.stdout.write("\n");
  }

  return report.some(({ results }) => (results[0]?.score ?? 0) === 0) ? 1 : 0;
}

function runImport(options: Options): number {
  if (options.files.length === 0) {
    process.stderr.write("import needs at least one file.\n");
    return 2;
  }

  const ledger = loadLedger(options.ledger);
  const before = ledger.transactions.length;

  const incoming: Transaction[] = [];
  const problems: { file: string; problem: ImportProblem }[] = [];

  for (const file of options.files) {
    const result = importFile(read(file), {
      file: basename(file),
      dayFirst: options.dayFirst,
      ...(options.account !== undefined ? { account: options.account } : {}),
      ...(options.currency !== undefined ? { defaultCurrency: options.currency } : {}),
    });

    incoming.push(...result.transactions);
    for (const problem of result.problems) problems.push({ file: basename(file), problem });

    if (!options.json) {
      process.stdout.write(
        `${basename(file).padEnd(28)} ${result.importer.padEnd(14)} ` +
          `${String(result.transactions.length).padStart(5)} rows  ` +
          `${result.account}\n`,
      );
    }
  }

  const merged = merge(ledger, incoming);
  const review = merged.result.entries.filter((entry) => entry.status === "review");
  const duplicates = merged.result.entries.filter((entry) => entry.status === "duplicate");

  if (!options.dryRun) saveLedger(options.ledger, merged.ledger);

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ledger: options.ledger,
          dryRun: options.dryRun,
          before,
          after: merged.ledger.transactions.length,
          added: merged.added,
          duplicates: duplicates.length,
          review: review.map(describeEntry),
          problems,
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  }

  process.stdout.write("\n");
  process.stdout.write(`  read       ${incoming.length} transactions\n`);
  process.stdout.write(`  added      ${merged.added}\n`);
  process.stdout.write(`  duplicate  ${duplicates.length} (already in the ledger)\n`);
  process.stdout.write(`  review     ${review.length}\n`);
  process.stdout.write(`  ledger     ${merged.ledger.transactions.length} transactions\n`);

  if (problems.length > 0) {
    process.stdout.write(`\nSkipped ${problems.length} row(s):\n`);
    for (const { file, problem } of problems) {
      process.stdout.write(`  ${file}:${problem.line}  ${problem.message}\n`);
    }
  }

  if (review.length > 0) {
    process.stdout.write("\nNeeds a decision -- kept for now, nothing was deleted:\n");
    for (const entry of review) {
      const t = entry.transaction;
      process.stdout.write(
        `\n  ${t.date}  ${formatAmount(t.amount, t.currency).padStart(12)} ` +
          `${t.currency}  ${t.otherParty}\n`,
      );
      process.stdout.write(`      ${t.source.file}:${t.source.line}\n`);
      process.stdout.write(`      ${entry.reason}\n`);
    }
  }

  if (options.dryRun) {
    process.stdout.write(`\nDry run: ${options.ledger} was not written.\n`);
  }

  return 0;
}

function runList(options: Options): number {
  const ledger = loadLedger(options.ledger);
  const scoped = withinRange(options, ledger.transactions);

  if (options.json) {
    process.stdout.write(`${JSON.stringify(scoped, null, 2)}\n`);
    return 0;
  }

  if (scoped.length === 0) {
    process.stdout.write(
      ledger.transactions.length === 0
        ? `${options.ledger} is empty. Run "nzosa import" first.\n`
        : `No transactions in ${describeRange(options.range)}.\n`,
    );
    return 0;
  }

  const sorted = [...scoped].sort((a, b) => a.date.localeCompare(b.date));
  for (const t of sorted) {
    process.stdout.write(
      `${t.date}  ${formatAmount(t.amount, t.currency).padStart(12)} ${t.currency.padEnd(4)} ` +
        `${truncate(t.otherParty, 30).padEnd(30)} ${truncate(t.particulars, 20).padEnd(20)} ` +
        `${t.account}\n`,
    );
  }

  process.stdout.write(
    `\n${sorted.length} transactions in ${options.ledger} (${describeRange(options.range)})\n`,
  );
  return 0;
}

interface AccountSummary {
  account: string;
  currency: string;
  count: number;
  moneyIn: number;
  moneyOut: number;
  net: number;
  first: string;
  last: string;
}

/**
 * Per-account totals, and a reconciliation against known balances.
 *
 * This is the check that proves the import stage. If opening plus the net
 * movement equals the closing balance from a statement or a set of filed
 * financials, then over that period nothing was missed, double-counted or
 * mis-signed. It needs no categorisation at all, which is exactly why it is
 * worth doing first, before anything is built on top of the transactions.
 */
function runBalances(options: Options): number {
  const ledger = loadLedger(options.ledger);
  const scoped = withinRange(options, ledger.transactions);

  const summaries = new Map<string, AccountSummary>();
  for (const t of scoped) {
    const summary: AccountSummary = summaries.get(t.account) ?? {
      account: t.account,
      currency: t.currency,
      count: 0,
      moneyIn: 0,
      moneyOut: 0,
      net: 0,
      first: t.date,
      last: t.date,
    };

    summary.count += 1;
    summary.net += t.amount;
    if (t.amount < 0) summary.moneyOut += t.amount;
    else summary.moneyIn += t.amount;
    if (t.date < summary.first) summary.first = t.date;
    if (t.date > summary.last) summary.last = t.date;

    // A multi-currency account would make these totals meaningless, so say so
    // rather than quietly adding EUR cents to NZD cents.
    if (summary.currency !== t.currency) summary.currency = "MIXED";

    summaries.set(t.account, summary);
  }

  const rows = [...summaries.values()].sort((a, b) => a.account.localeCompare(b.account));
  const checks = reconcile(ledger.balances ?? {}, summaries);

  // A daily balance export is a far stronger check than a pair of hand-entered
  // figures: it says not just whether an account ties, but on exactly which day
  // it stopped tying and by how much.
  const dailyPath = options.daily;
  if (dailyPath !== undefined) {
    const parsed = parseDailyBalances(read(dailyPath));
    for (const problem of parsed.problems) process.stderr.write(`  ${problem}\n`);
    const balanceChecks = checkDailyBalances(parsed.sections, ledger.transactions);

    process.stdout.write(`\nAgainst ${dailyPath}\n\n`);
    let outOfLine = 0;
    for (const check of balanceChecks) {
      const name = `${check.section.label} (${check.section.account})`;
      if (check.account === null) {
        process.stdout.write(`  ${name}\n    nothing imported for this account\n\n`);
        continue;
      }
      if (check.breaks.length === 0) {
        process.stdout.write(
          `  ${name}\n    in line -- ${check.transactions} transactions, ` +
            `${check.section.days.length} days checked\n\n`,
        );
        continue;
      }
      outOfLine += 1;
      process.stdout.write(
        `  ${name}\n    agreed until ${check.agreedUntil ?? "never"}, then ` +
          `${check.breaks.length} day(s) differ, out by ` +
          `${formatAmount(check.outBy, "NZD")}\n`,
      );
      for (const gap of check.breaks.slice(0, 10)) {
        process.stdout.write(`      ${gap.date}  ${formatAmount(gap.difference, "NZD").padStart(12)}\n`);
      }
      if (check.breaks.length > 10) {
        process.stdout.write(`      ... and ${check.breaks.length - 10} more\n`);
      }
      process.stdout.write("\n");
    }
    if (outOfLine > 0) {
      process.stdout.write(
        `${outOfLine} account(s) do not tie. A negative figure is money the bank ` +
          `saw leave that we have no transaction for; a positive one is movement ` +
          `we hold and it does not.\n`,
      );
      return 1;
    }
    process.stdout.write("Every account ties to the bank's own balances.\n");
    return 0;
  }

  if (options.json) {
    const payload = { range: options.range, accounts: rows, reconciliation: checks };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return checks.some((check) => check.status === "mismatch") ? 1 : 0;
  }

  if (rows.length === 0) {
    process.stdout.write(`Nothing in ${options.ledger} for ${describeRange(options.range)}.\n`);
    return 0;
  }

  process.stdout.write(`${describeRange(options.range)}\n\n`);
  const width = Math.max(20, ...rows.map((row) => row.account.length));
  process.stdout.write(
    `${"ACCOUNT".padEnd(width)}  ${"TXNS".padStart(5)}  ${"FIRST".padEnd(10)}  ` +
      `${"LAST".padEnd(10)}  ${"IN".padStart(13)}  ${"OUT".padStart(13)}  ${"NET".padStart(13)}\n`,
  );
  for (const row of rows) {
    process.stdout.write(
      `${row.account.padEnd(width)}  ${String(row.count).padStart(5)}  ${row.first}  ` +
        `${row.last}  ${formatAmount(row.moneyIn, row.currency).padStart(13)}  ` +
        `${formatAmount(row.moneyOut, row.currency).padStart(13)}  ` +
        `${formatAmount(row.net, row.currency).padStart(13)}\n`,
    );
  }

  if (checks.length === 0) {
    process.stdout.write(
      `\nNo known balances to reconcile against. Add a "balances" block to ` +
        `${options.ledger} with the opening and closing figures from a statement ` +
        `or your financials, and this command will check them.\n`,
    );
    return 0;
  }

  process.stdout.write("\nReconciliation\n");
  for (const check of checks) {
    process.stdout.write(`\n  ${check.account}\n`);
    if (check.status === "incomplete") {
      process.stdout.write(`    ${check.message}\n`);
      continue;
    }
    process.stdout.write(`    opening   ${formatAmount(check.opening).padStart(14)}\n`);
    process.stdout.write(`    movement  ${formatAmount(check.movement).padStart(14)}\n`);
    if (check.cutOff !== 0) {
      process.stdout.write(`    cut-off   ${formatAmount(-check.cutOff).padStart(14)}\n`);
      for (const line of check.cutOffNotes) {
        process.stdout.write(`                ${line}\n`);
      }
    }
    process.stdout.write(`    computed  ${formatAmount(check.computed).padStart(14)}\n`);
    process.stdout.write(`    expected  ${formatAmount(check.expected).padStart(14)}\n`);
    process.stdout.write(
      `    variance  ${formatAmount(check.variance).padStart(14)}   ` +
        `${check.status === "ok" ? "ok" : "MISMATCH"}\n`,
    );
    if (check.note) process.stdout.write(`    (${check.note})\n`);
  }

  const mismatches = checks.filter((check) => check.status === "mismatch").length;
  process.stdout.write(
    mismatches === 0
      ? "\nEvery configured account ties.\n"
      : `\n${mismatches} account(s) do not tie. The variance is what is missing or duplicated.\n`,
  );

  return mismatches === 0 ? 0 : 1;
}

type ReconcileCheck =
  | { account: string; status: "incomplete"; message: string }
  | {
      account: string;
      status: "ok" | "mismatch";
      opening: number;
      movement: number;
      cutOff: number;
      computed: number;
      expected: number;
      variance: number;
      note?: string;
      cutOffNotes: string[];
    };

/**
 * Compare computed movement against known opening and closing balances.
 *
 * Filed financial statements are usually rounded to whole dollars, so an exact
 * match is not always achievable. A variance under a dollar is reported as
 * `ok` but the number is still printed, because a real one-cent error and a
 * rounding artefact look identical and the user should see it either way.
 */
function reconcile(
  balances: Record<string, AccountBalances>,
  summaries: ReadonlyMap<string, AccountSummary>,
): ReconcileCheck[] {
  const checks: ReconcileCheck[] = [];

  for (const [account, known] of Object.entries(balances)) {
    const summary = summaries.get(account);

    if (!summary) {
      checks.push({
        account,
        status: "incomplete",
        message: "no transactions in this period for this account id -- check the id matches",
      });
      continue;
    }
    if (!known.closing) {
      checks.push({ account, status: "incomplete", message: "no closing balance configured" });
      continue;
    }

    const opening = known.opening ? parseAmount(known.opening.amount, summary.currency) : 0;
    const expected = parseAmount(known.closing.amount, summary.currency);

    if (opening === null || expected === null) {
      checks.push({
        account,
        status: "incomplete",
        message: "opening or closing amount is not a number",
      });
      continue;
    }

    let cutOff = 0;
    const cutOffNotes: string[] = [];
    for (const adjustment of known.cutOff ?? []) {
      const value = parseAmount(adjustment.amount, summary.currency);
      if (value === null) {
        checks.push({
          account,
          status: "incomplete",
          message: `cut-off amount ${JSON.stringify(adjustment.amount)} is not a number`,
        });
        cutOff = Number.NaN;
        break;
      }
      cutOff += value;
      cutOffNotes.push(
        `${adjustment.date ? `${adjustment.date}  ` : ""}${formatAmount(value, summary.currency)}  ${adjustment.note}`,
      );
    }
    if (Number.isNaN(cutOff)) continue;

    const computed = opening + summary.net - cutOff;
    const variance = computed - expected;

    checks.push({
      account,
      status: Math.abs(variance) < 100 ? "ok" : "mismatch",
      opening,
      movement: summary.net,
      cutOff,
      computed,
      expected,
      variance,
      cutOffNotes,
      ...(known.note ? { note: known.note } : {}),
    });
  }

  return checks;
}

function describeEntry(entry: DedupeEntry) {
  return {
    id: entry.transaction.id,
    date: entry.transaction.date,
    amount: formatAmount(entry.transaction.amount, entry.transaction.currency),
    currency: entry.transaction.currency,
    otherParty: entry.transaction.otherParty,
    source: entry.transaction.source,
    duplicateOf: entry.duplicateOf,
    reason: entry.reason,
  };
}

/**
 * Read a bank file, whatever encoding it is in.
 *
 * A plain UTF-8 read turns every byte it does not understand into U+FFFD, and
 * banks here write Windows-1252 -- so a payee with a macron or an accent came
 * in mangled. That is not only ugly: the payee is part of the key a
 * transaction's id is hashed from, so the same file imported here and in the
 * app produced two different ids for the same row, and importing it in both
 * duplicated every affected transaction rather than recognising it.
 *
 * The app has always decoded bank files this way. This is the same decision,
 * in the other half of the project.
 */
function read(file: string): string {
  let bytes: Buffer;
  try {
    bytes = readFileSync(file);
  } catch (error) {
    throw new Error(`Cannot read ${file}: ${(error as Error).message}`);
  }
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  return text.includes("�") ? new TextDecoder("windows-1252").decode(bytes) : text;
}

function truncate(value: string, width: number): string {
  return value.length <= width ? value : `${value.slice(0, width - 1)}…`;
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exitCode = 1;
  });
