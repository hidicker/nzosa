import { parseCsvRecords } from "./csv.js";
/**
 * A minimal reader for the one spreadsheet shape this project must consume.
 *
 * Xero's GST returns are only available as `.xlsx`, so reading them is not
 * optional. A full spreadsheet library would be a large dependency for a
 * package that otherwise has none, and would have to work in a browser tab as
 * well as a CLI -- so this reads just enough of the format to get cells out:
 * the ZIP container, the shared-string table, and the cell values of each
 * sheet.
 *
 * Decompression uses `DecompressionStream`, which browsers and Node both
 * provide, so nothing here is platform-specific. Everything else is byte and
 * string handling.
 *
 * Deliberately not supported: formulas (the cached value is read instead),
 * styles beyond the number formats that mark a cell as a date, and encrypted
 * or ZIP64 archives. A file needing those is reported, not guessed at.
 */

/** One sheet's cells, addressed by row then column, both 1-based. */
export interface SheetRows {
  name: string;
  rows: Map<number, Map<number, string>>;
}

export interface WorkbookProblem {
  message: string;
}

export interface Workbook {
  sheets: SheetRows[];
  problems: WorkbookProblem[];
}

interface ZipEntry {
  name: string;
  compression: number;
  data: Uint8Array;
}

function u16(bytes: Uint8Array, at: number): number {
  return (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8);
}

function u32(bytes: Uint8Array, at: number): number {
  return (
    ((bytes[at] ?? 0) |
      ((bytes[at + 1] ?? 0) << 8) |
      ((bytes[at + 2] ?? 0) << 16) |
      ((bytes[at + 3] ?? 0) << 24)) >>>
    0
  );
}

/**
 * Read the ZIP central directory.
 *
 * The central directory is authoritative about where each entry begins; the
 * local headers repeat that information but may have a zero-length size when
 * the writer streamed the file, so they are used only to find where the data
 * starts.
 */
function readZip(bytes: Uint8Array): ZipEntry[] {
  // The end-of-central-directory record is at the tail, after a comment of
  // unknown length, so it is found by scanning backwards for its signature.
  let end = -1;
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 66000; i -= 1) {
    if (u32(bytes, i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("not a zip archive: no end-of-central-directory record");

  const count = u16(bytes, end + 10);
  let at = u32(bytes, end + 16);
  const entries: ZipEntry[] = [];

  for (let i = 0; i < count; i += 1) {
    if (u32(bytes, at) !== 0x02014b50) break;
    const compression = u16(bytes, at + 10);
    const compressedSize = u32(bytes, at + 20);
    const nameLength = u16(bytes, at + 28);
    const extraLength = u16(bytes, at + 30);
    const commentLength = u16(bytes, at + 32);
    const localAt = u32(bytes, at + 42);
    const name = utf8(bytes.subarray(at + 46, at + 46 + nameLength));

    // The local header's own name and extra lengths give the data offset.
    const localNameLength = u16(bytes, localAt + 26);
    const localExtraLength = u16(bytes, localAt + 28);
    const dataAt = localAt + 30 + localNameLength + localExtraLength;

    entries.push({
      name,
      compression,
      data: bytes.subarray(dataAt, dataAt + compressedSize),
    });
    at += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

/** Decode UTF-8 bytes without assuming a platform decoder is in scope. */
function utf8(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; ) {
    const a = bytes[i] ?? 0;
    if (a < 0x80) {
      out += String.fromCharCode(a);
      i += 1;
    } else if (a < 0xe0) {
      out += String.fromCharCode(((a & 0x1f) << 6) | ((bytes[i + 1] ?? 0) & 0x3f));
      i += 2;
    } else if (a < 0xf0) {
      out += String.fromCharCode(
        ((a & 0x0f) << 12) | (((bytes[i + 1] ?? 0) & 0x3f) << 6) | ((bytes[i + 2] ?? 0) & 0x3f),
      );
      i += 3;
    } else {
      const point =
        ((a & 0x07) << 18) |
        (((bytes[i + 1] ?? 0) & 0x3f) << 12) |
        (((bytes[i + 2] ?? 0) & 0x3f) << 6) |
        ((bytes[i + 3] ?? 0) & 0x3f);
      const shifted = point - 0x10000;
      out += String.fromCharCode(0xd800 + (shifted >> 10), 0xdc00 + (shifted & 0x3ff));
      i += 4;
    }
  }
  return out;
}

async function inflate(entry: ZipEntry): Promise<string> {
  if (entry.compression === 0) return utf8(entry.data);
  if (entry.compression !== 8) {
    throw new Error(`unsupported zip compression method ${entry.compression} for ${entry.name}`);
  }
  // Fed through a stream rather than a Blob: Blob's parameter types are not in
  // scope in a package that declares no DOM library, and a one-chunk stream
  // says the same thing with types that are.
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(entry.data);
      controller.close();
    },
  });
  const stream = source.pipeThrough(new DecompressionStream("deflate-raw"));
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    merged.set(chunk, at);
    at += chunk.length;
  }
  return utf8(merged);
}

