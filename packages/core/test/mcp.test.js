import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asGeminiFunction,
  callMcpTool,
  cleanSchema,
  mcpTools,
  openMcp,
  readRpcBody,
} from "../dist/mcp.js";

/**
 * A server that answers from a script, so none of this touches the network.
 *
 * It records what it was sent, because the headers are half of what the
 * protocol asks for: a session id that is not carried is a session the server
 * has already forgotten.
 */
function fakeServer(replies, options = {}) {
  const sent = [];
  let turn = 0;
  const fetcher = async (url, init) => {
    sent.push({ url, headers: init.headers, body: JSON.parse(init.body ?? "null") });
    const reply = replies[Math.min(turn, replies.length - 1)];
    turn += 1;
    const headers = new Map(Object.entries(reply.headers ?? {}));
    return {
      ok: reply.status === undefined || reply.status < 400,
      status: reply.status ?? 200,
      headers: { get: (name) => headers.get(name.toLowerCase()) ?? null },
      text: async () => reply.body ?? "",
    };
  };
  return { fetcher, sent, options };
}

const HELLO = {
  headers: { "content-type": "application/json", "mcp-session-id": "sess-abc" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: {
      protocolVersion: "2025-03-26",
      serverInfo: { name: "ledger-guides", title: "Ledger Guides" },
      instructions: "Cite the guide you used.",
    },
  }),
};

test("a plain JSON reply is read", () => {
  const got = readRpcBody('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}', "application/json");
  assert.equal(got.result.ok, true);
});

test("the same reply arriving as an event stream is read the same way", () => {
  const stream = 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n\n';
  const got = readRpcBody(stream, "text/event-stream");
  assert.equal(got.result.ok, true);
});

test("a half-written frame before the real one does not lose the answer", () => {
  const stream =
    'data: {"jsonrpc":"2.0","id":1,"resul\n' +
    'data: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n';
  assert.equal(readRpcBody(stream, "text/event-stream").result.ok, true);
});

test("nothing readable is null rather than a thrown error", () => {
  assert.equal(readRpcBody("", "application/json"), null);
  assert.equal(readRpcBody("<html>no</html>", "application/json"), null);
});

test("the handshake keeps the session id the server gave", async () => {
  const { fetcher, sent } = fakeServer([HELLO, { body: "" }]);
  const session = await openMcp("https://guides.example/api/mcp", fetcher);
  assert.equal(session.sessionId, "sess-abc");
  assert.equal(session.serverName, "Ledger Guides");
  assert.equal(session.instructions, "Cite the guide you used.");
  assert.equal(session.protocolVersion, "2025-03-26");
  // The second message is the required notification, and it carries the id.
  assert.equal(sent[1].body.method, "notifications/initialized");
  assert.equal(sent[1].headers["mcp-session-id"], "sess-abc");
});

test("a server that hangs up on the notification still gives a session", async () => {
  let turn = 0;
  const fetcher = async () => {
    turn += 1;
    if (turn === 2) throw new Error("socket closed");
    return {
      ok: true,
      status: 200,
      headers: { get: (n) => (n.toLowerCase() === "mcp-session-id" ? "sess-abc" : "application/json") },
      text: async () => HELLO.body,
    };
  };
  const session = await openMcp("https://guides.example/api/mcp", fetcher);
  assert.equal(session.sessionId, "sess-abc");
});

test("tools come back named, and the session id goes with the request", async () => {
  const { fetcher, sent } = fakeServer([
    HELLO,
    { body: "" },
    {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        result: {
          tools: [
            { name: "find_guide", description: "Search the guides.", inputSchema: { type: "object" } },
            { name: "", description: "nameless, and dropped" },
          ],
        },
      }),
    },
  ]);
  const session = await openMcp("https://guides.example/api/mcp", fetcher);
  const tools = await mcpTools(session, fetcher);
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, "find_guide");
  assert.equal(sent[2].headers["mcp-session-id"], "sess-abc");
});

test("no protocol-version header, because a browser would never send it", async () => {
  // A cross-origin request carrying a header the server does not allow is
  // refused at the preflight and never goes out -- and fetch reports that as
  // "Failed to fetch", with no status. OpenAccountants allows Content-Type,
  // Accept, Mcp-Session-Id and Authorization. This is the one that broke it.
  const { fetcher, sent } = fakeServer([
    HELLO,
    { body: "" },
    {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, result: { tools: [] } }),
    },
  ]);
  const session = await openMcp("https://guides.example/api/mcp", fetcher);
  await mcpTools(session, fetcher);
  for (const one of sent) {
    const names = Object.keys(one.headers).map((n) => n.toLowerCase());
    assert.ok(!names.includes("mcp-protocol-version"), `sent ${names.join(", ")}`);
    for (const name of names) {
      assert.ok(
        ["content-type", "accept", "mcp-session-id"].includes(name),
        `${name} is not on the server's allow list`,
      );
    }
  }
});

test("a tool's answer comes back as its text", async () => {
  const { fetcher } = fakeServer([
    HELLO,
    { body: "" },
    {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        result: { content: [{ type: "text", text: "Keep a logbook for 90 days." }] },
      }),
    },
  ]);
  const session = await openMcp("https://guides.example/api/mcp", fetcher);
  const answer = await callMcpTool(session, fetcher, "find_guide", { query: "logbook" });
  assert.equal(answer.text, "Keep a logbook for 90 days.");
  assert.equal(answer.isError, false);
});

test("a refused call is an answer the model can read, not a crash", async () => {
  const { fetcher } = fakeServer([
    HELLO,
    { body: "" },
    {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        error: { code: -32602, message: "unknown tool" },
      }),
    },
  ]);
  const session = await openMcp("https://guides.example/api/mcp", fetcher);
  const answer = await callMcpTool(session, fetcher, "nope", {});
  assert.equal(answer.isError, true);
  assert.equal(answer.text, "unknown tool");
});

test("an HTTP failure says what the server said, not just the number", async () => {
  const { fetcher } = fakeServer([
    {
      status: 429,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", error: { message: "Too many requests this minute." } }),
    },
  ]);
  await assert.rejects(
    () => openMcp("https://guides.example/api/mcp", fetcher),
    /Too many requests this minute/,
  );
});

test("a schema is stripped to what the model will accept", () => {
  const cleaned = cleanSchema({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    additionalProperties: false,
    type: "object",
    properties: {
      jurisdiction: { type: "string", description: "ISO code", pattern: "^[A-Z]{2}$" },
      domains: { type: "array", items: { type: "string", minLength: 1 } },
    },
    required: ["jurisdiction"],
  });
  assert.deepEqual(Object.keys(cleaned).sort(), ["properties", "required", "type"]);
  assert.deepEqual(Object.keys(cleaned.properties.jurisdiction).sort(), ["description", "type"]);
  assert.deepEqual(cleaned.properties.domains.items, { type: "string" });
});

test("a tool that takes nothing is described as taking nothing", () => {
  assert.deepEqual(cleanSchema({ type: "object", properties: {} }), {
    type: "object",
    properties: {},
  });
});

test("a very long tool description is cut before it becomes the prompt", () => {
  const offered = asGeminiFunction({
    name: "find_guide",
    description: "x".repeat(4000),
    inputSchema: { type: "object", properties: { q: { type: "string" } } },
  });
  assert.equal(offered.name, "find_guide");
  assert.equal(offered.description.length, 900);
  assert.deepEqual(offered.parameters.properties.q, { type: "string" });
});
