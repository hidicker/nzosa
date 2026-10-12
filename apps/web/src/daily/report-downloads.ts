/**
 * Which reports Download CSV can save, and as what.
 *
 * Anything not named here hides the button. It used to fall through to the
 * profit and loss, so the balance sheet, the general ledger and nine others
 * all downloaded a P&L under their own name -- a file that says it is one
 * thing and holds another is worse than no file. A report added later has no
 * download until it is given one here.
 */
export const REPORT_DOWNLOADS = {
  pl: "Profit and loss",
  // The journal report's entries, line by line: the general ledger's format.
  journal: "General ledger",
  general: "General ledger",
  extract: "Account transactions",
  depreciation: "Depreciation schedule",
  agedpayables: "Aged payables",
  agedreceivables: "Aged receivables",
  bankreconcile: "Bank reconciliation",
  gstreturn: "GST return",
  rentals: "Rental schedules",
  ir3: "IR3",
  owner: "Income by owner",
} as const;

export type DownloadKind = keyof typeof REPORT_DOWNLOADS;

export function hasDownload(kind: string): kind is DownloadKind {
  return Object.prototype.hasOwnProperty.call(REPORT_DOWNLOADS, kind);
}
