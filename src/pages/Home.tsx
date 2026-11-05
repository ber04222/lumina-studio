import * as React from 'react';
import { Aperture, Clapperboard, Sparkles, Palette, Layers, Wand2, Film, ShieldCheck, HardDriveDownload, HardDriveUpload, Loader2 } from 'lucide-react';
import { useFilePicker, useToast } from '@/components/ui';
import { downloadBlob } from '@/lib/db';
import { createBackup, restoreBackup } from '@/lib/backup';

function DataCard() {
  const toast = useToast();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [usage, setUsage] = React.useState('');
  const [persisted, setPersisted] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    navigator.storage?.estimate?.().then((e) => setUsage(e.usage ? `${(e.usage / 1e6).toFixed(0)} MB used on this device` : '')).catch(() => undefined);
    navigator.storage?.persisted?.().then(setPersisted).catch(() => undefined);
  }, [busy]);
  const backup = async () => {
    setBusy('Preparing backup…');
    try {
      const { blob, count } = await createBackup((m) => setBusy(m));
      const d = new Date().toISOString().slice(0, 10);
      if (await downloadBlob(blob, `lumina-backup-${d}.zip`)) toast(`Backup saved (${count} media files, ${(blob.size / 1e6).toFixed(0)} MB)`, 'ok');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Backup failed', 'error');
    } finally {
      setBusy(null);
    }
  };
  const pick = useFilePicker('.zip,application/zip', false, async (f) => {
    if (!f[0]) return;
    setBusy('Restoring…');
    try {
      const r = await restoreBackup(f[0]);
      toast(`Restored ${r.photos} photos and ${r.projects} video projects`, 'ok');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Restore failed', 'error');
    } finally {
      setBusy(null);
    }
  });
  return (
    <section className="mt-6 rounded-2xl bg-panel p-4 ring-1 ring-line">
      <div className="flex items-center gap-2 text-[14px] font-semibold"><ShieldCheck size={16} className="text-accent" /> Your data</div>
      <p className="mt-1 text-[12px] leading-relaxed text-dim">
        Photos, videos and edits are stored only in this browser on this device — nothing is uploaded. Browsers can clear site data, so keep a backup file (save it to Google Drive or your computer).
        {usage && <span className="block text-faint">{usage}{persisted === false ? ' · storage may be cleared when space is low' : persisted ? ' · protected from automatic clearing' : ''}</span>}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" className="btn-solid" disabled={!!busy} onClick={backup}>{busy ? <Loader2 size={15} className="animate-spin" /> : <HardDriveDownload size={15} />} Back up library</button>
        <button type="button" className="btn-solid" disabled={!!busy} onClick={pick}><HardDriveUpload size={15} /> Restore backup</button>
      </div>
      {busy && <div className="mt-2 text-[12px] text-dim">{busy}</div>}
    </section>
  );
}

// ── Card artwork: a graded before/after landscape and a mini timeline ────────
type SceneColors = [string, string, string, string, string, string];
const FLAT: SceneColors = ['#8f9aa0', '#c9c6bb', '#ece6d4', '#6d7775', '#4d5850', '#353c37'];
const GRADED: SceneColors = ['#0e3442', '#f0a06a', '#ffd9a8', '#1c4a55', '#14343d', '#0a1d23'];

