// ─── Geometry maths mirroring PRESENT_FS (source ↔ output coordinates) ──────
import type { Crop, EditSettings } from '@/types/edits';

type Geo = Pick<EditSettings, 'crop' | 'angle' | 'rotate' | 'flipH' | 'flipV' | 'distortion'>;

export function frameSize(e: Pick<EditSettings, 'rotate'>, sw: number, sh: number): [number, number] {
  return e.rotate === 90 || e.rotate === 270 ? [sh, sw] : [sw, sh];
}

/** output uv (0..1 inside the crop) → source uv. `crop=false` maps the full frame. */
export function outputToSource(e: Geo, sw: number, sh: number, u: number, v: number, crop = true) {
  const [fw, fh] = frameSize(e, sw, sh);
  const c = crop ? e.crop : { x: 0, y: 0, w: 1, h: 1 };
  let qx = c.x + u * c.w;
  let qy = c.y + v * c.h;
  if (crop && e.distortion) {
    const ccx = c.x + c.w / 2, ccy = c.y + c.h / 2;
    const m = Math.max(fw, fh);
    const dx = ((qx - ccx) * fw) / m, dy = ((qy - ccy) * fh) / m;
    const k = 1 + (e.distortion / 100) * (dx * dx + dy * dy) * 1.2;
    qx = ccx + (qx - ccx) * k;
    qy = ccy + (qy - ccy) * k;
  }
  let px = (qx - 0.5) * fw;
  let py = (qy - 0.5) * fh;
  const a = (-e.angle * Math.PI) / 180;
  const ca = Math.cos(a), sa = Math.sin(a);
  [px, py] = [ca * px - sa * py, sa * px + ca * py];
  for (let i = 0; i < Math.round(e.rotate / 90) % 4; i++) [px, py] = [py, -px];
  if (e.flipH) px = -px;
  if (e.flipV) py = -py;
  return { x: px / sw + 0.5, y: py / sh + 0.5 };
}

/** source uv → output uv (ignores lens distortion, fine for UI handles). */
export function sourceToOutput(e: Geo, sw: number, sh: number, x: number, y: number, crop = true) {
  const [fw, fh] = frameSize(e, sw, sh);
  let px = (x - 0.5) * sw;
  let py = (y - 0.5) * sh;
  if (e.flipH) px = -px;
  if (e.flipV) py = -py;
  for (let i = 0; i < Math.round(e.rotate / 90) % 4; i++) [px, py] = [-py, px];
  const a = (e.angle * Math.PI) / 180;
  const ca = Math.cos(a), sa = Math.sin(a);
  [px, py] = [ca * px - sa * py, sa * px + ca * py];
  const qx = px / fw + 0.5;
  const qy = py / fh + 0.5;
  const c = crop ? e.crop : { x: 0, y: 0, w: 1, h: 1 };
  return { x: (qx - c.x) / c.w, y: (qy - c.y) / c.h };
}

/** True when every crop corner lies inside the straightened image. */
export function cropInside(cr: Crop, angle: number, fw: number, fh: number) {
  if (cr.x < -1e-4 || cr.y < -1e-4 || cr.x + cr.w > 1.0001 || cr.y + cr.h > 1.0001) return false;
  const a = (-angle * Math.PI) / 180;
  const ca = Math.cos(a), sa = Math.sin(a);
  for (const [qx, qy] of [[cr.x, cr.y], [cr.x + cr.w, cr.y], [cr.x, cr.y + cr.h], [cr.x + cr.w, cr.y + cr.h]]) {
    const px = (qx - 0.5) * fw, py = (qy - 0.5) * fh;
    const rx = ca * px - sa * py, ry = sa * px + ca * py;
    if (Math.abs(rx) > fw / 2 + 0.5 || Math.abs(ry) > fh / 2 + 0.5) return false;
  }
  return true;
}

/** Largest crop (keeping centre & aspect) whose corners stay inside the straightened image. */
export function fitCrop(c: Crop, angle: number, fw: number, fh: number): Crop {
  const a = (angle * Math.PI) / 180;
  const inside = (cr: Crop) => {
    const corners = [
      [cr.x, cr.y],
      [cr.x + cr.w, cr.y],
      [cr.x, cr.y + cr.h],
      [cr.x + cr.w, cr.y + cr.h],
    ];
    return corners.every(([qx, qy]) => {
      const px = (qx - 0.5) * fw, py = (qy - 0.5) * fh;
      const ca = Math.cos(-a), sa = Math.sin(-a);
      const rx = ca * px - sa * py, ry = sa * px + ca * py;
      return Math.abs(rx) <= fw / 2 + 0.5 && Math.abs(ry) <= fh / 2 + 0.5;
    });
  };
  let cr = { ...c };
  cr.x = Math.max(0, Math.min(1 - cr.w, cr.x));
  cr.y = Math.max(0, Math.min(1 - cr.h, cr.y));
  if (inside(cr)) return cr;
  const cx = cr.x + cr.w / 2, cy = cr.y + cr.h / 2;
  let lo = 0, hi = 1;
  for (let i = 0; i < 24; i++) {
    const s = (lo + hi) / 2;
    const t = { x: cx - (c.w * s) / 2, y: cy - (c.h * s) / 2, w: c.w * s, h: c.h * s };
    if (inside(t)) lo = s;
    else hi = s;
  }
  cr = { x: cx - (c.w * lo) / 2, y: cy - (c.h * lo) / 2, w: c.w * lo, h: c.h * lo };
  return cr;
}

/** Crop rect of a given pixel aspect ratio, as large as possible and centred. */
export function aspectCrop(aspect: number, fw: number, fh: number): Crop {
  const frameAspect = fw / fh;
  if (aspect > frameAspect) {
    const h = frameAspect / aspect;
    return { x: 0, y: (1 - h) / 2, w: 1, h };
  }
  const w = aspect / frameAspect;
  return { x: (1 - w) / 2, y: 0, w, h: 1 };
}
