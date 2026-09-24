import { redraw } from "../app.js";
import {
  NOT_IN_LEDGER,
  accountsForEditing,
  banks,
  chartTreatmentOf,
  codingProgress,
  ledgerAccountFor,
  persistRules,
  reclassify,
  record,
  saveEntities,
} from "../books.js";
import { GST_OPTIONS } from "../reconcile.js";
import type { RuleFileShape } from "../rules-ui.js";
import { $, state } from "../state.js";
import { save, savePart } from "../store.js";
import { escapeHtml, note } from "../ui.js";
import {
  mergeAccount,
  DEFAULT_ENTITY_NAME,
  accountEntityKey,
  accountLabel,
  emptyEntityModel,
  entityCoverage,
  entityId,
  formatOwners,
  isKnownType,
  ownersTotal,
  parseOwners,
  rateForTreatment,
  relabelOpeningBalances,
  renameAccount,
  renameProblem,
  reportsNetOfGst,
} from "@nzosa/core";
import type { Account, EntityKind, EntityModel, RuleSet } from "@nzosa/core";

/**
 * Account types offered on the accounts page.
 *
 * Xero's own vocabulary, so a chart written here still reads as a Xero chart,
 * plus a blank for "not on the profit and loss at all" -- which is the right
 * answer for a bank account, a loan or drawings.
 */
const ACCOUNT_TYPES: readonly (readonly [string, string])[] = [
  ["", "-- not on the P&L --"],
  ["Revenue", "Revenue (income)"],
  ["Other Income", "Other Income"],
  ["Direct Costs", "Direct Costs (expense)"],
  ["Expense", "Expense"],
  ["Overhead", "Overhead (expense)"],
  ["Bank", "Bank"],
  ["Current Asset", "Current Asset"],
  ["Current Liability", "Current Liability"],
  ["Equity", "Equity"],
];

/**
 * Entities, and the chart of accounts as it is edited.
 *
 * One set of books can hold more than one thing: a company, a rental, a
 * partnership, a sole trader's own affairs. Each has its own bank accounts and
 * its own share of the chart, and a report that mixes two of them is wrong in
 * a way that is hard to see, so every account belongs to exactly one entity
 * and the reports filter on it.
 *
 * The chart is edited here too, because the two questions are asked together:
 * what is this account, and whose is it. Renaming an account has to carry the
 * coding already done under the old name -- a rename that quietly orphans
 * three years of transactions looks like a tidy-up and is a loss of data -- so
 * renaming rewrites the rules and the overrides with it.
 */

/** The form for starting another entity, under the ones that already exist. */
export function addEntityForm(): HTMLElement {
  const row = document.createElement("div");
  row.className = "entity-add-row";

  const name = document.createElement("input");
  name.type = "text";
  name.placeholder = "New entity name";

  // Kind and registration are asked for here rather than left to be found
  // later: they decide whether losses are ring-fenced and whether reports are
  // net of GST, and an entity made without them is one whose first report is
  // wrong with nothing to prompt anybody.
  const kind = document.createElement("select");
  for (const [value, caption] of [
    ["business", "Business"],
    ["residential", "Residential rental"],
    ["commercial", "Commercial rental"],
    ["personal", "Personal"],
  ] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = caption;
    kind.append(option);
  }
  kind.title = "Residential rental losses are ring-fenced; the others are not.";

  const gstWrap = document.createElement("label");
  gstWrap.className = "entity-add-gst";
  const gst = document.createElement("input");
  gst.type = "checkbox";
  gst.checked = true;
  gstWrap.append(gst, document.createTextNode(" GST registered"));

  const add = document.createElement("button");
  add.type = "button";
  add.textContent = "Add entity";
  add.addEventListener("click", () => {
    const wanted = name.value.trim();
    if (wanted === "") return;
    const model = state.ledger.entities ?? emptyEntityModel();
    const id = entityId(wanted);
    if (model.entities.some((e) => e.id === id)) {
      alert(`There is already an entity called "${wanted}".`);
      return;
    }
    name.value = "";
    void saveEntities({
      ...model,
      entities: [
        ...model.entities,
        { id, name: wanted, kind: kind.value as EntityKind, gstRegistered: gst.checked },
      ],
    });
  });

  row.append(name, kind, gstWrap, add);
  return row;
}

/**
 * Which bank accounts serve which entities.
 *
 * A column per entity, so with none defined there is no grid to draw -- which
 * is why the caller skips it rather than rendering an empty one.
 */
function bankTable(model: EntityModel): HTMLElement {
  const accounts = [...new Set(state.ledger.transactions.map((t) => t.account))].sort();
  const bankTable = document.createElement("table");
  bankTable.className = "entity-table";
  const bankHead = document.createElement("thead");
  bankHead.innerHTML =
    "<tr><th>Bank account</th>" +
    model.entities.map((e) => `<th>${escapeHtml(e.name)}</th>`).join("") +
    "</tr>";
  const bankBody = document.createElement("tbody");

  for (const account of accounts) {
    const tr = document.createElement("tr");
    const label = document.createElement("td");
    label.className = "entity-left";
    const named = state.ledger.transactions.find((t) => t.account === account)?.extras?.[
      "accountLabel"
    ];
    label.textContent = named !== undefined ? `${named} (${account})` : account;
    tr.append(label);

    for (const entity of model.entities) {
      const cell = document.createElement("td");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = (model.banks[account] ?? []).includes(entity.id);
      box.addEventListener("change", () => {
        // Read the model as it is now, not as it was when this row was drawn.
        // Two changes made before the redraw would otherwise see the same
        // starting point and the second would silently undo the first.
        const live = state.ledger.entities ?? emptyEntityModel();
        const current = new Set(live.banks[account] ?? []);
        if (box.checked) current.add(entity.id);
        else current.delete(entity.id);
        const banks = { ...live.banks };
        if (current.size === 0) delete banks[account];
        else banks[account] = [...current];
        void saveEntities({ ...live, banks });
      });
      cell.append(box);
      tr.append(cell);
    }
    bankBody.append(tr);
  }
  bankTable.append(bankHead, bankBody);
  return bankTable;

}

