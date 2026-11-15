import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useFarmCtx } from '../../layout/FarmContext'
import { useCreateAnalysis, usePlots } from '../../hooks/queries'
import { Button, Card, Chip, Field, Input, Skeleton, cx } from '../../components/ui/primitives'
import { Banner, EmptyState, ErrorState } from '../../components/ui/states'
import { Icon, type IconName } from '../../components/ui/Icon'
import { CropIcon } from '../../components/crops/CropIcon'
import { FarmMiniMap } from '../../components/map/FarmMiniMap'
import { CROP_IDS } from '../../lib/places'
import { area as fmtArea, cropName, date, listSep } from '../../lib/format'
import type { AnalysisType } from '../../lib/types'
import { ApiError } from '../../lib/api'

const OBJECTIVES: { id: AnalysisType; icon: IconName }[] = [
  { id: 'crop_suitability', icon: 'target' },
  { id: 'crop_recommendation', icon: 'sprout' },
  { id: 'planting_window', icon: 'calendar' },
  { id: 'rotation', icon: 'rotate' },
  { id: 'water', icon: 'drop' },
  { id: 'risk', icon: 'alert' },
]
const PRIORITIES = ['save_water', 'improve_soil', 'increase_income'] as const
type StepId = 'scope' | 'objective' | 'crop' | 'date' | 'review'

