import assert from "node:assert/strict";
import test from "node:test";
import { abaFile, bankName, bankText, nzAccount, nzBankOf, nzHashTotal, nzPaymentFile } from "../dist/index.js";

// Made by the open-source nz-bank-batch library (MIT) from the same payments,
// as an independent check on each bank's layout, byte for byte.
const EXPECTED = {
  "anz": "1,,,,,,20260323,20260320,\r\n2,1232000123456000,50,125050,JANE SMITH,SALARY,,MARCH,PAY,ACME PAYROLL LTD,,SALARY,PAY\r\n2,0200010000002025,50,99,BOB JONES,WK12,,WK,WAGES,ACME PAYROLL LTD,,WK12,WAGES\r\n3,125149,2,32010123458\r\n",
  "anz-wages": "1,,,,,,20260323,20260320,\r\n2,1232000123456000,52,125050,JANE SMITH,SALARY,,MARCH,PAY,ACME PAYROLL LTD,,SALARY,PAY\r\n2,0200010000002025,52,99,BOB JONES,WK12,,WK,WAGES,ACME PAYROLL LTD,,WK12,WAGES\r\n3,125149,2,32010123458\r\n",
  "asb": "12123200045678900 20260323     Acme Payroll Ltd                                                                                                                 \r\n13123200012345600 0510000125050Jane Smith                      MARCH       SALARY      PAY          Acme Payroll Ltd    MARCH       SALARY      PAY             \r\n13020001000000225 0510000000099Bob Jones                       WK          WK12        WAGES        Acme Payroll Ltd    WK          WK12        WAGES           \r\n139932010123458      0000125149                                                                                                                                 \r\n",
  "asb-wages": "12123200045678900 20260323     Acme Payroll Ltd                                                                                                                 \r\n13123200012345600 0520000125050Jane Smith                      MARCH       SALARY      PAY          Acme Payroll Ltd    MARCH       SALARY      PAY             \r\n13020001000000225 0520000000099Bob Jones                       WK          WK12        WAGES        Acme Payroll Ltd    WK          WK12        WAGES           \r\n139932010123458      0000125149                                                                                                                                 \r\n",
  "bnz": "1,,,,020001000000100,7,260323,260323,MARCH2026\r\n2,123200012345600,50,125050,Jane Smith,PAY,SALARY,,,Acme Payroll Ltd,MARCH,SALARY,PAY\r\n2,020001000000225,50,99,Bob Jones,WAGES,WK12,,,Acme Payroll Ltd,WK,WK12,WAGES\r\n3,125149,2,20100123458\r\n",
  "bnz-wages": "1,,,,020001000000100,7,260323,260323,MARCH2026\r\n2,123200012345600,50,125050,Jane Smith,PAY,SALARY,,,Acme Payroll Ltd,MARCH,SALARY,PAY\r\n2,020001000000225,50,99,Bob Jones,WAGES,WK12,,,Acme Payroll Ltd,WK,WK12,WAGES\r\n3,125149,2,20100123458\r\n",
  "kiwibank": "1,,,,389000000000100,7,260323,260323,MARCH2026\r\n2,123200012345600,50,125050,Jane Smith,PAY,SALARY,,,Acme Payroll Ltd,MARCH,SALARY,PAY\r\n2,020001000000225,50,99,Bob Jones,WAGES,WK12,,,Acme Payroll Ltd,WK,WK12,WAGES\r\n3,125149,2,20100123458\r\n",
  "kiwibank-wages": "1,,,,389000000000100,7,260323,260323,MARCH2026\r\n2,123200012345600,50,125050,Jane Smith,PAY,SALARY,,,Acme Payroll Ltd,MARCH,SALARY,PAY\r\n2,020001000000225,50,99,Bob Jones,WAGES,WK12,,,Acme Payroll Ltd,WK,WK12,WAGES\r\n3,125149,2,20100123458\r\n",
  "westpac": "A,000001,03,0123,ACME PAYROLL LTD,,MARCH2026,230326,\r\nD,000002,12,3200,00123456,0000,50,DC,125050,Jane Smith,PAY,MARCH,SALARY,03,0123,00456789,0000,ACME PAYROLL LTD,\r\nD,000003,02,0001,00000002,0025,50,DC,99,Bob Jones,WAGES,WK,WK12,03,0123,00456789,0000,ACME PAYROLL LTD,\r\n",
  "westpac-wages": "A,000001,03,0123,ACME PAYROLL LTD,,MARCH2026,230326,\r\nD,000002,12,3200,00123456,0000,52,DC,125050,Jane Smith,PAY,MARCH,SALARY,03,0123,00456789,0000,ACME PAYROLL LTD,\r\nD,000003,02,0001,00000002,0025,52,DC,99,Bob Jones,WAGES,WK,WK12,03,0123,00456789,0000,ACME PAYROLL LTD,\r\n"
};

