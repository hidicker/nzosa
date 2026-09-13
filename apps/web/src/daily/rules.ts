import { redraw } from "../app.js";
import { persistRules, reclassify, record, useRules } from "../books.js";
import { blankDraft, fromDraft, ruleImpact, toDraft, validateDraft } from "../rules-editor.js";
import type { RuleDraft } from "../rules-editor.js";
import { describeRules, mergeRules } from "../rules-ui.js";
import type { RuleFileShape } from "../rules-ui.js";
import { $, state } from "../state.js";
import { saveRulesArchive } from "../store.js";
import { download, note } from "../ui.js";
import type { CategoryRule } from "@nzosa/core";

/**
 * The coding rules, and editing them.
 *
 * A rule is a keyword and the code it implies. Together they are the reason a
 * thousand-line statement does not have to be coded a line at a time, and they
 * are worth reading as a document in their own right: the rule set is the
 * policy, and the coding is what the policy produced.
 *
 * Which is why a rule is never silently overwritten. Adding a set that already
 * holds a keyword keeps the existing answer, replacing one archives what it
 * displaced, and both say how many were skipped -- because a duplicate rule
 * makes which one wins depend on declaration order, and that is invisible.
 */

async function replaceRules(): Promise<void> {
  const pending = state.pendingRules;
  if (!pending) return;
  // The set being displaced is kept: replacing changes every suggestion at
  // once, and getting the old one back should not depend on still having the
  // file it came from.
  if (state.rules) {
    state.rulesArchive = {
      version: 1,
      entries: [
        {
          name: state.rulesName,
          replacedAt: new Date().toISOString().slice(0, 16).replace("T", " "),
          rules: state.rules,
        },
        ...state.rulesArchive.entries,
      ].slice(0, 10),
    };
    await saveRulesArchive(state.rulesArchive);
  }
  await useRules(pending.rules, pending.name, "Replaced with");
}

async function addRules(): Promise<void> {
  const pending = state.pendingRules;
  if (!pending || !state.rules) return;
  const report = mergeRules(state.rules as RuleFileShape, pending.rules);
  await useRules(report.merged, `${state.rulesName} + ${pending.name}`, "Added");
  state.rulesMessage =
    `Added ${report.addedRules} rules from ${pending.name}` +
    (report.skippedRules > 0 ? `, skipping ${report.skippedRules} already present` : "") +
    (report.addedTreatments > 0 ? `, and ${report.addedTreatments} code treatments` : "") +
    ".";
  if (report.conflictingTreatments.length > 0) {
    state.rulesMessage +=
      ` ${report.conflictingTreatments.length} code treatment(s) disagreed and the existing ones were kept: ` +
      report.conflictingTreatments.map((c) => c.code).slice(0, 5).join(", ") +
      ".";
  }
  redraw("rules");
}

async function restoreRules(index: number): Promise<void> {
  const entry = state.rulesArchive.entries[index];
  if (!entry) return;
  state.rulesArchive = {
    version: 1,
    entries: state.rulesArchive.entries.filter((_, i) => i !== index),
  };
  await saveRulesArchive(state.rulesArchive);
  await useRules(entry.rules as RuleFileShape, entry.name, "Restored");
}

function renderRulesStatus(): void {
  const holder = $("rules-status");
  holder.textContent = "";

  const line = document.createElement("p");
  line.className = "page-hint";
  line.textContent =
    state.rules === undefined
      ? "No rules loaded. Load a rule file to get coding suggestions."
      : `In use: ${state.rulesName} — ${describeRules(state.rules as RuleFileShape)}, loaded ${state.rulesLoadedAt}. Kept between sessions.`;
  holder.append(line);

  if (state.rulesMessage !== "") {
    const message = document.createElement("p");
    message.className = "rules-message";
    message.textContent = state.rulesMessage;
    holder.append(message);
  }

  const pending = state.pendingRules;
  if (pending) {
    const choice = document.createElement("div");
    choice.className = "rules-choice";
    const question = document.createElement("p");
    question.textContent =
      `${pending.name} holds ${describeRules(pending.rules)}. ` +
      "Add it to what is already loaded, or replace? The set being replaced is kept.";
    choice.append(question);

    const add = document.createElement("button");
    add.type = "button";
    add.className = "primary";
    add.textContent = "Add to existing";
    add.addEventListener("click", () => void addRules());

    const replace = document.createElement("button");
    replace.type = "button";
    replace.textContent = "Replace";
    replace.addEventListener("click", () => void replaceRules());

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => {
      state.pendingRules = null;
      redraw("rules");
    });

    choice.append(add, replace, cancel);
    holder.append(choice);
  }

  if (state.rulesArchive.entries.length > 0) {
    const heading = document.createElement("h3");
    heading.textContent = "Replaced rule sets";
    holder.append(heading);
    for (const [index, entry] of state.rulesArchive.entries.entries()) {
      const row = document.createElement("p");
      row.className = "rules-archive";
      row.textContent = `${entry.name} — ${describeRules(entry.rules as RuleFileShape)}, replaced ${entry.replacedAt}. `;
      const restore = document.createElement("button");
      restore.type = "button";
      restore.textContent = "Restore";
      restore.addEventListener("click", () => void restoreRules(index));
      row.append(restore);
      holder.append(row);
    }
  }
}

