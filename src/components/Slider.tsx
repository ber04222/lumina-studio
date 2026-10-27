import * as React from 'react';
import { cn } from '@/lib/utils';

export type TrackStyle = 'default' | 'temp' | 'tint' | 'hue' | 'sat' | 'lum' | 'exposure';

const TRACKS: Record<Exclude<TrackStyle, 'default'>, string> = {
  temp: 'linear-gradient(90deg,#3d7bd9,#d8d8d8 50%,#e9b540)',
  tint: 'linear-gradient(90deg,#3cb85a,#d8d8d8 50%,#d14fc4)',
  hue: 'linear-gradient(90deg,#e5484d,#f5d90a,#46a758,#12a594,#3e63dd,#8e4ec6,#e5484d)',
  sat: 'linear-gradient(90deg,#8a8a8a,#e5484d)',
  lum: 'linear-gradient(90deg,#111,#eee)',
  exposure: 'linear-gradient(90deg,#111,#888 50%,#fafafa)',
};

export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  defaultValue?: number;
  onChange: (v: number) => void;
  onCommit?: () => void;
  format?: (v: number) => string;
  track?: TrackStyle | string;
  disabled?: boolean;
  className?: string;
}

/**
 * Lightroom-mobile style slider: label + value on top, thin track with a fill from
 * the neutral point. Relative dragging anywhere on the row (fine control), double-tap
 * to reset, arrow keys for accessibility.
 */
export function Slider({ label, value, min, max, step = 1, defaultValue, onChange, onCommit, format, track = 'default', disabled, className }: SliderProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const drag = React.useRef<{ x: number; v: number; id: number; moved: boolean } | null>(null);
  const lastTap = React.useRef(0);
  const def = defaultValue ?? (min < 0 ? 0 : min);
  const range = max - min;
  const pct = ((value - min) / range) * 100;
  const zero = ((Math.min(max, Math.max(min, def)) - min) / range) * 100;
  const snap = (v: number) => {
    const s = Math.round(v / step) * step;
    return Math.min(max, Math.max(min, +s.toFixed(4)));
  };
  const shown = format ? format(value) : (min < 0 && value > 0 ? '+' : '') + (step < 1 ? value.toFixed(step < 0.1 ? 2 : 1) : Math.round(value));

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    const now = performance.now();
    if (now - lastTap.current < 300) {
      onChange(def);
      onCommit?.();
      lastTap.current = 0;
      return;
    }
    lastTap.current = now;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, v: value, id: e.pointerId, moved: false };
    // tap directly on the track jumps there (desktop convenience)
    const r = ref.current?.getBoundingClientRect();
    if (r && e.pointerType === 'mouse' && e.clientY >= r.top - 6 && e.clientY <= r.bottom + 6) {
      const v = snap(min + ((e.clientX - r.left) / r.width) * range);
      drag.current.v = v;
      onChange(v);
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId || !ref.current) return;
    const w = ref.current.getBoundingClientRect().width || 1;
    const fine = e.shiftKey ? 0.25 : 1;
    const v = snap(d.v + ((e.clientX - d.x) / w) * range * fine);
    if (Math.abs(e.clientX - d.x) > 2) d.moved = true;
    if (v !== value) onChange(v);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (drag.current?.id === e.pointerId) {
      drag.current = null;
      onCommit?.();
    }
  };
  const onKey = (e: React.KeyboardEvent) => {
    const k = e.key;
    let v = value;
    const big = e.shiftKey ? 10 : 1;
    if (k === 'ArrowRight' || k === 'ArrowUp') v = snap(value + step * big);
    else if (k === 'ArrowLeft' || k === 'ArrowDown') v = snap(value - step * big);
    else if (k === 'Home') v = min;
    else if (k === 'End') v = max;
    else if (k === 'Backspace' || k === 'Delete') v = def;
    else return;
    e.preventDefault();
    onChange(v);
    onCommit?.();
  };

  const bg = track === 'default' ? undefined : TRACKS[track as keyof typeof TRACKS] ?? track;
  const lo = Math.min(pct, zero);
  const hi = Math.max(pct, zero);
  const changed = Math.abs(value - def) > 1e-6;

  return (
    <div
      className={cn('group relative select-none py-2 [touch-action:pan-y]', disabled && 'opacity-40', className)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={shown}
      onKeyDown={onKey}
    >
      <div className="mb-2 flex items-baseline justify-between text-[13px] leading-none">
        <span className={cn('text-dim', changed && 'text-fg')}>{label}</span>
        <span className={cn('font-mono text-[12px] tabular-nums text-faint', changed && 'text-fg')}>{shown}</span>
      </div>
      <div ref={ref} className="relative h-[3px] rounded-full" style={{ background: bg ?? 'hsl(var(--widget))' }}>
        {!bg && <div className="absolute inset-y-0 rounded-full bg-fg/85" style={{ left: `${lo}%`, width: `${hi - lo}%` }} />}
        {min < 0 && <div className="absolute -top-[3px] h-[9px] w-px bg-fg/30" style={{ left: `${zero}%` }} />}
        <div
          className="absolute top-1/2 h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[2.5px] border-bg bg-fg shadow-[0_1px_4px_rgba(0,0,0,.6)] transition-transform group-active:scale-110"
          style={{ left: `${pct}%` }}
        />
      </div>
    </div>
  );
}
