import { test } from "node:test";
import assert from "node:assert/strict";
import { accountTreatment, isMyobAccounts, isMyobJournal, parseMyobAccounts, parseMyobBooks, parseMyobJournal } from "../dist/index.js";

// As MYOB writes them: tab separated, the bracket row first, the field names next.
const tab = (rows) => rows.map((r) => r.join("\t")).join("\r\n") + "\r\n";

const ACCOUNTS = tab([
  ["{}"],
  ["Account Number", "Account Name", "Header", "Account Type", "Tax Code", "Inactive Account"],
  ["1-0000", "Assets", "H", "Asset", "", "N"],
  ["1-1110", "Business Cheque Account", "", "Bank", "N-T", "N"],
  ["1-1310", "Trade Debtors", "", "Accounts receivable", "N-T", "N"],
  ["2-1210", "GST Collected", "", "Other current liability", "N-T", "N"],
  ["2-1110", "Business Visa", "", "Credit card", "N-T", "N"],
  ["3-1100", "Owner's Capital", "", "Equity", "N-T", "N"],
  ["4-1000", "Sales", "", "Income", "S15", "N"],
  ["4-2000", "Export Sales", "", "Income", "Z", "N"],
  ["6-1300", "Bank Fees", "", "Expense", "E", "N"],
  ["6-1500", "Office Supplies", "", "Expense", "S15", "N"],
  ["6-1600", "Imported Parts", "", "Cost of sales", "IMP", "N"],
]);

const JOURNAL = tab([
  ["{}"],
  ["Journal Number", "Date", "Memo", "Account Number", "Debit Amount", "Credit Amount", "Job"],
  ["GJ000001", "01/04/2026", "Owner puts money in", "1-1110", "$5,000.00", "", ""],
  ["GJ000001", "01/04/2026", "Owner puts money in", "3-1100", "", "$5,000.00", ""],
  [""],
  ["CD000002", "15/04/2026", "Officemax", "6-1500", "100.00", "", ""],
  ["CD000002", "15/04/2026", "Officemax", "2-1210", "15.00", "", ""],
  ["CD000002", "15/04/2026", "Officemax", "1-1110", "", "115.00", ""],
  [""],
  ["CD000003", "15/04/2026", "Officemax", "6-1500", "100.00", "", ""],
  ["CD000003", "15/04/2026", "Officemax", "2-1210", "15.00", "", ""],
  ["CD000003", "15/04/2026", "Officemax", "1-1110", "", "115.00", ""],
  [""],
  ["GJ000004", "30/04/2026", "Accrue sales", "1-1310", "230.00", "", ""],
  ["GJ000004", "30/04/2026", "Accrue sales", "4-1000", "", "200.00", ""],
  ["GJ000004", "30/04/2026", "Accrue sales", "2-1210", "", "30.00", ""],
  [""],
  ["GJ000005", "31/04/2026", "Bad date", "6-1300", "1.00", "", ""],
  ["GJ000005", "31/04/2026", "Bad date", "1-1110", "", "1.00", ""],
  [""],
  ["GJ000006", "30/04/2026", "Lost a line", "6-1300", "5.00", "", ""],
]);

test("MYOB's files are known for what they are", () => {
  assert.equal(isMyobAccounts(ACCOUNTS), true);
  assert.equal(isMyobJournal(ACCOUNTS), false);
  assert.equal(isMyobJournal(JOURNAL), true);
  assert.equal(isMyobAccounts(JOURNAL), false);
  // Without the bracket row, or comma separated, still MYOB's.
  assert.equal(isMyobJournal(JOURNAL.replace(/^\{\}\r\n/, "").replace(/\t/g, ",")), true);
  assert.equal(isMyobAccounts("*Code,*Name,*Type\r\n200,Sales,Revenue\r\n"), false);
});

test("the accounts list: types as MYOB says, header accounts left out, tax codes in words the GST reads", () => {
  const { chart, problems } = parseMyobAccounts(ACCOUNTS);
  assert.deepEqual(problems, []);
  const by = Object.fromEntries(chart.accounts.map((a) => [a.name, a]));
  assert.equal(by.Assets, undefined, "a header holds nothing");
  assert.equal(by["Business Cheque Account"].type, "Bank");
  assert.equal(by["Business Cheque Account"].code, "", "a bank account goes by its own id, its MYOB number kept");
  assert.match(by["Business Cheque Account"].description, /MYOB 1-1110/);
  assert.deepEqual(chart.bankNames, ["Business Cheque Account", "Business Visa"]);
  assert.deepEqual(chart.cardNames, ["Business Visa"]);
  assert.equal(by["Trade Debtors"].type, "Accounts Receivable");
  assert.equal(by.Sales.type, "Revenue");
  assert.equal(by.Sales.code, "4-1000");
  assert.deepEqual(accountTreatment(by.Sales), { treatment: "standard", side: "sales" });
  assert.deepEqual(accountTreatment(by["Office Supplies"]), { treatment: "standard", side: "purchases" });
  assert.deepEqual(accountTreatment(by["Export Sales"]), { treatment: "zero-rated" });
  assert.deepEqual(accountTreatment(by["Bank Fees"]), { treatment: "exempt", side: "none" });
  assert.deepEqual(accountTreatment(by["Imported Parts"]), { treatment: "standard", side: "imports" });
});

