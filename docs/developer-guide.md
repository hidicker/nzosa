# NZOSA: a guide for developers

Architecture, data model, the invariants that must not be broken, and the
mistakes this codebase has already made so you do not repeat them.

---

## 1. Shape

```
packages/core    pure functions, zero dependencies, no I/O
packages/cli     the same core behind a command line
apps/web         browser app, esbuild bundle, no framework
tools/           the privacy audit, run before anything is pushed
```

**Core has no I/O and no ambient DOM or Node types.** Everything is a pure
function over strings and plain objects. That is what lets identical code run
in a browser tab with the file never leaving the machine, in a Node CLI, or
behind a server. Storage is the caller's problem, deliberately.

**Zero dependencies in core.** Including the `.xlsx` reader, which parses the
ZIP central directory by hand and inflates with `DecompressionStream`
(`deflate-raw`) — native in Node 18+ and every current browser.

The web app must remain deployable to a free static host: no backend, no build
step at runtime, no network calls from the page.

### Build and test

```bash
npm install
./node_modules/.bin/tsc --build          # typechecks every package
node --test packages/core/test/*.test.js # 339 tests
node --test packages/cli/test/*.test.js  # 18 more, over the command line
npm test                                 # both, through the workspaces
cd apps/web && node build.js             # bundle to apps/web/dist
cd apps/web && node build.js --serve     # dev server on :3210
```

### What persists, and what does not

Anything a person loaded or decided is kept with the ledger; only what can be
derived again, and the transient state of the page, lives in memory.

Kept with the ledger, each for the same reason -- anything else means
re-loading a file or re-picking a setting after every reload: the filed GST
returns (`filedReturns`, which the CLI writes and the page reads), the accounts
the GST comparison is scoped to, and the coded history loaded on the Coding
reconciliation page.

Restoring a value is not always enough. The GST comparison is *derived* from
the filed returns, so `recomputeVariance` runs at startup as well; restoring
the returns without recomputing leaves the page holding figures and showing
nothing.

Still memory-only, deliberately: the current page, the search boxes, the
reconcile account chips, the split being edited. Those are where you are, not
what you decided.

### The ledger folder is the truth

`apps/web/ledger-folder.js` and `apps/web/server.js` are the reason the files
on disk are the books rather than a copy of them. The page holds a working
copy and writes every change back before it counts as saved: no export step,
nothing to remember, and a folder that can be copied or backed up.

**One file per part.** `transactions.json` is written by an import and then
only read; `decisions.json` holds everything a person chose and changes on
every click. Keeping them apart is what makes writing on every change
affordable -- confirming a coding writes about seventy kilobytes rather than
rewriting two megabytes of transactions beside it. `store.ts` skips a part
whose object is the one it last sent, so "which parts changed" is recognised by
reference rather than declared by the caller.

**Every write is a rename.** `writePart` writes `.name.json.writing` and
renames it into place. A rename within a directory is atomic, so a crash leaves
either the old file or the new one, never half of either. That guarantee is
what makes it safe to call a file the truth.

**Versions and the lock.** Each part carries a counter, sent back with every
write, and a stale version is refused with a 409 rather than silently
overwritten. Nothing produces a conflict today -- the server holds `.open-by`
while it runs and the command line refuses -- but this is the seam a shared
ledger would need, and it is far cheaper carried unused than retrofitted once
two people share a ledger.

**The command line reads that folder.** `loadLedger` in `packages/cli` takes a
directory as well as a file: each part read from its own `{ version, data }`
file, `decisions` spread out flat the way the app holds it in memory. It also
reads the `rules.json` sitting beside the books, so a return produced from the
terminal is built from the same rules the app coded with — and the chart, so it
is built with the same tax codes. Anything less and the two halves answer the
same question differently, which is worse than one of them refusing.

Writing is refused, with a message saying so. The app writes each part
separately with its own version counter, and one file dropped into the middle
of that folder would be ignored by the app and would look, to the next person,
like the books. `ledger.json` inside a ledger folder is metadata — the name and
the date it was made — and reading it as the books is the mistake that made
every real folder look like an unknown version.

**Clearing archives.** `POST /api/ledger/archive` moves every file into
`archive/<timestamp>/`. The ledger is gone and there is nothing left to reload
from, which is the point: a clear that empties the browser but leaves the files
on disk refills itself from `data/` on the next refresh, and is
indistinguishable from a clear that did not work.

**Two modes.** `loadFromFolder` asks `/api/status` once. A folder answers and
becomes the source; nothing answers on a static host, and the app falls back to
keeping everything in the browser. `data/` now only seeds that browser-only
case, and never loads over a folder.

The build deliberately excludes `public/data` from `dist`, because that folder
held real books and copying it into the output would publish them with the app.

### Bank balances: `bank-balances.ts`

`parseDailyBalances` reads a BNZ daily balance export — several accounts one
after another, a heading line then a row per business day. `checkDailyBalances`
compares each day's closing balance against the cumulative sum of our
transactions up to that date.

