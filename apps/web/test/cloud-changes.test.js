import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { applyPartOps } from "@nzosa/core";

/**
 * Books kept online save only what changed. These run the page's own saving
 * code against a stand-in for the server that applies changes by the rules
 * the database does (the database is held to the same rules separately), and
 * check what was sent and what the server ends up holding.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = mkdtempSync(join(tmpdir(), "nzosa-cloud-changes-"));
const bundle = join(out, "store.mjs");
await build({
  entryPoints: [join(root, "src", "store.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: ["node20"],
  define: { __NZOSA_EDITION__: '"nz"' },
  outfile: bundle,
  logLevel: "silent",
});
test.after(() => rmSync(out, { recursive: true, force: true }));

const BOOK = "11111111-2222-3333-4444-555555555555";

/** A server holding one set of books, and a record of what was asked of it. */
function server({ takesChanges = true, delay = 0 } = {}) {
  const parts = new Map();
  const asked = [];
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetch = async (url, init = {}) => {
    const where = String(url);
    const body = init.body ? JSON.parse(init.body) : null;
    asked.push({ where, body, bytes: init.body?.length ?? 0 });
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    if (where.includes("/rest/v1/book_parts?")) {
      const named = /part=in\.\(([^)]*)\)/.exec(where)?.[1]?.split(",").map(decodeURIComponent);
      return reply(
        200,
        [...parts]
          .filter(([part]) => named === undefined || named.includes(part))
          .map(([part, held]) => ({ part, version: held.version, data: structuredClone(held.data) })),
      );
    }
    if (where.endsWith("/rpc/book_member_list")) return reply(200, [{ user_id: "me", role: "owner" }]);
    if (where.endsWith("/rpc/save_part")) {
      const held = parts.get(body.p_part);
      if ((held?.version ?? 0) !== body.p_version) return reply(409, { code: "PT409" });
      const version = (held?.version ?? 0) + 1;
      parts.set(body.p_part, { version, data: body.p_data });
      return reply(200, version);
    }
    if (where.endsWith("/rpc/save_part_changes")) {
      if (!takesChanges) return reply(404, { code: "PGRST202", message: "no such function" });
      const next = new Map(parts);
      const versions = [];
      for (const change of body.p_changes) {
        const held = next.get(change.part);
        if ((held?.version ?? 0) !== change.version) return reply(409, { code: "PT409" });
        if ("ops" in change && held === undefined) return reply(409, { code: "PT409" });
        const data = "ops" in change ? applyPartOps(held.data, change.ops) : change.data;
        const version = (held?.version ?? 0) + 1;
        next.set(change.part, { version, data });
        versions.push(version);
      }
      for (const [part, held] of next) parts.set(part, held);
      return reply(200, versions);
    }
    return reply(404, {});
  };
  return { parts, asked, fetch };
}

let fresh = 0;

/** The page's store, signed in with these books open, talking to `remote`. */
async function opened(remote) {
  const kept = new Map([
    ["nzosa:cloud-session", JSON.stringify({ userId: "me", email: "me@example.com", accessToken: "a", refreshToken: "r", expiresAt: 4102444800 })],
    ["nzosa:cloud-book", JSON.stringify({ id: BOOK, name: "Test" })],
  ]);
  globalThis.localStorage = {
    getItem: (key) => kept.get(key) ?? null,
    setItem: (key, value) => kept.set(key, String(value)),
    removeItem: (key) => kept.delete(key),
  };
  globalThis.location = { protocol: "https:", hostname: "example.com" };
  globalThis.fetch = remote.fetch;
  fresh += 1;
  const store = await import(`${pathToFileURL(bundle).href}?n=${fresh}`);
  const troubles = [];
  store.onSaveTrouble((trouble) => troubles.push(trouble));
  const { ledger } = await store.load();
  assert.equal(store.backendKind(), "cloud");
  const events = await store.loadEvents();
  return { store, ledger, events, troubles };
}

