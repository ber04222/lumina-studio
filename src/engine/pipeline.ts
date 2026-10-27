// ─── Lumina GPU pipeline: develop → blur pyramid → detail + masks → present ──
import { GL, type Target } from './gl';
import { BLUR_FS, COMPOSITE_FS, COPY_FS, DEVELOP_FS, DOWN_FS, FINISH_FS, GLOW_EXTRACT_FS, GLOW_FS, PRESENT_FS, VIEW_FS } from './shaders';
import { buildCurve, buildLocalTone, buildMatchLut, buildMatchMap, statsKey, buildTone, curvesActive, hueToAB, matchUniforms, wbGains, type Lut3D } from './color';
import type { ColorStats, EditSettings, Mask } from '@/types/edits';
import { HSL_HUES } from '@/types/edits';

export interface Frame {
  tex: WebGLTexture;
  w: number;
  h: number;
}

export interface DevelopOptions {
  /** full-resolution width of the source (for pixel-based params such as sharpen radius) */
  fullW: number;
  /** stats of the original image, needed by Colour Match */
  srcStats: ColorStats | null;
  air?: [number, number, number];
  masks?: Mask[];
  /** skip spatial detail work (used for LUT export) */
  noDetail?: boolean;
}

export interface PresentOptions {
  flipY?: boolean;
  effects?: boolean; // vignette + grain
  geometry?: boolean; // false → show the uncropped, unstraightened frame (crop tool)
  overlay?: { ch: number } | null;
  overlayColor?: [number, number, number];
  clip?: boolean;
  seed?: number;
}

const L1W = 1024;
const L1ROWS = 7;

export class Pipeline {
  gl: GL;
  private lut1: WebGLTexture;
  private lut1Data = new Float32Array(L1W * L1ROWS);
  private lut1Key = '';
  private lut3: WebGLTexture;
  private lut3Id: string | null = null;
  private lut3Size = 2;
  private maskA: WebGLTexture;
  private maskB: WebGLTexture;
  private maskKey = '';
  maskSize: [number, number] = [1, 1];

  constructor(gl: GL) {
    this.gl = gl;
    const g = gl.gl;
    this.lut1 = gl.texture('nearest');
    this.lut3 = g.createTexture()!;
    this.setLut3D(null);
    this.maskA = gl.texture('linear');
    this.maskB = gl.texture('linear');
    gl.uploadData(this.maskA, 1, 1, new Uint8Array(4));
    gl.uploadData(this.maskB, 1, 1, new Uint8Array(4));
    // compile everything up front so first interaction is snappy
    for (const [k, fs] of Object.entries(PROGRAMS)) gl.program(k, fs);
  }

  // ── resources ────────────────────────────────────────────────────────────
  private lut3Cache = new Map<string, { tex: WebGLTexture; size: number }>();

  private make3D(data: Float32Array, size: number) {
    const g = this.gl.gl;
    const tex = g.createTexture()!;
    g.bindTexture(g.TEXTURE_3D, tex);
    for (const p of [g.TEXTURE_MIN_FILTER, g.TEXTURE_MAG_FILTER]) g.texParameteri(g.TEXTURE_3D, p, g.LINEAR);
    for (const p of [g.TEXTURE_WRAP_S, g.TEXTURE_WRAP_T, g.TEXTURE_WRAP_R]) g.texParameteri(g.TEXTURE_3D, p, g.CLAMP_TO_EDGE);
    g.texImage3D(g.TEXTURE_3D, 0, g.RGB16F, size, size, size, 0, g.RGB, g.FLOAT, data);
    return tex;
  }

  private matchLuts = new Map<string, WebGLTexture>();
  /** 3D LUT for the full colour transfer src → ref (cached, small LRU). */
  private matchLut(src: ColorStats, ref: ColorStats): WebGLTexture | null {
    if (!src.pts || !ref.pts) return null;
    const key = statsKey(src) + '>' + statsKey(ref);
    let tex = this.matchLuts.get(key);
    if (tex) {
      this.matchLuts.delete(key);
      this.matchLuts.set(key, tex);
      return tex;
    }
    const data = buildMatchLut(src, ref, 33);
    if (!data) return null;
    tex = this.make3D(data, 33);
    this.matchLuts.set(key, tex);
    if (this.matchLuts.size > 8) {
      const [k, t] = this.matchLuts.entries().next().value!;
      this.gl.gl.deleteTexture(t);
      this.matchLuts.delete(k);
    }
    return tex;
  }

