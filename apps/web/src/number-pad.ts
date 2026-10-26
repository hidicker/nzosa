/**
 * Typing figures from a number pad, as somebody entering a pile of paper does:
 * Enter goes on to the next box, and an amount typed without a point has one
 * put in two places from the end -- 1234 is 12.34. Each is a setting, kept on
 * this device, off until turned on.
 */

const ENTER_KEY = "nzosa.enterNext";
const DECIMAL_KEY = "nzosa.autoDecimal";

function setting(key: string): boolean {
  try {
    return localStorage.getItem(key) === "yes";
  } catch {
    return false;
  }
}

function setSetting(key: string, on: boolean): void {
  try {
    if (on) localStorage.setItem(key, "yes");
    else localStorage.removeItem(key);
  } catch {
    // Not kept; it lasts until the page is reloaded only through the box.
  }
}

/** The boxes Enter moves between: the forms where figures are typed. */
const FORMS = ".invoice-editor, .journal-editor, .split-editor, .register-entry, .payroll-card, .contact-form";

/** An amount box, where a missing point is put in. */
function isAmount(el: Element): el is HTMLInputElement {
  return (
    el instanceof HTMLInputElement &&
    el.type === "text" &&
    (el.inputMode === "decimal" || el.classList.contains("invoice-amount") || el.classList.contains("split-amount") || el.classList.contains("line-gross"))
  );
}

/** "1234" as "12.34", "-50" as "-0.50"; anything with a point, or not a whole number, as it was. */
export function withPoint(text: string): string {
  const said = text.trim();
  if (!/^-?\d+$/.test(said)) return text;
  const negative = said.startsWith("-");
  const digits = (negative ? said.slice(1) : said).padStart(3, "0");
  const whole = digits.slice(0, -2).replace(/^0+(?=\d)/, "");
  return `${negative ? "-" : ""}${whole}.${digits.slice(-2)}`;
}

export function wireNumberPad(): void {
  // Before the page's own handlers read the figure, the point goes in.
  document.addEventListener(
    "change",
    (event) => {
      if (!setting(DECIMAL_KEY)) return;
      const el = event.target;
      if (!(el instanceof Element) || !isAmount(el)) return;
      const next = withPoint(el.value);
      if (next === el.value) return;
      el.value = next;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    true,
  );

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing || event.defaultPrevented || !setting(ENTER_KEY)) return;
    if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
    const el = event.target;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement)) return;
    if (el instanceof HTMLInputElement && (el.type === "search" || el.type === "checkbox" || el.type === "file")) return;
    // A picker with its list open uses Enter to choose.
    if (el.getAttribute("aria-expanded") === "true") return;
    const form = el.closest(FORMS);
    if (form === null) return;
    const boxes = [...form.querySelectorAll<HTMLElement>("input, select, textarea")].filter(
      (b) => !(b as HTMLInputElement).disabled && b.offsetParent !== null && (b as HTMLInputElement).type !== "hidden" && (b as HTMLInputElement).type !== "file",
    );
    const at = boxes.indexOf(el);
    const next = boxes[at + 1];
    if (at < 0 || next === undefined) return;
    event.preventDefault();
    // An amount finished with Enter gets its point too, as leaving it would.
    if (isAmount(el)) el.dispatchEvent(new Event("change", { bubbles: true }));
    next.focus();
    if (next instanceof HTMLInputElement) next.select();
  });
}

/** The two settings, as boxes to tick, for the Setup page. */
export function numberPadSettings(): HTMLElement {
  const box = document.createElement("div");
  box.className = "setup-typing";
  const heading = document.createElement("h3");
  heading.textContent = "Typing figures";
  box.append(heading);
  const tick = (key: string, label: string, hint: string): void => {
    const wrap = document.createElement("label");
    wrap.className = "checkbox";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = setting(key);
    input.addEventListener("change", () => setSetting(key, input.checked));
    const small = document.createElement("small");
    small.textContent = ` ${hint}`;
    wrap.append(input, ` ${label}`, small);
    const p = document.createElement("p");
    p.append(wrap);
    box.append(p);
  };
  tick(ENTER_KEY, "Enter moves to the next box", "In invoices, bills, journals, splits, the register, contacts and payroll, as Tab does.");
  tick(DECIMAL_KEY, "Put the decimal point in for me", "An amount typed without one has it put two places from the end: 1234 is 12.34.");
  const said = document.createElement("p");
  said.className = "page-hint";
  said.textContent = "Kept on this device, for whoever uses it.";
  box.append(said);
  return box;
}
