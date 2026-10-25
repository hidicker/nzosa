import { test } from "node:test";
import assert from "node:assert/strict";
import { abaFile, auAccountParts, bankText, nzAccountParts, nzHashTotal, nzPaymentFile } from "../dist/index.js";

const lines = (text) => {
  assert.ok(text.endsWith("\r\n"), "every record ends CR LF");
  return text.slice(0, -2).split("\r\n");
};

const pays = [
  { name: "Mere Tane", account: "12-3456-0123456-00", amount: 78_554, particulars: "Wages", reference: "2026-09-20", ourParticulars: "Mere Tane" },
  { name: "Kea Supplies, Ltd", account: "0201000123456025", amount: 1_688, reference: "INV-100364C", ourReference: "BILL-7" },
];

test("NZ account numbers in any usual form", () => {
  assert.deepEqual(nzAccountParts("12-3456-0123456-00"), { bank: "12", branch: "3456", base: "0123456", suffix: "000" });
  assert.deepEqual(nzAccountParts("020100012345625"), { bank: "02", branch: "0100", base: "0123456", suffix: "025" });
  assert.deepEqual(nzAccountParts("0201000123456025"), nzAccountParts("020100012345625"), "BNZ: 25 and 025 are one suffix");
  assert.deepEqual(nzAccountParts("01 0123 00456789 0001"), { bank: "01", branch: "0123", base: "0456789", suffix: "001" });
  assert.equal(nzAccountParts("062-000 12345678"), null);
  assert.equal(nzAccountParts("12-3456-012345-ab"), null);
  assert.equal(nzAccountParts(""), null);
});

test("the hash total, as BNZ and ANZ work it", () => {
  // BNZ's second worked example: the sum passes eleven digits and drops its left.
  assert.equal(nzHashTotal(["02-1745-0124580-000", "02-8284-0066289-000"]), "00290190869");
  // ANZ: branch 0123 and base 0456789 make 1,230,456,789.
  assert.equal(nzHashTotal(["01-0123-0456789-00"]), "01230456789");
});

test("text a bank takes: no commas, no accents, cut to fit, no trailing space", () => {
  assert.equal(bankText("Kea Supplies, Ltd", 20), "Kea Supplies Ltd");
  assert.equal(bankText("Māori Wardens Café", 20), "Maori Wardens Cafe");
  assert.equal(bankText("A very long name that will not fit", 12), "A very long");
  assert.equal(bankText(undefined, 12), "");
});

test("BNZ: header, a transaction a payment, control with total, count and hash", () => {
  const file = nzPaymentFile({ format: "bnz", from: "02-0100-0123456-000", payer: "Kea Coffee Limited", due: "2026-10-27", created: "2026-10-25", payments: pays, name: "bills 2026-10-27" });
  const [header, one, two, control, ...rest] = lines(file.text);
  assert.equal(rest.length, 0);
  assert.equal(header, "1,,,,0201000123456000,7,261027,261025,I");
  assert.equal(one, "2,1234560123456000,50,78554,Mere Tane,2026-09-20,,,Wages,Kea Coffee Limited,,,Mere Tane");
  assert.equal(two, "2,0201000123456025,50,1688,Kea Supplies Ltd,INV-100364C,,,,Kea Coffee Limited,,BILL-7,");
  assert.equal(control, `3,80242,2,${nzHashTotal(pays.map((p) => p.account))}`);
  assert.equal(file.total, 80_242);
  assert.equal(file.fileName, "bills 2026-10-27.txt");
  for (const line of lines(file.text)) assert.equal(line, line.trimEnd(), "no trailing spaces");
});

test("BNZ wages: code 52 and one line on the payer's statement", () => {
  const file = nzPaymentFile({ format: "bnz", from: "02-0100-0123456-000", payer: "Kea", due: "2026-10-27", created: "2026-10-25", payments: pays, payroll: true });
  const [header, one] = lines(file.text);
  assert.ok(header.endsWith(",261025,"), "bulk listing: indicator blank");
  assert.equal(one.split(",")[2], "52");
});

test("ANZ: eight-digit dates, otherwise the same records", () => {
  const file = nzPaymentFile({ format: "anz", from: "01-0123-0456789-00", payer: "Kea", due: "2026-10-27", created: "2026-10-25", payments: pays });
  const all = lines(file.text);
  assert.equal(all[0], "1,,,,,,20261027,20261025,");
  assert.equal(all[1].split(",").length, 13);
  assert.equal(all.at(-1), `3,80242,2,${nzHashTotal(pays.map((p) => p.account))}`);
});

test("Westpac: 180-character lines, a header and a detail each, nothing after", () => {
  const file = nzPaymentFile({ format: "westpac", from: "03-0123-0456789-00", payer: "Kea Coffee", due: "2026-10-27", created: "2026-10-25", payments: pays });
  const all = lines(file.text);
  assert.equal(all.length, 3);
  for (const line of all) assert.equal(line.length, 180);
  const [header, detail] = all;
  assert.equal(header.slice(0, 13), "A000001030123");
  assert.equal(header.slice(13, 43).trimEnd(), "Kea Coffee");
  assert.equal(header.slice(69, 75), "271026", "DDMMYY at 70-75");
  assert.equal(detail.slice(0, 7), "D000002");
  assert.equal(detail.slice(7, 25), "123456" + "00123456" + "0000", "bank, branch, 8-digit account, 4-digit suffix");
  assert.equal(detail.slice(25, 29), "50DC");
  assert.equal(detail.slice(29, 44), "000000000078554");
  assert.equal(detail.slice(44, 64).trimEnd(), "Mere Tane");
  assert.equal(detail.slice(64, 76).trimEnd(), "Wages");
  assert.equal(detail.slice(88, 100).trimEnd(), "2026-09-20");
  assert.equal(detail.slice(100, 118), "03" + "0123" + "00456789" + "0000");
  assert.equal(detail.slice(118, 138).trimEnd(), "Kea Coffee");
  assert.throws(() => nzPaymentFile({ format: "westpac", from: "02-0100-0123456-000", payer: "Kea", due: "2026-10-27", created: "2026-10-25", payments: pays }), /Westpac/);
});

