# End-to-end test: from nothing to the signed accounts

A full run of the whole chain, starting with an empty browser, ending with
figures that can be checked against a signed set of accounts.

Each stage says what it **proves**, what to **record**, and what counts as a
**failure**. Recording the numbers is the point — a stage that "looked fine"
tells you nothing next time.

Allow about ninety minutes, most of it in stages 5 and 6.

---

## Stage 0 — Before you start

Two things will silently invalidate the test if you skip them.

**Use a different origin.** IndexedDB is per origin, so serving the app on
another port gives it a completely separate store and leaves your real work
untouched:

```bash
cd apps/web && node build.js --serve --port 3211
```

If the port option is not wired up, use a private window instead — same effect,
and it is discarded when you close it.

**Move the seed ledger aside.** `apps/web/public/data/ledger.json` holds 2,832
transactions and 172 codings, and it loads *first*. Leave it there and the app
seeds itself with finished work, which makes every stage below meaningless:

```bash
mv apps/web/public/data/ledger.json apps/web/public/data/ledger.json.hold
```

Put it back at the end.

**Export your current work first** — Bank import → Export ledger — even though the
separate origin should make that unnecessary. Cheap insurance.

---

## Stage 1 — An empty app

Open it. Do nothing.

| Record | Expect |
|---|---|
| Startup line | Names only the files still in `data/` — no ledger |
| Reconcile | "No transactions yet" |
| History | "Nothing recorded yet" |
| Reports | Empty, no crash |

**Proves** the app starts from nothing and says what it did and did not find.

**Fails if** any figure appears, or a page errors rather than saying it is empty.

---

## Stage 2 — Setup loads itself

Everything except the ledger should already be in `apps/web/public/data/`, so
this stage should require no clicking at all — just read the startup line.

| Record | Expect |
|---|---|
| chart of accounts | 93 accounts |
| coding rules | 696 rules, 26 defaults, 64 code treatments |
| invoices | 134 |
| payment allocations | 115 |
| fixed assets | 38 |
| general ledger | 1,470 journals |
| Entities & accounts | 4 entities: Kea Coffee, Rimu Lane, Totara Place, Mount |

**Note:** entities are *not* loaded separately. They are created from the
`Entity`, `Entity Owners` and `Entity Kind` columns of the chart, which is why
the chart must come first. If entities are missing, the chart is the thing to
look at.

**Proves** the startup folder seeds a cold browser, and that ownership and GST
treatments survive in a file rather than only in a browser.

**Fails if** entities are absent, owners are blank, or accounts show no GST
treatment.

---

## Stage 3 — Import the bank data

Bank import → drop the bank CSVs for the year.

| Record | Expect |
|---|---|
| Transactions imported | ~1,404 for FY2026 |
| On the two Kea Coffee accounts | ~434 |
| Duplicates flagged | However many the importer reports |
| Rows skipped | Should be none; investigate any |

Then **import the same file again**. Everything should be flagged as a
duplicate and nothing added. That is the transaction-id design doing its job.

**Proves** the importers, and that re-importing an overlapping statement is safe.

**Fails if** the second import adds rows, or the count is materially off.

---

## Stage 4 — The first look, before any human decision

Do not code anything yet. This is the baseline you will measure improvement
against.

| Record | Where |
|---|---|
| "N of M lines coded" | Reconcile hint |
| Lines with no suggestion at all | Reconcile, scroll |
| Cash P&L for Kea Coffee FY2026 | Reports |
| GST: the nine periods and their differences | GST page |

**Proves** how far the rules get you on their own. Everything after this is the
value of human judgement, and you cannot measure it without this number.

**Fails if** the GST periods are wildly out — that would point at the rules or
the chart, not at the coding.

---

## Stage 5 — Work it: code and match

Now use it as you normally would, for twenty minutes or so.

1. Put your name on the **History** page first, or changes are recorded as
   "unattributed".
2. Code a dozen transactions on **Reconcile**. Use the Description field.
3. Split one that deserves it — a courier payment, or a Stripe payout.
4. Match several receipts to invoices on the green row under the bank line.
5. Assign an account to an entity on **Entities & accounts**.

