# NZOSA

Free accounting for New Zealand. Bank files in; a coded double-entry ledger, GST returns and financial reports out.

Help keep this project moving and free: [![Donate a coffee](https://img.shields.io/badge/Donate-a%20coffee-orange?logo=stripe)](https://buy.stripe.com/28EaEX2sY2Ar7vy49pd7q00)

Point it at your bank exports and, if you have them, the exports from whatever accounting system you keep today. It codes transactions from your own past decisions rather than from keywords you type, matches receipts to the invoices they settle, and keeps a ledger that has to balance — so a mistake shows up as a figure that does not add up, rather than as a report that quietly reads wrong.

It runs on your own machine. Nothing is uploaded, and the app makes no network requests of its own.

## Running it

1. **Install Node.js** — [nodejs.org](https://nodejs.org/), choose the **LTS** build, and accept every default.
2. **Download & Run**:
   - Click the green **Code** button at the top of this GitHub page, select **Download ZIP**, and extract it anywhere on your computer.
   - Double-click **`NZOSA.cmd`** (Windows) or **`NZOSA.command`** (Mac).
   - It will install what it needs the first time, then automatically open the app in your browser.
   - To stop it, double-click **`Stop NZOSA`** in the same folder.

> **Mac users:** On macOS the first double-click may say it is from an unidentified developer. Right-click the file, choose **Open**, then click **Open** again.

> **Online demo:** Want to try it first with sample data without installing anything? Visit the [online demo](https://nbparagliding.nz/nzosa_demo/). More about NZOSA on its [home page](https://nbparagliding.nz/nzosa/home/).

### For developers / terminal

```bash
npm install && npm run build
```

```bash
npm run dev --workspace @nzosa/web
```

An app with nothing in it opens on **Setup**, which lists what is needed, in the order it is needed, and says what each optional file adds.

Started either of those ways, your books are files in a folder you can back up and read without this software. Opened as a plain web page with no server behind it, they live in that browser instead — fine for trying it out, wrong for anything you depend on. The [guide for owners](docs/user-guide.md) explains the difference in plain terms; section 19 of the [developer guide](docs/developer-guide.md) explains the mechanism.

## Ask an AI about your books (optional)

`packages/mcp` is a small read-only [MCP](https://modelcontextprotocol.io) server. It lets an AI client on the same machine, such as Claude Desktop or Claude Code, search your transactions and check how much of your coding is done, without the books going anywhere except to the AI you chose to ask. It has no network listener, it opens no file for writing, and it can see the one folder you point it at.

```bash
npm install && npm run build
node packages/mcp/dist/server.js --books "/path/to/your/books"
```

In Claude Desktop's config, add it as a server with that command and arguments. `--entities a,b` limits it to some of the entities in the books, and `--max-rows` caps how many rows one answer can hold.

Be clear about what that means: whatever the AI asks for is sent to the company running it, including payee names and bank references. The tools return figures without free text wherever they can, and mark the text they do return as data. A model that runs on your own machine keeps all of it local. The tools today are `list_entities`, `search_transactions`, `get_unreconciled_transactions`, `get_coding_progress` and `check_daily_balances`; reports and journals are not in yet.

## Documentation

| | |
|---|---|
| [Guide for owners](docs/user-guide.md) | What it does, how to set it up, and where your data actually lives. No accounting background assumed |
| [Guide for accountants](docs/accountant-guide.md) | The posting model, the three accounting bases, IRD compliance, and how to validate it against a signed set of accounts |
| [Guide for developers](docs/developer-guide.md) | Architecture, invariants, money and date rules, the formats it reads, deduplication, deployment, and the traps |
| [Hosting it online yourself](docs/self-hosting.md) | Books online on your own Supabase project and web host, step by step, for a person on their own or working with their own AI assistant |
| [What the spreadsheet encodes](docs/from-the-spreadsheet.md) | The workbook this was rebuilt from |
| [Testing plan](docs/testing-plan.md) | Running a full year end to end |

## Status

In use on real books. Import, coding, GST, invoices, fixed assets, reporting and return preparation are built and tested. A full year has been reconciled against a practitioner's signed accounts: the profit and loss, balance sheet and IR10 agree with the filed figures to the dollar, and every GST return difference is explained. Rental properties and personal books are handled the same way: each property its own entity with its owners and GST registration, rental schedules as a practitioner sets them out, and each owner's IR3 from the same books.

Every figure is meant to be checkable, and the guides say how to check it. Do that before relying on it.

## Licence

Copyright (C) 2026 hidicker.

NZOSA is free software under the GNU Affero General Public Licence, version 3 or later
([LICENSE](LICENSE)), with the additional terms in [NOTICE](NOTICE). You may run, study,
share and change it. If you change it and let other people use your version, including
over a network, you have to offer them its source too, keep the attribution
"NZOSA, by hidicker" with its link to the [NZOSA home page](https://nbparagliding.nz/nzosa/home/),
and call your version something other than NZOSA. Provided as is, without warranty of any
kind. You remain responsible for what you file.

NZOSA is free, and donations keep it going: [donate a coffee](https://buy.stripe.com/28EaEX2sY2Ar7vy49pd7q00).
If you pass it on or build on it, please leave the donate button in place. Donations are
voluntary and buy no extra rights.
