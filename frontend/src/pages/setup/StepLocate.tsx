import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Circle, Marker, useMapEvents } from 'react-leaflet'
import type { LatLngExpression } from 'leaflet'
import { FlyTo, JordanMap, pinIcon } from '../../components/map/JordanMap'
import { PlaceSearch } from '../../components/map/PlaceSearch'
import { Button, Card } from '../../components/ui/primitives'
import { Banner } from '../../components/ui/states'
import { Icon } from '../../components/ui/Icon'
import { useLocate } from '../../hooks/queries'
import type { Governorate } from '../../lib/types'
import { num } from '../../lib/format'
import { detectLocation, LocateError, PRECISE_M, type LocateFailure } from '../../lib/locate'

type State = 'idle' | 'asking' | 'detecting' | 'detected' | 'denied' | 'outside' | 'manual'

export interface LocatedPoint {
  lat: number
  lon: number
  governorate: Governorate | null
}

/** Accuracy radius for display: whole metres, rounded to tens above 100 m. */
const accMetres = (m: number) => num(m > 100 ? Math.round(m / 10) * 10 : Math.max(1, Math.round(m)), 0)

function ClickToSet({ enabled, onPick }: { enabled: boolean; onPick: (lat: number, lon: number) => void }) {
  useMapEvents({
    click(e) {
      if (enabled) onPick(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}

export function StepLocate({ initial, onConfirm }: { initial: LocatedPoint | null; onConfirm: (p: LocatedPoint) => void }) {
  const { t, i18n } = useTranslation()
  const [state, setState] = useState<State>(initial ? 'detected' : 'idle')
  const [point, setPoint] = useState<LocatedPoint | null>(initial)
  const [fly, setFly] = useState<{ c: LatLngExpression; z: number } | null>(initial ? { c: [initial.lat, initial.lon], z: 15 } : null)
  const [error, setError] = useState<string | null>(null)
  // why the device position failed (shown to the user), and whether the pin is only a network estimate
  const [failure, setFailure] = useState<LocateFailure | null>(null)
  const [approximate, setApproximate] = useState(false)
  // accuracy radius (metres) of the device fix behind the pin; null once the user places the pin
  const [accuracy, setAccuracy] = useState<number | null>(null)
  const locate = useLocate()

  const resolve = async (lat: number, lon: number, zoom = 15, fromGps = false, approx = false, radius: number | null = null) => {
    setError(null)
    setApproximate(approx)
    setAccuracy(radius)
    try {
      const r = await locate.mutateAsync({ lat, lon })
      setPoint({ lat, lon, governorate: r.governorate })
      setFly({ c: [lat, lon], z: zoom })
      if (!r.inside_jordan) setState('outside')
      else setState(fromGps ? 'detected' : 'manual')
    } catch {
      setError(t('states.errorBody'))
    }
  }

  const ask = async () => {
    setError(null)
    setFailure(null)
    setApproximate(false)
    setState('asking')
    try {
      const found = await detectLocation((stage) => setState(stage))
      setState('detecting')
      const acc = found.accuracy
      if (found.source === 'device' && acc != null && acc <= PRECISE_M) {
        setPoint({ lat: found.lat, lon: found.lon, governorate: null })
        setFly({ c: [found.lat, found.lon], z: 18 })
        // brief pause so the pulsing "detecting" marker is visible while we resolve the governorate
        setTimeout(() => resolve(found.lat, found.lon, 18, true, false, acc), 600)
      } else if (found.source === 'device') {
        // the device has no precise fix (no GPS, or indoors): never present it as the land itself.
        // Show how far off it may be and let the user put the pin on the land.
        const r = acc ?? 5000
        await resolve(found.lat, found.lon, r <= 150 ? 17 : r <= 600 ? 15 : r <= 2500 ? 13 : 11, false, true, r)
      } else {
        // only a city-level estimate from the internet connection: show it, and ask the user to refine
        setFailure(found.deviceFailure ?? null)
        await resolve(found.lat, found.lon, 11, false, true)
      }
    } catch (e) {
      setFailure(e instanceof LocateError ? e.reason : 'unavailable')
      setState('denied')
    }
  }

  const canClickMap = state === 'denied' || state === 'outside' || state === 'manual'
  const govName = point?.governorate ? (i18n.language === 'ar' ? point.governorate.name_ar : point.governorate.name_en) : '—'

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6 h-full">
      <div className="lg:col-span-4 flex flex-col gap-4 lg:overflow-y-auto">
        <Card className="flex flex-col gap-5">
          <span className="size-14 rounded-pill border border-border flex items-center justify-center text-green-600">
            <Icon name="locate" size={28} />
          </span>
          <div>
            <h2 className="text-h1 font-semibold">{t('setup.locate.title')}</h2>
            <p className="text-body text-text-secondary mt-2">{t('setup.locate.body')}</p>
          </div>

          {state === 'idle' && (
            <Button size="lg" icon="locate" onClick={ask}>
              {t('setup.locate.allow')}
            </Button>
          )}

          {(state === 'asking' || state === 'detecting') && (
            <div className="flex items-center gap-3 text-body" role="status" aria-live="polite">
              <span className="pulse-marker shrink-0" aria-hidden />
              {state === 'asking' ? t('setup.locate.asking') : t('setup.locate.detecting')}
            </div>
          )}

          {approximate && state === 'manual' && (
            <Banner icon="info" tone="warning">
              <b className="font-semibold block">{accuracy != null ? t('setup.locate.approxDevice', { m: accMetres(accuracy) }) : t('setup.locate.approx')}</b>
              {accuracy != null ? t('setup.locate.approxDeviceBody') : t('setup.locate.approxBody')}
              {failure && <span className="block text-caption text-text-secondary mt-1">{t(`setup.locate.reasons.${failure}`)}</span>}
            </Banner>
          )}
          {(state === 'detected' || state === 'manual') && point && (
            <div className="flex flex-col gap-4" aria-live="polite">
              {state === 'detected' && (
                <p className="flex items-center gap-2 text-body font-semibold text-green-700">
                  <Icon name="check" size={18} /> {t('setup.locate.detected')}
                  {accuracy != null && <span className="text-caption font-normal text-text-secondary">{t('setup.locate.accuracy', { m: accMetres(accuracy) })}</span>}
                </p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-surface-muted rounded-tile p-4">
                  <p className="text-caption text-text-secondary">{t('setup.locate.governorate')}</p>
                  <p className="text-body font-semibold mt-1">{govName}</p>
                </div>
                <div className="bg-surface-muted rounded-tile p-4">
                  <p className="text-caption text-text-secondary">{t('setup.locate.coordinates')}</p>
                  <p className="text-caption font-semibold mt-1.5 tabular-nums whitespace-nowrap" dir="ltr">
                    {num(point.lat, 5)}, {num(point.lon, 5)}
                  </p>
                </div>
              </div>
              <Button size="lg" onClick={() => onConfirm(point)} iconEnd="arrowRight">
                {t('setup.locate.useThis')}
              </Button>
              {state === 'detected' && (
                <Button variant="secondary" onClick={() => setState('manual')}>
                  {t('setup.locate.notMine')}
                </Button>
              )}
              {approximate && state === 'manual' && (
                <Button variant="secondary" icon="locate" onClick={ask}>
                  {t('setup.locate.retryPrecise')}
                </Button>
              )}
              {state === 'manual' && <p className="text-caption text-text-secondary">{t('setup.locate.moveHint')}</p>}
            </div>
          )}

          {state === 'denied' && (
            <>
              <Banner icon="info" tone="warning">
                <b className="font-semibold block">{t('setup.locate.denied')}</b>
                {failure && <span className="block">{t(`setup.locate.reasons.${failure}`)}</span>}
                {t('setup.locate.deniedBody')}
              </Banner>
              <Button variant="secondary" icon="rotate" onClick={ask}>
                {t('common.retry')}
              </Button>
            </>
          )}
          {state === 'outside' && (
            <Banner icon="pin" tone="warning">
              <b className="font-semibold block">{t('setup.locate.outside')}</b>
              {t('setup.locate.outsideBody')}
            </Banner>
          )}
          {error && <Banner icon="alert" tone="critical">{error}</Banner>}

          {(state === 'denied' || state === 'outside' || state === 'manual') && (
            <div className="flex flex-col gap-2">
              <PlaceSearch onPick={(p) => resolve(p.lat, p.lon, p.zoom)} />
              <p className="text-caption text-text-tertiary">{t('setup.locate.clickMap')}</p>
            </div>
          )}
          {state === 'idle' && (
            <button className="text-label text-green-600 hover:underline self-start" onClick={() => setState('manual')}>
              {t('setup.locate.chooseManually')}
            </button>
          )}
        </Card>
      </div>

      <div className="lg:col-span-8 rounded-card overflow-hidden relative min-h-[360px]">
        <JordanMap showCoords>
          <ClickToSet enabled={canClickMap} onPick={(lat, lon) => resolve(lat, lon, undefined)} />
          {fly && <FlyTo center={fly.c} zoom={fly.z} />}
          {point && accuracy != null && state !== 'detecting' && (
            <Circle center={[point.lat, point.lon]} radius={accuracy} interactive={false} pathOptions={{ color: '#2F8F4E', weight: 1.5, fillColor: '#2F8F4E', fillOpacity: 0.12 }} />
          )}
          {point && state !== 'detecting' && (
            <Marker
              position={[point.lat, point.lon]}
              icon={pinIcon()}
              draggable={canClickMap || state === 'detected'}
              eventHandlers={{
                dragend: (e) => {
                  const ll = e.target.getLatLng()
                  if (state === 'detected') setState('manual')
                  resolve(ll.lat, ll.lng)
                },
              }}
            />
          )}
          {state === 'detecting' && point && <Marker position={[point.lat, point.lon]} icon={pinIcon(true)} />}
        </JordanMap>
      </div>
    </div>
  )
}