/**
 * Which account in this ledger a chart's bank row actually is.
 *
 * A chart brings bank accounts with it, under the names the other system used.
 * Import the transactions and the same accounts arrive again under the names
 * the bank issues, and now one card is two rows: one with a name and no money,
 * one with money and no name. Nothing can safely join them by their words, so
 * this asks the one person who knows, once.
 *
 * Its own function because the guided start asks the same question, and a
 * second picker built beside this one is a second thing to keep in step.
 */
export function bankLinkSelect(account: Account): HTMLSelectElement {
  const id = ledgerAccountFor(account.name, account);
  const link = document.createElement("select");
  link.className = "bank-link";

  const unsaid = document.createElement("option");
  unsaid.value = "";
  unsaid.textContent = "— which account is this? —";
  unsaid.selected = account.ledgerAccount === undefined && id === null;
  link.append(unsaid);

  const { accounts: held, labels } = banks();
  for (const bank of [...held].sort()) {
    const option = document.createElement("option");
    option.value = bank;
    const label = labels.get(bank);
    option.textContent = label !== undefined && label !== bank ? `${label} (${bank})` : bank;
    option.selected = bank === id;
    link.append(option);
  }

  const none = document.createElement("option");
  none.value = NOT_IN_LEDGER;
  none.textContent = "not in this ledger";
  none.selected = account.ledgerAccount === NOT_IN_LEDGER;
  link.append(none);

  link.title =
    "The account in this ledger that this chart row is. Set it and the two stop " +
    "being two accounts; say it is not in this ledger and it stops being asked about.";
  link.addEventListener("change", () => {
    void setLedgerAccount(account, link.value);
  });
  return link;
}

/**
 * Every bank row in the chart, with its picker, as a table of its own.
 *
 * For the guided start, which asks this as one of its steps: the answer is a
 * handful of rows, and sending somebody to another page to find them among
 * sixty-six others is how a step gets left undone.
 */
export function bankLinkTable(): HTMLElement | null {
  const rows = accountsForEditing().filter(
    ({ account }) => account.type.trim().toLowerCase() === "bank",
  );
  if (rows.length === 0) return null;

  const table = document.createElement("table");
  table.className = "report-table accounts-table bank-link-table";
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const text of ["From the chart", "Is this account"]) {
    const th = document.createElement("th");
    th.textContent = text;
    headRow.append(th);
  }
  head.append(headRow);

  const body = document.createElement("tbody");
  for (const { account } of rows) {
    const tr = document.createElement("tr");
    const name = document.createElement("td");
    name.className = "report-name";
    name.textContent = account.code.trim() === ""
      ? account.name
      : `${account.code} ${account.name}`;
    const picker = document.createElement("td");
    picker.append(bankLinkSelect(account));
    tr.append(name, picker);
    body.append(tr);
  }
  table.append(head, body);
  return table;
}

