import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Marker, useMapEvents } from 'react-leaflet'
import type { LatLngExpression } from 'leaflet'
import { FlyTo, JordanMap, pinIcon } from '../../components/map/JordanMap'
import { PlaceSearch } from '../../components/map/PlaceSearch'
import { Button, Card } from '../../components/ui/primitives'
import { Banner } from '../../components/ui/states'
import { Icon } from '../../components/ui/Icon'
import { useLocate } from '../../hooks/queries'
import type { Governorate } from '../../lib/types'
import { num } from '../../lib/format'

type State = 'idle' | 'asking' | 'detecting' | 'detected' | 'denied' | 'outside' | 'manual'

export interface LocatedPoint {
  lat: number
  lon: number
  governorate: Governorate | null
}

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
  const locate = useLocate()

  const resolve = async (lat: number, lon: number, zoom = 15, fromGps = false) => {
    setError(null)
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
    if (!('geolocation' in navigator)) {
      setError(t('setup.locate.unsupportedGeo'))
      setState('denied')
      return
    }
    try {
      const perm = await navigator.permissions?.query({ name: 'geolocation' as PermissionName })
      setState(perm?.state === 'granted' ? 'detecting' : 'asking')
    } catch {
      setState('asking')
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lon } = pos.coords
        setState('detecting')
        setPoint({ lat, lon, governorate: null })
        setFly({ c: [lat, lon], z: 16 })
        // brief pause so the pulsing "detecting" marker is visible while we resolve the governorate
        setTimeout(() => resolve(lat, lon, 16, true), 600)
      },
      () => setState('denied'),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    )
  }

  const canClickMap = state === 'denied' || state === 'outside' || state === 'manual'
  const govName = point?.governorate ? (i18n.language === 'ar' ? point.governorate.name_ar : point.governorate.name_en) : '—'

  return (
    <div className="grid grid-cols-12 gap-6 h-full">
      <div className="col-span-4 flex flex-col gap-4 overflow-y-auto">
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

          {(state === 'detected' || state === 'manual') && point && (
            <div className="flex flex-col gap-4" aria-live="polite">
              {state === 'detected' && (
                <p className="flex items-center gap-2 text-body font-semibold text-green-700">
                  <Icon name="check" size={18} /> {t('setup.locate.detected')}
                </p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-surface-muted rounded-tile p-4">
                  <p className="text-caption text-text-secondary">{t('setup.locate.governorate')}</p>
                  <p className="text-body font-semibold mt-1">{govName}</p>
                </div>
                <div className="bg-surface-muted rounded-tile p-4">
                  <p className="text-caption text-text-secondary">{t('setup.locate.coordinates')}</p>
                  <p className="text-label font-semibold mt-1 tabular-nums" dir="ltr">
                    {num(point.lat, 4)}, {num(point.lon, 4)}
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
              {state === 'manual' && <p className="text-caption text-text-secondary">{t('setup.locate.moveHint')}</p>}
            </div>
          )}

          {state === 'denied' && (
            <Banner icon="info" tone="warning">
              <b className="font-semibold block">{t('setup.locate.denied')}</b>
              {t('setup.locate.deniedBody')}
            </Banner>
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
            <button className="text-label text-green-600 hover:underline self-start" onClick={() => setState('denied')}>
              {t('setup.locate.notMine')}
            </button>
          )}
        </Card>
      </div>

      <div className="col-span-8 rounded-card overflow-hidden relative min-h-[480px]">
        <JordanMap>
          <ClickToSet enabled={canClickMap} onPick={(lat, lon) => resolve(lat, lon, undefined)} />
          {fly && <FlyTo center={fly.c} zoom={fly.z} />}
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
