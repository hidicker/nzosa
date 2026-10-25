import type { Cents } from "./money.js";
import type { IsoDate } from "./dates.js";
import { bankParts } from "./employee-details.js";

/**
 * Bank payment files: one file to upload to internet banking that pays a list
 * of people at once -- a pay run's net pay, or a run of bills -- instead of
 * typing each payment in.
 *
 * New Zealand has no single layout: each bank takes its own. The five here are
 * the big banks' bulk direct credit uploads -- ANZ's domestic extended CSV,
 * ASB's MT9 fixed-width file, BNZ's and Kiwibank's IB4B CSV, and Westpac's
 * Deskbank CSV -- worked from the banks' published layouts as the open-source
 * nz-bank-batch library (MIT) sets them out, since the bank sites themselves
 * could not be reached when this was written. Australia has one: the ABA (Cemtex)
 * direct entry file every bank takes.
 *
 * Nothing is sent from here. The file is saved, and the person uploads it to
 * their bank, which checks it again and shows every payment before it is
 * approved. Problems are returned rather than thrown, so a page can list them
 * all at once instead of failing on the first.
 */

/** One payment in a file. */
export interface PaymentItem {
  /** Who is paid, as their bank should show it. */
  name: string;
  /** Their account: a New Zealand account number, or, for ABA, the account number alone. */
  account: string;
  /** ABA only: the BSB, six digits. */
  bsb?: string;
  amount: Cents;
  /** What shows on the payee's statement: up to 12 characters each. */
  particulars?: string;
  code?: string;
  reference?: string;
}

export type NzBank = "anz" | "asb" | "bnz" | "kiwibank" | "westpac";

export const NZ_BANK_NAMES: Readonly<Record<NzBank, string>> = {
  anz: "ANZ",
  asb: "ASB",
  bnz: "BNZ",
  kiwibank: "Kiwibank",
  westpac: "Westpac",
};

/**
 * Which bank's file to make, from the account the money leaves: its first two
 * digits are the bank. Null for a bank with no layout here (TSB, the
 * co-operative bank and the rest), where the person picks by hand or keys
 * the payments in.
 */
export function nzBankOf(account: string): NzBank | null {
  const parts = nzAccount(account);
  if (parts === null) return null;
  switch (parts.bank) {
    case "01":
    case "06":
    case "11":
      return "anz";
    case "12":
      return "asb";
    case "02":
      return "bnz";
    case "38":
      return "kiwibank";
    case "03":
      return "westpac";
    default:
      return null;
  }
}

/** A New Zealand account in its four parts: a 7-digit base and a 2 or 3 digit suffix. */
export interface NzAccountParts {
  bank: string;
  branch: string;
  base: string;
  suffix: string;
}

/** A New Zealand account number read the ways people write them, or null. */
export function nzAccount(raw: string): NzAccountParts | null {
  const held = bankParts(raw);
  if (held === null) return null;
  let base = held.number;
  if (base.length === 8 && base.startsWith("0")) base = base.slice(1);
  if (!/^\d{7}$/.test(base)) return null;
  let suffix = held.suffix;
  while (suffix.length > 2 && suffix.startsWith("0")) suffix = suffix.slice(1);
  if (!/^\d{2,3}$/.test(suffix)) return null;
  if (!/^\d{2}$/.test(held.bank) || !/^\d{4}$/.test(held.branch)) return null;
  return { bank: held.bank, branch: held.branch, base, suffix };
}

/**
 * The hash total the NZ files carry: branch and base of every account added,
 * last 11 digits. ANZ and ASB take the base as its seven digits; BNZ's IB4B
 * takes it padded to eight, which moves every branch a place to the left.
 */
export function nzHashTotal(accounts: readonly NzAccountParts[], baseWidth: 7 | 8 = 7): string {
  let total = 0n;
  for (const a of accounts) total = (total + BigInt(`${a.branch}${a.base.padStart(baseWidth, "0")}`)) % 100_000_000_000n;
  return total.toString().padStart(11, "0");
}

export interface PaymentFile {
  /** The file's text, CRLF line ends; empty when there are problems. */
  text: string;
  fileName: string;
  problems: string[];
  total: Cents;
  count: number;
}

/**
 * Text a bank will take: plain ASCII, no commas (the CSV layouts have no
 * quoting), cut to the field's width. Macrons and other letters a bank cannot
 * carry are written without their marks, so "Māpua" goes as "Mapua".
 */
