import { saveEntities } from "../books.js";
import { state } from "../state.js";
import { emptyEntityModel, NON_PROFIT_FORMS, nonProfitDefaults, nonProfitNotes, nonProfitReporting } from "@nzosa/core";
import type { Entity, NonProfit, NonProfitForm } from "@nzosa/core";

/**
 * A not-for-profit's settings, in the entity's settings: what sort it is, and
 * the few facts that decide how it is treated -- registered charity, donee
 * organisation, approved for the $1,000 deduction. Under them, in plain words,
 * what it has to file and what follows from the answers given.
 *
 * Shown only for an entity of kind `nonprofit`. The legal form sets the usual
 * answers; each one can be changed on its own, because a club may be a
 * charity and a society may not be (see core's non-profit.ts).
 */

/** The form's usual settings for a new not-for-profit: shown in the add row too. */
export function formSelect(value: NonProfitForm, onChange: (form: NonProfitForm) => void): HTMLSelectElement {
  const select = document.createElement("select");
  select.title = "What sort of organisation it is. Sets the usual answers below; change any of them.";
  for (const [form, caption] of NON_PROFIT_FORMS) {
    const option = document.createElement("option");
    option.value = form;
    option.textContent = caption;
    option.selected = value === form;
    select.append(option);
  }
  select.addEventListener("change", () => onChange(select.value as NonProfitForm));
  return select;
}

function change(entity: Entity, next: NonProfit, what: string): void {
  const live = state.ledger.entities ?? emptyEntityModel();
  void saveEntities(
    { ...live, entities: live.entities.map((e) => (e.id === entity.id ? { ...e, nonprofit: next } : e)) },
    `${entity.name}: ${what}`,
  );
}

function tick(label: string, checked: boolean, onChange: (value: boolean) => void): HTMLLabelElement {
  const wrap = document.createElement("label");
  wrap.className = "entity-gst";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = checked;
  box.addEventListener("change", () => onChange(box.checked));
  wrap.append(box, ` ${label}`);
  return wrap;
}

export function nonProfitSettings(entity: Entity): HTMLElement {
  const box = document.createElement("div");
  box.className = "non-profit-settings";
  box.hidden = entity.kind !== "nonprofit";
  const np: NonProfit = entity.nonprofit ?? nonProfitDefaults("society");

  box.append(
    formSelect(np.form, (form) => {
      // The form's usual answers fill what has not been said; what has is kept.
      const usual = nonProfitDefaults(form);
      change(entity, { ...usual, ...np, form, registeredCharity: np.registeredCharity ?? usual.registeredCharity }, `now a ${form}`);
    }),
    tick("Registered charity", np.registeredCharity === true, (value) =>
      change(entity, { ...np, registeredCharity: value }, value ? "registered charity" : "not a registered charity"),
    ),
  );

  const number = document.createElement("input");
  number.type = "text";
  number.placeholder = "Charity number (CC12345)";
  number.value = np.charityNumber ?? "";
  number.hidden = np.registeredCharity !== true;
  number.addEventListener("change", () => {
    const { charityNumber: _gone, ...rest } = np;
    change(entity, number.value.trim() === "" ? rest : { ...rest, charityNumber: number.value.trim() }, "charity number");
  });
  box.append(number);

  box.append(
    tick("Donee organisation (donors can claim a tax credit)", np.donee === true, (value) =>
      change(entity, { ...np, donee: value }, value ? "donee organisation" : "not a donee organisation"),
    ),
  );
  // What a receipt shows, and who signs it: only a donee organisation issues them.
  if (np.donee === true) {
    const parent = document.createElement("input");
    parent.type = "text";
    parent.placeholder = "Part of a larger organisation? Its name, for receipts";
    parent.title = "A branch must say on its receipts which larger organisation it belongs to.";
    parent.value = np.partOf ?? "";
    parent.addEventListener("change", () => {
      const { partOf: _gone, ...rest } = np;
      change(entity, parent.value.trim() === "" ? rest : { ...rest, partOf: parent.value.trim() }, "part of");
    });
    box.append(parent);
    const ird = document.createElement("input");
    ird.type = "text";
    ird.placeholder = "IRD number";
    ird.value = np.irdNumber ?? "";
    ird.addEventListener("change", () => {
      const { irdNumber: _gone, ...rest } = np;
      change(entity, ird.value.trim() === "" ? rest : { ...rest, irdNumber: ird.value.trim() }, "IRD number");
    });
    const signer = document.createElement("input");
    signer.type = "text";
    signer.placeholder = "Authorised to sign receipts: full name";
    signer.value = np.signatory?.name ?? "";
    const role = document.createElement("input");
    role.type = "text";
    role.placeholder = "Designation (Treasurer)";
    role.value = np.signatory?.designation ?? "";
    const saveSigner = (): void => {
      const { signatory: _gone, ...rest } = np;
      const name = signer.value.trim();
      const designation = role.value.trim();
      change(entity, name === "" && designation === "" ? rest : { ...rest, signatory: { name, designation } }, "who signs receipts");
    };
    signer.addEventListener("change", saveSigner);
    role.addEventListener("change", saveSigner);
    box.append(ird, signer, role);
  }
  if (np.registeredCharity !== true) {
    box.append(
      tick("Approved by Inland Revenue for the $1,000 deduction", np.deduction === true, (value) =>
        change(entity, { ...np, deduction: value }, value ? "approved for the $1,000 deduction" : "not approved for the $1,000 deduction"),
      ),
    );
  }

  const owes = nonProfitReporting(np);
  const notes = nonProfitNotes(np, entity.gstRegistered === true);
  if (owes.length > 0) {
    const heading = document.createElement("h4");
    heading.textContent = "What it files";
    const list = document.createElement("ul");
    for (const line of owes) list.append(Object.assign(document.createElement("li"), { textContent: line }));
    box.append(heading, list);
  }
  const heading = document.createElement("h4");
  heading.textContent = "Worth knowing";
  const list = document.createElement("ul");
  for (const line of notes) list.append(Object.assign(document.createElement("li"), { textContent: line }));
  box.append(heading, list);
  return box;
}
