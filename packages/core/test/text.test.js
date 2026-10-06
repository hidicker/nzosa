import assert from "node:assert/strict";
import test from "node:test";
import { decodeText, decodeWindows1252, parseChartOfAccounts } from "../dist/index.js";

const bytes = (...values) => new Uint8Array(values);

test("the range that separates Windows-1252 from Latin-1 is mapped", () => {
  // The runtime this was written against decoded 0x96 as U+0096, an invisible
  // control character, so an en dash in an account name simply vanished.
  assert.equal(decodeWindows1252(bytes(0x96)), "–", "en dash");
  assert.equal(decodeWindows1252(bytes(0x97)), "—", "em dash");
  assert.equal(decodeWindows1252(bytes(0x91)), "‘", "left single quote");
  assert.equal(decodeWindows1252(bytes(0x92)), "’", "right single quote");
  assert.equal(decodeWindows1252(bytes(0x93)), "“", "left double quote");
  assert.equal(decodeWindows1252(bytes(0x94)), "”", "right double quote");
  assert.equal(decodeWindows1252(bytes(0x85)), "…", "ellipsis");
  assert.equal(decodeWindows1252(bytes(0x80)), "€", "euro");
});

test("a byte the encoding does not define is kept, not dropped", () => {
  // It is somebody's data. Showing it oddly beats losing it in silence.
  assert.equal(decodeWindows1252(bytes(0x81)), "");
});

test("ordinary bytes are unchanged", () => {
  assert.equal(decodeWindows1252(bytes(0x41, 0x42, 0x43)), "ABC");
  assert.equal(decodeWindows1252(bytes(0xe9)), "é", "e acute, where Latin-1 and 1252 agree");
});

test("UTF-8 is preferred when the file really is UTF-8", () => {
  const utf8 = new TextEncoder().encode("Depreciation – Vehicles");
  assert.equal(decodeText(utf8), "Depreciation – Vehicles");
});

test("a Windows-1252 file falls back rather than coming back mangled", () => {
  // "Less Accumulated Depreciation - Vehicles" as Xero writes it.
  const line = bytes(
    ...[..."Less Accumulated Depreciation "].map((c) => c.charCodeAt(0)),
    0x96,
    ...[..." Vehicles"].map((c) => c.charCodeAt(0)),
  );
  assert.equal(decodeText(line), "Less Accumulated Depreciation – Vehicles");
});

test("a UTF-8 file containing a replacement character is still read as UTF-8", () => {
  // The old test was whether a loose read produced U+FFFD, which a legitimate
  // UTF-8 file can contain of its own accord.
  const utf8 = new TextEncoder().encode("Odd � name");
  assert.equal(decodeText(utf8), "Odd � name");
});

test("a chart of accounts keeps the dash in an account name", () => {
  const csv = bytes(
    ...[..."*Code,*Name,*Type,*Tax Code\n741,Less Accumulated Depreciation "].map((c) =>
      c.charCodeAt(0),
    ),
    0x96,
    ...[..." Vehicles,Fixed Asset,No GST\n"].map((c) => c.charCodeAt(0)),
  );
  const parsed = parseChartOfAccounts(decodeText(csv));
  const account = parsed.accounts.find((a) => a.code === "741");
  assert.equal(account.name, "Less Accumulated Depreciation – Vehicles");
});
