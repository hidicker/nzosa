import { redraw } from "../app.js";
import { applyBetweenNow, betweenEntities, betweenLinesDiffering, saveEntities } from "../books.js";
import { state } from "../state.js";
import { note } from "../ui.js";
import { booksLocale, moneyPlaces } from "../country.js";
import { emptyEntityModel, isSeparatePerson, owedBetween, pairKey } from "@nzosa/core";
import type { EntityModel, IsoDate } from "@nzosa/core";

/**
 * How money between entities is recorded, pair by pair: a section of the Rules
 * page, beside the rules that decide how each line is coded. Bank account
 * owners stay on Entities & accounts.
 */

/** "Apply to N confirmed lines": the deliberate act a change needs to reach lines already confirmed. */
export function applyButton(ids: readonly string[], between: string, how: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "link-button";
  button.textContent = `Apply to ${ids.length} confirmed line${ids.length === 1 ? "" : "s"}`;
  button.title = "Lines already confirmed keep how they were recorded until this is applied to them.";
  button.addEventListener("click", () => {
    const sure = confirm(
      `Record the ${ids.length} confirmed line${ids.length === 1 ? "" : "s"} between ${between} as: ${how.replace(/ \(usual\)$/, "")}?\n\n` +
        "Lines in a locked year are left as they are. This is recorded in History, where it can be undone.",
    );
    if (!sure) return;
    void applyBetweenNow(ids, `Money between ${between}, applied`).then(({ applied, locked }) => {
      if (locked > 0) alert(`${applied} line${applied === 1 ? "" : "s"} changed. ${locked} in a locked year left as they were.`);
      redraw("entities");
      redraw("rules");
    });
  });
  return button;
}

/**
 * How money passing between two entities is recorded, for the pairs it has
 * passed between, and whether one person's money paying for another's is a
 * gift. The defaults follow the law: things owned directly are the owners'
 * money; a company, trust or society can only owe or be owed.
 */
function betweenSettings(model: EntityModel): HTMLElement {
  const wrap = document.createElement("div");
  const heading = document.createElement("h4");
  heading.textContent = "Money between entities";
  wrap.append(heading);
  const nameOf = (id: string): string => model.entities.find((e) => e.id === id)?.name ?? id;
  const byId = new Map(model.entities.map((e) => [e.id, e]));

  // The pairs money has actually passed between.
  const { journals, accounts } = betweenEntities();
  const owed = owedBetween(journals, accounts, model, new Date().toISOString().slice(0, 10) as IsoDate);
  const entityOf = new Map(accounts.map((a) => [a.code, a.entityId]));
  const pairs = new Set<string>();
  for (const journal of journals) {
    const ids = [...new Set(journal.lines.map((l) => entityOf.get(l.accountCode)).filter((id): id is string => id !== undefined))];
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) pairs.add(pairKey(ids[i]!, ids[j]!));
  }
  for (const key of Object.keys(model.between ?? {})) pairs.add(key);

  if (pairs.size === 0) {
    wrap.append(note("No money has passed between entities yet."));
  } else {
    wrap.append(
      note(
        "Where one entity's account pays for another's line, the books record the money passing between them: " +
          "usually the owners' funds introduced and drawings, by their shares, and a loan where a company, trust " +
          "or society is involved. Reports, Money between entities, sets it out.",
      ),
    );
    const table = document.createElement("table");
    table.className = "entity-table";
    const tbody = document.createElement("tbody");
    for (const key of [...pairs].sort()) {
      const [a, b] = key.split("|") as [string, string];
      const one = byId.get(a);
      const two = byId.get(b);
      if (one === undefined || two === undefined) continue;
      const tr = document.createElement("tr");
      const label = document.createElement("td");
      label.className = "entity-left";
      label.textContent = `${nameOf(a)} and ${nameOf(b)}`;
      const cell = document.createElement("td");
      const pick = document.createElement("select");
      const usual: "loan" | "equity" = isSeparatePerson(one) || isSeparatePerson(two) ? "loan" : "equity";
      const current = model.between?.[key] ?? usual;
      for (const [value, text] of [
        ["equity", "Owners' funds introduced and drawings"],
        ["loan", "A loan between them"],
      ] as const) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value === usual ? `${text} (usual)` : text;
        option.selected = current === value;
        pick.append(option);
      }
      pick.addEventListener("change", () => {
        const live = state.ledger.entities ?? emptyEntityModel();
        const between = { ...(live.between ?? {}) };
        if (pick.value === usual) delete between[key];
        else between[key] = pick.value as "loan" | "equity";
        const { between: _old, ...rest } = live;
        void saveEntities(
          Object.keys(between).length > 0 ? { ...rest, between } : rest,
          `Money between ${nameOf(a)} and ${nameOf(b)}: ${pick.selectedOptions[0]?.textContent ?? ""}`,
        ).then(() => redraw("rules"));
      });
      cell.append(pick);
      // Confirmed lines keep what they were confirmed with; a change of
      // setting reaches them only when asked to.
      const setting = model.between?.[key] ?? "usual";
      const differing = betweenLinesDiffering(
        (_id, c) => (c.owner === a && c.with[b] !== undefined && c.with[b] !== setting) || (c.owner === b && c.with[a] !== undefined && c.with[a] !== setting),
      );
      if (differing.length > 0) {
        cell.append(" ", applyButton(differing, `${nameOf(a)} and ${nameOf(b)}`, pick.selectedOptions[0]?.textContent ?? ""));
      }
      const standing = document.createElement("td");
      standing.className = "cell-said-elsewhere";
      const owes = owed.find((o) => o.kind === "loan" && o.entityIds.includes(a) && o.entityIds.includes(b));
      if (owes !== undefined) {
        const amount = (owes.amount / 100).toLocaleString(booksLocale(), { minimumFractionDigits: moneyPlaces(), maximumFractionDigits: moneyPlaces() });
        standing.textContent = `${owes.from} owes ${owes.to} $${amount}`;
      }
      tr.append(label, cell, standing);
      tbody.append(tr);
    }
    table.append(tbody);
    wrap.append(table);
  }

  const gift = document.createElement("label");
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = model.ownerGifts === true;
  gift.append(
    box,
    " When one person's money pays for something another owns, such as joint money paying for a property one " +
      "of you owns alone, treat it as a gift rather than owed back",
  );
  box.addEventListener("change", () => {
    const live = state.ledger.entities ?? emptyEntityModel();
    const { ownerGifts: _was, ...rest } = live;
    void saveEntities(
      box.checked ? { ...rest, ownerGifts: true } : rest,
      box.checked ? "Money between people: a gift" : "Money between people: owed back",
    ).then(() => redraw("rules"));
  });
  wrap.append(gift);
  return wrap;
}


/** The section on the Rules page. */
export function renderBetweenSettings(): void {
  const holder = document.getElementById("rules-between");
  if (holder === null) return;
  holder.textContent = "";
  const model = state.ledger.entities ?? emptyEntityModel();
  if (model.entities.length < 2) return;
  holder.append(betweenSettings(model));
}
