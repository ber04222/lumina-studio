import * as React from 'react';
import type { Crop, EditSettings, HealSpot, MaskComponent } from '@/types/edits';
import { cropInside, frameSize } from '@/engine/geometry';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  scale: number;
}

type Pt = { x: number; y: number };

/** Generic draggable handle (pointer-capturing). */
function Handle({ x, y, onDrag, onEnd, r = 11, dashed, label }: { x: number; y: number; onDrag: (sx: number, sy: number) => void; onEnd: () => void; r?: number; dashed?: boolean; label: string }) {
  const active = React.useRef(false);
  return (
    <g>
      <circle
        cx={x}
        cy={y}
        r={r + 10}
        fill="transparent"
        style={{ cursor: 'grab', touchAction: 'none' }}
        aria-label={label}
        onPointerDown={(e) => {
          e.stopPropagation();
          (e.target as Element).setPointerCapture(e.pointerId);
          active.current = true;
        }}
        onPointerMove={(e) => {
          if (!active.current) return;
          const svg = (e.target as SVGElement).ownerSVGElement!.getBoundingClientRect();
          onDrag(e.clientX - svg.left, e.clientY - svg.top);
        }}
        onPointerUp={() => {
          if (active.current) onEnd();
          active.current = false;
        }}
      />
      <circle cx={x} cy={y} r={r * 0.62} fill={dashed ? 'rgba(0,0,0,.35)' : 'hsl(211 95% 62%)'} stroke="white" strokeWidth={2} strokeDasharray={dashed ? '3 3' : undefined} pointerEvents="none" />
    </g>
  );
}

