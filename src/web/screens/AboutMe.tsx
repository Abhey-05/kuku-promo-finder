import { useEffect, useState, type ReactNode } from 'react';
import { FILL_ME, PROFILE } from '../profile';

const card = 'rounded-lg border border-border bg-surface p-5';

function Icon({ name }: { name: 'linkedin' | 'github' | 'mail' | 'file' }) {
  const paths: Record<typeof name, ReactNode> = {
    linkedin: <path d="M4 9h3v11H4zM5.5 4a1.75 1.75 0 1 1 0 3.5 1.75 1.75 0 0 1 0-3.5zM10 9h3v1.6c.5-.9 1.7-1.8 3.4-1.8 3 0 3.6 2 3.6 4.6V20h-3v-5.8c0-1.4 0-3.1-1.9-3.1s-2.1 1.5-2.1 3V20h-3z" fill="currentColor" stroke="none" />,
    github: <path d="M12 3a9 9 0 0 0-2.8 17.5c.4.1.6-.2.6-.4v-1.6c-2.5.5-3-1.1-3-1.1-.4-1-1-1.3-1-1.3-.8-.6.1-.6.1-.6.9.1 1.4 1 1.4 1 .8 1.4 2.1 1 2.6.8.1-.6.3-1 .6-1.2-2-.2-4.1-1-4.1-4.5 0-1 .4-1.8 1-2.4-.1-.2-.4-1.2.1-2.4 0 0 .8-.3 2.5.9a8.6 8.6 0 0 1 4.6 0c1.7-1.2 2.5-.9 2.5-.9.5 1.2.2 2.2.1 2.4.6.6 1 1.4 1 2.4 0 3.5-2.1 4.3-4.1 4.5.3.3.6.8.6 1.6v2.4c0 .2.2.5.6.4A9 9 0 0 0 12 3z" fill="currentColor" stroke="none" />,
    mail: <path d="M3 6h18v12H3zM3 6l9 7 9-7" />,
    file: <path d="M6 3h8l4 4v14H6zM14 3v4h4M9 13h6M9 17h6" />,
  };
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function LinkButton({ href, label, icon }: { href: string; label: string; icon: Parameters<typeof Icon>[0]['name'] }) {
  const missing = href === FILL_ME || href.endsWith(FILL_ME);
  if (missing) {
    return (
      <span className="inline-flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-1.5 text-sm text-muted" title="Not added yet">
        <Icon name={icon} /> {label}: not added yet
      </span>
    );
  }
  return (
    <a href={href} target={href.startsWith('mailto:') ? undefined : '_blank'} rel="noreferrer" className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text no-underline hover:bg-surface-2">
      <Icon name={icon} /> {label}
    </a>
  );
}

/** Shows public/resume.pdf when it exists. Otherwise a placeholder, never a broken embed. */
function Resume() {
  const url = `${import.meta.env.BASE_URL}${PROFILE.links.resume}`;
  const [state, setState] = useState<'checking' | 'ok' | 'missing'>('checking');
  useEffect(() => {
    let live = true;
    fetch(url, { method: 'HEAD' })
      .then((r) => live && setState(r.ok && (r.headers.get('content-type') ?? '').includes('pdf') ? 'ok' : 'missing'))
      .catch(() => live && setState('missing'));
    return () => {
      live = false;
    };
  }, [url]);
  return (
    <section className={card} aria-label="Resume">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Resume</h2>
        {state === 'ok' && (
          <a href={url} download className="rounded-md border border-border px-3 py-1.5 text-sm text-text no-underline hover:bg-surface-2">
            Download PDF
          </a>
        )}
      </div>
      {state === 'checking' && <div className="skeleton h-64 rounded" aria-hidden="true" />}
      {state === 'ok' && <iframe title="Resume PDF" src={url} className="h-[70vh] w-full rounded border border-border bg-surface-2" />}
      {state === 'missing' && (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted">
          The resume PDF is not published yet. The sections on this page are taken from it.
        </div>
      )}
    </section>
  );
}

export function AboutMe() {
  const p = PROFILE;
  return (
    <div className="max-w-3xl space-y-5">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold">{p.name}</h1>
        <p className="text-sm text-muted">{p.line}</p>
        <div className="space-y-1">{p.bio.map((b) => <p key={b} className="m-0">{b}</p>)}</div>
        <div className="flex flex-wrap gap-2 pt-1">
          <LinkButton href={p.links.linkedin} label="LinkedIn" icon="linkedin" />
          <LinkButton href={p.links.github} label="GitHub" icon="github" />
          <LinkButton href={p.links.email === FILL_ME ? FILL_ME : `mailto:${p.links.email}`} label="Email" icon="mail" />
          <button type="button" onClick={() => document.getElementById('resume')?.scrollIntoView({ behavior: 'smooth' })} className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text hover:bg-surface-2">
            <Icon name="file" /> Resume
          </button>
        </div>
      </header>

      <section className={card} aria-label="Why I built it this way">
        <h2 className="mb-3 text-lg font-semibold">Why I built it this way</h2>
        <ul className="m-0 list-none space-y-2 p-0 text-sm">
          {p.why.map(([h, t]) => (
            <li key={h}><strong>{h}.</strong> {t}</li>
          ))}
        </ul>
      </section>

      <section className={card} aria-label="Experience">
        <h2 className="mb-3 text-lg font-semibold">Experience</h2>
        <div className="space-y-4">
          {p.experience.map((x) => (
            <div key={x.title}>
              <p className="m-0 font-semibold">{x.title}</p>
              <p className="m-0 text-xs text-muted">{x.when}</p>
              <ul className="mt-1 mb-0 space-y-0.5 pl-5 text-sm">{x.points.map((pt) => <li key={pt}>{pt}</li>)}</ul>
            </div>
          ))}
        </div>
      </section>

      <section className={card} aria-label="Projects">
        <h2 className="mb-3 text-lg font-semibold">Projects</h2>
        <div className="space-y-3">
          {p.projects.map((x) => (
            <div key={x.title}>
              <p className="m-0 font-semibold">{x.title}</p>
              <p className="m-0 text-xs text-muted">{x.when}</p>
              <p className="m-0 mt-1 text-sm">{x.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className={card} aria-label="Skills">
        <h2 className="mb-3 text-lg font-semibold">Skills</h2>
        <dl className="m-0 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[9rem_1fr]">
          {p.skills.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd className="m-0 mb-1">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div id="resume">
        <Resume />
      </div>
    </div>
  );
}
