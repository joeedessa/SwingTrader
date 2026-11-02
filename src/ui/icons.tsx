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
export const IconCalendar = () => (
  <Svg size={13}><rect x="4" y="5.5" width="16" height="14" rx="2.5" /><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" /></Svg>
);
export const IconPositions = () => (
  <Svg><path d="M8 3v18M16 3v18M8 8h8M8 13h8M8 18h8" /></Svg>
);
export const IconHistory = () => (
  <Svg><path d="M3.6 12a8.4 8.4 0 1 0 2.5-6" /><path d="M3.6 4.6V9H8" /><path d="M12 7.5V12l3 2" /></Svg>
);
export const IconMethod = () => (
  <Svg><path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H19v14H7.5A2.5 2.5 0 0 0 5 19.5V5.5z" /><path d="M5 19.5A2.5 2.5 0 0 0 7.5 22H19v-5" /></Svg>
);
export const IconSignals = () => (
  <Svg><path d="M3 16.5 8 10l3.5 3.5L16 6l5 5" /><path d="M3 20c4.2 0 5.6-5 9-5s4.6 3 9 1.5" /></Svg>
);