export function renderEntities(): void {
  const body = $("entities-body");
  body.textContent = "";
  const model = state.ledger.entities ?? emptyEntityModel();

  const list = document.createElement("div");
  list.className = "entity-list";
  if (model.entities.length === 0) {
    list.append(
      note(
        "No entities, which is right for one company or one set of books: leave this " +
          "empty and every report covers everything. Add one above only if you keep " +
          "several things in one ledger -- a company and two rental properties, say -- " +
          "and want a separate profit figure for each.",
      ),
    );
  }
  for (const entity of model.entities) {
    const row = document.createElement("div");
    row.className = "entity-chip";

    // Still called by the placeholder name. Marked on the row itself rather
    // than shown once as a first-visit bubble: a bubble needs somewhere to
    // remember it has been seen, and is gone for good if it was dismissed by
    // somebody not ready to act on it. This clears itself the moment the
    // entity is renamed, which is exactly when it stops being true -- and it
    // is the same fact the Setup page counts as this step being done.
    const unnamed = entity.name === DEFAULT_ENTITY_NAME;
    if (unnamed) row.classList.add("needs-name");

    const name = document.createElement("span");
    const coverage = entityCoverage(model, state.chart);
    const count = coverage.byEntity.get(entity.id) ?? 0;
    const banks = Object.entries(model.banks).filter(([, ids]) => ids.includes(entity.id)).length;
    name.textContent =
      `${entity.name} — ${count} account${count === 1 ? "" : "s"}, ` +
      `${banks} bank account${banks === 1 ? "" : "s"}`;

    if (unnamed) {
      const hint = document.createElement("span");
      hint.className = "entity-rename-hint";
      hint.textContent =
        "Rename this to your company, trust or your own name — it is the one " +
        "thing these books cannot work out for themselves.";
      name.append(hint);
    }

    // Ownership decides whose tax return a rental's profit reaches, so it is
    // edited beside the entity rather than buried in a file.
    const ownersWrap = document.createElement("div");
    ownersWrap.className = "entity-owners-wrap";
    const owners = document.createElement("input");
    owners.type = "text";
    owners.className = "entity-owners";
    owners.placeholder = "Owners, e.g. Ana Whitcombe 50%, Tom Whitcombe 50%";
    owners.value = formatOwners(entity.owners ?? []);
    owners.title =
      "Names and shares. Separate them with a comma, a semicolon or the word " +
      "'and'. Shares should total 100%.";

    // What it understood, said back.
    //
    // The parsing is forgiving and therefore capable of being forgiving in the
    // wrong direction -- reading two owners as one, or a name as a share. That
    // used to happen silently, and a wrong share reaches somebody's return
    // looking exactly like a right one. So the reading is shown, and the total
    // with it: there has been a check that shares add to 100 since entities
    // existed, and nothing ever called it.
    const said = document.createElement("span");
    said.className = "entity-owners-said";
    const sayOwners = (text: string): void => {
      const parsed = parseOwners(text);
      const total = ownersTotal(parsed);
      said.textContent = total.said;
      said.classList.toggle("owners-wrong", !total.ok);
      said.title = total.ok
        ? "How this was read."
        : "Shares that do not total 100% mean somebody's income is unreported, or reported twice.";
    };
    sayOwners(owners.value);

    owners.addEventListener("input", () => sayOwners(owners.value));
    owners.addEventListener("change", () => {
      const live = state.ledger.entities ?? emptyEntityModel();
      void saveEntities({
        ...live,
        entities: live.entities.map((e) =>
          e.id === entity.id ? { ...e, owners: parseOwners(owners.value) } : e,
        ),
      });
    });
    ownersWrap.append(owners, said);

    const kind = document.createElement("select");
    for (const [value, caption] of [
      ["business", "Business"],
      ["residential", "Residential rental"],
      ["commercial", "Commercial rental"],
      ["personal", "Personal"],
    ] as const) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = caption;
      option.selected = (entity.kind ?? "business") === value;
      kind.append(option);
    }
    kind.title = "Residential rental losses are ring-fenced; the others are not.";
    kind.addEventListener("change", () => {
      const live = state.ledger.entities ?? emptyEntityModel();
      void saveEntities({
        ...live,
        entities: live.entities.map((e) =>
          e.id === entity.id ? { ...e, kind: kind.value as EntityKind } : e,
        ),
      });
    });

    // Registration decides whether this entity's own reports are net of GST,
    // so it lives beside the entity rather than as a switch on the report:
    // one ledger can hold a registered company and an unregistered rental,
    // and the report cannot be both at once for both of them.
    const gstWrap = document.createElement("label");
    gstWrap.className = "entity-gst";
    const gstBox = document.createElement("input");
    gstBox.type = "checkbox";
    gstBox.checked = reportsNetOfGst(entity);
    gstWrap.title =
      "Registered: GST is collected for Inland Revenue, so it belongs in neither " +
      "income nor expenses and reports are net of it. Not registered: the GST paid " +
      "is part of what things cost, and reports include it.";
    gstWrap.append(gstBox, document.createTextNode(" GST registered"));
    gstBox.addEventListener("change", () => {
      const live = state.ledger.entities ?? emptyEntityModel();
      void saveEntities(
        {
          ...live,
          entities: live.entities.map((e) =>
            e.id === entity.id ? { ...e, gstRegistered: gstBox.checked } : e,
          ),
        },
        `${entity.name} ${gstBox.checked ? "is" : "is not"} GST registered`,
      );
    });

    // Only a residential property is caught by the interest limitation rules,
    // so only one is asked. Exempt means its interest is claimed in full in
    // every year, including the year to 31 March 2025 when others got 80%.
    const exemptWrap = document.createElement("label");
    exemptWrap.className = "entity-gst";
    exemptWrap.hidden = entity.kind !== "residential";
    const exemptBox = document.createElement("input");
    exemptBox.type = "checkbox";
    exemptBox.checked = entity.interestExempt === true;
    exemptWrap.title =
      "A new build, or another property Inland Revenue exempts from the interest " +
      "limitation rules. Its mortgage interest is then claimed in full on the rental " +
      "schedule in every year.";
    exemptWrap.append(exemptBox, document.createTextNode(" Interest exempt (new build)"));
    exemptBox.addEventListener("change", () => {
      const live = state.ledger.entities ?? emptyEntityModel();
      void saveEntities(
        {
          ...live,
          entities: live.entities.map((e) =>
            e.id === entity.id ? { ...e, interestExempt: exemptBox.checked } : e,
          ),
        },
        `${entity.name} ${exemptBox.checked ? "is" : "is not"} exempt from the interest limit`,
      );
    });

    const rename = document.createElement("button");
    rename.type = "button";
    rename.textContent = "Rename";
    rename.addEventListener("click", () => {
      const next = prompt("Name for this entity", entity.name);
      if (next === null || next.trim() === "") return;
      void saveEntities({
        ...model,
        entities: model.entities.map((e) =>
          e.id === entity.id ? { ...e, name: next.trim() } : e,
        ),
      });
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => {
      if (!confirm(`Delete "${entity.name}"? Everything assigned to it becomes unassigned.`)) {
        return;
      }
      // Assignments pointing at a deleted entity are removed rather than left
      // dangling: a mapping to something that no longer exists would drop out
      // of a per-entity total silently.
      const accounts: Record<string, string> = {};
      for (const [code, id] of Object.entries(model.accounts)) {
        if (id !== entity.id) accounts[code] = id;
      }
      const banks: Record<string, string[]> = {};
      for (const [account, ids] of Object.entries(model.banks)) {
        const kept = ids.filter((id) => id !== entity.id);
        if (kept.length > 0) banks[account] = kept;
      }
      void saveEntities({
        entities: model.entities.filter((e) => e.id !== entity.id),
        accounts,
        banks,
      });
    });

    row.append(name, ownersWrap, kind, gstWrap, exemptWrap, rename, remove);

    // What goes at the top of an invoice you send somebody. Nothing else in
    // these books knows any of it, and without it an invoice cannot be sent:
    // one over $200 has to carry the supplier's GST number, and a customer
    // needs somewhere to pay.
    // Collapsed by default. These three are wanted once, when an invoice is
    // first sent, and never looked at again -- but they were open on every
    // entity for ever, and each one costs a full-width row with a two-line
    // address box in it. On a ledger with a few entities that pushed the
    // opening balances, which this page also holds, off the bottom of the
    // screen entirely. The summary counts what is still empty, so collapsing
    // them does not hide that they are missing.
    const billingDetails = document.createElement("details");
    billingDetails.className = "entity-billing-details";
    const billingSummary = document.createElement("summary");
    const missing = (["gstNumber", "address", "payTo"] as const).filter(
      (field) => (entity[field] ?? "").trim() === "",
    ).length;
    billingSummary.textContent =
      missing === 0 ? "Invoice details" : `Invoice details — ${missing} of 3 not filled in`;
    billingSummary.title =
      "The GST number, address and bank account that go at the top of an invoice you " +
      "send. An invoice over $200 has to carry the GST number.";
    billingDetails.append(billingSummary);

    const billing = document.createElement("div");
    billing.className = "entity-billing";
    for (const [key, label, hint, wide] of [
      ["gstNumber", "GST number", "123-456-789", false],
      ["address", "Address", "12 Example Street, Nelson 7010", true],
      ["payTo", "Payment", "02-1234-0567890-000", true],
    ] as const) {
      const wrap = document.createElement("label");
      wrap.className = "entity-billing-field";
      const caption = document.createElement("span");
      caption.textContent = label;
      const input = key === "address"
        ? document.createElement("textarea")
        : document.createElement("input");
      if (input instanceof HTMLTextAreaElement) input.rows = 2;
      input.value = entity[key] ?? "";
      input.placeholder = hint;
      if (wide) wrap.classList.add("wide");
      input.addEventListener("change", () => {
        const live = state.ledger.entities ?? emptyEntityModel();
        const value = input.value.trim();
        void saveEntities({
          ...live,
          entities: live.entities.map((e) => {
            if (e.id !== entity.id) return e;
            const { [key]: _drop, ...rest } = e;
            return value === "" ? rest : { ...rest, [key]: value };
          }),
        });
      });
      wrap.append(caption, input);
      billing.append(wrap);
    }
    billingDetails.append(billing);
    row.append(billingDetails);
    list.append(row);
  }
  body.append(list);
  // Built here rather than moved here. It used to live in the markup and be
  // moved into this container, which worked exactly once: the next render
  // begins by emptying the container, so the element was destroyed and every
  // render after the first threw looking for it -- taking the bank section and
  // the whole accounts table down with it, and making a chart that had loaded
  // look like a chart that had not.
  body.append(addEntityForm());

  // --- bank accounts ---
  if (model.entities.length > 0) {
    const bankHeading = document.createElement("h3");
    bankHeading.textContent = "Bank accounts";
    body.append(bankHeading);
    body.append(
      note("A bank account can serve several entities. Tick every one it pays for."),
    );
    body.append(bankTable(model));
  }

  // Bank rows in a chart carry no account number, so nothing can tell which
  // of the ledger's bank accounts each one is -- and until somebody says, the
  // reports cannot put a payment on the right entity. The control for it is a
  // column in the accounts table below, which on a chart of sixty-six accounts
  // is not somewhere anybody looks. So the count is said up here, where the
  // rest of the setting up is.
  const unlinked = accountsForEditing().filter(
    ({ account }) =>
      account.type.trim().toLowerCase() === "bank" &&
      account.ledgerAccount === undefined &&
      ledgerAccountFor(account.name, account) === null,
  );
  if (unlinked.length > 0) {
    const say = document.createElement("p");
    say.className = "needs-linking";
    say.textContent =
      `${unlinked.length} bank account${unlinked.length === 1 ? "" : "s"} in the chart ` +
      `${unlinked.length === 1 ? "is" : "are"} not yet linked to an account in this ` +
      "ledger: " +
      unlinked.map(({ account }) => account.name).join(", ") +
      ". Set each one under “Entity, or which account” in the table below.";
    body.append(say);
  }

  // --- accounts ---
  const chartHeading = document.createElement("h3");
  chartHeading.textContent = "Accounts";
  body.append(chartHeading);

  const accountRows = accountsForEditing();
  if (accountRows.length === 0) {
    body.append(
      note(
        "No accounts yet. Load a chart of accounts with the button above, or add one below. " +
          "Accounts also appear here once a rule or a GST treatment names them.",
      ),
    );
  } else {
    const coverage = entityCoverage(model, accountRows.map((r) => r.account));
    const untreated = accountRows.filter((r) => treatmentOf(r.label) === null).length;
    // "0 assigned to an entity" on books that have no entities reads as a job
    // half done, and most books are one entity and will never have any. The
    // count is worth saying once there is something to be assigned to.
    const entityPart =
      model.entities.length === 0
        ? ""
        : `, ${coverage.assigned} assigned to an entity`;
    body.append(
      note(
        `${accountRows.length} accounts${entityPart}` +
          (untreated > 0 ? `, ${untreated} with no GST treatment set` : "") +
          (model.entities.length === 0 ? "." : ". An account belongs to one entity only."),
      ),
    );
  }

  const addRow = document.createElement("div");
  addRow.className = "account-add";
  const newCode = document.createElement("input");
  newCode.type = "text";
  newCode.placeholder = "Code, e.g. 424";
  newCode.required = true;
  const newName = document.createElement("input");
  newName.type = "text";
  newName.placeholder = "Name, e.g. Entertainment - Non deductible";
  const addAccount = document.createElement("button");
  addAccount.type = "button";
  addAccount.textContent = "Add account";
  addAccount.addEventListener("click", () => {
    const code = newCode.value.trim();
    const name = newName.value.trim();
    if (name === "") return;
    // A code, the same as when one is edited. It is what survives a rename:
    // the entity assignment, the reports and the chart's own tax code all find
    // an account again by its number, and an account with only a name can be
    // found only by the thing most likely to change.
    const wrong = renameProblem(state.chart, { code: "", name: "" }, { code, name });
    if (wrong !== null) {
      alert(wrong);
      return;
    }
    // Named the way this ledger already names accounts, so a code chosen here
    // is the same string the coding picker offers.
    //
    // Which is not one fixed way. One chart puts "NB" in front of every
    // account name -- a house convention of that chart's, nothing to do with
    // accounting -- and this wrote it into every account anybody added, so a
    // person starting from their own bank data got a stranger's prefix on
    // their books with no way to know where it came from. Followed where the
    // ledger already uses it, and not invented where it does not.
    const housePrefixed = accountRows.some((r) => /^NB\s+/i.test(r.label));
    const label = accountLabel(code, name, housePrefixed);
    if (accountRows.some((r) => r.label === label)) {
      alert(`"${label}" already exists.`);
      return;
    }
    newCode.value = "";
    newName.value = "";
    setTreatment(label, "15");
  });
  addRow.append(newCode, newName, addAccount);
  body.append(addRow);

  if (accountRows.length === 0) return;

  const chartTable = document.createElement("table");
  chartTable.className = "entity-table accounts-table";
  const chartHead = document.createElement("thead");
  chartHead.innerHTML =
    "<tr><th>Code</th><th>Name</th><th>Type</th><th>GST</th>" +
    "<th>Entity, or which account</th><th></th></tr>";
  const chartBody = document.createElement("tbody");

  for (const { account, label } of accountRows) {
    const tr = document.createElement("tr");

    // Code and name are editable in place. A dialog would be tidier to build
    // and worse to use: the whole reason to change a code is that you can see
    // the ones around it, and a dialog covers them up.
    const codeCell = document.createElement("td");
    const nameCell = document.createElement("td");
    codeCell.className = "entity-left";
    nameCell.className = "entity-left";
    codeCell.textContent = account.code;
    nameCell.textContent = account.name;
    tr.append(codeCell, nameCell);

    // The type decides whether an account is income, an expense, or neither.
    // Chart accounts arrive with Xero's; accounts that exist only as a rule
    // have none, and a profit figure cannot be built until they do.
    const typeCell = document.createElement("td");
    typeCell.className = "entity-left";
    const typeSelect = document.createElement("select");
    for (const [value, caption] of ACCOUNT_TYPES) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = caption;
      option.selected = value === account.type;
      typeSelect.append(option);
    }
    // A type the picker does not offer -- Xero has more of them than a profit
    // and loss needs -- is kept as its own option rather than lost, and only
    // called out when nothing can place it.
    const placeable = isKnownType(account.type);
    if (account.type !== "" && !ACCOUNT_TYPES.some(([v]) => v === account.type)) {
      const option = document.createElement("option");
      option.value = account.type;
      option.textContent = account.type + (placeable ? "" : " (not recognised)");
      option.selected = true;
      typeSelect.append(option);
    }
    // Amber means "no report can place this", not "this is not income".
    // Accounts Receivable and Inventory are balance-sheet accounts doing
    // exactly what they should, and colouring them as problems taught people
    // to ignore the colour, which is worse than not having it.
    if (!placeable) typeSelect.className = "type-unset";
    typeSelect.addEventListener("change", () => {
      void setAccountType(account, label, typeSelect.value);
    });
    typeCell.append(typeSelect);
    tr.append(typeCell);

    // GST treatment. This is the value the returns actually use, so an account
    // with none is called out rather than defaulted quietly.
    //
    // Except on a bank account, which has none to set. Money moving into or
    // out of your own account is not a supply: the treatment belongs to the
    // income or expense code the other side of it was coded to. Asking for
    // one here put an amber "not set" against every bank account in the
    // chart, which was a job that could never be finished.
    const isBankAccount = account.type.trim().toLowerCase() === "bank";
    const gstCell = document.createElement("td");
    if (isBankAccount) {
      const none = document.createElement("span");
      none.className = "cell-not-applicable";
      none.textContent = "—";
      none.title = "A bank account has no GST treatment: moving your own money is not a supply.";
      gstCell.append(none);
      tr.append(gstCell);
    } else {
    const gst = document.createElement("select");
    const current = treatmentOf(label);
    const fromChart =
      current !== null &&
      ((state.rules as RuleFileShape | undefined)?.codeTreatments ?? {})[label] === undefined;
    const unset = document.createElement("option");
    unset.value = "";
    unset.textContent = "-- not set --";
    unset.selected = current === null;
    gst.append(unset);
    for (const rate of GST_OPTIONS) {
      const option = document.createElement("option");
      option.value = rate.value;
      option.textContent = rate.label;
      option.title = rate.hint;
      option.selected = current === rate.value;
      gst.append(option);
    }
    if (current !== null && !GST_OPTIONS.some((r) => r.value === current)) {
      // A treatment this picker cannot express -- half-deductible
      // entertainment, for instance -- is shown and left alone rather than
      // being flattened by the act of looking at it.
      const option = document.createElement("option");
      option.value = current;
      option.textContent = current;
      option.selected = true;
      gst.append(option);
    }
    if (current === null) gst.className = "gst-unset";
    else if (fromChart) {
      // Shown as what it is: the chart's own tax code, not a decision taken
      // here. Choosing anything writes a real treatment and the mark goes.
      gst.className = "gst-from-chart";
      gst.title = `From the chart: ${account.taxCode}`;
    }
    gst.addEventListener("change", () => setTreatment(label, gst.value));
    gstCell.append(gst);
    tr.append(gstCell);
    }

    // --- Which entity it belongs to. ---
    //
    // Two controls used to write this, and they could not agree. A chart
    // account belongs to one entity and is set here; a bank account may serve
    // several -- one current account pays the rates on two properties and the
    // company's suppliers -- and is set in the entity list above, which is
    // the only one of the two that can say "both". They were even keyed
    // differently, so assigning a bank account above left this reading
    // "unassigned" for ever. There is now one place to set it, and this shows
    // what it says.
    const cell = document.createElement("td");
    if (isBankAccount) {
      // Not which entity -- that is set above, where a bank account can serve
      // several -- but which account in this ledger this row *is*.
      //
      // A chart brings bank accounts with it, under the names the other system
      // used. Import the transactions and the same accounts arrive again under
      // the names the bank issues, and now one card is two rows: one with a
      // name and no money, one with money and no name. Nothing can safely join
      // them by their words, so this asks the one person who knows, once.
      const id = ledgerAccountFor(account.name, account);
      cell.append(bankLinkSelect(account));

      // And, quietly beside it, which entities that account serves -- decided
      // above, shown here so the row is not half an answer.
      const serves = (id === null ? [] : (model.banks[id] ?? []))
        .map((entityId) => model.entities.find((e) => e.id === entityId)?.name)
        .filter((name): name is string => name !== undefined);
      if (serves.length > 0) {
        const shown = document.createElement("span");
        shown.className = "cell-said-elsewhere bank-serves";
        shown.textContent = serves.join(", ");
        shown.title = "Which entities it serves, set in the list above.";
        cell.append(shown);
      }

      tr.append(cell);
      tr.append(removalCell(account, label));
      chartBody.append(tr);
      continue;
    }
    const select = document.createElement("select");
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "-- unassigned --";
    select.append(blank);
    for (const entity of model.entities) {
      const option = document.createElement("option");
      option.value = entity.id;
      option.textContent = entity.name;
      option.selected = model.accounts[accountEntityKey(account)] === entity.id;
      select.append(option);
    }
    select.addEventListener("change", () => {
      const live = state.ledger.entities ?? emptyEntityModel();
      const accountsMap = { ...live.accounts };
      const key = accountEntityKey(account);
      if (select.value === "") delete accountsMap[key];
      else accountsMap[key] = select.value;
      void saveEntities({ ...live, accounts: accountsMap });
    });
    cell.append(select);
    tr.append(cell);

    // Edit is offered here and not on the bank rows above. A bank row's name
    // is the ledger's own account id -- the string every transaction on that
    // account carries -- so letting somebody type over it would detach the
    // account from its own transactions, which is not a rename.
    const actions = removalCell(account, label);
    actions.prepend(editCell({ code: codeCell, name: nameCell }, account, label));
    tr.append(actions);
    chartBody.append(tr);
  }
  chartTable.append(chartHead, chartBody);
  body.append(chartTable);
}

