/**
 * NASA POWER daily point client (no authentication, CORS enabled).
 * Parameter names verified against the live API (v2.10.3, community=AG):
 *   T2M, T2M_MIN, T2M_MAX (°C) · RH2M (%) · WS2M (m/s) · ALLSKY_SFC_SW_DWN (MJ/m²/day)
 *   PRECTOTCORR (mm/day) · GWETTOP, GWETROOT (soil wetness, 0–1 fraction — not volumetric, not SMAP)
 * Responses are cached in IndexedDB keyed by the 0.5° cell; the fill value (-999) becomes null.
 */
import { ApiError } from '../api'

export const POWER_URL = 'https://power.larc.nasa.gov/api/temporal/daily/point'
export const POWER_PARAMS = ['T2M', 'T2M_MIN', 'T2M_MAX', 'RH2M', 'WS2M', 'ALLSKY_SFC_SW_DWN', 'PRECTOTCORR', 'GWETTOP', 'GWETROOT'] as const
export const HISTORY_YEARS = 12
const TTL_MS = 24 * 60 * 60 * 1000

type Series = (number | null)[]
export interface Daily {
  cell: string
  lat: number
  lon: number
  elevation: number
  start: string // YYYY-MM-DD of index 0
  days: number
  t: Series
  tmin: Series
  tmax: Series
  rh: Series
  ws: Series
  rs: Series
  pr: Series
  gwt: Series
  gwr: Series
  fetchedAt: string
  /** last date that has a temperature value */
  lastDate: string
  fromCache: boolean
}

const DAY = 86400000
export const toDay = (iso: string) => Math.floor(Date.parse(iso + 'T00:00:00Z') / DAY)
export const fromDay = (d: number) => new Date(d * DAY).toISOString().slice(0, 10)

export function cellOf(lat: number, lon: number): { key: string; lat: number; lon: number } {
  const la = Math.round(lat * 2) / 2
  const lo = Math.round(lon * 2) / 2
  return { key: `${la.toFixed(1)}_${lo.toFixed(1)}`, lat: la, lon: lo }
}

// ---- tiny IndexedDB key-value cache (falls back to memory) ----
const mem = new Map<string, Daily>()
function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open('ardna-env', 1)
    r.onupgradeneeded = () => r.result.createObjectStore('power')
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}
async function cacheGet(key: string): Promise<Daily | null> {
  if (mem.has(key)) return mem.get(key)!
  try {
    const d = await db()
    return await new Promise((res) => {
      const rq = d.transaction('power').objectStore('power').get(key)
      rq.onsuccess = () => res((rq.result as Daily) ?? null)
      rq.onerror = () => res(null)
    })
  } catch {
    return null
  }
}
async function cachePut(key: string, v: Daily) {
  mem.set(key, v)
  try {
    const d = await db()
    d.transaction('power', 'readwrite').objectStore('power').put(v, key)
  } catch {
    /* memory only */
  }
}

/** Converts a raw POWER JSON response into aligned daily arrays. Exported for tests. */
export function parsePower(json: unknown, cell: string, lat: number, lon: number): Daily {
  const j = json as { geometry?: { coordinates?: number[] }; properties?: { parameter?: Record<string, Record<string, number>> }; header?: { fill_value?: number } }
  const p = j?.properties?.parameter
  if (!p || !p.T2M) throw new ApiError(502, 'MISSING_DATA', 'NASA POWER returned no data')
  const fill = j.header?.fill_value ?? -999
  const keys = Object.keys(p.T2M).sort()
  const iso = (k: string) => `${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}`
  const start = iso(keys[0])
  const s0 = toDay(start)
  const days = toDay(iso(keys[keys.length - 1])) - s0 + 1
  const mk = (name: string): Series => {
    const out: Series = new Array(days).fill(null)
    const src = p[name] ?? {}
    for (const k of Object.keys(src)) {
      const v = src[k]
      if (v !== fill && v !== null && Number.isFinite(v) && v > -900) out[toDay(iso(k)) - s0] = Math.round(v * 100) / 100
    }
    return out
  }
  const t = mk('T2M')
  let last = days - 1
  while (last > 0 && t[last] === null) last--
  return {
    cell,
    lat,
    lon,
    elevation: j.geometry?.coordinates?.[2] ?? 0,
    start,
    days,
    t,
    tmin: mk('T2M_MIN'),
    tmax: mk('T2M_MAX'),
    rh: mk('RH2M'),
    ws: mk('WS2M'),
    rs: mk('ALLSKY_SFC_SW_DWN'),
    pr: mk('PRECTOTCORR'),
    gwt: mk('GWETTOP'),
    gwr: mk('GWETROOT'),
    fetchedAt: new Date().toISOString(),
    lastDate: fromDay(s0 + last),
    fromCache: false,
  }
}

const inflight = new Map<string, Promise<Daily>>()

/** At least 10 full years of daily history for the 0.5° cell containing the point. */
export async function getDaily(lat: number, lon: number): Promise<Daily> {
  const cell = cellOf(lat, lon)
  const cached = await cacheGet(cell.key)
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < TTL_MS) return { ...cached, fromCache: true }
  if (inflight.has(cell.key)) return inflight.get(cell.key)!
  const job = (async () => {
    const now = new Date()
    const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '')
    const startDate = new Date(Date.UTC(now.getUTCFullYear() - HISTORY_YEARS, 0, 1))
    const url = `${POWER_URL}?parameters=${POWER_PARAMS.join(',')}&community=AG&longitude=${lon.toFixed(4)}&latitude=${lat.toFixed(4)}&start=${fmt(startDate)}&end=${fmt(new Date(now.getTime() - DAY))}&format=JSON`
    try {
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), 90000)
      const res = await fetch(url, { signal: ctl.signal })
      clearTimeout(timer)
      if (!res.ok) throw new ApiError(res.status, res.status === 429 ? 'RATE_LIMITED' : 'UPSTREAM_ERROR', `NASA POWER responded ${res.status}`)
      const daily = parsePower(await res.json(), cell.key, lat, lon)
      await cachePut(cell.key, daily)
      return daily
    } catch (e) {
      if (cached) return { ...cached, fromCache: true } // offline / upstream failure: fall back to the stored copy
      if (e instanceof ApiError) throw e
      throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach NASA POWER')
    } finally {
      inflight.delete(cell.key)
    }
  })()
  inflight.set(cell.key, job)
  return job
}
