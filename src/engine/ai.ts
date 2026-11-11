// ─── AI selection: semantic segmentation (in-browser) + offline fallbacks ────
import type { AIKind } from '@/types/edits';
import { oklab, s2l } from './color';

export interface SegResult {
  w: number;
  h: number;
  maps: Partial<Record<AIKind, Uint8Array>>;
  source: 'ai' | 'estimate';
  /** set once the AI sky was checked (and replaced or dropped), so older saved results are only repaired once */
  skyChecked?: boolean;
}

export type Progress = (msg: string, pct?: number) => void;

const MODEL = 'Xenova/segformer-b0-finetuned-ade-512-512';
const TRANSFORMERS_CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/dist/transformers.min.js';
const RES = 512;

// ADE20K label groups
const GROUPS: Record<Exclude<AIKind, 'subject' | 'background'>, string[]> = {
  sky: ['sky'],
  people: ['person'],
  vegetation: ['tree', 'grass', 'plant', 'flower', 'palm', 'field'],
  water: ['water', 'sea', 'river', 'lake', 'swimming pool', 'waterfall', 'fountain'],
  buildings: ['building', 'house', 'skyscraper', 'tower', 'bridge', 'hovel', 'column', 'awning', 'booth', 'stage'],
  ground: ['floor', 'road', 'sidewalk', 'earth', 'sand', 'path', 'land', 'dirt track', 'runway', 'rug', 'stairs', 'step', 'mountain', 'hill', 'rock'],
};
const THINGS = new Set([
  'person', 'animal', 'car', 'bicycle', 'minibike', 'boat', 'ship', 'bus', 'truck', 'van', 'airplane', 'sculpture', 'food',
  'bottle', 'vase', 'flower', 'ball', 'plaything', 'bag', 'basket', 'computer', 'television receiver', 'monitor', 'book',
  'glass', 'plate', 'pot', 'tray', 'chair', 'armchair', 'sofa', 'bed', 'lamp', 'clock', 'traffic light', 'bench', 'tent', 'cradle',
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Seg = any;
const segmenters: Partial<Record<'webgpu' | 'wasm', Promise<Seg>>> = {};
let failedAt = 0;
export let lastAIError = '';

export function aiModelState() {
  return failedAt && Date.now() - failedAt < 60000 ? 'failed' : Object.keys(segmenters).length ? 'loaded' : 'idle';
}

async function getSegmenter(device: 'webgpu' | 'wasm', onProgress?: Progress): Promise<Seg | null> {
  if (!segmenters[device]) {
    segmenters[device] = (async () => {
      // Loaded from the CDN on first use (keeps the app download small; the model itself
      // comes from the Hugging Face hub and is cached by the browser afterwards).
      const tf = (await import(/* @vite-ignore */ TRANSFORMERS_CDN)) as typeof import('@huggingface/transformers');
      tf.env.allowLocalModels = false;
      const files: Record<string, number> = {};
      const progress_callback = (p: { status: string; file?: string; progress?: number }) => {
        if (p.status === 'progress' && p.file) {
          files[p.file] = p.progress ?? 0;
          const vals = Object.values(files);
          onProgress?.('Downloading AI model (first time only, ~10 MB)…', vals.reduce((a, b) => a + b, 0) / vals.length / 100);
        }
      };
      return tf.pipeline('image-segmentation', MODEL, { device, progress_callback });
    })();
  }
  try {
    return await segmenters[device];
  } catch (err) {
    delete segmenters[device];
    throw err;
  }
}

type SegOut = { label: string | null; mask: { data: Uint8Array | Uint8ClampedArray; width: number; height: number; channels: number } }[];

/** A result where one label covers almost the whole frame is a sign of a broken GPU run. */
function plausible(out: SegOut) {
  if (!out.length) return false;
  if (out.length > 1) return true;
  const m = out[0].mask;
  let on = 0;
  for (let i = 0; i < m.data.length; i += m.channels || 1) if (m.data[i] > 127) on++;
  return on / (m.data.length / (m.channels || 1)) < 0.985;
}

/** Run the model: WebGPU first when available, then the CPU (WebAssembly) engine. */
async function segment(img: HTMLCanvasElement, onProgress?: Progress): Promise<SegOut | null> {
  if (failedAt && Date.now() - failedAt < 60000) return null; // don't hammer a failing network
  const order: ('webgpu' | 'wasm')[] = typeof navigator !== 'undefined' && 'gpu' in navigator ? ['webgpu', 'wasm'] : ['wasm'];
  for (const device of order) {
    try {
      const seg = await getSegmenter(device, onProgress);
      onProgress?.('Detecting subject, sky and people…');
      const out: SegOut = await seg(img);
      if (plausible(out)) {
        failedAt = 0;
        lastAIError = '';
        return out;
      }
      lastAIError = `${device} returned an implausible result`;
      delete segmenters[device];
    } catch (err) {
      lastAIError = err instanceof Error ? err.message : String(err);
      console.warn(`AI segmentation on ${device} failed`, err);
    }
  }
  failedAt = Date.now();
  return null;
}

function downscale(src: CanvasImageSource, w: number, h: number, max: number) {
  const s = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * s));
  c.height = Math.max(1, Math.round(h * s));
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

/** A believable sky is a decent share of the frame and sits mostly in its upper half. */
export function skyPlausible(m: Uint8Array | undefined, w: number, h: number) {
  if (!m) return false;
  let area = 0, top = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (m[y * w + x] > 127) {
        area++;
        if (y < h / 2) top++;
      }
  return area >= w * h * 0.015 && top >= area * 0.6;
}

function resampleNearest(m: Uint8Array, sw: number, sh: number, dw: number, dh: number) {
  if (sw === dw && sh === dh) return m;
  const o = new Uint8Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor((y / dh) * sh));
    for (let x = 0; x < dw; x++) o[y * dw + x] = m[sy * sw + Math.min(sw - 1, Math.floor((x / dw) * sw))];
  }
  return o;
}

