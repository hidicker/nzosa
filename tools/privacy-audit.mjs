/**
 * Check that nothing real has leaked into the files git tracks.
 *
 * This repository is published. The .gitignore keeps whole folders of real
 * data out, and that is the part that matters -- but it cannot help with a
 * payee name copied into a test to make it realistic, which is how a person's
 * name, a bank account and an IRD number ended up in a public repository once
 * already. Those arrive one string at a time and look like ordinary fixtures.
 *
 * So this reads a real ledger, takes every name, reference and account number
 * out of it, and looks for them in the files git tracks. Nothing is sent
 * anywhere and nothing is written: it reads and reports.
 *
 *   node tools/privacy-audit.mjs ledgers/my-books
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const folder = process.argv[2];
if (!folder) {
  console.error("usage: node tools/privacy-audit.mjs <ledger folder>");
  process.exit(2);
}

const part = (name) => {
  const file = join(folder, `${name}.json`);
  if (!existsSync(file)) return [];
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  const data = parsed.data ?? parsed;
  return Array.isArray(data) ? data : [];
};

/**
 * Strings that identify nobody.
 *
 * A shared vocabulary is not a leak: every New Zealand ledger has "Insurance",
 * "Inland Revenue" and "Bank Fee" in it, and a well-known merchant appears on
 * everybody's statement. Listing them here is what keeps the report short
 * enough to read, which is what makes it get read.
 */
const GENERIC =
  /^(ACCOUNTANT|ADJUSTMENT|INSURANCE|INTEREST|PRINCIPAL|SPENDING|GROCERIES|MAINTENANCE|INVESTMENT|KIWISAVER|BANK FEE|LOAN PAYMT|LOAN DRAWDOWN|HOUSING LOAN|INLAND REVENUE|INTERNET XFR|BILL PAYMENT|WITHDRAWAL|AUTOMATIC PAYMENT|VISA PURCHASE|DIRECT CREDIT|DIRECT DEBIT|DD PAYMENT.*|PAYMENT - THANK YOU|BNZCREDITCDS|BANK OF NEW ZEALAND|BNZ ADVANTAGE VISA.*|AUCKLAND|AUCKLAND COUNCIL|WELLINGTON|CHRISTCHURCH|DUNEDIN|HAMILTON|TAURANGA|STOCKHOLM|SHARESIES|TRANSFERWISE|STRIPE.*|PAYPAL.*|BUNNINGS|BUNNINGS WAREHOUSE|NELSON CITY COUNCIL|MITRE 10.*|DHL EXPRESS.*|FEDEX.*|GOOGLE ADS.*|SP GARMIN.*|OPENAI.*|HTTPS.*|SPOTIFY.*|NETFLIX.*|XERO.*|TOWER INSURANCE.*|RICHMOND|NEW LYNN|NELSON|MOUNT ST|FULL YEAR|NZD[0-9]+|INV-[0-9]+|BUILDING|CHRISTMAS|COMPLAINT|ENGINEER|CLEANING|LOAN INTEREST|LOAN PAYMENT|PROV TAX|PROVISIONAL TAX|GST RETURN|INCOME TAX|TRAINING|STAFF TRAINING.*|0+)$/;

const strings = new Set();
const add = (value) => {
  // Trailing punctuation is the bank's, not part of the name: "Auckland," and
  // "Auckland" are the same place, and only one of them is worth listing.
  const text = String(value ?? "").trim().replace(/[.,;:]+$/, "");
  if (text.length >= 8 && /[A-Za-z0-9]/.test(text)) strings.add(text.toUpperCase());
};

for (const t of part("transactions")) {
  for (const field of ["otherParty", "particulars", "reference", "code", "otherPartyAccount", "account"]) {
    add(t[field]);
  }
}
for (const i of part("invoices")) {
  add(i.contact);
  add(i.reference);
}

/*
 * Chart account names are deliberately not scanned, and neither are invoice
 * numbers. A chart is a shared vocabulary -- "Accounts Receivable", "Repairs
 * and Maintenance", "Depreciation" -- so scanning it reports forty standard
 * names and buries the one line that matters. What identifies somebody is who
 * they paid and what account it went to, which is what is read above.
 */

/*
 * Files git tracks, *and* files it would track on the next `git add -A`.
 *
 * `git ls-files` alone is blind to exactly the file that leaks: a brand new
 * one. It is not tracked yet, so it is not scanned, so the audit passes, so it
 * gets committed -- and only then can the audit see it, one commit too late.
 * That is not hypothetical: it is how a real company name and a real account
 * reached a public repository out of a file this very tool had just called
 * clean. `--others --exclude-standard` adds the untracked files that are not
 * ignored, which together are the set about to be published.
 */
const tracked = execSync("git ls-files --cached --others --exclude-standard", {
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean);
const contents = new Map();
for (const file of tracked) {
  try {
    contents.set(file, readFileSync(file, "utf8").toUpperCase());
  } catch {
    // Binary or unreadable: nothing to match against.
  }
}

const found = new Map();
for (const needle of strings) {
  if (GENERIC.test(needle)) continue;
  // On a boundary, not merely present: "MOUNT ST" sits inside "aMOUNT STays",
  // and a report full of those is one nobody reads to the end. Checked by
  // looking at the characters either side rather than by building a pattern,
  // because a payee can contain anything a regular expression treats as syntax.
  const boundary = (character) => character === undefined || !/[A-Z0-9]/.test(character);
  const standsAlone = (text) => {
    let at = text.indexOf(needle);
    while (at !== -1) {
      if (boundary(text[at - 1]) && boundary(text[at + needle.length])) return true;
      at = text.indexOf(needle, at + 1);
    }
    return false;
  };

  for (const [file, text] of contents) {
    if (standsAlone(text)) {
      const list = found.get(needle) ?? [];
      list.push(file);
      found.set(needle, list);
    }
  }
}

console.log(
  `Checked ${strings.size} strings from ${folder} against ${tracked.length} files ` +
    "git tracks or would track.\n",
);

if (found.size === 0) {
  console.log("Nothing from the ledger appears in the files git tracks.");
  process.exit(0);
}

console.log(`${found.size} string${found.size === 1 ? "" : "s"} from the ledger appear in tracked files:\n`);
for (const [needle, files] of [...found].sort()) {
  console.log(`  ${JSON.stringify(needle)}`);
  for (const file of [...new Set(files)].sort()) console.log(`      ${file}`);
}
console.log(
  "\nEach of these is either a coincidence of common words, or real data that\n" +
    "would be published. Add the harmless ones to GENERIC in this script so the\n" +
    "report stays short, and replace the rest with invented equivalents.",
);
process.exit(1);
