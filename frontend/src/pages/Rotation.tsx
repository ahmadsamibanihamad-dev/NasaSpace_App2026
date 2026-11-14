import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { useFarmCtx } from '../layout/FarmContext'
import { useAnalysis, useCreateAnalysis, useHistory, usePlots, useSaveHistory, useUpdatePlot } from '../hooks/queries'
import { Button, Card, CardTitle, Chip, IconButton, Select, Skeleton } from '../components/ui/primitives'
import { Banner, EmptyState, ErrorState } from '../components/ui/states'
import { useToast } from '../components/ui/Toast'
import { CropIcon } from '../components/crops/CropIcon'
import { CROP_IDS } from '../lib/places'
import { cropName } from '../lib/format'
import type { CropHistoryItem, RotationStrategy } from '../lib/types'
import { Processing } from './analysis/AnalysisView'
import { RotationView } from './analysis/results'

const PRIORITIES = ['save_water', 'improve_soil', 'increase_income'] as const

function currentSeasonStart() {
  const d = new Date()
  return d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1
}

export default function Rotation() {
  const { t } = useTranslation()
  const nav = useNavigate()
  const toast = useToast()
  const qc = useQueryClient()
  const [params] = useSearchParams()
  const { farm } = useFarmCtx()
  const plotsQ = usePlots(farm?.id)
  const plots = useMemo(() => plotsQ.data ?? [], [plotsQ.data])
  const [plotId, setPlotId] = useState<string | null>(params.get('plot'))
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]>('improve_soil')
  const [analysisId, setAnalysisId] = useState<string | null>(null)
  const plot = plots.find((p) => p.id === plotId) ?? plots[0] ?? null
  const historyQ = useHistory(plot?.id)
  const saveHistory = useSaveHistory()
  const updatePlot = useUpdatePlot()
  const create = useCreateAnalysis()
  const analysis = useAnalysis(analysisId, true)
  const [rows, setRows] = useState<CropHistoryItem[]>([])
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (historyQ.data) {
      setRows(historyQ.data)
      setDirty(false)
    }
  }, [historyQ.data, plot?.id])
  useEffect(() => setAnalysisId(null), [plot?.id])

  if (plotsQ.isLoading) return <Skeleton className="h-96 !rounded-card" />
  if (plotsQ.error) return <ErrorState error={plotsQ.error} onRetry={() => plotsQ.refetch()} />
  if (!farm || !plot)
    return (
      <Card>
        <EmptyState icon="polygon" title={t('parcels.emptyTitle')} body={t('parcels.emptyBody')} action={<Button icon="plus" onClick={() => nav('/app/farm?add=1')}>{t('parcels.addNew')}</Button>} />
      </Card>
    )

  const y0 = currentSeasonStart()
  const addSeason = () => {
    const used = new Set(rows.map((r) => r.season))
    for (let k = 1; k <= 6; k++) {
      const s = `${y0 - k}-${y0 - k + 1}`
      if (!used.has(s)) {
        setRows([...rows, { season: s, crop_id: null }].sort((a, b) => a.season.localeCompare(b.season)))
        setDirty(true)
        return
      }
    }
  }
  const persistHistory = async () => {
    await saveHistory.mutateAsync({ plotId: plot.id, items: rows })
    setDirty(false)
  }
  const run = async () => {
    try {
      if (dirty) await persistHistory()
      const r = await create.mutateAsync({ analysis_type: 'rotation', farm_id: farm.id, plot_ids: [plot.id], priority })
      setAnalysisId(r.analysis_id)
    } catch {
      toast(t('states.errorBody'), 'error')
    }
  }
  const apply = async (_pid: string, s: RotationStrategy) => {
    const nextCrop = s.sequence[0]?.crop ?? null
    try {
      await updatePlot.mutateAsync({ id: plot.id, patch: { previous_crop_id: plot.current_crop_id, current_crop_id: nextCrop, status: nextCrop ? 'planted' : 'fallow' } })
      const season = `${y0}-${y0 + 1}`
      const merged = [...rows.filter((r) => r.season !== season), { season, crop_id: plot.current_crop_id }].sort((a, b) => a.season.localeCompare(b.season)).slice(-10)
      await saveHistory.mutateAsync({ plotId: plot.id, items: merged })
      qc.invalidateQueries({ queryKey: ['plots'] })
      toast(t('rotation.applied'))
    } catch {
      toast(t('parcels.saveFailed'), 'error')
    }
  }

  const a = analysis.data
  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-5">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="flex flex-col gap-2">
            <label htmlFor="rot-plot" className="text-label text-text-secondary">
              {t('rotation.pickPlot')}
            </label>
            <Select id="rot-plot" value={plot.id} onChange={(e) => setPlotId(e.target.value)}>
              {plots.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} · {p.name} ({cropName(p.current_crop_id)})
                </option>
              ))}
            </Select>
            <span className="text-label text-text-secondary mt-3">{t('analysis.priority')}</span>
            <div className="flex flex-wrap gap-2" role="radiogroup">
              {PRIORITIES.map((p) => (
                <Chip key={p} selected={priority === p} onClick={() => setPriority(p)}>
                  {t(`analysis.priorities.${p}`)}
                </Chip>
              ))}
            </div>
          </div>

          <div className="lg:col-span-2">
            <CardTitle
              action={
                <span className="flex gap-2">
                  <Button size="sm" variant="secondary" icon="plus" onClick={addSeason} disabled={rows.length >= 6}>
                    {t('rotation.addSeason')}
                  </Button>
                  {dirty && (
                    <Button size="sm" onClick={persistHistory} loading={saveHistory.isPending}>
                      {t('rotation.saveHistory')}
                    </Button>
                  )}
                </span>
              }
            >
              {t('rotation.history')}
            </CardTitle>
            {historyQ.isLoading ? (
              <Skeleton className="h-20" />
            ) : (
              <ol className="flex flex-wrap items-stretch gap-3">
                {rows.map((r, i) => (
                  <li key={r.season} className="rounded-tile bg-surface-muted p-3 flex items-center gap-3 min-w-56">
                    <CropIcon crop={r.crop_id} size={36} />
                    <span className="flex-1">
                      <span className="block text-caption text-text-secondary" dir="ltr" style={{ textAlign: 'start' }}>{r.season}</span>
                      <Select
                        aria-label={`${t('rotation.season')} ${r.season}`}
                        className="!h-8 !text-label !px-2"
                        value={r.crop_id ?? ''}
                        onChange={(e) => {
                          setRows(rows.map((x, j) => (j === i ? { ...x, crop_id: e.target.value || null } : x)))
                          setDirty(true)
                        }}
                      >
                        <option value="">{t('rotation.fallow')}</option>
                        {CROP_IDS.map((c) => (
                          <option key={c} value={c}>
                            {t(`crops.${c}`)}
                          </option>
                        ))}
                      </Select>
                    </span>
                    <IconButton
                      icon="x"
                      size={28}
                      label={t('common.delete')}
                      onClick={() => {
                        setRows(rows.filter((_, j) => j !== i))
                        setDirty(true)
                      }}
                    />
                  </li>
                ))}
                <li className="rounded-tile border border-green-600 p-3 flex items-center gap-3 min-w-48">
                  <CropIcon crop={plot.current_crop_id} size={36} />
                  <span>
                    <span className="block text-caption text-text-secondary">{t('rotation.now')}</span>
                    <span className="block text-label font-semibold">{cropName(plot.current_crop_id)}</span>
                  </span>
                </li>
              </ol>
            )}
          </div>
        </div>
        <div className="flex justify-end">
          <Button icon="compare" onClick={run} loading={create.isPending} disabled={a?.status === 'running' || a?.status === 'queued'}>
            {t('rotation.run')}
          </Button>
        </div>
      </Card>

      {!analysisId ? (
        <Card>
          <EmptyState icon="rotate" title={t('rotation.title')} body={t('rotation.empty')} />
        </Card>
      ) : analysis.error ? (
        <ErrorState error={analysis.error} onRetry={() => analysis.refetch()} />
      ) : !a || a.status === 'queued' || a.status === 'running' ? (
        a ? <Processing a={a} /> : <Skeleton className="h-64 !rounded-card" />
      ) : a.status === 'failed' ? (
        <Banner icon="alert" tone="critical">
          {t('analysis.failed')}: {a.error?.code === 'NETWORK_ERROR' ? t('analysis.failedOffline') : t('states.errorBody')}
        </Banner>
      ) : (
        <RotationView result={a.result!} farm={farm} plots={plots} onApply={apply} applying={updatePlot.isPending} />
      )}
    </div>
  )
}
