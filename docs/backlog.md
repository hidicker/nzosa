# Backlog

Things found and not yet fixed, because the fix is not obvious or not small.
Newest at the top of each section. When one is done, take it off and say so in
the commit. The larger, planned work is in [roadmap.md](roadmap.md).

## Waiting on a decision

- **Invitation email cap: deploy it.** The 100-a-day limit per person and the
  warning email on the eleventh are written
  (`supabase/migrations/20261012090000_invitation_caps.sql` and
  `supabase/functions/invite`) but not yet on the live project. The migration and
  the function go together: the new function calls the new three-argument
  `invitation_email_take`. Set the `ALERT_EMAIL` secret first, or the warning
  is not sent.

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

## The app

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

- **Own Supabase project: no bank feed, AI or morning run.** These are edge
  functions, and a person's own project does not have them. Deploying them
  there would need the person's own Akahu and AI keys, and a guided set-up.
- **The morning run starts every set of books at once.** Fine for a few dozen;
  with hundreds it should go in batches.
- **The morning run's key is compared with `!==`.** A constant-time comparison
  would be better practice, though the key is long and random.
