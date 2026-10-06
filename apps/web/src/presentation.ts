import { state } from "./state.js";
import { emptyEntityModel, isValidIrdNumber } from "@nzosa/core";

/**
 * Presentation mode: the books on screen with what identifies people masked,
 * for recording a video or sharing a screen.
 *
 * Only what is shown changes. Text already drawn is rewritten as it appears,
 * and boxes holding a number are shown as dots; nothing is saved, no state is
 * touched, and turning it off and redrawing brings everything back. It is
 * kept in this browser, not in the books, so it never travels with them.
 *
 *   IRD numbers        123-456-789  ->  •••-•••-789
 *   Bank accounts      02-1234-0056789-05  ->  02-••••-•••••••-05
 *   People's names     the books' owners, shareholders, employees and
 *                      tenants -> initials
 *   Amounts            on the Reports page -> $###
 */

const KEY = "nzosa:presentation";

export function presenting(): boolean {
  try {
    return localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
}

const IRD_FORMATTED = /\b(\d{2,3})-(\d{3})-(\d{3})\b/g;
const BANK = /\b(\d{2})-(\d{4})-(\d{7})-(\d{2,3})\b/g;
const BARE_DIGITS = /\b\d{8,9}\b/g;
const BANK_RUN = /\b\d{15,16}\b/g;
/** Money as reports write it: grouped thousands, cents, or a dollar sign. */
const MONEY = /\(?-?\$?(?:\d{1,3}(?:,\d{3})+(?:\.\d{1,4})?|\d+\.\d{2,4})\)?|\$\d+/g;

/** Everyone the books name who is a person, longest first, with their initials. */
function people(): { name: RegExp; initials: string }[] {
  const model = state.ledger.entities ?? emptyEntityModel();
  const names = new Set<string>();
  for (const entity of model.entities) {
    if (entity.kind === "personal") names.add(entity.name);
    for (const owner of entity.owners ?? []) names.add(owner.name);
    for (const holder of entity.shareholders ?? []) names.add(holder.name);
  }
  for (const employee of state.ledger.payroll?.employees ?? []) names.add(employee.name);
  for (const tenancy of state.ledger.tenancies ?? []) if (tenancy.tenant) names.add(tenancy.tenant);
  const out: { name: RegExp; initials: string }[] = [];
  const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const initial = (word: string): string => `${word.charAt(0).toUpperCase()}.`;
  for (const full of [...names].map((n) => n.trim()).filter((n) => n.length > 2)) {
    const words = full.split(/\s+/);
    out.push({ name: new RegExp(`\\b${escape(full)}\\b`, "gi"), initials: words.map(initial).join(" ") });
    // Each part on its own too. Five letters or more anywhere, even run into
    // another word as bank descriptions do ("smithJones"); shorter ones only
    // as a whole word, and a short surname not at all -- too often an
    // ordinary word ("Park", "Day").
    if (words.length > 1) {
      words.forEach((word, index) => {
        if (word.length >= 5) out.push({ name: new RegExp(escape(word), "gi"), initials: initial(word) });
        else if (index === 0 && word.length > 2) out.push({ name: new RegExp(`\\b${escape(word)}\\b`, "gi"), initials: initial(word) });
      });
    }
  }
  return out.sort((a, b) => b.name.source.length - a.name.source.length);
}

let names: { name: RegExp; initials: string }[] = [];

function mask(text: string, inReports: boolean, amountCell: boolean): string {
  let out = text
    .replace(BANK, (_m, bank: string, _b, _a, suffix: string) => `${bank}-••••-•••••••-${suffix}`)
    .replace(IRD_FORMATTED, (_m, _a, _b, last: string) => `•••-•••-${last}`)
    .replace(BARE_DIGITS, (m) => (isValidIrdNumber(m) ? `••••••${m.slice(-3)}` : m))
    .replace(BANK_RUN, (m) => `${m.slice(0, 2)}•••••••••••${m.slice(-2)}`);
  for (const { name, initials } of names) out = out.replace(name, initials);
  if (amountCell) out = out.replace(/[\d,.]+/g, (m) => (/\d/.test(m) ? "###" : m));
  else if (inReports) out = out.replace(MONEY, "$###");
  return out;
}

function inside(node: Node, selector: string): boolean {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return element?.closest(selector) !== null && element?.closest(selector) !== undefined;
}

function maskText(node: Text): void {
  const before = node.data;
  if (before.trim() === "") return;
  if (inside(node, "script, style, textarea, .presentation-toggle")) return;
  const inReports = inside(node, "#page-reports");
  const amountCell = inReports && inside(node, ".report-amount, td.amount, .amt");
  const after = mask(before, inReports, amountCell);
  if (after !== before) node.data = after;
}

/** Boxes holding an IRD or bank number are shown as dots; their value stays. */
function maskInput(input: HTMLInputElement): void {
  const value = input.value;
  const sensitive =
    /\d{2,3}-\d{3}-\d{3}/.test(value) || /\d{2}-\d{4}-\d{7}-\d{2,3}/.test(value) || (/^\d{8,9}$/.test(value.replace(/\D/g, "")) && isValidIrdNumber(value));
  input.classList.toggle("presentation-masked", sensitive);
}

function sweep(root: Node): void {
  if (root.nodeType === Node.TEXT_NODE) {
    maskText(root as Text);
    return;
  }
  if (!(root instanceof Element)) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) maskText(node as Text);
  for (const input of root.querySelectorAll<HTMLInputElement>("input[type=text], input:not([type])")) maskInput(input);
  if (root instanceof HTMLInputElement) maskInput(root);
}

