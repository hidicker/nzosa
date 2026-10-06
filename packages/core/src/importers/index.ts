import { parseCsvRecords } from "../csv.js";
import { hash } from "../hash.js";
import { dedupeKey } from "../dedupe.js";
import { bnzAccount } from "./bnz-account.js";
import { bnzCard } from "./bnz-card.js";
import { bnzTransactionList } from "./bnz-transaction-list.js";
import { anzLoan } from "./anz-loan.js";
import { wise } from "./wise.js";
import type { ReadonlyCsvRecord } from "../csv.js";
import type {
  DetectionResult,
  Importer,
  ImporterContext,
  ImportResult,
} from "../types.js";

export { bnzAccount, bnzCard, bnzTransactionList, anzLoan, wise };

/** Every importer, in no particular order. Detection decides which is used. */
export const importers: readonly Importer[] = [
  bnzAccount,
  bnzCard,
  bnzTransactionList,
  anzLoan,
  wise,
];

export function getImporter(id: string): Importer | undefined {
  return importers.find((importer) => importer.id === id);
}

/** Detection results for every importer, best first. */
export function detectAll(text: string): DetectionResult[] {
  const records = parseCsvRecords(text);
  return importers
    .map((importer) => importer.detect(records))
    .sort((a, b) => b.score - a.score);
}

/** The single best importer for a file, or undefined if nothing recognises it. */
export function detect(text: string): DetectionResult | undefined {
  const best = detectAll(text)[0];
  return best && best.score > 0 ? best : undefined;
}

export interface ImportOptions {
  /** File name, used for provenance. Defaults to `upload.csv`. */
  file?: string;
  /** Account id to stamp on rows the file does not identify itself. */
  account?: string;
  /** Account currency when the file does not state one. Defaults to `NZD`. */
  defaultCurrency?: string;
  /** Interpret ambiguous numeric dates day-first. Defaults to true. */
  dayFirst?: boolean;
  /** Force a specific importer instead of detecting one. */
  importer?: string;
}

/**
 * Parse a file into canonical transactions, detecting the format unless one is
 * forced.
 *
 * Throws only when no importer recognises the file at all. Every other failure
 * -- an unreadable row, a footer line, a cancelled Wise transfer -- comes back
 * in `problems` so the user is told exactly what was left out rather than
 * having rows disappear.
 */
export function importFile(text: string, options: ImportOptions = {}): ImportResult {
  const records = parseCsvRecords(text);
  const file = options.file ?? "upload.csv";

  const chosen = options.importer
    ? getImporter(options.importer)
    : pickBest(records);

  if (!chosen) {
    const tried = importers
      .map((importer) => `${importer.label}: ${importer.detect(records).reason}`)
      .join("; ");
    throw new Error(`No importer recognised ${file}. Tried -- ${tried}`);
  }

  const context: ImporterContext = {
    file,
    account: options.account ?? chosen.id,
    ...(options.defaultCurrency !== undefined ? { defaultCurrency: options.defaultCurrency } : {}),
    ...(options.dayFirst !== undefined ? { dayFirst: options.dayFirst } : {}),
  };

  const result = chosen.parse(records, context);

  // Number otherwise-identical rows within this file before ids are assigned,
  // so three real repeats get three ids rather than colliding on one.
  const counts = new Map<string, number>();
  for (const transaction of result.transactions) {
    const key = dedupeKey(transaction);
    const next = (counts.get(key) ?? 0) + 1;
    counts.set(key, next);
    transaction.occurrence = next;
  }

  // Ids are assigned centrally so that every importer produces the same id for
  // the same transaction, and so a re-import of the same file is recognisable
  // before dedupe even runs.
  for (const transaction of result.transactions) {
    transaction.id = hash(dedupeKey(transaction));
  }

  return result;
}

function pickBest(records: readonly ReadonlyCsvRecord[]): Importer | undefined {
  let best: { importer: Importer; score: number } | undefined;
  for (const importer of importers) {
    const { score } = importer.detect(records);
    if (score > 0 && (!best || score > best.score)) best = { importer, score };
  }
  return best?.importer;
}
