// Forecast outlook: the AI team's 30- and 90-day forecasts from a planting start date, with three
// ranked crops per period. Everything shown comes from the backend; this file only lays it out.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Button, Card, Field, Input, Pill, Skeleton, Tabs, Tile } from '../../components/ui/primitives'
import { Banner, ErrorState, StateBlock } from '../../components/ui/states'
import { Icon, type IconName } from '../../components/ui/Icon'
import { CropIcon } from '../../components/crops/CropIcon'
import { ApiError } from '../../lib/api'
import { getOutlook, type HistoricalIndicators, type OutlookCrop, type OutlookForecast } from '../../lib/data/repo'
import { date, num } from '../../lib/format'
import { loc } from '../../i18n'
import { Explanations, GroupScores } from './CropScore'
import { emptyHistory, FarmHistory, historyKey, historyPayload, type FarmHistoryValue } from './FarmHistory'
import { SoilTiles } from './SoilInfo'

const VAR_ICON: Record<OutlookForecast['key'], IconName> = {
  temperature_c: 'thermo',
  humidity_pct: 'wind',
  soil_moisture_m3_m3: 'drop',
  rainfall_mm: 'cloudRain',
}
const STATUS_TONE = { suitable_candidate: 'green', conditional: 'warning', not_recommended: 'critical' } as const

/** Display value and unit for a forecast variable (soil moisture is shown as % by volume). */
function shown(f: OutlookForecast, v: number | null): string {
  if (v === null || v === undefined) return '—'
  if (f.key === 'temperature_c') return `${num(v, 1)} °C`
  if (f.key === 'humidity_pct') return `${num(v, 0)} %`
  if (f.key === 'soil_moisture_m3_m3') return `${num(v * 100, 1)} %`
  return `${num(v, v < 10 ? 1 : 0)} mm`
}

function CropCard({ c, rank }: { c: OutlookCrop; rank: number }) {
  const { t } = useTranslation()
  return (
    <Card as="article" className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <CropIcon crop={c.crop_id} size={48} />
        <div className="flex-1 min-w-0">
          <p className="text-h2 font-semibold truncate">{loc(c.name)}</p>
          <Pill tone={STATUS_TONE[c.status]} icon={c.status === 'not_recommended' ? 'ban' : c.status === 'conditional' ? 'info' : 'check'}>
            {t(`outlook.status.${c.status}`)}
          </Pill>
        </div>
        <div className="text-end">
          <p className="text-metric font-light tabular-nums leading-none">{num(c.score, 0)}</p>
          <p className="text-caption text-text-secondary">
            {t('score.overall')} · #{rank}
          </p>
        </div>
      </div>

      <p className="flex items-center gap-2 text-label text-text-secondary">
        <Icon name="calendar" size={16} className="shrink-0" />
        {t('outlook.harvest', { a: c.days_to_harvest[0], b: c.days_to_harvest[1] })} · {loc(c.note)}
      </p>

      <GroupScores groups={c.group_scores} coverage={c.coverage_pct} />
      <Explanations items={c.explanations} critical={c.critical_failures} />
    </Card>
  )
}

function HistoryTiles({ h }: { h: HistoricalIndicators }) {
  const { t } = useTranslation()
  const items: [string, string][] = [
    [t('outlook.hist.tmin'), `${num(h.t2m_min_mean_c, 1)} °C`],
    [t('outlook.hist.tmax'), `${num(h.t2m_max_mean_c, 1)} °C`],
    [t('outlook.hist.frost'), `${num(h.frost_frequency * 100, 0)} %`],
    [t('outlook.hist.root'), `${num(h.root_zone_moisture_m3_m3 * 100, 1)} %`],
    [t('outlook.hist.profile'), `${num(h.profile_moisture_m3_m3 * 100, 1)} %`],
    [t('outlook.hist.solar'), num(h.solar_radiation, 1)],
    [t('outlook.hist.wind'), `${num(h.wind_speed_m_s, 1)} m/s`],
    [t('outlook.hist.dew'), `${num(h.dew_point_c, 1)} °C`],
  ]
  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {items.map(([label, value]) => (
          <Tile key={label} className="!p-3">
            <p className="text-caption text-text-secondary">{label}</p>
            <p className="text-body font-semibold tabular-nums mt-0.5" dir="ltr" style={{ textAlign: 'start' }}>
              {value}
            </p>
          </Tile>
        ))}
      </div>
      <p className="text-caption text-text-tertiary mt-2">{t('outlook.hist.note', { a: Math.min(...h.years), b: Math.max(...h.years) })}</p>
    </div>
  )
}

