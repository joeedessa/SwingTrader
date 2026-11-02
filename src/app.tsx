import { useEffect } from 'preact/hooks';
import { app, load, recompute, reloadStored } from './data/app';
import { todayOf } from './data/selectors';
import { visits } from './data/visit';
import { route } from './router';
import { useStore } from './store';
import { dismiss, notice } from './ui/notice';
import { HistoryPage } from './ui/history';
import { FillDialog } from './ui/journal';
import { MethodPage } from './ui/method';
import { MorePage } from './ui/more';
import { TabBar, TopNav } from './ui/nav';
import { BoardPage } from './ui/page';
import { PositionsPage } from './ui/positions';
import { TodayPage } from './ui/today';
import { useNarrow } from './ui/hooks';

const REFRESH_AFTER_MS = 5 * 60 * 1000;

function Notice() {
  const n = useStore(notice);
  if (!n.text) return null;
  return (
    <div class={'notice ' + n.tone} role="status" aria-live="polite">
      <span>{n.text}</span>
      {n.action ? <button type="button" class="linkbtn strong" onClick={() => { n.action!.run(); dismiss(); }}>{n.action.label}</button> : null}
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
      // Another tab, or the old watchlist page, may have saved edits, fills or acknowledgements while this one sat behind.
      reloadStored();
      visits.back(Date.now());
      const at = app.get().loadedAt;
      if (at && Date.now() - at > REFRESH_AFTER_MS) void load(); else recompute();
    };
    /* Leaving the page, by hiding it or closing it, is when Today's last look is written down. */
    const away = () => {
      const s = app.get();
      if (s.phase === 'ready') visits.leave(Date.now(), todayOf(s, 'watchlist', null).ids);
    };
    const hide = () => { if (document.hidden) away(); };
    document.addEventListener('visibilitychange', back);
    document.addEventListener('visibilitychange', hide);
    addEventListener('pagehide', away);
    // The browser says so when another document changes storage: take it in at once.
    addEventListener('storage', reloadStored);
    return () => {
      document.removeEventListener('visibilitychange', back);
      document.removeEventListener('visibilitychange', hide);
      removeEventListener('pagehide', away);
      removeEventListener('storage', reloadStored);
    };
  }, []);

  return (
    <div class="app">
      {narrow ? null : <TopNav page={r.page} />}
      {r.page === 'today' ? <TodayPage key="today" />
        : r.page === 'positions' ? <PositionsPage key="positions" />
        : r.page === 'history' ? <HistoryPage key="history" />
        : r.page === 'method' ? <MethodPage key="method" />
        : r.page === 'more' ? <MorePage key="more" />
        : <BoardPage key={r.page} set={r.page === 'benchmarks' ? 'benchmarks' : 'watchlist'} />}
      {narrow ? <TabBar page={r.page} /> : null}
      <Notice />
      <FillDialog />
    </div>
  );
}
