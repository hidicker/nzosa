/**
 * A text box that filters a long list as you type, and refuses anything that is
 * not on it.
 *
 * The chart runs to a hundred accounts, and picking one from a native select
 * means scrolling a list ordered by code rather than by what you are looking
 * for. Typing "sal" should offer Salaries and Sales.
 *
 * The typed text is never the answer. `value` returns only a code that was
 * actually chosen, so a half-typed or misspelt entry codes nothing rather than
 * inventing an account -- the same reason nothing here confirms a line on the
 * user's behalf.
 */
export interface Combobox {
  readonly element: HTMLElement;
  readonly value: string;
  /**
   * Empty the box, keeping the options.
   *
   * For a picker that gathers rather than decides: one payment settling several
   * invoices takes each choice in turn, and the box has to be ready for the
   * next one without being rebuilt and losing focus.
   */
  clear(): void;
}

export function combobox(
  options: readonly string[],
  initial: string | null,
  placeholder: string,
  /**
   * Called whenever the chosen value changes.
   *
   * For a caller whose other controls depend on the choice -- gathering several
   * invoices against one payment shows a running total and a way to add
   * another, and both are wrong until the box says what was picked.
   */
  onChange: () => void = () => {},
): Combobox {
  let chosen = initial ?? "";
  let active = -1;

  const wrap = document.createElement("div");
  wrap.className = "combo";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "combo-input";
  input.placeholder = placeholder;
  input.value = chosen;
  input.autocomplete = "off";
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-autocomplete", "list");

  const list = document.createElement("div");
  list.className = "combo-list";
  list.setAttribute("role", "listbox");
  list.hidden = true;

  /** Prefix matches first: typing "sal" wants Salaries before Loss on sale. */
  function ranked(query: string): string[] {
    const q = query.trim().toLowerCase();
    if (q === "") return [...options];
    const starts: string[] = [];
    const within: string[] = [];
    for (const option of options) {
      const lower = option.toLowerCase();
      const at = lower.indexOf(q);
      if (at < 0) continue;
      // A code is "470 - Salaries", so a word start counts as a prefix.
      if (at === 0 || /[^a-z0-9]/.test(lower[at - 1] ?? "")) starts.push(option);
      else within.push(option);
    }
    return [...starts, ...within];
  }

  function close(): void {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    active = -1;
  }

  function pick(option: string): void {
    chosen = option;
    input.value = option;
    close();
    onChange();
  }

  function draw(query: string): void {
    const matches = ranked(query);
    list.textContent = "";
    if (matches.length === 0) {
      const empty = document.createElement("div");
      empty.className = "combo-empty";
      empty.textContent = "No account matches";
      list.append(empty);
    }
    matches.forEach((option, index) => {
      const row = document.createElement("div");
      row.className = index === active ? "combo-option on" : "combo-option";
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(option === chosen));
      row.textContent = option;
      // mousedown, not click: blur fires first on click and closes the list
      // before the click lands, so nothing would ever be selected.
      row.addEventListener("mousedown", (event) => {
        event.preventDefault();
        pick(option);
      });
      list.append(row);
    });
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }

  input.addEventListener("focus", () => {
    active = -1;
    draw("");
    input.select();
  });
  input.addEventListener("input", () => {
    active = -1;
    draw(input.value);
  });
  input.addEventListener("blur", () => {
    // Leaving a half-typed account reverts to the last real choice rather than
    // silently keeping text that means nothing.
    input.value = chosen;
    close();
  });
  input.addEventListener("keydown", (event) => {
    const key = event.key;
    const matches = ranked(list.hidden ? "" : input.value);
    if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault();
      if (list.hidden) {
        draw(input.value);
        return;
      }
      active += key === "ArrowDown" ? 1 : -1;
      if (active < 0) active = matches.length - 1;
      if (active >= matches.length) active = 0;
      draw(input.value);
      list.querySelector(".combo-option.on")?.scrollIntoView({ block: "nearest" });
      return;
    }
    if (key === "Enter") {
      const match = matches[active] ?? (matches.length === 1 ? matches[0] : undefined);
      if (match !== undefined) {
        event.preventDefault();
        pick(match);
      }
      return;
    }
    if (key === "Escape" && !list.hidden) {
      event.preventDefault();
      event.stopPropagation();
      input.value = chosen;
      close();
    }
  });

  wrap.append(input, list);
  return {
    element: wrap,
    get value() {
      return chosen;
    },
    clear() {
      chosen = "";
      input.value = "";
      close();
      onChange();
    },
  };
}