export function renderRules(): void {
  renderRulesStatus();
  const body = $("rules-body");
  body.textContent = "";
  const file = state.rules as RuleFileShape | undefined;

  if (!file) {
    body.append(note("No rules loaded. Load a rule file with the button above."));
    return;
  }

  const all = file.rules ?? [];
  const needle = $<HTMLInputElement>("rules-search").value.trim().toLowerCase();
  const matches = (text: string) => needle === "" || text.toLowerCase().includes(needle);

  // Indexes are carried through the filter: editing row 3 of a search result
  // has to write back to the rule it actually came from, not to rule 3.
  const shown = all
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) =>
      matches(
        `${rule.keyword ?? ""} ${rule.code} ${rule.account ?? ""} ${rule.contact ?? ""} ${rule.note ?? ""}`,
      ),
    )
    .sort((a, b) => (b.rule.priority ?? 0) - (a.rule.priority ?? 0) || a.index - b.index);

  const summary = document.createElement("div");
  summary.className = "rules-summary";
  const count = document.createElement("span");
  count.textContent =
    `${shown.length} of ${all.length} rules, ` +
    `${(file.defaults ?? []).length} defaults, ` +
    `${Object.keys(file.codeTreatments ?? {}).length} code treatments. ` +
    "Changes are kept in this browser as you make them.";

  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.textContent = "Add rule";
  addButton.addEventListener("click", () => {
    state.ruleDraft = blankDraft();
    renderRules();
  });

  const downloadButton = document.createElement("button");
  downloadButton.type = "button";
  downloadButton.textContent = "Download JSON";
  downloadButton.title = "Save the whole rule set to a file you can keep or share.";
  downloadButton.addEventListener("click", () => downloadRules());

  summary.append(count, addButton, downloadButton);
  body.append(summary);

  if (state.ruleDraft && state.ruleDraft.index === null) {
    body.append(ruleEditor(state.ruleDraft, "Add this rule"));
  }

  const limit = 300;
  const table = document.createElement("table");
  table.className = "rules-table";
  const head = document.createElement("thead");
  head.innerHTML =
    "<tr><th>Priority</th><th>Keyword</th><th>Account</th><th>Code</th>" +
    "<th>To (contact)</th><th>Note</th><th></th></tr>";
  const tbody = document.createElement("tbody");

  for (const { rule, index } of shown.slice(0, limit)) {
    if (state.ruleDraft && state.ruleDraft.index === index) {
      const editing = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 7;
      cell.append(ruleEditor(state.ruleDraft, "Save this rule"));
      editing.append(cell);
      tbody.append(editing);
      continue;
    }

    const tr = document.createElement("tr");
    const cells = [
      String(rule.priority ?? 0),
      rule.keyword ?? "",
      rule.account ?? "",
      rule.code,
      rule.contact ?? "",
      rule.note ?? "",
    ];
    cells.forEach((text, column) => {
      const td = document.createElement("td");
      td.textContent = text;
      if (column > 0) td.className = "rules-left";
      tr.append(td);
    });

    const actions = document.createElement("td");
    actions.className = "rules-actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => {
      state.ruleDraft = toDraft(rule, index);
      renderRules();
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => deleteRule(index, rule));
    actions.append(edit, remove);
    tr.append(actions);
    tbody.append(tr);
  }

  table.append(head, tbody);
  body.append(table);

  if (shown.length > limit) {
    body.append(
      note(`Showing the first ${limit}. Search to narrow the list down to the rule you want.`),
    );
  }
}

/**
 * The edit form for one rule.
 *
 * It reports how many transactions the rule would match before it is saved,
 * because that is the only honest answer to what a rule actually does -- a
 * keyword that reads as specific can match three hundred lines, and one that
 * reads as broad can match none.
 */
