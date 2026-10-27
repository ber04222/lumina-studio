// ─── Real-time preview player: A/V sync, frame-accurate scrubbing, grading ───
import { GL, type Target } from '@/engine/gl';
import type { Frame } from '@/engine/pipeline';
import type { AudioClip, Project } from '@/types/video';
import { activeAt, clipDur, clipStarts, projectDuration, srcTime, transDur } from '@/types/video';
import { Compositor } from './compositor';
import { drawTitles } from './titles';
import { getLut } from '@/studios/shared/luts';

const PREVIEW_MAX = 1280;

export class Player {
  gl: GL;
  comp: Compositor;
  canvas: HTMLCanvasElement;
  overlay: HTMLCanvasElement | null = null;
  project: Project | null = null;
  private blobs = new Map<string, Blob>();
  private urls = new Map<string, string>();
  private vids = new Map<string, HTMLVideoElement>(); // per clip
  private imgs = new Map<string, HTMLImageElement>(); // per media
  private auds = new Map<string, HTMLAudioElement>(); // per audio clip
  private tex = new Map<string, WebGLTexture>(); // per clip
  private imgTexReady = new Set<string>();
  private frameTarget: Target | null = null;
  t = 0;
  playing = false;
  private wall0 = 0;
  private t0 = 0;
  private raf = 0;
  private dirty = true;
  selectedTitle: string | null = null;
  onTime: ((t: number) => void) | null = null;
  onState: ((playing: boolean) => void) | null = null;
  onFrame: (() => void) | null = null;
  private unlocked = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.gl = new GL(canvas);
    this.comp = new Compositor(this.gl);
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.tick();
    };
    this.raf = requestAnimationFrame(loop);
  }

  get duration() {
    return this.project ? projectDuration(this.project) : 0;
  }

  url(mediaId: string) {
    let u = this.urls.get(mediaId);
    const b = this.blobs.get(mediaId);
    if (!u && b) {
      u = URL.createObjectURL(b);
      this.urls.set(mediaId, u);
    }
    return u ?? '';
  }

  /** Sync elements with the project (called whenever the project changes). */
  setProject(p: Project, blobs: Map<string, Blob>) {
    this.project = p;
    for (const [k, b] of blobs) this.blobs.set(k, b);
    const clipIds = new Set(p.clips.map((c) => c.id));
    for (const [id, v] of this.vids)
      if (!clipIds.has(id)) {
        v.pause();
        v.removeAttribute('src');
        v.load();
        this.vids.delete(id);
        const t = this.tex.get(id);
        if (t) this.gl.gl.deleteTexture(t);
        this.tex.delete(id);
      }
    for (const c of p.clips) {
      const m = p.media.find((x) => x.id === c.mediaId);
      if (!m) continue;
      if (m.kind === 'video' && !this.vids.has(c.id)) {
        const v = document.createElement('video');
        v.playsInline = true;
        v.preload = 'auto';
        v.crossOrigin = 'anonymous';
        v.src = this.url(m.id);
        v.addEventListener('seeked', () => (this.dirty = true));
        v.addEventListener('loadeddata', () => (this.dirty = true));
        this.vids.set(c.id, v);
      }
      if (m.kind === 'image' && !this.imgs.has(m.id)) {
        const im = new Image();
        im.src = this.url(m.id);
        im.onload = () => (this.dirty = true);
        this.imgs.set(m.id, im);
      }
      if (c.grade.lut.id) getLut(c.grade.lut.id).then((l) => {
        if (l) {
          this.comp.pipe.setLut3D(l);
          this.dirty = true;
        }
      });
    }
    const audIds = new Set(p.audio.map((a) => a.id));
    for (const [id, a] of this.auds)
      if (!audIds.has(id)) {
        a.pause();
        this.auds.delete(id);
      }
    for (const a of p.audio)
      if (!this.auds.has(a.id)) {
        const el = new Audio();
        el.preload = 'auto';
        el.src = this.url(a.mediaId);
        this.auds.set(a.id, el);
      }
    if (this.t > this.duration) this.t = this.duration;
    this.syncMedia(true);
    this.dirty = true;
  }

  private unlock() {
    // iOS: media must be started from a user gesture once before scripted playback works
    if (this.unlocked) return;
    this.unlocked = true;
    for (const el of [...this.vids.values(), ...this.auds.values()]) {
      const was = el.muted;
      el.muted = true;
      el.play().then(() => {
        if (!this.playing) el.pause();
        el.muted = was;
      }).catch(() => (el.muted = was));
    }
  }

  play() {
    if (!this.project || !this.project.clips.length) return;
    this.unlock();
    if (this.t >= this.duration - 0.03) this.t = 0;
    this.playing = true;
    this.t0 = this.t;
    this.wall0 = performance.now();
    this.syncMedia(true);
    this.onState?.(true);
  }

  pause() {
    this.playing = false;
    for (const v of this.vids.values()) v.pause();
    for (const a of this.auds.values()) a.pause();
    this.syncMedia(true);
    this.onState?.(false);
    this.dirty = true;
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  seek(t: number) {
    this.t = Math.max(0, Math.min(this.duration, t));
    if (this.playing) {
      this.t0 = this.t;
      this.wall0 = performance.now();
    }
    this.syncMedia(true);
    this.dirty = true;
    this.onTime?.(this.t);
  }

  invalidate() {
    this.dirty = true;
  }

  /** Keep media elements at the right time / rate / volume. */
  private syncMedia(force: boolean) {
    const p = this.project;
    if (!p) return;
    const starts = clipStarts(p.clips);
    const act = activeAt(p.clips, this.t, starts);
    const activeIdx = new Set<number>(act ? (act.a != null ? [act.a, act.b] : [act.b]) : []);
    // pre-roll the next clip so its first frame is ready at the cut
    const next = act ? act.b + 1 : -1;
    p.clips.forEach((c, i) => {
      const v = this.vids.get(c.id);
      if (!v) return;
      const local = this.t - starts[i];
      if (activeIdx.has(i)) {
        const want = srcTime(c, local);
        v.playbackRate = c.speed;
        // audio level: clip volume × fades × transition crossfade
        let g = c.muted ? 0 : c.volume;
        const d = clipDur(c);
        if (c.fadeIn > 0) g *= Math.min(1, local / c.fadeIn);
        if (c.fadeOut > 0) g *= Math.min(1, (d - local) / c.fadeOut);
        if (act && act.a != null) g *= i === act.b ? act.p : 1 - act.p;
        v.volume = Math.max(0, Math.min(1, g));
        v.muted = g <= 0.001;
        const drift = Math.abs(v.currentTime - want);
        if (this.playing) {
          if (drift > 0.25 || force) v.currentTime = want;
          if (v.paused) v.play().catch(() => undefined);
        } else if (force || drift > 1 / 120) {
          if (!v.paused) v.pause();
          v.currentTime = want;
        }
      } else {
        if (!v.paused) v.pause();
        if (i === next && force) {
          const want = c.in;
          if (Math.abs(v.currentTime - want) > 0.05) v.currentTime = want;
        }
      }
    });
    for (const a of p.audio) this.syncAudio(a, force);
  }

  private syncAudio(a: AudioClip, force: boolean) {
    const el = this.auds.get(a.id);
    if (!el) return;
    const local = this.t - a.start;
    const len = a.out - a.in;
    if (local >= 0 && local < len) {
      let g = a.volume;
      if (a.fadeIn > 0) g *= Math.min(1, local / a.fadeIn);
      if (a.fadeOut > 0) g *= Math.min(1, (len - local) / a.fadeOut);
      el.volume = Math.max(0, Math.min(1, g));
      const want = a.in + local;
      if (this.playing) {
        if (force || Math.abs(el.currentTime - want) > 0.25) el.currentTime = want;
        if (el.paused) el.play().catch(() => undefined);
      } else {
        if (!el.paused) el.pause();
        if (force) el.currentTime = want;
      }
    } else if (!el.paused) el.pause();
  }

  private frameOf = (i: number): Frame | null => {
    const p = this.project!;
    const c = p.clips[i];
    const m = p.media.find((x) => x.id === c.mediaId);
    if (!m) return null;
    const g = this.gl;
    let tex = this.tex.get(c.id);
    if (!tex) {
      tex = g.texture();
      this.tex.set(c.id, tex);
    }
    if (m.kind === 'video') {
      const v = this.vids.get(c.id);
      if (!v || v.readyState < 2 || !v.videoWidth) return null;
      // downscale big sources for real-time preview
      const s = Math.min(1, PREVIEW_MAX / Math.max(v.videoWidth, v.videoHeight));
      if (s < 1) {
        const tmp = this.scratch(Math.round(v.videoWidth * s), Math.round(v.videoHeight * s));
        tmp.getContext('2d')!.drawImage(v, 0, 0, tmp.width, tmp.height);
        g.upload(tex, tmp);
        return { tex, w: tmp.width, h: tmp.height };
      }
      g.upload(tex, v);
      return { tex, w: v.videoWidth, h: v.videoHeight };
    }
    const im = this.imgs.get(m.id);
    if (!im || !im.complete || !im.naturalWidth) return null;
    const s = Math.min(1, 2048 / Math.max(im.naturalWidth, im.naturalHeight));
    const w = Math.round(im.naturalWidth * s), h = Math.round(im.naturalHeight * s);
    if (!this.imgTexReady.has(c.id)) {
      const tmp = this.scratch(w, h);
      tmp.getContext('2d')!.drawImage(im, 0, 0, w, h);
      g.upload(tex, tmp);
      this.imgTexReady.add(c.id);
    }
    return { tex, w, h };
  };

  private scratchCanvas: HTMLCanvasElement | null = null;
  private scratch(w: number, h: number) {
    if (!this.scratchCanvas) this.scratchCanvas = document.createElement('canvas');
    if (this.scratchCanvas.width !== w) this.scratchCanvas.width = w;
    if (this.scratchCanvas.height !== h) this.scratchCanvas.height = h;
    return this.scratchCanvas;
  }

  private tick() {
    const p = this.project;
    if (!p) return;
    if (this.playing) {
      this.t = this.t0 + (performance.now() - this.wall0) / 1000;
      if (this.t >= this.duration) {
        this.t = this.duration;
        this.pause();
      } else {
        // detect clip boundaries to re-sync media exactly at cuts/transitions
        const starts = clipStarts(p.clips);
        const bound = starts.some((s, i) => Math.abs(this.t - s) < 0.04 || Math.abs(this.t - (s + transDur(p.clips, i))) < 0.04);
        this.syncMedia(bound);
      }
      this.onTime?.(this.t);
      this.dirty = true;
    }
    if (!this.dirty) return;
    this.dirty = false;
    this.draw();
  }

  /** Render the current frame to the canvas (+ titles overlay). */
  draw() {
    const p = this.project;
    if (!p) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.max(2, Math.round(this.canvas.clientWidth * dpr));
    const H = Math.max(2, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    // render into an offscreen target first (also used for scopes), then to the canvas
    if (!this.frameTarget || this.frameTarget.w !== W || this.frameTarget.h !== H) {
      this.gl.release(this.frameTarget);
      this.frameTarget = this.gl.target(W, H, false);
    }
    try {
      this.comp.render(p, this.t, this.frameOf, this.frameTarget, false);
      this.comp.pipe.copy(this.frameTarget, null, true);
    } catch (err) {
      console.error(err);
    }
    if (this.overlay) {
      const o = this.overlay;
      if (o.width !== W || o.height !== H) {
        o.width = W;
        o.height = H;
      }
      const ctx = o.getContext('2d')!;
      ctx.clearRect(0, 0, W, H);
      drawTitles(ctx, W, H, this.t, p.titles, this.selectedTitle);
    }
    this.onFrame?.();
  }

  /** Small readback for scopes. */
  scopeImage(): ImageData | null {
    if (!this.frameTarget) return null;
    const s = Math.min(1, 320 / Math.max(this.frameTarget.w, this.frameTarget.h));
    const t = this.gl.target(Math.max(1, Math.round(this.frameTarget.w * s)), Math.max(1, Math.round(this.frameTarget.h * s)), false);
    this.comp.pipe.copy(this.frameTarget, t, false);
    const px = this.gl.read(t);
    this.gl.release(t);
    return new ImageData(px, t.w, t.h);
  }

  /** Current source frame of a clip as a canvas (for colour stats / auto). */
  clipFrame(clipId: string): HTMLCanvasElement | null {
    const v = this.vids.get(clipId);
    const p = this.project;
    const c = p?.clips.find((x) => x.id === clipId);
    if (!c || !p) return null;
    const m = p.media.find((x) => x.id === c.mediaId);
    const src: CanvasImageSource | undefined = m?.kind === 'image' ? this.imgs.get(m.id) : v;
    if (!src) return null;
    const w = m?.kind === 'image' ? (src as HTMLImageElement).naturalWidth : (src as HTMLVideoElement).videoWidth;
    const h = m?.kind === 'image' ? (src as HTMLImageElement).naturalHeight : (src as HTMLVideoElement).videoHeight;
    if (!w || !h) return null;
    const s = Math.min(1, 512 / Math.max(w, h));
    const c2 = document.createElement('canvas');
    c2.width = Math.round(w * s);
    c2.height = Math.round(h * s);
    c2.getContext('2d')!.drawImage(src, 0, 0, c2.width, c2.height);
    return c2;
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    for (const v of this.vids.values()) {
      v.pause();
      v.removeAttribute('src');
      v.load();
    }
    for (const a of this.auds.values()) a.pause();
    for (const u of this.urls.values()) URL.revokeObjectURL(u);
    this.gl.dispose();
  }
}
