/**
 * Crop knowledge base for the 13 supported crops. Every value carries its source.
 *
 * Verified sources (copies of the extracted rows are in backend/app/data/sources/):
 *  - ECO  = FAO ECOCROP table as distributed in the Recocrop R package (inst/parameters/ecocrop.rds)
 *  - F56  = FAO Irrigation and Drainage Paper 56 (Allen et al. 1998): Table 11 (stage lengths),
 *           Table 12 (Kc), Table 22 (root depth), read from fao.org/3/x0490e
 * Anything not found in those sources is marked needs_review: true and must be confirmed locally.
 */
import type { Bi } from '../types'

export interface SV<T = number> {
  value: T
  source: string
  needs_review?: boolean
  note?: string
}
export type Tolerance = 'low' | 'moderate' | 'high'
export type Stages = [number, number, number, number]

export interface CropKB {
  id: string
  name: Bi
  scientific_name: string
  family: string
  category: 'cereal' | 'legume' | 'vegetable' | 'tree'
  nitrogen_fixing: boolean
  perennial: boolean
  temp: { abs_min: SV; opt_min: SV; opt_max: SV; abs_max: SV }
  killing_temp: SV
  rain: { abs_min: SV; opt_min: SV; opt_max: SV; abs_max: SV }
  ph: { abs_min: SV; opt_min: SV; opt_max: SV; abs_max: SV }
  cycle_days: { min: SV; max: SV }
  season_length: SV
  stages: SV<Stages>
  kc: { ini: SV; mid: SV; end: SV }
  root_depth: SV<[number, number]>
  base_temp: SV
  heat_threshold: SV
  planting_months: SV<number[]>
  frost_tolerance: SV<Tolerance>
  drought_tolerance: SV<Tolerance>
  income: SV<1 | 2 | 3>
}

const ECO = 'FAO ECOCROP'
const eco = (value: number): SV => ({ value, source: ECO })
const f56 = (value: number, table: string, note?: string): SV => ({ value, source: `FAO-56 ${table}`, ...(note ? { note } : {}) })
const review = <T,>(value: T, source: string, note: string): SV<T> => ({ value, source, needs_review: true, note })

type Row = [tmin: number, topmn: number, topmx: number, tmax: number, ktmp: number, rmin: number, ropmn: number, ropmx: number, rmax: number, gmin: number, gmax: number, phmin: number, phopmn: number, phopmx: number, phmax: number]

interface Def {
  id: string
  name: Bi
  sci: string
  family: string
  category: CropKB['category']
  nfix?: boolean
  perennial?: boolean
  eco: Row
  kc: [number, number, number]
  kcNote?: string
  kcReview?: boolean
  stages: Stages
  stagesSource?: string // FAO-56 Table 11 row description; omitted = not in FAO-56
  root: [number, number]
  rootReview?: boolean
  months: number[]
  income: 1 | 2 | 3
}

