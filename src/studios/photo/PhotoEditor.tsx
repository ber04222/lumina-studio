import * as React from 'react';
import {
  Bandage, ChevronLeft, Columns2, Crop as CropIcon, Download, Layers, Loader2, MoreHorizontal, Palette, Redo2, Sparkles,
  SlidersHorizontal, Undo2, Wand2, BarChart3, Copy, ClipboardPaste, RefreshCcw, Triangle, CopyCheck,
} from 'lucide-react';
import type { AIKind, EditSettings, HealSpot, Mask, MaskComponent, PhotoItem } from '@/types/edits';
import { AI_LABEL, defaultEdits, newLocalMask, MAX_MASKS } from '@/types/edits';
import { PhotoRenderer, decodeImage, type ViewState } from './PhotoRenderer';
import { outputToSource, sourceToOutput } from '@/engine/geometry';
import { analyze, lastAIError, type SegResult } from '@/engine/ai';
import { autoTone, s2l, sampleImage, writeCube } from '@/engine/color';
import { findHealSource } from '@/engine/heal';
import { drawScope, type ScopeKind } from '@/engine/scopes';
import { Chips, Sheet, ToolBar, useFilePicker, useToast } from '@/components/ui';
import { ColorPanel, CurvePanel, DetailPanel, EffectsPanel, GradingPanel, LightPanel, MixPanel, OpticsPanel } from '@/studios/shared/EditPanels';
import { LooksPanel, MatchPanel, type RefSource } from '@/studios/shared/LookPanels';
import { referenceFromImage } from '@/studios/shared/reference';
import { getLut } from '@/studios/shared/luts';
import { PresetsPanel, usePresets } from './panels/PresetsPanel';
import { ADAPTIVE, MasksPanel, type BrushSettings, type CompType } from './panels/MasksPanel';
import { COPY_DEFAULT, CopySettingsList, CropPanel, RemovePanel, pickGroups, type RemoveSettings } from './panels/ToolPanels';
import { ExportSheet, type ExportRequest } from './panels/ExportSheet';
import { CropOverlay, HealOverlay, MaskHandles, type Rect } from './Overlays';
import { db, downloadBlob, storeBlob, uid } from '@/lib/db';
import { acquireRenderer, releaseRenderer } from '@/lib/glResource';
import { cn } from '@/lib/utils';

type Tool = 'presets' | 'edit' | 'masks' | 'remove' | 'crop' | 'match';
type EditTab = 'light' | 'curve' | 'color' | 'mix' | 'grading' | 'effects' | 'detail' | 'optics' | 'looks';
type Snap = { edits: EditSettings; masks: Mask[] };

export interface Clipboard {
  edits: EditSettings;
  masks: Mask[];
  groups: Record<string, boolean>;
}

export interface PhotoEditorProps {
  photo: PhotoItem;
  library: PhotoItem[];
  getBlob: (id: string) => Promise<Blob | undefined>;
  onUpdate: (p: PhotoItem) => void;
  onBack: () => void;
  clipboard: Clipboard | null;
  setClipboard: (c: Clipboard) => void;
  onSyncAll: (c: Clipboard) => void;
}

const BG: [number, number, number] = [0.055, 0.055, 0.063];

