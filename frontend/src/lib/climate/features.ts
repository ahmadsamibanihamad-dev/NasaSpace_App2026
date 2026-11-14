/**
 * Feature engineering from the daily historical record (unit-tested).
 *
 * Definitions:
 *  - ET0: FAO-56 Penman–Monteith (Allen et al. 1998, eq. 6) with Hargreaves (eq. 52) as fallback.
 *  - ETc = Kc × ET0 with the FAO-56 four-stage Kc curve.
 *  - Frost day: Tmin < 0 °C (ETCCDI "FD"). Dry day: precipitation < 1 mm (ETCCDI "CDD").
 *  - Extreme rain day: precipitation above the local 95th percentile of wet days (ETCCDI "R95p").
 *  - Effective rainfall: USDA-SCS monthly formula as used in FAO CROPWAT (needs local review).
 */
import { fromDay, toDay, type Daily } from './power'

type Series = (number | null)[]

export const dayOfYear = (dayIndex: number) => {
  const d = new Date(dayIndex * 86400000)
  return Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000) + 1
}

/** Extraterrestrial radiation Ra, MJ/m²/day (FAO-56 eq. 21). */
export function extraterrestrialRadiation(latDeg: number, J: number): number {
  const phi = (latDeg * Math.PI) / 180
  const dr = 1 + 0.033 * Math.cos((2 * Math.PI * J) / 365)
  const delta = 0.409 * Math.sin((2 * Math.PI * J) / 365 - 1.39)
  const ws = Math.acos(Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(delta))))
  return ((24 * 60) / Math.PI) * 0.082 * dr * (ws * Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.sin(ws))
}

const svp = (T: number) => 0.6108 * Math.exp((17.27 * T) / (T + 237.3))

/** FAO-56 Penman–Monteith reference ET (mm/day). RH is the daily mean (eq. 19). */
export function et0PenmanMonteith(i: { tmin: number; tmax: number; rh: number; ws: number; rs: number; lat: number; elevation: number; J: number }): number {
  const tmean = (i.tmin + i.tmax) / 2
  const P = 101.3 * Math.pow((293 - 0.0065 * i.elevation) / 293, 5.26)
  const gamma = 0.000665 * P
  const es = (svp(i.tmax) + svp(i.tmin)) / 2
  const ea = (Math.max(0, Math.min(100, i.rh)) / 100) * es
  const delta = (4098 * svp(tmean)) / Math.pow(tmean + 237.3, 2)
  const Ra = extraterrestrialRadiation(i.lat, i.J)
  const Rso = (0.75 + 2e-5 * i.elevation) * Ra
  const Rns = 0.77 * i.rs
  const rel = Rso > 0 ? Math.min(1, i.rs / Rso) : 0.5
  const Rnl = 4.903e-9 * ((Math.pow(i.tmax + 273.16, 4) + Math.pow(i.tmin + 273.16, 4)) / 2) * (0.34 - 0.14 * Math.sqrt(ea)) * (1.35 * rel - 0.35)
  const Rn = Rns - Rnl
  const et0 = (0.408 * delta * Rn + ((gamma * 900) / (tmean + 273)) * i.ws * (es - ea)) / (delta + gamma * (1 + 0.34 * i.ws))
  return Math.max(0, et0)
}

/** Hargreaves reference ET (mm/day), FAO-56 eq. 52. */
export function et0Hargreaves(tmin: number, tmax: number, lat: number, J: number): number {
  const Ra = extraterrestrialRadiation(lat, J)
  return Math.max(0, 0.0023 * ((tmin + tmax) / 2 + 17.8) * Math.sqrt(Math.max(0, tmax - tmin)) * 0.408 * Ra)
}

export function computeEt0(d: Daily): { et0: Series; method: 'penman_monteith' | 'mixed' | 'hargreaves' } {
  const s0 = toDay(d.start)
  let pm = 0
  let hg = 0
  const et0: Series = d.t.map((_, k) => {
    const tmin = d.tmin[k]
    const tmax = d.tmax[k]
    if (tmin === null || tmax === null) return null
    const J = dayOfYear(s0 + k)
    const rh = d.rh[k]
    const ws = d.ws[k]
    const rs = d.rs[k]
    if (rh !== null && ws !== null && rs !== null) {
      pm++
      return et0PenmanMonteith({ tmin, tmax, rh, ws, rs, lat: d.lat, elevation: d.elevation, J })
    }
    hg++
    return et0Hargreaves(tmin, tmax, d.lat, J)
  })
  return { et0, method: hg === 0 ? 'penman_monteith' : pm === 0 ? 'hargreaves' : 'mixed' }
}