function Scene({ c, id }: { c: SceneColors; id: string }) {
  const [skyTop, skyLow, sun, far, near, ground] = c;
  return (
    <svg viewBox="0 0 400 150" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
      <defs>
        <linearGradient id={`sky-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={skyTop} />
          <stop offset="0.85" stopColor={skyLow} />
        </linearGradient>
        <radialGradient id={`sun-${id}`}>
          <stop offset="0" stopColor={sun} />
          <stop offset="0.35" stopColor={sun} stopOpacity="0.9" />
          <stop offset="1" stopColor={sun} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="400" height="150" fill={`url(#sky-${id})`} />
      <circle cx="268" cy="86" r="46" fill={`url(#sun-${id})`} />
      <path d="M0 98 L52 70 L96 88 L150 58 L206 90 L250 74 L300 94 L352 66 L400 84 V150 H0Z" fill={far} />
      <path d="M0 112 C60 96 110 118 170 104 S290 92 340 108 S390 110 400 104 V150 H0Z" fill={near} />
      <path d="M0 128 C90 120 180 134 260 126 S360 122 400 128 V150 H0Z" fill={ground} />
    </svg>
  );
}

function PhotoArt() {
  return (
    <div className="relative mb-5 h-32 overflow-hidden rounded-xl ring-1 ring-white/5" aria-hidden>
      <Scene c={FLAT} id="flat" />
      <div className="absolute inset-0 transition-[clip-path] duration-500 ease-out [clip-path:inset(0_0_0_50%)] group-hover:[clip-path:inset(0_0_0_30%)]">
        <Scene c={GRADED} id="graded" />
      </div>
      <div className="absolute inset-y-0 left-1/2 w-px bg-white/80 transition-[left] duration-500 ease-out group-hover:left-[30%]">
        <span className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-lg ring-2 ring-black/20" />
      </div>
      <span className="absolute left-2 top-2 rounded-full bg-black/45 px-2 py-0.5 text-[10px] font-medium text-white/85 backdrop-blur">Before</span>
      <span className="absolute right-2 top-2 rounded-full bg-black/45 px-2 py-0.5 text-[10px] font-medium text-white/85 backdrop-blur">After</span>
    </div>
  );
}

const WAVE = Array.from({ length: 64 }, (_, i) => 0.35 + 0.65 * Math.abs(Math.sin(i * 0.9) * Math.cos(i * 0.37)));

function VideoArt() {
  const clips = [
    { w: 34, bg: 'linear-gradient(135deg,#0e3442,#f0a06a)' },
    { w: 26, bg: 'linear-gradient(135deg,#3b2a20,#d98f4e)' },
    { w: 38, bg: 'linear-gradient(135deg,#1b2b4a,#7aa6c9)' },
  ];
  return (
    <div className="relative mb-5 h-32 overflow-hidden rounded-xl bg-black/40 px-3 pt-2 ring-1 ring-white/5" aria-hidden>
      <div className="flex justify-between font-mono text-[9px] text-faint">
        {['0:00', '0:02', '0:04', '0:06', '0:08'].map((t) => <span key={t}>{t}</span>)}
      </div>
      <div className="mt-1.5 h-4 w-[44%] translate-x-[40%] rounded bg-violet-600/80 px-1.5 text-[9px] font-medium leading-4 text-white/90">T  Title</div>
      <div className="mt-1 flex h-9 gap-[3px]">
        {clips.map((c, i) => (
          <div key={i} className="rounded-md ring-1 ring-white/10" style={{ width: `${c.w}%`, background: c.bg }} />
        ))}
      </div>
      <div className="mt-1 flex h-6 items-center gap-[2px] rounded-md bg-emerald-800/60 px-1">
        {WAVE.map((h, i) => <span key={i} className="flex-1 rounded-full bg-emerald-300/70" style={{ height: `${h * 80}%` }} />)}
      </div>
      <div className="absolute inset-y-0 left-[37%] w-px bg-white transition-[left] duration-700 ease-out group-hover:left-[63%]">
        <span className="absolute -left-[5px] top-1 h-2.5 w-2.5 rotate-45 rounded-[2px] bg-white" />
      </div>
    </div>
  );
}

export default function Home({ onOpen }: { onOpen: (s: 'photo' | 'video') => void }) {
  return (
    <div className="thin-scroll flex h-full flex-col overflow-y-auto bg-bg">
      {/* .safe-t sets padding-top, so keep it off the element that needs its own top padding */}
      <div className="safe-t shrink-0">
      <header className="flex items-center justify-between px-5 pb-2 pt-5">
        <div className="flex items-center gap-2.5">
          <div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-raised ring-1 ring-line">
            <span className="h-4 w-4 rounded-full border-[3px] border-accent" />
            <span className="absolute h-1.5 w-1.5 rounded-full bg-amber-400" />
          </div>
          <span className="text-[17px] font-semibold tracking-tight">Lumina Studio</span>
        </div>
        <span className="text-[11px] text-faint">v2.0</span>
      </header>
      </div>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-8">
        <p className="mb-5 mt-2 max-w-xl px-1 text-[14px] leading-relaxed text-dim">
          Pro photo grading and video editing in one place — runs entirely in your browser on the GPU. Your files never leave this device.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <button type="button" onClick={() => onOpen('photo')} className="group relative overflow-hidden rounded-2xl bg-panel p-5 text-left ring-1 ring-line transition hover:ring-accent/60">
            <PhotoArt />
            <div className="flex items-center gap-2.5">
              <Aperture className="text-accent" size={22} />
              <h2 className="text-[20px] font-semibold tracking-tight">Photo</h2>
            </div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-dim">Lightroom-style editing: light, curves, colour mix, grading wheels, AI masks for subject/sky/people, remove tool, presets, crop.</p>
          </button>
          <button type="button" onClick={() => onOpen('video')} className="group relative overflow-hidden rounded-2xl bg-panel p-5 text-left ring-1 ring-line transition hover:ring-accent/60">
            <VideoArt />
            <div className="flex items-center gap-2.5">
              <Clapperboard className="text-accent" size={22} />
              <h2 className="text-[20px] font-semibold tracking-tight">Video</h2>
            </div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-dim">Premiere-style timeline with DaVinci-grade colour: trims, splits, speed, transitions, titles, music, LUTs, scopes, MP4 export.</p>
          </button>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {[
            { icon: <Palette size={16} />, t: 'Copy any look', d: 'Match colour tones from a reference photo or video.' },
            { icon: <Sparkles size={16} />, t: 'AI selections', d: 'Subject, sky, background, people — then adjust just that area.' },
            { icon: <Layers size={16} />, t: 'Pro masking', d: 'Brush, linear, radial, colour & luminance ranges with add/subtract.' },
            { icon: <Wand2 size={16} />, t: 'Presets & LUTs', d: 'Food, portrait, film looks. Import or export .cube LUTs.' },
            { icon: <Film size={16} />, t: 'Frame-accurate export', d: 'Full-res photos; MP4/WebM video rendered offline.' },
            { icon: <ShieldCheck size={16} />, t: 'Private & saved', d: 'Projects autosave on this device. Nothing is uploaded.' },
          ].map((f) => (
            <div key={f.t} className="rounded-xl bg-panel/60 p-3 ring-1 ring-line/60">
              <div className="mb-1 flex items-center gap-2 text-[13px] font-medium"><span className="text-accent">{f.icon}</span>{f.t}</div>
              <p className="text-[12px] leading-relaxed text-dim">{f.d}</p>
            </div>
          ))}
        </div>
        <DataCard />
      </main>
    </div>
  );
}
