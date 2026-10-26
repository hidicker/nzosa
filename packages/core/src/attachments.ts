/**
 * Files attached to what is in the books: a supplier's bill as it came, the
 * receipt for a petty cash line, a contract on a contact, the workings behind
 * a journal.
 *
 * The books keep what each file is -- its name, type, size and what it
 * belongs to. The file itself is kept where the books are kept: in the
 * books' folder, in the browser, or in private storage for books online.
 */

/** What a file is attached to. `id` is the document's `kind:number`, a journal's, contact's or line's id. */
export interface AttachmentOwner {
  kind: "document" | "journal" | "contact" | "line";
  id: string;
}

export interface Attachment {
  /** Also the stored file's name. Letters, digits and hyphens only. */
  id: string;
  owner: AttachmentOwner;
  name: string;
  /** Its media type, as the browser gave it. */
  type: string;
  size: number;
  /** When it was attached. */
  added: string;
}

/** The largest file that can be attached, in bytes. */
export const ATTACHMENT_LIMIT = 10 * 1024 * 1024;

/** The key a document's attachments are kept under: its kind and number, as numbers repeat across kinds. */
export function documentOwner(kind: string, number: string): AttachmentOwner {
  return { kind: "document", id: `${kind}:${number}` };
}

const sameOwner = (a: AttachmentOwner, b: AttachmentOwner): boolean => a.kind === b.kind && a.id === b.id;

/** A thing's attachments, oldest first. */
export function attachmentsOf(all: readonly Attachment[] | undefined, owner: AttachmentOwner): Attachment[] {
  return (all ?? []).filter((a) => sameOwner(a.owner, owner)).sort((a, b) => a.added.localeCompare(b.added));
}

/** What is wrong with a file to attach, in words, or null. */
export function attachmentProblem(file: { name: string; size: number }): string | null {
  if (file.size === 0) return `${file.name} is empty.`;
  if (file.size > ATTACHMENT_LIMIT) return `${file.name} is ${sizeWords(file.size)}; a file of 10 MB or less can be attached.`;
  return null;
}

/** A file's size as a person says it. */
export function sizeWords(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A new attachment's id: random, and safe as a file name anywhere. */
export function newAttachmentId(random: () => number = Math.random): string {
  const part = (): string => Math.floor(random() * 0x100000000).toString(16).padStart(8, "0");
  return `att-${part()}${part()}`;
}

/**
 * The attachments when what they belong to is given a new key: a document
 * renumbered, a bank line's id changed. Others are left as they were.
 */
export function moveAttachments(all: readonly Attachment[], from: AttachmentOwner, to: AttachmentOwner): Attachment[] {
  return all.map((a) => (sameOwner(a.owner, from) ? { ...a, owner: to } : a));
}
