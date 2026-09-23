/**
 * Talking to an MCP server, and translating what it offers into what a model
 * can be handed.
 *
 * Gemini has no connector for this. Anthropic's API and OpenAI's will take the
 * address of a remote MCP server and do the rest themselves; Google's will
 * not, which is why asking Gemini for the OpenAccountants connector gets "not
 * available to me" rather than an answer. So the client is here: list the
 * server's tools, describe them to the model as functions it may call, and
 * carry each call across and each result back.
 *
 * Nothing here knows what the tools are for. A tool is a name, a description
 * and a schema, and the model chooses; that is the whole point of the
 * protocol, and hard-coding which guide to fetch would throw it away.
 *
 * No transport of its own: one POST per message, which is the plain half of
 * MCP's streamable HTTP. Servers may answer with an event stream instead, so
 * both shapes are read.
 */

export interface McpTool {
  name: string;
  description: string;
  /** JSON Schema for the arguments, as the server gave it. */
  inputSchema: Record<string, unknown>;
}

export interface McpSession {
  url: string;
  /** What the server called itself, for saying where an answer came from. */
  serverName: string;
  /** The server's own instructions, which are guidance for the model. */
  instructions: string;
  /** Carried on every later message, when the server asked for one. */
  sessionId: string;
  protocolVersion: string;
}

/** How a request is made. Passed in so tests need no network. */
export type Fetcher = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get: (name: string) => string | null };
  text: () => Promise<string>;
}>;

const PROTOCOL = "2025-06-18";

/**
 * Read one JSON-RPC reply, whichever way the server chose to send it.
 *
 * A server may answer a POST with plain JSON or with an event stream carrying
 * the same object in a `data:` line. Both are legal and a server may switch
 * between them, so neither is assumed.
 */
export function readRpcBody(body: string, contentType: string): unknown {
  const text = body.trim();
  if (text === "") return null;
  if (!contentType.includes("event-stream") && !text.startsWith("event:")) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
  // The last data: line that parses is the answer; earlier ones are progress.
  let found: unknown = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    try {
      const parsed: unknown = JSON.parse(line.slice(5).trim());
      if (parsed !== null && typeof parsed === "object" && "jsonrpc" in parsed) found = parsed;
    } catch {
      // A partial frame. The next one usually completes it.
    }
  }
  return found;
}

interface RpcReply {
  result?: Record<string, unknown>;
  error?: { code?: number; message?: string };
}

async function rpc(
  fetcher: Fetcher,
  url: string,
  message: Record<string, unknown>,
  sessionId: string,
  protocolVersion: string,
): Promise<{ reply: RpcReply | null; sessionId: string }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (sessionId !== "") headers["mcp-session-id"] = sessionId;
  // No mcp-protocol-version header, deliberately.
  //
  // The spec has one, and sending it from a browser is what stopped this
  // working: a cross-origin request carrying a header the server does not
  // name in access-control-allow-headers never leaves the browser at all --
  // the preflight refuses it and fetch reports only "Failed to fetch", with
  // no status to read. OpenAccountants allows Content-Type, Accept,
  // Mcp-Session-Id and Authorization, and not that one. Node does not
  // enforce CORS, so it worked everywhere except where it had to.
  //
  // Nothing is lost by leaving it out: the version was agreed in the
  // handshake and the session id is what the server matches the conversation
  // by. It is kept on the session for anything that needs to know.

  const response = await fetcher(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", ...message }),
  });
  const given = response.headers.get("mcp-session-id") ?? "";
  const body = await response.text();
  if (!response.ok) {
    // The server's own words where it gave any: "rate limited" is worth more
    // than "HTTP 429", and this is shown to a person.
    const said = readRpcBody(body, response.headers.get("content-type") ?? "");
    const message_ =
      said !== null && typeof said === "object" && "error" in said
        ? ((said as RpcReply).error?.message ?? "")
        : "";
    throw new Error(
      message_ !== "" ? message_ : `The guide library answered ${response.status}.`,
    );
  }
  const parsed = readRpcBody(body, response.headers.get("content-type") ?? "");
  return {
    reply: parsed as RpcReply | null,
    sessionId: given !== "" ? given : sessionId,
  };
}

