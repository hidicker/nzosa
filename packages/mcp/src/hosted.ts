import { BookShelf } from "./load.js";
import { handle } from "./protocol.js";
import type { Message } from "./protocol.js";
import { PartsSource } from "./source.js";

/**
 * The same tools, for books kept online: what the connector edge function
 * (supabase/functions/mcp) runs for each request. The function checks who is
 * asking and loads the books; this answers, and says what to save.
 */
export interface HostedRequest {
  /** One JSON-RPC message, or a batch of them. */
  body: unknown;
  /** The book's parts as the server holds them: transactions, decisions, entities, chart, rules, suggested. */
  parts: Readonly<Record<string, unknown>>;
  /** The books' name. */
  name: string;
  /** May this person suggest (not read-only in these books)? */
  suggest: boolean;
  /** Who is asking, as the app named itself when it was connected. */
  client: string;
}

export interface HostedAnswer {
  /** What to send back: one reply, a batch, or nothing (only notifications came). */
  reply: unknown;
  /** The suggestions to save as the part `suggested`, when any were made. */
  suggested: unknown;
}

export function answerHosted(request: HostedRequest): HostedAnswer {
  const source = new PartsSource(request.parts, request.name);
  const context = {
    shelf: new BookShelf(source),
    allowed: undefined,
    maxRows: 200,
    suggest: request.suggest,
    client: request.client,
  };
  const messages = Array.isArray(request.body) ? request.body : [request.body];
  const replies = messages
    .map((message) => handle(message as Message, context))
    .filter((reply) => reply !== undefined);
  return {
    reply: Array.isArray(request.body) ? (replies.length > 0 ? replies : undefined) : replies[0],
    suggested: source.written === undefined ? undefined : JSON.parse(source.written),
  };
}