/**
 * Record which account in this ledger a chart's bank row is.
 *
 * Kept on the chart account, so it travels in the file with the rest of the
 * setup and survives a browser being cleared, the same way the entity
 * assignment and the GST treatment do.
 */
async function setLedgerAccount(account: Account, to: string): Promise<void> {
  const chart = [...state.chart];
  const index = chart.findIndex((a) => a.code === account.code && a.name === account.name);
  if (index < 0) return;
  const was = chart[index];
  if (!was) return;
  const { ledgerAccount: _drop, ...rest } = was;
  chart[index] = to === "" ? rest : { ...rest, ledgerAccount: to };

  state.chart = chart;
  state.ledger = { ...state.ledger, chart };

  // Opening balances loaded before this link was made hold the bank row under
  // the name the other system gave it. Saying which account it is should
  // settle those too, rather than leaving a re-import as the only way to move
  // them onto the account they belong to.
  const held = state.ledger.openingBalances;
  if (held !== undefined && to !== "" && to !== NOT_IN_LEDGER) {
    const name = account.name.trim().toLowerCase();
    const { balances, moved } = relabelOpeningBalances(held, (key) =>
      key.trim().toLowerCase() === name ? to : undefined,
    );
    if (moved.length > 0) state.ledger = { ...state.ledger, openingBalances: balances };
  }

  // Naming the chart, because a save that names nothing writes only the parts
  // that are written every time -- the transactions and the decisions. The
  // opening balances moved just above ride along in the decisions; the link
  // itself lives in the chart, and without this it was held in memory until
  // the next reload threw it away.
  state.persistent = await savePart(state.ledger, "chart");
  await record(
    "chart",
    to === ""
      ? `${account.name} is no longer linked to a ledger account`
      : to === NOT_IN_LEDGER
        ? `${account.name} is not an account this ledger holds`
        : `${account.name} is ${to}`,
    was,
    chart[index] ?? null,
    `${account.code}|${account.name}`,
  );
  redraw("entities");
  // The guided start asks this as one of its steps and counts what is left.
  redraw("migration");
}