/** `BC` -> 55. Column letters are base-26 with no zero. */
function columnOf(reference: string): number {
  let value = 0;
  for (const character of reference) {
    const code = character.charCodeAt(0);
    if (code < 65 || code > 90) break;
    value = value * 26 + (code - 64);
  }
  return value;
}

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&");
}

/**
 * The shared-string table.
 *
 * A string cell holds an index into this rather than the text, and a single
 * entry can be split across several runs when part of it was formatted
 * differently -- so every `<t>` inside one `<si>` is concatenated.
 */
function readSharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const item of xml.split("<si>").slice(1)) {
    const body = item.slice(0, item.indexOf("</si>"));
    let text = "";
    for (const part of body.split("<t")) {
      const start = part.indexOf(">");
      if (start < 0) continue;
      const stop = part.indexOf("</t>");
      if (stop < 0) continue;
      text += part.slice(start + 1, stop);
    }
    out.push(unescapeXml(text));
  }
  return out;
}

/**
 * Which cell styles mean "this number is a date".
 *
 * A date in a spreadsheet is a number -- 45397 is a day counted from the end
 * of 1899 -- and the only thing that says so is the format attached to the
 * cell. Read without it, an Account Transactions export arrives with a column
 * of five-figure numbers where its dates should be, and every one of them is
 * silently wrong rather than visibly missing.
 *
 * `cellXfs` is an ordered list; a cell's `s="4"` is an index into it. The
 * built-in format ids for dates are 14-17 and 22 (14 is the short date, 22
 * date and time); 45-47 are durations, which are not dates. Anything from 164
 * up is a format the file defines itself, and is a date when its pattern
 * contains a year, month or day token outside the quoted literals.
 */
const BUILT_IN_DATE_FORMATS = new Set([14, 15, 16, 17, 22]);

function readDateStyles(xml: string): Set<number> {
  const custom = new Map<number, string>();
  for (const chunk of xml.split("<numFmt ").slice(1)) {
    const head = chunk.slice(0, chunk.indexOf(">"));
    const id = Number(/numFmtId="(\d+)"/.exec(head)?.[1] ?? NaN);
    const code = unescapeXml(/formatCode="([^"]*)"/.exec(head)?.[1] ?? "");
    if (Number.isFinite(id)) custom.set(id, code);
  }

  const looksLikeADate = (code: string): boolean =>
    // Strip what the format prints literally, so a currency symbol spelt
    // "dollars" or a colour like [Red] cannot be read as a day or a month.
    /[ymd]/i.test(code.replace(/\[[^\]]*\]/g, "").replace(/"[^"]*"/g, "").replace(/\\./g, ""));

  const dates = new Set<number>();
  const section = xml.slice(xml.indexOf("<cellXfs"), xml.indexOf("</cellXfs>"));
  let index = 0;
  for (const chunk of section.split("<xf ").slice(1)) {
    const head = chunk.slice(0, chunk.indexOf(">"));
    const id = Number(/numFmtId="(\d+)"/.exec(head)?.[1] ?? NaN);
    if (
      BUILT_IN_DATE_FORMATS.has(id) ||
      (custom.has(id) && looksLikeADate(custom.get(id) ?? ""))
    ) {
      dates.add(index);
    }
    index += 1;
  }
  return dates;
}

/**
 * A spreadsheet serial as `YYYY-MM-DD`.
 *
 * Day zero is 30 December 1899, which is a day earlier than it should be
 * because Excel keeps a 29 February 1900 that never happened, and every date
 * from 1 March 1900 on is right as a result. Dates before that are not
 * reachable from a bank export, and are left as the number rather than dated
 * wrongly by one day.
 */
function dateOfSerial(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 61) return null;
  const at = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
}

function readSheet(
  xml: string,
  shared: readonly string[],
  dateStyles: ReadonlySet<number>,
): Map<number, Map<number, string>> {
  const rows = new Map<number, Map<number, string>>();

  for (const chunk of xml.split("<row").slice(1)) {
    const rowMatch = /\sr="(\d+)"/.exec(chunk.slice(0, chunk.indexOf(">") + 1));
    if (!rowMatch?.[1]) continue;
    const rowNumber = Number(rowMatch[1]);
    const cells = new Map<number, string>();

    for (const cell of chunk.split("<c ").slice(1)) {
      const head = cell.slice(0, cell.indexOf(">") + 1);
      // No leading-whitespace anchor: splitting on "<c " has already consumed
      // the space, so the reference sits at position zero.
      const reference = /r="([A-Z]+)[0-9]+"/.exec(head)?.[1];
      if (!reference) continue;
      const type = /\st="([^"]+)"/.exec(head)?.[1] ?? "n";

      let value: string | undefined;
      if (type === "inlineStr") {
        const start = cell.indexOf("<t");
        const open = start < 0 ? -1 : cell.indexOf(">", start);
        const stop = cell.indexOf("</t>");
        if (open >= 0 && stop > open) value = unescapeXml(cell.slice(open + 1, stop));
      } else {
        // For a formula cell this is the cached result, which is what a report
        // reader wants: the figure the spreadsheet last displayed.
        const start = cell.indexOf("<v>");
        const stop = cell.indexOf("</v>");
        if (start >= 0 && stop > start) {
          const raw = unescapeXml(cell.slice(start + 3, stop));
          if (type === "s") {
            value = shared[Number(raw)] ?? "";
          } else {
            const style = Number(/\ss="(\d+)"/.exec(head)?.[1] ?? NaN);
            const dated = dateStyles.has(style) ? dateOfSerial(Number(raw)) : null;
            value = dated ?? raw;
          }
        }
      }

      if (value !== undefined && value !== "") cells.set(columnOf(reference), value);
    }

    if (cells.size > 0) rows.set(rowNumber, cells);
  }

  return rows;
}

