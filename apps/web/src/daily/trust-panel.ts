import { saveEntities } from "../books.js";
import { state } from "../state.js";
import { TRUST_TYPES, emptyEntityModel, emptyTrust, trustNotes, trustReporting } from "@nzosa/core";
import type { Entity, Trust, TrustType } from "@nzosa/core";

/**
 * A trust or estate's settings, in the entity's settings: what sort of trust
 * it is and the few facts that change its rates and what it has to disclose.
 * The people -- settlors, appointers, beneficiaries -- have a page of their
 * own. Shown only for an entity of kind `trust`.
 */

function change(entity: Entity, next: Trust, what: string): void {
  const live = state.ledger.entities ?? emptyEntityModel();
  void saveEntities(
    { ...live, entities: live.entities.map((e) => (e.id === entity.id ? { ...e, trust: next } : e)) },
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

/** Set or clear an optional text field without leaving an empty string behind. */
function withText<K extends "irdNumber" | "deed">(t: Trust, key: K, value: string): Trust {
  const { [key]: _gone, ...rest } = t;
  return (value.trim() === "" ? rest : { ...rest, [key]: value.trim() }) as Trust;
}

export function trustSettings(entity: Entity): HTMLElement {
  const box = document.createElement("div");
  box.className = "non-profit-settings";
  box.hidden = entity.kind !== "trust";
  if (entity.kind !== "trust") return box;
  const trust: Trust = entity.trust ?? emptyTrust();

  const type = document.createElement("select");
  type.title = "A complying trust has always paid tax on its income; a foreign or non-complying trust has different rules.";
  for (const [value, caption] of TRUST_TYPES) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = caption;
    option.selected = trust.type === value;
    type.append(option);
  }
  type.addEventListener("change", () => change(entity, { ...trust, type: type.value as TrustType }, `now a ${type.value} trust`));

  const ird = document.createElement("input");
  ird.type = "text";
  ird.placeholder = "Trust's IRD number";
  ird.value = trust.irdNumber ?? "";
  ird.addEventListener("change", () => change(entity, withText(trust, "irdNumber", ird.value), "IRD number"));

  const deed = document.createElement("input");
  deed.type = "date";
  deed.title = "The date of the trust deed (or of the death, for an estate)";
  deed.value = trust.deed ?? "";
  deed.addEventListener("change", () => change(entity, withText(trust, "deed", deed.value), "date of the deed"));

  box.append(
    type,
    ird,
    deed,
    tick("Registered with Inland Revenue (an IR596 and the deed sent)", trust.registered === true, (v) =>
      change(entity, { ...trust, registered: v }, v ? "registered" : "not registered"),
    ),
    tick("An estate (a deceased person's)", trust.estateDeathYear !== undefined, (v) => {
      const { estateDeathYear: _gone, ...rest } = trust;
      change(entity, v ? { ...rest, estateDeathYear: new Date().getFullYear() + (new Date().getMonth() >= 3 ? 1 : 0) } : rest, v ? "an estate" : "not an estate");
    }),
  );
  if (trust.estateDeathYear !== undefined) {
    const death = document.createElement("input");
    death.type = "number";
    death.min = "1990";
    death.title = "The tax year the person died in, by the year it ends: a death in June 2025 is the 2026 year";
    death.value = String(trust.estateDeathYear);
    death.addEventListener("change", () => {
      const year = Number(death.value);
      if (Number.isFinite(year) && year > 1900) change(entity, { ...trust, estateDeathYear: year }, "year of death");
    });
    const label = document.createElement("label");
    label.className = "year-end-field";
    label.append("Tax year of death (the year it ends in) ", death);
    box.append(label);
  }
  box.append(
    tick("A disabled beneficiary trust (33% on trustee income)", trust.disabledBeneficiaryTrust === true, (v) =>
      change(entity, { ...trust, disabledBeneficiaryTrust: v }, "disabled beneficiary trust"),
    ),
    tick("An energy consumer trust (33%)", trust.energyConsumerTrust === true, (v) =>
      change(entity, { ...trust, energyConsumerTrust: v }, "energy consumer trust"),
    ),
    tick("A legacy superannuation fund trust (28%)", trust.legacySuperannuation === true, (v) =>
      change(entity, { ...trust, legacySuperannuation: v }, "legacy superannuation fund trust"),
    ),
    tick(
      "Not subject to the disclosure rules: inactive, a registered charity, a foreign trust or the like",
      trust.disclosureExempt === true,
      (v) => change(entity, { ...trust, disclosureExempt: v }, "disclosure rules"),
    ),
  );

  const owes = trustReporting(trust);
  const heading = document.createElement("h4");
  heading.textContent = "What it files";
  const list = document.createElement("ul");
  for (const line of owes) list.append(Object.assign(document.createElement("li"), { textContent: line }));
  const worth = document.createElement("h4");
  worth.textContent = "Worth knowing";
  const notes = document.createElement("ul");
  for (const line of trustNotes(trust)) notes.append(Object.assign(document.createElement("li"), { textContent: line }));
  box.append(heading, list);
  if (notes.childElementCount > 0) box.append(worth, notes);
  return box;
}
