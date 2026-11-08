import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { toast, useToasts } from '../toast';

type Variant = 'primary' | 'ghost';

export function Button({ variant = 'ghost', className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const look =
    variant === 'primary'
      ? 'bg-accent text-on-accent border-accent font-semibold'
      : 'bg-surface text-text border-border hover:bg-surface-2';
  return <button type="button" {...rest} className={`rounded-md border px-3 py-1.5 text-sm ${look} ${className}`} />;
}

export function CopyButton({ text, label, done = 'Copied' }: { text: string; label: string; done?: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast(done);
    } catch {
      toast('Copy failed. Your browser blocked the clipboard.', 'error');
    }
  };
  return <Button onClick={copy}>{label}</Button>;
}

/** A small label. `strong` uses the accent, for the one thing that should stand out. */
export function Chip({ children, strong = false, title }: { children: ReactNode; strong?: boolean; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-xs ${strong ? 'border-accent text-accent' : 'border-border text-muted'}`}>
      {children}
    </span>
  );
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4" aria-hidden="true">
      <div className="skeleton mb-3 h-5 w-1/3 rounded" />
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton mb-2 h-3 rounded" style={{ width: `${90 - i * 15}%` }} />
      ))}
    </div>
  );
}

export function Toaster() {
  const list = useToasts();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast-in pointer-events-auto max-w-md rounded-md border px-3 py-2 text-sm shadow-lg ${t.tone === 'error' ? 'border-danger bg-surface text-text' : 'border-border bg-surface-2 text-text'}`}>
          {t.tone === 'error' && <strong className="text-danger">Error: </strong>}
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function Overlay({ title, onClose, children, side = false }: { title: string; onClose: () => void; children: ReactNode; side?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => previous?.focus?.();
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex" style={{ background: 'rgb(0 0 0 / 0.45)' }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={
          side
            ? 'slide-in ml-auto h-full w-full max-w-md overflow-y-auto bg-surface p-5 border-l border-border'
            : 'm-auto max-h-[90vh] w-[calc(100%-32px)] max-w-lg overflow-y-auto rounded-lg bg-surface p-5 border border-border'
        }
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <Button aria-label={`Close ${title}`} onClick={onClose}>
            ✕
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-8 text-center">
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  );
}
