// ─── Scopes: histogram, luma/RGB waveform, vectorscope ──────────────────────

export type ScopeKind = 'histogram' | 'waveform' | 'parade' | 'vectorscope';

export function drawScope(kind: ScopeKind, img: ImageData, canvas: HTMLCanvasElement) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const H = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);
  const d = img.data;
  const n = img.width * img.height;
  if (kind === 'histogram') {
    const bins = [new Float32Array(256), new Float32Array(256), new Float32Array(256)];
    for (let p = 0; p < n; p++) for (let c = 0; c < 3; c++) bins[c][d[p * 4 + c]]++;
    let mx = 1;
    for (const b of bins) for (let i = 2; i < 254; i++) mx = Math.max(mx, b[i]);
    ctx.globalCompositeOperation = 'lighter';
    const cols = ['rgba(255,70,70,0.55)', 'rgba(70,220,90,0.55)', 'rgba(80,130,255,0.6)'];
    bins.forEach((b, c) => {
      ctx.fillStyle = cols[c];
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let i = 0; i < 256; i++) ctx.lineTo((i / 255) * W, H - Math.min(1, b[i] / mx) * H * 0.95);
      ctx.lineTo(W, H);
      ctx.fill();
    });
    ctx.globalCompositeOperation = 'source-over';
    return;
  }
  const out = ctx.createImageData(W, H);
  const o = out.data;
  const plot = (x: number, y: number, r: number, g: number, b: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = ((y | 0) * W + (x | 0)) * 4;
    o[i] = Math.min(255, o[i] + r);
    o[i + 1] = Math.min(255, o[i + 1] + g);
    o[i + 2] = Math.min(255, o[i + 2] + b);
    o[i + 3] = 255;
  };
  const k = Math.max(6, Math.round(60000 / n) * 6);
  if (kind === 'waveform' || kind === 'parade') {
    for (let y = 0; y < img.height; y++)
      for (let x = 0; x < img.width; x++) {
        const i = (y * img.width + x) * 4;
        if (kind === 'waveform') {
          const L = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
          plot((x / img.width) * W, H - 1 - (L / 255) * (H - 1), k, k, k);
        } else {
          const third = W / 3;
          plot((x / img.width) * third, H - 1 - (d[i] / 255) * (H - 1), k, 0, 0);
          plot(third + (x / img.width) * third, H - 1 - (d[i + 1] / 255) * (H - 1), 0, k, 0);
          plot(2 * third + (x / img.width) * third, H - 1 - (d[i + 2] / 255) * (H - 1), 0, 0, k);
        }
      }
  } else {
    const R = Math.min(W, H) / 2 - 2;
    const cx = W / 2, cy = H / 2;
    for (let p = 0; p < n; p++) {
      const r = d[p * 4] / 255, g = d[p * 4 + 1] / 255, b = d[p * 4 + 2] / 255;
      const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const cb = (b - Y) / 1.8556;
      const cr = (r - Y) / 1.5748;
      plot(cx + cb * R * 2, cy - cr * R * 2, d[p * 4] * 0.08 + 4, d[p * 4 + 1] * 0.08 + 4, d[p * 4 + 2] * 0.08 + 4);
    }
  }
  ctx.putImageData(out, 0, 0);
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  if (kind === 'vectorscope') {
    const R = Math.min(W, H) / 2 - 2;
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, R, 0, Math.PI * 2);
    ctx.stroke();
    // skin-tone line (~123°)
    ctx.beginPath();
    ctx.moveTo(W / 2, H / 2);
    ctx.lineTo(W / 2 + Math.cos((-123 * Math.PI) / 180) * R, H / 2 + Math.sin((-123 * Math.PI) / 180) * R);
    ctx.stroke();
  } else {
    for (const v of [0.25, 0.5, 0.75]) {
      ctx.beginPath();
      ctx.moveTo(0, H * v);
      ctx.lineTo(W, H * v);
      ctx.stroke();
    }
  }
}
