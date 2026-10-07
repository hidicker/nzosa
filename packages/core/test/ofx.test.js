import test from "node:test";
import assert from "node:assert/strict";
import { importFile, isOfx } from "../dist/index.js";

// OFX 1.x: SGML, tags left open, as most US banks still send it. Invented.
const SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<CURDEF>USD
<BANKACCTFROM>
<BANKID>041000124
<ACCTID>99887766
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260301120000.000[-5:EST]
<TRNAMT>1850.00
<FITID>2026030101
<NAME>TENANT J OKAFOR
<MEMO>March rent
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260315
<TRNAMT>-612.50
<FITID>2026031502
<NAME>FIRST LAKES BANK
<CHECKNUM>1043
</STMTTRN>
</BANKTRANLIST>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>
`;

// OFX 2.x: XML, a credit card statement in Australian dollars. Invented.
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<?OFX OFXHEADER="200" VERSION="220"?>
<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS>
<CURDEF>AUD</CURDEF>
<CCACCTFROM><ACCTID>4111000011112222</ACCTID></CCACCTFROM>
<BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20250805</DTPOSTED><TRNAMT>-1,234.56</TRNAMT><FITID>A1</FITID><NAME>Roastery Wholesale</NAME></STMTTRN>
</BANKTRANLIST>
</CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`;

test("recognises OFX and QFX, and not a CSV", () => {
  assert.equal(isOfx(SGML), true);
  assert.equal(isOfx(XML), true);
  assert.equal(isOfx("Date,Amount,Payee\n01/03/2026,10.00,Shop\n"), false);
});

test("reads an OFX 1 (SGML) bank statement", () => {
  const result = importFile(SGML, { file: "checking.qfx" });
  assert.equal(result.importer, "ofx");
  assert.equal(result.transactions.length, 2);
  const [rent, mortgage] = result.transactions;
  assert.equal(rent.date, "2026-03-01");
  assert.equal(rent.amount, 185_000);
  assert.equal(rent.currency, "USD");
  assert.equal(rent.otherParty, "TENANT J OKAFOR");
  assert.equal(rent.particulars, "March rent");
  assert.equal(rent.reference, "2026030101");
  assert.equal(rent.account, "ofx-041000124-99887766");
  assert.equal(mortgage.amount, -61_250);
  assert.equal(mortgage.serial, "1043");
  assert.notEqual(rent.id, "");
  assert.notEqual(rent.id, mortgage.id);
});

test("reads an OFX 2 (XML) card statement, with grouped thousands", () => {
  const result = importFile(XML, { file: "card.ofx" });
  assert.equal(result.transactions.length, 1);
  const [line] = result.transactions;
  assert.equal(line.amount, -123_456);
  assert.equal(line.currency, "AUD");
  assert.equal(line.account, "ofx-4111000011112222");
});

test("the same download read twice gives the same ids", () => {
  const once = importFile(SGML).transactions.map((t) => t.id);
  const again = importFile(SGML).transactions.map((t) => t.id);
  assert.deepEqual(once, again);
});