/**
 * Read a workbook's sheets, in the order the workbook declares them.
 *
 * Sheet names come from `workbook.xml` and the files they live in from its
 * relationships, because the numbering of `sheetN.xml` does not reliably match
 * the order sheets appear in.
 */
export async function readXlsx(bytes: Uint8Array): Promise<Workbook> {
  const problems: WorkbookProblem[] = [];
  const entries = new Map(readZip(bytes).map((entry) => [entry.name, entry]));

  const sharedEntry = entries.get("xl/sharedStrings.xml");
  const shared = sharedEntry ? readSharedStrings(await inflate(sharedEntry)) : [];

  const stylesEntry = entries.get("xl/styles.xml");
  const dateStyles = stylesEntry ? readDateStyles(await inflate(stylesEntry)) : new Set<number>();

  const workbookEntry = entries.get("xl/workbook.xml");
  if (!workbookEntry) {
    return { sheets: [], problems: [{ message: "not an xlsx file: xl/workbook.xml is missing" }] };
  }
  const workbookXml = await inflate(workbookEntry);

  const relsEntry = entries.get("xl/_rels/workbook.xml.rels");
  const targets = new Map<string, string>();
  if (relsEntry) {
    const relsXml = await inflate(relsEntry);
    for (const rel of relsXml.split("<Relationship").slice(1)) {
      const id = /Id="([^"]+)"/.exec(rel)?.[1];
      const target = /Target="([^"]+)"/.exec(rel)?.[1];
      if (id && target) targets.set(id, target.replace(/^\/?xl\//, "").replace(/^\//, ""));
    }
  }

  const sheets: SheetRows[] = [];
  for (const declaration of workbookXml.split("<sheet ").slice(1)) {
    const head = declaration.slice(0, declaration.indexOf(">"));
    const name = unescapeXml(/name="([^"]*)"/.exec(head)?.[1] ?? "");
    const id = /r:id="([^"]+)"/.exec(head)?.[1];
    const target = id ? targets.get(id) : undefined;
    const entry = target ? entries.get(`xl/${target}`) : undefined;

    if (!entry) {
      problems.push({ message: `sheet ${JSON.stringify(name)} could not be located in the archive` });
      continue;
    }
    sheets.push({ name, rows: readSheet(await inflate(entry), shared, dateStyles) });
  }

  return { sheets, problems };
}

/**
 * A sheet rendered as CSV text.
 *
 * Every reader here is written against the CSV a system exports, because that
 * is the format with the stable column names. But the same report often comes
 * out of the same system as a spreadsheet -- Xero's Journal Report does, and a
 * person who exported it that way had no way in at all, with the file input
 * refusing the extension.
 *
 * Rather than teach each reader a second shape, the sheet is turned back into
 * the text they already understand. Gaps become empty cells so the columns
 * still line up, which is the whole reason a header row can be found.
 */
export function sheetToCsv(sheet: SheetRows): string {
  const width = Math.max(
    0,
    ...[...sheet.rows.values()].map((cells) => Math.max(0, ...cells.keys())),
  );

  const quote = (value: string): string =>
    /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

  const lines: string[] = [];
  for (const [, cells] of [...sheet.rows.entries()].sort((a, b) => a[0] - b[0])) {
    const row: string[] = [];
    for (let column = 1; column <= width; column += 1) row.push(quote(cells.get(column) ?? ""));
    lines.push(row.join(","));
  }
  return lines.join("\r\n");
}

/**
 * CSV text as a sheet.
 *
 * The inverse of `sheetToCsv`, and there for the same reason from the other
 * direction: a reader written against a workbook should not refuse the same
 * report when somebody exported it, or pasted it out, as a CSV. Blank cells
 * are left out rather than stored empty, which is how a sheet read from a
 * spreadsheet arrives.
 */
export function csvToSheet(text: string, name = "Sheet1"): SheetRows {
  const rows = new Map<number, Map<number, string>>();
  for (const record of parseCsvRecords(text)) {
    const cells = new Map<number, string>();
    record.fields.forEach((value, index) => {
      if (value !== "") cells.set(index + 1, value);
    });
    rows.set(record.line, cells);
  }
  return { name, rows };
}
