# NZOSA outside New Zealand

Books can be kept in another country. The engine is the same everywhere:
- double entry and coding learned from past decisions
- matching and reconciliation
- the profit and loss, balance sheet and cash flow

What changes is a short list of facts about the country, and which returns the books produce.

This is the `international` branch. New Zealand's books open and read exactly as they did: the
parity check (below) compares every page, report and workbook sheet with `main`, word for word.

## Choosing the country

- **A set of books' country is `jurisdiction`** in its decisions.
  - Unset is New Zealand, so every set kept before this is New Zealand's.
- **The choice is under Setup → Country.** It shows only in the international edition:
  - `node apps/web/build.js --edition international` (or `NZOSA_EDITION=international`)
- **Books already set to another country show it in either edition.**
- **NZOSA as it ships never asks.**

## What the country decides

| | New Zealand | Australia | United States | South Korea | Anywhere |
|---|---|---|---|---|---|
| Tax year | 1 Apr – 31 Mar | 1 Jul – 30 Jun | Calendar | Calendar | Calendar |
| Currency | NZD | AUD | USD | KRW (shown without decimals) | USD |
| Sales tax | GST 15% (3/23) | GST 10% (1/11) | none | VAT 10% (1/11) | none |
| Usual GST period | 2 months | quarter | – | 6 months | – |
| Dates in bank files | day first | day first | month first | year first | day first |
| Starter chart | NZ small company | Xero AU | Schedule C/E names | 표준 계정과목 | NZ |

The facts are in `packages/core/src/jurisdiction.ts`. The web app reads them through:
- `apps/web/src/country.ts`: locale, currency, decimals, the rate of GST and the country's own reports
- `apps/web/src/tax-year.ts`: the year's dates, and the year in words

## Returns and reports by country

**New Zealand:** everything NZOSA has always done:
- GST returns, IR10, IR3 and IR3R
- payroll and myIR
- Akahu
- the AI accounts check

Modules tagged `countries: ["nz"]`, and pages marked `data-module="nz"` or `business+nz`, appear only for New Zealand books.

**United States** (`packages/core/src/us-tax.ts`):
- Schedule E Part I, one per rental property
- Schedule C, one per business, with half of business meals on line 24b and cost of goods sold off gross income
- 1099-NEC contractors: payments to contract labor accounts by payee, against the year's threshold
  - $600 to 2025, $2,000 from 2026: confirm
- The four estimated tax dates, moved off weekends
- Not covered:
  - federal or state income tax itself
  - state sales tax
  - payroll
  - Form 8582 passive loss limits
  - home office

**Australia** (`au-tax.ts`):
- The rental property schedule (individual tax return item 21) on the ATO's labels, with notes on:
  - residential travel (not deductible since 2017)
  - second-hand plant
- GST on the BAS by quarter: the simpler BAS's G1, 1A and 1B, with the due dates for lodging yourself
- Resident tax rates and the Medicare levy are in core (`auResidentTax`, `medicareLevy`) for 2025–2027, but not yet on a page
- Not covered:
  - PAYG instalments and withholding
  - the full BAS labels (G2–G20)
  - Single Touch Payroll and super
  - capital works and depreciation schedules

**South Korea** (`kr-tax.ts`), with each line in Korean and English:
- 표준손익계산서: the standard income statement for a sole proprietor
- 부동산임대업: rental income and expenses, with notes on deemed rent (간주임대료), separate taxation of housing rent up to 20 million won, and the single-house rule
- 부가가치세: VAT for each half year (1기, 2기), with the final return due dates
- Comprehensive income tax rates and local income tax are in core (`krIncomeTax`); the 31 May due date is on the business statement
- Not covered:
  - tax invoices against card and cash-receipt sales
  - preliminary returns (예정신고)
  - simplified taxpayers (간이과세자)
  - deemed rent itself
  - deductions and credits

How the forms work:
- **One engine fills every form:** `formSchedule` (core `form-schedules.ts`).
- **Placement:** an account goes on the first line whose rule its name matches, and the line lists the accounts behind it.
- **Choice:** a person's choice of line can be passed in, and wins over the guess.

Rates, thresholds and rules were checked on 7 October 2026 against the OpenAccountants guides:
- **United States:** us-1099-nec-issuance (accountant-verified), us-tax-workflow-base, us-sole-prop-bookkeeping and us-federal-return-assembly
- **Australia:** au-rates-2026-27, au-gst-bas, australia-gst and au-rental-property
- **South Korea:** kr-income-tax, written by the accountant Yeong Min Lee

That check corrected:
- Entertainment is not deductible in the US.
- The 1099-NEC note now covers attorneys and payment processors.
- Australia's low income tax offset and Medicare low-income threshold are applied.
- BAS due dates move off weekends.
- Australian rental losses are limited from 1 July 2027 (new builds, or properties held at 12 May 2026).
- Korea's tax base is rounded down to 10,000 won, with the basic deduction and standard credit applied.
- National pension and health insurance are kept out of Korean business expenses.

The guides are guidance, not certified figures: confirm each rate with the ATO, the IRS and the NTS (Hometax) before relying on it.

## Bank files

- **OFX and QFX** (`packages/core/src/ofx.ts`): most US and Australian banks offer them, as do some New Zealand banks. Both dialects are read through `importFile`:
  - OFX 1, SGML with unclosed tags
  - OFX 2, XML
- **The bank's FITID** is kept as the reference.
- **"Day first"** on Bank import follows the country.

## Testing

- `npm test`: the core tests, including:
  - `jurisdiction`, `sales-tax`, `country-forms`, `country-charts` and `ofx`
  - New Zealand's GST rounding, checked cent for cent across half a million cents
- **Parity with `main`**, New Zealand unchanged:
  - `node tools/parity.mjs --a ../nzosa --b . --ledgers ../nzosa/ledgers --books <sets>`
  - Run `main` against itself first: it must report identical.
- **Invented books** for each country:
  - `node tools/make-country-books.mjs <folder>`, then open one with `--ledgers <folder> --ledger us-books` (or `au-books`, `kr-books`).
