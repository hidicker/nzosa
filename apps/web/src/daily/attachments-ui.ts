import { record } from "../books.js";
import { deleteFile, getFile, putFile } from "../files.js";
import { state } from "../state.js";
import { save } from "../store.js";
import { askOnPage, tellOnPage } from "../ui.js";
import { attachmentProblem, attachmentsOf, newAttachmentId, sizeWords } from "@nzosa/core";
import type { Attachment, AttachmentOwner } from "@nzosa/core";

/**
 * The files attached to one thing -- a document, a journal, a contact, a
 * register line -- with a way to add more (chosen, or dropped on the box),
 * open one, and remove one.
 */
export function attachmentsControl(owner: AttachmentOwner, what: string): HTMLElement {
  const box = document.createElement("div");
  box.className = "attachments";
  const draw = (): void => {
    box.textContent = "";
    const heading = document.createElement("div");
    heading.className = "attachments-head";
    const title = document.createElement("span");
    title.textContent = "Files";
    const picker = document.createElement("input");
    picker.type = "file";
    picker.multiple = true;
    picker.hidden = true;
    picker.addEventListener("change", () => {
      void attach([...(picker.files ?? [])]);
    });
    const add = document.createElement("button");
    add.type = "button";
    add.className = "small";
    add.textContent = "Attach a file";
    add.title = `A file of 10 MB or less, kept with ${what}. Or drop files here.`;
    add.addEventListener("click", () => picker.click());
    heading.append(title, add, picker);
    box.append(heading);

    const files = attachmentsOf(state.ledger.attachments, owner);
    if (files.length === 0) {
      const none = document.createElement("p");
      none.className = "attachments-none";
      none.textContent = "None yet. Drop a file here, or attach one.";
      box.append(none);
      return;
    }
    const list = document.createElement("ul");
    list.className = "attachments-list";
    for (const file of files) {
      const item = document.createElement("li");
      const open = document.createElement("button");
      open.type = "button";
      open.className = "link-button";
      open.textContent = file.name;
      open.title = "Open";
      open.addEventListener("click", () => void openAttachment(file));
      const size = document.createElement("span");
      size.className = "attachments-size";
      size.textContent = sizeWords(file.size);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "small remove";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => void removeAttachment(file, what).then(draw));
      item.append(open, " ", size, " ", remove);
      list.append(item);
    }
    box.append(list);
  };

  async function attach(chosen: File[]): Promise<void> {
    if (chosen.length === 0) return;
    const added: Attachment[] = [];
    const refused: string[] = [];
    for (const file of chosen) {
      const problem = attachmentProblem(file);
      if (problem !== null) {
        refused.push(problem);
        continue;
      }
      const id = newAttachmentId();
      if (!(await putFile(id, file))) {
        refused.push(`${file.name} could not be kept here.`);
        continue;
      }
      added.push({ id, owner, name: file.name, type: file.type || "application/octet-stream", size: file.size, added: new Date().toISOString() });
    }
    if (added.length > 0) {
      const before = state.ledger.attachments ?? [];
      const after = [...before, ...added];
      const was = state.ledger;
      state.ledger = { ...state.ledger, attachments: after };
      try {
        state.persistent = await save(state.ledger);
      } catch (error) {
        state.ledger = was;
        for (const a of added) await deleteFile(a.id);
        refused.push(error instanceof Error ? error.message : String(error));
        added.length = 0;
      }
      if (added.length > 0) {
        await record("attachments", `Attached ${added.map((a) => a.name).join(", ")} to ${what}`, before, after, `${owner.kind}:${owner.id}`);
      }
    }
    draw();
    if (refused.length > 0) await tellOnPage(refused.join("\n"));
  }

  box.addEventListener("dragover", (event) => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    box.classList.add("attachments-over");
  });
  box.addEventListener("dragleave", () => box.classList.remove("attachments-over"));
  box.addEventListener("drop", (event) => {
    if (!event.dataTransfer?.files.length) return;
    event.preventDefault();
    // A drop here is an attachment, not a file for the page's importer.
    event.stopPropagation();
    box.classList.remove("attachments-over");
    void attach([...event.dataTransfer.files]);
  });
  draw();
  return box;
}

async function removeAttachment(file: Attachment, what: string): Promise<void> {
  if (!(await askOnPage(`Remove ${file.name} from ${what}? The file is deleted, and cannot be brought back from History.`, "Remove"))) return;
  const before = state.ledger.attachments ?? [];
  const after = before.filter((a) => a.id !== file.id);
  const was = state.ledger;
  state.ledger = { ...state.ledger, attachments: after };
  try {
    state.persistent = await save(state.ledger);
  } catch (error) {
    state.ledger = was;
    await tellOnPage(error instanceof Error ? error.message : String(error));
    return;
  }
  await deleteFile(file.id);
  await record("attachments", `Removed ${file.name} from ${what}`, before, after, `${file.owner.kind}:${file.owner.id}`);
}

/** Open a file: shown on the page where a browser can show it, saved otherwise. */
export async function openAttachment(file: Attachment): Promise<void> {
  const blob = await getFile(file.id, file.type);
  if (blob === null) {
    await tellOnPage(`${file.name} is not kept here any more. Attach it again if it is wanted.`);
    return;
  }
  const url = URL.createObjectURL(blob);
  const shown = /^image\/|^application\/pdf$|^text\/plain$/.test(file.type);
  if (!shown) {
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return;
  }
  const box = document.createElement("dialog");
  box.className = "ask-on-page payslip-view";
  const view = file.type.startsWith("image/") ? document.createElement("img") : document.createElement("iframe");
  view.className = file.type.startsWith("image/") ? "attachment-image" : "payslip-frame";
  if (view instanceof HTMLImageElement) view.alt = file.name;
  else view.title = file.name;
  view.src = url;
  const actions = document.createElement("div");
  actions.className = "ask-on-page-actions";
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Close";
  const keep = document.createElement("button");
  keep.type = "button";
  keep.className = "primary";
  keep.textContent = "Save a copy";
  actions.append(close, keep);
  box.append(view, actions);
  const finish = (): void => {
    box.close();
    box.remove();
    URL.revokeObjectURL(url);
  };
  close.addEventListener("click", finish);
  box.addEventListener("cancel", (event) => {
    event.preventDefault();
    finish();
  });
  keep.addEventListener("click", () => {
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    link.click();
  });
  document.body.append(box);
  box.showModal();
  close.focus();
}
