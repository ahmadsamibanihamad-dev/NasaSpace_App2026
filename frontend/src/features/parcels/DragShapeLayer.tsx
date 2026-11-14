// Drag-to-draw: press on the map, drag, release → a rectangle (or a true square in metres).
// Works with mouse, touch and pen (pointer events). Map panning is paused while this tool is active.
import { useEffect, useRef, useState } from 'react'
import { Polygon as LPolygon, useMap } from 'react-leaflet'
import type L from 'leaflet'
import type { LatLon } from '../../lib/geometry'
import { rectangleFrom } from './shapeMath'

const MIN_DRAG_PX = 12

export function DragShapeLayer({ square, color, onDone, onTooSmall }: { square: boolean; color: string; onDone: (pts: LatLon[]) => void; onTooSmall: () => void }) {
  const map = useMap()
  const [box, setBox] = useState<LatLon[] | null>(null)
  const cb = useRef({ onDone, onTooSmall })
  cb.current = { onDone, onTooSmall }

  useEffect(() => {
    const el = map.getContainer()
    const wasDragging = map.dragging.enabled()
    map.dragging.disable()
    el.classList.add('drawing-shape')
    let start: L.LatLng | null = null
    let startPt: L.Point | null = null
    let current: LatLon[] | null = null

    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      // ignore presses on buttons / search box / attribution that sit above the map
      if ((e.target as HTMLElement).closest('button, input, a, .leaflet-control')) return
      start = map.mouseEventToLatLng(e)
      startPt = map.mouseEventToContainerPoint(e)
      current = null
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        /* not supported: dragging still works while the pointer stays over the map */
      }
      e.preventDefault()
    }
    const move = (e: PointerEvent) => {
      if (!start) return
      current = rectangleFrom(start, map.mouseEventToLatLng(e), square)
      setBox(current)
    }
    const up = (e: PointerEvent) => {
      if (!start || !startPt) return
      const moved = startPt.distanceTo(map.mouseEventToContainerPoint(e))
      const pts = current
      start = null
      startPt = null
      current = null
      setBox(null)
      if (pts && moved >= MIN_DRAG_PX) cb.current.onDone(pts)
      else cb.current.onTooSmall()
    }
    const cancel = () => {
      start = null
      current = null
      setBox(null)
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', cancel)
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', cancel)
      el.classList.remove('drawing-shape')
      if (wasDragging) map.dragging.enable()
    }
  }, [map, square])

  return box ? <LPolygon positions={box} pathOptions={{ color: '#FFFFFF', weight: 2.5, fillColor: color, fillOpacity: 0.35, dashArray: '6 5' }} interactive={false} /> : null
}