let observer: MutationObserver | null = null;

function start(): void {
  names = people();
  document.documentElement.classList.add("presenting");
  sweep(document.body);
  observer?.disconnect();
  observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "characterData") maskText(record.target as Text);
      for (const added of record.addedNodes) sweep(added);
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  document.addEventListener("input", onInput, true);
}

function onInput(event: Event): void {
  if (event.target instanceof HTMLInputElement) maskInput(event.target);
}

function stop(): void {
  observer?.disconnect();
  observer = null;
  document.removeEventListener("input", onInput, true);
  document.documentElement.classList.remove("presenting");
  for (const input of document.querySelectorAll(".presentation-masked")) input.classList.remove("presentation-masked");
}

function sync(button: HTMLButtonElement): void {
  const on = presenting();
  button.setAttribute("aria-pressed", String(on));
  button.textContent = on ? "Presenting" : "Present";
  button.title = on
    ? "Presentation mode is on: IRD and bank numbers, people's names and report amounts are masked on screen. Click (or Ctrl+Shift+P) to show everything again."
    : "Presentation mode: mask IRD and bank numbers, people's names and report amounts on screen, for recording or sharing. Nothing in the books changes. (Ctrl+Shift+P)";
}

/**
 * The switch in the top bar, and Ctrl+Shift+P. Turning it off reloads the
 * page, which redraws every figure from the books as it really is.
 */
export function wirePresentation(): void {
  const bar = document.querySelector(".topbar");
  if (bar === null) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "presentation-toggle";
  const toggle = (): void => {
    const on = !presenting();
    try {
      localStorage.setItem(KEY, on ? "on" : "off");
    } catch {
      // Storage refused: presentation mode cannot be kept; leave it off.
      return;
    }
    if (on) {
      start();
      sync(button);
    } else {
      stop();
      location.reload();
    }
  };
  button.addEventListener("click", toggle);
  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey && event.shiftKey && (event.key === "P" || event.key === "p")) {
      event.preventDefault();
      toggle();
    }
  });
  bar.append(button);
  sync(button);
  if (presenting()) start();
}

/**
 * People's names change as books load and entities are edited: work them out
 * again, and go over the page once more only if they changed.
 */
let namesSaid = "";
export function refreshPresentation(): void {
  if (!presenting()) return;
  const next = people();
  const said = next.map((n) => n.name.source).join("|");
  if (said === namesSaid) return;
  namesSaid = said;
  names = next;
  sweep(document.body);
}
