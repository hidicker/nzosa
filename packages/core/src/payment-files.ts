import type { Cents } from "./money.js";
import type { IsoDate } from "./dates.js";

/**
 * Bank payment files: a list of payments written the way a bank's business
 * internet banking imports them, so wages or bills are paid in one upload
 * instead of typed in one by one.
 *
 * New Zealand, from each bank's published guide:
 *   - BNZ Internet Banking for Business: comma separated, header 1 /
 *     transactions 2 / control 3, dates YYMMDD.
 *   - ANZ domestic extended format: the same three records, dates YYYYMMDD.
 *   - Westpac Corporate Online, New Zealand Direct Entry: fixed 180-character
 *     lines, a header A and a detail D for each payment, no trailer.
 * Australia: the ABA (Cemtex) direct entry file every Australian bank takes,
 * fixed 120-character lines: descriptive 0, details 1, file total 7.
 *
 * Nothing here sends anything. The file is downloaded and uploaded to the
 * bank by the person, who still approves the batch there.
 */

/** One payment to make. */
export interface BankPayment {
  /** Who is paid: shown on their statement, cut to fit. */
  name: string;
  /** Their account: an NZ account number, or an Australian BSB and account number. */
  account: string;
  amount: Cents;
  /** What their statement shows (New Zealand: particulars, code, reference; Australia: the reference). */
  particulars?: string;
  code?: string;
  reference?: string;
  /** What the payer's own statement shows against this payment (New Zealand). */
  ourParticulars?: string;
  ourCode?: string;
  ourReference?: string;
}

/** A payment left out, and why, in words for the person. */
export interface SkippedPayment {
  name: string;
  why: string;
}

export interface PaymentFile {
  text: string;
  /** A file name ending in the extension the bank expects. */
  fileName: string;
  count: number;
  total: Cents;
  skipped: SkippedPayment[];
}

export type NzBankFormat = "bnz" | "anz" | "westpac";

export const NZ_BANK_FORMATS: readonly { id: NzBankFormat; label: string }[] = [
  { id: "bnz", label: "BNZ (Internet Banking for Business)" },
  { id: "anz", label: "ANZ (domestic payments file)" },
  { id: "westpac", label: "Westpac (Corporate Online direct entry)" },
];

/** An NZ account number in its four parts, the account base as 7 digits; null when it is not one. */
export function nzAccountParts(account: string): { bank: string; branch: string; base: string; suffix: string } | null {
  const text = account.trim();
  const pieces = text.split(/[\s-]+/).filter(Boolean);
  if (pieces.length === 4 && pieces.every((p) => /^\d+$/.test(p))) {
    const [bank, branch, base, suffix] = pieces as [string, string, string, string];
    if (bank.length > 2 || branch.length > 4 || base.length > 8 || suffix.length > 4) return null;
    // An 8-digit base is a 7-digit one with a leading zero (the hash rules drop its first digit).
    if (base.length === 8 && !base.startsWith("0")) return null;
    const suffixValue = Number(suffix);
    if (suffixValue > 999) return null;
    return {
      bank: bank.padStart(2, "0"),
      branch: branch.padStart(4, "0"),
      base: base.slice(-7).padStart(7, "0"),
      suffix: String(suffixValue).padStart(3, "0"),
    };
  }
  const digits = text.replace(/\D/g, "");
  if (digits !== text.replace(/[\s-]/g, "")) return null;
  if (digits.length === 15 || digits.length === 16) {
    return { bank: digits.slice(0, 2), branch: digits.slice(2, 6), base: digits.slice(6, 13), suffix: digits.slice(13).padStart(3, "0") };
  }
  return null;
}

/** As the CSV formats take it: 16 digits, the suffix as three. */
function nzSixteen(parts: { bank: string; branch: string; base: string; suffix: string }): string {
  return `${parts.bank}${parts.branch}${parts.base}${parts.suffix}`;
}

/**
 * The control record's hash total: each account's branch and base number
 * (digits 3 to 13 of the 16) added up, the left digits dropped past eleven,
 * zero filled to eleven.
 */
export function nzHashTotal(accounts: readonly string[]): string {
  let sum = 0n;
  for (const account of accounts) {
    const parts = nzAccountParts(account);
    if (parts !== null) sum += BigInt(`${parts.branch}${parts.base}`);
  }
  return String(sum % 100_000_000_000n).padStart(11, "0");
}

/**
 * Text a bank will take in a field: letters, digits, space and - ' & / # ? : _ .
 * Never a comma, which would split the field. Other characters become a
 * space, accents are dropped, and the result is cut to the length and trimmed
 * (no trailing spaces).
 */