// ── Crop ────────────────────────────────────────────────────────────────────
export function CropOverlay({ rect, e, srcW, srcH, onChange, onCommit }: { rect: Rect; e: EditSettings; srcW: number; srcH: number; onChange: (c: Crop) => void; onCommit: () => void }) {
  const [fw, fh] = frameSize(e, srcW, srcH);
  const c = e.crop;
  const drag = React.useRef<{ mode: string; sx: number; sy: number; c: Crop } | null>(null);
  const [active, setActive] = React.useState(false);
  const X = rect.x + c.x * rect.w;
  const Y = rect.y + c.y * rect.h;
  const W = c.w * rect.w;
  const H = c.h * rect.h;

  const start = (mode: string) => (ev: React.PointerEvent) => {
    ev.stopPropagation();
    (ev.target as Element).setPointerCapture(ev.pointerId);
    drag.current = { mode, sx: ev.clientX, sy: ev.clientY, c: { ...c } };
    setActive(true);
  };
  const move = (ev: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (ev.clientX - d.sx) / rect.w;
    const dy = (ev.clientY - d.sy) / rect.h;
    let n = { ...d.c };
    const min = 0.04;
    if (d.mode === 'move') {
      n.x = Math.min(1 - n.w, Math.max(0, d.c.x + dx));
      n.y = Math.min(1 - n.h, Math.max(0, d.c.y + dy));
    } else {
      if (d.mode.includes('l')) { n.x = Math.min(d.c.x + d.c.w - min, d.c.x + dx); n.w = d.c.x + d.c.w - n.x; }
      if (d.mode.includes('r')) n.w = Math.max(min, d.c.w + dx);
      if (d.mode.includes('t')) { n.y = Math.min(d.c.y + d.c.h - min, d.c.y + dy); n.h = d.c.y + d.c.h - n.y; }
      if (d.mode.includes('b')) n.h = Math.max(min, d.c.h + dy);
      if (e.aspect) {
        // keep aspect: derive height from width (or width from height for top/bottom-only drags)
        const k = fw / (fh * e.aspect);
        if (d.mode === 't' || d.mode === 'b') {
          const nw = n.h / k;
          n.x = d.c.x + (d.c.w - nw) / 2;
          n.w = nw;
        } else {
          const nh = n.w * k;
          if (d.mode.includes('t')) n.y = d.c.y + d.c.h - nh;
          else if (!d.mode.includes('b')) n.y = d.c.y + (d.c.h - nh) / 2;
          n.h = nh;
        }
      }
    }
    if (!cropInside(n, e.angle, fw, fh)) {
      // clamp into the frame; if still outside (straightened corners) keep the last valid crop
      n = { x: Math.max(0, n.x), y: Math.max(0, n.y), w: Math.min(n.w, 1 - Math.max(0, n.x)), h: Math.min(n.h, 1 - Math.max(0, n.y)) };
      if (e.aspect) return;
      if (!cropInside(n, e.angle, fw, fh)) return;
    }
    onChange(n);
  };
  const end = () => {
    if (drag.current) onCommit();
    drag.current = null;
    setActive(false);
  };
  const handles: [string, number, number][] = [
    ['tl', X, Y], ['tr', X + W, Y], ['bl', X, Y + H], ['br', X + W, Y + H],
    ['t', X + W / 2, Y], ['b', X + W / 2, Y + H], ['l', X, Y + H / 2], ['r', X + W, Y + H / 2],
  ];
  const cursor: Record<string, string> = { tl: 'nwse-resize', br: 'nwse-resize', tr: 'nesw-resize', bl: 'nesw-resize', t: 'ns-resize', b: 'ns-resize', l: 'ew-resize', r: 'ew-resize' };
  return (
    <svg className="absolute inset-0 h-full w-full" onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
      <path d={`M0,0H9999V9999H0Z M${X},${Y}v${H}h${W}v${-H}Z`} fill="rgba(0,0,0,0.55)" fillRule="evenodd" pointerEvents="none" />
      <rect x={X} y={Y} width={W} height={H} fill="transparent" stroke="white" strokeWidth={1.5} style={{ cursor: 'move', touchAction: 'none' }} onPointerDown={start('move')} />
      {(active ? [1 / 3, 2 / 3] : []).map((t) => (
        <g key={t} stroke="rgba(255,255,255,.45)" pointerEvents="none">
          <line x1={X + W * t} y1={Y} x2={X + W * t} y2={Y + H} />
          <line x1={X} y1={Y + H * t} x2={X + W} y2={Y + H * t} />
        </g>
      ))}
      {handles.map(([id, hx, hy]) => (
        <g key={id}>
          <rect x={hx - 16} y={hy - 16} width={32} height={32} fill="transparent" style={{ cursor: cursor[id], touchAction: 'none' }} onPointerDown={start(id)} />
          {id.length === 2 ? (
            <path d={`M${hx + (id[1] === 'l' ? 16 : -16)},${hy} H${hx} V${hy + (id[0] === 't' ? 16 : -16)}`} stroke="white" strokeWidth={3.5} fill="none" pointerEvents="none" />
          ) : (
            <rect x={id === 'l' || id === 'r' ? hx - 2 : hx - 10} y={id === 't' || id === 'b' ? hy - 2 : hy - 10} width={id === 'l' || id === 'r' ? 4 : 20} height={id === 't' || id === 'b' ? 4 : 20} fill="white" pointerEvents="none" />
          )}
        </g>
      ))}
      <text x={X + 6} y={Y + H - 8} fill="rgba(255,255,255,.8)" fontSize={11} fontFamily="JetBrains Mono, monospace" pointerEvents="none">
        {Math.round(c.w * fw)} × {Math.round(c.h * fh)}
      </text>
    </svg>
  );
}

