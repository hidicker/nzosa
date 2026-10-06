import { state } from "./state.js";

/**
 * Whether these books may be asked about by a model.
 *
 * Normally that is the owner's answer, stored with the books and off until
 * they turn it on: sending payee names and amounts anywhere is their call.
 *
 * The demo build is the exception, and it says so itself -- the build step
 * marks the page with data-demo. Every figure in it is invented, there is
 * nobody to ask, and a visitor who cannot see the AI button cannot see how
 * the app works.
 *
 * The page is asked rather than the books, because the books a returning
 * visitor holds were saved by whatever demo was current when they first came.
 * Those predate the flag, so asking the books kept the button hidden from
 * everybody who had visited before -- which is how it was first reported.
 * The banner is not asked either: a visitor can close it.
 */
export function isDemoBuild(): boolean {
  return typeof document !== "undefined" && document.documentElement.dataset["demo"] === "yes";
}

export function aiAllowed(): boolean {
  return state.ledger.aiEnabled === true || isDemoBuild();
}
