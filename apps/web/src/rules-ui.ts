import type { CategoryDefault, CategoryRule, RuleSet } from "@nzosa/core";

/**
 * Combining two rule sets.
 *
 * Adding is not appending: two files can hold the same keyword on the same
 * account, and a duplicate rule is not merely untidy -- it makes which one wins
 * depend on declaration order, which is invisible. So a rule that already
 * exists is skipped, and the count of skipped ones is reported rather than
 * quietly absorbed.
 *
 * Code treatments and defaults follow the same principle: the existing answer
 * stands, because it is the one the current coding was built on.
 */

export interface RuleFileShape extends Omit<RuleSet, "rules" | "defaults"> {
  // Mutable, because merging builds a new set by appending to a copy.
  rules?: CategoryRule[];
  defaults?: CategoryDefault[];
  codeTreatments?: Record<string, unknown>;
  gstRules?: unknown[];
}

export interface MergeReport {
  merged: RuleFileShape;
  addedRules: number;
  skippedRules: number;
  addedTreatments: number;
  conflictingTreatments: { code: string; kept: unknown; ignored: unknown }[];
}

function ruleKey(rule: { keyword?: string; account?: string; code: string }): string {
  return JSON.stringify([rule.keyword ?? "", rule.account ?? "", rule.code]);
}

export function mergeRules(existing: RuleFileShape, incoming: RuleFileShape): MergeReport {
  const merged: RuleFileShape = {
    ...existing,
    rules: [...(existing.rules ?? [])],
    defaults: [...(existing.defaults ?? [])],
    codeTreatments: { ...(existing.codeTreatments ?? {}) },
    gstRules: [...(existing.gstRules ?? [])],
  };

  const seen = new Set((merged.rules ?? []).map(ruleKey));
  let addedRules = 0;
  let skippedRules = 0;
  for (const rule of incoming.rules ?? []) {
    if (seen.has(ruleKey(rule))) {
      skippedRules += 1;
      continue;
    }
    seen.add(ruleKey(rule));
    merged.rules?.push(rule);
    addedRules += 1;
  }

  let addedTreatments = 0;
  const conflictingTreatments: MergeReport["conflictingTreatments"] = [];
  for (const [code, treatment] of Object.entries(incoming.codeTreatments ?? {})) {
    const current = merged.codeTreatments?.[code];
    if (current === undefined) {
      if (merged.codeTreatments) merged.codeTreatments[code] = treatment;
      addedTreatments += 1;
    } else if (JSON.stringify(current) !== JSON.stringify(treatment)) {
      // A code meaning two different things for GST is exactly the kind of
      // disagreement that quietly changes a return, so it is surfaced.
      conflictingTreatments.push({ code, kept: current, ignored: treatment });
    }
  }

  const defaultKey = (entry: { code: string }) => entry.code;
  const seenDefaults = new Set((merged.defaults ?? []).map(defaultKey));
  for (const entry of incoming.defaults ?? []) {
    if (seenDefaults.has(defaultKey(entry))) continue;
    seenDefaults.add(defaultKey(entry));
    merged.defaults?.push(entry);
  }

  return { merged, addedRules, skippedRules, addedTreatments, conflictingTreatments };
}

/** A short description of what a rule file contains. */
export function describeRules(rules: RuleFileShape): string {
  return (
    `${(rules.rules ?? []).length} rules, ` +
    `${(rules.defaults ?? []).length} defaults, ` +
    `${Object.keys(rules.codeTreatments ?? {}).length} code treatments`
  );
}
