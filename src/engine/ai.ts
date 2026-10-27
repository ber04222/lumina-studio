// ─── AI selection: semantic segmentation (in-browser) + offline fallbacks ────
import type { AIKind } from '@/types/edits';
import { oklab, s2l } from './color';

export interface SegResult {
  w: number;
  h: number;
  maps: Partial<Record<AIKind, Uint8Array>>;
  source: 'ai' | 'estimate';
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
  buildings: ['building', 'house', 'skyscraper', 'tower', 'bridge', 'hovel', 'column', 'awning', 'booth', 'stage', 'wall'],
  ground: ['floor', 'road', 'sidewalk', 'earth', 'sand', 'path', 'land', 'dirt track', 'runway', 'rug', 'stairs', 'step', 'mountain', 'hill', 'rock'],
};
const THINGS = new Set([
  'person', 'animal', 'car', 'bicycle', 'minibike', 'boat', 'ship', 'bus', 'truck', 'van', 'airplane', 'sculpture', 'food',
  'bottle', 'vase', 'flower', 'ball', 'plaything', 'bag', 'basket', 'computer', 'television receiver', 'monitor', 'book',
  'glass', 'plate', 'pot', 'tray', 'chair', 'armchair', 'sofa', 'bed', 'lamp', 'clock', 'traffic light', 'bench', 'tent', 'cradle',
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let segmenter: Promise<any> | null = null;
let modelFailed = false;

export function aiModelState() {
  return modelFailed ? 'failed' : segmenter ? 'loaded' : 'idle';
}

async function getSegmenter(onProgress?: Progress) {
  if (modelFailed) return null;
  if (!segmenter) {
    segmenter = (async () => {
      // Loaded from the CDN on first use (keeps the app download small; the model itself
      // comes from the Hugging Face hub and is cached by the browser afterwards).
      const tf = (await import(/* @vite-ignore */ TRANSFORMERS_CDN)) as typeof import('@huggingface/transformers');
      tf.env.allowLocalModels = false;
      const device = typeof navigator !== 'undefined' && 'gpu' in navigator ? 'webgpu' : 'wasm';
      const files: Record<string, number> = {};
      const progress_callback = (p: { status: string; file?: string; progress?: number; loaded?: number; total?: number }) => {
        if (p.status === 'progress' && p.file) {
          files[p.file] = p.progress ?? 0;
          const vals = Object.values(files);
          onProgress?.('Downloading AI model (first time only)…', vals.reduce((a, b) => a + b, 0) / vals.length);
        }
      };
      try {
        return await tf.pipeline('image-segmentation', MODEL, { device, progress_callback });
      } catch (err) {
        if (device === 'webgpu') return await tf.pipeline('image-segmentation', MODEL, { device: 'wasm', progress_callback });
        throw err;
      }
    })();
  }
  try {
    return await segmenter;
  } catch (err) {
    console.warn('AI model unavailable, using estimates', err);
    modelFailed = true;
    segmenter = null;
    return null;
  }
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

const norm = (label: string | null) => (label ?? '').split(/[;,]/)[0].trim().toLowerCase();

/** Analyse a photo. Uses the AI model when reachable, otherwise quick on-device estimates. */
export async function analyze(src: CanvasImageSource, w: number, h: number, onProgress?: Progress): Promise<SegResult> {
  const small = downscale(src, w, h, RES);
  const seg = await getSegmenter(onProgress);
  if (seg) {
    onProgress?.('Detecting subject, sky and people…');
    try {
      const out: { label: string | null; mask: { data: Uint8Array | Uint8ClampedArray; width: number; height: number; channels: number } }[] = await seg(small);
      if (out.length) {
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
        return { w: mw, h: mh, maps, source: 'ai' };
      }
    } catch (err) {
      console.warn('Segmentation failed, using estimates', err);
    }
  }
  onProgress?.('Estimating selection on-device…');
  const est = downscale(src, w, h, 192);
  const subject = estimateSubject(est);
  return {
    w: est.width,
    h: est.height,
    maps: { subject, background: invert(subject), sky: estimateSky(est) },
    source: 'estimate',
  };
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

/** Sky: bright/blue-ish region connected to the top edge with smooth colour transitions. */
export function estimateSky(c: HTMLCanvasElement): Uint8Array {
  const w = c.width, h = c.height, n = w * h;
  const { lab, d } = labPixels(c);
  const cand = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    const r = d[p * 4] / 255, g = d[p * 4 + 1] / 255, b = d[p * 4 + 2] / 255;
    const L = lab[p * 3];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const sat = mx > 0 ? (mx - mn) / mx : 0;
    const blue = b >= r - 0.02 && b >= g - 0.06;
    const overcast = sat < 0.18 && L > 0.72;
    const sunset = r > b && L > 0.55 && (p / w) < h * 0.45;
    cand[p] = L > 0.42 && (blue || overcast || sunset) ? 1 : 0;
  }
  const out = new Uint8Array(n);
  const stack: number[] = [];
  for (let x = 0; x < w; x++) if (cand[x]) {
    out[x] = 255;
    stack.push(x);
  }
  while (stack.length) {
    const q = stack.pop()!;
    const x = q % w, y = (q / w) | 0;
    const nb = [x > 0 ? q - 1 : -1, x < w - 1 ? q + 1 : -1, y > 0 ? q - w : -1, y < h - 1 ? q + w : -1];
    for (const r of nb) {
      if (r < 0 || out[r] || !cand[r]) continue;
      const dd = Math.hypot(lab[q * 3] - lab[r * 3], lab[q * 3 + 1] - lab[r * 3 + 1], lab[q * 3 + 2] - lab[r * 3 + 2]);
      if (dd < 0.06) {
        out[r] = 255;
        stack.push(r);
      }
    }
  }
  // a "sky" covering less than 1.5% of the frame is noise
  let area = 0;
  for (let p = 0; p < n; p++) if (out[p]) area++;
  if (area < n * 0.015) out.fill(0);
  return out;
}