The comparison is of the *offset* (bank closing less our running total), not the
balance. Three consequences, all deliberate:

- No opening balance is needed, and a wrong one cannot poison the result.
- One missing transaction produces one break, not a break on every later day.
- The file lists business days only, so a Saturday movement lands in Monday's
  balance; comparing cumulative totals absorbs that, comparing daily movement
  would not.

Cards are matched to our account ids by their last four digits, and only when
that is unambiguous — guessing between two cards would be worse than saying
nothing.

### Tax read from tags, and the settlement case

`taxSummary` builds the boxes from the tax tag on each line, not from the
balance of account 820. A coded bank line posts its own GST line and the boxes
read it there.

Settling an invoice posts no GST line: the sale and its tax were booked when the
invoice was raised, and the receipt only clears the receivable. On the invoice
basis that is right. On the payments basis the invoice journal is excluded, so
nothing supplied the tax at all -- every settled invoice reported its gross in
Box 5 and nothing in Box 8. `postsTaxFor` indexes which tax types each journal
actually posts, and where a tag has no tax line the tax is taken from the gross
instead. An ordinary coded sale is unaffected, because its journal does post one.

The `taxBase` on a settlement line is the signed gross, the same convention a
supply line uses -- for payables as well as receivables. Flipping the sign for
payables makes a settled bill subtract from Box 11 rather than add to it, and a
book whose invoices are all sales will never show it.

### The demo data

`apps/web/public/demo/` is generated by the three scripts in `tools/`, and is
the one place the deny-by-default rules in `.gitignore` are deliberately
reversed — every name in it is invented, and it is what makes the app
demonstrable without anyone's bank data.

Stage one writes bank exports and runs them through the real importer, so ids
are genuine `hash(dedupeKey(...))` values; stage two attaches everything a CSV
cannot carry — splits, confirmed codings, invoice matches, a transfer — keyed
by those ids. It asserts each decision matches exactly one bank line, so a
change to the invented transactions fails loudly rather than silently pinning a
split to nothing.

`loadStartupFiles(folder, replace)` serves both the automatic `data/` load and
the demo: the demo passes `replace` so it overwrites rather than filling gaps,
and calls `wipe()` first, because a demo laid over a part-coded book would
leave the old book's decisions attached to transactions that are gone.

`clearStore()` clears the object store rather than deleting known keys: a key
added by a later version and forgotten there would survive a clear and reappear
attached to a book that no longer exists.

### The launchers

`NZOSA.cmd` and `NZOSA.command` at the repo root exist so a non-technical user
never types a command. They install on first run, always build, start the
server **detached with no window**, wait for it to answer, and exit — so the
console window closes and the app stays up.

`Stop NZOSA.cmd` / `Stop NZOSA.command` stop it, finding the process by the
port it listens on rather than by a saved process id: a stale id after a crash
points at nothing, or at whatever has since been given that number.

Detaching costs the two things a visible window gave for free, so both are
replaced. Errors go to `nzosa-log.txt` beside the app, because a hidden process
has nowhere to print; and the launcher waits for the port before exiting, so a
failure keeps its window open with the log in it rather than vanishing. The
launcher also checks whether the app is already running *before* installing or
building — without that, a second double-click started a second server that
could not even write its log, because the first still held the file open.

Two things about them are load-bearing:

- **`NZOSA.cmd` must be CRLF**, and must not be renamed to anything
  starting with the word `Start`. `cmd /c "Start NZOSA.cmd"` parses
  `Start` as the START builtin and detaches the process, and LF-only line
  endings break `goto` and parenthesised blocks. `NZOSA.command` must
  stay LF: `/bin/sh` chokes on CR.
- **A busy port never falls back to the next one.** Browser storage is per
  origin, so a different port is a different database; moving silently would
  show someone an empty app and their work would look lost. `build.js` instead
  fetches the port, and if `<title>NZOSA</title>` comes back it opens that
  copy and exits 0; otherwise it prints a plain-English message and exits 1.

`tsconfig` runs with `exactOptionalPropertyTypes`, so `{ x: undefined }` is not
assignable to `{ x?: string }`. Spread conditionally:
`...(v !== undefined ? { x: v } : {})`.

## 2. Money and dates

- **Money is integer minor units** (`Cents`). Never floats. `parseAmount`
  handles the formats banks emit; `formatAmount` is the only way out.
- **Dates are ISO strings** (`YYYY-MM-DD`), compared lexically. Bank formats are
  ambiguous, so importers take a `dayFirst` option.
- NZ financial years end 31 March. FY2026 is 1 Apr 2025 to 31 Mar 2026.

## 3. Data model

`StoredLedger` is the in-memory shape, identical between the CLI's
`ledger.json` and the browser, so it round-trips.

**It is not stored as one record.** Chart, entities, assets, journals,
invoices, allocations, invoice matches and tax extras each get their own
IndexedDB key; everything else stays on a core record. Before that split,
changing one account's type rewrote 2.3 MB to change 20 KB. `save()` writes
everything, `savePart()` writes only what changed, and `load()` reassembles.
Records written before the split still load, so nothing needed migrating.

