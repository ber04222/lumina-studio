import * as React from 'react';
import {
  ChevronLeft, Download, Pause, Play, Redo2, SkipBack, SkipForward, Undo2, Scissors, SlidersHorizontal, Palette, Copy, Trash2,
  ArrowLeftToLine, ArrowRightToLine, Type, Music2, Film, RectangleHorizontal, BarChart3, Diamond, Sparkles, Wand2, ClipboardPaste, Layers,
} from 'lucide-react';
import type { EditSettings } from '@/types/edits';
import { defaultEdits } from '@/types/edits';
import type { AudioClip, MediaRef, Project, Title, VClip } from '@/types/video';
import { activeAt, clipDur, clipStarts, newClip, projectDuration } from '@/types/video';
import { Player } from './Player';
import Timeline, { type Sel } from './Timeline';
import { AudioPanel, ClipPanel, ExportVideoSheet, FormatSheet, TitlePanel, TransitionPanel } from './panels';
import { TITLE_PRESETS } from './titles';
import { filmstrip, probe, waveform } from './media';
import { Chips, ToolBar, useFilePicker, useToast } from '@/components/ui';
import { ColorPanel, CurvePanel, EffectsPanel, GradingPanel, LightPanel, MixPanel } from '@/studios/shared/EditPanels';
import { LooksPanel, MatchPanel, type RefSource } from '@/studios/shared/LookPanels';
import { referenceFromImage, referenceFromVideo, type RefResult } from '@/studios/shared/reference';
import { BUILT_IN_PRESETS, applyPreset } from '@/studios/shared/presets';
import { usePresets } from '@/studios/photo/panels/PresetsPanel';
import { autoTone, sampleImage } from '@/engine/color';
import { drawScope, type ScopeKind } from '@/engine/scopes';
import { db, storeBlob, uid } from '@/lib/db';
import { acquireRenderer, releaseRenderer } from '@/lib/glResource';
import { cn } from '@/lib/utils';

type Panel = 'none' | 'clip' | 'color' | 'match' | 'looks' | 'transition' | 'title' | 'audio';
type ColorTab = 'light' | 'curve' | 'color' | 'mix' | 'grading' | 'effects' | 'lut';

export interface VideoEditorProps {
  project: Project;
  onChange: (p: Project) => void;
  onBack: () => void;
}

