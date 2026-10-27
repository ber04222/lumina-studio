// ─── Import Lightroom presets (.xmp / .lrtemplate / DNG), LUTs (.cube) and zips of them ─
import type { CurvePoint, EditSettings, HSLSlot, Preset } from '@/types/edits';
import { defaultEdits } from '@/types/edits';
import { unzip } from '@/lib/backup';
import { db, uid } from '@/lib/db';
import { importCube } from './luts';

type Raw = Record<string, string>;
const HSL_KEYS = ['Red', 'Orange', 'Yellow', 'Green', 'Aqua', 'Blue', 'Purple', 'Magenta'];
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (r: Raw, k: string) => (r[k] != null && r[k] !== '' && isFinite(+r[k]) ? +r[k] : undefined);

/** Convert Adobe Camera Raw / Lightroom develop settings to a Lumina preset. */
export function crsToEdits(r: Raw, curves: Record<string, number[]>): Partial<EditSettings> {
  const d = defaultEdits();
  const e: Partial<EditSettings> = {};
  const set = <K extends keyof EditSettings>(k: K, v: EditSettings[K] | undefined) => {
    if (v !== undefined) e[k] = v;
  };
  set('exposure', num(r, 'Exposure2012') ?? num(r, 'Exposure'));
  set('contrast', num(r, 'Contrast2012') ?? num(r, 'Contrast'));
  set('highlights', num(r, 'Highlights2012') ?? (num(r, 'HighlightRecovery') !== undefined ? -num(r, 'HighlightRecovery')! : undefined));
  set('shadows', num(r, 'Shadows2012') ?? num(r, 'FillLight'));
  set('whites', num(r, 'Whites2012'));
  set('blacks', num(r, 'Blacks2012'));
  // white balance: relative (JPEG) values map directly; absolute Kelvin (raw) is approximated around daylight
  const it = num(r, 'IncrementalTemperature');
  const k = num(r, 'Temperature');
  if (it !== undefined) set('temp', clamp(it, -100, 100));
  else if (k !== undefined && k > 1000) set('temp', clamp(Math.round(Math.log2(k / 5500) * 110), -100, 100));
  const tint = num(r, 'IncrementalTint') ?? num(r, 'Tint');
  if (tint !== undefined) set('tint', clamp(Math.round(tint * 0.67), -100, 100));
  set('vibrance', num(r, 'Vibrance'));
  set('saturation', num(r, 'Saturation'));
  if (/true/i.test(r.ConvertToGrayscale ?? '')) set('saturation', -100);
  set('texture', num(r, 'Texture'));
  set('clarity', num(r, 'Clarity2012') ?? num(r, 'Clarity'));
  set('dehaze', num(r, 'Dehaze'));

  if (HSL_KEYS.some((c) => r['HueAdjustment' + c] || r['SaturationAdjustment' + c] || r['LuminanceAdjustment' + c])) {
    e.hsl = HSL_KEYS.map((c): HSLSlot => ({
      hue: num(r, 'HueAdjustment' + c) ?? 0,
      sat: num(r, 'SaturationAdjustment' + c) ?? 0,
      lum: num(r, 'LuminanceAdjustment' + c) ?? 0,
    }));
  }

  const g = { ...d.grading };
  const wheel = (prefix: string, old?: string) => ({
    h: num(r, `ColorGrade${prefix}Hue`) ?? (old ? num(r, `SplitToning${old}Hue`) : undefined) ?? 0,
    s: num(r, `ColorGrade${prefix}Sat`) ?? (old ? num(r, `SplitToning${old}Saturation`) : undefined) ?? 0,
    l: num(r, `ColorGrade${prefix}Lum`) ?? 0,
  });
  g.shadows = wheel('Shadow', 'Shadow');
  g.midtones = wheel('Midtone');
  g.highlights = wheel('Highlight', 'Highlight');
  g.global = wheel('Global');
  g.blending = num(r, 'ColorGradeBlending') ?? 50;
  g.balance = num(r, 'SplitToningBalance') ?? 0;
  if ([g.shadows, g.midtones, g.highlights, g.global].some((w) => w.s || w.l)) e.grading = g;

  const toPts = (a?: number[]): CurvePoint[] | undefined => {
    if (!a || a.length < 4) return undefined;
    const pts: CurvePoint[] = [];
    for (let i = 0; i + 1 < a.length; i += 2) pts.push({ x: clamp(a[i] / 255, 0, 1), y: clamp(a[i + 1] / 255, 0, 1) });
    return pts.length >= 2 ? pts.sort((p, q) => p.x - q.x) : undefined;
  };
  const master = toPts(curves.ToneCurvePV2012);
  const cr = toPts(curves.ToneCurvePV2012Red);
  const cg = toPts(curves.ToneCurvePV2012Green);
  const cb = toPts(curves.ToneCurvePV2012Blue);
  if (master || cr || cg || cb) e.curves = { master: master ?? d.curves.master, r: cr ?? d.curves.r, g: cg ?? d.curves.g, b: cb ?? d.curves.b };

  const va = num(r, 'PostCropVignetteAmount');
  if (va) e.vignette = { amount: va, midpoint: num(r, 'PostCropVignetteMidpoint') ?? 50, roundness: num(r, 'PostCropVignetteRoundness') ?? 0, feather: num(r, 'PostCropVignetteFeather') ?? 50, highlights: num(r, 'PostCropVignetteHighlightContrast') ?? 0 };
  const ga = num(r, 'GrainAmount');
  if (ga) e.grain = { amount: ga, size: num(r, 'GrainSize') ?? 25, roughness: num(r, 'GrainFrequency') ?? 50 };
  const sh = num(r, 'Sharpness');
  if (sh !== undefined) e.sharpen = { amount: sh, radius: num(r, 'SharpenRadius') ?? 1, detail: num(r, 'SharpenDetail') ?? 25, masking: num(r, 'SharpenEdgeMasking') ?? 0 };
  const nl = num(r, 'LuminanceSmoothing');
  const nc = num(r, 'ColorNoiseReduction');
  if (nl !== undefined || nc !== undefined) e.noise = { luminance: nl ?? 0, color: nc ?? 0 };
  return e;
}