/**
 * Turn an account's code and name into fields, and back again.
 *
 * In place rather than in a dialog: the reason somebody is changing a code is
 * usually that they can see the codes around it, and a dialog covers them up.
 *
 * Enter saves, Escape abandons -- both because a two-field edit that can only
 * be finished by aiming at a button is slower than the typing it follows.
 */
function editCell(
  cells: { code: HTMLTableCellElement; name: HTMLTableCellElement },
  account: Account,
  label: string,
): HTMLButtonElement {
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "row-edit";
  edit.textContent = "Edit";
  edit.title = "Change this account's code or name.";

  let editing = false;
  const stop = (): void => {
    editing = false;
    cells.code.textContent = account.code;
    cells.name.textContent = account.name;
    edit.textContent = "Edit";
  };

  edit.addEventListener("click", () => {
    if (editing) {
      const code = (cells.code.firstElementChild as HTMLInputElement | null)?.value ?? "";
      const name = (cells.name.firstElementChild as HTMLInputElement | null)?.value ?? "";
      void renameChartAccount(account, label, { code, name });
      return;
    }

    editing = true;
    edit.textContent = "Save";
    for (const [cell, value, width, placeholder] of [
      [cells.code, account.code, "5em", "Code"],
      [cells.name, account.name, "14em", "Name"],
    ] as const) {
      const input = document.createElement("input");
      input.type = "text";
      input.value = value;
      input.placeholder = placeholder;
      input.style.width = width;
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") edit.click();
        if (event.key === "Escape") stop();
      });
      cell.textContent = "";
      cell.append(input);
    }
    (cells.code.firstElementChild as HTMLInputElement | null)?.focus();
  });

  return edit;
}