  /** Make a LUT available (cached by id) and select it; null selects the identity LUT. */
  setLut3D(lut: Lut3D | null) {
    if (!lut) {
      if (!this.lut3Cache.has('__identity')) {
        const d = new Float32Array(2 * 2 * 2 * 3);
        for (let b = 0; b < 2; b++) for (let gg = 0; gg < 2; gg++) for (let r = 0; r < 2; r++) d.set([r, gg, b], (b * 4 + gg * 2 + r) * 3);
        this.lut3Cache.set('__identity', { tex: this.make3D(d, 2), size: 2 });
      }
      const id = this.lut3Cache.get('__identity')!;
      this.lut3 = id.tex;
      this.lut3Size = 2;
      this.lut3Id = null;
      return;
    }
    let hit = this.lut3Cache.get(lut.id);
    if (!hit) {
      hit = { tex: this.make3D(lut.data, lut.size), size: lut.size };
      this.lut3Cache.set(lut.id, hit);
    }
    this.lut3 = hit.tex;
    this.lut3Size = hit.size;
    this.lut3Id = lut.id;
  }

  /** Select an already-cached LUT by id (returns false when not loaded yet). */
  useLut(id: string | null): boolean {
    if (!id) {
      this.setLut3D(null);
      return true;
    }
    const hit = this.lut3Cache.get(id);
    if (!hit) return false;
    this.lut3 = hit.tex;
    this.lut3Size = hit.size;
    this.lut3Id = id;
    return true;
  }

  get activeLut() {
    return this.lut3Id;
  }

  /** Upload combined mask maps (values 0..255, w*h each), up to 8. */
  setMasks(maps: Uint8Array[], w: number, h: number, key: string) {
    if (key === this.maskKey) return;
    this.maskKey = key;
    this.maskSize = [w, h];
    const pack = (offset: number) => {
      const out = new Uint8Array(w * h * 4);
      for (let c = 0; c < 4; c++) {
        const m = maps[offset + c];
        if (!m) continue;
        for (let p = 0, i = c; p < w * h; p++, i += 4) out[i] = m[p];
      }
      return out;
    };
    if (!maps.length) {
      this.gl.uploadData(this.maskA, 1, 1, new Uint8Array(4));
      this.gl.uploadData(this.maskB, 1, 1, new Uint8Array(4));
      return;
    }
    this.gl.uploadData(this.maskA, w, h, pack(0));
    this.gl.uploadData(this.maskB, w, h, maps.length > 4 ? pack(4) : new Uint8Array(w * h * 4));
  }

  get maskTextures() {
    return [this.maskA, this.maskB];
  }

  private updateLut1(e: EditSettings, src: ColorStats | null) {
    const key = JSON.stringify([e.exposure > 0 ? e.exposure : 0, e.contrast, e.highlights, e.shadows, e.whites, e.blacks, e.curves, e.match.ref?.lCdf, src?.lCdf]);
    if (key === this.lut1Key) return;
    this.lut1Key = key;
    const row = (r: number) => this.lut1Data.subarray(r * L1W, (r + 1) * L1W);
    buildTone(e, row(0));
    buildCurve(e.curves.r, row(1));
    buildCurve(e.curves.g, row(2));
    buildCurve(e.curves.b, row(3));
    buildCurve(e.curves.master, row(4));
    buildMatchMap(src, e.match.ref, row(5));
    buildLocalTone(e, row(6));
    const g = this.gl.gl;
    g.bindTexture(g.TEXTURE_2D, this.lut1);
    g.texImage2D(g.TEXTURE_2D, 0, g.R32F, L1W, L1ROWS, 0, g.RED, g.FLOAT, this.lut1Data);
  }

