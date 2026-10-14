import { redraw } from "../app.js";
import { restoreAiSuggestions } from "../ai.js";
import { state } from "../state.js";
import type { AiSuggestion } from "@nzosa/core";

/**
 * Example AI answers on the demo's Reconcile page.
 *
 * The demo's invented books carry a few answers written by hand in the shape
 * a model returns, so a visitor sees what an AI suggestion looks like --
 * account, how sure, why, and any caution -- without a model being asked.
 * Each is put on its line the way the app puts back suggestions kept from
 * an earlier session, and is named an example, never a model's.
 *
 * Demo only: real books have no such field, and this is called from nowhere
 * else.
 */
export function placeExampleSuggestions(): void {
  const held = (state.ledger as { exampleAiSuggestions?: AiSuggestion[] }).exampleAiSuggestions ?? [];
  if (held.length === 0) return;
  if (restoreAiSuggestions(held.map((one) => ({ ...one, via: "example" }))) > 0) redraw("reconcile");
}
