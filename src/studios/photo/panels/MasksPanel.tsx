import * as React from 'react';
import {
  Brush, ChevronLeft, CircleDashed, Copy, Eye, EyeOff, Layers, Loader2, Minus, Pipette, Plus, Sparkles, SunMedium,
  Trash2, User, Mountain, Trees, Waves, Building2, Footprints, Contrast, Blend, FlipHorizontal2, Eraser, Focus, Sun,
} from 'lucide-react';
import type { AIKind, LocalAdjust, Mask, MaskComponent } from '@/types/edits';
import { AI_LABEL, defaultLocal } from '@/types/edits';
import { Slider } from '@/components/Slider';
import { Chips, Segmented, Toggle } from '@/components/ui';
import { cn } from '@/lib/utils';

export type CompType = MaskComponent['type'];
export interface BrushSettings {
  size: number;
  feather: number;
  flow: number;
  erase: boolean;
}

export const AI_ICONS: Record<AIKind, React.ReactNode> = {
  subject: <Focus size={18} />,
  sky: <Sun size={18} />,
  background: <Layers size={18} />,
  people: <User size={18} />,
  vegetation: <Trees size={18} />,
  water: <Waves size={18} />,
  buildings: <Building2 size={18} />,
  ground: <Footprints size={18} />,
};

const TOOL_ITEMS: { type: CompType; label: string; icon: React.ReactNode }[] = [
  { type: 'brush', label: 'Brush', icon: <Brush size={18} /> },
  { type: 'linear', label: 'Linear', icon: <Blend size={18} /> },
  { type: 'radial', label: 'Radial', icon: <CircleDashed size={18} /> },
  { type: 'color', label: 'Color range', icon: <Pipette size={18} /> },
  { type: 'luminance', label: 'Light range', icon: <Contrast size={18} /> },
];

export const ADAPTIVE: { id: string; label: string; kind: AIKind; adjust: Partial<LocalAdjust>; icon: React.ReactNode }[] = [
  { id: 'sky', label: 'Enhance sky', kind: 'sky', adjust: { exposure: -0.3, highlights: -30, dehaze: 20, saturation: 18, temp: -6 }, icon: <Sun size={16} /> },
  { id: 'pop', label: 'Pop subject', kind: 'subject', adjust: { exposure: 0.2, contrast: 10, texture: 15, clarity: 10, saturation: 8 }, icon: <Sparkles size={16} /> },
  { id: 'blur', label: 'Blur background', kind: 'background', adjust: { sharpness: -70, exposure: -0.1 }, icon: <CircleDashed size={16} /> },
  { id: 'people', label: 'Brighten people', kind: 'people', adjust: { exposure: 0.3, shadows: 20, texture: -10 }, icon: <User size={16} /> },
  { id: 'bgdark', label: 'Darken background', kind: 'background', adjust: { exposure: -0.6, saturation: -15 }, icon: <Mountain size={16} /> },
];

const compLabel = (c: MaskComponent) =>
  c.type === 'ai' ? AI_LABEL[c.kind] : c.type === 'color' ? 'Color range' : c.type === 'luminance' ? 'Luminance range' : c.type[0].toUpperCase() + c.type.slice(1);
const compIcon = (c: MaskComponent) => (c.type === 'ai' ? AI_ICONS[c.kind] : TOOL_ITEMS.find((t) => t.type === c.type)?.icon);

export interface MasksPanelProps {
  masks: Mask[];
  activeId: string | null;
  activeComp: string | null;
  setActive: (maskId: string | null, compId?: string | null) => void;
  onChange: (masks: Mask[], commit: boolean) => void;
  onCreate: (spec: { type: CompType; kind?: AIKind }, into?: { maskId: string; mode: MaskComponent['mode'] }) => void;
  onAdaptive: (a: (typeof ADAPTIVE)[number]) => void;
  aiBusy: string | null;
  aiAvailable: (k: AIKind) => boolean | null;
  brush: BrushSettings;
  setBrush: (b: BrushSettings) => void;
  overlay: boolean;
  setOverlay: (v: boolean) => void;
  picking: boolean;
  setPicking: (v: boolean) => void;
}