  // ── passes ───────────────────────────────────────────────────────────────
  private blur(src: Target | Frame, sigma: number): Target {
    const gl = this.gl;
    let cur: Target | Frame = src;
    let scale = 1;
    const temps: (Target | Frame)[] = [];
    while (sigma / scale > 5 && cur.w > 24 && cur.h > 24) {
      const d = gl.target(Math.ceil(cur.w / 2), Math.ceil(cur.h / 2));
      const from = cur;
      gl.draw(gl.program('down', DOWN_FS), d, (u) => {
        gl.gl.uniform1i(u('uTex'), 0);
        gl.gl.uniform2f(u('uTexel'), 1 / from.w, 1 / from.h);
      }, [from.tex]);
      if (cur !== src) temps.push(cur);
      cur = d as Target;
      scale = src.w / cur.w;
    }
    const s = sigma / scale;
    const p = gl.program('blur', BLUR_FS);
    const tmp = gl.target(cur.w, cur.h);
    const out = gl.target(cur.w, cur.h);
    const c = cur;
    gl.draw(p, tmp, (u) => {
      gl.gl.uniform1i(u('uTex'), 0);
      gl.gl.uniform2f(u('uDir'), 1 / c.w, 0);
      gl.gl.uniform1f(u('uSigma'), s);
    }, [c.tex]);
    gl.draw(p, out, (u) => {
      gl.gl.uniform1i(u('uTex'), 0);
      gl.gl.uniform2f(u('uDir'), 0, 1 / c.h);
      gl.gl.uniform1f(u('uSigma'), s);
    }, [tmp.tex]);
    gl.release(tmp);
    if (cur !== src) temps.push(cur);
    temps.forEach((t) => gl.release(t as Target));
    return out;
  }

