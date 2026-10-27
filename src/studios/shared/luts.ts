// ─── LUT library (.cube) persisted in IndexedDB ──────────────────────────────
import { parseCube, type Lut3D } from '@/engine/color';
import { db, uid } from '@/lib/db';

const cache = new Map<string, Lut3D>();

export interface LutInfo {
  id: string;
  name: string;
  size: number;
}

export async function listLuts(): Promise<LutInfo[]> {
  const all = await db.all<{ id: string; name: string; size: number; data: Float32Array }>('luts');
  for (const l of all) cache.set(l.id, l);
  return all.map(({ id, name, size }) => ({ id, name, size })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getLut(id: string | null): Promise<Lut3D | null> {
  if (!id) return null;
  const hit = cache.get(id);
  if (hit) return hit;
  const l = await db.get<Lut3D>('luts', id);
  if (l) cache.set(id, l);
  return l ?? null;
}

export async function importCube(file: File): Promise<LutInfo> {
  const text = await file.text();
  const lut = parseCube(text, file.name.replace(/\.cube$/i, ''), uid());
  cache.set(lut.id, lut);
  await db.put('luts', lut.id, lut);
  return { id: lut.id, name: lut.name, size: lut.size };
}

export async function deleteLut(id: string) {
  cache.delete(id);
  await db.del('luts', id);
}
