import type { BalanceSheet, BalanceSheetSection } from "./balance-sheet.js";
import type { TrialBalance } from "./posting.js";

/**
 * The balance sheet and the trial balance as CSV, for the accountant: one row
 * per account, amounts as plain numbers with two places, debits positive.
 */

function cell(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const money = (cents: number): string => (cents / 100).toFixed(2);

function lines(rows: readonly (readonly string[])[]): string {
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

export function balanceSheetCsv(sheet: BalanceSheet, title = "Balance sheet"): string {
  const rows: string[][] = [[`${title} as at ${sheet.asAt}`], [], ["Section", "Code", "Account", "Opening", "Movement", "Closing"]];
  const section = (s: BalanceSheetSection): void => {
    for (const l of s.lines) rows.push([s.title, l.code, l.name, money(l.opening), money(l.movement), money(l.closing)]);
    rows.push([s.title, "", `Total ${s.title.toLowerCase()}`, "", "", money(s.total)]);
  };
  section(sheet.currentAssets);
  section(sheet.nonCurrentAssets);
  rows.push(["", "", "Total assets", "", "", money(sheet.totalAssets)]);
  section(sheet.currentLiabilities);
  section(sheet.nonCurrentLiabilities);
  rows.push(["", "", "Total liabilities", "", "", money(sheet.totalLiabilities)]);
  rows.push(["", "", "Net assets", "", "", money(sheet.netAssets)]);
  section(sheet.equity);
  rows.push(["", "", "Total equity", "", "", money(sheet.totalEquity)]);
  if (sheet.imbalance !== 0) rows.push(["", "", "Out of balance by", "", "", money(sheet.imbalance)]);
  return lines(rows);
}

export function trialBalanceCsv(balance: TrialBalance, title: string): string {
  const rows: string[][] = [[title], [], ["Code", "Account", "Debit", "Credit"]];
  let debits = 0;
  let credits = 0;
  for (const r of balance.rows) {
    if (r.balance === 0) continue;
    rows.push([r.accountCode, r.accountName, r.balance > 0 ? money(r.balance) : "", r.balance < 0 ? money(-r.balance) : ""]);
    if (r.balance > 0) debits += r.balance;
    else credits -= r.balance;
  }
  rows.push(["", "Total", money(debits), money(credits)]);
  if (balance.imbalance !== 0) rows.push(["", "Out of balance by", money(balance.imbalance), ""]);
  return lines(rows);
}
