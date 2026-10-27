// ─── Title rendering (identical for preview and export) ─────────────────────
import type { Title, TitleStyle } from '@/types/video';

const FONTS: Record<Title['font'], string> = {
  sans: 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: '"JetBrains Mono", ui-monospace, Menlo, monospace',
};

export const TITLE_PRESETS: Record<TitleStyle, Partial<Title> & { label: string }> = {
  title: { label: 'Title', x: 0.5, y: 0.5, size: 0.085, color: '#ffffff', bg: false, font: 'sans', anim: 'rise' },
  lower: { label: 'Lower third', x: 0.07, y: 0.8, size: 0.05, color: '#ffffff', bg: true, font: 'sans', anim: 'fade' },
  caption: { label: 'Caption', x: 0.5, y: 0.86, size: 0.045, color: '#ffffff', bg: true, font: 'sans', anim: 'fade' },
  bold: { label: 'Bold', x: 0.5, y: 0.5, size: 0.12, color: '#ffd23f', bg: false, font: 'sans', anim: 'pop' },
  minimal: { label: 'Minimal', x: 0.5, y: 0.5, size: 0.05, color: '#ffffff', bg: false, font: 'serif', anim: 'fade' },
};

const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

export function drawTitles(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, titles: Title[], selectedId?: string | null) {
  for (const ti of titles) {
    const local = t - ti.start;
    if (local < 0 || local > ti.duration || !ti.text.trim()) continue;
    const inP = ease(local / 0.45);
    const outP = ease((ti.duration - local) / 0.35);
    const k = Math.min(inP, outP);
    let alpha = ti.anim === 'none' ? 1 : k;
    let dy = 0;
    let scale = 1;
    let text = ti.text;
    if (ti.anim === 'rise') dy = (1 - k) * H * 0.04;
    if (ti.anim === 'pop') {
      scale = 0.7 + 0.3 * ease(local / 0.3) + Math.sin(Math.min(1, local / 0.3) * Math.PI) * 0.08;
      alpha = outP;
    }
    if (ti.anim === 'type') {
      const n = Math.floor((local / Math.max(0.3, Math.min(ti.duration * 0.6, ti.text.length * 0.06))) * ti.text.length);
      text = ti.text.slice(0, Math.max(0, n));
      alpha = outP;
    }
    const px = Math.max(8, ti.size * H);
    const minimal = ti.style === 'minimal';
    const upper = ti.style === 'bold' || minimal;
    ctx.save();
    ctx.globalAlpha = alpha;
    const weight = ti.style === 'bold' ? 800 : ti.style === 'title' ? 700 : minimal ? 400 : 600;
    ctx.font = `${weight} ${px}px ${FONTS[ti.font]}`;
    if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = minimal ? `${px * 0.25}px` : '0px';
    const lines = (upper ? text.toUpperCase() : text).split('\n');
    const lh = px * 1.18;
    const widths = lines.map((l) => ctx.measureText(l).width);
    const maxW = Math.max(1, ...widths);
    const left = ti.style === 'lower';
    const cx = ti.x * W;
    const cy = ti.y * H + dy;
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    const blockH = lh * lines.length;
    if (ti.bg) {
      const padX = px * 0.55, padY = px * 0.3;
      const bx = left ? -padX : -maxW / 2 - padX;
      ctx.fillStyle = ti.style === 'lower' ? 'rgba(10,10,12,0.72)' : 'rgba(0,0,0,0.6)';
      roundRect(ctx, bx, -blockH / 2 - padY, maxW + padX * 2, blockH + padY * 2, px * 0.22);
      ctx.fill();
      if (ti.style === 'lower') {
        ctx.fillStyle = ti.color === '#ffffff' ? '#4aa3ff' : ti.color;
        ctx.fillRect(bx, -blockH / 2 - padY, px * 0.14, blockH + padY * 2);
      }
    } else {
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = px * 0.25;
      ctx.shadowOffsetY = px * 0.04;
    }
    ctx.fillStyle = ti.color;
    ctx.textBaseline = 'middle';
    ctx.textAlign = left ? 'left' : 'center';
    lines.forEach((l, i) => ctx.fillText(l, left ? px * 0.1 : 0, -blockH / 2 + lh * (i + 0.5)));
    if (selectedId === ti.id) {
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = 'rgba(74,163,255,0.9)';
      ctx.lineWidth = Math.max(1.5, H * 0.003);
      ctx.setLineDash([6, 5]);
      ctx.strokeRect((left ? 0 : -maxW / 2) - px * 0.6, -blockH / 2 - px * 0.4, maxW + px * 1.2, blockH + px * 0.8);
    }
    ctx.restore();
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