/** FAO-56 Kc curve for day `n` (0-based) of the season. */
export function kcAt(n: number, stages: [number, number, number, number], kc: { ini: number; mid: number; end: number }): number {
  const [li, ld, lm, ll] = stages
  if (n < li) return kc.ini
  if (n < li + ld) return kc.ini + ((n - li) / ld) * (kc.mid - kc.ini)
  if (n < li + ld + lm) return kc.mid
  if (n < li + ld + lm + ll) return kc.mid + ((n - li - ld - lm) / ll) * (kc.end - kc.mid)
  return kc.end
}

/** Scales FAO-56 stage lengths to another total season length, keeping proportions. */
export function scaleStages(stages: [number, number, number, number], total: number): [number, number, number, number] {
  const sum = stages.reduce((a, b) => a + b, 0)
  const s = stages.map((x) => Math.max(1, Math.round((x / sum) * total))) as [number, number, number, number]
  s[2] += total - s.reduce((a, b) => a + b, 0)
  return s
}

/** Monthly effective rainfall (mm) — USDA-SCS formula used in FAO CROPWAT. */
export function effectiveRainMonthly(p: number): number {
  return p <= 250 ? (p * (125 - 0.2 * p)) / 125 : 125 + 0.1 * p
}

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)
export const std = (xs: number[]) => {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1))
}
function quantile(xs: number[], q: number) {
  if (!xs.length) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const pos = (s.length - 1) * q
  const lo = Math.floor(pos)
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (pos - lo)
}
const valid = (xs: Series, a: number, b: number): number[] => {
  const out: number[] = []
  for (let k = a; k < b; k++) {
    const v = xs[k]
    if (v !== null && v !== undefined) out.push(v)
  }
  return out
}

export interface Climate {
  daily: Daily
  et0: Series
  et0Method: string
  s0: number
  firstYear: number
  lastYear: number
  /** local threshold of an "extreme rain day" (mm/day) */
  r95: number
  completeness: number
  recordYears: number
  /** year*12 + monthIndex for every day (fast month bucketing) */
  ym: Int32Array
}

export function buildClimate(daily: Daily): Climate {
  const { et0, method } = computeEt0(daily)
  const s0 = toDay(daily.start)
  const wet = daily.pr.filter((v): v is number => v !== null && v >= 1)
  const last = toDay(daily.lastDate) - s0 + 1
  const have = daily.t.slice(0, last).filter((v) => v !== null).length
  const ym = new Int32Array(daily.days)
  for (let k = 0; k < daily.days; k++) {
    const dt = new Date((s0 + k) * 86400000)
    ym[k] = dt.getUTCFullYear() * 12 + dt.getUTCMonth()
  }
  return {
    ym,
    daily,
    et0,
    et0Method: method,
    s0,
    firstYear: +daily.start.slice(0, 4),
    lastYear: +daily.lastDate.slice(0, 4),
    r95: wet.length ? quantile(wet, 0.95) : NaN,
    completeness: last ? have / last : 0,
    recordYears: last / 365.25,
  }
}

export interface SeasonParams {
  startMonth: number // 1-12
  startDay: number
  lengthDays: number
  tBase: number
  heatThreshold: number
  kc?: { ini: number; mid: number; end: number }
  stages?: [number, number, number, number]
  /** 0–100 suitability of one day's mean temperature (crop trapezoid); averaged over the season */
  tempSuitability?: (t: number) => number
}

export interface SeasonYear {
  year: number
  tmean: number
  tminMean: number
  tmaxMean: number
  absMinT: number
  gdd: number
  frostDays: number
  heatDays: number
  rain: number
  longestDrySpell: number
  extremeRainDays: number
  rs: number
  soilWetness: number | null
  et0: number
  etc: number
  effRain: number
  irrigation: number
  /** mean daily temperature suitability over the season (0–100) */
  tempScore: number
  /** water satisfaction: seasonal effective rainfall as a share of seasonal crop water demand ETc (0–1) */
  waterSatisfaction: number
  /** share of the initial-stage water demand met by rain falling in that stage (0–1): are there sowing rains? */
  establishment: number
}

export interface SeasonStats {
  years: SeasonYear[]
  n: number
  tmean: number
  tminMean: number
  tmaxMean: number
  absMinT: number
  gdd: number
  frostDays: number
  frostYearFraction: number
  heatDays: number
  rain: number
  rainCV: number
  longestDrySpell: number
  extremeRainDays: number
  rs: number
  soilWetness: number | null
  et0: number
  etc: number
  effRain: number
  irrigation: number
  tempScore: number
  waterSatisfaction: number
  establishment: number
}

