import * as React from 'react';
import { ChevronLeft, Check, ImagePlus, Loader2, Trash2, X, Images, Star } from 'lucide-react';
import type { PhotoItem } from '@/types/edits';
import { defaultEdits, normalizeEdits } from '@/types/edits';
import { db, debounce, requestPersistence, storeBlob, uid } from '@/lib/db';
import { Empty, useFilePicker, useToast } from '@/components/ui';
import { cn } from '@/lib/utils';
import PhotoEditor, { type Clipboard } from './photo/PhotoEditor';
import { pickGroups } from './photo/panels/ToolPanels';

async function makeThumb(blob: Blob, size = 360): Promise<{ thumb: string; w: number; h: number }> {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  const s = size / Math.max(bmp.width, bmp.height);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * s));
  c.height = Math.max(1, Math.round(bmp.height * s));
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  const out = { thumb: c.toDataURL('image/jpeg', 0.8), w: bmp.width, h: bmp.height };
  bmp.close();
  return out;
}

export default function PhotoStudio({ onExit }: { onExit: () => void }) {
  const toast = useToast();
  const [photos, setPhotos] = React.useState<PhotoItem[] | null>(null);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [selecting, setSelecting] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [importing, setImporting] = React.useState<number>(0);
  const [clipboard, setClipboard] = React.useState<Clipboard | null>(null);
  const [drag, setDrag] = React.useState(false);

  React.useEffect(() => {
    requestPersistence();
    db.all<PhotoItem>('photos').then((list) => setPhotos(list.map((p) => ({ ...p, edits: normalizeEdits(p.edits), masks: p.masks ?? [] })).sort((a, b) => b.createdAt - a.createdAt)));
  }, []);

  const saveLater = React.useMemo(() => {
    const map = new Map<string, (p: PhotoItem) => void>();
    return (p: PhotoItem) => {
      let f = map.get(p.id);
      if (!f) {
        f = debounce((x: PhotoItem) => db.put('photos', x.id, x), 600);
        map.set(p.id, f);
      }
      f(p);
    };
  }, []);

  const update = React.useCallback(
    (p: PhotoItem) => {
      setPhotos((list) => list?.map((x) => (x.id === p.id ? p : x)) ?? null);
      saveLater(p);
    },
    [saveLater],
  );

  const getBlob = React.useCallback((id: string) => db.get<Blob>('blobs', id), []);

  const importFiles = async (files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|avif|heic|heif|gif|bmp)$/i.test(f.name));
    if (!imgs.length) {
      toast('Choose image files (JPEG, PNG, WebP, HEIC on Safari…)', 'error');
      return;
    }
    setImporting(imgs.length);
    const added: PhotoItem[] = [];
    for (const f of imgs) {
      const id = uid();
      try {
        const data = await storeBlob(id, f);
        let meta: Awaited<ReturnType<typeof makeThumb>>;
        try {
          meta = await makeThumb(data);
        } catch {
          await db.del('blobs', id);
          throw new Error(`Couldn't read ${f.name} — this browser can't decode that format.`);
        }
        const { thumb, w, h } = meta;
        const p: PhotoItem = { id, name: f.name, width: w, height: h, createdAt: Date.now() + added.length, edits: defaultEdits(), masks: [], rating: 0, flag: 'none', thumb };
        await db.put('photos', id, p);
        added.push(p);
      } catch (err) {
        toast(err instanceof Error ? err.message : `Couldn't import ${f.name}`, 'error');
      }
      setImporting((n) => n - 1);
    }
    setImporting(0);
    if (added.length) {
      setPhotos((l) => [...added.reverse(), ...(l ?? [])]);
      if (added.length === 1) setOpenId(added[0].id);
      toast(`Imported ${added.length} photo${added.length > 1 ? 's' : ''}`, 'ok');
    }
  };
  const pick = useFilePicker('image/*', true, importFiles);

  const removeSelected = async () => {
    for (const id of selected) {
      await db.del('photos', id);
      await db.del('blobs', id);
      await db.del('aimaps', id);
    }
    setPhotos((l) => l?.filter((p) => !selected.has(p.id)) ?? null);
    toast(`Deleted ${selected.size} photo${selected.size > 1 ? 's' : ''}`, 'info');
    setSelected(new Set());
    setSelecting(false);
  };

  const syncAll = (c: Clipboard) => {
    setPhotos((list) => {
      if (!list) return list;
      return list.map((p) => {
        if (p.id === openId) return p;
        const np = { ...p, edits: pickGroups(c.edits, p.edits, c.groups), masks: c.groups.masks ? structuredClone(c.masks) : p.masks };
        db.put('photos', np.id, np);
        return np;
      });
    });
  };

  const open = photos?.find((p) => p.id === openId) ?? null;
  if (open && photos) {
    return (
      <PhotoEditor
        key={open.id}
        photo={open}
        library={photos}
        getBlob={getBlob}
        onUpdate={update}
        onBack={() => setOpenId(null)}
        clipboard={clipboard}
        setClipboard={setClipboard}
        onSyncAll={syncAll}
      />
    );
  }

  return (
    <div
      className="flex h-full flex-col bg-bg"
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        importFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <header className="safe-t flex h-14 shrink-0 items-center gap-1 px-2">
        <button type="button" className="icon-btn" onClick={onExit} aria-label="Home">
          <ChevronLeft size={22} />
        </button>
        <h1 className="flex-1 text-[17px] font-semibold">Photos</h1>
        {selecting ? (
          <>
            <button type="button" className="btn-ghost text-danger" disabled={!selected.size} onClick={removeSelected}>
              <Trash2 size={16} /> Delete {selected.size || ''}
            </button>
            <button type="button" className="icon-btn" onClick={() => { setSelecting(false); setSelected(new Set()); }} aria-label="Cancel selection">
              <X size={20} />
            </button>
          </>
        ) : (
          <>
            {!!photos?.length && <button type="button" className="btn-ghost" onClick={() => setSelecting(true)}>Select</button>}
            <button type="button" className="btn-accent" onClick={pick}>
              <ImagePlus size={16} /> Add
            </button>
          </>
        )}
      </header>
      <main className="thin-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-6">
        {photos === null ? (
          <div className="flex h-40 items-center justify-center text-dim"><Loader2 className="animate-spin" /></div>
        ) : photos.length === 0 ? (
          <Empty
            icon={<Images size={40} />}
            title="Your photo library is empty"
            body="Add photos from your device. Everything stays on this device — edits are saved automatically and never touch your originals."
            action={<button type="button" className="btn-accent mt-2" onClick={pick}><ImagePlus size={16} /> Add photos</button>}
          />
        ) : (
          <div className="grid grid-cols-3 gap-1 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
            {photos.map((p) => {
              const isSel = selected.has(p.id);
              const edited = JSON.stringify(p.edits) !== JSON.stringify(defaultEdits()) || p.masks.length > 0;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    if (selecting) {
                      const s = new Set(selected);
                      if (isSel) s.delete(p.id);
                      else s.add(p.id);
                      setSelected(s);
                    } else setOpenId(p.id);
                  }}
                  className={cn('group relative aspect-square overflow-hidden rounded-[3px] bg-raised', isSel && 'ring-2 ring-accent')}
                  aria-label={p.name}
                >
                  {p.thumb && <img src={p.thumb} alt="" className={cn('h-full w-full object-cover transition', isSel && 'scale-90 rounded')} loading="lazy" />}
                  {edited && !selecting && <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 text-[9px] font-semibold uppercase tracking-wider text-white/80">Edited</span>}
                  {p.rating > 0 && <span className="absolute bottom-1 left-1 flex items-center gap-0.5 rounded bg-black/60 px-1 text-[9px] text-amber-300"><Star size={9} fill="currentColor" />{p.rating}</span>}
                  {selecting && (
                    <span className={cn('absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white', isSel ? 'bg-accent' : 'bg-black/30')}>
                      {isSel && <Check size={12} strokeWidth={3} />}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
        {importing > 0 && (
          <div className="fixed inset-x-0 bottom-6 mx-auto flex w-fit items-center gap-2 rounded-full bg-raised px-4 py-2 text-[13px] shadow-xl ring-1 ring-line">
            <Loader2 size={14} className="animate-spin" /> Importing… {importing} left
          </div>
        )}
      </main>
      {drag && <div className="pointer-events-none fixed inset-3 z-50 flex items-center justify-center rounded-2xl border-2 border-dashed border-accent bg-accent/10 text-[15px] font-medium">Drop photos to import</div>}
    </div>
  );
}
