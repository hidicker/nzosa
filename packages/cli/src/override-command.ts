import { formatAmount } from "@nzosa/core";
import type { GstSide, GstTreatment, Transaction } from "@nzosa/core";
import { loadLedger, saveLedger } from "./ledger.js";

/**
 * Recording a human's answer about one transaction.
 *
 * The rules engine is a suggestion engine. It will be wrong -- a payout that
 * arrives net of fees, a supplier who deregisters, a one-off that reads like
 * something else -- and when it is, the correction has to be recordable and
 * durable rather than re-argued every import.
 *
 * Overrides are keyed by the derived transaction id, so re-importing the same
 * statement, or a later overlapping one, lands the correction on the same row.
 */

export interface OverrideOptions {
  ledger: string;
  /** Transaction id, or a unique fragment of one. */
  target: string | undefined;
  code: string | undefined;
  /** Period end to claim this transaction's GST in, as a late claim. */
  claimIn: string | undefined;
  treatment: GstTreatment | undefined;
  side: GstSide | undefined;
  note: string | undefined;
  /**
   * Record that a human has accepted this transaction's coding.
   *
   * On its own it confirms the suggestion unchanged. Combined with --code or
   * --gst it records a decision that also changed something.
   */
  confirm: boolean;
  /** Remove the override instead of setting it. */
  clear: boolean;
  /** List every override currently recorded. */
  list: boolean;
  json: boolean;
}

export function runOverride(options: OverrideOptions): number {
  const ledger = loadLedger(options.ledger);
  const overrides = { ...(ledger.overrides ?? {}) };

  if (options.list) {
    return listOverrides(ledger.transactions, overrides, options.json);
  }

  if (options.target === undefined) {
    process.stderr.write(
      "override needs a transaction id. Run \"nzosa gst --detail\" or " +
        '"nzosa list --json" to find one, or "--list" to see existing overrides.\n',
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
    // Applying an override to the wrong row is silent and durable, so an
    // ambiguous id is refused rather than resolved by guessing.
    process.stderr.write(
      `${options.target} matches ${matches.length} transactions. Use a longer id:\n`,
    );
    for (const t of matches.slice(0, 10)) process.stderr.write(`  ${describe(t)}\n`);
    return 2;
  }

  const transaction = matches[0] as Transaction;

  if (options.clear) {
    if (overrides[transaction.id] === undefined) {
      process.stdout.write(`No override on ${describe(transaction)}.\n`);
      return 0;
    }
    delete overrides[transaction.id];
    saveLedger(options.ledger, { ...ledger, overrides });
    process.stdout.write(`Cleared the override on ${describe(transaction)}.\n`);
    return 0;
  }

  // Deferring a claim is a change in its own right: it moves GST between two
  // returns, so it needs a note for the same reason a recoding does.
  const changing =
    options.code !== undefined || options.treatment !== undefined || options.claimIn !== undefined;

  if (!changing && !options.confirm) {
    process.stderr.write("override needs --code, --gst, --claim-in, --confirm, or --clear.\n");
    return 2;
  }
  if (changing && (options.note === undefined || options.note.trim() === "")) {
    // Accepting a suggestion unchanged needs no explanation. Overruling one
    // does: an anonymous correction is indistinguishable from a mistake later,
    // and this is exactly the kind of decision questioned at year end.
    process.stderr.write("override needs --note explaining why the coding was changed.\n");
    return 2;
  }

  const existing = overrides[transaction.id];
  overrides[transaction.id] = {
    confirmed: true,
    ...(options.code !== undefined ? { code: options.code } : existing?.code !== undefined ? { code: existing.code } : {}),
    ...(options.treatment !== undefined
      ? { treatment: options.treatment }
      : existing?.treatment !== undefined
        ? { treatment: existing.treatment }
        : {}),
    ...(options.side !== undefined ? { side: options.side } : existing?.side !== undefined ? { side: existing.side } : {}),
    ...(options.claimIn !== undefined
      ? { claimIn: options.claimIn }
      : existing?.claimIn !== undefined
        ? { claimIn: existing.claimIn }
        : {}),
    note: options.note ?? existing?.note ?? 'Suggestion confirmed unchanged',
    at: new Date().toISOString().slice(0, 10),
  };

  saveLedger(options.ledger, { ...ledger, overrides });

  process.stdout.write(`${describe(transaction)}\n`);
  const record = overrides[transaction.id];
  if (record?.code !== undefined) process.stdout.write(`  code       ${record.code}\n`);
  if (record?.claimIn !== undefined) {
    process.stdout.write(`  claim in   ${record.claimIn}  (late claim: Box 9 or Box 13)\n`);
  }
  if (record?.treatment !== undefined) process.stdout.write(`  gst        ${record.treatment}\n`);
  if (record?.side !== undefined) process.stdout.write(`  side       ${record.side}\n`);
  process.stdout.write(`  note       ${record?.note ?? ""}\n`);
  process.stdout.write(`  confirmed  yes\n`);
  return 0;
}

function listOverrides(
  transactions: readonly Transaction[],
  overrides: Record<string, { code?: string; treatment?: string; side?: string; note: string; at?: string }>,
  json: boolean,
): number {
  const entries = Object.entries(overrides);

  if (json) {
    process.stdout.write(`${JSON.stringify(overrides, null, 2)}\n`);
    return 0;
  }

  if (entries.length === 0) {
    process.stdout.write("No overrides recorded.\n");
    return 0;
  }

  const byId = new Map(transactions.map((t) => [t.id, t]));
  process.stdout.write(`${entries.length} override(s)\n\n`);

  for (const [id, record] of entries) {
    const transaction = byId.get(id);
    process.stdout.write(
      transaction ? `${describe(transaction)}\n` : `${id}  (no longer in the ledger)\n`,
    );
    const parts = [
      record.code !== undefined ? `code ${record.code}` : "",
      record.treatment !== undefined ? `gst ${record.treatment}` : "",
      record.side !== undefined ? `side ${record.side}` : "",
    ].filter((part) => part !== "");
    process.stdout.write(`    ${parts.join(", ")}\n`);
    process.stdout.write(`    ${record.note}${record.at ? `  (${record.at})` : ""}\n\n`);
  }

  return 0;
}

function describe(t: Transaction): string {
  return (
    `${t.id.slice(0, 12)}  ${t.date}  ${formatAmount(t.amount, t.currency).padStart(11)}  ` +
    `${t.otherParty || t.particulars || "--"}`
  );
}