  /** Global develop + detail + local masks. Returns a source-space target (caller releases). */
  develop(input: Frame, e: EditSettings, o: DevelopOptions): Target {
    const gl = this.gl;
    const g = gl.gl;
    this.updateLut1(e, o.srcStats);
    if ((e.lut.id ?? null) !== this.lut3Id) this.useLut(e.lut.id);
    const dev = gl.target(input.w, input.h);
    const toneOn = e.contrast || e.whites || e.blacks || e.exposure > 0;
    const localOn = !!(e.highlights || e.shadows);
    // base layer for local (Lightroom-like) highlights/shadows: preserves local contrast
    const base = localOn ? this.blur(input, 0.012 * Math.max(input.w, input.h)) : null;
    const hslOn = e.hsl.some((s) => s.hue || s.sat || s.lum);
    const gr = e.grading;
    const gradOn = [gr.shadows, gr.midtones, gr.highlights, gr.global].some((w) => w.s || w.l);
    const wheel = (w: { h: number; s: number; l: number }) => {
      const [a, b] = hueToAB(w.h);
      return [a * (w.s / 100) * 0.1, b * (w.s / 100) * 0.1, (w.l / 100) * 0.12] as const;
    };
    const wb = wbGains(e.temp, e.tint);
    const matchOn = !!(e.match.ref && o.srcStats && e.match.amount > 0);
    const mu = matchOn ? matchUniforms(o.srcStats!, e.match.ref!) : null;
    const mlut = matchOn ? this.matchLut(o.srcStats!, e.match.ref!) : null;
    const lutOn = !!(e.lut.id && this.lut3Id === e.lut.id && e.lut.amount > 0);

    gl.draw(gl.program('develop', DEVELOP_FS), dev, (u) => {
      g.uniform1i(u('uSrc'), 0);
      g.uniform1i(u('uLut1'), 1);
      g.uniform1i(u('uLut3'), 2);
      g.activeTexture(g.TEXTURE2);
      g.bindTexture(g.TEXTURE_3D, this.lut3);
      g.uniform1f(u('uLutAmt'), lutOn ? e.lut.amount / 100 : 0);
      g.uniform1f(u('uLutSize'), this.lut3Size);
      g.uniform3f(u('uWB'), wb[0], wb[1], wb[2]);
      g.uniform1f(u('uExpo'), 2 ** e.exposure);
      g.uniform1f(u('uDehaze'), e.dehaze / 100);
      const air = o.air ?? [0.8, 0.8, 0.8];
      g.uniform3f(u('uAir'), air[0], air[1], air[2]);
      g.uniform1f(u('uToneOn'), toneOn ? 1 : 0);
      g.uniform1i(u('uBase'), 3);
      g.uniform1f(u('uLocalOn'), localOn ? 1 : 0);
      g.uniform1f(u('uToneMix'), 0.4);
      g.uniform1f(u('uCurvesOn'), curvesActive(e) ? 1 : 0);
      g.uniform1f(u('uHslOn'), hslOn ? 1 : 0);
      g.uniform3fv(u('uHsl'), e.hsl.flatMap((s) => [s.hue / 100, s.sat / 100, s.lum / 100]));
      g.uniform1fv(u('uHslHue'), HSL_HUES);
      g.uniform1f(u('uSat'), e.saturation / 100);
      g.uniform1f(u('uVib'), e.vibrance / 100);
      g.uniform1f(u('uGradOn'), gradOn ? 1 : 0);
      g.uniform3f(u('uGS'), ...wheel(gr.shadows));
      g.uniform3f(u('uGM'), ...wheel(gr.midtones));
      g.uniform3f(u('uGH'), ...wheel(gr.highlights));
      g.uniform3f(u('uGG'), ...wheel(gr.global));
      g.uniform1f(u('uPivot'), 0.56 + (gr.balance / 100) * 0.18);
      g.uniform1f(u('uWidth'), 0.08 + (gr.blending / 100) * 0.3);
      g.uniform1f(u('uMatchOn'), matchOn ? 1 : 0);
      if (mu) {
        const amt = e.match.amount / 100;
        g.uniform1f(u('uMColor'), amt * (e.match.color / 100));
        g.uniform1f(u('uMTone'), amt * (e.match.tone / 100));
        g.uniform2fv(u('uMSrc'), mu.src);
        g.uniform2fv(u('uMRef'), mu.ref);
        g.uniform2f(u('uMStd'), mu.std[0], mu.std[1]);
      }
      g.uniform1i(u('uMLut'), 5);
      g.activeTexture(g.TEXTURE5);
      g.bindTexture(g.TEXTURE_3D, mlut ?? this.lut3);
      g.uniform1f(u('uMLutOn'), mlut ? 1 : 0);
    }, [input.tex, this.lut1, input.tex, (base ?? input).tex]);
    gl.release(base);

    if (o.noDetail) return dev;

    const masks = (o.masks ?? []).filter((m) => m.visible && m.opacity > 0).slice(0, 8);
    const allMasks = (o.masks ?? []).slice(0, 8);
    const needB1 = e.sharpen.amount > 0 || e.noise.luminance > 0 || e.texture !== 0 || e.defringe > 0 || masks.some((m) => m.adjust.sharpness > 0 || m.adjust.noise > 0 || m.adjust.texture !== 0);
    const needB2 = e.texture !== 0 || e.clarity !== 0 || e.noise.color > 0 || e.noise.luminance > 50 || e.defringe > 0 || e.sharpen.masking > 0 || masks.some((m) => m.adjust.texture !== 0 || m.adjust.clarity !== 0 || m.adjust.sharpness < 0);
    const needB3 = e.clarity !== 0 || masks.some((m) => m.adjust.clarity !== 0 || m.adjust.sharpness < 0);
    if (!needB1 && !needB2 && !needB3 && !masks.length) return this.glow(dev, e);

    const long = Math.max(input.w, input.h);
    const scale = input.w / Math.max(1, o.fullW);
    const b1 = needB1 ? this.blur(dev, Math.max(0.75, e.sharpen.radius * scale * 1.1)) : null;
    const b2 = needB2 ? this.blur(dev, 0.0035 * long) : null;
    const b3 = needB3 ? this.blur(dev, 0.02 * long) : null;
    const out = gl.target(input.w, input.h);
    gl.draw(gl.program('finish', FINISH_FS), out, (u) => {
      ['uDev', 'uB1', 'uB2', 'uB3', 'uMaskA', 'uMaskB'].forEach((n, i) => g.uniform1i(u(n), i));
      g.uniform1f(u('uTexture'), e.texture / 100);
      g.uniform1f(u('uClarity'), e.clarity / 100);
      g.uniform1f(u('uSharp'), e.sharpen.amount / 150);
      g.uniform1f(u('uSharpDetail'), e.sharpen.detail / 100);
      g.uniform1f(u('uSharpMask'), e.sharpen.masking / 100);
      g.uniform1f(u('uNrL'), e.noise.luminance / 100);
      g.uniform1f(u('uNrC'), e.noise.color / 100);
      g.uniform1f(u('uDefringe'), e.defringe / 100);
      g.uniform1i(u('uMaskCount'), allMasks.length);
      const op: number[] = [];
      const L0: number[] = [], L1: number[] = [], L2: number[] = [], L3: number[] = [], L4: number[] = [];
      for (let i = 0; i < 8; i++) {
        const m = allMasks[i];
        const a = m?.adjust;
        op.push(m && m.visible ? m.opacity / 100 : 0);
        L0.push(a ? a.temp / 100 : 0, a ? a.tint / 100 : 0, a ? a.exposure : 0, a ? a.contrast / 100 : 0);
        L1.push(a ? a.highlights / 100 : 0, a ? a.shadows / 100 : 0, a ? a.whites / 100 : 0, a ? a.blacks / 100 : 0);
        L2.push(a ? a.texture / 100 : 0, a ? a.clarity / 100 : 0, a ? a.dehaze / 100 : 0, a ? ((a.hue / 100) * 60 * Math.PI) / 180 : 0);
        L3.push(a ? a.saturation / 100 : 0, a ? a.sharpness / 100 : 0, a ? a.noise / 100 : 0, a ? (a.colorS / 100) * 0.12 : 0);
        const dir = a ? hueToAB(a.colorH) : [0, 0];
        L4.push(dir[0], dir[1]);
      }
      g.uniform1fv(u('uMOp'), op);
      g.uniform4fv(u('uL0'), L0);
      g.uniform4fv(u('uL1'), L1);
      g.uniform4fv(u('uL2'), L2);
      g.uniform4fv(u('uL3'), L3);
      g.uniform2fv(u('uL4'), L4);
    }, [dev.tex, (b1 ?? dev).tex, (b2 ?? b1 ?? dev).tex, (b3 ?? b2 ?? dev).tex, this.maskA, this.maskB]);
    gl.release(dev);
    gl.release(b1);
    gl.release(b2);
    gl.release(b3);
    return this.glow(out, e);
  }

