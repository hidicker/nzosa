import { formatAmount, parseAmount, validateSplits } from "@nzosa/core";
import type { GstTreatment, SplitPart, Transaction } from "@nzosa/core";
import { loadLedger, saveLedger } from "./ledger.js";

/**
 * Dividing one bank transaction into several coded parts.
 *
 * Each `--part` is `amount|code|gst|note`, with the last three optional:
 *
 *   --part "-15.00|NB Entertainment - 420|standard|coffee with a client"
 *   --part "-35.00|Ana||personal groceries"
 *
 * The parts must sum to the transaction exactly. That is the whole safety
 * property: the bank saw one number, and if the parts do not add back to it the
 * balance reconciliation stops proving anything.
 */

export interface SplitOptions {
  ledger: string;
  target: string | undefined;
  parts: string[];
  /**
   * `codeA|codeB|note` -- split in half, the first half GST-claimable and the
   * second not.
   *
   * Entertainment is the case this exists for. IRD allows half of most
   * entertainment as a deductible expense with GST claimable, and disallows the
   * other half entirely, so the same payment has to appear twice with different
   * treatments. Doing it by hand means computing two halves that add back to an
   * odd number of cents, every time.
   */
  half: string | undefined;
  clear: boolean;
  list: boolean;
  json: boolean;
}

const TREATMENTS = new Set(["standard", "zero-rated", "exempt", "out-of-scope"]);

export function runSplit(options: SplitOptions): number {
  const ledger = loadLedger(options.ledger);
  const splits = { ...(ledger.splits ?? {}) };

  if (options.list) return listSplits(ledger.transactions, splits, options.json);

  if (options.target === undefined) {
    process.stderr.write(
      'split needs a transaction id. Use "--list" to see existing splits, or ' +
        '"nzosa gst --detail" to find one.\n',
    );
    return 2;
  }

  const matches = ledger.transactions.filter(
    (t) => t.id === options.target || t.id.startsWith(options.target as string),
  );
  if (matches.length === 0) {
    process.stderr.write(`No transaction with id starting ${options.target}.\n`);
    return 2;
  }
  if (matches.length > 1) {
    process.stderr.write(`${options.target} matches ${matches.length} transactions.\n`);
    for (const t of matches.slice(0, 10)) process.stderr.write(`  ${describe(t)}\n`);
    return 2;
  }

  const transaction = matches[0] as Transaction;

  if (options.clear) {
    if (splits[transaction.id] === undefined) {
      process.stdout.write(`${describe(transaction)} is not split.\n`);
      return 0;
    }
    delete splits[transaction.id];
    saveLedger(options.ledger, { ...ledger, splits });
    process.stdout.write(`Removed the split on ${describe(transaction)}.\n`);
    return 0;
  }

  if (options.parts.length === 0 && options.half === undefined) {
    process.stderr.write("split needs --part values, --half, or --clear.\n");
    return 2;
  }

  let parts: SplitPart[];
  try {
    parts =
      options.half !== undefined
        ? halveForEntertainment(options.half, transaction.amount)
        : options.parts.map((raw, index) => parsePart(raw, index, transaction.currency));
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return 2;
  }

  const candidate = { ...splits, [transaction.id]: parts };
  const problems = validateSplits(ledger.transactions, candidate);
  const mine = problems.filter((problem) => problem.id === transaction.id);

  if (mine.length > 0) {
    // Refused rather than rounded: a split that does not balance would break
    // the reconciliation quietly, which is the one failure worth being strict
    // about.
    process.stderr.write(`Cannot split ${describe(transaction)}:\n`);
    for (const problem of mine) process.stderr.write(`  ${problem.message}\n`);
    return 1;
  }

  saveLedger(options.ledger, { ...ledger, splits: candidate });

  process.stdout.write(`${describe(transaction)}\n`);
  process.stdout.write(`  split into ${parts.length} parts\n\n`);
  for (const [index, part] of parts.entries()) {
    process.stdout.write(
      `  ${index + 1}. ${formatAmount(part.amount, transaction.currency).padStart(12)}  ` +
        `${(part.code ?? "(no code)").padEnd(28)} ${part.treatment ?? ""}\n`,
    );
    process.stdout.write(`     ${part.note}\n`);
  }
  process.stdout.write(
    `\n  total ${formatAmount(
      parts.reduce((sum, part) => sum + part.amount, 0),
      transaction.currency,
    )}  matches the transaction\n`,
  );
  return 0;
}