test("payments that cannot go are left out, each with its reason, and the totals are of the rest", () => {
  const file = nzPaymentFile({
    format: "bnz",
    from: "02-0100-0123456-000",
    payer: "Kea",
    due: "2026-10-27",
    created: "2026-10-25",
    payments: [...pays, { name: "No Bank", account: "", amount: 500 }, { name: "Zero", account: "12-3456-0123456-00", amount: 0 }, { name: "Odd", account: "abc", amount: 100 }],
  });
  assert.equal(file.count, 2);
  assert.deepEqual(file.skipped.map((s) => s.name), ["No Bank", "Zero", "Odd"]);
  assert.match(file.skipped[0].why, /no NZ bank account/);
  assert.throws(() => nzPaymentFile({ format: "bnz", from: "nope", payer: "Kea", due: "2026-10-27", created: "2026-10-25", payments: pays }), /not a New Zealand bank account/);
});

const auPays = [
  { name: "Sam Lee", account: "062-000 12345678", amount: 248_800, reference: "Pay 14 Jul" },
  { name: "Wattle Supplies Pty", account: "033 002 987654", amount: 11_000, reference: "INV 55" },
];

test("Australian accounts: BSB and number", () => {
  assert.deepEqual(auAccountParts("062-000 12345678"), { bsb: "062-000", number: "12345678" });
  assert.deepEqual(auAccountParts("062000 12345678"), { bsb: "062-000", number: "12345678" });
  assert.deepEqual(auAccountParts("06200012345678"), { bsb: "062-000", number: "12345678" });
  assert.equal(auAccountParts("12-3456-0123456-00"), null);
});

test("ABA: 120-character records, header 0, details 1, total 7", () => {
  const file = abaFile({ from: "062-111 11112222", bank: "cba", userName: "Wattle Pty Ltd", userId: "301500", description: "PAYROLL", date: "2026-07-14", remitter: "Wattle Pty Ltd", payments: auPays, payroll: true });
  const all = lines(file.text);
  assert.equal(all.length, 4);
  for (const line of all) assert.equal(line.length, 120);
  const [header, first, , trailer] = all;
  assert.equal(header.slice(0, 1), "0");
  assert.equal(header.slice(18, 23), "01CBA");
  assert.equal(header.slice(30, 56).trimEnd(), "Wattle Pty Ltd");
  assert.equal(header.slice(56, 62), "301500");
  assert.equal(header.slice(62, 74).trimEnd(), "PAYROLL");
  assert.equal(header.slice(74, 80), "140726");
  assert.equal(first.slice(0, 8), "1062-000");
  assert.equal(first.slice(8, 17), " 12345678");
  assert.equal(first.slice(17, 20), " 53");
  assert.equal(first.slice(20, 30), "0000248800");
  assert.equal(first.slice(30, 62).trimEnd(), "Sam Lee");
  assert.equal(first.slice(62, 80).trimEnd(), "Pay 14 Jul");
  assert.equal(first.slice(80, 96), "062-111" + " 11112222");
  assert.equal(first.slice(96, 112).trimEnd(), "Wattle Pty Ltd");
  assert.equal(first.slice(112), "00000000");
  assert.equal(trailer.slice(0, 8), "7999-999");
  assert.equal(trailer.slice(20, 30), "0000259800");
  assert.equal(trailer.slice(30, 40), "0000259800");
  assert.equal(trailer.slice(40, 50), "0000000000");
  assert.equal(trailer.slice(74, 80), "000002");
});

test("ABA balanced: a debit to the paying account for the total, net nil", () => {
  const file = abaFile({ from: "062-111 11112222", bank: "WBC", userName: "Wattle", userId: "1", description: "CREDITORS", date: "2026-07-14", remitter: "Wattle", payments: auPays, balance: true });
  const all = lines(file.text);
  assert.equal(all.length, 5);
  const balancing = all[3];
  assert.equal(balancing.slice(1, 17), "062-111" + " 11112222");
  assert.equal(balancing.slice(18, 20), "13");
  assert.equal(balancing.slice(20, 30), "0000259800");
  const trailer = all[4];
  assert.equal(trailer.slice(20, 30), "0000000000");
  assert.equal(trailer.slice(40, 50), "0000259800");
  assert.equal(trailer.slice(74, 80), "000003");
  assert.equal(all[0].slice(56, 62), "000001", "user ID zero filled");
  assert.equal(file.fileName, "payments.aba");
});

test("ABA refuses what the bank would refuse", () => {
  const base = { from: "062-111 11112222", bank: "CBA", userName: "Wattle", userId: "301500", description: "X", date: "2026-07-14", remitter: "W", payments: auPays };
  assert.throws(() => abaFile({ ...base, from: "12-3456-0123456-00" }), /BSB/);
  assert.throws(() => abaFile({ ...base, bank: "Commonwealth" }), /three-letter/);
  assert.throws(() => abaFile({ ...base, userId: "ABC" }), /user ID/);
});
