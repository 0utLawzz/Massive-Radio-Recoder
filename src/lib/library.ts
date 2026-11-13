export type TrackMark = {
  t: number;
  title: string;
};

export type TakeMeta = {
  id: string;
  stationId: string;
  stationName: string;
  trackTitle?: string;
  startedAt: number;
  endedAt: number;
  bytes: number;
  tracks: TrackMark[];
  mediaType?: "audio" | "video";
};

const DB_NAME = "massive-tape";
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("takes")) {
        db.createObjectStore("takes", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("blobs")) {
        db.createObjectStore("blobs", { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Couldn't open saved tapes."));
  });
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Saved tape request failed."));
  });
}

export async function listTakes(): Promise<TakeMeta[]> {
  const db = await openDb();
  try {
    const rows = await requestToPromise(db.transaction("takes", "readonly").objectStore("takes").getAll());
    return (rows as TakeMeta[]).sort((a, b) => b.startedAt - a.startedAt);
  } finally {
    db.close();
  }
}

export async function saveTake(meta: TakeMeta, blob: Blob): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(["takes", "blobs"], "readwrite");
    tx.objectStore("takes").put(meta);
    tx.objectStore("blobs").put({ id: meta.id, blob });
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Couldn't keep this tape."));
      tx.onabort = () => reject(tx.error ?? new Error("Couldn't keep this tape."));
    });
  } finally {
    db.close();
  }
}

export async function getTakeBlob(id: string): Promise<Blob | null> {
  const db = await openDb();
  try {
    const row = await requestToPromise(
      db.transaction("blobs", "readonly").objectStore("blobs").get(id) as IDBRequest<{ id: string; blob: Blob } | undefined>,
    );
    return row?.blob ?? null;
  } finally {
    db.close();
  }
}

export async function deleteTake(id: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(["takes", "blobs"], "readwrite");
    tx.objectStore("takes").delete(id);
    tx.objectStore("blobs").delete(id);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Couldn't delete this tape."));
      tx.onabort = () => reject(tx.error ?? new Error("Couldn't delete this tape."));
    });
  } finally {
    db.close();
  }
}
