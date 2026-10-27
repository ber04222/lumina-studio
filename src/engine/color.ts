// ─── CPU colour science helpers (LUT building, colour match, auto tone, .cube) ─
import type { ColorStats, CurvePoint, EditSettings } from '@/types/edits';
import { isIdentityCurve } from '@/types/edits';

export const clamp = (v: number, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const bell = (x: number, c: number, w: number) => Math.exp(-(((x - c) / w) ** 2));

export const s2l = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export const l2s = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.max(c, 0) ** (1 / 2.4) - 0.055);

export function oklab(r: number, g: number, b: number): [number, number, number] {
  let l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  let m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  let s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  l = Math.cbrt(l);
  m = Math.cbrt(m);
  s = Math.cbrt(s);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function hsv2rgb(h: number, s: number, v: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)];
}

/** Direction in Oklab a/b of a hue picked on a colour wheel (HSV hue degrees). */
export function hueToAB(h: number): [number, number] {
  const [r, g, b] = hsv2rgb(((h % 360) + 360) % 360, 1, 1);
  const [, a, bb] = oklab(s2l(r), s2l(g), s2l(b));
  const len = Math.hypot(a, bb) || 1;
  return [a / len, bb / len];
}

export function wbGains(temp: number, tint: number): [number, number, number] {
  const t = temp / 100;
  const u = tint / 100;
  const g = [2 ** (t * 0.55), 2 ** (-u * 0.35), 2 ** (-t * 0.55)];
  const y = 0.2126 * g[0] + 0.7152 * g[1] + 0.0722 * g[2];
  return [g[0] / y, g[1] / y, g[2] / y];
}

// ── Tone curve (exposure handled on GPU; this maps gamma luminance 0..2 → 0..1) ─

export function buildTone(e: EditSettings, out: Float32Array) {
  // global part: whites, blacks, contrast, exposure shoulder (highlights/shadows are local, see buildLocalTone)
  const wh = e.whites / 100;
  const bl = e.blacks / 100;
  const con = e.contrast / 100;
  const ex = con >= 0 ? 1 + 1.15 * con : 1 / (1 - 1.15 * con);
  const shoulder = clamp(e.exposure / 1.5, 0, 1);
  const n = out.length;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2;
    let y = x;
    if (wh >= 0) y += wh * 0.2 * smooth(0.45, 1.05, y) * Math.min(y, 1);
    else y -= -wh * 0.22 * smooth(0.5, 1.2, y) * Math.min(y, 1.3);
    y += bl * 0.1 * (1 - smooth(0, 0.32, y));
    // pushed exposure gets a soft shoulder instead of a hard clip (identity at 0 EV)
    if (shoulder > 0) {
      const k = 1 - 0.3 * shoulder;
      if (y > k) y = k + (1 - k) * Math.tanh((y - k) / (1 - k));
    }
    let z = clamp(y, 0, 1);
    if (con !== 0) z = z < 0.5 ? 0.5 * (2 * z) ** ex : 1 - 0.5 * (2 * (1 - z)) ** ex;
    z = Math.max(z, prev);
    prev = z;
    out[i] = z;
  }
}

/** Local tone curve applied to the (blurred) base layer: highlights & shadows, domain 0..2. */
export function buildLocalTone(e: EditSettings, out: Float32Array) {
  const hi = e.highlights / 100;
  const sh = e.shadows / 100;
  const n = out.length;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2;
    let y = x;
    if (hi < 0) {
      const k = 0.45;
      if (y > k) y = k + (y - k) / (1 + -hi * 2.4 * (y - k));
    } else if (hi > 0) y += hi * 0.24 * bell(y, 0.72, 0.26);
    if (sh > 0) y += sh * 0.3 * bell(y, 0.18, 0.2) * Math.min(1, y * 12);
    else y += sh * 0.22 * bell(y, 0.25, 0.2);
    y = Math.max(y, prev);
    prev = y;
    out[i] = y;
  }
}

