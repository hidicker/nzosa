import { NZ_BANK_FORMATS, abaFile, isAccountNumber, nzPaymentFile } from "@nzosa/core";
import type { BankPayment, IsoDate, NzBankFormat, PaymentFile } from "@nzosa/core";
import { bankLabel, banks } from "../books.js";
import { booksMoney } from "../country.js";
import { download, tellOnPage } from "../ui.js";

/**
 * The bank payment file dialog: wages from a pay run, or bills, written as a
 * file the bank's business internet banking imports. The person picks the
 * bank and the paying account, ticks what to pay, and downloads the file;
 * the payments are approved at the bank, never sent from here.
 */

/** One payment the dialog offers. */
export interface OfferedPayment {
  payment: BankPayment;
  /** A second line under the name: the bill number and its due date. */
  detail?: string;
  /** Ticked at first. */
  ticked?: boolean;
}

export interface PaymentFileRequest {
  title: string;
  country: "nz" | "au";
  payments: readonly OfferedPayment[];
  /** Wages: the payroll transaction code. */
  payroll: boolean;
  /** The payday or the day the bills are to be paid. */
  date: IsoDate;
  /** Who is paying, as the people paid see it. */
  payer: string;
  /** Start of the file name. */
  fileName: string;
  /** ABA batch description: PAYROLL, CREDITORS. */
  description: string;
  /** Where a missing bank account is added, in words. */
  whereToAdd: string;
  /** Run when the ticked list changes date, for bills due by a date. */
  tickFor?: (date: IsoDate) => readonly boolean[];
}

/** What was used last time, so the next file starts the same. Kept in this browser only. */
interface Remembered {
  format?: NzBankFormat;
  from?: string;
  auFrom?: string;
  bank?: string;
  userId?: string;
  userName?: string;
  balance?: boolean;
}

/** Kept by who is paying: one browser can keep several sets of books. */
const memoryKey = (payer: string): string => `nzosa-payment-file:${payer.trim().toLowerCase()}`;

function remembered(payer: string): Remembered {
  try {
    const text = localStorage.getItem(memoryKey(payer));
    return text === null ? {} : (JSON.parse(text) as Remembered);
  } catch {
    return {};
  }
}

function remember(payer: string, next: Remembered): void {
  try {
    localStorage.setItem(memoryKey(payer), JSON.stringify({ ...remembered(payer), ...next }));
  } catch {
    // Private window or storage blocked: it is only a convenience.
  }
}

const todayIs = (): IsoDate => new Date().toLocaleDateString("en-CA") as IsoDate;

function labelled(text: string, control: HTMLElement, hint?: string): HTMLLabelElement {
  const label = document.createElement("label");
  label.className = "contact-field";
  const span = document.createElement("span");
  span.textContent = text;
  label.append(span, control);
  if (hint !== undefined) {
    const small = document.createElement("small");
    small.textContent = hint;
    label.append(small);
  }
  return label;
}

function textInput(value: string, placeholder = ""): HTMLInputElement {
  const el = document.createElement("input");
  el.type = "text";
  el.value = value;
  el.placeholder = placeholder;
  el.autocomplete = "off";
  return el;
}

