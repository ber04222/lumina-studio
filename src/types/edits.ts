// ─── Lumina Studio: shared edit model (photo + video clip grades) ───────────

export interface CurvePoint {
  x: number; // 0..1
  y: number; // 0..1
}

export interface Wheel {
  h: number; // hue 0..360
  s: number; // 0..100
  l: number; // -100..100
}

export interface HSLSlot {
  hue: number; // -100..100
  sat: number; // -100..100
  lum: number; // -100..100
}

/** Compact colour statistics of an image, used by Colour Match. */
export interface ColorStats {
  /** cumulative histogram of Oklab L, 64 bins, 0..1 */
  lCdf: number[];
  /** weighted mean (a,b) for shadows / midtones / highlights */
  zoneA: [number, number, number];
  zoneB: [number, number, number];
  /** std of a / b around their zone means */
  stdA: number;
  stdB: number;
  meanL: number;
  /** subsampled Oklab pixels (L,a,b triplets) for full-distribution colour transfer */
  pts?: number[];
}

export interface ColorMatch {
  ref: ColorStats | null;
  refName: string;
  refThumb: string; // small data URL for UI
  amount: number; // 0..100
  color: number; // 0..100 (how much of the colour cast/tones)
  tone: number; // 0..100 (how much of the luminance distribution)
}