export function bankText(value: string | undefined, length: number): string {
  const plain = (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’`]/g, "'")
    .replace(/[^A-Za-z0-9 \-'&/#?:_.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.slice(0, length).trimEnd();
}

const yymmdd = (date: IsoDate): string => `${date.slice(2, 4)}${date.slice(5, 7)}${date.slice(8, 10)}`;
const yyyymmdd = (date: IsoDate): string => date.replace(/-/g, "");
const ddmmyy = (date: IsoDate): string => `${date.slice(8, 10)}${date.slice(5, 7)}${date.slice(2, 4)}`;

const left = (text: string, length: number): string => text.slice(0, length).padEnd(length, " ");
const zeros = (value: number | bigint | string, length: number): string => String(value).padStart(length, "0");

/** Payments that can go in a file, and those that cannot, with the reason. */
function sortOut<T>(
  payments: readonly BankPayment[],
  read: (account: string) => T | null,
  accountWord: string,
): { kept: { payment: BankPayment; account: T }[]; skipped: SkippedPayment[] } {
  const kept: { payment: BankPayment; account: T }[] = [];
  const skipped: SkippedPayment[] = [];
  for (const payment of payments) {
    const name = payment.name.trim() === "" ? "(no name)" : payment.name.trim();
    if (!Number.isInteger(payment.amount) || payment.amount <= 0) {
      skipped.push({ name, why: "nothing to pay" });
      continue;
    }
    if (payment.account.trim() === "") {
      skipped.push({ name, why: `no ${accountWord} on file` });
      continue;
    }
    const account = read(payment.account);
    if (account === null) {
      skipped.push({ name, why: `${payment.account.trim()} is not a ${accountWord}` });
      continue;
    }
    if (bankText(payment.name, 20) === "") {
      skipped.push({ name, why: "no name a bank can show" });
      continue;
    }
    kept.push({ payment, account });
  }
  return { kept, skipped };
}

export interface NzPaymentFileOptions {
  format: NzBankFormat;
  /** The account paying, an NZ account number. */
  from: string;
  /** The payer's name, as the people paid see it. */
  payer: string;
  /** The day the bank is to pay. */
  due: IsoDate;
  /** Today. */
  created: IsoDate;
  payments: readonly BankPayment[];
  /** Wages: transaction code 52 and one line on the payer's statement, rather than 50 and a line each. */
  payroll?: boolean;
  /** Start of the file name, without extension. */
  name?: string;
}

/**
 * A New Zealand bank payment file. Throws when the paying account is not an
 * NZ account number, or (Westpac) not a Westpac one: the file would be
 * refused whole.
 */
export function nzPaymentFile(options: NzPaymentFileOptions): PaymentFile {
  const from = nzAccountParts(options.from);
  if (from === null) throw new Error(`${options.from.trim() || "The paying account"} is not a New Zealand bank account number.`);
  if (options.format === "westpac" && from.bank !== "03") {
    throw new Error("Westpac's file pays from a Westpac account, one starting 03.");
  }
  const { kept, skipped } = sortOut(options.payments, nzAccountParts, "NZ bank account");
  const total = kept.reduce((sum, k) => sum + k.payment.amount, 0);
  const payer = bankText(options.payer, 20);
  const code = options.payroll === true ? "52" : "50";
  const base = (options.name ?? "payments").replace(/[^A-Za-z0-9 \-'&#_]/g, "-");
  const lines: string[] = [];

  if (options.format === "bnz" || options.format === "anz") {
    if (options.format === "bnz") {
      // Blank: one total line on the payer's statement (wages). I: a line each,
      // with the payer's own particulars, code and reference -- one per bill
      // to match on Reconcile.
      lines.push(["1", "", "", "", nzSixteen(from), "7", yymmdd(options.due), yymmdd(options.created), options.payroll === true ? "" : "I"].join(","));
    } else {
      lines.push(["1", "", "", "", "", "", yyyymmdd(options.due), yyyymmdd(options.created), ""].join(","));
    }
    for (const { payment, account } of kept) {
      lines.push(
        [
          "2",
          nzSixteen(account),
          code,
          String(payment.amount),
          bankText(payment.name, 20),
          bankText(payment.reference, 12),
          bankText(payment.code, 12),
          "",
          bankText(payment.particulars, 12),
          payer,
          bankText(payment.ourCode, 12),
          bankText(payment.ourReference, 12),
          bankText(payment.ourParticulars, 12),
        ].join(","),
      );
    }
    lines.push(["3", String(total), String(kept.length), nzHashTotal(kept.map((k) => k.payment.account))].join(","));
    return { text: `${lines.join("\r\n")}\r\n`, fileName: `${base}.txt`, count: kept.length, total, skipped };
  }

  // Westpac: fixed width, a header A then a detail D a payment.
  let sequence = 1;
  lines.push(
    "A" +
      zeros(sequence, 6) +
      "03" +
      from.branch +
      left(bankText(options.payer, 30), 30) +
      " ".repeat(6) +
      left(bankText(options.payroll === true ? "Wages" : "Payments", 20), 20) +
      ddmmyy(options.due) +
      " ".repeat(105),
  );
  for (const { payment, account } of kept) {
    sequence += 1;
    lines.push(
      "D" +
        zeros(sequence, 6) +
        account.bank +
        account.branch +
        zeros(account.base, 8) +
        zeros(account.suffix, 4) +
        code +
        "DC" +
        zeros(payment.amount, 15) +
        left(bankText(payment.name, 20), 20) +
        left(bankText(payment.particulars, 12), 12) +
        left(bankText(payment.code, 12), 12) +
        left(bankText(payment.reference, 12), 12) +
        from.bank +
        from.branch +
        zeros(from.base, 8) +
        zeros(from.suffix, 4) +
        left(payer, 20) +
        " ".repeat(42),
    );
  }
  return { text: `${lines.join("\r\n")}\r\n`, fileName: `${base}.txt`, count: kept.length, total, skipped };
}

/** An Australian account as a BSB (NNN-NNN) and account number; null when it is not one. */
export function auAccountParts(account: string): { bsb: string; number: string } | null {
  const text = account.trim();
  const match = /^(\d{3})[\s-]?(\d{3})[\s,/-]+(\d{1,9})$/.exec(text) ?? /^(\d{3})(\d{3})(\d{1,9})$/.exec(text.replace(/\s+/g, ""));
  if (match === null) return null;
  const [, a, b, number] = match as unknown as [string, string, string, string];
  return { bsb: `${a}-${b}`, number };
}

export interface AbaOptions {
  /** The paying account: BSB and account number. */
  from: string;
  /** The bank's three-letter code: CBA, WBC, NAB, ANZ, and so on. */
  bank: string;
  /** The name the bank holds for the person paying (the APCA user name). */
  userName: string;
  /** The six-digit APCA user identification number the bank gave. */
  userId: string;
  /** What the batch is: "PAYROLL", "CREDITORS". Up to 12 characters. */
  description: string;
  /** The day the bank is to process it. */
  date: IsoDate;
  /** Remitter, shown on the receiver's statement: up to 16 characters. */
  remitter: string;
  payments: readonly BankPayment[];
  /** Wages: code 53 rather than 50. */
  payroll?: boolean;
  /** Add a debit to the paying account for the total, for banks that ask for a balanced file. */
  balance?: boolean;
  name?: string;
}

/**
 * An ABA (Cemtex) direct entry file. Throws when the paying account, the
 * bank code or the user ID would get the whole file refused.
 */
export function abaFile(options: AbaOptions): PaymentFile {
  const from = auAccountParts(options.from);
  if (from === null) throw new Error(`${options.from.trim() || "The paying account"} is not a BSB and account number.`);
  const bank = options.bank.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(bank)) throw new Error("The bank's three-letter code, such as CBA, WBC, NAB or ANZ.");
  const userId = options.userId.trim();
  if (!/^\d{1,6}$/.test(userId)) throw new Error("The APCA user ID: the six-digit number the bank gave for direct entry.");
  const userName = bankText(options.userName, 26);
  if (userName === "") throw new Error("The account name the bank holds for the paying account.");

  const { kept, skipped } = sortOut(options.payments, auAccountParts, "BSB and account number");
  const total = kept.reduce((sum, k) => sum + k.payment.amount, 0);
  const remitter = left(bankText(options.remitter, 16), 16);
  const code = options.payroll === true ? "53" : "50";
  const lines: string[] = [];
  lines.push(
    "0" +
      " ".repeat(17) +
      "01" +
      bank +
      " ".repeat(7) +
      left(userName, 26) +
      zeros(userId, 6) +
      left(bankText(options.description, 12), 12) +
      ddmmyy(options.date) +
      " ".repeat(40),
  );
  const detail = (bsb: string, number: string, txCode: string, amount: Cents, title: string, reference: string): string =>
    "1" +
    bsb +
    number.padStart(9, " ") +
    " " +
    txCode +
    zeros(amount, 10) +
    left(bankText(title, 32), 32) +
    left(bankText(reference, 18), 18) +
    from.bsb +
    from.number.padStart(9, " ") +
    remitter +
    "0".repeat(8);
  for (const { payment, account } of kept) {
    lines.push(detail(account.bsb, account.number, code, payment.amount, payment.name, payment.reference ?? ""));
  }
  const balanced = options.balance === true && total > 0;
  if (balanced) lines.push(detail(from.bsb, from.number, "13", total, options.userName, options.description));
  const debits = balanced ? total : 0;
  lines.push(
    "7" +
      "999-999" +
      " ".repeat(12) +
      zeros(Math.abs(total - debits), 10) +
      zeros(total, 10) +
      zeros(debits, 10) +
      " ".repeat(24) +
      zeros(kept.length + (balanced ? 1 : 0), 6) +
      " ".repeat(40),
  );
  const base = (options.name ?? "payments").replace(/[^A-Za-z0-9 \-_]/g, "-");
  return { text: `${lines.join("\r\n")}\r\n`, fileName: `${base}.aba`, count: kept.length, total, skipped };
}
