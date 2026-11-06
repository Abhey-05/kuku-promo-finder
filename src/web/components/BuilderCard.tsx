import { BUILDER_FIELDS, builderText } from '../builder';
import { CopyButton } from './ui';

export function BuilderCard() {
  return (
    <section aria-label="Builder card" className="rounded-lg border border-border bg-surface p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Builder card</h2>
        <CopyButton text={builderText} label="Copy builder card" />
      </div>
      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[10rem_1fr]">
        {BUILDER_FIELDS.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-sm text-muted">{k}</dt>
            <dd className="m-0 mb-1 break-words text-sm">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function BuilderFooter() {
  const pick = (k: string) => BUILDER_FIELDS.find(([f]) => f === k)?.[1] ?? '';
  return (
    <footer className="mt-10 border-t border-border pt-4 text-xs text-muted">
      Built by {pick('Name')} ({pick('Roll number')}), {pick('Branch')}. {pick('Problem chosen')}.
    </footer>
  );
}
