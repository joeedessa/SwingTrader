import { useEffect } from 'preact/hooks';
import { app, load, recompute } from './data/app';
import { route } from './router';
import { useStore } from './store';
import { dismiss, notice } from './ui/notice';
import { TabBar, TopNav } from './ui/nav';
import { BoardPage } from './ui/page';
import { useNarrow } from './ui/hooks';

const REFRESH_AFTER_MS = 5 * 60 * 1000;

function Notice() {
  const n = useStore(notice);
  if (!n.text) return null;
  return (
    <div class={'notice ' + n.tone} role="status" aria-live="polite">
      <span>{n.text}</span>
      <button type="button" class="linkbtn" onClick={dismiss}>Dismiss</button>
    </div>
  );
}

export function App() {
  const r = useStore(route);
  const narrow = useNarrow();

  useEffect(() => {
    void load();
    /* Coming back to the tab: after a few minutes fetch everything again; sooner than that only re-read the clock,
       because a session may have opened or closed while the page sat there. */
    const back = () => {
      if (document.hidden) return;
      const at = app.get().loadedAt;
      if (at && Date.now() - at > REFRESH_AFTER_MS) void load(); else recompute();
    };
    document.addEventListener('visibilitychange', back);
    return () => document.removeEventListener('visibilitychange', back);
  }, []);

  return (
    <div class="app">
      {narrow ? null : <TopNav page={r.page} />}
      <BoardPage key={r.page} set={r.page === 'benchmarks' ? 'benchmarks' : 'watchlist'} />
      {narrow ? <TabBar page={r.page} /> : null}
      <Notice />
    </div>
  );
}
