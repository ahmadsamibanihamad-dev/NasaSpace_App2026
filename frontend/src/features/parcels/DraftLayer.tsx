// Interactive polygon being drawn or reshaped: click to add vertices, drag to move,
// click a mid-point to insert a vertex, right-click (or long-press) a vertex to remove it.
import { useMemo } from 'react'
import { Marker, Polygon as LPolygon, Polyline, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import type { LatLon } from '../../lib/geometry'

function vertexIcon(kind: 'first' | 'vertex' | 'mid', closable = false) {
  const size = kind === 'mid' ? 12 : kind === 'first' ? 20 : 16
  const bg = kind === 'mid' ? 'rgba(255,255,255,.75)' : kind === 'first' && closable ? '#24753F' : '#fff'
  return L.divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${bg};border:2px solid #24753F;box-shadow:0 0 0 2px rgba(255,255,255,.7)"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

export function DraftLayer({
  points,
  closed,
  color,
  onChange,
  onCommit,
}: {
  points: LatLon[]
  closed: boolean
  color: string
  /** live change while dragging (no undo step) */
  onChange: (pts: LatLon[], closed: boolean) => void
  /** discrete change (adds an undo step) */
  onCommit: (pts: LatLon[], closed: boolean) => void
}) {
  useMapEvents({
    click(e) {
      if (!closed) onCommit([...points, [e.latlng.lat, e.latlng.lng]], false)
    },
    dblclick() {
      if (closed) return
      // a double-click also fires two clicks at the same spot: drop the repeated vertex
      const clean = points.filter((p, i) => i === 0 || Math.abs(p[0] - points[i - 1][0]) > 3e-6 || Math.abs(p[1] - points[i - 1][1]) > 3e-6)
      if (clean.length >= 3) onCommit(clean, true)
    },
  })

  const icons = useMemo(() => ({ first: vertexIcon('first', true), firstIdle: vertexIcon('first'), vertex: vertexIcon('vertex'), mid: vertexIcon('mid') }), [])
  const canClose = !closed && points.length >= 3
  const mids: { pos: LatLon; after: number }[] = closed
    ? points.map((p, i) => {
        const q = points[(i + 1) % points.length]
        return { pos: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] as LatLon, after: i }
      })
    : []

  const moved = (i: number, ll: L.LatLng) => points.map((p, j) => (j === i ? ([ll.lat, ll.lng] as LatLon) : p))
  const removeAt = (i: number) => {
    if (points.length <= (closed ? 3 : 1)) return
    onCommit(points.filter((_, j) => j !== i), closed)
  }

  return (
    <>
      {closed ? (
        <LPolygon positions={points} pathOptions={{ color: '#FFFFFF', weight: 2.5, fillColor: color, fillOpacity: 0.35, dashArray: '6 5' }} interactive={false} />
      ) : (
        points.length > 1 && <Polyline positions={points} pathOptions={{ color: '#FFFFFF', weight: 2.5, dashArray: '6 5' }} interactive={false} />
      )}
      {mids.map((m) => (
        <Marker
          key={`m${m.after}-${m.pos[0]}-${m.pos[1]}`}
          position={m.pos}
          icon={icons.mid}
          draggable
          eventHandlers={{
            click: () => onCommit([...points.slice(0, m.after + 1), m.pos, ...points.slice(m.after + 1)], true),
            dragend: (e) => {
              const ll = (e.target as L.Marker).getLatLng()
              onCommit([...points.slice(0, m.after + 1), [ll.lat, ll.lng], ...points.slice(m.after + 1)], true)
            },
          }}
        />
      ))}
      {points.map((p, i) => (
        <Marker
          key={`v${i}`}
          position={p}
          draggable
          icon={i === 0 ? (canClose ? icons.first : icons.firstIdle) : icons.vertex}
          zIndexOffset={i === 0 ? 500 : 100}
          eventHandlers={{
            click: (e) => {
              L.DomEvent.stopPropagation(e.originalEvent)
              if (i === 0 && canClose) onCommit(points, true)
            },
            contextmenu: (e) => {
              L.DomEvent.preventDefault(e.originalEvent)
              removeAt(i)
            },
            drag: (e) => onChange(moved(i, (e.target as L.Marker).getLatLng()), closed),
            dragend: (e) => onCommit(moved(i, (e.target as L.Marker).getLatLng()), closed),
          }}
        />
      ))}
    </>
  )
}
