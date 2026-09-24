# Rates to update each year

New Zealand's tax and payroll figures change on 1 April. NZOSA holds them in
tables, one row per tax year (named by the 31 March it ends on). A year with
no row works out no tax, so `packages/core/test/yearly-rates.test.js` fails on
the first day of a tax year that has none. When it does, work through this
list.

## Income tax and the IR3 — `packages/core/src/rental-schedules.ts`

- `INCOME_TAX`: the bands. Legislated with no end date, so usually a copy of
  last year's row; check no Budget changed them.
- `EARNER_LEVY`: rate (including GST) and maximum liable earnings, from IRD's
  "ACC earners' levy rates" page. IRD publishes the next year's in advance.
- `IETC`: from IRD's independent earner tax credit page.
- `residentialInterestDeductible`: only if the interest limitation rules change.

## Payroll — `packages/core/src/payroll.ts`

- `RATES`: levy, levy ceiling, maximum levy and the KiwiSaver default rate
  (4% for paydays from 1 April 2028).
- Download IRD's *Payroll Calculations & Business Rules Specification* and
  *Payday software developers' casebook* for the year (IRD's digital service
  providers pages). Re-run the casebook figures in `test/payroll.test.js`
  against the new year's scenario 3.1 and 3.6 tables.
- Check the *Payday Filing File Upload Specification*: if the HEI2 or DEI
  layout changes, `generatePaydayFilingCsv` changes with it.
- Student loan threshold ($24,128, frozen indefinitely), ESCT bands and the
  secondary rates: change only if the specification does.

## Vehicles — `packages/core/src/year-end-adjustments.ts`

- `KILOMETRE_RATES`: IRD publishes each year's kilometre rates after the year
  ends (the 2025-26 rates came out on 2 June 2026). Add the row then.

## After updating

Run `npm test -w @nzosa/core`, then deploy.