/** Statistics of one candidate season across every year of the record that fully contains it. */
export function seasonStats(c: Climate, p: SeasonParams): SeasonStats {
  const d = c.daily
  const lastIdx = toDay(d.lastDate) - c.s0
  const years: SeasonYear[] = []
  const stages = p.stages ? scaleStages(p.stages, p.lengthDays) : null
  for (let y = c.firstYear; y <= c.lastYear; y++) {
    const a = toDay(`${y}-${String(p.startMonth).padStart(2, '0')}-${String(p.startDay).padStart(2, '0')}`) - c.s0
    const b = a + p.lengthDays
    if (a < 0 || b - 1 > lastIdx) continue
    const t = valid(d.t, a, b)
    if (t.length < p.lengthDays * 0.9) continue
    let gdd = 0
    let frost = 0
    let heat = 0
    let rain = 0
    let dry = 0
    let longest = 0
    let extreme = 0
    let et0 = 0
    let etc = 0
    let absMin = Infinity
    let tsSum = 0
    let tsN = 0
    const iniDays = stages ? stages[0] : Math.min(30, p.lengthDays)
    let iniRain = 0
    let iniEtc = 0
    // monthly buckets for effective rainfall and irrigation requirement
    const pm = new Map<number, { p: number; etc: number }>()
    for (let k = a; k < b; k++) {
      const tm = d.t[k]
      const tn = d.tmin[k]
      const pr = d.pr[k] ?? 0
      if (tm !== null) {
        gdd += Math.max(0, tm - p.tBase)
        // heat-stress day: daily MEAN temperature above the crop's absolute maximum (ECOCROP limits are for mean temperature)
        if (tm > p.heatThreshold) heat++
        if (p.tempSuitability) {
          tsSum += p.tempSuitability(tm)
          tsN++
        }
      }
      if (tn !== null) {
        if (tn < 0) frost++
        if (tn < absMin) absMin = tn
      }
      rain += pr
      if (pr < 1) {
        dry++
        if (dry > longest) longest = dry
      } else dry = 0
      if (Number.isFinite(c.r95) && pr > c.r95) extreme++
      const e0 = c.et0[k] ?? 0
      const kc = stages && p.kc ? kcAt(k - a, stages, p.kc) : 1
      et0 += e0
      etc += e0 * kc
      if (k - a < iniDays) {
        iniRain += pr
        iniEtc += e0 * kc
      }
      const mk = c.ym[k]
      const m = pm.get(mk) ?? { p: 0, etc: 0 }
      m.p += pr
      m.etc += e0 * kc
      pm.set(mk, m)
    }
    let eff = 0
    let irr = 0
    let effSeason = 0 // effective rain of the whole season: winter surplus is assumed stored in the soil for later months
    for (const m of pm.values()) {
      const em = effectiveRainMonthly(m.p)
      const e = Math.min(em, m.etc)
      effSeason += em
      eff += e
      irr += Math.max(0, m.etc - e)
    }
    const gw = valid(d.gwr, a, b)
    years.push({
      year: y,
      tmean: mean(t),
      tminMean: mean(valid(d.tmin, a, b)),
      tmaxMean: mean(valid(d.tmax, a, b)),
      absMinT: absMin,
      gdd,
      frostDays: frost,
      heatDays: heat,
      rain,
      longestDrySpell: longest,
      extremeRainDays: extreme,
      rs: mean(valid(d.rs, a, b)),
      soilWetness: gw.length ? mean(gw) : null,
      et0,
      etc,
      effRain: eff,
      irrigation: irr,
      tempScore: tsN ? tsSum / tsN : NaN,
      waterSatisfaction: etc > 0 ? Math.min(1, effSeason / etc) : 1,
      establishment: iniEtc > 0 ? Math.min(1, iniRain / iniEtc) : 1,
    })
  }
  const col = (f: (y: SeasonYear) => number) => mean(years.map(f))
  const rains = years.map((y) => y.rain)
  const sw = years.map((y) => y.soilWetness).filter((v): v is number => v !== null)
  return {
    years,
    n: years.length,
    tmean: col((y) => y.tmean),
    tminMean: col((y) => y.tminMean),
    tmaxMean: col((y) => y.tmaxMean),
    absMinT: years.length ? Math.min(...years.map((y) => y.absMinT)) : NaN,
    gdd: col((y) => y.gdd),
    frostDays: col((y) => y.frostDays),
    frostYearFraction: years.length ? years.filter((y) => y.frostDays > 0).length / years.length : 0,
    heatDays: col((y) => y.heatDays),
    rain: mean(rains),
    rainCV: mean(rains) > 0 ? std(rains) / mean(rains) : 0,
    longestDrySpell: col((y) => y.longestDrySpell),
    extremeRainDays: col((y) => y.extremeRainDays),
    rs: col((y) => y.rs),
    soilWetness: sw.length ? mean(sw) : null,
    et0: col((y) => y.et0),
    etc: col((y) => y.etc),
    effRain: col((y) => y.effRain),
    irrigation: col((y) => y.irrigation),
    tempScore: col((y) => y.tempScore),
    waterSatisfaction: col((y) => y.waterSatisfaction),
    establishment: col((y) => y.establishment),
  }
}

