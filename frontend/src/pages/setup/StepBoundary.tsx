import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Marker, Polygon as LPolygon, Polyline, useMapEvents } from 'react-leaflet'
import * as turf from '@turf/turf'
import type { Polygon } from 'geojson'
import { JordanMap, isInJordanClient, vertexIcon, FitGeometry } from '../../components/map/JordanMap'
import { Button, Card, Field, IconButton, Input } from '../../components/ui/primitives'
import { Banner } from '../../components/ui/states'
import { area as fmtArea } from '../../lib/format'
import type { Governorate } from '../../lib/types'
import { ApiError } from '../../lib/api'

type Pt = [number, number] // [lat, lon]

function DrawClicks({ enabled, onAdd }: { enabled: boolean; onAdd: (p: Pt) => void }) {
  useMapEvents({
    click(e) {
      if (enabled) onAdd([e.latlng.lat, e.latlng.lng])
    },
  })
  return null
}

export function polygonFromPts(pts: Pt[]): Polygon | null {
  if (pts.length < 3) return null
  const ring = pts.map(([la, lo]) => [lo, la])
  ring.push(ring[0])
  return { type: 'Polygon', coordinates: [ring] }
}

export function StepBoundary({
  center,
  governorate,
  initialName,
  initialBoundary,
  saving,
  onBack,
  onConfirm,
}: {
  center: { lat: number; lon: number }
  governorate: Governorate | null
  initialName: string
  initialBoundary: Polygon | null
  saving: boolean
  onBack: () => void
  onConfirm: (name: string, boundary: Polygon) => Promise<void>
}) {
  const { t, i18n } = useTranslation()
  const [pts, setPts] = useState<Pt[]>(() => (initialBoundary ? initialBoundary.coordinates[0].slice(0, -1).map(([lo, la]) => [la, lo] as Pt) : []))
  const [closed, setClosed] = useState(!!initialBoundary)
  const [history, setHistory] = useState<{ pts: Pt[]; closed: boolean }[]>([])
  const [name, setName] = useState(initialName)
  const [err, setErr] = useState<string | null>(null)
  const [nameErr, setNameErr] = useState<string | null>(null)

  const poly = useMemo(() => polygonFromPts(pts), [pts])
  const areaM2 = poly && closed ? turf.area(poly) : poly ? turf.area(poly) : 0
  const kinks = poly ? turf.kinks(turf.polygon(poly.coordinates)).features.length > 0 : false
  const outside = pts.some(([la, lo]) => !isInJordanClient(la, lo))

  const push = (next: Pt[], nextClosed = closed) => {
    setHistory((h) => [...h.slice(-50), { pts, closed }])
    setPts(next)
    setClosed(nextClosed)
  }
  const undo = () => {
    const last = history[history.length - 1]
    if (!last) return
    setHistory((h) => h.slice(0, -1))
    setPts(last.pts)
    setClosed(last.closed)
  }

  const confirm = async () => {
    setErr(null)
    if (!name.trim()) return setNameErr(t('auth.required'))
    setNameErr(null)
    if (!poly || !closed) return setErr(t('setup.boundary.needMore'))
    if (areaM2 < 250) return setErr(t('setup.boundary.tooSmall'))
    try {
      await onConfirm(name.trim(), poly)
    } catch (e) {
      const a = e as ApiError
      setErr(a.code === 'UNSUPPORTED_LOCATION' ? t('setup.boundary.outside') : a.message || t('states.errorBody'))
    }
  }

  const govName = governorate ? (i18n.language === 'ar' ? governorate.name_ar : governorate.name_en) : '—'
  const line: Pt[] = closed ? [...pts, pts[0]] : pts

  return (
    <div className="grid grid-cols-12 gap-6 h-full">
      <div className="col-span-8 rounded-card overflow-hidden relative min-h-[480px]">
        <JordanMap center={[center.lat, center.lon]} zoom={17}>
          {initialBoundary && <FitGeometry geometry={initialBoundary} padding={60} />}
          <DrawClicks enabled={!closed} onAdd={(p) => push([...pts, p])} />
          {closed && poly && <LPolygon positions={pts} pathOptions={{ color: '#FFFFFF', weight: 2, fillColor: '#4FA867', fillOpacity: 0.25 }} interactive={false} />}
          {!closed && pts.length > 1 && <Polyline positions={line} pathOptions={{ color: '#FFFFFF', weight: 2, dashArray: '6 4' }} interactive={false} />}
          {pts.map((p, i) => (
            <Marker
              key={i}
              position={p}
              draggable
              icon={vertexIcon(i === 0, !closed && pts.length >= 3)}
              keyboard
              title={`${i + 1}`}
              eventHandlers={{
                click: () => {
                  if (i === 0 && !closed && pts.length >= 3) push(pts, true)
                },
                dragend: (e) => {
                  const ll = e.target.getLatLng()
                  const next = [...pts]
                  next[i] = [ll.lat, ll.lng]
                  push(next)
                },
              }}
            />
          ))}
        </JordanMap>
        <div className="absolute top-4 start-4 z-[1000] flex gap-2 no-print">
          <IconButton icon="undo" label={t('common.undo')} onClick={undo} disabled={history.length === 0} />
          <IconButton icon="trash" label={t('common.clear')} onClick={() => push([], false)} disabled={pts.length === 0} />
        </div>
        <div className="absolute bottom-6 inset-x-0 z-[1000] flex justify-center pointer-events-none">
          <span className="bg-surface/95 rounded-pill px-4 py-2 text-label shadow-soft">
            {closed ? t('setup.boundary.dragHint') : pts.length < 3 ? t('setup.boundary.needMore') : t('setup.boundary.body')}
          </span>
        </div>
      </div>

      <div className="col-span-4 flex flex-col gap-4 overflow-y-auto">
        <Card className="flex flex-col gap-5">
          <div>
            <h2 className="text-h1 font-semibold">{t('setup.boundary.title')}</h2>
            <p className="text-body text-text-secondary mt-2">{t('setup.boundary.body')}</p>
          </div>
          <Field label={t('setup.boundary.farmName')} htmlFor="farm-name" error={nameErr}>
            <Input id="farm-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('setup.boundary.farmNamePh')} aria-invalid={!!nameErr} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-surface-muted rounded-tile p-4">
              <p className="text-caption text-text-secondary">{t('setup.boundary.governorate')}</p>
              <p className="text-body font-semibold mt-1">{govName}</p>
            </div>
            <div className="bg-surface-muted rounded-tile p-4">
              <p className="text-caption text-text-secondary">{t('setup.boundary.area')}</p>
              <p className="text-body font-semibold mt-1 tabular-nums" aria-live="polite">{fmtArea(areaM2)}</p>
            </div>
          </div>
          <p className="text-caption text-text-secondary">
            {t('setup.boundary.points', { n: pts.length })}
            {closed && <> · {t('setup.boundary.closed')}</>}
          </p>
          {kinks && <Banner icon="alert" tone="warning">{t('states.validation')}</Banner>}
          {outside && <Banner icon="pin" tone="warning">{t('setup.boundary.outside')}</Banner>}
          {err && <Banner icon="alert" tone="critical">{err}</Banner>}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onBack} icon="arrowLeft" className="ltr:[&_svg]:scale-x-100 rtl:[&_svg]:-scale-x-100">
              {t('common.back')}
            </Button>
            <Button className="flex-1" onClick={confirm} loading={saving} disabled={!closed || kinks || outside}>
              {t('common.confirm')}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}
