import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Chips (horizontally scrolling segmented tabs) ─────────────────────────
export function Chips<T extends string>({ items, value, onChange, className }: { items: { id: T; label: string; icon?: React.ReactNode; dot?: boolean }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cn('no-scrollbar flex gap-1.5 overflow-x-auto px-3 py-2', className)} role="tablist">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          role="tab"
          aria-selected={value === it.id}
          onClick={() => onChange(it.id)}
          className={cn('chip relative flex items-center gap-1.5', value === it.id ? 'chip-on' : 'bg-widget/50 hover:text-fg')}
        >
          {it.icon}
          {it.label}
          {it.dot && <span className={cn('h-1.5 w-1.5 rounded-full', value === it.id ? 'bg-accent' : 'bg-accent')} />}
        </button>
      ))}
    </div>
  );
}

// ── Bottom tool bar (Lightroom mobile) ────────────────────────────────────
export function ToolBar<T extends string>({ items, value, onChange, className }: { items: { id: T; label: string; icon: React.ReactNode; badge?: boolean }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <nav className={cn('no-scrollbar flex justify-around gap-1 overflow-x-auto px-1', className)}>
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          onClick={() => onChange(it.id)}
          aria-pressed={value === it.id}
          className={cn('relative flex min-w-[58px] flex-col items-center gap-1 rounded-xl px-2 py-2 text-[11px] font-medium transition-colors', value === it.id ? 'text-accent' : 'text-dim hover:text-fg')}
        >
          <span className="flex h-6 items-center">{it.icon}</span>
          {it.label}
          {it.badge && <span className="absolute right-3 top-1.5 h-1.5 w-1.5 rounded-full bg-accent" />}
        </button>
      ))}
    </nav>
  );
}

// ── Modal sheet ───────────────────────────────────────────────────────────
export function Sheet({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  React.useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label={title} className={cn('sheet-in safe-b max-h-[88vh] w-full overflow-y-auto rounded-t-2xl border border-line bg-panel sm:rounded-2xl', wide ? 'sm:max-w-2xl' : 'sm:max-w-md')}>
        <div className="sticky top-0 z-10 flex items-center justify-between bg-panel/95 px-5 pb-2 pt-4 backdrop-blur">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <button type="button" className="icon-btn -mr-2 h-9 w-9" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="px-5 pb-5">{children}</div>
      </div>
    </div>
  );
}

// ── Toasts ────────────────────────────────────────────────────────────────
type Toast = { id: number; text: string; kind: 'info' | 'error' | 'ok' };
const ToastCtx = React.createContext<(text: string, kind?: Toast['kind']) => void>(() => {});
export const useToast = () => React.useContext(ToastCtx);

export function ToastHost({ children }: { children: React.ReactNode }) {
  const [list, setList] = React.useState<Toast[]>([]);
  const push = React.useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = Date.now() + Math.random();
    setList((l) => [...l.slice(-2), { id, text, kind }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), kind === 'error' ? 6000 : 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-14 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {list.map((t) => (
          <div key={t.id} className={cn('toast-in pointer-events-auto max-w-sm rounded-xl px-4 py-2.5 text-[13px] shadow-xl', t.kind === 'error' ? 'bg-danger text-white' : t.kind === 'ok' ? 'bg-raised text-fg ring-1 ring-accent/40' : 'bg-raised text-fg ring-1 ring-line')}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ── Misc ──────────────────────────────────────────────────────────────────
export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className="flex w-full items-center justify-between py-2 text-[13px] text-dim">
      <span className={cn(on && 'text-fg')}>{label}</span>
      <span className={cn('relative h-5 w-9 rounded-full transition-colors', on ? 'bg-accent' : 'bg-widget')}>
        <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform', on ? 'translate-x-[18px]' : 'translate-x-0.5')} />
      </span>
    </button>
  );
}

export function Segmented<T extends string | number>({ items, value, onChange, className }: { items: { id: T; label: React.ReactNode; title?: string }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cn('flex rounded-lg bg-widget/60 p-0.5', className)}>
      {items.map((it) => (
        <button
          key={String(it.id)}
          type="button"
          title={it.title}
          onClick={() => onChange(it.id)}
          className={cn('flex-1 rounded-md px-2 py-1.5 text-[12px] font-medium transition-colors', value === it.id ? 'bg-fg text-bg' : 'text-dim hover:text-fg')}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function Progress({ value, label }: { value: number; label?: string }) {
  return (
    <div>
      {label && <div className="mb-2 flex justify-between text-[12px] text-dim"><span>{label}</span><span className="font-mono">{Math.round(value * 100)}%</span></div>}
      <div className="h-1.5 overflow-hidden rounded-full bg-widget">
        <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.max(2, value * 100)}%` }} />
      </div>
    </div>
  );
}

export function Empty({ icon, title, body, action }: { icon: React.ReactNode; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <div className="text-faint">{icon}</div>
      <div className="text-[15px] font-medium">{title}</div>
      {body && <p className="max-w-xs text-[13px] leading-relaxed text-dim">{body}</p>}
      {action}
    </div>
  );
}

/** File picker hook returning a trigger function. */
export function useFilePicker(accept: string, multiple: boolean, onFiles: (f: File[]) => void) {
  const ref = React.useRef<HTMLInputElement | null>(null);
  const cb = React.useRef(onFiles);
  React.useEffect(() => {
    cb.current = onFiles;
  });
  React.useEffect(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    input.onchange = () => {
      if (input.files?.length) cb.current(Array.from(input.files));
      input.value = '';
    };
    document.body.appendChild(input);
    ref.current = input;
    return () => input.remove();
  }, [accept, multiple]);
  return React.useCallback(() => ref.current?.click(), []);
}
