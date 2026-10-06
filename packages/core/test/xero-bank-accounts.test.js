import assert from "node:assert/strict";
import test from "node:test";
import {
  feedAccountForNumber,
  identifyExport,
  isXeroBankAccountList,
  parseXeroBankAccountList,
} from "../dist/index.js";

// Invented accounts, in the shape Xero exports its uncoded statement lines.
const LIST = [
  "PayPal",
  "ABC123XYZ",
  "Date,Payee,Particulars | Reference | Code,Spent,Received,Tax,Your Comments",
  "",
  "",
  "Kowhai Visa - Business Card ",
  "1234",
  "Date,Payee,Particulars | Reference | Code,Spent,Received,Tax,Your Comments",
  "12 Sep 2026,Cafe,,4.50,,,",
  "",
  "Kowhai Trading Account",
  "0212340056789001",
  "Date,Payee,Particulars | Reference | Code,Spent,Received,Tax,Your Comments",
  "",
].join("\n");

test("the uncoded statement lines export is recognised, and not as a bank statement", () => {
  assert.equal(isXeroBankAccountList(LIST), true);
  assert.equal(identifyExport(LIST).kind, "bank-accounts");
});

test("each account's name and number are read, uncoded lines or not", () => {
  assert.deepEqual(parseXeroBankAccountList(LIST), [
    { name: "PayPal", number: "ABC123XYZ" },
    { name: "Kowhai Visa - Business Card", number: "1234" },
    { name: "Kowhai Trading Account", number: "0212340056789001" },
  ]);
});

test("numbers find their feed accounts: whole numbers whole, a card's last four, an id within", () => {
  const feed = [
    { id: "02-1234-0056789-001", label: "Kowhai Trading" },
    { id: "kowhai-coffee-lt-1234", label: "Kowhai Coffee Lt" },
    { id: "acc_abc123xyz", label: "PayPal" },
  ];
  assert.equal(feedAccountForNumber("0212340056789001", feed), "02-1234-0056789-001");
  assert.equal(feedAccountForNumber("1234", feed), "kowhai-coffee-lt-1234");
  assert.equal(feedAccountForNumber("ABC123XYZ", feed), "acc_abc123xyz");
  assert.equal(feedAccountForNumber("9999", feed), null);
});

test("two cards ending the same are left for a person", () => {
  const feed = [
    { id: "card-a-1234", label: "A" },
    { id: "card-b-1234", label: "B" },
  ];
  assert.equal(feedAccountForNumber("1234", feed), null);
});
