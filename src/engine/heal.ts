// ─── Remove tool: content-aware heal / clone with seamless blending ─────────
import type { HealSpot } from '@/types/edits';

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function spotBox(s: Pick<HealSpot, 'points' | 'size'>, w: number, h: number, pad = 1.6): Box {
  const R = s.size * Math.max(w, h);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of s.points) {
    x0 = Math.min(x0, p.x * w);
    y0 = Math.min(y0, p.y * h);
    x1 = Math.max(x1, p.x * w);
    y1 = Math.max(y1, p.y * h);
  }
  return {
    x0: Math.max(0, Math.floor(x0 - R * pad)),
    y0: Math.max(0, Math.floor(y0 - R * pad)),
    x1: Math.min(w, Math.ceil(x1 + R * pad)),
    y1: Math.min(h, Math.ceil(y1 + R * pad)),
  };
}

/** Soft stroke mask inside a box (alpha 0..1). */
function spotMask(s: Pick<HealSpot, 'points' | 'size' | 'feather'>, b: Box, w: number, h: number): Float32Array {
  const bw = b.x1 - b.x0, bh = b.y1 - b.y0;
  const c = document.createElement('canvas');
  c.width = Math.max(1, bw);
  c.height = Math.max(1, bh);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const R = Math.max(1.5, s.size * Math.max(w, h));
  const inner = R * Math.max(0.05, 1 - s.feather / 100);
  const stamp = (x: number, y: number) => {
    const g = ctx.createRadialGradient(x, y, inner, x, y, R);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, R, 0, Math.PI * 2);
    ctx.fill();
  };
  const pts = s.points.map((p) => ({ x: p.x * w - b.x0, y: p.y * h - b.y0 }));
  stamp(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    const n = Math.max(1, Math.ceil(d / (R * 0.2)));
    for (let k = 1; k <= n; k++) stamp(pts[i - 1].x + ((pts[i].x - pts[i - 1].x) * k) / n, pts[i - 1].y + ((pts[i].y - pts[i - 1].y) * k) / n);
  }
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const m = new Float32Array(c.width * c.height);
  for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] / 255;
  return m;
}

/** Automatically choose where to copy pixels from (best matching surroundings). */
export function findHealSource(img: ImageData, s: Pick<HealSpot, 'points' | 'size' | 'feather'>): { dx: number; dy: number } {
  const { width: w, height: h, data } = img;
  const b = spotBox(s, w, h, 1.8);
  const bw = b.x1 - b.x0, bh = b.y1 - b.y0;
  const m = spotMask(s, b, w, h);
  const R = s.size * Math.max(w, h);
  const span = Math.max(bw, bh);
  let best = { dx: span * 1.1, dy: 0 }, bestCost = Infinity;
  const step = Math.max(1, Math.floor(Math.min(bw, bh) / 24));
  for (const dist of [1.0, 1.35, 1.8, 2.5]) {
    for (let a = 0; a < 24; a++) {
      const ang = (a / 24) * Math.PI * 2;
      const dx = Math.round(Math.cos(ang) * (span * 0.55 + R) * dist);
      const dy = Math.round(Math.sin(ang) * (span * 0.55 + R) * dist);
      if (b.x0 + dx < 0 || b.y0 + dy < 0 || b.x1 + dx > w || b.y1 + dy > h) continue;
      let cost = 0, cnt = 0, inner = 0;
      for (let y = 0; y < bh; y += step)
        for (let x = 0; x < bw; x += step) {
          const mv = m[y * bw + x];
          const t = ((b.y0 + y) * w + b.x0 + x) * 4;
          const q = ((b.y0 + y + dy) * w + b.x0 + x + dx) * 4;
          const dd = (data[t] - data[q]) ** 2 + (data[t + 1] - data[q + 1]) ** 2 + (data[t + 2] - data[q + 2]) ** 2;
          if (mv < 0.3) {
            cost += dd;
            cnt++;
          } else {
            // penalise sources that contain strong detail (they'd paste a new blemish)
            const q2 = ((b.y0 + y + dy) * w + Math.min(w - 1, b.x0 + x + dx + step)) * 4;
            inner += Math.abs(data[q] - data[q2]) + Math.abs(data[q + 1] - data[q2 + 1]);
          }
        }
      if (!cnt) continue;
      const c = cost / cnt + inner * 0.8 / Math.max(1, (bw * bh) / (step * step)) + dist * 25;
      if (c < bestCost) {
        bestCost = c;
        best = { dx, dy };
      }
    }
  }
  return { dx: best.dx / w, dy: best.dy / h };
}

