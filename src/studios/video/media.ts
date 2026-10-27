// ─── Media probing, thumbnails and waveforms ────────────────────────────────
import { ALL_FORMATS, AudioBufferSink, BlobSource, CanvasSink, Input } from 'mediabunny';
import type { MediaRef } from '@/types/video';

export function mediaKind(f: File): MediaRef['kind'] | null {
  if (f.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|mkv)$/i.test(f.name)) return 'video';
  if (f.type.startsWith('image/') || /\.(jpe?g|png|webp|avif|heic|gif)$/i.test(f.name)) return 'image';
  if (f.type.startsWith('audio/') || /\.(mp3|m4a|aac|wav|ogg|opus|flac)$/i.test(f.name)) return 'audio';
  return null;
}

function elementProbe(blob: Blob, kind: 'video' | 'audio'): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((res, rej) => {
    const el = document.createElement(kind);
    const url = URL.createObjectURL(blob);
    el.preload = 'metadata';
    el.onloadedmetadata = () => {
      const v = el as HTMLVideoElement;
      res({ duration: isFinite(el.duration) ? el.duration : 0, width: v.videoWidth || 0, height: v.videoHeight || 0 });
      URL.revokeObjectURL(url);
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      rej(new Error('This file format is not supported by your browser.'));
    };
    el.src = url;
  });
}

export async function probe(file: File, id: string): Promise<MediaRef> {
  const kind = mediaKind(file);
  if (!kind) throw new Error(`${file.name}: unsupported file type`);
  if (kind === 'image') {
    const bmp = await createImageBitmap(file);
    const r: MediaRef = { id, name: file.name, kind, duration: 4, width: bmp.width, height: bmp.height, hasAudio: false };
    bmp.close();
    return r;
  }
  try {
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
    const vt = kind === 'video' ? await input.getPrimaryVideoTrack() : null;
    const at = await input.getPrimaryAudioTrack();
    const duration = await input.computeDuration();
    const ref: MediaRef = { id, name: file.name, kind, duration, width: vt?.displayWidth ?? 0, height: vt?.displayHeight ?? 0, hasAudio: !!at };
    input.dispose();
    if (kind === 'video' && !vt) throw new Error('no video track');
    return ref;
  } catch {
    const m = await elementProbe(file, kind);
    return { id, name: file.name, kind, duration: m.duration, width: m.width, height: m.height, hasAudio: true };
  }
}

const thumbCache = new Map<string, string[]>();

/** Evenly spaced filmstrip thumbnails for a media item (cached). */
export async function filmstrip(m: MediaRef, blob: Blob, count = 8, height = 56): Promise<string[]> {
  const key = `${m.id}:${count}:${height}`;
  const hit = thumbCache.get(key);
  if (hit) return hit;
  let out: string[] = [];
  if (m.kind === 'image') {
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.height = height;
    c.width = Math.round((bmp.width / bmp.height) * height);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    out = [c.toDataURL('image/jpeg', 0.7)];
  } else if (m.kind === 'video') {
    try {
      const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
      const track = await input.getPrimaryVideoTrack();
      if (!track) throw new Error('no track');
      const sink = new CanvasSink(track, { height, poolSize: 0 });
      const ts = Array.from({ length: count }, (_, i) => ((i + 0.5) / count) * m.duration);
      for await (const wc of sink.canvasesAtTimestamps(ts)) {
        if (!wc) continue;
        const c = wc.canvas as HTMLCanvasElement | OffscreenCanvas;
        if (c instanceof HTMLCanvasElement) out.push(c.toDataURL('image/jpeg', 0.7));
        else {
          const b = await (c as OffscreenCanvas).convertToBlob({ type: 'image/jpeg', quality: 0.7 });
          out.push(await new Promise<string>((r) => {
            const fr = new FileReader();
            fr.onload = () => r(fr.result as string);
            fr.readAsDataURL(b);
          }));
        }
      }
      input.dispose();
    } catch {
      out = await elementFilmstrip(blob, m.duration, count, height);
    }
  }
  thumbCache.set(key, out);
  return out;
}

async function elementFilmstrip(blob: Blob, duration: number, count: number, height: number): Promise<string[]> {
  const v = document.createElement('video');
  v.muted = true;
  v.preload = 'auto';
  const url = URL.createObjectURL(blob);
  v.src = url;
  await new Promise<void>((r) => (v.onloadeddata = () => r()));
  const out: string[] = [];
  const c = document.createElement('canvas');
  c.height = height;
  c.width = Math.round((v.videoWidth / v.videoHeight) * height) || height;
  for (let i = 0; i < count; i++) {
    await new Promise<void>((r) => {
      v.onseeked = () => r();
      v.currentTime = ((i + 0.5) / count) * duration;
    });
    c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
    out.push(c.toDataURL('image/jpeg', 0.7));
  }
  URL.revokeObjectURL(url);
  return out;
}

const waveCache = new Map<string, Float32Array>();

/** Peak envelope (0..1) for drawing audio waveforms. */
export async function waveform(m: MediaRef, blob: Blob, buckets = 400): Promise<Float32Array | null> {
  if (!m.hasAudio && m.kind !== 'audio') return null;
  const key = `${m.id}:${buckets}`;
  const hit = waveCache.get(key);
  if (hit) return hit;
  const peaks = new Float32Array(buckets);
  const dur = Math.max(0.01, m.duration);
  try {
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
    const track = await input.getPrimaryAudioTrack();
    if (!track) return null;
    const sink = new AudioBufferSink(track);
    for await (const { buffer, timestamp } of sink.buffers()) {
      const ch = buffer.getChannelData(0);
      const sr = buffer.sampleRate;
      const step = Math.max(1, Math.floor(ch.length / 64));
      for (let i = 0; i < ch.length; i += step) {
        const b = Math.min(buckets - 1, Math.floor(((timestamp + i / sr) / dur) * buckets));
        const v = Math.abs(ch[i]);
        if (v > peaks[b]) peaks[b] = v;
      }
    }
    input.dispose();
  } catch {
    try {
      const ac = new OfflineAudioContext(1, 1, 44100);
      const buf = await ac.decodeAudioData(await blob.arrayBuffer());
      const ch = buf.getChannelData(0);
      const per = Math.max(1, Math.floor(ch.length / buckets));
      for (let b = 0; b < buckets; b++) {
        let mx = 0;
        for (let i = b * per; i < Math.min(ch.length, (b + 1) * per); i += 8) mx = Math.max(mx, Math.abs(ch[i]));
        peaks[b] = mx;
      }
    } catch {
      return null;
    }
  }
  const mx = Math.max(0.01, ...peaks);
  for (let i = 0; i < buckets; i++) peaks[i] = Math.sqrt(peaks[i] / mx);
  waveCache.set(key, peaks);
  return peaks;
}
