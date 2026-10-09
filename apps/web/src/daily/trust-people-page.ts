import { redraw } from "../app.js";
import { saveEntities } from "../books.js";
import { $, state } from "../state.js";
import { note } from "../ui.js";
import { accountEntityKey, ageOn, emptyEntityModel, emptyTrust } from "@nzosa/core";
import type { Entity, Trust, TrustAppointer, TrustBeneficiary, TrustPerson } from "@nzosa/core";

/**
 * Who is in a trust: the settlors, the people who can appoint or remove
 * trustees and beneficiaries, and the beneficiaries -- with, for each
 * beneficiary, the account in the books that holds what the trust owes them
 * and the facts that decide which tax rules apply to them. The IR6 page uses
 * these; see core's trust.ts for what the guide says.
 */

let chosen = "";

type Group = "settlors" | "appointers" | "beneficiaries";

function trustEntities(): Entity[] {
  return (state.ledger.entities ?? emptyEntityModel()).entities.filter((e) => e.kind === "trust");
}

function newId(): string {
  return `p${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

function field(
  placeholder: string,
  value: string,
  onChange: (v: string) => void,
  type: "text" | "date" = "text",
  title?: string,
): HTMLInputElement {
  const input = document.createElement("input");
  input.type = type;
  input.placeholder = placeholder;
  input.value = value;
  if (title !== undefined) input.title = title;
  input.addEventListener("change", () => onChange(input.value.trim()));
  return input;
}

function tick(label: string, checked: boolean, onChange: (v: boolean) => void, title?: string): HTMLLabelElement {
  const wrap = document.createElement("label");
  wrap.className = "feed-auto";
  if (title !== undefined) wrap.title = title;
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = checked;
  box.addEventListener("change", () => onChange(box.checked));
  wrap.append(box, ` ${label}`);
  return wrap;
}

async function save(entity: Entity, trust: Trust, what: string): Promise<void> {
  const live = state.ledger.entities ?? emptyEntityModel();
  await saveEntities(
    { ...live, entities: live.entities.map((e) => (e.id === entity.id ? { ...e, trust } : e)) },
    `${entity.name}: ${what}`,
  );
  redraw("trustPeople");
}

/** Edit one person, from the trust as stored now. */
function edit<T extends TrustPerson>(entity: Entity, group: Group, id: string, change: Partial<T>, what: string): void {
  const live = (state.ledger.entities ?? emptyEntityModel()).entities.find((e) => e.id === entity.id);
  const trust = live?.trust ?? emptyTrust();
  const list = (trust[group] as unknown as T[]).map((p) => {
    if (p.id !== id) return p;
    const next = { ...p } as Record<string, unknown>;
    for (const [k, v] of Object.entries(change)) {
      if (v === undefined || v === "" || v === false) delete next[k];
      else next[k] = v;
    }
    return next as unknown as T;
  });
  void save(entity, { ...trust, [group]: list }, what);
}

function remove(entity: Entity, group: Group, id: string, name: string): void {
  const live = (state.ledger.entities ?? emptyEntityModel()).entities.find((e) => e.id === entity.id);
  const trust = live?.trust ?? emptyTrust();
  if (!confirm(`Remove ${name === "" ? "this person" : name} from the trust's ${group}?`)) return;
  void save(entity, { ...trust, [group]: (trust[group] as unknown as TrustPerson[]).filter((p) => p.id !== id) }, `removed ${name}`);
}

function add(entity: Entity, group: Group): void {
  const live = (state.ledger.entities ?? emptyEntityModel()).entities.find((e) => e.id === entity.id);
  const trust = live?.trust ?? emptyTrust();
  const person: TrustPerson = { id: newId(), name: "", residence: "NZ" };
  void save(entity, { ...trust, [group]: [...(trust[group] as unknown as TrustPerson[]), person] }, `added to the ${group}`);
}

function basics<T extends TrustPerson>(entity: Entity, group: Group, p: T): HTMLElement[] {
  return [
    field("Full name", p.name, (v) => edit<T>(entity, group, p.id, { name: v } as Partial<T>, `name`)),
    field("Born or began", p.born ?? "", (v) => edit<T>(entity, group, p.id, { born: v } as Partial<T>, "date of birth"), "date", "Date of birth, or the date a company or trust began"),
    field("Tax resident in", p.residence ?? "", (v) => edit<T>(entity, group, p.id, { residence: v } as Partial<T>, "residence"), "text", "NZ, or the country they are tax resident in"),
    field("IRD number", p.irdNumber ?? "", (v) => edit<T>(entity, group, p.id, { irdNumber: v } as Partial<T>, "IRD number"), "text", "Leave blank for a minor with no income, or a non-resident"),
    field("Foreign tax number (TIN)", p.tin ?? "", (v) => edit<T>(entity, group, p.id, { tin: v } as Partial<T>, "tax number"), "text", "For someone not resident in New Zealand"),
  ];
}

function section(
  body: HTMLElement,
  entity: Entity,
  group: Group,
  title: string,
  hint: string,
  addLabel: string,
  extras: (p: never) => HTMLElement[],
): void {
  const h = document.createElement("h3");
  h.textContent = title;
  body.append(h, note(hint));
  const trust = entity.trust ?? emptyTrust();
  const people = trust[group] as unknown as TrustPerson[];
  if (people.length === 0) body.append(note("None yet."));
  for (const p of people) {
    const row = document.createElement("div");
    row.className = "journal-card";
    row.style.display = "flex";
    row.style.flexWrap = "wrap";
    row.style.gap = "0.5rem";
    row.style.alignItems = "center";
    row.append(...basics(entity, group, p), ...(extras as (p: TrustPerson) => HTMLElement[])(p));
    const gone = document.createElement("button");
    gone.type = "button";
    gone.textContent = "Remove";
    gone.addEventListener("click", () => remove(entity, group, p.id, p.name));
    row.append(gone);
    body.append(row);
  }
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = addLabel;
  button.addEventListener("click", () => add(entity, group));
  body.append(button);
}