/** Colour-based sky at the size of the AI maps (dw × dh). */
function skyFromColour(src: CanvasImageSource, w: number, h: number, dw: number, dh: number) {
  const c = downscale(src, w, h, SKY_EST_SIZE);
  return resampleNearest(estimateSky(c), c.width, c.height, dw, dh);
}

/**
 * The model's sky can come back empty or in the wrong place (hazy overcast skies, a misbehaving GPU run).
 * Replace it with the colour-based sky when that is believable, otherwise drop it so the UI says
 * "no sky found" instead of applying an adjustment to nothing. Returns null when nothing needed changing.
 */
export function repairSky(res: SegResult, src: CanvasImageSource, w: number, h: number): SegResult | null {
  if (res.source !== 'ai' || res.skyChecked || skyPlausible(res.maps.sky, res.w, res.h)) return null;
  const maps = { ...res.maps };
  const est = skyFromColour(src, w, h, res.w, res.h);
  if (skyPlausible(est, res.w, res.h)) maps.sky = est;
  else delete maps.sky;
  return { ...res, maps, skyChecked: true };
}

const norm = (label: string | null) => (label ?? '').split(/[;,]/)[0].trim().toLowerCase();

/** Analyse a photo. Uses the AI model when reachable, otherwise quick on-device estimates. */
export async function analyze(src: CanvasImageSource, w: number, h: number, onProgress?: Progress): Promise<SegResult> {
  const small = downscale(src, w, h, RES);
  const out = await segment(small, onProgress);
  if (out) {
    {
      {
        const mw = out[0].mask.width;
        const mh = out[0].mask.height;
        const byLabel = new Map<string, Uint8Array>();
        for (const o of out) {
          const ch = o.mask.channels || 1;
          const m = new Uint8Array(mw * mh);
          for (let p = 0; p < mw * mh; p++) m[p] = o.mask.data[p * ch];
          byLabel.set(norm(o.label), m);
        }
        const union = (labels: string[]) => {
          const m = new Uint8Array(mw * mh);
          let any = false;
          for (const l of labels) {
            const s = byLabel.get(l);
            if (!s) continue;
            any = true;
            for (let p = 0; p < m.length; p++) if (s[p] > m[p]) m[p] = s[p];
          }
          return any ? m : null;
        };
        const maps: SegResult['maps'] = {};
        for (const [k, labels] of Object.entries(GROUPS)) {
          const m = union(labels);
          if (m) maps[k as AIKind] = m;
        }
        // subject = most prominent, central "thing" classes
        const scored: { l: string; s: number }[] = [];
        for (const [l, m] of byLabel) {
          if (!THINGS.has(l)) continue;
          let area = 0, cx = 0, cy = 0;
          for (let y = 0; y < mh; y++)
            for (let x = 0; x < mw; x++)
              if (m[y * mw + x] > 127) {
                area++;
                cx += x;
                cy += y;
              }
          if (area < mw * mh * 0.004) continue;
          cx = cx / area / mw - 0.5;
          cy = cy / area / mh - 0.5;
          const d = Math.hypot(cx, cy);
          scored.push({ l, s: (area / (mw * mh)) * (1.3 - d) * (l === 'person' ? 1.6 : 1) });
        }
        scored.sort((a, b) => b.s - a.s);
        let subject: Uint8Array | null = null;
        if (scored.length) subject = union(scored.filter((x) => x.s >= scored[0].s * 0.35).map((x) => x.l));
        if (!subject) subject = estimateSubject(small);
        maps.subject = subject;
        maps.background = invert(subject);
        return repairSky({ w: mw, h: mh, maps, source: 'ai' }, src, w, h) ?? { w: mw, h: mh, maps, source: 'ai', skyChecked: true };
      }
    }
  }
  onProgress?.('Estimating selection on-device…');
  const est = downscale(src, w, h, 192);
  const subject = estimateSubject(est);
  const sky = skyFromColour(src, w, h, est.width, est.height);
  const maps: SegResult['maps'] = { subject, background: invert(subject) };
  if (skyPlausible(sky, est.width, est.height)) maps.sky = sky; // an empty map would look "available" but do nothing
  return { w: est.width, h: est.height, maps, source: 'estimate' };
}

