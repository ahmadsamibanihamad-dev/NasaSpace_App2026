// Thin line icons, single stroke weight (1.5), 24px grid.
import type { SVGProps } from 'react'

const P: Record<string, string> = {
  home: 'M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10',
  farm: 'M3 20h18M5 20V9l7-5 7 5v11M9 20v-5h6v5',
  plus: 'M12 5v14M5 12h14',
  rotate: 'M4 12a8 8 0 0114-5.3M20 12a8 8 0 01-14 5.3M18 3v4h-4M6 21v-4h4',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  alert: 'M12 3l10 18H2L12 3zM12 10v4M12 17.5v.5',
  file: 'M14 3H6v18h12V7l-4-4zM14 3v4h4M9 13h6M9 17h6',
  settings: 'M12 9a3 3 0 100 6 3 3 0 000-6zM19.4 15l1.6 1-2 3.4-1.8-.7a7 7 0 01-2 1.1L15 22h-4l-.3-2.2a7 7 0 01-2-1.1l-1.8.7-2-3.4 1.6-1a7 7 0 010-2.3L4.9 11l2-3.4 1.8.7a7 7 0 012-1.1L11 5h4l.3 2.2a7 7 0 012 1.1l1.8-.7 2 3.4-1.6 1a7 7 0 010 2.3z',
  bell: 'M6 16V11a6 6 0 1112 0v5l2 2H4l2-2zM10 21h4',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4',
  globe: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  chevronDown: 'M6 9l6 6 6-6',
  chevronLeft: 'M15 6l-6 6 6 6',
  chevronRight: 'M9 6l6 6-6 6',
  menu: 'M4 7h16M4 12h16M4 17h16',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
  pin: 'M12 21s7-6.2 7-12a7 7 0 10-14 0c0 5.8 7 12 7 12zM12 11a2 2 0 100-4 2 2 0 000 4z',
  locate: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v3M12 19v3M2 12h3M19 12h3',
  drop: 'M12 3s6 7 6 11a6 6 0 01-12 0c0-4 6-11 6-11z',
  sun: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  thermo: 'M10 13V5a2 2 0 114 0v8a4 4 0 11-4 0zM12 9v6',
  cloudRain: 'M7 15a4 4 0 01-.5-8A6 6 0 0118 8a3.5 3.5 0 01-1 7H7zM8 18l-1 3M12 18l-1 3M16 18l-1 3',
  snow: 'M12 2v20M4.9 7l14.2 10M4.9 17L19.1 7M9 4l3 2 3-2M9 20l3-2 3 2',
  leaf: 'M5 19c0-8 5-14 15-14 0 10-6 15-14 15M5 19l7-7',
  sprout: 'M12 21v-9M12 12c0-4-3-6-7-6 0 4 3 6 7 6zM12 10c0-4 3-6 7-6 0 4-3 6-7 6z',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  check: 'M5 12l5 5 9-10',
  x: 'M6 6l12 12M18 6L6 18',
  info: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 11v5M12 8v.5',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3',
  redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  merge: 'M7 4v5a3 3 0 003 3h4a3 3 0 013 3v5M17 4v5a3 3 0 01-3 3',
  splitH: 'M4 4h16v16H4zM4 12h16',
  splitV: 'M4 4h16v16H4zM12 4v16',
  ban: 'M12 3a9 9 0 100 18 9 9 0 000-18zM5.6 5.6l12.8 12.8',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  layers: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5',
  satellite: 'M13 7l4 4M6 14l-3 3 4 4 3-3M9 11l4-4 4 4-4 4zM15 3a6 6 0 016 6M15 6a3 3 0 013 3',
  wifiOff: 'M3 3l18 18M8.5 16.5a5 5 0 017 0M5 13a10 10 0 015.5-2.8M19 13a10 10 0 00-2.2-1.6M2 9.5a15 15 0 015-2.8M22 9.5A15 15 0 0012 6M12 20h.01',
  arrowLeft: 'M19 12H5M11 6l-6 6 6 6',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  target: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 8a4 4 0 100 8 4 4 0 000-8z',
  wind: 'M3 8h11a3 3 0 10-3-3M3 12h16a3 3 0 11-3 3M3 16h8',
  grid: 'M4 4h16v16H4zM4 10h16M4 15h16M10 4v16M15 4v16',
  compare: 'M8 4v16M16 4v16M3 8h5M16 16h5',
  printer: 'M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z',
}

export type IconName = keyof typeof P

export function Icon({ name, size = 20, className, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...rest}
    >
      <path d={P[name]} />
    </svg>
  )
}