/** The books' own NZ bank accounts, to pick the paying one from. */
function ownNzAccounts(): { value: string; label: string }[] {
  return [...banks().accounts]
    .filter((a) => isAccountNumber(a))
    .map((a) => ({ value: a, label: bankLabel(a) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function openPaymentFile(request: PaymentFileRequest): void {
  const memory = remembered(request.payer);
  const box = document.createElement("dialog");
  box.className = "ask-on-page payment-file-view";
  const heading = document.createElement("h3");
  heading.textContent = request.title;

  const fields = document.createElement("div");
  fields.className = "payment-file-fields";
  const date = document.createElement("input");
  date.type = "date";
  // A bank takes nothing dated before today: an old pay run is paid from today.
  date.value = request.date < todayIs() ? todayIs() : request.date;
  const payer = textInput(request.payer);
  payer.maxLength = request.country === "au" ? 16 : 20;

  // New Zealand: the bank's format and the paying account.
  const format = document.createElement("select");
  for (const one of NZ_BANK_FORMATS) {
    const option = document.createElement("option");
    option.value = one.id;
    option.textContent = one.label;
    option.selected = (memory.format ?? "bnz") === one.id;
    format.append(option);
  }
  const own = ownNzAccounts();
  const from = textInput(
    request.country === "au" ? (memory.auFrom ?? "") : (memory.from ?? own[0]?.value ?? ""),
    request.country === "au" ? "062-000 12345678" : "02-0100-0123456-000",
  );
  if (request.country === "nz" && own.length > 0) {
    const list = document.createElement("datalist");
    list.id = "payment-file-accounts";
    for (const a of own) {
      const option = document.createElement("option");
      option.value = a.value;
      option.label = a.label;
      list.append(option);
    }
    from.setAttribute("list", list.id);
    fields.append(list);
  }

  // Australia: what the bank gave for direct entry.
  const bank = textInput(memory.bank ?? "", "CBA");
  bank.maxLength = 3;
  const userId = textInput(memory.userId ?? "", "301500");
  userId.inputMode = "numeric";
  userId.maxLength = 6;
  const userName = textInput(memory.userName ?? request.payer, "As your bank holds it");
  userName.maxLength = 26;
  const balance = document.createElement("input");
  balance.type = "checkbox";
  balance.checked = memory.balance === true;
  const balanceLabel = document.createElement("label");
  balanceLabel.className = "payment-file-tick";
  balanceLabel.append(balance, " Add a balancing line (some banks ask for one)");

  if (request.country === "nz") {
    fields.append(
      labelled("Bank", format),
      labelled("Pay from", from, "Your account the money comes out of"),
      labelled("Pay on", date),
      labelled("Your name on their statement", payer),
    );
  } else {
    fields.append(
      labelled("Pay from (BSB and account)", from),
      labelled("Pay on", date),
      labelled("Bank code", bank, "Three letters: CBA, WBC, NAB, ANZ"),
      labelled("Direct entry user ID", userId, "Six digits, from your bank"),
      labelled("Account name", userName, "As your bank holds it"),
      labelled("Your name on their statement", payer),
      balanceLabel,
    );
  }

  // The payments, each ticked or not.
  const table = document.createElement("table");
  table.className = "report-table payment-file-table";
  table.innerHTML = "<thead><tr><th></th><th>Pay</th><th>Into</th><th style=\"text-align:right\">Amount</th></tr></thead>";
  const tbody = document.createElement("tbody");
  const ticks: HTMLInputElement[] = [];
  for (const offered of request.payments) {
    const tr = document.createElement("tr");
    const tickCell = document.createElement("td");
    const tick = document.createElement("input");
    tick.type = "checkbox";
    const hasAccount = offered.payment.account.trim() !== "";
    tick.checked = hasAccount && offered.ticked !== false;
    tick.disabled = !hasAccount;
    tick.setAttribute("aria-label", `Pay ${offered.payment.name}`);
    ticks.push(tick);
    tickCell.append(tick);
    const nameCell = document.createElement("td");
    nameCell.textContent = offered.payment.name;
    if (offered.detail !== undefined) {
      const small = document.createElement("small");
      small.className = "payment-file-detail";
      small.textContent = offered.detail;
      nameCell.append(document.createElement("br"), small);
    }
    const intoCell = document.createElement("td");
    intoCell.textContent = hasAccount ? offered.payment.account : "No bank account";
    if (!hasAccount) intoCell.className = "match-off";
    const amountCell = document.createElement("td");
    amountCell.className = "report-amount";
    amountCell.textContent = booksMoney(offered.payment.amount);
    tr.append(tickCell, nameCell, intoCell, amountCell);
    tbody.append(tr);
  }
  table.append(tbody);
  const missing = request.payments.filter((p) => p.payment.account.trim() === "");
  const missingNote = document.createElement("p");
  missingNote.className = "payment-file-said";
  if (missing.length > 0) {
    missingNote.textContent = `${missing.length === 1 ? "One has" : `${missing.length} have`} no bank account to pay into. Add it ${request.whereToAdd}.`;
  }

  const totalLine = document.createElement("p");
  totalLine.className = "payment-file-total";
  const said = document.createElement("p");
  said.className = "cloud-said";
  said.setAttribute("role", "alert");
  const chosen = (): BankPayment[] => request.payments.filter((_, i) => ticks[i]?.checked === true).map((p) => p.payment);
  const showTotal = (): void => {
    const picked = chosen();
    const total = picked.reduce((sum, p) => sum + p.amount, 0);
    totalLine.textContent = `${picked.length} ${picked.length === 1 ? "payment" : "payments"}, ${booksMoney(total)}`;
  };
  for (const tick of ticks) tick.addEventListener("change", showTotal);
  if (request.tickFor !== undefined) {
    const tickFor = request.tickFor;
    date.addEventListener("change", () => {
      if (date.value === "") return;
      const wanted = tickFor(date.value as IsoDate);
      ticks.forEach((tick, i) => {
        if (!tick.disabled) tick.checked = wanted[i] === true;
      });
      showTotal();
    });
  }
  showTotal();

  const actions = document.createElement("div");
  actions.className = "ask-on-page-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  const go = document.createElement("button");
  go.type = "button";
  go.className = "primary";
  go.textContent = "Download file";
  actions.append(cancel, go);

  const finish = (): void => {
    box.close();
    box.remove();
  };
  cancel.addEventListener("click", finish);
  box.addEventListener("cancel", (event) => {
    event.preventDefault();
    finish();
  });

  go.addEventListener("click", () => {
    said.textContent = "";
    const picked = chosen();
    if (picked.length === 0) {
      said.textContent = "Tick at least one payment.";
      return;
    }
    if (date.value === "") {
      said.textContent = "Say the day to pay.";
      return;
    }
    const on = date.value as IsoDate;
    const today = todayIs();
    if (on < today) {
      said.textContent = "Banks will not take a payment dated before today. Choose today or later.";
      return;
    }
    const name = `${request.fileName}-${on}`;
    let file: PaymentFile;
    try {
      if (request.country === "nz") {
        file = nzPaymentFile({
          format: format.value as NzBankFormat,
          from: from.value,
          payer: payer.value,
          due: on,
          created: today,
          payments: picked,
          payroll: request.payroll,
          name,
        });
        remember(request.payer, { format: format.value as NzBankFormat, from: from.value.trim() });
      } else {
        file = abaFile({
          from: from.value,
          bank: bank.value,
          userName: userName.value,
          userId: userId.value,
          description: request.description,
          date: on,
          remitter: payer.value,
          payments: picked,
          payroll: request.payroll,
          balance: balance.checked,
          name,
        });
        remember(request.payer, { auFrom: from.value.trim(), bank: bank.value.trim().toUpperCase(), userId: userId.value.trim(), userName: userName.value.trim(), balance: balance.checked });
      }
    } catch (error) {
      said.textContent = error instanceof Error ? error.message : String(error);
      return;
    }
    if (file.count === 0) {
      said.textContent = `None of these can go in a file: ${file.skipped.map((s) => `${s.name}, ${s.why}`).join("; ")}.`;
      return;
    }
    download(file.text, file.fileName, "text/plain");
    finish();
    const left = file.skipped.length === 0 ? "" : ` Left out: ${file.skipped.map((s) => `${s.name} (${s.why})`).join("; ")}.`;
    void tellOnPage(
      `Saved ${file.fileName}: ${file.count} ${file.count === 1 ? "payment" : "payments"}, ${booksMoney(file.total)}.` +
        `${left} Upload it in your bank's business internet banking and approve it there. ` +
        "When the payment shows in the bank feed, match it on Reconcile as usual.",
    );
  });

  box.append(heading, fields, table, missingNote, totalLine, said, actions);
  document.body.append(box);
  box.showModal();
  go.focus();
}
