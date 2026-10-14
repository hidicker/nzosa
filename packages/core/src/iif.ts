import type { Account } from "./chart.js";
import type { Contact } from "./contacts.js";
import { parseDate } from "./dates.js";
import { parseAmount } from "./money.js";
import type { ImportProblem, Transaction } from "./types.js";
import {
  quickBooksAccountId,
  quickBooksBooksFrom,
  quickBooksPlacement,
} from "./quickbooks.js";
import type {
  QuickBooksBooks,
  QuickBooksChart,
  QuickBooksEntry,
  QuickBooksLedgerOptions,
} from "./quickbooks.js";

/**
 * QuickBooks Desktop's IIF files (Intuit Interchange Format).
 *
 * Tab-separated, in blocks: a row starting `!` names the columns of the rows of
 * that kind that follow (`!ACCNT`, then `ACCNT` rows). A transaction is a
 * `TRNS` row, its `SPL` rows, and `ENDTRNS`; each row is one posting, debits
 * positive and credits negative. Lists come as `ACCNT`, `CUST` and `VEND`.
 *
 * The entries go the same way QuickBooks Online's general ledger does, so
 * invoices and bills come in as documents with their payments applied, money
 * moved between accounts as transfers, and the rest as journals.
 */

export function isIif(text: string): boolean {
  return /^"?!(TRNS|ACCNT|CUST|VEND)"?\t/m.test(text.slice(0, 20000));
}

/** IIF's account types, as QuickBooks Online names them. */
const ACCOUNT_TYPES: Record<string, string> = {
  BANK: "Bank",
  CCARD: "Credit Card",
  AR: "Accounts receivable (A/R)",
  OCASSET: "Other Current Assets",
  FIXASSET: "Fixed Assets",
  OASSET: "Other Assets",
  AP: "Accounts payable (A/P)",
  OCLIAB: "Other Current Liabilities",
  LTLIAB: "Long Term Liabilities",
  EQUITY: "Equity",
  INC: "Income",
  COGS: "Cost of Goods Sold",
  EXP: "Expenses",
  EXINC: "Other Income",
  EXEXP: "Other Expense",
};

/** IIF's transaction types, as QuickBooks Online names them, which is what the rest of the reading goes by. */
const TRANSACTION_TYPES: Record<string, string> = {
  INVOICE: "Invoice",
  BILL: "Bill",
  PAYMENT: "Payment",
  CHECK: "Check",
  DEPOSIT: "Deposit",
  "GENERAL JOURNAL": "Journal Entry",
  BILLPMT: "Bill Payment (Check)",
  "BILL REFUND": "Vendor Refund",
  "CREDIT MEMO": "Credit Memo",
  "CASH SALE": "Sales Receipt",
  "CREDIT CARD": "Expense",
  "CC CREDIT": "Credit Card Credit",
  "BILL CCARD": "Bill Payment (Credit Card)",
  TRANSFER: "Transfer",
  "ITEM RECEIPT": "Item Receipt",
  "SALES TAX PAYMENT": "Sales Tax Payment",
  "INVENTORY ADJUST": "Inventory Qty Adjust",
  ESTIMATE: "Estimate",
  "PURCHORD": "Purchase Order",
};

