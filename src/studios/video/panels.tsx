import * as React from 'react';
import { Download, Share2, X } from 'lucide-react';
import type { AudioClip, Project, Title, TitleStyle, TransitionType, VClip } from '@/types/video';
import { ASPECTS, TRANSITIONS, clipDur } from '@/types/video';
import { Slider } from '@/components/Slider';
import { Progress, Segmented, Sheet, Toggle, useToast } from '@/components/ui';
import { cn } from '@/lib/utils';
import { downloadBlob, inHostedViewer } from '@/lib/db';
import { TITLE_PRESETS } from './titles';
import { canExportVideo, exportVideo, type ExportOptions } from './exporter';

// ── clip: speed, audio, framing ───────────────────────────────────────────
export function ClipPanel({ c, kind, onChange, onCommit }: { c: VClip; kind: 'video' | 'image'; onChange: (p: Partial<VClip>) => void; onCommit: () => void }) {
  const speeds = [0.25, 0.5, 1, 1.5, 2, 4];
  return (
    <div className="space-y-2">
      {kind === 'video' ? (
        <>
          <div className="label-xs">Speed</div>
          <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
            {speeds.map((s) => (
              <button key={s} type="button" onClick={() => { onChange({ speed: s }); onCommit(); }} className={cn('chip', Math.abs(c.speed - s) < 0.001 ? 'chip-on' : 'bg-widget/50')}>{s}×</button>
            ))}
          </div>
          <Slider label="Custom speed" value={c.speed} min={0.25} max={4} step={0.05} defaultValue={1} format={(v) => `${v.toFixed(2)}×`} onChange={(speed) => onChange({ speed })} onCommit={onCommit} />
          <div className="label-xs pt-2">Audio</div>
          <Toggle on={!c.muted} onChange={(v) => { onChange({ muted: !v }); onCommit(); }} label="Clip audio" />
          <Slider label="Volume" value={Math.round(c.volume * 100)} min={0} max={100} defaultValue={100} disabled={c.muted} onChange={(v) => onChange({ volume: v / 100 })} onCommit={onCommit} format={(v) => `${v}%`} />
          <Slider label="Fade in" value={c.fadeIn} min={0} max={3} step={0.1} disabled={c.muted} onChange={(fadeIn) => onChange({ fadeIn })} onCommit={onCommit} format={(v) => `${v.toFixed(1)}s`} />
          <Slider label="Fade out" value={c.fadeOut} min={0} max={3} step={0.1} disabled={c.muted} onChange={(fadeOut) => onChange({ fadeOut })} onCommit={onCommit} format={(v) => `${v.toFixed(1)}s`} />
        </>
      ) : (
        <>
          <Slider label="Duration" value={c.out - c.in} min={0.5} max={20} step={0.1} defaultValue={4} format={(v) => `${v.toFixed(1)}s`} onChange={(d) => onChange({ in: 0, out: d })} onCommit={onCommit} />
          <Toggle on={c.kenBurns} onChange={(v) => { onChange({ kenBurns: v }); onCommit(); }} label="Ken Burns (slow zoom)" />
        </>
      )}
      <div className="label-xs pt-2">Framing</div>
      <Segmented value={c.fit} onChange={(fit) => { onChange({ fit }); onCommit(); }} items={[{ id: 'fill', label: 'Fill frame' }, { id: 'fit', label: 'Fit (letterbox)' }]} />
      <Slider label="Zoom" value={c.scale} min={1} max={3} step={0.01} defaultValue={1} onChange={(scale) => onChange({ scale })} onCommit={onCommit} format={(v) => `${Math.round(v * 100)}%`} />
      <Slider label="Position X" value={c.x} min={-1} max={1} step={0.01} onChange={(x) => onChange({ x })} onCommit={onCommit} format={(v) => v.toFixed(2)} />
      <Slider label="Position Y" value={c.y} min={-1} max={1} step={0.01} onChange={(y) => onChange({ y })} onCommit={onCommit} format={(v) => v.toFixed(2)} />
      {kind === 'video' && <Toggle on={c.kenBurns} onChange={(v) => { onChange({ kenBurns: v }); onCommit(); }} label="Slow push-in" />}
    </div>
  );
}

