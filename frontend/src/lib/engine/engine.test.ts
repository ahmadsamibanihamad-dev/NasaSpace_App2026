import { describe, expect, it } from 'vitest'
import { buildClimate, effectiveRainMonthly, et0Hargreaves, et0PenmanMonteith, extraterrestrialRadiation, kcAt, scaleStages, seasonStats } from '../climate/features'
import { parsePower, toDay, type Daily } from '../climate/power'
import { areaM2, parseCoordinates, parseLatLonQuery, perimeterM, toPolygon, validateRing, governorateFor, insideJordan } from '../geometry'
import { statusOf, trapezoid } from './config'
import { CROPS, CROP_LIST, needsReviewList } from './crops'
import { buildRotation } from './rotation'
import { bestWindow, buildRisks, evaluate, scanYear, windowDates } from './suitability'

/** Synthetic Mediterranean climate: cool wet winters, hot dry summers (fixed, deterministic). */
function synthetic(years = 11): Daily {
  const start = '2014-01-01'
  const days = years * 365 + 3
  const s0 = toDay(start)
  const mk = (f: (doy: number, k: number) => number) => Array.from({ length: days }, (_, k) => {
    const d = new Date((s0 + k) * 86400000)
    const doy = Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000)
    return Math.round(f(doy, k) * 100) / 100
  })
  const season = (doy: number) => Math.cos(((doy - 200) / 365) * 2 * Math.PI) // +1 in mid-July, -1 in mid-January
  const t = mk((doy) => 17 + 9 * season(doy))
  return {
    cell: 'test', lat: 32.5, lon: 36, elevation: 600, start, days,
    t,
    tmin: mk((doy) => 11 + 8 * season(doy)),
    tmax: mk((doy) => 23 + 10 * season(doy)),
    rh: mk((doy) => 55 - 15 * season(doy)),
    ws: mk(() => 2),
    rs: mk((doy) => 19 + 9 * season(doy)),
    // rain only in the cool half of the year: every 4th day
    pr: mk((doy, k) => (season(doy) < -0.2 && k % 4 === 0 ? 10 : 0)),
    gwt: mk((doy) => 0.45 - 0.2 * season(doy)),
    gwr: mk((doy) => 0.5 - 0.15 * season(doy)),
    fetchedAt: new Date().toISOString(),
    lastDate: new Date((s0 + days - 1) * 86400000).toISOString().slice(0, 10),
    fromCache: false,
  }
}
const rainfed = { irrigation_available: false, irrigation_method: 'none', soil_ph: null, soil_type: null }
const drip = { irrigation_available: true, irrigation_method: 'drip', soil_ph: 7.5, soil_type: 'clay' }

describe('FAO-56 reference evapotranspiration', () => {
  it('matches the FAO-56 worked example within tolerance (Brussels, 6 July ≈ 3.9 mm/day)', () => {
    const et0 = et0PenmanMonteith({ tmin: 12.3, tmax: 21.5, rh: 73.5, ws: 2.078, rs: 22.07, lat: 50.8, elevation: 100, J: 187 })
    expect(et0).toBeGreaterThan(3.5)
    expect(et0).toBeLessThan(4.3)
  })
  it('computes extraterrestrial radiation (FAO-56 example 8: 20°S, 3 September = 32.2 MJ/m²/day)', () => {
    expect(extraterrestrialRadiation(-20, 246)).toBeCloseTo(32.2, 0)
  })
  it('falls back to Hargreaves with a plausible value', () => {
    const v = et0Hargreaves(12.3, 21.5, 50.8, 187)
    expect(v).toBeGreaterThan(2.5)
    expect(v).toBeLessThan(5.5)
  })
  it('builds the Kc curve and scales stages', () => {
    const st: [number, number, number, number] = [30, 40, 45, 30]
    const kc = { ini: 0.6, mid: 1.15, end: 0.8 }
    expect(kcAt(0, st, kc)).toBe(0.6)
    expect(kcAt(80, st, kc)).toBe(1.15)
    expect(kcAt(50, st, kc)).toBeCloseTo(0.875, 2)
    expect(kcAt(144, st, kc)).toBeCloseTo(0.81, 1)
    expect(scaleStages(st, 290).reduce((a, b) => a + b, 0)).toBe(290)
  })
  it('effective rainfall never exceeds rainfall', () => {
    for (const p of [0, 10, 80, 250, 400]) expect(effectiveRainMonthly(p)).toBeLessThanOrEqual(p)
    expect(effectiveRainMonthly(100)).toBeCloseTo(84, 0)
  })
})

