/**
 * Parcel geometry: area, perimeter, validation, coordinate parsing and Jordan checks.
 * Pure functions (unit-tested), independent from the map UI and from storage.
 */
import * as turf from '@turf/turf'
import type { Feature, Polygon } from 'geojson'
import jordan from '../data/geo/jordan.json'
import governorates from '../data/geo/governorates.json'
import type { Governorate } from './types'

export type LatLon = [number, number] // [lat, lon]

const jordanFeature = (jordan as unknown as { features: Feature<Polygon>[] }).features[0]
type GovProps = { id: string; name_ar: string; name_en: string }
const govFeatures = (governorates as unknown as { features: Feature<Polygon, GovProps>[] }).features

export const MIN_PARCEL_M2 = 10 // anything smaller is almost certainly a drawing mistake

export function insideJordan(lat: number, lon: number): boolean {
  return turf.booleanPointInPolygon(turf.point([lon, lat]), jordanFeature)
}

/** Governorate by local point-in-polygon (no external geocoder). */
export function governorateFor(lat: number, lon: number): Governorate | null {
  if (!insideJordan(lat, lon)) return null
  const pt = turf.point([lon, lat])
  const hit = govFeatures.find((f) => turf.booleanPointInPolygon(pt, f))
  if (hit) return { ...hit.properties }
  // Country and governorate outlines come from different sources and differ slightly at the edges.
  let best: { d: number; g: GovProps } | null = null
  for (const f of govFeatures) {
    const d = turf.pointToLineDistance(pt, turf.polygonToLine(f) as Feature<GeoJSON.LineString>)
    if (!best || d < best.d) best = { d, g: f.properties }
  }
  return best ? { ...best.g } : null
}

export function toPolygon(pts: LatLon[]): Polygon | null {
  if (pts.length < 3) return null
  const ring = pts.map(([la, lo]) => [lo, la])
  ring.push([...ring[0]])
  return { type: 'Polygon', coordinates: [ring] }
}

export function fromPolygon(poly: Polygon): LatLon[] {
  return poly.coordinates[0].slice(0, -1).map(([lo, la]) => [la, lo])
}

export function areaM2(poly: Polygon | null): number {
  return poly ? turf.area(poly) : 0
}

export function perimeterM(poly: Polygon | null): number {
  if (!poly) return 0
  return turf.length(turf.lineString(poly.coordinates[0]), { units: 'meters' })
}

export function centroidOf(poly: Polygon): { lat: number; lon: number } {
  const c = turf.centroid(poly).geometry.coordinates
  return { lat: c[1], lon: c[0] }
}

export type GeometryIssue = 'too_few_points' | 'invalid_number' | 'out_of_range' | 'duplicate_points' | 'self_intersecting' | 'too_small' | 'outside_jordan' | 'overlaps_parcel'

// Two parcels may share a border, and hand-drawn neighbours overlap by slivers. A boundary is refused when the
// shared area exceeds this share of the smaller parcel. Same value as the backend (services/geo.py).
export const MAX_OVERLAP_SHARE = 0.02

/** The number of the first parcel this boundary overlaps beyond the tolerance, or null. The backend repeats the check. */
export function overlappingParcel(poly: Polygon, others: { id: string; label: string; polygon: Polygon }[], selfId?: string | null): string | null {
  const a = turf.polygon(poly.coordinates)
  const areaA = turf.area(a)
  for (const o of others) {
    if (o.id === selfId) continue
    try {
      const b = turf.polygon(o.polygon.coordinates)
      const shared = turf.intersect(turf.featureCollection([a, b]))
      if (shared && turf.area(shared) / Math.min(areaA, turf.area(b)) > MAX_OVERLAP_SHARE) return o.label
    } catch {
      /* a shape turf cannot intersect is left to the backend */
    }
  }
  return null
}

/** Returns every reason a ring cannot be saved; empty array = valid. */
export function validateRing(pts: LatLon[]): GeometryIssue[] {
  const issues: GeometryIssue[] = []
  if (pts.some(([la, lo]) => !Number.isFinite(la) || !Number.isFinite(lo))) return ['invalid_number']
  if (pts.some(([la, lo]) => la < -90 || la > 90 || lo < -180 || lo > 180)) return ['out_of_range']
  const distinct = new Set(pts.map(([la, lo]) => `${la.toFixed(7)},${lo.toFixed(7)}`))
  if (distinct.size < 3) return ['too_few_points']
  if (distinct.size !== pts.length) issues.push('duplicate_points')
  const poly = toPolygon(pts)!
  if (!issues.length && turf.kinks(turf.polygon(poly.coordinates)).features.length > 0) issues.push('self_intersecting')
  if (!issues.length && areaM2(poly) < MIN_PARCEL_M2) issues.push('too_small')
  if (pts.some(([la, lo]) => !insideJordan(la, lo))) issues.push('outside_jordan')
  return issues
}

/**
 * Parses free text coordinates, one point per line: "lat, lon" (also accepts space / ; / tab,
 * Arabic digits and the Arabic comma). Returns points and per-line errors.
 */
export function parseCoordinates(text: string): { points: LatLon[]; errors: { line: number; reason: 'format' | 'range' }[] } {
  const points: LatLon[] = []
  const errors: { line: number; reason: 'format' | 'range' }[] = []
  const western = text.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/٫/g, '.')
  western.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim()
    if (!line) return
    const parts = line.split(/[\s,;،]+/).filter(Boolean)
    if (parts.length !== 2 || parts.some((p) => !/^[-+]?\d+(\.\d+)?$/.test(p))) {
      errors.push({ line: i + 1, reason: 'format' })
      return
    }
    const la = parseFloat(parts[0])
    const lo = parseFloat(parts[1])
    if (la < -90 || la > 90 || lo < -180 || lo > 180) {
      errors.push({ line: i + 1, reason: 'range' })
      return
    }
    points.push([la, lo])
  })
  return { points, errors }
}

/** "32.55, 35.84" typed in a search box → coordinates, else null. */
export function parseLatLonQuery(q: string): { lat: number; lon: number } | null {
  const r = parseCoordinates(q.trim())
  if (r.points.length === 1 && r.errors.length === 0) return { lat: r.points[0][0], lon: r.points[0][1] }
  return null
}

export function formatCoordinates(pts: LatLon[]): string {
  return pts.map(([la, lo]) => `${la.toFixed(6)}, ${lo.toFixed(6)}`).join('\n')
}

export function boundsOf(polys: Polygon[]): [[number, number], [number, number]] | null {
  if (!polys.length) return null
  const [w, s, e, n] = turf.bbox(turf.featureCollection(polys.map((p) => turf.polygon(p.coordinates))))
  return [
    [s, w],
    [n, e],
  ]
}
