// Pure shape maths for the drawing tools (no map dependency, unit-tested).
import type { LatLon } from '../../lib/geometry'

const M_PER_DEG = 111320

/** Rectangle between the press point and the release point; `square` forces equal sides in metres. */
export function rectangleFrom(a: { lat: number; lng: number }, b: { lat: number; lng: number }, square: boolean): LatLon[] {
  let lat2 = b.lat
  let lng2 = b.lng
  if (square) {
    const k = Math.cos((a.lat * Math.PI) / 180)
    const side = Math.max(Math.abs(b.lat - a.lat) * M_PER_DEG, Math.abs(b.lng - a.lng) * M_PER_DEG * k)
    lat2 = a.lat + (Math.sign(b.lat - a.lat) || 1) * (side / M_PER_DEG)
    lng2 = a.lng + (Math.sign(b.lng - a.lng) || 1) * (side / (M_PER_DEG * k))
  }
  return [
    [a.lat, a.lng],
    [a.lat, lng2],
    [lat2, lng2],
    [lat2, a.lng],
  ]
}

export function centerOf(pts: LatLon[]): LatLon {
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length]
}

/** Rotates points around a centre by `angle` radians (clockwise), in a local metric frame so shapes are not skewed. */
export function rotatePoints(pts: LatLon[], center: LatLon, angle: number): LatLon[] {
  const k = Math.cos((center[0] * Math.PI) / 180)
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return pts.map(([la, lo]) => {
    const x = (lo - center[1]) * k
    const y = la - center[0]
    return [center[0] - x * sin + y * cos, center[1] + (x * cos + y * sin) / k] as LatLon
  })
}

/** Compass bearing (radians, clockwise from north) from the centre to a point. */
export const bearing = (c: LatLon, lat: number, lng: number) => Math.atan2((lng - c[1]) * Math.cos((c[0] * Math.PI) / 180), lat - c[0])