  /** Film bloom + halation (spatial, sized relative to the image so export matches preview). */
  private glow(img: Target, e: EditSettings): Target {
    const gw = e.glow;
    if (!gw || (gw.amount <= 0 && gw.halation <= 0)) return img;
    const gl = this.gl;
    const g = gl.gl;
    const long = Math.max(img.w, img.h);
    const ext = gl.target(img.w, img.h);
    gl.draw(gl.program('glowx', GLOW_EXTRACT_FS), ext, (u) => {
      g.uniform1i(u('uTex'), 0);
      g.uniform1f(u('uThr'), 0.35 + (gw.threshold / 100) * 0.55);
    }, [img.tex]);
    const bg = gw.amount > 0 ? this.blur(ext, (0.008 + (gw.size / 100) * 0.04) * long) : null;
    const bh = gw.halation > 0 ? this.blur(ext, 0.0035 * long) : null;
    gl.release(ext);
    const out = gl.target(img.w, img.h);
    gl.draw(gl.program('glow', GLOW_FS), out, (u) => {
      ['uTex', 'uGlow', 'uHal'].forEach((n, i) => g.uniform1i(u(n), i));
      g.uniform1f(u('uGlowAmt'), gw.amount / 100);
      g.uniform1f(u('uHalAmt'), gw.halation / 100);
    }, [img.tex, (bg ?? img).tex, (bh ?? img).tex]);
    gl.release(img);
    gl.release(bg);
    gl.release(bh);
    return out;
  }

