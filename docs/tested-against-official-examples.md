# Tested against official and published examples

Worked examples from Inland Revenue, the ATO, the IRS and OpenAccountants'
guides (which cite those authorities), checked against NZOSA. Where an example
could be entered through the app it was: bank files dropped on Bank import,
entities set up on Entities & accounts, lines coded on Reconcile, and the
report read. Each figure below is also a core test, so it stays checked.

Checked 17–18 October 2026.

## New Zealand

| Example | Source | NZOSA | Result |
| --- | --- | --- | --- |
| Sole trader, taxable income $90,000, 2025-26: tax $19,577.50, no IETC | OpenAccountants NZ IR3 guide, case C1 (IRD tax rates from 1 April 2025) | Entered through the app: IR3 box 24 $90,000, box 36 $19,577.50 | Matches, **after a fix**: box 24 was always nil, so a sole trader's profit never reached the IR3 |
| Rental: $20,000 rent, $15,000 interest, $8,000 other: $3,000 ring-fenced and carried forward | Same guide, case C7 | Entered through the app: 22E $23,000, 22G $20,000, 22I $3,000 | Matches |
| IETC at $68,000: $260 | Same guide, case C2 | $260 | Matches |
| Standard provisional tax on RIT $12,000: $12,600, three of $4,200 | Same guide, case C3 | $12,600, three of $4,200 | Matches |
| GST: $920 of tools, $120 GST, in Box 11 | OpenAccountants NZ GST guide, case 2 | Entered through the app: Box 11 includes $920, Box 12 $120 | Matches |
| GST: $8,500 of advice to a Sydney company, zero-rated, Boxes 5 and 6 | Same guide, case 3 | Entered through the app: Box 5 $20,000 (with an $11,500 sale), Box 6 $8,500 | Matches, **after a fix**: New Zealand lines had no zero-rated choice, so an export was off the return altogether |
| Entertainment $2,300: $150 debit adjustment | Same guide, case 6 | Coded to 420 alone, the full $300 is claimed; split 50/50 into 420 and 424 (the Xero NZ way, which Split offers), $150 is claimed | Same result when split; no change |
| PAYE, M code, $1,000 a week, 2026-27: $171.50 | IRD payroll calculations specification 2026-27, section 5.2 | $171.50; fortnightly $343.00; monthly ME $1,256.66; $4,000 a week $1,210.36 (levy capped) | Matches |
| Seasonal worker's $960 holiday pay: $117.60 | Same, NSW example | $117.60 | Matches |
| ESCT on $79.04 at 17.5%: $13.82 (cents dropped first) | Same, 5.21.4 | $13.82 | Matches |
| ESCT rate thresholds | Same, 5.21.1 and 5.21.2 | 17.5%, 10.5%, 17.5%, 17.5% | Matches |
| Extra pay examples 2 and 3 | Same, 5.11 | $5,850; $1,225 | Matches |
| Extra pay example 1: $10,366.39 | Same, 5.11 | $10,366.40 | One cent apart. IRD's printed figure truncates each part; its own steps 5.1 and 5.2 add them unrounded and truncate once, which gives $10,366.40. Not changed |
| Depreciation: $10,000 at 30% DV bought 15 September, 31 March year end | IRD whole-month rule | $1,750, then $2,475 | Matches |

## Australia

| Example | Source | NZOSA | Result |
| --- | --- | --- | --- |
| Sole trader: $92,000 income, $11,060 deductions, taxable $80,940: tax $15,070, Medicare $1,619, offset $1,000, total $15,689 | OpenAccountants AU individual guide, example 1 (Ryan Duguid, accountant) | Entered through the app on Australian books: $15,070, -$1,000, $1,618.80, estimate $15,688.80 | Matches (the guide rounds Medicare to dollars) |
| Medicare levy reduction: Angie, $29,000 in 2025-26, pays $98.90; thresholds $28,011 and $35,013 | ATO, "Medicare levy reduction for low-income earners" (updated 30 June 2026) | $98.90 | Matches |
| BAS: "round down to whole dollars (don't show cents)" | ATO, "Instructions for completing your BAS" (updated 14 September 2026) | Showed cents | **Fixed**: the BAS shows whole dollars, rounded down, and the amount to pay is worked from them |
| Super guarantee: 12%; maximum contribution base $62,500 a quarter (2025-26), $270,830 a year from 2026-27 | OpenAccountants AU super guarantee guide | The same | Matches |
| Company tax: 25% base rate entity, 30% otherwise | OpenAccountants AU bookkeeping guide | The same | Matches |

## United States

| Example | Source | NZOSA | Result |
| --- | --- | --- | --- |
| SE tax on $53,087: $7,501, half $3,750 | OpenAccountants US Schedule C and SE guide (accountant-checked method), example 1 | $7,500.95, half $3,750.48 | Matches |
| SE tax on $102,500: $14,483 | Same, example 2 | Entered through the app on US books ($142,000 receipts, $39,500 of expenses with the $1,000 home office): Schedule C net $102,500, SE tax $14,482.79, half $7,241.40; QBI deduction $15,901.72 (limited to 20% of taxable income before it), taxable $63,606.88, federal tax $8,907.51; June's payment moved to Monday 16 June 2025 | Matches |
| $280,000: Social Security capped at $176,100, SE tax $29,335, Additional Medicare $527 on Form 8959 | Same, example 5 | $21,836.40 + $7,498.82; $527.22 | Matches. **Fixed** the tax estimate showing the $527 inside the Schedule SE row; it has its own Form 8959 row |
| Federal tax, single, taxable $100,000: $16,914 (2025), $16,712 (2026) | IRS brackets, Rev. Proc. 2024-40 and 2025-32 | The same | Matches |
| 1099-NEC: $600 or more for 2025, $2,000 or more from 2026 | OpenAccountants US workflow guide, case 4 (OBBBA) | The same | Matches |
| Corporation tax 21%; estimated payments 15 April, June, September, December | OpenAccountants Form 1120 guide | The same | Matches |

## South Korea

| Example | Source | NZOSA | Result |
| --- | --- | --- | --- |
| Tax base ₩60,000,000: ₩8,640,000, local income tax ₩864,000 | OpenAccountants KR income tax guide (2025 table) | The same | Matches |
| VAT periods due 25 July and 25 January | — | The same | Matches; a due date on a weekend is not moved to the next business day (25 July 2026 is a Saturday). Not changed |

## Left as they are, to be decided

- **Small business income tax offset (Australia).** The ATO works the offset on
  "net small business income", which leaves out tax-related expenses such as
  the accountant's fee for the return. NZOSA uses the business's net profit
  after them. It changes nothing once the offset reaches its $1,000 cap, and
  the rule's exact scope was not confirmed, so it is unchanged.
- **IRD extra pay example 1**, one cent, above.
- **Korean due dates on a weekend**, above.
- **Standard provisional tax** is rounded to whole dollars before it is
  split into instalments ($19,577.50 plus 5% is $20,556.375, shown as
  $20,556, in three of $6,852). The IRD guide's own case is whole dollars
  already, so this was not tested against a source.
