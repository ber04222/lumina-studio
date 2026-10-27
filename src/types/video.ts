// ─── Video project model ─────────────────────────────────────────────────────
import type { ColorStats, EditSettings } from './edits';
import { defaultEdits, normalizeEdits } from './edits';

export type TransitionType = 'none' | 'crossfade' | 'dip-black' | 'dip-white' | 'wipe' | 'slide' | 'zoom';
export const TRANSITIONS: { id: TransitionType; label: string; mode: number }[] = [
  { id: 'none', label: 'Cut', mode: 0 },
  { id: 'crossfade', label: 'Cross dissolve', mode: 1 },
  { id: 'dip-black', label: 'Dip to black', mode: 2 },
  { id: 'dip-white', label: 'Dip to white', mode: 3 },
  { id: 'wipe', label: 'Wipe', mode: 4 },
  { id: 'slide', label: 'Slide', mode: 5 },
  { id: 'zoom', label: 'Zoom', mode: 6 },
];

export interface MediaRef {
  id: string;
  name: string;
  kind: 'video' | 'image' | 'audio';
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
}

export interface VClip {
  id: string;
  mediaId: string;
  in: number; // source seconds
  out: number;
  speed: number; // 0.25..4
  volume: number; // 0..1
  muted: boolean;
  fadeIn: number; // audio fade seconds
  fadeOut: number;
  transition: { type: TransitionType; duration: number }; // into this clip
  fit: 'fit' | 'fill';
  scale: number; // extra zoom 1..3
  x: number; // pan -1..1
  y: number;
  kenBurns: boolean;
  grade: EditSettings;
  srcStats: ColorStats | null; // stats of this clip (for colour match)
}

export type TitleStyle = 'title' | 'lower' | 'caption' | 'bold' | 'minimal';
export interface Title {
  id: string;
  text: string;
  start: number;
  duration: number;
  style: TitleStyle;
  x: number; // 0..1 centre
  y: number;
  size: number; // fraction of frame height
  color: string;
  bg: boolean;
  font: 'sans' | 'serif' | 'mono';
  anim: 'none' | 'fade' | 'rise' | 'pop' | 'type';
}

export interface AudioClip {
  id: string;
  mediaId: string;
  start: number; // timeline seconds
  in: number;
  out: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
}

export interface Project {
  id: string;
  name: string;
  aspect: number; // w/h
  height: number; // export height in px (e.g. 1080)
  fps: number;
  bg: string;
  clips: VClip[];
  titles: Title[];
  audio: AudioClip[];
  media: MediaRef[];
  updatedAt: number;
  thumb?: string;
}

export const ASPECTS = [
  { id: 16 / 9, label: '16:9', hint: 'YouTube' },
  { id: 9 / 16, label: '9:16', hint: 'Reels · TikTok' },
  { id: 1, label: '1:1', hint: 'Square' },
  { id: 4 / 5, label: '4:5', hint: 'Feed' },
  { id: 4 / 3, label: '4:3', hint: 'Classic' },
  { id: 21 / 9, label: '21:9', hint: 'Cinema' },
];

export const newProject = (id: string): Project => ({
  id,
  name: 'Untitled project',
  aspect: 16 / 9,
  height: 1080,
  fps: 30,
  bg: '#000000',
  clips: [],
  titles: [],
  audio: [],
  media: [],
  updatedAt: Date.now(),
});

export const newClip = (id: string, m: MediaRef): VClip => ({
  id,
  mediaId: m.id,
  in: 0,
  out: m.kind === 'image' ? 4 : m.duration,
  speed: 1,
  volume: 1,
  muted: false,
  fadeIn: 0,
  fadeOut: 0,
  transition: { type: 'none', duration: 0.6 },
  fit: 'fill',
  scale: 1,
  x: 0,
  y: 0,
  kenBurns: m.kind === 'image',
  grade: defaultEdits(),
  srcStats: null,
});

export function normalizeProject(p: Project): Project {
  return { ...newProject(p.id), ...p, clips: p.clips.map((c) => ({ ...c, grade: normalizeEdits(c.grade) })) };
}

// ── timeline maths (overlapping transitions) ────────────────────────────────

export const clipDur = (c: VClip) => Math.max(0.05, (c.out - c.in) / c.speed);

export function transDur(clips: VClip[], i: number) {
  const c = clips[i];
  if (i === 0 || !c || c.transition.type === 'none') return 0;
  return Math.max(0, Math.min(c.transition.duration, clipDur(clips[i - 1]) * 0.5, clipDur(c) * 0.5));
}

export function clipStarts(clips: VClip[]): number[] {
  const s: number[] = [];
  let t = 0;
  for (let i = 0; i < clips.length; i++) {
    if (i > 0) t = s[i - 1] + clipDur(clips[i - 1]) - transDur(clips, i);
    s.push(t);
  }
  return s;
}

export function projectDuration(p: Pick<Project, 'clips' | 'titles' | 'audio'>) {
  const s = clipStarts(p.clips);
  const v = p.clips.length ? s[s.length - 1] + clipDur(p.clips[p.clips.length - 1]) : 0;
  return v;
}

export interface Active {
  b: number; // index of the (incoming) clip
  a: number | null; // outgoing clip during a transition
  p: number; // transition progress 0..1
}

export function activeAt(clips: VClip[], t: number, starts = clipStarts(clips)): Active | null {
  if (!clips.length) return null;
  let b = -1;
  for (let i = 0; i < clips.length; i++) if (t >= starts[i] - 1e-6) b = i;
  if (b < 0) b = 0;
  const end = starts[b] + clipDur(clips[b]);
  if (t > end + 1e-3 && b === clips.length - 1) return { b, a: null, p: 0 };
  const T = transDur(clips, b);
  if (T > 0 && t < starts[b] + T) return { b, a: b - 1, p: (t - starts[b]) / T };
  return { b, a: null, p: 0 };
}

export const srcTime = (c: VClip, local: number) => Math.min(c.out, c.in + Math.max(0, local) * c.speed);

export function formatTC(t: number, fps = 30) {
  const sign = t < 0 ? '-' : '';
  t = Math.abs(t);
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const f = Math.floor((t % 1) * fps + 1e-6);
  return `${sign}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(f).padStart(2, '0')}`;
}
