// ─── Grades and composites clips for one timeline instant (preview + export) ─
import type { GL, Target } from '@/engine/gl';
import { Pipeline, type Frame } from '@/engine/pipeline';
import type { Project, VClip } from '@/types/video';
import { TRANSITIONS, activeAt, clipDur, clipStarts } from '@/types/video';

const hexToRgb = (h: string): [number, number, number] => {
  const n = parseInt(h.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

export class Compositor {
  gl: GL;
  pipe: Pipeline;

  constructor(gl: GL) {
    this.gl = gl;
    this.pipe = new Pipeline(gl);
  }

  /** Grade one clip frame → target in the clip's (cropped) resolution. */
  grade(c: VClip, src: Frame): Target {
    const e = c.grade;
    this.pipe.useLut(e.lut.id);
    const dev = this.pipe.develop(src, e, { fullW: src.w, srcStats: c.srcStats, masks: [] });
    const [ow, oh] = Pipeline.outputSize(e, src.w, src.h);
    const out = this.gl.target(ow, oh, false);
    this.pipe.present(dev, e, out, {});
    this.gl.release(dev);
    return out;
  }

  /** Where a clip lands in the output frame (uv rect). */
  static rect(c: VClip, w: number, h: number, outAspect: number, local: number): [number, number, number, number] {
    const m = w / h;
    let rw: number, rh: number;
    const fill = c.fit === 'fill';
    if (m > outAspect === fill) {
      rh = 1;
      rw = m / outAspect;
    } else {
      rw = 1;
      rh = outAspect / m;
    }
    let s = c.scale;
    let kx = 0, ky = 0;
    if (c.kenBurns) {
      const k = Math.min(1, Math.max(0, local / clipDur(c)));
      s *= 1 + 0.12 * k;
      kx = 0.03 * k;
      ky = -0.02 * k;
    }
    rw *= s;
    rh *= s;
    const x = (1 - rw) / 2 + (c.x + kx) * Math.abs(1 - rw) * 0.5 * (rw > 1 ? -1 : 1);
    const y = (1 - rh) / 2 + (c.y + ky) * Math.abs(1 - rh) * 0.5 * (rh > 1 ? -1 : 1);
    return [x, y, rw, rh];
  }

  /**
   * Render the timeline at time t. `frameOf(i, local)` returns the decoded source
   * frame for clip i (or null if not ready). Output goes to `out` (or the canvas).
   */
  render(p: Project, t: number, frameOf: (i: number) => Frame | null, out: Target | null, flipY: boolean) {
    const act = activeAt(p.clips, t);
    const bg = hexToRgb(p.bg);
    const starts = clipStarts(p.clips);
    const outAspect = p.aspect;
    const layers: { tex: WebGLTexture; rect: [number, number, number, number]; t: Target }[] = [];
    if (act) {
      for (const i of act.a != null ? [act.a, act.b] : [act.b]) {
        const f = frameOf(i);
        if (!f) continue;
        const c = p.clips[i];
        const g = this.grade(c, f);
        layers.push({ tex: g.tex, rect: Compositor.rect(c, g.w, g.h, outAspect, t - starts[i]), t: g });
      }
    }
    if (!layers.length) {
      // nothing decoded yet: clear to background
      const g = this.gl.gl;
      g.bindFramebuffer(g.FRAMEBUFFER, out ? out.fbo : null);
      if (out) g.viewport(0, 0, out.w, out.h);
      else g.viewport(0, 0, g.drawingBufferWidth, g.drawingBufferHeight);
      g.clearColor(bg[0], bg[1], bg[2], 1);
      g.clear(g.COLOR_BUFFER_BIT);
      return;
    }
    const mode = act && act.a != null && layers.length === 2 ? TRANSITIONS.find((x) => x.id === p.clips[act.b].transition.type)?.mode ?? 0 : 0;
    const A = layers.length === 2 ? layers[0] : null;
    const B = layers[layers.length - 1];
    this.pipe.composite(out, A, B, mode, act?.p ?? 1, flipY, bg);
    layers.forEach((l) => this.gl.release(l.t));
  }
}
