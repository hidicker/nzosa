import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handle } from "../dist/protocol.js";
import { BookShelf } from "../dist/load.js";
import { Sandbox } from "../dist/sandbox.js";

const BANK = "02-0001-0000001-000";

function tx(id, date, amount, otherParty) {
  return {
    id, date, amount, currency: "NZD", account: BANK, serial: "", trn: "", particulars: "", code: "",
    reference: "", otherParty, origin: "", type: "", batch: "", otherPartyAccount: "",
    occurrence: 1, extras: {}, source: { importer: "test", file: "t.csv", line: 1 },
  };
}

/** One company: a line coded by a rule, two waiting, one in a locked period. */
function books(decisions = {}) {
  const folder = join(mkdtempSync(join(tmpdir(), "nzosa-suggest-")), "books");
  mkdirSync(folder);
  const put = (name, data) => writeFileSync(join(folder, name), JSON.stringify({ version: 1, data }));
  writeFileSync(join(folder, "ledger.json"), JSON.stringify({ name: "Test company", created: "2026-01-01" }));
  put("transactions.json", [
    tx("old", "2025-03-20", -5000, "LOCKED SHOP"),
    tx("fuel", "2026-01-15", -23000, "Z ENERGY"),
    tx("mixed", "2026-01-16", -11500, "BUNNINGS"),
    tx("rent", "2026-01-17", -100000, "LANDLORD"),
  ]);
  put("decisions.json", { overrides: {}, splits: {}, lockDates: { gst: "2025-03-31" }, ...decisions });
  put("entities.json", { entities: [{ id: "co", name: "Co Ltd", kind: "company" }], accounts: {}, banks: { [BANK]: ["co"] } });
  put("chart.json", [
    { code: "449", name: "Motor Vehicle Expenses", type: "Expense" },
    { code: "710", name: "Office Equipment", type: "Fixed Asset" },
    { code: "429", name: "General Expenses", type: "Expense" },
    { code: "469", name: "Rent", type: "Expense" },
    { code: "880", name: "Drawings", type: "Equity" },
  ]);
  put("rules.json", { rules: [{ keyword: "landlord", code: "Rent - 469" }] });
  return folder;
}

function context(folder, extra = {}) {
  return {
    shelf: new BookShelf(new Sandbox(folder)), allowed: undefined, maxRows: 200, suggest: true,
    client: "claude-ai", now: () => "2026-10-31T09:00:00.000Z", ...extra,
  };
}

function call(ctx, name, args = {}) {
  const out = handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, ctx).result;
  const body = out.content[0].text;
  return out.isError ? { error: body } : JSON.parse(body);
}

const held = (folder) => JSON.parse(readFileSync(join(folder, "suggested.json"), "utf8"));
const bookFiles = (folder) =>
  readdirSync(folder).filter((f) => f !== "suggested.json").map((f) => [f, readFileSync(join(folder, f), "utf8")]);

test("without --suggest the suggest tools are not offered and cannot be called", () => {
  const folder = books();
  const ctx = context(folder, { suggest: false });
  const names = handle({ jsonrpc: "2.0", id: 1, method: "tools/list" }, ctx).result.tools.map((t) => t.name);
  assert.ok(names.includes("list_accounts"));
  assert.ok(!names.some((n) => n.startsWith("suggest_")));
  assert.match(handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "suggest_codes", arguments: {} } }, ctx).error.message, /No tool/);
  assert.equal(existsSync(join(folder, "suggested.json")), false);
});

test("with --suggest they are offered, and the instructions say a suggestion is not done", () => {
  const ctx = context(books());
  const hello = handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "Claude Desktop" } } }, ctx).result;
  assert.match(hello.instructions, /never changes the books/);
  assert.equal(ctx.client, "Claude Desktop");
  const names = handle({ jsonrpc: "2.0", id: 2, method: "tools/list" }, ctx).result.tools.map((t) => t.name);
  for (const name of ["suggest_codes", "suggest_split", "suggest_journal", "show_in_app", "list_suggestions"]) assert.ok(names.includes(name), name);
});

test("list_accounts names every account the books can code to", () => {
  const found = call(context(books()), "list_accounts").accounts.map((a) => a.account);
  assert.ok(found.includes("Motor Vehicle Expenses - 449"));
  assert.ok(found.includes("Rent - 469"));
});

test("codes are checked, kept as one set beside the books, and the books are untouched", () => {
  const folder = books();
  const before = bookFiles(folder);
  const ctx = context(folder);
  const said = call(ctx, "suggest_codes", { lines: [{ transaction: "fuel", account: "449", because: "Z Energy is fuel" }] });
  assert.equal(said.suggestions, 1);
  assert.equal(said.from, "Claude");
  assert.match(said.said, /Nothing is in the books yet/);
  const file = held(folder);
  assert.equal(file.sets.length, 1);
  assert.deepEqual(file.sets[0].items, [{ kind: "coding", transaction: "fuel", code: "Motor Vehicle Expenses - 449", because: "Z Energy is fuel" }]);
  assert.equal(file.sets[0].from, "claude-ai");
  assert.deepEqual(bookFiles(folder), before);

  // Sent again after a dropped answer: kept once.
  const again = call(ctx, "suggest_codes", { lines: [{ transaction: "fuel", account: "449", because: "Z Energy is fuel" }] });
  assert.equal(again.alreadyHeld, true);
  assert.equal(held(folder).sets.length, 1);
});