| Record | Expect |
|---|---|
| History entries | One per change, with your name and a timestamp |
| Undo one coding | The line returns to its previous state |
| Undo the same one again | Refused — "Already undone" |
| Change something twice, undo the older | Refused, naming the newer change |

**Proves** the working loop, and that the log is honest about what it can and
cannot reverse.

**Fails if** a change is missing from History, or an undo leaves the figure
different from where it started.

---

## Stage 6 — Check the coding against Xero

Coding reconciliation → Load reference → the Account Transactions `.xlsx` **and** the
chart CSV together.

| Record | Expect |
|---|---|
| Agree / differ | Roughly 400 / 80 before applying Xero's coding |
| GST rate disagrees | A handful |
| Split in Xero | 12, most already split here |
| Coded, nothing to check against | ~225 |
| Not coded yet | Whatever is left |

Open one split row and look at Xero's parts. Load one with **use split** and
check the parts sum to the bank line exactly.

**Proves** the comparison engine, the account mapping between two systems that
name nothing alike, and the split reconstruction.

**Fails if** agreement is far below 80%, or a loaded split does not balance.

---

## Stage 7 — Apply Xero's coding wholesale

This is the strongest test in the plan: give our engine *the same codings Xero
has* and see whether it produces the same accounts.

Either accept the differences one by one on the Coding reconciliation page, or run the
matcher script that does it in bulk.

| Record | Expect after applying |
|---|---|
| Motor Vehicle Expenses | 7,531.33 against signed 7,531 |
| Consulting & Accounting | 779.40 against 779 |
| Telephone & Internet | 600.13 against 600 |
| Insurance | 580.31 against 580 |
| Rent | 240.00 against 240 |
| Stripe Fees | 332.51 against 333 |
| Cleaning | 8.70 against 9 |
| **The nine GST periods** | **Unchanged** |

That last row matters most. Recoding hundreds of transactions **must not**
disturb the GST returns, because the returns were already correct. If they
move, something in the recoding is wrong — this exact check caught a $1,005.69
error once, where receipts settling invoices were coded to receivables and lost
their GST on a payments basis.

**Proves** that our engine and Xero's produce the same figures from the same
decisions.

**Fails if** any expense line is materially off, or the GST periods move.

---

## Stage 8 — The reports, against the signed accounts

| Report | Setting | Expect |
|---|---|---|
| P&L | Accrual (imported ledger), Kea Coffee, FY2026 | Net **8,907.32** against signed 8,907 |
| P&L | Accrual (our postings) | Income ~90,568 — higher, see below |
| P&L | Cash | Materially lower; that is correct |
| Depreciation schedule | FY2026 | **19,877.26** against 19,877; closing 6,309.55 against 6,310 |
| Journal & trial balance | FY2026 | **Balanced**, nil imbalance |
| Income by owner | Ana, FY2026 | Rimu Lane 50% share 54,729.94 against IR3 54,681.38 |
| Income by owner | Tom, FY2026 | Whole return within about $223 |

**Why "our postings" reads high:** invoices post their sale when raised, and a
receipt only clears the receivable if it is matched to that invoice. Unmatched
invoices are therefore counted twice. With 93 of 134 matched the overstatement
is about $5,300. **Match more invoices and this figure should fall** — that is
the single best way to confirm the mechanism is working as described.

**Proves** the whole chain, and that three different sources — bank data, an
asset register, and a general ledger — agree where they should.

**Fails if** the trial balance does not balance, or depreciation differs by more
than rounding.

---

## Stage 9 — Put it back

```bash
mv apps/web/public/data/ledger.json.hold apps/web/public/data/ledger.json
```

Close the test window. Your real work is untouched at the original port.

If you want to *keep* what you did in the test instead, export its ledger first
and copy it over `data/ledger.json`.

---

## What this plan does not test

Worth knowing, so a clean run is not mistaken for more than it is.

- **Year-end journals and manual adjustments.** They cannot be made here at all.
- **Opening balances.** Nothing carries them, so no balance sheet is complete.
- **Multi-user anything.** One browser, one person, a name that nothing verifies.
- **Storage eviction.** Persistence is requested but not guaranteed, and this
  plan will not tell you whether the browser honoured it.
