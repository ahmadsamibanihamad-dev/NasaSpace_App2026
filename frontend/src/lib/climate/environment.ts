// Environment summary and time series for the dashboard / analytics, from real NASA POWER data.
import type { DataMeta, EnvSummary, TimeSeries } from '../types'
import { buildClimate, mean, monthlyClimatology, monthlySeries, type Climate, type MonthlyRow } from './features'
import { fromDay, getDaily, toDay } from './power'

const cache = new Map<string, Promise<Climate>>()
export function getClimate(lat: number, lon: number): Promise<Climate> {
  const key = `${(Math.round(lat * 2) / 2).toFixed(1)}_${(Math.round(lon * 2) / 2).toFixed(1)}`
  let p = cache.get(key)
  if (!p) {
    p = getDaily(lat, lon).then(buildClimate)
    p.catch(() => cache.delete(key))
    cache.set(key, p)
  }
  return p
}

export const POWER_SOURCE = 'NASA POWER'

/** Provenance shared by everything derived from POWER only (SMAP / IMERG are not ingested in frontend-only mode). */
export function powerMeta(c: Climate, basis: string): DataMeta {
  const quality: DataMeta['data_quality'] = c.completeness < 0.8 || c.recordYears < 5 ? 'poor' : 'limited'
  return {
    data_sources: [POWER_SOURCE],
    data_quality: quality,
    confidence: c.recordYears >= 10 && c.completeness >= 0.95 ? 'medium' : 'low',
    data_timestamp: c.daily.lastDate,
    analysis_basis: basis,
    is_demo: false,
    notes: [
      {
        ar: 'رطوبة التربة والأمطار هنا من NASA POWER (GWETROOT و PRECTOTCORR) وليست من SMAP أو GPM IMERG، لذلك جودة البيانات «محدودة».',
        en: 'Soil moisture and rainfall here come from NASA POWER (GWETROOT, PRECTOTCORR), not SMAP or GPM IMERG, so data quality is "limited".',
      },
    ],
  }
}

const lastN = (xs: (number | null)[], end: number, n: number) => {
  const v: number[] = []
  for (let k = Math.max(0, end - n + 1); k <= end; k++) if (xs[k] !== null && xs[k] !== undefined) v.push(xs[k] as number)
  return v.length ? mean(v) : null
}

export async function getEnvSummary(lat: number, lon: number): Promise<EnvSummary> {
  const c = await getClimate(lat, lon)
  const d = c.daily
  const end = toDay(d.lastDate) - c.s0
  const rows = monthlySeries(c)
  const recent = rows.slice(-12)
  const cur = rows[rows.length - 1]
  const climOf = (pick: (r: MonthlyRow) => number | null) => monthlyClimatology(rows, pick, cur.key)[cur.month - 1]
  const label = (r: MonthlyRow) => r.key

  // Rainy season to date (1 October → latest day) vs the same span in other years
  const ly = +d.lastDate.slice(0, 4)
  const lm = +d.lastDate.slice(5, 7)
  const seasonYear = lm >= 10 ? ly : ly - 1
  const span = end - (toDay(`${seasonYear}-10-01`) - c.s0)
  const total = (y: number) => {
    const a = toDay(`${y}-10-01`) - c.s0
    if (a < 0 || a + span > end) return null
    let s = 0
    for (let k = a; k <= a + span; k++) s += d.pr[k] ?? 0
    return s
  }
  const seasonRain = total(seasonYear)
  const others: number[] = []
  for (let y = c.firstYear; y < seasonYear; y++) {
    const v = total(y)
    if (v !== null) others.push(v)
  }
  const histRain = others.length ? mean(others) : null

  const sm = lastN(d.gwr, end, 30)
  const smHist = climOf((r) => r.gwr)
  const t30 = lastN(d.t, end, 30)
  const tHist = climOf((r) => r.t)
  const last30 = { ar: 'متوسط آخر 30 يوماً', en: 'Mean of the last 30 days' }

  return {
    ...powerMeta(c, 'recent_observations'),
    lat,
    lon,
    metrics: {
      soil_moisture: {
        value: sm === null ? null : sm * 100,
        unit: '%',
        source: 'NASA POWER · GWETROOT',
        period: last30,
        trend: recent.map((r) => ({ label: label(r), value: r.gwr === null ? null : r.gwr * 100 })),
        historical_mean: smHist === null ? null : smHist * 100,
        anomaly: sm !== null && smHist !== null ? (sm - smHist) * 100 : null,
      },
      temperature: {
        value: t30,
        unit: '°C',
        source: 'NASA POWER · T2M',
        period: last30,
        trend: recent.map((r) => ({ label: label(r), value: r.t })),
        historical_mean: tHist,
        anomaly: t30 !== null && tHist !== null ? t30 - tHist : null,
      },
      seasonal_rainfall: {
        value: seasonRain,
        unit: 'mm',
        source: 'NASA POWER · PRECTOTCORR',
        period: { ar: `من 1 تشرين الأول ${seasonYear} حتى ${d.lastDate}`, en: `1 October ${seasonYear} to ${d.lastDate}` },
        trend: recent.map((r) => ({ label: label(r), value: r.rain })),
        historical_mean: histRain,
        anomaly: seasonRain !== null && histRain !== null ? seasonRain - histRain : null,
      },
    },
  }
}

