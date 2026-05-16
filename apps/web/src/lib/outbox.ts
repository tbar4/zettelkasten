import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export interface OutboxRecord {
  id?: number;
  kind: "fleeting-note";
  body: { title: string; body_md?: string };
  createdAt: string;
}

interface OutboxDB extends DBSchema {
  pending: {
    key: number;
    value: OutboxRecord;
    indexes: Record<string, never>;
  };
}

let dbPromise: Promise<IDBPDatabase<OutboxDB>> | null = null;

function getDb(): Promise<IDBPDatabase<OutboxDB>> {
  if (!dbPromise) {
    dbPromise = openDB<OutboxDB>("zk-outbox", 1, {
      upgrade(db) {
        db.createObjectStore("pending", {
          keyPath: "id",
          autoIncrement: true
        });
      }
    });
  }
  return dbPromise;
}

export async function enqueueNote(payload: {
  title: string;
  body_md?: string;
}): Promise<void> {
  const db = await getDb();
  const record: OutboxRecord = {
    kind: "fleeting-note",
    body: { title: payload.title, body_md: payload.body_md },
    createdAt: new Date().toISOString()
  };
  await db.add("pending", record);
}

export async function listPending(): Promise<OutboxRecord[]> {
  const db = await getDb();
  return db.getAll("pending");
}

export async function markFlushed(id: number): Promise<void> {
  const db = await getDb();
  await db.delete("pending", id);
}

export async function clearAll(): Promise<void> {
  const db = await getDb();
  await db.clear("pending");
}

/** Reset singleton (for testing only) */
export function _resetDb(): void {
  dbPromise = null;
}
