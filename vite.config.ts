import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

/* Yahoo sends no CORS header, so the page reaches it through the Cloudflare Worker, which only accepts this
   site's own address. On localhost the same request goes through the dev (or preview) server instead, which is
   not a browser and has no such problem: the page asks for /SwingTrader/__yahoo/..., and this forwards it. */
const yahoo = {
  target: 'https://query1.finance.yahoo.com',
  changeOrigin: true,
  headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
  rewrite: (path: string) => path.replace(/^\/SwingTrader\/__yahoo/, ''),
};

// The site lives at https://joeedessa.github.io/SwingTrader/, and the path is case-sensitive.
export default defineConfig({
  base: '/SwingTrader/',
  plugins: [preact()],
  build: { outDir: 'dist', sourcemap: false },
  server: { proxy: { '/SwingTrader/__yahoo': yahoo } },
  preview: { proxy: { '/SwingTrader/__yahoo': yahoo } },
  // The parity and data tests read multi-megabyte JSON; the generous timeout is for a loaded machine, not a slow test.
  test: { include: ['tests/**/*.test.{ts,tsx}'], testTimeout: 30_000 },
});
