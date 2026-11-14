/**
 * Location detection without a backend.
 *
 * 1) Browser Geolocation, network-based (fast; works on laptops with no GPS)
 * 2) Browser Geolocation, high accuracy (GPS on phones)
 * 3) Approximate position from the internet connection (IP lookup, city level)
 *
 * Step 3 calls a public key-less service; the request carries nothing but the visitor's IP
 * address (as any web request does). Set VITE_IP_GEO_URL to "off" to disable it, or to another
 * endpoint that returns JSON with latitude / longitude.
 */

export type LocateSource = 'device' | 'network'
export type LocateFailure = 'denied' | 'insecure' | 'unsupported' | 'unavailable'

export interface Located {
  lat: number
  lon: number
  /** metres; for 'network' this is a rough city-level estimate */
  accuracy: number | null
  source: LocateSource
  /** why the device position could not be used, when we fell back to the network estimate */
  deviceFailure?: LocateFailure
}

export class LocateError extends Error {
  reason: LocateFailure
  constructor(reason: LocateFailure) {
    super(reason)
    this.reason = reason
  }
}

const IP_SERVICES: string[] = (() => {
  const custom: string = import.meta.env?.VITE_IP_GEO_URL ?? ''
  if (custom === 'off') return []
  if (/^https:\/\//.test(custom)) return [custom]
  return ['https://get.geojs.io/v1/ip/geo.json', 'https://ipwho.is/']
})()

function browserPosition(options: PositionOptions): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, options))
}

async function networkEstimate(): Promise<{ lat: number; lon: number } | null> {
  for (const url of IP_SERVICES) {
    try {
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), 7000)
      const res = await fetch(url, { signal: ctl.signal, credentials: 'omit', referrerPolicy: 'no-referrer' })
      clearTimeout(timer)
      if (!res.ok) continue
      const j = (await res.json()) as { latitude?: number | string; longitude?: number | string; success?: boolean }
      if (j.success === false) continue
      const lat = Number(j.latitude)
      const lon = Number(j.longitude)
      if (Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0)) return { lat, lon }
    } catch {
      /* try the next service */
    }
  }
  return null
}

/**
 * Resolves with the best position available, or rejects with a LocateError that says why.
 * `onStage` lets the UI show what is happening ("asking permission" → "detecting").
 */
export async function detectLocation(onStage?: (stage: 'asking' | 'detecting') => void): Promise<Located> {
  let failure: LocateFailure | null = null

  if (!('geolocation' in navigator)) failure = 'unsupported'
  else if (!window.isSecureContext) failure = 'insecure' // browsers only allow geolocation on https or localhost
  else {
    try {
      const perm = await navigator.permissions?.query({ name: 'geolocation' as PermissionName })
      onStage?.(perm?.state === 'granted' ? 'detecting' : 'asking')
    } catch {
      onStage?.('asking')
    }
    try {
      // Wi-Fi / network positioning: quick, and the only thing most computers have
      const p = await browserPosition({ enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 })
      onStage?.('detecting')
      let best = p
      if (p.coords.accuracy > 1500) {
        // coarse fix: give GPS a short chance to do better (phones); keep the coarse one if it cannot
        try {
          best = await browserPosition({ enableHighAccuracy: true, timeout: 8000, maximumAge: 0 })
        } catch {
          best = p
        }
      }
      return { lat: best.coords.latitude, lon: best.coords.longitude, accuracy: best.coords.accuracy, source: 'device' }
    } catch (e) {
      const code = (e as GeolocationPositionError).code
      if (code === 1) failure = 'denied'
      else {
        onStage?.('detecting')
        try {
          const p = await browserPosition({ enableHighAccuracy: true, timeout: 12000, maximumAge: 0 })
          return { lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy, source: 'device' }
        } catch (e2) {
          failure = (e2 as GeolocationPositionError).code === 1 ? 'denied' : 'unavailable'
        }
      }
    }
  }

  onStage?.('detecting')
  const est = await networkEstimate()
  if (est) return { ...est, accuracy: null, source: 'network', deviceFailure: failure ?? 'unavailable' }
  throw new LocateError(failure ?? 'unavailable')
}
