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
- **Ask on the page everywhere, not in the browser's confirm box.** An
  embedded browser (the Claude desktop app's pane, for one) answers
  `confirm()` "Cancel" at once without showing it, so whatever it guards is
  refused in silence. `askOnPage` in `ui.ts` asks in the page instead; the
  trial balance, Leave out after all, Bring in as a journal and taking the
  year-end journals from the journal report use it, and `askTextOnPage`
  (the same box with a field) asks for the name of a new set of books and of
  a copy. About 44 `confirm()` calls in 28 files remain, and `alert()` and
  `prompt()` (entity names, donation reasons, asset and opening amounts) have
  the same problem. Each needs its handler made async.
  First of them: Delete on the online Books page (`cloud-books.ts`) asks for
  the set's name with `prompt()`, so in such a browser the button does
  nothing at all. Replace everything on the server, there, and the two
  backup restores in `backup.ts` ask with `confirm()`.
- **Reconcile tick, stage 2: redraw only the ticked line.** Stage 1 is done: a
  tick no longer waits for its saves (about 0.3 s on books online, down from
  0.8–2.6 s), and the writes queue in order (`writeQueue` in core). What is
  left is the full redraw of up to 200 rows. Plan: in the plain case only --
  a suggestion accepted, no rule made or changed, no split, invoice, transfer
  or asset -- take the row out and update the counts; anything else redraws
  in full as now. Held until asked for. Not yet tested by hand: cutting the
  connection mid-tick (the "not saved" warning, and the warning on leaving
  with saves outstanding), and two tabs on the same books.
- **History is rewritten whole on every change.** Each coding sends the
  entire event log (77 KB on AI Test, growing), so every write gets slower as
  the books age. Append one event at a time instead -- a table of rows on the
  server rather than a part, with the browser and folder backends to match.
- **Arrow Rock is 0.03 from Xero's P&L for FY2026**, after the bills, credit
  notes and the Google One journal with GST were sorted. Not yet traced.
- **Say it is working while the other bulk actions on Reconcile run.** "Split
  N" now shows the `working` style and "Splitting 12 of 40…" on its button
  until it is done. Accept all and AI suggestions may need the same: check
  how long each takes on a large set of books.
- **A journal keeps an account's old name after the account is renamed.** Manual
  journal lines store "Name - CODE" as text; the figures follow the code, but
  the journal list shows the name as it was.
- **Each page change asks the local server for `/api/status` and `/api/ai`
  twice.** Harmless, but chatty; one of each is enough.
- **At about 800 pixels wide, Entities & accounts scrolls sideways.** The
  accounts table is wider than the page.
- **The lock guard works out every GST return from the first transaction on
  every save.** Fine on the books tried so far; on books with many years it
  may make saving slow. Worth measuring before changing.

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
- **Rename and Delete are offered to people who cannot use them.** The online
  Books page shows both on every row, whatever the person's role. The server
  lets only an owner do either, so a bookkeeper, accountant or reader is
  refused after pressing. Show them to owners only.
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
