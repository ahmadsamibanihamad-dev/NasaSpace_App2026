// Saved parcels as polygons. Each parcel is memoized so selecting/editing one does not redraw the rest.
import { memo, useMemo, useState } from 'react'
import { Polygon as LPolygon, Tooltip, useMapEvents } from 'react-leaflet'
import type { Plot } from '../../lib/types'
import { area as fmtArea } from '../../lib/format'
import { useSettings } from '../../lib/settings'

const LABEL_MIN_ZOOM = 14

const ParcelShape = memo(function ParcelShape({
  plot,
  selected,
  dimmed,
  showLabel,
  fill,
  areaText,
  onSelect,
}: {
  plot: Plot
  selected: boolean
  dimmed: boolean
  showLabel: boolean
  fill: string
  areaText: string
  onSelect?: (id: string) => void
}) {
  const positions = useMemo(() => plot.polygon.coordinates[0].slice(0, -1).map(([lo, la]) => [la, lo] as [number, number]), [plot.polygon])
  return (
    <LPolygon
      positions={positions}
      pathOptions={{
        color: selected ? '#FFFFFF' : fill,
        weight: selected ? 4 : 2,
        fillColor: fill,
        fillOpacity: dimmed ? 0.12 : selected ? 0.6 : 0.4,
        opacity: dimmed ? 0.4 : 1,
        dashArray: undefined,
      }}
      eventHandlers={onSelect ? { click: () => onSelect(plot.id) } : undefined}
      interactive={!!onSelect}
    >
      {showLabel && (
        <Tooltip permanent direction="center" className="plot-label" interactive={false}>
          <b>{plot.label}</b> · {plot.name} · <span dir="ltr">{areaText}</span>
        </Tooltip>
      )}
    </LPolygon>
  )
})

export function ParcelsLayer({
  plots,
  selectedId,
  hiddenId,
  dimOthers,
  colorOf,
  onSelect,
}: {
  plots: Plot[]
  selectedId?: string | null
  /** parcel currently being reshaped (drawn by the draft layer instead) */
  hiddenId?: string | null
  dimOthers?: boolean
  /** override fill colour (e.g. by suitability score) */
  colorOf?: (p: Plot) => string
  onSelect?: (id: string) => void
}) {
  const settings = useSettings() // re-render labels when units change
  const [zoom, setZoom] = useState(15)
  const map = useMapEvents({ zoomend: () => setZoom(map.getZoom()) })
  const labels = Math.max(zoom, map.getZoom()) >= LABEL_MIN_ZOOM || plots.length <= 12
  return (
    <>
      {plots
        .filter((p) => p.id !== hiddenId)
        .map((p) => (
          <ParcelShape
            key={p.id}
            plot={p}
            selected={p.id === selectedId}
            dimmed={!!dimOthers && p.id !== selectedId}
            showLabel={labels}
            fill={colorOf ? colorOf(p) : p.color}
            areaText={fmtArea(p.area_m2, settings.areaUnit)}
            onSelect={onSelect}
          />
        ))}
    </>
  )
}
