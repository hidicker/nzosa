# What is outstanding

Two reviews in September 2026 produced the lists below: an outside architectural
and statutory review against the OpenAccountants guides
([the report](reviews/2026-09-openaccountants-deep-review.html)), and a security
review of the hosted copy. This file is the running record of what came of them.

## From the statutory review

### Done

| Recommendation | What was done |
|---|---|
| Composite tax bands for the year ended 31 March 2025 | `INCOME_TAX` in `rental-schedules.ts` holds 2025 (14,533 / 49,833 / 72,700 / 180,000), so a past year can be worked out and checked. A year with bands but no levy or credit table now says so on the return rather than showing nothing. |
| Provisional tax: the 110% fallback | `provisionalStandardOption()` works out both bases — 105% of last year once that return is filed, 110% of the year before it until then — with the instalments. The IR3 says which applies. |

### Still open

- **ACC work levy by classification unit.** A sole trader's work levy depends on
  their CU, and the rates change each year. That is a rate table this project
  does not hold, and guessing one is worse than leaving it out: the levy would
  look calculated when it was invented. Wanted: the current CU schedule from
  ACC, loaded the way other rate tables are, with the year it applies to.
- **A read-only MCP server.** The engine is pure functions over local files, so
  a small wrapper could answer `get_trial_balance`, `get_gst_return`,
  `get_unreconciled_transactions` and `check_daily_balances` for an AI client
  without any books leaving the machine. New package, no change to the engine.

### Offered back to OpenAccountants

Their New Zealand guides are drafts, and three are out of date against what this
engine holds and tests: the GST return layout (theirs has 12 boxes, the return
has 15), the income tax thresholds (theirs predate 31 July 2024), and the IETC
abatement range. Worth offering: the IR10 60-box mapping, residential
ring-fencing with the carry-forward, and the property manager clearing-account
method, none of which they cover.

## From the security review

### Done

| Finding | Fix |
|---|---|
| Members could write to the tables directly, skipping the version check and the kept history | No insert, update or delete is granted on any table. Every change goes through a function. Renaming and retiring a set of books stay with its owner through a column grant. |
| An owner could remove the last owner, orphaning a set of books | Same fix: membership changes go through the function that refuses it. |
| Adding somebody by email revealed whether that address had an account, and put books in their list unasked | Invitations. The answer never varies, nothing is shared until the person accepts, and the owner can withdraw one. |
| No limit on sets of books per account | Twenty. |
| No security headers on the site | Content policy, HSTS, nosniff, anti-framing, referrer policy. Folder listings off, source map no longer shipped. |

### Still open

- **Two-factor sign-in is available but not required.** Worth requiring for
  anybody who is not just trying the app out. Free.
- **The breached-password check is off** — it is a paid-plan feature.
- **Backups.** The free plan keeps none worth the name. The answer today is the
  backup file a person downloads; the paid plan adds point-in-time recovery.
- **No DMARC record** for the sending domain, so a forged "from" address is
  easier than it should be for a domain that sends account email.
- **Legacy API keys are still enabled**, and an unused secret key exists.
- **The database accepts connections from any address and does not require
  TLS** for direct connections. Neither is used by this app.
- **One save is capped by the statement timeout** at roughly 20,000
  transactions; a set of books nearing that needs the parts split up.
