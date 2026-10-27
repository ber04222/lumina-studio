import * as React from 'react';
import type { Wheel as W } from '@/types/edits';
import { hsv2rgb } from '@/engine/color';
import { Slider } from './Slider';

/** DaVinci/Lightroom style colour wheel: drag the puck for hue + strength, slider for luminance. */
export function ColorWheel({ label, value, onChange, onCommit, size = 132 }: { label: string; value: W; onChange: (w: W) => void; onCommit: () => void; size?: number }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const dragging = React.useRef(false);
  const lastTap = React.useRef(0);
  const R = size / 2;
  const a = (value.h * Math.PI) / 180;
  const px = R + Math.cos(a) * (value.s / 100) * (R - 8);
  const py = R - Math.sin(a) * (value.s / 100) * (R - 8);
  const [r, g, b] = hsv2rgb(value.h, Math.min(1, value.s / 100), 1);

  const set = (e: React.PointerEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    const x = e.clientX - rect.left - R;
    const y = -(e.clientY - rect.top - R);
    let h = (Math.atan2(y, x) * 180) / Math.PI;
    if (h < 0) h += 360;
    const s = Math.min(100, (Math.hypot(x, y) / (R - 8)) * 100);
    onChange({ ...value, h: Math.round(h), s: Math.round(s) });
  };
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="label-xs mb-1">{label}</div>
      <div
        ref={ref}
        className="relative touch-none rounded-full"
        style={{
          width: size,
          height: size,
          background: 'radial-gradient(circle, rgba(128,128,128,1) 0%, rgba(128,128,128,0) 72%), conic-gradient(from 90deg, #f33, #f3f, #33f, #3ff, #3f3, #ff3, #f33)',
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.08)',
        }}
        onPointerDown={(e) => {
          const now = performance.now();
          if (now - lastTap.current < 300) {
            onChange({ ...value, s: 0 });
            onCommit();
            return;
          }
          lastTap.current = now;
          dragging.current = true;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          set(e);
        }}
        onPointerMove={(e) => dragging.current && set(e)}
        onPointerUp={() => {
          if (dragging.current) onCommit();
          dragging.current = false;
        }}
        role="group"
        aria-label={`${label} colour wheel`}
      >
        <div className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/40" />
        <div
          className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,.5)]"
          style={{ left: px, top: py, background: `rgb(${r * 255},${g * 255},${b * 255})` }}
        />
      </div>
      <div className="w-full max-w-[150px]">
        <Slider label="Lum" value={value.l} min={-100} max={100} onChange={(l) => onChange({ ...value, l })} onCommit={onCommit} track="lum" />
      </div>
      <div className="font-mono text-[10px] text-faint">H {value.h}° · S {value.s}</div>
    </div>
  );
}
