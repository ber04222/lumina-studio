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
  // ── Koloro-style looks (original recipes in the spirit of popular mobile filter packs) ──
  // Film
  { id: 'k-warm-neg', name: 'Warm Negative', group: 'Film Stocks', edits: { temp: 14, tint: 4, contrast: -8, highlights: -30, shadows: 18, blacks: 14, vibrance: 6, saturation: -6, grain: { amount: 18, size: 28, roughness: 50 }, curves: { ...d.curves, master: curve([0, 0.06], [0.3, 0.29], [0.7, 0.72], [1, 0.96]) }, hsl: hsl({ 1: [4, -6, 6], 3: [-14, -18, 0], 5: [-6, -10, 0] }) } },
  { id: 'k-portra', name: 'Soft Portrait Film', group: 'Film Stocks', edits: { temp: 8, contrast: -12, highlights: -25, shadows: 22, blacks: 18, saturation: -10, texture: -10, grading: grade({ shadows: { h: 200, s: 8, l: 0 }, highlights: { h: 40, s: 12, l: 2 } }), curves: { ...d.curves, master: curve([0, 0.07], [0.5, 0.52], [1, 0.97]) } } },
  { id: 'k-ektar', name: 'Punchy Slide', group: 'Film Stocks', edits: { contrast: 22, vibrance: 22, saturation: 10, highlights: -18, blacks: -8, hsl: hsl({ 0: [0, 14, -4], 5: [-6, 20, -10], 4: [-8, 10, -6] }), grain: { amount: 10, size: 20, roughness: 40 } } },
  { id: 'k-fuji-green', name: 'Green Chrome', group: 'Film Stocks', edits: { temp: -6, tint: -8, contrast: 8, saturation: -12, highlights: -20, shadows: 10, hsl: hsl({ 3: [-20, -10, -8], 2: [-12, -14, 0], 0: [0, -8, 0], 5: [-10, -18, -6] }), grading: grade({ shadows: { h: 160, s: 14, l: 0 }, highlights: { h: 50, s: 8, l: 0 } }) } },
  { id: 'k-tungsten', name: 'Tungsten Night', group: 'Film Stocks', edits: { temp: -22, tint: 8, contrast: 14, highlights: -35, shadows: 14, vibrance: 14, grading: grade({ shadows: { h: 200, s: 26, l: -4 }, highlights: { h: 15, s: 22, l: 0 } }), grain: { amount: 22, size: 30, roughness: 55 }, vignette: { ...d.vignette, amount: -20 } } },
  { id: 'k-instant', name: 'Instant Print', group: 'Film Stocks', edits: { exposure: 0.15, contrast: -18, blacks: 30, whites: -12, saturation: -14, temp: 10, curves: { master: curve([0, 0.12], [0.5, 0.5], [1, 0.9]), r: curve([0, 0.04], [1, 1]), g: d.curves.g, b: curve([0, 0.08], [1, 0.92]) }, vignette: { ...d.vignette, amount: -14, feather: 80 } } },
  // Aesthetic
  { id: 'k-peach', name: 'Peach Cream', group: 'Aesthetic', edits: { exposure: 0.3, temp: 16, tint: 10, contrast: -14, highlights: -20, shadows: 26, blacks: 16, saturation: -8, hsl: hsl({ 1: [6, -10, 12], 0: [8, -14, 6] }), curves: { ...d.curves, master: curve([0, 0.08], [0.5, 0.55], [1, 0.98]) } } },
  { id: 'k-lavender', name: 'Lavender Haze', group: 'Aesthetic', edits: { exposure: 0.2, tint: 18, temp: -6, contrast: -10, blacks: 20, saturation: -12, grading: grade({ shadows: { h: 270, s: 18, l: 2 }, highlights: { h: 320, s: 10, l: 0 } }) } },
  { id: 'k-mint', name: 'Mint Fresh', group: 'Aesthetic', edits: { exposure: 0.25, temp: -10, tint: -6, contrast: -6, shadows: 20, blacks: 14, hsl: hsl({ 3: [24, -20, 10], 4: [-6, -10, 8], 2: [10, -20, 0] }), grading: grade({ shadows: { h: 165, s: 12, l: 0 } }) } },
  { id: 'k-beige', name: 'Beige Minimal', group: 'Aesthetic', edits: { exposure: 0.2, temp: 10, contrast: -16, highlights: -14, blacks: 22, vibrance: -24, saturation: -10, curves: { ...d.curves, master: curve([0, 0.1], [0.5, 0.53], [1, 0.95]) } } },
  { id: 'k-dreamy', name: 'Dreamy Glow', group: 'Aesthetic', edits: { exposure: 0.35, contrast: -20, highlights: -10, whites: 14, clarity: -30, texture: -12, dehaze: -12, temp: 6, tint: 6 } },
  { id: 'k-vintage', name: 'Vintage 70s', group: 'Aesthetic', edits: { temp: 24, tint: -6, contrast: -6, blacks: 26, saturation: -18, hsl: hsl({ 3: [-30, -20, 0], 5: [-20, -30, 0] }), grain: { amount: 26, size: 34, roughness: 60 }, curves: { master: curve([0, 0.1], [1, 0.93]), r: curve([0, 0.05], [0.5, 0.55], [1, 1]), g: d.curves.g, b: curve([0, 0.1], [1, 0.86]) } } },
  // Moody
  { id: 'k-forest', name: 'Dark Forest', group: 'Moody', edits: { exposure: -0.35, contrast: 16, highlights: -30, shadows: -6, saturation: -16, hsl: hsl({ 3: [-18, -26, -24], 2: [-24, -20, -10], 4: [-10, -20, -12] }), grading: grade({ shadows: { h: 170, s: 16, l: -6 } }), vignette: { ...d.vignette, amount: -30 } } },
  { id: 'k-desert', name: 'Desert Dust', group: 'Moody', edits: { temp: 20, contrast: 8, highlights: -26, blacks: 10, saturation: -16, hsl: hsl({ 1: [-4, 10, -6], 5: [-30, -40, -10], 4: [-20, -40, 0] }), grain: { amount: 14, size: 24, roughness: 50 } } },
  { id: 'k-rain', name: 'Rainy Day', group: 'Moody', edits: { exposure: -0.15, temp: -14, contrast: -4, highlights: -24, blacks: 12, saturation: -26, dehaze: -8, grading: grade({ shadows: { h: 210, s: 14, l: 0 } }) } },
  { id: 'k-teal-fade', name: 'Faded Teal', group: 'Moody', edits: { contrast: -8, blacks: 24, saturation: -10, grading: grade({ shadows: { h: 185, s: 26, l: 0 }, highlights: { h: 35, s: 12, l: 0 } }), curves: { ...d.curves, master: curve([0, 0.1], [0.5, 0.5], [1, 0.95]) } } },
  { id: 'k-chocolate', name: 'Chocolate Brown', group: 'Moody', edits: { exposure: -0.2, temp: 18, contrast: 12, highlights: -30, saturation: -20, hsl: hsl({ 1: [-6, 6, -16], 2: [-20, -20, -10], 3: [-40, -40, -20] }), vignette: { ...d.vignette, amount: -22 } } },
  // Travel
  { id: 'k-bali', name: 'Tropical Gold', group: 'Travel', edits: { temp: 18, vibrance: 22, highlights: -34, shadows: 18, hsl: hsl({ 4: [-10, 16, -6], 5: [-6, 14, -10], 3: [-8, 6, 0] }), grading: grade({ highlights: { h: 45, s: 16, l: 2 } }) } },
  { id: 'k-summer', name: 'Summer Haze', group: 'Travel', edits: { exposure: 0.3, temp: 12, contrast: -10, highlights: -20, dehaze: -10, vibrance: 10, blacks: 14 } },
  { id: 'k-city', name: 'City Lights', group: 'Travel', edits: { contrast: 18, highlights: -40, shadows: 20, clarity: 18, dehaze: 10, temp: -8, hsl: hsl({ 1: [-6, 18, 6], 5: [0, 10, -12] }), grading: grade({ shadows: { h: 210, s: 18, l: -4 }, highlights: { h: 35, s: 14, l: 0 } }) } },
  { id: 'k-mountain', name: 'Alpine Air', group: 'Travel', edits: { temp: -12, highlights: -30, shadows: 16, clarity: 12, dehaze: 16, vibrance: 14, hsl: hsl({ 5: [-4, 16, -14], 3: [10, -10, 0] }) } },
  // Food (extra)
  { id: 'k-street-food', name: 'Street Food', group: 'Food', edits: { temp: 12, contrast: 16, highlights: -24, shadows: 14, vibrance: 26, texture: 20, clarity: 10, hsl: hsl({ 0: [2, 14, 0], 1: [-4, 18, 4], 2: [-6, 12, 6] }), vignette: { ...d.vignette, amount: -16 } } },
  { id: 'k-dessert', name: 'Sweet Pastel', group: 'Food', edits: { exposure: 0.4, temp: 6, tint: 8, contrast: -12, highlights: -18, shadows: 24, saturation: -6, hsl: hsl({ 0: [6, -10, 10], 7: [0, -10, 10] }) } },
  // Night
  { id: 'k-neon', name: 'Neon Nights', group: 'Night', edits: { contrast: 20, highlights: -30, shadows: 10, vibrance: 30, temp: -16, tint: 14, hsl: hsl({ 5: [10, 20, 0], 6: [0, 24, 6], 7: [0, 22, 6], 1: [-10, -20, 0] }), grading: grade({ shadows: { h: 240, s: 22, l: -4 }, highlights: { h: 320, s: 14, l: 0 } }) } },
  { id: 'k-blue-hour', name: 'Blue Hour', group: 'Night', edits: { temp: -24, contrast: 10, highlights: -20, shadows: 16, vibrance: 12, grading: grade({ shadows: { h: 220, s: 20, l: -2 }, highlights: { h: 40, s: 10, l: 0 } }) } },
  // ── Cinematic Travel (tuned from measured reference looks: matte blacks, rolled highlights, olive greens) ──
  { id: 'ct-golden-travel', name: 'Golden Travel', group: 'Cinematic Travel', edits: { temp: 16, contrast: 10, highlights: -35, shadows: 10, whites: -8, blacks: 18, vibrance: 12, saturation: -4, hsl: hsl({ 1: [0, 15, 8], 2: [-18, -22, -6], 3: [-35, -45, -18], 4: [10, -15, 0], 5: [-10, -15, -15] }), grading: grade({ shadows: { h: 195, s: 15, l: 0 }, highlights: { h: 42, s: 22, l: 2 } }), curves: { ...d.curves, master: curve([0, 0.07], [0.25, 0.22], [0.75, 0.78], [1, 0.97]) }, grain: { amount: 10, size: 22, roughness: 45 } } },
  { id: 'ct-desert-gold', name: 'Desert Gold', group: 'Cinematic Travel', edits: { temp: 26, contrast: 14, highlights: -30, shadows: 6, blacks: 14, vibrance: 8, hsl: hsl({ 0: [12, 10, 0], 1: [2, 20, 4], 2: [-12, 10, 6], 5: [-10, -30, -12], 4: [0, -20, 0] }), grading: grade({ shadows: { h: 200, s: 10, l: -2 }, highlights: { h: 38, s: 26, l: 2 } }), vignette: { ...d.vignette, amount: -15, feather: 70 } } },
  { id: 'ct-documentary', name: 'Muted Documentary', group: 'Cinematic Travel', edits: { temp: -4, contrast: -6, highlights: -40, whites: -30, blacks: 22, vibrance: -6, saturation: -18, hsl: hsl({ 1: [0, -5, 4], 2: [-15, -28, -10], 3: [-30, -42, -22], 5: [0, -20, -10] }), grading: grade({ shadows: { h: 215, s: 12, l: 0 }, highlights: { h: 45, s: 10, l: 0 } }), curves: { ...d.curves, master: curve([0, 0.08], [0.5, 0.48], [1, 0.86]) }, grain: { amount: 12, size: 25, roughness: 50 } } },
  { id: 'ct-road-blue', name: 'Road Trip Blue', group: 'Cinematic Travel', edits: { temp: -10, contrast: 6, whites: -20, blacks: 15, saturation: -15, hsl: hsl({ 1: [0, 10, 4], 5: [0, -6, -10], 3: [-15, -25, -10] }), grading: grade({ shadows: { h: 220, s: 20, l: -4 }, midtones: { h: 210, s: 6, l: 0 }, highlights: { h: 50, s: 8, l: 0 } }), curves: { ...d.curves, master: curve([0, 0.07], [0.5, 0.5], [1, 0.9]) } } },
  { id: 'ct-sunrise', name: 'Mountain Sunrise', group: 'Cinematic Travel', edits: { temp: 10, tint: 8, contrast: 8, highlights: -30, shadows: 8, blacks: 12, vibrance: 10, hsl: hsl({ 5: [20, -10, -6], 6: [0, 10, 0], 1: [0, 12, 4] }), grading: grade({ shadows: { h: 250, s: 12, l: 0 }, highlights: { h: 40, s: 25, l: 2 } }) } },
  { id: 'ct-moody-peaks', name: 'Moody Peaks', group: 'Cinematic Travel', edits: { exposure: -0.2, contrast: 18, highlights: -40, shadows: -10, blacks: -5, temp: 8, dehaze: 12, clarity: 10, hsl: hsl({ 1: [0, 15, 0], 5: [0, -10, -20] }), grading: grade({ shadows: { h: 220, s: 10, l: -2 }, highlights: { h: 35, s: 20, l: 0 } }), vignette: { ...d.vignette, amount: -25 } } },
  { id: 'ct-snow-peaks', name: 'Crisp Snow Peaks', group: 'Cinematic Travel', edits: { temp: -6, highlights: -45, whites: 10, blacks: 8, clarity: 10, dehaze: 15, vibrance: 6, hsl: hsl({ 5: [-4, 10, -15], 4: [0, -10, -6], 3: [-15, -20, -10] }), grading: grade({ shadows: { h: 210, s: 10, l: 0 } }) } },
  { id: 'ct-teal-gold', name: 'Teal & Gold', group: 'Cinematic Travel', edits: { contrast: 14, highlights: -25, blacks: 12, saturation: -4, hsl: hsl({ 2: [-15, -20, -6], 3: [-38, -45, -16], 4: [-10, 10, -6], 5: [-15, 0, -10], 1: [0, 12, 4] }), grading: grade({ shadows: { h: 190, s: 30, l: -2 }, highlights: { h: 40, s: 28, l: 2 } }) } },
  { id: 'ct-foggy', name: 'Foggy Mood', group: 'Cinematic Travel', edits: { temp: -8, contrast: -10, dehaze: -15, blacks: 25, saturation: -25, grading: grade({ shadows: { h: 200, s: 15, l: 0 } }), curves: { ...d.curves, master: curve([0, 0.1], [0.5, 0.48], [1, 0.9]) } } },
  { id: 'ct-earthy', name: 'Earthy Brown', group: 'Cinematic Travel', edits: { temp: 12, contrast: 6, blacks: 14, hsl: hsl({ 3: [-45, -50, -22], 2: [-22, -30, -8], 5: [0, -40, -10], 4: [0, -30, 0], 1: [0, 5, 0] }), grading: grade({ highlights: { h: 40, s: 12, l: 0 } }) } },
  // ── Clean Aesthetic (bright, airy, creamy highlights) ──
  { id: 'ca-airy-alpine', name: 'Airy Alpine', group: 'Clean Aesthetic', edits: { exposure: 0.35, contrast: -15, highlights: -15, shadows: 30, whites: 5, blacks: 15, dehaze: -10, temp: 6, tint: -4, vibrance: 5, saturation: -8, hsl: hsl({ 3: [15, -20, 15], 2: [0, -10, 0], 5: [0, -25, 10], 4: [0, -20, 0] }), grading: grade({ highlights: { h: 50, s: 10, l: 0 } }), curves: { ...d.curves, master: curve([0, 0.1], [0.5, 0.55], [1, 1]) } } },
  { id: 'ca-soft-green', name: 'Soft Film Green', group: 'Clean Aesthetic', edits: { exposure: 0.2, contrast: -8, highlights: -20, shadows: 20, blacks: 18, temp: 4, saturation: -10, hsl: hsl({ 3: [20, -25, 10], 2: [-8, -15, 5], 4: [-10, -15, 0] }), grading: grade({ shadows: { h: 170, s: 10, l: 0 }, highlights: { h: 45, s: 8, l: 0 } }), grain: { amount: 8, size: 20, roughness: 40 } } },
  { id: 'ca-clean-white', name: 'Clean White', group: 'Clean Aesthetic', edits: { exposure: 0.3, highlights: -20, shadows: 15, whites: 15, temp: 2, vibrance: 5, saturation: -10, hsl: hsl({ 1: [0, -5, 8] }) } },
  { id: 'ca-nordic', name: 'Nordic Cool', group: 'Clean Aesthetic', edits: { temp: -16, saturation: -20, highlights: -20, blacks: 10, hsl: hsl({ 5: [0, -20, 10] }), grading: grade({ highlights: { h: 200, s: 6, l: 0 } }) } },
  { id: 'ca-cream', name: 'Creamy Daylight', group: 'Clean Aesthetic', edits: { exposure: 0.25, temp: 10, contrast: -12, highlights: -25, shadows: 20, blacks: 16, vibrance: -10, hsl: hsl({ 3: [10, -25, 5], 5: [0, -30, 8] }), grading: grade({ highlights: { h: 48, s: 14, l: 2 } }) } },
  // ── Hollywood (original recipes inspired by well-known film grades) ──
  // Large-format natural: neutral-cool shadows, warm skin, gentle filmic roll-off, fine grain
  { id: 'hw-imax', name: 'IMAX Natural', group: 'Hollywood', edits: { contrast: 8, highlights: -30, shadows: 10, blacks: 6, saturation: -12, hsl: hsl({ 1: [0, 6, 4], 3: [-10, -25, -8], 5: [-4, -15, -6] }), grading: grade({ shadows: { h: 205, s: 12, l: -2 }, highlights: { h: 42, s: 10, l: 0 } }), curves: { ...d.curves, master: curve([0, 0.03], [0.25, 0.22], [0.75, 0.79], [1, 0.96]) }, grain: { amount: 10, size: 18, roughness: 45 } } },
  // Dark superhero thriller: steel-blue city, desaturated, hard contrast
  { id: 'hw-steel', name: 'Steel City', group: 'Hollywood', edits: { exposure: -0.15, temp: -14, contrast: 26, highlights: -25, blacks: -8, saturation: -30, clarity: 12, hsl: hsl({ 1: [0, 15, 0] }), grading: grade({ shadows: { h: 210, s: 25, l: -4 }, highlights: { h: 190, s: 8, l: 0 } }), vignette: { ...d.vignette, amount: -22 } } },
  // Pastel storybook: candy pinks, lifted soft blacks, warm cream highlights
  { id: 'hw-pastel', name: 'Pastel Hotel', group: 'Hollywood', edits: { exposure: 0.15, contrast: -10, blacks: 22, highlights: -15, temp: 6, tint: 14, vibrance: 15, hsl: hsl({ 0: [10, 10, 8], 7: [-5, 15, 10], 6: [10, 0, 8], 2: [-5, -15, 10], 3: [20, -30, 8], 5: [-10, -20, 12] }), grading: grade({ shadows: { h: 340, s: 14, l: 0 }, highlights: { h: 45, s: 16, l: 2 } }), curves: { ...d.curves, master: curve([0, 0.1], [0.5, 0.53], [1, 0.97]) } } },
  // Dystopian desert haze: almost monochrome orange, soft dust
  { id: 'hw-orange-haze', name: 'Orange Haze', group: 'Hollywood', edits: { temp: 45, tint: 6, contrast: -6, dehaze: -18, blacks: 14, highlights: -20, saturation: -25, hsl: hsl({ 1: [0, 40, 5], 2: [-20, 10, 0], 3: [-60, -70, -10], 4: [0, -80, 0], 5: [0, -80, 0] }), grading: grade({ shadows: { h: 25, s: 40, l: -4 }, midtones: { h: 30, s: 25, l: 0 }, highlights: { h: 38, s: 40, l: 2 } }) } },
  // Neo-noir neon rain: teal-cyan shadows, magenta highlights, deep blacks
  { id: 'hw-neon-rain', name: 'Neon Rain', group: 'Hollywood', edits: { exposure: -0.3, temp: -32, tint: 4, contrast: 22, highlights: -30, shadows: 6, blacks: -8, vibrance: 20, saturation: -12, hsl: hsl({ 0: [10, 0, 0], 1: [-8, -30, 0], 2: [-20, -50, 0], 3: [30, -45, 0], 4: [0, 25, 0], 7: [0, 25, 0] }), grading: grade({ shadows: { h: 185, s: 55, l: -6 }, midtones: { h: 200, s: 15, l: 0 }, highlights: { h: 315, s: 30, l: 0 } }), vignette: { ...d.vignette, amount: -25 } } },
  // Epic sand: muted beige, warm, low saturation, soft contrast
  { id: 'hw-sand', name: 'Desert Epic', group: 'Hollywood', edits: { temp: 18, contrast: 6, highlights: -30, blacks: 10, saturation: -35, hsl: hsl({ 1: [0, 20, 0], 3: [-30, -40, 0], 5: [0, -20, -6] }), grading: grade({ shadows: { h: 30, s: 14, l: -2 }, highlights: { h: 40, s: 18, l: 0 } }), curves: { ...d.curves, master: curve([0, 0.05], [0.5, 0.5], [1, 0.94]) } } },
  // Cyber green: the simulated-world green cast
  { id: 'hw-code-green', name: 'Code Green', group: 'Hollywood', edits: { temp: -8, tint: -45, contrast: 22, highlights: -20, saturation: -30, clarity: 10, grading: grade({ shadows: { h: 140, s: 45, l: -4 }, midtones: { h: 125, s: 28, l: 0 }, highlights: { h: 95, s: 22, l: 0 } }) } },
  // Sodium-vapour thriller: sickly yellow-green highlights, teal shadows, desaturated
  { id: 'hw-thriller', name: 'Sodium Thriller', group: 'Hollywood', edits: { exposure: -0.1, contrast: 16, highlights: -20, blacks: -4, saturation: -35, hsl: hsl({ 2: [10, 10, 0], 5: [0, -40, -10] }), grading: grade({ shadows: { h: 180, s: 20, l: -4 }, highlights: { h: 70, s: 28, l: 0 } }), vignette: { ...d.vignette, amount: -20 } } },
  // Post-apocalyptic pop: punchy orange & teal, crushed blacks
  { id: 'hw-wasteland', name: 'Wasteland Pop', group: 'Hollywood', edits: { contrast: 30, highlights: -20, shadows: 10, blacks: -10, vibrance: 30, saturation: 8, clarity: 12, hsl: hsl({ 1: [-5, 25, 0], 2: [-10, 10, 0], 4: [10, 20, -10], 5: [-10, 25, -15] }), grading: grade({ shadows: { h: 195, s: 35, l: -4 }, highlights: { h: 30, s: 30, l: 0 } }) } },
  // Whimsical Paris: emerald greens, rich reds, golden cast
  { id: 'hw-paris', name: 'Paris Dream', group: 'Hollywood', edits: { temp: 16, contrast: 14, highlights: -15, blacks: 4, vibrance: 15, hsl: hsl({ 0: [0, 25, 0], 3: [25, 15, -8], 2: [-10, 10, 0], 5: [-20, -20, -10] }), grading: grade({ shadows: { h: 140, s: 22, l: -2 }, highlights: { h: 45, s: 32, l: 2 } }), vignette: { ...d.vignette, amount: -18 } } },
  // Musical dusk: purple-blue twilight, glowing warm practicals
  { id: 'hw-twilight', name: 'Twilight Magic', group: 'Hollywood', edits: { temp: -18, tint: 10, contrast: 12, highlights: -20, shadows: 10, vibrance: 22, hsl: hsl({ 5: [10, 20, 0], 6: [0, 20, 4], 1: [0, 12, 4] }), grading: grade({ shadows: { h: 255, s: 45, l: -4 }, midtones: { h: 270, s: 10, l: 0 }, highlights: { h: 35, s: 22, l: 2 } }) } },
  // Film print golden hour (Kodak 2383-style): amber, lifted toe, soft gold shoulder, muted teal sky, bloom + halation
  { id: 'hw-golden-2383', name: 'Golden Film', group: 'Hollywood', edits: { temp: 20, contrast: 10, highlights: -30, shadows: 6, blacks: 12, saturation: -5, hsl: hsl({ 1: [0, 15, 4], 2: [-12, 15, 0], 3: [-30, -30, -6], 4: [0, -30, 0], 5: [-12, -35, -6] }), grading: grade({ shadows: { h: 32, s: 14, l: 0 }, highlights: { h: 45, s: 24, l: 2 } }), curves: { ...d.curves, master: curve([0, 0.06], [0.25, 0.22], [0.75, 0.8], [1, 0.95]) }, glow: { amount: 25, size: 60, threshold: 55, halation: 35 }, grain: { amount: 14, size: 22, roughness: 45 } } },
  // Sun-baked desert: heavy amber warmth, punchy contrast, dull greens pushed to gold, teal shadow separation
  { id: 'hw-desert-sun', name: 'Desert Sun', group: 'Hollywood', edits: { temp: 35, contrast: 28, highlights: -15, blacks: -8, vibrance: 20, hsl: hsl({ 0: [0, 10, 0], 1: [0, 20, 0], 2: [-15, 20, 0], 3: [-45, -20, -8], 5: [0, -20, 0] }), grading: grade({ shadows: { h: 190, s: 12, l: -2 }, midtones: { h: 35, s: 15, l: 0 }, highlights: { h: 42, s: 30, l: 2 } }), vignette: { ...d.vignette, amount: -20 }, glow: { amount: 10, size: 50, threshold: 65, halation: 0 } } },
  // Asian film / Wong Kar-wai mood: green-leaning highlights, warm midtones, slightly cool, soft glow, 35mm grain
  { id: 'hw-asian-film', name: 'Asian Film', group: 'Hollywood', edits: { temp: -6, tint: -10, contrast: 6, highlights: -20, blacks: 10, saturation: -8, grading: grade({ highlights: { h: 150, s: 12, l: 0 }, midtones: { h: 40, s: 14, l: 0 } }), curves: { ...d.curves, r: curve([0, 0], [0.75, 0.72], [1, 0.96]) }, glow: { amount: 15, size: 55, threshold: 60, halation: 10 }, grain: { amount: 20, size: 30, roughness: 50 } } },
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
