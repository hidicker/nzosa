# Plan: your own AI app, working with NZOSA

Status: stages 1 and 2 built, 31 October 2026. Stage 3 not started.

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
   everything twice. Each suggestion is decided in the place it belongs —
   Reconcile, the split editor, the journal editor — not in a separate
   approval list.
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

## Stage 2 — books online, through a connector (built)

Books kept online have no folder for the MCP server to read, so the same
tools are offered from the server, as a **remote connector**: Claude (web,
desktop, phone), ChatGPT and any app that takes a remote MCP server with
sign-in can connect with nothing to install.

- **The address**, one per set of books, is on the AI page:
  `https://<project>.supabase.co/functions/v1/mcp/<book id>`.
- **Sign-in** is Supabase's OAuth 2.1 server, with dynamic registration (how
  Claude and ChatGPT register themselves). The app connecting is sent to
  NZOSA's own consent screen (`/nzosa/oauth/consent`, answered by
  `connect-consent.ts`): the person signs in if need be, sees what the app
  may and may not do, and allows or denies.
- **The connector** (`supabase/functions/mcp`) checks the token with Auth,
  checks the person is a member of those books (and not past their access
  date), loads the parts, and answers with the very same tools as stage 1
  (`packages/mcp`, bundled in). A read-only member gets the read tools only.
  What is suggested is added to the part `suggested` by `suggested_add`,
  under the row's lock, so two chats suggesting at once both land.
- **What an outside app's token cannot do.** Such a token is a sign-in for
  the person, and would otherwise reach everything the app can. It carries
  the app's `client_id`, so every database request through the API that
  comes with one is refused (PostgREST's pre-request hook,
  `refuse_outside_apps`), and membership is never granted to one
  (`is_member`, `has_role`). The connector is the only way in: read, and
  suggest. Migration `20261031120000_outside_apps.sql`.
- **In NZOSA**, the page reads `suggested` every 30 seconds and on focus,
  and suggestions land as in stage 1.

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
- `packages/mcp/src/source.ts`, `hosted.ts` — books read from a folder or handed over by the server.
- `supabase/functions/mcp/index.ts` — the connector; `tools/build-mcp-function.mjs` bundles the tools into it.
- `supabase/migrations/20261031120000_outside_apps.sql` — the `suggested` part, `suggested_add`, and the guard.
- `apps/web/src/connect-consent.ts`, `public/oauth/consent/` — the consent screen.
- `apps/web/src/daily/own-ai-panel.ts` — the AI page section, for both kinds of books.