// ── transition into a clip ────────────────────────────────────────────────
export function TransitionPanel({ c, prev, onChange, onCommit, onApplyAll }: { c: VClip; prev: VClip | null; onChange: (p: Partial<VClip>) => void; onCommit: () => void; onApplyAll: () => void }) {
  if (!prev) return <p className="text-[13px] text-dim">The first clip has no incoming transition. Select a later clip.</p>;
  const max = Math.max(0.1, Math.min(clipDur(prev), clipDur(c)) / 2);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-2">
        {TRANSITIONS.map((t) => (
          <button key={t.id} type="button" onClick={() => { onChange({ transition: { ...c.transition, type: t.id as TransitionType } }); onCommit(); }} className={cn('flex h-16 flex-col items-center justify-center gap-1 rounded-xl text-[11px] ring-1', c.transition.type === t.id ? 'bg-accent/15 text-fg ring-accent' : 'bg-raised text-dim ring-line')}>
            <TransitionIcon id={t.id as TransitionType} />
            {t.label}
          </button>
        ))}
      </div>
      {c.transition.type !== 'none' && (
        <Slider label="Duration" value={Math.min(c.transition.duration, max)} min={0.1} max={Math.max(0.2, Math.min(3, max))} step={0.05} defaultValue={0.6} onChange={(duration) => onChange({ transition: { ...c.transition, duration } })} onCommit={onCommit} format={(v) => `${v.toFixed(2)}s`} />
      )}
      <button type="button" className="btn-ghost w-full" onClick={onApplyAll}>Apply this transition to every cut</button>
    </div>
  );
}

function TransitionIcon({ id }: { id: TransitionType }) {
  const a = 'h-5 w-8 rounded-sm';
  if (id === 'none') return <div className="flex gap-0.5"><div className={cn(a, 'w-4 bg-accent/60')} /><div className={cn(a, 'w-4 bg-amber-500/60')} /></div>;
  const bg: Record<string, string> = {
    crossfade: 'linear-gradient(90deg, hsl(211 95% 62% / .7), hsl(38 92% 50% / .7))',
    'dip-black': 'linear-gradient(90deg, hsl(211 95% 62% / .7), #000, hsl(38 92% 50% / .7))',
    'dip-white': 'linear-gradient(90deg, hsl(211 95% 62% / .7), #fff, hsl(38 92% 50% / .7))',
    wipe: 'linear-gradient(90deg, hsl(211 95% 62% / .7) 50%, hsl(38 92% 50% / .7) 50%)',
    slide: 'linear-gradient(90deg, hsl(211 95% 62% / .7) 35%, #111 35% 40%, hsl(38 92% 50% / .7) 40%)',
    zoom: 'radial-gradient(circle, hsl(38 92% 50% / .8) 30%, hsl(211 95% 62% / .7) 32%)',
  };
  return <div className={a} style={{ background: bg[id] }} />;
}