export default function NewAnalysis() {
  const { t } = useTranslation()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const { farm } = useFarmCtx()
  const plotsQ = usePlots(farm?.id)
  const create = useCreateAnalysis()
  const plots = useMemo(() => plotsQ.data ?? [], [plotsQ.data])

  const presetPlot = params.get('plot')
  const presetType = params.get('type') as AnalysisType | null
  const [whole, setWhole] = useState(!presetPlot)
  const [picked, setPicked] = useState<string[]>(presetPlot ? [presetPlot] : [])
  const [type, setType] = useState<AnalysisType | null>(presetType && OBJECTIVES.some((o) => o.id === presetType) ? presetType : null)
  const [crop, setCrop] = useState<string | null>(null)
  const [plantingDate, setPlantingDate] = useState('')
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]>('improve_soil')
  const [step, setStep] = useState<StepId>('scope')
  const [err, setErr] = useState<string | null>(null)

  const needsCrop = type === 'crop_suitability'
  const cropOptional = type === 'planting_window' || type === 'water'
  const hasCropStep = needsCrop || cropOptional || type === 'rotation'
  const hasDateStep = type === 'crop_suitability' || type === 'water'
  const steps: StepId[] = ['scope', 'objective', ...(hasCropStep ? (['crop'] as StepId[]) : []), ...(hasDateStep ? (['date'] as StepId[]) : []), 'review']
  const idx = steps.indexOf(step)
  const scopePlots = whole ? plots : plots.filter((p) => picked.includes(p.id))

  const canNext = step === 'scope' ? scopePlots.length > 0 : step === 'objective' ? !!type : step === 'crop' ? !needsCrop || !!crop : true
  const next = () => {
    setErr(null)
    if (!canNext) return setErr(step === 'scope' ? t('analysis.needPlot') : step === 'crop' ? t('analysis.needCrop') : t('states.validation'))
    setStep(steps[Math.min(idx + 1, steps.length - 1)])
  }
  const submit = async () => {
    if (!farm || !type) return
    setErr(null)
    try {
      const r = await create.mutateAsync({
        analysis_type: type,
        farm_id: farm.id,
        plot_ids: whole ? null : picked,
        crop_id: hasCropStep && type !== 'rotation' ? crop : null,
        planting_date: hasDateStep && plantingDate ? plantingDate : null,
        priority: type === 'rotation' ? priority : null,
      })
      nav(`/app/analysis/${r.analysis_id}`)
    } catch (e) {
      const a = e as ApiError
      setErr(a.code === 'NETWORK_ERROR' ? t('states.serverDownBody') : a.code === 'VALIDATION_ERROR' ? t('states.validation') : t('states.errorBody'))
    }
  }

  if (plotsQ.isLoading) return <Skeleton className="h-96 !rounded-card" />
  if (plotsQ.error) return <ErrorState error={plotsQ.error} onRetry={() => plotsQ.refetch()} />
  if (!farm || plots.length === 0)
    return (
      <Card>
        <EmptyState icon="polygon" title={t('parcels.emptyTitle')} body={t('parcels.emptyBody')} action={<Button icon="plus" onClick={() => nav('/app/farm?add=1')}>{t('parcels.addNew')}</Button>} />
      </Card>
    )

  const stepLabel: Record<StepId, string> = { scope: t('analysis.scope'), objective: t('analysis.objective'), crop: type === 'rotation' ? t('analysis.priority') : t('analysis.crop'), date: t('analysis.date'), review: t('analysis.review') }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
      <div className="xl:col-span-8 flex flex-col gap-6">
        <ol className="flex flex-wrap items-center gap-2" aria-label={t('analysis.title')}>
          {steps.map((s, i) => (
            <li key={s} className="flex items-center gap-2">
              <button
                onClick={() => i < idx && setStep(s)}
                disabled={i > idx}
                aria-current={i === idx ? 'step' : undefined}
                className={cx('h-9 px-4 rounded-pill text-label flex items-center gap-2', i === idx ? 'bg-green-600 text-white' : i < idx ? 'bg-green-50 text-green-700 hover:bg-green-100' : 'bg-surface text-text-secondary')}
              >
                {i < idx ? <Icon name="check" size={16} /> : <b className="font-semibold">{i + 1}</b>} {stepLabel[s]}
              </button>
            </li>
          ))}
        </ol>

        <Card className="flex flex-col gap-6 min-h-[420px]">
          {step === 'scope' && (
            <>
              <h2 className="text-h1 font-semibold">{t('analysis.scope')}</h2>
              <div className="flex gap-2">
                <Chip selected={whole} onClick={() => setWhole(true)}>
                  <Icon name="farm" size={16} /> {t('analysis.wholeFarm')} ({plots.length})
                </Chip>
                <Chip selected={!whole} onClick={() => setWhole(false)}>
                  <Icon name="polygon" size={16} /> {t('analysis.selectPlots')}
                </Chip>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <FarmMiniMap
                  farm={farm}
                  plots={plots}
                  interactive
                  picked={whole ? plots.map((p) => p.id) : picked}
                  onPick={(id) => {
                    setWhole(false)
                    setPicked((x) => (whole ? [id] : x.includes(id) ? x.filter((y) => y !== id) : [...x, id]))
                  }}
                  className="h-72"
                />
                <ul className="flex flex-col gap-1 max-h-72 overflow-y-auto" aria-label={t('analysis.pickOnMap')}>
                  {plots.map((p) => {
                    const on = whole || picked.includes(p.id)
                    return (
                      <li key={p.id}>
                        <label className={cx('flex items-center gap-3 rounded-tile px-3 py-2 border cursor-pointer', on ? 'border-green-600 bg-green-50' : 'border-transparent hover:bg-surface-muted')}>
                          <input
                            type="checkbox"
                            className="size-4 accent-[#24753F]"
                            checked={on}
                            onChange={() => {
                              if (whole) {
                                setWhole(false)
                                setPicked(plots.filter((x) => x.id !== p.id).map((x) => x.id))
                              } else setPicked((x) => (x.includes(p.id) ? x.filter((y) => y !== p.id) : [...x, p.id]))
                            }}
                          />
                          <span className="flex-1 min-w-0">
                            <span className="block text-label font-semibold truncate">
                              {p.label} · {p.name}
                            </span>
                            <span className="block text-caption text-text-secondary">
                              {cropName(p.current_crop_id)} · {fmtArea(p.area_m2)}
                            </span>
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              </div>
              <p className="text-caption text-text-secondary">{t('analysis.pickOnMap')}</p>
            </>
          )}

          {step === 'objective' && (
            <>
              <h2 className="text-h1 font-semibold">{t('analysis.objective')}</h2>
              <div role="radiogroup" aria-label={t('analysis.objective')} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {OBJECTIVES.map((o) => (
                  <button
                    key={o.id}
                    role="radio"
                    aria-checked={type === o.id}
                    onClick={() => setType(o.id)}
                    className={cx('text-start rounded-tile border p-5 flex flex-col gap-3 transition-colors', type === o.id ? 'border-green-600 bg-green-50' : 'border-border hover:border-green-300')}
                  >
                    <span className={cx('size-11 rounded-pill flex items-center justify-center', type === o.id ? 'bg-green-600 text-white' : 'border border-border text-green-600')}>
                      <Icon name={o.icon} size={20} />
                    </span>
                    <span className="text-body font-semibold">{t(`analysis.objectives.${o.id}`)}</span>
                    <span className="text-label text-text-secondary">{t(`analysis.objectivesBody.${o.id}`)}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {step === 'crop' && type === 'rotation' && (
            <>
              <h2 className="text-h1 font-semibold">{t('analysis.priority')}</h2>
              <div role="radiogroup" className="flex flex-wrap gap-2">
                {PRIORITIES.map((p) => (
                  <Chip key={p} selected={priority === p} onClick={() => setPriority(p)}>
                    {t(`analysis.priorities.${p}`)}
                  </Chip>
                ))}
              </div>
            </>
          )}

          {step === 'crop' && type !== 'rotation' && (
            <>
              <div>
                <h2 className="text-h1 font-semibold">{t('analysis.chooseCrop')}</h2>
                {cropOptional && <p className="text-label text-text-secondary mt-1">{t(type === 'planting_window' ? 'analysis.cropOptionalAll' : 'analysis.cropOptional')}</p>}
              </div>
              <div role="radiogroup" aria-label={t('analysis.chooseCrop')} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {cropOptional && (
                  <button role="radio" aria-checked={crop === null} onClick={() => setCrop(null)} className={cx('rounded-tile border p-4 flex items-center gap-3 text-label', crop === null ? 'border-green-600 bg-green-50' : 'border-border hover:border-green-300')}>
                    <CropIcon crop={null} size={36} /> {t(type === 'planting_window' ? 'analysis.allCrops' : 'analysis.currentCrops')}
                  </button>
                )}
                {CROP_IDS.map((c) => (
                  <button key={c} role="radio" aria-checked={crop === c} onClick={() => setCrop(c)} className={cx('rounded-tile border p-4 flex items-center gap-3 text-label', crop === c ? 'border-green-600 bg-green-50' : 'border-border hover:border-green-300')}>
                    <CropIcon crop={c} size={36} /> {t(`crops.${c}`)}
                  </button>
                ))}
              </div>
            </>
          )}

          {step === 'date' && (
            <>
              <h2 className="text-h1 font-semibold">{t('analysis.plantingDate')}</h2>
              <div className="max-w-xs">
                <Field label={`${t('analysis.plantingDate')} (${t('common.optional')})`} htmlFor="pd" hint={t('analysis.plantingDateHint')}>
                  <Input id="pd" type="date" dir="ltr" value={plantingDate} onChange={(e) => setPlantingDate(e.target.value)} />
                </Field>
              </div>
              <Banner icon="info">{t('results.climatology')}</Banner>
            </>
          )}

          {step === 'review' && (
            <>
              <h2 className="text-h1 font-semibold">{t('analysis.review')}</h2>
              <Summary farmName={farm.name} plots={scopePlots.map((p) => p.label)} whole={whole} type={type} crop={hasCropStep && type !== 'rotation' ? crop : undefined} date={hasDateStep ? plantingDate : undefined} priority={type === 'rotation' ? priority : undefined} large />
              <Banner icon="satellite">{t('analysis.reviewNote')}</Banner>
            </>
          )}

          {err && <Banner icon="alert" tone="critical">{err}</Banner>}

          <div className="flex gap-2 mt-auto">
            {idx > 0 && (
              <Button variant="secondary" onClick={() => setStep(steps[idx - 1])}>
                {t('common.back')}
              </Button>
            )}
            <span className="flex-1" />
            {step === 'review' ? (
              <Button icon="check" loading={create.isPending} onClick={submit}>
                {t('analysis.submit')}
              </Button>
            ) : (
              <Button iconEnd="arrowRight" onClick={next} disabled={!canNext}>
                {t('common.next')}
              </Button>
            )}
          </div>
        </Card>
      </div>

      <aside className="xl:col-span-4">
        <Card className="sticky top-0">
          <h2 className="text-h2 font-semibold mb-4">{t('analysis.summary')}</h2>
          <Summary farmName={farm.name} plots={scopePlots.map((p) => p.label)} whole={whole} type={type} crop={hasCropStep && type !== 'rotation' ? crop : undefined} date={hasDateStep ? plantingDate : undefined} priority={type === 'rotation' ? priority : undefined} />
        </Card>
      </aside>
    </div>
  )
}

function Summary({ farmName, plots, whole, type, crop, date: d, priority, large }: { farmName: string; plots: string[]; whole: boolean; type: AnalysisType | null; crop?: string | null; date?: string; priority?: string; large?: boolean }) {
  const { t } = useTranslation()
  const rows: [string, string][] = [
    [t('common.farm'), farmName],
    [t('analysis.scope'), whole ? `${t('analysis.wholeFarm')} (${plots.length})` : plots.length ? plots.join(listSep()) : '—'],
    [t('analysis.objective'), type ? t(`analysis.objectives.${type}`) : '—'],
  ]
  if (crop !== undefined) rows.push([t('analysis.crop'), crop ? cropName(crop) : type === 'crop_suitability' ? '—' : t(type === 'planting_window' ? 'analysis.allCrops' : 'analysis.currentCrops')])
  if (d !== undefined) rows.push([t('analysis.date'), d ? date(d) : t('analysis.bestDate')])
  if (priority) rows.push([t('analysis.priority'), t(`analysis.priorities.${priority}`)])
  return (
    <dl className={cx('divide-y divide-border', large && 'rounded-tile border border-border')}>
      {rows.map(([k, v]) => (
        <div key={k} className={cx('flex justify-between gap-4 py-3 text-label', large && 'px-4')}>
          <dt className="text-text-secondary shrink-0">{k}</dt>
          <dd className="font-semibold text-end">{v}</dd>
        </div>
      ))}
    </dl>
  )
}