const VARS: Record<string, { unit: string; daily: (c: Climate) => (number | null)[]; monthly: (r: MonthlyRow) => number | null; sum: boolean; scale: number }> = {
  temperature: { unit: '°C', daily: (c) => c.daily.t, monthly: (r) => r.t, sum: false, scale: 1 },
  rainfall: { unit: 'mm', daily: (c) => c.daily.pr, monthly: (r) => r.rain, sum: true, scale: 1 },
  soil_moisture: { unit: '%', daily: (c) => c.daily.gwr, monthly: (r) => r.gwr, sum: false, scale: 100 },
  humidity: { unit: '%', daily: (c) => c.daily.rh, monthly: (r) => r.rh, sum: false, scale: 1 },
  solar_radiation: { unit: 'MJ/m²', daily: (c) => c.daily.rs, monthly: (r) => r.rs, sum: false, scale: 1 },
}
const SEASON_OF = [0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 0] // month index → DJF, MAM, JJA, SON
const SEASON_KEYS = ['winter', 'spring', 'summer', 'autumn']

export async function getTimeSeries(lat: number, lon: number, variable: string, resolution: string): Promise<TimeSeries> {
  const c = await getClimate(lat, lon)
  const v = VARS[variable] ?? VARS.temperature
  const rows = monthlySeries(c)
  const sc = (x: number | null) => (x === null ? null : x * v.scale)
  const agg = (xs: (number | null)[]) => {
    const ok = xs.filter((x): x is number => x !== null)
    if (!ok.length) return null
    return v.sum ? ok.reduce((a, b) => a + b, 0) : mean(ok)
  }
  let points: TimeSeries['points'] = []

  if (resolution === 'daily') {
    const series = v.daily(c)
    const end = toDay(c.daily.lastDate) - c.s0
    const start = Math.max(0, end - 364)
    // day-of-year climatology from the earlier years (±3-day window to smooth single-day noise)
    const byMd = new Map<string, number[]>()
    for (let k = 0; k < start; k++) {
      const x = series[k]
      if (x === null) continue
      const md = fromDay(c.s0 + k).slice(5)
      ;(byMd.get(md) ?? byMd.set(md, []).get(md)!).push(x)
    }
    for (let k = start; k <= end; k++) {
      const pool: number[] = []
      for (let o = -3; o <= 3; o++) pool.push(...(byMd.get(fromDay(c.s0 + k + o).slice(5)) ?? []))
      points.push({ t: fromDay(c.s0 + k), value: sc(series[k]), historical_mean: pool.length ? mean(pool) * v.scale : null })
    }
  } else if (resolution === 'monthly') {
    const clim = monthlyClimatology(rows, v.monthly)
    points = rows.slice(-24).map((r) => ({ t: r.key, value: sc(v.monthly(r)), historical_mean: sc(clim[r.month - 1]) }))
  } else if (resolution === 'seasonal') {
    const groups = new Map<string, MonthlyRow[]>()
    for (const r of rows) {
      const s = SEASON_OF[r.month - 1]
      const y = r.month === 12 ? r.year + 1 : r.year // DJF belongs to January's year
      const key = `${y}-${SEASON_KEYS[s]}`
      ;(groups.get(key) ?? groups.set(key, []).get(key)!).push(r)
    }
    const full = [...groups.entries()].filter(([, g]) => g.length === 3)
    const val = (g: MonthlyRow[]) => agg(g.map(v.monthly))
    const hist: Record<string, number | null> = {}
    for (const s of SEASON_KEYS) {
      const xs = full.filter(([k]) => k.endsWith(s)).map(([, g]) => val(g)).filter((x): x is number => x !== null)
      hist[s] = xs.length ? mean(xs) : null
    }
    points = full.slice(-12).map(([k, g]) => ({ t: k, value: sc(val(g)), historical_mean: sc(hist[k.split('-')[1]]) }))
  } else {
    const years = new Map<number, MonthlyRow[]>()
    for (const r of rows) (years.get(r.year) ?? years.set(r.year, []).get(r.year)!).push(r)
    const full = [...years.entries()].filter(([, g]) => g.length === 12 && g.every((r) => r.days >= 27))
    const vals = full.map(([y, g]) => ({ y, v: agg(g.map(v.monthly)) }))
    const ok = vals.map((x) => x.v).filter((x): x is number => x !== null)
    const h = ok.length ? mean(ok) : null
    points = vals.map((x) => ({ t: String(x.y), value: sc(x.v), historical_mean: sc(h) }))
  }

  return { ...powerMeta(c, 'recent_observations'), variable, unit: v.unit, resolution, points }
}
