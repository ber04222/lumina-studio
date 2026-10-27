// Keeps one GPU renderer per canvas and survives React StrictMode's mount→unmount→mount
// cycle (disposing a WebGL context there would leave the canvas with a dead context).
const cache = new WeakMap<HTMLCanvasElement, { r: { dispose: () => void }; t: ReturnType<typeof setTimeout> | null }>();

export function acquireRenderer<T extends { dispose: () => void }>(canvas: HTMLCanvasElement, make: (c: HTMLCanvasElement) => T): T {
  const hit = cache.get(canvas);
  if (hit) {
    if (hit.t) clearTimeout(hit.t);
    hit.t = null;
    return hit.r as T;
  }
  const r = make(canvas);
  cache.set(canvas, { r, t: null });
  return r;
}

export function releaseRenderer(canvas: HTMLCanvasElement) {
  const hit = cache.get(canvas);
  if (!hit) return;
  hit.t = setTimeout(() => {
    hit.r.dispose();
    cache.delete(canvas);
  }, 500);
}