export function bankText(text: string | undefined, width: number, upper = false): string {
  const plain = (text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^ -~]/g, "")
    .replace(/[,"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const cut = plain.slice(0, width).trimEnd();
  return upper ? cut.toUpperCase() : cut;
}

/** A name for a bank field: "Limited" as "Ltd", so a company's name is not cut short of itself. */
export function bankName(name: string | undefined, width: number, upper = false): string {
  return bankText((name ?? "").replace(/\bLimited\b/gi, "Ltd"), width, upper);
}

const yymmdd = (iso: IsoDate): string => iso.slice(2).replace(/-/g, "");
const yyyymmdd = (iso: IsoDate): string => iso.replace(/-/g, "");
const ddmmyy = (iso: IsoDate): string => `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(2, 4)}`;

function checkItems(items: readonly PaymentItem[], read: (item: PaymentItem) => boolean, what: string): string[] {
  const problems: string[] = [];
  if (items.length === 0) problems.push("There is nothing to pay.");
  for (const item of items) {
    const who = item.name.trim() || "A payee with no name";
    if (item.name.trim() === "") problems.push("Every payment needs the payee's name.");
    if (!Number.isInteger(item.amount) || item.amount <= 0) problems.push(`${who}: the amount must be more than nothing.`);
    if (!read(item)) problems.push(`${who}: "${item.account}" is not ${what}.`);
  }
  return [...new Set(problems)];
}

/**
 * A New Zealand bank's bulk direct credit file.
 *
 * `wages` marks the payments as salary and wages where the bank has a code for
 * it (ANZ, ASB and Westpac); the others take an ordinary credit.
 */
export function nzPaymentFile(
  items: readonly PaymentItem[],
  options: {
    bank: NzBank;
    /** The account the money comes from. */
    fromAccount: string;
    /** Who the payments come from, as the payee's statement shows it. */
    payerName: string;
    /** The day the payments are to be made. */
    date: IsoDate;
    /** The day the file is made; today's date if not given. */
    created?: IsoDate;
    wages?: boolean;
    /** A reference for the whole batch: "PAY 22 SEP". */
    batchReference?: string;
  },
): PaymentFile {
  const { bank } = options;
  const from = nzAccount(options.fromAccount);
  const problems: string[] = [];
  if (from === null) problems.push(`The account to pay from, "${options.fromAccount}", is not a New Zealand account number.`);
  else if (nzBankOf(options.fromAccount) !== bank) {
    problems.push(`The account to pay from is not a ${NZ_BANK_NAMES[bank]} account, so ${NZ_BANK_NAMES[bank]} would not take the file.`);
  }
  if (bank === "asb" && from !== null && from.suffix.length !== 2) problems.push("ASB's file needs the account to pay from to have a two-digit suffix.");
  if (options.payerName.trim() === "") problems.push("The file needs the name the payments come from.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.date)) problems.push("The file needs the date the payments are to be made.");
  problems.push(...checkItems(items, (i) => nzAccount(i.account) !== null, "a New Zealand account number"));
  const total = items.reduce((s, i) => s + i.amount, 0);
  const fileName = `${NZ_BANK_NAMES[bank]} payments ${options.date}.${bank === "bnz" || bank === "kiwibank" ? "txt" : bank === "asb" ? "mt9" : "csv"}`;
  if (problems.length > 0 || from === null) return { text: "", fileName, problems: [...new Set(problems)], total, count: items.length };

  const accounts = items.map((i) => nzAccount(i.account) as NzAccountParts);
  const hash = nzHashTotal(accounts);
  const created = options.created ?? new Date().toISOString().slice(0, 10);
  const lines: string[] = [];

  if (bank === "bnz" || bank === "kiwibank") {
    const fromDigits = `${from.bank}${from.branch}${from.base}${from.suffix}`;
    lines.push(["1", "", "", "", fromDigits, "7", yymmdd(options.date), yymmdd(options.date), bankText(options.batchReference, 12)].join(","));
    items.forEach((item, n) => {
      const a = accounts[n] as NzAccountParts;
      const particulars = bankText(item.particulars, 12);
      const reference = bankText(item.reference, 12);
      lines.push(
        [
          "2",
          `${a.bank}${a.branch}${a.base}${a.suffix}`,
          "50",
          String(item.amount),
          bankName(item.name, 20),
          // The payee's particulars and reference, a spare field and
          // "information", then the payer's side.
          particulars,
          reference,
          "",
          "",
          bankName(options.payerName, 20),
          bankText(item.code, 12),
          reference,
          particulars,
        ].join(","),
      );
    });
    lines.push(["3", String(total), String(items.length), nzHashTotal(accounts, 8)].join(","));
  } else if (bank === "anz") {
    lines.push(["1", "", "", "", "", "", yyyymmdd(options.date), yyyymmdd(created), ""].join(","));
    items.forEach((item, n) => {
      const a = accounts[n] as NzAccountParts;
      const fields = [
        "2",
        `${a.bank}${a.branch}${a.base}${a.suffix.padStart(3, "0")}`,
        options.wages === true ? "52" : "50",
        String(item.amount),
        bankName(item.name, 20, true),
        // Reference, analysis code, alpha reference, particulars: the code
        // goes as the alpha reference, which is what statements show.
        bankText(item.reference, 12, true),
        "",
        bankText(item.code, 12, true),
        bankText(item.particulars, 12, true),
        bankName(options.payerName, 20, true),
        "",
        bankText(item.reference, 12, true),
        bankText(item.particulars, 12, true),
      ];
      while (fields.length > 5 && fields[fields.length - 1] === "") fields.pop();
      lines.push(fields.join(","));
    });
    lines.push(["3", String(total), String(items.length), hash].join(","));
  } else if (bank === "asb") {
    const field = (value: string, width: number, right = false, pad = " "): string =>
      right ? value.slice(-width).padStart(width, pad) : value.slice(0, width).padEnd(width, pad);
    const suffix = (s: string): string => (s.length === 2 ? `${s} ` : s.padStart(3, "0"));
    lines.push(
      "12" + from.bank + from.branch + from.base + suffix(from.suffix) +
        field(yyyymmdd(options.date), 13) + field(bankName(options.payerName, 20), 20) + field("", 109),
    );
    items.forEach((item, n) => {
      const a = accounts[n] as NzAccountParts;
      lines.push(
        "13" + a.bank + a.branch + a.base + suffix(a.suffix) +
          (options.wages === true ? "052" : "051") +
          field(String(item.amount), 10, true, "0") +
          field(bankName(item.name, 20), 20) +
          field("", 12) +
          // The payee's code is required: the payer's name stands in when none is given.
          field(bankText(item.code, 12) || bankName(options.payerName, 12), 12) +
          field(bankText(item.reference, 12), 12) +
          field(bankText(item.particulars, 12), 12) +
          " " +
          field(bankName(options.payerName, 20), 20) +
          field(bankText(item.code, 12), 12) +
          field(bankText(item.reference, 12), 12) +
          field(bankText(item.particulars, 12), 12) +
          field("", 4),
      );
    });
    lines.push("13" + "99" + hash + field("", 6) + field(String(total), 10, true, "0") + field("", 129));
  } else {
    // Westpac Deskbank: a header and one line a payment, numbered; no trailer.
    const seq = (n: number): string => String(n).padStart(6, "0");
    lines.push(["A", seq(1), "03", from.branch, bankName(options.payerName, 30, true), "", bankText(options.batchReference, 20, true), ddmmyy(options.date), ""].join(","));
    items.forEach((item, n) => {
      const a = accounts[n] as NzAccountParts;
      lines.push(
        [
          "D",
          seq(n + 2),
          a.bank,
          a.branch,
          a.base.padStart(8, "0"),
          a.suffix.padStart(4, "0"),
          options.wages === true ? "52" : "50",
          "DC",
          String(item.amount),
          bankName(item.name, 20),
          bankText(item.particulars, 12),
          bankText(item.code, 12),
          bankText(item.reference, 12),
          from.bank,
          from.branch,
          from.base.padStart(8, "0"),
          from.suffix.padStart(4, "0"),
          bankName(options.payerName, 20, true),
          "",
        ].join(","),
      );
    });
  }

  return { text: lines.join("\r\n") + "\r\n", fileName, problems: [], total, count: items.length };
}

/** What an ABA file needs from the bank, kept once and used for every file. */
export interface AbaSettings {
  bankCode: string;
  userName: string;
  userId: string;
  fromBsb: string;
  fromAccount: string;
  balance?: boolean;
}

/** A BSB as six digits, or null. */
export function cleanBsb(raw: string | undefined): string | null {
  const digits = (raw ?? "").replace(/[\s-]/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}

/** An Australian account number: up to nine digits (some carry a hyphen, which is kept out). */
export function cleanAuAccount(raw: string | undefined): string | null {
  const digits = (raw ?? "").replace(/[\s-]/g, "");
  return /^\d{1,9}$/.test(digits) ? digits : null;
}

/**
 * An Australian ABA (Cemtex direct entry) file: 120-character records, a
 * descriptive record, a detail record a payment and a file total.
 *
 * `balance` adds the balancing debit from the account paid from, which some
 * banks require (the file then nets to nothing); ask the bank whether yours
 * does.
 */
export function abaFile(
  items: readonly PaymentItem[],
  options: {
    /** The bank's three-letter code: CBA, WBC, NAB, ANZ, BQL... */
    bankCode: string;
    /** The name the bank holds for the account paying, up to 26 characters. */
    userName: string;
    /** The direct entry user ID the bank issued, six digits. */
    userId: string;
    /** The account the money comes from, for tracing returns. */
    fromBsb: string;
    fromAccount: string;
    /** Up to 16 characters: who the payments come from, on the payee's statement. */
    remitter: string;
    /** Up to 12 characters, "PAYROLL" or "SUPPLIERS". */
    description: string;
    date: IsoDate;
    wages?: boolean;
    balance?: boolean;
  },
): PaymentFile {
  const problems: string[] = [];
  const bankCode = options.bankCode.trim().toUpperCase();
  const fromBsb = cleanBsb(options.fromBsb);
  const fromAccount = cleanAuAccount(options.fromAccount);
  if (!/^[A-Z]{3}$/.test(bankCode)) problems.push("The bank's three-letter code is needed (CBA, WBC, NAB, ANZ...).");
  if (!/^\d{6}$/.test(options.userId.trim())) problems.push("The direct entry user ID is six digits, from the bank.");
  if (bankText(options.userName, 26) === "") problems.push("The account name the bank holds is needed.");
  if (fromBsb === null || fromAccount === null) problems.push("The BSB and account number to pay from are needed.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.date)) problems.push("The file needs the date the payments are to be made.");
  problems.push(
    ...checkItems(items, (i) => cleanBsb(i.bsb) !== null && cleanAuAccount(i.account) !== null, "a BSB and account number"),
  );
  const total = items.reduce((s, i) => s + i.amount, 0);
  const fileName = `ABA payments ${options.date}.aba`;
  if (problems.length > 0 || fromBsb === null || fromAccount === null) {
    return { text: "", fileName, problems: [...new Set(problems)], total, count: items.length };
  }
  if (total > 9_999_999_999) problems.push("The file's total is more than an ABA file can carry.");

  const left = (value: string, width: number): string => value.slice(0, width).padEnd(width, " ");
  const right = (value: string, width: number, pad = " "): string => value.slice(-width).padStart(width, pad);
  const bsb = (digits: string): string => `${digits.slice(0, 3)}-${digits.slice(3)}`;
  const remitter = bankName(options.remitter, 16) || bankName(options.userName, 16);

  const detail = (to: { bsb: string; account: string }, code: string, amount: Cents, title: string, reference: string): string =>
    "1" + bsb(to.bsb) + right(to.account, 9) + " " + code + right(String(amount), 10, "0") +
    left(title, 32) + left(reference, 18) + bsb(fromBsb) + right(fromAccount, 9) + left(remitter, 16) + "00000000";

  const lines = [
    "0" + " ".repeat(17) + "01" + bankCode + " ".repeat(7) + left(bankText(options.userName, 26), 26) +
      right(options.userId.trim(), 6, "0") + left(bankText(options.description, 12), 12) + ddmmyy(options.date) + " ".repeat(40),
  ];
  for (const item of items) {
    const reference = bankText([item.reference, item.particulars].filter(Boolean).join(" "), 18);
    lines.push(
      detail(
        { bsb: cleanBsb(item.bsb) as string, account: cleanAuAccount(item.account) as string },
        options.wages === true ? "53" : "50",
        item.amount,
        bankName(item.name, 32),
        reference,
      ),
    );
  }
  let debits = 0;
  if (options.balance === true) {
    lines.push(detail({ bsb: fromBsb, account: fromAccount }, "13", total, bankText(options.userName, 32), bankText(options.description, 18)));
    debits = total;
  }
  const count = lines.length - 1;
  lines.push(
    "7" + "999-999" + " ".repeat(12) + right(String(Math.abs(total - debits)), 10, "0") + right(String(total), 10, "0") +
      right(String(debits), 10, "0") + " ".repeat(24) + right(String(count), 6, "0") + " ".repeat(40),
  );
  if (problems.length > 0) return { text: "", fileName, problems, total, count: items.length };
  return { text: lines.join("\r\n") + "\r\n", fileName, problems: [], total, count: items.length };
}