describe('NASA POWER parsing', () => {
  it('turns the fill value into null and reads elevation', () => {
    const d = parsePower(
      { geometry: { coordinates: [35.8, 32.5, 148.9] }, header: { fill_value: -999 }, properties: { parameter: { T2M: { '20250101': 9.7, '20250102': -999, '20250103': 10.4 }, PRECTOTCORR: { '20250101': 0.57, '20250102': 0, '20250103': -999 } } } },
      'c', 32.5, 35.8,
    )
    expect(d.days).toBe(3)
    expect(d.t).toEqual([9.7, null, 10.4])
    expect(d.pr).toEqual([0.57, 0, null])
    expect(d.elevation).toBeCloseTo(148.9)
    expect(d.lastDate).toBe('2025-01-03')
  })
})

describe('season features', () => {
  const c = buildClimate(synthetic())
  it('summarises a winter season', () => {
    const s = seasonStats(c, { startMonth: 11, startDay: 11, lengthDays: 240, tBase: 5, heatThreshold: 27 })
    expect(s.n).toBeGreaterThanOrEqual(9)
    expect(s.rain).toBeGreaterThan(300)
    expect(s.frostDays).toBe(0)
    expect(s.longestDrySpell).toBeGreaterThan(3)
    expect(s.gdd).toBeGreaterThan(500)
    expect(s.et0).toBeGreaterThan(200)
  })
  it('a summer season is dry and hot', () => {
    const s = seasonStats(c, { startMonth: 6, startDay: 1, lengthDays: 100, tBase: 5, heatThreshold: 25 })
    expect(s.rain).toBeLessThan(20)
    expect(s.heatDays).toBeGreaterThan(20)
    expect(s.irrigation).toBeGreaterThan(300)
  })
})

describe('scoring', () => {
  const c = buildClimate(synthetic())
  it('trapezoid and status thresholds', () => {
    expect(trapezoid(10, 5, 15, 23, 27)).toBe(50)
    expect(trapezoid(20, 5, 15, 23, 27)).toBe(100)
    expect(trapezoid(30, 5, 15, 23, 27)).toBe(0)
    expect([statusOf(80), statusOf(79), statusOf(59), statusOf(39)]).toEqual(['highly_suitable', 'suitable', 'marginal', 'unsuitable'])
  })
  it('rainfed wheat prefers an autumn/winter planting window', () => {
    const evals = scanYear(c, CROPS.wheat, rainfed)
    expect(evals).toHaveLength(36)
    const w = bestWindow(evals)!
    expect(w).not.toBeNull()
    const month = Math.floor(w.best / 3) + 1
    expect([9, 10, 11, 12, 1]).toContain(month)
    const summer = evals[17] // late June
    expect(evals[w.best].score).toBeGreaterThan(summer.score + 10)
    for (const e of evals) {
      expect(e.score).toBeGreaterThanOrEqual(0)
      expect(e.score).toBeLessThanOrEqual(100)
    }
  })
  it('irrigation removes the rainfall-deficit penalty', () => {
    const dry = evaluate(c, CROPS.tomato, 12, rainfed)
    const wet = evaluate(c, CROPS.tomato, 12, drip)
    expect(wet.factors.precipitation).toBeGreaterThanOrEqual(95)
    expect(wet.score).toBeGreaterThan(dry.score)
  })
  it('reports drought risk for a rainfed summer crop with explanation and action in both languages', () => {
    const e = evaluate(c, CROPS.tomato, 12, rainfed)
    const risks = buildRisks(c, e, rainfed, -0.12)
    const types = risks.map((r) => r.type)
    expect(types).toContain('drought')
    expect(types).toContain('low_soil_moisture')
    for (const r of risks) {
      expect(r.explanation.ar.length).toBeGreaterThan(10)
      expect(r.explanation.en.length).toBeGreaterThan(10)
      expect(r.action.ar.length).toBeGreaterThan(5)
      expect(['low', 'moderate', 'high']).toContain(r.severity)
    }
  })
  it('window dates fall in the future and in order', () => {
    const w = windowDates(31, 34, new Date('2026-11-14T00:00:00Z'))
    expect(w.start >= '2026-11-01').toBe(true)
    expect(w.end > w.start).toBe(true)
  })
})

