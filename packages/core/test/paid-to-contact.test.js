import assert from "node:assert/strict";
import test from "node:test";
import { paidToContact, payeeMatches } from "../dist/index.js";

test("a bank's shortened, capitalised payee is the supplier written in full", () => {
  assert.equal(payeeMatches("GREEN BEAN IMPORT", "Green Bean Importers Limited"), true);
  assert.equal(payeeMatches("Mitre 10 Mega Nelson", "Mitre 10 Mega Nelson"), true);
  assert.equal(payeeMatches("Māpua Bakehouse Ltd", "Mapua Bakehouse Limited"), true);
});

test("a short name does not catch everybody who begins with it", () => {
  assert.equal(payeeMatches("BP CONNECT NELSON", "BP"), false);
  assert.equal(payeeMatches("Kea Cafe Group", "Kea Coffee Roasters"), false);
  assert.equal(payeeMatches("", "Anyone"), false);
});

const line = (id, date, amount, otherParty, over = {}) => ({ id, date, amount, account: "chq", otherParty, reference: "", particulars: "", ...over });

test("what was paid to a supplier: this year, all time, the lines newest first", () => {
  const lines = [
    line("a", "2025-12-01", -10_000, "GREEN BEAN IMPORT", { reference: "INV 77" }),
    line("b", "2026-05-01", -20_000, "Green Bean Importers"),
    line("c", "2026-05-02", 5_000, "GREEN BEAN IMPORT"),
    line("d", "2026-05-03", -7_000, "Other Supplier"),
    line("e", "2026-05-04", -3_000, "GREEN BEAN IMPORT"),
  ];
  const paid = paidToContact(lines, "Green Bean Importers Limited", { from: "2026-04-01", to: "2027-03-31" }, new Set(["e"]));
  assert.equal(paid.inPeriod, 20_000);
  assert.equal(paid.allTime, 30_000);
  assert.deepEqual(paid.lines.map((l) => l.id), ["b", "a"]);
  assert.equal(paid.lines[1].reference, "INV 77");
});
