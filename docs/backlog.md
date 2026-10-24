# Backlog

Things found and not yet fixed, because the fix is not obvious or not small.
Newest at the top of each section. When one is done, take it off and say so in
the commit. The larger, planned work is in [roadmap.md](roadmap.md).

## Waiting on a decision

- **`supabase db push` does not know the live database's history.** The
  migrations were applied in the SQL editor, so the project's migration record
  is empty and `db push` starts again from the first one (it fails at once on
  "books already exists", changing nothing). Until it is fixed, apply a new
  migration in the SQL editor. The fix is `supabase migration repair --status
  applied <version>` for each migration already in place, after checking each
  one really is there.

## Ledger integrity

Settings that change entries already confirmed, in past years, without
saying so. Each is set out in [ledger-integrity.md](ledger-integrity.md), with
whether lock dates catch it today. The principle to follow: a setting applies
from when it is changed, and reaching what is already confirmed is a separate,
deliberate step that says what it will change (as money between entities now
works).

- **Lock dates enforced on the server, not only the lock dates themselves.**
  Since 20261012120000_deleted_books_and_locks.sql, save_part refuses a
  bookkeeper's save that moves the lock dates. What they lock is still guarded
  by the page alone: a save that changes a coding, journal or invoice dated on
  or before a lock is not refused by the server. Doing it there means
  comparing the locked figures (`lockedFigures` in core's lock-dates.ts) in the
  database, or in an edge function every save goes through.
- **Changing an account's type or entity says what it reaches, and asks.** A
  type change moves all its history between the profit and loss and the balance
  sheet and can move confirmed lines between Box 5 and Box 11; an entity change
  moves all its history to the other entity. The year lock should compare by
  type and entity as well as code, so a finished year refuses either.
- **Owners and shares with a date.** A change of shares rewrites past years'
  Income by owner, IR3 shares and the owner split of money between entities.
  Each confirmed line should keep the shares it was confirmed with, and owner
  accounts be found by a stable id rather than the owner's name.
- **Asset and payroll changes say which years they will change** before saving:
  depreciation is worked out from the register every time, and pay runs from
  the accounts chosen on Payroll.
- **Opening balances are not covered by the year lock.**
- **A prompt to lock a year once its return is filed**, so lock dates are the
  usual backstop rather than an option few set.

## Tax and returns

- **IR9 for an unincorporated club works out no tax.** It is assessed at
  individual rates, and the page says to work it out. `individualRates()` in
  `trust.ts` already holds the bands by year, so the IR9 could do it.
- **The minor beneficiary rule assumes the settlor was a relative.** The rule
  applies only to property settled by a relative or legal guardian of the child
  (or someone associated with one). The app applies it to every child under 16,
  which is the cautious answer but not always the right one. A tick on the
  beneficiary, "settled by someone unrelated", would let the trustees say so.
- **A shared bank account is held under the GST lock even for an unregistered
  entity's line.** A line on an account that pays for a GST-registered entity
  and an unregistered one cannot be told apart until it is coded, so it is held
  back. Coding it first, then deciding, would be more precise.

## QuickBooks and the United States

- **QuickBooks invoices, bills and customers as documents.** The general ledger
  brings in every invoice and bill as a journal, so the profit and loss and
  balance sheet match, but they are journals, not invoices: no due dates, no
  customer list, no aged receivables or payables, and a customer payment is
  coded to receivables rather than matched to an invoice. QuickBooks' own
  exports (A/R and A/P aging detail, Customer and Vendor lists, Invoice list,
  Trial balance, Product/Service list) hold what is missing.
- **Other expense on the profit and loss.** QuickBooks puts "Other expense"
  below net operating income; here it sits among operating expenses. Net
  profit agrees, the subtotal does not.
- **A credit card sits under assets** (as negative) in the balance sheet, as
  Xero's do, where QuickBooks has it under liabilities. Net assets agree.
- **Sample QuickBooks exports in the US demo**, for the "Moving from
  QuickBooks" lesson to offer.
- **US income tax** stops at the single filer with the standard deduction: no
  QBI deduction, credits, other filing statuses or state tax.
- **Form 941/940, W-2 and sales tax payable reports** exist in QuickBooks and
  SlowBooks Pro; none here.

## The app

- **Wise balances in other currencies.** Only balances in the books' own
  currency can be brought in (`wise-feed.ts`): a KRW or EUR line came in as if
  it were dollars. Bringing others in needs each line converted at the day's
  rate (Wise's statement gives the rate on conversions, not on every line), a
  foreign-currency bank account in the chart, and the realised gain or loss
  on conversion posted. Xero's chart had no row for Wise KRW either, so the
  link step needs a way to add a bank row for one.
- **Reconcile tick, stage 2: redraw only the ticked line.** Stage 1 is done: a
  tick no longer waits for its saves (about 0.3 s on books online, down from
  0.8–2.6 s), and the writes queue in order (`writeQueue` in core). What is
  left is the full redraw of up to 200 rows. Plan: in the plain case only --
  a suggestion accepted, no rule made or changed, no split, invoice, transfer
  or asset -- take the row out and update the counts; anything else redraws
  in full as now. Held until asked for. Not yet tested by hand: cutting the
  connection mid-tick (the "not saved" warning, and the warning on leaving
  with saves outstanding), and two tabs on the same books.
- **Books in a folder still write each changed part whole.** Books online
  now send only what changed (`save_part_changes`, and `part-changes.ts` in
  core), with the coding and its history entry in one request. A folder is
  the app on the same computer, so the size matters far less there, but the
  history file is still rewritten on every change. The same change lists
  could go to `PUT api/ledger/parts/:part` if it ever shows.
- **The rules go whole when a tick makes or changes one.** Changes reach
  two levels into a part, and the list of rules is the third (`rules.rules`),
  so it is sent whole: 7–17 KB on the books online in Oct 2026, against a
  few hundred bytes for the coding. Small, but the biggest piece of such a
  tick. Reaching a third level means `apply_part_ops` taking longer paths.
- **What each online save replaced is all kept.** The owner decided on
  22 Oct 2026 to keep all of it (then about 68 MB of an 87 MB database, from
  the whole copies saves used to keep). Saves now keep the change rather
  than a whole copy, with a whole copy at most once a day per part, so it
  grows slowly. Revisit only if the database nears the free plan's 500 MB:
  `prune_part_history(interval)` removes rows older than the interval and
  keeps each part rebuildable.
- **Say it is working while the other bulk actions on Reconcile run.** "Split
  N" now shows the `working` style and "Splitting 12 of 40…" on its button
  until it is done. Accept all and AI suggestions may need the same: check
  how long each takes on a large set of books.
- **The lock guard works out every GST return from the first transaction on
  every save.** Measured 24 Oct 2026 on invented books in the browser, eight
  years and 11,800 bank lines: with lock dates set, about 230 ms a save (525
  ms the save that sets them); with none, nothing. Noticeable, not the slow
  part (below). Working out only the periods up to the lock would cut it.
- **Reconcile on large books with many lines still to code.** On invented
  books of eight years (11,800 lines, none coded at first) a tick took
  18-23 s, nearly all of it in the redraw: each row worked out every line in
  the books again (how its payee was coded before, and its usual transfer
  partner), and the transfer search compared every line with every other.
  Fixed 24 Oct 2026 -- worked out once per redraw, and transfers searched by
  amount -- with the page shown identical before and after; a tick there is
  now about 2 s, most of it the full redraw (Reconcile tick, stage 2).

## Online books

- **The two books lists offer the same things.** Books in a folder (Books
  page, `books-page.ts`) have Open, Make a copy… and Clear…; books online
  (`cloud-books.ts`) have Open, Rename, Delete and Start a new set. Both
  should have Open, Rename, Make a copy…, Clear… and Delete, in the same
  order and words, each where it makes sense:
  - **Copy online:** `createBook` plus each part from `loadParts`, saved with
    `savePart`. Not copied: the bank feed connection (two sets fetching from
    one bank would muddle both), the AI key, sharing, the morning run's part,
    and History, which starts with a note of where the copy came from.
  - **Clear online:** empty the parts but keep the set, its name and its
    sharing, as Clear does for a folder (which keeps a dated copy to put back).
  - **Rename and Delete for a folder:** Delete moves the folder aside rather
    than removing it, like Clear, so it can be put back.
  - **When each was last opened, by the person looking.** Online this needs a
    per-person record (a `last_opened_at` on the membership row, set on
    opening); in a folder, a note beside the books. Shown as a column, and
    the list sorted by it.
- **Bring the GitHub workflows up to date.** The "Deploy website" run on
  10 October 2026 warned that `actions/checkout@v4` and `actions/setup-node@v4`
  target Node.js 20, which GitHub has deprecated (they are being run on
  Node.js 24 for now), and that `ubuntu-latest` moves to Ubuntu 26 from
  19 October 2026. Move both actions to their current major versions in
  `.github/workflows/deploy.yml` and `deploy-functions.yml`, and run a deploy
  after 19 October to check nothing in the build or upload depends on the old
  image.

- **Own Supabase project: no bank feed, AI or morning run.** These are edge
  functions, and a person's own project does not have them. Deploying them
  there would need the person's own Akahu and AI keys, and a guided set-up.
- **The morning run starts every set of books at once.** Fine for a few dozen;
  with hundreds it should go in batches.
- **The morning run's key is compared with `!==`.** A constant-time comparison
  would be better practice, though the key is long and random.
- **Two New Zealand GST invoice-basis rules not applied** (from the
  OpenAccountants NZ GST guide, checked 16 October 2026): a single supply over
  $225,000 must go on the invoice basis whatever basis is chosen (unless
  settled within 365 days), and on the invoice basis a payment received
  before the invoice is issued makes the GST due when paid. Both rare for the
  businesses NZOSA is for; the GST return takes neither into account yet.
- **The cash flow statement never recognises a bank account named "loan".**
  Its pattern in `apps/web/src/daily/cash-flow-report.ts` (`isLoanAccount`)
  has held a backspace character where a word boundary was meant, since the
  first commit, so only "mortgage", "total money" and "line of credit"
  accounts are treated as loans (financing) rather than cash. Fixing it moves
  any other loan account out of cash in New Zealand's cash flow statements
  too, so it waits for a decision. Found 17 October 2026.
- **SimpleFIN for books kept online.** The SimpleFIN feed works on the
  desktop app only: its Access URL is kept in `.simplefin.json` by the local
  server. Books kept online need it in Supabase Vault with an edge function
  (`supabase/functions/simplefin`, a `simplefin_secret` table and RPCs), as
  `supabase/functions/wise` does for Wise. Left because it changes the
  production database. 18 October 2026.