const SOURCES = { anz: "01-0123-0456789-00", asb: "12-3200-0456789-00", bnz: "02-0001-0000001-00", kiwibank: "38-9000-0000001-00", westpac: "03-0123-0456789-00" };
const PAYMENTS = [
  { name: "Jane Smith", account: "12-3200-0123456-00", amount: 125050, particulars: "PAY", code: "MARCH", reference: "SALARY" },
  { name: "Bob Jones", account: "02-0001-0000002-025", amount: 99, particulars: "WAGES", code: "WK", reference: "WK12" },
];

for (const bank of Object.keys(SOURCES)) {
  for (const wages of [false, true]) {
    test(`${bank}${wages ? ", as wages" : ""}: the file is the bank's layout exactly`, () => {
      const file = nzPaymentFile(PAYMENTS, {
        bank, fromAccount: SOURCES[bank], payerName: "Acme Payroll Ltd", date: "2026-03-23", created: "2026-03-20", wages, batchReference: "MARCH2026",
      });
      assert.deepEqual(file.problems, []);
      assert.equal(file.text, EXPECTED[`${bank}${wages ? "-wages" : ""}`]);
      assert.equal(file.total, 125_149);
      assert.equal(file.count, 2);
    });
  }
}

test("the bank comes from the account paid from", () => {
  assert.equal(nzBankOf("01-0123-0456789-00"), "anz");
  assert.equal(nzBankOf("06 0501 0123456 00"), "anz");
  assert.equal(nzBankOf("12-3200-0456789-00"), "asb");
  assert.equal(nzBankOf("020001000000100"), "bnz");
  assert.equal(nzBankOf("38-9000-0000001-00"), "kiwibank");
  assert.equal(nzBankOf("03-0123-0456789-00"), "westpac");
  assert.equal(nzBankOf("15-3900-0123456-00"), null);
  assert.equal(nzBankOf("not an account"), null);
});

test("account numbers are read the ways people write them", () => {
  assert.deepEqual(nzAccount("12-3200-0123456-00"), { bank: "12", branch: "3200", base: "0123456", suffix: "00" });
  assert.deepEqual(nzAccount("02 0001 00000002 0025"), { bank: "02", branch: "0001", base: "0000002", suffix: "25" });
  assert.deepEqual(nzAccount("0200010000002025"), { bank: "02", branch: "0001", base: "0000002", suffix: "25" });
  assert.equal(nzAccount("12-3200-123"), null);
});

test("the hash total keeps eleven digits", () => {
  const big = Array.from({ length: 40 }, () => nzAccount("12-9999-9999999-00"));
  assert.equal(nzHashTotal(big).length, 11);
  assert.equal(nzHashTotal([nzAccount("12-3200-0123456-00")]), "32000123456");
  assert.equal(nzHashTotal([nzAccount("12-3200-0123456-00")], 8), "20000123456");
});

