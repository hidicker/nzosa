import assert from "node:assert/strict";
import test from "node:test";
import { parseXeroAccountTransactions } from "../dist/index.js";

/**
 * The same report comes out of Xero two ways.
 *
 * Run for one account it is sectioned: a row holding only the account name,
 * then that account's rows. Run across the ledger it is flat, and every row
 * names its own account in a column.
 */
const SECTIONED = [
  "Account Transactions",
  "Example Holdings Limited",
  "",
  "Date,Source,Contact,Description,Reference,Debit,Credit,Related account",
  "Business Bank Account,,,,,,,",
  "15/04/2024,Spend Money,Ozone Supplies,Toner,INV-101,,120.75,Office Expenses",
  "16/04/2024,Receive Money,A Customer,Deposit,,4000.00,,Sales",
  "Office Expenses,,,,,,,",
  "15/04/2024,Spend Money,Ozone Supplies,Toner,INV-101,120.75,,Business Bank Account",
].join("\r\n");

const FLAT = [
  "Account Transactions",
  "Example Holdings Limited",
  "",
  "Date,Source,Contact,Description,Reference,Debit,Credit,Account Code,Account,Account Type,Related account",
  "15/04/2024,Spend Money,Ozone Supplies,Toner,INV-101,,120.75,090,Business Bank Account,Asset,Office Expenses",
  "16/04/2024,Receive Money,A Customer,Deposit,,4000.00,,090,Business Bank Account,Asset,Sales",
  "15/04/2024,Spend Money,Ozone Supplies,Toner,INV-101,120.75,,429,Office Expenses,Expense,Business Bank Account",
  "20/04/2024,Spend Money,The Bank,Monthly fee,,5.00,,404,Bank Fees,Expense,Business Bank Account",
].join("\r\n");

test("the sectioned layout reads the bank section and skips the rest", () => {
  const { entries, problems } = parseXeroAccountTransactions(SECTIONED);
  assert.deepEqual(problems, []);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].date, "2024-04-15");
  assert.equal(entries[0].amount, -12075);
  assert.equal(entries[0].account, "Business Bank Account");
  assert.equal(entries[1].amount, 400000);
});

test("the flat layout reads the account from the row", () => {
  const { entries, problems } = parseXeroAccountTransactions(FLAT);
  assert.deepEqual(problems, []);
  // Only the two bank rows: the expense side of the same posting is the other
  // half of a row already counted, and would double every figure.
  assert.equal(entries.length, 2);
  assert.equal(entries[0].account, "Business Bank Account");
  assert.equal(entries[0].amount, -12075);
  assert.equal(entries[1].amount, 400000);
});

test('"Bank Fees" is an expense, not a bank account', () => {
  // It is named like one, and the name is all the sectioned layout has to go
  // on. The flat layout also says what class the account is, which settles it.
  const { entries } = parseXeroAccountTransactions(FLAT);
  assert.equal(entries.some((e) => e.account === "Bank Fees"), false);
});

test("a file that is not this report says so", () => {
  const { entries, problems } = parseXeroAccountTransactions("Name,Amount\r\nA,1\r\n");
  assert.equal(entries.length, 0);
  assert.match(problems[0].message, /required columns missing/);
});
