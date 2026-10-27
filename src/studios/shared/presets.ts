import type { EditSettings, Preset } from '@/types/edits';
import { defaultEdits } from '@/types/edits';

const d = defaultEdits();
const curve = (...p: [number, number][]) => p.map(([x, y]) => ({ x, y }));
const hsl = (o: Record<number, [number, number, number]>) => d.hsl.map((s, i) => (o[i] ? { hue: o[i][0], sat: o[i][1], lum: o[i][2] } : s));
const grade = (g: Partial<EditSettings['grading']>) => ({ ...d.grading, ...g });

export const BUILT_IN_PRESETS: Preset[] = [
  // Food
  { id: 'food-pop', name: 'Food Pop', group: 'Food', edits: { exposure: 0.2, contrast: 12, highlights: -25, shadows: 20, whites: 10, temp: 8, vibrance: 28, saturation: 6, texture: 18, clarity: 8, hsl: hsl({ 0: [0, 12, 0], 1: [-6, 15, 5], 2: [-4, 8, 6], 3: [8, -10, -6] }) } },
  { id: 'food-cafe', name: 'Bright Café', group: 'Food', edits: { exposure: 0.45, contrast: -6, highlights: -35, shadows: 30, whites: 18, blacks: 12, temp: 10, tint: 4, vibrance: 15, clarity: -4, curves: { ...d.curves, master: curve([0, 0.05], [0.5, 0.53], [1, 1]) } } },
  { id: 'food-dark', name: 'Moody Plate', group: 'Food', edits: { exposure: -0.35, contrast: 22, highlights: -40, shadows: -10, blacks: -12, temp: 12, vibrance: 10, texture: 22, clarity: 14, vignette: { ...d.vignette, amount: -35, midpoint: 40, feather: 70 } } },
  // Portrait
  { id: 'por-natural', name: 'Natural Skin', group: 'Portrait', edits: { exposure: 0.15, contrast: -4, highlights: -20, shadows: 18, temp: 6, vibrance: 10, saturation: -4, texture: -12, clarity: -6, hsl: hsl({ 1: [0, -8, 8], 0: [3, -6, 4] }) } },
  { id: 'por-glow', name: 'Soft Glow', group: 'Portrait', edits: { exposure: 0.3, contrast: -15, highlights: -15, shadows: 22, whites: 12, texture: -25, clarity: -18, dehaze: -8, temp: 10, tint: 6, curves: { ...d.curves, master: curve([0, 0.08], [0.5, 0.55], [1, 0.98]) } } },
  { id: 'por-warm', name: 'Warm Portrait', group: 'Portrait', edits: { temp: 18, tint: 6, contrast: 10, highlights: -22, shadows: 14, vibrance: 8, grading: grade({ highlights: { h: 40, s: 18, l: 2 }, shadows: { h: 25, s: 10, l: 0 } }) } },
  // Cinematic
  { id: 'cin-teal', name: 'Teal & Orange', group: 'Cinematic', edits: { contrast: 18, highlights: -20, saturation: 4, grading: grade({ shadows: { h: 195, s: 38, l: -4 }, midtones: { h: 30, s: 10, l: 0 }, highlights: { h: 35, s: 30, l: 3 } }), curves: { ...d.curves, master: curve([0, 0.04], [0.25, 0.2], [0.75, 0.82], [1, 0.97]) }, vignette: { ...d.vignette, amount: -18 } } },
  { id: 'cin-golden', name: 'Golden Hour', group: 'Cinematic', edits: { temp: 30, tint: 6, exposure: 0.2, contrast: 14, highlights: -30, shadows: 16, vibrance: 12, grading: grade({ shadows: { h: 28, s: 16, l: -4 }, highlights: { h: 45, s: 26, l: 6 } }), vignette: { ...d.vignette, amount: -24, feather: 65 } } },
  { id: 'cin-moody', name: 'Moody Blue', group: 'Cinematic', edits: { exposure: -0.3, contrast: 14, highlights: -35, shadows: -8, temp: -18, vibrance: -10, dehaze: 8, grading: grade({ shadows: { h: 215, s: 28, l: -8 }, highlights: { h: 45, s: 8, l: 0 }, balance: -15 }), vignette: { ...d.vignette, amount: -36, midpoint: 40 } } },
  { id: 'cin-bleach', name: 'Bleach Bypass', group: 'Cinematic', edits: { contrast: 35, saturation: -45, clarity: 20, highlights: -10, blacks: -15, grain: { ...d.grain, amount: 14 } } },
  { id: 'cin-matrix', name: 'Night City', group: 'Cinematic', edits: { temp: -25, tint: -12, contrast: 22, highlights: -30, shadows: 10, vibrance: 18, grading: grade({ shadows: { h: 170, s: 35, l: -6 }, highlights: { h: 300, s: 16, l: 0 } }) } },
  // Film
  { id: 'film-warm', name: 'Warm Film', group: 'Film', edits: { temp: 20, tint: -6, contrast: -6, blacks: 20, saturation: -8, grain: { amount: 30, size: 30, roughness: 55 }, vignette: { ...d.vignette, amount: -16, feather: 70 }, curves: { master: curve([0, 0.07], [0.25, 0.25], [0.75, 0.76], [1, 0.95]), r: curve([0, 0], [0.55, 0.58], [1, 1]), g: d.curves.g, b: curve([0, 0.06], [0.5, 0.5], [1, 0.94]) } } },
  { id: 'film-green', name: 'Fresh Film', group: 'Film', edits: { temp: -4, tint: -10, contrast: 6, blacks: 16, highlights: -20, saturation: -10, hsl: hsl({ 3: [-12, -15, 0], 2: [-10, -10, 0], 5: [-8, -12, 0] }), grain: { amount: 22, size: 25, roughness: 50 }, curves: { ...d.curves, master: curve([0, 0.06], [0.5, 0.52], [1, 0.96]) } } },
  { id: 'film-fade', name: 'Faded', group: 'Film', edits: { contrast: -18, blacks: 35, saturation: -14, curves: { ...d.curves, master: curve([0, 0.14], [0.5, 0.52], [1, 0.92]) }, grain: { amount: 12, size: 20, roughness: 40 } } },
  // B&W
  { id: 'bw-noir', name: 'Noir', group: 'B&W', edits: { saturation: -100, contrast: 30, blacks: -18, whites: 10, grain: { amount: 24, size: 25, roughness: 55 }, vignette: { ...d.vignette, amount: -32, midpoint: 42 }, curves: { ...d.curves, master: curve([0, 0], [0.3, 0.14], [0.7, 0.84], [1, 1]) } } },
  { id: 'bw-soft', name: 'Soft Mono', group: 'B&W', edits: { saturation: -100, contrast: -10, blacks: 26, highlights: -20, curves: { ...d.curves, master: curve([0, 0.1], [0.5, 0.52], [1, 0.94]) }, grain: { amount: 10, size: 20, roughness: 40 } } },
  { id: 'bw-street', name: 'Street', group: 'B&W', edits: { saturation: -100, contrast: 38, highlights: -15, shadows: 25, texture: 20, clarity: 18, sharpen: { ...d.sharpen, amount: 40 }, grain: { amount: 16, size: 22, roughness: 50 } } },
  { id: 'bw-selenium', name: 'Selenium', group: 'B&W', edits: { saturation: -100, contrast: 18, grading: grade({ shadows: { h: 280, s: 18, l: 0 }, highlights: { h: 40, s: 10, l: 0 } }) } },
  // Landscape
  { id: 'land-vivid', name: 'Vivid Land', group: 'Landscape', edits: { contrast: 14, highlights: -40, shadows: 30, vibrance: 35, clarity: 15, dehaze: 12, hsl: hsl({ 3: [6, 12, 0], 5: [0, 18, -10], 4: [0, 10, -4] }) } },
  { id: 'land-sky', name: 'Deep Sky', group: 'Landscape', edits: { highlights: -45, dehaze: 18, hsl: hsl({ 5: [-4, 25, -22], 4: [0, 15, -12] }), vibrance: 10 } },
  { id: 'land-autumn', name: 'Autumn', group: 'Landscape', edits: { temp: 14, vibrance: 18, hsl: hsl({ 3: [-40, -20, -8], 2: [-15, 20, 0], 1: [-6, 20, 0] }), contrast: 10 } },
  { id: 'land-arctic', name: 'Arctic', group: 'Landscape', edits: { temp: -28, exposure: 0.25, highlights: 12, shadows: 15, vibrance: 6, clarity: 8, grading: grade({ shadows: { h: 200, s: 12, l: -4 }, highlights: { h: 55, s: 10, l: 6 }, balance: 20 }) } },
];

