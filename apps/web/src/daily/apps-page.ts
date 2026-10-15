import { redraw } from "../app.js";
import { modulesPanel } from "../modules.js";
import { $ } from "../state.js";

/**
 * Modules: every module these books can use, each turned on or off from here,
 * and opened. Turning one on puts its pages in the menu; turning it off only
 * hides them, and nothing in the books changes.
 */
export function renderApps(): void {
  const body = $("apps-body");
  body.textContent = "";
  body.append(modulesPanel(() => redraw("apps"), undefined, true));
}
