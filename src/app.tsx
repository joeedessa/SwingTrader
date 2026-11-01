import { useEffect, useState } from 'preact/hooks';
import { loadJson } from './data/load';

// Phase 1 shell: proves the data files are served from this origin. The pages arrive in later phases.
interface Board {
  setups: number;
  benchmarks: number;
  barSymbols: number;
  generatedAt: string | null;
  errors: string[];
}

declare global {
  interface Window {
    __board?: Board;
  }
}

export function App() {
  const [board, setBoard] = useState<Board | null>(null);

  useEffect(() => {
    const errors: string[] = [];
    const attempt = <T,>(name: string) => loadJson<T>(name).catch((e: Error) => {
      errors.push(e.message);
      return null;
    });
    Promise.all([
      attempt<unknown[]>('watchlist.json'),
      attempt<unknown[]>('benchmarks.json'),
      attempt<{ bars: Record<string, unknown>; generated_at: string }>('bars.json'),
    ]).then(([watch, bench, bars]) => {
      const next: Board = {
        setups: watch?.length ?? 0,
        benchmarks: bench?.length ?? 0,
        barSymbols: bars ? Object.keys(bars.bars).length : 0,
        generatedAt: bars?.generated_at ?? null,
        errors,
      };
      window.__board = next;
      setBoard(next);
    });
  }, []);

  return (
    <main class="shell">
      <h1>SwingTrader</h1>
      {board === null ? (
        <p>Loading data…</p>
      ) : (
        <ul>
          <li>{board.setups} setups on the watchlist</li>
          <li>{board.benchmarks} benchmarks</li>
          <li>{board.barSymbols} symbols with daily bars{board.generatedAt ? `, written ${board.generatedAt}` : ''}</li>
          {board.errors.map((e) => <li class="error">{e}</li>)}
        </ul>
      )}
    </main>
  );
}
