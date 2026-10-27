// ─── Tiny IndexedDB wrapper: projects survive refreshes ─────────────────────

const DB_NAME = 'lumina-studio';
const VERSION = 1;
export const STORES = ['blobs', 'photos', 'projects', 'presets', 'luts', 'aimaps', 'meta'] as const;
export type StoreName = (typeof STORES)[number];

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    if (typeof indexedDB === 'undefined') return rej(new Error('IndexedDB unavailable'));
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  dbp.catch(() => (dbp = null));
  return dbp;
}

function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((res, rej) => {
        const t = db.transaction(store, mode);
        const r = fn(t.objectStore(store));
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      }),
  );
}

export const db = {
  get: <T>(store: StoreName, key: string) => tx<T | undefined>(store, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>).catch(() => undefined),
  put: (store: StoreName, key: string, value: unknown) => tx(store, 'readwrite', (s) => s.put(value, key)).catch((e) => console.warn('save failed', e)),
  del: (store: StoreName, key: string) => tx(store, 'readwrite', (s) => s.delete(key)).catch(() => undefined),
  all: <T>(store: StoreName) => tx<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>).catch(() => [] as T[]),
  keys: (store: StoreName) => tx<IDBValidKey[]>(store, 'readonly', (s) => s.getAllKeys()).catch(() => [] as IDBValidKey[]),
};

/**
 * Save an original file and confirm it really landed. Images are copied into memory first, so a
 * file that can't be read (e.g. a cloud-only Google Photos item) fails here instead of leaving a
 * library entry with no original. Throws a user-facing message on failure.
 */
export async function storeBlob(id: string, f: Blob, copy = true): Promise<Blob> {
  const name = (f as File).name || 'the file';
  let data: Blob = f;
  if (copy) {
    try {
      data = new Blob([await f.arrayBuffer()], { type: f.type });
    } catch {
      throw new Error(`Couldn't read ${name}. If it's in Google Photos or cloud storage, download it to your phone first.`);
    }
  }
  if (!data.size) throw new Error(`${name} is empty or still downloading.`);
  try {
    await tx('blobs', 'readwrite', (s) => s.put(data, id));
  } catch {
    throw new Error(`Couldn't save ${name}: not enough storage space on this device.`);
  }
  // quota errors surface when the transaction commits, so read back to be sure
  const back = await db.get<Blob>('blobs', id);
  if (!back || back.size !== data.size) throw new Error(`Couldn't save ${name} on this device (storage may be full).`);
  return data;
}

/** Ask the browser not to evict our data (best effort). */
export function requestPersistence() {
  navigator.storage?.persist?.().catch(() => undefined);
}

export const uid = () => (crypto.randomUUID ? crypto.randomUUID().slice(0, 12) : Math.random().toString(36).slice(2, 14));

/** Debounce helper for autosave. */
export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | null = null;
  const d = (...a: A) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      t = null;
      fn(...a);
    }, ms);
  };
  return d;
}

type HostDownloads = { save: (r: { filename: string; data: Blob }) => Promise<unknown> };
type HostClaude = { use?: (name: string) => Promise<unknown> };
let hostDl: Promise<HostDownloads | null> | null = null;

/** True when running inside the claude.ai artifact viewer (downloads go through its save prompt). */
export const inHostedViewer = () => typeof window !== 'undefined' && !!(window as unknown as { claude?: HostClaude }).claude?.use;

function hostDownloads(): Promise<HostDownloads | null> {
  const c = (window as unknown as { claude?: HostClaude }).claude;
  if (!c?.use) return Promise.resolve(null);
  if (!hostDl) hostDl = (c.use('downloads') as Promise<HostDownloads | null>).catch(() => null);
  return hostDl;
}

/**
 * Save a file to the device. Inside the hosted viewer this asks the viewer to confirm the save;
 * elsewhere it uses a normal browser download. Resolves false if the viewer declined.
 */
export async function downloadBlob(blob: Blob, name: string): Promise<boolean> {
  const host = await hostDownloads();
  if (host) {
    try {
      await host.save({ filename: name, data: blob });
      return true;
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === 'declined') return false;
      if (code === 'rejected_extension') {
        // e.g. .cube LUTs: the viewer only accepts common formats, so save as text
        await host.save({ filename: `${name}.txt`, data: blob });
        return true;
      }
      if (code === 'rate_limited') throw new Error('Another save is waiting for confirmation — try again in a moment.');
      if (code && code !== 'unavailable' && code !== 'not_granted' && code !== 'capability_disabled') throw new Error((err as { message?: string }).message || 'Save failed');
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return true;
}
