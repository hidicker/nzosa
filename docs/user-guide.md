# NZOSA: a guide for owners

For the person whose business this is. No accounting background assumed.

If you are the accountant, read the [guide for accountants](accountant-guide.md) instead. If you are changing the code, read the [guide for developers](developer-guide.md).

---

## What it does

You give it your bank statements. It works out what each line was, keeps a proper set of books, and produces your GST returns and the figures your accountant needs at year end.

The important part is the second sentence. Plenty of software will import a bank statement. What makes this a set of books rather than a list is that every line lands in a double-entry ledger that has to balance, so a mistake shows up as a number that does not add up rather than as a report that quietly reads wrong.

## What it will not do

- **It will not file anything for you.** It produces the figures; you or your accountant put them in the return.
- **It is not a substitute for an accountant.** It does the mechanical work — coding, matching, GST, depreciation. Year-end judgement calls are still judgement calls.
- **It will not guess in secret.** Every figure traces back to a bank line and a decision somebody made. Where it is unsure it asks rather than picking.

---

## Where your data lives

Worth understanding before you put a year of your business into it, because it depends on how you opened it.

**If you started it with the launcher** (`NZOSA.cmd` on Windows, `NZOSA.command` on a Mac), your books are **files in a folder on your computer**. One file per part — transactions, decisions, invoices, chart. You can back them up, copy them to another machine, and read them without this software. This is the mode to use for real books.

**If you opened it as a web page** with no launcher running, there is no folder, and your books are kept **inside that browser** on that device. That is fine for trying it out. It is a poor place for anything you care about:

- Clearing your browsing data deletes it.
- It does not follow you to another browser, another computer, or your phone.
- A private or incognito window starts empty and keeps nothing.
- The browser is allowed to discard it if the device runs short of space.

Either way, **nothing is uploaded**. Your files are read on your own machine and the app does not send them anywhere. That is also why nobody can recover your books for you if you lose them — there is no copy but yours.

The app tells you which mode you are in: with a folder behind it, the ledger's name shows at the bottom of the sidebar and the demo offers to "Open the demo books"; without one, it offers to "Load demo data".

**Back it up.** In folder mode, copy the folder. Wherever you are, `Bank import → Export ledger` writes the whole thing to a single file you can keep somewhere else.

---

## Running it on your own computer

The demo online is for looking at. For books of your own you run NZOSA on your own machine, which takes about ten minutes once.

You are not "installing an app" in the usual sense: you are putting a folder on your computer and double-clicking a file in it. Nothing goes into Program Files, nothing runs at startup, and nothing phones home.

### 1. Install Node.js

