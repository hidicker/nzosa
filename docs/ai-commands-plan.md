# Plan: asking for things in words (AI commands trial)

Status: plan for review, 31 October 2026. Nothing built yet.

## The idea

A person types what they want — "show me unpaid invoices", "paid $230 incl
GST for shuttle fuel on the 15th", "split this 50/50 between equipment and
site fees" — and the app goes to the right page and fills in the form it
already has. Nothing is saved until the person confirms it there, the same
as if they had typed it themselves.

The model only works out *what was asked* and *with which values*. Every
figure that reaches the books — GST, totals, the two sides of an entry, the
parts of a split — is worked out by the code that works it out today, and
every check that runs today (locked periods, balancing, known accounts)
runs on the draft before it is shown.

## What this trial is not

- Not a second AI system. It goes through the AI connection the app has:
  the key in Supabase Vault for books online, the key file for books in a
  folder, the same consent switch (`aiEnabled`), the same daily limit.
  No `.env` key and no new localhost-only endpoint: those would work on one
  machine and never in the live app.
- Not a new panel taking a quarter of the screen. Reports are wide and the
  phone menu was just made to slide out; a docked rail fights both.
- Not a new approval card. The draft is the real form, filled in.
- Nothing is posted by the model, ever.

## Where it goes in the page

The search box at the top (`#menu-search`, Ctrl+K) already finds pages and
reports. It becomes the place to type a request too: what matches a page or
report is offered as now, and below the matches one more line — "Ask: <what
was typed>" — sends it as a request. One box, one shortcut, nothing new to
learn, and it works the same on a phone.

The answer shows as one line under the box ("Showing unpaid invoices",
"Drafted in Quick entry — check it and press Save"), with the page behind
already changed.

## The three requests in the trial

### A. Go somewhere and narrow it down

"Show me unpaid invoices", "lines from Z Energy last month", "what's still
to code".

- Pages: `showPage(page)` in `apps/web/src/app.ts`.
- Reconcile already has what is needed: `#reconcile-search` and
  `#reconcile-filter` (to confirm, suggested, AI suggested, nothing
  suggested, coded, between entities, all). The request sets those two and
  redraws.
- Invoices and Bills have only a search box (`#invoice-search`). This needs
  a small "Show: all / unpaid / overdue / paid" choice added to those pages
  first — worth having on its own, by hand, before any AI uses it.
- Dates ("last month") are turned into a range by our code from the words
  the model returns (`"last-month"`, `"this-gst-period"`, a from/to pair),
  not worked out by the model.

### B. A spend or a sale, drafted

"Paid $230 incl GST for shuttle fuel on the 15th."

- Goes to Quick entry (`openQuickEntry("purchase")` in
  `apps/web/src/daily/quick-entry.ts`) and fills one row: date, contact,
  description, account, tax type, amount.
- The model returns: amount as written, whether it said incl/excl GST,
  date words, payee, what it was for, and an account **chosen from the
  chart's own list** (see "Keeping it to real accounts").
- Our code turns "the 15th" into a date (the 15th of this month, or last
  month if that is still ahead), applies the GST rule the row already
  applies, and checks the date is not in a locked period
  (`apps/web/src/daily/lock-dates.ts`). A locked date is said on the row,
  not quietly moved.
- Receipts (a photo or PDF dropped on the box) are the second step, not the
  first: `aiReadDocument` already reads a document and could fill the same
  row, but it is a separate thing to get right.

### C. Do something to the line in front of you

On Reconcile, with a line selected: "split this 50/50 between equipment
and site fees".

- Reconcile has no "selected line" today. The trial adds one: the row a
  person last clicked or tabbed into is marked as the current line (and
  shown so). The request sends that line's id, amount, date and payee —
  not the rest of the books. With no current line it says so and asks for
  one to be clicked.
- Opens the split editor already there (`splitEditor` in
  `apps/web/src/split-ui.ts`, reached through `state.splitting`) with the
  parts filled in.
- The cents are divided by our code (`splitByShare` in
  `packages/core/src/ir7.ts` already divides by percentages without losing
  a cent), and `validateSplits` in `packages/core/src/splits.ts` must pass
  before it is shown. The person confirms the split as now.

## Keeping it to real accounts

The app already has a tool-calling conversation with Gemini
(`aiConverse` in `apps/web/src/ai-backend.ts`, the `converse` action of
`supabase/functions/gemini`). The trial uses it with one tool per request:

- `show_page { page, filter, search, period }` — `page` and `filter` are
  enums of what exists.
- `draft_entry { kind, date_words, payee, description, amount, gst, account }`
  — `account` is an enum of this entity's chart codes, built when asked;
  `gst` is `incl | excl | none`.
- `split_selected { parts: [{ share, account }] }` — `account` the same enum.

The model cannot name an account the chart does not have, and anything it
returns is checked again on our side regardless. A request it cannot fit to
one of the three is answered "I can only do these three for now" with the
three listed, not guessed at.

## What is sent, and when

Only when AI is switched on for these books, as for every other AI feature.
Each request sends: the words typed, the page it was typed on, the chart's
codes and names, and for C the one selected line. Not the ledger, not other
lines, not contacts.

The online demo and books kept in a browser have no tool-calling route
today (`aiConverse` refuses there). For the trial they get the fallback
below; whether the shared demo key should take these requests is a later
question.

## Without a key: the fallback

A plain pattern reader for the three kinds of request ("show … invoices",
"$N incl GST for … on the Nth", "split this N/M between … and …") that
returns the same tool call the model would. It is what the tests use, so
the page choreography is tested without a model, and what the demo uses.

## Showing what was filled

- A field filled by a request gets a short highlight (`.ai-filled`, about
  1.5 s, in the warning colour already used) and keeps a small "Filled from
  your request" note until it is saved or changed.
- A row picked out by a request (the line being split) gets the same
  highlight.
- Nothing about "AI preview" or "draft pending" in the wording: it is the
  form, filled in, waiting to be saved like any other.

## Order of work

1. Invoices and Bills: the "Show: unpaid / overdue / paid" choice, by hand.
2. The search box offers "Ask: …" and shows the one-line answer.
3. The fallback reader and request A, end to end, with tests.
4. Request B into Quick entry, with the date, GST and lock checks.
5. Request C into the split editor.
6. The model route (tools with chart enums) behind the same three, and a
   test that whatever it returns is checked as the fallback's is.
7. Try it on 28OctTest and TestOnline; NZ parity before anything ships.

Each step is usable on its own; 1 ships whether or not the rest does.

## Questions for you

- Is the search box the right home, or would you rather a separate "Ask"
  button beside it?
- Request B into Quick entry (a bill of one line) — or should a spend paid
  from the bank go to Reconcile instead, matched to its bank line?
- Should the demo's shared key take these requests, or stay on the
  fallback?
