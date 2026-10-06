import { aiConverse } from "./ai-backend.js";
import { OPENACCOUNTANTS_MCP } from "./ai-review.js";
import {
  asGeminiFunction,
  callMcpTool,
  mcpTools,
  openMcp,
  type McpSession,
  type McpTool,
} from "@nzosa/core";

/**
 * Running the year-end review with the guide library actually connected.
 *
 * The model is not given the library's address and left to it. Gemini has no
 * connector for MCP -- Anthropic's API and OpenAI's will take a server's URL
 * and do the rest, Google's will not, which is exactly what it says when
 * asked -- so the client is ours: list the tools, describe them as functions
 * the model may call, and carry each call across and each result back until
 * it stops asking and answers.
 *
 * It runs here, in the page, rather than on either server. The library is a
 * public HTTP endpoint that allows browser requests, the loop is then written
 * once instead of twice in two languages, and the only thing that has to stay
 * behind a server is the key. It also means the library is reached from this
 * machine: it sees the questions the model asks it -- "motor vehicle logbook,
 * NZ" -- and never the books, which go to Google and nowhere else.
 */

/** As many turns as a thorough review takes, and no more. */
const MOST_TURNS = 12;

/** How much of one tool's answer goes back. A whole guide is a book. */
const MOST_PER_ANSWER = 24000;

export interface ReviewProgress {
  /** Said to the person while they wait, because this takes a while. */
  (said: string): void;
}

export interface ReviewResult {
  text: string;
  /** Which guides were actually consulted, in the order they were asked for. */
  consulted: string[];
  /** True where the library was reached at all. */
  connected: boolean;
  error?: string;
}

interface Part {
  text?: string;
  functionCall?: { name?: string; args?: Record<string, unknown> };
}

const fetcher = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) =>
  fetch(url, init);

/**
 * Open the library and describe what it offers.
 *
 * Failing here is not failing the review. A library that is down, rate
 * limited or blocked by a browser leaves the model answering from training
 * data, which is worth less but is not nothing -- as long as the answer says
 * so, which is what `connected` is for.
 */
async function connect(): Promise<{ session: McpSession; tools: McpTool[] } | null> {
  try {
    const session = await openMcp(OPENACCOUNTANTS_MCP, fetcher);
    const tools = await mcpTools(session, fetcher);
    return tools.length === 0 ? null : { session, tools };
  } catch {
    return null;
  }
}

/** A short name for a call, for the list of what was consulted. */
function nameOfCall(name: string, args: Record<string, unknown>): string {
  const said = String(args["slug"] ?? args["query"] ?? args["intent"] ?? args["jurisdiction"] ?? "");
  return said === "" ? name : `${name}: ${said}`;
}

export async function runReview(
  prompt: string,
  say: ReviewProgress,
): Promise<ReviewResult> {
  say("Opening the guide library…");
  const library = await connect();
  const consulted: string[] = [];

  if (library === null) {
    say("The guide library could not be reached. Asking anyway, and saying so.");
  } else {
    say(`${library.tools.length} tools offered. Asking the model…`);
  }

  const tools = library === null ? [] : library.tools.map(asGeminiFunction);
  const contents: { role: string; parts: unknown[] }[] = [
    {
      role: "user",
      parts: [
        {
          text:
            library === null
              ? prompt +
                "\n\nThe guide library is NOT connected for this run. Say that plainly at the " +
                "top of your answer, and do not cite guides as though you had read them."
              : prompt +
                "\n\nThe guide library is connected and you may call its tools. Look things " +
                "up rather than answering from memory, and cite the guide you used.",
        },
      ],
    },
  ];

  let said = "";
  // The library allows three lookups to anyone not signed in. The model is
  // told what happened and works around it, and the answer says which guides
  // it could not reach -- but somebody watching a progress line deserves to
  // know why the lookups stopped rather than to wonder.
  let ranOut = false;
  for (let turn = 0; turn < MOST_TURNS; turn += 1) {
    const answer = await aiConverse(contents, tools);
    if (answer.error !== undefined) {
      return { text: said, consulted, connected: library !== null, error: answer.error };
    }

    const parts = (answer.parts ?? []) as Part[];
    const calls = parts.filter((part) => part.functionCall?.name !== undefined);
    said += parts
      .map((part) => part.text ?? "")
      .filter((text) => text !== "")
      .join("\n");

    // Nothing more to fetch: this turn is the answer.
    if (calls.length === 0 || library === null) break;

    contents.push({ role: "model", parts: parts as unknown[] });

    const results: unknown[] = [];
    for (const call of calls) {
      const name = call.functionCall?.name ?? "";
      const args = call.functionCall?.args ?? {};
      consulted.push(nameOfCall(name, args));
      say(`Looking up ${nameOfCall(name, args)}…`);
      let result: { text: string; isError: boolean };
      try {
        result = await callMcpTool(library.session, fetcher, name, args);
      } catch (error) {
        // Told to the model rather than thrown. One lookup failing is
        // something it can work around; the whole review falling over
        // because a library was busy is not.
        result = { text: `That lookup failed: ${(error as Error).message}`, isError: true };
      }
      if (!ranOut && /free questions/i.test(result.text)) {
        ranOut = true;
        say(
          "The guide library's three free lookups are used up. Carrying on with what it " +
            "gave, and the answer will say which guides it could not reach.",
        );
      }
      results.push({
        functionResponse: {
          name,
          response: { content: result.text.slice(0, MOST_PER_ANSWER), isError: result.isError },
        },
      });
    }
    contents.push({ role: "user", parts: results });
    if (!ranOut) {
      say(`${consulted.length} lookup${consulted.length === 1 ? "" : "s"} so far. Thinking…`);
    }
  }

  if (said.trim() === "") {
    return {
      text: "",
      consulted,
      connected: library !== null,
      error:
        consulted.length >= MOST_TURNS
          ? "The model kept looking things up and never answered. Nothing has changed."
          : "The model returned nothing.",
    };
  }
  return { text: said.trim(), consulted, connected: library !== null };
}