  /** Output pixel size for the given source size. */
  static outputSize(e: EditSettings, sw: number, sh: number, geometry = true): [number, number] {
    const rot = e.rotate === 90 || e.rotate === 270;
    const fw = rot ? sh : sw;
    const fh = rot ? sw : sh;
    if (!geometry) return [fw, fh];
    return [Math.max(1, Math.round(fw * e.crop.w)), Math.max(1, Math.round(fh * e.crop.h))];
  }

  /** Geometry + vignette/grain into `out` (or the canvas when null). */
  present(img: Target | Frame, e: EditSettings, out: Target | null, o: PresentOptions = {}, viewport?: [number, number, number, number]) {
    const gl = this.gl;
    const g = gl.gl;
    const geo = o.geometry !== false;
    const rot = e.rotate === 90 || e.rotate === 270;
    const fw = rot ? img.h : img.w;
    const fh = rot ? img.w : img.h;
    const [ow, oh] = Pipeline.outputSize(e, img.w, img.h, geo);
    gl.draw(gl.program('present', PRESENT_FS), out, (u) => {
      g.uniform1i(u('uImg'), 0);
      g.uniform1i(u('uOverlay'), 1);
      g.uniform1i(u('uOverlayCh'), o.overlay ? o.overlay.ch % 4 : 0);
      g.uniform1f(u('uOverlayOn'), o.overlay ? 1 : 0);
      const oc = o.overlayColor ?? [0.95, 0.2, 0.25];
      g.uniform3f(u('uOverlayColor'), oc[0], oc[1], oc[2]);
      g.uniform1f(u('uFlipY'), o.flipY ? 1 : 0);
      const c = geo ? e.crop : { x: 0, y: 0, w: 1, h: 1 };
      g.uniform4f(u('uCrop'), c.x, c.y, c.w, c.h);
      g.uniform2f(u('uFrame'), fw, fh);
      g.uniform2f(u('uSrcSize'), img.w, img.h);
      g.uniform1f(u('uAngle'), ((geo ? e.angle : e.angle) * Math.PI) / 180);
      g.uniform1i(u('uRot'), Math.round(e.rotate / 90) % 4);
      g.uniform2f(u('uFlip'), e.flipH ? -1 : 1, e.flipV ? -1 : 1);
      g.uniform1f(u('uDistort'), geo ? e.distortion / 100 : 0);
      const fx = o.effects !== false;
      g.uniform1f(u('uEffects'), fx ? 1 : 0);
      g.uniform1f(u('uVigAmt'), e.vignette.amount / 100);
      g.uniform1f(u('uVigMid'), (e.vignette.midpoint / 100) * 0.9);
      g.uniform1f(u('uVigRound'), e.vignette.roundness / 100);
      g.uniform1f(u('uVigFeather'), (e.vignette.feather / 100) * 0.9);
      g.uniform1f(u('uVigHi'), e.vignette.highlights / 100);
      g.uniform1f(u('uGrain'), e.grain.amount / 100);
      g.uniform1f(u('uGrainSize'), e.grain.size / 100);
      g.uniform1f(u('uGrainRough'), e.grain.roughness / 100);
      g.uniform2f(u('uOutSize'), ow, oh);
      g.uniform1f(u('uSeed'), o.seed ?? 3.7);
      g.uniform1f(u('uClip'), o.clip ? 1 : 0);
    }, [img.tex, o.overlay ? (o.overlay.ch < 4 ? this.maskA : this.maskB) : this.maskA], viewport);
  }

