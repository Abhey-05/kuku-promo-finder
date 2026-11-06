export type Vote = 'up' | 'down';
const KEY = 'promo-finder-labels';

export function loadLabels(): Record<string, Vote> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function saveLabels(labels: Record<string, Vote>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(labels));
  } catch {
    // Without storage, labels last for this visit and can still be exported.
  }
}

export function labelsCsv(labels: Record<string, Vote>): string {
  const rows = Object.entries(labels).map(([id, v]) => `${id},${v === 'up' ? 'post' : 'dont'}`);
  return ['id,label', ...rows].join('\n') + '\n';
}
