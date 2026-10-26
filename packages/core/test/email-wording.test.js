import { test } from "node:test";
import assert from "node:assert/strict";
import { fillWording, STANDARD_WORDING, unknownBlanks, wordingFor } from "../dist/index.js";

test("blanks filled, and a line whose blank is empty is not said", () => {
  const filled = fillWording(STANDARD_WORDING.invoice, {
    title: "Tax invoice", number: "INV-1", business: "Kea Coffee", amount: "1,150.00", due: "20 Nov 2026", reference: "", payment: "02-0100-0123456-000", message: "",
  });
  assert.equal(filled.subject, "Tax invoice INV-1 from Kea Coffee");
  assert.ok(filled.body.includes("Amount due: 1,150.00\nDue: 20 Nov 2026"));
  assert.ok(!filled.body.includes("Reference"), "no reference, no reference line");
  assert.ok(!/\n{3,}/.test(filled.body), "no gap left where the message was");
  assert.ok(filled.body.endsWith("Thank you,\nKea Coffee"));
});

test("the books' own wording where there is one, the standard otherwise", () => {
  const own = { statement: { subject: "Your account with {business}", body: "Kia ora {customer}, you owe {owing}." } };
  assert.equal(wordingFor("statement", own).subject, "Your account with {business}");
  assert.equal(wordingFor("reminder", own), STANDARD_WORDING.reminder);
  assert.equal(wordingFor("statement", { statement: { subject: " ", body: "" } }), STANDARD_WORDING.statement);
  assert.equal(fillWording(own.statement, { customer: "Ana", owing: "50.00", business: "Kea" }).body, "Kia ora Ana, you owe 50.00.");
});

test("a misspelt blank is caught", () => {
  assert.deepEqual(unknownBlanks("statement", { subject: "Hi {cutsomer}", body: "{owing} {number}" }), ["cutsomer", "number"]);
  assert.deepEqual(unknownBlanks("invoice", STANDARD_WORDING.invoice), []);
  assert.deepEqual(unknownBlanks("statement", STANDARD_WORDING.statement), []);
  assert.deepEqual(unknownBlanks("reminder", STANDARD_WORDING.reminder), []);
});