test("a code is refused for a line already coded, a locked line, an unknown line or account", () => {
  const ctx = context(books());
  const one = (line) => call(ctx, "suggest_codes", { lines: [{ because: "x", ...line }] }).error;
  assert.match(one({ transaction: "rent", account: "449" }), /already coded to Rent - 469/);
  assert.match(one({ transaction: "old", account: "449" }), /locked period/);
  assert.match(one({ transaction: "nope", account: "449" }), /no line "nope"/);
  assert.match(one({ transaction: "fuel", account: "999" }), /no account "999"/);
  assert.match(call(ctx, "suggest_codes", { lines: [{ transaction: "fuel", account: "449" }] }).error, /say why/);
});

test("a split must add up to the line, and unsigned parts take the line's direction", () => {
  const folder = books();
  const ctx = context(folder);
  assert.match(
    call(ctx, "suggest_split", { transaction: "mixed", parts: [{ amount: "100.00", account: "710" }, { amount: "10.00", account: "429" }], because: "x" }).error,
    /come to -110.00, and the line is -115.00 \(out by 5.00\)/,
  );
  const ok = call(ctx, "suggest_split", { transaction: "mixed", parts: [{ amount: "100.00", account: "710" }, { amount: "15", account: "429", note: "bits" }], because: "a drill and screws" });
  assert.equal(ok.suggestions, 1);
  assert.deepEqual(held(folder).sets[0].items[0].parts, [
    { amount: -10000, code: "Office Equipment - 710" },
    { amount: -1500, code: "General Expenses - 429", note: "bits" },
  ]);
});

test("a journal must balance, and not be dated in a locked period", () => {
  const folder = books();
  const ctx = context(folder);
  const lines = [{ account: "880", debit: "50.00" }, { account: "449", credit: "50.00" }];
  assert.match(call(ctx, "suggest_journal", { date: "2025-03-31", narration: "x", lines, because: "x" }).error, /locked period/);
  assert.match(
    call(ctx, "suggest_journal", { date: "2026-03-31", narration: "x", lines: [{ account: "880", debit: "50.00" }, { account: "449", credit: "40.00" }], because: "x" }).error,
    /do not balance \(out by 10.00\)/,
  );
  assert.match(call(ctx, "suggest_journal", { date: "2026-03-31", narration: "x", lines: [{ account: "880", debit: "5", credit: "5" }, { account: "449", credit: "5" }], because: "x" }).error, /one of them/);
  const ok = call(ctx, "suggest_journal", { date: "2026-03-31", narration: "Private use of the van", lines, because: "a fifth of the fuel was private" });
  assert.equal(ok.suggestions, 1);
  assert.deepEqual(held(folder).sets[0].items[0].lines, [
    { code: "Drawings - 880", debit: 5000, credit: 0 },
    { code: "Motor Vehicle Expenses - 449", debit: 0, credit: 5000 },
  ]);
});

test("list_suggestions leaves out what the app has used or declined", () => {
  const folder = books();
  const ctx = context(folder);
  const { suggestionSet } = call(ctx, "suggest_codes", {
    lines: [
      { transaction: "fuel", account: "449", because: "fuel" },
      { transaction: "mixed", account: "429", because: "hardware" },
    ],
  });
  assert.equal(call(ctx, "list_suggestions").waiting, 2);
  const decisions = JSON.parse(readFileSync(join(folder, "decisions.json"), "utf8"));
  decisions.data.suggestionsHandled = { [`${suggestionSet}:0`]: "used" };
  writeFileSync(join(folder, "decisions.json"), JSON.stringify(decisions));
  const left = call(ctx, "list_suggestions");
  assert.equal(left.waiting, 1);
  assert.equal(left.suggestions[0].line.id, "mixed");
});

test("show_in_app asks for a page, each time anew", () => {
  const folder = books();
  let tick = 0;
  const ctx = context(folder, { now: () => `2026-10-31T09:00:0${tick++}.000Z` });
  call(ctx, "show_in_app", { page: "reconcile", search: "Z Energy" });
  call(ctx, "show_in_app", { page: "reconcile", search: "Z Energy" });
  assert.equal(held(folder).sets.length, 2);
  assert.equal(held(folder).sets[0].items[0].page, "reconcile");
  assert.match(call(ctx, "show_in_app", { page: "settings" }).error, /one of/);
});

test("books handed over by the server answer the same, and suggestions come back to be saved", async () => {
  const { answerHosted } = await import("../dist/hosted.js");
  const folder = books();
  const part = (name) => JSON.parse(readFileSync(join(folder, name), "utf8")).data;
  const parts = {
    transactions: part("transactions.json"), decisions: part("decisions.json"), entities: part("entities.json"),
    chart: part("chart.json"), rules: part("rules.json"),
  };
  const ask = (body, suggest = true) => answerHosted({ body, parts, name: "Online co", suggest, client: "Claude" });

  const listed = ask({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_entities", arguments: {} } });
  assert.equal(JSON.parse(listed.reply.result.content[0].text).books, "Online co");
  assert.equal(listed.suggested, undefined);

  const made = ask({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "suggest_codes", arguments: { lines: [{ transaction: "fuel", account: "449", because: "fuel" }] } } });
  assert.equal(JSON.parse(made.reply.result.content[0].text).from, "Claude");
  assert.equal(made.suggested.sets[0].from, "Claude");
  assert.equal(made.suggested.sets[0].items[0].code, "Motor Vehicle Expenses - 449");

  // Read-only in these books: no suggest tools.
  const names = ask({ jsonrpc: "2.0", id: 3, method: "tools/list" }, false).reply.result.tools.map((t) => t.name);
  assert.ok(!names.includes("suggest_codes"));

  // A batch, with a notification in it that takes no answer.
  const batch = ask([{ jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: 4, method: "ping" }]);
  assert.deepEqual(batch.reply, [{ jsonrpc: "2.0", id: 4, result: {} }]);
  assert.equal(ask({ jsonrpc: "2.0", method: "notifications/initialized" }).reply, undefined);
});
