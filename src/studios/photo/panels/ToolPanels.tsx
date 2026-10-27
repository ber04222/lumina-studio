import { Bandage, Copy, FlipHorizontal2, FlipVertical2, RotateCcw, RotateCw, Stamp, Trash2, Undo2 } from 'lucide-react';
import type { EditSettings } from '@/types/edits';
import { Slider } from '@/components/Slider';
import { Segmented } from '@/components/ui';
import { aspectCrop, fitCrop, frameSize } from '@/engine/geometry';
import { cn } from '@/lib/utils';

// ── Remove (heal / clone) ─────────────────────────────────────────────────
export interface RemoveSettings {
  mode: 'heal' | 'clone';
  size: number;
  feather: number;
}

export function RemovePanel({ s, setS, count, onUndo, onClear, showSpots, setShowSpots }: { s: RemoveSettings; setS: (s: RemoveSettings) => void; count: number; onUndo: () => void; onClear: () => void; showSpots: boolean; setShowSpots: (v: boolean) => void }) {
  return (
    <div className="space-y-2">
      <Segmented
        value={s.mode}
        onChange={(mode) => setS({ ...s, mode })}
        items={[
          { id: 'heal', label: <span className="inline-flex items-center gap-1.5"><Bandage size={14} /> Heal</span> },
          { id: 'clone', label: <span className="inline-flex items-center gap-1.5"><Stamp size={14} /> Clone</span> },
        ]}
      />
      <p className="text-[12px] leading-relaxed text-dim">
        Paint over a blemish, wire, sensor spot or small object. Lumina finds matching texture nearby and blends it in{s.mode === 'heal' ? ' seamlessly' : ''}. Drag the dashed circle to choose a different source.
      </p>
      <Slider label="Brush size" value={Math.round(s.size * 1000)} min={4} max={150} onChange={(v) => setS({ ...s, size: v / 1000 })} />
      <Slider label="Feather" value={s.feather} min={0} max={100} defaultValue={40} onChange={(feather) => setS({ ...s, feather })} />
      <div className="flex items-center gap-2 pt-1">
        <button type="button" className="btn-solid flex-1" disabled={!count} onClick={onUndo}><Undo2 size={15} /> Undo spot</button>
        <button type="button" className="btn-solid flex-1" disabled={!count} onClick={onClear}><Trash2 size={15} /> Clear all</button>
      </div>
      <label className="flex items-center justify-between py-1 text-[12px] text-dim">
        <span>{count} spot{count === 1 ? '' : 's'} removed</span>
        <button type="button" className={cn('text-[12px]', showSpots ? 'text-accent' : 'text-faint')} onClick={() => setShowSpots(!showSpots)}>{showSpots ? 'Hide outlines' : 'Show outlines'}</button>
      </label>
    </div>
  );
}

// ── Crop & rotate ─────────────────────────────────────────────────────────
const ASPECTS: { id: string; label: string; v: number | null | 'orig' }[] = [
  { id: 'free', label: 'Free', v: null },
  { id: 'orig', label: 'Original', v: 'orig' },
  { id: '1:1', label: '1:1', v: 1 },
  { id: '4:5', label: '4:5', v: 4 / 5 },
  { id: '5:4', label: '5:4', v: 5 / 4 },
  { id: '3:2', label: '3:2', v: 3 / 2 },
  { id: '2:3', label: '2:3', v: 2 / 3 },
  { id: '16:9', label: '16:9', v: 16 / 9 },
  { id: '9:16', label: '9:16', v: 9 / 16 },
  { id: '4:3', label: '4:3', v: 4 / 3 },
];