function CreateGrid({ onPick, aiBusy, aiAvailable, compact }: { onPick: (s: { type: CompType; kind?: AIKind }) => void; aiBusy: string | null; aiAvailable: (k: AIKind) => boolean | null; compact?: boolean }) {
  const kinds: AIKind[] = compact ? ['subject', 'sky', 'background', 'people'] : ['subject', 'sky', 'background', 'people', 'vegetation', 'water', 'buildings', 'ground'];
  return (
    <div className="space-y-3">
      <div>
        <div className="label-xs mb-1.5 flex items-center gap-1.5"><Sparkles size={11} className="text-accent" /> AI selection</div>
        <div className="grid grid-cols-4 gap-2">
          {kinds.map((k) => {
            const avail = aiAvailable(k);
            return (
              <button key={k} type="button" disabled={!!aiBusy || avail === false} onClick={() => onPick({ type: 'ai', kind: k })} className="flex flex-col items-center gap-1.5 rounded-xl bg-raised py-2.5 text-[11px] text-dim ring-1 ring-line hover:text-fg disabled:opacity-35">
                {aiBusy === k ? <Loader2 size={18} className="animate-spin" /> : AI_ICONS[k]}
                {AI_LABEL[k]}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <div className="label-xs mb-1.5">Tools</div>
        <div className="grid grid-cols-5 gap-2">
          {TOOL_ITEMS.map((t) => (
            <button key={t.type} type="button" onClick={() => onPick({ type: t.type })} className="flex flex-col items-center gap-1.5 rounded-xl bg-raised py-2.5 text-[11px] text-dim ring-1 ring-line hover:text-fg">
              {t.icon}
              <span className="leading-tight">{t.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function MasksPanel(p: MasksPanelProps) {
  const mask = p.masks.find((m) => m.id === p.activeId) ?? null;
  const [adding, setAdding] = React.useState<MaskComponent['mode'] | null>(null);
  const [tab, setTab] = React.useState<'light' | 'color' | 'effects' | 'detail'>('light');

  if (!mask) {
    return (
      <div className="space-y-4">
        {p.masks.length > 0 && (
          <div>
            <div className="label-xs mb-1.5">Your masks</div>
            <div className="space-y-1">
              {p.masks.map((m) => (
                <button key={m.id} type="button" onClick={() => p.setActive(m.id, m.components[0]?.id ?? null)} className="flex w-full items-center gap-3 rounded-lg bg-raised px-3 py-2.5 text-left ring-1 ring-line hover:bg-widget">
                  <span className="text-dim">{m.components[0] ? compIcon(m.components[0]) : <Layers size={18} />}</span>
                  <span className="flex-1 text-[13px]">{m.name}</span>
                  <span className="text-[11px] text-faint">{m.components.length} part{m.components.length === 1 ? '' : 's'}</span>
                  {!m.visible && <EyeOff size={14} className="text-faint" />}
                </button>
              ))}
            </div>
          </div>
        )}
        <div>
          <div className="label-xs mb-1.5">Adaptive presets</div>
          <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {ADAPTIVE.map((a) => (
              <button key={a.id} type="button" disabled={!!p.aiBusy || p.aiAvailable(a.kind) === false} onClick={() => p.onAdaptive(a)} className="flex shrink-0 items-center gap-1.5 rounded-full bg-raised px-3 py-2 text-[12px] text-dim ring-1 ring-line hover:text-fg disabled:opacity-35">
                {p.aiBusy === a.kind ? <Loader2 size={14} className="animate-spin" /> : a.icon} {a.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="label-xs mb-2 text-fg">Create new mask</div>
          <CreateGrid onPick={(s) => p.onCreate(s)} aiBusy={p.aiBusy} aiAvailable={p.aiAvailable} />
        </div>
      </div>
    );
  }

  const comp = mask.components.find((c) => c.id === p.activeComp) ?? null;
  const updMask = (m: Partial<Mask>, commit = false) => p.onChange(p.masks.map((x) => (x.id === mask.id ? { ...x, ...m } : x)), commit);
  const updComp = (c: MaskComponent, commit = false) => updMask({ components: mask.components.map((x) => (x.id === c.id ? c : x)) }, commit);
  const a = mask.adjust;
  const setA = (patch: Partial<LocalAdjust>) => updMask({ adjust: { ...a, ...patch } });
  const commit = () => p.onChange(p.masks, true);
  const S = (label: string, key: keyof LocalAdjust, min = -100, max = 100, step = 1, track?: string) => (
    <Slider key={key} label={label} value={a[key]} min={min} max={max} step={step} onChange={(v) => setA({ [key]: v } as Partial<LocalAdjust>)} onCommit={commit} track={track} format={key === 'exposure' ? (v) => (v > 0 ? '+' : '') + v.toFixed(2) : undefined} />
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1">
        <button type="button" className="icon-btn -ml-2 h-9 w-9" aria-label="All masks" onClick={() => p.setActive(null)}>
          <ChevronLeft size={18} />
        </button>
        <input className="min-w-0 flex-1 bg-transparent text-[14px] font-medium outline-none" value={mask.name} onChange={(e) => updMask({ name: e.target.value })} onBlur={commit} aria-label="Mask name" />
        <button type="button" className={cn('icon-btn h-9 w-9', p.overlay && 'text-accent')} title="Show overlay" onClick={() => p.setOverlay(!p.overlay)}>
          <SunMedium size={17} />
        </button>
        <button type="button" className="icon-btn h-9 w-9" title={mask.visible ? 'Hide mask' : 'Show mask'} onClick={() => updMask({ visible: !mask.visible }, true)}>
          {mask.visible ? <Eye size={17} /> : <EyeOff size={17} />}
        </button>
        <button type="button" className="icon-btn h-9 w-9" title="Duplicate & invert" onClick={() => {
          const id = Math.random().toString(36).slice(2, 10);
          const dup: Mask = { ...structuredClone(mask), id, name: `${mask.name} (inverted)`, components: mask.components.map((c, i) => ({ ...structuredClone(c), id: id + i, invert: i === 0 ? !c.invert : c.invert })) };
          p.onChange([...p.masks, dup], true);
          p.setActive(dup.id, dup.components[0]?.id);
        }}>
          <Copy size={16} />
        </button>
        <button type="button" className="icon-btn h-9 w-9 hover:text-danger" title="Delete mask" onClick={() => { p.onChange(p.masks.filter((x) => x.id !== mask.id), true); p.setActive(null); }}>
          <Trash2 size={16} />
        </button>
      </div>

      {/* components */}
      <div className="space-y-1">
        {mask.components.map((c, i) => (
          <div key={c.id} className={cn('flex items-center gap-2 rounded-lg px-2 py-1.5 ring-1', c.id === p.activeComp ? 'bg-widget ring-accent/60' : 'bg-raised ring-line')}>
            <button type="button" className="flex flex-1 items-center gap-2 text-left text-[13px]" onClick={() => p.setActive(mask.id, c.id)}>
              <span className={cn('flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold', c.mode === 'add' ? 'text-accent' : c.mode === 'subtract' ? 'text-danger' : 'text-amber-400')}>
                {i === 0 ? '' : c.mode === 'add' ? '+' : c.mode === 'subtract' ? '−' : '∩'}
              </span>
              <span className="text-dim">{compIcon(c)}</span>
              {compLabel(c)}
            </button>
            <button type="button" className={cn('icon-btn h-8 w-8', c.invert && 'text-accent')} title="Invert" onClick={() => updComp({ ...c, invert: !c.invert }, true)}>
              <FlipHorizontal2 size={15} />
            </button>
            {mask.components.length > 1 && (
              <button type="button" className="icon-btn h-8 w-8" title="Remove" onClick={() => updMask({ components: mask.components.filter((x) => x.id !== c.id) }, true)}>
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}
        <div className="grid grid-cols-3 gap-2 pt-1">
          <button type="button" className={cn('btn-solid h-8 text-[12px]', adding === 'add' && 'ring-2 ring-accent')} onClick={() => setAdding(adding === 'add' ? null : 'add')}><Plus size={14} /> Add</button>
          <button type="button" className={cn('btn-solid h-8 text-[12px]', adding === 'subtract' && 'ring-2 ring-accent')} onClick={() => setAdding(adding === 'subtract' ? null : 'subtract')}><Minus size={14} /> Subtract</button>
          <button type="button" className={cn('btn-solid h-8 text-[12px]', adding === 'intersect' && 'ring-2 ring-accent')} onClick={() => setAdding(adding === 'intersect' ? null : 'intersect')}>∩ Intersect</button>
        </div>
        {adding && (
          <div className="rounded-xl bg-bg/60 p-2 ring-1 ring-line">
            <CreateGrid compact onPick={(s) => { p.onCreate(s, { maskId: mask.id, mode: adding }); setAdding(null); }} aiBusy={p.aiBusy} aiAvailable={p.aiAvailable} />
          </div>
        )}
      </div>

      {/* active component controls */}
      {comp?.type === 'brush' && (
        <div className="rounded-xl bg-raised p-3 ring-1 ring-line">
          <div className="mb-1 flex items-center justify-between">
            <div className="label-xs">Brush — paint on the photo</div>
            <Segmented className="w-40" value={p.brush.erase ? 'erase' : 'paint'} onChange={(v) => p.setBrush({ ...p.brush, erase: v === 'erase' })} items={[{ id: 'paint', label: <span className="inline-flex items-center gap-1"><Brush size={12} /> Paint</span> }, { id: 'erase', label: <span className="inline-flex items-center gap-1"><Eraser size={12} /> Erase</span> }]} />
          </div>
          <Slider label="Size" value={Math.round(p.brush.size * 1000)} min={5} max={250} onChange={(v) => p.setBrush({ ...p.brush, size: v / 1000 })} />
          <Slider label="Feather" value={p.brush.feather} min={0} max={100} defaultValue={60} onChange={(v) => p.setBrush({ ...p.brush, feather: v })} />
          <Slider label="Flow" value={p.brush.flow} min={5} max={100} defaultValue={70} onChange={(v) => p.setBrush({ ...p.brush, flow: v })} />
          <p className="text-[11px] text-faint">Two fingers to pan/zoom while painting.</p>
        </div>
      )}
      {comp?.type === 'linear' && <p className="rounded-xl bg-raised p-3 text-[12px] text-dim ring-1 ring-line">Drag the two handles on the photo. The effect is full at the solid handle and fades out towards the dashed one.</p>}
      {comp?.type === 'radial' && (
        <div className="rounded-xl bg-raised p-3 ring-1 ring-line">
          <p className="mb-1 text-[12px] text-dim">Drag the centre to move, the edge handles to resize.</p>
          <Slider label="Feather" value={comp.feather} min={0} max={100} defaultValue={50} onChange={(feather) => updComp({ ...comp, feather })} onCommit={commit} />
          <Slider label="Angle" value={comp.angle} min={-90} max={90} onChange={(angle) => updComp({ ...comp, angle })} onCommit={commit} format={(v) => `${Math.round(v)}°`} />
        </div>
      )}
      {comp?.type === 'color' && (
        <div className="rounded-xl bg-raised p-3 ring-1 ring-line">
          <div className="mb-2 flex items-center gap-2">
            <button type="button" className={cn('btn-solid h-8 text-[12px]', p.picking && 'bg-accent text-white')} onClick={() => p.setPicking(!p.picking)}><Pipette size={14} /> {p.picking ? 'Tap the photo…' : 'Pick colour'}</button>
            <div className="flex gap-1">{comp.samples.map((s, i) => <span key={i} className="h-6 w-6 rounded-full ring-1 ring-white/30" style={{ background: `rgb(${s.r},${s.g},${s.b})` }} />)}</div>
            {comp.samples.length > 0 && <button type="button" className="ml-auto text-[11px] text-faint hover:text-fg" onClick={() => updComp({ ...comp, samples: [] }, true)}>Clear</button>}
          </div>
          <Slider label="Refine" value={comp.range} min={0} max={100} defaultValue={40} onChange={(range) => updComp({ ...comp, range })} onCommit={commit} />
        </div>
      )}
      {comp?.type === 'luminance' && (
        <div className="rounded-xl bg-raised p-3 ring-1 ring-line">
          <Slider label="From" value={comp.lo} min={0} max={100} onChange={(lo) => updComp({ ...comp, lo: Math.min(lo, comp.hi) })} onCommit={commit} track="lum" />
          <Slider label="To" value={comp.hi} min={0} max={100} defaultValue={100} onChange={(hi) => updComp({ ...comp, hi: Math.max(hi, comp.lo) })} onCommit={commit} track="lum" />
          <Slider label="Smoothness" value={comp.feather} min={0} max={100} defaultValue={50} onChange={(feather) => updComp({ ...comp, feather })} onCommit={commit} />
        </div>
      )}

      <Slider label="Amount" value={mask.opacity} min={0} max={100} defaultValue={100} onChange={(opacity) => updMask({ opacity })} onCommit={commit} />
      <Chips className="-mx-3" value={tab} onChange={setTab} items={[{ id: 'light', label: 'Light' }, { id: 'color', label: 'Color' }, { id: 'effects', label: 'Effects' }, { id: 'detail', label: 'Detail' }]} />
      {tab === 'light' && (
        <>
          {S('Exposure', 'exposure', -4, 4, 0.01, 'exposure')}
          {S('Contrast', 'contrast')}
          {S('Highlights', 'highlights')}
          {S('Shadows', 'shadows')}
          {S('Whites', 'whites')}
          {S('Blacks', 'blacks')}
        </>
      )}
      {tab === 'color' && (
        <>
          {S('Temp', 'temp', -100, 100, 1, 'temp')}
          {S('Tint', 'tint', -100, 100, 1, 'tint')}
          {S('Hue', 'hue', -100, 100, 1, 'hue')}
          {S('Saturation', 'saturation')}
          <div className="label-xs mt-2">Colour tint</div>
          {S('Tint hue', 'colorH', 0, 360, 1, 'hue')}
          {S('Tint strength', 'colorS', 0, 100)}
        </>
      )}
      {tab === 'effects' && (
        <>
          {S('Texture', 'texture')}
          {S('Clarity', 'clarity')}
          {S('Dehaze', 'dehaze')}
        </>
      )}
      {tab === 'detail' && (
        <>
          {S('Sharpness (− = blur)', 'sharpness')}
          {S('Noise reduction', 'noise', 0, 100)}
        </>
      )}
      <button type="button" className="text-[12px] text-faint hover:text-fg" onClick={() => updMask({ adjust: defaultLocal() }, true)}>Reset mask sliders</button>
      <Toggle on={p.overlay} onChange={p.setOverlay} label="Show mask overlay" />
    </div>
  );
}
