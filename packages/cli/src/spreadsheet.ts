import { readFileSync } from "node:fs";
import { readXlsx, sheetToCsv } from "@nzosa/core";

/**
 * Read a file the user exported, whether it came out as CSV or as a workbook.
 *
 * Xero offers both, and which one you get depends on which button you happened
 * to press. Read as text, a `.xlsx` is a zip archive: the header row is not
 * found, and the reader says "required columns missing" -- which sends the
 * person off to check their columns, when the columns were fine and the file
 * was simply the other kind.
 *
 * The core already turns a sheet back into CSV for exactly this reason, so
 * there is one shape for every reader downstream. This is where that happens.
 * A workbook's first sheet is the report; Xero's exports have only one.
 */
export async function readExport(path: string): Promise<string> {
  const bytes = new Uint8Array(readFileSync(path));

  // Every zip archive starts "PK", and every xlsx is a zip archive. Sniffing
  // the file beats trusting the extension: a workbook saved as `.csv` is still
  // a workbook, and a CSV named `.xlsx` is still text.
  const zipped = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (!zipped) {
    // A plain UTF-8 read mangles anything written in Windows-1252, which is
    // what a payee with an accent in their name comes out as.
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    return text.includes("�") ? new TextDecoder("windows-1252").decode(bytes) : text;
  }

  const workbook = await readXlsx(bytes);
  for (const problem of workbook.problems) {
    process.stderr.write(`  ${path}: ${problem.message}\n`);
  }
  const first = workbook.sheets[0];
  if (first === undefined) throw new Error(`${path} has no sheets in it.`);
  return sheetToCsv(first);
}