export function CropPanel({ e, set, commit, srcW, srcH }: { e: EditSettings; set: (p: Partial<EditSettings>) => void; commit: () => void; srcW: number; srcH: number }) {
  const [fw, fh] = frameSize(e, srcW, srcH);
  const current = ASPECTS.find((a) => (a.v === 'orig' ? e.aspect != null && Math.abs(e.aspect - fw / fh) < 0.001 && a.id === 'orig' : a.v === e.aspect || (a.v != null && e.aspect != null && Math.abs((a.v as number) - e.aspect) < 0.001)))?.id ?? 'free';
  const pickAspect = (a: (typeof ASPECTS)[number]) => {
    if (a.v === null) {
      set({ aspect: null });
      commit();
      return;
    }
    const ratio = a.v === 'orig' ? fw / fh : a.v;
    set({ aspect: ratio, crop: fitCrop(aspectCrop(ratio, fw, fh), e.angle, fw, fh) });
    commit();
  };
  const rotate = (dir: 1 | -1) => {
    const r = (((e.rotate + dir * 90) % 360) + 360) % 360 as EditSettings['rotate'];
    set({ rotate: r, crop: { x: 0, y: 0, w: 1, h: 1 }, aspect: e.aspect ? 1 / e.aspect : null });
    commit();
  };
  return (
    <div className="space-y-3">
      <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
        {ASPECTS.map((a) => (
          <button key={a.id} type="button" onClick={() => pickAspect(a)} className={cn('chip', current === a.id ? 'chip-on' : 'bg-widget/50')}>
            {a.label}
          </button>
        ))}
      </div>
      <Slider
        label="Straighten"
        value={e.angle}
        min={-45}
        max={45}
        step={0.1}
        format={(v) => `${v.toFixed(1)}°`}
        onChange={(angle) => set({ angle, crop: fitCrop(e.aspect ? aspectCrop(e.aspect, fw, fh) : { x: 0, y: 0, w: 1, h: 1 }, angle, fw, fh) })}
        onCommit={commit}
      />
      <div className="grid grid-cols-5 gap-2">
        <button type="button" className="btn-solid px-0" title="Rotate left" onClick={() => rotate(-1)}><RotateCcw size={16} /></button>
        <button type="button" className="btn-solid px-0" title="Rotate right" onClick={() => rotate(1)}><RotateCw size={16} /></button>
        <button type="button" className={cn('btn-solid px-0', e.flipH && 'text-accent')} title="Flip horizontal" onClick={() => { set({ flipH: !e.flipH }); commit(); }}><FlipHorizontal2 size={16} /></button>
        <button type="button" className={cn('btn-solid px-0', e.flipV && 'text-accent')} title="Flip vertical" onClick={() => { set({ flipV: !e.flipV }); commit(); }}><FlipVertical2 size={16} /></button>
        <button type="button" className="btn-solid px-0 text-[12px]" title="Reset crop" onClick={() => { set({ crop: { x: 0, y: 0, w: 1, h: 1 }, angle: 0, aspect: null, rotate: 0, flipH: false, flipV: false }); commit(); }}>Reset</button>
      </div>
      <p className="text-[11px] text-faint">Drag the corners or edges on the photo; drag inside the frame to move it.</p>
    </div>
  );
}

// ── Copy / paste settings ─────────────────────────────────────────────────
export function CopySettingsList({ groups, setGroups }: { groups: Record<string, boolean>; setGroups: (g: Record<string, boolean>) => void }) {
  const labels: Record<string, string> = { light: 'Light & curve', color: 'Color, mix & grading', effects: 'Effects', detail: 'Detail & optics', looks: 'LUT & colour match', masks: 'Masks', geometry: 'Crop & geometry', heals: 'Removed spots' };
  return (
    <div className="space-y-0.5">
      {Object.keys(labels).map((k) => (
        <label key={k} className="flex items-center gap-3 rounded-lg px-2 py-2 text-[13px] hover:bg-widget/40">
          <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--accent))]" checked={!!groups[k]} onChange={(ev) => setGroups({ ...groups, [k]: ev.target.checked })} />
          {labels[k]}
        </label>
      ))}
      <div className="flex items-center gap-2 pt-1 text-[11px] text-faint"><Copy size={12} /> Choose what gets copied, then paste on any photo.</div>
    </div>
  );
}

export const COPY_DEFAULT = { light: true, color: true, effects: true, detail: true, looks: true, masks: false, geometry: false, heals: false };

export function pickGroups(src: EditSettings, dst: EditSettings, g: Record<string, boolean>): EditSettings {
  const out = { ...dst };
  const take = (keys: (keyof EditSettings)[]) => keys.forEach((k) => ((out as Record<string, unknown>)[k] = structuredClone(src[k])));
  if (g.light) take(['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'curves']);
  if (g.color) take(['temp', 'tint', 'vibrance', 'saturation', 'hsl', 'grading']);
  if (g.effects) take(['texture', 'clarity', 'dehaze', 'vignette', 'grain']);
  if (g.detail) take(['sharpen', 'noise', 'distortion', 'defringe']);
  if (g.looks) take(['lut', 'match']);
  if (g.geometry) take(['crop', 'aspect', 'angle', 'rotate', 'flipH', 'flipV']);
  if (g.heals) take(['heals']);
  return out;
}
