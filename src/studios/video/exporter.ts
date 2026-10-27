// ─── Offline, frame-accurate video export (WebCodecs via mediabunny) ─────────
import {
  ALL_FORMATS, AudioBufferSink, AudioBufferSource, BlobSource, BufferTarget, CanvasSink, CanvasSource, Input, Mp4OutputFormat, Output,
  WebMOutputFormat, getFirstEncodableAudioCodec, getFirstEncodableVideoCodec, type AudioCodec, type VideoCodec, type WrappedCanvas,
} from 'mediabunny';
import { GL } from '@/engine/gl';
import type { Frame } from '@/engine/pipeline';
import type { Project } from '@/types/video';
import { activeAt, clipDur, clipStarts, projectDuration, srcTime, transDur } from '@/types/video';
import { Compositor } from './compositor';
import { drawTitles } from './titles';
import { getLut } from '@/studios/shared/luts';

export interface ExportOptions {
  height: number; // output height (e.g. 1080)
  fps: number;
  quality: 'standard' | 'high' | 'max';
  format: 'auto' | 'mp4' | 'webm';
}

export interface ExportResult {
  blob: Blob;
  ext: string;
  mime: string;
  width: number;
  height: number;
  codec: string;
}

export function canExportVideo() {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

async function pickCodecs(o: ExportOptions, w: number, h: number) {
  const vOrder: VideoCodec[] = o.format === 'webm' ? ['vp9', 'av1', 'vp8'] : o.format === 'mp4' ? ['avc', 'hevc', 'av1', 'vp9'] : ['avc', 'vp9', 'av1', 'hevc', 'vp8'];
  const vcodec = await getFirstEncodableVideoCodec(vOrder, { width: w, height: h });
  if (!vcodec) throw new Error('This browser cannot encode video. Please use a recent Chrome, Edge or Safari.');
  const mp4 = vcodec === 'avc' || vcodec === 'hevc' || (vcodec === 'av1' && o.format !== 'webm') || (o.format === 'mp4' && vcodec === 'vp9');
  const aOrder: AudioCodec[] = mp4 ? ['aac', 'opus'] : ['opus', 'vorbis'];
  const acodec = await getFirstEncodableAudioCodec(aOrder, { numberOfChannels: 2, sampleRate: 48000 });
  return { vcodec, acodec, mp4 };
}

export async function exportVideo(p: Project, blobs: Map<string, Blob>, o: ExportOptions, onProgress: (f: number, msg: string) => void, signal: AbortSignal): Promise<ExportResult> {
  if (!canExportVideo()) throw new Error('Video export needs WebCodecs (Chrome, Edge, Safari 17+ or Firefox 130+).');
  if (!p.clips.length) throw new Error('Add at least one clip to export.');
  const H = even(o.height);
  const W = even(o.height * p.aspect);
  const fps = o.fps;
  const total = projectDuration(p);
  const frames = Math.max(1, Math.round(total * fps));
  const { vcodec, acodec, mp4 } = await pickCodecs(o, W, H);
  const bitrate = Math.round(W * H * fps * (o.quality === 'max' ? 0.22 : o.quality === 'high' ? 0.14 : 0.08));

  // GPU renderer (own context so preview stays untouched)
  const glCanvas = document.createElement('canvas');
  glCanvas.width = W;
  glCanvas.height = H;
  const gl = new GL(glCanvas, { preserve: true });
  const comp = new Compositor(gl);
  for (const c of p.clips) if (c.grade.lut.id) {
    const l = await getLut(c.grade.lut.id);
    if (l) comp.pipe.setLut3D(l);
  }
  const frameCanvas = document.createElement('canvas');
  frameCanvas.width = W;
  frameCanvas.height = H;
  const fctx = frameCanvas.getContext('2d')!;

  const output = new Output({ format: mp4 ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(), target: new BufferTarget() });
  const vsrc = new CanvasSource(frameCanvas, { codec: vcodec, bitrate, keyFrameInterval: 2 });
  output.addVideoTrack(vsrc, { frameRate: fps });

  // ── audio mixdown (offline, sample accurate) ──
  onProgress(0, 'Mixing audio…');
  const audioBuffer = await mixAudio(p, blobs, total, signal).catch((e) => {
    console.warn('audio mix failed', e);
    return null;
  });
  let asrc: AudioBufferSource | null = null;
  if (audioBuffer && acodec) {
    asrc = new AudioBufferSource({ codec: acodec, bitrate: 192000 });
    output.addAudioTrack(asrc);
  }
  await output.start();

  // ── per-clip decoders (sequential, exact timestamps) ──
  const starts = clipStarts(p.clips);
  type Dec = { it: AsyncGenerator<WrappedCanvas | null>; last: Frame | null; tex: WebGLTexture; input: Input; done: boolean };
  const decs = new Map<number, Dec>();
  const imgs = new Map<number, Frame>();
  const maxSrc = Math.max(W, H) * 1.25;
  const tsFor = function* (i: number) {
    const c = p.clips[i];
    for (let f = 0; f < frames; f++) {
      const t = f / fps;
      const local = t - starts[i];
      if (local < -1e-6 || local > clipDur(c) + 1e-6) continue;
      yield srcTime(c, local);
    }
  };
  const getFrame = async (i: number): Promise<Frame | null> => {
    const c = p.clips[i];
    const m = p.media.find((x) => x.id === c.mediaId)!;
    if (m.kind === 'image') {
      let f = imgs.get(i);
      if (!f) {
        const bmp = await createImageBitmap(blobs.get(m.id)!);
        const s = Math.min(1, 4096 / Math.max(bmp.width, bmp.height));
        const cv = document.createElement('canvas');
        cv.width = Math.round(bmp.width * s);
        cv.height = Math.round(bmp.height * s);
        cv.getContext('2d')!.drawImage(bmp, 0, 0, cv.width, cv.height);
        bmp.close();
        const tex = gl.texture();
        gl.upload(tex, cv);
        f = { tex, w: cv.width, h: cv.height };
        imgs.set(i, f);
      }
      return f;
    }
    let d = decs.get(i);
    if (!d) {
      const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blobs.get(m.id)!) });
      const track = await input.getPrimaryVideoTrack();
      if (!track) return null;
      const s = Math.min(1, maxSrc / Math.max(track.displayWidth, track.displayHeight));
      const sink = new CanvasSink(track, { width: Math.round(track.displayWidth * s), height: Math.round(track.displayHeight * s), fit: 'fill', poolSize: 3 });
      d = { it: sink.canvasesAtTimestamps(tsFor(i)), last: null, tex: gl.texture(), input, done: false };
      decs.set(i, d);
    }
    if (!d.done) {
      const r = await d.it.next();
      if (r.done) d.done = true;
      else if (r.value) {
        gl.upload(d.tex, r.value.canvas as TexImageSource);
        d.last = { tex: d.tex, w: r.value.canvas.width, h: r.value.canvas.height };
      }
    }
    return d.last;
  };
  const finishDec = (i: number) => {
    const d = decs.get(i);
    if (!d) return;
    d.it.return(undefined);
    d.input.dispose();
    gl.gl.deleteTexture(d.tex);
    decs.delete(i);
  };

  try {
    for (let f = 0; f < frames; f++) {
      if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
      const t = f / fps;
      const act = activeAt(p.clips, t, starts);
      const idx = act ? (act.a != null ? [act.a, act.b] : [act.b]) : [];
      const fr = new Map<number, Frame | null>();
      for (const i of idx) fr.set(i, await getFrame(i));
      // release decoders of clips that are finished
      for (const i of [...decs.keys()]) if (i < (act?.a ?? act?.b ?? 0)) finishDec(i);
      comp.render(p, t, (i) => fr.get(i) ?? null, null, true);
      fctx.clearRect(0, 0, W, H);
      fctx.drawImage(glCanvas, 0, 0);
      drawTitles(fctx, W, H, t, p.titles);
      await vsrc.add(t, 1 / fps);
      if (f % 5 === 0) onProgress(0.05 + 0.9 * (f / frames), `Rendering frame ${f + 1} of ${frames}`);
    }
    if (asrc && audioBuffer) {
      onProgress(0.96, 'Encoding audio…');
      await asrc.add(audioBuffer);
    }
    onProgress(0.98, 'Finalising file…');
    await output.finalize();
  } catch (err) {
    await output.cancel().catch(() => undefined);
    throw err;
  } finally {
    for (const i of [...decs.keys()]) finishDec(i);
    gl.dispose();
  }
  const buf = (output.target as BufferTarget).buffer!;
  const mime = mp4 ? 'video/mp4' : 'video/webm';
  onProgress(1, 'Done');
  return { blob: new Blob([buf], { type: mime }), ext: mp4 ? 'mp4' : 'webm', mime, width: W, height: H, codec: `${vcodec}${asrc ? ' + ' + acodec : ''}` };
}

