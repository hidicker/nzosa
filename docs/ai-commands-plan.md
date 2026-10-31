# Plan: your own AI app, working with NZOSA

Status: stage 1 built, 31 October 2026. Stages 2 and 3 not started.

## The idea

People already have an AI app they like: Claude on their computer or phone,
ChatGPT, Cursor. Rather than build a chat box into NZOSA with a model we pay
for, NZOSA lets the app they already use look at their books and *suggest*
changes. The person then uses or declines each suggestion in NZOSA, where it
goes through the same checks as if they had typed it.

So the AI does the reading and the thinking, in the app the person chose,
on their own subscription. NZOSA keeps the books, the arithmetic and the
final say.

An earlier draft of this plan put a chat box inside NZOSA, driven by Gemini.
It was set aside: it would have been a second AI system beside the one the
app has, cost NZOSA per request, and taken screen space the reports need.

## The rules it keeps

1. **The AI never changes the books.** It suggests. The books change only
   when a person presses Save or the tick in NZOSA.
2. **NZOSA does the arithmetic.** GST, totals, the two sides of a journal,
   the parts of a split: worked out and checked by NZOSA's own code, never
   taken on trust from the model.
3. **Real accounts only.** A suggestion naming an account the books do not
   have is refused before it is kept.
4. **Nothing in a locked period.** Refused before it is kept, and checked
   again when it is used.
5. **Suggestions are change sets.** Several made together are one set, and
   the same set sent twice is kept once, so a retried call cannot suggest
   everything twice. (Prosaic's public API does the same with what it calls
   change-sets: agent-proposed writes, held pending until an admin approves
   them. NZOSA goes one step further: each suggestion is decided in the
   place it belongs, not in a separate approval list.)
6. **The person can see who suggested it.** Every suggestion carries the
   name the app gives itself ("Claude"), and the page says so.

## Stage 1 — books in a folder, through the MCP server (built)

The NZOSA books MCP server (`packages/mcp`) could already read: entities,
transactions, what is uncoded, coding progress, daily balances. It now also:

- `list_accounts` — every account the books can code to, by the name NZOSA
  uses. Read-only, always offered.
- With `--suggest` (the "Let Claude suggest" setting in the Claude Desktop
  extension, off unless turned on):
  - `suggest_codes` — accounts for uncoded lines, up to 200 at a time.
  - `suggest_split` — one line split between accounts; the parts must add
    up to the line to the cent.
  - `suggest_journal` — a manual journal; debits must equal credits.
  - `show_in_app` — bring up a page in NZOSA, with its search filled in.
  - `list_suggestions` — what is still waiting for the person.

Each is kept in `suggested.json` beside the books. Only the MCP server
writes that file; the app only reads it, and keeps what it has done with
each suggestion in the books' decisions (`suggestionsHandled`). One writer
per file, so a suggestion cannot be lost to two programs saving at once.

In NZOSA, while it is open (it looks every few seconds, and on focus):

- **Codes** go on their lines on Reconcile as suggestions — "AI suggestion
  (Claude) · because …" — to tick or change, like any other. They are kept
  with the morning run's suggestions, so a reload does not lose them.
- **Splits and journals** wait on Actions required under "Suggested by
  Claude", each with Open and Decline. Open puts the split in the split
  editor on its line, or the journal in the journal editor, filled in; Save
  is the person's.
- **A page asked for** in the last two minutes is brought up; an older
  request is let go.

What a person does to set it up: install the NZOSA books extension in
Claude Desktop (or add the server by hand), choose the books folder, and
turn on "Let Claude suggest". Then, in Claude: "go through this month's
uncoded lines and suggest codes", and open Reconcile.

Tested: the MCP tests (every refusal: coded line, locked line, unknown
line or account, split out by cents, journal out of balance, retried set),
the shared format in core, and end to end on a copy of the 28OctTest books
— the real server suggesting, the app showing each suggestion in its place,
a journal opened and saved, a split opened filled in.

## Stage 2 — books online (not started; needs your approval)

Books kept online (Supabase) have no folder for the MCP server to read.
They need the same tools offered from the server:

- A `suggested` book part, written only by a new edge function.
- A **remote MCP connector**: an edge function speaking MCP over HTTP,
  signed in with the person's NZOSA account (OAuth), so Claude.ai, Claude
  Desktop and Claude on a phone can add "NZOSA" as a connector with nothing
  to install.
- A **read-and-suggest token** for it: it can read the books and add
  suggestions, and nothing else — the line Prosaic draws with its read-only
  token that may write only change-sets.
- Rate limits per book, and the person's members and roles respected (a
  member who may only read gets read-only tools).

This changes production Supabase (a new part, a function, sign-in for an
outside app), so it waits for your go-ahead.

## Stage 3 — later

- Copy and paste for any AI app: "Copy for your AI" on a page (the lines,
  the account names, what to answer in), and "Paste the answer" read into
  the same suggestions. No setup, nothing sent unless pasted.
- Re-coding lines a rule has already coded, with the rule shown beside the
  suggestion. Today only uncoded lines take one.
- Suggested invoices and bills (drafts in the invoice editor).

## Files

- `packages/core/src/suggested.ts` — the format, change-set ids, what is waiting.
- `packages/mcp/src/suggest-tools.ts` — the tools and their checks.
- `packages/mcp/src/sandbox.ts` — the one file the server may write.
- `apps/web/server.js` — `GET /api/suggested`, read-only.
- `apps/web/src/suggested-inbox.ts` — taking suggestions in, and the Actions section.
- `tools/build-mcpb.mjs` — the Claude Desktop extension and its setting.
