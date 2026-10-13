/** The 22 hand-drawn icons of DESIGN-SYSTEM section 6.22: 20x20 grid, 1.75 stroke, round caps, currentColor. */
import type { ReactNode } from 'react';

export const ICON_NAMES = [
  'overview', 'stations', 'rejects', 'sacks', 'weight', 'product', 'reports', 'health', 'setup',
  'calendar', 'compare', 'chevron-down', 'chevron-right', 'close', 'info', 'lock', 'download',
  'print', 'refresh', 'search', 'check', 'menu',
] as const;
export type IconName = (typeof ICON_NAMES)[number];

const SHAPES: Record<IconName, ReactNode> = {
  overview: (<><rect x="3" y="3" width="5.5" height="5.5" rx="1.5" /><rect x="11.5" y="3" width="5.5" height="5.5" rx="1.5" /><rect x="3" y="11.5" width="5.5" height="5.5" rx="1.5" /><rect x="11.5" y="11.5" width="5.5" height="5.5" rx="1.5" /></>),
  stations: <path d="M4 16v-5M10 16V4M16 16V8M2.5 16.5h15" />,
  rejects: (<><circle cx="10" cy="10" r="7" /><path d="M7.2 7.2l5.6 5.6M12.8 7.2l-5.6 5.6" /></>),
  sacks: <path d="M7 3.5h6l1.5 3-1 10H6.5l-1-10zM5.7 6.5h8.6" />,
  weight: <path d="M3 6.5h14M10 3.5v3M5 6.5l-2.3 5.5a2.5 2.5 0 004.6 0zM15 6.5l-2.3 5.5a2.5 2.5 0 004.6 0zM7 16.5h6" />,
  product: <path d="M10 2.8l6.7 3.4v7.6L10 17.2l-6.7-3.4V6.2zM3.3 6.2L10 9.6l6.7-3.4M10 9.6v7.6" />,
  reports: <path d="M5 2.5h6.5L15 6v11.5H5zM11.5 2.5V6H15M7.5 10h5M7.5 13.5h5" />,
  health: <path d="M2 10h4l2-5.5 3.5 11 2-5.5H18" />,
  setup: (<><path d="M3 6h8M15 6h2M3 14h2M9 14h8" /><circle cx="13" cy="6" r="2" /><circle cx="7" cy="14" r="2" /></>),
  calendar: (<><rect x="3" y="4.5" width="14" height="12.5" rx="2" /><path d="M3 8.5h14M7 2.5v3M13 2.5v3" /></>),
  compare: <path d="M4 7h11M12 4l3 3-3 3M16 13H5M8 10l-3 3 3 3" />,
  'chevron-down': <path d="M5 8l5 5 5-5" />,
  'chevron-right': <path d="M8 5l5 5-5 5" />,
  close: <path d="M5 5l10 10M15 5L5 15" />,
  info: (<><circle cx="10" cy="10" r="7.5" /><path d="M10 9.2v4.6M10 6.4h.01" /></>),
  lock: (<><rect x="4.5" y="9" width="11" height="8" rx="2" /><path d="M7 9V6.5a3 3 0 016 0V9" /></>),
  download: <path d="M10 3v9M6.5 8.8l3.5 3.5 3.5-3.5M4 16h12" />,
  print: <path d="M6 7V3h8v4M6 12H4.5A1.5 1.5 0 013 10.5v-2A1.5 1.5 0 014.5 7h11A1.5 1.5 0 0117 8.5v2a1.5 1.5 0 01-1.5 1.5H14M6 10.5h8v6.5H6z" />,
  refresh: <path d="M16.5 10a6.5 6.5 0 11-2-4.7M16.5 3.5v3.3h-3.3" />,
  search: (<><circle cx="9" cy="9" r="5.5" /><path d="M13.2 13.2L17 17" /></>),
  check: <path d="M4.5 10.5l3.5 3.5 7.5-8" />,
  menu: <path d="M3 5.5h14M3 10h14M3 14.5h14" />,
};

export interface IconProps {
  name: IconName;
  /** Pixel size; default 20 (the grid). */
  size?: number;
  /** A standalone icon carries a label (role img). Without one it is decorative and aria-hidden. */
  label?: string;
  className?: string;
}

export function Icon({ name, size = 20, label, className }: IconProps) {
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true as const, focusable: false as const };
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      data-icon={name}
      {...a11y}
    >
      {SHAPES[name]}
    </svg>
  );
}
