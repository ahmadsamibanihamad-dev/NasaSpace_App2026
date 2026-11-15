// Crop Rotation Planner: a preliminary 90-day planting sequence built by the backend from the AI
// team's forecasts and recommendation rules. This file only collects the inputs and lays out the
// answer; it calculates no suitability or rotation score.
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { Button, Card, Field, Input, Pill, Skeleton, Tabs, Tile } from '../../components/ui/primitives'
import { Banner, ErrorState, StateBlock } from '../../components/ui/states'
import { FactorBar } from '../../components/ui/viz'
import { Icon, type IconName } from '../../components/ui/Icon'
import { CropIcon } from '../../components/crops/CropIcon'
import { useToast } from '../../components/ui/Toast'
import { ApiError } from '../../lib/api'
import { getRotationPlan, saveRotationPlan, type ForecastKey, type RotationOption, type RotationPlanData, type RotationStep } from '../../lib/data/repo'
import { date, dayMonth, num } from '../../lib/format'
import { loc } from '../../i18n'
import { SoilTiles } from '../outlook/SoilInfo'
import { GroupScores } from '../outlook/CropScore'
import { emptyHistory, FarmHistory, historyKey, historyPayload, type FarmHistoryValue, type LabValues } from '../outlook/FarmHistory'

export const PLAN_CROPS = ['radish', 'arugula', 'spinach', 'carrot', 'beet', 'bush_bean'] as const
const VARS: { key: ForecastKey; icon: IconName }[] = [
  { key: 'temperature_c', icon: 'thermo' },
  { key: 'humidity_pct', icon: 'wind' },
  { key: 'soil_moisture_m3_m3', icon: 'drop' },
  { key: 'rainfall_mm', icon: 'cloudRain' },
]
const STEP_TONE = { suitable_candidate: 'green', conditional: 'warning', not_recommended: 'critical' } as const

function fmtVar(key: ForecastKey, v: number | null | undefined): string {
  if (v === null || v === undefined) return '—'
  if (key === 'temperature_c') return `${num(v, 1)} °C`
  if (key === 'humidity_pct') return `${num(v, 0)} %`
  if (key === 'soil_moisture_m3_m3') return `${num(v * 100, 1)} %`
  return `${num(v, v < 10 ? 1 : 0)} mm`
}

const stepName = (s: RotationStep) => loc({ ar: s.crop_name_ar, en: s.crop_name_en })

/** 90-day bar: phase 1 takes a third, phase 2 two thirds. Time always runs left to right. */
function Timeline({ plan, option }: { plan: RotationPlanData; option: RotationOption }) {
  const { t } = useTranslation()
  const total = plan.planning_horizon_days
  const p1 = plan.forecasts.phase_1
  const p2 = plan.forecasts.phase_2
  const seg = (s: RotationStep | undefined, from: number, to: number, label: string) => (
    <div className="min-w-0" style={{ width: `${((to - from + 1) / total) * 100}%` }}>
      <div className={`h-14 rounded-tile flex items-center gap-2 px-3 ${s ? 'bg-green-50 border border-green-200' : 'bg-surface-muted border border-dashed border-border'}`}>
        {s ? (
          <>
            <CropIcon crop={s.crop_id} size={36} />
            <div className="min-w-0">
              <p className="text-label font-semibold truncate">{stepName(s)}</p>
              <p className="text-caption text-text-secondary truncate">{label}</p>
            </div>
          </>
        ) : (
          <p className="text-caption text-text-secondary truncate">{t('planner.noSecond')}</p>
        )}
      </div>
    </div>
  )
  const marks: [number, string][] = [[1, p1.start_date], ...(p2 ? ([[30, p1.end_date], [90, p2.end_date]] as [number, string][]) : ([[30, p1.end_date]] as [number, string][]))]
  return (
    <div style={{ direction: 'ltr' }} role="img" aria-label={t('planner.timeline')}>
      <div className="flex gap-1">
        {seg(option.sequence[0], 1, 30, t('planner.firstCrop'))}
        {total === 90 && seg(option.sequence[1], 31, 90, t('planner.secondCrop'))}
      </div>
      <div className="flex justify-between mt-2 text-caption text-text-secondary">
        {marks.map(([d, iso]) => (
          <span key={d} className="tabular-nums">
            {t('planner.day', { n: d })} · {dayMonth(iso)}
          </span>
        ))}
      </div>
    </div>
  )
}