export function renderTrustPeoplePage(): void {
  const body = $("trust-people-body");
  body.textContent = "";
  const trusts = trustEntities();
  if (trusts.length === 0) {
    body.append(note("No trusts or estates. On Entities & accounts, add one and choose \"Trust or estate\"."));
    return;
  }
  const entity = trusts.find((e) => e.id === chosen) ?? trusts.find((e) => e.id === state.entityFilter) ?? trusts[0];
  if (entity === undefined) return;
  chosen = entity.id;
  const trust = entity.trust ?? emptyTrust();

  if (trusts.length > 1) {
    const who = document.createElement("select");
    for (const e of trusts) {
      const option = document.createElement("option");
      option.value = e.id;
      option.textContent = e.name;
      option.selected = e.id === entity.id;
      who.append(option);
    }
    who.addEventListener("change", () => {
      chosen = who.value;
      redraw("trustPeople");
    });
    body.append(who);
  }

  const today = new Date().toISOString().slice(0, 10);
  // The trust's own accounts: a beneficiary's current account is the trust's
  // liability, never somebody else's equity. With nothing assigned to the trust
  // yet, every account, rather than an empty list.
  const model = state.ledger.entities ?? emptyEntityModel();
  const theTrusts = (a: (typeof state.chart)[number]): boolean => model.accounts[accountEntityKey(a)] === entity.id;
  const kinds = state.chart.filter((a) => /liabilit|payable|equity/i.test(a.type));
  const liabilityAccounts = kinds.some(theTrusts) ? kinds.filter(theTrusts) : kinds;

  section(
    body,
    entity,
    "beneficiaries",
    "Beneficiaries",
    "Each beneficiary, with the account in the books that holds what the trust owes them (a current account). A child under 16 who lives in New Zealand is taxed under the minor rule when " +
      "they are allocated more than $1,000 in a year; a company is taxed under the corporate rule when a settlor, trustee or their relative is a shareholder.",
    "Add a beneficiary",
    ((b: TrustBeneficiary) => {
      const out: HTMLElement[] = [];
      const account = document.createElement("select");
      account.title = "The account in the books that holds what the trust owes this beneficiary";
      const none = document.createElement("option");
      none.value = "";
      none.textContent = "Their account in the books";
      account.append(none);
      // One linked earlier to an account outside the list stays shown.
      const linkedElsewhere = state.chart.filter((a) => a.code === b.accountCode && !liabilityAccounts.includes(a));
      for (const a of [...liabilityAccounts, ...linkedElsewhere]) {
        const option = document.createElement("option");
        option.value = a.code;
        option.textContent = `${a.code} ${a.name}`;
        option.selected = a.code === b.accountCode;
        account.append(option);
      }
      account.addEventListener("change", () => edit<TrustBeneficiary>(entity, "beneficiaries", b.id, { accountCode: account.value }, "their account"));
      out.push(account);
      out.push(
        tick("Company: corporate rule applies", b.corporateRule === true, (v) =>
          edit<TrustBeneficiary>(entity, "beneficiaries", b.id, { corporateRule: v }, "corporate rule"),
          "A close company with a settlor, trustee or their relative as a shareholder. Not for a Māori authority, tax charity or securitisation trust.",
        ),
        tick("Disability allowance paid", b.disabilityAllowance === true, (v) =>
          edit<TrustBeneficiary>(entity, "beneficiaries", b.id, { disabilityAllowance: v }, "disability allowance"),
          "A child on a disability allowance or child disability allowance is outside the minor rule.",
        ),
        tick("Trustee does not deduct their tax", b.trusteeDoesNotPay === true, (v) =>
          edit<TrustBeneficiary>(entity, "beneficiaries", b.id, { trusteeDoesNotPay: v }, "tax agreement"),
          "By agreement, for example where the beneficiary has losses. The trustees are liable if they default.",
        ),
      );
      if (b.born !== undefined && b.born !== "") {
        const age = ageOn(b.born, today);
        if (age < 16 && b.corporateRule !== true) out.push(Object.assign(document.createElement("span"), { textContent: `Age ${age}: a minor` }));
      }
      return out;
    }) as unknown as (p: never) => HTMLElement[],
  );

  section(
    body,
    entity,
    "settlors",
    "Settlors",
    "Anyone who has ever put value into the trust, or on its terms -- including by selling to it or lending to it below market value. Include past settlors, even if they settled nothing this year. " +
      "What each settled this year is entered on the IR6 page.",
    "Add a settlor",
    (() => []) as unknown as (p: never) => HTMLElement[],
  );

  section(
    body,
    entity,
    "appointers",
    "People who can appoint or remove",
    "Anyone with the power to appoint or dismiss a trustee, add or remove a beneficiary, or change the trust deed. Say when they got the power, and when they lost it if they have.",
    "Add a person",
    ((p: TrustAppointer) => [
      field("From", p.since ?? "", (v) => edit<TrustAppointer>(entity, "appointers", p.id, { since: v }, "power from"), "date", "When they were given the power; a reasonable estimate if unknown"),
      field("Until", p.until ?? "", (v) => edit<TrustAppointer>(entity, "appointers", p.id, { until: v }, "power until"), "date", "Leave blank if they still have it"),
    ]) as unknown as (p: never) => HTMLElement[],
  );

  if (trust.beneficiaries.length > 0) {
    body.append(
      note(
        "Beneficiary accounts, allocations and the year's distributions are entered on the IR6 page, where the tax is worked out.",
      ),
    );
  }
}
