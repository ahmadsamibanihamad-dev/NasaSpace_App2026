import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useFarmCtx } from '../layout/FarmContext'
import { useAnalyses, useAnalysis, useCreateAnalysis, usePlots } from '../hooks/queries'
import { Button, Card, Skeleton } from '../components/ui/primitives'
import { Banner, EmptyState, ErrorState } from '../components/ui/states'
import { useToast } from '../components/ui/Toast'
import { date } from '../lib/format'
import { Processing } from './analysis/AnalysisView'
import { RiskView } from './analysis/results'

export default function Risks() {
  const { t } = useTranslation()
  const nav = useNavigate()
  const toast = useToast()
  const { farm } = useFarmCtx()
  const plotsQ = usePlots(farm?.id)
  const list = useAnalyses(farm?.id, 'risk')
  const create = useCreateAnalysis()
  const [runId, setRunId] = useState<string | null>(null)
  const latestDone = list.data?.find((a) => a.status === 'completed')
  const id = runId ?? latestDone?.id ?? null
  const q = useAnalysis(id, true)
  const a = q.data

  const run = async () => {
    if (!farm) return
    try {
      const r = await create.mutateAsync({ analysis_type: 'risk', farm_id: farm.id, plot_ids: null })
      setRunId(r.analysis_id)
    } catch {
      toast(t('states.errorBody'), 'error')
    }
  }

  if (plotsQ.isLoading || list.isLoading) return <Skeleton className="h-96 !rounded-card" />
  if (list.error) return <ErrorState error={list.error} onRetry={() => list.refetch()} />
  if (!plotsQ.data?.length)
    return (
      <Card>
        <EmptyState icon="polygon" title={t('parcels.emptyTitle')} body={t('parcels.emptyBody')} action={<Button icon="plus" onClick={() => nav('/app/farm?add=1')}>{t('parcels.addNew')}</Button>} />
      </Card>
    )

  const busy = a?.status === 'running' || a?.status === 'queued'
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body text-text-secondary">
          {farm?.name}
          {a?.status === 'completed' && ` · ${date(a.created_at)}`}
        </p>
        <Button icon="rotate" onClick={run} loading={create.isPending} disabled={busy}>
          {t('risks.run')}
        </Button>
      </div>
      {!id ? (
        <Card>
          <EmptyState icon="alert" title={t('risks.title')} body={t('risks.empty')} action={<Button onClick={run} loading={create.isPending}>{t('risks.run')}</Button>} />
        </Card>
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !a ? (
        <Skeleton className="h-64 !rounded-card" />
      ) : busy ? (
        <Processing a={a} />
      ) : a.status === 'failed' ? (
        <Banner icon="alert" tone="critical">
          {t('analysis.failed')}: {a.error?.code === 'NETWORK_ERROR' ? t('analysis.failedOffline') : t('states.errorBody')}
        </Banner>
      ) : (
        <RiskView result={a.result!} />
      )}
    </div>
  )
}
