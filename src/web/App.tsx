import JSZip from 'jszip';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type DragEvent } from 'react';
import { DEFAULT_AGENT, DEFAULT_CONFIG, DEFAULT_WEIGHTS } from '../core/config';
import { PROVIDERS } from '../core/llm/interface';
import type { AgentSettings, InputFile, ProviderName, RunView, Weights } from '../core/schema';
import { LogDrawer, RunSummaryLine } from './components/Live';
import { initialLive, liveReducer } from './live';
import { Settings, type LlmSettings } from './components/Settings';
import { Button, Overlay, Toaster } from './components/ui';
import { downloadBlob, readDrop, screenplayFiles } from './files';
import { labelsCsv, loadLabels, saveLabels, type Vote } from './labels';
import { About } from './screens/About';
import { AboutMe } from './screens/AboutMe';
import { Detail } from './screens/Detail';
import { Home } from './screens/Home';
import { aiRan, applyFilters, Results, type ResultFilters } from './screens/Results';
import { SHORTCUTS, useShortcuts } from './shortcuts';
import { applyTheme, initialTheme, resolved, type ThemeChoice } from './theme';
import { toast } from './toast';
import type { WorkerMessage, WorkerRequest } from './worker';

const demoModules = import.meta.glob('../../samples/demo-show/*.txt', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const demoFiles: InputFile[] = Object.entries(demoModules).map(([p, text]) => ({ name: p.split('/').pop()!, text }));

type Route = { name: 'home' } | { name: 'results' } | { name: 'about' } | { name: 'about-me' } | { name: 'promo'; id: string };

function parseHash(): Route {
  const h = decodeURIComponent(window.location.hash.replace(/^#\/?/, ''));
  if (h === 'results') return { name: 'results' };
  if (h === 'about') return { name: 'about' };
  if (h === 'about-me') return { name: 'about-me' };
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
  const [error, setError] = useState<string | null>(null);
  const [live, dispatch] = useReducer(liveReducer, undefined, initialLive);
  const [logOpen, setLogOpen] = useState(false);
  const [autoRun, setAutoRunState] = useState<boolean>(() => {
    try {
      return localStorage.getItem('promo-finder:auto-run') !== '0';
    } catch {
      return true;
    }
  });
  const setAutoRun = (v: boolean) => {
    setAutoRunState(v);
    try {
      localStorage.setItem('promo-finder:auto-run', v ? '1' : '0');
    } catch {
      /* storage blocked: the choice lasts for this visit only */
    }
  };
  const pendingAutoRun = useRef(false);
  const runStartedAt = useRef(0);
  const autoRunRef = useRef(autoRun);
  autoRunRef.current = autoRun;
  const [view, setView] = useState<RunView | null>(null);
  const [outputs, setOutputs] = useState<Record<string, string> | null>(null);
  const [overlay, setOverlay] = useState<'help' | 'settings' | null>(null);
  const [selected, setSelected] = useState(0);
  const [compare, setCompare] = useState(false);
  const [labels, setLabels] = useState<Record<string, Vote>>(loadLabels);
  const [filters, setFilters] = useState<ResultFilters>({ query: '', episode: '', minScore: 0, sort: 'rank', useLlm: true, showRunnersUp: false });
  const [theme, setThemeState] = useState<ThemeChoice>(initialTheme);
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS);
  const [cap, setCap] = useState<number | null>(DEFAULT_CONFIG.maxPerEpisode);
  const [agent, setAgent] = useState<AgentSettings>(DEFAULT_AGENT);
  const [llm, setLlm] = useState<LlmSettings>({ provider: 'none', model: '', baseUrl: '', apiKey: '', temperature: 0 });
  const worker = useRef<Worker | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const aiMode = llm.provider !== 'none';
  const modelName = llm.model || PROVIDERS[llm.provider].defaultModel;
  const modeLabel = aiMode ? `AI: ${llm.provider}/${modelName}` : 'Heuristic only';

  useEffect(() => {
    const onHash = () => {
      setRoute(parseHash());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => applyTheme(theme), [theme]);

  /** Starts a worker that reads (and unzips) the files and parses each episode, reporting as it goes. */
  const load = useCallback((sources: (File | InputFile)[], name: string) => {
    if (sources.length === 0) {
      setError('No .txt or .zip files found in that selection.');
      return;
    }
    worker.current?.terminate();
    setError(null);
    setFiles([]);
    setSource(name);
    setView(null);
    setOutputs(null);
    const zip = sources.some((f) => f.name.toLowerCase().endsWith('.zip'));
    dispatch({ type: 'start', phase: 'reading', zip, at: Date.now() });
    go('/');
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    w.onmessage = ({ data }: MessageEvent<WorkerMessage>) => {
      if (data.type === 'events') dispatch({ type: 'events', events: data.events, at: Date.now() });
      else if (data.type === 'read_done') {
        setFiles(data.files);
        dispatch({ type: 'read_done', at: Date.now() });
        w.terminate();
        if (data.report.totals.episodes_parsed > 0 && autoRunRef.current) pendingAutoRun.current = true;
      } else if (data.type === 'error') {
        dispatch({ type: 'fail', message: data.message, at: Date.now() });
        setError(data.message);
        w.terminate();
      }
    };
    w.onerror = () => {
      dispatch({ type: 'fail', message: 'Reading stopped unexpectedly.', at: Date.now() });
      setError('That file could not be read. If it is a zip, check that it is not damaged.');
    };
    const req: WorkerRequest = { type: 'read', sources };
    w.postMessage(req);
  }, []);

  const run = useCallback((override?: { provider: ProviderName }) => {
    if (live.phase === 'running' || live.phase === 'reading' || files.length === 0) return;
    const provider = override?.provider ?? llm.provider;
    const info = PROVIDERS[provider];
    const ai = provider !== 'none';
    if (ai && info.needsKey && !llm.apiKey) {
      toast(`${info.label} needs an API key. Add it in Settings, or switch to Heuristic only.`, 'error');
      setOverlay('settings');
      return;
    }
    if (ai && info.needsBaseUrl && !llm.baseUrl) {
      toast('Enter a base URL for the OpenAI-compatible provider.', 'error');
      setOverlay('settings');
      return;
    }
    setError(null);
    runStartedAt.current = Date.now();
    dispatch({ type: 'start', phase: 'running', at: runStartedAt.current, keepFiles: true });
    go('/');
    worker.current?.terminate();
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    w.onmessage = ({ data }: MessageEvent<WorkerMessage>) => {
      if (data.type === 'events') {
        dispatch({ type: 'events', events: data.events, at: Date.now() });
      } else if (data.type === 'error') {
        dispatch({ type: 'fail', message: data.message, at: Date.now() });
        setError(data.message);
        w.terminate();
      } else if (data.type === 'done') {
        setView(data.view);
        setOutputs(data.outputs);
        setSelected(0);
        setFilters((f) => ({ ...f, useLlm: true }));
        w.terminate();
        const took = Date.now() - runStartedAt.current;
        const fb = data.view.trace.stages.find((s) => s.stage === 'verify')?.fallbacks.length ?? 0;
        toast(`Done in ${took < 1000 ? `${took} ms` : `${(took / 1000).toFixed(1)} s`}${data.view.trace.mode === 'ai' ? `. ${data.view.trace.calls} model calls${fb ? `, ${fb} fallbacks` : ''}` : ''}.`, fb ? 'error' : 'info');
        go('/results');
        setTimeout(() => document.getElementById('results-heading')?.focus(), 50);
      }
    };
    w.onerror = () => {
      dispatch({ type: 'fail', message: 'The analysis stopped unexpectedly. Your files are still loaded, so you can run it again.', at: Date.now() });
      setError('The analysis stopped unexpectedly. Your files are still loaded, so you can run it again.');
    };
    const req: WorkerRequest = {
      files,
      type: 'run',
      config: { ...DEFAULT_CONFIG, weights, maxPerEpisode: cap, provider, agent, label: 'web' },
      llm: { apiKey: llm.apiKey || undefined, model: llm.model || undefined, baseUrl: llm.baseUrl || undefined, temperature: llm.temperature },
    };
    w.postMessage(req);
  }, [live.phase, files, weights, cap, llm, agent]);

  // Auto-run once the upload is parsed, using the latest settings.
  useEffect(() => {
    if (live.phase === 'ready' && pendingAutoRun.current && files.length) {
      pendingAutoRun.current = false;
      run();
    }
  }, [live.phase, files, run]);

  const cancel = () => {
    worker.current?.terminate();
    worker.current = null;
    dispatch({ type: 'cancel', at: Date.now() });
    toast('Cancelled. Results so far are kept and marked partial.');
  };

  const runHeuristic = () => {
    setLlm((l) => ({ ...l, provider: 'none' }));
    run({ provider: 'none' });
  };

  const exportRun = useCallback(async () => {
    if (!outputs) {
      toast('Nothing to export yet. Run the analysis first.');
      return;
    }
    const zip = new JSZip();
    for (const [n, content] of Object.entries(outputs)) zip.file(n, content);
    if (Object.keys(labels).length) zip.file('labels.csv', labelsCsv(labels));
    downloadBlob(await zip.generateAsync({ type: 'blob' }), 'promo-run.zip');
    toast('Exported promo-run.zip');
  }, [outputs, labels]);

  const exportLabels = () => {
    downloadBlob(new Blob([labelsCsv(labels)], { type: 'text/csv' }), 'labels.csv');
    toast('Exported labels.csv');
  };

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
      else if (logOpen) setLogOpen(false);
      else (document.activeElement as HTMLElement | null)?.blur();
    },
    u: () => go('/'),
    r: () => run(),
    l: () => setLogOpen((o) => !o),
    s: () => setOverlay('settings'),
    m: () => setOverlay('settings'),
    c: () => {
      setCompare((x) => !x);
      if (!onResults) go('/results');
    },
    t: toggleTheme,
    '+': () => selectedId && vote(selectedId, 'up'),
    '-': () => selectedId && vote(selectedId, 'down'),
    e: () => void exportRun(),
    'g h': () => go(view ? '/results' : '/'),
    'g a': () => go('/about'),
    'g m': () => go('/about-me'),
  });

  const nav: [string, string, boolean][] = [
    ['Upload', '#/', route.name === 'home'],
    ['Results', '#/results', route.name === 'results' || route.name === 'promo'],
    ['About', '#/about', route.name === 'about'],
    ['About Me', '#/about-me', route.name === 'about-me'],
  ];

  const lastRun = view ? (aiRan(view) ? `Last run: AI ${view.trace.provider}/${view.trace.model}` : 'Last run: heuristic only') : 'No run yet';

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5">
          <a href="#/" className="font-semibold text-text no-underline">Promo Finder</a>
          <nav aria-label="Main" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {nav.map(([name, href, active]) => (
              <a key={name} href={href} aria-current={active ? 'page' : undefined} className={active ? 'font-semibold text-accent no-underline' : 'text-muted no-underline hover:text-text'}>
                {name}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setOverlay('settings')}
              title={`${lastRun}. Click or press m to change.`}
              aria-label={`Mode: ${modeLabel}. Open model settings.`}
              data-testid="mode-badge"
              className={`max-w-[14rem] truncate rounded-full border px-2.5 py-1 text-xs font-semibold ${aiMode ? 'border-accent text-accent' : 'border-border text-muted'}`}
            >
              {modeLabel}
            </button>
            <Button aria-label="Keyboard shortcuts" onClick={() => setOverlay('help')}>?</Button>
            <Button aria-label={`Switch to ${resolved(theme) === 'dark' ? 'light' : 'dark'} theme`} onClick={toggleTheme}>{resolved(theme) === 'dark' ? '☀' : '☾'}</Button>
            <Button aria-label="Open settings" onClick={() => setOverlay('settings')}>⚙</Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        {route.name === 'home' && (
          <Home
            live={live}
            source={source}
            error={error}
            aiMode={aiMode}
            modeLabel={modeLabel}
            hasResults={view !== null}
            autoRun={autoRun}
            setAutoRun={setAutoRun}
            onDrop={(e: DragEvent) => {
              e.preventDefault();
              void readDrop(e.dataTransfer)
                .then((f) => load(f, `${f.length} file${f.length === 1 ? '' : 's'} dropped`))
                .catch(() => setError('That selection could not be read.'));
            }}
            onPick={(picked) => {
              const f = screenplayFiles(picked);
              load(f, `${f.length} file${f.length === 1 ? '' : 's'} selected`);
            }}
            onDemo={() => load(demoFiles, 'Demo show (fictional)')}
            onRun={() => run()}
            onCancel={cancel}
            onHeuristic={runHeuristic}
            onSettings={() => setOverlay('settings')}
            onResults={() => go('/results')}
          />
        )}
        {route.name === 'results' && (
          <Results view={view} filters={filters} setFilters={setFilters} visible={visible} selected={selected} setSelected={setSelected} labels={labels} compare={compare} setCompare={setCompare} onVote={vote} onOpen={(id) => go(`/promo/${encodeURIComponent(id)}`)} onExport={() => void exportRun()} onExportLabels={exportLabels} onUpload={() => go('/')} searchRef={searchRef} runSummary={<RunSummaryLine live={live} aiMode={view?.trace.mode === 'ai'} onRetry={() => run()} />} />
        )}
        {route.name === 'promo' && <Detail promo={current} trace={view?.trace} vote={labels[route.id]} onVote={(v) => vote(route.id, v)} onBack={() => go('/results')} />}
        {route.name === 'about' && <About />}
        {route.name === 'about-me' && <AboutMe />}
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
      {overlay === 'settings' && <Settings llm={llm} setLlm={setLlm} agent={agent} setAgent={setAgent} weights={weights} setWeights={setWeights} cap={cap} setCap={setCap} theme={theme} setTheme={setThemeState} onClose={() => setOverlay(null)} />}
      {logOpen && <LogDrawer live={live} onClose={() => setLogOpen(false)} />}
      <Toaster />
    </div>
  );
}
