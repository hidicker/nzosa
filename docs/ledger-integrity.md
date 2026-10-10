# What can change entries already in the ledger

October 2026. A check of every input the ledger is built from, for ways a
person can change entries they have already confirmed without meaning to,
other than recoding a line on Reconcile or accepting a difference on Coding
reconciliation.

## How the ledger is kept

NZOSA does not store finished journals for bank lines. It stores each line as
the bank gave it and, when the line is confirmed, the decision about it: the
account, the GST treatment and side, any split, a transfer pairing, the
invoice it settles, and (since 10 October) whose money paid it and how money
between entities is recorded. The journals are built from those each time
the books are read, together with what else is stored: manual journals,
property manager statements, the asset register, pay runs, vehicle use and
prepayments, opening balances.

So an entry is only as fixed as everything it is built from. Confirmed
codings and their GST are fixed: every way of confirming stores them, and no
rule, AI answer or account setting overrides them. The gaps below are the
other inputs: settings that reach back over finished periods when they are
changed, without saying so.

Lock dates are the backstop. A save that changes a figure inside a locked
year, or a filed GST return, is refused. The last column says whether the lock
catches each case today.

## Found

| # | What the person does | What changes, silently | Caught by lock dates? |
|---|---|---|---|
| 1 | Ticks or unticks **GST registered** on an entity | GST on every line of that entity, all years, confirmed lines included: registration overrides a line's stored treatment. Past GST returns are worked out again. | Yes, both: the returns change, and so do the postings' totals by account (GST moves in or out of the cost). |
| 2 | Changes an account's **type** (say Expense to Current Asset) | Every line ever coded to it moves between the profit and loss and the balance sheet. A confirmed line's GST **side** (sales, Box 5, or purchases, Box 11) follows the account's type, so past returns can change boxes. | Year lock: **no** (it compares totals by account code, which do not change). GST lock: yes, for the box. |
| 3 | Moves an account to **another entity** (Entities & accounts, entity column) | Every line coded to it, all years, moves to the other entity: its profit and loss, rental schedule, IR3 share, GST return when one entity is chosen, and now the money between entities. | **No**, where both entities have the same GST registration: the year lock compares by code, and the GST lock compares the return for all entities together. Yes where one is registered and the other not. |
| 4 | Changes an entity's **owners or shares** | Past years' Income by owner and IR3 shares, and the split of owners' funds introduced and drawings for every line (the stored choice keeps whose money and how, not the shares). | IR3 and Income by owner: **no** (not postings). Money between entities: yes. |
| 5 | Renames an **owner** | The between-entity accounts are found by the owner's name, so a new "funds introduced" and "drawings" account is made and all history moves to it. | Year lock: yes (new codes). |
| 6 | Edits a **fixed asset**: cost, date, rate, method, disposal | Depreciation is worked out from the register every time, so every year's depreciation changes. | Year lock: yes. |
| 7 | Changes the **accounts chosen on Payroll** (wages, wages payable, PAYE) | Every pay run ever posted moves to the new accounts. | Year lock: yes. |
| 8 | Adds a GST control account (820, or an entity's own 820XX) | Where GST is posted, for all history: the ledger looks for the account each time. | Year lock: yes. |
| 9 | Changes the **books' start date** or the **opening balances** | Which lines are in the books at all, and every balance since the start. | Start date: yes. Opening balances: **no** (they are not among the postings the lock compares). |
| 10 | **Loads a chart** over the top, or adds standard accounts "replacing the unused starter chart" | Account names and types, and so all of 2 and 3 above at once. | As 2 and 3. |
| 11 | **Undoes** an old change in History | Whatever that change touched, back to how it was, however long ago. | Year lock: yes. |
| 12 | Imports bank lines, or the feed fetches them, **dated in a past period** | New lines in a finished year. | Held back only where a lock covers them. |

## Expected, not gaps

- **Lines not yet confirmed** follow the rules, the AI and the list of known
  businesses, and change when those do. Reports include them and say so
  ("Provisional: N lines coded by a suggestion nobody has confirmed").
- **A rule's or an account's GST setting** reaches only unconfirmed lines.
- **The year in progress's depreciation** grows month by month.
- **Editing a manual journal, an invoice or bill, a property manager statement,
  vehicle use or a prepayment** changes its own entries: those records are the
  entries. Lock dates refuse it inside a finished period.
- **Removing an account** that has lines coded to it is refused.
- **Money between entities** keeps each confirmed line's choice; a change of
  setting or owner reaches confirmed lines only through "Apply to N confirmed
  lines".

## What would close the gaps

The same principle as money between entities: a setting applies from when it
is changed, and reaching what is already confirmed is a separate, deliberate
step that says what it will change.

1. **GST registration with a date** (1): registered from a day, deregistered
   from a day, as Inland Revenue has it. Lines before the date keep their GST.
2. **Say what an account change reaches** (2, 3, 10): changing an account's type
   or entity says "N confirmed lines in M years will move from the profit and
   loss to the balance sheet" (or "to Larch Street"), and asks. Better still,
   the year lock compares by account type and entity as well as code, so a
   finished year refuses it.
3. **Owners and shares with a date** (4): a share held from a day, so a change of
   ownership does not rewrite past years; the stored choice for a line keeps
   the shares it was confirmed with. Owner accounts found by a stable id rather
   than the name (5).
4. **Say what an asset or payroll change reaches** (6, 7): the years whose
   depreciation or pay runs will change, before saving.
5. **Lock dates for everyone**: with no lock set, nothing above is caught. A
   prompt to lock a year once its return is filed would make the backstop
   ordinary rather than optional.
