import { useEffect, type ReactNode } from 'react'
import { MapContainer, Polygon as LPolygon, TileLayer, useMap, GeoJSON } from 'react-leaflet'
import L, { type LatLngBoundsExpression, type LatLngExpression } from 'leaflet'
import type { Feature, MultiPolygon, Polygon } from 'geojson'
import * as turf from '@turf/turf'
import jordan from '../../data/geo/jordan.json'
import { JORDAN_BOUNDS, JORDAN_CENTER, LABELS_TILE_URL, SATELLITE_ATTRIBUTION, SATELLITE_TILE_URL } from '../../config'

const jordanGeom = (jordan as unknown as { features: Feature<Polygon>[] }).features[0]
export const jordanFeature = jordanGeom
const jordanRing: [number, number][] = jordanGeom.geometry.coordinates[0].map(([x, y]) => [y, x])
const worldRing: [number, number][] = [
  [-89, -179],
  [-89, 179],
  [89, 179],
  [89, -179],
]
const maxBounds = L.latLngBounds(JORDAN_BOUNDS).pad(0.08)

/** Quick client-side hint only; the backend is authoritative. */
export function isInJordanClient(lat: number, lon: number) {
  return turf.booleanPointInPolygon(turf.point([lon, lat]), jordanGeom)
}

function JordanMask() {
  return (
    <>
      <LPolygon positions={[worldRing, jordanRing]} pathOptions={{ stroke: false, fillColor: '#EFEFED', fillOpacity: 0.88, interactive: false }} />
      <LPolygon positions={jordanRing} pathOptions={{ color: '#FFFFFF', weight: 1.5, fill: false, interactive: false, opacity: 0.9 }} />
    </>
  )
}

export function FlyTo({ center, zoom }: { center: LatLngExpression | null; zoom?: number }) {
  const map = useMap()
  useEffect(() => {
    if (center) map.flyTo(center, zoom ?? map.getZoom(), { duration: 1.2 })
  }, [center, zoom, map])
  return null
}

export function FitGeometry({ geometry, padding = 40, maxZoom = 18 }: { geometry: Polygon | MultiPolygon | null | undefined; padding?: number; maxZoom?: number }) {
  const map = useMap()
  const key = geometry ? JSON.stringify(turf.bbox(geometry)) : ''
  useEffect(() => {
    if (!geometry) return
    const [w, s, e, n] = turf.bbox(geometry)
    map.fitBounds(
      [
        [s, w],
        [n, e],
      ],
      { padding: [padding, padding], maxZoom },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return null
}

/** Invalidate size when the container changes (e.g. panels open). */
export function AutoResize() {
  const map = useMap()
  useEffect(() => {
    const el = map.getContainer()
    const ro = new ResizeObserver(() => map.invalidateSize())
    ro.observe(el)
    return () => ro.disconnect()
  }, [map])
  return null
}

export function JordanMap({
  children,
  center = JORDAN_CENTER,
  zoom = 7,
  className = '',
  bounds,
  interactive = true,
}: {
  children?: ReactNode
  center?: LatLngExpression
  zoom?: number
  className?: string
  bounds?: LatLngBoundsExpression
  interactive?: boolean
}) {
  return (
    <MapContainer
      center={center}
      zoom={zoom}
      bounds={bounds}
      minZoom={7}
      maxZoom={19}
      maxBounds={maxBounds}
      maxBoundsViscosity={1}
      className={`w-full h-full ${className}`}
      zoomControl={interactive}
      dragging={interactive}
      scrollWheelZoom={interactive}
      doubleClickZoom={false}
      attributionControl
    >
      <TileLayer url={SATELLITE_TILE_URL} attribution={SATELLITE_ATTRIBUTION} maxNativeZoom={18} maxZoom={19} />
      {LABELS_TILE_URL && <TileLayer url={LABELS_TILE_URL} maxNativeZoom={18} maxZoom={19} />}
      <JordanMask />
      <AutoResize />
      {children}
    </MapContainer>
  )
}

export function BoundaryOutline({ geometry }: { geometry: Polygon }) {
  return <GeoJSON key={JSON.stringify(geometry.coordinates[0][0])} data={geometry} style={{ color: '#FFFFFF', weight: 2, fill: false, dashArray: '6 4' }} interactive={false} />
}

export function pinIcon(pulsing = false) {
  return L.divIcon({
    className: '',
    html: pulsing
      ? '<div class="pulse-marker"></div>'
      : '<svg width="32" height="40" viewBox="0 0 32 40"><path d="M16 39s13-12.5 13-23A13 13 0 003 16c0 10.5 13 23 13 23z" fill="#24753F" stroke="#fff" stroke-width="2"/><circle cx="16" cy="16" r="5" fill="#fff"/></svg>',
    iconSize: pulsing ? [18, 18] : [32, 40],
    iconAnchor: pulsing ? [9, 9] : [16, 39],
  })
}

export function vertexIcon(first = false, closable = false) {
  return L.divIcon({
    className: '',
    html: `<div style="width:${first ? 16 : 12}px;height:${first ? 16 : 12}px;border-radius:9999px;background:${first && closable ? '#24753F' : '#fff'};border:2px solid #24753F;box-shadow:0 0 0 2px rgba(255,255,255,.6)"></div>`,
    iconSize: first ? [16, 16] : [12, 12],
    iconAnchor: first ? [8, 8] : [6, 6],
  })
}