/** Push-pull membrane interpolation of known values (weight 1) into unknowns (weight 0). */
function pushPull(val: Float32Array, wt: Float32Array, w: number, h: number, ch: number) {
  if (w <= 1 && h <= 1) return;
  const w2 = Math.max(1, Math.ceil(w / 2)), h2 = Math.max(1, Math.ceil(h / 2));
  const v2 = new Float32Array(w2 * h2 * ch);
  const t2 = new Float32Array(w2 * h2);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x, q = (y >> 1) * w2 + (x >> 1);
      const ww = wt[p];
      if (!ww) continue;
      t2[q] += ww;
      for (let c = 0; c < ch; c++) v2[q * ch + c] += val[p * ch + c] * ww;
    }
  for (let q = 0; q < w2 * h2; q++)
    if (t2[q] > 0) {
      for (let c = 0; c < ch; c++) v2[q * ch + c] /= t2[q];
      t2[q] = Math.min(1, t2[q]);
    }
  if (w2 < w || h2 < h) pushPull(v2, t2, w2, h2, ch);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (wt[p] >= 1) continue;
      const q = (y >> 1) * w2 + (x >> 1);
      const k = wt[p];
      for (let c = 0; c < ch; c++) val[p * ch + c] = val[p * ch + c] * k + v2[q * ch + c] * (1 - k);
      wt[p] = 1;
    }
}

/** Apply all heal spots to a canvas (returns a new canvas). */
export function applyHeals(src: HTMLCanvasElement, heals: HealSpot[]): HTMLCanvasElement {
  const w = src.width, h = src.height;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0);
  if (!heals.length) return out;
  for (const s of heals) {
    if (!s.points.length) continue;
    const b = spotBox(s, w, h, 1.25);
    const dx = Math.round(s.dx * w), dy = Math.round(s.dy * h);
    const bw = b.x1 - b.x0, bh = b.y1 - b.y0;
    if (bw < 2 || bh < 2) continue;
    // clamp source box into the image
    const sx = Math.min(w - bw, Math.max(0, b.x0 + dx));
    const sy = Math.min(h - bh, Math.max(0, b.y0 + dy));
    const tgt = ctx.getImageData(b.x0, b.y0, bw, bh);
    const srcPix = ctx.getImageData(sx, sy, bw, bh).data;
    const m = spotMask(s, b, w, h);
    const n = bw * bh;
    if (s.mode === 'heal') {
      // colour difference known on the boundary band, interpolated inside
      const diff = new Float32Array(n * 3);
      const wt = new Float32Array(n);
      for (let p = 0; p < n; p++) {
        if (m[p] < 0.04) {
          wt[p] = 1;
          for (let c = 0; c < 3; c++) diff[p * 3 + c] = tgt.data[p * 4 + c] - srcPix[p * 4 + c];
        }
      }
      pushPull(diff, wt, bw, bh, 3);
      for (let p = 0; p < n; p++) {
        const a = m[p];
        if (a <= 0) continue;
        for (let c = 0; c < 3; c++) {
          const healed = srcPix[p * 4 + c] + diff[p * 3 + c];
          tgt.data[p * 4 + c] = tgt.data[p * 4 + c] * (1 - a) + healed * a;
        }
      }
    } else {
      for (let p = 0; p < n; p++) {
        const a = m[p];
        if (a <= 0) continue;
        for (let c = 0; c < 3; c++) tgt.data[p * 4 + c] = tgt.data[p * 4 + c] * (1 - a) + srcPix[p * 4 + c] * a;
      }
    }
    ctx.putImageData(tgt, b.x0, b.y0);
  }
  return out;
}
