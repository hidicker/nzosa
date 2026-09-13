import { showPage } from "./app.js";
import { entityBankAccounts } from "./books.js";
import { formatAmount } from "@nzosa/core";
import { $, state } from "./state.js";

/**
 * Small pieces of page furniture that more than one page shows.
 *
 * Not primitives -- each of these reads the books to know what to draw, which
 * is exactly what keeps them out of `ui.ts`. They are here rather than in
 * whichever page happened to need them first, because a second page needing
 * one is how a page module ends up importing another page module.
 */

/**
 * Choosing which bank accounts a page is about.
 *
 * A row of chips rather than a multi-select, because the usual answer is
 * "all of them" and the second most usual is "this one" -- both of which a
 * select box makes you work for. "All accounts" is a chip of its own and not
 * the absence of a choice, so the page can say which it is showing.
 *
 * `chosen` is mutated rather than replaced: the caller holds the array in its
 * own state and re-renders from it, and handing back a new one would leave
 * the two disagreeing about what is selected.
 */
/**
 * Account chooser as a row of toggles.
 *
 * A multi-select listbox is the wrong control here: it hides most of its
 * options behind a scrollbar, gives no hint that several can be chosen, and
 * loses the whole selection to a stray click. Toggles show every account at
 * once and each one is independent.
 */
export function fillAccounts(id: string, chosen: string[], onChange: () => void): void {
  const holder = $(id);
  const entity = entityBankAccounts();
  const present = [...new Set(state.ledger.transactions.map((t) => t.account))]
    .filter((account) => entity.length === 0 || entity.includes(account))
    .sort();
  holder.textContent = "";

  const label = (account: string): string => {
    const named = state.ledger.transactions.find((t) => t.account === account)?.extras?.accountLabel;
    return named ?? account;
  };

  const all = document.createElement("button");
  all.type = "button";
  all.className = chosen.length === 0 ? "chip on" : "chip";
  all.textContent = "All accounts";
  all.addEventListener("click", () => {
    chosen.length = 0;
    onChange();
  });
  holder.append(all);

  for (const account of present) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = chosen.includes(account) ? "chip on" : "chip";
    chip.textContent = label(account);
    chip.title = account;
    chip.addEventListener("click", () => {
      const at = chosen.indexOf(account);
      if (at >= 0) chosen.splice(at, 1);
      else chosen.push(account);
      onChange();
    });
    holder.append(chip);
  }
}

/**
 * Say when a figure is built on transactions still in question.
 *
 * A duplicate the app is unsure of is kept and flagged, which is right: two
 * payments of the same amount a few days apart can genuinely be two payments,
 * and dropping one on a guess would lose real money. But kept means counted,
 * and the flag lives on the Import page while the damage is done here -- a
 * profit figure, or a return, quietly too big by whatever those rows come to.
 *
 * So the pages that state a figure say what is still unsettled underneath it,
 * and how much it is worth. Being wrong is survivable; being wrong with
 * nothing on the screen to say so is not.
 */
export function unresolvedNote(): HTMLElement | null {
  const waiting = state.entries.filter((e) => e.status === "review");
  if (waiting.length === 0) return null;

  const worth = waiting.reduce((sum, e) => sum + Math.abs(e.transaction.amount), 0);
  const note = document.createElement("p");
  note.className = "unresolved-note";
  note.textContent =
    `${waiting.length} transaction${waiting.length === 1 ? " is" : "s are"} still in question ` +
    `— possibly the same thing counted twice, worth ${formatAmount(worth)} in total. ` +
    // Not "the figures below": this line appears on the reconcile queue as well,
    // where there are no figures below it, and a warning that describes the
    // wrong page is one somebody learns to skip.
    "They count towards every total until you decide.";

  const go = document.createElement("button");
  go.type = "button";
  go.className = "link-button";
  go.textContent = "settle them";
  go.addEventListener("click", () => {
    state.filter = "review";
    showPage("import");
  });
  note.append(" ", go);
  return note;
}
