import { useEffect, useRef } from 'react';

export const SHORTCUTS: [string, string][] = [
  ['?', 'Open or close this help'],
  ['/', 'Focus the search box'],
  ['j / k', 'Select next / previous promo'],
  ['Enter', 'Open the selected promo'],
  ['Esc', 'Close a modal or drawer, clear focus'],
  ['u', 'Go to Upload'],
  ['r', 'Run the analysis'],
  ['s', 'Open Settings'],
  ['m', 'Open Model settings'],
  ['c', 'Compare heuristic and AI ranking'],
  ['t', 'Toggle dark and light theme'],
  ['+ / -', 'Thumbs up / down on the selected promo'],
  ['e', 'Export the run as a zip'],
  ['l', 'Open or close the live log'],
  ['g then h', 'Go to Home or Results'],
  ['g then a', 'Go to About'],
  ['g then m', 'Go to About Me'],
];

export type Handlers = Partial<Record<string, () => void>>;

function typing(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

/** Enter on a focused control belongs to that control, not to the global shortcut. */
function activatable(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  return !!t && (t.tagName === 'BUTTON' || t.tagName === 'A' || t.tagName === 'SUMMARY' || t.getAttribute?.('role') === 'button');
}

/** Global keys. Ignored while typing, except Esc. `g` starts a two-key sequence. */
export function useShortcuts(handlers: Handlers) {
  const ref = useRef(handlers);
  ref.current = handlers;
  const pendingG = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return ref.current.Escape?.();
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.key === 'Enter' || e.key === ' ') && activatable(e.target)) return;
      const key = e.key === '=' ? '+' : e.key;
      if (pendingG.current && Date.now() - pendingG.current < 1200) {
        pendingG.current = 0;
        const chord = ref.current[`g ${key}`];
        if (chord) {
          e.preventDefault();
          chord();
        }
        return;
      }
      if (key === 'g') {
        pendingG.current = Date.now();
        return;
      }
      const fn = ref.current[key];
      if (fn) {
        e.preventDefault();
        fn();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
