# Separating migration from daily use

A plan for splitting `apps/web/src/main.ts`, with the measurements behind it.

Nothing here is a matter of taste. Every claim below came from reading the file with a script, and the numbers are reproducible.

---

## 1. The problem, measured

```
33,842   lines of TypeScript in the repository
13,656   apps/web/src/main.ts                    40% of everything, in one file
 1,058   packages/cli/src/cli.ts                 the next largest
 1,041   apps/web/src/store.ts
```

`main.ts` holds **236 top-level functions**. The largest is `renderEntities` at 622 lines.

`packages/core` is not the problem. Forty-odd modules, largest 926 lines, each with a header saying what it is for. Somebody auditing the accounting would read `posting.ts`, `gst.ts` and `ir10.ts` and be satisfied. Everything wrong is in one file, and it is the file that sits between a person and those modules.

### Symptoms worth naming

* **Four different functions are called `section`.** One at the top level (388 lines, the coding reconciliation) and three local ones inside `renderIr10`, `renderBalanceSheet` and `renderDetail`. Nothing is wrong with any of them; a file small enough to read would not have produced them.
* **Two more names are shadowed the same way**: `matches`, `sameAccount`.
* **44 fields on one `state` object**, plus eight module-level caches.

### What is *not* wrong

* **Almost no dead code.** Four uncalled functions, 39 lines between them.
* Types are green and enforced — `npm test` runs `tsc` first as of the previous commit.

---

## 2. The seam is cleaner than it looks

A call graph says everything reaches everything, because a hundred places end with "…and redraw". That tells you nothing, so the classification below uses harder evidence: **which page's DOM ids a function touches, and which `state` fields it reads**.

| | functions | lines |
|---|---:|---:|
| migration only | 40 | 2,571 |
| day-to-day only | 39 | 3,830 |
| **touches both** | **4** | **713** |
| no page, no page-state | 153 | 5,978 |

**Only four functions straddle the two concerns**, and three of them are not really counter-examples:

| lines | function | why it straddles |
|---:|---|---|
| 274 | `wireUp` | wires every listener in the app. Bootstrap. |
| 274 | `setupSteps` | a checklist *about* everything, so it reads everything. |
| 90 | `init` | bootstrap. |
| 75 | `renderReconcile` | genuinely both: the coding reconciliation redraws it after an accept. |

That last one is the only real coupling, and it is one call.

---

## 3. Where the reduction is

The 153 functions with no page affinity are 46% of the file, and they divide:

| | functions | lines | what to do |
|---|---:|---:|---|
| pure — no state, no DOM | 55 | 1,313 | move out as-is |
| reads `state`, builds no DOM | 82 | 3,746 | take arguments instead; becomes testable |
| builds DOM, no page id | 16 | 919 | shared presentation |

The middle row is the prize. **50 of those 82 read nothing but `state.ledger`, `state.chart` and `state.rules` — 2,398 lines.** Each is already a pure function of the ledger; it just reaches for a module global instead of accepting a parameter. Change

```ts
function balancesByFinancialYear(): FinancialYearBalances[] {
  const held = state.ledger.openingBalances;
  const byCode = new Map(state.chart.map((a) => [a.code, a]));
```

to

```ts
export function balancesByFinancialYear(
  ledger: StoredLedger,
  chart: readonly Account[],
): FinancialYearBalances[] {
```

and it leaves the app, gains a unit test, and stops being something only a browser can exercise. **That is roughly 2,400 lines moving from untestable to tested**, which matters more for an accounting package than the line count does.

---

## 4. The plan

Five phases, each shippable on its own, each leaving the app working.

### Phase 0 — safety net *(done)*

**The golden master.** `tools/golden-master.js` captures every figure the app can show — 225 variants on a real ledger: 216 report combinations (11 kinds x 3 bases x 2 GST settings x 3 years, plus the owner sweep), the GST comparison, opening balances per year, the reconcile summary, entities and the setup checklist. It stores a SHA-256 per variant rather than the text, because the text runs to half a megabyte and the question being asked is only "did this change".

Run it, save a baseline, refactor, run it again, diff. An empty diff is the only pass.

**It has to wait for the app to go quiet first.** Opening the app starts work that finishes seconds later: the bank feed fetches, and new transactions move every figure resting on a balance. Captured too early, a sweep records a book that is still arriving. This was not theoretical -- an early comparison showed 115 of 225 variants "changed", and the whole of it was box 28 moving from 39,183.31 to 39,232.89 about twenty-five seconds after load. The harness now watches one report until it stops moving before it begins.

**Certified so far:** phase 1 against `main`, **225 of 225 identical**.

`tsc` green and wired into `npm test`. Without this a refactor of a 13,000-line file is guesswork: the compiler is the thing that says whether a moved block still holds together, and it was reporting 33 errors, so a new one would not have stood out.

### Phase 1 — shared presentation *(prototyped on this branch)*

`apps/web/src/ui.ts`: elements in, elements out, no state. `note`, `nameCell`, `amountCell`, `invoiceCell`, `escapeHtml`, `download`, `setLoadingStatus`, `currentTheme`.

The rule for belonging there: **a helper that reaches for `state` is not a primitive.** It is a piece of one of the pages wearing a general-sounding name, and it belongs with that page. `bankCell`, `editCell` and `appendTruncationWarning` look like siblings of these and are not — they reach back through `bankLabel`, `renameChartAccount` and `truncatedAccounts`. They move in Phase 2 or not at all.

### Phase 2 — the derived-data layer

Take the 50 ledger-only functions, give them parameters, move them to `apps/web/src/derive.ts` (or into `packages/core` where they are not browser-specific), and write tests. Do this **before** splitting the pages: it is the phase that shrinks the file most, and every later move gets easier once these are not reaching for globals.

Go one function at a time. Each is independently verifiable, and a mistake is a compile error rather than a wrong figure.

### Phase 3 — split the pages

```
apps/web/src/
  migrate/     setup, coding reconciliation, rules proposals, file recognisers,
               opening balances, demo seeding          ~2,600 lines
  daily/       reconcile, reports, GST, invoices, history, assets, entities,
               bank import                             ~3,800 lines
  ui.ts        presentation primitives
  derive.ts    ledger questions, tested
  main.ts      bootstrap and routing only
```

### Phase 4 — the four straddlers

`wireUp` splits along the same line: each half wires its own listeners, `main.ts` calls both. `setupSteps` stays a checklist about everything and imports what it needs to ask. `renderReconcile`'s one cross-call becomes `showPage(state.page)` — which the developer guide already prescribes, for a bug this exact pattern has caused before.

---

## 5. What this buys, and what it does not

**Buys:** an auditor can read `daily/` without wading through Xero parsing. Roughly 2,400 lines move from untestable to tested. The migration code becomes separable to the point where you could plausibly not ship it. A new Xero import page has an obvious home instead of landing in a 13,000-line file and making it worse.

**Does not buy:** any change in behaviour. If a figure moves, something is wrong.

**The risk worth respecting:** `main.ts` shares a single 44-field `state` object and eight caches through closures. Moving a function out means it can no longer see them, which is the point and also the hazard. Phase 2 is deliberately first because it converts that hidden coupling into visible parameters, and it does so one function at a time with the compiler checking each.

**The order matters.** Do not build the new Xero page first. It would land in `main.ts`, grow the thing being split, and add to the work.