describe('rotation', () => {
  const c = buildClimate(synthetic())
  it('returns exactly three strategies with the five sections', () => {
    const { strategies } = buildRotation({ climate: c, plot: { ...rainfed, current_crop_id: 'wheat', previous_crop_id: 'wheat' }, history: [{ season: '2024-2025', crop_id: 'wheat' }, { season: '2025-2026', crop_id: 'wheat' }], priority: 'save_water', today: new Date('2026-11-14T00:00:00Z') })
    expect(strategies.map((s) => s.key)).toEqual(['current', 'option_a', 'option_b'])
    for (const s of strategies) {
      expect(s.sequence).toHaveLength(3)
      expect(s.why.length).toBeGreaterThan(0)
      expect(s.evidence.length).toBeGreaterThan(0)
      expect(s.benefits.length).toBeGreaterThan(0)
      expect(s.information_gaps.length).toBeGreaterThan(0)
      expect(s.risks_for_review.length).toBeGreaterThan(0)
      for (const k of ['water_use', 'soil_health', 'income_potential'] as const) {
        expect(s.scores[k]).toBeGreaterThanOrEqual(0)
        expect(s.scores[k]).toBeLessThanOrEqual(100)
      }
    }
    const [current, a] = strategies
    expect(current.sequence.every((q) => q.crop === 'wheat')).toBe(true)
    // soil-health option: no family repeated in consecutive seasons, starting after wheat
    const fam = ['Poaceae', ...a.sequence.map((q) => (q.crop ? CROPS[q.crop].family : null))]
    for (let i = 1; i < fam.length; i++) expect(fam[i]).not.toBe(fam[i - 1])
    expect(a.sequence.some((q) => q.crop && CROPS[q.crop].nitrogen_fixing)).toBe(true)
    expect(a.scores.soil_health).toBeGreaterThan(current.scores.soil_health)
  })
})

describe('crop knowledge base', () => {
  it('has the 13 crops, each value with a source', () => {
    expect(CROP_LIST).toHaveLength(13)
    for (const c of CROP_LIST) {
      expect(c.temp.abs_min.value).toBeLessThan(c.temp.opt_min.value)
      expect(c.temp.opt_max.value).toBeLessThanOrEqual(c.temp.abs_max.value)
      expect(c.temp.opt_min.source).toBeTruthy()
      expect(c.kc.mid.source).toContain('FAO-56')
    }
    expect(needsReviewList().some((x) => x.crop === 'vetch' && x.field.startsWith('kc'))).toBe(true)
  })
})

describe('parcel geometry', () => {
  const sq = [[32.5568, 35.8469], [32.5568, 35.8479], [32.5578, 35.8479], [32.5578, 35.8469]] as [number, number][]
  it('computes area and perimeter', () => {
    const poly = toPolygon(sq)!
    // 0.001° lat ≈ 111.2 m, 0.001° lon ≈ 93.8 m at this latitude
    expect(areaM2(poly)).toBeGreaterThan(10000)
    expect(areaM2(poly)).toBeLessThan(10900)
    expect(perimeterM(poly)).toBeGreaterThan(400)
    expect(perimeterM(poly)).toBeLessThan(420)
  })
  it('validates rings', () => {
    expect(validateRing(sq)).toEqual([])
    expect(validateRing(sq.slice(0, 2))).toEqual(['too_few_points'])
    expect(validateRing([sq[0], sq[2], sq[1], sq[3]])).toContain('self_intersecting')
    expect(validateRing([[33.51, 36.29], [33.52, 36.29], [33.52, 36.3]])).toContain('outside_jordan')
    expect(validateRing([[95, 36], [32, 36], [32, 37]])).toEqual(['out_of_range'])
  })
  it('parses typed coordinates, including Arabic digits', () => {
    const r = parseCoordinates('32.5568, 35.8469\n٣٢٫٥٥٧ ، ٣٥٫٨٤٨\nabc\n95, 10')
    expect(r.points).toHaveLength(2)
    expect(r.points[1][0]).toBeCloseTo(32.557)
    expect(r.errors).toEqual([{ line: 3, reason: 'format' }, { line: 4, reason: 'range' }])
    expect(parseLatLonQuery('32.55, 35.84')).toEqual({ lat: 32.55, lon: 35.84 })
    expect(parseLatLonQuery('إربد')).toBeNull()
  })
  it('resolves governorates locally and rejects points outside Jordan', () => {
    expect(governorateFor(32.5568, 35.8469)?.id).toBe('ir')
    expect(governorateFor(31.95, 35.93)?.id).toBe('am')
    expect(insideJordan(33.51, 36.29)).toBe(false)
    expect(governorateFor(24.71, 46.67)).toBeNull()
  })
})
