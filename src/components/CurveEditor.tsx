import * as React from 'react';
import type { CurvePoint, EditSettings } from '@/types/edits';
import { identityCurve } from '@/types/edits';
import { buildCurve } from '@/engine/color';
import { Segmented } from './ui';
import { RotateCcw } from 'lucide-react';

type Ch = 'master' | 'r' | 'g' | 'b';
const COLORS: Record<Ch, string> = { master: '#e8e8e8', r: '#ff5a5f', g: '#46d36a', b: '#5b8cff' };

/** Point curve editor: tap to add, drag to move, double-tap (or drag off) to delete. */
export function CurveEditor({ curves, onChange, onCommit, histogram }: { curves: EditSettings['curves']; onChange: (c: EditSettings['curves']) => void; onCommit: () => void; histogram?: number[] | null }) {
  const [ch, setCh] = React.useState<Ch>('master');
  const ref = React.useRef<SVGSVGElement>(null);
  const drag = React.useRef<{ idx: number } | null>(null);
  const lastTap = React.useRef<{ t: number; idx: number }>({ t: 0, idx: -1 });
  const pts = curves[ch];
  const S = 256;

  const path = React.useMemo(() => {
    const lut = new Float32Array(128);
    buildCurve(pts, lut);
    return Array.from(lut, (y, i) => `${i ? 'L' : 'M'}${(i / 127) * S},${(1 - y) * S}`).join(' ');
  }, [pts]);

  const toLocal = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height)) };
  };
  const setPts = (p: CurvePoint[]) => onChange({ ...curves, [ch]: p });

  const down = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const p = toLocal(e);
    const r = ref.current!.getBoundingClientRect();
    const hit = pts.findIndex((q) => Math.hypot((q.x - p.x) * r.width, (q.y - p.y) * r.height) < 18);
    const now = performance.now();
    if (hit >= 0) {
      if (now - lastTap.current.t < 320 && lastTap.current.idx === hit && hit > 0 && hit < pts.length - 1) {
        setPts(pts.filter((_, i) => i !== hit));
        onCommit();
        lastTap.current = { t: 0, idx: -1 };
        return;
      }
      lastTap.current = { t: now, idx: hit };
      drag.current = { idx: hit };
      return;
    }
    const next = [...pts, p].sort((a, b) => a.x - b.x);
    drag.current = { idx: next.indexOf(p) };
    setPts(next);
  };
  const move = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const p = toLocal(e);
    const i = drag.current.idx;
    const next = pts.map((q) => ({ ...q }));
    const last = next.length - 1;
    if (i === 0) next[0] = { x: Math.min(p.x, next[1].x - 0.02), y: p.y };
    else if (i === last) next[last] = { x: Math.max(p.x, next[last - 1].x + 0.02), y: p.y };
    else {
      // drag far outside → delete point
      const r = ref.current!.getBoundingClientRect();
      if (e.clientY < r.top - 40 || e.clientY > r.bottom + 40) {
        drag.current = null;
        setPts(next.filter((_, k) => k !== i));
        onCommit();
        return;
      }
      next[i] = { x: Math.min(next[i + 1].x - 0.01, Math.max(next[i - 1].x + 0.01, p.x)), y: p.y };
    }
    setPts(next);
  };
  const up = () => {
    if (drag.current) onCommit();
    drag.current = null;
  };

  const hist = histogram && histogram.length ? histogram : null;
  const hmax = hist ? Math.max(...hist.slice(2, -2), 1) : 1;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Segmented
          className="flex-1"
          value={ch}
          onChange={setCh}
          items={[
            { id: 'master', label: 'RGB' },
            { id: 'r', label: <span className="text-[#ff7a7f]">Red</span> },
            { id: 'g', label: <span className="text-[#5be07c]">Green</span> },
            { id: 'b', label: <span className="text-[#7ea4ff]">Blue</span> },
          ]}
        />
        <button type="button" className="icon-btn h-9 w-9" title="Reset channel" onClick={() => { setPts(identityCurve()); onCommit(); }}>
          <RotateCcw size={16} />
        </button>
      </div>
      <svg
        ref={ref}
        viewBox={`0 0 ${S} ${S}`}
        className="mx-auto aspect-square w-full max-w-[300px] touch-none rounded-lg bg-[#141416] ring-1 ring-line"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        role="img"
        aria-label="Tone curve"
      >
        {hist && (
          <path
            d={`M0,${S} ` + hist.map((v, i) => `L${(i / (hist.length - 1)) * S},${S - (Math.min(1, v / hmax) * S * 0.9)}`).join(' ') + ` L${S},${S} Z`}
            fill="rgba(255,255,255,0.06)"
          />
        )}
        {[0.25, 0.5, 0.75].map((v) => (
          <g key={v} stroke="rgba(255,255,255,0.07)">
            <line x1={v * S} y1={0} x2={v * S} y2={S} />
            <line x1={0} y1={v * S} x2={S} y2={v * S} />
          </g>
        ))}
        <line x1={0} y1={S} x2={S} y2={0} stroke="rgba(255,255,255,0.12)" strokeDasharray="3 4" />
        <path d={path} fill="none" stroke={COLORS[ch]} strokeWidth={2} />
        {pts.map((p, i) => (
          <circle key={i} cx={p.x * S} cy={(1 - p.y) * S} r={6} fill="#141416" stroke={COLORS[ch]} strokeWidth={2} />
        ))}
      </svg>
      <p className="text-center text-[11px] text-faint">Tap to add a point · drag to shape · double-tap a point to remove</p>
    </div>
  );
}
