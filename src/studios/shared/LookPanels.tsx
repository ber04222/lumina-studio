import * as React from 'react';
import { Film, ImagePlus, Loader2, Palette, Save, Trash2, Upload, Download, X } from 'lucide-react';
import type { ColorMatch, EditSettings } from '@/types/edits';
import { Slider } from '@/components/Slider';
import { useFilePicker, useToast } from '@/components/ui';
import { cn } from '@/lib/utils';
import { referenceFromFile, type RefResult } from './reference';
import { deleteLut, importCube, listLuts, type LutInfo } from './luts';

export interface RefSource {
  id: string;
  name: string;
  thumb: string;
  kind: 'photo' | 'video';
  load: () => Promise<RefResult>;
}

/** "Copy colour tones" — match the look of any reference photo or video. */
export function MatchPanel({ match, onChange, sources, onSavePreset, title = 'Match a look' }: { match: ColorMatch; onChange: (m: ColorMatch, commit: boolean) => void; sources?: RefSource[]; onSavePreset?: () => void; title?: string }) {
  const toast = useToast();
  const [busy, setBusy] = React.useState<string | null>(null);
  const use = async (id: string, fn: () => Promise<RefResult>) => {
    setBusy(id);
    try {
      const r = await fn();
      onChange({ ...match, ref: r.stats, refName: r.name, refThumb: r.thumb, amount: match.ref ? match.amount : 100 }, true);
      toast(`Matched the look of “${r.name}”`, 'ok');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not read that file', 'error');
    } finally {
      setBusy(null);
    }
  };
  const pick = useFilePicker('image/*,video/*', false, (f) => f[0] && use('file', () => referenceFromFile(f[0])));
  return (
    <div className="space-y-3">
      <p className="text-[12px] leading-relaxed text-dim">{title}: pick a reference photo or video and Lumina copies its colour tones, contrast and split-toning onto this {sources?.some((s) => s.kind === 'video') ? 'clip' : 'image'}. Fine-tune with the sliders.</p>
      {match.ref ? (
        <div className="flex items-center gap-3 rounded-xl bg-raised p-2.5 ring-1 ring-line">
          {match.refThumb ? <img src={match.refThumb} alt="" className="h-14 w-14 rounded-lg object-cover" /> : <div className="h-14 w-14 rounded-lg bg-widget" />}
          <div className="min-w-0 flex-1">
            <div className="label-xs">Reference</div>
            <div className="truncate text-[13px]">{match.refName || 'Reference'}</div>
          </div>
          <button type="button" className="icon-btn h-9 w-9" aria-label="Remove reference" onClick={() => onChange({ ...match, ref: null, refName: '', refThumb: '' }, true)}>
            <X size={16} />
          </button>
        </div>
      ) : null}
      <button type="button" onClick={pick} className="btn-solid w-full" disabled={!!busy}>
        {busy === 'file' ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} Choose reference photo or video…
      </button>
      {sources && sources.length > 0 && (
        <div>
          <div className="label-xs mb-1.5">From your library</div>
          <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
            {sources.map((s) => (
              <button key={s.id} type="button" title={s.name} onClick={() => use(s.id, s.load)} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg ring-1 ring-line hover:ring-accent">
                {s.thumb ? <img src={s.thumb} alt={s.name} className="h-full w-full object-cover" /> : <div className="h-full w-full bg-widget" />}
                {s.kind === 'video' && <Film size={12} className="absolute bottom-1 left-1 text-white drop-shadow" />}
                {busy === s.id && <div className="absolute inset-0 flex items-center justify-center bg-black/50"><Loader2 size={16} className="animate-spin" /></div>}
              </button>
            ))}
          </div>
        </div>
      )}
      {match.ref && (
        <div>
          <Slider label="Amount" value={match.amount} min={0} max={150} defaultValue={100} onChange={(amount) => onChange({ ...match, amount }, false)} onCommit={() => onChange(match, true)} />
          <Slider label="Colour" value={match.color} min={0} max={100} defaultValue={100} onChange={(color) => onChange({ ...match, color }, false)} onCommit={() => onChange(match, true)} />
          <Slider label="Tone & contrast" value={match.tone} min={0} max={100} defaultValue={70} onChange={(tone) => onChange({ ...match, tone }, false)} onCommit={() => onChange(match, true)} />
          {onSavePreset && (
            <button type="button" className="btn-ghost mt-1 w-full" onClick={onSavePreset}>
              <Save size={15} /> Save this look as a preset
            </button>
          )}
        </div>
      )}
      {!match.ref && !sources?.length && (
        <div className="flex items-center gap-2 text-[12px] text-faint"><ImagePlus size={14} /> Tip: screenshots of a film or an Instagram post make great references.</div>
      )}
    </div>
  );
}

/** Creative LUTs (.cube) — import from DaVinci/Premiere packs, or export the current grade. */
export function LooksPanel({ e, set, commit, onExportCube }: { e: EditSettings; set: (p: Partial<EditSettings>) => void; commit: () => void; onExportCube?: () => void }) {
  const toast = useToast();
  const [luts, setLuts] = React.useState<LutInfo[]>([]);
  const refresh = React.useCallback(() => listLuts().then(setLuts), []);
  React.useEffect(() => {
    refresh();
  }, [refresh]);
  const pick = useFilePicker('.cube', true, async (files) => {
    for (const f of files) {
      try {
        const info = await importCube(f);
        set({ lut: { id: info.id, name: info.name, amount: 100 } });
        commit();
        toast(`Imported LUT “${info.name}” (${info.size}³)`, 'ok');
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Invalid LUT', 'error');
      }
    }
    refresh();
  });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn-solid" onClick={pick}><Upload size={15} /> Import .cube</button>
        {onExportCube && <button type="button" className="btn-solid" onClick={onExportCube}><Download size={15} /> Export as .cube</button>}
      </div>
      <div className="space-y-1">
        <button type="button" onClick={() => { set({ lut: { id: null, name: '', amount: 100 } }); commit(); }} className={cn('flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px]', !e.lut.id ? 'bg-widget text-fg' : 'text-dim hover:bg-widget/50')}>
          <Palette size={15} /> None
        </button>
        {luts.map((l) => (
          <div key={l.id} className={cn('flex items-center rounded-lg', e.lut.id === l.id ? 'bg-widget' : 'hover:bg-widget/50')}>
            <button type="button" onClick={() => { set({ lut: { id: l.id, name: l.name, amount: e.lut.id === l.id ? e.lut.amount : 100 } }); commit(); }} className={cn('flex flex-1 items-center gap-2 px-3 py-2 text-left text-[13px]', e.lut.id === l.id ? 'text-fg' : 'text-dim')}>
              <Palette size={15} /> <span className="truncate">{l.name}</span> <span className="ml-auto font-mono text-[10px] text-faint">{l.size}³</span>
            </button>
            <button type="button" className="icon-btn h-8 w-8" aria-label={`Delete ${l.name}`} onClick={async () => { await deleteLut(l.id); if (e.lut.id === l.id) { set({ lut: { id: null, name: '', amount: 100 } }); commit(); } refresh(); }}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
      {e.lut.id && <Slider label="LUT amount" value={e.lut.amount} min={0} max={100} defaultValue={100} onChange={(amount) => set({ lut: { ...e.lut, amount } })} onCommit={commit} />}
      <p className="text-[11px] leading-relaxed text-faint">Use display-referred (Rec.709) creative LUTs. Exported .cube files work in Premiere Pro, DaVinci Resolve, Final Cut and most video apps (global colour only — masks, detail and vignette aren't part of a LUT).</p>
    </div>
  );
}