function StepCard({ s }: { s: RotationStep }) {
  const { t } = useTranslation()
  return (
    <Card as="article" className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <CropIcon crop={s.crop_id} size={48} />
        <div className="flex-1 min-w-0">
          <p className="text-caption text-text-secondary">{t(s.phase === 1 ? 'planner.firstCrop' : 'planner.secondCrop')}</p>
          <p className="text-h2 font-semibold truncate">{stepName(s)}</p>
        </div>
        <div className="text-end">
          <p className="text-metric font-light tabular-nums leading-none">{num(s.suitability_score, 0)}</p>
          <p className="text-caption text-text-secondary">{t('planner.suitability')}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Pill tone={STEP_TONE[s.suitability_status]} icon={s.suitability_status === 'suitable_candidate' ? 'check' : 'info'}>
          {t(`outlook.status.${s.suitability_status}`)}
        </Pill>
        <Pill tone="outline" icon="leaf">
          {t(`planner.families.${s.family}`, { defaultValue: s.family })} <span dir="ltr">({s.family})</span>
        </Pill>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Tile className="!p-3">
          <p className="text-caption text-text-secondary">{t('planner.planting')}</p>
          <p className="text-label font-semibold mt-0.5">{date(s.planting_date)}</p>
        </Tile>
        <Tile className="!p-3">
          <p className="text-caption text-text-secondary">{t('planner.harvest')}</p>
          <p className="text-label font-semibold mt-0.5">
            {dayMonth(s.earliest_harvest_date)} – {dayMonth(s.latest_harvest_date)}
          </p>
        </Tile>
      </div>
      <p className="text-caption text-text-secondary">
        {t('planner.growth', { a: s.growth_days[0], b: s.growth_days[1] })} · {loc(s.note)}
      </p>
      <GroupScores groups={s.group_scores} coverage={s.coverage_pct} />
      {s.reasons.length > 0 && (
        <div>
          <p className="text-label font-semibold mb-1">{t('outlook.why')}</p>
          <ul className="flex flex-col gap-1">
            {s.reasons.map((r, i) => (
              <li key={i} className="flex items-start gap-2 text-label">
                <Icon name="check" size={16} className="mt-0.5 shrink-0 text-green-600" /> {loc(r)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {s.conditions.length > 0 && (
        <div>
          <p className="text-label font-semibold mb-1">{t('planner.conditions')}</p>
          <ul className="flex flex-col gap-1">
            {s.conditions.map((r, i) => (
              <li key={i} className="flex items-start gap-2 text-label text-text-secondary">
                <Icon name="alert" size={16} className="mt-0.5 shrink-0 text-warning" /> {loc(r)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}

function OptionCard({ o, rank, onPick, active }: { o: RotationOption; rank: number; onPick: () => void; active: boolean }) {
  const { t } = useTranslation()
  const c = o.components
  return (
    <Card as="article" className={`flex flex-col gap-3 ${active ? 'border border-green-600' : ''}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-caption text-text-secondary">{rank === 1 ? t('planner.best') : t('planner.alternative', { n: rank - 1 })}</p>
          <p className="text-body font-semibold truncate">{o.sequence.map(stepName).join(' ← ')}</p>
        </div>
        <div className="text-end shrink-0">
          <p className="text-h1 font-light tabular-nums leading-none">{num(o.rotation_score, 0)}</p>
          <p className="text-caption text-text-secondary">{t('planner.rotationScore')}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {o.sequence.map((s) => (
          <CropIcon key={s.crop_id} crop={s.crop_id} size={32} />
        ))}
        <Pill tone={o.status === 'suitable' ? 'green' : 'warning'} icon={o.status === 'suitable' ? 'check' : 'info'}>
          {t(`planner.optionStatus.${o.status}`)}
        </Pill>
      </div>
      <p className="text-caption text-text-secondary">{t('planner.totalDays', { a: o.estimated_total_days[0], b: o.estimated_total_days[1] })}</p>
      <div className="flex flex-col gap-3">
        <FactorBar label={t('planner.c.first')} value={c.first_crop_suitability} />
        {c.second_crop_suitability !== null && <FactorBar label={t('planner.c.second')} value={c.second_crop_suitability} />}
        <FactorBar label={t('planner.c.family')} value={c.family_diversity_score} />
        <FactorBar label={t('planner.c.duration')} value={c.duration_compatibility_score} />
      </div>
      <Button variant="secondary" size="sm" onClick={onPick} disabled={active}>
        {active ? t('planner.shown') : t('planner.show')}
      </Button>
    </Card>
  )
}

export function PlanView({ plan, header }: { plan: RotationPlanData; header?: ReactNode }) {
  const { t } = useTranslation()
  const options = plan.best_rotation ? [plan.best_rotation, ...plan.alternative_rotations] : []
  const [picked, setPicked] = useState(0)
  const option = options[Math.min(picked, options.length - 1)]
  const p1 = plan.forecasts.phase_1
  const p2 = plan.forecasts.phase_2

  return (
    <div className="flex flex-col gap-6">
      {header}

      {/* B. forecast cards, one value per phase */}
      <Card className="flex flex-col gap-4">
        <div>
          <h2 className="text-h2 font-semibold">{t('planner.forecastTitle')}</h2>
          <p className="text-label text-text-secondary mt-1">{t('planner.forecastBody')}</p>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {VARS.map(({ key, icon }) => (
            <Tile key={key} className="flex flex-col gap-2">
              <span className="flex items-center gap-2 text-caption text-text-secondary">
                <Icon name={icon} size={16} className="text-green-600 shrink-0" />
                {t(`outlook.vars.${key}`)}
              </span>
              <div>
                <p className="text-caption text-text-tertiary">{t('planner.phase1')}</p>
                <p className="text-h2 font-light tabular-nums" dir="ltr" style={{ textAlign: 'start' }}>
                  {fmtVar(key, p1[key])}
                </p>
              </div>
              {p2 && (
                <div>
                  <p className="text-caption text-text-tertiary">{t('planner.phase2')}</p>
                  <p className="text-h2 font-light tabular-nums" dir="ltr" style={{ textAlign: 'start' }}>
                    {fmtVar(key, p2[key])}
                  </p>
                </div>
              )}
            </Tile>
          ))}
        </div>
        {p2 && (
          <p className="text-caption text-text-secondary flex items-start gap-1">
            <Icon name="info" size={14} className="mt-0.5 shrink-0" /> {t(p2.reliable ? 'planner.derivedNote' : 'planner.derivedBad')}
          </p>
        )}
      </Card>

      {/* C. timeline and crop cards */}
      {plan.status === 'no_plan_available' || !option ? (
        <Card>
          <StateBlock icon="sprout" tone="warning" title={t('planner.noPlan')} body={plan.explanation.map((e) => loc(e)).join(' ')} />
        </Card>
      ) : (
        <>
          {plan.status === 'partial_plan' && (
            <Banner icon="info" tone="warning">
              <b className="font-semibold block">{t('planner.partial')}</b>
              {loc(plan.explanation[0])}
            </Banner>
          )}
          <Card className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-h2 font-semibold">{t('planner.timeline')}</h2>
                <p className="text-label text-text-secondary mt-1">{picked === 0 ? t('planner.best') : t('planner.alternative', { n: picked })}</p>
              </div>
              <div className="text-end">
                <p className="text-metric font-light tabular-nums leading-none">{num(option.rotation_score, 0)}</p>
                <p className="text-caption text-text-secondary">{t('planner.rotationScore')}</p>
              </div>
            </div>
            <Timeline plan={plan} option={option} />
          </Card>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {option.sequence.map((s) => (
              <StepCard key={s.phase} s={s} />
            ))}
          </div>

          {/* D. alternatives */}
          {options.length > 1 && (
            <div>
              <h2 className="text-h2 font-semibold mb-4">{t('planner.compare')}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 items-start">
                {options.map((o, i) => (
                  <OptionCard key={i} o={o} rank={i + 1} active={i === picked} onPick={() => setPicked(i)} />
                ))}
              </div>
            </div>
          )}

          {/* E. explanation */}
          <Card>
            <h2 className="text-h2 font-semibold mb-3">{t('planner.whyTitle')}</h2>
            <ul className="flex flex-col gap-2">
              {plan.explanation.map((e, i) => (
                <li key={i} className="flex items-start gap-2 text-body">
                  <Icon name="check" size={18} className="mt-1 shrink-0 text-green-600" /> {loc(e)}
                </li>
              ))}
            </ul>
            <p className="text-caption text-text-tertiary mt-3">{t('planner.weightsNote')}</p>
          </Card>
        </>
      )}

      <Card className="flex flex-col gap-3">
        <h2 className="text-h2 font-semibold">{t('soilInfo.title')}</h2>
        <SoilTiles soil={plan.soil} terrain={plan.terrain} />
      </Card>

      {/* F. data quality and warnings */}
      <Card>
        <h2 className="text-h2 font-semibold mb-3">{t('planner.warningsTitle')}</h2>
        <ul className="flex flex-col gap-2">
          {plan.warnings.map((w, i) => (
            <li key={i} className="flex items-start gap-2 text-label text-text-secondary">
              <Icon name="alert" size={16} className="mt-0.5 shrink-0 text-warning" /> {loc(w)}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}

export function RotationPlanner({
  lat,
  lon,
  place,
  defaultIrrigation,
  defaultPrevious,
  defaultLab,
  farmId,
  plotId,
  onSaved,
}: {
  lat: number
  lon: number
  /** Farm / parcel / governorate line shown in the inputs card. */
  place: string
  defaultIrrigation: boolean | null
  /** The parcel's current crop, offered as the previous crop. */
  defaultPrevious?: string | null
  /** The parcel's stored laboratory soil test. */
  defaultLab?: LabValues | null
  /** When set (signed-in user with a farm) the plan can be saved. */
  farmId?: string
  plotId?: string | null
  onSaved?: () => void
}) {
  const { t } = useTranslation()
  const toast = useToast()
  const [horizon, setHorizon] = useState<'90' | '30'>('90')
  const [planting, setPlanting] = useState('') // '' = default date from the backend
  const [history, setHistory] = useState<FarmHistoryValue>(() => emptyHistory(defaultIrrigation, defaultPrevious, defaultLab))

  const input = {
    latitude: lat,
    longitude: lon,
    planning_horizon_days: Number(horizon) as 30 | 90,
    planting_date: planting || null,
    ...historyPayload(history),
  }
  const q = useQuery({
    queryKey: ['rotation-plan', lat.toFixed(4), lon.toFixed(4), horizon, planting, historyKey(history)],
    queryFn: () => getRotationPlan(input),
    staleTime: 10 * 60 * 1000,
    retry: 0,
    placeholderData: keepPreviousData,
  })
  const save = useMutation({
    mutationFn: () => saveRotationPlan({ ...input, farm_id: farmId!, plot_id: plotId ?? null }),
    onSuccess: () => {
      toast(t('planner.saved'))
      onSaved?.()
    },
    onError: () => toast(t('parcels.saveFailed'), 'error'),
  })

  const plan = q.data
  const dateError = q.error instanceof ApiError && q.error.code === 'DATE_OUT_OF_RANGE'

  // A. inputs
  const inputs = (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-h2 font-semibold">{t('planner.inputs')}</h2>
          <p className="text-label text-text-secondary mt-1 flex items-center gap-1">
            <Icon name="pin" size={14} className="shrink-0" /> {place}
          </p>
        </div>
        <Tabs
          value={horizon}
          onChange={setHorizon}
          options={[
            { value: '90', label: t('planner.h90') },
            { value: '30', label: t('planner.h30') },
          ]}
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={t('outlook.plantingDate')} htmlFor="plan-date" error={dateError && plan ? t('outlook.dateRange', { a: date(plan.planting_date_min), b: date(plan.planting_date_max) }) : null}>
          <Input
            id="plan-date"
            type="date"
            dir="ltr"
            value={planting || plan?.planting_date || ''}
            min={plan?.planting_date_min}
            max={plan?.planting_date_max}
            aria-invalid={dateError}
            onChange={(e) => e.target.value && setPlanting(e.target.value)}
          />
        </Field>
      </div>
      <div>
        <p className="text-label font-semibold mb-2">{t('history.title')}</p>
        <FarmHistory value={history} onChange={setHistory} idPrefix="plan" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {planting && plan && !plan.is_default_date && (
          <Button variant="secondary" size="sm" icon="rotate" onClick={() => setPlanting('')}>
            {t('outlook.defaultDate')}
          </Button>
        )}
        {q.isFetching && <span className="pulse-marker" role="status" aria-label={t('common.loading')} />}
        {plan && (
          <p className="text-caption text-text-secondary">
            {t('outlook.dateRange', { a: date(plan.planting_date_min), b: date(plan.planting_date_max) })}
          </p>
        )}
        {farmId && plan && plan.status !== 'no_plan_available' && (
          <Button className="ms-auto" icon="download" onClick={() => save.mutate()} loading={save.isPending}>
            {t('planner.save')}
          </Button>
        )}
      </div>
    </Card>
  )

  if (q.isLoading)
    return (
      <div className="flex flex-col gap-6" aria-busy="true" role="status">
        {inputs}
        <Skeleton className="h-40 !rounded-card" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-72 !rounded-card" />
          <Skeleton className="h-72 !rounded-card" />
        </div>
      </div>
    )
  if (!plan) {
    const e = q.error instanceof ApiError ? q.error : null
    return (
      <div className="flex flex-col gap-6">
        {inputs}
        <Card>
          {e?.code === 'MODEL_UNAVAILABLE' ? (
            <StateBlock icon="cloudRain" tone="warning" title={t('outlook.unavailable')} body={t('outlook.unavailableBody')} />
          ) : (
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          )}
        </Card>
      </div>
    )
  }
  return <PlanView key={`${plan.planting_date}-${plan.planning_horizon_days}-${plan.previous_crop}`} plan={plan} header={inputs} />
}