/** Find and parse the XMP packet in .xmp text or inside a DNG/JPEG. */
export function parseXmp(text: string): { name: string; group: string; raw: Raw; curves: Record<string, number[]>; isProfile: boolean } | null {
  const start = text.indexOf('<x:xmpmeta');
  const end = text.indexOf('</x:xmpmeta>');
  if (start < 0 || end < 0) return null;
  const doc = new DOMParser().parseFromString(text.slice(start, end + 12), 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) return null;
  const CRS = 'http://ns.adobe.com/camera-raw-settings/1.0/';
  const raw: Raw = {};
  for (const el of Array.from(doc.getElementsByTagName('*'))) {
    for (const a of Array.from(el.attributes)) if (a.namespaceURI === CRS) raw[a.localName] = a.value;
    if (el.namespaceURI === CRS && el.children.length === 0 && el.textContent) raw[el.localName] = el.textContent.trim();
  }
  const curves: Record<string, number[]> = {};
  for (const key of ['ToneCurvePV2012', 'ToneCurvePV2012Red', 'ToneCurvePV2012Green', 'ToneCurvePV2012Blue']) {
    const el = doc.getElementsByTagNameNS(CRS, key)[0];
    if (el) curves[key] = Array.from(el.getElementsByTagNameNS('*', 'li')).flatMap((li) => (li.textContent ?? '').split(',').map((v) => +v.trim()));
  }
  const alt = (k: string) => doc.getElementsByTagNameNS(CRS, k)[0]?.getElementsByTagNameNS('*', 'li')[0]?.textContent?.trim();
  const isProfile = raw.PresetType === 'Look' || !!raw.RGBTable || !!raw.Table_ || Object.keys(raw).some((k) => k.startsWith('Table_'));
  return { name: alt('Name') || raw.Name || '', group: alt('Group') || raw.Group || '', raw, curves, isProfile };
}

