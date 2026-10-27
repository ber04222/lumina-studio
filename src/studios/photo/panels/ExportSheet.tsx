import * as React from 'react';
import { Download, Loader2, Share2 } from 'lucide-react';
import { Sheet, Segmented, useToast } from '@/components/ui';
import { Slider } from '@/components/Slider';
import { downloadBlob, inHostedViewer } from '@/lib/db';

export interface ExportRequest {
  type: 'image/jpeg' | 'image/png' | 'image/webp';
  quality: number;
  maxEdge: number;
}

export function ExportSheet({ open, onClose, name, outW, outH, onExport, multi }: { open: boolean; onClose: () => void; name: string; outW: number; outH: number; onExport: (r: ExportRequest, all: boolean) => Promise<{ blob: Blob; w: number; h: number }[]>; multi: number }) {
  const toast = useToast();
  const [fmt, setFmt] = React.useState<'jpg' | 'png' | 'webp'>('jpg');
  const [q, setQ] = React.useState(92);
  const [size, setSize] = React.useState<number>(0);
  const [busy, setBusy] = React.useState(false);
  const type = fmt === 'jpg' ? 'image/jpeg' : fmt === 'png' ? 'image/png' : 'image/webp';
  const long = Math.max(outW, outH);
  const maxEdge = size || 16384;
  const k = Math.min(1, maxEdge / long);
  const ow = Math.round(outW * k);
  const oh = Math.round(outH * k);
  const canShare = typeof navigator !== 'undefined' && 'canShare' in navigator && !inHostedViewer();

  const run = async (share: boolean, all = false) => {
    setBusy(true);
    try {
      const res = await onExport({ type, quality: q / 100, maxEdge }, all);
      const files = res.map((r, i) => new File([r.blob], `${(all ? `lumina-${i + 1}` : name.replace(/\.[^.]+$/, '')) + '-edit'}.${fmt}`, { type }));
      if (share && canShare && navigator.canShare({ files })) {
        await navigator.share({ files, title: name });
      } else {
        for (const f of files) if (!(await downloadBlob(f, f.name))) return;
      }
      const r0 = res[0];
      toast(`Exported ${res.length > 1 ? `${res.length} photos` : `${r0.w} × ${r0.h}`}`, 'ok');
      onClose();
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') toast(err instanceof Error ? err.message : 'Export failed', 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Export">
      <div className="space-y-4">
        <div>
          <div className="label-xs mb-1.5">Format</div>
          <Segmented value={fmt} onChange={setFmt} items={[{ id: 'jpg', label: 'JPEG' }, { id: 'png', label: 'PNG' }, { id: 'webp', label: 'WebP' }]} />
        </div>
        {fmt !== 'png' && <Slider label="Quality" value={q} min={40} max={100} defaultValue={92} onChange={setQ} />}
        <div>
          <div className="label-xs mb-1.5">Size</div>
          <Segmented value={size} onChange={setSize} items={[{ id: 0, label: 'Full' }, { id: 4096, label: '4096' }, { id: 2048, label: '2048' }, { id: 1080, label: '1080' }]} />
          <div className="mt-1.5 font-mono text-[11px] text-faint">{ow} × {oh} px</div>
        </div>
        <div className="grid gap-2">
          <button type="button" className="btn-accent h-11" disabled={busy} onClick={() => run(false)}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} Save to device
          </button>
          {canShare && (
            <button type="button" className="btn-solid h-11" disabled={busy} onClick={() => run(true)}>
              <Share2 size={16} /> Share…
            </button>
          )}
          {multi > 1 && (
            <button type="button" className="btn-ghost h-10" disabled={busy} onClick={() => run(false, true)}>
              Export all {multi} photos
            </button>
          )}
        </div>
      </div>
    </Sheet>
  );
}