/** Monotone cubic (Fritsch–Carlson) interpolation through curve points → LUT. */
export function buildCurve(points: CurvePoint[], out: Float32Array) {
  const pts = [...points].sort((a, b) => a.x - b.x);
  const n = out.length;
  if (pts.length < 2) {
    for (let i = 0; i < n; i++) out[i] = i / (n - 1);
    return;
  }
  const k = pts.length;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < k - 1; i++) {
    dx.push(Math.max(1e-6, pts[i + 1].x - pts[i].x));
    m.push((pts[i + 1].y - pts[i].y) / dx[i]);
  }
  const t: number[] = [m[0]];
  for (let i = 1; i < k - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  t.push(m[k - 2]);
  for (let i = 0; i < k - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      t[i] = tau * a * m[i];
      t[i + 1] = tau * b * m[i];
    }
  }
  let seg = 0;
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    if (x <= pts[0].x) {
      out[i] = clamp(pts[0].y);
      continue;
    }
    if (x >= pts[k - 1].x) {
      out[i] = clamp(pts[k - 1].y);
      continue;
    }
    while (seg < k - 2 && x > pts[seg + 1].x) seg++;
    const h = dx[seg];
    const u = (x - pts[seg].x) / h;
    const h00 = 2 * u ** 3 - 3 * u ** 2 + 1;
    const h10 = u ** 3 - 2 * u ** 2 + u;
    const h01 = -2 * u ** 3 + 3 * u ** 2;
    const h11 = u ** 3 - u ** 2;
    out[i] = clamp(h00 * pts[seg].y + h10 * h * t[seg] + h01 * pts[seg + 1].y + h11 * h * t[seg + 1]);
  }
}

/** Luminance histogram matching map (source L → reference L), smoothed and slope-limited. */
export function buildMatchMap(src: ColorStats | null, ref: ColorStats | null, out: Float32Array) {
  const n = out.length;
  if (!src || !ref) {
    for (let i = 0; i < n; i++) out[i] = i / (n - 1);
    return;
  }
  const bins = src.lCdf.length;
  const cdfAt = (cdf: number[], x: number) => {
    const f = clamp(x) * (bins - 1);
    const i = Math.floor(f);
    const j = Math.min(bins - 1, i + 1);
    return cdf[i] + (cdf[j] - cdf[i]) * (f - i);
  };
  const inv = (cdf: number[], p: number) => {
    // binary search on monotone cdf
    let lo = 0;
    let hi = 1;
    for (let it = 0; it < 22; it++) {
      const mid = (lo + hi) / 2;
      if (cdfAt(cdf, mid) < p) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    out[i] = inv(ref.lCdf, cdfAt(src.lCdf, x));
  }
  // smooth + limit slope to avoid posterisation
  const tmp = Float32Array.from(out);
  const R = 12;
  for (let i = 0; i < n; i++) {
    let s = 0;
    let w = 0;
    for (let k = -R; k <= R; k++) {
      const j = Math.min(n - 1, Math.max(0, i + k));
      s += tmp[j];
      w++;
    }
    out[i] = s / w;
  }
  const step = 1 / (n - 1);
  out[0] = clamp(out[0], 0, 0.25);
  for (let i = 1; i < n; i++) {
    const d = out[i] - out[i - 1];
    out[i] = out[i - 1] + clamp(d, step * 0.35, step * 2.8);
  }
  const top = out[n - 1];
  if (top > 1) for (let i = 0; i < n; i++) out[i] /= top;
}

export function curvesActive(e: EditSettings) {
  const c = e.curves;
  return !isIdentityCurve(c.master) || !isIdentityCurve(c.r) || !isIdentityCurve(c.g) || !isIdentityCurve(c.b);
}

// ── Image statistics ────────────────────────────────────────────────────────

/** Downscale any drawable to an ImageData no larger than `max` on its long edge. */
export function sampleImage(src: CanvasImageSource, w: number, h: number, max = 256): ImageData {
  const s = Math.min(1, max / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * s));
  const ch = Math.max(1, Math.round(h * s));
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0, cw, ch);
  return ctx.getImageData(0, 0, cw, ch);
}

interface StatAccum {
  hist: Float64Array;
  za: [number, number, number];
  zb: [number, number, number];
  zw: [number, number, number];
  samples: { L: number; a: number; b: number }[];
  sumL: number;
  n: number;
}

const newAccum = (): StatAccum => ({
  hist: new Float64Array(64),
  za: [0, 0, 0],
  zb: [0, 0, 0],
  zw: [0, 0, 0],
  samples: [],
  sumL: 0,
  n: 0,
});

const zoneW = (L: number): [number, number, number] => {
  const ws = 1 - smooth(0.2, 0.55, L);
  const wh = smooth(0.45, 0.82, L);
  return [ws, clamp(1 - ws - wh), wh];
};