export default function VideoEditor({ project, onChange, onBack }: VideoEditorProps) {
  const toast = useToast();
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const overlayRef = React.useRef<HTMLCanvasElement>(null);
  const scopeRef = React.useRef<HTMLCanvasElement>(null);
  const stageRef = React.useRef<HTMLDivElement>(null);
  const playerRef = React.useRef<Player | null>(null);
  const [p, setP] = React.useState<Project>(project);
  const pRef = React.useRef(p);
  pRef.current = p;
  const hist = React.useRef<{ past: Project[]; future: Project[]; base: Project }>({ past: [], future: [], base: project });
  const [, bump] = React.useState(0);
  const [blobs, setBlobs] = React.useState<Map<string, Blob>>(new Map());
  const [time, setTime] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [pps, setPps] = React.useState(60);
  const [sel, setSel] = React.useState<Sel>(null);
  const [panel, setPanel] = React.useState<Panel>('none');
  const [colorTab, setColorTab] = React.useState<ColorTab>('light');
  const [formatOpen, setFormatOpen] = React.useState(false);
  const [exportOpen, setExportOpen] = React.useState(false);
  const [thumbs, setThumbs] = React.useState<Map<string, string[]>>(new Map());
  const [waves, setWaves] = React.useState<Map<string, Float32Array>>(new Map());
  const [scopes, setScopes] = React.useState<ScopeKind | null>(null);
  const [box, setBox] = React.useState({ w: 0, h: 0 });
  const [gradeClip, setGradeClip] = React.useState<EditSettings | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const userPresets = usePresets();
  const [compactUI, setCompactUI] = React.useState(() => window.innerHeight < 900);
  React.useEffect(() => {
    const on = () => setCompactUI(window.innerHeight < 900);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);

  // ── player lifecycle ─────────────────────────────────────────────────────
  React.useEffect(() => {
    const c = canvasRef.current!;
    try {
      const pl = acquireRenderer(c, (cv) => new Player(cv));
      pl.overlay = overlayRef.current;
      pl.onTime = (t) => setTime(t);
      pl.onState = (s) => setPlaying(s);
      playerRef.current = pl;
    } catch (err) {
      toast(err instanceof Error ? err.message : 'WebGL2 is required', 'error');
    }
    const lost = (ev: Event) => {
      ev.preventDefault();
      toast('The graphics processor was reset. Your project is saved — go back and reopen it.', 'error');
    };
    c.addEventListener('webglcontextlost', lost);
    return () => {
      c.removeEventListener('webglcontextlost', lost);
      playerRef.current?.pause();
      releaseRenderer(c);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // load media blobs
  React.useEffect(() => {
    let alive = true;
    (async () => {
      const m = new Map(blobs);
      let changed = false;
      for (const media of p.media)
        if (!m.has(media.id)) {
          const b = await db.get<Blob>('blobs', media.id);
          if (b) {
            m.set(media.id, b);
            changed = true;
          }
        }
      if (alive && changed) setBlobs(m);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.media]);

  // thumbnails & waveforms
  React.useEffect(() => {
    for (const m of p.media) {
      const b = blobs.get(m.id);
      if (!b) continue;
      if (m.kind !== 'audio' && !thumbs.has(m.id)) {
        thumbs.set(m.id, []);
        filmstrip(m, b, m.kind === 'image' ? 1 : 12, 56).then((t) => setThumbs((old) => new Map(old).set(m.id, t))).catch(() => undefined);
      }
      if ((m.kind === 'audio' || m.hasAudio) && !waves.has(m.id)) {
        waves.set(m.id, new Float32Array(1));
        waveform(m, b).then((w) => w && setWaves((old) => new Map(old).set(m.id, w))).catch(() => undefined);
      }
    }
  }, [p.media, blobs, thumbs, waves]);

  // push project to the player
  React.useEffect(() => {
    playerRef.current?.setProject(p, blobs);
  }, [p, blobs]);

  React.useEffect(() => {
    const pl = playerRef.current;
    if (pl) {
      pl.selectedTitle = sel?.kind === 'title' ? sel.id : null;
      pl.invalidate();
    }
  }, [sel]);

  // stage box: fit project aspect into the available area
  React.useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const fit = () => {
      const W = el.clientWidth - 16, H = el.clientHeight - 16;
      const a = pRef.current.aspect;
      const w = Math.min(W, H * a);
      setBox({ w: Math.max(10, Math.floor(w)), h: Math.max(10, Math.floor(w / a)) });
      playerRef.current?.invalidate();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [p.aspect]);

  // scopes
  React.useEffect(() => {
    const pl = playerRef.current;
    if (!pl) return;
    let last = 0;
    pl.onFrame = scopes
      ? () => {
          const now = performance.now();
          if (now - last < 150 || !scopeRef.current) return;
          last = now;
          const img = pl.scopeImage();
          if (img) drawScope(scopes, img, scopeRef.current);
        }
      : null;
    pl.invalidate();
  }, [scopes]);

  // ── history ──────────────────────────────────────────────────────────────
  const commit = React.useCallback(() => {
    const h = hist.current;
    const cur = pRef.current;
    if (JSON.stringify(cur) === JSON.stringify(h.base)) return;
    h.past.push(h.base);
    if (h.past.length > 60) h.past.shift();
    h.future = [];
    h.base = structuredClone(cur);
    onChange({ ...cur, updatedAt: Date.now() });
    bump((x) => x + 1);
  }, [onChange]);
  const update = (fn: (p: Project) => Project, doCommit = true) => {
    const next = fn(pRef.current);
    pRef.current = next;
    setP(next);
    if (doCommit) commit();
  };
  const restore = (s: Project) => {
    pRef.current = s;
    setP(s);
    hist.current.base = structuredClone(s);
    onChange({ ...s, updatedAt: Date.now() });
    bump((x) => x + 1);
  };
  const undo = () => {
    const h = hist.current;
    if (!h.past.length) return;
    h.future.push(h.base);
    restore(h.past.pop()!);
  };
  const redo = () => {
    const h = hist.current;
    if (!h.future.length) return;
    h.past.push(h.base);
    restore(h.future.pop()!);
  };

  // ── derived ──────────────────────────────────────────────────────────────
  const starts = React.useMemo(() => clipStarts(p.clips), [p.clips]);
  const total = projectDuration(p);
  const clip = sel?.kind === 'clip' || sel?.kind === 'transition' ? p.clips.find((c) => c.id === sel.id) ?? null : null;
  const clipIdx = clip ? p.clips.indexOf(clip) : -1;
  const title = sel?.kind === 'title' ? p.titles.find((t) => t.id === sel.id) ?? null : null;
  const audio = sel?.kind === 'audio' ? p.audio.find((a) => a.id === sel.id) ?? null : null;
  const mediaOf = (id: string) => p.media.find((m) => m.id === id);

  const updClip = (id: string, patch: Partial<VClip>, doCommit = false) => update((pp) => ({ ...pp, clips: pp.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) }), doCommit);
  const updTitle = (id: string, patch: Partial<Title>, doCommit = false) => update((pp) => ({ ...pp, titles: pp.titles.map((t) => (t.id === id ? { ...t, ...patch } : t)) }), doCommit);
  const updAudio = (id: string, patch: Partial<AudioClip>, doCommit = false) => update((pp) => ({ ...pp, audio: pp.audio.map((a) => (a.id === id ? { ...a, ...patch } : a)) }), doCommit);

  // ── import ───────────────────────────────────────────────────────────────
  const importFiles = async (files: File[], target: 'auto' | 'music' = 'auto') => {
    setBusy('Importing…');
    const nb = new Map(blobs);
    const added: MediaRef[] = [];
    for (const f of files) {
      try {
        const id = uid();
        const m = await probe(f, id);
        await storeBlob(id, f, f.type.startsWith('image/'));
        nb.set(id, f);
        added.push(m);
      } catch (err) {
        toast(err instanceof Error ? err.message : `Couldn't import ${f.name}`, 'error');
      }
    }
    setBlobs(nb);
    setBusy(null);
    if (!added.length) return;
    update((pp) => {
      const clips = [...pp.clips];
      const audioClips = [...pp.audio];
      for (const m of added) {
        if (m.kind === 'audio' || (target === 'music' && m.hasAudio && m.kind === 'video')) {
          const startAt = audioClips.reduce((acc, a) => Math.max(acc, a.start + a.out - a.in), 0);
          audioClips.push({ id: uid(), mediaId: m.id, start: startAt, in: 0, out: m.duration, volume: 0.8, fadeIn: 0.5, fadeOut: 1.5 });
        } else clips.push(newClip(uid(), m));
      }
      let aspect = pp.aspect;
      // first video sets the project aspect ratio
      const firstVid = added.find((m) => m.kind !== 'audio' && m.width && m.height);
      if (!pp.clips.length && firstVid) {
        const r = firstVid.width / firstVid.height;
        aspect = r < 0.8 ? 9 / 16 : r < 1.1 ? 1 : 16 / 9;
      }
      return { ...pp, media: [...pp.media, ...added], clips, audio: audioClips, aspect, name: pp.name === 'Untitled project' && added[0] ? added[0].name.replace(/\.[^.]+$/, '') : pp.name };
    });
    toast(`Added ${added.length} item${added.length > 1 ? 's' : ''}`, 'ok');
  };
  const pickMedia = useFilePicker('video/*,image/*,audio/*', true, (f) => importFiles(f));
  const pickMusic = useFilePicker('audio/*,video/*', true, (f) => importFiles(f, 'music'));

  // ── clip operations ──────────────────────────────────────────────────────
  const split = () => {
    const t = playerRef.current?.t ?? time;
    const act = activeAt(p.clips, t, starts);
    if (!act) return;
    const i = act.b;
    const c = p.clips[i];
    const local = t - starts[i];
    if (local < 0.08 || local > clipDur(c) - 0.08) {
      toast('Move the playhead inside a clip to split it', 'info');
      return;
    }
    const cut = c.in + local * c.speed;
    const b: VClip = { ...structuredClone(c), id: uid(), in: cut, transition: { type: 'none', duration: c.transition.duration } };
    update((pp) => {
      const clips = [...pp.clips];
      clips.splice(i, 1, { ...c, out: cut }, b);
      return { ...pp, clips };
    });
    setSel({ kind: 'clip', id: b.id });
  };
  const removeSel = () => {
    if (!sel) return;
    if (sel.kind === 'clip' || sel.kind === 'transition') update((pp) => ({ ...pp, clips: pp.clips.filter((c) => c.id !== sel.id) }));
    if (sel.kind === 'title') update((pp) => ({ ...pp, titles: pp.titles.filter((t) => t.id !== sel.id) }));
    if (sel.kind === 'audio') update((pp) => ({ ...pp, audio: pp.audio.filter((a) => a.id !== sel.id) }));
    setSel(null);
    setPanel('none');
  };
  const duplicate = () => {
    if (clip) {
      const d = { ...structuredClone(clip), id: uid() };
      update((pp) => {
        const clips = [...pp.clips];
        clips.splice(clipIdx + 1, 0, d);
        return { ...pp, clips };
      });
      setSel({ kind: 'clip', id: d.id });
    } else if (title) {
      const d = { ...title, id: uid(), start: title.start + title.duration };
      update((pp) => ({ ...pp, titles: [...pp.titles, d] }));
      setSel({ kind: 'title', id: d.id });
    }
  };
  const move = (dir: -1 | 1) => {
    if (!clip) return;
    const j = clipIdx + dir;
    if (j < 0 || j >= p.clips.length) return;
    update((pp) => {
      const clips = [...pp.clips];
      [clips[clipIdx], clips[j]] = [clips[j], clips[clipIdx]];
      return { ...pp, clips };
    });
  };
  const trim = (id: string, edge: 'in' | 'out', v: number, doCommit: boolean) => {
    const c = pRef.current.clips.find((x) => x.id === id);
    if (!c) return;
    const m = mediaOf(c.mediaId);
    const maxOut = m?.kind === 'image' ? 120 : m?.duration ?? c.out;
    if (edge === 'in') updClip(id, { in: Math.max(0, Math.min(c.out - 0.1, v)) }, doCommit);
    else updClip(id, { out: Math.min(maxOut, Math.max(c.in + 0.1, v)) }, doCommit);
  };
  const addTitle = () => {
    const { label: _l, ...preset } = TITLE_PRESETS.title;
    void _l;
    const t: Title = { id: uid(), text: 'Your title', start: playerRef.current?.t ?? time, duration: 3, style: 'title', x: 0.5, y: 0.5, size: 0.085, color: '#ffffff', bg: false, font: 'sans', anim: 'rise', ...preset };
    update((pp) => ({ ...pp, titles: [...pp.titles, t] }));
    setSel({ kind: 'title', id: t.id });
    setPanel('title');
  };

  // ── colour ───────────────────────────────────────────────────────────────
  const gradeApi = clip
    ? {
        e: clip.grade,
        set: (patch: Partial<EditSettings>) => updClip(clip.id, { grade: { ...clip.grade, ...patch } }),
        commit,
      }
    : null;

  const clipStats = async (c: VClip): Promise<RefResult | null> => {
    const m = mediaOf(c.mediaId);
    const b = m && blobs.get(m.id);
    if (!m || !b) return null;
    if (m.kind === 'image') {
      const bmp = await createImageBitmap(b);
      try {
        return await referenceFromImage(bmp, bmp.width, bmp.height, m.name);
      } finally {
        bmp.close();
      }
    }
    return referenceFromVideo(b, m.name, 6, [c.in, c.out]);
  };

  const refSources: RefSource[] = p.clips
    .filter((c) => c.id !== clip?.id)
    .map((c) => {
      const m = mediaOf(c.mediaId);
      return { id: c.id, name: m?.name ?? 'clip', thumb: thumbs.get(c.mediaId)?.[0] ?? '', kind: 'video' as const, load: async () => (await clipStats(c))! };
    });

  const setMatch = async (match: EditSettings['match'], doCommit: boolean) => {
    if (!clip) return;
    let srcStats = clip.srcStats;
    if (match.ref && !srcStats?.pts) {
      setBusy('Analysing clip…');
      srcStats = (await clipStats(clip))?.stats ?? null;
      setBusy(null);
    }
    updClip(clip.id, { grade: { ...clip.grade, match }, srcStats }, doCommit);
  };

  const matchAll = async () => {
    if (!clip?.grade.match.ref) return;
    setBusy('Matching all clips…');
    const ref = clip.grade.match;
    const clips: VClip[] = [];
    for (const c of pRef.current.clips) {
      const st = c.srcStats?.pts ? c.srcStats : ((await clipStats(c))?.stats ?? c.srcStats ?? null);
      clips.push({ ...c, srcStats: st, grade: { ...c.grade, match: { ...ref } } });
    }
    setBusy(null);
    update((pp) => ({ ...pp, clips }));
    toast('Every clip now matches this look', 'ok');
  };

  const autoColor = () => {
    if (!clip) return;
    const f = playerRef.current?.clipFrame(clip.id);
    if (!f) return toast('Move the playhead over this clip first', 'info');
    updClip(clip.id, { grade: { ...clip.grade, ...autoTone(sampleImage(f, f.width, f.height, 320)) } }, true);
    toast('Auto colour applied', 'ok');
  };

  const applyGradeAll = () => {
    if (!clip) return;
    const g = clip.grade;
    update((pp) => ({ ...pp, clips: pp.clips.map((c) => (c.id === clip.id ? c : { ...c, grade: { ...structuredClone(g), match: c.grade.match } })) }));
    toast('Grade applied to all clips', 'ok');
  };

  // ── keyboard ─────────────────────────────────────────────────────────────
  React.useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const pl = playerRef.current;
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === ' ') {
        e.preventDefault();
        pl?.toggle();
      } else if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (!mod && e.key.toLowerCase() === 's') split();
      else if (e.key === 'ArrowLeft') pl?.seek(pl.t - (e.shiftKey ? 1 : 1 / p.fps));
      else if (e.key === 'ArrowRight') pl?.seek(pl.t + (e.shiftKey ? 1 : 1 / p.fps));
      else if (e.key === 'Delete' || e.key === 'Backspace') removeSel();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  // drag titles on the preview
  const titleDrag = React.useRef<{ id: string } | null>(null);
  const onStagePointer = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    if (e.type === 'pointerdown') {
      if (title) {
        titleDrag.current = { id: title.id };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        updTitle(title.id, { x, y });
      } else playerRef.current?.toggle();
    } else if (e.type === 'pointermove' && titleDrag.current) updTitle(titleDrag.current.id, { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) });
    else if (e.type === 'pointerup' && titleDrag.current) {
      titleDrag.current = null;
      commit();
    }
  };

  // ── toolbar per context ─────────────────────────────────────────────────
  const openPanel = (pn: Panel) => setPanel(panel === pn ? 'none' : pn);
  const tools =
    sel?.kind === 'clip' || sel?.kind === 'transition'
      ? [
          { id: 'split', label: 'Split', icon: <Scissors size={19} />, fn: split },
          { id: 'clip', label: 'Edit', icon: <SlidersHorizontal size={19} />, fn: () => openPanel('clip') },
          { id: 'color', label: 'Color', icon: <Palette size={19} />, fn: () => openPanel('color') },
          { id: 'match', label: 'Match', icon: <Wand2 size={19} />, fn: () => openPanel('match') },
          { id: 'looks', label: 'Looks', icon: <Layers size={19} />, fn: () => openPanel('looks') },
          { id: 'transition', label: 'Transition', icon: <Diamond size={19} />, fn: () => openPanel('transition') },
          { id: 'dup', label: 'Duplicate', icon: <Copy size={19} />, fn: duplicate },
          { id: 'left', label: 'Move ◀', icon: <ArrowLeftToLine size={19} />, fn: () => move(-1) },
          { id: 'right', label: 'Move ▶', icon: <ArrowRightToLine size={19} />, fn: () => move(1) },
          { id: 'del', label: 'Delete', icon: <Trash2 size={19} />, fn: removeSel },
        ]
      : sel?.kind === 'title'
        ? [
            { id: 'title', label: 'Edit', icon: <Type size={19} />, fn: () => openPanel('title') },
            { id: 'dup', label: 'Duplicate', icon: <Copy size={19} />, fn: duplicate },
            { id: 'del', label: 'Delete', icon: <Trash2 size={19} />, fn: removeSel },
          ]
        : sel?.kind === 'audio'
          ? [
              { id: 'audio', label: 'Volume', icon: <Music2 size={19} />, fn: () => openPanel('audio') },
              { id: 'del', label: 'Delete', icon: <Trash2 size={19} />, fn: removeSel },
            ]
          : [
              { id: 'media', label: 'Media', icon: <Film size={19} />, fn: pickMedia },
              { id: 'text', label: 'Text', icon: <Type size={19} />, fn: addTitle },
              { id: 'music', label: 'Music', icon: <Music2 size={19} />, fn: pickMusic },
              { id: 'format', label: 'Format', icon: <RectangleHorizontal size={19} />, fn: () => setFormatOpen(true) },
              { id: 'scopes', label: 'Scopes', icon: <BarChart3 size={19} />, fn: () => setScopes(scopes ? null : 'waveform') },
            ];

  React.useEffect(() => {
    if (sel?.kind === 'transition') setPanel('transition');
    else if (sel?.kind === 'title') setPanel((pn) => (pn === 'title' ? pn : 'title'));
    else if (sel?.kind === 'audio') setPanel('audio');
    else if (!sel) setPanel('none');
    else if (sel.kind === 'clip') setPanel((pn) => (pn === 'title' || pn === 'audio' || pn === 'transition' ? 'none' : pn));
  }, [sel]);

  const panelBody = (() => {
    if (panel === 'clip' && clip) return <ClipPanel c={clip} kind={mediaOf(clip.mediaId)?.kind === 'image' ? 'image' : 'video'} onChange={(patch) => updClip(clip.id, patch)} onCommit={commit} />;
    if (panel === 'transition' && clip) return <TransitionPanel c={clip} prev={clipIdx > 0 ? p.clips[clipIdx - 1] : null} onChange={(patch) => updClip(clip.id, patch)} onCommit={commit} onApplyAll={() => update((pp) => ({ ...pp, clips: pp.clips.map((c, i) => (i === 0 ? c : { ...c, transition: { ...clip.transition } })) }))} />;
    if (panel === 'title' && title) return <TitlePanel t={title} onChange={(patch) => updTitle(title.id, patch)} onCommit={commit} />;
    if (panel === 'audio' && audio) return <AudioPanel a={audio} onChange={(patch) => updAudio(audio.id, patch)} onCommit={commit} />;
    if (panel === 'match' && clip)
      return (
        <div className="space-y-3">
          <MatchPanel title="Shot match" match={clip.grade.match} sources={refSources} onChange={(m, c) => setMatch(m, c)} />
          {clip.grade.match.ref && <button type="button" className="btn-solid w-full" onClick={matchAll}><Sparkles size={15} /> Match every clip to this look</button>}
        </div>
      );
    if (panel === 'looks' && clip && gradeApi)
      return (
        <div className="space-y-3">
          <div className="label-xs">Presets</div>
          <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
            {[...userPresets.user, ...BUILT_IN_PRESETS].map((pr) => (
              <button key={pr.id} type="button" className="chip bg-widget/50" onClick={() => { updClip(clip.id, { grade: applyPreset(clip.grade, pr) }, true); }}>{pr.name}</button>
            ))}
          </div>
          <LooksPanel e={clip.grade} set={gradeApi.set} commit={commit} />
        </div>
      );
    if (panel === 'color' && clip && gradeApi)
      return (
        <div>
          {colorTab === 'light' && <LightPanel {...gradeApi} />}
          {colorTab === 'curve' && <CurvePanel {...gradeApi} />}
          {colorTab === 'color' && <ColorPanel {...gradeApi} />}
          {colorTab === 'mix' && <MixPanel {...gradeApi} />}
          {colorTab === 'grading' && <GradingPanel {...gradeApi} />}
          {colorTab === 'effects' && <EffectsPanel {...gradeApi} />}
          {colorTab === 'lut' && <LooksPanel e={clip.grade} set={gradeApi.set} commit={commit} />}
          <div className="mt-3 grid grid-cols-3 gap-2 border-t border-line/60 pt-3">
            <button type="button" className="btn-solid h-8 px-2 text-[12px]" onClick={() => { setGradeClip(structuredClone(clip.grade)); toast('Grade copied', 'ok'); }}><Copy size={13} /> Copy</button>
            <button type="button" className="btn-solid h-8 px-2 text-[12px]" disabled={!gradeClip} onClick={() => gradeClip && updClip(clip.id, { grade: { ...structuredClone(gradeClip), match: clip.grade.match } }, true)}><ClipboardPaste size={13} /> Paste</button>
            <button type="button" className="btn-solid h-8 px-2 text-[12px]" onClick={applyGradeAll}>All clips</button>
          </div>
          <button type="button" className="mt-2 w-full text-[12px] text-faint hover:text-fg" onClick={() => updClip(clip.id, { grade: { ...defaultEdits(), match: clip.grade.match } }, true)}>Reset grade</button>
        </div>
      );
    return null;
  })();

  const pl = playerRef.current;
  const empty = p.clips.length === 0;

  return (
    <div className="flex h-full flex-col bg-bg">
      <header className="safe-t flex h-12 shrink-0 items-center gap-0.5 px-1.5">
        <button type="button" className="icon-btn" onClick={() => { pl?.pause(); onBack(); }} aria-label="Back to projects"><ChevronLeft size={22} /></button>
        <input className="min-w-0 flex-1 bg-transparent px-1 text-[14px] font-medium outline-none" value={p.name} onChange={(e) => update((pp) => ({ ...pp, name: e.target.value }), false)} onBlur={commit} aria-label="Project name" />
        <button type="button" className="icon-btn" onClick={undo} disabled={!hist.current.past.length} aria-label="Undo"><Undo2 size={19} /></button>
        <button type="button" className="icon-btn" onClick={redo} disabled={!hist.current.future.length} aria-label="Redo"><Redo2 size={19} /></button>
        <button type="button" className="btn-ghost h-8 px-2 font-mono text-[11px]" onClick={() => setFormatOpen(true)} aria-label="Format">
          {p.aspect > 1.7 ? '16:9' : p.aspect > 1.2 ? (p.aspect > 2 ? '21:9' : '4:3') : p.aspect > 0.95 ? '1:1' : p.aspect > 0.7 ? '4:5' : '9:16'}
        </button>
        <button type="button" className="btn-accent ml-1 h-8 px-3" onClick={() => { pl?.pause(); setExportOpen(true); }} disabled={empty}>
          <Download size={15} /> Export
        </button>
      </header>

      {/* preview */}
      <div ref={stageRef} className="relative flex min-h-0 flex-1 items-center justify-center bg-[#050506]">
        <div className="relative" style={{ width: box.w, height: box.h }} onPointerDown={onStagePointer} onPointerMove={onStagePointer} onPointerUp={onStagePointer}>
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
          <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" />
          {empty && (
            <button type="button" onClick={(e) => { e.stopPropagation(); pickMedia(); }} onPointerDown={(e) => e.stopPropagation()} className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-dim hover:text-fg">
              <Film size={30} />
              <span className="text-[14px] font-medium">Add videos, photos or music</span>
              <span className="text-[12px] text-faint">MP4 · MOV · WebM · JPG · PNG · MP3 · WAV</span>
            </button>
          )}
        </div>
        {scopes && (
          <button type="button" onClick={() => setScopes(scopes === 'waveform' ? 'parade' : scopes === 'parade' ? 'vectorscope' : scopes === 'vectorscope' ? 'histogram' : 'waveform')} className="absolute right-2 top-2 overflow-hidden rounded-lg bg-black/75 ring-1 ring-white/10" title="Tap to switch scope">
            <canvas ref={scopeRef} className={cn('block', scopes === 'vectorscope' ? 'h-[120px] w-[120px]' : 'h-[90px] w-[190px]')} />
            <span className="absolute bottom-0.5 left-1.5 text-[9px] uppercase tracking-wider text-white/50">{scopes}</span>
          </button>
        )}
        {busy && <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-raised px-4 py-1.5 text-[12px] ring-1 ring-line">{busy}</div>}
      </div>

      {/* transport */}
      <div className="flex h-11 shrink-0 items-center justify-center gap-2 border-t border-line bg-panel">
        <button type="button" className="icon-btn h-9 w-9" aria-label="Previous frame" onClick={() => pl?.seek(pl.t - 1 / p.fps)}><SkipBack size={17} /></button>
        <button type="button" className="flex h-9 w-9 items-center justify-center rounded-full bg-fg text-bg" aria-label={playing ? 'Pause' : 'Play'} onClick={() => pl?.toggle()} disabled={empty}>
          {playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" className="ml-0.5" />}
        </button>
        <button type="button" className="icon-btn h-9 w-9" aria-label="Next frame" onClick={() => pl?.seek(pl.t + 1 / p.fps)}><SkipForward size={17} /></button>
      </div>

      <Timeline
        p={p}
        time={time}
        playing={playing}
        pps={pps}
        setPps={setPps}
        sel={sel}
        onSelect={setSel}
        onScrub={(t) => pl?.seek(t)}
        onTrimClip={trim}
        onMoveTitle={(id, start, duration, c) => updTitle(id, { start, duration }, c)}
        onMoveAudio={(id, start, i, o, c) => updAudio(id, { start, in: i, out: o }, c)}
        onAddMedia={pickMedia}
        onAddTitle={addTitle}
        onAddMusic={pickMusic}
        thumbs={thumbs}
        waves={waves}
        compact={panel !== 'none' && compactUI}
      />

      {/* context panel */}
      {panel !== 'none' && panelBody && (
        <div className="flex max-h-[38vh] min-h-0 flex-col border-t border-line bg-panel md:max-h-[34vh]">
          {panel === 'color' && clip && (
            <div className="flex items-center border-b border-line/60">
              <button type="button" onClick={autoColor} className="ml-2 flex shrink-0 items-center gap-1 rounded-full bg-accent/15 px-3 py-1.5 text-[12px] font-semibold text-accent hover:bg-accent/25"><Sparkles size={14} /> Auto</button>
              <Chips className="flex-1 pl-2" value={colorTab} onChange={setColorTab} items={[{ id: 'light', label: 'Light' }, { id: 'curve', label: 'Curve' }, { id: 'color', label: 'Color' }, { id: 'mix', label: 'Mix' }, { id: 'grading', label: 'Wheels' }, { id: 'effects', label: 'Effects' }, { id: 'lut', label: 'LUT' }]} />
            </div>
          )}
          <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-4 py-2">{panelBody}</div>
        </div>
      )}

      <div className="safe-b shrink-0 border-t border-line bg-panel">
        <ToolBar
          className="justify-start md:justify-center [&>button]:flex-1 md:[&>button]:flex-none"
          value={panel === 'none' ? '' : panel}
          onChange={(id) => tools.find((t) => t.id === id)?.fn()}
          items={tools.map((t) => ({ id: t.id, label: t.label, icon: t.icon }))}
        />
      </div>

      <FormatSheet open={formatOpen} onClose={() => setFormatOpen(false)} p={p} onChange={(patch) => update((pp) => ({ ...pp, ...patch }))} />
      <ExportVideoSheet open={exportOpen} onClose={() => setExportOpen(false)} p={p} blobs={blobs} />
      <span className="sr-only">{total.toFixed(1)} seconds, {p.clips.length} clips</span>
    </div>
  );
}