| Field | What it is |
|---|---|
| `transactions` | Imported bank rows, deduplicated |
| `overrides` | Human decisions, keyed by transaction id |
| `splits` | One bank line divided into parts |
| `varianceNotes` | Why a computed return differs from a filed one |
| `chart` | Chart of accounts, with entity and GST columns |
| `entities` | Entities, account assignments, bank assignments |
| `assets` | Fixed asset register |
| `journals` | General ledger, for the accrual basis |
| `invoices`, `allocations`, `invoiceMatches` | Invoice matching |
| `taxExtras` | Income entered by hand |
| `filedReturns` | Filed GST returns, for comparison |

Two things live outside the ledger, under their own keys: the **event log**
(`events`) and the **user's name** (`user`). Neither is part of an export —
history belongs to the machine the work was done on.

### Transaction identity

`id` is a hash of the transaction's own contents, not its position in a file.
This is what makes an override durable: re-import the same statement, or a
later overlapping one, and the decision lands on the same row.

Anything keyed by transaction id inherits that property. Anything keyed by row
number does not, and will silently drift.

## 4. Invariants

Break these and figures become wrong without anything failing.

1. **Splits must sum to the parent exactly.** Enforced in the editor (save is
   disabled) and on load. A split that does not balance changes a GST return
   with no bank line changing.

2. **Rules suggest; overrides decide.** `confirmed` distinguishes a decision
   from a guess. Nothing may set `confirmed: true` on a user's behalf.

3. **Overrides beat rules, always.** `categorise` checks overrides first and
   returns immediately.

4. **The GST comparison baseline is Box 8 − Box 12**, never Box 15. Boxes 9 and
   13 carry adjustments a bank-derived ledger cannot contain.

5. **Cash and accrual must not be mixed in one figure.** They answer different
   questions and are sourced differently.

6. **One account, one name.** See below.

7. **Every journal sums to zero**, and so does the ledger. `trialBalance`
   returns an `imbalance`; a non-zero answer is a posting bug, not a surprising
   figure.

8. **The GST return reads tax tags, never an account balance.** A line posted to
   the GST account with no tax type must reach no box. There is a test asserting
   the account balance and the return *differ*.

9. **A sale is counted on one basis, never both.** Each journal declares the
   basis its tax falls due on; `taxSummary` filters. Posting an invoice and its
   payment without this doubles the return.

10. **`before` is captured before the change.** An event recorder that reads
    current state has already lost the thing it needs. This was written wrong
    once, in `matchToInvoice`.

## 5. Account names: `coding-names.ts` and `chart-codes.ts` — read these

An account is stored once in the chart and referred to everywhere else by a
*label* built from its code and its name — `Advertising - 400`. That label is
what is written into every override, every rule, every split part, the GST
treatment and the entity assignment. Getting from a label back to a chart row
is therefore the lookup this codebase does most, and the one it has got wrong
most.

**Take no first match. Rank.** Accepting a raw label from another system leaves
aliases behind: a bare `200` beside the canonical `NB Sales - 200`, both live,
both carrying transactions. Code that reaches for "the code containing 200" and
takes the first match gets whichever sorts first — the alias — and the account
quietly becomes two accounts, splitting its own total.

This bug was written four times before and after `coding-names.ts` existed: in
the chart matcher, in the Xero matcher, in invoice matching, and in
depreciation, which filed roasting equipment against *Office* Equipment because
both names contain "equipment". `canonicalCodeFor` ranks candidates instead,
preferring a real account name over a bare number, and has tests for the
near-miss (`20` must not match `200`).

**One label format.** `accountLabel(code, name, housePrefixed)` builds them,
name first. There were two: adding an account by hand in the app wrote
`400 - Advertising` while every other path wrote `Advertising - 400`. Both name
account 400, nothing matched them to each other, so the app *manufactured* the
alias problem the paragraph above exists to survive. Name first because the
trailing code is what `bareAccountName` strips to compare two spellings; a code
at the front is not stripped and does not match.

**One chart lookup.** `chartTreatments(chart, rules, overrides)` returns every
label the chart has an opinion about, and the app and the CLI both call it.
Deliberately one function rather than one each: two implementations agree on
the ordinary codes and part company on the awkward ones — `820 GST` is written
number first, which a matcher built around three fixed shapes misses — and two
answers to "what is this account's tax code" is two GST returns from one set of
books.

An account answers to **every** label whose account number matches it, not only
its canonical one. Keying only the canonical name left aliases with no opinion
from the chart, and no opinion means the fall-through assumption:
standard-rated. An account marked `No GST` claiming GST whenever it was reached
by its other name.

**Renaming: `rename-account.ts`.** Changing a code or a name changes the label,
so an edit that touches only the chart row orphans every reference to it — with
no error, just a return that quietly moved. `renameAccount` rewrites the chart,
the overrides, the split parts, the rules, the code treatments and the entity
key together, returns fresh objects, and never edits what it was given, so the
caller saves it as one change. `renameProblem` refuses a rename before anything
is written: no name, no code, a code that is not letters/numbers/hyphens, or a
code another account already holds.

