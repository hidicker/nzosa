/**
 * @nzosa/core
 *
 * Bank flat files in, canonical transactions out.
 *
 * Everything here is a pure function over strings and plain objects. There is
 * no file system, no network and no database, which is what lets the same code
 * run in a browser tab with the file never leaving the machine, in a Node CLI,
 * or behind a server. Storage is the caller's problem, deliberately.
 */

export { parseCsv, parseCsvRecords, findHeaderRow, normaliseHeader } from "./csv.js";
export type {
  Row,
  ReadonlyRow,
  CsvRecord,
  ReadonlyCsvRecord,
  CsvParseOptions,
  HeaderMatch,
} from "./csv.js";

export { matchInvoices } from "./invoice-matching.js";
export type {
  InvoiceMatch,
  InvoiceMatchProposal,
  InvoiceMatchOptions,
  InvoiceMatchResult,
} from "./invoice-matching.js";

export {
  parseDailyBalances,
  matchBalanceAccount,
  checkDailyBalances,
  judgeDuplicates,
} from "./bank-balances.js";
export type {
  DailyBalance,
  BalanceSection,
  BalanceImportResult,
  BalanceBreak,
  BalanceCheck,
  DuplicateJudgement,
  DuplicateVerdict,
} from "./bank-balances.js";

export {
  postInvoice,
  postDepreciation,
  postTransfer,
  taxTypeFromRate,
  postTransaction,
  postDisposal,
  journalImbalance,
  trialBalance,
  taxSummary,
  taxTypeFor,
} from "./posting.js";
export type {
  JournalSource,
  TaxBasis,
  SettledInvoice,
  DepreciationPosting,
  TransferPosting,
  TaxType,
  PostedLine,
  PostedJournal,
  PostingPart,
  PostingOptions,
  TrialBalance,
  TrialBalanceRow,
  TaxSummary,
} from "./posting.js";

export {
  inferRules,
  inferAccountUsage,
  keywordFor,
  coverage,
} from "./rule-inference.js";
export type {
  CodedExample,
  RuleProposal,
  InferenceOptions,
  AccountUsage,
  AccountUse,
} from "./rule-inference.js";

export { canonicalCodeFor, matchAccountName, bareAccountName } from "./coding-names.js";
export { knownCodes, labelForChartAccount, chartTreatments, accountLabel, splitAccountLabel } from "./chart-codes.js";
export { starterChart } from "./starter-chart.js";
export { identifyExport } from "./identify-export.js";
export type { ExportKind, Identified } from "./identify-export.js";
export { invoiceDocument } from "./invoice-document.js";
export type { InvoiceSupplier, InvoiceDocumentOptions } from "./invoice-document.js";
export { renameAccount, renameProblem } from "./rename-account.js";
export type { AccountReferences, RenameResult } from "./rename-account.js";
export type { RuleFile, ImpliedTreatment } from "./chart-codes.js";

export { formatChartOfAccounts } from "./chart.js";

export {
  parseFixedAssets,
  depreciationSchedule,
  formatDepreciationSchedule,
} from "./assets.js";
export type {
  FixedAsset,
  AssetImportResult,
  DepreciationRow,
  DepreciationSchedule,
} from "./assets.js";

export { TAX_EXTRA_CATEGORIES, totalExtras } from "./reports.js";
export type { TaxExtra, TaxExtraCategory } from "./reports.js";

export {
  accrualProfitAndLoss,
  profitAndLoss,
  formatProfitAndLoss,
  summariseForOwner,
  formatOwnerSummary,
  isKnownType,
  sectionForType,
  sectionsFromChart,
  gstWithin,
} from "./reports.js";
export type {
  AccrualOptions,
  OwnerShare,
  OwnerSummary,
  ProfitAndLoss,
  ProfitAndLossOptions,
  ReportLine,
  ReportSection,
} from "./reports.js";

export {
  formatOwners,
  ownersOf,
  parseOwners,
  ownersTotal,
  shareOf,
} from "./entities.js";
export type { Owner, EntityKind } from "./entities.js";

