import type { Account } from "./chart.js";
import { parseChartOfAccounts } from "./chart.js";

/**
 * The chart a new set of books starts with.
 *
 * Starting empty is technically honest and practically useless: with no chart
 * there is nothing to code to, the account picker is empty, and the first
 * thing anybody has to do is find a chart of accounts somewhere else and
 * import it. Every one of them would import very nearly this, because this is
 * the standard New Zealand small-company chart -- the same numbering an
 * accountant here expects to see, so a set of books can be handed to one
 * without a conversation about what 429 means.
 *
 * It is a starting point and not a fixture: accounts can be renamed, renumbered
 * and removed, and anybody who has their own chart can import it over the top.
 *
 * Held as the CSV rather than as objects so that it is read by the same parser
 * as an imported chart. A starter chart that took a private path into the app
 * would be the one chart never exercising the code every other chart uses.
 */
const STARTER_CHART_CSV = `*Code,*Name,*Type,*Tax Code,Description,GST Treatment
200,Sales,Revenue,15% GST on Income,Income from any normal business activity,standard
260,Other Revenue,Revenue,15% GST on Income,Any other income that does not relate to normal business activities and is not recurring,standard
270,Interest Income,Revenue,No GST,"Gross interest income (i.e. before deducting Residential Withholding Tax), such as bank interest",out-of-scope
300,Depreciation Recovered,Other Income,No GST,,out-of-scope
301,Capital Gain (Loss) on Disposal of Assets,Revenue,15% GST on Income,,standard
310,Cost of Goods Sold,Direct Costs,15% GST on Expenses,Cost of goods sold by the business,standard
400,Advertising,Overhead,15% GST on Expenses,Expenses incurred for advertising while trying to increase sales,standard
401,ACC Levy Expenses,Expense,15% GST on Expenses,,standard
404,Bank Fees,Overhead,No GST,Fees charged by your bank for transactions regarding your bank account(s).,out-of-scope
408,Cleaning,Overhead,15% GST on Expenses,Expenses incurred for cleaning  business property.,standard
412,Consulting & Accounting,Overhead,15% GST on Expenses,Expenses related to paying consultants,standard
413,Subcontractors (GST Registered),Expense,15% GST on Expenses,,standard
414,Subcontractors (Not GST Registered),Expense,15% GST on Expenses,,standard
416,Depreciation,Overhead,No GST,The amount of the asset's cost (based on the useful life) that was consumed during the period,out-of-scope
420,Entertainment,Overhead,15% GST on Expenses,50% of the total expense relating to business-related entertainment. E.g. shouting clients or employees  a drink or a meal etc.,standard
424,Entertainment - Non deductible,Overhead,No GST,Expenses paid by company for the business but are not deductable for income tax purposes.,out-of-scope
425,Freight & Courier,Overhead,15% GST on Expenses,Expenses incurred on courier & freight costs,standard
429,General Expenses,Overhead,15% GST on Expenses,General expenses related to the running of the business.,standard
433,Insurance,Overhead,15% GST on Expenses,Expenses incurred for insuring the business' assets,standard
437,Interest Expense,Overhead,No GST,"Any interest expenses paid to IRD, business bank accounts or credit card accounts.",out-of-scope
441,Legal expenses,Overhead,15% GST on Expenses,Expenses incurred on any legal matters,standard
445,"Light, Power, Heating",Overhead,15% GST on Expenses,"Expenses incurred for lighting, powering or heating the premises",standard
446,Low Value Assets <1K,Expense,15% GST on Expenses,,standard
449,Motor Vehicle Expenses,Overhead,15% GST on Expenses,Expenses incurred on the running of company motor vehicles,standard
453,Office Expenses,Overhead,15% GST on Expenses,General expenses related to the running of the business office.,standard
461,Printing & Stationery,Overhead,15% GST on Expenses,Expenses incurred by the entity as a result of printing and stationery,standard
469,Rent,Overhead,15% GST on Expenses,The payment to lease a building or area.,standard
470,Loss on sale of Fixed Assets,Expense,No GST,,out-of-scope
473,Repairs and Maintenance,Overhead,15% GST on Expenses,Expenses incurred on a damaged or run down asset that will bring the asset back to its original condition.,standard
477,Salaries,Overhead,No GST,Payment to employees in exchange for their resources,out-of-scope
478,KiwiSaver Employer Contributions,Overhead,No GST,KiwiSaver employer contributions,out-of-scope
485,Subscriptions,Overhead,15% GST on Expenses,"E.g. Magazines, professional bodies.",standard
489,Telephone & Internet,Overhead,15% GST on Expenses,"Expenditure incurred from any business-related phone calls, phone lines, or internet connections",standard
493,Travel - National,Overhead,15% GST on Expenses,Expenses incurred from domestic travel which has a business purpose,standard
494,Travel - International,Overhead,No GST,Expenses incurred from international travel which has a business purpose,out-of-scope
495,Staff Training Expense,Expense,15% GST on Expenses,,standard
505,Income Tax Expense,Expense,No GST,A percentage of total earnings paid to the government.,out-of-scope
506,Stripe Fees,Expense,No GST,,out-of-scope
507,PayPal fees,Expense,No GST,PayPal fees,out-of-scope
610,Accounts Receivable,Accounts Receivable,No GST,Outstanding invoices the company has issued out to the client but has not yet received in cash at balance date.,out-of-scope
611,less Provision for Doubtful Debts,Current Asset,No GST,A provision anticipating that some of the accounts receivables will become bad debts.,out-of-scope
620,Prepayments,Current Asset,No GST,An expenditure that has been paid for in advance.,out-of-scope
625,Withholding tax paid,Current Asset,No GST,Withholding tax paid,out-of-scope
630,Inventory,Inventory,No GST,Value of tracked items for resale.,out-of-scope
710,Office Equipment,Fixed Asset,15% GST on Expenses,Office equipment that is owned and controlled by the business,standard
711,Less Accumulated Depreciation on Office Equipment,Fixed Asset,No GST,The total amount of office equipment cost that has been consumed by the entity (based on the useful life),out-of-scope
720,Computer Equipment,Fixed Asset,15% GST on Expenses,Computer equipment that is owned and controlled by the business,standard
721,Less Accumulated Depreciation on Computer Equipment,Fixed Asset,No GST,The total amount of computer equipment cost that has been consumed by the business (based on the useful life),out-of-scope
740,Motor Vehicle >1K,Fixed Asset,15% GST on Expenses,Vehicles owned and controlled by the business,standard
741,Less Accumulated Depreciation – Vehicles,Fixed Asset,No GST,Accumulated Depreciation for Vehicle,out-of-scope
800,Accounts Payable,Accounts Payable,No GST,Outstanding invoices the company has received from suppliers but has not yet paid at balance date,out-of-scope
801,Unpaid Expense Claims,Unpaid Expense Claims,No GST,Expense claims typically made by employees/shareholder employees still outstanding.,out-of-scope
814,Wages Payable - Payroll,Current Liability,No GST,"Where this account is set as the nominated Wages Payable account within Payroll Settings, Xero allocates the net wage amount of each pay run created using Payroll to this account",out-of-scope
816,Wages Deductions Payable,Current Liability,No GST,The amounts deducted from employee's wages due to be paid,out-of-scope
820,GST,GST,No GST,"The balance in this account represents GST owing to or from the IRD. At the end of the GST period, it is this account that should be used to code against either the 'refunds from' or 'payments to' the IRD that will appear on the bank statement. Xero has been designed to use only one GST account to track GST on income and expenses, so there is no need to add any new GST accounts to Xero.",out-of-scope
825,PAYE Payable,Current Liability,No GST,The amount of PAYE tax that is due to be paid,out-of-scope
830,Income Tax,Current Liability,No GST,"The amount of income tax that is due to be paid, also resident withholding tax paid on interest received.",out-of-scope
840,Historical Adjustment,Historical,No GST,For accountant adjustments,out-of-scope
850,Suspense,Current Liability,No GST,"An entry that allows an unknown transaction to be entered, so the accounts can still be worked on in balance and the entry can be dealt with later.",out-of-scope
860,Rounding,Rounding,No GST,An adjustment entry to allow for rounding,out-of-scope
877,Tracking Transfers,Tracking,No GST,Transfers between tracking categories,out-of-scope
900,Loan,Non-current Liability,No GST,Money that has been borrowed from a creditor,out-of-scope
910,Loan from Director,Non-current Liability,No GST,Loan from directors,out-of-scope
960,Retained Earnings,Retained Earnings,No GST,Do not Use,out-of-scope
970,Owner Funds Introduced,Equity,No GST,Funds contributed by the owner,out-of-scope
980,Owner Drawings,Equity,No GST,Withdrawals by the owners,out-of-scope
`;

/**
 * A fresh copy of the starter chart.
 *
 * Parsed on each call and never shared, because the caller owns what it gets
 * back and will edit it -- handing out one cached array would let one set of
 * books rename an account in another.
 */
export function starterChart(): Account[] {
  return parseChartOfAccounts(STARTER_CHART_CSV).accounts;
}
