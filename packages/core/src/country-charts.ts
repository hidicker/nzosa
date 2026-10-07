import type { Account } from "./chart.js";
import { parseChartOfAccounts } from "./chart.js";
import { starterChart } from "./starter-chart.js";

/**
 * The chart a new set of books starts with, by country.
 *
 * New Zealand's is the standard small-company chart (starter-chart.ts). The
 * others follow what an accountant in that country expects to see: Xero's
 * Australian chart and tax codes; a United States chart whose names fall on
 * the Schedule C and E lines; Korea's standard account names in Korean and
 * English. Each is read by the same parser as an imported chart.
 */

const AU_CHART_CSV = `*Code,*Name,*Type,*Tax Code,Description
200,Sales,Revenue,GST on Income,Income from normal business activity
260,Other Revenue,Revenue,GST on Income,
270,Interest Income,Revenue,Input Taxed,Interest from the bank
310,Cost of Goods Sold,Direct Costs,GST on Expenses,
400,Advertising,Expense,GST on Expenses,
404,Bank Fees,Expense,GST Free Expenses,
408,Cleaning,Expense,GST on Expenses,
412,Consulting & Accounting,Expense,GST on Expenses,
416,Depreciation,Expense,BAS Excluded,
420,Entertainment,Expense,GST on Expenses,Generally not deductible and no GST credit
425,Freight & Courier,Expense,GST on Expenses,
429,General Expenses,Expense,GST on Expenses,
433,Insurance,Expense,GST on Expenses,
437,Interest Expense,Expense,GST Free Expenses,
441,Legal Expenses,Expense,GST on Expenses,
445,Light Power Heating,Expense,GST on Expenses,
449,Motor Vehicle Expenses,Expense,GST on Expenses,
461,Printing & Stationery,Expense,GST on Expenses,
469,Rent,Expense,GST on Expenses,
473,Repairs and Maintenance,Expense,GST on Expenses,
477,Wages and Salaries,Expense,BAS Excluded,
478,Superannuation,Expense,BAS Excluded,
485,Subscriptions,Expense,GST on Expenses,
489,Telephone & Internet,Expense,GST on Expenses,
493,Travel - National,Expense,GST on Expenses,
610,Accounts Receivable,Current Asset,BAS Excluded,
800,Accounts Payable,Current Liability,BAS Excluded,
820,GST,Current Liability,BAS Excluded,
825,PAYG Withholdings Payable,Current Liability,BAS Excluded,
826,Superannuation Payable,Current Liability,BAS Excluded,
880,Owner A Drawings,Equity,BAS Excluded,
881,Owner A Funds Introduced,Equity,BAS Excluded,
960,Retained Earnings,Equity,BAS Excluded,
`;

const US_CHART_CSV = `*Code,*Name,*Type,*Tax Code,Description
4000,Sales,Revenue,Tax Exempt,Schedule C line 1
4100,Rent received,Revenue,Tax Exempt,Schedule E line 3
4900,Interest income,Revenue,Tax Exempt,
5000,Cost of goods sold,Direct Costs,Tax Exempt,Schedule C line 4
6000,Advertising,Expense,Tax Exempt,
6010,Car and truck expenses,Expense,Tax Exempt,
6020,Commissions and fees,Expense,Tax Exempt,
6030,Contract labor,Expense,Tax Exempt,1099-NEC payees
6040,Depreciation,Expense,Tax Exempt,
6050,Insurance,Expense,Tax Exempt,
6060,Mortgage interest,Expense,Tax Exempt,
6070,Other interest,Expense,Tax Exempt,
6080,Legal and professional services,Expense,Tax Exempt,
6090,Office expense,Expense,Tax Exempt,
6100,Rent or lease - equipment,Expense,Tax Exempt,
6110,Rent or lease - property,Expense,Tax Exempt,
6120,Repairs and maintenance,Expense,Tax Exempt,
6130,Supplies,Expense,Tax Exempt,
6140,Taxes and licenses,Expense,Tax Exempt,
6150,Travel,Expense,Tax Exempt,
6160,Business meals,Expense,Tax Exempt,50% deductible
6170,Utilities,Expense,Tax Exempt,
6180,Wages,Expense,Tax Exempt,
6190,Property management fees,Expense,Tax Exempt,
6200,Cleaning and maintenance,Expense,Tax Exempt,
6900,Other expenses,Expense,Tax Exempt,
1200,Accounts receivable,Current Asset,Tax Exempt,
2000,Accounts payable,Current Liability,Tax Exempt,
2200,Sales tax payable,Current Liability,Tax Exempt,State sales tax collected
3000,Owner contributions,Equity,Tax Exempt,
3100,Owner draws,Equity,Tax Exempt,
3900,Retained earnings,Equity,Tax Exempt,
`;

const KR_CHART_CSV = `*Code,*Name,*Type,*Tax Code,Description
401,매출 Sales,Revenue,10% VAT on Income,
402,임대료 수입 Rent received,Revenue,10% VAT on Income,
403,면세 매출 Exempt sales,Revenue,Exempt,
901,이자수익 Interest income,Revenue,No VAT,
451,매출원가 Cost of sales,Direct Costs,10% VAT on Expenses,
801,급여 Salaries and wages,Expense,No VAT,
806,퇴직급여 Retirement benefits,Expense,No VAT,
811,복리후생비 Employee welfare,Expense,10% VAT on Expenses,
812,여비교통비 Travel and transport,Expense,10% VAT on Expenses,
813,기업업무추진비 Business entertainment,Expense,No VAT,Input VAT is not deductible
814,통신비 Communications,Expense,10% VAT on Expenses,
815,수도광열비 Utilities,Expense,10% VAT on Expenses,
817,세금과공과 Taxes and dues,Expense,No VAT,
818,감가상각비 Depreciation,Expense,No VAT,
819,지급임차료 Rent,Expense,10% VAT on Expenses,
820,수선비 Repairs,Expense,10% VAT on Expenses,
821,보험료 Insurance,Expense,Exempt,
822,차량유지비 Vehicle,Expense,10% VAT on Expenses,
833,광고선전비 Advertising,Expense,10% VAT on Expenses,
830,소모품비 Supplies,Expense,10% VAT on Expenses,
831,지급수수료 Fees and commissions,Expense,10% VAT on Expenses,
931,이자비용 Interest expense,Expense,No VAT,
108,외상매출금 Accounts receivable,Current Asset,No VAT,
251,외상매입금 Accounts payable,Current Liability,No VAT,
255,부가세예수금 VAT payable,Current Liability,No VAT,
331,자본금 Owner's capital,Equity,No VAT,
338,인출금 Drawings,Equity,No VAT,
`;

/** The starter chart for a country: New Zealand's where the country has none. */
export function starterChartFor(country: string): Account[] {
  if (country === "au") return parseChartOfAccounts(AU_CHART_CSV).accounts;
  if (country === "us") return parseChartOfAccounts(US_CHART_CSV).accounts;
  if (country === "kr") return parseChartOfAccounts(KR_CHART_CSV).accounts;
  return starterChart();
}
