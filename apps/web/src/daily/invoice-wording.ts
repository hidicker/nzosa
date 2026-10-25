import { redraw } from "../app.js";
import { record } from "../books.js";
import { state } from "../state.js";
import { savePart } from "../store.js";
import type { StoredLedger } from "../store.js";
import { note } from "../ui.js";
import { DEFAULT_WORDING, WORDING_FILL_INS } from "@nzosa/core";
import type { InvoiceMessage, WordingKind } from "@nzosa/core";

/**
 * Messages and email wording, at the foot of the Invoices page: the saved
 * messages an invoice can carry, one of them the default for new invoices,
 * and the person's own words for the emails that go with an invoice, a
 * statement and a reminder.
 */

let opened = false;

type Kept = Pick<StoredLedger, "invoiceMessages" | "emailWording">;

function kept(): Kept {
  return {
    ...(state.ledger.invoiceMessages !== undefined ? { invoiceMessages: state.ledger.invoiceMessages } : {}),
    ...(state.ledger.emailWording !== undefined ? { emailWording: state.ledger.emailWording } : {}),
  };
}

async function keep(next: Kept, what: string): Promise<void> {
  const before = kept();
  const { invoiceMessages: _m, emailWording: _w, ...rest } = state.ledger;
  state.ledger = { ...rest, ...next } as StoredLedger;
  state.persistent = await savePart(state.ledger);
  await record("wording", what, before, next);
  redraw("invoices");
}

/** A labelled box, laid out as the invoice editor lays out its own. */
function labelled(words: string, control: HTMLElement): HTMLLabelElement {
  const wrap = document.createElement("label");
  const name = document.createElement("span");
  name.textContent = words;
  control.style.width = "100%";
  wrap.append(name, control);
  return wrap;
}

const WORDING_NAMES: Readonly<Record<WordingKind, string>> = {
  invoice: "Email with an invoice",
  statement: "Email with a statement",
  reminder: "Email with a reminder",
};

export function invoiceWordingPanel(body: HTMLElement): void {
  const box = document.createElement("details");
  box.className = "payroll-add";
  box.open = opened;
  box.addEventListener("toggle", () => {
    opened = box.open;
  });
  const summary = document.createElement("summary");
  summary.textContent = "Messages and email wording";
  box.append(summary);

  // --- saved messages -------------------------------------------------------
  const messages = state.ledger.invoiceMessages ?? [];
  const h = document.createElement("h4");
  h.textContent = "Messages on invoices";
  box.append(h, note("Printed at the foot of an invoice. The default one goes on every new invoice; another can be chosen, or the words changed, on the invoice itself."));
  for (const m of messages) {
    const row = document.createElement("div");
    row.className = "invoice-fields";
    const name = document.createElement("input");
    name.type = "text";
    name.value = m.name;
    const text = document.createElement("textarea");
    text.rows = 2;
    text.value = m.text;
    const save = (): void => {
      const next = messages.map((x) => (x.id === m.id ? { ...x, name: name.value.trim() || x.name, text: text.value.trim() } : x));
      void keep({ ...kept(), invoiceMessages: next }, `Invoice message ${m.name} changed`);
    };
    name.addEventListener("change", save);
    text.addEventListener("change", save);
    const makeDefault = document.createElement("button");
    makeDefault.type = "button";
    makeDefault.className = "small";
    makeDefault.textContent = m.isDefault === true ? "The default" : "Make the default";
    makeDefault.disabled = m.isDefault === true;
    makeDefault.addEventListener("click", () => {
      const next = messages.map((x) => {
        const { isDefault: _d, ...rest } = x;
        return x.id === m.id ? { ...rest, isDefault: true } : rest;
      });
      void keep({ ...kept(), invoiceMessages: next }, `${m.name} is the default invoice message`);
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "small";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      void keep({ ...kept(), invoiceMessages: messages.filter((x) => x.id !== m.id) }, `Invoice message ${m.name} removed`);
    });
    const buttons = document.createElement("div");
    buttons.className = "migration-actions";
    buttons.append(makeDefault, remove);
    row.append(labelled("Name", name), labelled("Words", text));
    box.append(row, buttons);
  }
  const add = document.createElement("button");
  add.type = "button";
  add.textContent = "Add a message";
  add.addEventListener("click", () => {
    const made: InvoiceMessage = {
      id: `msg-${Date.now().toString(36)}`,
      name: messages.length === 0 ? "How to pay" : `Message ${messages.length + 1}`,
      text: "",
      // The first one is the default: a single saved message that was not would be forgotten.
      ...(messages.length === 0 ? { isDefault: true } : {}),
    };
    opened = true;
    void keep({ ...kept(), invoiceMessages: [...messages, made] }, "Invoice message added");
  });
  box.append(add);

  // --- email wording --------------------------------------------------------
  for (const kind of ["invoice", "statement", "reminder"] as const) {
    const own = state.ledger.emailWording?.[kind];
    const wording = own ?? DEFAULT_WORDING[kind];
    const head = document.createElement("h4");
    head.textContent = WORDING_NAMES[kind] + (own === undefined ? "" : " (your own wording)");
    const subject = document.createElement("input");
    subject.type = "text";
    subject.value = wording.subject;
    subject.size = 60;
    const text = document.createElement("textarea");
    text.rows = 8;
    text.value = wording.body;
    const save = (): void => {
      const mine = { subject: subject.value, body: text.value };
      const same = mine.subject === DEFAULT_WORDING[kind].subject && mine.body === DEFAULT_WORDING[kind].body;
      const { [kind]: _old, ...others } = state.ledger.emailWording ?? {};
      const next = same ? others : { ...others, [kind]: mine };
      void keep({ ...kept(), emailWording: next }, `${WORDING_NAMES[kind]} changed`);
    };
    subject.addEventListener("change", save);
    text.addEventListener("change", save);
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "small";
    reset.textContent = "Back to the standard wording";
    reset.disabled = own === undefined;
    reset.addEventListener("click", () => {
      const { [kind]: _old, ...others } = state.ledger.emailWording ?? {};
      void keep({ ...kept(), emailWording: others }, `${WORDING_NAMES[kind]} back to standard`);
    });
    const fields = document.createElement("div");
    fields.className = "invoice-fields";
    fields.append(labelled("Subject", subject), labelled("Message", text));
    box.append(
      head,
      fields,
      note(
        `Fill-ins: ${WORDING_FILL_INS[kind].map((f) => `{${f}}`).join(" ")}. A line whose fill-ins are empty is left out, ` +
          "so a message never goes with an empty \"Due:\".",
      ),
      reset,
    );
  }
  body.append(box);
}
