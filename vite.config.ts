import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

// The site lives at https://joeedessa.github.io/SwingTrader/, and the path is case-sensitive.
export default defineConfig({
  base: '/SwingTrader/',
  plugins: [preact()],
  build: { outDir: 'dist', sourcemap: false },
  test: { include: ['tests/**/*.test.ts'] },
});
