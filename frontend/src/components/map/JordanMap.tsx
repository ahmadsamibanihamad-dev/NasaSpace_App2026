import { useEffect, useRef, useState, type ReactNode } from 'react'
import { MapContainer, Polygon as LPolygon, ScaleControl, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import L, { type LatLngBoundsExpression, type LatLngExpression } from 'leaflet'
import type { Feature, Polygon } from 'geojson'
import { useTranslation } from 'react-i18next'
import jordan from '../../data/geo/jordan.json'
import { JORDAN_BOUNDS, JORDAN_CENTER } from '../../config'
import { activeTileSource, useSettings } from '../../lib/settings'
import { Icon, type IconName } from '../ui/Icon'

const jordanGeom = (jordan as unknown as { features: Feature<Polygon>[] }).features[0]
const jordanRing: [number, number][] = jordanGeom.geometry.coordinates[0].map(([x, y]) => [y, x])
const worldRing: [number, number][] = [
  [-89, -179],
  [-89, 179],
  [89, 179],
  [89, -179],
]
const maxBounds = L.latLngBounds(JORDAN_BOUNDS).pad(0.08)

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
    if (center) map.flyTo(center, zoom ?? map.getZoom(), { duration: 1.1 })
  }, [center, zoom, map])
  return null
}

/** Fits the map to bounds whenever `token` changes. */
export function FitBounds({ bounds, token, maxZoom = 18 }: { bounds: [[number, number], [number, number]] | null; token: unknown; maxZoom?: number }) {
  const map = useMap()
  useEffect(() => {
    if (bounds) map.fitBounds(bounds, { padding: [48, 48], maxZoom })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])
  return null
}

function AutoResize() {
  const map = useMap()
  useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize())
    ro.observe(map.getContainer())
    return () => ro.disconnect()
  }, [map])
  return null
}

/** Small card with the pointer coordinates (updates only its own state, not the parent tree). */
function CursorCoords() {
  const { t } = useTranslation()
  const [ll, setLl] = useState<{ lat: number; lng: number } | null>(null)
  const map = useMapEvents({
    mousemove: (e) => setLl(e.latlng),
    move: () => setLl((p) => p ?? map.getCenter()),
  })
  const p = ll ?? map.getCenter()
  return (
    <div className="absolute bottom-3 start-3 z-[1000] bg-surface/95 rounded-pill px-3 h-8 flex items-center gap-2 text-caption shadow-soft pointer-events-none" aria-live="off">
      <Icon name="target" size={14} className="text-green-600" />
      <span className="text-text-secondary hidden sm:inline">{t('map.cursor')}</span>
      <span dir="ltr" className="tabular-nums font-semibold">
        {p.lat.toFixed(5)}, {p.lng.toFixed(5)}
      </span>
    </div>
  )
}

function CtlButton({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="size-10 rounded-pill bg-surface border border-border text-text-primary flex items-center justify-center shadow-soft hover:bg-surface-muted active:bg-green-50"
    >
      <Icon name={icon} size={18} />
    </button>
  )
}

/** Zoom in/out, go to my location, fit to farm. */
export function MapControls({ onFit, onLocated, onLocateError }: { onFit?: () => void; onLocated?: (lat: number, lon: number) => void; onLocateError?: () => void }) {
  const map = useMap()
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // Buttons sit above the map: clicks must not add drawing vertices or pan the map.
    if (ref.current) {
      L.DomEvent.disableClickPropagation(ref.current)
      L.DomEvent.disableScrollPropagation(ref.current)
    }
  }, [])
  const locate = () => {
    if (!('geolocation' in navigator)) return onLocateError?.()
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lon } = pos.coords
        if (onLocated) onLocated(lat, lon)
        else map.flyTo([lat, lon], 17)
      },
      () => onLocateError?.(),
      { enableHighAccuracy: true, timeout: 12000 },
    )
  }
  return (
    <div ref={ref} className="absolute top-3 end-3 z-[1000] flex flex-col gap-2">
      <CtlButton icon="plus" label={t('map.zoomIn')} onClick={() => map.zoomIn()} />
      <CtlButton icon="minus" label={t('map.zoomOut')} onClick={() => map.zoomOut()} />
      <CtlButton icon="locate" label={t('map.myLocation')} onClick={locate} />
      {onFit && <CtlButton icon="farm" label={t('map.fitFarm')} onClick={onFit} />}
    </div>
  )
}

export function JordanMap({
  children,
  center = JORDAN_CENTER,
  zoom = 7,
  className = '',
  bounds,
  interactive = true,
  showCoords = false,
}: {
  children?: ReactNode
  center?: LatLngExpression
  zoom?: number
  className?: string
  bounds?: LatLngBoundsExpression
  interactive?: boolean
  showCoords?: boolean
}) {
  const settings = useSettings()
  const src = activeTileSource(settings)
  return (
    <MapContainer
      center={center}
      zoom={zoom}
      bounds={bounds}
      minZoom={7}
      maxZoom={20}
      maxBounds={maxBounds}
      maxBoundsViscosity={1}
      className={`w-full h-full ${className}`}
      zoomControl={false}
      dragging={interactive}
      scrollWheelZoom={interactive}
      touchZoom={interactive}
      keyboard={interactive}
      doubleClickZoom={false}
      attributionControl
    >
      <TileLayer key={src.id + src.url} url={src.url} attribution={src.attribution} maxNativeZoom={src.maxNativeZoom} maxZoom={20} />
      <JordanMask />
      <AutoResize />
      {showCoords && <CursorCoords />}
      {showCoords && <ScaleControl position="bottomright" imperial={false} />}
      {children}
    </MapContainer>
  )
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