const invert = (m: Uint8Array) => {
  const o = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) o[i] = 255 - m[i];
  return o;
};

// ── fallbacks ──────────────────────────────────────────────────────────────

function labPixels(c: HTMLCanvasElement) {
  const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data;
  const n = c.width * c.height;
  const lab = new Float32Array(n * 3);
  for (let p = 0; p < n; p++) {
    const v = oklab(s2l(d[p * 4] / 255), s2l(d[p * 4 + 1] / 255), s2l(d[p * 4 + 2] / 255));
    lab.set(v, p * 3);
  }
  return { lab, d };
}

/** Colour-contrast saliency with a centre prior → largest central blob. */
export function estimateSubject(c: HTMLCanvasElement): Uint8Array {
  const w = c.width, h = c.height, n = w * h;
  const { lab } = labPixels(c);
  // border colour clusters
  const border: number[] = [];
  for (let x = 0; x < w; x += 2) border.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y += 2) border.push(y * w, y * w + w - 1);
  const K = 6;
  const centers: number[][] = [];
  for (let k = 0; k < K; k++) {
    const p = border[Math.floor((k / K) * border.length)];
    centers.push([lab[p * 3], lab[p * 3 + 1], lab[p * 3 + 2]]);
  }
  for (let it = 0; it < 6; it++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (const p of border) {
      let best = 0, bd = Infinity;
      for (let k = 0; k < K; k++) {
        const dd = (lab[p * 3] - centers[k][0]) ** 2 + (lab[p * 3 + 1] - centers[k][1]) ** 2 + (lab[p * 3 + 2] - centers[k][2]) ** 2;
        if (dd < bd) {
          bd = dd;
          best = k;
        }
      }
      sums[best][0] += lab[p * 3];
      sums[best][1] += lab[p * 3 + 1];
      sums[best][2] += lab[p * 3 + 2];
      sums[best][3]++;
    }
    sums.forEach((s, k) => {
      if (s[3]) centers[k] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
    });
  }
  const sal = new Float32Array(n);
  let mx = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      let bd = Infinity;
      for (const ct of centers) bd = Math.min(bd, (lab[p * 3] - ct[0]) ** 2 * 0.6 + (lab[p * 3 + 1] - ct[1]) ** 2 + (lab[p * 3 + 2] - ct[2]) ** 2);
      const dx = x / w - 0.5, dy = y / h - 0.5;
      const v = Math.sqrt(bd) * Math.exp(-(dx * dx + dy * dy) / 0.12);
      sal[p] = v;
      if (v > mx) mx = v;
    }
  // Otsu threshold
  const hist = new Array(64).fill(0);
  for (let p = 0; p < n; p++) hist[Math.min(63, Math.floor((sal[p] / (mx || 1)) * 64))]++;
  let sum = 0;
  for (let i = 0; i < 64; i++) sum += i * hist[i];
  let sB = 0, wB = 0, best = 0, thr = 16;
  for (let i = 0; i < 64; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sB += i * hist[i];
    const mB = sB / wB, mF = (sum - sB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      thr = i;
    }
  }
  const bin = new Uint8Array(n);
  for (let p = 0; p < n; p++) bin[p] = (sal[p] / (mx || 1)) * 64 > thr ? 1 : 0;
  // keep the connected component with the most saliency mass
  const label = new Int32Array(n).fill(-1);
  let bestComp = -1, bestMass = 0;
  const stack: number[] = [];
  let comp = 0;
  for (let p = 0; p < n; p++) {
    if (!bin[p] || label[p] >= 0) continue;
    let mass = 0;
    stack.push(p);
    label[p] = comp;
    while (stack.length) {
      const q = stack.pop()!;
      mass += sal[q];
      const x = q % w, y = (q / w) | 0;
      const nb = [x > 0 ? q - 1 : -1, x < w - 1 ? q + 1 : -1, y > 0 ? q - w : -1, y < h - 1 ? q + w : -1];
      for (const r of nb) if (r >= 0 && bin[r] && label[r] < 0) {
        label[r] = comp;
        stack.push(r);
      }
    }
    if (mass > bestMass) {
      bestMass = mass;
      bestComp = comp;
    }
    comp++;
  }
  const out = new Uint8Array(n);
  for (let p = 0; p < n; p++) out[p] = label[p] === bestComp ? 255 : 0;
  return fillHoles(out, w, h);
}

