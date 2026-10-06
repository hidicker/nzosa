# Security

## Supported versions

Only the latest version of NZOSA gets security fixes. Update before
reporting a problem: it may already be fixed.

## Reporting a problem

Please report anything that could expose somebody's books, keys or tokens
privately to the copyright holder (hidicker on GitHub), not in a public issue.
Say what you found, how to reproduce it, and what it could reach. You will hear
back, and a fix is released before anything is said publicly.

## How NZOSA protects your data

What follows is checked in each security review; the last was on 5 October 2026.

**Run on your own computer** (the launcher, `NZOSA.cmd`):

- The local server listens on this computer only (127.0.0.1), refuses any
  request whose Host is not this computer (so another web page cannot reach it
  by renaming itself), and refuses changes from any other web origin. Changes
  have to be JSON, which a web form elsewhere cannot send.
- Ledger and archive names are checked before they touch a path, and files are
  served only from the app's own folder.
- Bank feed (Akahu, Wise) tokens and AI keys stay in the books' folder on this
  computer. The page is only ever told that one is held and its first and last
  few characters, never the token itself.

**Hosted** (signed in, books kept on the server):

- Every table has row-level security: you reach only books you are a member
  of, with the role you were given.
- Bank feed tokens and AI keys are kept server-side. The functions that read
  them can be called by the server alone, and every server function checks the
  caller's role on the books first.
- The site sends a strict content security policy (scripts only from the site
  itself, data only to the site and its database), HSTS, and refuses to be
  framed. The online demo sends the same headers, and keeps its sample books in
  browser storage of its own, apart from the hosted app's.

**In the app:**

- Text from bank files, spreadsheets and names is escaped before it is shown,
  so it cannot run as script.
- CSV files meant for a spreadsheet keep a value that starts like a formula as
  text, so a payee name cannot run as a formula in Excel.
- AI is only asked when you press a button for it. What is sent, and to whom,
  is set out on the AI page before it is turned on; nothing an AI answers is
  kept until you accept it.
- Dependencies are few (esbuild and TypeScript, to build) and `npm audit` is
  clean.