test("journal entries end at the blank line; two alike stay two; one that does not balance is said", () => {
  const { chart } = parseMyobAccounts(ACCOUNTS);
  const read = parseMyobJournal(JOURNAL, chart, { currency: "NZD", dayFirst: true });
  assert.deepEqual(read.entries.map((e) => [e.num, e.date, e.legs.length]), [
    ["GJ000001", "2026-04-01", 2],
    ["CD000002", "2026-04-15", 2],
    ["CD000003", "2026-04-15", 2],
    ["GJ000004", "2026-04-30", 3],
  ]);
  assert.deepEqual(read.entries[0].legs, [{ account: "Business Cheque Account", debit: 500_000 }, { account: "Owner's Capital", debit: -500_000 }]);
  // Paid from the bank: the GST line is back in the cost, so the line is coded at 115.
  assert.deepEqual(read.entries[1].legs, [{ account: "Office Supplies", debit: 11_500 }, { account: "Business Cheque Account", debit: -11_500 }]);
  // No bank account in it: a journal keeps its GST line as MYOB had it.
  assert.ok(read.entries[3].legs.some((l) => l.account === "GST Collected" && l.debit === -3_000));
  assert.ok(read.problems.some((p) => /Unreadable date/.test(p.message)));
  assert.ok(read.problems.some((p) => /GJ000006 Lost a line does not balance/.test(p.message)));
});

test("as books: bank legs are bank lines, the rest journals, every posting kept", () => {
  const { chart } = parseMyobAccounts(ACCOUNTS);
  const books = parseMyobBooks(JOURNAL, chart, { currency: "NZD", dayFirst: true, file: "journal.txt" });
  assert.deepEqual(books.transactions.map((t) => [t.date, t.amount]).sort(), [
    ["2026-04-01", 500_000],
    ["2026-04-15", -11_500],
    ["2026-04-15", -11_500],
  ]);
  assert.ok(books.transactions.every((t) => t.source.importer === "myob-journal"));
  // The accrual touches no bank account: a journal.
  assert.equal(books.journals.length, 1);
  assert.equal(books.journals[0].lines.reduce((s, l) => s + l.amount, 0), 0);
});

test("a number the accounts list does not have is an account of its own", () => {
  const read = parseMyobJournal(tab([["Journal Number", "Date", "Memo", "Account Number", "Debit Amount", "Credit Amount"], ["1", "2/5/2026", "x", "6-9999", "10", ""], ["1", "2/5/2026", "x", "1-1110", "", "10"]]), null, { dayFirst: true });
  assert.deepEqual(read.entries[0].legs.map((l) => l.account), ["MYOB account 6-9999", "MYOB account 1-1110"]);
  assert.equal(read.chart.accounts.find((a) => a.name === "MYOB account 6-9999").type, "Overhead");
});

test("the drop zone knows them", async () => {
  const { identifyExport } = await import("../dist/index.js");
  assert.equal(identifyExport(ACCOUNTS).kind, "myob-accounts");
  assert.equal(identifyExport(JOURNAL).kind, "myob-journal");
});

test("MYOB's account numbers read back out of a coding label", async () => {
  const { splitAccountLabel } = await import("../dist/index.js");
  assert.deepEqual(splitAccountLabel("Sales - 4-1000"), { code: "4-1000", name: "Sales" });
  assert.deepEqual(splitAccountLabel("Sales - 200"), { code: "200", name: "Sales" });
  assert.deepEqual(splitAccountLabel("Rates - 420MS"), { code: "420MS", name: "Rates" });
});

test("GST spread over several costs in proportion, to the cent", () => {
  const text = tab([
    ["Journal Number", "Date", "Memo", "Account Number", "Debit Amount", "Credit Amount"],
    ["1", "1/5/2026", "Hardware", "6-1500", "60.00", ""],
    ["1", "1/5/2026", "Hardware", "6-1300", "40.01", ""],
    ["1", "1/5/2026", "Hardware", "2-1210", "15.00", ""],
    ["1", "1/5/2026", "Hardware", "1-1110", "", "115.01"],
  ]);
  const { chart } = parseMyobAccounts(ACCOUNTS);
  const [entry] = parseMyobJournal(text, chart, { dayFirst: true }).entries;
  assert.deepEqual(entry.legs.map((l) => [l.account, l.debit]), [["Office Supplies", 6_900], ["Bank Fees", 4_601], ["Business Cheque Account", -11_501]]);
});
