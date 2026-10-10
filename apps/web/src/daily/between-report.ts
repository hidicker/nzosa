import { betweenEntities } from "../books.js";
import { state } from "../state.js";
import { amountCell, nameCell, note } from "../ui.js";
import { booksLocale, moneyPlaces } from "../country.js";
import { taxYearEnd, taxYearEndSaid, taxYearStart } from "../tax-year.js";
import { emptyEntityModel, personPositions } from "@nzosa/core";

/**
 * Money between entities: what each owner put into and took out of each
 * entity, the loans between them, and who owes whom.
 *
 * The entries are worked out from the coding and from whose bank account each
 * line went through (see core's between-entities.ts). Nothing here changes the
 * books: a rental's profit and its GST are the same whichever account paid.
 */
export function renderBetweenReport(body: HTMLElement, year: number): void {
  const from = taxYearStart(year);
  const to = taxYearEnd(year);
  const model = state.ledger.entities ?? emptyEntityModel();
  const money = (cents: number): string => {
    const text = (Math.abs(cents) / 100).toLocaleString(booksLocale(), {
      minimumFractionDigits: moneyPlaces(),
      maximumFractionDigits: moneyPlaces(),
    });
    return cents < 0 ? `(${text})` : text;
  };

  const heading = document.createElement("h3");
  heading.textContent = `Money between entities, year ended ${taxYearEndSaid(year)}`;
  body.append(heading);
  body.append(
    note(
      "Where a line is for one entity but went through another's bank account, such as a rental's repair on the " +
        "joint card, the profit and the GST are that entity's, and the money came from, or went to, the account's " +
        "owner. For things owned directly, that is the owners' funds introduced and drawings, by their shares; with a " +
        "company, trust or society, a loan. The choice for each pair of entities is on Entities & accounts.",
    ),
  );

  const unowned = Object.values(model.banks).filter((ids) => ids.length > 1).length;
  if (unowned > 0) {
    body.append(
      note(
        `${unowned === 1 ? "A bank account has" : `${unowned} bank accounts have`} no owner chosen yet, so ${unowned === 1 ? "its" : "their"} ` +
          "lines are left out here. Choose one on Entities & accounts.",
      ),
    );
  }

  const { journals, accounts } = betweenEntities();
  if (journals.length === 0) {
    body.append(note("No money has passed between entities in these books."));
    return;
  }

  // Each account's movement in the year and its balance at the end.
  const moved = new Map<string, number>();
  const closing = new Map<string, number>();
  for (const journal of journals) {
    if (journal.date > to) continue;
    for (const line of journal.lines) {
      closing.set(line.accountCode, (closing.get(line.accountCode) ?? 0) + line.amount);
      if (journal.date >= from) moved.set(line.accountCode, (moved.get(line.accountCode) ?? 0) + line.amount);
    }
  }

  const table = document.createElement("table");
  table.className = "report-table";
  const head = document.createElement("thead");
  head.innerHTML = `<tr><th>Entity and account</th><th>This year</th><th>At ${taxYearEndSaid(year)}</th></tr>`;
  const tbody = document.createElement("tbody");
  // Credits shown as positive: money put in, owed to somebody.
  for (const entity of model.entities) {
    const own = accounts
      .filter((a) => a.entityId === entity.id && ((moved.get(a.code) ?? 0) !== 0 || (closing.get(a.code) ?? 0) !== 0))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (own.length === 0) continue;
    const header = document.createElement("tr");
    header.className = "bs-section";
    const cell = document.createElement("td");
    cell.colSpan = 3;
    cell.textContent = entity.name;
    header.append(cell);
    tbody.append(header);
    for (const account of own) {
      const tr = document.createElement("tr");
      tr.append(nameCell(account.name), amountCell(money(-(moved.get(account.code) ?? 0))), amountCell(money(-(closing.get(account.code) ?? 0))));
      tbody.append(tr);
    }
  }
  table.append(head, tbody);
  const wrap = document.createElement("div");
  wrap.className = "table-scroll";
  wrap.append(table);
  body.append(wrap);
  body.append(
    note(
      "Positive is money put in, or owed to somebody; in brackets, money taken out, or owed by them. A current " +
        "account is a loan between a company and its owner.",
    ),
  );

  // Between people.
  const { owes, byEntity } = personPositions(journals, accounts, model, to);
  const people = document.createElement("h4");
  people.textContent = "Between the people";
  body.append(people);
  if (owes.length === 0) {
    body.append(note("Each person's money has paid only for their own share of things."));
  } else {
    // Where it comes from: each person's net, entity by entity, to the year end.
    const people = [...new Set(byEntity.map((b) => b.person))].sort();
    const grid = document.createElement("table");
    grid.className = "report-table";
    const gridHead = document.createElement("thead");
    const hr = document.createElement("tr");
    hr.append(nameCell("Entity"), ...people.map((p) => nameCell(p)));
    gridHead.append(hr);
    const gridBody = document.createElement("tbody");
    for (const entity of model.entities) {
      const rows = byEntity.filter((b) => b.entityId === entity.id);
      if (rows.length === 0) continue;
      const tr = document.createElement("tr");
      tr.append(nameCell(entity.name), ...people.map((p) => amountCell(money(rows.find((r) => r.person === p)?.net ?? 0))));
      gridBody.append(tr);
    }
    grid.append(gridHead, gridBody);
    const gridWrap = document.createElement("div");
    gridWrap.className = "table-scroll";
    gridWrap.append(grid);
    body.append(gridWrap);
    body.append(
      note(
        "Each person's money in (positive) and out (in brackets), entity by entity, to the year end: what came to them " +
          "through what they own, and what their share of jointly held money paid. Where the totals differ, one person's " +
          "money paid for what the other owns.",
      ),
    );
    for (const one of owes) {
      body.append(
        note(
          model.ownerGifts === true
            ? `${one.to}'s money paid $${money(one.amount)} more towards what ${one.from} owns than ${one.from}'s paid towards ${one.to}'s: a gift, as these books are set.`
            : `${one.from} owes ${one.to} $${money(one.amount)}: ${one.to}'s money paid that much more towards what ${one.from} owns. ` +
                "If it was a gift, say so on Entities & accounts.",
        ),
      );
    }
  }
}
