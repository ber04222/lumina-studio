// ─── CPU mask rendering (Lightroom-style components + edge-aware refine) ────
import type { BrushStroke, Mask, MaskComponent } from '@/types/edits';
import { oklab, s2l } from './color';

export interface MaskContext {
  w: number;
  h: number;
  /** original (unedited) source pixels at mask resolution */
  src: ImageData;
  /** gamma luminance 0..1 at mask resolution */
  lum: Float32Array;
  /** AI probability map for a kind, already at mask resolution (0..1), or null when unavailable */
  ai: (kind: string) => Float32Array | null;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a || 1e-6)));
  return t * t * (3 - 2 * t);
};

export function makeContext(src: ImageData, ai: MaskContext['ai']): MaskContext {
  const { width: w, height: h, data } = src;
  const lum = new Float32Array(w * h);
  for (let p = 0, i = 0; p < w * h; p++, i += 4) lum[p] = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
  return { w, h, src, lum, ai };
}

// ── primitives ────────────────────────────────────────────────────────────

export function renderStrokes(strokes: BrushStroke[], w: number, h: number): Float32Array {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const long = Math.max(w, h);
  for (const s of strokes) {
    if (!s.points.length) continue;
    const R = Math.max(1, s.size * long);
    const inner = R * Math.max(0, 1 - s.feather / 100);
    ctx.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over';
    const stamp = (x: number, y: number) => {
      const g = ctx.createRadialGradient(x, y, inner * 0.999, x, y, R);
      const a = Math.max(0.02, s.flow / 100);
      g.addColorStop(0, `rgba(255,255,255,${a})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, R, 0, Math.PI * 2);
      ctx.fill();
    };
    const step = Math.max(1, R * 0.18);
    let px = s.points[0].x * w;
    let py = s.points[0].y * h;
    stamp(px, py);
    for (let i = 1; i < s.points.length; i++) {
      const x = s.points[i].x * w;
      const y = s.points[i].y * h;
      const d = Math.hypot(x - px, y - py);
      const n = Math.floor(d / step);
      for (let k = 1; k <= n; k++) stamp(px + ((x - px) * k) / n, py + ((y - py) * k) / n);
      if (n > 0) {
        px = x;
        py = y;
      }
    }
  }
  const d = ctx.getImageData(0, 0, w, h).data;
  const out = new Float32Array(w * h);
  for (let p = 0; p < w * h; p++) out[p] = d[p * 4 + 3] / 255;
  return out;
}

function renderComponent(c: MaskComponent, ctx: MaskContext): Float32Array {
  const { w, h } = ctx;
  const out = new Float32Array(w * h);
  switch (c.type) {
    case 'brush':
      return renderStrokes(c.strokes, w, h);
    case 'linear': {
      const x0 = c.x0 * w, y0 = c.y0 * h, x1 = c.x1 * w, y1 = c.y1 * h;
      const dx = x1 - x0, dy = y1 - y0;
      const L2 = dx * dx + dy * dy || 1;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const t = ((x - x0) * dx + (y - y0) * dy) / L2;
          out[y * w + x] = 1 - smooth(0, 1, t);
        }
      return out;
    }
    case 'radial': {
      const cx = c.cx * w, cy = c.cy * h;
      const rx = Math.max(1, c.rx * w), ry = Math.max(1, c.ry * h);
      const ca = Math.cos((-c.angle * Math.PI) / 180), sa = Math.sin((-c.angle * Math.PI) / 180);
      const f = Math.max(0.01, c.feather / 100);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const px = x - cx, py = y - cy;
          const u = (ca * px - sa * py) / rx;
          const v = (sa * px + ca * py) / ry;
          const r = Math.sqrt(u * u + v * v);
          out[y * w + x] = 1 - smooth(1 - f, 1, r);
        }
      return out;
    }
    case 'color': {
      if (!c.samples.length) return out;
      const th = 0.02 + (c.range / 100) * 0.22;
      const refs = c.samples.map((s) => oklab(s2l(s.r / 255), s2l(s.g / 255), s2l(s.b / 255)));
      const d = ctx.src.data;
      for (let p = 0, i = 0; p < w * h; p++, i += 4) {
        const [L, a, b] = oklab(s2l(d[i] / 255), s2l(d[i + 1] / 255), s2l(d[i + 2] / 255));
        let best = 0;
        for (const r of refs) {
          // weight chroma differences more than lightness (selects "this colour")
          const dist = Math.sqrt(((L - r[0]) * 0.5) ** 2 + (a - r[1]) ** 2 + (b - r[2]) ** 2);
          best = Math.max(best, 1 - smooth(th * 0.45, th, dist));
        }
        out[p] = best;
      }
      return out;
    }
    case 'luminance': {
      const f = Math.max(0.01, (c.feather / 100) * 0.25);
      const lo = c.lo / 100, hi = c.hi / 100;
      for (let p = 0; p < w * h; p++) {
        const L = ctx.lum[p];
        out[p] = smooth(lo - f, lo, L) * (1 - smooth(hi, hi + f, L));
      }
      return out;
    }
    case 'ai': {
      const m = ctx.ai(c.kind);
      if (m) out.set(m);
      return out;
    }
  }
}

/** Render a full mask (components combined) to 0..255 bytes. */
export function renderMask(mask: Mask, ctx: MaskContext): Uint8Array {
  const n = ctx.w * ctx.h;
  let acc: Float32Array | null = null;
  for (const comp of mask.components) {
    const v = renderComponent(comp, ctx);
    if (comp.invert) for (let p = 0; p < n; p++) v[p] = 1 - v[p];
    if (!acc) {
      // the first component defines the base selection; subtracting from nothing leaves nothing
      acc = comp.mode === 'subtract' ? new Float32Array(n) : v;
      continue;
    }
    if (comp.mode === 'add') for (let p = 0; p < n; p++) acc[p] = Math.max(acc[p], v[p]);
    else if (comp.mode === 'subtract') for (let p = 0; p < n; p++) acc[p] *= 1 - v[p];
    else for (let p = 0; p < n; p++) acc[p] *= v[p];
  }
  const out = new Uint8Array(n);
  if (acc) for (let p = 0; p < n; p++) out[p] = Math.round(Math.min(1, Math.max(0, acc[p])) * 255);
  return out;
}

// ── edge-aware refinement (He et al. guided filter, O(N)) ─────────────────

function boxFilter(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let s = 0;
    const row = y * w;
    for (let x = -r; x <= r; x++) s += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = s / (2 * r + 1);
      s += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s / (2 * r + 1);
      s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

export function guidedFilter(guide: Float32Array, p: Float32Array, w: number, h: number, r: number, eps: number): Float32Array {
  const n = w * h;
  const Ip = new Float32Array(n);
  const II = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    Ip[i] = guide[i] * p[i];
    II[i] = guide[i] * guide[i];
  }
  const mI = boxFilter(guide, w, h, r);
  const mp = boxFilter(p, w, h, r);
  const mIp = boxFilter(Ip, w, h, r);
  const mII = boxFilter(II, w, h, r);
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const cov = mIp[i] - mI[i] * mp[i];
    const v = mII[i] - mI[i] * mI[i];
    a[i] = cov / (v + eps);
    b[i] = mp[i] - a[i] * mI[i];
  }
  const ma = boxFilter(a, w, h, r);
  const mb = boxFilter(b, w, h, r);
  const q = new Float32Array(n);
  for (let i = 0; i < n; i++) q[i] = Math.min(1, Math.max(0, ma[i] * guide[i] + mb[i]));
  return q;
}

/** Bilinear resize of a single-channel map. */
export function resizeMap(src: Float32Array | Uint8Array, sw: number, sh: number, w: number, h: number, scale = 1): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(sh - 1, Math.max(0, ((y + 0.5) * sh) / h - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(sw - 1, Math.max(0, ((x + 0.5) * sw) / w - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const tx = fx - x0;
      const a = src[y0 * sw + x0] * (1 - tx) + src[y0 * sw + x1] * tx;
      const b = src[y1 * sw + x0] * (1 - tx) + src[y1 * sw + x1] * tx;
      out[y * w + x] = (a * (1 - ty) + b * ty) * scale;
    }
  }
  return out;
}

/** Upscale a coarse probability map and snap it to image edges. */
export function refineMap(coarse: Uint8Array, cw: number, ch: number, ctx: MaskContext): Float32Array {
  const up = resizeMap(coarse, cw, ch, ctx.w, ctx.h, 1 / 255);
  const r = Math.max(2, Math.round(Math.max(ctx.w, ctx.h) * 0.006));
  const q = guidedFilter(ctx.lum, up, ctx.w, ctx.h, r, 0.0025);
  for (let i = 0; i < q.length; i++) q[i] = smooth(0.12, 0.88, q[i]);
  return q;
}
