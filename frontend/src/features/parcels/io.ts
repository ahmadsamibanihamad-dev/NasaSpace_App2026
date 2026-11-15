// Export parcels to CSV / GeoJSON and read parcels back from GeoJSON.
import type { Feature, FeatureCollection, Polygon } from 'geojson'
import type { Farm, Plot, PlotDraft, PlotStatus } from '../../lib/types'
import { centroidOf, fromPolygon, validateRing } from '../../lib/geometry'
import { getSettings } from '../../lib/settings'

export const PARCEL_COLORS = ['#2F8F4E', '#7FC190', '#134324', '#2F7FD1', '#E8892B', '#D64533', '#6B706B', '#B0D9BB']
const STATUSES: PlotStatus[] = ['planted', 'fallow', 'preparing', 'unused']

export function emptyDraft(polygon: Polygon, label: string, index = 0): PlotDraft {
  return {
    label,
    name: '',
    region: '',
    polygon,
    color: PARCEL_COLORS[index % PARCEL_COLORS.length],
    status: 'fallow',
    notes: '',
    owner_name: '',
    owner_phone: '',
    current_crop_id: null,
    previous_crop_id: null,
    irrigation_available: false,
    irrigation_method: 'none',
    soil_type: null,
    soil_ph: null,
    soil_lab: null,
  }
}

export function toGeoJSON(farm: Farm, plots: Plot[]): FeatureCollection<Polygon> {
  return {
    type: 'FeatureCollection',
    features: plots.map((p) => ({
      type: 'Feature',
      geometry: p.polygon,
      properties: {
        farm: farm.name,
        number: p.label,
        name: p.name,
        region: p.region,
        crop: p.current_crop_id,
        previous_crop: p.previous_crop_id,
        status: p.status,
        color: p.color,
        notes: p.notes,
        owner_name: p.owner_name,
        owner_phone: p.owner_phone,
        irrigation_available: p.irrigation_available,
        irrigation_method: p.irrigation_method,
        soil_type: p.soil_type,
        soil_ph: p.soil_ph,
        area_m2: Math.round(p.area_m2 * 10) / 10,
        perimeter_m: Math.round(p.perimeter_m * 10) / 10,
      },
    })),
  }
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCSV(farm: Farm, plots: Plot[]): string {
  const dunum = getSettings().dunumM2
  const head = ['farm', 'number', 'name', 'region', 'crop', 'status', 'area_m2', `area_dunum(${dunum}m2)`, 'area_hectare', 'perimeter_m', 'centroid_lat', 'centroid_lon', 'owner_name', 'owner_phone', 'notes', 'coordinates_lat_lon']
  const rows = plots.map((p) => {
    const c = centroidOf(p.polygon)
    return [
      farm.name,
      p.label,
      p.name,
      p.region,
      p.current_crop_id ?? '',
      p.status,
      p.area_m2.toFixed(1),
      (p.area_m2 / dunum).toFixed(3),
      (p.area_m2 / 10000).toFixed(4),
      p.perimeter_m.toFixed(1),
      c.lat.toFixed(6),
      c.lon.toFixed(6),
      p.owner_name,
      p.owner_phone,
      p.notes,
      fromPolygon(p.polygon).map(([la, lo]) => `${la.toFixed(6)} ${lo.toFixed(6)}`).join(' | '),
    ]
      .map(csvCell)
      .join(',')
  })
  return '﻿' + [head.join(','), ...rows].join('\r\n') // BOM so Excel reads Arabic correctly
}

export function download(filename: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export interface ImportResult {
  drafts: PlotDraft[]
  skipped: number
}

/** Accepts a FeatureCollection / Feature / Polygon / MultiPolygon. Invalid or non-Jordan shapes are skipped and counted. */
export function parseGeoJSON(text: string, crops: readonly string[], startNumber: number): ImportResult {
  const data = JSON.parse(text)
  const feats: Feature[] = data?.type === 'FeatureCollection' ? data.features ?? [] : data?.type === 'Feature' ? [data] : data?.type ? [{ type: 'Feature', geometry: data, properties: {} }] : []
  const drafts: PlotDraft[] = []
  let skipped = 0
  let n = startNumber
  for (const f of feats) {
    const g = f?.geometry
    const polys: Polygon[] = g?.type === 'Polygon' ? [g] : g?.type === 'MultiPolygon' ? g.coordinates.map((c) => ({ type: 'Polygon', coordinates: c })) : []
    if (!polys.length) {
      skipped++
      continue
    }
    for (const poly of polys) {
      let pts
      try {
        pts = fromPolygon({ type: 'Polygon', coordinates: [poly.coordinates[0].map((c) => [Number(c[0]), Number(c[1])])] })
      } catch {
        skipped++
        continue
      }
      if (validateRing(pts).length) {
        skipped++
        continue
      }
      const pr = (f.properties ?? {}) as Record<string, unknown>
      const str = (k: string) => (typeof pr[k] === 'string' ? (pr[k] as string).slice(0, 200) : '')
      const ring = pts.map(([la, lo]) => [lo, la])
      ring.push([...ring[0]])
      const d = emptyDraft({ type: 'Polygon', coordinates: [ring] }, String(n), n - 1)
      d.name = str('name') || `${n}`
      d.region = str('region')
      d.notes = str('notes')
      d.owner_name = str('owner_name')
      d.owner_phone = str('owner_phone')
      if (typeof pr.color === 'string' && PARCEL_COLORS.includes(pr.color)) d.color = pr.color
      if (STATUSES.includes(pr.status as PlotStatus)) d.status = pr.status as PlotStatus
      if (typeof pr.crop === 'string' && crops.includes(pr.crop)) d.current_crop_id = pr.crop
      drafts.push(d)
      n++
    }
  }
  return { drafts, skipped }
}
