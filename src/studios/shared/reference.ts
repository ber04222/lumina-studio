// ─── Colour-match references from photos or videos ──────────────────────────
import type { ColorStats } from '@/types/edits';
import { computeStats, sampleImage } from '@/engine/color';

export interface RefResult {
  stats: ColorStats;
  thumb: string;
  name: string;
}

function thumbOf(src: CanvasImageSource, w: number, h: number, size = 160) {
  const s = size / Math.max(w, h);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * s));
  c.height = Math.max(1, Math.round(h * s));
  c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82);
}

export async function referenceFromImage(src: CanvasImageSource, w: number, h: number, name: string): Promise<RefResult> {
  return { stats: computeStats([sampleImage(src, w, h, 256)]), thumb: thumbOf(src, w, h), name };
}

/** Samples frames across a video so the "look" is captured from the whole clip. */
export async function referenceFromVideo(blob: Blob, name: string, frames = 8, range?: [number, number]): Promise<RefResult> {
  const url = URL.createObjectURL(blob);
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.src = url;
  try {
    await new Promise<void>((res, rej) => {
      v.onloadeddata = () => res();
      v.onerror = () => rej(new Error('This video format cannot be read by your browser.'));
    });
    const dur = isFinite(v.duration) ? v.duration : 1;
    const [a, b] = range ?? [0, dur];
    const imgs: ImageData[] = [];
    let thumb = '';
    for (let i = 0; i < frames; i++) {
      const t = a + ((i + 0.5) / frames) * (b - a);
      await new Promise<void>((res) => {
        const done = () => {
          v.removeEventListener('seeked', done);
          res();
        };
        v.addEventListener('seeked', done);
        v.currentTime = Math.min(dur - 0.05, Math.max(0, t));
        setTimeout(done, 2500);
      });
      imgs.push(sampleImage(v, v.videoWidth, v.videoHeight, 192));
      if (i === Math.floor(frames / 2)) thumb = thumbOf(v, v.videoWidth, v.videoHeight);
    }
    return { stats: computeStats(imgs), thumb, name };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function referenceFromFile(file: File): Promise<RefResult> {
  if (file.type.startsWith('video/')) return referenceFromVideo(file, file.name);
  const bmp = await createImageBitmap(file);
  try {
    return await referenceFromImage(bmp, bmp.width, bmp.height, file.name);
  } finally {
    bmp.close();
  }
}
