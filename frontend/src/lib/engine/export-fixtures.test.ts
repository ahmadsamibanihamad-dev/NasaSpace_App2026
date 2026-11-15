/**
 * Exports the crop knowledge base, the engine config and reference results to the backend.
 * The Python engine is a port of this TypeScript engine; backend tests compare against these
 * results so the two cannot drift apart silently.
 *
 * Run on demand:  EXPORT_FIXTURES=1 npx vitest run src/lib/engine/export-fixtures.test.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildClimate, dekadProbabilities, monthlyClimatology, monthlySeries, seasonStats } from '../climate/features'
import { toDay, type Daily } from '../climate/power'
import * as config from './config'
import { CROPS, CROP_LIST } from './crops'
import { buildRotation } from './rotation'
import { bestWindow, buildRisks, evaluate, scanYear, windowDates } from './suitability'

const BACKEND = resolve(__dirname, '../../../../backend')

/** Same deterministic Mediterranean climate as engine.test.ts. */
function synthetic(years = 11): Daily {
  const start = '2014-01-01'
  const days = years * 365 + 3
  const s0 = toDay(start)
  const mk = (f: (doy: number, k: number) => number) =>
    Array.from({ length: days }, (_, k) => {
      const d = new Date((s0 + k) * 86400000)
      const doy = Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000)
      return Math.round(f(doy, k) * 100) / 100
    })
  const season = (doy: number) => Math.cos(((doy - 200) / 365) * 2 * Math.PI)
  const daily: Daily = {
    cell: 'test', lat: 32.5, lon: 36, elevation: 600, start, days,
    t: mk((doy) => 17 + 9 * season(doy)),
    tmin: mk((doy) => 11 + 8 * season(doy)),
    tmax: mk((doy) => 23 + 10 * season(doy)),
    rh: mk((doy) => 55 - 15 * season(doy)),
    ws: mk(() => 2),
    rs: mk((doy) => 19 + 9 * season(doy)),
    pr: mk((doy, k) => (season(doy) < -0.2 && k % 4 === 0 ? 10 : 0)),
    gwt: mk((doy) => 0.45 - 0.2 * season(doy)),
    gwr: mk((doy) => 0.5 - 0.15 * season(doy)),
    fetchedAt: '2026-01-01T00:00:00.000Z',
    lastDate: new Date((s0 + days - 1) * 86400000).toISOString().slice(0, 10),
    fromCache: false,
  }
  // a few gaps and frost days so null handling and frost logic are exercised
  for (const k of [40, 41, 900, 2000]) daily.t[k] = null
  for (const k of [41, 2500]) daily.pr[k] = null
  for (const k of [10, 11, 380, 745, 746, 1110]) daily.tmin[k] = -1.5
  daily.rh[300] = null
  return daily
}

const PLOTS = {
  rainfed: { irrigation_available: false, irrigation_method: 'none', soil_ph: null, soil_type: null },
  drip: { irrigation_available: true, irrigation_method: 'drip', soil_ph: 7.5, soil_type: 'clay' },
}
const num = (x: number | null) => (x === null || !Number.isFinite(x) ? null : Math.round(x * 1e6) / 1e6)