function accumulate(acc: StatAccum, img: ImageData) {
  const d = img.data;
  const stride = Math.max(1, Math.floor(d.length / 4 / 40000));
  for (let p = 0; p < d.length / 4; p += stride) {
    const i = p * 4;
    const [L, a, b] = oklab(s2l(d[i] / 255), s2l(d[i + 1] / 255), s2l(d[i + 2] / 255));
    acc.hist[Math.min(63, Math.max(0, Math.floor(L * 64)))]++;
    const w = zoneW(L);
    for (let z = 0; z < 3; z++) {
      acc.za[z] += a * w[z];
      acc.zb[z] += b * w[z];
      acc.zw[z] += w[z];
    }
    acc.sumL += L;
    acc.n++;
    if (acc.samples.length < 60000) acc.samples.push({ L, a, b });
  }
}

function finish(acc: StatAccum): ColorStats {
  const zoneA = [0, 1, 2].map((z) => (acc.zw[z] > 1e-3 ? acc.za[z] / acc.zw[z] : 0)) as [number, number, number];
  const zoneB = [0, 1, 2].map((z) => (acc.zw[z] > 1e-3 ? acc.zb[z] / acc.zw[z] : 0)) as [number, number, number];
  // fill empty zones from neighbours so transfer stays smooth
  for (let z = 0; z < 3; z++)
    if (acc.zw[z] <= 1e-3) {
      const o = acc.zw[1] > 1e-3 ? 1 : z === 0 ? 2 : 0;
      zoneA[z] = zoneA[o];
      zoneB[z] = zoneB[o];
    }
  let va = 0;
  let vb = 0;
  for (const s of acc.samples) {
    const w = zoneW(s.L);
    const ma = w[0] * zoneA[0] + w[1] * zoneA[1] + w[2] * zoneA[2];
    const mb = w[0] * zoneB[0] + w[1] * zoneB[1] + w[2] * zoneB[2];
    va += (s.a - ma) ** 2;
    vb += (s.b - mb) ** 2;
  }
  const n = Math.max(1, acc.samples.length);
  const total = acc.hist.reduce((x, y) => x + y, 0) || 1;
  const lCdf: number[] = [];
  let run = 0;
  for (let i = 0; i < 64; i++) {
    run += acc.hist[i] / total;
    lCdf.push(run);
  }
  return {
    lCdf,
    zoneA,
    zoneB,
    stdA: Math.sqrt(va / n),
    stdB: Math.sqrt(vb / n),
    meanL: acc.sumL / Math.max(1, acc.n),
  };
}

export function computeStats(images: ImageData[]): ColorStats {
  const acc = newAccum();
  for (const im of images) accumulate(acc, im);
  return finish(acc);
}

/** Uniform values for the colour-match transfer. */
export function matchUniforms(src: ColorStats, ref: ColorStats) {
  // gentle, clamped contrast scaling of the colour spread (avoids amplifying chroma noise)
  const ratio = (r: number, s: number) => clamp(Math.pow(r / Math.max(s, 0.006), 0.75), 0.55, 1.6);
  return {
    src: [0, 1, 2].map((z) => [src.zoneA[z], src.zoneB[z]]).flat(),
    ref: [0, 1, 2].map((z) => [ref.zoneA[z], ref.zoneB[z]]).flat(),
    std: [ratio(ref.stdA, src.stdA), ratio(ref.stdB, src.stdB)],
  };
}

/** Bright, low-saturation "haze" colour estimate (linear), used by Dehaze. */
export function estimateAirlight(img: ImageData): [number, number, number] {
  const d = img.data;
  const lum: number[] = [];
  for (let i = 0; i < d.length; i += 16) lum.push(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
  const sorted = [...lum].sort((a, b) => a - b);
  const thr = sorted[Math.floor(sorted.length * 0.97)] ?? 200;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0, k = 0; i < d.length; i += 16, k++) {
    if (lum[k] >= thr) {
      r += d[i];
      g += d[i + 1];
      b += d[i + 2];
      n++;
    }
  }
  if (!n) return [0.8, 0.8, 0.8];
  return [s2l(r / n / 255), s2l(g / n / 255), s2l(b / n / 255)];
}

// ── Auto tone / auto white balance ─────────────────────────────────────────

