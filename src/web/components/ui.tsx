import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';

type Variant = 'primary' | 'ghost';

export function Button({ variant = 'ghost', className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const look =
    variant === 'primary'
      ? 'bg-accent text-on-accent border-accent font-semibold'
      : 'bg-surface text-text border-border hover:bg-surface-2';
  return <button type="button" {...rest} className={`rounded-md border px-3 py-1.5 text-sm ${look} ${className}`} />;
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      setDone(false);
    }
  };
  return (
    <Button onClick={copy}>
      <span aria-live="polite">{done ? 'Copied' : label}</span>
    </Button>
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
