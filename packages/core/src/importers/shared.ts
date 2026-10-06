import { findHeaderRow, normaliseHeader } from "../csv.js";
import type { ReadonlyCsvRecord } from "../csv.js";
import type { DetectionResult } from "../types.js";

/**
 * Accessor for a header-mapped row.
 *
 * Importers address columns by name rather than position, because banks
 * reorder and add columns between statement formats without warning.
 */
export class ColumnReader {
  constructor(
    private readonly columns: Map<string, number>,
    private fields: readonly string[] = [],
  ) {}

  at(fields: readonly string[]): this {
    this.fields = fields;
    return this;
  }

  /** First present column among `names`, or `""`. */
  get(...names: string[]): string {
    for (const name of names) {
      const index = this.columns.get(normaliseHeader(name));
      if (index === undefined) continue;
      const value = this.fields[index];
      if (value !== undefined && value !== "") return value;
    }
    return "";
  }

  has(name: string): boolean {
    return this.columns.has(normaliseHeader(name));
  }
}

/**
 * Score a file against an importer's expected columns.
 *
 * `required` columns must all be present or the score is 0. Each `distinctive`
 * column that is also present adds a point, which is what separates two feeds
 * sharing a common core -- BNZ account and BNZ card exports both have
 * Date/Amount/Payee, but only the account export has `This Party Account`.
 */
export function scoreColumns(
  records: readonly ReadonlyCsvRecord[],
  required: readonly string[],
  distinctive: readonly string[],
  importer: string,
  label: string,
): DetectionResult {
  const header = findHeaderRow(records, required);
  if (!header) {
    return { importer, score: 0, reason: `no header row with ${required.join(", ")}` };
  }

  const matched = distinctive.filter((name) => header.columns.has(normaliseHeader(name)));
  return {
    importer,
    score: 1 + matched.length,
    reason:
      matched.length > 0
        ? `${label}: matched ${matched.join(", ")}`
        : `${label}: matched required columns only`,
  };
}
