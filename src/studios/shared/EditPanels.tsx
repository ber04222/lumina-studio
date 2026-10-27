import * as React from 'react';
import type { EditSettings, Wheel } from '@/types/edits';
import { HSL_NAMES, HSL_SWATCH } from '@/types/edits';
import { Slider } from '@/components/Slider';
import { ColorWheel } from '@/components/Wheel';
import { CurveEditor } from '@/components/CurveEditor';
import { Segmented } from '@/components/ui';
import { cn } from '@/lib/utils';
import { Pipette } from 'lucide-react';

export interface EditApi {
  e: EditSettings;
  set: (p: Partial<EditSettings>) => void;
  commit: () => void;
}

const Group = ({ title, children, right }: { title?: string; children: React.ReactNode; right?: React.ReactNode }) => (
  <section className="mb-2">
    {title && (
      <div className="mb-1 mt-2 flex items-center justify-between">
        <div className="label-xs">{title}</div>
        {right}
      </div>
    )}
    {children}
  </section>
);

export function LightPanel({ e, set, commit }: EditApi) {
  return (
    <Group>
      <Slider label="Exposure" value={e.exposure} min={-5} max={5} step={0.01} onChange={(exposure) => set({ exposure })} onCommit={commit} format={(v) => (v > 0 ? '+' : '') + v.toFixed(2)} track="exposure" />
      <Slider label="Contrast" value={e.contrast} min={-100} max={100} onChange={(contrast) => set({ contrast })} onCommit={commit} />
      <Slider label="Highlights" value={e.highlights} min={-100} max={100} onChange={(highlights) => set({ highlights })} onCommit={commit} />
      <Slider label="Shadows" value={e.shadows} min={-100} max={100} onChange={(shadows) => set({ shadows })} onCommit={commit} />
      <Slider label="Whites" value={e.whites} min={-100} max={100} onChange={(whites) => set({ whites })} onCommit={commit} />
      <Slider label="Blacks" value={e.blacks} min={-100} max={100} onChange={(blacks) => set({ blacks })} onCommit={commit} />
    </Group>
  );
}

export function CurvePanel({ e, set, commit, histogram }: EditApi & { histogram?: number[] | null }) {
  return <CurveEditor curves={e.curves} onChange={(curves) => set({ curves })} onCommit={commit} histogram={histogram} />;
}

export function ColorPanel({ e, set, commit, onPickWB }: EditApi & { onPickWB?: () => void }) {
  return (
    <Group
      title="White balance"
      right={
        onPickWB && (
          <button type="button" onClick={onPickWB} className="btn-ghost h-7 px-2 text-[12px]" title="Tap something neutral grey/white in the photo">
            <Pipette size={14} /> Pick neutral
          </button>
        )
      }
    >
      <Slider label="Temp" value={e.temp} min={-100} max={100} onChange={(temp) => set({ temp })} onCommit={commit} track="temp" />
      <Slider label="Tint" value={e.tint} min={-100} max={100} onChange={(tint) => set({ tint })} onCommit={commit} track="tint" />
      <div className="label-xs mb-1 mt-3">Presence</div>
      <Slider label="Vibrance" value={e.vibrance} min={-100} max={100} onChange={(vibrance) => set({ vibrance })} onCommit={commit} />
      <Slider label="Saturation" value={e.saturation} min={-100} max={100} onChange={(saturation) => set({ saturation })} onCommit={commit} />
    </Group>
  );
}

export function MixPanel({ e, set, commit }: EditApi) {
  const [k, setK] = React.useState(0);
  const slot = e.hsl[k];
  const upd = (p: Partial<typeof slot>) => set({ hsl: e.hsl.map((s, i) => (i === k ? { ...s, ...p } : s)) });
  const prev = HSL_SWATCH[(k + 7) % 8];
  const next = HSL_SWATCH[(k + 1) % 8];
  return (
    <Group>
      <div className="mb-2 flex justify-between px-1" role="radiogroup" aria-label="Colour">
        {HSL_SWATCH.map((c, i) => {
          const edited = e.hsl[i].hue || e.hsl[i].sat || e.hsl[i].lum;
          return (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={i === k}
              aria-label={HSL_NAMES[i]}
              onClick={() => setK(i)}
              className={cn('relative h-8 w-8 rounded-full transition-transform', i === k ? 'scale-110 ring-2 ring-fg ring-offset-2 ring-offset-panel' : 'opacity-80')}
              style={{ background: c }}
            >
              {edited ? <span className="absolute -bottom-1.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-fg" /> : null}
            </button>
          );
        })}
      </div>
      <div className="mb-1 text-center text-[12px] text-dim">{HSL_NAMES[k]}</div>
      <Slider label="Hue" value={slot.hue} min={-100} max={100} onChange={(hue) => upd({ hue })} onCommit={commit} track={`linear-gradient(90deg,${prev},${HSL_SWATCH[k]},${next})`} />
      <Slider label="Saturation" value={slot.sat} min={-100} max={100} onChange={(sat) => upd({ sat })} onCommit={commit} track={`linear-gradient(90deg,#808080,${HSL_SWATCH[k]})`} />
      <Slider label="Luminance" value={slot.lum} min={-100} max={100} onChange={(lum) => upd({ lum })} onCommit={commit} track={`linear-gradient(90deg,#111,${HSL_SWATCH[k]},#fff)`} />
    </Group>
  );
}

