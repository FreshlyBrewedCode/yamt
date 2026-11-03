import type { OutboxEntry, OutboxStore } from "./types";

/** For tests, and the fallback when IndexedDB is unavailable (then a reload loses the queue). */
export class MemoryStore implements OutboxStore {
  readonly map = new Map<string, OutboxEntry>();
  async all() {
    return [...this.map.values()];
  }
  async put(entry: OutboxEntry) {
    this.map.set(entry.id, entry);
  }
  async delete(id: string) {
    this.map.delete(id);
  }
}

const DB = "yamt";
const STORE = "outbox";

/**
 * The queue in IndexedDB (database `yamt`, store `outbox`, keyed by entry id). Blobs are stored
 * as they are (structured clone copies the bytes, so a photo picked from the library survives
 * the picker's temp file).
 */
export class IdbStore implements OutboxStore {
  private db: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE))
          req.result.createObjectStore(STORE, { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.db;
  }

  private async tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = run(t.objectStore(STORE));
      // resolve when the transaction is durable, not just when the request succeeded
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error ?? req.error);
      t.onabort = () => reject(t.error ?? new Error("IndexedDB transaction aborted"));
    });
  }

  all() {
    return this.tx("readonly", (s) => s.getAll() as IDBRequest<OutboxEntry[]>);
  }
  async put(entry: OutboxEntry) {
    await this.tx("readwrite", (s) => s.put(entry));
  }
  async delete(id: string) {
    await this.tx("readwrite", (s) => s.delete(id));
  }
}

/** IndexedDB if the browser lets us open it, else memory. */
export async function openStore(): Promise<OutboxStore> {
  try {
    const store = new IdbStore();
    await store.all();
    return store;
  } catch (e) {
    console.warn("IndexedDB unavailable; pending uploads won't survive a reload", e);
    return new MemoryStore();
  }
}