function titleCase(text: string): string {
  return text.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** One cell: IIF quotes a cell that has a tab or a quote in it. */
function cell(raw: string | undefined): string {
  const text = (raw ?? "").trim();
  return text.length >= 2 && text.startsWith('"') && text.endsWith('"') ? text.slice(1, -1).replace(/""/g, '"').trim() : text;
}

export interface IifFile {
  chart: QuickBooksChart;
  entries: QuickBooksEntry[];
  contacts: Omit<Contact, "id">[];
  /** Class each entry was given, by its position in `entries`, where it gave one. */
  classes: Map<QuickBooksEntry, string>;
  problems: ImportProblem[];
}

/** Read an IIF file's accounts, customers, vendors and transactions. */
export function parseIif(text: string, options: { currency?: string } = {}): IifFile {
  const currency = options.currency ?? "USD";
  const columns = new Map<string, string[]>();
  const accounts: Account[] = [];
  const bankNames: string[] = [];
  const cardNames: string[] = [];
  const debitNormal: string[] = [];
  const next = new Map<number, number>();
  const contacts: Omit<Contact, "id">[] = [];
  const entries: QuickBooksEntry[] = [];
  const classes = new Map<QuickBooksEntry, string>();
  const problems: ImportProblem[] = [];
  const lines = text.split(/\r?\n/);
  let open: QuickBooksEntry | null = null;
  let openLine = 0;

  const close = (): void => {
    if (open === null) return;
    const sum = open.legs.reduce((total, leg) => total + leg.debit, 0);
    if (sum !== 0) {
      problems.push({
        line: openLine,
        row: [],
        message: `${open.date} ${open.type} ${open.num} does not balance and was left out`.replace(/\s+/g, " "),
      });
    } else {
      entries.push(open);
    }
    open = null;
  };

  lines.forEach((raw, index) => {
    const line = index + 1;
    if (raw.trim() === "") return;
    const fields = raw.split("\t").map(cell);
    const kind = (fields[0] ?? "").toUpperCase();
    if (kind.startsWith("!")) {
      columns.set(kind.slice(1), fields.map((f) => f.toUpperCase()));
      return;
    }
    const heads = columns.get(kind);
    if (heads === undefined) return;
    const get = (name: string): string => {
      const at = heads.indexOf(name);
      return at < 0 ? "" : (fields[at] ?? "");
    };

    if (kind === "ACCNT") {
      const name = get("NAME");
      const typeCode = get("ACCNTTYPE").toUpperCase();
      const type = ACCOUNT_TYPES[typeCode];
      if (name === "" || type === undefined || accounts.some((a) => a.name === name)) return;
      const place = quickBooksPlacement(type, /retained earnings/i.test(name) ? "Retained Earnings" : "");
      // The account's own number where it has one; one made from its type where not.
      let code = "";
      if (place.base !== null) {
        const own = get("ACCNUM");
        if (own !== "" && !accounts.some((a) => a.code === own)) code = own;
        else {
          let n = next.get(place.base) ?? place.base;
          while (accounts.some((a) => a.code === String(n))) n += 10;
          code = String(n);
          next.set(place.base, n + 10);
        }
      }
      accounts.push({
        code,
        name,
        type: place.type,
        taxCode: "",
        description: typeCode === "CCARD" ? "Credit Card" : get("DESC"),
      } as Account);
      if (place.debit) debitNormal.push(name);
      if (place.bank) bankNames.push(name);
      if (place.card) cardNames.push(name);
      return;
    }

    if (kind === "CUST" || kind === "VEND") {
      const name = get("NAME");
      if (name === "") return;
      const address = ["ADDR1", "ADDR2", "ADDR3", "ADDR4", "ADDR5"]
        .map((k) => get(k) || get(`B${k}`))
        .filter((part) => part !== "")
        .join("\n");
      const email = get("EMAIL");
      const phone = get("PHONE1");
      const company = get("COMPANYNAME");
      const terms = get("TERMS");
      const taxId = get("TAXID");
      contacts.push({
        name,
        kind: kind === "CUST" ? "customer" : "vendor",
        source: "QuickBooks",
        ...(company !== "" && company !== name ? { company } : {}),
        ...(email !== "" ? { email } : {}),
        ...(phone !== "" ? { phone } : {}),
        ...(address !== "" ? { address } : {}),
        ...(terms !== "" ? { terms } : {}),
        ...(taxId !== "" ? { taxId } : {}),
        ...(kind === "VEND" && /^y/i.test(get("1099")) ? { is1099: true } : {}),
      });
      return;
    }

    if (kind === "ENDTRNS") {
      close();
      return;
    }
    if (kind !== "TRNS" && kind !== "SPL") return;
    if (kind === "TRNS") {
      close();
      const dateText = get("DATE");
      const date = parseDate(dateText, { dayFirst: false });
      if (date === null) {
        problems.push({ line, row: fields, message: `Unreadable date ${JSON.stringify(dateText)}` });
        return;
      }
      const typeCode = get("TRNSTYPE").toUpperCase();
      open = {
        date,
        type: TRANSACTION_TYPES[typeCode] ?? titleCase(typeCode),
        num: get("DOCNUM"),
        name: get("NAME"),
        memo: get("MEMO"),
        legs: [],
      };
      openLine = line;
      const klass = get("CLASS");
      if (klass !== "") classes.set(open, klass);
    }
    if (open === null) return;
    const account = get("ACCNT");
    const amount = parseAmount(get("AMOUNT") || "0", currency);
    if (amount === null) {
      problems.push({ line, row: fields, message: `Unreadable amount ${JSON.stringify(get("AMOUNT"))}` });
      return;
    }
    if (account === "") return;
    const memo = get("MEMO");
    open.legs.push({ account, debit: amount, ...(memo !== "" ? { memo } : {}) });
  });
  close();

  return { chart: { accounts, debitNormal, bankNames, cardNames }, entries, contacts, classes, problems };
}

/**
 * Everything an IIF file holds, as this app keeps it. `chart` is the books'
 * own, for a file that carries transactions but not the accounts they use.
 */
export function parseIifBooks(
  text: string,
  chart: QuickBooksChart | null,
  options: QuickBooksLedgerOptions = {},
): QuickBooksBooks & {
  chart: QuickBooksChart;
  listed: Omit<Contact, "id">[];
  /** The class each bank line and document was given, where the file gave one. */
  classOf: { transactions: Map<Transaction, string>; invoices: Map<string, string> };
} {
  const file = parseIif(text, options.currency !== undefined ? { currency: options.currency } : {});
  const used = file.chart.accounts.length > 0 || chart === null ? file.chart : chart;
  const known = new Set(used.accounts.map((a) => a.name));
  const banks = new Set(used.bankNames);
  const problems: ImportProblem[] = [...file.problems];
  const entries = file.entries.filter((entry) => {
    const missing = entry.legs.find((leg) => !known.has(leg.account));
    if (missing === undefined) return true;
    problems.push({ line: 0, row: [], message: `${entry.date} ${entry.type} ${entry.num}: account "${missing.account}" is not in the chart` });
    return false;
  });

  // Each posting to a bank or card account is a bank line, as the bank or
  // card would show it: a debit is money in. A card's charge is a credit to
  // it, so it comes out as money going out, which is what it was.
  const currency = options.currency ?? "USD";
  const name = options.file ?? "quickbooks.iif";
  const transactions: Transaction[] = [];
  const classOfLine = new Map<Transaction, string>();
  for (const entry of entries) {
    const klass = file.classes.get(entry);
    for (const leg of entry.legs) {
      if (!banks.has(leg.account) || leg.debit === 0) continue;
      const words = leg.memo ?? entry.memo;
      transactions.push({
        id: "",
        occurrence: 1,
        date: entry.date,
        amount: leg.debit,
        currency,
        serial: "",
        trn: "",
        particulars: words,
        code: entry.num,
        reference: "",
        otherParty: entry.name || words,
        origin: "",
        type: entry.type,
        batch: "",
        otherPartyAccount: "",
        account: quickBooksAccountId(leg.account),
        extras: { accountLabel: leg.account },
        source: { importer: "quickbooks-iif", file: name, line: 0 },
      } as Transaction);
      const made = transactions[transactions.length - 1];
      if (klass !== undefined && made !== undefined) classOfLine.set(made, klass);
    }
  }
  const books = quickBooksBooksFrom(
    { transactions, reference: [], problems: [] },
    { entries, problems: [] },
    used,
    { ...options, file: name },
  );
  // A document is the entry of its date, name and number.
  const classOfDocument = new Map<string, string>();
  for (const invoice of books.invoices) {
    const entry = entries.find(
      (e) => e.date === invoice.issued && e.name === invoice.contact && e.num !== "" && invoice.number.startsWith(e.num),
    );
    const klass = entry === undefined ? undefined : file.classes.get(entry);
    if (klass !== undefined) classOfDocument.set(invoice.number, klass);
  }
  return {
    ...books,
    problems: [...problems, ...books.problems],
    chart: used,
    listed: file.contacts,
    classOf: { transactions: classOfLine, invoices: classOfDocument },
  };
}