export interface Crop {
  // normalised rect in the rotated+straightened frame
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface HealSpot {
  id: string;
  points: { x: number; y: number }[]; // normalised source coords
  size: number; // normalised radius (relative to long edge)
  dx: number; // normalised source offset (where pixels are copied from)
  dy: number;
  feather: number; // 0..100
  mode: 'heal' | 'clone';
}

export interface EditSettings {
  // Light
  exposure: number; // -5..5 EV
  contrast: number; // -100..100
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  curves: { master: CurvePoint[]; r: CurvePoint[]; g: CurvePoint[]; b: CurvePoint[] };
  // Colour
  temp: number; // -100..100
  tint: number;
  vibrance: number;
  saturation: number;
  hsl: HSLSlot[]; // 8 slots
  grading: { shadows: Wheel; midtones: Wheel; highlights: Wheel; global: Wheel; blending: number; balance: number };
  // Effects
  texture: number;
  clarity: number;
  dehaze: number;
  vignette: { amount: number; midpoint: number; roundness: number; feather: number; highlights: number };
  grain: { amount: number; size: number; roughness: number };
  /** film bloom around highlights + red-orange halation on bright edges (0..100) */
  glow: { amount: number; size: number; threshold: number; halation: number };
  // Detail
  sharpen: { amount: number; radius: number; detail: number; masking: number };
  noise: { luminance: number; color: number };
  // Optics
  distortion: number; // -100..100
  defringe: number; // 0..100 (chromatic aberration reduction)
  // Geometry
  crop: Crop;
  aspect: number | null; // locked crop aspect (w/h) or null = free
  angle: number; // straighten -45..45
  rotate: 0 | 90 | 180 | 270;
  flipH: boolean;
  flipV: boolean;
  // Looks
  lut: { id: string | null; name: string; amount: number };
  match: ColorMatch;
  // Remove tool
  heals: HealSpot[];
}

export const HSL_NAMES = ['Red', 'Orange', 'Yellow', 'Green', 'Aqua', 'Blue', 'Purple', 'Magenta'];
export const HSL_HUES = [0, 30, 60, 120, 180, 225, 270, 315];
export const HSL_SWATCH = ['#e5484d', '#f08a24', '#f5d90a', '#46a758', '#12a594', '#3e63dd', '#8e4ec6', '#d6409f'];

export const identityCurve = (): CurvePoint[] => [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
];

export const defaultEdits = (): EditSettings => ({
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  curves: { master: identityCurve(), r: identityCurve(), g: identityCurve(), b: identityCurve() },
  temp: 0,
  tint: 0,
  vibrance: 0,
  saturation: 0,
  hsl: Array.from({ length: 8 }, () => ({ hue: 0, sat: 0, lum: 0 })),
  grading: {
    shadows: { h: 220, s: 0, l: 0 },
    midtones: { h: 40, s: 0, l: 0 },
    highlights: { h: 45, s: 0, l: 0 },
    global: { h: 30, s: 0, l: 0 },
    blending: 50,
    balance: 0,
  },
  texture: 0,
  clarity: 0,
  dehaze: 0,
  vignette: { amount: 0, midpoint: 50, roundness: 0, feather: 50, highlights: 0 },
  grain: { amount: 0, size: 25, roughness: 50 },
  glow: { amount: 0, size: 50, threshold: 60, halation: 0 },
  sharpen: { amount: 0, radius: 1, detail: 25, masking: 0 },
  noise: { luminance: 0, color: 0 },
  distortion: 0,
  defringe: 0,
  crop: { x: 0, y: 0, w: 1, h: 1 },
  aspect: null,
  angle: 0,
  rotate: 0,
  flipH: false,
  flipV: false,
  lut: { id: null, name: '', amount: 100 },
  match: { ref: null, refName: '', refThumb: '', amount: 100, color: 100, tone: 70 },
  heals: [],
});

/** Merge a possibly-partial / older edit object onto defaults (forward compatible loading). */
export function normalizeEdits(e: Partial<EditSettings> | undefined | null): EditSettings {
  const d = defaultEdits();
  if (!e) return d;
  return {
    ...d,
    ...e,
    curves: { ...d.curves, ...(e.curves ?? {}) },
    hsl: e.hsl && e.hsl.length === 8 ? e.hsl : d.hsl,
    grading: { ...d.grading, ...(e.grading ?? {}) },
    vignette: { ...d.vignette, ...(e.vignette ?? {}) },
    grain: { ...d.grain, ...(e.grain ?? {}) },
    glow: { ...d.glow, ...(e.glow ?? {}) },
    sharpen: { ...d.sharpen, ...(e.sharpen ?? {}) },
    noise: { ...d.noise, ...(e.noise ?? {}) },
    crop: { ...d.crop, ...(e.crop ?? {}) },
    lut: { ...d.lut, ...(e.lut ?? {}) },
    match: { ...d.match, ...(e.match ?? {}) },
    heals: e.heals ?? [],
  };
}

export const isIdentityCurve = (p: CurvePoint[]) =>
  p.length === 2 && p[0].x === 0 && p[0].y === 0 && p[1].x === 1 && p[1].y === 1;

// ─── Masks (Lightroom-style: a mask = components combined, + local sliders) ──

export interface LocalAdjust {
  temp: number;
  tint: number;
  exposure: number; // -4..4
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  texture: number;
  clarity: number;
  dehaze: number;
  hue: number; // -100..100 → ±60°
  saturation: number;
  sharpness: number; // negative = blur (lens-blur look)
  noise: number; // 0..100
  colorH: number; // tint colour hue
  colorS: number; // tint colour strength 0..100
}

export const defaultLocal = (): LocalAdjust => ({
  temp: 0,
  tint: 0,
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  texture: 0,
  clarity: 0,
  dehaze: 0,
  hue: 0,
  saturation: 0,
  sharpness: 0,
  noise: 0,
  colorH: 30,
  colorS: 0,
});

export type AIKind = 'subject' | 'sky' | 'background' | 'people' | 'vegetation' | 'water' | 'buildings' | 'ground';

export const AI_LABEL: Record<AIKind, string> = {
  subject: 'Subject',
  sky: 'Sky',
  background: 'Background',
  people: 'People',
  vegetation: 'Vegetation',
  water: 'Water',
  buildings: 'Architecture',
  ground: 'Ground',
};

export interface BrushStroke {
  points: { x: number; y: number }[]; // normalised source coords
  size: number; // radius relative to long edge
  feather: number; // 0..100
  flow: number; // 0..100
  erase: boolean;
}

export type MaskComponent = {
  id: string;
  mode: 'add' | 'subtract' | 'intersect';
  invert: boolean;
} & (
  | { type: 'brush'; strokes: BrushStroke[] }
  | { type: 'linear'; x0: number; y0: number; x1: number; y1: number }
  | { type: 'radial'; cx: number; cy: number; rx: number; ry: number; angle: number; feather: number }
  | { type: 'color'; samples: { r: number; g: number; b: number }[]; range: number }
  | { type: 'luminance'; lo: number; hi: number; feather: number }
  | { type: 'ai'; kind: AIKind }
);

export interface Mask {
  id: string;
  name: string;
  visible: boolean;
  opacity: number; // 0..100 (amount)
  components: MaskComponent[];
  adjust: LocalAdjust;
}

export const MAX_MASKS = 8;

// ─── Photo library item ──────────────────────────────────────────────────────

export interface PhotoItem {
  id: string;
  name: string;
  width: number;
  height: number;
  createdAt: number;
  edits: EditSettings;
  masks: Mask[];
  rating: number; // 0..5
  flag: 'none' | 'pick' | 'reject';
  thumb?: string; // small edited preview (data URL)
}

export const newLocalMask = (id: string, name: string, components: MaskComponent[]): Mask => ({
  id,
  name,
  visible: true,
  opacity: 100,
  components,
  adjust: defaultLocal(),
});

// ─── Presets ────────────────────────────────────────────────────────────────

export interface Preset {
  id: string;
  name: string;
  group: string;
  /** partial edits merged onto the current photo (geometry / heals never included) */
  edits: Partial<EditSettings>;
  user?: boolean;
}