type WheelKey = 'shadows' | 'midtones' | 'highlights' | 'global';
export function GradingPanel({ e, set, commit, wide }: EditApi & { wide?: boolean }) {
  const [view, setView] = React.useState<'3way' | WheelKey>('3way');
  const g = e.grading;
  const upd = (key: WheelKey, w: Wheel) => set({ grading: { ...g, [key]: w } });
  const wheel = (key: WheelKey, label: string, size?: number) => <ColorWheel key={key} label={label} value={g[key]} onChange={(w) => upd(key, w)} onCommit={commit} size={size} />;
  return (
    <Group>
      <Segmented
        className="mb-3"
        value={view}
        onChange={setView}
        items={[
          { id: '3way', label: '3-Way' },
          { id: 'shadows', label: 'Shadows' },
          { id: 'midtones', label: 'Mids' },
          { id: 'highlights', label: 'Highs' },
          { id: 'global', label: 'Global' },
        ]}
      />
      {view === '3way' ? (
        <div className={cn('grid gap-2', wide ? 'grid-cols-3' : 'grid-cols-3')}>
          {wheel('shadows', 'Shadows', wide ? 96 : 92)}
          {wheel('midtones', 'Midtones', wide ? 96 : 92)}
          {wheel('highlights', 'Highlights', wide ? 96 : 92)}
        </div>
      ) : (
        <div className="flex justify-center">{wheel(view, view[0].toUpperCase() + view.slice(1), 168)}</div>
      )}
      <Slider label="Blending" value={g.blending} min={0} max={100} defaultValue={50} onChange={(blending) => set({ grading: { ...g, blending } })} onCommit={commit} />
      <Slider label="Balance" value={g.balance} min={-100} max={100} onChange={(balance) => set({ grading: { ...g, balance } })} onCommit={commit} />
    </Group>
  );
}

export function EffectsPanel({ e, set, commit }: EditApi) {
  const v = e.vignette;
  const gr = e.grain;
  return (
    <>
      <Group>
        <Slider label="Texture" value={e.texture} min={-100} max={100} onChange={(texture) => set({ texture })} onCommit={commit} />
        <Slider label="Clarity" value={e.clarity} min={-100} max={100} onChange={(clarity) => set({ clarity })} onCommit={commit} />
        <Slider label="Dehaze" value={e.dehaze} min={-100} max={100} onChange={(dehaze) => set({ dehaze })} onCommit={commit} />
      </Group>
      <Group title="Vignette">
        <Slider label="Amount" value={v.amount} min={-100} max={100} onChange={(amount) => set({ vignette: { ...v, amount } })} onCommit={commit} />
        <Slider label="Midpoint" value={v.midpoint} min={0} max={100} defaultValue={50} disabled={!v.amount} onChange={(midpoint) => set({ vignette: { ...v, midpoint } })} onCommit={commit} />
        <Slider label="Roundness" value={v.roundness} min={-100} max={100} disabled={!v.amount} onChange={(roundness) => set({ vignette: { ...v, roundness } })} onCommit={commit} />
        <Slider label="Feather" value={v.feather} min={0} max={100} defaultValue={50} disabled={!v.amount} onChange={(feather) => set({ vignette: { ...v, feather } })} onCommit={commit} />
        <Slider label="Highlights" value={v.highlights} min={0} max={100} disabled={!v.amount} onChange={(highlights) => set({ vignette: { ...v, highlights } })} onCommit={commit} />
      </Group>
      <Group title="Grain">
        <Slider label="Amount" value={gr.amount} min={0} max={100} onChange={(amount) => set({ grain: { ...gr, amount } })} onCommit={commit} />
        <Slider label="Size" value={gr.size} min={0} max={100} defaultValue={25} disabled={!gr.amount} onChange={(size) => set({ grain: { ...gr, size } })} onCommit={commit} />
        <Slider label="Roughness" value={gr.roughness} min={0} max={100} defaultValue={50} disabled={!gr.amount} onChange={(roughness) => set({ grain: { ...gr, roughness } })} onCommit={commit} />
      </Group>
    </>
  );
}

export function DetailPanel({ e, set, commit }: EditApi) {
  const s = e.sharpen;
  const n = e.noise;
  return (
    <>
      <Group title="Sharpening">
        <Slider label="Amount" value={s.amount} min={0} max={150} onChange={(amount) => set({ sharpen: { ...s, amount } })} onCommit={commit} />
        <Slider label="Radius" value={s.radius} min={0.5} max={3} step={0.1} defaultValue={1} disabled={!s.amount} onChange={(radius) => set({ sharpen: { ...s, radius } })} onCommit={commit} />
        <Slider label="Detail" value={s.detail} min={0} max={100} defaultValue={25} disabled={!s.amount} onChange={(detail) => set({ sharpen: { ...s, detail } })} onCommit={commit} />
        <Slider label="Masking" value={s.masking} min={0} max={100} disabled={!s.amount} onChange={(masking) => set({ sharpen: { ...s, masking } })} onCommit={commit} />
      </Group>
      <Group title="Noise reduction">
        <Slider label="Luminance" value={n.luminance} min={0} max={100} onChange={(luminance) => set({ noise: { ...n, luminance } })} onCommit={commit} />
        <Slider label="Color" value={n.color} min={0} max={100} onChange={(color) => set({ noise: { ...n, color } })} onCommit={commit} />
      </Group>
      <p className="mt-1 text-[11px] leading-relaxed text-faint">Sharpening works at pixel level — zoom in to judge it. Exports use the full-resolution file.</p>
    </>
  );
}

export function OpticsPanel({ e, set, commit }: EditApi) {
  return (
    <Group>
      <Slider label="Remove chromatic aberration" value={e.defringe} min={0} max={100} onChange={(defringe) => set({ defringe })} onCommit={commit} />
      <Slider label="Distortion" value={e.distortion} min={-100} max={100} onChange={(distortion) => set({ distortion })} onCommit={commit} />
    </Group>
  );
}