Go to [nodejs.org](https://nodejs.org) and download the **LTS** version — the one on the left, marked "Recommended For Most Users". Run the installer and accept every default.

Node.js is the engine NZOSA runs on. You will never open it or see it again.

### 2. Get the NZOSA folder

You will be given either a ZIP file or a link. Download it and **unzip it somewhere you will find again** — Documents is a good choice, and somewhere inside a folder that is backed up is better.

Do not run it from inside the ZIP. Windows will let you open files in a ZIP without unpacking it, and NZOSA will fail in confusing ways if you do.

### 3. Start it

Open the folder and double-click:

* **Windows** — `NZOSA.cmd`
* **Mac** — `NZOSA.command`

The first time, it spends a minute or two fetching what it needs and building itself. A black window shows what it is doing; that is normal, and it closes on its own. Your browser then opens at NZOSA.

To stop it, double-click **`Stop NZOSA`** in the same folder. Closing the browser tab does not stop it.

### If something gets in the way

**Windows says it protected your PC.** Click *More info*, then *Run anyway*. This is SmartScreen not recognising a file that few people have downloaded; it is not a virus warning.

**Mac says it is from an unidentified developer.** Right-click `NZOSA.command`, choose **Open**, then **Open** again in the box that appears. You only do this once.

**Mac says it cannot be opened, or opens it in a text editor.** The file lost its permission to run, which happens with some ways of downloading. Open Terminal, type `chmod +x ` (with the space), drag `NZOSA.command` into the window, and press Enter. Then double-click it as normal.

**Nothing happens, or the window flashes and vanishes.** Node.js is probably not installed, or was installed after you first tried. Restart the computer and try again.

**It says NZOSA is already running.** It is — the launcher reopens your browser at it rather than starting a second copy.

### Where your books end up

In a folder called `ledgers` inside the NZOSA folder, as ordinary files. Back that up the way you back up anything else you would hate to lose. There is no copy anywhere else, and nobody can recover it for you.

### Updating

You will be given a new folder. Copy your `ledgers` folder out of the old one and into the new one before you start it. Your books are those files; everything else is just the software.

---

## Setting up

Open **Setup**. It lists what is needed, in the order it is needed, and ticks each item off as it arrives. You do not have to do it in one sitting.

### 1. Say whose books these are

At the top of Setup. Your company, trust, or your own name. It is the one thing no file can tell it: a chart of accounts arrives with sixty accounts and not one of them says whose they are.

If one set of books holds several things — a company and two rental properties, say — add the others on **Entities & accounts**. Most people need only the one.

### 2. Fetch your files, all at once

Setup lists exactly what to export and where each one lives. If you use an accounting system already, they all come from the same place and the whole set takes a few minutes — so fetch them in one visit rather than one at a time.

Then drop the lot on the same page, in any order. Each file is recognised by its own columns, so you do not have to say which is which.

At a minimum you need your **bank statements**. Everything else improves what the software can tell you, and Setup says what each one adds. The ones that earn their place quickly:

| File | What it gives you |
|---|---|
| Chart of accounts | Consistent account names, and the GST treatment each account uses |
| Your existing coded history | Your own past coding becomes the rules. This is the big one — see below |
| Trial balance at last year end | Opening balances, without which a balance sheet is wrong rather than merely short |
| Invoices | Income counted when you invoiced it, and receipts matched to what they settled |
| Fixed asset register | Depreciation, which no bank statement can produce |

### 3. Say which bank accounts are yours

On **Entities & accounts**. Your chart lists an account called something like "Business Cheque Account"; your ledger has one identified by its number. Tell it which is which.

This matters more than it sounds. Money moving between two of your own accounts is a transfer, not income — but the software can only know that if it knows both ends belong to you. Get this wrong and paying your own credit card looks like a sale.

### 4. Opening balances

On its own page. Load the trial balance from your previous year end. Skip this only if the books start at the very beginning of the business, when there is genuinely nothing to bring forward.

### 5. Let it learn your coding

On **Coding reconciliation**, load the coded history you exported. The software compares its guesses against what you actually did last year and writes rules from the agreement.

You never type keyword rules. Your own past decisions are the rules.

---

## The everyday job

**Reconcile** is where you spend your time. It shows bank lines that still need a decision, with a suggestion against each one.

Three things to know:

**Suggestions are suggestions.** Accept, change, or split. Nothing is filed on your behalf.

**Corrections stick.** Correcting a line teaches it, and the correction survives re-importing the same statement later. If you find yourself making the same correction twice, something is wrong — say so.

**It flags what it is unsure about rather than guessing.** A line it cannot place stays visible until you deal with it. An empty Reconcile page means the books are done, not that it gave up.

### The three that catch people out

**Transfers.** Moving money between your own accounts is not income and not an expense. The software looks for the matching leg and offers it as a transfer for you to confirm. Check the pairing before confirming — two unrelated payments of the same round amount a day apart look identical to a computer, and confirming a false transfer hides two real transactions at once.

**Customer payments.** If you raise invoices, a receipt should settle the invoice, not count as a fresh sale. Coding it as a sale counts the same income twice and leaves the invoice looking unpaid for ever. Where one payment covers several invoices, split it — there is a button for exactly that.

**Entertainment.** Most business entertainment is only half deductible in New Zealand. The **Split 50/50** button does the halving and the GST correctly. Use it rather than coding the whole amount.

---

## GST

**GST reconciliation** builds your return from the ledger for whatever period you are on.

If you load the returns you have already filed, it compares each one against what the books now say and shows the difference. Differences are normal and not automatically errors — but each one should have an explanation, and there is somewhere to record it.

Check the return before you file it. It is your return.

---

## Year end

What your accountant will want, and what this produces:

- **Profit and loss** and **balance sheet**, on **Reports**
- **IR10** figures
- The **fixed asset** schedule with depreciation
- **Shareholder current account** movements

Two things the software cannot know, and will not pretend to:

1. **Judgement journals.** Provisions, reclassifications, and year-end adjustments your accountant makes in their working papers. Once made, they can be entered as manual journals — every one needs a reason typed against it, because a journal nobody can explain is one nobody can defend.
2. **Anything that never touched a bank account.** Non-cash adjustments, and anything that happened before the books start.

Expect your accountant to make adjustments. That is what they are for. The point of this software is that they start from a complete, balanced, explainable ledger rather than from a shoebox.

---

## When something looks wrong

**A number you cannot account for.** Every figure decomposes. Click through from the report to the account to the transactions behind it.

**Check nothing is missing.** **Bank import → Check against the bank's own balances** compares the running balance of what you imported against the bank's own daily figures. If a transaction is missing or counted twice, it names the exact day and the exact amount. This is the single most valuable check in the app, and it needs no coding at all — do it before you trust any report.

**Undo it.** **History** records every change, most recent first, with a way to put it back.

**A balance sheet that does not balance** almost always means opening balances, not coding.

---

## Trying it first

There is a complete invented set of books — a coffee roastery and a rental, part way through a year, with codings, splits, invoices and a transfer already in it. Worth ten minutes before you load a real year.

Online, it loads by itself: anything you see there is invented, and you can change it freely. On your own machine it opens in books of its own, from **Setup → Demo data**, so nothing of yours is touched.

---

## Licence and liability

NZOSA is open-source software under the MIT Licence. It is provided as is, with no warranty. Nobody who wrote or distributes it is liable if a figure is wrong.

You remain responsible for what you file. Check the figures.