**Codes are required**, on adding and on editing, because the code is the only
stable identity an account has: `accountEntityKey` is the code where there is
one and `name:<name>` where there is not, so a codeless account loses its entity
assignment the moment it is renamed. Bank accounts are the exception and carry
none — their identity is the bank account number, and any code would be
invented.

**The starter chart: `starter-chart.ts`.** A new ledger seeds the standard NZ
small-company chart. It is held as CSV and parsed by `parseChartOfAccounts`, so
it is not the one chart in the system that takes a private path into the app.
`starterChart()` parses on every call: the caller owns and edits what it gets,
and one shared array would let one set of books rename an account in another.

## 6. Posting: `posting.ts`

Coded bank lines, invoices, bills and depreciation all post as balanced
`PostedLine[]`, debit positive and credit negative — one convention, so a
journal balances by summing rather than by comparing two columns.

| Function | Produces |
|---|---|
| `postTransaction` | Bank line → supply, tax, bank. Splits post every part against one bank line |
| `postInvoice` | Dr receivable / Cr income / Cr GST — the entry no statement can make |
| `postDepreciation` | Dr depreciation / Cr accumulated — no money moves at all |
| `trialBalance` | Per-account balances, plus the imbalance proof |
| `taxSummary` | The return, read from tags, filtered by basis |

Postings are **derived, never stored**. Recomputed from the transaction and its
coding, so a corrected rule corrects the journal.

`postTransaction(…, { settles })` is the correctness lynchpin: a receipt matched
to an invoice clears the receivable instead of booking the sale again. Without
it, posting invoices overstated income by a third on real data.

Two cases worth knowing:

- **Imports**: the line *is* the tax, so there is no supply line beside it.
- **Half-deductible**: a return claims a share of the *gross* and takes 3/23 of
  that, not a share of the tax. The two differ by a cent often enough to matter.

## 7. The event log: `events.ts`

State stays the source of truth; the log sits beside it. Each event carries
`before` and `after`, which is what makes reversal possible — reversal is
applying `before` back over the target.

- Events carry **the thing that changed, not the collection it lives in**. A
  chart event holding the whole chart cost 41 KB and, worse, undoing one account
  reverted every other account edited since.
- `canReverse` refuses when a later event touched the same target.
- `who` is **attribution, not authentication**, and the UI says so. Do not let
  that wording soften.
- Capped at 5,000, oldest falling off.

## 8. GST engine

`gstResolver` composes, in precedence order:

1. Override on the transaction
2. Code treatment (`codeTreatments`, keyed by account name)
3. GST rules (keyword and account patterns)
4. Direction of the amount

`GstTreatment` is `standard | zero-rated | exempt | out-of-scope`; `GstSide` is
`sales | purchases | imports | none`.

`imports` is the case people get wrong: the line **is** the tax, so it is
claimed whole in Box 13 rather than having 3/23 taken out of it.

`deductiblePercent` on a treatment halves entertainment per line, not by
adjusting a total afterwards.

### Payments basis and receivables

Xero carries no tax rate on Accounts Receivable, because on an accrual basis the
GST arose when the invoice was raised. **These returns are filed on a payments
basis**, so a receipt settling an invoice is a taxable supply when it lands.

Coding such receipts `out-of-scope` to "match Xero" silently drops that GST — it
cost one period $1,005.69 before it was caught. Anything coded to a receivables
control account needs `standard`, with the side following the direction of the
money.

## 9. Matching engines

Three, all following the same principle: **rank evidence, never take the first
match.**

| Engine | File | Matches |
|---|---|---|
| Coding check | `coding-check.ts` | Our coding against another system's |
| Invoice matching | `invoice-matching.ts` | Receipts to the invoices they settle |
| Account names | `coding-names.ts` | One system's account label to ours |

`matchInvoices` lives in core so the CLI and the browser reach the same answer
from the same evidence. Accrual reporting depends on it: an unmatched invoice
means its payment posts as a second sale.

`compareCodings` deliberately excludes Accounts Payable and Receivable as
"structural": letting a payment match a control-account line pairs it with the
wrong side of a posting. Uncoded transactions need a placeholder code to be
matched at all, or they are set aside and never paired.

`inferAccountMapping` pairs bank accounts between systems from the payments
themselves, because the two name nothing alike — a card called `Kea Coffee
Tradin` here is `BNZ Visa - Business Card` there. An account with **no** inferred
pairing is excluded rather than left unconstrained once a mapping exists,
otherwise a transfer marries an unrelated loan of the same amount.

### Invoices written by hand

`renderInvoiceEditor` in `main.ts` writes to `ledger.invoices` (its own store
part) under the `invoice` event kind, which carries one invoice so undoing an
edit does not revert every other invoice touched since -- the same rule as
`chart`.