export function OutlookView({ lat, lon, irrigation, defaultPrevious }: { lat: number; lon: number; irrigation: boolean | null; defaultPrevious?: string | null }) {
  const { t } = useTranslation()
  const [horizon, setHorizon] = useState<'30' | '90'>('30')
  // '' = the default planting date chosen by the backend
  const [planting, setPlanting] = useState('')
  const [history, setHistory] = useState<FarmHistoryValue>(() => emptyHistory(irrigation, defaultPrevious))
  const q = useQuery({
    queryKey: ['outlook', lat.toFixed(4), lon.toFixed(4), planting, historyKey(history)],
    queryFn: () => getOutlook({ lat, lon, planting_date: planting || null, ...historyPayload(history) }),
    staleTime: 10 * 60 * 1000,
    retry: 0,
    placeholderData: keepPreviousData,
  })

  if (q.isLoading)
    return (
      <div aria-busy="true" role="status" className="flex flex-col gap-6">
        <Skeleton className="h-28 !rounded-card" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-72 !rounded-card" />
          ))}
        </div>
      </div>
    )
  const o = q.data
  if (q.error && !o) {
    const e = q.error instanceof ApiError ? q.error : null
    if (e?.code === 'MODEL_UNAVAILABLE')
      return (
        <Card>
          <StateBlock icon="cloudRain" tone="warning" title={t('outlook.unavailable')} body={t('outlook.unavailableBody')} />
        </Card>
      )
    return (
      <Card>
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </Card>
    )
  }
  if (!o) return null
  const p = o.periods.find((x) => String(x.horizon_days) === horizon) ?? o.periods[0]
  const dateError = q.error instanceof ApiError && q.error.code === 'DATE_OUT_OF_RANGE'
  const canPickDate = o.planting_date_min !== o.planting_date_max

  return (
    <div className="flex flex-col gap-6">
      <Banner icon="info" tone="warning">
        <b className="font-semibold block">{t('outlook.demoTitle')}</b>
        {t(o.is_default_date ? 'outlook.demoBody' : 'outlook.historyBody', { date: date(o.forecast_origin) })}
      </Banner>

      {/* agricultural history of the land */}
      <Card className="flex flex-col gap-4">
        <div>
          <h2 className="text-h2 font-semibold">{t('history.title')}</h2>
          <p className="text-label text-text-secondary mt-1">{t('history.body')}</p>
        </div>
        <FarmHistory value={history} onChange={setHistory} idPrefix="outlook" />
      </Card>

      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-48">
              <Field label={t('outlook.plantingDate')} htmlFor="outlook-date">
                <Input
                  id="outlook-date"
                  type="date"
                  dir="ltr"
                  value={planting || o.planting_date}
                  min={o.planting_date_min}
                  max={o.planting_date_max}
                  disabled={!canPickDate}
                  aria-invalid={dateError}
                  onChange={(e) => e.target.value && setPlanting(e.target.value)}
                />
              </Field>
            </div>
            {planting && !o.is_default_date && (
              <Button variant="secondary" icon="rotate" onClick={() => setPlanting('')}>
                {t('outlook.defaultDate')}
              </Button>
            )}
            {q.isFetching && <span className="pulse-marker mb-3" role="status" aria-label={t('common.loading')} />}
          </div>
          <Tabs
            value={horizon}
            onChange={setHorizon}
            options={[
              { value: '30', label: t('outlook.h30') },
              { value: '90', label: t('outlook.h90') },
            ]}
          />
        </div>
        <p className="text-caption text-text-secondary -mt-2">
          {dateError
            ? t('outlook.dateRange', { a: date(o.planting_date_min), b: date(o.planting_date_max) })
            : canPickDate
              ? `${t('outlook.dateHint')} ${t('outlook.dateRange', { a: date(o.planting_date_min), b: date(o.planting_date_max) })}`
              : t('outlook.dateFixed')}
        </p>

        <div>
          <h2 className="text-h2 font-semibold">{t('outlook.forecastTitle')}</h2>
          <p className="text-label text-text-secondary mt-1">
            {date(p.period_start)} – {date(p.period_end)}
          </p>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {p.forecast.map((f) => (
            <Tile key={f.key} className="flex flex-col gap-1">
              <span className="flex items-center gap-2 text-caption text-text-secondary">
                <Icon name={VAR_ICON[f.key]} size={16} className="text-green-600 shrink-0" /> {t(`outlook.vars.${f.key}`)}
              </span>
              <span className="text-h1 font-light tabular-nums" dir="ltr" style={{ textAlign: 'start' }}>
                {shown(f, f.value)}
              </span>
              {f.validation_mae != null && (
                <span className="text-caption text-text-secondary">
                  {t('outlook.error')} <span dir="ltr">± {shown(f, f.validation_mae)}</span>
                </span>
              )}
              <span className="text-caption text-text-tertiary">{t(f.method === 'baseline' ? 'outlook.methodBaseline' : 'outlook.methodModel')}</span>
            </Tile>
          ))}
        </div>
        <p className="text-caption text-text-secondary flex items-start gap-1">
          <Icon name="pin" size={14} className="mt-0.5 shrink-0" />
          {t('outlook.grid', { km: num(o.grid.distance_km, 1) })}
        </p>
      </Card>

      <div>
        <h2 className="text-h2 font-semibold mb-1">{t('outlook.cropsTitle', { days: p.horizon_days })}</h2>
        <p className="text-label text-text-secondary mb-4">{p.best_candidate ? t('outlook.cropsBodyMulti') : t('outlook.noneBody')}</p>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {p.recommendations.map((c, i) => (
            <CropCard key={c.crop_id} c={c} rank={i + 1} />
          ))}
        </div>
        <p className="text-caption text-text-secondary mt-3 flex items-start gap-1">
          <Icon name="info" size={14} className="mt-0.5 shrink-0" /> {t('score.note')}
        </p>
      </div>

      <Card className="flex flex-col gap-3">
        <div>
          <h2 className="text-h2 font-semibold">{t('soilInfo.titleFull')}</h2>
          <p className="text-label text-text-secondary mt-1">{t('soilInfo.static')}</p>
        </div>
        <SoilTiles soil={o.soil} terrain={o.terrain} />
      </Card>

      {p.historical_indicators && (
        <Card className="flex flex-col gap-3">
          <div>
            <h2 className="text-h2 font-semibold">{t('outlook.hist.title')}</h2>
            <p className="text-label text-text-secondary mt-1">{t('outlook.hist.body')}</p>
          </div>
          <HistoryTiles h={p.historical_indicators} />
        </Card>
      )}

      <div className="flex flex-col gap-1 px-2 text-caption text-text-secondary">
        {o.warnings.map((w, i) => (
          <p key={i} className="flex items-start gap-1">
            <Icon name="info" size={14} className="mt-0.5 shrink-0" /> {loc(w)}
          </p>
        ))}
        <p className="flex items-start gap-1">
          <Icon name="info" size={14} className="mt-0.5 shrink-0" /> {loc(o.weight_policy)}
        </p>
      </div>
    </div>
  )
}
