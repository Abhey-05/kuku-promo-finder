import JSZip from 'jszip';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { DEFAULT_CONFIG, DEFAULT_WEIGHTS } from '../core/config';
import { DEFAULT_MODELS } from '../core/llm/interface';
import { parseAll } from '../core/parse';
import type { Stage } from '../core/pipeline';
import type { InputFile, ParseReport, RunView, Weights } from '../core/schema';
import { Settings, type LlmSettings } from './components/Settings';
import { Button, Overlay } from './components/ui';
import { downloadBlob, readDrop, readFiles } from './files';
import { labelsCsv, loadLabels, saveLabels, type Vote } from './labels';
import { About } from './screens/About';
import { Detail } from './screens/Detail';
import { Home } from './screens/Home';
import { applyFilters, Results, type ResultFilters } from './screens/Results';
import { SHORTCUTS, useShortcuts } from './shortcuts';
import { applyTheme, initialTheme, resolved, type ThemeChoice } from './theme';
import type { WorkerMessage, WorkerRequest } from './worker';

const demoModules = import.meta.glob('../../samples/demo-show/*.txt', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const demoFiles: InputFile[] = Object.entries(demoModules).map(([p, text]) => ({ name: p.split('/').pop()!, text }));

type Route = { name: 'home' } | { name: 'results' } | { name: 'about' } | { name: 'promo'; id: string };

function parseHash(): Route {
  const h = decodeURIComponent(window.location.hash.replace(/^#\/?/, ''));
  if (h === 'results') return { name: 'results' };
  if (h === 'about') return { name: 'about' };
  if (h.startsWith('promo/')) return { name: 'promo', id: h.slice(6) };
  return { name: 'home' };
}

const go = (hash: string) => {
  window.location.hash = hash;
};

export function App() {
  const [route, setRoute] = useState<Route>(parseHash);
  const [files, setFiles] = useState<InputFile[]>([]);
  const [source, setSource] = useState('');
  const [report, setReport] = useState<ParseReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage | null>(null);
  const [view, setView] = useState<RunView | null>(null);
  const [outputs, setOutputs] = useState<Record<string, string> | null>(null);
  const [overlay, setOverlay] = useState<'help' | 'settings' | null>(null);
  const [selected, setSelected] = useState(0);
  const [labels, setLabels] = useState<Record<string, Vote>>(loadLabels);
  const [filters, setFilters] = useState<ResultFilters>({ query: '', episode: '', minScore: 0, sort: 'rank', useLlm: true, showRunnersUp: false });
  const [theme, setThemeState] = useState<ThemeChoice>(initialTheme);
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS);
  const [cap, setCap] = useState<number | null>(DEFAULT_CONFIG.maxPerEpisode);
  const [llm, setLlm] = useState<LlmSettings>({ provider: 'none', model: '', baseUrl: '', apiKey: '' });
  const worker = useRef<Worker | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const running = stage !== null;

  useEffect(() => {
    const onHash = () => {
      setRoute(parseHash());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => applyTheme(theme), [theme]);

  const load = useCallback((input: InputFile[], name: string) => {
    if (input.length === 0) {
      setError('No .txt screenplays found in that selection.');
      return;
    }
    setError(null);
    setFiles(input);
    setSource(name);
    setReport(parseAll(input).report);
    setView(null);
    setOutputs(null);
  }, []);

  const attempt = async (read: () => Promise<InputFile[]>, name: (n: number) => string) => {
    try {
      const input = await read();
      load(input, name(input.length));
    } catch {
      setError('That file could not be read. If it is a zip, check that it is not damaged.');
    }
  };

  const run = useCallback(() => {
    if (running || files.length === 0 || !report?.totals.episodes_parsed) return;
    setError(null);
    setStage('parse');
    worker.current?.terminate();
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    w.onmessage = ({ data }: MessageEvent<WorkerMessage>) => {
      if (data.type === 'stage') setStage(data.stage);
      else if (data.type === 'error') {
        setStage(null);
        setError(data.message);
      } else {
        setView(data.view);
        setOutputs(data.outputs);
        setStage(null);
        setSelected(0);
        go('/results');
      }
    };
    w.onerror = () => {
      setStage(null);
      setError('The analysis stopped unexpectedly. Your files are still loaded, so you can run it again.');
    };
    const req: WorkerRequest = {
      files,
      config: { ...DEFAULT_CONFIG, weights, maxPerEpisode: cap, provider: llm.provider, label: 'web' },
      llm: { apiKey: llm.apiKey || undefined, model: llm.model || DEFAULT_MODELS[llm.provider], baseUrl: llm.baseUrl || undefined },
    };
    w.postMessage(req);
  }, [running, files, report, weights, cap, llm]);

  const cancel = () => {
    worker.current?.terminate();
    worker.current = null;
    setStage(null);
  };

  const exportRun = useCallback(async () => {
    if (!outputs) return;
    const zip = new JSZip();
    for (const [n, content] of Object.entries(outputs)) zip.file(n, content);
    if (Object.keys(labels).length) zip.file('labels.csv', labelsCsv(labels));
    downloadBlob(await zip.generateAsync({ type: 'blob' }), 'promo-run.zip');
  }, [outputs, labels]);

  const exportLabels = () => downloadBlob(new Blob([labelsCsv(labels)], { type: 'text/csv' }), 'labels.csv');

  const vote = useCallback((id: string, v: Vote) => {
    setLabels((prev) => {
      const next = { ...prev };
      if (next[id] === v) delete next[id];
      else next[id] = v;
      saveLabels(next);
      return next;
    });
  }, []);

  const visible = useMemo(() => (view ? applyFilters(view, filters) : []), [view, filters]);
  useEffect(() => setSelected((s) => Math.min(s, Math.max(0, visible.length - 1))), [visible.length]);

  const onResults = route.name === 'results';
  const current = route.name === 'promo' ? visible.find((p) => p.id === route.id) ?? (view ? [...view.promos, ...view.heuristicPromos, ...view.runnersUp].find((p) => p.id === route.id) : undefined) : undefined;
  const selectedId = route.name === 'promo' ? route.id : visible[selected]?.id;

  const toggleTheme = () => setThemeState(resolved(theme) === 'dark' ? 'light' : 'dark');

  useShortcuts({
    '?': () => setOverlay((o) => (o === 'help' ? null : 'help')),
    '/': () => {
      if (!onResults) go('/results');
      setTimeout(() => searchRef.current?.focus(), 0);
    },
    j: () => onResults && setSelected((s) => Math.min(s + 1, visible.length - 1)),
    k: () => onResults && setSelected((s) => Math.max(s - 1, 0)),
    Enter: () => {
      if (onResults && selectedId) go(`/promo/${encodeURIComponent(selectedId)}`);
    },
    Escape: () => {
      if (overlay) setOverlay(null);
      else (document.activeElement as HTMLElement | null)?.blur();
    },
    u: () => go('/'),
    r: run,
    s: () => setOverlay('settings'),
    t: toggleTheme,
    '+': () => selectedId && vote(selectedId, 'up'),
    '-': () => selectedId && vote(selectedId, 'down'),
    e: () => void exportRun(),
    'g h': () => go(view ? '/results' : '/'),
    'g a': () => go('/about'),
  });

  const nav: [string, string, boolean][] = [
    ['Upload', '#/', route.name === 'home'],
    ['Results', '#/results', route.name === 'results' || route.name === 'promo'],
    ['About', '#/about', route.name === 'about'],
  ];

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-5 gap-y-1 px-4 py-2.5">
          <a href="#/" className="font-semibold text-text no-underline">Promo Finder</a>
          <nav aria-label="Main" className="flex gap-4 text-sm">
            {nav.map(([name, href, active]) => (
              <a key={name} href={href} aria-current={active ? 'page' : undefined} className={active ? 'font-semibold text-accent no-underline' : 'text-muted no-underline hover:text-text'}>
                {name}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex gap-1.5">
            <Button aria-label="Keyboard shortcuts" onClick={() => setOverlay('help')}>?</Button>
            <Button aria-label={`Switch to ${resolved(theme) === 'dark' ? 'light' : 'dark'} theme`} onClick={toggleTheme}>{resolved(theme) === 'dark' ? '☀' : '☾'}</Button>
            <Button aria-label="Open settings" onClick={() => setOverlay('settings')}>⚙</Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6">
        {route.name === 'home' && (
          <Home
            fileCount={files.length}
            source={source}
            report={report}
            error={error}
            running={running}
            stage={stage}
            provider={llm.provider}
            onDrop={(e: DragEvent) => {
              e.preventDefault();
              void attempt(() => readDrop(e.dataTransfer), (n) => `${n} file${n === 1 ? '' : 's'} dropped`);
            }}
            onPick={(f) => void attempt(() => readFiles(f), (n) => `${n} file${n === 1 ? '' : 's'} selected`)}
            onDemo={() => load(demoFiles, 'Demo show (fictional)')}
            onRun={run}
            onCancel={cancel}
            onSettings={() => setOverlay('settings')}
          />
        )}
        {route.name === 'results' && (
          <Results view={view} filters={filters} setFilters={setFilters} visible={visible} selected={selected} setSelected={setSelected} labels={labels} onVote={vote} onOpen={(id) => go(`/promo/${encodeURIComponent(id)}`)} onExport={() => void exportRun()} onExportLabels={exportLabels} onUpload={() => go('/')} searchRef={searchRef} />
        )}
        {route.name === 'promo' && <Detail promo={current} vote={labels[route.id]} onVote={(v) => vote(route.id, v)} onBack={() => go('/results')} />}
        {route.name === 'about' && <About />}
      </main>

      {overlay === 'help' && (
        <Overlay title="Keyboard shortcuts" onClose={() => setOverlay(null)}>
          <table className="w-full text-sm">
            <tbody>
              {SHORTCUTS.map(([k, what]) => (
                <tr key={k} className="border-t border-border">
                  <td className="py-1.5 pr-4 whitespace-nowrap">
                    {k.split(' ').map((p, i) => (p === 'then' || p === '/' ? <span key={i} className="text-muted"> {p} </span> : <kbd key={i}>{p}</kbd>))}
                  </td>
                  <td className="py-1.5">{what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Overlay>
      )}
      {overlay === 'settings' && <Settings llm={llm} setLlm={setLlm} weights={weights} setWeights={setWeights} cap={cap} setCap={setCap} theme={theme} setTheme={setThemeState} onClose={() => setOverlay(null)} />}
    </div>
  );
}