export const fractionOfYearsMeeting = (s: SeasonStats, minRain: number) => (s.n ? s.years.filter((y) => y.rain >= minRain).length / s.n : 0)

// ---- dekads (10-day periods, 36 per year) ----
export const DEKADS = 36
export function dekadStart(k: number): { month: number; day: number } {
  return { month: Math.floor(k / 3) + 1, day: [1, 11, 21][k % 3] }
}
export function dekadOf(month: number, day: number): number {
  return (month - 1) * 3 + (day >= 21 ? 2 : day >= 11 ? 1 : 0)
}

/** Probability (fraction of years) of at least one frost day / hot day in each dekad. */
export function dekadProbabilities(c: Climate, heatThreshold: number): { frost: number[]; heat: number[] } {
  const d = c.daily
  const frostY: Set<number>[] = Array.from({ length: DEKADS }, () => new Set())
  const heatY: Set<number>[] = Array.from({ length: DEKADS }, () => new Set())
  const seen: Set<number>[] = Array.from({ length: DEKADS }, () => new Set())
  for (let k = 0; k < d.days; k++) {
    const iso = fromDay(c.s0 + k)
    const y = +iso.slice(0, 4)
    const dk = dekadOf(+iso.slice(5, 7), +iso.slice(8, 10))
    const tn = d.tmin[k]
    const tm = d.t[k]
    if (tn === null && tm === null) continue
    seen[dk].add(y)
    if (tn !== null && tn < 0) frostY[dk].add(y)
    if (tm !== null && tm > heatThreshold) heatY[dk].add(y)
  }
  return {
    frost: frostY.map((s, i) => (seen[i].size ? s.size / seen[i].size : 0)),
    heat: heatY.map((s, i) => (seen[i].size ? s.size / seen[i].size : 0)),
  }
}

export interface MonthlyRow {
  key: string // YYYY-MM
  year: number
  month: number
  t: number | null
  tmin: number | null
  tmax: number | null
  rh: number | null
  rs: number | null
  rain: number | null
  gwt: number | null
  gwr: number | null
  et0: number | null
  days: number
}

/** Calendar-month aggregates for every month in the record. */
export function monthlySeries(c: Climate): MonthlyRow[] {
  const d = c.daily
  const groups = new Map<string, number[]>()
  const lastIdx = toDay(d.lastDate) - c.s0
  for (let k = 0; k <= lastIdx; k++) {
    const key = fromDay(c.s0 + k).slice(0, 7)
    ;(groups.get(key) ?? groups.set(key, []).get(key)!).push(k)
  }
  const avg = (xs: Series, idx: number[]) => {
    const v = idx.map((k) => xs[k]).filter((x): x is number => x !== null)
    return v.length ? mean(v) : null
  }
  const sum = (xs: Series, idx: number[]) => {
    const v = idx.map((k) => xs[k]).filter((x): x is number => x !== null)
    return v.length >= idx.length * 0.8 ? v.reduce((a, b) => a + b, 0) * (idx.length / v.length) : null
  }
  return [...groups.entries()].map(([key, idx]) => ({
    key,
    year: +key.slice(0, 4),
    month: +key.slice(5, 7),
    t: avg(d.t, idx),
    tmin: avg(d.tmin, idx),
    tmax: avg(d.tmax, idx),
    rh: avg(d.rh, idx),
    rs: avg(d.rs, idx),
    rain: sum(d.pr, idx),
    gwt: avg(d.gwt, idx),
    gwr: avg(d.gwr, idx),
    et0: sum(c.et0, idx),
    days: idx.length,
  }))
}

/** Mean of each calendar month over full months only (month 1..12). */
export function monthlyClimatology(rows: MonthlyRow[], pick: (r: MonthlyRow) => number | null, excludeKey?: string): (number | null)[] {
  return Array.from({ length: 12 }, (_, m) => {
    const v = rows.filter((r) => r.month === m + 1 && r.days >= 27 && r.key !== excludeKey).map(pick).filter((x): x is number => x !== null)
    return v.length ? mean(v) : null
  })
}

/** Least-squares slope per step (used for soil-moisture trend). */
export function slope(xs: number[]): number {
  const n = xs.length
  if (n < 2) return 0
  const mx = (n - 1) / 2
  const my = mean(xs)
  let num = 0
  let den = 0
  xs.forEach((y, i) => {
    num += (i - mx) * (y - my)
    den += (i - mx) ** 2
  })
  return den ? num / den : 0
}