Two things it is careful about: the account is stored as the bare chart code
(`200`), the way an imported invoice holds it, rather than the picker's label;
and `outstanding` is derived as `total - paid` rather than typed, because
`matchInvoices` reads it.

Every invoice reaches exactly one bucket, and a test pins that. One with
`paid === 0` belongs in `unmatched` -- it is awaiting payment, or was just
written by hand. Skipping those drops them from every bucket, which makes them
invisible rather than outstanding.

### Transfers

`postTransfer` in `posting.ts` emits one journal for a pair of bank lines:
debit the receiving bank, credit the sending one, `taxType: "NONE"`, source
`transfer`, dated the **later** of the two legs. Its `transactionId` sorts the
two ids, so the same pair yields the same journal whichever leg you start from.

`ledger.transfers` is `Record<txId, partnerTxId>`, written for **both** legs so
either finds its partner in one lookup and neither can point at a leg that does
not point back. It is its own store part, and its own event kind whose reversal
deletes both keys — half a transfer is a balance that means nothing.

The trap is double counting. `journalsFor` builds the transfer journals from
the outgoing legs only (`leg.amount >= 0` is skipped, since both halves are
recorded) and collects both ids in `postedAsTransfer`, which the bank `flatMap`
then skips. Linking one pair moves the FY2027 totals from 438 journals / 987
lines to 437 / 985: one journal of two lines replacing two of two.

Candidates come from `transferCandidates` in `reconcile.ts` — never applied
automatically, for the same reason no rule confirms a coding.

## 10. Reporting

`profitAndLoss` (cash) and `accrualProfitAndLoss` (ledger) return the same
`ProfitAndLoss` shape, so the UI renders either.

- Cash removes GST **line by line** from each transaction's own treatment, never
  by dividing a total.
- Accrual reads journal amounts, which are already GST-exclusive; it flips the
  ledger's sign once, since a ledger credits income.
- **`unclassified` is listed, never dropped.** Anything whose account has no type
  — transfers, drawings, loan principal — appears under its own heading. A profit
  figure that quietly excludes things cannot be checked.

An account's **type** (Revenue, Direct Costs, Overhead…)
decides income vs expense vs neither. Accounts that exist only as a coding rule
have no type until one is set, and get promoted into the chart when it is.

## 11. Files it reads

**Everything goes through one reader.** `readExport` in `packages/cli` and
`asCsvText` in the app both sniff the file and hand every parser the same CSV
text. There were four private copies of "read a file that might not be UTF-8",
and the three that did not also handle a workbook were the three that could not
read what Xero actually gives you.

Two things that reader settles:

- **A spreadsheet is a zip, and every zip starts `PK`.** Sniffed rather than
  taken from the extension: a workbook saved as `.csv` is still a workbook.
  A `.xlsx` read as text finds no header row, and the parser then reports
  "required columns missing" — of a file whose columns are perfectly fine.
- **Bank and Xero exports are Windows-1252, not UTF-8.** Decode UTF-8 first and
  fall back when the result contains `U+FFFD`. This is not cosmetic: the payee
  is one of the fields a transaction's id is hashed from, so a mangled one gives
  the same row a different id in the CLI from the app, and importing one file in
  both duplicates every accented row rather than recognising it.

**Dates in a workbook are numbers.** A cell holding `45397` is 15 April 2024,
and the only thing that says so is the number format on it. `xlsx.ts` reads
`xl/styles.xml` and treats a cell as a date when its format is one of the
built-in date formats (14–17, 22) or a custom one whose pattern has a year,
month or day outside the parts it prints literally. Serials below 61 are left
as numbers: those are the days around Excel's imaginary 29 February 1900, they
cannot come off a bank export, and a date silently one day out is worse than a
number obviously wrong.

| File | Parser |
|---|---|
| Bank CSV (BNZ ×3, ANZ loan, Wise) | `importers/` |
| Account Transactions CSV or `.xlsx` | `xero.ts`, and `coding-check.ts` for the coding comparison |
| Journal Report CSV or `.xlsx` | `journals.ts` |
| Chart of accounts CSV | `chart.ts` |
| Fixed assets CSV | `assets.ts` |
| Invoices, allocations CSV or `.xlsx` | `invoices.ts` |
| Filed GST returns `.xlsx` | `filed-returns.ts` |
| Daily balances CSV | `bank-balances.ts` |

**Account Transactions comes in two layouts.** Run for one account it is
sectioned, each section introduced by a row holding only the account name. Run
across the ledger — which is how you would export it to check a whole year — it
is flat, and every row names its own account in a column. Reading only the
sectioned one meant such a file produced no rows at all and an empty
reconciliation that looked like agreement.

The account *name* decides what is a bank account, because the `Account Type`
column holds the broad class — Asset, Expense, Liability — and never a bank
flag. The class still rules things out: "Bank Fees" is named like a bank account
and is an Expense.

### The startup folder

