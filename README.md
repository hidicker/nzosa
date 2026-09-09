# NZOSA

New Zealand open-source accounting. Bank files in; a coded double-entry ledger, GST returns and financial reports out.

Point it at your bank exports and, if you have them, the exports from whatever accounting system you keep today. It codes transactions from your own past decisions rather than from keywords you type, matches receipts to the invoices they settle, and keeps a ledger that has to balance — so a mistake shows up as a figure that does not add up, rather than as a report that quietly reads wrong.

It runs on your own machine. Nothing is uploaded, and the app makes no network requests of its own.

## Documentation

| | |
|---|---|
| [Guide for owners](docs/user-guide.md) | What it does, how to set it up, and where your data actually lives. No accounting background assumed |
| [Guide for accountants](docs/accountant-guide.md) | The posting model, the three accounting bases, IRD compliance, and how to validate it against a signed set of accounts |
| [Guide for developers](docs/developer-guide.md) | Architecture, invariants, money and date rules, the formats it reads, deduplication, deployment, and the traps |
| [What the spreadsheet encodes](docs/from-the-spreadsheet.md) | The workbook this was rebuilt from |
| [Testing plan](docs/testing-plan.md) | Running a full year end to end |

## Running it

Requires Node 20 or newer. If you do not have it, get the **LTS** version from [nodejs.org](https://nodejs.org) and accept the defaults.

Double-click **`NZOSA.cmd`** (Windows) or **`NZOSA.command`** (macOS). It installs what it needs the first time, then opens the app in your browser. To stop it, double-click **`Stop NZOSA`** in the same folder.

> On macOS the first double-click may be refused as being from an unidentified developer. Right-click the file, choose **Open**, then **Open** again.

Or from a terminal:

```bash
npm install && npm run build
```

```bash
npm run dev --workspace @nzosa/web
```

An app with nothing in it opens on **Setup**, which lists what is needed, in the order it is needed, and says what each optional file adds.

Started either of those ways, your books are files in a folder you can back up and read without this software. Opened as a plain web page with no server behind it, they live in that browser instead — fine for trying it out, wrong for anything you depend on. The [guide for owners](docs/user-guide.md) explains the difference in plain terms; section 19 of the [developer guide](docs/developer-guide.md) explains the mechanism.

## Status

In use on real books. Import, coding, GST, invoices, fixed assets, reporting and return preparation are built and tested.

Every figure is meant to be checkable, and the guides say how to check it. Do that before relying on it.

## Licence

MIT. See [LICENSE](LICENSE). Provided as is, without warranty of any kind. You remain responsible for what you file.