// ── Linear / radial mask handles ───────────────────────────────────────────
export function MaskHandles({ comp, toScreen, toSource, srcW, srcH, onChange, onCommit }: { comp: MaskComponent; toScreen: (p: Pt) => Pt; toSource: (p: Pt) => Pt; srcW: number; srcH: number; onChange: (c: MaskComponent) => void; onCommit: () => void }) {
  if (comp.type === 'linear') {
    const a = toScreen({ x: comp.x0, y: comp.y0 });
    const b = toScreen({ x: comp.x1, y: comp.y1 });
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * 2000, ny = (dx / len) * 2000;
    return (
      <svg className="pointer-events-none absolute inset-0 h-full w-full">
        <line x1={a.x - nx} y1={a.y - ny} x2={a.x + nx} y2={a.y + ny} stroke="white" strokeWidth={1.5} />
        <line x1={(a.x + b.x) / 2 - nx} y1={(a.y + b.y) / 2 - ny} x2={(a.x + b.x) / 2 + nx} y2={(a.y + b.y) / 2 + ny} stroke="rgba(255,255,255,.5)" strokeWidth={1} />
        <line x1={b.x - nx} y1={b.y - ny} x2={b.x + nx} y2={b.y + ny} stroke="white" strokeWidth={1.5} strokeDasharray="6 5" />
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="rgba(255,255,255,.6)" strokeWidth={1} />
        <g className="pointer-events-auto">
          <Handle label="Gradient start" x={a.x} y={a.y} onDrag={(sx, sy) => { const p = toSource({ x: sx, y: sy }); onChange({ ...comp, x0: p.x, y0: p.y }); }} onEnd={onCommit} />
          <Handle label="Gradient end" dashed x={b.x} y={b.y} onDrag={(sx, sy) => { const p = toSource({ x: sx, y: sy }); onChange({ ...comp, x1: p.x, y1: p.y }); }} onEnd={onCommit} />
        </g>
      </svg>
    );
  }
  if (comp.type === 'radial') {
    const ang = (comp.angle * Math.PI) / 180;
    const pt = (t: number, k = 1) => {
      const ux = Math.cos(t) * comp.rx * srcW * k, uy = Math.sin(t) * comp.ry * srcH * k;
      return toScreen({ x: comp.cx + (Math.cos(ang) * ux - Math.sin(ang) * uy) / srcW, y: comp.cy + (Math.sin(ang) * ux + Math.cos(ang) * uy) / srcH });
    };
    const ring = (k: number) => Array.from({ length: 49 }, (_, i) => pt((i / 48) * Math.PI * 2, k)).map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ');
    const c = toScreen({ x: comp.cx, y: comp.cy });
    const ex = pt(0);
    const ey = pt(Math.PI / 2);
    const dist = (sx: number, sy: number) => {
      const p = toSource({ x: sx, y: sy });
      const px = (p.x - comp.cx) * srcW, py = (p.y - comp.cy) * srcH;
      return { u: Math.cos(-ang) * px - Math.sin(-ang) * py, v: Math.sin(-ang) * px + Math.cos(-ang) * py };
    };
    return (
      <svg className="pointer-events-none absolute inset-0 h-full w-full">
        <path d={ring(1)} fill="none" stroke="white" strokeWidth={1.5} />
        <path d={ring(Math.max(0.05, 1 - comp.feather / 100))} fill="none" stroke="rgba(255,255,255,.5)" strokeDasharray="4 4" />
        <g className="pointer-events-auto">
          <Handle label="Move radial" x={c.x} y={c.y} onDrag={(sx, sy) => { const p = toSource({ x: sx, y: sy }); onChange({ ...comp, cx: p.x, cy: p.y }); }} onEnd={onCommit} />
          <Handle label="Radial width" r={8} x={ex.x} y={ex.y} onDrag={(sx, sy) => onChange({ ...comp, rx: Math.max(0.01, Math.abs(dist(sx, sy).u) / srcW) })} onEnd={onCommit} />
          <Handle label="Radial height" r={8} x={ey.x} y={ey.y} onDrag={(sx, sy) => onChange({ ...comp, ry: Math.max(0.01, Math.abs(dist(sx, sy).v) / srcH) })} onEnd={onCommit} />
        </g>
      </svg>
    );
  }
  return null;
}

// ── Heal spots ─────────────────────────────────────────────────────────────
export function HealOverlay({ heals, toScreen, toSource, scalePx, onMove, onCommit, interactive }: { heals: HealSpot[]; toScreen: (p: Pt) => Pt; toSource: (p: Pt) => Pt; scalePx: number; onMove: (id: string, dx: number, dy: number) => void; onCommit: () => void; interactive: boolean }) {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full">
      {heals.map((h) => {
        const pts = h.points.map(toScreen);
        const src = h.points.map((p) => toScreen({ x: p.x + h.dx, y: p.y + h.dy }));
        const w = Math.max(4, h.size * scalePx * 2);
        const path = (ps: Pt[]) => ps.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ') + (ps.length === 1 ? ' l0.01,0' : '');
        const sc = src[Math.floor(src.length / 2)];
        const tc = pts[Math.floor(pts.length / 2)];
        return (
          <g key={h.id}>
            <path d={path(pts)} stroke="rgba(255,255,255,.85)" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={0.25} />
            <path d={path(src)} stroke="white" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={0.18} strokeDasharray="4 4" />
            <line x1={tc.x} y1={tc.y} x2={sc.x} y2={sc.y} stroke="rgba(255,255,255,.6)" strokeDasharray="3 3" />
            {interactive && (
              <g className="pointer-events-auto">
                <Handle
                  label="Heal source"
                  dashed
                  r={9}
                  x={sc.x}
                  y={sc.y}
                  onDrag={(sx, sy) => {
                    const p = toSource({ x: sx, y: sy });
                    const mid = h.points[Math.floor(h.points.length / 2)];
                    onMove(h.id, p.x - mid.x, p.y - mid.y);
                  }}
                  onEnd={onCommit}
                />
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}