function removalCell(account: Account, label: string): HTMLTableCellElement {
  const cell = document.createElement("td");
  const coded = codedToEach().get(label) ?? 0;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "row-remove";
  button.textContent = "Remove";
  if (coded > 0) {
    button.disabled = true;
    button.title =
      `${coded} transaction${coded === 1 ? " is" : "s are"} coded to this account. ` +
      "Recode them first, or it would leave them pointing at nothing.";
  } else {
    button.title = "Take this account out of the chart.";
    button.addEventListener("click", () => {
      if (!confirm(`Remove "${account.name}" from the chart of accounts?`)) return;
      void removeChartAccount(account, label);
    });
  }
  cell.append(button);
  return cell;
}

function codedToEach(): Map<string, number> {
  return codingProgress().byCode;
}

/** Take one account out of the chart, and out of everything keyed to it. */
async function removeChartAccount(account: Account, label: string): Promise<void> {
  const chart = state.chart.filter(
    (a) => !(a.code === account.code && a.name === account.name),
  );
  state.chart = chart;

  // The entity assignment goes with it: an assignment keyed to an account that
  // is gone is a row nothing will ever read and something will one day count.
  const model = state.ledger.entities ?? emptyEntityModel();
  const accounts = { ...model.accounts };
  delete accounts[accountEntityKey(account)];

  state.ledger = { ...state.ledger, chart, entities: { ...model, accounts } };
  state.persistent = await savePart(state.ledger, "chart", "entities");
  await record("chart", `${account.name} removed from the chart`, account, null, `${account.code}|${account.name}`);

  // And its GST treatment, which lives with the rules.
  const file = state.rules as RuleFileShape | undefined;
  if (file?.codeTreatments?.[label] !== undefined) {
    const codeTreatments = { ...file.codeTreatments };
    delete codeTreatments[label];
    state.rules = { ...file, codeTreatments } as RuleSet;
    await persistRules();
  }
  reclassify();
  redraw("entities");
}