function seeded(remote) {
  const overrides = {};
  for (let i = 0; i < 3000; i++) overrides[`t${i}`] = { code: "6100", confirmed: true, note: "x".repeat(40) };
  remote.parts.set("decisions", { version: 7, data: { overrides, splits: {}, legitimateDuplicates: ["a"], lockDates: { all: "2024-03-31" } } });
  remote.parts.set("events", { version: 3, data: Array.from({ length: 2000 }, (_, i) => ({ id: `e${i}`, kind: "coding", summary: `s${i}`, before: null, after: { code: "1" } })) });
  remote.parts.set("transactions", { version: 2, data: [{ id: "t1", date: "2025-01-01", amount: -100, description: "x" }] });
  remote.parts.set("filed", { version: 1, data: [] });
  remote.parts.set("payroll", { version: 1, data: { employerIrd: "", employees: [], payRuns: [] } });
}

const saves = (remote) => remote.asked.filter((one) => one.where.includes("/rpc/save_part"));

test("a tick sends the line and the history entry, together and small", async () => {
  const remote = server();
  seeded(remote);
  const { store, ledger, events } = await opened(remote);

  const next = { ...ledger, overrides: { ...ledger.overrides, t5: { code: "4000", confirmed: true } } };
  const entry = { id: "new", kind: "coding", summary: "Coded t5", before: null, after: { code: "4000" } };
  const [saved, logged] = await Promise.all([store.save(next), store.saveEvents([entry, ...events])]);
  assert.equal(saved, true);
  assert.equal(logged, true);

  const sent = saves(remote);
  assert.equal(sent.length, 1, "one request");
  assert.match(sent[0].where, /save_part_changes$/);
  assert.deepEqual(sent[0].body.p_changes.map((c) => c.part).sort(), ["decisions", "events"]);
  assert.ok(sent[0].body.p_changes.every((c) => "ops" in c));
  assert.ok(sent[0].bytes < 1000, `sent ${sent[0].bytes} bytes`);

  assert.deepEqual(remote.parts.get("decisions").data.overrides.t5, { code: "4000", confirmed: true });
  assert.equal(remote.parts.get("decisions").version, 8);
  assert.equal(remote.parts.get("events").data[0].id, "new");
  assert.equal(remote.parts.get("events").data.length, 2001);
  assert.equal(store.savesPending(), 0);
});

test("a change made in place, without a new object, is still sent", async () => {
  const remote = server();
  seeded(remote);
  const { store, ledger } = await opened(remote);
  ledger.overrides.t9.code = "9999";
  ledger.legitimateDuplicates.push("b");
  assert.equal(await store.save(ledger), true);
  const data = remote.parts.get("decisions").data;
  assert.equal(data.overrides.t9.code, "9999");
  assert.deepEqual(data.legitimateDuplicates, ["a", "b"]);
  // And again: the copy kept after the first save is what the server holds.
  ledger.overrides.t9.code = "1111";
  assert.equal(await store.save(ledger), true);
  assert.equal(remote.parts.get("decisions").data.overrides.t9.code, "1111");
  assert.ok(saves(remote).every((one) => one.bytes < 1000));
});

