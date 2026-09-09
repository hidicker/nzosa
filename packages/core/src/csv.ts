/**
 * A small RFC 4180 CSV reader.
 *
 * Bank exports are not well-behaved CSV: they carry BOMs, mix CRLF and LF, pad
 * fields with spaces, and often prepend a block of account-header lines before
 * the real column row. This parser deals with the quoting rules; finding the
 * header row inside the noise is `findHeaderRow`'s job.
 */

export type Row = string[];

/** A row as callers see it once parsing is done: read-only. */
export type ReadonlyRow = readonly string[];

/**
 * A parsed row together with the physical line it started on.
 *
 * The line number is carried rather than inferred from the array index,
 * because blank rows are dropped and a quoted field may span several lines.
 * Every problem this tool reports points the user at a line in their own file,
 * so an index that silently drifts from the file would be worse than useless.
 */
export interface CsvRecord {
  fields: Row;
  /** 1-based line in the source text where this row begins. */
  line: number;
}

export interface ReadonlyCsvRecord {
  readonly fields: ReadonlyRow;
  readonly line: number;
}

export interface CsvParseOptions {
  /** Field separator. Auto-detected from the content when omitted. */
  delimiter?: string;
  /** Drop rows where every field is blank. Defaults to true. */
  skipEmptyRows?: boolean;
  /** Trim surrounding whitespace from every field. Defaults to true. */
  trim?: boolean;
}

/** Parse CSV/TSV text into rows that remember where they came from. */
export function parseCsvRecords(text: string, options: CsvParseOptions = {}): CsvRecord[] {
  const skipEmptyRows = options.skipEmptyRows ?? true;
  const trim = options.trim ?? true;

  // Strip a UTF-8 BOM, which otherwise becomes part of the first header cell
  // and quietly breaks every column-name match.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const delimiter = options.delimiter ?? detectDelimiter(input);

  const records: CsvRecord[] = [];
  let fields: Row = [];
  let field = "";
  let quoted = false;
  let i = 0;

  let line = 1;
  let rowStartLine = 1;

  const endField = () => {
    fields.push(trim ? field.trim() : field);
    field = "";
  };
  const endRow = () => {
    endField();
    if (!skipEmptyRows || fields.some((cell) => cell !== "")) {
      records.push({ fields, line: rowStartLine });
    }
    fields = [];
    rowStartLine = line;
  };

  while (i < input.length) {
    const char = input[i] as string;

    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      // A newline inside a quoted field advances the line counter but does not
      // end the row, which is exactly why lines are tracked here.
      if (char === "\n") line += 1;
      field += char;
      i += 1;
      continue;
    }

    if (char === '"' && field.trim() === "") {
      // Only treat a quote as opening a quoted field at the start of one; a
      // stray mid-field quote (`5" pipe`) is literal text.
      field = "";
      quoted = true;
      i += 1;
      continue;
    }

    if (char === delimiter) {
      endField();
      i += 1;
      continue;
    }

    if (char === "\r" || char === "\n") {
      i += char === "\r" && input[i + 1] === "\n" ? 2 : 1;
      line += 1;
      endRow();
      continue;
    }

    field += char;
    i += 1;
  }

  if (field !== "" || fields.length > 0) endRow();

  return records;
}

/** Parse CSV/TSV text into rows of raw strings, discarding line numbers. */
export function parseCsv(text: string, options: CsvParseOptions = {}): Row[] {
  return parseCsvRecords(text, options).map((record) => record.fields);
}

/** Guess the delimiter by counting candidates outside quoted spans. */
function detectDelimiter(text: string): string {
  const sample = text.slice(0, 64_000);
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let bestCount = 0;

  for (const candidate of candidates) {
    let count = 0;
    let quoted = false;
    for (let i = 0; i < sample.length; i += 1) {
      const char = sample[i];
      if (char === '"') quoted = !quoted;
      else if (char === candidate && !quoted) count += 1;
    }
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }

  return best;
}

/** Normalise a header cell so `"Other Party Account "` matches `otherpartyaccount`. */
export function normaliseHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export interface HeaderMatch {
  /** Index into the records array of the row holding the column names. */
  index: number;
  /** Normalised header cell -> column index. First occurrence wins. */
  columns: Map<string, number>;
}

/**
 * Locate the real header row.
 *
 * BNZ and ANZ exports both put account metadata above the column names -- the
 * ANZ loan sheet in the source workbook has twelve such rows -- so a parser
 * that assumes row 0 is the header reads garbage. This scans the first
 * `searchLimit` rows for one containing every required column name.
 */
export function findHeaderRow(
  records: readonly ReadonlyCsvRecord[],
  required: readonly string[],
  searchLimit = 25,
): HeaderMatch | null {
  const needles = required.map(normaliseHeader);
  const limit = Math.min(records.length, searchLimit);

  for (let index = 0; index < limit; index += 1) {
    const record = records[index];
    if (!record) continue;

    const columns = new Map<string, number>();
    for (let column = 0; column < record.fields.length; column += 1) {
      const key = normaliseHeader(record.fields[column] ?? "");
      if (key !== "" && !columns.has(key)) columns.set(key, column);
    }

    if (needles.every((needle) => columns.has(needle))) return { index, columns };
  }

  return null;
}
