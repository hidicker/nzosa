import { deleteCloudFile, getCloudFile, putCloudFile } from "./cloud.js";
import { backendKind, openCloudBookId } from "./store.js";

/**
 * Where an attached file's bytes are kept: wherever the books are.
 *
 *   folder   the books' folder, in attachments/, through the local server
 *   browser  this browser's own storage, beside the books
 *   cloud    private storage online, under the books' id
 *
 * The books hold what each file is; this only puts, gets and removes bytes.
 */

const DB = "nzosa-files";
const STORE = "files";

function openFiles(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function inBrowser<T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openFiles();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = act(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

/** Keep a file's bytes. False when they could not be kept. */
export async function putFile(id: string, file: Blob): Promise<boolean> {
  try {
    const where = backendKind();
    if (where === "folder") {
      const response = await fetch(`/api/attachments/${id}`, { method: "PUT", body: file, headers: { "content-type": "application/octet-stream" } });
      return response.ok;
    }
    if (where === "cloud") return await putCloudFile(openCloudBookId(), id, file);
    await inBrowser("readwrite", (store) => store.put(file, id));
    return true;
  } catch {
    return false;
  }
}

/** A file's bytes, typed as given, or null when they are not there. */
export async function getFile(id: string, type: string): Promise<Blob | null> {
  try {
    const where = backendKind();
    let bytes: Blob | null | undefined;
    if (where === "folder") {
      const response = await fetch(`/api/attachments/${id}`);
      bytes = response.ok ? await response.blob() : null;
    } else if (where === "cloud") {
      bytes = await getCloudFile(openCloudBookId(), id);
    } else {
      bytes = await inBrowser<Blob | undefined>("readonly", (store) => store.get(id));
    }
    return bytes === null || bytes === undefined ? null : new Blob([bytes], { type });
  } catch {
    return null;
  }
}

/** Remove a file's bytes. */
export async function deleteFile(id: string): Promise<void> {
  try {
    const where = backendKind();
    if (where === "folder") await fetch(`/api/attachments/${id}`, { method: "DELETE" });
    else if (where === "cloud") await deleteCloudFile(openCloudBookId(), id);
    else await inBrowser("readwrite", (store) => store.delete(id));
  } catch {
    // Left behind: it is named by an id nothing points at any more.
  }
}
