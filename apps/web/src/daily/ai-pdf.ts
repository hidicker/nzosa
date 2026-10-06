import { aiReadDocument, aiRoute, aiStatus } from "../ai-backend.js";
import { note } from "../ui.js";
import { PROVIDER_NAMES, detectProvider } from "@nzosa/core";

/**
 * Sending a PDF to be read from here, under the books' own key, once agreed to.
 *
 * Every PDF a model reads has two ways in: carry it with the prompt to a model
 * somebody already uses and paste the answer back, or -- with a key of their
 * own on this computer -- send it from here. This is the second. It is hidden
 * where there is no key, or only the shared one: a statement or a tax record
 * is not sent under somebody else's account.
 */
export function sendPdfWithOwnKey(options: {
  prompt: () => string;
  /** What is in the PDF, for the consent: "the IRD number and name". */
  contains: string;
  onAnswer: (text: string) => void;
}): HTMLElement {
  const wrap = document.createElement("div");
  wrap.hidden = true;
  if (aiRoute() !== "folder") return wrap;
  void aiStatus().then((status) => {
    if (status === null || !status.configured || status.sharedKey === true) return;
    if (detectProvider(status.key) === "jev") return;
    const provider = PROVIDER_NAMES[detectProvider(status.key)];
    const file = document.createElement("input");
    file.type = "file";
    file.accept = ".pdf,application/pdf";
    const agreeLabel = document.createElement("label");
    const agree = document.createElement("input");
    agree.type = "checkbox";
    agreeLabel.append(
      agree,
      ` Send the whole PDF -- ${options.contains} included -- to ${provider} under my key, to be ` +
        "read. It is not kept here.",
    );
    const go = document.createElement("button");
    go.type = "button";
    go.className = "primary";
    go.textContent = "Send it and read the answer";
    const said = document.createElement("span");
    said.className = "field-hint";
    const ready = (): void => {
      go.disabled = !agree.checked || (file.files?.length ?? 0) === 0;
    };
    agree.addEventListener("change", ready);
    file.addEventListener("change", ready);
    ready();
    go.addEventListener("click", () => {
      const chosen = file.files?.[0];
      if (chosen === undefined) return;
      go.disabled = true;
      said.textContent = ` Asking ${provider}…`;
      void aiReadDocument(options.prompt(), chosen).then((answer) => {
        if (answer === null || answer.error !== undefined || answer.text === undefined) {
          said.textContent = ` ${answer?.error ?? "It could not be sent from here."}`;
          go.disabled = false;
          return;
        }
        options.onAnswer(answer.text);
      });
    });
    wrap.append(note(`Or, with your own ${provider} key on this computer, send the PDF from here:`), file, agreeLabel, go, said);
    wrap.hidden = false;
  });
  return wrap;
}

/** "Copy the prompt", and the prompt itself folded away beneath it. */
export function promptControls(prompt: () => string): HTMLElement[] {
  const actions = document.createElement("div");
  actions.className = "page-actions";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = "Copy the prompt";
  const copied = document.createElement("span");
  copied.className = "field-hint";
  copy.addEventListener("click", () => {
    void navigator.clipboard
      .writeText(prompt())
      .then(() => {
        copied.textContent = " Copied.";
      })
      .catch(() => {
        copied.textContent = " Could not copy; open the prompt below and copy it by hand.";
      });
  });
  actions.append(copy, copied);
  const shown = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "Show the prompt";
  const pre = document.createElement("pre");
  pre.className = "ai-prompt";
  pre.textContent = prompt();
  shown.append(summary, pre);
  return [actions, shown];
}
