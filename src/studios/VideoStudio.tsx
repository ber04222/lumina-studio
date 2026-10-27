import * as React from 'react';
import { ChevronLeft, Clapperboard, Loader2, Plus, Trash2 } from 'lucide-react';
import type { Project } from '@/types/video';
import { newProject, normalizeProject, projectDuration, formatTC } from '@/types/video';
import { db, debounce, requestPersistence, uid } from '@/lib/db';
import { Empty, useToast } from '@/components/ui';
import VideoEditor from './video/VideoEditor';
import { filmstrip } from './video/media';

export default function VideoStudio({ onExit }: { onExit: () => void }) {
  const toast = useToast();
  const [projects, setProjects] = React.useState<Project[] | null>(null);
  const [openId, setOpenId] = React.useState<string | null>(null);

  React.useEffect(() => {
    requestPersistence();
    db.all<Project>('projects').then((l) => setProjects(l.map(normalizeProject).sort((a, b) => b.updatedAt - a.updatedAt)));
  }, []);

  const save = React.useMemo(() => debounce((p: Project) => db.put('projects', p.id, p), 500), []);

  const onChange = React.useCallback(
    (p: Project) => {
      setProjects((l) => l?.map((x) => (x.id === p.id ? p : x)) ?? null);
      save(p);
      // refresh the project card thumbnail from its first clip
      const c = p.clips[0];
      const m = c && p.media.find((x) => x.id === c.mediaId);
      if (m && !p.thumb) {
        db.get<Blob>('blobs', m.id).then((b) => b && filmstrip(m, b, m.kind === 'image' ? 1 : 12, 56)).then((t) => {
          if (t?.[0]) {
            const np = { ...p, thumb: t[0] };
            setProjects((l) => l?.map((x) => (x.id === p.id ? { ...x, thumb: t[0] } : x)) ?? null);
            db.put('projects', np.id, np);
          }
        }).catch(() => undefined);
      }
    },
    [save],
  );

  const create = async () => {
    const p = newProject(uid());
    await db.put('projects', p.id, p);
    setProjects((l) => [p, ...(l ?? [])]);
    setOpenId(p.id);
  };

  const remove = async (p: Project) => {
    await db.del('projects', p.id);
    // media blobs are only referenced by this project
    for (const m of p.media) await db.del('blobs', m.id);
    setProjects((l) => l?.filter((x) => x.id !== p.id) ?? null);
    toast(`Deleted “${p.name}”`, 'info');
  };

  const open = projects?.find((p) => p.id === openId);
  if (open) return <VideoEditor key={open.id} project={open} onChange={onChange} onBack={() => setOpenId(null)} />;

  return (
    <div className="flex h-full flex-col bg-bg">
      <header className="safe-t flex h-14 shrink-0 items-center gap-1 px-2">
        <button type="button" className="icon-btn" onClick={onExit} aria-label="Home"><ChevronLeft size={22} /></button>
        <h1 className="flex-1 text-[17px] font-semibold">Video projects</h1>
        <button type="button" className="btn-accent" onClick={create}><Plus size={16} /> New</button>
      </header>
      <main className="thin-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-8">
        {projects === null ? (
          <div className="flex h-40 items-center justify-center text-dim"><Loader2 className="animate-spin" /></div>
        ) : projects.length === 0 ? (
          <Empty icon={<Clapperboard size={40} />} title="No projects yet" body="Start a project, add clips, photos and music, then cut, grade and export — all on this device." action={<button type="button" className="btn-accent mt-2" onClick={create}><Plus size={16} /> New project</button>} />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {projects.map((p) => (
              <div key={p.id} className="group relative overflow-hidden rounded-xl bg-panel ring-1 ring-line">
                <button type="button" onClick={() => setOpenId(p.id)} className="block w-full text-left">
                  <div className="aspect-video w-full bg-raised bg-cover bg-center" style={{ backgroundImage: p.thumb ? `url(${p.thumb})` : undefined }} />
                  <div className="p-2.5">
                    <div className="truncate text-[13px] font-medium">{p.name}</div>
                    <div className="mt-0.5 font-mono text-[10px] text-faint">{p.clips.length} clips · {formatTC(projectDuration(p), p.fps).slice(0, 5)} · {new Date(p.updatedAt).toLocaleDateString()}</div>
                  </div>
                </button>
                <button type="button" aria-label={`Delete ${p.name}`} onClick={() => remove(p)} className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white opacity-80 hover:bg-danger md:opacity-0 md:group-hover:opacity-100">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
