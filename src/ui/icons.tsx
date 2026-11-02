import type { ComponentChildren } from 'preact';

/* Monoline icons on a 24-unit grid, drawn with the text colour, so they follow light and dark and the active
   state without a second asset. Decorative: the button or link around each one carries the name. */

const Svg = ({ children, size = 22 }: { children: ComponentChildren; size?: number }) => (
  <svg class="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">{children}</svg>
);

export const IconSetups = () => (
  <Svg><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1.2" fill="currentColor" stroke="none" /><circle cx="4.5" cy="12" r="1.2" fill="currentColor" stroke="none" /><circle cx="4.5" cy="18" r="1.2" fill="currentColor" stroke="none" /></Svg>
);
export const IconBenchmarks = () => (
  <Svg><path d="M5 20V11M12 20V4M19 20v-6" /></Svg>
);
export const IconRefresh = () => (
  <Svg><path d="M20 12a8 8 0 1 1-2.6-5.9" /><path d="M20 4v4.5h-4.5" /></Svg>
);
export const IconPlus = () => (
  <Svg><path d="M12 5v14M5 12h14" /></Svg>
);
export const IconSearch = () => (
  <Svg size={16}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></Svg>
);
export const IconClose = () => (
  <Svg size={20}><path d="M6 6l12 12M18 6 6 18" /></Svg>
);
export const IconExternal = () => (
  <Svg size={14}><path d="M9 6h9v9M18 6 7 17" /></Svg>
);
export const IconChevron = () => (
  <Svg size={16}><path d="m9 6 6 6-6 6" /></Svg>
);
export const IconDown = () => (
  <Svg size={14}><path d="m6 9 6 6 6-6" /></Svg>
);
export const IconMore = () => (
  <Svg><circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none" /></Svg>
);
export const IconToday = () => (
  <Svg><path d="M4 13.5 6.4 6.2A1.5 1.5 0 0 1 7.8 5h8.4a1.5 1.5 0 0 1 1.4 1.2L20 13.5" /><path d="M4 13.5V18a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 18v-4.5h-4.6a3.4 3.4 0 0 1-6.8 0z" /></Svg>
);
export const IconCheck = () => (
  <Svg size={24}><circle cx="12" cy="12" r="9" /><path d="m8.2 12.4 2.7 2.7 5-5.4" /></Svg>
);
