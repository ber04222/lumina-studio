import * as React from 'react';
import { Plus, Music2, Type, ZoomIn, ZoomOut, Diamond } from 'lucide-react';
import type { Project } from '@/types/video';
import { clipDur, clipStarts, formatTC, projectDuration, transDur } from '@/types/video';
import { cn } from '@/lib/utils';

export type Sel = { kind: 'clip' | 'title' | 'audio' | 'transition'; id: string } | null;

interface Props {
  p: Project;
  time: number;
  playing: boolean;
  pps: number;
  setPps: (v: number) => void;
  sel: Sel;
  onSelect: (s: Sel) => void;
  onScrub: (t: number) => void;
  onTrimClip: (id: string, edge: 'in' | 'out', value: number, commit: boolean) => void;
  onMoveTitle: (id: string, start: number, duration: number, commit: boolean) => void;
  onMoveAudio: (id: string, start: number, inPt: number, outPt: number, commit: boolean) => void;
  onAddMedia: () => void;
  onAddTitle: () => void;
  onAddMusic: () => void;
  thumbs: Map<string, string[]>;
  waves: Map<string, Float32Array>;
  /** collapse to the video row only (used while a panel is open on small screens) */
  compact?: boolean;
}


function Wave({ peaks, from, to, width, height, color }: { peaks: Float32Array; from: number; to: number; width: number; height: number; color: string }) {
  const n = Math.max(2, Math.floor(width / 3));
  let d = '';
  for (let i = 0; i < n; i++) {
    const f = from + ((to - from) * i) / n;
    const v = peaks[Math.min(peaks.length - 1, Math.max(0, Math.floor(f * peaks.length)))] ?? 0;
    const x = (i / n) * width;
    const h = Math.max(1, v * height * 0.9);
    d += `M${x.toFixed(1)},${((height - h) / 2).toFixed(1)}v${h.toFixed(1)}`;
  }
  return (
    <svg width={width} height={height} className="absolute inset-0" aria-hidden>
      <path d={d} stroke={color} strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}

export default function Timeline(props: Props) {
  const { p, time, playing, pps, setPps, sel, onSelect, onScrub, compact } = props;
  const ROW_V = compact ? 38 : 52;
  const TOP_V = compact ? 22 : 48;
  const scroller = React.useRef<HTMLDivElement>(null);
  const [vw, setVw] = React.useState(360);
  const programmatic = React.useRef(-1);
  const starts = React.useMemo(() => clipStarts(p.clips), [p.clips]);
  const total = projectDuration(p);
  const contentEnd = Math.max(total, ...p.titles.map((t) => t.start + t.duration), ...p.audio.map((a) => a.start + a.out - a.in), 1);
  const pad = vw / 2;
  const width = contentEnd * pps + 140;

  React.useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setVw(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // follow the playhead (programmatic scroll is ignored by onScroll)
  React.useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const want = time * pps;
    if (Math.abs(el.scrollLeft - want) > 0.5) {
      programmatic.current = want;
      el.scrollLeft = want;
    }
  }, [time, pps, vw]);

  const onScroll = () => {
    const el = scroller.current!;
    if (programmatic.current >= 0 && Math.abs(el.scrollLeft - programmatic.current) < 1.5) {
      programmatic.current = -1;
      return;
    }
    programmatic.current = -1;
    if (!playing) onScrub(Math.max(0, el.scrollLeft / pps));
  };

  // pinch / ctrl-wheel zoom
  React.useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let d0 = 0, p0 = pps;
    const ts = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        d0 = Math.abs(e.touches[0].clientX - e.touches[1].clientX);
        p0 = pps;
      }
    };
    const tm = (e: TouchEvent) => {
      if (e.touches.length === 2 && d0 > 0) {
        e.preventDefault();
        const d = Math.abs(e.touches[0].clientX - e.touches[1].clientX);
        setPps(Math.min(400, Math.max(8, (p0 * d) / d0)));
      }
    };
    const wh = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setPps(Math.min(400, Math.max(8, pps * Math.exp(-e.deltaY * 0.004))));
      }
    };
    el.addEventListener('touchstart', ts, { passive: true });
    el.addEventListener('touchmove', tm, { passive: false });
    el.addEventListener('wheel', wh, { passive: false });
    return () => {
      el.removeEventListener('touchstart', ts);
      el.removeEventListener('touchmove', tm);
      el.removeEventListener('wheel', wh);
    };
  }, [pps, setPps]);

  // snap a time to the playhead / clip edges when within ~10 px (like Premiere's snapping)
  const snap = (t: number, len = 0) => {
    const pts = [0, time, ...starts, ...p.clips.map((c, i) => starts[i] + clipDur(c))];
    const tol = 10 / pps;
    for (const q of pts) {
      if (Math.abs(t - q) < tol) return q;
      if (len && Math.abs(t + len - q) < tol) return q - len;
    }
    return Math.max(0, t);
  };

  // generic horizontal drag helper
  const dragStart = (e: React.PointerEvent, onMove: (dx: number) => void, onEnd: (dx: number) => void) => {
    e.stopPropagation();
    e.preventDefault();
    const x0 = e.clientX;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const mv = (ev: PointerEvent) => onMove(ev.clientX - x0);
    const up = (ev: PointerEvent) => {
      target.removeEventListener('pointermove', mv);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      onEnd(ev.clientX - x0);
    };
    target.addEventListener('pointermove', mv);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  const step = pps > 160 ? 0.5 : pps > 60 ? 1 : pps > 25 ? 2 : pps > 12 ? 5 : 10;
  const ticks: number[] = [];
  for (let t = 0; t <= contentEnd + step; t += step) ticks.push(t);

  return (
    <div className="relative select-none border-t border-line bg-[#0b0b0d]">
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="font-mono text-[11px] tabular-nums text-fg">{formatTC(time, p.fps)} <span className="text-faint">/ {formatTC(total, p.fps)}</span></span>
        <div className="flex items-center gap-1">
          <button type="button" className="icon-btn h-7 w-7" aria-label="Zoom out timeline" onClick={() => setPps(Math.max(8, pps / 1.5))}><ZoomOut size={15} /></button>
          <button type="button" className="icon-btn h-7 w-7" aria-label="Zoom in timeline" onClick={() => setPps(Math.min(400, pps * 1.5))}><ZoomIn size={15} /></button>
        </div>
      </div>
      <div ref={scroller} onScroll={onScroll} className="no-scrollbar relative overflow-x-auto overflow-y-hidden pb-2 [touch-action:pan-x]" onPointerDown={(e) => { if (e.target === e.currentTarget) onSelect(null); }}>
        <div className="relative" style={{ width: width + pad * 2, height: compact ? TOP_V + ROW_V + 4 : 18 + 26 + ROW_V + 34 + 12 }} onPointerDown={(e) => { if (e.target === e.currentTarget) onSelect(null); }}>
          {/* ruler */}
          <div className="absolute left-0 top-0 h-[18px]" style={{ width: width + pad * 2 }}>
            {ticks.map((t) => (
              <div key={t} className="absolute top-0 h-full border-l border-white/10 pl-1 font-mono text-[9px] leading-[18px] text-faint" style={{ left: pad + t * pps }}>
                {Number.isInteger(t / (step * 2)) ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}` : ''}
              </div>
            ))}
          </div>

          {/* titles row */}
          {!compact && <div className="absolute left-0" style={{ top: 20, height: 24, width: width + pad * 2 }}>
            {p.titles.map((t) => {
              const on = sel?.kind === 'title' && sel.id === t.id;
              return (
                <div
                  key={t.id}
                  className={cn('absolute top-0 flex h-full items-center gap-1 overflow-hidden rounded-md bg-violet-500/70 px-1.5 text-[11px] font-medium text-white', on && 'ring-2 ring-white')}
                  style={{ left: pad + t.start * pps, width: Math.max(12, t.duration * pps) }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    if (!on) return onSelect({ kind: 'title', id: t.id });
                    const s0 = t.start;
                    dragStart(e, (dx) => props.onMoveTitle(t.id, snap(s0 + dx / pps, t.duration), t.duration, false), (dx) => props.onMoveTitle(t.id, snap(s0 + dx / pps, t.duration), t.duration, true));
                  }}
                >
                  <Type size={11} className="shrink-0" /> <span className="truncate">{t.text || 'Title'}</span>
                  {on && (
                    <span
                      className="absolute right-0 top-0 h-full w-3 cursor-ew-resize bg-white/80"
                      onPointerDown={(e) => {
                        const d0 = t.duration;
                        dragStart(e, (dx) => props.onMoveTitle(t.id, t.start, Math.max(0.3, d0 + dx / pps), false), (dx) => props.onMoveTitle(t.id, t.start, Math.max(0.3, d0 + dx / pps), true));
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>}

          {/* video row */}
          <div className="absolute left-0" style={{ top: TOP_V, height: ROW_V, width: width + pad * 2 }}>
            {p.clips.map((c, i) => {
              const m = p.media.find((x) => x.id === c.mediaId);
              const w = clipDur(c) * pps;
              const left = pad + starts[i] * pps;
              const on = sel?.kind === 'clip' && sel.id === c.id;
              const th = props.thumbs.get(c.mediaId) ?? [];
              const tileW = m && m.height ? Math.min(90, Math.max(28, (m.width / m.height) * ROW_V)) : ROW_V;
              const n = Math.max(1, Math.ceil(w / tileW));
              const wave = props.waves.get(c.mediaId);
              return (
                <div
                  key={c.id}
                  role="button"
                  aria-label={`Clip ${i + 1}: ${m?.name ?? ''}`}
                  aria-pressed={on}
                  className={cn('absolute top-0 h-full overflow-hidden rounded-md bg-raised ring-1 ring-black', on ? 'z-20 ring-2 ring-white' : 'z-10')}
                  style={{ left, width: Math.max(6, w) }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onSelect({ kind: 'clip', id: c.id });
                  }}
                >
                  <div className="absolute inset-0 flex">
                    {Array.from({ length: n }, (_, k) => {
                      const tt = m?.kind === 'image' ? 0 : c.in + ((k + 0.5) / n) * (c.out - c.in);
                      const src = th.length ? th[Math.min(th.length - 1, Math.floor((tt / Math.max(0.01, m?.duration ?? 1)) * th.length))] : '';
                      return <div key={k} className="h-full shrink-0 bg-cover bg-center" style={{ width: tileW, backgroundImage: src ? `url(${src})` : undefined }} />;
                    })}
                  </div>
                  {wave && !c.muted && (
                    <div className="absolute inset-x-0 bottom-0 h-3 bg-black/40">
                      <Wave peaks={wave} from={c.in / (m?.duration || 1)} to={c.out / (m?.duration || 1)} width={Math.max(6, w)} height={12} color="rgba(120,220,160,.9)" />
                    </div>
                  )}
                  {c.speed !== 1 && <span className="absolute left-1 top-1 rounded bg-black/70 px-1 font-mono text-[9px]">{c.speed}×</span>}
                  {on && (
                    <>
                      <span
                        className="absolute left-0 top-0 z-30 flex h-full w-4 cursor-ew-resize items-center justify-center rounded-l-md bg-white"
                        aria-label="Trim start"
                        onPointerDown={(e) => {
                          const in0 = c.in;
                          dragStart(e, (dx) => props.onTrimClip(c.id, 'in', in0 + (dx / pps) * c.speed, false), (dx) => props.onTrimClip(c.id, 'in', in0 + (dx / pps) * c.speed, true));
                        }}
                      >
                        <span className="h-4 w-0.5 rounded bg-black/60" />
                      </span>
                      <span
                        className="absolute right-0 top-0 z-30 flex h-full w-4 cursor-ew-resize items-center justify-center rounded-r-md bg-white"
                        aria-label="Trim end"
                        onPointerDown={(e) => {
                          const out0 = c.out;
                          dragStart(e, (dx) => props.onTrimClip(c.id, 'out', out0 + (dx / pps) * c.speed, false), (dx) => props.onTrimClip(c.id, 'out', out0 + (dx / pps) * c.speed, true));
                        }}
                      >
                        <span className="h-4 w-0.5 rounded bg-black/60" />
                      </span>
                    </>
                  )}
                </div>
              );
            })}
            {/* transition markers */}
            {p.clips.map((c, i) =>
              i === 0 ? null : (
                <button
                  key={'tr' + c.id}
                  type="button"
                  aria-label={`Transition into clip ${i + 1}`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => onSelect({ kind: 'transition', id: c.id })}
                  className={cn('absolute top-1/2 z-30 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-md border border-black/60 text-[10px]', c.transition.type !== 'none' ? 'bg-accent text-white' : 'bg-fg text-bg', sel?.kind === 'transition' && sel.id === c.id && 'ring-2 ring-accent ring-offset-1 ring-offset-black')}
                  style={{ left: pad + (starts[i] + transDur(p.clips, i) / 2) * pps }}
                >
                  <Diamond size={11} fill={c.transition.type !== 'none' ? 'currentColor' : 'none'} />
                </button>
              ),
            )}
            <button type="button" onClick={props.onAddMedia} aria-label="Add media" className="absolute top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg bg-widget text-fg hover:bg-accent" style={{ left: pad + total * pps + 10 }}>
              <Plus size={18} />
            </button>
          </div>

          {/* audio row */}
          {!compact && <div className="absolute left-0" style={{ top: 48 + ROW_V + 6, height: 28, width: width + pad * 2 }}>
            {p.audio.map((a) => {
              const m = p.media.find((x) => x.id === a.mediaId);
              const on = sel?.kind === 'audio' && sel.id === a.id;
              const w = (a.out - a.in) * pps;
              const wave = props.waves.get(a.mediaId);
              return (
                <div
                  key={a.id}
                  className={cn('absolute top-0 h-full overflow-hidden rounded-md bg-emerald-700/60', on && 'ring-2 ring-white')}
                  style={{ left: pad + a.start * pps, width: Math.max(8, w) }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    if (!on) return onSelect({ kind: 'audio', id: a.id });
                    const s0 = a.start;
                    dragStart(e, (dx) => props.onMoveAudio(a.id, snap(s0 + dx / pps, a.out - a.in), a.in, a.out, false), (dx) => props.onMoveAudio(a.id, snap(s0 + dx / pps, a.out - a.in), a.in, a.out, true));
                  }}
                >
                  {wave && <Wave peaks={wave} from={a.in / (m?.duration || 1)} to={a.out / (m?.duration || 1)} width={Math.max(8, w)} height={28} color="rgba(190,255,215,.75)" />}
                  <span className="pointer-events-none absolute left-1 top-0.5 flex max-w-[calc(100%-8px)] items-center gap-1 truncate rounded bg-black/55 px-1 text-[10px] text-white"><Music2 size={10} className="shrink-0" /> {m?.name}</span>
                  {on && (
                    <>
                      <span className="absolute left-0 top-0 h-full w-3 cursor-ew-resize bg-white/85" onPointerDown={(e) => {
                        const in0 = a.in, s0 = a.start;
                        const f = (dx: number) => { const d = Math.min(a.out - 0.3, Math.max(0, in0 + dx / pps)) - in0; return [s0 + d, in0 + d] as const; };
                        dragStart(e, (dx) => { const [s, i] = f(dx); props.onMoveAudio(a.id, s, i, a.out, false); }, (dx) => { const [s, i] = f(dx); props.onMoveAudio(a.id, s, i, a.out, true); });
                      }} />
                      <span className="absolute right-0 top-0 h-full w-3 cursor-ew-resize bg-white/85" onPointerDown={(e) => {
                        const out0 = a.out;
                        const f = (dx: number) => Math.min(m?.duration ?? out0, Math.max(a.in + 0.3, out0 + dx / pps));
                        dragStart(e, (dx) => props.onMoveAudio(a.id, a.start, a.in, f(dx), false), (dx) => props.onMoveAudio(a.id, a.start, a.in, f(dx), true));
                      }} />
                    </>
                  )}
                </div>
              );
            })}
            {!p.audio.length && (
              <button type="button" onClick={props.onAddMusic} className="absolute top-0 flex h-full items-center gap-1.5 rounded-md border border-dashed border-white/15 px-3 text-[11px] text-faint hover:text-fg" style={{ left: pad }}>
                <Music2 size={12} /> Add music
              </button>
            )}
          </div>}
          {!compact && !p.titles.length && (
            <button type="button" onClick={props.onAddTitle} className="absolute flex h-6 items-center gap-1.5 rounded-md border border-dashed border-white/15 px-3 text-[11px] text-faint hover:text-fg" style={{ left: pad, top: 20 }}>
              <Type size={12} /> Add title
            </button>
          )}
        </div>
      </div>
      {/* fixed centre playhead */}
      <div className="pointer-events-none absolute bottom-2 left-1/2 top-[30px] w-0.5 -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgba(0,0,0,.4)]">
        <div className="absolute -left-[5px] -top-1 h-3 w-3 rotate-45 bg-white" />
      </div>
    </div>
  );
}