/** Open a session: the handshake, and the note that says it is complete. */
export async function openMcp(url: string, fetcher: Fetcher): Promise<McpSession> {
  const { reply, sessionId } = await rpc(
    fetcher,
    url,
    {
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: PROTOCOL,
        capabilities: {},
        clientInfo: { name: "nzosa", version: "1" },
      },
    },
    "",
    "",
  );
  if (reply?.error !== undefined) throw new Error(reply.error.message ?? "refused the handshake");
  const result = reply?.result ?? {};
  const info = (result["serverInfo"] ?? {}) as { name?: string; title?: string };
  const session: McpSession = {
    url,
    serverName: info.title ?? info.name ?? "the guide library",
    instructions: String(result["instructions"] ?? ""),
    sessionId,
    protocolVersion: String(result["protocolVersion"] ?? PROTOCOL),
  };

  // Required by the protocol, and a notification, so there is no reply to
  // wait for and nothing useful to do if it fails.
  try {
    await rpc(
      fetcher,
      url,
      { method: "notifications/initialized" },
      session.sessionId,
      session.protocolVersion,
    );
  } catch {
    // Some servers close the response on a notification. Harmless.
  }
  return session;
}

export async function mcpTools(session: McpSession, fetcher: Fetcher): Promise<McpTool[]> {
  const { reply } = await rpc(
    fetcher,
    session.url,
    { id: 2, method: "tools/list", params: {} },
    session.sessionId,
    session.protocolVersion,
  );
  if (reply?.error !== undefined) throw new Error(reply.error.message ?? "would not list tools");
  const tools = (reply?.result?.["tools"] ?? []) as {
    name?: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
  }[];
  return tools
    .filter((tool) => typeof tool.name === "string" && tool.name !== "")
    .map((tool) => ({
      name: tool.name as string,
      description: tool.description ?? "",
      inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
    }));
}

export interface McpAnswer {
  text: string;
  isError: boolean;
}

export async function callMcpTool(
  session: McpSession,
  fetcher: Fetcher,
  name: string,
  args: Record<string, unknown>,
): Promise<McpAnswer> {
  const { reply } = await rpc(
    fetcher,
    session.url,
    { id: 3, method: "tools/call", params: { name, arguments: args } },
    session.sessionId,
    session.protocolVersion,
  );
  // A refusal is an answer, not a crash: the model asked for something the
  // server would not give, and telling it so is how it tries something else.
  if (reply?.error !== undefined) {
    return { text: reply.error.message ?? "that call was refused", isError: true };
  }
  const result = reply?.result ?? {};
  const content = (result["content"] ?? []) as { type?: string; text?: string }[];
  const text = content
    .filter((part) => part.type === undefined || part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n")
    .trim();
  return {
    text: text === "" ? "(the guide library returned nothing)" : text,
    isError: result["isError"] === true,
  };
}

/**
 * An MCP tool as a function the model may call.
 *
 * Gemini rejects a schema carrying keywords it does not know -- `$schema`,
 * `additionalProperties` and the rest -- with a 400 naming the field, so the
 * schema is rebuilt from the parts it does accept rather than passed through.
 * A tool whose arguments cannot be expressed that way is still offered with no
 * arguments, which is right for this server: its front doors take none.
 */
export function asGeminiFunction(tool: McpTool): Record<string, unknown> {
  return {
    name: tool.name,
    // Trimmed, because these run to paragraphs and fourteen of them at full
    // length is a prompt of its own before the books are even described.
    description: tool.description.slice(0, 900),
    parameters: cleanSchema(tool.inputSchema),
  };
}

const ALLOWED = new Set([
  "type",
  "description",
  "enum",
  "items",
  "properties",
  "required",
  "nullable",
]);

/** The parts of a JSON Schema that Gemini will accept, and nothing else. */
export function cleanSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (!ALLOWED.has(key)) continue;
    if (key === "properties" && value !== null && typeof value === "object") {
      const properties: Record<string, unknown> = {};
      for (const [name, sub] of Object.entries(value as Record<string, unknown>)) {
        properties[name] =
          sub !== null && typeof sub === "object"
            ? cleanSchema(sub as Record<string, unknown>)
            : {};
      }
      out["properties"] = properties;
    } else if (key === "items" && value !== null && typeof value === "object") {
      out["items"] = cleanSchema(value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  if (out["type"] === undefined) out["type"] = "object";
  // Gemini refuses an object with an empty properties map, so a tool that
  // takes nothing is described as taking nothing rather than as an object
  // with no fields.
  if (
    out["type"] === "object" &&
    (out["properties"] === undefined ||
      Object.keys(out["properties"] as Record<string, unknown>).length === 0)
  ) {
    return { type: "object", properties: {} };
  }
  return out;
}