describe.runIf(process.env.EXPORT_FIXTURES === '1')('export fixtures for the backend', () => {
  it('writes crops.json, engine_config.json and parity.json', () => {
    const daily = synthetic()
    const c = buildClimate(daily)
    const today = new Date('2026-11-14T00:00:00Z')

    const evaluations: Record<string, unknown> = {}
    for (const crop of CROP_LIST) {
      for (const [pk, plot] of Object.entries(PLOTS)) {
        const evals = scanYear(c, crop, plot)
        const w = bestWindow(evals)
        const e = evals[w ? w.best : 0]
        evaluations[`${crop.id}|${pk}`] = {
          scores: evals.map((x) => num(x.score)),
          window: w,
          at: e.dekad,
          factors: Object.fromEntries(Object.entries(e.factors).map(([k, v]) => [k, num(v)])),
          penalties: Object.fromEntries(Object.entries(e.penalties).map(([k, v]) => [k, num(v)])),
          rainReliability: num(e.rainReliability),
          stats: Object.fromEntries(
            (['n', 'tmean', 'tminMean', 'tmaxMean', 'absMinT', 'gdd', 'frostDays', 'frostYearFraction', 'heatDays', 'rain', 'rainCV', 'longestDrySpell', 'extremeRainDays', 'rs', 'soilWetness', 'et0', 'etc', 'effRain', 'irrigation', 'tempScore', 'waterSatisfaction', 'establishment'] as const).map((k) => [k, num(e.stats[k] as number | null)]),
          ),
          risks: buildRisks(c, e, plot, -0.12).map((r) => [r.type, r.severity]),
        }
      }
    }

    const rotation: Record<string, unknown> = {}
    const cases = {
      wheat_mono_save_water: { plot: { ...PLOTS.rainfed, current_crop_id: 'wheat', previous_crop_id: 'wheat' }, history: [{ season: '2024-2025', crop_id: 'wheat' }, { season: '2025-2026', crop_id: 'wheat' }], priority: 'save_water' as const },
      fallow_income_drip: { plot: { ...PLOTS.drip, current_crop_id: null, previous_crop_id: 'tomato' }, history: [], priority: 'increase_income' as const },
      olive_soil: { plot: { ...PLOTS.rainfed, current_crop_id: 'olive', previous_crop_id: 'olive' }, history: [{ season: '2025-2026', crop_id: 'olive' }], priority: 'improve_soil' as const },
    }
    for (const [k, v] of Object.entries(cases)) {
      const r = buildRotation({ climate: c, ...v, today })
      rotation[k] = { input: { plot: v.plot, history: v.history, priority: v.priority }, seasons: r.seasons, strategies: r.strategies.map((s) => ({ key: s.key, focus: s.focus, sequence: s.sequence, scores: s.scores, gaps: s.information_gaps.length, review: s.risks_for_review.length, why: s.why.length, benefits: s.benefits.length })) }
    }

    const rows = monthlySeries(c)
    const season = seasonStats(c, { startMonth: 11, startDay: 11, lengthDays: 240, tBase: 5, heatThreshold: 27 })
    const parity = {
      generated_from: 'frontend/src/lib/engine (rules-web-v0)',
      today: '2026-11-14',
      daily: { ...daily, fromCache: undefined },
      climate: { s0: c.s0, firstYear: c.firstYear, lastYear: c.lastYear, r95: num(c.r95), completeness: num(c.completeness), recordYears: num(c.recordYears), et0Method: c.et0Method, et0_sum: num(c.et0.reduce((a: number, b) => a + (b ?? 0), 0)), et0_head: c.et0.slice(0, 400).map(num) },
      season_plain: Object.fromEntries((['n', 'tmean', 'rain', 'rainCV', 'gdd', 'frostDays', 'heatDays', 'longestDrySpell', 'extremeRainDays', 'et0', 'etc', 'effRain', 'irrigation', 'waterSatisfaction', 'establishment', 'soilWetness', 'rs'] as const).map((k) => [k, num(season[k] as number | null)])),
      monthly: { count: rows.length, t_clim: monthlyClimatology(rows, (r) => r.t).map(num), rain_clim: monthlyClimatology(rows, (r) => r.rain).map(num), gwr_clim: monthlyClimatology(rows, (r) => r.gwr).map(num), last: { ...rows[rows.length - 1] }, row50: { ...rows[50] } },
      dekad_probabilities: { frost: dekadProbabilities(c, 27).frost.map(num), heat: dekadProbabilities(c, 27).heat.map(num) },
      window_dates: { '31-34': windowDates(31, 34, today), '34-2': windowDates(34, 2, today), '5-8': windowDates(5, 8, today), '30-32': windowDates(30, 32, today) },
      single: { wheat_d31_rainfed: num(evaluate(c, CROPS.wheat, 31, PLOTS.rainfed).score), tomato_d12_drip: num(evaluate(c, CROPS.tomato, 12, PLOTS.drip).score) },
      evaluations,
      rotation,
    }

    mkdirSync(resolve(BACKEND, 'tests/fixtures'), { recursive: true })
    mkdirSync(resolve(BACKEND, 'app/data'), { recursive: true })
    writeFileSync(resolve(BACKEND, 'tests/fixtures/parity.json'), JSON.stringify(parity))
    writeFileSync(resolve(BACKEND, 'app/data/crops.json'), JSON.stringify({ note: 'Exported from frontend/src/lib/engine/crops.ts. Every value carries its source; needs_review marks values to confirm locally.', crops: CROP_LIST }, null, 1))
    const { statusOf: _s, trapezoid: _t, ...cfg } = config
    writeFileSync(resolve(BACKEND, 'app/data/engine_config.json'), JSON.stringify({ note: 'Weights, thresholds and penalties of the rule engine. Engineering defaults, all needs_review: calibrate locally.', ...cfg }, null, 1))
    expect(Object.keys(evaluations).length).toBe(26)
  })
})
