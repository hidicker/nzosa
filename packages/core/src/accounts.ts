/**
 * Account-number normalisation.
 *
 * The same NZ bank account appears in different feeds with different suffix
 * padding -- `02-1100-0022002-02` in a BNZ payments export and
 * `02-1100-0022002-002` in the counterparty column of another. Left alone,
 * that difference splits one account into two everywhere downstream.
 */

/**
 * Canonicalise an NZ bank account number to `BB-bbbb-AAAAAAA-SSS`.
 *
 * Returns the trimmed input unchanged when it is not an NZ account number,
 * so foreign IBANs and Wise references pass through intact.
 */
export function normaliseAccountNumber(value: string): string {
  const text = value.trim();
  if (text === "") return "";

  const parts = text.split("-");
  if (parts.length !== 4) return text;
  if (!parts.every((part) => /^\d+$/.test(part))) return text;

  const [bank, branch, account, suffix] = parts as [string, string, string, string];
  if (bank.length > 2 || branch.length > 4 || account.length > 7 || suffix.length > 4) {
    return text;
  }

  return [
    bank.padStart(2, "0"),
    branch.padStart(4, "0"),
    account.padStart(7, "0"),
    suffix.padStart(3, "0"),
  ].join("-");
}

/** True when `value` looks like an NZ bank account number. */
export function isAccountNumber(value: string): boolean {
  return /^\d{2}-\d{4}-\d{7}-\d{2,4}$/.test(value.trim());
}

/**
 * Build a stable account id from a label and an optional account number.
 *
 * The number is authoritative when present, because labels get renamed and
 * truncated by bank exports; the label is only a fallback.
 */
export function accountId(label: string, number?: string): string {
  const normalised = number ? normaliseAccountNumber(number) : "";
  if (normalised !== "" && isAccountNumber(normalised)) return normalised;
  return label.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") || "unknown";
}
