/**
 * A prompt for an AI browser agent to export a business's files from Xero.
 *
 * For somebody happy to have an agent (Claude in Chrome, say) click through
 * Xero for them: they sign in themselves, paste this, and the agent downloads
 * each export NZOSA asks for, with the settings each needs and the dates of
 * these books filled in. It is told to read and export only, and to stop and
 * ask at anything that needs the person: a sign-in, a code, an approval.
 *
 * The settings are the ones the Setup file list gives, and the trial balance
 * and account transactions use the same strings, so the two cannot disagree.
 */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** 2025-04-01 as 1 April 2025. */
function said(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1] ?? ""} ${y}`;
}

function dayBefore(iso: string): string {
  const day = new Date(`${iso}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}

/**
 * The prompt, for books starting on `start` (YYYY-MM-DD). `trialBalance` and
 * `accountTransactions` are the Setup list's own instructions for those two.
 */
export function xeroAgentPrompt(start: string, trialBalance: string, accountTransactions: string): string {
  const from = said(start);
  const before = said(dayBefore(start));
  const plain = (text: string): string => text.replace(/^Xero:\s*/, "");
  return [
    "Please export my accounting files from Xero, so I can load them into NZOSA, a free New Zealand accounting app.",
    "",
    "Ground rules:",
    "- Only read and export. Do not create, edit, approve, delete, void, file, send or reconcile anything in Xero, and do not change any setting except the filters on a report or export screen.",
    "- I sign in myself. If Xero asks for a password, a two-factor code, or to approve or confirm anything, stop and ask me.",
    "- If I have more than one organisation in Xero, ask me which one before starting.",
    "- Save each file to my Downloads folder, keeping the name Xero gives it.",
    "",
    `My books in NZOSA start on ${from}, so the opening figures are as at ${before}.`,
    "",
    "The exports:",
    "1. Chart of accounts: Accounting → Chart of accounts → Export.",
    `2. Account transactions: ${plain(accountTransactions)}. Date range ${from} to today. Export to Excel.`,
    `3. Trial balance: ${plain(trialBalance)} The date is ${before}. Export to Excel.`,
    `4. Invoices: Business → Invoices → All → Export, covering ${from} to today.`,
    `5. Aged receivables: Accounting → Reports → Aged Receivables Detail, as at ${before}, ageing by due date. Export to Excel.`,
    `6. Aged payables: Accounting → Reports → Aged Payables Detail, as at ${before}, ageing by due date. Export to Excel.`,
    "7. Fixed assets: Accounting → Fixed assets → Export (registered and disposed assets).",
    "8. Bank account list: Accounting → Bank accounts → Uncoded statement lines → Export, for all bank accounts.",
    `9. Journal report: Accounting → Reports → Journal Report, ${from} to today, all columns. Export to Excel.`,
    `10. GST returns: Reporting → GST, then each return filed for a period ending on or after ${from}, opened and exported to Excel, one file per return.`,
    "",
    "Bank statements are not needed: NZOSA takes those from the bank itself.",
    "",
    "When you have finished, list every file you saved with its name, and say plainly anything you could not export and why. Do not open or summarise what is in the files.",
  ].join("\n");
}