/**
 * Change an account's code or name, and everything that points at it.
 *
 * An account is stored in the chart and referred to everywhere else by a
 * label built from its code and name. Editing the chart row alone would leave
 * every transaction coded to a name no account has, its GST treatment
 * unfindable and its entity assignment keyed to a code nothing holds -- none
 * of which raises an error, and all of which quietly moves a return.
 *
 * So the whole move is worked out first, in the core where it can be tested,
 * and saved as one change. The user is told what came with it, because "also
 * moved 46 codings" is the part they would otherwise have to take on trust.
 */
async function renameChartAccount(
  account: Account,
  label: string,
  to: { code: string; name: string },
): Promise<void> {
  const code = to.code.trim();
  const name = to.name.trim();
  if (code === account.code && name === account.name) return;

  // Named the way this ledger already names accounts, so the new label is the
  // same string the coding picker will offer.
  const housePrefixed = accountsForEditing().some((r) => /^NB\s+/i.test(r.label));
  const newLabel = accountLabel(code, name, housePrefixed);

  // Given the name or the code of an account that is already there, the two
  // are one account -- an imported category and the chart's name for the same
  // thing. Refusing left the category as a second account, or to be recoded
  // line by line.
  const existing = accountsForEditing().find(
    (r) => r.label !== label && (r.label === newLabel || (code !== "" && r.account.code.trim() === code)),
  );
  if (existing !== undefined) {
    const ok = confirm(
      `"${existing.label}" already exists. Merge "${label}" into it?\n\n` +
        "Every coding, split and rule moves across, and the account keeps its own GST " +
        `treatment and entity. A file that still says "${label}" will read as ${existing.label}.`,
    );
    if (ok) await mergeChartAccount(account, label, existing.account, existing.label);
    return;
  }

  const why = renameProblem(state.chart, account, to);
  if (why !== null) {
    alert(why);
    return;
  }

  const model = state.ledger.entities ?? emptyEntityModel();
  const after = renameAccount(
    {
      chart: state.chart,
      overrides: state.ledger.overrides ?? {},
      splits: state.ledger.splits ?? {},
      rules: state.rules,
      accountEntities: model.accounts,
    },
    account,
    { code, name },
    label,
    newLabel,
  );

  state.chart = after.chart;
  state.ledger = {
    ...state.ledger,
    chart: after.chart,
    overrides: after.overrides,
    splits: after.splits,
    entities: { ...model, accounts: after.accountEntities },
  };
  // Saved whole rather than part by part: a rename moves the chart, the
  // codings, the splits and the entity assignment together, and a half-written
  // rename is the thing this function exists to prevent.
  state.persistent = await save(state.ledger);
  state.rules = after.rules;
  await persistRules();

  const { codings, splitParts, rules, treatment } = after.moved;
  const carried = [
    codings > 0 ? `${codings} coding${codings === 1 ? "" : "s"}` : "",
    splitParts > 0 ? `${splitParts} split part${splitParts === 1 ? "" : "s"}` : "",
    rules > 0 ? `${rules} rule${rules === 1 ? "" : "s"}` : "",
    treatment ? "its GST treatment" : "",
  ].filter((part) => part !== "");

  await record(
    "chart",
    `${label} renamed to ${newLabel}` +
      (carried.length > 0 ? `, carrying ${carried.join(", ")}` : ""),
    account,
    after.chart.find((a) => a.code === code && a.name === name) ?? null,
    `${account.code}|${account.name}`,
  );

  reclassify();
  redraw("entities");
}