`apps/web/public/data/` holds what the app loads for itself: `ledger.json`,
`rules.json`, `chart-of-accounts.csv`, `invoices.csv`, `allocations.csv`,
`assets.csv`, `journals.csv`. Each loads **only when the browser holds nothing
of that kind**, so files seed an empty browser and never overwrite work. A
missing file is a setup step not done, not an error.

Nothing writes back. A page cannot write to disk; `Export ledger`, `Save chart`
and `Download JSON` produce files you copy in yourself. The folder is a seed,
not a sync, and it goes stale the moment anything changes.

The chart file is the app's own record: the usual chart-of-accounts columns,
with `Entity`, `GST Treatment`, `Entity Owners`, `Entity Kind` and
`Ledger Account` appended. Appended, not woven in, so the file still imports
into Xero and unknown columns are ignored rather than fatal. Bank accounts are
written as their own rows, so which entities each serves survives a cleared
browser.

## 12. Bank statement formats

| Importer               | Source                                                             |
| ---------------------- | ------------------------------------------------------------------ |
| `bnz-transaction-list` | BNZ "Transaction list" — every account at once, in blocks           |
| `bnz-account`          | BNZ transaction account export (the "Payment"/"Spending" download)  |
| `bnz-card`             | BNZ credit card export (Advantage Visa Platinum / Classic)          |
| `anz-loan`             | ANZ home-loan statement export                                      |
| `wise`                 | Wise multi-currency balance statement                               |

The BNZ transaction list is the one to prefer: it covers every account in a
single file, each block naming its own account, and its thirteen columns are the
richest BNZ produces.

The format is detected from the column names, so you do not have to say which
file is which. Files with an export preamble above the header row are handled —
the ANZ loan export puts twelve lines of account metadata first.

Adding a bank is one file: see section 16.

## 13. Deduplication

**Nothing is ever deleted automatically.** Every row is classified, and anything
uncertain is surfaced for you to decide.

| Status      | Meaning                                                                                              |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| `unique`    | Not seen before. Added to the ledger.                                                                  |
| `duplicate` | Identical on every field the bank gave us, including the account. Left out — re-importing is safe.     |
| `review`    | Looks like a duplicate but is not certain. **Kept**, and flagged, with a reason.                       |

A row is flagged `review` rather than dropped when:

- It matches on date, amount and payee but the bank's **serial or reference
  differs** — usually the same transaction exported twice, but not always.
- It matches on amount and payee **a day or two apart** on a feed that carries no
  serial at all (cards, loans), where a genuine repeat and a re-dated re-export
  are indistinguishable.

**Repeats inside one export are kept.** A school taking three $20 membership
payments on one day produces three byte-identical rows, and a card feed has no
serial to tell them apart. They are numbered 1, 2, 3, which makes two things
true at once: all three survive, and re-importing that file matches them
one-for-one instead of adding three more. A bank export should not list one
transaction twice, so a repeat inside a single file is treated as real.

For the case numbering cannot see — the same transaction legitimately arriving
in two separate exports — add its key to `legitimateDuplicates` in `ledger.json`,
or click **Keep both** in the browser. That decision persists.

## 14. Corrections beat rules

Coding and GST rules are a suggestion engine. They will be wrong, and when they
are the correction has to stick:

```bash
node packages/cli/dist/cli.js override a1b2c3 --gst out-of-scope --note "overseas supplier, no NZ GST"
```

```bash
node packages/cli/dist/cli.js override a1b2c3 --code "Rimu Lane Expense" --note "paid on the wrong card"
```

Overrides are checked before any rule and always win. They are keyed by the
derived transaction id, so a correction survives re-importing the same
statement, or a later overlapping one. `--note` is **required** — an anonymous
correction is indistinguishable from a mistake six months later, and this is
exactly the kind of decision that gets questioned at year end. `--list` shows
every correction recorded; `--clear` removes one.

Correcting a coding does not silently change a GST treatment you did not touch,
and vice versa.

Getting this wrong in either direction is expensive — a false duplicate silently
deletes a real expense from a tax return, and a missed one double-counts income —
which is why the default is to keep and ask.

## 15. Proving the import is complete

Deduplication that is nearly right is worse than useless, so there is a way to
check it against something outside the bank feeds:

```bash
node packages/cli/dist/cli.js balances --year 2026
```

`--year 2026` means the financial year ending 31 March 2026 — the NZ/AU
convention, configurable with `--fy-end MM-DD` for a 5 April or 31 December
year end. It prints per-account totals, and reconciles them against any known
balances in the ledger:

```json
"balances": {
  "02-1100-0022001-001": {
    "opening": { "date": "2025-03-31", "amount": "356.00" },
    "closing": { "date": "2026-03-31", "amount": "13591.00" },
    "note": "FY2026 financials, balance sheet"
  }
}
```

**Opening + the sum of every transaction must equal closing.** If it does, then
across that period nothing was missed, double-counted or mis-signed — a complete
audit of the import stage against an independent source, needing no categories
at all. If it does not, the variance is exactly what is wrong. The command exits
non-zero on a mismatch, so it works in CI.

Where the two sides date a transaction differently, record it rather than
letting it look like a discrepancy:

