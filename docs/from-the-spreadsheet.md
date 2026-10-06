# What the spreadsheet encodes

NZOSA is a rebuild of a working personal-and-business accounting workbook —
74 sheets, several years of real use, covering a roasting business, three
rental properties and personal spending in New Zealand.

This note records what that workbook actually does, so the knowledge survives
the rebuild rather than living only in formulas. It is the source of the
roadmap. Nothing here contains real financial data.

## The pipeline

```
  bank downloads          AllAccountsRaw
  (per account,     ->    canonical 13-column      ->   DuplicatesRemoved
   per month)             transaction shape             (dedupe keys + counts)
                                                              |
                                                              v
  XeroCSV        <-   Split Transactions   <-   GST_Rules  <-  Rules
  GST returns         Editor                    GST_Overrides   Defaults
  P&L, tax packs
```

## 1. Import

Monthly downloads per account: BNZ transaction accounts ("Payment",
"Spending"), BNZ credit cards, ANZ loan statements, and Wise. Each has a
different column set, pasted into its own sheet.

BNZ also offers a **Transaction list** export covering every account at once, in
blocks. Its columns are exactly the thirteen the workbook normalises everything
else into — so the spreadsheet's canonical row *was* this export all along, and
the other sheets were being hand-mapped onto it.

That export also settles something the sheet names make ambiguous:
**"Kea Coffee Roasters" and "Kea Coffee Roaster" are two different accounts**, not
one name truncated two ways. The first is the company's bank account
(`02-1100-0022001-001`); the second is its credit card, whose label BNZ truncates
to seventeen characters. The parallel entries for them in `Rules` and `Defaults`
are therefore correct and necessary — card debits default to subscriptions, bank
credits default to sales.

**Rebuilt as:** `packages/core/src/importers/`.

## 2. Canonical shape

Everything is mapped to one 13-column row:

```
Date | Amount | CCY | Serial | Trn | Particulars | Code | Reference |
Other Party | Origin | Type | Batch | Other Party Account
```

plus `BankAccount`, derived from the `This Party Account` column.

**Rebuilt as:** the `Transaction` interface in `packages/core/src/types.ts`.
Two deliberate deviations:

- Amounts are integer minor units rather than floats. The workbook carries
  values like `-78.08000000000001` and `-195.00000000000003` from float
  round-trips.
- For a foreign card purchase the workbook puts the original currency in the
  `CCY` column while `Amount` stays in NZD. NZOSA keeps `currency` as the
  account's own currency and records the original leg separately in `foreign`,
  so the currency of an amount is never ambiguous.

## 3. Deduplication

The workbook builds two concatenated keys per row and counts occurrences of
each:

| Workbook column   | Fields                                                            |
| ----------------- | ----------------------------------------------------------------- |
| Full key          | Date, Amount, CCY, Serial, Trn, Particulars, Code, Reference, Other Party |
| "Without Serial"  | Date, Amount, CCY, Trn, Particulars, Code, Other Party             |

Alongside these are two hand-maintained columns:

- **`Legitimate Duplicates`** — a manual flag marking repeats that are real.
- **`IgnoreConsequative Dates` / `Consequative Dups`** — for transactions that
  legitimately repeat on adjacent days.

**Rebuilt as:** `packages/core/src/dedupe.ts`. `dedupeKey` and `looseKey` are
the two keys above, with `account` added — the workbook tracked the account in a
separate column, but the same amount to the same payee on two accounts is two
transactions. The manual columns become the `legitimateDuplicates` allowlist and
the `adjacentDays` check, and the "without serial" case is a `review` flag
rather than an automatic removal.

## 4. Categorisation — *not yet built*

The `Rules` sheet, in priority order:

```
Priority | Keyword | Account | Sign | MinAmt | MaxAmt | Code | HistCount | Note | Confidence
```

A rule matches on a keyword in the transaction text, optionally narrowed by
which account it is on, whether it is a debit or a credit, and an amount band.
Priority orders the rules; the first match wins.

The real workbook shows why each narrowing exists:

- **Priority 10** matches an exact loan account reference, with **priority 20**
  keyword fallbacks "if col H unreadable".
- Two rules share the keyword `TOTALMONEY` and are separated only by amount
  band — `40–180` versus `300–750`, annotated "~82 +/-30%" and "~484 +/-30%" —
  with a third catch-all for anything outside both.
- The same keyword resolves differently by account: `BUNNINGS` on one card is a
  property expense, and a hardware store in a particular suburb is attributed to
  the property nearest it.

The `Defaults` sheet is the fallback layer, keyed on account plus DR/CR, with a
`HistCount` and a hit ratio like `587/631` that amounts to a confidence score.

## 5. GST — *not yet built*

- **`GST_Rules`**: account code → `Inc` or `Excl`, with a history count and a
  consistency note (`978/979 consistent`).
- **`GST_Overrides`**: keyword plus account → treatment, for the cases the code
  alone gets wrong. Two examples from the sheet: Wise payments carry no NZ GST,
  and specific counterparties are not GST registered.

## 6. Splits — *not yet built*

The `Split Transactions Editor` fans one payment into several lines, each with
its own account code and GST treatment, keyed back to the original transaction.

## 7. Outputs — *not yet built*

- `XeroCSV` — `*Date, *Amount, Payee, Description, Reference, Check Number, GST,
  Uploaded?`, where Description carries the account code and Check Number is the
  dedupe key, used to track what has already been uploaded.
- GST returns, profit and loss, per-entity tax summaries, fixed assets and
  depreciation, and a summary sheet for the accountant.

## Open questions

Things the workbook does not settle, which need a real statement to resolve:

- **Wise fees.** The export has `Source amount (after fees)` and a separate
  `Source fee amount`. Whether the total leaving the balance is the amount, or
  the amount plus the fee, appears to vary by transfer type. NZOSA records
  the fee in `extras` and never folds it into `amount`, because guessing wrong
  would be invisible. Reconciling against a Wise balance settles it.
- **Budget months.** The workbook has both a `Month Personal Budget` column and
  a `YearMonthTrue` column, and they disagree — a transaction dated 5 September
  is labelled `202308` by the first and `202309` by the second. The budget month
  evidently starts before the calendar month. Whatever reporting gets built will
  need to make that offset explicit and configurable.
