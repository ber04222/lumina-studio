// ─── Library backup / restore (.zip, stored entries, no dependencies) ────────
import { db, type StoreName } from './db';

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(d: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const enc = new TextEncoder();

/** Build an uncompressed zip (photos/videos are already compressed). */
async function zip(files: { name: string; data: Uint8Array | Blob }[]): Promise<Blob> {
  const parts: BlobPart[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const data = f.data instanceof Blob ? new Uint8Array(await f.data.arrayBuffer()) : f.data;
    const name = enc.encode(f.name);
    const crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 0x0800, true); // UTF-8 names
    h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true);
    h.setUint32(22, data.length, true);
    h.setUint16(26, name.length, true);
    parts.push(h.buffer, name, data as Uint8Array<ArrayBuffer>);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true);
    c.setUint32(24, data.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    const cc = new Uint8Array(46 + name.length);
    cc.set(new Uint8Array(c.buffer), 0);
    cc.set(name, 46);
    central.push(cc);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, cdSize, true);
  e.setUint32(16, offset, true);
  return new Blob([...parts, ...(central as Uint8Array<ArrayBuffer>[]), e.buffer], { type: 'application/zip' });
}

/** Read a zip (stored or deflated entries). */
export async function unzip(blob: Blob): Promise<Map<string, Blob>> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const v = new DataView(buf.buffer);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--)
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error('This is not a Lumina backup file.');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out = new Map<string, Blob>();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('Backup file is damaged.');
    const method = v.getUint16(p + 10, true);
    const size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const extra = v.getUint16(p + 30, true);
    const comment = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const raw = buf.slice(start, start + size);
    if (!name.endsWith('/') && !name.startsWith('__MACOSX')) {
      if (method === 0) out.set(name, new Blob([raw]));
      else if (method === 8 && typeof DecompressionStream !== 'undefined') {
        const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        out.set(name, await new Response(stream).blob());
      }
    }
    p += 46 + nameLen + extra + comment;
  }
  return out;
}

const TABLES: StoreName[] = ['photos', 'projects', 'presets', 'luts'];

/** Everything needed to rebuild the library: originals, edits, projects, presets and LUTs. */
export async function createBackup(onProgress?: (msg: string) => void): Promise<{ blob: Blob; count: number }> {
  const files: { name: string; data: Uint8Array | Blob }[] = [];
  const manifest: Record<string, unknown> = { app: 'lumina-studio', version: 2, createdAt: new Date().toISOString() };
  for (const t of TABLES) {
    const keys = (await db.keys(t)).map(String);
    const rows: unknown[] = [];
    for (const k of keys) {
      const row = await db.get<Record<string, unknown>>(t, k);
      if (!row) continue;
      if (t === 'luts' && row.data instanceof Float32Array) {
        files.push({ name: `luts/${k}.bin`, data: new Uint8Array(row.data.buffer.slice(0)) });
        rows.push({ key: k, value: { ...row, data: null } });
      } else rows.push({ key: k, value: row });
    }
    manifest[t] = rows;
  }
  const blobKeys = (await db.keys('blobs')).map(String);
  for (let i = 0; i < blobKeys.length; i++) {
    onProgress?.(`Packing media ${i + 1} of ${blobKeys.length}…`);
    const b = await db.get<Blob>('blobs', blobKeys[i]);
    if (b) files.push({ name: `media/${blobKeys[i]}`, data: b });
  }
  files.unshift({ name: 'manifest.json', data: enc.encode(JSON.stringify(manifest)) });
  return { blob: await zip(files), count: blobKeys.length };
}

export async function restoreBackup(file: Blob): Promise<{ photos: number; projects: number }> {
  const entries = await unzip(file);
  const m = entries.get('manifest.json');
  if (!m) throw new Error('This is not a Lumina backup file.');
  const manifest = JSON.parse(await m.text());
  if (manifest.app !== 'lumina-studio') throw new Error('This is not a Lumina backup file.');
  for (const [name, b] of entries) if (name.startsWith('media/')) await db.put('blobs', name.slice(6), b);
  for (const t of TABLES) {
    for (const { key, value } of (manifest[t] ?? []) as { key: string; value: Record<string, unknown> }[]) {
      if (t === 'luts') {
        const bin = entries.get(`luts/${key}.bin`);
        if (!bin) continue;
        value.data = new Float32Array(await bin.arrayBuffer());
      }
      await db.put(t, key, value);
    }
  }
  return { photos: (manifest.photos ?? []).length, projects: (manifest.projects ?? []).length };
}

