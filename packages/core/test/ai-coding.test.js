import assert from "node:assert/strict";
import test from "node:test";
import {
  askAbout,
  briefing,
  directionCaution,
  examples,
  instructions,
  labelForCode,
  parseSuggestions,
  unmatched,
  wholePrompt,
} from "../dist/index.js";

/**
 * What would be asked, and what is made of the answer.
 *
 * None of this talks to anybody, which is the point: the whole of the risk is
 * in what is described and what is believed, and both can be held still.
 */

const chart = [
  { code: "200", name: "Sales", type: "Revenue", taxCode: "", description: "", entity: "kea" },
  { code: "404", name: "Bank Fees", type: "Overhead", taxCode: "", description: "", entity: "kea" },
  { code: "463", name: "Repairs", type: "Overhead", taxCode: "", description: "", entity: "rimu" },
  { code: "", name: "Trading account", type: "Bank", taxCode: "", description: "", entity: "kea" },
];

const model = {
  entities: [
    { id: "kea", name: "Kea Coffee", kind: "business", gstRegistered: true },
    { id: "rimu", name: "12 Rimu St", kind: "residential", gstRegistered: false },
  ],
  accounts: {},
  banks: {},
};

const about = (entity) => (entity.id === "kea" ? "Roasts and wholesales coffee" : "");

test("only what nothing in these books answered is ever asked about", () => {
  const lines = [
    { transaction: { id: "a" }, code: "463", confirmed: false },
    { transaction: { id: "b" }, code: null, confirmed: false },
    { transaction: { id: "c" }, code: "200", confirmed: true },
    // Answered by a person even though no rule matched: their answer stands.
    { transaction: { id: "d" }, code: null, confirmed: true },
    { transaction: { id: "e" }, code: null, confirmed: false },
  ];
  assert.deepEqual(
    unmatched(lines).map((one) => one.transaction.id),
    ["b", "e"],
  );
});

test("a transaction is reduced to what would identify it, and nothing else", () => {
  const asked = askAbout(
    {
      id: "t1",
      date: "2026-08-14",
      amount: -128450,
      currency: "NZD",
      serial: "0001",
      trn: "POS",
      particulars: "POS W/D",
      code: "",
      reference: "4929-0011",
      otherParty: "Rimu Hardware",
      origin: "02-1255",
      type: "PUR",
      batch: "",
      otherPartyAccount: "",
      account: "01-2345-0678901-000",
      occurrence: 1,
    },
    "Trading account",
  );
  // Unsigned now: the direction is what says which way, in words a model
  // cannot skim past the way it skimmed past a minus sign.
  assert.equal(asked.amount, "1284.50");
  assert.equal(asked.direction, "money out");
  assert.equal(asked.payee, "Rimu Hardware");
  // The empty field is left out rather than sent as a blank.
  assert.equal(asked.details, "POS W/D · 4929-0011");
  assert.equal(asked.paidFrom, "Trading account");
  // The bank account number is not in what is sent.
  assert.equal(JSON.stringify(asked).includes("01-2345"), false);
});

test("the briefing carries what changes the right answer, not only the names", () => {
  const books = briefing(model, chart, about);
  const said = instructions({ ...books, about: "Two entities kept together." });

  assert.match(said, /Two entities kept together\./);
  assert.match(said, /Kea Coffee .*GST registered\): Roasts and wholesales coffee/);
  // The two facts that make an answer wrong rather than merely unhelpful.
  assert.match(said, /12 Rimu St \(residential rental: losses are ring-fenced.*not GST registered/);
  assert.match(said, /- 200 Sales \[Revenue\] \(Kea Coffee\)/);
  // A bank row with no code is not something to code to.
  assert.equal(said.includes("Trading account"), false);
  // And it is told to refuse rather than guess.
  assert.match(said, /return an\n {2}empty code rather than a guess/);
});

test("worked examples are one per payee, and the newest win", () => {
  const said = examples([
    { payee: "Rimu Hardware", code: "463" },
    { payee: "rimu hardware", code: "400" },
    { payee: "", code: "200" },
    { payee: "Kea Fuel Co", code: "449" },
    { payee: "Matai Grocers", code: "" },
  ]);
  assert.match(said, /- Rimu Hardware -> 463/);
  assert.equal(said.includes("-> 400"), false, "the same payee is not listed twice");
  assert.equal(said.includes("Matai Grocers"), false, "a line with no code teaches nothing");
});

test("the whole prompt can be read before it is sent", () => {
  const books = { ...briefing(model, chart, about), about: "A roastery and a rental." };
  const whole = wholePrompt(books, [
    { id: "t1", date: "2026-08-14", amount: "-1284.50", payee: "Rimu Hardware", details: "", paidFrom: "Trading account" },
  ]);
  assert.match(whole, /A roastery and a rental\./);
  assert.match(whole, /Transactions to code:/);
  assert.match(whole, /Rimu Hardware/);
});

test("an answer is believed only where it names a code this chart has", () => {
  const out = parseSuggestions(
    'Here you go!\n```json\n[{"id":"t1","code":"463","confidence":0.8,"because":"Hardware for the rental"},' +
      '{"id":"t2","code":"9999","confidence":0.9,"because":"Made this up"}]\n```\nHope that helps.',
    { asked: ["t1", "t2"], codes: ["200", "404", "463"] },
  );
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], {
    id: "t1",
    code: "463",
    confidence: 0.8,
    because: "Hardware for the rental",
  });
  // Invented codes are refused, and say so rather than vanishing.
  assert.equal(out[1].code, "");
  assert.equal(out[1].confidence, 0);
  assert.match(out[1].because, /9999, which is not in this chart/);
});