/** Sample-accurate mixdown of clip audio (with speed, fades, transition crossfades) and music. */
async function mixAudio(p: Project, blobs: Map<string, Blob>, total: number, signal: AbortSignal): Promise<AudioBuffer | null> {
  const SR = 48000;
  const len = Math.max(1, Math.ceil(total * SR));
  const ctx = new OfflineAudioContext(2, len, SR);
  let any = false;
  const starts = clipStarts(p.clips);

  const schedule = async (mediaId: string, from: number, to: number, at: number, speed: number, gainFn: (g: GainNode, start: number, dur: number) => void) => {
    const blob = blobs.get(mediaId);
    if (!blob) return;
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
    try {
      const track = await input.getPrimaryAudioTrack();
      if (!track) return;
      const sink = new AudioBufferSink(track);
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      gainFn(gain, at, (to - from) / speed);
      for await (const { buffer, timestamp } of sink.buffers(Math.max(0, from - 0.05), to)) {
        if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.playbackRate.value = speed;
        src.connect(gain);
        const off = Math.max(0, from - timestamp);
        const when = at + Math.max(0, timestamp - from) / speed;
        const dur = Math.min(buffer.duration - off, to - Math.max(from, timestamp));
        if (dur <= 0) continue;
        src.start(when, off, dur);
        any = true;
      }
    } finally {
      input.dispose();
    }
  };

  for (let i = 0; i < p.clips.length; i++) {
    const c = p.clips[i];
    const m = p.media.find((x) => x.id === c.mediaId);
    if (!m || m.kind !== 'video' || !m.hasAudio || c.muted || c.volume <= 0) continue;
    const d = clipDur(c);
    const Tin = transDur(p.clips, i);
    const Tout = i + 1 < p.clips.length ? transDur(p.clips, i + 1) : 0;
    await schedule(c.mediaId, c.in, c.out, starts[i], c.speed, (g, s, dur) => {
      const v = c.volume;
      const fi = Math.max(c.fadeIn, Tin);
      const fo = Math.max(c.fadeOut, Tout);
      g.gain.setValueAtTime(fi > 0 ? 0 : v, s);
      if (fi > 0) g.gain.linearRampToValueAtTime(v, s + Math.min(fi, dur / 2));
      if (fo > 0) {
        g.gain.setValueAtTime(v, Math.max(s, s + dur - fo));
        g.gain.linearRampToValueAtTime(0, s + d);
      }
    });
  }
  for (const a of p.audio) {
    const len2 = a.out - a.in;
    const dur = Math.min(len2, total - a.start);
    if (dur <= 0 || a.volume <= 0) continue;
    await schedule(a.mediaId, a.in, a.in + dur, a.start, 1, (g, s) => {
      const v = a.volume;
      g.gain.setValueAtTime(a.fadeIn > 0 ? 0 : v, s);
      if (a.fadeIn > 0) g.gain.linearRampToValueAtTime(v, s + a.fadeIn);
      const fo = Math.max(a.fadeOut, 0);
      if (fo > 0) {
        g.gain.setValueAtTime(v, Math.max(s, s + dur - fo));
        g.gain.linearRampToValueAtTime(0, s + dur);
      }
    });
  }
  if (!any) return null;
  return ctx.startRendering();
}