function ruleEditor(draft: RuleDraft, saveLabel: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "rule-editor";

  const fields: [keyof RuleDraft, string, string][] = [
    ["priority", "Priority", "0"],
    ["keyword", "Keyword", "Text found anywhere in the bank line"],
    ["account", "Account", "Bank account id, or blank for any"],
    ["code", "Code", "Account to code it to"],
    ["contact", "To (contact)", "Defaults to the keyword"],
    ["note", "Note", "Why this rule exists"],
    // Narrower than a keyword: these look in one field each, and all of them
    // have to hold. The payee is the same on every payment to Inland Revenue;
    // which tax it was is in the particulars.
    ["wherePayee", "Payee contains", "Narrower than a keyword — blank for any"],
    ["whereParticulars", "Particulars contains", "e.g. GST"],
    ["whereCode", "Bank code contains", "The bank's own code field"],
    ["whereReference", "Reference contains", ""],
    // The one field that identifies a counterparty when the payee will not.
    // Some banks write the particulars into the payee, so every payment to one
    // supplier arrives under a different name -- and all of them name the same
    // account number.
    ["whereOtherAccount", "Paid to/from account", "e.g. 12-3456-0012345-00"],
  ];

  const impact = document.createElement("p");
  impact.className = "rule-impact";

  const refresh = (): void => {
    // The parts as well as the whole, because a rule may now name a field.
    const text = state.ledger.transactions.map((t) => ({
      account: t.account,
      text: [t.otherParty, t.particulars, t.code, t.reference, t.otherPartyAccount]
        .join(" ")
        .toUpperCase(),
      otherParty: t.otherParty,
      particulars: t.particulars,
      code: t.code,
      reference: t.reference,
      otherPartyAccount: t.otherPartyAccount,
    }));
    const codes = state.suggestions;
    const result = ruleImpact(draft, text, (index) => {
      const transaction = state.ledger.transactions[index];
      return transaction ? (codes?.get(transaction.id)?.code ?? null) : null;
    });
    impact.textContent =
      result.matches === 0
        ? "Matches nothing in the ledger as it stands."
        : `Matches ${result.matches} transaction${result.matches === 1 ? "" : "s"}` +
          (result.stolen > 0
            ? `, ${result.stolen} of which another rule currently codes differently.`
            : ".") +
          " Lines already confirmed keep their coding.";
  };

  for (const [key, label, placeholder] of fields) {
    const wrapper = document.createElement("label");
    wrapper.className = "rule-field";
    const caption = document.createElement("span");
    caption.textContent = label;
    const input = document.createElement("input");
    input.type = "text";
    input.value = String(draft[key]);
    input.placeholder = placeholder;
    input.addEventListener("input", () => {
      (draft[key] as string) = input.value;
      refresh();
    });
    wrapper.append(caption, input);
    wrap.append(wrapper);
  }

  const problems = document.createElement("p");
  problems.className = "rule-problems";

  const save = document.createElement("button");
  save.type = "button";
  save.className = "primary";
  save.textContent = saveLabel;
  save.addEventListener("click", () => {
    const found = validateDraft(draft);
    if (found.length > 0) {
      problems.textContent = found.map((p) => p.message).join(" ");
      return;
    }
    commitRule(draft);
  });

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => {
    state.ruleDraft = null;
    redraw("rules");
  });

  const buttons = document.createElement("div");
  buttons.className = "rule-editor-actions";
  buttons.append(save, cancel);

  refresh();
  wrap.append(impact, problems, buttons);
  return wrap;
}

/** Put an edited or new rule back into the set, in memory only. */
function commitRule(draft: RuleDraft): void {
  const file = state.rules as RuleFileShape | undefined;
  if (!file) return;
  const rules = [...(file.rules ?? [])];
  const rule = fromDraft(draft);

  const index = draft.index ?? rules.length;
  const before = draft.index === null ? null : (rules[draft.index] ?? null);
  if (draft.index === null) rules.push(rule);
  else rules[draft.index] = rule;
  void record(
    "rule",
    `${before === null ? "Added" : "Changed"} rule: ${rule.keyword ?? rule.account ?? "everything"} → ${rule.code}`,
    before,
    rule,
    String(index),
  );

  state.rules = { ...file, rules };
  state.ruleDraft = null;
  reclassify();
  void persistRules();
}

function deleteRule(index: number, rule: CategoryRule): void {
  if (
    !confirm(
      `Delete the rule coding "${rule.keyword ?? rule.account ?? "everything"}" to ${rule.code}?` +
        " Lines already confirmed keep their coding; unconfirmed ones lose this suggestion.",
    )
  ) {
    return;
  }
  const file = state.rules as RuleFileShape | undefined;
  if (!file) return;
  const rules = [...(file.rules ?? [])];
  const removed = rules[index] ?? null;
  rules.splice(index, 1);
  void record(
    "rule",
    `Deleted rule: ${rule.keyword ?? rule.account ?? "everything"} → ${rule.code}`,
    removed,
    null,
    String(index),
  );
  state.rules = { ...file, rules };
  state.ruleDraft = null;
  reclassify();
  void persistRules();
}

/**
 * Write the rule set out as JSON.
 *
 * Rules edited here would otherwise live only in one browser profile, where
 * they cannot be backed up, reviewed in a diff, or moved to the command line.
 */
function downloadRules(): void {
  const file = state.rules as RuleFileShape | undefined;
  if (!file) return;
  download(
    `${JSON.stringify(file, null, 2)}\n`,
    state.rulesName || "rules.json",
    "application/json",
  );
}