export function applyPreset(base: EditSettings, p: Preset, amount = 100): EditSettings {
  // presets never touch geometry, heals or match
  const target: EditSettings = { ...defaultEdits(), ...p.edits, crop: base.crop, aspect: base.aspect, angle: base.angle, rotate: base.rotate, flipH: base.flipH, flipV: base.flipV, heals: base.heals, match: p.edits.match ?? base.match, lut: p.edits.lut ?? base.lut } as EditSettings;
  if (amount >= 100) return target;
  // blend numeric fields with the neutral defaults for a partial-strength preset
  const k = amount / 100;
  const neutral = defaultEdits();
  const mix = (a: unknown, n: unknown): unknown => {
    if (typeof a === 'number' && typeof n === 'number') return n + (a - n) * k;
    if (Array.isArray(a) && Array.isArray(n) && a.length === n.length && typeof a[0] === 'object') return a.map((x, i) => mix(x, n[i]));
    if (a && n && typeof a === 'object' && !Array.isArray(a)) {
      const o: Record<string, unknown> = {};
      for (const key of Object.keys(a)) o[key] = mix((a as Record<string, unknown>)[key], (n as Record<string, unknown>)[key]);
      return o;
    }
    return a;
  };
  const out = mix(target, neutral) as EditSettings;
  return { ...out, crop: base.crop, angle: base.angle, rotate: base.rotate, flipH: base.flipH, flipV: base.flipV, heals: base.heals, match: target.match, lut: { ...target.lut, amount: target.lut.amount * k }, curves: amount > 0 ? (mix(target.curves, neutral.curves) as EditSettings['curves']) : neutral.curves };
}

/** Edits a preset should store (no geometry / heals / per-image data). */
export function presetFromEdits(e: EditSettings): Partial<EditSettings> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { crop, aspect, angle, rotate, flipH, flipV, heals, ...rest } = e;
  return rest;
}
