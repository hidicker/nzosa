import { record } from "./books.js";
import { state } from "./state.js";
import { attachmentsKeptHere, booksReadOnly, getAttachmentFile, putAttachmentFile, savePart } from "./store.js";
import type { Attachment } from "./store.js";
import { askOnPage, tellOnPage } from "./ui.js";

/**
 * Files attached to a document -- the receipt for a bank line, the bill as it
 * arrived, a contract beside a contact -- shown where the document is, with a
 * way to open each and to attach another.
 *
 * Only which file belongs to which document is kept with the books; the bytes
 * are kept apart by the store: in the books' folder, this browser, or for
 * books online in their Storage bucket. Removing
 * a file takes it off the document and leaves the bytes, so History can put
 * it back.
 */

/** The largest file taken. */
export const ATTACHMENT_MAX_BYTES = 10_000_000;

function held(): Attachment[] {
  return state.ledger.attachments ?? [];
}

async function keep(next: Attachment[], what: string): Promise<void> {
  const before = held();
  state.ledger = { ...state.ledger, attachments: next };
  state.persistent = await savePart(state.ledger);
  await record("attachments", what, before, next);
}

function sizeSaid(bytes: number): string {
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

/** A file's bytes as base64, without the data: prefix. */
function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      resolve(text.slice(text.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function openFile(one: Attachment): Promise<void> {
  const file = await getAttachmentFile(one.id);
  if (file === null) {
    await tellOnPage(`${one.name} is not where these books keep their files. It may have been attached on another computer, or in another browser.`);
    return;
  }
  const bytes = Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: file.type }));
  // Opened beside the books; saved under its own name where the browser cannot show it.
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener";
  if (!/^(image\/|application\/pdf|text\/plain)/.test(file.type)) link.download = one.name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** The attachments box for one document. Draws itself again in place after a change. */
export function attachmentsBox(to: Attachment["to"], what: string): HTMLElement {
  const box = document.createElement("div");
  box.className = "attachments";
  const draw = (): void => {
    box.textContent = "";
    const mine = held().filter((a) => a.to.kind === to.kind && a.to.id === to.id);
    const title = document.createElement("span");
    title.className = "k-block";
    title.textContent = mine.length === 0 ? "Attachments" : `Attachments (${mine.length})`;
    box.append(title);
    for (const one of mine) {
      const row = document.createElement("div");
      const open = document.createElement("button");
      open.type = "button";
      open.className = "small";
      open.textContent = one.name;
      open.title = `${sizeSaid(one.size)}, attached ${one.addedAt.slice(0, 10)}`;
      open.addEventListener("click", () => void openFile(one));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "small";
      remove.textContent = "Remove";
      remove.hidden = booksReadOnly();
      remove.addEventListener("click", async () => {
        if (!(await askOnPage(`Take ${one.name} off ${what}? History can put it back.`, "Take it off"))) return;
        await keep(held().filter((a) => a.id !== one.id), `${one.name} taken off ${what}`);
        draw();
      });
      row.append(open, " ", remove);
      box.append(row);
    }
    // Somebody who may only read these books opens what is attached, and adds nothing.
    if (booksReadOnly()) return;
    if (!attachmentsKeptHere()) {
      const said = document.createElement("p");
      said.className = "page-hint";
      said.textContent = "These books cannot keep files here. Put the file in your own Drive or Dropbox and keep its link instead.";
      box.append(said);
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.hidden = true;
    input.accept = "image/*,application/pdf,.pdf,.csv,.txt,.xlsx,.xls,.doc,.docx";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (file === undefined) return;
      if (file.size > ATTACHMENT_MAX_BYTES) {
        await tellOnPage(`${file.name} is ${sizeSaid(file.size)}; files of up to ${sizeSaid(ATTACHMENT_MAX_BYTES)} are kept.`);
        return;
      }
      const id = `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const type = /^[\w.+-]+\/[\w.+-]+$/.test(file.type) ? file.type : "application/octet-stream";
      try {
        await putAttachmentFile(id, type, await readBase64(file));
      } catch (error) {
        await tellOnPage(error instanceof Error ? error.message : "The file could not be kept.");
        return;
      }
      const made: Attachment = { id, name: file.name, type, size: file.size, addedAt: new Date().toISOString(), to };
      await keep([...held(), made], `${file.name} attached to ${what}`);
      draw();
    });
    const add = document.createElement("button");
    add.type = "button";
    add.className = "small";
    add.textContent = "Attach a file…";
    add.addEventListener("click", () => input.click());
    box.append(input, add);
  };
  draw();
  return box;
}