test("problems are listed, all at once, and no file is made", () => {
  const file = nzPaymentFile(
    [{ name: "", account: "nope", amount: 0 }, { name: "Ana", account: "12-3200-0123456-00", amount: -5 }],
    { bank: "bnz", fromAccount: "12-3200-0456789-00", payerName: "", date: "" },
  );
  assert.equal(file.text, "");
  assert.ok(file.problems.some((p) => /not a BNZ account/.test(p)));
  assert.ok(file.problems.some((p) => /name the payments come from/.test(p)));
  assert.ok(file.problems.some((p) => /date/.test(p)));
  assert.ok(file.problems.some((p) => /payee's name/.test(p)));
  assert.ok(file.problems.some((p) => /"nope" is not a New Zealand account number/.test(p)));
  assert.ok(file.problems.some((p) => /Ana: the amount/.test(p)));
  assert.deepEqual(nzPaymentFile([], { bank: "bnz", fromAccount: SOURCES.bnz, payerName: "Co", date: "2026-03-23" }).problems, ["There is nothing to pay."]);
});

test("text goes as plain ASCII with no commas, cut to the field", () => {
  assert.equal(bankText("Māpua Bakehouse, Ltd", 20), "Mapua Bakehouse Ltd");
  assert.equal(bankText("  Ōtaki   Tūī  ", 12, true), "OTAKI TUI");
  assert.equal(bankText("A very long name indeed for a bank", 20), "A very long name ind");
  assert.equal(bankText('say "hi"', 20), "say hi");
  assert.equal(bankName("Māpua Bakehouse Limited", 20), "Mapua Bakehouse Ltd");
});

const ABA_ITEMS = [
  { name: "Alex Tran", bsb: "062-000", account: "12345678", amount: 241_600, reference: "PAY 31 JUL" },
  { name: "Sam Okafor", bsb: "084004", account: "987654321", amount: 239_200, reference: "PAY 31 JUL" },
];
const ABA_OPTIONS = { bankCode: "cba", userName: "Wattle & Lens Photography", userId: "301500", fromBsb: "062-111", fromAccount: "11112222", remitter: "Wattle Lens", description: "PAYROLL", date: "2026-07-31", wages: true };

test("an ABA file: 120-character records, the payments and the file total", () => {
  const file = abaFile(ABA_ITEMS, ABA_OPTIONS);
  assert.deepEqual(file.problems, []);
  const lines = file.text.split("\r\n");
  assert.equal(lines.pop(), "");
  assert.ok(lines.every((l) => l.length === 120));
  assert.equal(lines[0], "0                 01CBA       Wattle & Lens Photography 301500PAYROLL     310726" + " ".repeat(40));
  assert.equal(lines[1], "1062-000 12345678 530000241600Alex Tran                       PAY 31 JUL        062-111 11112222Wattle Lens     00000000");
  assert.equal(lines[2], "1084-004987654321 530000239200Sam Okafor                      PAY 31 JUL        062-111 11112222Wattle Lens     00000000");
  assert.equal(lines[3], "7999-999            000048080000004808000000000000" + " ".repeat(24) + "000002" + " ".repeat(40));
});

test("an ABA file balanced by a debit from the account paid from", () => {
  const lines = abaFile(ABA_ITEMS, { ...ABA_OPTIONS, balance: true }).text.split("\r\n");
  assert.equal(lines[3], "1062-111 11112222 130000480800Wattle & Lens Photography       PAYROLL           062-111 11112222Wattle Lens     00000000");
  assert.equal(lines[4], "7999-999            000000000000004808000000480800" + " ".repeat(24) + "000003" + " ".repeat(40));
});

test("an ABA file says what it needs instead of guessing", () => {
  const file = abaFile([{ name: "Kim", bsb: "12", account: "x", amount: 100 }], { ...ABA_OPTIONS, bankCode: "C", userId: "12", fromBsb: "" });
  assert.equal(file.text, "");
  assert.ok(file.problems.some((p) => /three-letter/.test(p)));
  assert.ok(file.problems.some((p) => /user ID/.test(p)));
  assert.ok(file.problems.some((p) => /BSB and account number to pay from/.test(p)));
  assert.ok(file.problems.some((p) => /Kim: "x" is not a BSB and account number/.test(p)));
});