/** Fold an account into one that already exists, carrying what points at it. */
async function mergeChartAccount(
  account: Account,
  label: string,
  into: Account,
  intoLabel: string,
): Promise<void> {
  const model = state.ledger.entities ?? emptyEntityModel();
  const after = mergeAccount(
    {
      chart: state.chart,
      overrides: state.ledger.overrides ?? {},
      splits: state.ledger.splits ?? {},
      rules: state.rules,
      accountEntities: model.accounts,
    },
    account,
    into,
    label,
    intoLabel,
  );

  state.chart = after.chart;
  state.ledger = {
    ...state.ledger,
    chart: after.chart,
    overrides: after.overrides,
    splits: after.splits,
    entities: { ...model, accounts: after.accountEntities },
  };
  // Saved whole, as a rename is: the codings and the chart move together.
  state.persistent = await save(state.ledger);
  state.rules = after.rules;
  await persistRules();

  const { codings, splitParts, rules } = after.moved;
  const carried = [
    codings > 0 ? `${codings} coding${codings === 1 ? "" : "s"}` : "",
    splitParts > 0 ? `${splitParts} split part${splitParts === 1 ? "" : "s"}` : "",
    rules > 0 ? `${rules} rule${rules === 1 ? "" : "s"}` : "",
  ].filter((part) => part !== "");

  await record(
    "chart",
    `${label} merged into ${intoLabel}` + (carried.length > 0 ? `, carrying ${carried.join(", ")}` : ""),
    account,
    into,
    `${account.code}|${account.name}`,
  );

  reclassify();
  redraw("entities");
}

/**
 * Set an account's type, promoting it into the chart if it was only a rule.
 *
 * An account that exists solely as a coding rule has nowhere to keep a type.
 * Giving it one puts it in the chart, which is also what makes it survive a
 * reload and travel in the saved file.
 */
async function setAccountType(account: Account, label: string, type: string): Promise<void> {
  const chart = [...state.chart];
  const index = chart.findIndex((a) => a.code === account.code && a.name === account.name);
  if (index >= 0) {
    const existing = chart[index];
    if (existing) chart[index] = { ...existing, type };
  } else {
    chart.push({ ...account, type });
  }
  const wasAccount = index >= 0 ? (state.chart[index] ?? null) : null;
  state.chart = chart;
  state.ledger = { ...state.ledger, chart };
  state.persistent = await savePart(state.ledger, "chart");
  await record(
    "chart",
    `${account.code || account.name} type set to ${type === "" ? "not on the P&L" : type}`,
    wasAccount,
    chart[index >= 0 ? index : chart.length - 1] ?? null,
    `${account.code}|${account.name}`,
  );
  redraw("entities");
}

/**
 * The GST option this account's treatment corresponds to, or null if unset.
 *
 * A treatment set in this app wins; the chart's tax code is the default behind
 * it. Both are reported the same way, and `treatmentIsFromChart` says which,
 * so the page can show a default as a default.
 */
function treatmentOf(label: string): string | null {
  const file = state.rules as RuleFileShape | undefined;
  return rateForTreatment((file?.codeTreatments ?? {})[label] ?? chartTreatmentOf(label));
}

/**
 * Write a GST treatment for one account into the rule set.
 *
 * Started with none, if there are none. How an account is treated for GST is a
 * fact about the account, and having written no coding rules yet is no reason
 * to refuse to record it -- but the treatments are kept in the rule file, so
 * the page used to say "load a rule file first" to anybody who had not got one.
 * Which is everybody who starts from a bank feed rather than from another
 * accounting system, and they cannot get one: the rule file is something this
 * app writes, not something they have lying about.
 */
function setTreatment(label: string, rate: string): void {
  const file = (state.rules as RuleFileShape | undefined) ?? { rules: [] };
  if (state.rules === undefined) {
    state.rulesName = "rules.json";
    state.rulesLoadedAt = new Date().toISOString();
  }
  const codeTreatments = { ...(file.codeTreatments ?? {}) };
  const wasTreated = codeTreatments[label] ?? null;
  if (rate === "") delete codeTreatments[label];
  else if (rate === "0") codeTreatments[label] = "out-of-scope";
  else if (rate === "100") codeTreatments[label] = { treatment: "standard", side: "imports" };
  else if (rate === "15") codeTreatments[label] = "standard";
  else return; // a treatment this picker does not express: left as it was

  // RuleSet is the shape core consumes; the file carries GST fields alongside
  // it, which is why the app works in terms of RuleFileShape throughout.
  state.rules = { ...file, codeTreatments } as RuleSet;
  void record(
    "codeTreatment",
    `${label} GST set to ${rate === "" ? "not set" : rate + "%"}`,
    wasTreated,
    codeTreatments[label] ?? null,
    label,
  );
  reclassify();
  void persistRules().then(() => redraw("entities"));
}
