import assert from "node:assert/strict";
import test from "node:test";
import { readXlsx, sheetToCsv } from "../dist/index.js";

/**
 * A workbook, built by hand.
 *
 * Entries are stored rather than deflated -- the reader accepts both, and a
 * test that had to compress would be testing the compressor.
 */
function workbook(files) {
  const encoder = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;

  const crcTable = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc32 = (bytes) => {
    let c = 0xffffffff;
    for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };

  const put = (view, at, value, width) => {
    for (let i = 0; i < width; i += 1) view[at + i] = (value >>> (8 * i)) & 0xff;
  };

  for (const [name, text] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(text);
    const sum = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length + data.length);
    put(local, 0, 0x04034b50, 4);
    put(local, 4, 20, 2);
    put(local, 8, 0, 2); // stored
    put(local, 14, sum, 4);
    put(local, 18, data.length, 4);
    put(local, 22, data.length, 4);
    put(local, 26, nameBytes.length, 2);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    parts.push(local);

    const entry = new Uint8Array(46 + nameBytes.length);
    put(entry, 0, 0x02014b50, 4);
    put(entry, 10, 0, 2);
    put(entry, 16, sum, 4);
    put(entry, 20, data.length, 4);
    put(entry, 24, data.length, 4);
    put(entry, 28, nameBytes.length, 2);
    put(entry, 42, offset, 4);
    entry.set(nameBytes, 46);
    central.push(entry);

    offset += local.length;
  }

  const directory = central.reduce((n, e) => n + e.length, 0);
  const end = new Uint8Array(22);
  put(end, 0, 0x06054b50, 4);
  put(end, 8, central.length, 2);
  put(end, 10, central.length, 2);
  put(end, 12, directory, 4);
  put(end, 16, offset, 4);

  const total = [...parts, ...central, end];
  const size = total.reduce((n, part) => n + part.length, 0);
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const part of total) {
    bytes.set(part, at);
    at += part.length;
  }
  return bytes;
}

const SHEET_XML = `<worksheet><sheetData>
  <row r="1"><c r="A1" s="1"><v>45397</v></c><c r="B1" s="2"><v>45397</v></c><c r="C1" s="0"><v>45397</v></c></row>
  <row r="2"><c r="A2" s="3"><v>115</v></c><c r="B2" s="1"><v>61</v></c><c r="C2" s="1"><v>60</v></c></row>
</sheetData></worksheet>`;

// Style 0 is General, 1 the built-in short date, 2 a date format the file
// defines itself, 3 a money format whose only "d" is inside a literal.
const STYLES_XML = `<styleSheet>
  <numFmts>
    <numFmt numFmtId="164" formatCode="0.00"/>
    <numFmt numFmtId="165" formatCode="d\ mmm\ yy"/>
    <numFmt numFmtId="166" formatCode="&quot;NZ dollars&quot;#,##0.00"/>
  </numFmts>
  <cellXfs count="4">
    <xf numFmtId="0"/>
    <xf numFmtId="14"/>
    <xf numFmtId="165"/>
    <xf numFmtId="166"/>
  </cellXfs>
</styleSheet>`;

const FILES = {
  "xl/workbook.xml": `<workbook><sheets><sheet name="Sheet1" r:id="rId1"/></sheets></workbook>`,
  "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
  "xl/worksheets/sheet1.xml": SHEET_XML,
  "xl/styles.xml": STYLES_XML,
};

test("a cell formatted as a date is read as a date, not as its serial", async () => {
  const book = await readXlsx(workbook(FILES));
  assert.equal(book.problems.length, 0);
  const csv = sheetToCsv(book.sheets[0]);
  const [first] = csv.split(/\r?\n/);
  // Built-in format, then the file's own -- both are dates; the third cell
  // has no date format and stays the number it is.
  assert.equal(first, "2024-04-15,2024-04-15,45397");
});

test("a number that is only a number keeps its own value", async () => {
  const book = await readXlsx(workbook(FILES));
  const second = sheetToCsv(book.sheets[0]).split(/\r?\n/)[1];
  // 115 under a money format whose only "d" is inside the quoted literal
  // "NZ dollars"; then the first serial that Excel dates correctly, and the
  // last one it does not, which is left alone rather than dated a day out.
  assert.equal(second, "115,1900-03-01,60");
});

test("a workbook with no styles is still readable", async () => {
  const { "xl/styles.xml": _styles, ...rest } = FILES;
  const book = await readXlsx(workbook(rest));
  assert.equal(sheetToCsv(book.sheets[0]).split(/\r?\n/)[0], "45397,45397,45397");
});
