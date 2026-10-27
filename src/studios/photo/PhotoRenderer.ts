// ─── Photo renderer: owns GPU state for the open photo ──────────────────────
import { GL, type Target } from '@/engine/gl';
import { Pipeline } from '@/engine/pipeline';
import { computeStats, estimateAirlight, sampleImage } from '@/engine/color';
import { applyHeals } from '@/engine/heal';
import { makeContext, refineMap, renderMask, type MaskContext } from '@/engine/masks';
import type { SegResult } from '@/engine/ai';
import type { ColorStats, EditSettings, Mask } from '@/types/edits';
import type { Lut3D } from '@/engine/color';

export interface ViewState {
  zoom: number; // 1 = fit
  panX: number; // css px
  panY: number;
  split: number | null; // 0..1 before/after split position
  beforeOnly: boolean;
  overlayMask: number | null; // index of mask to tint
  clip: boolean;
  cropMode: boolean;
}

const WORK_MAX = 2048;
const MASK_MAX = 1280;

export async function decodeImage(blob: Blob): Promise<HTMLCanvasElement> {
  let bmp: ImageBitmap | HTMLImageElement;
  try {
    bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  } catch {
    const url = URL.createObjectURL(blob);
    bmp = await new Promise<HTMLImageElement>((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error('Unsupported image format'));
      im.src = url;
    });
    URL.revokeObjectURL(url);
  }
  const w = 'naturalWidth' in bmp ? bmp.naturalWidth : bmp.width;
  const h = 'naturalHeight' in bmp ? bmp.naturalHeight : bmp.height;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')!.drawImage(bmp, 0, 0);
  if ('close' in bmp) bmp.close();
  return c;
}

export function scaledCanvas(src: HTMLCanvasElement, max: number): HTMLCanvasElement {
  const s = Math.min(1, max / Math.max(src.width, src.height));
  if (s === 1) return src;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(src.width * s));
  c.height = Math.max(1, Math.round(src.height * s));
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

export class PhotoRenderer {
  gl: GL;
  pipe: Pipeline;
  id: string | null = null;
  full: HTMLCanvasElement | null = null;
  work: HTMLCanvasElement | null = null;
  private healed: HTMLCanvasElement | null = null;
  private healKey = '';
  private srcTex: WebGLTexture;
  stats: ColorStats | null = null;
  air: [number, number, number] = [0.8, 0.8, 0.8];
  maskCtx: MaskContext | null = null;
  ai: SegResult | null = null;
  private aiRefined = new Map<string, Float32Array>();
  private maskCache = new Map<string, Uint8Array>();
  private presented: Target | null = null;
  private before: Target | null = null;
  private renderKey = '';
  private beforeKey = '';
  lastError: string | null = null;

  canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.gl = new GL(canvas);
    this.pipe = new Pipeline(this.gl);
    this.srcTex = this.gl.texture();
  }

  get workMax() {
    return Math.min(WORK_MAX, this.gl.maxTex);
  }

  load(id: string, full: HTMLCanvasElement) {
    this.id = id;
    this.full = full;
    this.work = scaledCanvas(full, this.workMax);
    this.healed = null;
    this.healKey = '';
    this.ai = null;
    this.aiRefined.clear();
    this.maskCache.clear();
    this.renderKey = '';
    this.beforeKey = '';
    const sample = sampleImage(this.work, this.work.width, this.work.height, 256);
    this.stats = computeStats([sample]);
    this.air = estimateAirlight(sample);
    const mc = scaledCanvas(this.work, MASK_MAX);
    const md = mc.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, mc.width, mc.height);
    this.maskCtx = makeContext(md, (k) => this.aiMap(k));
    this.gl.upload(this.srcTex, this.work);
    this.pipe.setMasks([], 1, 1, 'none');
  }

  setAI(r: SegResult | null) {
    this.ai = r;
    this.aiRefined.clear();
    this.maskCache.clear();
  }

  private aiMap(kind: string): Float32Array | null {
    if (!this.ai || !this.maskCtx) return null;
    const hit = this.aiRefined.get(kind);
    if (hit) return hit;
    const m = this.ai.maps[kind as keyof SegResult['maps']];
    if (!m) return null;
    const r = refineMap(m, this.ai.w, this.ai.h, this.maskCtx);
    this.aiRefined.set(kind, r);
    return r;
  }

  hasAI(kind: string) {
    return !!this.ai?.maps[kind as keyof SegResult['maps']];
  }

  setLut(lut: Lut3D | null) {
    this.pipe.setLut3D(lut);
    this.renderKey = '';
  }

  /** Applies heal spots to the working source (only when they change). */
  private syncHeals(e: EditSettings) {
    if (!this.work) return;
    const key = JSON.stringify(e.heals);
    if (key === this.healKey) return;
    this.healKey = key;
    this.healed = e.heals.length ? applyHeals(this.work, e.heals) : null;
    this.gl.upload(this.srcTex, this.healed ?? this.work);
  }

  /** Renders masks on the CPU and uploads them (cached per mask definition). */
  private syncMasks(masks: Mask[]) {
    if (!this.maskCtx) return;
    const ctx = this.maskCtx;
    const maps = masks.slice(0, 8).map((m) => {
      const k = JSON.stringify(m.components) + (this.ai ? this.ai.source : '');
      let v = this.maskCache.get(m.id + k);
      if (!v) {
        v = renderMask(m, ctx);
        // drop stale cache entries for this mask
        for (const key of this.maskCache.keys()) if (key.startsWith(m.id)) this.maskCache.delete(key);
        this.maskCache.set(m.id + k, v);
      }
      return v;
    });
    const key = masks.map((m) => m.id + JSON.stringify(m.components)).join('|') + (this.ai ? this.ai.source + this.ai.w : '');
    this.pipe.setMasks(maps, ctx.w, ctx.h, key);
  }

  /** Mask coverage (0..1) at a normalized source point — used for UI feedback. */
  maskValueAt(maskIndex: number, masks: Mask[], x: number, y: number) {
    if (!this.maskCtx) return 0;
    const m = masks[maskIndex];
    const k = m ? [...this.maskCache.entries()].find(([kk]) => kk.startsWith(m.id))?.[1] : null;
    if (!k) return 0;
    const px = Math.min(this.maskCtx.w - 1, Math.max(0, Math.round(x * this.maskCtx.w)));
    const py = Math.min(this.maskCtx.h - 1, Math.max(0, Math.round(y * this.maskCtx.h)));
    return k[py * this.maskCtx.w + px] / 255;
  }

  /** Pixel of the original (unedited) working image at a source uv. */
  sourcePixel(x: number, y: number): [number, number, number] {
    const d = this.maskCtx?.src;
    if (!d) return [128, 128, 128];
    const px = Math.min(d.width - 1, Math.max(0, Math.round(x * d.width)));
    const py = Math.min(d.height - 1, Math.max(0, Math.round(y * d.height)));
    const i = (py * d.width + px) * 4;
    return [d.data[i], d.data[i + 1], d.data[i + 2]];
  }

  /** Renders the full-quality working preview + draws it to the canvas. */
  render(e: EditSettings, masks: Mask[], v: ViewState, bg: [number, number, number] = [0.07, 0.07, 0.08]) {
    if (!this.work) return null;
    const gl = this.gl;
    const g = gl.gl;
    const W = this.work.width, H = this.work.height;
    this.syncHeals(e);
    this.syncMasks(masks);
    const geo = !v.cropMode;
    const key = JSON.stringify([e, masks, v.overlayMask, v.clip, geo, this.pipe.activeLut]);
    if (key !== this.renderKey || !this.presented) {
      this.renderKey = key;
      const dev = this.pipe.develop({ tex: this.srcTex, w: W, h: H }, e, { fullW: this.full!.width, srcStats: this.stats, air: this.air, masks });
      const [ow, oh] = Pipeline.outputSize(e, W, H, geo);
      gl.release(this.presented);
      this.presented = gl.target(ow, oh, false);
      this.pipe.present(dev, e, this.presented, {
        geometry: geo,
        effects: geo,
        overlay: v.overlayMask != null && v.overlayMask < masks.length ? { ch: v.overlayMask } : null,
        clip: v.clip,
      });
      gl.release(dev);
    }
    const showBefore = v.split != null || v.beforeOnly;
    if (showBefore) {
      const bkey = JSON.stringify([e.crop, e.angle, e.rotate, e.flipH, e.flipV, geo]);
      if (bkey !== this.beforeKey || !this.before) {
        this.beforeKey = bkey;
        const [ow, oh] = Pipeline.outputSize(e, W, H, geo);
        gl.release(this.before);
        this.before = gl.target(ow, oh, false);
        // "before" = original pixels through geometry only
        this.gl.upload(this.srcTex, this.work);
        this.pipe.present({ tex: this.srcTex, w: W, h: H }, e, this.before, { geometry: geo, effects: false });
        this.gl.upload(this.srcTex, this.healed ?? this.work);
      }
    }
    // canvas sizing
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const ch = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
    const rect = this.imageRect(e, v, this.canvas.clientWidth, this.canvas.clientHeight);
    const r: [number, number, number, number] = [rect.x * dpr, rect.y * dpr, rect.w * dpr, rect.h * dpr];
    g.viewport(0, 0, cw, ch);
    this.pipe.view(this.presented!, showBefore ? this.before : null, r, v.split != null ? (rect.x + rect.w * v.split) * dpr : -1, v.beforeOnly, bg);
    return rect;
  }

  /** Image rect (css px) inside a viewport of the given size. */
  imageRect(e: EditSettings, v: Pick<ViewState, 'zoom' | 'panX' | 'panY' | 'cropMode'>, vw: number, vh: number) {
    if (!this.work) return { x: 0, y: 0, w: 0, h: 0, scale: 1 };
    const [ow, oh] = Pipeline.outputSize(e, this.work.width, this.work.height, !v.cropMode);
    const pad = v.cropMode ? 28 : 8;
    const fit = Math.min((vw - pad * 2) / ow, (vh - pad * 2) / oh);
    const s = fit * v.zoom;
    const w = ow * s, h = oh * s;
    return { x: (vw - w) / 2 + v.panX, y: (vh - h) / 2 + v.panY, w, h, scale: s };
  }

  /** Small preview (data URL) of an arbitrary grade — used for preset thumbnails. */
  thumbnail(e: EditSettings, masks: Mask[], size = 120): string {
    if (!this.work) return '';
    const gl = this.gl;
    const W = this.work.width, H = this.work.height;
    this.syncHeals(e);
    const dev = this.pipe.develop({ tex: this.srcTex, w: W, h: H }, e, { fullW: this.full!.width, srcStats: this.stats, air: this.air, masks });
    const [ow, oh] = Pipeline.outputSize(e, W, H);
    const s = size / Math.max(ow, oh);
    const t = gl.target(Math.max(1, Math.round(ow * s)), Math.max(1, Math.round(oh * s)), false);
    this.pipe.present(dev, e, t, {});
    const px = gl.read(t);
    const c = document.createElement('canvas');
    c.width = t.w;
    c.height = t.h;
    c.getContext('2d')!.putImageData(new ImageData(px, t.w, t.h), 0, 0);
    gl.release(dev);
    gl.release(t);
    this.renderKey = '';
    return c.toDataURL('image/jpeg', 0.8);
  }

  /** Small RGBA readback of the current result for scopes. */
  scopeImage(): ImageData | null {
    if (!this.presented) return null;
    const gl = this.gl;
    const s = Math.min(1, 360 / Math.max(this.presented.w, this.presented.h));
    const t = gl.target(Math.max(1, Math.round(this.presented.w * s)), Math.max(1, Math.round(this.presented.h * s)), false);
    this.pipe.copy(this.presented, t, false);
    const px = gl.read(t);
    const out = new ImageData(px, t.w, t.h);
    gl.release(t);
    return out;
  }

  /** Full-resolution export. Falls back to smaller sizes if the device runs out of memory. */
  async exportImage(e: EditSettings, masks: Mask[], opts: { type: 'image/jpeg' | 'image/png' | 'image/webp'; quality: number; maxEdge: number }): Promise<{ blob: Blob; w: number; h: number }> {
    if (!this.full) throw new Error('No photo loaded');
    // maxEdge is the requested long edge of the *output*; convert it to a source size (crop-aware)
    const [fo, fh] = Pipeline.outputSize(e, this.full.width, this.full.height);
    const srcLong = Math.max(this.full.width, this.full.height);
    const want = Math.round(srcLong * Math.min(1, opts.maxEdge / Math.max(fo, fh)));
    const tries = [want, 6000, 4096, 2048].filter((m, i, a) => m <= want && a.indexOf(m) === i);
    let lastErr: unknown = null;
    for (const maxEdge of tries) {
      try {
        return await this.exportAt(e, masks, opts, Math.min(maxEdge, this.gl.maxTex));
      } catch (err) {
        lastErr = err;
        console.warn('export retry at smaller size', err);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('Export failed');
  }

  private async exportAt(e: EditSettings, masks: Mask[], opts: { type: string; quality: number }, maxEdge: number) {
    const gl = this.gl;
    const src = scaledCanvas(this.full!, maxEdge);
    const healed = e.heals.length ? applyHeals(src, e.heals) : src;
    const tex = gl.texture();
    gl.upload(tex, healed);
    this.syncMasks(masks);
    const dev = this.pipe.develop({ tex, w: src.width, h: src.height }, e, { fullW: this.full!.width, srcStats: this.stats, air: this.air, masks });
    const [ow, oh] = Pipeline.outputSize(e, src.width, src.height);
    const t = gl.target(ow, oh, false);
    this.pipe.present(dev, e, t, {});
    gl.release(dev);
    const px = gl.read(t);
    gl.release(t);
    gl.gl.deleteTexture(tex);
    const err = gl.gl.getError();
    if (err === gl.gl.OUT_OF_MEMORY || gl.gl.isContextLost()) throw new Error('GPU out of memory');
    const c = document.createElement('canvas');
    c.width = ow;
    c.height = oh;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('Canvas too large for this device');
    ctx.putImageData(new ImageData(px, ow, oh), 0, 0);
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, opts.type, opts.quality));
    if (!blob) throw new Error('Encoding failed (image too large for this browser)');
    this.renderKey = '';
    return { blob, w: ow, h: oh };
  }

  invalidate() {
    this.renderKey = '';
    this.beforeKey = '';
  }

  dispose() {
    this.gl.dispose();
  }
}