/** Parse an old-style Lightroom .lrtemplate (Lua table). */
export function parseLrTemplate(text: string): { name: string; raw: Raw; curves: Record<string, number[]> } | null {
  if (!/settings\s*=/.test(text)) return null;
  const raw: Raw = {};
  const curves: Record<string, number[]> = {};
  const body = text.slice(text.search(/settings\s*=/));
  for (const m of body.matchAll(/(\w+)\s*=\s*\{([^{}]*)\}/g)) if (m[1].startsWith('ToneCurve')) curves[m[1]] = m[2].split(',').map((v) => +v.trim()).filter((v) => isFinite(v));
  for (const m of body.matchAll(/(\w+)\s*=\s*("[^"]*"|-?[\d.]+|true|false)\s*,/g)) raw[m[1]] = m[2].replace(/"/g, '');
  const title = text.match(/title\s*=\s*"([^"]*)"/)?.[1] ?? text.match(/internalName\s*=\s*"([^"]*)"/)?.[1] ?? '';
  return { name: title, raw, curves };
}

export interface ImportResult {
  presets: Preset[];
  luts: number;
  skipped: string[];
}

const base = (n: string) => n.split('/').pop()!.replace(/\.[^.]+$/, '');

/** Import any mix of .xmp, .lrtemplate, .dng/.jpg (with embedded settings), .cube and .zip files. */
export async function importLooks(files: File[]): Promise<ImportResult> {
  const res: ImportResult = { presets: [], luts: 0, skipped: [] };
  const queue: { name: string; blob: Blob; group: string }[] = files.map((f) => ({ name: f.name, blob: f, group: '' }));
  while (queue.length) {
    const { name, blob, group } = queue.shift()!;
    const ext = name.toLowerCase().split('.').pop() ?? '';
    try {
      if (ext === 'zip') {
        const entries = await unzip(blob);
        for (const [n, b] of entries) queue.push({ name: n, blob: b, group: group || base(name) });
        continue;
      }
      if (ext === 'cube') {
        const info = await importCube(new File([blob], base(name) + '.cube'));
        res.luts++;
        const p: Preset = { id: uid(), name: info.name, group: group ? `${group} · LUTs` : 'Your LUTs', edits: { lut: { id: info.id, name: info.name, amount: 100 } }, user: true };
        await db.put('presets', p.id, p);
        res.presets.push(p);
        continue;
      }
      if (ext === 'lrtemplate') {
        const t = parseLrTemplate(await blob.text());
        if (!t) throw new Error('not a develop preset');
        const p: Preset = { id: uid(), name: t.name || base(name), group: group || 'Imported', edits: crsToEdits(t.raw, t.curves), user: true };
        await db.put('presets', p.id, p);
        res.presets.push(p);
        continue;
      }
      if (['xmp', 'dng', 'jpg', 'jpeg', 'tif', 'tiff'].includes(ext)) {
        // XMP is plain text even inside binary files; latin1 decoding keeps byte offsets intact
        const buf = new Uint8Array(await blob.slice(0, ext === 'xmp' ? blob.size : Math.min(blob.size, 8_000_000)).arrayBuffer());
        const x = parseXmp(new TextDecoder('latin1').decode(buf));
        if (!x) throw new Error('no Lightroom settings inside');
        if (x.isProfile && Object.keys(x.raw).filter((k) => /2012|Adjustment|ColorGrade/.test(k)).length === 0) throw new Error('Lightroom profile with a built-in table — export it as a .cube LUT instead');
        const edits = crsToEdits(x.raw, x.curves);
        if (!Object.keys(edits).length) throw new Error('preset has no supported adjustments');
        const p: Preset = { id: uid(), name: x.name || base(name), group: x.group || group || 'Imported', edits, user: true };
        await db.put('presets', p.id, p);
        res.presets.push(p);
        continue;
      }
      if (!/\.(txt|md|pdf|png|ds_store|html?)$/i.test(name)) res.skipped.push(`${base(name)} (unsupported file type)`);
    } catch (err) {
      res.skipped.push(`${base(name)} (${err instanceof Error ? err.message : 'unreadable'})`);
    }
  }
  return res;
}
