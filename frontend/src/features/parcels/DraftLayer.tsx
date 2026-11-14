// Interactive polygon being drawn or reshaped.
//  - corner handles: drag to move a corner; right-click (or long-press) removes it
//  - small mid-edge handles: click or drag to add a corner there
//  - centre handle: drag to move the whole shape
//  - rotate handle (above the shape): drag to rotate around the centre
//  - "points" tool only: click the map to add corners one by one
import { useMemo, useRef, useState } from 'react'
import { Marker, Polygon as LPolygon, Polyline, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import type { LatLon } from '../../lib/geometry'
import { bearing, centerOf, rotatePoints } from './shapeMath'

function dot(kind: 'first' | 'vertex' | 'mid', closable = false) {
  const size = kind === 'mid' ? 12 : kind === 'first' ? 20 : 16
  const bg = kind === 'mid' ? 'rgba(255,255,255,.75)' : kind === 'first' && closable ? '#24753F' : '#fff'
  return L.divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${bg};border:2px solid #24753F;box-shadow:0 0 0 2px rgba(255,255,255,.7)"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

function toolIcon(path: string, cursor: string) {
  return L.divIcon({
    className: '',
    html: `<div style="width:30px;height:30px;border-radius:9999px;background:#24753F;border:2px solid #fff;display:flex;align-items:center;justify-content:center;cursor:${cursor};box-shadow:0 2px 8px rgba(0,0,0,.25)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  })
}
const MOVE_PATH = 'M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3'
const ROTATE_PATH = 'M20 12a8 8 0 11-3-6.2M20 4v5h-5'

export function DraftLayer({
  points,
  closed,
  color,
  clickToAdd = true,
  moveLabel,
  rotateLabel,
  onChange,
  onCommit,
}: {
  points: LatLon[]
  closed: boolean
  color: string
  /** add a corner on every map click while the shape is open (the "points" tool) */
  clickToAdd?: boolean
  moveLabel?: string
  rotateLabel?: string
  /** live change while dragging (no undo step) */
  onChange: (pts: LatLon[], closed: boolean) => void
  /** discrete change (adds an undo step) */
  onCommit: (pts: LatLon[], closed: boolean) => void
}) {
  useMapEvents({
    click(e) {
      if (!closed && clickToAdd) onCommit([...points, [e.latlng.lat, e.latlng.lng]], false)
    },
    dblclick() {
      if (closed || !clickToAdd) return
      // a double-click also fires two clicks at the same spot: drop the repeated vertex
      const clean = points.filter((p, i) => i === 0 || Math.abs(p[0] - points[i - 1][0]) > 3e-6 || Math.abs(p[1] - points[i - 1][1]) > 3e-6)
      if (clean.length >= 3) onCommit(clean, true)
    },
  })

  const icons = useMemo(() => ({ first: dot('first', true), firstIdle: dot('first'), vertex: dot('vertex'), mid: dot('mid'), move: toolIcon(MOVE_PATH, 'move'), rotate: toolIcon(ROTATE_PATH, 'grab') }), [])
  // state captured when a whole-shape drag starts
  const grab = useRef<{ pts: LatLon[]; center: LatLon; angle: number } | null>(null)
  // while rotating, the handle follows the pointer instead of snapping back above the shape
  const [rotHandle, setRotHandle] = useState<LatLon | null>(null)

  const canClose = !closed && clickToAdd && points.length >= 3
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

  const center = closed && points.length >= 3 ? centerOf(points) : null
  // rotate handle sits a little above the northernmost corner, on the centre's meridian
  const north = center ? Math.max(...points.map((p) => p[0])) : 0
  const south = center ? Math.min(...points.map((p) => p[0])) : 0
  const rotatePos: LatLon | null = center ? [north + Math.max((north - south) * 0.18, 0.00004), center[1]] : null

  const translate = (ll: L.LatLng): LatLon[] => {
    const g = grab.current!
    return g.pts.map(([la, lo]) => [la + (ll.lat - g.center[0]), lo + (ll.lng - g.center[1])] as LatLon)
  }
  const rotate = (ll: L.LatLng): LatLon[] => {
    const g = grab.current!
    return rotatePoints(g.pts, g.center, bearing(g.center, ll.lat, ll.lng) - g.angle)
  }

  return (
    <>
      {closed ? (
        <LPolygon positions={points} pathOptions={{ color: '#FFFFFF', weight: 2.5, fillColor: color, fillOpacity: 0.35, dashArray: '6 5' }} interactive={false} />
      ) : (
        points.length > 1 && <Polyline positions={points} pathOptions={{ color: '#FFFFFF', weight: 2.5, dashArray: '6 5' }} interactive={false} />
      )}
      {center && rotatePos && <Polyline positions={[center, rotHandle ?? rotatePos]} pathOptions={{ color: '#FFFFFF', weight: 1.5, dashArray: '3 4', opacity: 0.8 }} interactive={false} />}

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

      {center && (
        <Marker
          key="move"
          position={center}
          icon={icons.move}
          draggable
          zIndexOffset={800}
          title={moveLabel}
          alt={moveLabel}
          eventHandlers={{
            dragstart: () => (grab.current = { pts: points, center, angle: 0 }),
            drag: (e) => grab.current && onChange(translate((e.target as L.Marker).getLatLng()), true),
            dragend: (e) => {
              if (grab.current) onCommit(translate((e.target as L.Marker).getLatLng()), true)
              grab.current = null
            },
          }}
        />
      )}
      {center && rotatePos && (
        <Marker
          key="rotate"
          position={rotHandle ?? rotatePos}
          icon={icons.rotate}
          draggable
          zIndexOffset={800}
          title={rotateLabel}
          alt={rotateLabel}
          eventHandlers={{
            dragstart: () => (grab.current = { pts: points, center, angle: bearing(center, rotatePos[0], rotatePos[1]) }),
            drag: (e) => {
              if (!grab.current) return
              const ll = (e.target as L.Marker).getLatLng()
              setRotHandle([ll.lat, ll.lng])
              onChange(rotate(ll), true)
            },
            dragend: (e) => {
              if (grab.current) onCommit(rotate((e.target as L.Marker).getLatLng()), true)
              grab.current = null
              setRotHandle(null)
            },
          }}
        />
      )}
    </>
  )
}
