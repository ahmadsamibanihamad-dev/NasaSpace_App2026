// App settings kept in the browser (units, dunum conversion, basemap source).
import { useSyncExternalStore } from 'react'

export type AreaUnit = 'dunum' | 'hectare' | 'm2'

export interface TileSource {
  id: string
  name: { ar: string; en: string }
  url: string
  attribution: string
  maxNativeZoom: number
}

// No API keys here: only key-less public tile services. A custom XYZ URL can be set in Settings
// or with VITE_SATELLITE_TILE_URL at build time.
export const TILE_SOURCES: TileSource[] = [
  {
    id: 'esri',
    name: { ar: 'صور فضائية (Esri World Imagery)', en: 'Satellite (Esri World Imagery)' },
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    maxNativeZoom: 18,
  },
  {
    id: 'osm',
    name: { ar: 'خريطة شوارع (OpenStreetMap)', en: 'Street map (OpenStreetMap)' },
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxNativeZoom: 19,
  },
]

export interface Settings {
  areaUnit: AreaUnit
  /** Square metres in one dunum. 1000 m² is the metric dunum used in Jordan; adjustable per region. */
  dunumM2: number
  tileSourceId: string
  customTileUrl: string
  customTileAttribution: string
  notifyRisks: boolean
  notifyAnalyses: boolean
}

const ENV_URL: string = import.meta.env?.VITE_SATELLITE_TILE_URL || ''
const ENV_ATTR: string = import.meta.env?.VITE_SATELLITE_ATTRIBUTION || ''

export const DEFAULT_SETTINGS: Settings = {
  areaUnit: 'dunum',
  dunumM2: 1000,
  tileSourceId: ENV_URL ? 'custom' : 'esri',
  customTileUrl: ENV_URL,
  customTileAttribution: ENV_ATTR,
  notifyRisks: true,
  notifyAnalyses: true,
}

const KEY = 'ardna.v1.settings'
let cache: Settings | null = null
const listeners = new Set<() => void>()

function read(): Settings {
  if (cache) return cache
  let stored: Partial<Settings> = {}
  try {
    stored = JSON.parse(localStorage.getItem(KEY) || '{}')
  } catch {
    stored = {}
  }
  cache = { ...DEFAULT_SETTINGS, ...stored }
  if (!(cache.dunumM2 > 0)) cache.dunumM2 = DEFAULT_SETTINGS.dunumM2
  return cache
}

export function getSettings(): Settings {
  return read()
}

export function updateSettings(patch: Partial<Settings>) {
  cache = { ...read(), ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(cache))
  } catch {
    /* settings stay in memory for this session */
  }
  listeners.forEach((l) => l())
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    read,
    read,
  )
}

export function activeTileSource(s: Settings = read()): TileSource {
  if (s.tileSourceId === 'custom' && /^https?:\/\/.+\{z\}.+/.test(s.customTileUrl)) {
    return { id: 'custom', name: { ar: 'مصدر مخصص', en: 'Custom source' }, url: s.customTileUrl, attribution: s.customTileAttribution || '', maxNativeZoom: 18 }
  }
  return TILE_SOURCES.find((t) => t.id === s.tileSourceId) ?? TILE_SOURCES[0]
}