export {
  accountEntityKey,
  emptyEntityModel,
  defaultEntityModel,
  reportsNetOfGst,
  DEFAULT_ENTITY_NAME,
  entityId,
  entityOfAccount,
  entitiesOfBank,
  validateEntityModel,
  entityCoverage,
} from "./entities.js";
export type {
  Entity,
  EntityModel,
  AccountEntities,
  BankEntities,
  EntityProblem,
} from "./entities.js";

export { parseAmount, formatAmount, minorUnits } from "./money.js";
export type { Cents } from "./money.js";

export {
  parseDate,
  fromExcelSerial,
  daysBetween,
  daysInMonth,
  financialYear,
  inRange,
} from "./dates.js";
export type {
  IsoDate,
  DateParseOptions,
  DateRange,
  FinancialYearOptions,
} from "./dates.js";

export { normaliseAccountNumber, isAccountNumber, accountId } from "./accounts.js";

export { hash } from "./hash.js";

export {
  importers,
  getImporter,
  detect,
  detectAll,
  importFile,
  bnzAccount,
  bnzCard,
  bnzTransactionList,
  anzLoan,
  wise,
} from "./importers/index.js";
export type { ImportOptions } from "./importers/index.js";

export { dedupe, dedupeKey, looseKey } from "./dedupe.js";
export type {
  DedupeEntry,
  DedupeOptions,
  DedupeResult,
  DedupeStatus,
} from "./dedupe.js";

export type {
  DetectionResult,
  Importer,
  ImporterContext,
  ImportProblem,
  ImportResult,
  Transaction,
  TransactionSource,
} from "./types.js";

export {
  gstReturn,
  gstPeriods,
  gstDueDate,
  gstContent,
} from "./gst.js";
export type {
  GstBasis,
  GstRounding,
  GstTreatment,
  GstSide,
  GstClassification,
  GstResolver,
  GstPeriod,
  GstPeriodOptions,
  GstReturnBoxes,
  GstReturnOptions,
  GstReturnLine,
  GstReturnResult,
} from "./gst.js";

export { gstResolver, DEFAULT_GST_RULES } from "./gst-rules.js";
export type { GstRule, GstRulesOptions } from "./gst-rules.js";

export { categorise, categoriseAll, matchText } from "./rules.js";
export type {
  Sign,
  CategoryRule,
  CategoryDefault,
  Categorisation,
  MatchedBy,
  RuleSet,
} from "./rules.js";

export { overrideFor, gstOverride } from "./overrides.js";
export type { TransactionOverride, Overrides } from "./overrides.js";

export { validateSplits, expandSplits, splitPartId } from "./splits.js";
export type { SplitPart, Splits, SplitProblem, ExpandedSplits } from "./splits.js";

export {
  parseXeroInvoices,
  parseXeroAllocations,
  validateInvoices,
  invoiceGross,
  allocateAcrossLines,
  invoiceBalances,
} from "./invoices.js";
export type {
  Invoice,
  InvoiceLine,
  InvoiceKind,
  InvoiceProblem,
  InvoiceImportResult,
  PaymentAllocation,
  AllocationImportResult,
  InvoiceBalance,
  InvoiceAssignment,
  InvoiceStatus,
} from "./invoices.js";
export * from "./xero.js";
export * from "./journals.js";
export * from "./chart.js";
export * from "./variance.js";
export * from "./xlsx.js";
export * from "./akahu.js";
export * from "./filed-returns.js";
export * from "./coding-check.js";

export {
  formatAccountTransactions,
  accountTransactionRows,
  gstRateName,
  EXPORT_MARK,
} from "./account-transactions.js";
export type {
  AccountTransactionRow,
  AccountTransactionsOptions,
} from "./account-transactions.js";

export {
  generalLedgerRows,
  generalLedgerTotals,
  formatGeneralLedger,
} from "./general-ledger.js";
export type { GeneralLedgerRow, GeneralLedgerOptions } from "./general-ledger.js";
export * from "./ir10.js";
export * from "./balance-sheet.js";
export * from "./trial-balance.js";
export * from "./text.js";
export * from "./disposal.js";
export * from "./shareholders.js";
export * from "./payouts.js";
export * from "./manual-journals.js";
export * from "./ir3.js";
