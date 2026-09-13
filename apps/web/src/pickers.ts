import { entityBankAccounts } from "./books.js";
import { $, state } from "./state.js";

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
