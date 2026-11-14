// Single place for the product name and app-wide constants.
export const APP_NAME = { en: 'Ardna', ar: 'أرضنا' } as const

export const DUNUM_M2 = 1000
export const HECTARE_M2 = 10000
export const MIN_PLOT_DUNUM = 0.25

export const JORDAN_BOUNDS: [[number, number], [number, number]] = [
  [29.0, 34.8],
  [33.5, 39.4],
]
export const JORDAN_CENTER: [number, number] = [31.25, 36.6]

export const SATELLITE_TILE_URL =
  import.meta.env.VITE_SATELLITE_TILE_URL ||
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
export const SATELLITE_ATTRIBUTION =
  import.meta.env.VITE_SATELLITE_ATTRIBUTION ||
  'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
export const LABELS_TILE_URL: string = import.meta.env.VITE_LABELS_TILE_URL || ''
