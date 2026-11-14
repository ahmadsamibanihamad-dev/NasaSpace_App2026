// Demo farm (clearly flagged is_demo): مزرعة الحصن, Irbid, ~25 dunum, six parcels with crop history.
import type { Polygon } from 'geojson'
import { emptyDraft, PARCEL_COLORS } from '../../features/parcels/io'
import * as repo from './repo'

const LAT = 32.5568
const LON = 35.8469
const CELL_LAT = 0.000535 // ≈ 59.5 m north–south
const CELL_LON = 0.000746 // ≈ 70 m east–west at this latitude

const PLOTS: { label: string; crop: string | null; history: (string | null)[]; irrigated?: boolean }[] = [
  { label: 'A1', crop: 'wheat', history: ['wheat', 'lentil', 'wheat'] },
  { label: 'A2', crop: 'wheat', history: ['barley', 'wheat', 'wheat'] },
  { label: 'A3', crop: 'barley', history: ['chickpea', 'wheat', 'barley'] },
  { label: 'B1', crop: 'lentil', history: ['wheat', 'barley', 'lentil'] },
  { label: 'B2', crop: null, history: ['wheat', null, null] },
  { label: 'B3', crop: 'tomato', history: ['cucumber', 'tomato', 'tomato'], irrigated: true },
]
const SEASONS = ['2023-2024', '2024-2025', '2025-2026']

function cell(row: number, col: number): Polygon {
  const n = LAT + CELL_LAT * (1 - row)
  const s = n - CELL_LAT
  const w = LON + CELL_LON * (col - 1.5)
  const e = w + CELL_LON
  const r = (x: number) => +x.toFixed(6)
  return { type: 'Polygon', coordinates: [[[r(w), r(s)], [r(e), r(s)], [r(e), r(n)], [r(w), r(n)], [r(w), r(s)]]] }
}

export async function createDemoFarm(): Promise<string> {
  const farm = await repo.createFarm({ name: 'مزرعة الحصن', lat: LAT, lon: LON, is_demo: true })
  for (let i = 0; i < PLOTS.length; i++) {
    const p = PLOTS[i]
    const d = emptyDraft(cell(Math.floor(i / 3), i % 3), p.label, i)
    d.name = `قطعة ${p.label}`
    d.region = 'الحصن'
    d.current_crop_id = p.crop
    d.previous_crop_id = p.history[1]
    d.status = p.crop ? 'planted' : 'fallow'
    d.color = PARCEL_COLORS[i % PARCEL_COLORS.length]
    d.irrigation_available = !!p.irrigated
    d.irrigation_method = p.irrigated ? 'drip' : 'none'
    d.notes = 'بيانات تجريبية'
    const plot = await repo.createPlot(farm.id, d)
    await repo.saveHistory(plot.id, SEASONS.map((season, k) => ({ season, crop_id: p.history[k] })))
  }
  return farm.id
}