test("several ticks while a save is on its way go in the next request, and all arrive", async () => {
  const remote = server({ delay: 30 });
  seeded(remote);
  const { store, ledger } = await opened(remote);
  let current = ledger;
  const all = [];
  for (let i = 0; i < 6; i++) {
    current = { ...current, overrides: { ...current.overrides, [`t${i}`]: { code: `C${i}`, confirmed: true } } };
    all.push(store.save(current));
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.deepEqual(await Promise.all(all), [true, true, true, true, true, true]);
  assert.ok(saves(remote).length < 6, `${saves(remote).length} requests for six ticks`);
  const held = remote.parts.get("decisions").data.overrides;
  for (let i = 0; i < 6; i++) assert.equal(held[`t${i}`].code, `C${i}`);
});

test("books changed elsewhere: refused, said once, and nothing half saved", async () => {
  const remote = server();
  seeded(remote);
  const { store, ledger, events, troubles } = await opened(remote);
  remote.parts.set("decisions", { ...remote.parts.get("decisions"), version: 99 });
  const next = { ...ledger, overrides: { ...ledger.overrides, t1: { code: "X" } } };
  const results = await Promise.all([store.save(next), store.saveEvents([{ id: "z" }, ...events])]);
  assert.deepEqual(results, [false, false]);
  assert.equal(remote.parts.get("events").data[0].id, "e0", "the history entry was not saved without its change");
  assert.ok(troubles.some((t) => t.kind === "conflict"));
  assert.equal(store.hasUnsavedChanges(), true);
});

test("a big change is sent whole", async () => {
  const remote = server();
  seeded(remote);
  const { store, ledger } = await opened(remote);
  const overrides = {};
  for (let i = 0; i < 3000; i++) overrides[`n${i}`] = { code: "200" };
  assert.equal(await store.save({ ...ledger, overrides }), true);
  const [change] = saves(remote)[0].body.p_changes;
  assert.ok("data" in change && !("ops" in change));
  assert.deepEqual(remote.parts.get("decisions").data.overrides, overrides);
});

test("new books, with nothing on the server yet, are sent whole", async () => {
  const remote = server();
  const { store, ledger } = await opened(remote);
  assert.equal(await store.save({ ...ledger, overrides: { a: { code: "1" } } }), true);
  const changes = saves(remote)[0].body.p_changes;
  assert.ok(changes.every((c) => "data" in c && c.version === 0));
  assert.deepEqual(remote.parts.get("decisions").data.overrides, { a: { code: "1" } });
  // And the next save is changes to it.
  assert.equal(await store.save({ ...ledger, overrides: { a: { code: "1" }, b: { code: "2" } } }), true);
  const last = saves(remote).at(-1).body.p_changes;
  assert.ok(last.every((c) => "ops" in c));
});

test("a project without save_part_changes saves each part whole, as before", async () => {
  const remote = server({ takesChanges: false });
  seeded(remote);
  const { store, ledger, events } = await opened(remote);
  const next = { ...ledger, overrides: { ...ledger.overrides, t5: { code: "4000" } } };
  assert.deepEqual(await Promise.all([store.save(next), store.saveEvents([{ id: "n" }, ...events])]), [true, true]);
  assert.equal(remote.parts.get("decisions").data.overrides.t5.code, "4000");
  assert.equal(remote.parts.get("events").data[0].id, "n");
  // Asked once; after that, straight to whole saves.
  assert.equal(await store.save({ ...next, overrides: { ...next.overrides, t6: { code: "1" } } }), true);
  assert.equal(saves(remote).filter((one) => one.where.endsWith("save_part_changes")).length, 1);
});

test("the null character goes up as its stand-in, in keys and values", async () => {
  const remote = server();
  seeded(remote);
  const { store, ledger } = await opened(remote);
  assert.equal(await store.save({ ...ledger, legitimateDuplicates: [...ledger.legitimateDuplicates, "a\u0000b"] }), true);
  assert.ok(JSON.stringify(saves(remote)[0].body).includes("ab"));
  assert.ok(!JSON.stringify(saves(remote)[0].body).includes("\\u0000"));
});

/** The page's books, as main.ts hands them to the store. */
function memoryFor(store, ledger, events) {
  const memory = { ledger, events, rules: undefined, shown: 0 };
  store.keepBooksInMemory({
    ledger: () => memory.ledger,
    setLedger: (next) => (memory.ledger = next),
    events: () => memory.events,
    setEvents: (next) => (memory.events = next),
    rules: () => memory.rules,
    setRules: (next) => (memory.rules = next),
    shown: () => (memory.shown += 1),
  });
  return memory;
}

/** Somebody else's save, made straight to the server. */
function elsewhere(remote, part, change) {
  const held = remote.parts.get(part);
  remote.parts.set(part, { version: held.version + 1, data: change(structuredClone(held.data)) });
}

test("somebody else saved in between: theirs is taken in, and this goes on top", async () => {
  const remote = server();
  seeded(remote);
  const { store, ledger, events, troubles } = await opened(remote);
  const memory = memoryFor(store, ledger, events);

  elsewhere(remote, "decisions", (d) => ({ ...d, overrides: { ...d.overrides, t9: { code: "THEIRS" } } }));
  elsewhere(remote, "events", (e) => [{ id: "theirs", kind: "coding", summary: "theirs" }, ...e]);

  memory.ledger = { ...memory.ledger, overrides: { ...memory.ledger.overrides, t5: { code: "MINE" } } };
  memory.events = [{ id: "mine", kind: "coding", summary: "mine" }, ...memory.events];
  const results = await Promise.all([store.save(memory.ledger), store.saveEvents(memory.events)]);
  assert.deepEqual(results, [true, true]);
  assert.deepEqual(troubles, []);

  const held = remote.parts.get("decisions").data.overrides;
  assert.equal(held.t5.code, "MINE");
  assert.equal(held.t9.code, "THEIRS");
  assert.deepEqual(remote.parts.get("events").data.slice(0, 3).map((e) => e.id), ["mine", "theirs", "e0"]);
  // The page now shows theirs too, and the next save builds on both.
  assert.equal(memory.ledger.overrides.t9.code, "THEIRS");
  assert.deepEqual(memory.events.slice(0, 2).map((e) => e.id), ["mine", "theirs"]);
  assert.equal(memory.shown, 1);
  memory.ledger = { ...memory.ledger, overrides: { ...memory.ledger.overrides, t6: { code: "NEXT" } } };
  assert.equal(await store.save(memory.ledger), true);
  assert.equal(remote.parts.get("decisions").data.overrides.t9.code, "THEIRS");
  assert.equal(remote.parts.get("decisions").data.overrides.t6.code, "NEXT");
});

test("both changed the same line: refused as before, and theirs is not overwritten", async () => {
  const remote = server();
  seeded(remote);
  const { store, ledger, events, troubles } = await opened(remote);
  const memory = memoryFor(store, ledger, events);
  elsewhere(remote, "decisions", (d) => ({ ...d, overrides: { ...d.overrides, t5: { code: "THEIRS" } } }));

  memory.ledger = { ...memory.ledger, overrides: { ...memory.ledger.overrides, t5: { code: "MINE" } } };
  assert.equal(await store.save(memory.ledger), false);
  assert.equal(remote.parts.get("decisions").data.overrides.t5.code, "THEIRS");
  assert.ok(troubles.some((t) => t.kind === "conflict"));
  assert.equal(memory.ledger.overrides.t5.code, "MINE", "nothing in memory was changed");
  assert.equal(memory.shown, 0);
});

test("lock dates changed elsewhere and here: refused", async () => {
  const remote = server();
  seeded(remote);
  const { store, ledger, events } = await opened(remote);
  const memory = memoryFor(store, ledger, events);
  elsewhere(remote, "decisions", (d) => ({ ...d, lockDates: { all: "2025-03-31" } }));
  memory.ledger = { ...memory.ledger, lockDates: { all: "2023-03-31" } };
  assert.equal(await store.save(memory.ledger), false);
  assert.deepEqual(remote.parts.get("decisions").data.lockDates, { all: "2025-03-31" });
});

test("an undo here and a new entry there both stay in the history", async () => {
  const remote = server();
  seeded(remote);
  const { store, ledger, events } = await opened(remote);
  const memory = memoryFor(store, ledger, events);
  elsewhere(remote, "events", (e) => [{ id: "theirs" }, ...e]);
  memory.events = memory.events.map((e) => (e.id === "e3" ? { ...e, reverted: true } : e));
  assert.equal(await store.saveEvents(memory.events), true);
  const held = remote.parts.get("events").data;
  assert.equal(held[0].id, "theirs");
  assert.equal(held.find((e) => e.id === "e3").reverted, true);
  assert.equal(held.length, 2001);
});

test("without the page's books to take theirs into, refused as before", async () => {
  const remote = server();
  seeded(remote);
  const { store, ledger } = await opened(remote);
  elsewhere(remote, "decisions", (d) => ({ ...d, overrides: { ...d.overrides, t9: { code: "THEIRS" } } }));
  assert.equal(await store.save({ ...ledger, overrides: { ...ledger.overrides, t5: { code: "MINE" } } }), false);
  assert.equal(remote.parts.get("decisions").data.overrides.t5.code, "6100");
});
