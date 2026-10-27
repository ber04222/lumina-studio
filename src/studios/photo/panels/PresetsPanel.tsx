import * as React from 'react';
import { Check, Plus, Trash2 } from 'lucide-react';
import type { EditSettings, Mask, Preset } from '@/types/edits';
import { BUILT_IN_PRESETS, applyPreset, presetFromEdits } from '@/studios/shared/presets';
import { Slider } from '@/components/Slider';
import { useToast } from '@/components/ui';
import { db, uid } from '@/lib/db';
import { cn } from '@/lib/utils';

export function usePresets() {
  const [user, setUser] = React.useState<Preset[]>([]);
  const refresh = React.useCallback(() => db.all<Preset>('presets').then((p) => setUser(p.sort((a, b) => a.name.localeCompare(b.name)))), []);
  React.useEffect(() => {
    refresh();
  }, [refresh]);
  const save = async (name: string, e: EditSettings) => {
    const p: Preset = { id: uid(), name, group: 'Your presets', edits: presetFromEdits(e), user: true };
    await db.put('presets', p.id, p);
    await refresh();
    return p;
  };
  const remove = async (id: string) => {
    await db.del('presets', id);
    refresh();
  };
  return { user, save, remove };
}

export function PresetsPanel({
  e,
  masks,
  photoKey,
  thumbnail,
  onApply,
  presets,
}: {
  e: EditSettings;
  masks: Mask[];
  photoKey: string;
  thumbnail: (e: EditSettings, masks: Mask[]) => string;
  onApply: (e: EditSettings, commit: boolean) => void;
  presets: ReturnType<typeof usePresets>;
}) {
  const toast = useToast();
  const [thumbs, setThumbs] = React.useState<Record<string, string>>({});
  const [active, setActive] = React.useState<{ id: string; base: EditSettings } | null>(null);
  const [amount, setAmount] = React.useState(100);
  const [naming, setNaming] = React.useState<string | null>(null);
  const all = React.useMemo(() => [...presets.user, ...BUILT_IN_PRESETS], [presets.user]);
  const groups = React.useMemo(() => [...new Set(all.map((p) => p.group))], [all]);

  // lazily render preview thumbnails (a few per frame so the UI stays responsive)
  React.useEffect(() => {
    setThumbs({});
    let i = 0;
    let raf = 0;
    const next = () => {
      const batch = all.slice(i, i + 3);
      if (!batch.length) return;
      const out: Record<string, string> = {};
      for (const p of batch) out[p.id] = thumbnail(applyPreset(e, p), masks);
      setThumbs((t) => ({ ...t, ...out }));
      i += 3;
      raf = requestAnimationFrame(next);
    };
    raf = requestAnimationFrame(next);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoKey, all.length]);

  const choose = (p: Preset) => {
    const base = active ? active.base : e;
    setActive({ id: p.id, base });
    setAmount(100);
    onApply(applyPreset(base, p, 100), true);
  };

  return (
    <div>
      {active && (
        <div className="sticky top-0 z-10 -mx-4 mb-2 flex items-center gap-3 bg-panel px-4 pb-1">
          <div className="flex-1">
            <Slider
              label={`Amount · ${all.find((p) => p.id === active.id)?.name ?? ''}`}
              value={amount}
              min={0}
              max={150}
              defaultValue={100}
              onChange={(v) => {
                setAmount(v);
                const p = all.find((x) => x.id === active.id);
                if (p) onApply(applyPreset(active.base, p, v), false);
              }}
              onCommit={() => onApply(e, true)}
            />
          </div>
          <button type="button" className="btn-ghost h-8 px-2" onClick={() => setActive(null)} aria-label="Done">
            <Check size={16} />
          </button>
        </div>
      )}
      {groups.map((g) => (
        <section key={g} className="mb-3">
          <div className="label-xs mb-1.5">{g}</div>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-5 md:grid-cols-3">
            {all
              .filter((p) => p.group === g)
              .map((p) => (
                <div key={p.id} className="group relative">
                  <button type="button" onClick={() => choose(p)} className={cn('w-full overflow-hidden rounded-lg ring-1 ring-line transition', active?.id === p.id && 'ring-2 ring-accent')}>
                    <div className="aspect-square w-full bg-widget">{thumbs[p.id] && <img src={thumbs[p.id]} alt="" className="h-full w-full object-cover" />}</div>
                    <div className="truncate px-1 py-1 text-center text-[10.5px] text-dim">{p.name}</div>
                  </button>
                  {p.user && (
                    <button type="button" aria-label={`Delete ${p.name}`} onClick={() => presets.remove(p.id)} className="absolute right-1 top-1 hidden h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white group-hover:flex">
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              ))}
          </div>
        </section>
      ))}
      {naming !== null ? (
        <form
          className="flex gap-2"
          onSubmit={async (ev) => {
            ev.preventDefault();
            if (!naming.trim()) return;
            await presets.save(naming.trim(), e);
            toast(`Saved preset “${naming.trim()}”`, 'ok');
            setNaming(null);
          }}
        >
          <input autoFocus className="field flex-1" placeholder="Preset name" value={naming} onChange={(ev) => setNaming(ev.target.value)} />
          <button type="submit" className="btn-accent">Save</button>
        </form>
      ) : (
        <button type="button" className="btn-solid w-full" onClick={() => setNaming('')}>
          <Plus size={15} /> Create preset from current edit
        </button>
      )}
    </div>
  );
}