  /** Viewer pass into the canvas. Rect is in canvas pixels, top-left origin. */
  view(img: Target, before: Target | null, rect: [number, number, number, number], split: number, beforeOnly: boolean, bg: [number, number, number]) {
    const gl = this.gl;
    const g = gl.gl;
    const cw = g.drawingBufferWidth;
    const ch = g.drawingBufferHeight;
    gl.draw(gl.program('view', VIEW_FS), null, (u) => {
      g.uniform1i(u('uTex'), 0);
      g.uniform1i(u('uBefore'), 1);
      g.uniform4f(u('uRect'), rect[0], rect[1], rect[2], rect[3]);
      g.uniform2f(u('uCanvas'), cw, ch);
      g.uniform1f(u('uSplit'), split);
      g.uniform1f(u('uBeforeOnly'), beforeOnly ? 1 : 0);
      g.uniform3f(u('uBg'), bg[0], bg[1], bg[2]);
    }, [img.tex, (before ?? img).tex]);
  }

  /** Video compositing pass. Rects are in output uv. */
  composite(
    out: Target | null,
    a: { tex: WebGLTexture; rect: [number, number, number, number] } | null,
    b: { tex: WebGLTexture; rect: [number, number, number, number] },
    mode: number,
    p: number,
    flipY: boolean,
    bg: [number, number, number] = [0, 0, 0],
  ) {
    const gl = this.gl;
    const g = gl.gl;
    gl.draw(gl.program('composite', COMPOSITE_FS), out, (u) => {
      g.uniform1i(u('uA'), 0);
      g.uniform1i(u('uB'), 1);
      g.uniform4f(u('uRA'), ...(a?.rect ?? [0, 0, 1, 1]));
      g.uniform4f(u('uRB'), ...b.rect);
      g.uniform1f(u('uHasA'), a ? 1 : 0);
      g.uniform1i(u('uMode'), mode);
      g.uniform1f(u('uP'), p);
      g.uniform1f(u('uFlipY'), flipY ? 1 : 0);
      g.uniform3f(u('uBgColor'), bg[0], bg[1], bg[2]);
    }, [(a ?? b).tex, b.tex]);
  }

  copy(src: Target, out: Target | null, flipY: boolean) {
    const gl = this.gl;
    gl.draw(gl.program('copy', COPY_FS), out, (u) => {
      gl.gl.uniform1i(u('uTex'), 0);
      gl.gl.uniform1f(u('uFlipY'), flipY ? 1 : 0);
    }, [src.tex]);
  }

  /** Bake the global (per-pixel) part of the grade into a 3D LUT lattice. */
  bakeLut(e: EditSettings, srcStats: ColorStats | null, size = 33): Float32Array {
    const gl = this.gl;
    const w = size * size;
    const h = size;
    const data = new Uint8Array(w * h * 4);
    for (let b = 0; b < size; b++)
      for (let g = 0; g < size; g++)
        for (let r = 0; r < size; r++) {
          const i = (b * w + g * size + r) * 4;
          data[i] = Math.round((r / (size - 1)) * 255);
          data[i + 1] = Math.round((g / (size - 1)) * 255);
          data[i + 2] = Math.round((b / (size - 1)) * 255);
          data[i + 3] = 255;
        }
    const tex = gl.texture('nearest');
    gl.uploadData(tex, w, h, data);
    const res = this.develop({ tex, w, h }, e, { fullW: w, srcStats, noDetail: true });
    const o8 = gl.target(w, h, false);
    this.copy(res, o8, false);
    const px = gl.read(o8);
    gl.release(res);
    gl.release(o8);
    gl.gl.deleteTexture(tex);
    const outRgb = new Float32Array(size * size * size * 3);
    for (let b = 0; b < size; b++)
      for (let g = 0; g < size; g++)
        for (let r = 0; r < size; r++) {
          const i = (b * w + g * size + r) * 4;
          const k = (b * size * size + g * size + r) * 3;
          outRgb[k] = px[i] / 255;
          outRgb[k + 1] = px[i + 1] / 255;
          outRgb[k + 2] = px[i + 2] / 255;
        }
    return outRgb;
  }
}

const PROGRAMS: Record<string, string> = {
  develop: DEVELOP_FS,
  blur: BLUR_FS,
  down: DOWN_FS,
  finish: FINISH_FS,
  glowx: GLOW_EXTRACT_FS,
  glow: GLOW_FS,
  present: PRESENT_FS,
  view: VIEW_FS,
  composite: COMPOSITE_FS,
  copy: COPY_FS,
};