export default function PhotoEditor({ photo, library, getBlob, onUpdate, onBack, clipboard, setClipboard, onSyncAll }: PhotoEditorProps) {
  const toast = useToast();
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const viewerRef = React.useRef<HTMLDivElement>(null);
  const scopeRef = React.useRef<HTMLCanvasElement>(null);
  const rendererRef = React.useRef<PhotoRenderer | null>(null);
  const [ready, setReady] = React.useState(false);
  const [fatal, setFatal] = React.useState<string | null>(null);
  const [missing, setMissing] = React.useState(false);
  const [reloadKey, setReloadKey] = React.useState(0);
  const relink = useFilePicker('image/*', false, async (files) => {
    const f = files[0];
    if (!f) return;
    try {
      await storeBlob(photo.id, f);
      setMissing(false);
      setFatal(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setFatal(err instanceof Error ? err.message : 'Could not save that file.');
    }
  });

  const [edits, setEdits] = React.useState<EditSettings>(photo.edits);
  const [masks, setMasks] = React.useState<Mask[]>(photo.masks);
  const stateRef = React.useRef<Snap>({ edits, masks });
  stateRef.current = { edits, masks };
  const history = React.useRef<{ past: Snap[]; future: Snap[]; base: Snap }>({ past: [], future: [], base: { edits: photo.edits, masks: photo.masks } });
  const [, bump] = React.useState(0);

  const [tool, setTool] = React.useState<Tool>('edit');
  const [editTab, setEditTab] = React.useState<EditTab>('light');
  const [view, setView] = React.useState<ViewState>({ zoom: 1, panX: 0, panY: 0, split: null, beforeOnly: false, overlayMask: null, clip: false, cropMode: false });
  const [rect, setRect] = React.useState<Rect>({ x: 0, y: 0, w: 0, h: 0, scale: 1 });
  const [activeMask, setActiveMask] = React.useState<string | null>(null);
  const [activeComp, setActiveComp] = React.useState<string | null>(null);
  const [overlay, setOverlay] = React.useState(true);
  const [brush, setBrush] = React.useState<BrushSettings>({ size: 0.05, feather: 60, flow: 70, erase: false });
  const [removeS, setRemoveS] = React.useState<RemoveSettings>({ mode: 'heal', size: 0.02, feather: 40 });
  const [showSpots, setShowSpots] = React.useState(true);
  const [picking, setPicking] = React.useState<'wb' | 'color' | null>(null);
  const [aiBusy, setAiBusy] = React.useState<string | null>(null);
  const [aiState, setAiState] = React.useState<SegResult | null>(null);
  const [scopes, setScopes] = React.useState<ScopeKind | null>(null);
  const [histo, setHisto] = React.useState<number[] | null>(null);
  const [exportOpen, setExportOpen] = React.useState(false);
  const [menu, setMenu] = React.useState(false);
  const [copyOpen, setCopyOpen] = React.useState(false);
  const [copyGroups, setCopyGroups] = React.useState<Record<string, boolean>>(COPY_DEFAULT);
  const [cursor, setCursor] = React.useState<{ x: number; y: number } | null>(null);
  const [healDraft, setHealDraft] = React.useState<{ x: number; y: number }[] | null>(null);
  const [progress, setProgress] = React.useState<{ msg: string; pct?: number } | null>(null);
  const presets = usePresets();

  // ── setup / load ─────────────────────────────────────────────────────────
  React.useEffect(() => {
    const c = canvasRef.current!;
    try {
      rendererRef.current = acquireRenderer(c, (cv) => new PhotoRenderer(cv));
    } catch (err) {
      setFatal(err instanceof Error ? err.message : 'Your browser does not support WebGL2.');
    }
    const lost = (ev: Event) => {
      ev.preventDefault();
      setFatal('The graphics processor was reset (this can happen when the device runs low on memory). Your edits are saved — go back and reopen the photo.');
    };
    c.addEventListener('webglcontextlost', lost);
    return () => {
      c.removeEventListener('webglcontextlost', lost);
      releaseRenderer(c);
    };
  }, []);

  React.useEffect(() => {
    let alive = true;
    setReady(false);
    (async () => {
      const r = rendererRef.current;
      if (!r) return;
      const blob = await getBlob(photo.id);
      if (!blob) {
        setMissing(true);
        setFatal('The original file for this photo wasn’t saved on this device, so it can’t be opened. Choose the same photo again to re-link it — your edits are kept.');
        return;
      }
      try {
        const full = await decodeImage(blob);
        if (!alive) return;
        r.load(photo.id, full);
        const cached = await db.get<SegResult>('aimaps', photo.id);
        if (cached && alive) {
          r.setAI(cached);
          setAiState(cached);
        } else setAiState(null);
        const lut = await getLut(photo.edits.lut.id);
        r.setLut(lut);
        if (alive) setReady(true);
      } catch (err) {
        setFatal(err instanceof Error ? err.message : 'Could not open this image.');
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo.id, reloadKey]);


  // ── history ──────────────────────────────────────────────────────────────
  const photoRef = React.useRef(photo);
  photoRef.current = photo;
  const persist = React.useCallback((s: Snap) => onUpdate({ ...photoRef.current, edits: s.edits, masks: s.masks }), [onUpdate]);
  const commit = React.useCallback(() => {
    const h = history.current;
    const cur = stateRef.current;
    if (JSON.stringify(cur) === JSON.stringify(h.base)) return;
    h.past.push(h.base);
    if (h.past.length > 80) h.past.shift();
    h.future = [];
    h.base = structuredClone(cur);
    persist(cur);
    bump((x) => x + 1);
  }, [persist]);
  const apply = (s: Snap) => {
    setEdits(s.edits);
    setMasks(s.masks);
    stateRef.current = s;
    history.current.base = structuredClone(s);
    persist(s);
    bump((x) => x + 1);
  };
  const undo = () => {
    const h = history.current;
    if (!h.past.length) return;
    h.future.push(h.base);
    apply(h.past.pop()!);
  };
  const redo = () => {
    const h = history.current;
    if (!h.future.length) return;
    h.past.push(h.base);
    apply(h.future.pop()!);
  };
  const set = React.useCallback((p: Partial<EditSettings>) => setEdits((e) => ({ ...e, ...p })), []);
  const setAndCommit = (p: Partial<EditSettings>) => {
    const next = { ...stateRef.current.edits, ...p };
    setEdits(next);
    stateRef.current = { ...stateRef.current, edits: next };
    commit();
  };
  const changeMasks = (m: Mask[], doCommit: boolean) => {
    setMasks(m);
    stateRef.current = { ...stateRef.current, masks: m };
    if (doCommit) commit();
  };

  // ── rendering ────────────────────────────────────────────────────────────
  const raf = React.useRef(0);
  const viewRef = React.useRef(view);
  viewRef.current = view;
  const overlayIdx = tool === 'masks' && overlay && activeMask ? masks.findIndex((m) => m.id === activeMask) : -1;
  const overlayRef = React.useRef(overlayIdx);
  overlayRef.current = overlayIdx;
  const scopeKind = React.useRef(scopes);
  scopeKind.current = scopes;
  const lastScope = React.useRef(0);
  const curveOpen = React.useRef(false);
  curveOpen.current = tool === 'edit' && editTab === 'curve';

  const scheduleRender = React.useCallback(() => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const r = rendererRef.current;
      if (!r || !r.work) return;
      const v = { ...viewRef.current, overlayMask: overlayRef.current >= 0 ? overlayRef.current : null };
      try {
        const rr = r.render(stateRef.current.edits, stateRef.current.masks, v, BG);
        if (rr) setRect((o) => (o.x === rr.x && o.y === rr.y && o.w === rr.w && o.h === rr.h ? o : rr));
      } catch (err) {
        console.error(err);
        setFatal(err instanceof Error ? err.message : 'Rendering failed');
        return;
      }
      const now = performance.now();
      if ((scopeKind.current || curveOpen.current) && now - lastScope.current > 120) {
        lastScope.current = now;
        const img = r.scopeImage();
        if (img && scopeKind.current && scopeRef.current) drawScope(scopeKind.current, img, scopeRef.current);
        if (img && curveOpen.current) {
          const h = new Array(64).fill(0);
          for (let i = 0; i < img.data.length; i += 4) h[Math.min(63, Math.floor((0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2]) / 4))]++;
          setHisto(h);
        }
      }
    });
  }, []);

  React.useEffect(() => {
    if (ready) scheduleRender();
  }, [ready, edits, masks, view, overlayIdx, scopes, editTab, tool, scheduleRender]);

  // LUT changes
  React.useEffect(() => {
    if (!ready) return;
    getLut(edits.lut.id).then((l) => {
      rendererRef.current?.setLut(l);
      scheduleRender();
    });
  }, [edits.lut.id, ready, scheduleRender]);

  React.useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => scheduleRender());
    ro.observe(el);
    return () => ro.disconnect();
  }, [scheduleRender]);

  // crop tool shows the full frame
  React.useEffect(() => {
    setView((v) => ({ ...v, cropMode: tool === 'crop', zoom: tool === 'crop' ? 1 : v.zoom, panX: tool === 'crop' ? 0 : v.panX, panY: tool === 'crop' ? 0 : v.panY }));
    if (tool !== 'masks') setPicking((p) => (p === 'color' ? null : p));
  }, [tool]);

  // thumbnail refresh for the library (debounced)
  React.useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => {
      const r = rendererRef.current;
      if (!r) return;
      const thumb = r.thumbnail(stateRef.current.edits, stateRef.current.masks, 360);
      onUpdate({ ...photoRef.current, edits: stateRef.current.edits, masks: stateRef.current.masks, thumb });
      scheduleRender();
    }, 1400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edits, masks, ready]);

  // keyboard shortcuts
  React.useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (e.key === '\\') setView((v) => ({ ...v, beforeOnly: !v.beforeOnly }));
      else if (e.key === '0') setView((v) => ({ ...v, zoom: 1, panX: 0, panY: 0 }));
      else if (e.key === '=' || e.key === '+') setView((v) => ({ ...v, zoom: Math.min(8, v.zoom * 1.25) }));
      else if (e.key === '-') setView((v) => ({ ...v, zoom: Math.max(1, v.zoom / 1.25) }));
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  // ── coordinate mapping ───────────────────────────────────────────────────
  const W = rendererRef.current?.work?.width ?? 1;
  const H = rendererRef.current?.work?.height ?? 1;
  const toSource = React.useCallback(
    (p: { x: number; y: number }) => {
      const u = (p.x - rect.x) / rect.w;
      const v = (p.y - rect.y) / rect.h;
      return outputToSource(stateRef.current.edits, W, H, u, v, !viewRef.current.cropMode);
    },
    [rect, W, H],
  );
  const toScreen = React.useCallback(
    (p: { x: number; y: number }) => {
      const o = sourceToOutput(stateRef.current.edits, W, H, p.x, p.y, !viewRef.current.cropMode);
      return { x: rect.x + o.x * rect.w, y: rect.y + o.y * rect.h };
    },
    [rect, W, H],
  );

  // ── AI ───────────────────────────────────────────────────────────────────
  const ensureAI = async (kind: string): Promise<boolean> => {
    const r = rendererRef.current;
    if (!r?.work) return false;
    // (re)run the AI when there's no result yet, or only a quick estimate from an earlier failed attempt
    if (!r.ai || r.ai.source === 'estimate') {
      setAiBusy(kind);
      try {
        const res = await analyze(r.work, r.work.width, r.work.height, (msg, pct) => setProgress({ msg, pct }));
        if (res.source === 'ai' || !r.ai) {
          r.setAI(res);
          setAiState(res);
          db.put('aimaps', photo.id, res);
        }
        if (res.source === 'estimate') toast(`Couldn't load the AI model${lastAIError ? ` (${lastAIError.slice(0, 80)})` : ''} — using a quick estimate. Check your connection and tap again to retry.`, 'error');
      } finally {
        setAiBusy(null);
        setProgress(null);
      }
    }
    if (!r.hasAI(kind)) {
      toast(r.ai?.source === 'estimate' ? `${AI_LABEL[kind as AIKind]} needs the AI model (connect to the internet once).` : `No ${AI_LABEL[kind as AIKind].toLowerCase()} detected in this photo.`, 'error');
      return false;
    }
    return true;
  };
  // true = ready, false = not in this photo, null = unknown (tap to analyse / retry)
  const aiAvailable = (k: AIKind) => (aiState ? (aiState.maps[k] ? true : aiState.source === 'ai' ? false : null) : null);

  const makeComp = (type: CompType, kind?: AIKind): MaskComponent => {
    const id = uid();
    const base = { id, mode: 'add' as const, invert: false };
    switch (type) {
      case 'brush': return { ...base, type: 'brush', strokes: [] };
      case 'linear': return { ...base, type: 'linear', x0: 0.5, y0: 0.15, x1: 0.5, y1: 0.55 };
      case 'radial': return { ...base, type: 'radial', cx: 0.5, cy: 0.5, rx: 0.22, ry: 0.22 * (W / H), angle: 0, feather: 50 };
      case 'color': return { ...base, type: 'color', samples: [], range: 40 };
      case 'luminance': return { ...base, type: 'luminance', lo: 60, hi: 100, feather: 50 };
      default: return { ...base, type: 'ai', kind: kind ?? 'subject' };
    }
  };

  const createMask = async (spec: { type: CompType; kind?: AIKind }, into?: { maskId: string; mode: MaskComponent['mode'] }) => {
    if (spec.type === 'ai' && !(await ensureAI(spec.kind!))) return;
    const comp = { ...makeComp(spec.type, spec.kind), mode: into?.mode ?? 'add' };
    const cur = stateRef.current.masks;
    if (into) {
      changeMasks(cur.map((m) => (m.id === into.maskId ? { ...m, components: [...m.components, comp] } : m)), true);
      setActiveComp(comp.id);
    } else {
      if (cur.length >= MAX_MASKS) {
        toast(`Up to ${MAX_MASKS} masks per photo`, 'error');
        return;
      }
      const label = spec.type === 'ai' ? AI_LABEL[spec.kind!] : spec.type === 'color' ? 'Color range' : spec.type === 'luminance' ? 'Light range' : spec.type[0].toUpperCase() + spec.type.slice(1);
      const m = newLocalMask(uid(), `${label} ${cur.length + 1}`, [comp]);
      changeMasks([...cur, m], true);
      setActiveMask(m.id);
      setActiveComp(comp.id);
    }
    setOverlay(true);
    if (spec.type === 'color') setPicking('color');
  };

  const adaptive = async (a: (typeof ADAPTIVE)[number]) => {
    if (!(await ensureAI(a.kind))) return;
    const comp = makeComp('ai', a.kind);
    const m = newLocalMask(uid(), a.label, [comp]);
    m.adjust = { ...m.adjust, ...a.adjust };
    changeMasks([...stateRef.current.masks, m], true);
    setActiveMask(m.id);
    setActiveComp(comp.id);
    setOverlay(false);
  };

  // ── viewer gestures ──────────────────────────────────────────────────────
  const pointers = React.useRef(new Map<number, { x: number; y: number }>());
  const gesture = React.useRef<
    | { kind: 'pinch'; d: number; cx: number; cy: number; zoom: number; panX: number; panY: number }
    | { kind: 'pan'; x: number; y: number; panX: number; panY: number; moved: boolean; t: number; timer: ReturnType<typeof setTimeout> | null }
    | { kind: 'paint' }
    | { kind: 'heal'; pts: { x: number; y: number }[] }
    | { kind: 'split' }
    | null
  >(null);
  const lastTap = React.useRef({ t: 0, x: 0, y: 0 });
  const activeMaskObj = masks.find((m) => m.id === activeMask) ?? null;
  const activeCompObj = activeMaskObj?.components.find((c) => c.id === activeComp) ?? null;
  const painting = tool === 'masks' && activeCompObj?.type === 'brush';

  const local = (e: React.PointerEvent | React.WheelEvent) => {
    const b = viewerRef.current!.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  };

  const pickAt = (p: { x: number; y: number }) => {
    const r = rendererRef.current!;
    const s = toSource(p);
    if (s.x < 0 || s.y < 0 || s.x > 1 || s.y > 1) return;
    // average a small neighbourhood
    let R = 0, G = 0, B = 0;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const [a, b, c] = r.sourcePixel(s.x + dx / W, s.y + dy / H);
        R += a; G += b; B += c;
      }
    R /= 25; G /= 25; B /= 25;
    if (picking === 'wb') {
      const rl = Math.max(1e-4, s2l(R / 255)), gl = Math.max(1e-4, s2l(G / 255)), bl = Math.max(1e-4, s2l(B / 255));
      const t = Math.log2(bl / rl) / 1.1;
      const gr = 2 ** (t * 0.55), gb = 2 ** (-t * 0.55);
      const u = -Math.log2(Math.sqrt(rl * gr * bl * gb) / gl) / 0.35;
      setAndCommit({ temp: Math.round(Math.max(-100, Math.min(100, t * 100))), tint: Math.round(Math.max(-100, Math.min(100, u * 100))) });
      setPicking(null);
      toast('White balance set from the picked point', 'ok');
    } else if (picking === 'color' && activeMaskObj && activeCompObj?.type === 'color') {
      const c = { ...activeCompObj, samples: [...activeCompObj.samples, { r: Math.round(R), g: Math.round(G), b: Math.round(B) }].slice(-5) };
      changeMasks(masks.map((m) => (m.id === activeMaskObj.id ? { ...m, components: m.components.map((x) => (x.id === c.id ? c : x)) } : m)), true);
    }
  };

  const addStrokePoint = (p: { x: number; y: number }, start: boolean) => {
    if (!activeMaskObj || activeCompObj?.type !== 'brush') return;
    const s = toSource(p);
    const comp = activeCompObj;
    const strokes = [...comp.strokes];
    if (start) strokes.push({ points: [s], size: brush.size / viewRef.current.zoom, feather: brush.feather, flow: brush.flow, erase: brush.erase });
    else {
      const last = strokes[strokes.length - 1];
      if (!last) return;
      const lp = last.points[last.points.length - 1];
      if (Math.hypot((lp.x - s.x) * W, (lp.y - s.y) * H) < last.size * Math.max(W, H) * 0.12) return;
      strokes[strokes.length - 1] = { ...last, points: [...last.points, s] };
    }
    const nc = { ...comp, strokes };
    const nm = stateRef.current.masks.map((m) => (m.id === activeMaskObj.id ? { ...m, components: m.components.map((x) => (x.id === nc.id ? nc : x)) } : m));
    changeMasks(nm, false);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!ready || view.cropMode) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 2) {
      const g = gesture.current;
      if (g?.kind === 'pan' && g.timer) clearTimeout(g.timer);
      if (g?.kind === 'paint') commit();
      setHealDraft(null);
      const [a, b] = [...pointers.current.values()];
      gesture.current = { kind: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, zoom: view.zoom, panX: view.panX, panY: view.panY };
      setView((v) => ({ ...v, beforeOnly: false }));
      return;
    }
    if (picking) {
      pickAt(p);
      gesture.current = null;
      return;
    }
    if (view.split != null && Math.abs(p.x - (rect.x + rect.w * view.split)) < 28) {
      gesture.current = { kind: 'split' };
      return;
    }
    if (painting && e.button === 0) {
      gesture.current = { kind: 'paint' };
      addStrokePoint(p, true);
      return;
    }
    if (tool === 'remove' && e.button === 0) {
      gesture.current = { kind: 'heal', pts: [toSource(p)] };
      setHealDraft([toSource(p)]);
      return;
    }
    const timer = setTimeout(() => setView((v) => ({ ...v, beforeOnly: true })), 380);
    gesture.current = { kind: 'pan', x: p.x, y: p.y, panX: view.panX, panY: view.panY, moved: false, t: performance.now(), timer };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = local(e);
    if (painting || tool === 'remove') setCursor(p);
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    if (!g) return;
    if (g.kind === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const zoom = Math.min(10, Math.max(1, g.zoom * (d / g.d)));
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      const vw = viewerRef.current!.clientWidth, vh = viewerRef.current!.clientHeight;
      // keep the pinch centre stable
      const k = zoom / g.zoom;
      const panX = (g.cx - vw / 2) - (g.cx - vw / 2 - g.panX) * k + (cx - g.cx);
      const panY = (g.cy - vh / 2) - (g.cy - vh / 2 - g.panY) * k + (cy - g.cy);
      setView((v) => ({ ...v, zoom, panX: zoom === 1 ? 0 : panX, panY: zoom === 1 ? 0 : panY }));
    } else if (g.kind === 'pan') {
      const dx = p.x - g.x, dy = p.y - g.y;
      if (Math.hypot(dx, dy) > 6) {
        g.moved = true;
        if (g.timer) clearTimeout(g.timer);
        g.timer = null;
      }
      if (g.moved && view.zoom > 1) setView((v) => ({ ...v, panX: g.panX + dx, panY: g.panY + dy }));
    } else if (g.kind === 'paint') addStrokePoint(p, false);
    else if (g.kind === 'heal') {
      const s = toSource(p);
      const lp = g.pts[g.pts.length - 1];
      if (Math.hypot((lp.x - s.x) * W, (lp.y - s.y) * H) > removeS.size * Math.max(W, H) * 0.25) {
        g.pts.push(s);
        setHealDraft([...g.pts]);
      }
    } else if (g.kind === 'split') {
      setView((v) => ({ ...v, split: Math.min(1, Math.max(0, (p.x - rect.x) / rect.w)) }));
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (g?.kind === 'pinch') {
      if (pointers.current.size === 0) gesture.current = null;
      return;
    }
    gesture.current = null;
    if (!g) return;
    if (g.kind === 'pan') {
      if (g.timer) clearTimeout(g.timer);
      if (view.beforeOnly) setView((v) => ({ ...v, beforeOnly: false }));
      else if (!g.moved) {
        const now = performance.now();
        const p = local(e);
        if (now - lastTap.current.t < 300 && Math.hypot(p.x - lastTap.current.x, p.y - lastTap.current.y) < 30) {
          // double tap: toggle zoom around the tapped point
          const vw = viewerRef.current!.clientWidth, vh = viewerRef.current!.clientHeight;
          setView((v) => (v.zoom > 1 ? { ...v, zoom: 1, panX: 0, panY: 0 } : { ...v, zoom: 2.5, panX: -(p.x - vw / 2) * 1.5, panY: -(p.y - vh / 2) * 1.5 }));
          lastTap.current.t = 0;
        } else lastTap.current = { t: now, x: p.x, y: p.y };
      }
    } else if (g.kind === 'paint') commit();
    else if (g.kind === 'heal') {
      setHealDraft(null);
      const r = rendererRef.current;
      if (!r?.work || !g.pts.length) return;
      const spotBase = { points: g.pts, size: removeS.size / view.zoom, feather: removeS.feather };
      const img = r.maskCtx?.src ?? sampleImage(r.work, W, H, 1280);
      const off = findHealSource(img, spotBase);
      const spot: HealSpot = { id: uid(), ...spotBase, dx: off.dx, dy: off.dy, mode: removeS.mode };
      setAndCommit({ heals: [...stateRef.current.edits.heals, spot] });
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!ready || view.cropMode) return;
    const p = local(e);
    const vw = viewerRef.current!.clientWidth, vh = viewerRef.current!.clientHeight;
    setView((v) => {
      const zoom = Math.min(10, Math.max(1, v.zoom * Math.exp(-e.deltaY * 0.0015)));
      const k = zoom / v.zoom;
      const panX = zoom === 1 ? 0 : p.x - vw / 2 - (p.x - vw / 2 - v.panX) * k;
      const panY = zoom === 1 ? 0 : p.y - vh / 2 - (p.y - vh / 2 - v.panY) * k;
      return { ...v, zoom, panX, panY };
    });
  };

  // ── actions ──────────────────────────────────────────────────────────────
  const runAuto = () => {
    const r = rendererRef.current;
    if (!r?.work) return;
    const a = autoTone(sampleImage(r.work, W, H, 320));
    setAndCommit(a);
    toast('Auto settings applied — tweak any slider to taste', 'ok');
  };

  const exportCube = async () => {
    const r = rendererRef.current;
    if (!r) return;
    const lat = r.pipe.bakeLut(edits, r.stats, 33);
    const text = writeCube(photo.name.replace(/\.[^.]+$/, ''), 33, lat);
    r.invalidate();
    scheduleRender();
    try {
      if (await downloadBlob(new Blob([text], { type: 'text/plain' }), `${photo.name.replace(/\.[^.]+$/, '')}-look.cube`)) toast('Exported .cube LUT (33³)', 'ok');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Save failed', 'error');
    }
  };

  const doExport = async (req: ExportRequest, all: boolean) => {
    const r = rendererRef.current!;
    if (!all) {
      const out = await r.exportImage(edits, masks, req);
      scheduleRender();
      return [out];
    }
    const results: { blob: Blob; w: number; h: number }[] = [];
    const cur = { id: photo.id, full: r.full! };
    try {
      for (let i = 0; i < library.length; i++) {
        const p = library[i];
        setProgress({ msg: `Exporting ${i + 1} of ${library.length}…`, pct: i / library.length });
        const blob = p.id === photo.id ? null : await getBlob(p.id);
        const full = p.id === photo.id ? cur.full : blob ? await decodeImage(blob) : null;
        if (!full) continue;
        r.load(p.id, full);
        const ai = await db.get<SegResult>('aimaps', p.id);
        if (ai) r.setAI(ai);
        const lut = await getLut(p.edits.lut.id);
        r.setLut(lut);
        const pe = p.id === photo.id ? edits : p.edits;
        const pm = p.id === photo.id ? masks : p.masks;
        results.push(await r.exportImage(pe, pm, req));
      }
    } finally {
      r.load(cur.id, cur.full);
      if (aiState) r.setAI(aiState);
      r.setLut(await getLut(edits.lut.id));
      setProgress(null);
      scheduleRender();
    }
    return results;
  };

  const refSources: RefSource[] = React.useMemo(
    () =>
      library
        .filter((p) => p.id !== photo.id)
        .slice(0, 30)
        .map((p) => ({
          id: p.id,
          name: p.name,
          thumb: p.thumb ?? '',
          kind: 'photo' as const,
          load: async () => {
            const b = await getBlob(p.id);
            if (!b) throw new Error('Missing file');
            const bmp = await createImageBitmap(b);
            try {
              return await referenceFromImage(bmp, bmp.width, bmp.height, p.name);
            } finally {
              bmp.close();
            }
          },
        })),
    [library, photo.id, getBlob],
  );

  const resetAll = () => {
    const d = defaultEdits();
    apply({ edits: { ...d }, masks: [] });
    history.current.past.push({ edits, masks });
    setActiveMask(null);
    toast('All edits reset', 'info');
  };

  // ── derived UI bits ──────────────────────────────────────────────────────
  const changedLight = edits.exposure || edits.contrast || edits.highlights || edits.shadows || edits.whites || edits.blacks;
  const editChips: { id: EditTab; label: string; dot?: boolean }[] = [
    { id: 'light', label: 'Light', dot: !!changedLight },
    { id: 'curve', label: 'Curve' },
    { id: 'color', label: 'Color', dot: !!(edits.temp || edits.tint || edits.vibrance || edits.saturation) },
    { id: 'mix', label: 'Mix', dot: edits.hsl.some((s) => s.hue || s.sat || s.lum) },
    { id: 'grading', label: 'Grading' },
    { id: 'effects', label: 'Effects', dot: !!(edits.texture || edits.clarity || edits.dehaze || edits.vignette.amount || edits.grain.amount) },
    { id: 'detail', label: 'Detail', dot: !!(edits.sharpen.amount || edits.noise.luminance || edits.noise.color) },
    { id: 'optics', label: 'Optics' },
    { id: 'looks', label: 'LUT', dot: !!edits.lut.id },
  ];
  const api = { e: edits, set, commit };
  const hist = history.current;
  const [ow, oh] = [rect.w, rect.h];
  const brushPx = ((painting ? brush.size : removeS.size) / view.zoom) * Math.max(W, H) * rect.scale;

  if (fatal) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
        <Triangle className="text-danger" />
        <p className="max-w-sm text-[14px] text-dim">{fatal}</p>
        {missing && (
          <button type="button" className="btn-accent" onClick={relink}>Choose the original photo…</button>
        )}
        {missing && photo.thumb && <img src={photo.thumb} alt="" className="h-20 w-20 rounded-lg object-cover opacity-80" />}
        <button type="button" className="btn-solid" onClick={onBack}>Back to library</button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-bg">
      {/* top bar */}
      <header className="safe-t flex h-12 shrink-0 items-center gap-0.5 px-1.5">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="Back to library">
          <ChevronLeft size={22} />
        </button>
        <div className="min-w-0 flex-1 truncate px-1 text-[13px] text-dim">{photo.name}</div>
        <button type="button" className="icon-btn" onClick={undo} disabled={!hist.past.length} aria-label="Undo">
          <Undo2 size={19} />
        </button>
        <button type="button" className="icon-btn" onClick={redo} disabled={!hist.future.length} aria-label="Redo">
          <Redo2 size={19} />
        </button>
        <button type="button" className={cn('icon-btn', view.split != null && 'text-accent')} onClick={() => setView((v) => ({ ...v, split: v.split == null ? 0.5 : null }))} aria-label="Before / after" title="Before / after (hold the photo for a quick look)">
          <Columns2 size={19} />
        </button>
        <div className="relative">
          <button type="button" className="icon-btn" onClick={() => setMenu(!menu)} aria-label="More">
            <MoreHorizontal size={20} />
          </button>
          {menu && (
            <>
              <div className="fixed inset-0 z-40" onPointerDown={() => setMenu(false)} />
              <div className="absolute right-0 top-11 z-50 w-60 overflow-hidden rounded-xl border border-line bg-raised py-1 shadow-2xl">
                {[
                  { icon: <Copy size={15} />, label: 'Copy settings…', fn: () => setCopyOpen(true) },
                  { icon: <ClipboardPaste size={15} />, label: 'Paste settings', disabled: !clipboard, fn: () => { if (!clipboard) return; const ne = pickGroups(clipboard.edits, edits, clipboard.groups); apply({ edits: ne, masks: clipboard.groups.masks ? structuredClone(clipboard.masks) : masks }); history.current.past.push({ edits, masks }); toast('Settings pasted', 'ok'); } },
                  { icon: <CopyCheck size={15} />, label: 'Sync settings to all photos', disabled: library.length < 2, fn: () => { onSyncAll({ edits, masks, groups: copyGroups }); toast(`Synced to ${library.length - 1} photos`, 'ok'); } },
                  { icon: <BarChart3 size={15} />, label: scopes ? 'Hide scopes' : 'Show scopes', fn: () => setScopes(scopes ? null : 'histogram') },
                  { icon: <Triangle size={15} />, label: view.clip ? 'Hide clipping' : 'Show clipping', fn: () => setView((v) => ({ ...v, clip: !v.clip })) },
                  { icon: <RefreshCcw size={15} />, label: 'Reset all edits', fn: resetAll },
                ].map((it) => (
                  <button key={it.label} type="button" disabled={it.disabled} onClick={() => { setMenu(false); it.fn(); }} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] text-dim hover:bg-widget hover:text-fg disabled:opacity-35">
                    {it.icon} {it.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <button type="button" className="icon-btn text-accent" onClick={() => setExportOpen(true)} aria-label="Export" disabled={!ready}>
          <Download size={19} />
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* viewer */}
        <div
          ref={viewerRef}
          className={cn('relative min-h-0 flex-1 touch-none overflow-hidden', (painting || tool === 'remove') && 'cursor-none', picking && 'cursor-crosshair')}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => setCursor(null)}
          onWheel={onWheel}
          onContextMenu={(e) => e.preventDefault()}
        >
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
          {!ready && (
            <div className="absolute inset-0 flex items-center justify-center text-dim">
              <Loader2 className="animate-spin" />
            </div>
          )}
          {ready && view.cropMode && <CropOverlay rect={rect} e={edits} srcW={W} srcH={H} onChange={(crop) => set({ crop })} onCommit={commit} />}
          {ready && tool === 'masks' && activeCompObj && (activeCompObj.type === 'linear' || activeCompObj.type === 'radial') && !view.beforeOnly && (
            <MaskHandles
              comp={activeCompObj}
              toScreen={toScreen}
              toSource={toSource}
              srcW={W}
              srcH={H}
              onChange={(c) => changeMasks(masks.map((m) => (m.id === activeMask ? { ...m, components: m.components.map((x) => (x.id === c.id ? c : x)) } : m)), false)}
              onCommit={commit}
            />
          )}
          {ready && tool === 'remove' && showSpots && !view.beforeOnly && (
            <HealOverlay
              heals={edits.heals}
              toScreen={toScreen}
              toSource={toSource}
              scalePx={Math.max(W, H) * rect.scale}
              interactive
              onMove={(id, dx, dy) => set({ heals: edits.heals.map((h) => (h.id === id ? { ...h, dx, dy } : h)) })}
              onCommit={commit}
            />
          )}
          {healDraft && (
            <svg className="pointer-events-none absolute inset-0 h-full w-full">
              <path d={healDraft.map(toScreen).map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ') + ' l0.01,0'} stroke="rgba(255,90,90,.55)" strokeWidth={brushPx * 2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
          )}
          {cursor && (painting || tool === 'remove') && (
            <svg className="pointer-events-none absolute inset-0 h-full w-full">
              <circle cx={cursor.x} cy={cursor.y} r={brushPx} fill="none" stroke="white" strokeWidth={1.5} />
              <circle cx={cursor.x} cy={cursor.y} r={brushPx * (1 - (painting ? brush.feather : removeS.feather) / 100)} fill="none" stroke="rgba(255,255,255,.45)" strokeDasharray="3 3" />
            </svg>
          )}
          {view.beforeOnly && <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-[11px] font-medium">Before</div>}
          {view.split != null && (
            <div className="pointer-events-none absolute top-3 flex w-full justify-between px-4 text-[10px] font-semibold uppercase tracking-widest text-white/80">
              <span className="rounded bg-black/60 px-2 py-0.5">Before</span>
              <span className="rounded bg-black/60 px-2 py-0.5">After</span>
            </div>
          )}
          {view.zoom > 1 && <button type="button" className="absolute bottom-3 left-3 rounded-full bg-black/70 px-3 py-1 font-mono text-[11px]" onClick={() => setView((v) => ({ ...v, zoom: 1, panX: 0, panY: 0 }))}>{Math.round(view.zoom * 100)}% · fit</button>}
          {picking && <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-accent px-3 py-1.5 text-[12px] font-medium text-white">{picking === 'wb' ? 'Tap something that should be neutral grey or white' : 'Tap a colour to select it'}</div>}
          {scopes && (
            <button type="button" onClick={() => setScopes(scopes === 'histogram' ? 'waveform' : scopes === 'waveform' ? 'parade' : scopes === 'parade' ? 'vectorscope' : 'histogram')} className="absolute right-2 top-2 overflow-hidden rounded-lg bg-black/70 ring-1 ring-white/10" title="Tap to switch scope">
              <canvas ref={scopeRef} className={cn('block', scopes === 'vectorscope' ? 'h-[120px] w-[120px]' : 'h-[84px] w-[180px]')} />
              <span className="absolute bottom-0.5 left-1.5 text-[9px] uppercase tracking-wider text-white/50">{scopes}</span>
            </button>
          )}
          {progress && (
            <div className="absolute inset-x-0 bottom-4 mx-auto w-[min(320px,85%)] rounded-xl bg-raised/95 p-3 text-[12px] shadow-xl ring-1 ring-line">
              <div className="mb-2 flex items-center gap-2 text-dim"><Loader2 size={14} className="animate-spin" /> {progress.msg}</div>
              {progress.pct != null && <div className="h-1 rounded bg-widget"><div className="h-full rounded bg-accent" style={{ width: `${Math.max(3, progress.pct * 100)}%` }} /></div>}
            </div>
          )}
          <span className="sr-only">{ow}×{oh}</span>
        </div>

        {/* panel + tool bar (bottom on phones, right column on desktop) */}
        <aside className="flex max-h-[46vh] shrink-0 flex-col border-t border-line bg-panel md:max-h-none md:w-[360px] md:border-l md:border-t-0">
          <ToolBar
            className="order-2 border-t border-line safe-b md:order-1 md:border-b md:border-t-0"
            value={tool}
            onChange={(t) => setTool(t)}
            items={[
              { id: 'presets', label: 'Presets', icon: <Wand2 size={20} /> },
              { id: 'edit', label: 'Edit', icon: <SlidersHorizontal size={20} /> },
              { id: 'masks', label: 'Masking', icon: <Layers size={20} />, badge: masks.length > 0 },
              { id: 'remove', label: 'Remove', icon: <Bandage size={20} />, badge: edits.heals.length > 0 },
              { id: 'crop', label: 'Crop', icon: <CropIcon size={20} /> },
              { id: 'match', label: 'Match', icon: <Palette size={20} />, badge: !!edits.match.ref },
            ]}
          />
          <div className="order-1 flex min-h-0 flex-1 flex-col md:order-2">
            {tool === 'edit' && (
              <div className="flex items-center border-b border-line/60">
                <button type="button" onClick={runAuto} className="ml-2 flex shrink-0 items-center gap-1 rounded-full bg-accent/15 px-3 py-1.5 text-[12px] font-semibold text-accent hover:bg-accent/25" title="Auto tone & white balance">
                  <Sparkles size={14} /> Auto
                </button>
                <Chips className="flex-1 pl-2" items={editChips} value={editTab} onChange={setEditTab} />
              </div>
            )}
            <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-4 py-2">
              {!ready ? null : tool === 'edit' ? (
                <>
                  {editTab === 'light' && <LightPanel {...api} />}
                  {editTab === 'curve' && <CurvePanel {...api} histogram={histo} />}
                  {editTab === 'color' && <ColorPanel {...api} onPickWB={() => setPicking(picking === 'wb' ? null : 'wb')} />}
                  {editTab === 'mix' && <MixPanel {...api} />}
                  {editTab === 'grading' && <GradingPanel {...api} />}
                  {editTab === 'effects' && <EffectsPanel {...api} />}
                  {editTab === 'detail' && <DetailPanel {...api} />}
                  {editTab === 'optics' && <OpticsPanel {...api} />}
                  {editTab === 'looks' && <LooksPanel e={edits} set={set} commit={commit} onExportCube={exportCube} />}
                </>
              ) : tool === 'presets' ? (
                <PresetsPanel preloadLut={async (id) => { const l = await getLut(id); if (l) rendererRef.current?.pipe.setLut3D(l); }} e={edits} masks={masks} photoKey={photo.id} presets={presets} thumbnail={(e, m) => rendererRef.current?.thumbnail(e, m, 140) ?? ''} onApply={(e, c) => { setEdits(e); stateRef.current = { ...stateRef.current, edits: e }; if (c) commit(); }} />
              ) : tool === 'masks' ? (
                <MasksPanel
                  masks={masks}
                  activeId={activeMask}
                  activeComp={activeComp}
                  setActive={(m, c) => { setActiveMask(m); setActiveComp(c ?? null); setPicking(null); }}
                  onChange={changeMasks}
                  onCreate={createMask}
                  onAdaptive={adaptive}
                  aiBusy={aiBusy}
                  aiAvailable={aiAvailable}
                  brush={brush}
                  setBrush={setBrush}
                  overlay={overlay}
                  setOverlay={setOverlay}
                  picking={picking === 'color'}
                  setPicking={(v) => setPicking(v ? 'color' : null)}
                />
              ) : tool === 'remove' ? (
                <RemovePanel s={removeS} setS={setRemoveS} count={edits.heals.length} showSpots={showSpots} setShowSpots={setShowSpots} onUndo={() => setAndCommit({ heals: edits.heals.slice(0, -1) })} onClear={() => setAndCommit({ heals: [] })} />
              ) : tool === 'crop' ? (
                <CropPanel e={edits} set={set} commit={commit} srcW={W} srcH={H} />
              ) : (
                <MatchPanel
                  match={edits.match}
                  sources={refSources}
                  onChange={(match, c) => { setEdits((e) => ({ ...e, match })); stateRef.current = { ...stateRef.current, edits: { ...stateRef.current.edits, match } }; if (c) commit(); }}
                  onSavePreset={async () => { await presets.save(`Look · ${edits.match.refName.replace(/\.[^.]+$/, '')}`, edits); toast('Saved to Presets → Your presets', 'ok'); }}
                />
              )}
            </div>
          </div>
        </aside>
      </div>

      <ExportSheet
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        name={photo.name}
        outW={Math.round((edits.rotate % 180 ? photo.height : photo.width) * edits.crop.w)}
        outH={Math.round((edits.rotate % 180 ? photo.width : photo.height) * edits.crop.h)}
        onExport={doExport}
        multi={library.length}
      />
      <Sheet open={copyOpen} onClose={() => setCopyOpen(false)} title="Copy settings">
        <CopySettingsList groups={copyGroups} setGroups={setCopyGroups} />
        <button type="button" className="btn-accent mt-3 w-full" onClick={() => { setClipboard({ edits: structuredClone(edits), masks: structuredClone(masks), groups: copyGroups }); setCopyOpen(false); toast('Settings copied — open another photo and choose Paste', 'ok'); }}>
          Copy
        </button>
      </Sheet>
    </div>
  );
}
