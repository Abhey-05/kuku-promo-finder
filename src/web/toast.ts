import { useEffect, useState } from 'react';

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'error';
}

let next = 1;
const listeners = new Set<(t: Toast[]) => void>();
let current: Toast[] = [];

function emit() {
  for (const l of listeners) l(current);
}

/** Shows a short message at the bottom of the screen. Errors stay longer. */
export function toast(text: string, tone: Toast['tone'] = 'info') {
  const t = { id: next++, text, tone };
  current = [...current.slice(-2), t];
  emit();
  setTimeout(() => {
    current = current.filter((x) => x.id !== t.id);
    emit();
  }, tone === 'error' ? 6000 : 2500);
}

export function useToasts(): Toast[] {
  const [list, setList] = useState(current);
  useEffect(() => {
    listeners.add(setList);
    return () => void listeners.delete(setList);
  }, []);
  return list;
}