```json
"cutOff": [
  {
    "date": "2025-04-01",
    "amount": "172.08",
    "note": "transfer the bank posts 1 Apr; the ledger dates it 31 Mar, so it is already in the opening balance"
  }
]
```

A transfer between your own accounts can leave one on 31 March and arrive at the
other on 1 April. The bank reports each leg on the day it touched that account;
an accounting ledger may treat the transfer as complete at balance date and put
both legs in the earlier year. Neither is wrong, but the two disagree by the
amount in transit, and without somewhere to record that, a correct set of books
looks like an error. A `note` is required, so an adjustment can never be a silent
fudge.

Opening and closing come from a bank statement, or from a set of prepared
financials. Note that financial statements are usually rounded to whole dollars;
a variance under a dollar is reported as `ok` but still shown, because a genuine
one-cent error and a rounding artefact look identical.

## 16. Adding an importer

One file in `packages/core/src/importers/`, exporting an object with `detect`
and `parse`. `detect` scores the file by column names — required columns must
all be present, distinctive ones raise confidence and break ties between banks
that share a common core. `parse` maps rows to `Transaction`.

Two rules that matter:

- **Never drop a row silently.** A row you cannot read goes into `problems` with
  its line number and a reason. A skipped row and a missing transaction must not
  look the same to the user.
- **Report the physical line number**, which is why parsed rows carry their own
  `line` rather than relying on an array index — blank rows are dropped and
  quoted fields can span lines.

Add it to the array in `importers/index.ts`, add a synthetic sample to
`samples/`, and add tests.

```bash
npm test
```

---

## 17. Traps

**Two implementations of one behaviour will drift, and the drift is silent.**
This is the trap that produced most of the bugs found in a single week of
testing: the chart lookup, four readers for "a file that might not be UTF-8",
two `loadRules`, two label formats, four copies of the `RuleFile` interface.
None of them announced itself. They showed up as the app and the command line
answering the same question differently, which on a tax return is the worst
possible kind of disagreement. If a behaviour is needed in both halves, it goes
in `packages/core` and both call it.

**Dead code that validates is worse than no validation.** There were two
`loadRules`: one that checked the file held rules and said so when it did not —
"failing loudly rather than silently coding nothing", its own comment said — and
a bare `JSON.parse` that was the one actually called. So `--rules` pointed at
any file that was not a rule set produced no error: nothing matched, everything
fell back to standard-rated, and a full GST101A printed with the same confidence
as a correct one. Check what is *called*, not what exists.

**An empty list is not a filter.** `--accounts` defaults to `[]`. `reconcile`
read that as "none of them" rather than "all of them", so without the flag our
side of the comparison was empty and it reported the entire Xero export as a
difference — a report that reads as catastrophic disagreement and is in fact no
comparison at all. Every other command here treats an empty list as everything.

**Read state before anything writes it back.** `record` appends to
`state.events` and saves the lot, so anything recording before the event log is
loaded saves a log of one and loses what was there. The entity setup at boot was
one changed ledger away from doing exactly that.

**A test fixture short of a required field reports faults that are its own.**
Three "bugs" in the folder-ledger work were a fixture missing `source`,
`extras`, `otherPartyAccount` and `occurrence`. Build fixtures from the full
required set, or a real one.

**Heredocs mangle escapes.** `\b` in a shell heredoc becomes a literal backspace
(0x08) and `\0` becomes a NUL. Both produce source that compiles, passes
typecheck, and silently misbehaves — a regex that matches nothing, an xlsx
reader returning zero rows. Two files reached git as *binary* because of NUL
separators. Python is not a way out: `"\b"` in a non-raw Python string is also a
backspace. Build the character with `chr(92)` when it matters, and scan for
control characters after any scripted edit:

```bash
python -c "import io,os
for r,d,f in os.walk('.'):
    d[:]=[x for x in d if x not in ('node_modules','.git','dist')]
    for n in f:
        if n.endswith(('.ts','.js','.json','.css','.html')):
            p=os.path.join(r,n); b=io.open(p,'rb').read()
            if any(c<9 or (10<c<13) or (13<c<32) for c in b): print(p)"
```

**`--ours` during a rebase means the upstream**, not your commit. It dropped a
347-line README for a 2-line placeholder.

**Assert every scripted anchor.** An unchecked `.replace()` that matches nothing
reports success and changes nothing.

**Prove a test fails without the fix.** Two of this week's fixes were checked by
taking the fix back out and watching the test go red. A test written after the
fact, against the fixed code, passes whether or not the code is right.

**`render()` only redraws the import page.** Page renderers must be called by
name; `showPage(state.page)` redraws whichever page is actually showing. A fix
that redraws a hidden page looks exactly like a feature that does nothing.

**A block moved to another page must not keep calling its old page's
renderer.** The rule proposals live on the Coding reconciliation page; if
`acceptProposals` ended with `renderSetup()` it would redraw a page nobody is
looking at, leaving the proposals on screen as though the click had missed --
and then showing them accepted the moment you navigate away and back. That is
the worst shape this bug takes: it looks like nothing happened, and then like
it happened twice. Anything a movable block calls has to be page-agnostic:
`showPage(state.page)`, never a renderer by name.

