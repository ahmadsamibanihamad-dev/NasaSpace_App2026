// Simple line illustrations for the 13 supported crops (original SVG, brand greens only).
const PATHS: Record<string, string> = {
  wheat: 'M12 21V6M12 8c-2-1-3-3-3-5 2 1 3 3 3 5zM12 8c2-1 3-3 3-5-2 1-3 3-3 5zM12 12c-2-1-3-3-3-5 2 1 3 3 3 5zM12 12c2-1 3-3 3-5-2 1-3 3-3 5zM12 16c-2-1-3-3-3-5 2 1 3 3 3 5zM12 16c2-1 3-3 3-5-2 1-3 3-3 5z',
  barley: 'M12 21V7M12 9l-3-2M12 9l3-2M12 12l-3-2M12 12l3-2M12 15l-3-2M12 15l3-2M9 7l-2-4M15 7l2-4M12 7V2',
  lentil: 'M5 14c2-5 12-7 14-4-1 4-11 7-14 4zM9 12.5a1 1 0 100 .1M12.5 11.5a1 1 0 100 .1M16 11a1 1 0 100 .1M19 10l2-2',
  chickpea: 'M7 13a5 5 0 1010 0 5 5 0 00-10 0zM12 8c0-2 1-4 3-5M10.5 12a1.5 1.5 0 103 0',
  vetch: 'M12 21V8M12 12c-3 0-5-2-5-4 3 0 5 2 5 4zM12 16c3 0 5-2 5-4-3 0-5 2-5 4zM12 8c0-3 2-5 4-5M12 8c-1-2-3-3-5-3',
  tomato: 'M5 13a7 7 0 1014 0 7 7 0 00-14 0zM12 6V3M9 6.5l3 1.5 3-1.5M10 7l-2-1M14 7l2-1',
  cucumber: 'M4 16c3-8 12-12 16-9 1 4-6 13-14 11-1.5-.4-2.3-1-2-2zM9 13h.01M12 11h.01M14 13h.01',
  potato: 'M5 12c0-4 4-6 8-6s6 3 6 6-3 6-7 6-7-2-7-6zM10 10h.01M14 12h.01M11 14h.01',
  onion: 'M12 4c0 3 6 5 6 10a6 6 0 01-12 0c0-5 6-7 6-10zM12 4V2M9 20.5l-1 1.5M15 20.5l1 1.5M12 9v10',
  eggplant: 'M14 7c4 2 5 8 1 12s-9 1-8-3 3-5 4-7c.5-1.3 1.6-2.4 3-2zM14 7l2-3M12 7.5c1-.8 3-.8 4 0',
  olive: 'M3 20c5-2 9-7 11-14M8 15c-2 0-3-1-3-3 2 0 3 1 3 3zM11 11c2 0 3-1 3-3-2 0-3 1-3 3zM15 13a2 2.8 30 104 0 2 2.8 30 10-4 0zM18 7a2 2.8 30 103 0 2 2.8 30 10-3 0z',
  date_palm: 'M12 21V9M12 9c-2-3-6-3-8-1M12 9c2-3 6-3 8-1M12 9c-1-3-4-5-6-5M12 9c1-3 4-5 6-5M12 9c0-3 0-5 0-6M10 12h.01M14 12h.01M12 13h.01',
  citrus: 'M5 13a7 7 0 1014 0 7 7 0 00-14 0zM12 6v14M5.5 10l13 6M5.5 16l13-6M12 6c1-2 3-3 5-3-1 2-3 3-5 3z',
  radish: 'M12 9c3 0 5 2 5 5s-2 5-5 8c-3-3-5-5-5-8s2-5 5-5zM12 9V6M12 6c-2 0-4-1-4-4M12 6c2 0 4-1 4-4M12 6V2',
  arugula: 'M12 21V5M12 5c1-2 3-2 3 0s-1 3-3 3M12 5c-1-2-3-2-3 0s1 3 3 3M12 11c2-1 5-1 5 1s-3 3-5 2M12 11c-2-1-5-1-5 1s3 3 5 2M12 16c1 0 3 0 3 2M12 16c-1 0-3 0-3 2',
  spinach: 'M12 21v-6M12 15c-5 0-7-4-6-10 5 0 8 3 6 10zM12 15c5 0 7-4 6-10-3 0-5 1-6 3M9 9l3 4',
  carrot: 'M9 9l6 6c-1 3-5 6-10 6 0-5 1-9 4-12zM13 9l4-5M15 11l5-3M12 8l1-5M8 14l2 2M7 17l2 1',
  beet: 'M12 8c4 0 6 3 6 6s-3 5-6 7c-3-2-6-4-6-7s2-6 6-6zM12 8V4M12 5c-2-1-3-2-3-3M12 5c2-1 3-2 3-3M9 13c1 2 4 2 6 0',
  bush_bean: 'M6 5c4 0 8 3 9 8s3 6 4 6c-5 1-9-2-10-7S7 6 6 5zM10 9h.01M12 12.5h.01M14 16h.01M6 5L4 3',
  fallow: 'M3 18h18M5 15h3M10 15h4M16 15h3M4 21h16',
}

export function CropIcon({ crop, size = 40, className }: { crop: string | null | undefined; size?: number; className?: string }) {
  const d = PATHS[crop || 'fallow'] || PATHS.fallow
  return (
    <span className={`inline-flex items-center justify-center rounded-pill bg-green-50 text-green-700 shrink-0 ${className ?? ''}`} style={{ width: size, height: size }} aria-hidden>
      <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <path d={d} />
      </svg>
    </span>
  )
}