const DEFS: Def[] = [
  { id: 'wheat', name: { ar: 'قمح', en: 'Wheat' }, sci: 'Triticum aestivum', family: 'Poaceae', category: 'cereal', eco: [5, 15, 23, 27, 0, 300, 750, 900, 1600, 90, 250, 5.5, 6.0, 7.0, 8.5], kc: [0.7, 1.15, 0.3], kcNote: 'Winter wheat, non-frozen soils; Kc end printed as 0.25–0.4', stages: [30, 140, 40, 30], stagesSource: 'Winter wheat, November, Mediterranean', root: [1.5, 1.8], months: [11, 12], income: 1 },
  { id: 'barley', name: { ar: 'شعير', en: 'Barley' }, sci: 'Hordeum vulgare', family: 'Poaceae', category: 'cereal', eco: [2, 15, 20, 40, -4, 200, 500, 1000, 2000, 90, 240, 6.0, 6.5, 7.5, 8.0], kc: [0.3, 1.15, 0.25], stages: [40, 60, 60, 40], stagesSource: 'Barley/Oats/Wheat, November (region not printed)', root: [1.0, 1.5], months: [11, 12], income: 1 },
  { id: 'lentil', name: { ar: 'عدس', en: 'Lentil' }, sci: 'Lens culinaris', family: 'Fabaceae', category: 'legume', nfix: true, eco: [5, 15, 29, 32, 0, 250, 600, 1000, 2500, 70, 240, 4.5, 5.5, 7.5, 8.2], kc: [0.4, 1.1, 0.3], stages: [25, 35, 70, 40], stagesSource: 'Lentil, Oct/Nov, Arid Region', root: [0.6, 0.8], months: [11, 12, 1], income: 2 },
  { id: 'chickpea', name: { ar: 'حمص', en: 'Chickpea' }, sci: 'Cicer arietinum', family: 'Fabaceae', category: 'legume', nfix: true, eco: [7, 15, 29, 35, -9, 300, 600, 1000, 1800, 90, 180, 4.7, 6.0, 8.5, 9.5], kc: [0.4, 1.0, 0.35], stages: [25, 35, 70, 40], root: [0.6, 1.0], months: [12, 1, 2, 3], income: 2 },
  { id: 'vetch', name: { ar: 'بيقيا', en: 'Vetch' }, sci: 'Vicia sativa', family: 'Fabaceae', category: 'legume', nfix: true, eco: [3, 14, 23, 28, 0, 350, 700, 900, 1600, 80, 170, 4.5, 6.0, 7.0, 8.2], kc: [0.4, 1.15, 0.55], kcReview: true, kcNote: 'Vetch is not listed in FAO-56; the Table 12 "Legumes" group values are used as a placeholder', stages: [25, 35, 70, 40], root: [0.6, 0.8], rootReview: true, months: [11, 12], income: 1 },
  { id: 'tomato', name: { ar: 'بندورة', en: 'Tomato' }, sci: 'Solanum lycopersicum', family: 'Solanaceae', category: 'vegetable', eco: [7, 20, 27, 35, 0, 400, 600, 1300, 1800, 70, 150, 5.0, 5.5, 6.8, 7.5], kc: [0.6, 1.15, 0.8], kcNote: 'Kc end printed as 0.70–0.90', stages: [30, 40, 45, 30], stagesSource: 'Tomato, April/May, Mediterranean', root: [0.7, 1.5], months: [3, 4, 5], income: 3 },
  { id: 'cucumber', name: { ar: 'خيار', en: 'Cucumber' }, sci: 'Cucumis sativus', family: 'Cucurbitaceae', category: 'vegetable', eco: [6, 18, 32, 38, 0, 400, 1000, 1200, 4300, 40, 180, 4.5, 6.0, 7.5, 8.7], kc: [0.6, 1.0, 0.75], kcNote: 'Fresh market', stages: [20, 30, 40, 15], stagesSource: 'Cucumber, June/Aug, Arid Region', root: [0.7, 1.2], months: [3, 4, 8], income: 3 },
  { id: 'potato', name: { ar: 'بطاطا', en: 'Potato' }, sci: 'Solanum tuberosum', family: 'Solanaceae', category: 'vegetable', eco: [7, 15, 25, 30, -1, 250, 500, 800, 2000, 90, 160, 4.2, 5.0, 6.2, 8.5], kc: [0.5, 1.15, 0.75], stages: [25, 30, 45, 30], stagesSource: 'Potato, Jan/Nov, (Semi) Arid Climate (mid stage printed 30/45)', root: [0.4, 0.6], months: [1, 2, 8, 9], income: 3 },
  { id: 'onion', name: { ar: 'بصل', en: 'Onion' }, sci: 'Allium cepa', family: 'Amaryllidaceae', category: 'vegetable', eco: [4, 12, 25, 30, 0, 300, 350, 600, 2800, 85, 175, 4.3, 6.0, 7.0, 8.3], kc: [0.7, 1.05, 0.75], kcNote: 'Onions – dry', stages: [20, 35, 110, 45], stagesSource: 'Onion (dry), Oct/Jan, Arid Region', root: [0.3, 0.6], months: [10, 11, 12], income: 3 },
  { id: 'eggplant', name: { ar: 'باذنجان', en: 'Eggplant' }, sci: 'Solanum melongena', family: 'Solanaceae', category: 'vegetable', eco: [9, 20, 35, 40, 0, 800, 1200, 1600, 4000, 70, 120, 4.3, 5.5, 6.8, 8.5], kc: [0.6, 1.05, 0.9], stages: [30, 45, 40, 25], stagesSource: 'Egg plant, May/June, Mediterranean', root: [0.7, 1.2], months: [3, 4, 5], income: 3 },
  { id: 'olive', name: { ar: 'زيتون', en: 'Olive' }, sci: 'Olea europaea', family: 'Oleaceae', category: 'tree', perennial: true, eco: [5, 20, 34, 40, 0, 200, 400, 700, 1200, 210, 300, 5.3, 6.0, 7.0, 8.5], kc: [0.65, 0.7, 0.7], kcNote: 'Olives, 40–60% ground coverage by canopy', stages: [30, 90, 60, 90], stagesSource: 'Olives, March, Mediterranean', root: [1.2, 1.7], months: [], income: 2 },
  { id: 'date_palm', name: { ar: 'نخيل التمر', en: 'Date palm' }, sci: 'Phoenix dactylifera', family: 'Arecaceae', category: 'tree', perennial: true, eco: [10, 26, 45, 52, -4, 100, 200, 300, 400, 365, 365, 6.0, 6.5, 8.0, 8.5], kc: [0.9, 0.95, 0.95], stages: [60, 90, 120, 95], root: [1.5, 2.5], months: [], income: 3 },
  { id: 'citrus', name: { ar: 'حمضيات', en: 'Citrus' }, sci: 'Citrus sinensis', family: 'Rutaceae', category: 'tree', perennial: true, eco: [13, 20, 30, 38, 0, 450, 1200, 2000, 2700, 180, 365, 4.0, 5.0, 6.0, 8.3], kc: [0.7, 0.65, 0.7], kcNote: 'Citrus, no ground cover, 70% canopy', stages: [60, 90, 120, 95], stagesSource: 'Citrus, January, Mediterranean', root: [1.2, 1.5], months: [], income: 3 },
]