test("nothing about a transaction nobody asked about gets through", () => {
  const out = parseSuggestions('[{"id":"someone-elses","code":"200","confidence":1}]', {
    asked: ["t1"],
    codes: ["200"],
  });
  assert.deepEqual(out, []);
});

test("one answer per transaction, however many come back", () => {
  const out = parseSuggestions(
    '[{"id":"t1","code":"200","confidence":0.9},{"id":"t1","code":"404","confidence":0.9}]',
    { asked: ["t1"], codes: ["200", "404"] },
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].code, "200");
});

test("an unreadable answer is a batch with nothing in it, not a crash", () => {
  const codes = { asked: ["t1"], codes: ["200"] };
  assert.deepEqual(parseSuggestions("I'm sorry, I can't help with that.", codes), []);
  assert.deepEqual(parseSuggestions("[not json at all}", codes), []);
  assert.deepEqual(parseSuggestions("", codes), []);
  assert.deepEqual(parseSuggestions('{"id":"t1"}', codes), []);
});

test("a confidence that is not a number between nothing and certain is not believed", () => {
  const out = parseSuggestions(
    '[{"id":"t1","code":"200","confidence":"very","because":"x"},' +
      '{"id":"t2","code":"200","confidence":7,"because":"y"}]',
    { asked: ["t1", "t2"], codes: ["200"] },
  );
  assert.equal(out[0].confidence, 0);
  assert.equal(out[1].confidence, 0);
});

test("a code is translated to the account these books actually code to", () => {
  const labels = ["ACC Levy Expenses - 401", "Sales - 200", "Bank Fees - 404", "Suspense"];
  assert.equal(labelForCode("401", labels), "ACC Levy Expenses - 401");
  assert.equal(labelForCode(" 200 ", labels), "Sales - 200");
  // A label with no code at all is matched by its whole name.
  assert.equal(labelForCode("Suspense", labels), "Suspense");
});

test("a code this chart does not have translates to nothing", () => {
  const labels = ["Sales - 200"];
  assert.equal(labelForCode("9999", labels), null);
  assert.equal(labelForCode("", labels), null);
  assert.equal(labelForCode("20", labels), null, "a prefix is not a match");
});

test("a code two accounts share is refused rather than picked between", () => {
  // Two charts loaded, one house-prefixed: the number alone cannot say which.
  const labels = ["Advertising - 400", "NB Advertising - 400"];
  assert.equal(labelForCode("400", labels), null);
});

test("the direction is said in words, and the amount is not signed", () => {
  const paid = askAbout(
    { id: "t", date: "2025-04-22", amount: -80000, currency: "NZD", serial: "", trn: "",
      particulars: "Rimu Hardware", code: "", reference: "", otherParty: "Payment",
      origin: "", type: "", batch: "", otherPartyAccount: "", account: "a", occurrence: 1 },
    "Trading account",
  );
  assert.equal(paid.direction, "money out");
  assert.equal(paid.amount, "800.00", "unsigned: the direction is what says which way");
  // "Payment" is the bank's word for the kind of transaction, not a payee.
  assert.equal(paid.payee, "Rimu Hardware");

  const got = askAbout(
    { id: "t2", date: "2025-04-22", amount: 80000, currency: "NZD", serial: "", trn: "",
      particulars: "Tai Whitcombe", code: "", reference: "INTERNET XFR", otherParty: "Payment",
      origin: "", type: "", batch: "", otherPartyAccount: "", account: "a", occurrence: 1 },
    "Trading account",
  );
  assert.equal(got.direction, "money in");
  assert.equal(got.payee, "Tai Whitcombe");
});

test("a real payee is left alone", () => {
  const one = askAbout(
    { id: "t3", date: "2025-04-22", amount: -1000, currency: "NZD", serial: "", trn: "",
      particulars: "POS W/D", code: "", reference: "", otherParty: "Kea Fuel Co",
      origin: "", type: "", batch: "", otherPartyAccount: "", account: "a", occurrence: 1 },
    "Trading account",
  );
  assert.equal(one.payee, "Kea Fuel Co");
});

test("money in coded to spending is flagged, not refused", () => {
  assert.match(directionCaution("money in", "Overhead"), /correct only for a refund/);
  assert.match(directionCaution("money in", "Direct Costs"), /correct only for a refund/);
  assert.match(directionCaution("money out", "Revenue"), /income account/);
  // The ordinary cases say nothing at all.
  assert.equal(directionCaution("money out", "Overhead"), undefined);
  assert.equal(directionCaution("money in", "Revenue"), undefined);
  assert.equal(directionCaution("money in", "Current Liability"), undefined);
});

test("the instructions tell it which way the money went, and stop telling it to ignore the amount", () => {
  const said = instructions(briefing(model, chart, about));
  assert.match(said, /direction is the first thing to read/);
  assert.match(said, /Money in is normally revenue/);
  assert.equal(said.includes("Do not infer anything from the amount alone"), false);
});