// ── titles ────────────────────────────────────────────────────────────────
export function TitlePanel({ t, onChange, onCommit }: { t: Title; onChange: (p: Partial<Title>) => void; onCommit: () => void }) {
  const colors = ['#ffffff', '#111111', '#ffd23f', '#4aa3ff', '#ff5a5f', '#46d36a', '#ff9f1c', '#c084fc'];
  return (
    <div className="space-y-3">
      <textarea className="field h-20 w-full resize-none py-2" value={t.text} onChange={(e) => onChange({ text: e.target.value })} onBlur={onCommit} placeholder="Your title…" aria-label="Title text" />
      <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
        {(Object.keys(TITLE_PRESETS) as TitleStyle[]).map((s) => (
          <button key={s} type="button" className={cn('chip', t.style === s ? 'chip-on' : 'bg-widget/50')} onClick={() => { const { label: _l, ...rest } = TITLE_PRESETS[s]; void _l; onChange({ ...rest, style: s }); onCommit(); }}>
            {TITLE_PRESETS[s].label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        {colors.map((c) => (
          <button key={c} type="button" aria-label={`Colour ${c}`} onClick={() => { onChange({ color: c }); onCommit(); }} className={cn('h-7 w-7 rounded-full ring-1 ring-white/20', t.color === c && 'ring-2 ring-accent ring-offset-2 ring-offset-panel')} style={{ background: c }} />
        ))}
      </div>
      <Segmented value={t.font} onChange={(font) => { onChange({ font }); onCommit(); }} items={[{ id: 'sans', label: 'Sans' }, { id: 'serif', label: <span className="font-serif">Serif</span> }, { id: 'mono', label: <span className="font-mono">Mono</span> }]} />
      <Segmented value={t.anim} onChange={(anim) => { onChange({ anim }); onCommit(); }} items={[{ id: 'none', label: 'None' }, { id: 'fade', label: 'Fade' }, { id: 'rise', label: 'Rise' }, { id: 'pop', label: 'Pop' }, { id: 'type', label: 'Type' }]} />
      <Toggle on={t.bg} onChange={(bg) => { onChange({ bg }); onCommit(); }} label="Background box" />
      <Slider label="Size" value={Math.round(t.size * 1000)} min={20} max={200} onChange={(v) => onChange({ size: v / 1000 })} onCommit={onCommit} />
      <Slider label="Position X" value={Math.round(t.x * 100)} min={0} max={100} defaultValue={50} onChange={(v) => onChange({ x: v / 100 })} onCommit={onCommit} />
      <Slider label="Position Y" value={Math.round(t.y * 100)} min={0} max={100} defaultValue={50} onChange={(v) => onChange({ y: v / 100 })} onCommit={onCommit} />
      <Slider label="Duration" value={t.duration} min={0.5} max={30} step={0.1} defaultValue={3} onChange={(duration) => onChange({ duration })} onCommit={onCommit} format={(v) => `${v.toFixed(1)}s`} />
      <p className="text-[11px] text-faint">Tip: drag the title on the preview to place it.</p>
    </div>
  );
}

// ── music / audio clip ────────────────────────────────────────────────────
export function AudioPanel({ a, onChange, onCommit }: { a: AudioClip; onChange: (p: Partial<AudioClip>) => void; onCommit: () => void }) {
  return (
    <div className="space-y-1">
      <Slider label="Volume" value={Math.round(a.volume * 100)} min={0} max={100} defaultValue={100} onChange={(v) => onChange({ volume: v / 100 })} onCommit={onCommit} format={(v) => `${v}%`} />
      <Slider label="Fade in" value={a.fadeIn} min={0} max={5} step={0.1} onChange={(fadeIn) => onChange({ fadeIn })} onCommit={onCommit} format={(v) => `${v.toFixed(1)}s`} />
      <Slider label="Fade out" value={a.fadeOut} min={0} max={5} step={0.1} onChange={(fadeOut) => onChange({ fadeOut })} onCommit={onCommit} format={(v) => `${v.toFixed(1)}s`} />
      <p className="pt-1 text-[11px] text-faint">Drag the music block to move it; drag its edges to trim.</p>
    </div>
  );
}

// ── format ────────────────────────────────────────────────────────────────
export function FormatSheet({ open, onClose, p, onChange }: { open: boolean; onClose: () => void; p: Project; onChange: (patch: Partial<Project>) => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Project format">
      <div className="space-y-4">
        <div>
          <div className="label-xs mb-2">Aspect ratio</div>
          <div className="grid grid-cols-3 gap-2">
            {ASPECTS.map((a) => (
              <button key={a.label} type="button" onClick={() => onChange({ aspect: a.id })} className={cn('flex flex-col items-center gap-1.5 rounded-xl py-3 ring-1', Math.abs(p.aspect - a.id) < 0.001 ? 'bg-accent/15 ring-accent' : 'bg-raised ring-line')}>
                <span className="block rounded-[3px] border-2 border-fg/70" style={{ width: a.id >= 1 ? 34 : 34 * a.id, height: a.id >= 1 ? 34 / a.id : 34 }} />
                <span className="text-[13px] font-medium">{a.label}</span>
                <span className="text-[10px] text-faint">{a.hint}</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="label-xs mb-2">Frame rate</div>
          <Segmented value={p.fps} onChange={(fps) => onChange({ fps })} items={[24, 25, 30, 60].map((f) => ({ id: f, label: `${f}` }))} />
        </div>
        <div>
          <div className="label-xs mb-2">Background (letterbox)</div>
          <div className="flex gap-2">
            {['#000000', '#ffffff', '#101114', '#1f2937', '#7c2d12'].map((c) => (
              <button key={c} type="button" aria-label={c} onClick={() => onChange({ bg: c })} className={cn('h-8 w-8 rounded-full ring-1 ring-white/20', p.bg === c && 'ring-2 ring-accent ring-offset-2 ring-offset-panel')} style={{ background: c }} />
            ))}
          </div>
        </div>
      </div>
    </Sheet>
  );
}

// ── export ────────────────────────────────────────────────────────────────
export function ExportVideoSheet({ open, onClose, p, blobs }: { open: boolean; onClose: () => void; p: Project; blobs: Map<string, Blob> }) {
  const toast = useToast();
  const [o, setO] = React.useState<ExportOptions>({ height: Math.min(1080, p.height), fps: p.fps, quality: 'high', format: 'auto' });
  const [prog, setProg] = React.useState<{ f: number; msg: string } | null>(null);
  const [result, setResult] = React.useState<{ blob: Blob; name: string; info: string } | null>(null);
  const abort = React.useRef<AbortController | null>(null);
  React.useEffect(() => setO((x) => ({ ...x, fps: p.fps })), [p.fps]);
  const short = Math.min(o.height, Math.round(o.height * p.aspect));
  const run = async () => {
    abort.current = new AbortController();
    setResult(null);
    setProg({ f: 0, msg: 'Preparing…' });
    const t0 = performance.now();
    try {
      // for portrait projects, "1080p" means 1080 px wide
      const height = p.aspect < 1 ? Math.round(o.height / p.aspect) : o.height;
      const r = await exportVideo(p, blobs, { ...o, height }, (f, msg) => setProg({ f, msg }), abort.current.signal);
      const name = `${p.name.replace(/[^\w\- ]+/g, '').trim() || 'lumina'}.${r.ext}`;
      setResult({ blob: r.blob, name, info: `${r.width}×${r.height} · ${r.codec} · ${(r.blob.size / 1e6).toFixed(1)} MB · ${((performance.now() - t0) / 1000).toFixed(1)}s` });
      toast('Video rendered', 'ok');
      await downloadBlob(r.blob, name).catch((e) => toast(e instanceof Error ? e.message : 'Save failed', 'error'));
    } catch (err) {
      if ((err as Error).name === 'AbortError') toast('Export cancelled', 'info');
      else toast(err instanceof Error ? err.message : 'Export failed', 'error');
    } finally {
      setProg(null);
    }
  };
  const supported = canExportVideo();
  return (
    <Sheet open={open} onClose={() => { if (!prog) onClose(); }} title="Export video">
      {!supported ? (
        <p className="text-[13px] text-dim">This browser can’t encode video. Use a recent Chrome, Edge, or Safari (17+) to export.</p>
      ) : prog ? (
        <div className="space-y-4 py-2">
          <Progress value={prog.f} label={prog.msg} />
          <button type="button" className="btn-solid w-full" onClick={() => abort.current?.abort()}><X size={15} /> Cancel</button>
          <p className="text-[11px] text-faint">Rendering happens frame-by-frame on your device, so it doesn’t matter if this tab is in the background.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <div className="label-xs mb-1.5">Resolution</div>
            <Segmented value={o.height} onChange={(height) => setO({ ...o, height })} items={[{ id: 720, label: '720p' }, { id: 1080, label: '1080p' }, { id: 1440, label: '1440p' }, { id: 2160, label: '4K' }]} />
            <div className="mt-1 font-mono text-[11px] text-faint">{p.aspect >= 1 ? `${Math.round(o.height * p.aspect)} × ${o.height}` : `${o.height} × ${Math.round(o.height / p.aspect)}`} px · short side {short}</div>
          </div>
          <div>
            <div className="label-xs mb-1.5">Frame rate</div>
            <Segmented value={o.fps} onChange={(fps) => setO({ ...o, fps })} items={[24, 25, 30, 60].map((f) => ({ id: f, label: `${f} fps` }))} />
          </div>
          <div>
            <div className="label-xs mb-1.5">Quality</div>
            <Segmented value={o.quality} onChange={(quality) => setO({ ...o, quality })} items={[{ id: 'standard', label: 'Smaller' }, { id: 'high', label: 'High' }, { id: 'max', label: 'Max' }]} />
          </div>
          <div>
            <div className="label-xs mb-1.5">Format</div>
            <Segmented value={o.format} onChange={(format) => setO({ ...o, format })} items={[{ id: 'auto', label: 'Best (MP4)' }, { id: 'mp4', label: 'MP4' }, { id: 'webm', label: 'WebM' }]} />
          </div>
          <button type="button" className="btn-accent h-11 w-full" onClick={run} disabled={!p.clips.length}>
            <Download size={16} /> Export
          </button>
          {result && (
            <div className="rounded-xl bg-raised p-3 text-[12px] ring-1 ring-line">
              <div className="mb-2 text-dim">{result.info}</div>
              <div className="flex gap-2">
                <button type="button" className="btn-solid flex-1" onClick={() => downloadBlob(result.blob, result.name).catch((e) => toast(e instanceof Error ? e.message : 'Save failed', 'error'))}><Download size={14} /> Save again</button>
                {'canShare' in navigator && !inHostedViewer() && (
                  <button type="button" className="btn-solid flex-1" onClick={() => { const f = new File([result.blob], result.name, { type: result.blob.type }); if (navigator.canShare({ files: [f] })) navigator.share({ files: [f] }).catch(() => undefined); }}><Share2 size={14} /> Share</button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}
