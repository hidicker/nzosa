/**
 * A balance sheet row's name. The code once where the account's name is only
 * its code again ("kea-card-4021"), and the lines not coded yet said in words
 * rather than as "(uncoded) (uncoded)".
 */
export function balanceSheetLabel(line: { code: string; name: string }): string {
  const code = line.code.trim();
  const name = line.name.trim();
  if (code === "(uncoded)" || (code === "" && name === "(uncoded)")) return "Not coded to an account yet";
  if (code === "" || name === "" || name === code) return code === "" ? name : code;
  // A bank account named in the books for its own name ("checking",
  // "Checking"), not a code anybody gave it.
  if (name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") === code) return name;
  // Nor an id the books made up ("au-business"): no number in it to tell anybody anything.
  if (/^[a-z][a-z-]*$/.test(code)) return name;
  return `${code} ${name}`;
}

/**
 * A bank account's name with its id beside it, as "BNZ Visa (02-1234-...)":
 * the account number tells somebody which account it is. An id the books made
 * up ("au-business", or the name made into one) tells them nothing, and is
 * left off.
 */
export function bankWithId(name: string, id: string): string {
  if (name === "" || name === id) return id;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (slug === id || /^[a-z][a-z-]*$/.test(id)) return name;
  return `${name} (${id})`;
}

/** The same, number first as on a statement: "02-1234-... BNZ Visa", or the name alone beside a made-up id. */
export function bankIdThenName(id: string, name: string): string {
  if (name === "" || name === id) return id;
  return /^[a-z][a-z-]*$/.test(id) ? name : `${id} ${name}`;
}
