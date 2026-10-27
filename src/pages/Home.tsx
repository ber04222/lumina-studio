import { Aperture, Clapperboard, Sparkles, Palette, Layers, Wand2, Film, ShieldCheck } from 'lucide-react';

export default function Home({ onOpen }: { onOpen: (s: 'photo' | 'video') => void }) {
  return (
    <div className="thin-scroll flex h-full flex-col overflow-y-auto bg-bg">
      <header className="safe-t flex items-center justify-between px-5 pb-2 pt-5">
        <div className="flex items-center gap-2.5">
          <div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-raised ring-1 ring-line">
            <span className="h-4 w-4 rounded-full border-[3px] border-accent" />
            <span className="absolute h-1.5 w-1.5 rounded-full bg-amber-400" />
          </div>
          <span className="text-[17px] font-semibold tracking-tight">Lumina Studio</span>
        </div>
        <span className="text-[11px] text-faint">v2.0</span>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-8">
        <p className="mb-5 mt-2 max-w-xl px-1 text-[14px] leading-relaxed text-dim">
          Pro photo grading and video editing in one place — runs entirely in your browser on the GPU. Your files never leave this device.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <button type="button" onClick={() => onOpen('photo')} className="group relative overflow-hidden rounded-2xl bg-panel p-5 text-left ring-1 ring-line transition hover:ring-accent/60">
            <div className="mb-14 flex gap-1.5" aria-hidden>
              {['#2c3e50', '#8e5b3c', '#d9a066', '#4a6b8a', '#c9c2b4'].map((c, i) => (
                <div key={c} className="h-16 flex-1 rounded-md transition-transform group-hover:-translate-y-1" style={{ background: c, transitionDelay: `${i * 30}ms` }} />
              ))}
            </div>
            <div className="flex items-center gap-2.5">
              <Aperture className="text-accent" size={22} />
              <h2 className="text-[20px] font-semibold tracking-tight">Photo</h2>
            </div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-dim">Lightroom-style editing: light, curves, colour mix, grading wheels, AI masks for subject/sky/people, remove tool, presets, crop.</p>
          </button>
          <button type="button" onClick={() => onOpen('video')} className="group relative overflow-hidden rounded-2xl bg-panel p-5 text-left ring-1 ring-line transition hover:ring-accent/60">
            <div className="mb-14 space-y-1.5" aria-hidden>
              {[[38, 22, 30], [20, 44, 26], [60, 30]].map((row, r) => (
                <div key={r} className="flex gap-1.5">
                  {row.map((w, i) => (
                    <div key={i} className={r === 2 ? 'h-4 rounded bg-emerald-700/50' : r === 1 ? 'h-4 rounded bg-amber-600/40' : 'h-7 rounded bg-accent/40'} style={{ width: `${w}%` }} />
                  ))}
                </div>
              ))}
            </div>
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
      </main>
    </div>
  );
}
