import type { ImportResult, Transaction } from "./types.js";

/**
 * OFX and QFX bank files: the download most banks in the United States and
 * Australia offer, and some in New Zealand ("Money", "Quicken", "OFX").
 *
 * Two dialects share one shape. OFX 1.x is SGML -- tags that are often never
 * closed, one value to a line -- and OFX 2.x is XML. Both hold a statement per
 * account (BANKACCTFROM or CCACCTFROM), its currency (CURDEF) and a list of
 * STMTTRN records. Reading by tag name, closed or not, handles both.
 *
 * Amounts are held in hundredths as everywhere in these books, whatever the
 * currency: TRNAMT 1234.5 is 123,450. The bank's FITID, its own id for the
 * line, goes in the reference, so a line that arrives in two downloads is
 * recognised as the same line.
 */

/** Whether a file is OFX or QFX rather than a CSV export. */
export function isOfx(text: string): boolean {
  const head = text.slice(0, 2000).toUpperCase();
  return head.includes("<OFX>") || head.includes("OFXHEADER") || head.includes("<?OFX");
}

/** The value of a tag inside a block, closed (XML) or not (SGML). */
function tag(block: string, name: string): string {
  const match = new RegExp(`<${name}>([^<\\r\\n]*)`, "i").exec(block);
  return (match?.[1] ?? "").trim();
}

/** Every block between <name> and </name>, or up to the next <name> where the close is left off. */
function blocks(text: string, name: string): string[] {
  const out: string[] = [];
  const open = new RegExp(`<${name}>`, "gi");
  let match: RegExpExecArray | null;
  const starts: number[] = [];
  while ((match = open.exec(text)) !== null) starts.push(match.index);
  starts.forEach((start, i) => {
    const close = text.toUpperCase().indexOf(`</${name.toUpperCase()}>`, start);
    const next = starts[i + 1] ?? text.length;
    out.push(text.slice(start, close >= 0 && close < next ? close : next));
  });
  return out;
}

/** 20260315120000.000[-5:EST] or 20260315 to 2026-03-15. */
function ofxDate(value: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(value);
  return m === null ? null : `${m[1]}-${m[2]}-${m[3]}`;
}

/** "1,234.50" or "-12.3" or "12,30" (some European files) to hundredths. */
function ofxAmount(value: string): number | null {
  let text = value.trim().replace(/\s/g, "");
  if (text === "") return null;
  // A comma with no point is a decimal comma; otherwise commas group thousands.
  if (text.includes(",") && !text.includes(".")) text = text.replace(",", ".");
  text = text.replace(/,/g, "");
  const n = Number(text);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export interface OfxOptions {
  file?: string;
  /** Account id where the file does not give one. */
  account?: string;
  /** Currency where the file does not state one. */
  defaultCurrency?: string;
}

/**
 * Read an OFX or QFX file into bank lines, one statement after another. Ids
 * and the occurrence count are set by the caller (importFile), as for every
 * other importer.
 */
export function importOfx(text: string, options: OfxOptions = {}): ImportResult {
  const file = options.file ?? "upload.ofx";
  const transactions: Transaction[] = [];
  const problems: ImportResult["problems"] = [];
  let firstAccount = options.account ?? "";

  const statements = [...blocks(text, "STMTRS"), ...blocks(text, "CCSTMTRS")];
  const sources = statements.length > 0 ? statements : [text];
  for (const statement of sources) {
    const from = blocks(statement, "BANKACCTFROM")[0] ?? blocks(statement, "CCACCTFROM")[0] ?? "";
    const accountId = tag(from, "ACCTID");
    const bank = tag(from, "BANKID");
    const account = options.account ?? (accountId === "" ? "ofx" : `ofx-${bank !== "" ? `${bank}-` : ""}${accountId}`);
    if (firstAccount === "") firstAccount = account;
    const currency = tag(statement, "CURDEF") || options.defaultCurrency || "USD";

    blocks(statement, "STMTTRN").forEach((record, index) => {
      const date = ofxDate(tag(record, "DTPOSTED"));
      const amount = ofxAmount(tag(record, "TRNAMT"));
      if (date === null || amount === null) {
        problems.push({ line: index + 1, row: [], message: "A transaction without a date or an amount was left out." });
        return;
      }
      const name = tag(record, "NAME") || tag(record, "PAYEE");
      const memo = tag(record, "MEMO");
      transactions.push({
        id: "",
        date,
        amount,
        currency,
        serial: tag(record, "CHECKNUM"),
        trn: "",
        particulars: memo,
        code: "",
        reference: tag(record, "FITID"),
        otherParty: name || memo,
        origin: "",
        type: tag(record, "TRNTYPE"),
        batch: "",
        otherPartyAccount: "",
        account,
        occurrence: 1,
        extras: {},
        source: { importer: "ofx", file, line: index + 1 },
      } as Transaction);
    });
  }
  return { importer: "ofx", file, account: firstAccount || "ofx", transactions, problems };
}
