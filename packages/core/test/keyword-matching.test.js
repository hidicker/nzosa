import assert from "node:assert/strict";
import test from "node:test";
import { categorise, matchText } from "../dist/rules.js";
import { keywordFor } from "../dist/rule-inference.js";
import { gstResolver } from "../dist/gst-rules.js";

const line = (over = {}) => ({
  id: "t1", date: "2026-06-05", account: "kea-card-4001", amount: -459,
  currency: "NZD", otherParty: "PAYPAL *KEA WIDGETS INC", particulars: "",
  code: "", reference: "1122334455", ...over,
});

test("a rule matches the very line its keyword was written from", () => {
  // The card network's asterisk is not part of anybody's name, so the keyword
  // loses it -- and the line keeps it. A plain substring test therefore said
  // the rule did not match the transaction it was derived from, which is the
  // one match it must never miss.
  const transaction = line();
  const keyword = keywordFor(transaction);
  assert.equal(keyword, "PAYPAL KEA WIDGETS INC");
  const { code } = categorise(transaction, {
    rules: [{ priority: 100, keyword, code: "Subscriptions - 485" }],
  });
  assert.equal(code, "Subscriptions - 485");
});

test("it matches the others the same payee wrote too", () => {
  const rules = { rules: [{ priority: 100, keyword: "PAYPAL KEA WIDGETS INC", code: "485" }] };
  for (const date of ["2026-05-05", "2026-04-05"]) {
    assert.equal(categorise(line({ id: date, date }), rules).code, "485");
  }
});

test("a keyword that already carried punctuation still matches", () => {
  // Folding only the text would have broken these: the keyword keeps its dot
  // and the text loses it. Both sides are folded, so both spellings meet.
  const transaction = line({ otherParty: "OPENAI.COM", reference: "" });
  assert.equal(categorise(transaction, { rules: [{ priority: 100, keyword: "OPENAI.COM", code: "485" }] }).code, "485");
  assert.equal(categorise(transaction, { rules: [{ priority: 100, keyword: "OPENAI COM", code: "485" }] }).code, "485");
});

test("digits are left alone, so a keyword may hold a number", () => {
  const transaction = line({ otherParty: "MITRE 10 MEGA", reference: "INV-4021" });
  assert.equal(categorise(transaction, { rules: [{ priority: 100, keyword: "MITRE 10", code: "455" }] }).code, "455");
  assert.equal(categorise(transaction, { rules: [{ priority: 100, keyword: "INV-4021", code: "455" }] }).code, "455");
});

test("a GST keyword matches through punctuation too", () => {
  const resolve = gstResolver({
    replaceDefaults: true,
    rules: [{ keyword: "PAYPAL KEA WIDGETS INC", treatment: "zero-rated", priority: 100 }],
  });
  assert.equal(resolve(line()).treatment, "zero-rated");
});

test("the fold leaves ordinary text as it was", () => {
  assert.equal(matchText("  Bunnings   Warehouse "), "BUNNINGS WAREHOUSE");
  assert.equal(matchText("A&B Ltd"), "A&B LTD");
  assert.equal(matchText("O'Brien-Smith"), "O'BRIEN-SMITH");
});