function frostTolerance(ktmp: number, tmin: number): Tolerance {
  if (ktmp <= -4) return 'high'
  return tmin <= 5 ? 'moderate' : 'low'
}
function droughtTolerance(rmin: number): Tolerance {
  return rmin <= 200 ? 'high' : rmin <= 300 ? 'moderate' : 'low'
}

function build(d: Def): CropKB {
  const [tmin, topmn, topmx, tmax, ktmp, rmin, ropmn, ropmx, rmax, gmin, gmax, phmin, phopmn, phopmx, phmax] = d.eco
  const total = d.stages.reduce((a, b) => a + b, 0)
  const kcSrc = (v: number): SV => (d.kcReview ? review(v, 'FAO-56 Table 12 (Legumes group)', d.kcNote!) : f56(v, 'Table 12', d.kcNote))
  return {
    id: d.id,
    name: d.name,
    scientific_name: d.sci,
    family: d.family,
    category: d.category,
    nitrogen_fixing: !!d.nfix,
    perennial: !!d.perennial,
    temp: { abs_min: eco(tmin), opt_min: eco(topmn), opt_max: eco(topmx), abs_max: eco(tmax) },
    killing_temp: ktmp === 0 ? review(ktmp, ECO, 'ECOCROP lists 0 °C, which may be a placeholder for "no data"') : eco(ktmp),
    rain: { abs_min: eco(rmin), opt_min: eco(ropmn), opt_max: eco(ropmx), abs_max: eco(rmax) },
    ph: { abs_min: eco(phmin), opt_min: eco(phopmn), opt_max: eco(phopmx), abs_max: eco(phmax) },
    cycle_days: { min: eco(gmin), max: eco(gmax) },
    season_length: d.perennial
      ? { value: 365, source: 'Perennial: evaluated over the full year' }
      : d.stagesSource
        ? f56(total, 'Table 11', d.stagesSource)
        : review(Math.round((gmin + gmax) / 2), ECO, 'No FAO-56 Table 11 row; midpoint of the ECOCROP growing-cycle range'),
    stages: d.stagesSource ? { value: d.stages, source: 'FAO-56 Table 11', note: d.stagesSource } : review(d.stages, 'FAO-56 Table 11 (other crop)', 'No Table 11 row for this crop; proportions borrowed from a similar crop'),
    kc: { ini: kcSrc(d.kc[0]), mid: kcSrc(d.kc[1]), end: kcSrc(d.kc[2]) },
    root_depth: d.rootReview ? review(d.root, 'FAO-56 Table 22 (lentil)', 'Vetch is not in Table 22; lentil values used as a placeholder') : { value: d.root, source: 'FAO-56 Table 22' },
    base_temp: review(tmin, ECO, 'Proxy: ECOCROP absolute minimum temperature used as the growing-degree-day base'),
    heat_threshold: review(tmax, ECO, 'Proxy: ECOCROP absolute maximum temperature applied to daily Tmax'),
    planting_months: review(d.months, 'Not verified', d.perennial ? 'Perennial tree crop' : 'Typical planting months in Jordan; confirm with the local extension service'),
    frost_tolerance: review(frostTolerance(ktmp, tmin), ECO, 'Derived from ECOCROP killing / minimum temperatures'),
    drought_tolerance: review(droughtTolerance(rmin), ECO, 'Derived from ECOCROP minimum rainfall'),
    income: review(d.income, 'Not verified', 'Relative indicator only (1 low – 3 high); no market data is used'),
  }
}

export const CROPS: Record<string, CropKB> = Object.fromEntries(DEFS.map((d) => [d.id, build(d)]))
export const CROP_LIST: CropKB[] = DEFS.map((d) => CROPS[d.id])
export const ANNUAL_CROPS = CROP_LIST.filter((c) => !c.perennial)

/** Flat list of every value flagged needs_review (for the summary / README). */
export function needsReviewList(): { crop: string; field: string; note: string }[] {
  const out: { crop: string; field: string; note: string }[] = []
  for (const c of CROP_LIST) {
    const walk = (obj: unknown, path: string) => {
      if (!obj || typeof obj !== 'object') return
      const sv = obj as SV<unknown>
      if ('value' in sv && 'source' in sv) {
        if (sv.needs_review) out.push({ crop: c.id, field: path, note: sv.note ?? '' })
        return
      }
      for (const [k, v] of Object.entries(obj)) walk(v, path ? `${path}.${k}` : k)
    }
    walk(c, '')
  }
  return out
}
