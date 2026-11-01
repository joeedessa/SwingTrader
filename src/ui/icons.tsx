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