export function autoTone(img: ImageData): Partial<EditSettings> {
  const d = img.data;
  const lums: number[] = [];
  let rs = 0;
  let gs = 0;
  let bs = 0;
  let wsum = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = s2l(d[i] / 255);
    const g = s2l(d[i + 1] / 255);
    const b = s2l(d[i + 2] / 255);
    const y = l2s(0.2126 * r + 0.7152 * g + 0.0722 * b);
    lums.push(y);
    // grey-world on midtones that aren't strongly saturated
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const sat = mx > 0 ? (mx - mn) / mx : 0;
    if (y > 0.15 && y < 0.92 && sat < 0.55) {
      const w = 1 - sat;
      rs += r * w;
      gs += g * w;
      bs += b * w;
      wsum += w;
    }
  }
  lums.sort((a, b) => a - b);
  const pct = (p: number) => lums[Math.min(lums.length - 1, Math.floor(lums.length * p))];
  const p01 = pct(0.005);
  const p50 = pct(0.5);
  const p99 = pct(0.995);
  const mean = lums.reduce((a, b) => a + b, 0) / lums.length;
  const target = 0.46;
  const key = (p50 + mean) / 2;
  const exposure = clamp(Math.log2(s2l(target) / Math.max(s2l(key), 1e-3)) * 0.75, -2, 2);
  const out: Partial<EditSettings> = {
    exposure: Math.round(exposure * 100) / 100,
    contrast: Math.round(clamp((0.62 - (p99 - p01)) * 60, -15, 25)),
    highlights: Math.round(clamp(-(p99 - 0.88) * 260 - 10, -70, 0)),
    shadows: Math.round(clamp((0.32 - pct(0.15)) * 140, 0, 55)),
    whites: Math.round(clamp((0.97 - p99) * 120, -30, 35)),
    blacks: Math.round(clamp((0.035 - p01) * 300, -30, 20)),
    vibrance: 14,
    saturation: 2,
  };
  if (wsum > 10) {
    const r = rs / wsum;
    const g = gs / wsum;
    const b = bs / wsum;
    const temp = clamp(100 * Math.log2(b / Math.max(r, 1e-4)) * 0.7, -60, 60);
    const [gr, , gb] = wbGains(temp, 0);
    const rb = Math.sqrt(r * gr * b * gb);
    const tint = clamp((-100 / 0.35) * Math.log2(rb / Math.max(g, 1e-4)) * 0.6, -45, 45);
    out.temp = Math.round(temp);
    out.tint = Math.round(tint);
  }
  return out;
}

// ── .cube LUT files ────────────────────────────────────────────────────────

export interface Lut3D {
  id: string;
  name: string;
  size: number;
  data: Float32Array; // r fastest, then g, then b; RGB triplets
}

export function parseCube(text: string, name: string, id: string): Lut3D {
  let size = 0;
  let dmin = [0, 0, 0];
  let dmax = [1, 1, 1];
  const vals: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    const k = parts[0].toUpperCase();
    if (k === 'LUT_3D_SIZE') size = parseInt(parts[1], 10);
    else if (k === 'DOMAIN_MIN') dmin = parts.slice(1, 4).map(Number);
    else if (k === 'DOMAIN_MAX') dmax = parts.slice(1, 4).map(Number);
    else if (k === 'LUT_1D_SIZE') throw new Error('1D LUTs are not supported — please use a 3D .cube LUT.');
    else if (/^[-+0-9.eE]/.test(parts[0]) && parts.length >= 3) vals.push(+parts[0], +parts[1], +parts[2]);
  }
  if (!size || vals.length < size * size * size * 3) throw new Error('Not a valid 3D .cube LUT file.');
  const data = new Float32Array(size * size * size * 3);
  for (let i = 0; i < data.length; i++) {
    const c = i % 3;
    data[i] = clamp((vals[i] - dmin[c]) / (dmax[c] - dmin[c] || 1));
  }
  return { id, name, size, data };
}

/** Serialise an RGB lattice (r fastest) to a .cube file. */
export function writeCube(title: string, size: number, rgb: Float32Array | Uint8ClampedArray, scale = 1): string {
  const lines = [`TITLE "${title.replace(/"/g, '')}"`, `# Created with Lumina Studio`, `LUT_3D_SIZE ${size}`, 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 1 1 1'];
  for (let i = 0; i < size * size * size; i++) {
    lines.push(`${(rgb[i * 3] * scale).toFixed(6)} ${(rgb[i * 3 + 1] * scale).toFixed(6)} ${(rgb[i * 3 + 2] * scale).toFixed(6)}`);
  }
  return lines.join('\n') + '\n';
}