/**
 * Split an amount in half, claimable and not.
 *
 * An odd number of cents cannot be halved evenly, and the parts must still sum
 * to the original exactly, so the first half takes the extra cent. Which half
 * gets it is arbitrary; that it lands somewhere is not.
 */
function halveForEntertainment(spec: string, amount: number): SplitPart[] {
  const [codeA = "", codeB = "", ...rest] = spec.split("|");
  const note = rest.join("|").trim();

  if (codeA.trim() === "" || codeB.trim() === "") {
    throw new Error(
      'Format: --half "deductible code|non-deductible code|note", for example ' +
        '"NB Entertainment - 420|NB Entertainment - Non deductible - 424|team lunch".',
    );
  }
  if (note === "") throw new Error("--half needs a note explaining the expense.");

  const magnitude = Math.abs(amount);
  const sign = Math.sign(amount);
  const smaller = Math.floor(magnitude / 2);
  const larger = magnitude - smaller;

  return [
    {
      amount: sign * larger,
      code: codeA.trim(),
      treatment: "standard",
      note: `${note} (deductible half, GST claimable)`,
    },
    {
      amount: sign * smaller,
      code: codeB.trim(),
      treatment: "out-of-scope",
      note: `${note} (non-deductible half, no GST claimed)`,
    },
  ];
}

function parsePart(raw: string, index: number, currency: string): SplitPart {
  const [amountText = "", code = "", treatment = "", ...rest] = raw.split("|");
  const note = rest.join("|").trim();

  const amount = parseAmount(amountText.trim(), currency);
  if (amount === null) {
    throw new Error(`Part ${index + 1}: ${JSON.stringify(amountText)} is not an amount.`);
  }
  if (note === "") {
    throw new Error(
      `Part ${index + 1} has no note. Format: amount|code|gst|note, for example ` +
        `"-15.00|NB Entertainment - 420|standard|coffee with a client".`,
    );
  }
  if (treatment.trim() !== "" && !TREATMENTS.has(treatment.trim())) {
    throw new Error(
      `Part ${index + 1}: ${JSON.stringify(treatment.trim())} is not a GST treatment. ` +
        `Use one of ${[...TREATMENTS].join(", ")}.`,
    );
  }

  return {
    amount,
    ...(code.trim() !== "" ? { code: code.trim() } : {}),
    ...(treatment.trim() !== "" ? { treatment: treatment.trim() as GstTreatment } : {}),
    note,
  };
}

function listSplits(
  transactions: readonly Transaction[],
  splits: Record<string, readonly SplitPart[]>,
  json: boolean,
): number {
  if (json) {
    process.stdout.write(`${JSON.stringify(splits, null, 2)}\n`);
    return 0;
  }

  const entries = Object.entries(splits);
  if (entries.length === 0) {
    process.stdout.write("No splits recorded.\n");
    return 0;
  }

  const byId = new Map(transactions.map((t) => [t.id, t]));
  const problems = new Map(
    validateSplits(transactions, splits).map((problem) => [problem.id, problem.message]),
  );

  process.stdout.write(`${entries.length} split transaction(s)\n\n`);
  for (const [id, parts] of entries) {
    const transaction = byId.get(id);
    process.stdout.write(transaction ? `${describe(transaction)}\n` : `${id}  (not in the ledger)\n`);
    for (const [index, part] of parts.entries()) {
      process.stdout.write(
        `    ${index + 1}. ${formatAmount(part.amount, transaction?.currency ?? "NZD").padStart(12)}  ` +
          `${(part.code ?? "(no code)").padEnd(28)} ${part.note}\n`,
      );
    }
    const problem = problems.get(id);
    if (problem) process.stdout.write(`    PROBLEM: ${problem}\n`);
    process.stdout.write("\n");
  }
  return 0;
}

function describe(t: Transaction): string {
  return (
    `${t.id.slice(0, 12)}  ${t.date}  ${formatAmount(t.amount, t.currency).padStart(11)}  ` +
    `${t.otherParty || t.particulars || "--"}`
  );
}
