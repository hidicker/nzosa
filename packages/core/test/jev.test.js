import test from "node:test";
import assert from "node:assert/strict";
import { detectProvider, jevSuggest, listModels, askModel, parseSuggestions } from "../dist/index.js";

/** A stand-in for Jev: records each request and answers from a script. */
function fakeJev(answerFor) {
  const sent = [];
  const fetcher = async (url, init) => {
    const body = JSON.parse(init.body);
    sent.push({ url, init, body });
    const { status = 200, json } = answerFor(body, sent.length);
    return { ok: status < 400, status, json: async () => json };
  };
  return { fetcher, sent };
}

const lines = [
  { id: "t1", date: "2026-05-01", direction: "money out", amount: "89.50", payee: "Kea Hardware", details: "", paidFrom: "Cheque" },
  { id: "t2", date: "2026-05-02", direction: "money in", amount: "560.00", payee: "A Tenant", details: "rent", paidFrom: "Rental" },
];
const codes = ["Repairs and maintenance - 473TS", "Rent received - 200TS"];

test("a jv_ key is Jev's", () => {
  assert.equal(detectProvider("jv_live_abc"), "jev");
  assert.equal(detectProvider("sk-ant-x"), "anthropic");
});

test("each line is its own question, and the answers read as any model's do", async () => {
  const { fetcher, sent } = fakeJev((body) => ({
    json: {
      answers: {
        account: body.state.includes("Kea Hardware")
          ? { type: "choice", choice: "a0", confidence: 0.93, probabilities: { a0: 0.93, a1: 0.07 } }
          : { type: "choice", choice: "a1", confidence: 0.99, probabilities: { a1: 0.99, a0: 0.01 } },
      },
    },
  }));
  const text = await jevSuggest({ key: "jv_test_1", lines, codes, about: "Two rentals.", fetcher });
  assert.equal(sent.length, 2);
  assert.equal(sent[0].url, "https://jevtypesafeai.com/api/v1/decide");
  assert.equal(sent[0].init.headers.authorization, "Bearer jv_test_1");
  assert.equal(sent[0].body.model, "jev-latest");
  assert.deepEqual(sent[0].body.questions.account.criteria, { a0: codes[0], a1: codes[1] });
  assert.match(sent[0].body.state, /Direction: money out/);
  assert.match(sent[0].body.state, /About these books: Two rentals\./);
  // Only the account is asked: GST follows the account's own setting.
  assert.deepEqual(Object.keys(sent[0].body.questions), ["account"]);

  const back = parseSuggestions(text, { asked: ["t1", "t2"], codes });
  assert.deepEqual(back.map((s) => [s.id, s.code, s.confidence]), [
    ["t1", codes[0], 0.93],
    ["t2", codes[1], 0.99],
  ]);
  assert.match(back[0].because, /next most likely Rent received - 200TS \(7%\)/);
});

test("Jev's refusals say what to do, and too big a chart is refused before asking", async () => {
  const { fetcher } = fakeJev(() => ({ status: 402, json: { error: "insufficient credits" } }));
  await assert.rejects(() => jevSuggest({ key: "jv_x", lines, codes, fetcher }), /no credit left: insufficient credits/);
  const many = Array.from({ length: 256 }, (_, i) => `Account ${i} - ${400 + i}`);
  const quiet = fakeJev(() => ({ json: {} }));
  await assert.rejects(() => jevSuggest({ key: "jv_x", lines, codes: many, fetcher: quiet.fetcher }), /at most 255/);
  assert.equal(quiet.sent.length, 0);
});

test("a Jev key is checked with one small question, and refuses prose", async () => {
  const { fetcher, sent } = fakeJev(() => ({ json: { answers: { ok: { type: "noul", confidence: 0.9 } } } }));
  const models = await listModels("jev", "jv_x", fetcher);
  assert.deepEqual(models.map((m) => m.name), ["jev-latest"]);
  assert.equal(sent[0].body.questions.ok.type, "noul");
  await assert.rejects(() => askModel("jev", "jv_x", "jev-latest", "hello", fetcher), /coding suggestions on Reconcile only/);
});