**IndexedDB is per-browser.** The dev preview and a user's Chrome hold separate
copies. A ledger seeded once is never re-seeded, so a stale browser will happily
show figures from before every correction.

**Event handlers must read live state**, not the state captured when the row was
drawn. Two changes before a redraw otherwise start from the same snapshot and
the second silently undoes the first.

**Never take the first match.** Rank. See §5, where this is written out in full
along with the four times it was got wrong.

**Do not re-run a scripted edit.** These scripts are not idempotent; running one
twice inserts everything twice, and it typechecks.

**No raw control characters in source.** Where one is needed -- as a key
separator, say -- write the escape (`\u0000`, `\u0001`) rather than the
byte. They are identical at runtime and only one of them is visible in a diff,
in a review, or to the scanner above. `posting.ts` carried a real 0x01 for
months: deliberate, working, and indistinguishable from the mangling accident.

## 18. Privacy

`.gitignore` is deny-by-default: ledgers, bank exports, accountant documents and
working spreadsheets are all excluded, and `data/` holds anything real.
`samples/*.csv` are synthetic — `SAMPLE & CO`, `12 Sample Street`, invented
account numbers — and are allowed by an explicit exception.

That covers whole folders, which is the part that matters and not the part that
fails. What fails is one string at a time: a payee copied into a test to make it
realistic, a real IRD number in a fixture, an account description naming
the client's actual trade carried into a starter chart. Three separate leaks
into tracked files have happened by exactly that route -- and a fourth was this
paragraph, which first quoted the offending description in full.

```bash
node tools/privacy-audit.mjs ledgers/my-books
```

It takes every name, reference and account number out of a real ledger and
looks for them in the files git tracks **or would track on the next
`git add -A`** — `--cached --others --exclude-standard`. `git ls-files` alone is
blind to precisely the file that leaks, because a brand new one is not tracked
yet, so it is not scanned, so the audit passes, so it gets committed, and only
then can the audit see it: one commit too late. That is not hypothetical.

Two things about running it:

- **It exits non-zero on a finding.** Do not pipe it through `head` or `tail`
  without checking the status — masking that exit code is how one of the leaks
  got through a run of this very tool.
- **A shared vocabulary is not a leak.** "Inland Revenue", "Bank Fee",
  "provisional tax", a well-known merchant — those go in `GENERIC` in the
  script. A report full of harmless matches is a report nobody reads to the
  end, which is the only way this tool fails.

Chart account names are deliberately not scanned: a chart is shared vocabulary,
and scanning it reports forty standard names and buries the one line that
matters. What identifies somebody is who they paid.

---

## 19. Running it, and deploying it

### Loading files automatically

The app reads `apps/web/public/data/` on startup, when the browser holds nothing
of that kind yet: `ledger.json`, `rules.json`, `chart-of-accounts.csv`,
`invoices.csv`, `allocations.csv`, `assets.csv`, `journals.csv`. Every one is
optional; a missing file is a setup step not done, not an error.

It is a **seed, not a sync**. A page cannot write to disk, so changes never flow
back — use *Export ledger* and copy the file in yourself. The folder is
gitignored, so real data never reaches the repository.

### Deploying your own copy

```bash
npm run build --workspace @nzosa/web
```

Upload `apps/web/dist/` to any static host — GitHub Pages, Netlify, Cloudflare
Pages, or plain shared hosting. There is no backend to run.

### Running a second copy side by side

```bash
npm run dev --workspace @nzosa/web -- --port 3211
```

Browser storage is per origin, so another port is a completely separate
database. That is how to try something out, or run the
[testing plan](docs/testing-plan.md), without touching real work.

### Command line

```bash
node packages/cli/dist/cli.js import samples/*.csv
```

```bash
node packages/cli/dist/cli.js detect statements/july.csv
```

`import` writes `ledger.json` in the current directory. `--dry-run` reports what
would happen without writing. The browser app reads and writes the same file
format, so you can move between the two.

### What a static deployment does not have

A static host serves the files and nothing else, so `/api/status` answers 404,
`loadFromFolder` returns null, and `backend` stays `"browser"`. Every
consequence follows from that one fact:

* **Each visitor's books live in their own browser**, in IndexedDB under that
  origin. There is no shared ledger, and nothing is uploaded — the host never
  sees a figure.
* **They are not durable.** Clearing site data deletes them; a private window
  keeps nothing; the browser may evict them under storage pressure unless
  `requestPersistence()` has been granted.
* **The folder-only features are absent**: switching ledgers, archives,
  restoring an archive, and the per-part file writes. `writesToFolder()` is
  false and the app adjusts what it offers accordingly.

That makes a static deployment right for a demo or for somebody to try, and
wrong for books anybody depends on. Real books want the launcher, which runs
the small server that owns the folder.