function fillHoles(m: Uint8Array, w: number, h: number) {
  const outside = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const q = stack.pop()!;
    if (outside[q] || m[q]) continue;
    outside[q] = 1;
    const x = q % w, y = (q / w) | 0;
    if (x > 0) stack.push(q - 1);
    if (x < w - 1) stack.push(q + 1);
    if (y > 0) stack.push(q - w);
    if (y < h - 1) stack.push(q + w);
  }
  for (let p = 0; p < w * h; p++) if (!outside[p]) m[p] = 255;
  return m;
}

/** Separable box blur (edge-clamped running sum). */
function boxBlur(src: Float32Array, w: number, h: number, r: number) {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const k = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += src[y * w + Math.min(w - 1, Math.max(0, i))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = sum / k;
      sum += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += tmp[Math.min(h - 1, Math.max(0, i)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / k;
      sum += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

/** Longest side the sky estimate is designed for (thresholds assume this scale). */
export const SKY_EST_SIZE = 256;

/**
 * Sky from colour alone (used when the AI model is unavailable or gives an implausible sky).
 * Sky is smooth, runs along the top edge, and ends at a horizon, so: smooth bright / blue / dusk
 * pixels → flood from the top edge → drop anything that doesn't reach across the top → stop at the horizon.
 * Pass a canvas no larger than SKY_EST_SIZE.
 */
export function estimateSky(c: HTMLCanvasElement): Uint8Array {
  const w = c.width, h = c.height, n = w * h;
  const { lab, d } = labPixels(c);
  // texture = local average of the luminance gradient (fur, wood grain and foliage are rough; sky is not)
  const grad = new Float32Array(n);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x, L = lab[p * 3];
      grad[p] = (x < w - 1 ? Math.abs(lab[(p + 1) * 3] - L) : 0) + (y < h - 1 ? Math.abs(lab[(p + w) * 3] - L) : 0);
    }
  const tex = boxBlur(grad, w, h, 2);
  const cand = new Uint8Array(n);
  const colour = new Uint8Array(n); // sky-coloured, ignoring texture (used to close the rim along edges)
  for (let p = 0; p < n; p++) {
    const r = d[p * 4] / 255, g = d[p * 4 + 1] / 255, b = d[p * 4 + 2] / 255;
    const L = lab[p * 3];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const sat = mx > 0 ? (mx - mn) / mx : 0;
    const blue = b >= r - 0.02 && b >= g - 0.06;
    const dusk = b - r > 0.08 && sat > 0.3 && L > 0.14; // deep blue evening / night sky
    const top = p / w < h * 0.6;
    const overcast = sat < 0.24 && L > (top ? 0.6 : 0.72);
    const sunset = r > b && L > 0.55 && p / w < h * 0.45;
    colour[p] = dusk || (L > 0.42 && (blue || overcast || sunset)) ? 1 : 0;
    cand[p] = colour[p] && tex[p] <= 0.03 ? 1 : 0;
  }
  const out = new Uint8Array(n);
  const stack: number[] = [];
  // seed from the top band rather than the very first row, so a black border or status bar doesn't hide the sky
  const band = Math.max(2, Math.ceil(h * 0.08));
  for (let p = 0; p < band * w; p++) if (cand[p]) {
    out[p] = 255;
    stack.push(p);
  }
  while (stack.length) {
    const q = stack.pop()!;
    const x = q % w, y = (q / w) | 0;
    const nb = [x > 0 ? q - 1 : -1, x < w - 1 ? q + 1 : -1, y > 0 ? q - w : -1, y < h - 1 ? q + w : -1];
    for (const r of nb) {
      if (r < 0 || out[r] || !cand[r]) continue;
      const dd = Math.hypot(lab[q * 3] - lab[r * 3], lab[q * 3 + 1] - lab[r * 3 + 1], lab[q * 3 + 2] - lab[r * 3 + 2]);
      if (dd < 0.075) {
        out[r] = 255;
        stack.push(r);
      }
    }
  }
  // sky spans the top of the frame: a bright patch in one corner (blurred background, a lamp) isn't sky
  const first = new Int32Array(w).fill(-1);
  let touch = 0;
  for (let x = 0; x < w; x++)
    for (let y = 0; y < band; y++)
      if (out[y * w + x]) {
        first[x] = y;
        touch++;
        break;
      }
  if (touch < w * 0.3) return new Uint8Array(n);
  // horizon: per column, the first strong dark step downwards (land under sky); columns without one
  // (open water, haze) borrow the nearest column that has one, so smooth water isn't swallowed
  const Lb = boxBlur(Float32Array.from({ length: n }, (_, p) => lab[p * 3]), w, h, 1);
  const edge = new Int32Array(w).fill(-1);
  for (let x = 0; x < w; x++) {
    if (first[x] < 0) continue;
    let y = first[x];
    while (y < h - 2 && out[y * w + x]) y++; // end of the flood-filled run
    for (let yy = Math.max(2, y - 6); yy < Math.min(h - 3, y + 3); yy++) {
      if (Lb[(yy - 2) * w + x] - Lb[(yy + 2) * w + x] > 0.06 || (!out[(yy + 1) * w + x] && out[yy * w + x])) {
        edge[x] = yy;
        break;
      }
    }
  }
  // a column whose "edge" lies far below where most columns end is water or ground running on, not the horizon
  const found = Array.from(edge).filter((e) => e >= 0).sort((a, b) => a - b);
  if (found.length) {
    const limit = found[found.length >> 1] + h * 0.08;
    for (let x = 0; x < w; x++) if (edge[x] > limit) edge[x] = -1;
  }
  const known = [] as number[];
  for (let x = 0; x < w; x++) if (edge[x] >= 0) known.push(x);
  if (known.length >= w * 0.1) {
    const cap = new Int32Array(w);
    let j = 0;
    for (let x = 0; x < w; x++) {
      while (j + 1 < known.length && Math.abs(known[j + 1] - x) <= Math.abs(known[j] - x)) j++;
      cap[x] = edge[known[j]];
    }
    const sm = boxBlur(Float32Array.from(cap), w, 1, Math.max(2, Math.round(w * 0.03)));
    for (let x = 0; x < w; x++) for (let y = Math.ceil(sm[x] + h * 0.02); y < h; y++) out[y * w + x] = 0;
  }
  // the smoothness test drops the pixels right beside sharp edges (hills, towers): grow back into sky-coloured ones
  for (let it = 0; it < 3; it++) {
    const add: number[] = [];
    for (let p = 0; p < n; p++) {
      if (out[p] || !colour[p]) continue;
      const x = p % w, y = (p / w) | 0;
      const q = (x > 0 && out[p - 1] ? p - 1 : -1) >= 0 ? p - 1 : x < w - 1 && out[p + 1] ? p + 1 : y > 0 && out[p - w] ? p - w : y < h - 1 && out[p + w] ? p + w : -1;
      if (q >= 0 && Math.hypot(lab[q * 3] - lab[p * 3], lab[q * 3 + 1] - lab[p * 3 + 1], lab[q * 3 + 2] - lab[p * 3 + 2]) < 0.06) add.push(p);
    }
    for (const p of add) out[p] = 255;
  }
  // a "sky" covering less than 8% of the frame is a bright patch, not sky
  let area = 0;
  for (let p = 0; p < n; p++) if (out[p]) area++;
  if (area < n * 0.08) out.fill(0);
  return out;
}
