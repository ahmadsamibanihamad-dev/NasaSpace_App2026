import { useEffect } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { useAnalysis, usePlots } from '../../hooks/queries'
import { useFarmCtx } from '../../layout/FarmContext'
import { Button, Card, Skeleton, cx } from '../../components/ui/primitives'
import { ErrorState, StateBlock } from '../../components/ui/states'
import { Icon } from '../../components/ui/Icon'
import { date } from '../../lib/format'
import type { Analysis, Farm, Plot } from '../../lib/types'
import { CalendarView, RecommendationView, RiskView, RotationView, SuitabilityView, WaterView } from './results'

export function Processing({ a }: { a: Analysis }) {
  const { t } = useTranslation()
  return (
    <Card className="max-w-2xl mx-auto flex flex-col gap-8 py-10" aria-live="polite">
      <div className="text-center">
        <span className="pulse-marker inline-block" aria-hidden />
        <h2 className="text-h1 font-semibold mt-4">{t('analysis.processingTitle')}</h2>
        <p className="text-body text-text-secondary mt-1">{t('analysis.processingBody')}</p>
      </div>
      <ol className="flex flex-col gap-1 max-w-md mx-auto w-full">
        {a.stages.map((s, i) => (
          <li key={s.key} className="flex items-center gap-4 py-2" aria-current={s.status === 'running' ? 'step' : undefined}>
            <span
              className={cx(
                'size-9 rounded-pill flex items-center justify-center text-label font-semibold shrink-0 border',
                s.status === 'done' ? 'bg-green-600 border-green-600 text-white' : s.status === 'running' ? 'border-green-600 text-green-700' : 'border-border text-text-tertiary',
              )}
            >
              {s.status === 'done' ? <Icon name="check" size={16} /> : s.status === 'running' ? <span className="size-4 rounded-full border-2 border-current border-t-transparent animate-spin" /> : i + 1}
            </span>
            <span className={cx('text-body', s.status === 'pending' && 'text-text-tertiary', s.status === 'running' && 'font-semibold')}>{t(`analysis.stages.${s.key}`)}</span>
          </li>
        ))}
      </ol>
    </Card>
  )
}

export function ResultBody({ a, farm, plots }: { a: Analysis; farm: Farm; plots: Plot[] }) {
  const r = a.result!
  switch (a.analysis_type) {
    case 'crop_suitability':
      return <SuitabilityView result={r} farm={farm} plots={plots} />
    case 'crop_recommendation':
      return <RecommendationView result={r} farm={farm} plots={plots} />
    case 'planting_window':
      return <CalendarView result={r} />
    case 'rotation':
      return <RotationView result={r} farm={farm} plots={plots} />
    case 'water':
      return <WaterView result={r} farm={farm} plots={plots} />
    default:
      return <RiskView result={r} />
  }
}

export default function AnalysisView() {
  const { id } = useParams()
  const { t } = useTranslation()
  const nav = useNavigate()
  const qc = useQueryClient()
  const { farm } = useFarmCtx()
  const q = useAnalysis(id, true)
  const plotsQ = usePlots(farm?.id)
  const a = q.data
  const status = a?.status

  useEffect(() => {
    if (status === 'completed' || status === 'failed') {
      qc.invalidateQueries({ queryKey: ['analyses'] })
      qc.invalidateQueries({ queryKey: ['plots'] })
    }
  }, [status, qc])

  // Reports → "Export PDF": open the report and bring up the browser's print / save-as-PDF dialog.
  const [params] = useSearchParams()
  const wantPrint = params.get('print') === '1'
  useEffect(() => {
    if (wantPrint && status === 'completed') {
      const id = setTimeout(() => window.print(), 900)
      return () => clearTimeout(id)
    }
  }, [wantPrint, status])

  if (q.isLoading) return <Skeleton className="h-96 !rounded-card" />
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!a || !farm) return <StateBlock icon="search" title={t('results.notFound')} />

  if (a.status === 'queued' || a.status === 'running') return <Processing a={a} />

  if (a.status === 'failed') {
    const code = a.error?.code
    const body =
      code === 'UNSUPPORTED_LOCATION' ? t('states.unsupportedLocationBody') : code === 'UNSUPPORTED_CROP' ? t('states.unsupportedCropBody') : code === 'NETWORK_ERROR' ? t('analysis.failedOffline') : code === 'MISSING_DATA' ? t('states.missingData') : code === 'INTERRUPTED' ? t('analysis.failedInterrupted') : t('states.errorBody')
    return (
      <Card>
        <StateBlock
          icon={code === 'NETWORK_ERROR' ? 'wifiOff' : 'alert'}
          tone="critical"
          title={t('analysis.failed')}
          body={body}
          action={
            <Button variant="secondary" icon="rotate" onClick={() => nav('/app/analysis/new')}>
              {t('common.retry')}
            </Button>
          }
        />
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3 no-print">
        <div className="me-auto">
          <h2 className="text-h1 font-semibold">{t(`analysis.objectives.${a.analysis_type}`)}</h2>
          <p className="text-caption text-text-secondary">
            {farm.name} · {date(a.created_at, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        <Button variant="secondary" icon="download" onClick={() => window.print()}>
          {t('results.exportPdf')}
        </Button>
        <Link to="/app/analysis/new" className="h-10 px-5 rounded-pill bg-green-600 text-white text-label flex items-center gap-2 hover:bg-green-700">
          <Icon name="plus" size={18} /> {t('results.newAnalysis')}
        </Link>
      </div>
      <div className="hidden print:block">
        <h1 className="text-h1 font-semibold">
          {t('app.name')} · {t(`analysis.objectives.${a.analysis_type}`)}
        </h1>
        <p className="text-label">
          {farm.name} · {date(a.created_at)}
        </p>
      </div>
      <ResultBody a={a} farm={farm} plots={plotsQ.data ?? []} />
    </div>
  )
}
