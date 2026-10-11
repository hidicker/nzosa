/**
 * A prompt for any AI to turn a bank export into one NZOSA reads.
 *
 * Banks write their exports a dozen ways -- separate debit and credit columns,
 * a running balance, a heading above the table, an Excel file rather than a
 * CSV -- and NZOSA reads a handful of them. Rather than an importer for each,
 * this asks an AI the person already uses to rewrite the file in the layout
 * NZOSA's BNZ account reader takes, which carries every field a bank line
 * has. The rules are the ones that keep the money right: nothing added,
 * dropped or merged, money in positive, and a total at the end to check
 * against the bank.
 */

import { note } from "../ui.js";

/** The header row NZOSA's BNZ account reader takes, in order. */
export const BANK_COLUMNS = [
  "Date",
  "Amount",
  "Payee",
  "Particulars",
  "Code",
  "Reference",
  "Tran Type",
  "This Party Account",
  "Other Party Account",
  "Serial",
  "Transaction Code",
  "Batch Number",
  "Originating Bank/Branch",
  "Processed Date",
];

export function bankConvertPrompt(): string {
  return [
    "Please convert the bank export I attach into a CSV file that NZOSA, a New Zealand accounting app, can import.",
    "",
    "Write one CSV file for each bank account in it, with exactly this header row:",
    BANK_COLUMNS.join(","),
    "",
    "Rules:",
    "- One row per transaction, in the file's own order. Do not add, drop, merge or total rows. Leave out opening balance, closing balance and total rows.",
    "- Date and Processed Date as DD/MM/YYYY. Processed Date is the same as Date unless the file gives a separate one.",
    "- Amount: money in positive, money out negative, as a plain number with two decimals: no currency sign, no thousands separator. Where the file has separate columns (debit and credit, withdrawal and deposit), combine them, taking care which one is money in.",
    "- Payee: who the money went to or came from. Particulars, Code and Reference: the bank's own fields where the file has them; otherwise the description goes in Particulars.",
    "- Tran Type: the bank's transaction type where the file gives one (DC, DD, AP, EFTPOS and so on); otherwise leave it empty.",
    "- This Party Account: the account's number, written 00-0000-0000000-000, where the file shows it; for a card, its last four digits; otherwise a short name for the account (business-visa, say). The same on every row of the file.",
    "- Other Party Account, Serial, Transaction Code, Batch Number and Originating Bank/Branch: from the file where it has them, otherwise empty.",
    "- Put double quotes around any field that contains a comma. Change nothing but the layout: no amounts or dates altered, and nothing guessed where the file says nothing.",
    "- From Xero's Account Transactions report: use only the bank account's rows. Contact is the Payee, Description the Particulars, Reference the Reference, Source the Tran Type, and Debit less Credit the Amount (in Xero's report for a bank account, debit is money in).",
    "",
    "Then tell me, for each file: how many rows you wrote, the first and last date, and the total of the Amount column, so I can check it against the bank.",
  ].join("\n");
}

/** Folded under Import bank files: the prompt, and a button to copy it. */
export function bankConvertPanel(): HTMLElement {
  const fold = document.createElement("details");
  fold.className = "bank-convert";
  const summary = document.createElement("summary");
  summary.textContent = "Another bank's layout, or a spreadsheet? Copy a prompt for an AI to convert it";
  fold.append(summary);
  fold.append(
    note(
      "Give the prompt and your bank's file to any AI you use (ChatGPT, Claude, Gemini). It writes the file " +
        "in the layout NZOSA reads; drop that here. Check its total against your bank before you rely on it. " +
        "Your bank file goes to that AI's company, under its terms.",
    ),
  );
  const text = document.createElement("textarea");
  text.className = "bank-convert-text";
  text.readOnly = true;
  text.rows = 10;
  text.value = bankConvertPrompt();
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "small";
  copy.textContent = "Copy the prompt";
  const said = document.createElement("span");
  said.className = "feed-said";
  copy.addEventListener("click", () => {
    void navigator.clipboard.writeText(text.value).then(
      () => {
        said.textContent = " Copied.";
      },
      () => {
        text.select();
        said.textContent = " Could not copy; select the text above and copy it by hand.";
      },
    );
  });
  fold.append(text, copy, said);
  return fold;
}
